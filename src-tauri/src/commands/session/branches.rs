//! Conversation branches (#782).
//!
//! A Claude Code transcript is a tree, not a list: every entry names its
//! predecessor in `parentUuid`. Editing an earlier prompt, `/rewind`, or
//! resuming at an earlier message appends a new child to an old entry, so the
//! file then holds two continuations of that entry one after the other.
//!
//! Claude Code resumes exactly one of them. Its transcript loader (2.1.x)
//! takes the leaf recorded by the last `last-prompt` entry (`leafUuid`; a
//! compaction boundary or an explicit `leafUuid: null` clears it), unless the
//! last entry written descends from that leaf, and otherwise the last entry
//! written; it walks up to the nearest user/assistant entry and follows
//! `parentUuid` back to the root. This module picks the same path.
//!
//! The viewer pages a session from the newest end of the file, so the tree
//! cannot be rebuilt from the loaded window: a fork and its older alternatives
//! are usually outside it. This module reads the whole file's links instead
//! (uuid, parent, kind - no message bodies) and reports where the conversation
//! forks, which alternative Claude Code resumes at each fork, and which
//! alternative every entry below a fork belongs to. The frontend filters
//! whatever window it has loaded with that.
//!
//! Not every entry with two children is a fork. Claude Code writes one API
//! response with parallel tool calls as several assistant entries sharing the
//! response's `message.id`, and each tool result hangs off its own call, so
//! the chain goes on from one result while the others are dead ends; hook
//! output and other attachments are dead ends too. A child only counts as an
//! alternative when something below it is a new turn: a user prompt, or an
//! assistant entry that is not a further block of the response above it.
//! Sidechain entries (inline subagent runs) are never part of the tree, and a
//! second root (a compaction boundary, a continuation file) is not a fork.

use std::collections::{HashMap, HashSet};
use std::fmt;
use std::path::Path;

use memmap2::Mmap;
use rayon::prelude::*;
use serde::de::{self, Deserializer, SeqAccess, Visitor};
use serde::{Deserialize, Serialize};

use crate::commands::stats::session_files;
use crate::models::ClaudeMessage;
use crate::utils::find_line_ranges;

