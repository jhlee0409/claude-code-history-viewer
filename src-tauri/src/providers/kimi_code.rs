//! Kimi Code (`kimi-code`, the 2026 rewrite of `kimi-cli`) session store,
//! surfaced through the existing `kimi` provider — the new CLI writes to
//! `~/.kimi-code`, a sibling of the old CLI's `~/.kimi` root, and both
//! layouts may coexist on one machine (antigravity/antigravity-cli pattern).
//!
//! Layout (from `packages/agent-core-v2` sources of the kimi-code repo):
//!
//! ```text
//! ~/.kimi-code/                       # KIMI_CODE_HOME overrides this root
//! ├── workspaces.json                 # { "workspaces": { "wd_<hash>": { root, name, … } } }
//! └── sessions/
//!     └── wd_<hash>/                  # one workspace directory
//!         └── session_<uuid>/
//!             ├── state.json          # { id, version: 2, cwd, title, lastPrompt,
//!             │                       #   createdAt, updatedAt, … }
//!             └── agents/
//!                 └── main/wire.jsonl # per-agent event journal (protocol 1.5)
//! ```
//!
//! `wire.jsonl` is a flat JSONL journal: one record per line, each shaped
//! `{ "type": <event>, …payload, "time": <epoch-ms> }`. The conversation is
//! rebuilt by replaying the `context.*` vocabulary exactly like the agent
//! core's `contextMemory` fold (`loopEventFold.ts`):
//!
//! - `context.append_message` — a fully formed message (`role`, `content[]`,
//!   `toolCalls[]`, optional `origin`, `id`) appended to the context. Only
//!   user/system-side messages are written this way; assistant turns are
//!   streamed as loop events.
//! - `context.append_loop_event` — one streaming event inside a turn:
//!   `step.begin` (open a partial assistant), `content.part` (append a
//!   `text` / `think` / media part), `tool.call` (append a tool call and
//!   mark it pending), `tool.result` (push a `tool` message for the pending
//!   call), `step.end` (settle the assistant: pending calls without results
//!   become interrupted tool messages; an assistant with no tool calls and
//!   only vacuous content is dropped).
//! - `context.clear` — reset the context, `context.undo` — cut the last
//!   `count` undo anchors (user prompts) with everything after them,
//!   `context.apply_compaction` — replace the compacted prefix with a
//!   summary message.
//!
//! A `context.append_message` arriving while tool results are still pending
//! is deferred until the exchange closes (assistant↔tool adjacency).
//! Everything else (`turn.*`, `llm.*`, `usage.record`, `permission.*`,
//! `profile.bind`, `plugin.*`, …) is session machinery, not conversation
//! content, and is skipped. Parsing is tolerant: malformed lines are
//! skipped, never propagated as scan errors.

use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::utils::{build_provider_message, is_symlink, search_json_value_case_insensitive};
use chrono::{TimeZone, Utc};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::BufRead;
use std::path::{Path, PathBuf};

/// The kimi-code layout is exposed through the existing `kimi` provider id
/// (see module docs) — a new id would require the full frontend registry +
/// i18n sweep for what is the same product.
const PROVIDER_ID: &str = "kimi";
/// Scheme prefix distinguishing kimi-code workspace paths from the old
/// CLI's `kimi://<dir>` paths inside the shared `kimi` provider.
pub(crate) const SCHEME: &str = "kimi-code://";
const SESSIONS_DIR: &str = "sessions";
const AGENTS_DIR: &str = "agents";
/// The primary agent of a session; subagent wires are sidechains and are
/// not surfaced (same policy as the old CLI reader).
const MAIN_AGENT: &str = "main";
const WIRE_FILE: &str = "wire.jsonl";
const STATE_FILE: &str = "state.json";
const WORKSPACES_FILE: &str = "workspaces.json";
const SUMMARY_MAX_CHARS: usize = 200;

/// Default kimi-code home. Mirrors the agent core's bootstrap: the
/// `KIMI_CODE_HOME` env var overrides `~/.kimi-code`.
pub(crate) fn default_root() -> Option<PathBuf> {
    if let Ok(env_val) = std::env::var("KIMI_CODE_HOME") {
        let path = PathBuf::from(&env_val);
        let absolute = if path.is_absolute() {
            path
        } else {
            std::env::current_dir().ok()?.join(path)
        };
        if absolute.exists() {
            return Some(absolute.canonicalize().unwrap_or(absolute));
        }
        return None;
    }
    let default = dirs::home_dir()?.join(".kimi-code");
    default
        .exists()
        .then(|| default.canonicalize().unwrap_or(default))
}

/// The sessions root (`<root>/sessions`), when it exists as a directory.
fn sessions_root(root: &Path) -> Option<PathBuf> {
    let root = root.join(SESSIONS_DIR);
    (!is_symlink(&root) && root.is_dir()).then_some(root)
}

/// True when the default kimi-code root looks like a kimi-code store.
pub(crate) fn is_available() -> bool {
    default_root()
        .and_then(|root| sessions_root(&root))
        .is_some_and(|root| has_any_session_dir(&root))
}

/// At least one `wd_*/session_*` directory exists under the sessions root.
fn has_any_session_dir(sessions_root: &Path) -> bool {
    list_workspace_dirs(sessions_root)
        .iter()
        .any(|dir| !list_session_dirs(dir).is_empty())
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider interface (default-root wrappers)
// ─────────────────────────────────────────────────────────────────────────────

/// Kimi-code projects, one per `wd_<hash>` workspace directory. Tolerant: a
/// missing or unreadable store yields an empty list, never an error.
pub fn scan_projects() -> Vec<ClaudeProject> {
    default_root()
        .and_then(|root| sessions_root(&root))
        .map(|root| scan_projects_from_root(&root))
        .unwrap_or_default()
}

/// Sessions for one workspace — the `kimi-code://`-stripped workspace dir.
pub fn load_sessions(workspace_dir: &str) -> Result<Vec<ClaudeSession>, String> {
    let Some(root) = default_root() else {
        return Ok(Vec::new());
    };
    let workspace = resolve_workspace_dir(&root, workspace_dir)?;
    Ok(load_sessions_from_dir(&workspace))
}

/// True when `session_path` is a valid kimi-code session directory under
/// the default root — used by the shared provider to route `load_messages`.
pub(crate) fn owns_session_path(session_path: &str) -> bool {
    let Some(root) = default_root() else {
        return false;
    };
    validate_session_dir(&root, session_path).is_ok()
}

pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let root = default_root().ok_or("Kimi Code root not found")?;
    load_messages_from_root(&root, session_path)
}

/// Content search across kimi-code conversations. Tolerant: errors degrade
/// to an empty result set.
pub fn search(query: &str, limit: usize) -> Vec<ClaudeMessage> {
    default_root()
        .and_then(|root| sessions_root(&root))
        .map(|root| search_from_root(&root, query, limit))
        .unwrap_or_default()
}

// ─────────────────────────────────────────────────────────────────────────────
// Root-parameterized implementation (fixture-testable)
// ─────────────────────────────────────────────────────────────────────────────

