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

use once_cell::sync::Lazy;

/// Hard cap on how many hops `resolve_session_chain` will follow. Guards
/// against a pathological or corrupted `logicalParentUuid` cycle; no real
/// Claude Code conversation should ever chain this deep.
const MAX_CHAIN_HOPS: usize = 50;

/// Resolved chains are cheap to recompute but not free (each hop scans every
/// `.jsonl` file in the project directory once), and the same session is
/// re-resolved on every pagination page as the user scrolls. Cache for the
/// life of the process, keyed by the leaf (most recent) session file path.
static SESSION_CHAIN_CACHE: Lazy<Mutex<HashMap<String, Vec<PathBuf>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(serde::Deserialize)]
struct BoundaryClassifier {
    #[serde(rename = "type")]
    message_type: String,
    subtype: Option<String>,
    uuid: Option<String>,
    #[serde(rename = "logicalParentUuid")]
    logical_parent_uuid: Option<String>,
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
        if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
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

/// Resolve the full chain of session files that make up one logical
/// conversation, oldest first, ending with `session_path` itself. For a
/// session with no cross-file continuation this is just `[session_path]`.
pub fn resolve_session_chain(session_path: &Path) -> Vec<PathBuf> {
    let key = session_path.to_string_lossy().to_string();
    if let Some(cached) = SESSION_CHAIN_CACHE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(&key)
    {
        return cached.clone();
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

    SESSION_CHAIN_CACHE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .insert(key, chain.clone());

    chain
}

/// Every file in `project_root` that is a non-final link in some OTHER
/// file's resolved chain — i.e. an earlier half of a conversation that a
/// newer session file already supersedes. The session list hides these by
/// default so a Claude Code auto-continuation shows as one entry, not two;
/// as a chain grows another hop, the file that used to be the leaf becomes
/// superseded in turn and drops out on the next list refresh.
pub fn superseded_chain_paths(project_root: &Path) -> HashSet<PathBuf> {
    let mut superseded = HashSet::new();
    let Ok(entries) = fs::read_dir(project_root) else {
        return superseded;
    };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
            continue;
        }
        let chain = resolve_session_chain(&path);
        if chain.len() > 1 {
            for predecessor in &chain[..chain.len() - 1] {
                superseded.insert(predecessor.clone());
            }
        }
    }
    superseded
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
}