/// Where a conversation forks and the alternatives that continue from there.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationBranches {
    /// Fork points, in file order of the entry they fork from.
    pub points: Vec<BranchPoint>,
    /// Every alternative of every point; `BranchPoint::option_ids` index it.
    pub options: Vec<BranchOption>,
    /// Each entry below a fork -> the innermost alternative (an `options`
    /// index) it belongs to. Entries above every fork are absent.
    pub membership: HashMap<String, u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchPoint {
    /// The entry the alternatives continue from.
    pub parent_uuid: String,
    /// Its alternatives in file order (the order they were written).
    pub option_ids: Vec<u32>,
    /// The alternative Claude Code resumes. A fork off that path (inside an
    /// abandoned alternative) defaults to its most recently written one.
    pub default_option: u32,
    /// The alternative of an enclosing fork this point sits in, if any.
    pub parent_option: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchOption {
    /// Index of its `BranchPoint`.
    pub point: u32,
    /// The first entry of this alternative (a child of the point's entry).
    pub head_uuid: String,
    /// Its first user prompt or assistant reply in file order: an entry the
    /// viewer shows (a tool result is folded into its call).
    pub anchor_uuid: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NodeKind {
    /// A user turn: typed prompt, command, or other user text.
    Prompt,
    Assistant,
    /// A user entry carrying tool results.
    ToolResult,
    /// Anything else with a uuid: attachments, system and progress entries.
    Other,
}

/// One tree entry: just what the fork analysis needs.
#[derive(Debug, Clone)]
pub(crate) struct BranchNode {
    pub uuid: String,
    pub parent_uuid: Option<String>,
    pub kind: NodeKind,
    /// The API response an assistant entry belongs to (`message.id`).
    pub response_id: Option<String>,
}

/// The leaf a session recorded as where the user is (`last-prompt`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResumeHint {
    pub leaf_uuid: String,
    /// Set explicitly and nothing written since: it wins even over a later
    /// entry below it.
    pub pinned: bool,
}

/// Analyze a session's entries, given in file order.
pub(crate) fn compute_conversation_branches(
    entries: Vec<BranchNode>,
    hint: Option<ResumeHint>,
) -> ConversationBranches {
    // A uuid written twice keeps its first entry (its place in the file).
    let mut index: HashMap<&str, usize> = HashMap::with_capacity(entries.len());
    let mut nodes: Vec<&BranchNode> = Vec::with_capacity(entries.len());
    for entry in &entries {
        if !index.contains_key(entry.uuid.as_str()) {
            index.insert(entry.uuid.as_str(), nodes.len());
            nodes.push(entry);
        }
    }
    let n = nodes.len();

    let parent: Vec<Option<usize>> = nodes
        .iter()
        .enumerate()
        .map(|(i, node)| {
            node.parent_uuid
                .as_deref()
                .and_then(|p| index.get(p).copied())
                .filter(|&p| p != i)
        })
        .collect();
    let mut children: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (i, p) in parent.iter().enumerate() {
        if let Some(p) = *p {
            children[p].push(i);
        }
    }

    // Preorder from the roots, children in file order. Entries on a parent
    // cycle are unreachable and simply stay out of the analysis.
    let mut order = Vec::with_capacity(n);
    let mut stack: Vec<usize> = (0..n).rev().filter(|&i| parent[i].is_none()).collect();
    while let Some(i) = stack.pop() {
        order.push(i);
        stack.extend(children[i].iter().rev());
    }
    let mut reachable = vec![false; n];
    for &i in &order {
        reachable[i] = true;
    }

    // A new turn: a prompt, or an assistant entry that is not another block
    // of the response it sits under.
    let mut response_above: Vec<Option<&str>> = vec![None; n];
    let mut new_turn = vec![false; n];
    for &i in &order {
        let inherited = parent[i].and_then(|p| response_above[p]);
        let node = nodes[i];
        response_above[i] = inherited;
        match node.kind {
            NodeKind::Prompt => new_turn[i] = true,
            NodeKind::Assistant => {
                let id = node.response_id.as_deref();
                new_turn[i] = id.is_none() || id != inherited;
                if id.is_some() {
                    response_above[i] = id;
                }
            }
            NodeKind::ToolResult | NodeKind::Other => {}
        }
    }

    // Bottom-up: each subtree's last-written entry and its first new turn
    // (file positions).
    let mut last_written: Vec<usize> = (0..n).collect();
    let mut first_turn: Vec<Option<usize>> = vec![None; n];
    for &i in order.iter().rev() {
        if new_turn[i] {
            first_turn[i] = Some(i);
        }
        if let Some(p) = parent[i] {
            last_written[p] = last_written[p].max(last_written[i]);
            first_turn[p] = match (first_turn[p], first_turn[i]) {
                (Some(a), Some(b)) => Some(a.min(b)),
                (a, b) => a.or(b),
            };
        }
    }

    let on_resume_path = resume_path(&nodes, &parent, &reachable, &index, hint);

    let mut fork_parents: Vec<usize> = order
        .iter()
        .copied()
        .filter(|&p| {
            children[p]
                .iter()
                .filter(|&&c| first_turn[c].is_some())
                .count()
                >= 2
        })
        .collect();
    fork_parents.sort_unstable();

    let mut points = Vec::with_capacity(fork_parents.len());
    let mut options = Vec::new();
    let mut option_of_head: Vec<Option<u32>> = vec![None; n];
    for &p in &fork_parents {
        let point = points.len() as u32;
        let alternatives: Vec<usize> = children[p]
            .iter()
            .copied()
            .filter(|&c| first_turn[c].is_some())
            .collect();
        let first_option = options.len() as u32;
        let default_offset = alternatives
            .iter()
            .position(|c| on_resume_path.contains(c))
            .or_else(|| {
                alternatives
                    .iter()
                    .enumerate()
                    .max_by_key(|(_, &c)| last_written[c])
                    .map(|(offset, _)| offset)
            })
            .unwrap_or(0);
        for &c in &alternatives {
            option_of_head[c] = Some(options.len() as u32);
            options.push(BranchOption {
                point,
                head_uuid: nodes[c].uuid.clone(),
                anchor_uuid: first_turn[c].map_or_else(String::new, |a| nodes[a].uuid.clone()),
            });
        }
        points.push(BranchPoint {
            parent_uuid: nodes[p].uuid.clone(),
            option_ids: (first_option..options.len() as u32).collect(),
            default_option: first_option + default_offset as u32,
            parent_option: None,
        });
    }

    let mut option_at: Vec<Option<u32>> = vec![None; n];
    let mut membership = HashMap::new();
    for &i in &order {
        option_at[i] = option_of_head[i].or_else(|| parent[i].and_then(|p| option_at[p]));
        if let Some(option) = option_at[i] {
            membership.insert(nodes[i].uuid.clone(), option);
        }
    }
    for (point, &p) in points.iter_mut().zip(&fork_parents) {
        point.parent_option = option_at[p];
    }

    ConversationBranches {
        points,
        options,
        membership,
    }
}

/// The entries on the path Claude Code resumes (see the module docs).
fn resume_path(
    nodes: &[&BranchNode],
    parent: &[Option<usize>],
    reachable: &[bool],
    index: &HashMap<&str, usize>,
    hint: Option<ResumeHint>,
) -> HashSet<usize> {
    let ancestors = |from: usize| {
        let mut seen = Vec::new();
        let mut at = Some(from);
        while let Some(i) = at {
            seen.push(i);
            at = parent[i];
        }
        seen
    };

    let Some(last) = (0..nodes.len()).rev().find(|&i| reachable[i]) else {
        return HashSet::new();
    };
    let start = match hint.and_then(|h| Some((*index.get(h.leaf_uuid.as_str())?, h.pinned))) {
        Some((recorded, pinned)) if reachable[recorded] => {
            if !pinned && ancestors(last).contains(&recorded) {
                last
            } else {
                recorded
            }
        }
        _ => last,
    };
    let path = ancestors(start);
    let leaf = path
        .iter()
        .position(|&i| nodes[i].kind != NodeKind::Other)
        .unwrap_or(0);
    path[leaf..].iter().copied().collect()
}

// ---------------------------------------------------------------------------
// Claude Code: the raw lines of the session's file chain
// ---------------------------------------------------------------------------

/// The fields of one JSONL line the analysis reads.
#[derive(Deserialize)]
struct BranchLine {
    #[serde(rename = "type")]
    entry_type: String,
    subtype: Option<String>,
    uuid: Option<String>,
    #[serde(rename = "parentUuid")]
    parent_uuid: Option<String>,
    #[serde(rename = "isSidechain")]
    is_sidechain: Option<bool>,
    #[serde(rename = "isMeta")]
    is_meta: Option<bool>,
    message: Option<BranchLineMessage>,
    #[serde(rename = "toolUseResult")]
    tool_use_result: Option<serde::de::IgnoredAny>,
    /// `last-prompt` only.
    #[serde(rename = "leafUuid", default)]
    leaf_uuid: LeafField,
    explicit: Option<bool>,
}

/// A `last-prompt` record's `leafUuid`: absent, an explicit `null`, or a leaf.
#[derive(Default)]
enum LeafField {
    #[default]
    Absent,
    Cleared,
    Leaf(String),
}

impl<'de> Deserialize<'de> for LeafField {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(match Option::<String>::deserialize(deserializer)? {
            Some(leaf) => LeafField::Leaf(leaf),
            None => LeafField::Cleared,
        })
    }
}