pub(crate) fn scan_projects_from_root(sessions_root: &Path) -> Vec<ClaudeProject> {
    // Workspace roots come from workspaces.json (`root`/`name`); per-session
    // state.json cwd values are the fallback for unindexed workspaces.
    let workspace_map = read_workspace_roots(sessions_root.parent().unwrap_or(sessions_root));

    let mut projects = Vec::new();
    for workspace_dir in list_workspace_dirs(sessions_root) {
        let sessions: Vec<ClaudeSession> = list_session_dirs(&workspace_dir)
            .into_iter()
            .filter_map(|dir| build_session(&dir))
            .map(CodeSession::into_claude_session)
            .collect();
        if sessions.is_empty() {
            continue;
        }

        let workspace_id = workspace_dir
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        let actual_path = workspace_map
            .get(&workspace_id)
            .cloned()
            .or_else(|| read_state_cwd(&workspace_dir))
            .unwrap_or_else(|| workspace_id.clone());
        let name = project_name_for_root(&actual_path, &workspace_id);
        let message_count = sessions.iter().map(|s| s.message_count).sum();
        let last_modified = sessions
            .iter()
            .map(|s| s.last_modified.as_str())
            .max()
            .unwrap_or_default()
            .to_string();

        projects.push(ClaudeProject {
            name,
            path: format!("{SCHEME}{}", workspace_dir.to_string_lossy()),
            actual_path: actual_path.clone(),
            session_count: sessions.len(),
            message_count,
            last_modified,
            git_info: if Path::new(&actual_path).is_absolute() {
                crate::utils::detect_git_worktree_info(&actual_path)
            } else {
                None
            },
            provider: Some(PROVIDER_ID.to_string()),
            storage_type: Some("jsonl".to_string()),
            custom_directory_label: None,
        });
    }

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    projects
}

pub(crate) fn load_sessions_from_dir(workspace_dir: &Path) -> Vec<ClaudeSession> {
    let mut sessions: Vec<ClaudeSession> = list_session_dirs(workspace_dir)
        .into_iter()
        .filter_map(|dir| build_session(&dir))
        .map(CodeSession::into_claude_session)
        .collect();
    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    sessions
}

pub(crate) fn load_messages_from_root(
    root: &Path,
    session_path: &str,
) -> Result<Vec<ClaudeMessage>, String> {
    let session_dir = validate_session_dir(root, session_path)?;
    let session_id = session_dir
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .ok_or("Kimi Code session path has no directory name")?;

    let wire = main_wire_path(&session_dir);
    let fallback_ts = read_state_json(&session_dir)
        .and_then(|state| {
            state
                .get("createdAt")
                .and_then(Value::as_u64)
                .and_then(ms_to_rfc3339)
        })
        .or_else(|| file_modified_iso(&wire))
        .unwrap_or_default();

    Ok(fold_wire_messages(&wire, &session_id, &fallback_ts))
}

pub(crate) fn search_from_root(
    sessions_root: &Path,
    query: &str,
    limit: usize,
) -> Vec<ClaudeMessage> {
    let query_lower = query.to_lowercase();
    let workspace_map = read_workspace_roots(sessions_root.parent().unwrap_or(sessions_root));

    let mut results = Vec::new();
    for workspace_dir in list_workspace_dirs(sessions_root) {
        let project_name = project_name_for_workspace(&workspace_dir, &workspace_map);
        for session_dir in list_session_dirs(&workspace_dir) {
            let Some(session) = build_session(&session_dir) else {
                continue;
            };
            for mut message in session.messages {
                let matches = message.content.as_ref().is_some_and(|content| {
                    search_json_value_case_insensitive(content, &query_lower)
                });
                if matches {
                    message.project_name = Some(project_name.clone());
                    results.push(message);
                    if results.len() >= limit {
                        return results;
                    }
                }
            }
        }
    }
    results
}

// ─────────────────────────────────────────────────────────────────────────────
// Session scanning
// ─────────────────────────────────────────────────────────────────────────────

/// One scanned session: the folded messages plus the metadata the viewer
/// list needs.
struct CodeSession {
    session_id: String,
    dir: PathBuf,
    summary: Option<String>,
    first_message_time: String,
    last_message_time: String,
    messages: Vec<ClaudeMessage>,
    /// Originating client value for `ClaudeSession.entrypoint`, following
    /// the Claude Code pattern (`cli` / `claude-vscode` / …): the VS Code
    /// extension stamps `custom.vscode_legacy_approval` into `state.json`
    /// (`apps/vscode/src/runtime/legacy-approval.ts`), everything else ran
    /// in the terminal.
    entrypoint: String,
}

impl CodeSession {
    fn into_claude_session(self) -> ClaudeSession {
        let has_tool_use = self.messages.iter().any(|message| {
            message
                .content
                .as_ref()
                .and_then(Value::as_array)
                .is_some_and(|blocks| {
                    blocks
                        .iter()
                        .any(|block| block.get("type").and_then(Value::as_str) == Some("tool_use"))
                })
        });
        // Error results surface as `is_error` tool_result blocks (folded
        // from `tool.result` records or interrupted-pending compensation).
        let has_errors = self.messages.iter().any(|message| {
            message
                .content
                .as_ref()
                .and_then(Value::as_array)
                .is_some_and(|blocks| {
                    blocks.iter().any(|block| {
                        block.get("type").and_then(Value::as_str) == Some("tool_result")
                            && block.get("is_error").and_then(Value::as_bool) == Some(true)
                    })
                })
        });

        ClaudeSession {
            session_id: self.session_id.clone(),
            actual_session_id: self.session_id,
            file_path: self.dir.to_string_lossy().to_string(),
            project_name: String::new(),
            message_count: self.messages.len(),
            first_message_time: self.first_message_time,
            last_message_time: self.last_message_time.clone(),
            last_modified: self.last_message_time,
            has_tool_use,
            has_errors,
            summary: self.summary,
            is_renamed: false,
            provider: Some(PROVIDER_ID.to_string()),
            storage_type: Some("jsonl".to_string()),
            entrypoint: Some(self.entrypoint),
        }
    }
}

/// Fold one session directory's main wire into a `CodeSession`; `None` when
/// the session has no readable wire or produces no viewer messages.
fn build_session(session_dir: &Path) -> Option<CodeSession> {
    let wire = main_wire_path(session_dir);
    if is_symlink(&wire) || !wire.is_file() {
        return None;
    }

    let session_id = session_dir.file_name()?.to_string_lossy().to_string();
    let state = read_state_json(session_dir);
    let fallback_ts = state
        .as_ref()
        .and_then(|s| s.get("createdAt").and_then(Value::as_u64))
        .and_then(ms_to_rfc3339)
        .or_else(|| file_modified_iso(&wire))
        .unwrap_or_default();

    let messages = fold_wire_messages(&wire, &session_id, &fallback_ts);
    if messages.is_empty() {
        return None;
    }

    let first_message_time = messages
        .first()
        .map(|m| m.timestamp.clone())
        .unwrap_or_default();
    let last_message_time = messages
        .last()
        .map(|m| m.timestamp.clone())
        .unwrap_or_default();

    let title = state
        .as_ref()
        .and_then(|s| {
            s.get("title")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|t| !t.is_empty())
        })
        .map(ToOwned::to_owned);
    let summary = title
        .or_else(|| first_user_text(&messages))
        .map(|text| truncate_chars(&text, SUMMARY_MAX_CHARS));

    let entrypoint = if state
        .as_ref()
        .and_then(|s| s.get("custom"))
        .and_then(|custom| custom.get("vscode_legacy_approval"))
        .is_some()
    {
        "kimi-vscode"
    } else {
        "kimi-cli"
    };

    Some(CodeSession {
        session_id,
        dir: session_dir.to_path_buf(),
        summary,
        first_message_time,
        last_message_time,
        messages,
        entrypoint: entrypoint.to_string(),
    })
}

/// `wd_*` directories under the sessions root, sorted for stable output.
fn list_workspace_dirs(sessions_root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(sessions_root) else {
        return Vec::new();
    };
    let mut dirs: Vec<PathBuf> = entries
        .flatten()
        .filter(|entry| {
            entry
                .file_type()
                .is_ok_and(|ft| !ft.is_symlink() && ft.is_dir())
        })
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("wd_"))
        })
        .collect();
    dirs.sort();
    dirs
}

/// `session_*` directories under one workspace dir, sorted for stable output.
fn list_session_dirs(workspace_dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(workspace_dir) else {
        return Vec::new();
    };
    let mut dirs: Vec<PathBuf> = entries
        .flatten()
        .filter(|entry| {
            entry
                .file_type()
                .is_ok_and(|ft| !ft.is_symlink() && ft.is_dir())
        })
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("session_"))
        })
        .collect();
    dirs.sort();
    dirs
}

