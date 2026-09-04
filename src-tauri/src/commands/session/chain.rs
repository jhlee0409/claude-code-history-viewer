//! Cross-file session chain resolution.
//!
//! Claude Code sometimes auto-continues a conversation that ran out of context
//! by starting a brand-new session file rather than compacting in place: the
//! new file's `compact_boundary` system event carries a `logicalParentUuid`
//! that points at the last message of the OLD file, not at anything in the
//! new one. The rest of the app (session list, message loading) only ever
//! looks at one file at a time, so that earlier half of the conversation was
//! invisible in the viewer even though it's still on disk.
//!
//! This module detects that dangling link and walks it backward to the
//! originating file(s), purely for display — nothing here reads or writes
//! anything on disk beyond the existing `.jsonl` files.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use once_cell::sync::Lazy;

use crate::utils::is_symlink;

/// A regular `.jsonl` file in the project directory. Symlinks are skipped so a
/// planted link can't pull a file outside the project root into chain scans.
fn is_regular_jsonl(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str()) == Some("jsonl") && !is_symlink(path)
}

/// Hard cap on how many hops `resolve_session_chain` will follow. Guards
/// against a pathological or corrupted `logicalParentUuid` cycle; no real
/// Claude Code conversation should ever chain this deep.
const MAX_CHAIN_HOPS: usize = 50;

/// A cheap fingerprint that changes when a session file is appended or
/// replaced. The directory snapshot below also notices new/deleted candidate
/// files, which matters when an orphaned boundary is completed later.
#[derive(Clone, Debug, PartialEq, Eq)]
struct FileSignature {
    len: u64,
    modified: Option<SystemTime>,
}

type ProjectSnapshot = Vec<(PathBuf, FileSignature)>;

#[derive(Clone)]
struct CachedChain {
    project_snapshot: ProjectSnapshot,
    chain: Vec<PathBuf>,
}

/// Resolved chains are cheap to recompute but not free (each hop scans every
/// `.jsonl` file in the project directory once), and the same session is
/// re-resolved on every pagination page as the user scrolls. Cache for the
/// life of the process, keyed by the leaf (most recent) session file path, but
/// invalidate it whenever any candidate file changes.
static SESSION_CHAIN_CACHE: Lazy<Mutex<HashMap<String, CachedChain>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn file_signature(path: &Path) -> Option<FileSignature> {
    let metadata = fs::metadata(path).ok()?;
    Some(FileSignature {
        len: metadata.len(),
        modified: metadata.modified().ok(),
    })
}

fn project_snapshot(project_dir: &Path) -> Option<ProjectSnapshot> {
    let mut snapshot = Vec::new();
    for entry in fs::read_dir(project_dir).ok()? {
        let entry = entry.ok()?;
        let path = entry.path();
        if !is_regular_jsonl(&path) {
            continue;
        }
        snapshot.push((path.clone(), file_signature(&path)?));
    }
    snapshot.sort_unstable_by(|left, right| left.0.cmp(&right.0));
    Some(snapshot)
}

#[derive(serde::Deserialize)]
struct BoundaryClassifier {
    #[serde(rename = "type")]
    message_type: String,
    subtype: Option<String>,
    uuid: Option<String>,
    #[serde(rename = "logicalParentUuid")]
    logical_parent_uuid: Option<String>,
    #[serde(rename = "isSidechain")]
    is_sidechain: Option<bool>,
}

/// Scan a session file for the first `compact_boundary` event whose
/// `logicalParentUuid` is NOT among this file's own message uuids. That
/// absence is exactly what marks "this file's history starts abruptly here;
/// the messages before it live in a different file."
fn find_dangling_parent_uuid(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);

    let mut own_uuids: HashSet<String> = HashSet::new();
    let mut boundary_parents: Vec<String> = Vec::new();

    for line in reader.lines() {
        let Ok(line) = line else { continue };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<BoundaryClassifier>(trimmed) else {
            continue;
        };
        if let Some(uuid) = entry.uuid {
            own_uuids.insert(uuid);
        }
        if entry.message_type == "system" && entry.subtype.as_deref() == Some("compact_boundary") {
            if let Some(parent) = entry.logical_parent_uuid {
                boundary_parents.push(parent);
            }
        }
    }

    boundary_parents
        .into_iter()
        .find(|parent| !own_uuids.contains(parent))
}