#[derive(Deserialize)]
struct BranchLineMessage {
    id: Option<String>,
    #[serde(default)]
    content: ToolResultProbe,
}

/// Whether a `message.content` holds a `tool_result` block, read without
/// building the content: text is skipped, an array is read for block types.
#[derive(Default)]
struct ToolResultProbe(bool);

#[derive(Deserialize)]
struct BlockType {
    #[serde(rename = "type")]
    block_type: Option<String>,
}

impl<'de> Deserialize<'de> for ToolResultProbe {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct ProbeVisitor;

        impl<'de> Visitor<'de> for ProbeVisitor {
            type Value = ToolResultProbe;

            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("message content")
            }

            fn visit_str<E: de::Error>(self, _: &str) -> Result<Self::Value, E> {
                Ok(ToolResultProbe(false))
            }

            fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
                Ok(ToolResultProbe(false))
            }

            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
                let mut found = false;
                while let Some(block) = seq.next_element::<BlockType>()? {
                    found |= block.block_type.as_deref() == Some("tool_result");
                }
                Ok(ToolResultProbe(found))
            }
        }

        deserializer.deserialize_any(ProbeVisitor)
    }
}

/// What one line contributes: a tree entry, or a change of the resume hint.
enum ScanItem {
    Entry {
        node: BranchNode,
        compact_boundary: bool,
    },
    /// A `last-prompt` record: its leaf (`None` = explicitly cleared).
    LastPrompt {
        leaf_uuid: Option<String>,
        explicit: bool,
    },
}