fn main_wire_path(session_dir: &Path) -> PathBuf {
    session_dir
        .join(AGENTS_DIR)
        .join(MAIN_AGENT)
        .join(WIRE_FILE)
}

fn read_state_json(session_dir: &Path) -> Option<Value> {
    let path = session_dir.join(STATE_FILE);
    if is_symlink(&path) || !path.is_file() {
        return None;
    }
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

/// First non-empty `state.json` `cwd` among a workspace's sessions — the
/// fallback project root when `workspaces.json` has no entry.
fn read_state_cwd(workspace_dir: &Path) -> Option<String> {
    list_session_dirs(workspace_dir)
        .into_iter()
        .find_map(|dir| {
            read_state_json(&dir)?
                .get("cwd")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
}

/// `workspaces.json` → `wd_<id>` → workspace root path.
fn read_workspace_roots(root: &Path) -> HashMap<String, String> {
    let path = root.join(WORKSPACES_FILE);
    if is_symlink(&path) || !path.is_file() {
        return HashMap::new();
    }
    let Ok(content) = fs::read_to_string(path) else {
        return HashMap::new();
    };
    let Ok(value) = serde_json::from_str::<Value>(&content) else {
        return HashMap::new();
    };

    value
        .get("workspaces")
        .and_then(Value::as_object)
        .map(|workspaces| {
            workspaces
                .iter()
                .filter_map(|(id, info)| {
                    info.get("root")
                        .and_then(Value::as_str)
                        .filter(|root| !root.is_empty())
                        .map(|root| (id.clone(), root.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn project_name_for_root(root: &str, workspace_id: &str) -> String {
    Path::new(root)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| workspace_id.to_string())
}

fn project_name_for_workspace(
    workspace_dir: &Path,
    workspace_map: &HashMap<String, String>,
) -> String {
    let id = workspace_dir
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    workspace_map
        .get(&id)
        .map(|root| project_name_for_root(root, &id))
        .unwrap_or_else(|| id)
}

// ─────────────────────────────────────────────────────────────────────────────
// Wire fold — the contextMemory/loopEventFold replay, in Rust
// ─────────────────────────────────────────────────────────────────────────────

/// A folded context message with the timestamp of the record that produced
/// it (the fold itself carries no time).
struct FoldedMessage {
    role: String,
    content: Vec<Value>,
    tool_calls: Vec<Value>,
    tool_call_id: Option<String>,
    is_error: Option<bool>,
    /// The wire message `id` (e.g. `msg_…`) — links prompt-owned injections
    /// back to their anchor during the undo cut.
    id: Option<String>,
    /// The wire `origin` object — drives the undo-anchor cut.
    origin: Option<Value>,
    /// `true` while the assistant message is still absorbing loop events
    /// (`step.begin` opened it, `step.end` has not settled it).
    partial: bool,
    timestamp: String,
    model: Option<String>,
}

impl FoldedMessage {
    fn origin_kind(&self) -> Option<&str> {
        self.origin
            .as_ref()
            .and_then(|origin| origin.get("kind"))
            .and_then(Value::as_str)
    }

    /// The agent core's `isUndoAnchor`: a user message the user themself
    /// triggered (plain, or via user-slash skill/plugin commands).
    fn is_undo_anchor(&self) -> bool {
        if self.role != "user" {
            return false;
        }
        match self.origin_kind() {
            None | Some("user") => true,
            Some("skill_activation" | "plugin_command") => {
                self.origin
                    .as_ref()
                    .and_then(|origin| origin.get("trigger"))
                    .and_then(Value::as_str)
                    == Some("user-slash")
            }
            _ => false,
        }
    }
}

/// Replay state — mirrors `loopEventFold.ts`'s `FoldCtx` plus the current
/// model alias from the latest `profile.bind`/`llm.request` record.
struct FoldState {
    pending: Vec<String>,
    deferred: Vec<FoldedMessage>,
    model: Option<String>,
}

/// Replay `wire.jsonl` into viewer messages.
///
/// Best-effort: malformed lines and unknown record types are skipped — a
/// partial journal must never fail the whole session.
pub(crate) fn fold_wire_messages(
    wire_path: &Path,
    session_id: &str,
    fallback_ts: &str,
) -> Vec<ClaudeMessage> {
    if is_symlink(wire_path) || !wire_path.is_file() {
        return Vec::new();
    }
    // Streamed line-by-line: scan folds every session's journal, so whole
    // journal buffering would multiply peak memory by the session count.
    let Ok(file) = fs::File::open(wire_path) else {
        return Vec::new();
    };
    let reader = std::io::BufReader::new(file);

    let mut history: Vec<FoldedMessage> = Vec::new();
    let mut state = FoldState {
        pending: Vec::new(),
        deferred: Vec::new(),
        model: None,
    };
    let mut last_ts = fallback_ts.to_string();

    for line in reader.lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(record) = serde_json::from_str::<Value>(&line) else {
            continue; // torn/malformed tail — skip like the agent core does
        };
        if let Some(ts) = record
            .get("time")
            .and_then(Value::as_u64)
            .and_then(ms_to_rfc3339)
        {
            last_ts = ts;
        }
        let record_type = record.get("type").and_then(Value::as_str).unwrap_or("");
        match record_type {
            "profile.bind" | "llm.request" => {
                let alias = record
                    .get("modelAlias")
                    .and_then(Value::as_str)
                    .or_else(|| record.get("model").and_then(Value::as_str));
                if let Some(alias) = alias {
                    state.model = Some(alias.to_string());
                }
            }
            "context.append_message" => {
                if let Some(message) = record.get("message") {
                    fold_append_message(&mut history, &mut state, message, &last_ts);
                }
            }
            "context.append_loop_event" => {
                if let Some(event) = record.get("event") {
                    fold_loop_event(&mut history, &mut state, event, &last_ts);
                }
            }
            "context.clear" => {
                history.clear();
                state.pending.clear();
                state.deferred.clear();
            }
            "context.undo" => {
                let count = record.get("count").and_then(Value::as_u64).unwrap_or(1) as usize;
                apply_undo_cut(&mut history, count);
                // The cut removed the assistant holding the open tool
                // exchange, so its pending calls and any messages deferred
                // behind that exchange are gone with it — keeping them
                // would resurrect interrupted results for calls that no
                // longer exist.
                state.pending.clear();
                state.deferred.clear();
            }
            "context.apply_compaction" => {
                fold_apply_compaction(&mut history, &mut state, &record, &last_ts);
            }
            _ => {}
        }
    }

    // A journal cut mid-turn (crash) may still hold a partial assistant or
    // open tool exchange — settle it exactly like a `step.end` would.
    settle_open_step(&mut history, &mut state, &last_ts);

    history
        .into_iter()
        .enumerate()
        .filter_map(|(index, message)| convert_folded_message(message, session_id, index as u64))
        .collect()
}

/// `ContextAppendMessage` fold: append unless a tool exchange is open, in
/// which case defer until the exchange closes.
fn fold_append_message(
    history: &mut Vec<FoldedMessage>,
    state: &mut FoldState,
    message: &Value,
    timestamp: &str,
) {
    let role = message.get("role").and_then(Value::as_str).unwrap_or("");
    if role.is_empty() {
        return;
    }
    let content = match message.get("content") {
        Some(Value::Array(items)) => items.iter().map(normalize_content_part).collect::<Vec<_>>(),
        Some(Value::String(text)) => vec![json!({ "type": "text", "text": text })],
        _ => Vec::new(),
    };
    let tool_calls = message
        .get("toolCalls")
        .and_then(Value::as_array)
        .map(|calls| calls.iter().map(convert_tool_call).collect())
        .unwrap_or_default();

    let folded = FoldedMessage {
        role: role.to_string(),
        content,
        tool_calls,
        tool_call_id: message
            .get("toolCallId")
            .and_then(Value::as_str)
            .map(String::from),
        is_error: message.get("isError").and_then(Value::as_bool),
        id: message.get("id").and_then(Value::as_str).map(String::from),
        origin: message.get("origin").cloned(),
        partial: false,
        timestamp: timestamp.to_string(),
        model: state.model.clone(),
    };

    if state.pending.is_empty() {
        history.push(folded);
    } else {
        state.deferred.push(folded);
    }
}

/// `ContextAppendLoopEvent` fold — the streaming turn vocabulary.
fn fold_loop_event(
    history: &mut Vec<FoldedMessage>,
    state: &mut FoldState,
    event: &Value,
    timestamp: &str,
) {
    let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
    match event_type {
        "step.begin" => {
            settle_open_step(history, state, timestamp);
            history.push(FoldedMessage {
                role: "assistant".to_string(),
                content: Vec::new(),
                tool_calls: Vec::new(),
                tool_call_id: None,
                is_error: None,
                id: None,
                origin: None,
                partial: true,
                timestamp: timestamp.to_string(),
                model: state.model.clone(),
            });
        }
        "content.part" => {
            if let Some(part) = event.get("part") {
                if let Some(open) = history.iter_mut().rev().find(|m| m.partial) {
                    open.content.push(normalize_content_part(part));
                }
            }
        }
        "tool.call" => {
            let id = event
                .get("toolCallId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let call = json!({
                "type": "tool_use",
                "id": id,
                "name": event.get("name").and_then(Value::as_str).unwrap_or("tool"),
                "input": event.get("args").cloned().unwrap_or_else(|| json!({})),
            });
            // Mirrors the fold: the call is pending even when no assistant
            // step is open; the block itself needs an open step to land on.
            state.pending.push(id);
            if let Some(open) = history.iter_mut().rev().find(|m| m.partial) {
                open.tool_calls.push(call);
            }
        }
        "tool.result" => {
            let Some(id) = event.get("toolCallId").and_then(Value::as_str) else {
                return;
            };
            if !state.pending.iter().any(|pending| pending == id) {
                return; // result without a recorded call — skip like the fold
            }
            state.pending.retain(|pending| pending != id);
            let result = event.get("result").cloned().unwrap_or(Value::Null);
            let output = result.get("output").cloned().unwrap_or(Value::Null);
            history.push(FoldedMessage {
                role: "tool".to_string(),
                content: vec![output_marker(&output)],
                tool_calls: Vec::new(),
                tool_call_id: Some(id.to_string()),
                is_error: result.get("isError").and_then(Value::as_bool),
                id: None,
                origin: None,
                partial: false,
                timestamp: timestamp.to_string(),
                model: None,
            });
            flush_deferred(history, state);
        }
        "step.end" => {
            settle_open_step(history, state, timestamp);
        }
        _ => {}
    }
}

/// Tool result outputs ride on the message as a marker part so the fold
/// structure stays flat; conversion turns it into the viewer's
/// `tool_result` shape.
fn output_marker(output: &Value) -> Value {
    json!({ "__kimi_code_output": output })
}

fn extract_output_marker(part: &Value) -> Option<&Value> {
    part.get("__kimi_code_output")
}

/// `step.end` / crash-tail semantics: pending calls become interrupted
/// tool messages, then the open assistant is dropped when it recorded
/// nothing sendable, or sealed otherwise, and deferred messages flush.
fn settle_open_step(history: &mut Vec<FoldedMessage>, state: &mut FoldState, timestamp: &str) {
    close_pending(history, state, timestamp);

    if let Some(index) = history.iter().rposition(|message| message.partial) {
        let vacuous = history[index].tool_calls.is_empty()
            && history[index]
                .content
                .iter()
                .all(|part| is_vacuous_content_part(part) && extract_output_marker(part).is_none());
        if vacuous {
            history.remove(index);
        } else {
            history[index].partial = false;
        }
    }

    flush_deferred(history, state);
}

fn close_pending(history: &mut Vec<FoldedMessage>, state: &mut FoldState, timestamp: &str) {
    if state.pending.is_empty() {
        return;
    }
    let interrupted = json!(
        "Tool execution was interrupted before its result was recorded. Do not assume the tool completed successfully."
    );
    for id in std::mem::take(&mut state.pending) {
        history.push(FoldedMessage {
            role: "tool".to_string(),
            content: vec![output_marker(&interrupted)],
            tool_calls: Vec::new(),
            tool_call_id: Some(id),
            is_error: Some(true),
            id: None,
            origin: None,
            partial: false,
            timestamp: timestamp.to_string(),
            model: None,
        });
    }
    flush_deferred(history, state);
}

fn flush_deferred(history: &mut Vec<FoldedMessage>, state: &mut FoldState) {
    if !state.pending.is_empty() || state.deferred.is_empty() {
        return;
    }
    history.append(&mut state.deferred);
}

/// The agent core's `computeUndoCut`: walk back counting undo anchors
/// (user prompts); the cut removes the anchor and everything after it, and
/// extends backwards over injections the prompt owns. The walk stops at a
/// compaction boundary.
fn apply_undo_cut(history: &mut Vec<FoldedMessage>, count: usize) {
    if history.is_empty() {
        return;
    }
    let mut remaining = count;
    let mut cut_index: Option<usize> = None;

    for i in (0..history.len()).rev() {
        if remaining == 0 {
            break;
        }
        let message = &history[i];
        match message.origin_kind() {
            Some("injection") => continue,
            Some("compaction_summary") => return,
            _ => {}
        }
        if message.is_undo_anchor() {
            remaining -= 1;
            let mut cut = i;
            // Extend over prompt-owned injections directly above the anchor
            // (`injection.ownerPromptId === prompt.id` — the message id).
            while cut > 0 {
                let above = &history[cut - 1];
                let owned = above.origin_kind() == Some("injection")
                    && above
                        .origin
                        .as_ref()
                        .and_then(|origin| origin.get("ownerPromptId"))
                        .and_then(Value::as_str)
                        .zip(message.id.as_deref())
                        .is_some_and(|(owner, prompt_id)| owner == prompt_id);
                if !owned {
                    break;
                }
                cut -= 1;
            }
            cut_index = Some(cut);
        }
    }

    if let Some(cut) = cut_index {
        history.truncate(cut);
    }
}

/// `ContextApplyCompaction` fold (viewer approximation): the compacted
/// prefix is replaced by a summary message. The agent core keeps a tail of
/// recent user messages; for history viewing the summary marker plus the
/// fresh continuation is the faithful-enough reduction. The summary is
/// tagged `compaction_summary` so a later undo stops at this boundary,
/// exactly like the core.
fn fold_apply_compaction(
    history: &mut Vec<FoldedMessage>,
    state: &mut FoldState,
    record: &Value,
    timestamp: &str,
) {
    let summary = record
        .get("contextSummary")
        .or_else(|| record.get("summary"))
        .cloned()
        .unwrap_or(Value::Null);
    let text = match &summary {
        Value::String(text) => Some(text.clone()),
        Value::Object(message) => message
            .get("content")
            .and_then(Value::as_array)
            .and_then(|parts| {
                parts
                    .iter()
                    .find_map(|part| part.get("text").and_then(Value::as_str))
            })
            .map(String::from),
        _ => None,
    };

    history.clear();
    state.pending.clear();
    state.deferred.clear();

    if let Some(text) = text.filter(|text| !text.trim().is_empty()) {
        history.push(FoldedMessage {
            role: "user".to_string(),
            content: vec![json!({
                "type": "text",
                "text": format!("[Compacted context summary]\n\n{text}")
            })],
            tool_calls: Vec::new(),
            tool_call_id: None,
            is_error: None,
            id: None,
            origin: Some(json!({ "kind": "compaction_summary" })),
            partial: false,
            timestamp: timestamp.to_string(),
            model: None,
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Folded message → viewer message
// ─────────────────────────────────────────────────────────────────────────────

fn convert_folded_message(
    message: FoldedMessage,
    session_id: &str,
    index: u64,
) -> Option<ClaudeMessage> {
    let uuid = format!("{session_id}-{index}");
    let timestamp = message.timestamp.clone();

    match message.role.as_str() {
        "user" | "system" => {
            // System-side appends (injections, notices) render as user
            // turns, the same mapping the old CLI reader uses.
            let mut blocks = message.content;
            for call in &message.tool_calls {
                blocks.push(call.clone());
            }
            Some(build_provider_message(
                PROVIDER_ID,
                uuid,
                session_id,
                timestamp,
                "user",
                Some("user"),
                Some(Value::Array(blocks)),
                None,
            ))
        }
        "assistant" => {
            let mut blocks = message.content;
            for call in &message.tool_calls {
                blocks.push(call.clone());
            }
            Some(build_provider_message(
                PROVIDER_ID,
                uuid,
                session_id,
                timestamp,
                "assistant",
                Some("assistant"),
                Some(Value::Array(blocks)),
                message.model,
            ))
        }
        "tool" => {
            // Pull the output marker back out into the tool_result shape.
            let content = message
                .content
                .iter()
                .find_map(extract_output_marker)
                .cloned()
                .unwrap_or(Value::Null);
            let mut block = json!({
                "type": "tool_result",
                "tool_use_id": message.tool_call_id.unwrap_or_default(),
                "content": content,
            });
            if message.is_error == Some(true) {
                block["is_error"] = json!(true);
            }
            Some(build_provider_message(
                PROVIDER_ID,
                uuid,
                session_id,
                timestamp,
                "tool",
                Some("tool"),
                Some(json!([block])),
                None,
            ))
        }
        _ => None,
    }
}

/// Normalize a wire content part for the viewer: `think` → the viewer's
/// `thinking` shape (same mapping as the old CLI reader).
fn normalize_content_part(part: &Value) -> Value {
    if part.get("type").and_then(Value::as_str) == Some("think") {
        return json!({
            "type": "thinking",
            "thinking": part.get("think").and_then(Value::as_str).unwrap_or(""),
        });
    }
    part.clone()
}

/// Wire `toolCalls` entries (`{type: "function", id, name, arguments}` where
/// `arguments` is a JSON *string* or null) → viewer `tool_use` blocks.
fn convert_tool_call(call: &Value) -> Value {
    let name = call.get("name").and_then(Value::as_str).unwrap_or("tool");
    let input = call.get("arguments").cloned().unwrap_or(Value::Null);
    let input = match input {
        Value::String(text) => serde_json::from_str(&text).unwrap_or(json!({ "input": text })),
        Value::Null => json!({}),
        other => other,
    };
    json!({
        "type": "tool_use",
        "id": call.get("id").and_then(Value::as_str).unwrap_or(""),
        "name": name,
        "input": input,
    })
}

/// The agent core's vacuous-content predicate: empty/whitespace text or an
/// unsigned empty thinking block; media parts always carry content.
fn is_vacuous_content_part(part: &Value) -> bool {
    match part.get("type").and_then(Value::as_str) {
        Some("text") => part
            .get("text")
            .and_then(Value::as_str)
            .is_some_and(|text| text.trim().is_empty()),
        Some("think" | "thinking") => {
            let field = if part.get("think").is_some() {
                "think"
            } else {
                "thinking"
            };
            part.get("encrypted").is_none()
                && part
                    .get(field)
                    .and_then(Value::as_str)
                    .is_some_and(|text| text.trim().is_empty())
        }
        _ => false,
    }
}

fn first_user_text(messages: &[ClaudeMessage]) -> Option<String> {
    messages
        .iter()
        .find(|message| message.message_type == "user")
        .and_then(|message| message.content.as_ref())
        .and_then(Value::as_array)
        .and_then(|blocks| {
            blocks
                .iter()
                .find_map(|block| block.get("text").and_then(Value::as_str))
        })
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    match text.char_indices().nth(max_chars) {
        Some((idx, _)) => format!("{}...", &text[..idx]),
        None => text.to_string(),
    }
}

fn ms_to_rfc3339(ms: u64) -> Option<String> {
    Utc.timestamp_millis_opt(i64::try_from(ms).ok()?)
        .single()
        .map(|dt| dt.to_rfc3339())
}

fn file_modified_iso(path: &Path) -> Option<String> {
    fs::metadata(path)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .map(|time| {
            let dt: chrono::DateTime<Utc> = time.into();
            dt.to_rfc3339()
        })
}

/// Resolve `path` to its canonical form and require that it stays inside
/// `<root>/sessions`. Rejects relative paths and symlinked entries — a
/// symlinked directory cannot redirect reads outside the store. This
/// guarantees containment only; it does not check the `wd_*/session_*`
/// naming shape (a contained path without a readable `agents/main/wire.jsonl`
/// simply yields no messages).
fn resolve_within_sessions(root: &Path, path: &str, label: &str) -> Result<PathBuf, String> {
    let target = Path::new(path);
    if !target.is_absolute() {
        return Err(format!("Kimi Code {label} path must be absolute"));
    }
    if is_symlink(target) || !target.is_dir() {
        return Err(format!("Kimi Code {label} path is not a directory"));
    }

    let canonical_root = root
        .join(SESSIONS_DIR)
        .canonicalize()
        .map_err(|e| format!("Failed to resolve Kimi Code sessions root: {e}"))?;
    let canonical_target = target
        .canonicalize()
        .map_err(|e| format!("Failed to resolve Kimi Code {label} path: {e}"))?;
    if !canonical_target.starts_with(&canonical_root) {
        return Err(format!(
            "Kimi Code {label} path is outside the sessions directory"
        ));
    }

    Ok(canonical_target)
}

/// Resolve the `kimi-code://`-stripped workspace path to a real directory
/// under the store's sessions root.
fn resolve_workspace_dir(root: &Path, workspace_path: &str) -> Result<PathBuf, String> {
    resolve_within_sessions(root, workspace_path, "workspace")
}

/// Resolve a session directory under the store's sessions root.
fn validate_session_dir(root: &Path, session_path: &str) -> Result<PathBuf, String> {
    resolve_within_sessions(root, session_path, "session")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// Root of a fixture kimi-code store: `<temp>/.kimi-code`.
    fn code_root(temp: &TempDir) -> PathBuf {
        let root = temp.path().join(".kimi-code");
        fs::create_dir_all(&root).expect("create kimi-code root");
        root
    }

    fn sessions_root(root: &Path) -> PathBuf {
        let sessions = root.join(SESSIONS_DIR);
        fs::create_dir_all(&sessions).expect("create sessions root");
        sessions
    }

    fn write_workspace_map(root: &Path) {
        fs::write(
            root.join(WORKSPACES_FILE),
            r#"{"version":1,"workspaces":{"wd_demo_abc123":{"root":"/tmp/demo-project","name":"demo-project","created_at":"2026-08-01T00:00:00.000Z","last_opened_at":"2026-08-02T00:00:00.000Z"}}}"#,
        )
        .expect("write workspaces.json");
    }

    fn write_session(
        root: &Path,
        workspace: &str,
        session: &str,
        state_json: &str,
        wire_lines: &[&str],
    ) -> PathBuf {
        let session_dir = root.join(SESSIONS_DIR).join(workspace).join(session);
        let wire_dir = session_dir.join(AGENTS_DIR).join(MAIN_AGENT);
        fs::create_dir_all(&wire_dir).expect("create wire dir");
        fs::write(session_dir.join(STATE_FILE), state_json).expect("write state.json");
        fs::write(wire_dir.join(WIRE_FILE), wire_lines.join("\n")).expect("write wire.jsonl");
        session_dir
    }

    fn default_state() -> String {
        r#"{"id":"session_x","version":2,"cwd":"/tmp/demo-project","archived":false,"agents":{"main":{"type":"main"}},"title":"","createdAt":1786957369672,"updatedAt":1787034652121}"#
            .to_string()
    }

    /// A full turn: user prompt, one thinking part + a tool call, the tool
    /// result inside the same step, then the closing assistant text — the
    /// documented loop vocabulary in its real on-disk order.
    fn full_turn_wire() -> Vec<&'static str> {
        vec![
            r#"{"type":"metadata","protocol_version":"1.5","created_at":1786959458480}"#,
            r#"{"type":"profile.bind","modelAlias":"kimi-code/k3","profileName":"agent","time":1786959458490}"#,
            r#"{"type":"turn.prompt","input":[{"type":"text","text":"Read the file"}],"origin":{"kind":"user"},"time":1786959458516}"#,
            r#"{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"Read the file"}],"toolCalls":[],"origin":{"kind":"user"},"id":"msg_u1"},"time":1786959458516}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"step.begin","uuid":"s1","turnId":"0","step":1},"time":1786959458517}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"content.part","uuid":"p1","stepUuid":"s1","part":{"type":"think","think":"user wants the file"}},"time":1786959458518}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"tool.call","uuid":"t1","stepUuid":"s1","toolCallId":"tool_a","name":"Read","args":{"path":"src/main.rs"}},"time":1786959458519}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"tool.result","parentUuid":"t1","toolCallId":"tool_a","result":{"output":"fn main() {}"}},"time":1786959458520}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"step.end","uuid":"s1","turnId":"0","step":1,"finishReason":"tool_use"},"time":1786959458521}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"step.begin","uuid":"s2","turnId":"0","step":2},"time":1786959458522}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"content.part","uuid":"p2","stepUuid":"s2","part":{"type":"text","text":"Here is main.rs"}},"time":1786959458523}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"step.end","uuid":"s2","turnId":"0","step":2,"finishReason":"end_turn"},"time":1786959458524}"#,
            "{ not json — torn tail is skipped",
        ]
    }

    #[test]
    fn scan_projects_groups_sessions_by_workspace_directory() {
        let temp = TempDir::new().expect("temp dir");
        let root = code_root(&temp);
        write_workspace_map(&root);
        write_session(
            &root,
            "wd_demo_abc123",
            "session_one",
            &default_state(),
            &full_turn_wire(),
        );
        // Not in workspaces.json → falls back to state.json cwd.
        let other_state =
            r#"{"id":"session_y","version":2,"cwd":"/Users/jack/other","createdAt":1786957369672}"#;
        write_session(
            &root,
            "wd_other_zzz",
            "session_two",
            other_state,
            &full_turn_wire(),
        );
        // A workspace with no valid sessions is not a project.
        fs::create_dir_all(sessions_root(&root).join("wd_empty")).expect("empty workspace");

        let mut projects = scan_projects_from_root(&sessions_root(&root));
        projects.sort_by(|a, b| a.path.cmp(&b.path));

        assert_eq!(projects.len(), 2);
        // Path order: `wd_demo_abc123` < `wd_other_zzz`.
        // Named workspace root (workspaces.json) wins for the indexed one…
        assert_eq!(projects[0].name, "demo-project");
        assert_eq!(
            projects[0].path,
            format!("{SCHEME}{}/sessions/wd_demo_abc123", root.display())
        );
        assert_eq!(projects[0].actual_path, "/tmp/demo-project");
        assert_eq!(projects[0].session_count, 1);
        assert_eq!(projects[0].provider.as_deref(), Some("kimi"));
        // …state.json cwd is the fallback for the unindexed one.
        assert_eq!(projects[1].name, "other");
        assert_eq!(projects[1].actual_path, "/Users/jack/other");
    }

    #[test]
    fn scan_projects_falls_back_to_state_cwd_without_workspace_map() {
        let temp = TempDir::new().expect("temp dir");
        let root = code_root(&temp);
        let state = r#"{"id":"session_x","version":2,"cwd":"/Users/jack/my-repo","createdAt":1786957369672}"#;
        write_session(
            &root,
            "wd_solo_123",
            "session_one",
            state,
            &full_turn_wire(),
        );

        let projects = scan_projects_from_root(&sessions_root(&root));

        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "my-repo");
        assert_eq!(projects[0].actual_path, "/Users/jack/my-repo");
    }

    #[test]
    fn load_sessions_reports_metadata_and_entrypoint() {
        let temp = TempDir::new().expect("temp dir");
        let root = code_root(&temp);
        write_workspace_map(&root);
        write_session(
            &root,
            "wd_demo_abc123",
            "session_one",
            &default_state(),
            &full_turn_wire(),
        );

        let sessions = load_sessions_from_dir(&sessions_root(&root).join("wd_demo_abc123"));

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "session_one");
        // default_state carries no vscode custom marker → CLI entrypoint.
        assert_eq!(sessions[0].entrypoint.as_deref(), Some("kimi-cli"));
        assert_eq!(
            sessions[0].message_count, 4,
            "user + assistant + tool + assistant"
        );
        assert!(sessions[0].has_tool_use);
        // No title in state.json → summary falls back to first user text.
        assert_eq!(sessions[0].summary.as_deref(), Some("Read the file"));
        assert!(sessions[0].first_message_time.starts_with("2026-08"));
    }

    #[test]
    fn load_sessions_marks_vscode_sessions_by_state_custom_marker() {
        let temp = TempDir::new().expect("temp dir");
        let root = code_root(&temp);
        let vscode_state = r#"{"id":"session_x","version":2,"cwd":"/tmp/demo","custom":{"vscode_legacy_approval":{"yolo":false,"afk":false}},"createdAt":1786957369672}"#;
        write_session(
            &root,
            "wd_demo_abc123",
            "session_vs",
            vscode_state,
            &full_turn_wire(),
        );
        write_session(
            &root,
            "wd_demo_abc123",
            "session_cli",
            &default_state(),
            &full_turn_wire(),
        );

        let sessions = load_sessions_from_dir(&sessions_root(&root).join("wd_demo_abc123"));

        let by_id = |id: &str| sessions.iter().find(|s| s.session_id == id).unwrap();
        assert_eq!(
            by_id("session_vs").entrypoint.as_deref(),
            Some("kimi-vscode")
        );
        assert_eq!(by_id("session_cli").entrypoint.as_deref(), Some("kimi-cli"));
    }

    #[test]
    fn load_sessions_prefers_state_title_over_first_user_text() {
        let temp = TempDir::new().expect("temp dir");
        let root = code_root(&temp);
        let state = r#"{"id":"session_x","version":2,"cwd":"/tmp/demo","title":"Custom title","createdAt":1786957369672}"#;
        write_session(
            &root,
            "wd_demo_abc123",
            "session_one",
            state,
            &full_turn_wire(),
        );

        let sessions = load_sessions_from_dir(&sessions_root(&root).join("wd_demo_abc123"));

        assert_eq!(sessions[0].summary.as_deref(), Some("Custom title"));
    }

    #[test]
    fn fold_maps_loop_events_to_viewer_messages() {
        let temp = TempDir::new().expect("temp dir");
        let root = code_root(&temp);
        write_workspace_map(&root);
        let session_dir = write_session(
            &root,
            "wd_demo_abc123",
            "session_one",
            &default_state(),
            &full_turn_wire(),
        );

        let messages =
            load_messages_from_root(&root, &session_dir.to_string_lossy()).expect("load messages");

        assert_eq!(messages.len(), 4);

        // User message from context.append_message.
        assert_eq!(messages[0].message_type, "user");
        assert_eq!(
            messages[0].content.as_ref().unwrap()[0]["text"],
            "Read the file"
        );

        // First assistant step: thinking part + tool_use block.
        assert_eq!(messages[1].message_type, "assistant");
        assert_eq!(messages[1].model.as_deref(), Some("kimi-code/k3"));
        let blocks = messages[1].content.as_ref().unwrap();
        assert_eq!(blocks[0]["type"], "thinking");
        assert_eq!(blocks[0]["thinking"], "user wants the file");
        assert_eq!(blocks[1]["type"], "tool_use");
        assert_eq!(blocks[1]["name"], "Read");
        assert_eq!(blocks[1]["input"]["path"], "src/main.rs");

        // Tool result message.
        assert_eq!(messages[2].message_type, "tool");
        let result = &messages[2].content.as_ref().unwrap()[0];
        assert_eq!(result["type"], "tool_result");
        assert_eq!(result["tool_use_id"], "tool_a");
        assert_eq!(result["content"], "fn main() {}");

        // Second assistant step: plain text.
        assert_eq!(messages[3].message_type, "assistant");
        assert_eq!(
            messages[3].content.as_ref().unwrap()[0]["text"],
            "Here is main.rs"
        );
    }

    #[test]
    fn fold_drops_vacuous_assistant_step() {
        let temp = TempDir::new().expect("temp dir");
        let root = code_root(&temp);
        let wire = vec![
            r#"{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"hi"}],"toolCalls":[]},"time":1786959458516}"#,
            // Step with only whitespace text → dropped on settle.
            r#"{"type":"context.append_loop_event","event":{"type":"step.begin","uuid":"s1"},"time":1786959458517}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"content.part","stepUuid":"s1","part":{"type":"text","text":"   "}},"time":1786959458518}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"step.end","uuid":"s1"},"time":1786959458519}"#,
        ];
        let session_dir = write_session(&root, "wd_a", "session_x", &default_state(), &wire);

        let messages =
            load_messages_from_root(&root, &session_dir.to_string_lossy()).expect("load messages");

        assert_eq!(messages.len(), 1, "only the user message survives");
    }

    #[test]
    fn fold_interrupted_tool_call_settles_with_error_result() {
        let temp = TempDir::new().expect("temp dir");
        let root = code_root(&temp);
        let wire = vec![
            r#"{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"run it"}],"toolCalls":[]},"time":1786959458516}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"step.begin","uuid":"s1"},"time":1786959458517}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"tool.call","stepUuid":"s1","toolCallId":"tool_b","name":"Bash","args":{"command":"ls"}},"time":1786959458518}"#,
            // Journal ends mid-exchange: no tool.result, no step.end.
        ];
        let session_dir = write_session(&root, "wd_a", "session_x", &default_state(), &wire);

        let messages =
            load_messages_from_root(&root, &session_dir.to_string_lossy()).expect("load messages");

        assert_eq!(messages.len(), 3);
        assert_eq!(messages[2].message_type, "tool");
        let result = &messages[2].content.as_ref().unwrap()[0];
        assert_eq!(result["is_error"], true);
        assert!(result["content"].as_str().unwrap().contains("interrupted"));
    }

    #[test]
    fn fold_defers_user_message_until_tool_exchange_closes() {
        let temp = TempDir::new().expect("temp dir");
        let root = code_root(&temp);
        let wire = vec![
            r#"{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"first"}],"toolCalls":[]},"time":1786959458516}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"step.begin","uuid":"s1"},"time":1786959458517}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"tool.call","stepUuid":"s1","toolCallId":"tool_c","name":"Read","args":{"path":"a"}},"time":1786959458518}"#,
            // Queued follow-up arrives while the tool exchange is open…
            r#"{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"second"}],"toolCalls":[]},"time":1786959458519}"#,
            // …and must land after the tool result, not before it.
            r#"{"type":"context.append_loop_event","event":{"type":"tool.result","toolCallId":"tool_c","result":{"output":"data"}},"time":1786959458520}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"step.end","uuid":"s1"},"time":1786959458521}"#,
        ];
        let session_dir = write_session(&root, "wd_a", "session_x", &default_state(), &wire);

        let messages =
            load_messages_from_root(&root, &session_dir.to_string_lossy()).expect("load messages");

        let roles: Vec<&str> = messages.iter().map(|m| m.message_type.as_str()).collect();
        assert_eq!(roles, vec!["user", "assistant", "tool", "user"]);
    }

    #[test]
    fn fold_undo_cuts_the_last_user_turn_not_just_one_message() {
        let temp = TempDir::new().expect("temp dir");
        let root = code_root(&temp);
        let wire = vec![
            r#"{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"one"}],"toolCalls":[],"origin":{"kind":"user"},"id":"m1"},"time":1786959458516}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"step.begin","uuid":"s1"},"time":1786959458517}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"content.part","stepUuid":"s1","part":{"type":"text","text":"answer one"}},"time":1786959458518}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"step.end","uuid":"s1"},"time":1786959458519}"#,
            r#"{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"two"}],"toolCalls":[],"origin":{"kind":"user"},"id":"m2"},"time":1786959458520}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"step.begin","uuid":"s2"},"time":1786959458521}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"content.part","stepUuid":"s2","part":{"type":"text","text":"answer two"}},"time":1786959458522}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"step.end","uuid":"s2"},"time":1786959458523}"#,
            // Undo one turn → the whole second turn (user + answer) goes.
            r#"{"type":"context.undo","count":1,"time":1786959458524}"#,
        ];
        let session_dir = write_session(&root, "wd_a", "session_x", &default_state(), &wire);

        let messages =
            load_messages_from_root(&root, &session_dir.to_string_lossy()).expect("load messages");

        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].content.as_ref().unwrap()[0]["text"], "one");
        assert_eq!(
            messages[1].content.as_ref().unwrap()[0]["text"],
            "answer one"
        );
    }

    #[test]
    fn fold_undo_stops_at_compaction_boundary() {
        let temp = TempDir::new().expect("temp dir");
        let root = code_root(&temp);
        let wire = vec![
            r#"{"type":"context.apply_compaction","contextSummary":"summary","compactedCount":3,"time":1786959458515}"#,
            r#"{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"post-compaction"}],"toolCalls":[],"origin":{"kind":"user"}},"time":1786959458516}"#,
            // Undo beyond the boundary does nothing (walk stops there).
            r#"{"type":"context.undo","count":5,"time":1786959458520}"#,
        ];
        let session_dir = write_session(&root, "wd_a", "session_x", &default_state(), &wire);

        let messages =
            load_messages_from_root(&root, &session_dir.to_string_lossy()).expect("load messages");

        assert_eq!(messages.len(), 2, "summary + post-compaction prompt stay");
    }

    #[test]
    fn fold_undo_extends_over_prompt_owned_injections() {
        let temp = TempDir::new().expect("temp dir");
        let root = code_root(&temp);
        let wire = vec![
            r#"{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"keep"}],"toolCalls":[],"origin":{"kind":"user"},"id":"m1"},"time":1786959458516}"#,
            // Owned by m2 → must be cut together with m2.
            r#"{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"owned injection"}],"toolCalls":[],"origin":{"kind":"injection","ownerPromptId":"m2"},"id":"i1"},"time":1786959458517}"#,
            r#"{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"drop"}],"toolCalls":[],"origin":{"kind":"user"},"id":"m2"},"time":1786959458518}"#,
            r#"{"type":"context.undo","count":1,"time":1786959458519}"#,
        ];
        let session_dir = write_session(&root, "wd_a", "session_x", &default_state(), &wire);

        let messages =
            load_messages_from_root(&root, &session_dir.to_string_lossy()).expect("load messages");

        assert_eq!(
            messages.len(),
            1,
            "the owned injection is cut with its prompt"
        );
        assert_eq!(messages[0].content.as_ref().unwrap()[0]["text"], "keep");
    }

    #[test]
    fn fold_undo_keeps_injections_owned_by_another_prompt() {
        let temp = TempDir::new().expect("temp dir");
        let root = code_root(&temp);
        let wire = vec![
            r#"{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"keep"}],"toolCalls":[],"origin":{"kind":"user"},"id":"m1"},"time":1786959458516}"#,
            // Owned by m1 → NOT cut by undoing m2.
            r#"{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"foreign injection"}],"toolCalls":[],"origin":{"kind":"injection","ownerPromptId":"m1"},"id":"i1"},"time":1786959458517}"#,
            r#"{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"drop"}],"toolCalls":[],"origin":{"kind":"user"},"id":"m2"},"time":1786959458518}"#,
            r#"{"type":"context.undo","count":1,"time":1786959458519}"#,
        ];
        let session_dir = write_session(&root, "wd_a", "session_x", &default_state(), &wire);

        let messages =
            load_messages_from_root(&root, &session_dir.to_string_lossy()).expect("load messages");

        assert_eq!(messages.len(), 2, "the foreign injection survives");
        assert_eq!(
            messages[1].content.as_ref().unwrap()[0]["text"],
            "foreign injection"
        );
    }

    #[test]
    fn interrupted_tool_message_carries_the_current_timestamp() {
        let temp = TempDir::new().expect("temp dir");
        let root = code_root(&temp);
        let wire = vec![
            r#"{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"run"}],"toolCalls":[]},"time":1786959458516}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"step.begin","uuid":"s1"},"time":1786959458517}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"tool.call","stepUuid":"s1","toolCallId":"tool_x","name":"Bash","args":{"command":"ls"}},"time":1786959458518}"#,
            // Journal cut mid-exchange: no tool.result, no step.end. The
            // final settle must stamp the interrupted message with the last
            // seen time, not an empty string (session sorting depends on it).
        ];
        let session_dir = write_session(&root, "wd_a", "session_x", &default_state(), &wire);

        let messages =
            load_messages_from_root(&root, &session_dir.to_string_lossy()).expect("load messages");

        let interrupted = messages.last().expect("interrupted tool message");
        assert!(!interrupted.timestamp.is_empty());
        assert!(interrupted.timestamp.starts_with("2026-08"));
    }

    #[test]
    fn undo_during_open_tool_exchange_drops_pending_and_deferred() {
        let temp = TempDir::new().expect("temp dir");
        let root = code_root(&temp);
        let wire = vec![
            r#"{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"keep"}],"toolCalls":[],"origin":{"kind":"user"},"id":"m0"},"time":1786959458515}"#,
            r#"{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"first"}],"toolCalls":[],"origin":{"kind":"user"},"id":"m1"},"time":1786959458516}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"step.begin","uuid":"s1"},"time":1786959458517}"#,
            r#"{"type":"context.append_loop_event","event":{"type":"tool.call","stepUuid":"s1","toolCallId":"tool_y","name":"Read","args":{"path":"a"}},"time":1786959458518}"#,
            // A follow-up queues behind the open exchange…
            r#"{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"second"}],"toolCalls":[]},"time":1786959458519}"#,
            // …then the m1 turn is undone mid-exchange. The pending call
            // and the deferred message must vanish with the cut, not
            // resurrect an interrupted result afterwards.
            r#"{"type":"context.undo","count":1,"time":1786959458520}"#,
        ];
        let session_dir = write_session(&root, "wd_a", "session_x", &default_state(), &wire);

        let messages =
            load_messages_from_root(&root, &session_dir.to_string_lossy()).expect("load messages");

        assert_eq!(messages.len(), 1, "only the pre-anchor user prompt remains");
        assert_eq!(messages[0].content.as_ref().unwrap()[0]["text"], "keep");
        assert!(
            !messages.iter().any(|m| m.message_type == "tool"),
            "no ghost interrupted result for the undone tool call"
        );
    }

    #[test]
    fn fold_applies_clear_and_compaction() {
        let temp = TempDir::new().expect("temp dir");
        let root = code_root(&temp);
        let wire = vec![
            r#"{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"one"}],"toolCalls":[]},"time":1786959458516}"#,
            r#"{"type":"context.apply_compaction","contextSummary":"Earlier discussion about setup.","compactedCount":1,"time":1786959458519}"#,
            r#"{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"after compaction"}],"toolCalls":[]},"time":1786959458520}"#,
        ];
        let session_dir = write_session(&root, "wd_a", "session_x", &default_state(), &wire);

        let messages =
            load_messages_from_root(&root, &session_dir.to_string_lossy()).expect("load messages");

        assert_eq!(messages.len(), 2);
        let first_text = messages[0].content.as_ref().unwrap()[0]["text"]
            .as_str()
            .unwrap();
        assert!(first_text.contains("Compacted context summary"));
        assert!(first_text.contains("Earlier discussion about setup."));
        assert_eq!(
            messages[1].content.as_ref().unwrap()[0]["text"],
            "after compaction"
        );
    }

    #[test]
    fn tool_arguments_string_form_is_parsed() {
        let temp = TempDir::new().expect("temp dir");
        let root = code_root(&temp);
        let wire = vec![
            r#"{"type":"context.append_message","message":{"role":"assistant","content":[],"toolCalls":[{"type":"function","id":"tool_s","name":"Bash","arguments":"{\"command\":\"pwd\"}"}]},"time":1786959458516}"#,
        ];
        let session_dir = write_session(&root, "wd_a", "session_x", &default_state(), &wire);

        let messages =
            load_messages_from_root(&root, &session_dir.to_string_lossy()).expect("load messages");

        assert_eq!(messages.len(), 1);
        let block = &messages[0].content.as_ref().unwrap()[0];
        assert_eq!(block["type"], "tool_use");
        assert_eq!(block["input"]["command"], "pwd");
    }

    #[test]
    fn search_matches_folded_content_and_respects_limit() {
        let temp = TempDir::new().expect("temp dir");
        let root = code_root(&temp);
        write_workspace_map(&root);
        write_session(
            &root,
            "wd_demo_abc123",
            "session_one",
            &default_state(),
            &full_turn_wire(),
        );

        let results = search_from_root(&sessions_root(&root), "main.rs", 10);
        // Both the tool args and the closing assistant text match.
        assert_eq!(results.len(), 2);
        assert!(results
            .iter()
            .all(|message| message.project_name.as_deref() == Some("demo-project")));

        assert!(search_from_root(&sessions_root(&root), "no-such-token", 10).is_empty());
    }

    #[cfg(unix)]
    #[test]
    /// A symlinked session directory pointing outside the store must be
    /// rejected by the path guard, not read through.
    fn load_messages_rejects_symlinked_session_dir() {
        use std::os::unix::fs as unix_fs;

        let temp = TempDir::new().expect("temp dir");
        let root = code_root(&temp);
        write_workspace_map(&root);
        let session_dir = write_session(
            &root,
            "wd_demo_abc123",
            "session_one",
            &default_state(),
            &full_turn_wire(),
        );

        let outside = TempDir::new().expect("outside dir");
        let outside_root = code_root(&outside);
        let outside_session = write_session(
            &outside_root,
            "wd_evil",
            "session_x",
            &default_state(),
            &full_turn_wire(),
        );

        let link = root
            .join(SESSIONS_DIR)
            .join("wd_demo_abc123")
            .join("session_link");
        unix_fs::symlink(&outside_session, &link).expect("create symlink");

        load_messages_from_root(&root, &link.to_string_lossy())
            .expect_err("symlinked session dir must be rejected");
        // The real session still loads.
        assert!(load_messages_from_root(&root, &session_dir.to_string_lossy()).is_ok());
    }

    #[test]
    fn sessions_without_wire_are_skipped() {
        let temp = TempDir::new().expect("temp dir");
        let root = code_root(&temp);
        // state.json but no agents/main/wire.jsonl.
        let session_dir = root.join(SESSIONS_DIR).join("wd_a").join("session_x");
        fs::create_dir_all(&session_dir).expect("create session dir");
        fs::write(session_dir.join(STATE_FILE), default_state()).expect("write state");

        let projects = scan_projects_from_root(&sessions_root(&root));
        assert!(projects.is_empty());
    }
}