/// Fast (non-JSON-parsing) check for whether `path` contains a message with
/// the given `uuid`. A plain substring search is sufficient: uuids are random
/// v4 strings, so an accidental match elsewhere in the file is not a realistic
/// concern, and this avoids parsing every line of every candidate file.
fn file_contains_uuid(path: &Path, target_uuid: &str) -> bool {
    let Ok(content) = fs::read(path) else {
        return false;
    };
    let needle = format!("\"uuid\":\"{target_uuid}\"");
    memchr::memmem::find(&content, needle.as_bytes()).is_some()
}

/// Search the (flat) project directory for a session file containing a
/// message with `target_uuid`, skipping anything in `skip`. Only looks at the
/// project root, not `subagents/` or other nested dirs — a session chain's
/// predecessor is always another top-level session file.
fn find_file_containing_uuid(
    project_dir: &Path,
    target_uuid: &str,
    skip: &HashSet<PathBuf>,
) -> Option<PathBuf> {
    let entries = fs::read_dir(project_dir).ok()?;
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if !is_regular_jsonl(&path) {
            continue;
        }
        if skip.contains(&path) {
            continue;
        }
        if file_contains_uuid(&path, target_uuid) {
            return Some(path);
        }
    }
    None
}

/// Whether the predecessor kept producing main-conversation turns after the
/// UUID referenced by a continuation boundary. A true result means the newer
/// file is a branch from the predecessor, not a replacement for it.
fn has_main_conversation_after_uuid(path: &Path, target_uuid: &str) -> bool {
    let Ok(file) = fs::File::open(path) else {
        return false;
    };
    let reader = BufReader::new(file);
    let mut found_target = false;

    for line in reader.lines() {
        let Ok(line) = line else { continue };
        let Ok(entry) = serde_json::from_str::<BoundaryClassifier>(line.trim()) else {
            continue;
        };

        if found_target
            && !entry.is_sidechain.unwrap_or(false)
            && matches!(entry.message_type.as_str(), "user" | "assistant")
        {
            return true;
        }

        if entry.uuid.as_deref() == Some(target_uuid) {
            found_target = true;
        }
    }

    false
}

/// Resolve the full chain of session files that make up one logical
/// conversation, oldest first, ending with `session_path` itself. For a
/// session with no cross-file continuation this is just `[session_path]`.
pub fn resolve_session_chain(session_path: &Path) -> Vec<PathBuf> {
    let key = session_path.to_string_lossy().to_string();
    let cached_snapshot = session_path.parent().and_then(project_snapshot);
    if let Some(snapshot) = cached_snapshot.as_ref() {
        if let Some(cached) = SESSION_CHAIN_CACHE
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&key)
        {
            if cached.project_snapshot == *snapshot {
                return cached.chain.clone();
            }
        }
    }

    let mut chain: Vec<PathBuf> = vec![session_path.to_path_buf()];
    let mut visited: HashSet<PathBuf> = HashSet::new();
    visited.insert(session_path.to_path_buf());

    let mut current = session_path.to_path_buf();
    for _ in 0..MAX_CHAIN_HOPS {
        let Some(parent_uuid) = find_dangling_parent_uuid(&current) else {
            break;
        };
        let Some(project_dir) = current.parent() else {
            break;
        };
        let Some(predecessor) = find_file_containing_uuid(project_dir, &parent_uuid, &visited)
        else {
            break;
        };
        chain.insert(0, predecessor.clone());
        visited.insert(predecessor.clone());
        current = predecessor;
    }

    if let Some(snapshot) = session_path.parent().and_then(project_snapshot) {
        SESSION_CHAIN_CACHE
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(
                key,
                CachedChain {
                    project_snapshot: snapshot,
                    chain: chain.clone(),
                },
            );
    }

    chain
}