fn parse_branch_line(line: &[u8]) -> Option<ScanItem> {
    if line.iter().all(u8::is_ascii_whitespace) {
        return None;
    }
    let mut bytes = line.to_vec();
    let line: BranchLine = simd_json::serde::from_slice(&mut bytes).ok()?;
    if line.entry_type == "last-prompt" {
        return Some(ScanItem::LastPrompt {
            leaf_uuid: match line.leaf_uuid {
                LeafField::Absent => return None,
                LeafField::Cleared => None,
                LeafField::Leaf(leaf) => Some(leaf),
            },
            explicit: line.explicit.unwrap_or(false),
        });
    }
    if line.is_sidechain.unwrap_or(false) {
        return None;
    }
    let uuid = line.uuid?;
    let (kind, response_id) = match line.entry_type.as_str() {
        "assistant" => (NodeKind::Assistant, line.message.and_then(|m| m.id)),
        "user" if line.is_meta.unwrap_or(false) => (NodeKind::Other, None),
        "user"
            if line.tool_use_result.is_some()
                || line.message.as_ref().is_some_and(|m| m.content.0) =>
        {
            (NodeKind::ToolResult, None)
        }
        "user" => (NodeKind::Prompt, None),
        _ => (NodeKind::Other, None),
    };
    Some(ScanItem::Entry {
        compact_boundary: line.subtype.as_deref() == Some("compact_boundary"),
        node: BranchNode {
            uuid,
            parent_uuid: line.parent_uuid,
            kind,
            response_id,
        },
    })
}

#[allow(unsafe_code)] // Required for mmap performance optimization
fn scan_claude_file(path: &Path) -> Result<Vec<ScanItem>, String> {
    let file = session_files::open_history_file(path)
        .map_err(|e| format!("Failed to open session file: {e}"))?;
    // SAFETY: We're only reading the file, and the file handle is kept open
    // for the duration of the mmap's lifetime. Session files are append-only.
    let mmap = unsafe { Mmap::map(&file) }
        .map_err(|e| format!("Failed to memory-map session file: {e}"))?;
    let ranges = find_line_ranges(&mmap);
    Ok(ranges
        .par_iter()
        .filter_map(|&(start, end)| parse_branch_line(&mmap[start..end]))
        .collect())
}

/// The forks of a Claude Code session, across its continuation files.
pub fn claude_conversation_branches(session_path: &Path) -> Result<ConversationBranches, String> {
    let chain = super::chain::resolve_session_chain(session_path);
    let mut nodes = Vec::new();
    let mut hint: Option<ResumeHint> = None;
    for (index, path) in chain.iter().enumerate() {
        let items = match scan_claude_file(path) {
            Ok(items) => items,
            Err(error) if index + 1 == chain.len() => return Err(error),
            Err(error) => {
                log::warn!(
                    "Skipping unreadable predecessor in branch scan {}: {error}",
                    path.display()
                );
                continue;
            }
        };
        for item in items {
            match item {
                ScanItem::Entry {
                    node,
                    compact_boundary,
                } => {
                    if compact_boundary {
                        hint = None;
                    } else if let Some(h) = hint.as_mut() {
                        h.pinned = false;
                    }
                    nodes.push(node);
                }
                ScanItem::LastPrompt {
                    leaf_uuid,
                    explicit,
                } => {
                    hint = leaf_uuid.map(|leaf_uuid| ResumeHint {
                        leaf_uuid,
                        pinned: explicit,
                    });
                }
            }
        }
    }
    Ok(compute_conversation_branches(nodes, hint))
}

// ---------------------------------------------------------------------------
// Other providers whose entries link the same way (Pi's id/parentId tree)
// ---------------------------------------------------------------------------

fn message_kind(message: &ClaudeMessage) -> NodeKind {
    match message.message_type.as_str() {
        "assistant" => NodeKind::Assistant,
        "user" => {
            let has_tool_result = message
                .content
                .as_ref()
                .and_then(|c| c.as_array())
                .is_some_and(|blocks| {
                    blocks
                        .iter()
                        .any(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_result"))
                });
            if has_tool_result {
                NodeKind::ToolResult
            } else {
                NodeKind::Prompt
            }
        }
        _ => NodeKind::Other,
    }
}

/// The forks of a session already parsed into messages, in file order. The
/// last entry written is where the session is.
pub fn conversation_branches_from_messages(messages: &[ClaudeMessage]) -> ConversationBranches {
    compute_conversation_branches(
        messages
            .iter()
            .filter(|m| !m.is_sidechain.unwrap_or(false))
            .map(|m| BranchNode {
                uuid: m.uuid.clone(),
                parent_uuid: m.parent_uuid.clone(),
                kind: message_kind(m),
                // One provider message is one whole response.
                response_id: None,
            })
            .collect(),
        None,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn line(value: serde_json::Value) -> String {
        format!("{value}\n")
    }

    fn user(uuid: &str, parent: Option<&str>, text: &str) -> String {
        line(serde_json::json!({
            "type": "user", "uuid": uuid, "parentUuid": parent, "sessionId": "s",
            "timestamp": "2026-01-01T00:00:00Z", "message": { "role": "user", "content": text }
        }))
    }

    fn assistant(uuid: &str, parent: &str, id: &str, tool: Option<&str>) -> String {
        let content = match tool {
            Some(tool_id) => {
                serde_json::json!([{ "type": "tool_use", "id": tool_id, "name": "Bash", "input": {} }])
            }
            None => serde_json::json!([{ "type": "text", "text": "reply" }]),
        };
        line(serde_json::json!({
            "type": "assistant", "uuid": uuid, "parentUuid": parent, "sessionId": "s",
            "timestamp": "2026-01-01T00:00:01Z",
            "message": { "id": id, "role": "assistant", "content": content }
        }))
    }

    fn tool_result(uuid: &str, parent: &str, tool_id: &str) -> String {
        line(serde_json::json!({
            "type": "user", "uuid": uuid, "parentUuid": parent, "sessionId": "s",
            "timestamp": "2026-01-01T00:00:02Z",
            "message": { "role": "user", "content": [{ "type": "tool_result", "tool_use_id": tool_id, "content": "ok" }] }
        }))
    }

    fn attachment(uuid: &str, parent: &str) -> String {
        line(serde_json::json!({
            "type": "attachment", "uuid": uuid, "parentUuid": parent, "sessionId": "s",
            "timestamp": "2026-01-01T00:00:03Z", "attachment": { "type": "hook_success" }
        }))
    }

    fn last_prompt(leaf: Option<&str>, explicit: bool) -> String {
        line(serde_json::json!({
            "type": "last-prompt", "lastPrompt": "p", "leafUuid": leaf,
            "explicit": explicit, "sessionId": "s"
        }))
    }

    fn analyze(lines: &[String]) -> ConversationBranches {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("session.jsonl");
        let mut file = std::fs::File::create(&path).unwrap();
        for l in lines {
            file.write_all(l.as_bytes()).unwrap();
        }
        claude_conversation_branches(&path).unwrap()
    }

    fn option_heads(branches: &ConversationBranches, point: usize) -> Vec<&str> {
        branches.points[point]
            .option_ids
            .iter()
            .map(|&o| branches.options[o as usize].head_uuid.as_str())
            .collect()
    }

    fn default_head(branches: &ConversationBranches, point: usize) -> &str {
        let id = branches.points[point].default_option as usize;
        &branches.options[id].head_uuid
    }

    /// Written by Claude Code 2.1.285 itself: `claude -p` ("one"), then
    /// `--resume` ("two"), then `--resume --resume-session-at <first reply>`
    /// ("three"), so "two" and "three" both answer the first reply. Only the
    /// working directory and attachment payloads were reduced.
    const PRODUCER_FORK: &str =
        include_str!("../../../tests/fixtures/claude-branch-resume-at.jsonl");

    #[test]
    fn claude_code_resume_at_writes_a_fork_in_the_same_file() {
        let lines: Vec<String> = PRODUCER_FORK.lines().map(|l| format!("{l}\n")).collect();
        let branches = analyze(&lines);
        assert_eq!(branches.points.len(), 1);
        assert_eq!(
            branches.points[0].parent_uuid,
            "84765127-8603-4719-97ba-c27fb082242e"
        );
        assert_eq!(
            option_heads(&branches, 0),
            [
                "190d25cf-ad05-4059-b282-223840233d3c",
                "3612e3a6-f490-4d3c-a43d-b4d263bb9651"
            ]
        );
        // The last `last-prompt` names the "three" reply.
        assert_eq!(
            default_head(&branches, 0),
            "3612e3a6-f490-4d3c-a43d-b4d263bb9651"
        );
        // The reply to "two" is below the fork, the first reply above it.
        assert_eq!(
            branches
                .membership
                .get("61d8c87c-bdd3-4d5c-baf3-437b844ec194"),
            Some(&0)
        );
        assert_eq!(
            branches
                .membership
                .get("84765127-8603-4719-97ba-c27fb082242e"),
            None
        );

        // Had the user gone back to "two", its leaf is the one recorded.
        let mut lines = lines;
        lines.push(last_prompt(
            Some("61d8c87c-bdd3-4d5c-baf3-437b844ec194"),
            false,
        ));
        assert_eq!(
            default_head(&analyze(&lines), 0),
            "190d25cf-ad05-4059-b282-223840233d3c"
        );
    }

    /// An edited prompt: `old` and `new` both answer `a1`.
    fn edited() -> Vec<String> {
        vec![
            user("u1", None, "hi"),
            assistant("a1", "u1", "m1", None),
            user("old", Some("a1"), "first try"),
            assistant("old-a", "old", "m2", None),
            user("new", Some("a1"), "edited"),
            assistant("new-a", "new", "m3", None),
        ]
    }

    #[test]
    fn linear_conversation_has_no_branches() {
        let branches = analyze(&[
            user("u1", None, "hi"),
            assistant("a1", "u1", "m1", None),
            user("u2", Some("a1"), "next"),
            assistant("a2", "u2", "m2", None),
        ]);
        assert_eq!(branches, ConversationBranches::default());
    }

    #[test]
    fn standalone_tool_results_with_a_shared_parent_do_not_fork() {
        let branches = analyze(&[
            user("prompt", None, "hi"),
            r#"{"type":"user","uuid":"read-result","parentUuid":"prompt","message":{"role":"user","content":""},"toolUseResult":{"result":0}}"#.into(),
            r#"{"type":"user","uuid":"terminal-result","parentUuid":"prompt","message":{"role":"user","content":""},"toolUseResult":{"stdout":"ok"}}"#.into(),
        ]);
        assert_eq!(branches, ConversationBranches::default());
    }

    #[test]
    fn edited_prompt_forks_and_resumes_the_last_written_alternative() {
        let branches = analyze(&edited());
        assert_eq!(branches.points.len(), 1);
        assert_eq!(branches.points[0].parent_uuid, "a1");
        assert_eq!(option_heads(&branches, 0), ["old", "new"]);
        assert_eq!(default_head(&branches, 0), "new");
        assert_eq!(branches.points[0].parent_option, None);
        assert_eq!(branches.membership.get("old-a"), Some(&0));
        assert_eq!(branches.membership.get("new-a"), Some(&1));
        // Above the fork: every alternative shows it.
        assert_eq!(branches.membership.get("a1"), None);
        assert_eq!(branches.options[1].anchor_uuid, "new");
    }

    #[test]
    fn recorded_last_prompt_leaf_decides_the_resumed_alternative() {
        // The user went back to the first alternative: Claude Code recorded
        // its leaf after the second one was written.
        let mut lines = edited();
        lines.push(last_prompt(Some("old-a"), false));
        assert_eq!(default_head(&analyze(&lines), 0), "old");

        // A later entry below the recorded leaf moves on with it.
        let mut lines = edited();
        lines.push(last_prompt(Some("new"), false));
        lines.push(attachment("hook", "new-a"));
        assert_eq!(default_head(&analyze(&lines), 0), "new");

        // An explicit null clears it: back to the last entry written.
        let mut lines = edited();
        lines.push(last_prompt(Some("old-a"), false));
        lines.push(last_prompt(None, true));
        assert_eq!(default_head(&analyze(&lines), 0), "new");

        // A leaf that is not in the file is ignored.
        let mut lines = edited();
        lines.push(last_prompt(Some("elsewhere"), false));
        assert_eq!(default_head(&analyze(&lines), 0), "new");
    }

    #[test]
    fn parallel_tool_calls_and_attachments_are_not_branches() {
        // One response, two tool calls written as two entries; each result
        // hangs off its own call, and the reply continues from either one.
        for continue_from in ["r1", "r2"] {
            let branches = analyze(&[
                user("u1", None, "run both"),
                assistant("c1", "u1", "resp", Some("t1")),
                attachment("hook", "c1"),
                assistant("c2", "c1", "resp", Some("t2")),
                tool_result("r1", "c1", "t1"),
                tool_result("r2", "c2", "t2"),
                assistant("done", continue_from, "resp2", None),
            ]);
            assert_eq!(
                branches,
                ConversationBranches::default(),
                "continued from {continue_from}"
            );
        }
    }

    #[test]
    fn sidechains_meta_and_second_roots_are_not_branches() {
        let sidechain = line(serde_json::json!({
            "type": "user", "uuid": "side", "parentUuid": "u1", "isSidechain": true,
            "sessionId": "s", "timestamp": "2026-01-01T00:00:09Z",
            "message": { "role": "user", "content": "subagent prompt" }
        }));
        let meta = line(serde_json::json!({
            "type": "user", "uuid": "meta", "parentUuid": "u1", "isMeta": true,
            "sessionId": "s", "timestamp": "2026-01-01T00:00:09Z",
            "message": { "role": "user", "content": "caveat" }
        }));
        let boundary = line(serde_json::json!({
            "type": "system", "subtype": "compact_boundary", "uuid": "cb", "parentUuid": null,
            "logicalParentUuid": "a1", "sessionId": "s", "timestamp": "2026-01-01T00:00:04Z"
        }));
        let branches = analyze(&[
            user("u1", None, "hi"),
            assistant("a1", "u1", "m1", None),
            sidechain,
            meta,
            boundary,
            user("u2", Some("cb"), "after compaction"),
            assistant("a2", "u2", "m2", None),
        ]);
        assert_eq!(branches, ConversationBranches::default());
    }

    #[test]
    fn nested_forks_name_their_enclosing_alternative() {
        let branches = analyze(&[
            user("u1", None, "hi"),
            user("a", Some("u1"), "A"),
            assistant("a-r", "a", "m1", None),
            user("a1", Some("a-r"), "A1"),
            user("a2", Some("a-r"), "A2"),
            user("b", Some("u1"), "B"),
        ]);
        assert_eq!(branches.points.len(), 2);
        assert_eq!(option_heads(&branches, 0), ["a", "b"]);
        assert_eq!(option_heads(&branches, 1), ["a1", "a2"]);
        assert_eq!(default_head(&branches, 0), "b");
        // Off the resumed path: its most recently written alternative.
        assert_eq!(default_head(&branches, 1), "a2");
        assert_eq!(branches.points[1].parent_option, Some(0));
        assert_eq!(branches.membership.get("a-r"), Some(&0));
        assert_eq!(branches.membership.get("a1"), Some(&2));
    }

    #[test]
    fn duplicate_uuids_and_cycles_do_not_break_the_analysis() {
        let branches = analyze(&[
            user("u1", None, "hi"),
            user("u1", None, "hi again"),
            user("c1", Some("c2"), "loop"),
            user("c2", Some("c1"), "loop"),
            "not json\n".to_string(),
        ]);
        assert_eq!(branches, ConversationBranches::default());
    }

    #[test]
    fn branches_from_messages_use_the_same_rules() {
        let message = |uuid: &str, parent: Option<&str>, kind: &str| ClaudeMessage {
            uuid: uuid.into(),
            parent_uuid: parent.map(Into::into),
            session_id: "s".into(),
            timestamp: "2026-01-01T00:00:00Z".into(),
            message_type: kind.into(),
            content: Some(serde_json::json!([{ "type": "text", "text": "x" }])),
            ..ClaudeMessage::default()
        };
        let branches = conversation_branches_from_messages(&[
            message("u1", None, "user"),
            message("x", Some("u1"), "assistant"),
            message("y", Some("u1"), "assistant"),
        ]);
        assert_eq!(branches.points.len(), 1);
        assert_eq!(default_head(&branches, 0), "y");
    }
}