/// Every file in `project_root` whose direct continuations already cover its
/// conversation history. Multiple children can share the same predecessor
/// without making that predecessor useful as a separate session-list entry.
/// It remains visible only when it kept receiving main-conversation turns
/// after at least one referenced branch point.
pub fn superseded_chain_paths(project_root: &Path) -> HashSet<PathBuf> {
    let mut referenced_branch_points: HashMap<PathBuf, HashSet<String>> = HashMap::new();
    let Ok(entries) = fs::read_dir(project_root) else {
        return HashSet::new();
    };

    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if !is_regular_jsonl(&path) {
            continue;
        }

        let Some(parent_uuid) = find_dangling_parent_uuid(&path) else {
            continue;
        };
        let skip = HashSet::from([path]);
        let Some(predecessor) = find_file_containing_uuid(project_root, &parent_uuid, &skip) else {
            continue;
        };
        referenced_branch_points
            .entry(predecessor)
            .or_default()
            .insert(parent_uuid);
    }

    referenced_branch_points
        .into_iter()
        .filter_map(|(predecessor, parent_uuids)| {
            (!parent_uuids
                .iter()
                .any(|parent_uuid| has_main_conversation_after_uuid(&predecessor, parent_uuid)))
            .then_some(predecessor)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_file(dir: &TempDir, name: &str, content: &str) -> PathBuf {
        let path = dir.path().join(name);
        fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn no_chain_for_a_normal_session() {
        let dir = TempDir::new().unwrap();
        let path = write_file(
            &dir,
            "a.jsonl",
            "{\"uuid\":\"u1\",\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"hi\"}}\n",
        );
        let chain = resolve_session_chain(&path);
        assert_eq!(chain, vec![path]);
    }

    /// A symlinked `.jsonl` inside the project dir must never be followed:
    /// neither as a chain predecessor nor as a superseded candidate.
    #[cfg(unix)]
    #[test]
    fn chain_scans_ignore_symlinked_jsonl() {
        let outside = TempDir::new().unwrap();
        let real_older = write_file(
            &outside,
            "older.jsonl",
            "{\"uuid\":\"tail-uuid\",\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[]}}\n",
        );

        let dir = TempDir::new().unwrap();
        let link = dir.path().join("older.jsonl");
        std::os::unix::fs::symlink(&real_older, &link).unwrap();
        let newer = write_file(
            &dir,
            "newer.jsonl",
            concat!(
                "{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"uuid\":\"boundary-1\",",
                "\"logicalParentUuid\":\"tail-uuid\"}\n",
                "{\"uuid\":\"u2\",\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"continuing\"}}\n",
            ),
        );

        assert_eq!(resolve_session_chain(&newer), vec![newer.clone()]);
        let superseded = superseded_chain_paths(dir.path());
        assert!(superseded.is_empty(), "got {superseded:?}");
    }

    #[test]
    fn resolves_a_two_hop_chain() {
        let dir = TempDir::new().unwrap();
        let older = write_file(
            &dir,
            "older.jsonl",
            "{\"uuid\":\"tail-uuid\",\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[]}}\n",
        );
        let newer = write_file(
            &dir,
            "newer.jsonl",
            concat!(
                "{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"uuid\":\"boundary-1\",",
                "\"logicalParentUuid\":\"tail-uuid\"}\n",
                "{\"uuid\":\"u2\",\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"continuing\"}}\n",
            ),
        );

        let chain = resolve_session_chain(&newer);
        assert_eq!(chain, vec![older, newer]);
    }

    #[test]
    fn stops_when_the_parent_uuid_is_nowhere_to_be_found() {
        let dir = TempDir::new().unwrap();
        let newer = write_file(
            &dir,
            "orphan.jsonl",
            concat!(
                "{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"uuid\":\"boundary-1\",",
                "\"logicalParentUuid\":\"missing-uuid\"}\n",
                "{\"uuid\":\"u2\",\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"hi\"}}\n",
            ),
        );

        let chain = resolve_session_chain(&newer);
        assert_eq!(chain, vec![newer]);
    }

    #[test]
    fn invalidates_cache_when_a_missing_predecessor_appears() {
        let dir = TempDir::new().unwrap();
        let newer = write_file(
            &dir,
            "newer.jsonl",
            concat!(
                "{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"uuid\":\"boundary-1\",",
                "\"logicalParentUuid\":\"tail-uuid\"}\n",
                "{\"uuid\":\"u2\",\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"continuing\"}}\n",
            ),
        );

        assert_eq!(resolve_session_chain(&newer), vec![newer.clone()]);

        let older = write_file(
            &dir,
            "older.jsonl",
            "{\"uuid\":\"tail-uuid\",\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[]}}\n",
        );

        assert_eq!(resolve_session_chain(&newer), vec![older, newer]);
    }

    #[test]
    fn stops_at_a_cycle_without_repeating_files() {
        let dir = TempDir::new().unwrap();
        let first = write_file(
            &dir,
            "first.jsonl",
            concat!(
                "{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"uuid\":\"boundary-a\",",
                "\"logicalParentUuid\":\"uuid-b\"}\n",
                "{\"uuid\":\"uuid-a\",\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"a\"}}\n",
            ),
        );
        let second = write_file(
            &dir,
            "second.jsonl",
            concat!(
                "{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"uuid\":\"boundary-b\",",
                "\"logicalParentUuid\":\"uuid-a\"}\n",
                "{\"uuid\":\"uuid-b\",\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"b\"}}\n",
            ),
        );

        assert_eq!(resolve_session_chain(&second), vec![first, second]);
    }

    #[test]
    fn respects_the_maximum_chain_hop_limit() {
        let dir = TempDir::new().unwrap();
        let mut paths = Vec::new();
        for index in 0..=MAX_CHAIN_HOPS {
            let boundary = if index == 0 {
                String::new()
            } else {
                format!(
                    "{{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"uuid\":\"boundary-{index}\",\"logicalParentUuid\":\"uuid-{}\"}}\n",
                    index - 1
                )
            };
            let content = format!(
                "{boundary}{{\"uuid\":\"uuid-{index}\",\"type\":\"user\",\"message\":{{\"role\":\"user\",\"content\":\"{index}\"}}}}\n"
            );
            paths.push(write_file(&dir, &format!("chain-{index}.jsonl"), &content));
        }

        let chain = resolve_session_chain(paths.last().unwrap());
        assert_eq!(chain.len(), MAX_CHAIN_HOPS + 1);
    }

    #[test]
    fn superseded_paths_hides_only_non_leaf_files() {
        let dir = TempDir::new().unwrap();
        let older = write_file(
            &dir,
            "older.jsonl",
            "{\"uuid\":\"tail-uuid\",\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[]}}\n",
        );
        let newer = write_file(
            &dir,
            "newer.jsonl",
            concat!(
                "{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"uuid\":\"boundary-1\",",
                "\"logicalParentUuid\":\"tail-uuid\"}\n",
                "{\"uuid\":\"u2\",\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"continuing\"}}\n",
            ),
        );
        let unrelated = write_file(
            &dir,
            "unrelated.jsonl",
            "{\"uuid\":\"u3\",\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"hi\"}}\n",
        );

        let superseded = superseded_chain_paths(dir.path());
        assert!(superseded.contains(&older));
        assert!(!superseded.contains(&newer));
        assert!(!superseded.contains(&unrelated));
    }

    #[test]
    fn superseded_paths_hides_an_inactive_parent_with_multiple_direct_children() {
        let dir = TempDir::new().unwrap();
        let parent = write_file(
            &dir,
            "parent.jsonl",
            "{\"uuid\":\"tail-uuid\",\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[]}}\n",
        );
        let first_child = write_file(
            &dir,
            "first-child.jsonl",
            concat!(
                "{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"uuid\":\"boundary-1\",",
                "\"logicalParentUuid\":\"tail-uuid\"}\n",
                "{\"uuid\":\"u1\",\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"first\"}}\n",
            ),
        );
        let second_child = write_file(
            &dir,
            "second-child.jsonl",
            concat!(
                "{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"uuid\":\"boundary-2\",",
                "\"logicalParentUuid\":\"tail-uuid\"}\n",
                "{\"uuid\":\"u2\",\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"second\"}}\n",
            ),
        );

        let superseded = superseded_chain_paths(dir.path());
        assert!(superseded.contains(&parent));
        assert!(!superseded.contains(&first_child));
        assert!(!superseded.contains(&second_child));
    }

    #[test]
    fn superseded_paths_keeps_an_active_parent_with_multiple_direct_children() {
        let dir = TempDir::new().unwrap();
        let parent = write_file(
            &dir,
            "parent.jsonl",
            concat!(
                "{\"uuid\":\"tail-uuid\",\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[]}}\n",
                "{\"uuid\":\"later-user\",\"type\":\"user\",\"isSidechain\":false,",
                "\"message\":{\"role\":\"user\",\"content\":\"still active\"}}\n",
            ),
        );
        let first_child = write_file(
            &dir,
            "first-child.jsonl",
            concat!(
                "{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"uuid\":\"boundary-1\",",
                "\"logicalParentUuid\":\"tail-uuid\"}\n",
                "{\"uuid\":\"u1\",\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"first\"}}\n",
            ),
        );
        let second_child = write_file(
            &dir,
            "second-child.jsonl",
            concat!(
                "{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"uuid\":\"boundary-2\",",
                "\"logicalParentUuid\":\"tail-uuid\"}\n",
                "{\"uuid\":\"u2\",\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"second\"}}\n",
            ),
        );

        let superseded = superseded_chain_paths(dir.path());
        assert!(!superseded.contains(&parent));
        assert!(!superseded.contains(&first_child));
        assert!(!superseded.contains(&second_child));
    }

    #[test]
    fn superseded_paths_keeps_a_parent_that_continues_after_the_branch_point() {
        let dir = TempDir::new().unwrap();
        let parent = write_file(
            &dir,
            "parent.jsonl",
            concat!(
                "{\"uuid\":\"tail-uuid\",\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[]}}\n",
                "{\"uuid\":\"later-user\",\"type\":\"user\",\"isSidechain\":false,",
                "\"message\":{\"role\":\"user\",\"content\":\"still active\"}}\n",
            ),
        );
        let child = write_file(
            &dir,
            "child.jsonl",
            concat!(
                "{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"uuid\":\"boundary-1\",",
                "\"logicalParentUuid\":\"tail-uuid\"}\n",
                "{\"uuid\":\"u2\",\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"branch\"}}\n",
            ),
        );

        let superseded = superseded_chain_paths(dir.path());
        assert!(!superseded.contains(&parent));
        assert!(!superseded.contains(&child));
    }

    #[test]
    fn superseded_paths_still_hides_each_predecessor_in_a_linear_chain() {
        let dir = TempDir::new().unwrap();
        let oldest = write_file(
            &dir,
            "oldest.jsonl",
            "{\"uuid\":\"old-tail\",\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[]}}\n",
        );
        let middle = write_file(
            &dir,
            "middle.jsonl",
            concat!(
                "{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"uuid\":\"boundary-1\",",
                "\"logicalParentUuid\":\"old-tail\"}\n",
                "{\"uuid\":\"middle-tail\",\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[]}}\n",
            ),
        );
        let newest = write_file(
            &dir,
            "newest.jsonl",
            concat!(
                "{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"uuid\":\"boundary-2\",",
                "\"logicalParentUuid\":\"middle-tail\"}\n",
                "{\"uuid\":\"new-user\",\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"latest\"}}\n",
            ),
        );

        let superseded = superseded_chain_paths(dir.path());
        assert!(superseded.contains(&oldest));
        assert!(superseded.contains(&middle));
        assert!(!superseded.contains(&newest));
    }
}
