use crate::models::{
    AntigravityProjectSummary, AntigravitySessionInfo, AntigravityState, PersistedSessionState,
    SessionLifecycle, SessionLifecycleStatus, SessionTotals,
};
use crate::providers::scan_report::ScanReport;
use once_cell::sync::Lazy;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

const ESTIMATED_PROMPT_RATIO: f64 = 0.62;

static MODEL_ALIAS_MAP: Lazy<HashMap<&'static str, &'static str>> = Lazy::new(|| {
    HashMap::from([
        ("MODEL_PLACEHOLDER_M37", "gemini-3.1-pro-high"),
        ("MODEL_PLACEHOLDER_M36", "gemini-3.1-pro-low"),
        ("MODEL_PLACEHOLDER_M18", "gemini-3-flash"),
        ("MODEL_PLACEHOLDER_M8", "gemini-3-pro-high"),
        ("MODEL_PLACEHOLDER_M7", "gemini-3-pro-low"),
        ("MODEL_PLACEHOLDER_M9", "gemini-3-pro-image"),
        ("MODEL_PLACEHOLDER_M26", "claude-opus-4-6-thinking"),
        ("MODEL_PLACEHOLDER_M35", "claude-sonnet-4-6-thinking"),
        ("MODEL_PLACEHOLDER_M12", "claude-opus-4-5-thinking"),
        ("MODEL_OPENAI_GPT_OSS_120B_MEDIUM", "gpt-oss-120b-medium"),
        ("MODEL_CLAUDE_4_5_SONNET", "claude-sonnet-4-5"),
        (
            "MODEL_CLAUDE_4_5_SONNET_THINKING",
            "claude-sonnet-4-5-thinking",
        ),
    ])
});

// ============================================================================
// Internal helpers — fully testable (no Tauri state dependency)
// ============================================================================

/// 定位 antigravity 根目录：`~/.gemini/antigravity`
pub fn get_antigravity_root() -> Option<PathBuf> {
    // Sandboxed helper, not `dirs::home_dir()`: on Windows the latter goes to
    // the known-folder API and ignores `HOME`, so a test pointing `HOME` at a
    // fixture was silently scanning the developer's real one (#551).
    crate::utils::home_dir().map(|h| h.join(".gemini").join("antigravity"))
}

/// Resolves the antigravity root directory, with fallback discovery logic.
///
/// First checks the default `~/.gemini/antigravity` path, then falls back to
/// external state directories discovered via platform-specific config locations.
pub fn resolve_antigravity_root() -> Option<PathBuf> {
    let default_root = get_antigravity_root();
    if default_root.as_ref().is_some_and(|root| root.exists()) {
        return default_root;
    }

    discover_external_state_dirs()
        .into_iter()
        .next()
        .or(default_root)
}

/// Resolves the antigravity root from an arbitrary path by walking up the directory
/// tree and looking for the `.token-monitor/rpc-cache/v1` marker.
///
/// Returns `None` when no marker is found. Callers used to receive a
/// `default_root` fallback here, which meant any path that didn't match
/// the marker was silently accepted as if it lived under the default
/// antigravity install — that made downstream `path_in_resolved` checks
/// trivially pass for arbitrary paths. Refuse to guess: missing marker
/// now means "this is not a recognizable antigravity root".
pub fn antigravity_root_from_path(path: &str) -> Option<PathBuf> {
    let candidate = PathBuf::from(path);

    let mut current = if candidate.is_dir() {
        candidate.clone()
    } else {
        candidate.parent()?.to_path_buf()
    };

    loop {
        if current
            .join(".token-monitor")
            .join("rpc-cache")
            .join("v1")
            .exists()
            || current.join("conversation_summaries.db").is_file()
        {
            return Some(current);
        }

        if !current.pop() {
            break;
        }
    }

    if let Some(root) = get_antigravity_root() {
        if candidate.starts_with(&root) {
            return Some(root);
        }
    }

    None
}

/// Returns the RPC cache root path for a given antigravity root.
pub fn get_antigravity_rpc_cache_root(root: &Path) -> PathBuf {
    root.join(".token-monitor").join("rpc-cache").join("v1")
}

/// Discovers external state directories across platform-specific config locations.
///
/// On macOS searches `~/Library/Application Support`; on Windows `dirs::data_dir()`;
/// on Linux checks `~/.config` and platform config dirs. Looks for directories
/// containing a `monitor-state.json` file in their global storage subdirectory.
fn discover_external_state_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let bases = if cfg!(target_os = "macos") {
        crate::utils::home_dir()
            .map(|home| vec![home.join("Library").join("Application Support")])
            .unwrap_or_default()
    } else if cfg!(target_os = "windows") {
        dirs::data_dir().map(|dir| vec![dir]).unwrap_or_default()
    } else {
        let mut candidates = Vec::new();
        if let Some(config_dir) = dirs::config_dir() {
            candidates.push(config_dir);
        }
        if let Some(home) = crate::utils::home_dir() {
            let fallback = home.join(".config");
            if !candidates.iter().any(|candidate| candidate == &fallback) {
                candidates.push(fallback);
            }
        }
        candidates
    };

    for base in bases {
        let Ok(app_entries) = std::fs::read_dir(base) else {
            continue;
        };

        for app_entry in app_entries.flatten() {
            let Ok(file_type) = app_entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() || !file_type.is_dir() {
                continue;
            }

            let global_storage = app_entry.path().join("User").join("globalStorage");
            if !global_storage.exists() {
                continue;
            }
            if let Ok(meta) = std::fs::symlink_metadata(&global_storage) {
                if meta.file_type().is_symlink() {
                    continue;
                }
            }

            let Ok(storage_entries) = std::fs::read_dir(&global_storage) else {
                continue;
            };
            for storage_entry in storage_entries.flatten() {
                let Ok(file_type) = storage_entry.file_type() else {
                    continue;
                };
                if file_type.is_symlink() || !file_type.is_dir() {
                    continue;
                }

                let candidate = storage_entry.path();
                if candidate.join("monitor-state.json").exists() {
                    dirs.push(candidate);
                }
            }
        }
    }

    dirs
}

/// Metadata extracted from an RPC cache `manifest.json` file.
#[derive(Default)]
struct RpcManifestInfo {
    /// Unix timestamp (ms) when the state was exported.
    exported_at_ms: u64,
    /// Unix timestamp (ms) of the server's last modification.
    server_last_modified_ms: u64,
}

/// Accumulates token usage across multiple usage records in a session.
#[derive(Default)]
struct RpcSessionAggregate {
    /// Number of usage records processed.
    record_count: u32,
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
    reasoning_tokens: u64,
    total_tokens: u64,
    first_seen_ms: Option<u64>,
    last_seen_ms: Option<u64>,
    /// Maps model name -> total tokens used.
    model_totals: HashMap<String, u64>,
}

/// Represents a candidate session discovered in the antigravity brain directory.
struct SessionCandidate {
    session_id: String,
    session_dir: PathBuf,
    file_paths: Vec<PathBuf>,
    last_modified_ms: u64,
    label_hint: String,
}

/// Parses an RFC3339 timestamp string to Unix milliseconds.
fn parse_rfc3339_to_ms(raw: &str) -> Option<u64> {
    let timestamp_ms = chrono::DateTime::parse_from_rfc3339(raw)
        .ok()?
        .timestamp_millis();
    if timestamp_ms < 0 {
        return None;
    }
    u64::try_from(timestamp_ms).ok()
}

/// Returns the file's modification time in Unix milliseconds, or 0 on error.
fn file_mtime_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// Reads and parses the `manifest.json` file from an RPC cache directory.
fn read_rpc_manifest(dir: &Path) -> RpcManifestInfo {
    let path = dir.join("manifest.json");
    let Ok(content) = std::fs::read_to_string(path) else {
        return RpcManifestInfo::default();
    };
    let Ok(value) = serde_json::from_str::<Value>(&content) else {
        return RpcManifestInfo::default();
    };

    RpcManifestInfo {
        exported_at_ms: value["exportedAt"].as_u64().unwrap_or(0),
        server_last_modified_ms: value["serverLastModifiedMs"].as_u64().unwrap_or(0),
    }
}

/// Resolves a model placeholder string to its canonical model name.
fn resolve_model_alias(model: &str) -> String {
    MODEL_ALIAS_MAP
        .get(model)
        .copied()
        .unwrap_or(model)
        .to_string()
}

/// Checks whether a session ID contains only safe characters (alphanumeric, underscore, hyphen).
pub(crate) fn is_valid_antigravity_session_id(session_id: &str) -> bool {
    !session_id.is_empty()
        && session_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-'))
}

/// Counts step records in a JSON value (records with `"recordType": "step"`
/// or Antigravity transcript step entries with `"step_index"`).
fn count_step_rows(value: &Value) -> u32 {
    match value {
        Value::Object(record) => {
            if record.get("recordType").and_then(Value::as_str) == Some("step") {
                return 1;
            }
            if record.get("step_index").is_some() {
                let is_turn = matches!(
                    record.get("type").and_then(Value::as_str),
                    Some("USER_INPUT" | "PLANNER_RESPONSE")
                ) || matches!(
                    record.get("source").and_then(Value::as_str),
                    Some("USER_EXPLICIT" | "MODEL")
                );
                if is_turn {
                    return 1;
                }
            }
            0
        }
        _ => 0,
    }
}

/// Counts messages (step rows) in a JSON object or array of records.
fn count_messages(value: &Value) -> u32 {
    match value {
        Value::Object(record) => match record.get("records") {
            Some(Value::Array(arr)) => arr.iter().map(count_step_rows).sum(),
            _ => count_step_rows(value),
        },
        _ => 0,
    }
}

/// Estimates token count from raw text length using a 4-char-per-token heuristic.
fn estimate_tokens(text: &str) -> u64 {
    let normalized = text.trim();
    if normalized.is_empty() {
        return 0;
    }

    ((normalized.len() as f64) / 4.0).round().max(1.0) as u64
}

/// Recursively collects all string values from a JSON structure into `output`.
fn collect_text_from_json(value: &Value, output: &mut String) {
    match value {
        Value::String(text) if !text.trim().is_empty() => {
            output.push('\n');
            output.push_str(text);
        }
        Value::Array(items) => {
            for item in items {
                collect_text_from_json(item, output);
            }
        }
        Value::Object(map) => {
            for value in map.values() {
                collect_text_from_json(value, output);
            }
        }
        _ => {}
    }
}

/// Parses a usage record and accumulates its token data into the aggregate.
/// Returns `true` if the record was a usage record, `false` otherwise.
fn parse_usage_record(record: &Value, aggregate: &mut RpcSessionAggregate) -> bool {
    if let Some(created_at) = record
        .get("created_at")
        .and_then(Value::as_str)
        .or_else(|| record["raw"]["chatModel"]["chatStartMetadata"]["createdAt"].as_str())
    {
        if let Some(ms) = parse_rfc3339_to_ms(created_at) {
            aggregate.first_seen_ms = Some(match aggregate.first_seen_ms {
                Some(current) => current.min(ms),
                None => ms,
            });
            aggregate.last_seen_ms = Some(match aggregate.last_seen_ms {
                Some(current) => current.max(ms),
                None => ms,
            });
        }
    }

    if record["recordType"].as_str() != Some("usage") {
        return false;
    }

    let input = record["inputTokens"].as_u64().unwrap_or(0);
    let output = record["outputTokens"].as_u64().unwrap_or(0);
    let cache_read = record["cacheReadTokens"].as_u64().unwrap_or(0);
    let cache_write = record["cacheWriteTokens"].as_u64().unwrap_or(0);
    let reasoning = record["reasoningTokens"].as_u64().unwrap_or(0);
    let reported_total = record["totalTokens"].as_u64().unwrap_or(0);
    let normalized_total =
        reported_total.max(input + output + cache_read + cache_write + reasoning);

    aggregate.record_count += 1;
    aggregate.input_tokens += input;
    aggregate.output_tokens += output;
    aggregate.cache_read_tokens += cache_read;
    aggregate.cache_write_tokens += cache_write;
    aggregate.reasoning_tokens += reasoning;
    aggregate.total_tokens += normalized_total;

    let model = resolve_model_alias(record["model"].as_str().unwrap_or("unknown"));
    *aggregate.model_totals.entry(model).or_insert(0) += normalized_total;

    true
}

/// Recursively collects all file paths under `dir` into `files`, skipping
/// system files (`.DS_Store`, `Thumbs.db`, backup files with `~` suffix) and symlinks.
/// When `transcript_full.jsonl` is present in `dir`, skips `transcript.jsonl` to avoid
/// double-counting the compact and full transcripts.
fn collect_files(dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    let has_full_transcript = dir.join("transcript_full.jsonl").is_file();
    let entries =
        std::fs::read_dir(dir).map_err(|e| format!("Failed to read {}: {}", dir.display(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read {} entry: {}", dir.display(), e))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to inspect {}: {}", path.display(), e))?;
        if file_type.is_symlink() {
            continue;
        }

        let file_name = entry.file_name();
        let file_name_lower = file_name.to_string_lossy().to_lowercase();
        if file_name_lower == ".ds_store"
            || file_name_lower == "thumbs.db"
            || file_name_lower.ends_with('~')
        {
            continue;
        }
        if has_full_transcript && file_name_lower == "transcript.jsonl" {
            continue;
        }

        if file_type.is_dir() {
            collect_files(&path, files)?;
        } else {
            files.push(path);
        }
    }

    Ok(())
}

/// Returns the legacy sibling `~/.gemini/antigravity-ide/brain/<session_id>` directory
/// if `root` is `~/.gemini/antigravity` and that sibling directory exists as a real directory.
pub(crate) fn legacy_ide_brain_session_dir(root: &Path, session_id: &str) -> Option<PathBuf> {
    if root.file_name().and_then(|n| n.to_str()) != Some("antigravity") {
        return None;
    }
    let parent = root.parent()?;
    let legacy_root = parent.join("antigravity-ide");
    let meta = std::fs::symlink_metadata(&legacy_root).ok()?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return None;
    }
    let brain_dir = legacy_root.join("brain");
    let brain_meta = std::fs::symlink_metadata(&brain_dir).ok()?;
    if brain_meta.file_type().is_symlink() || !brain_meta.is_dir() {
        return None;
    }
    let session_dir = brain_dir.join(session_id);
    let session_meta = std::fs::symlink_metadata(&session_dir).ok()?;
    if session_meta.file_type().is_symlink() || !session_meta.is_dir() {
        return None;
    }
    Some(session_dir)
}

/// Summary metadata loaded from `conversation_summaries.db` (`conversation_summaries` + `conversations_fts`).
#[derive(Debug, Default, Clone)]
pub(crate) struct ConversationSummaryMeta {
    pub title: Option<String>,
    pub preview: Option<String>,
    pub fts_title: Option<String>,
    pub workspace: Option<String>,
    pub step_count: u32,
    pub fts_turn_count: u32,
    pub fts_text_bytes: usize,
    pub last_modified_ms: u64,
}

fn normalize_workspace_uri(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let without_scheme = trimmed.strip_prefix("file://").unwrap_or(trimmed);
    let decoded = urlencoding::decode(without_scheme)
        .map(std::borrow::Cow::into_owned)
        .unwrap_or_else(|_| without_scheme.to_string());
    let cleaned = if decoded.len() > 1 {
        decoded.trim_end_matches('/').to_string()
    } else {
        decoded
    };
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

fn parse_workspace_uris_json(raw: &str) -> Option<String> {
    if let Ok(Value::Array(items)) = serde_json::from_str::<Value>(raw) {
        for item in items {
            if let Some(s) = item.as_str() {
                if let Some(ws) = normalize_workspace_uri(s) {
                    return Some(ws);
                }
            }
        }
    }
    normalize_workspace_uri(raw)
}

fn parse_fts_offset_count(raw: Option<rusqlite::types::ValueRef<'_>>, body_non_empty: bool) -> u32 {
    let bytes = match raw {
        Some(rusqlite::types::ValueRef::Text(b) | rusqlite::types::ValueRef::Blob(b)) => b,
        _ => return u32::from(body_non_empty),
    };
    if let Ok(Value::Array(arr)) = serde_json::from_slice::<Value>(bytes) {
        if !arr.is_empty() {
            return arr.len() as u32;
        }
    }
    u32::from(body_non_empty)
}

/// Loads session summary metadata from `<root>/conversation_summaries.db` (read-only).
pub(crate) fn load_conversation_summaries_map(
    root: &Path,
) -> HashMap<String, ConversationSummaryMeta> {
    let mut map: HashMap<String, ConversationSummaryMeta> = HashMap::new();
    let db_path = root.join("conversation_summaries.db");
    let Ok(meta) = std::fs::symlink_metadata(&db_path) else {
        return map;
    };
    if meta.file_type().is_symlink() || !meta.is_file() {
        return map;
    }

    let flags = rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
        | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX
        | rusqlite::OpenFlags::SQLITE_OPEN_URI;
    let Ok(conn) = rusqlite::Connection::open_with_flags(&db_path, flags) else {
        return map;
    };
    let _ = conn.busy_timeout(std::time::Duration::from_millis(2000));

    if let Ok(mut stmt) = conn.prepare(
        "SELECT conversation_id, title, preview, step_count, last_modified_time, last_user_input_time \
         FROM conversation_summaries",
    ) {
        if let Ok(rows) = stmt.query([]) {
            let mut rows = rows;
            while let Ok(Some(row)) = rows.next() {
                let Ok(conv_id) = row.get::<_, String>(0) else {
                    continue;
                };
                if !is_valid_antigravity_session_id(&conv_id) {
                    continue;
                }
                let title = row
                    .get::<_, Option<String>>(1)
                    .ok()
                    .flatten()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
                let preview = row
                    .get::<_, Option<String>>(2)
                    .ok()
                    .flatten()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
                let step_count = row
                    .get::<_, Option<i64>>(3)
                    .ok()
                    .flatten()
                    .unwrap_or(0)
                    .max(0) as u32;
                let mod_ms = row
                    .get::<_, Option<String>>(4)
                    .ok()
                    .flatten()
                    .and_then(|s| parse_rfc3339_to_ms(&s))
                    .unwrap_or(0);
                let user_ms = row
                    .get::<_, Option<String>>(5)
                    .ok()
                    .flatten()
                    .and_then(|s| parse_rfc3339_to_ms(&s))
                    .unwrap_or(0);

                let entry = map.entry(conv_id).or_default();
                if title.is_some() {
                    entry.title = title;
                }
                if preview.is_some() {
                    entry.preview = preview;
                }
                entry.step_count = entry.step_count.max(step_count);
                entry.last_modified_ms = entry.last_modified_ms.max(mod_ms).max(user_ms);
            }
        }
    }

    if let Ok(mut stmt) = conn.prepare(
        "SELECT conversation_id, CAST(chunk_index AS INTEGER), title, CAST(step_count AS INTEGER), \
                last_modified_time, user_body, agent_body, user_step_byte_offsets, agent_step_byte_offsets \
         FROM conversations_fts",
    ) {
        if let Ok(rows) = stmt.query([]) {
            let mut rows = rows;
            while let Ok(Some(row)) = rows.next() {
                let Ok(conv_id) = row.get::<_, String>(0) else {
                    continue;
                };
                if !is_valid_antigravity_session_id(&conv_id) {
                    continue;
                }
                let chunk_idx = row.get::<_, Option<i64>>(1).ok().flatten().unwrap_or(0);
                let entry = map.entry(conv_id).or_default();

                if chunk_idx < 0 {
                    let fts_title = row
                        .get::<_, Option<String>>(2)
                        .ok()
                        .flatten()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty());
                    if fts_title.is_some() {
                        entry.fts_title = fts_title;
                    }
                    let step_count = row
                        .get::<_, Option<i64>>(3)
                        .ok()
                        .flatten()
                        .unwrap_or(0)
                        .max(0) as u32;
                    entry.step_count = entry.step_count.max(step_count);

                    if let Ok(raw_time) = row.get_ref(4) {
                        let ts_ms = match raw_time {
                            rusqlite::types::ValueRef::Integer(v) if v > 0 => {
                                let u = v as u64;
                                if u > 10_000_000_000_000 {
                                    u / 1_000_000
                                } else {
                                    u
                                }
                            }
                            rusqlite::types::ValueRef::Text(b) => std::str::from_utf8(b)
                                .ok()
                                .and_then(|s| {
                                    s.trim()
                                        .parse::<u64>()
                                        .ok()
                                        .map(|u| {
                                            if u > 10_000_000_000_000 {
                                                u / 1_000_000
                                            } else {
                                                u
                                            }
                                        })
                                        .or_else(|| parse_rfc3339_to_ms(s.trim()))
                                })
                                .unwrap_or(0),
                            _ => 0,
                        };
                        entry.last_modified_ms = entry.last_modified_ms.max(ts_ms);
                    }
                } else {
                    let user_body = row
                        .get::<_, Option<String>>(5)
                        .ok()
                        .flatten()
                        .unwrap_or_default();
                    let agent_body = row
                        .get::<_, Option<String>>(6)
                        .ok()
                        .flatten()
                        .unwrap_or_default();
                    entry.fts_text_bytes += user_body.len() + agent_body.len();
                    let u_turns =
                        parse_fts_offset_count(row.get_ref(7).ok(), !user_body.trim().is_empty());
                    let a_turns =
                        parse_fts_offset_count(row.get_ref(8).ok(), !agent_body.trim().is_empty());
                    entry.fts_turn_count = entry.fts_turn_count.saturating_add(u_turns + a_turns);
                }
            }
        }
    }

    if let Ok(mut stmt) =
        conn.prepare("SELECT conversation_id, workspace_uris FROM conversation_summaries")
    {
        if let Ok(mut rows) = stmt.query([]) {
            while let Ok(Some(row)) = rows.next() {
                let Ok(conv_id) = row.get::<_, String>(0) else {
                    continue;
                };
                if !is_valid_antigravity_session_id(&conv_id) {
                    continue;
                }
                if let Some(ws) = row
                    .get::<_, Option<String>>(1)
                    .ok()
                    .flatten()
                    .and_then(|raw| parse_workspace_uris_json(&raw))
                {
                    map.entry(conv_id).or_default().workspace = Some(ws);
                }
            }
        }
    }

    if let Ok(mut stmt) = conn.prepare(
        "SELECT conversation_id, workspace FROM conversations_fts WHERE CAST(chunk_index AS INTEGER) < 0",
    ) {
        if let Ok(mut rows) = stmt.query([]) {
            while let Ok(Some(row)) = rows.next() {
                let Ok(conv_id) = row.get::<_, String>(0) else {
                    continue;
                };
                if !is_valid_antigravity_session_id(&conv_id) {
                    continue;
                }
                let entry = map.entry(conv_id).or_default();
                if entry.workspace.is_none() {
                    entry.workspace = row
                        .get::<_, Option<String>>(1)
                        .ok()
                        .flatten()
                        .and_then(|raw| normalize_workspace_uri(&raw));
                }
            }
        }
    }

    map
}

/// Parses `<root>/annotations/<session_id>.pbtxt` for `title:"..."` and `last_user_view_time`.
pub(crate) fn read_annotation_pbtxt(root: &Path, session_id: &str) -> (Option<String>, u64) {
    let pbtxt_path = root.join("annotations").join(format!("{session_id}.pbtxt"));
    let Ok(meta) = std::fs::symlink_metadata(&pbtxt_path) else {
        return (None, 0);
    };
    if meta.file_type().is_symlink() || !meta.is_file() {
        return (None, 0);
    }
    let mtime_ms = file_mtime_ms(&pbtxt_path);
    let Ok(content) = std::fs::read_to_string(&pbtxt_path) else {
        return (None, mtime_ms);
    };

    let mut title = None;
    if let Some(pos) = content.find("title:") {
        let after = content[pos + "title:".len()..].trim_start();
        if let Some(rest) = after.strip_prefix('"') {
            let mut parsed = String::new();
            let mut chars = rest.chars();
            while let Some(ch) = chars.next() {
                if ch == '\\' {
                    if let Some(next_ch) = chars.next() {
                        match next_ch {
                            'n' => parsed.push('\n'),
                            't' => parsed.push('\t'),
                            'r' => parsed.push('\r'),
                            other => parsed.push(other),
                        }
                    }
                } else if ch == '"' {
                    break;
                } else {
                    parsed.push(ch);
                }
            }
            let trimmed = parsed.trim().to_string();
            if !trimmed.is_empty() {
                title = Some(trimmed);
            }
        }
    }

    let mut view_ms = mtime_ms;
    if let Some(pos) = content.find("seconds:") {
        let after = content[pos + "seconds:".len()..].trim_start();
        let digits: String = after.chars().take_while(char::is_ascii_digit).collect();
        if let Ok(sec) = digits.parse::<u64>() {
            view_ms = view_ms.max(sec.saturating_mul(1000));
        }
    }

    (title, view_ms)
}

/// Scans the `brain/` directory for session candidates, returning them sorted
/// by last modification time (newest first).
fn scan_brain_candidates(
    root: &Path,
    report: &ScanReport,
) -> Result<Vec<SessionCandidate>, String> {
    let brain_dir = root.join("brain");
    let conversations_dir = root.join("conversations");
    let has_summaries_db = report
        .metadata(&root.join("conversation_summaries.db"))
        .is_some();
    if report.metadata(&brain_dir).is_none() {
        return Ok(vec![]);
    }

    let entries = std::fs::read_dir(&brain_dir)
        .map_err(|e| format!("Failed to read {}: {}", brain_dir.display(), e))?;
    let mut sessions = Vec::new();

    for entry in entries.filter_map(|entry| report.read(&brain_dir, entry)) {
        let Some(file_type) = report.read(&entry.path(), entry.file_type()) else {
            continue;
        };
        if file_type.is_symlink() || !file_type.is_dir() {
            continue;
        }

        let session_id = entry.file_name().to_string_lossy().to_string();
        // Defense-in-depth: refuse any brain-dir name that wouldn't be
        // safe to embed in a file path (e.g. `..`, `foo/bar`, control
        // chars). The entry filename is read straight from disk so the
        // allowlist guards against an attacker-placed directory.
        if !is_valid_antigravity_session_id(&session_id) {
            continue;
        }
        let session_dir = entry.path();
        let mut file_paths = Vec::new();
        collect_files(&session_dir, &mut file_paths)?;

        // Check legacy ~/.gemini/antigravity-ide/brain/<session_id> if no transcript files found here
        let has_local_transcript = file_paths.iter().any(|p| {
            p.file_name().and_then(|n| n.to_str()).is_some_and(|n| {
                matches!(
                    n,
                    "transcript_full.jsonl" | "transcript.jsonl" | "overview.txt"
                )
            })
        });
        if !has_local_transcript {
            if let Some(legacy_dir) = legacy_ide_brain_session_dir(root, &session_id) {
                let _ = collect_files(&legacy_dir, &mut file_paths);
            }
        }

        let pb_path = conversations_dir.join(format!("{session_id}.pb"));
        // Defense-in-depth: reject symlinks even though the parent
        // directory was already symlink-guarded — a symlinked .pb
        // artifact could point outside the trusted antigravity root.
        if let Ok(meta) = std::fs::symlink_metadata(&pb_path) {
            if !meta.file_type().is_symlink() && meta.file_type().is_file() {
                file_paths.push(pb_path);
            }
        }

        let db_path = conversations_dir.join(format!("{session_id}.db"));
        let has_conv_db = std::fs::symlink_metadata(&db_path)
            .map(|m| !m.file_type().is_symlink() && m.file_type().is_file())
            .unwrap_or(false);

        let mut last_modified_ms = 0;
        for file_path in &file_paths {
            last_modified_ms = last_modified_ms.max(file_mtime_ms(file_path));
        }
        if has_conv_db {
            last_modified_ms = last_modified_ms.max(file_mtime_ms(&db_path));
        }

        if file_paths.is_empty() && !has_conv_db && !has_summaries_db {
            continue;
        }

        sessions.push(SessionCandidate {
            session_id: session_id.clone(),
            session_dir,
            file_paths,
            last_modified_ms,
            label_hint: session_id,
        });
    }

    sessions.sort_by_key(|s| std::cmp::Reverse(s.last_modified_ms));
    Ok(sessions)
}

/// Resolves a human-readable label for a session by reading `task.md`,
/// `implementation_plan.md`, or `walkthrough.md` and extracting the first `#` heading,
/// or falling back to the first `USER_INPUT` prompt in a transcript file.
fn resolve_label(session_dir: &Path, fallback: &str) -> String {
    for label_file in ["task.md", "implementation_plan.md", "walkthrough.md"] {
        let path = session_dir.join(label_file);
        let Ok(content) = std::fs::read_to_string(path) else {
            continue;
        };
        for line in content.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("# ") {
                let candidate = rest.trim().trim_start_matches("Task:").trim();
                if !candidate.is_empty() {
                    return candidate.to_string();
                }
            }
        }
    }

    let logs_dir = session_dir.join(".system_generated").join("logs");
    for log_name in ["transcript_full.jsonl", "transcript.jsonl", "overview.txt"] {
        let path = logs_dir.join(log_name);
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() || !meta.is_file() {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        for line in content.lines() {
            let trimmed = line.trim();
            if !trimmed.starts_with('{') {
                continue;
            }
            let Ok(v) = serde_json::from_str::<Value>(trimmed) else {
                continue;
            };
            let is_user = v.get("type").and_then(Value::as_str) == Some("USER_INPUT")
                || v.get("source").and_then(Value::as_str) == Some("USER_EXPLICIT");
            if !is_user {
                continue;
            }
            if let Some(text) = v.get("content").and_then(Value::as_str) {
                let cleaned = text
                    .trim()
                    .trim_start_matches("<USER_REQUEST>")
                    .trim_end_matches("</USER_REQUEST>")
                    .trim();
                if let Some(first_line) = cleaned.lines().map(str::trim).find(|l| !l.is_empty()) {
                    let truncated: String = first_line.chars().take(80).collect();
                    return truncated;
                }
            }
        }
    }

    fallback.to_string()
}

/// Parses token usage from a list of files (jsonl, json, md, txt, log, yaml).
/// Returns the aggregated token counts, message count, and concatenated text.
fn parse_token_files(token_file_paths: &[PathBuf]) -> (RpcSessionAggregate, u32, String) {
    let mut aggregate = RpcSessionAggregate::default();
    let mut message_count = 0u32;
    let mut estimated_text = String::new();

    for file_path in token_file_paths {
        let ext = file_path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        // Defense-in-depth: only read regular files. The parent rpc-cache
        // directory is symlink-guarded upstream, but the entries within
        // it could still be symlinks (pointing outside the root) or
        // non-regular files (FIFOs, devices, …) that could block or
        // misbehave under `read_to_string`. Match the same guard used
        // by `load_active_state` / `load_archive_states`.
        let Ok(meta) = std::fs::symlink_metadata(file_path) else {
            continue;
        };
        if !meta.file_type().is_file() {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(file_path) else {
            continue;
        };

        match ext.as_str() {
            "jsonl" => {
                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    estimated_text.push('\n');
                    estimated_text.push_str(trimmed);
                    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
                        continue;
                    };
                    message_count += count_step_rows(&value);
                    parse_usage_record(&value, &mut aggregate);
                }
            }
            "json" => {
                estimated_text.push('\n');
                estimated_text.push_str(content.trim());
                let Ok(value) = serde_json::from_str::<Value>(&content) else {
                    continue;
                };
                message_count += count_messages(&value);
                collect_text_from_json(&value, &mut estimated_text);
            }
            "md" | "txt" | "log" | "yaml" | "yml" => {
                estimated_text.push('\n');
                estimated_text.push_str(&content);
                if ext == "txt" {
                    for line in content.lines() {
                        let trimmed = line.trim();
                        if trimmed.starts_with('{') {
                            if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
                                message_count += count_step_rows(&value);
                                parse_usage_record(&value, &mut aggregate);
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    (aggregate, message_count, estimated_text)
}

/// Applies metadata from `conversation_summaries.db` and `annotations/<session_id>.pbtxt`
/// onto a synthesized `PersistedSessionState`.
fn enrich_session_with_metadata(
    root: &Path,
    session_id: &str,
    persisted: &mut PersistedSessionState,
    summary_meta: Option<&ConversationSummaryMeta>,
) {
    let (annotation_title, annotation_ms) = read_annotation_pbtxt(root, session_id);
    let summary_title = summary_meta.and_then(|m| {
        m.title
            .clone()
            .or_else(|| m.fts_title.clone())
            .or_else(|| m.preview.clone())
    });

    // Prefer conversation_summaries.title -> annotations.pbtxt title -> fts_title/preview -> existing label
    let best_title = summary_meta
        .and_then(|m| m.title.clone())
        .or(annotation_title)
        .or(summary_title);

    if let Some(title) = best_title {
        if !title.is_empty() {
            persisted.latest.label = title;
        }
    }

    if let Some(meta) = summary_meta {
        let current_msg_count = persisted.latest.message_count.unwrap_or(0);
        let best_msg_count = current_msg_count
            .max(meta.fts_turn_count)
            .max(meta.step_count);
        if best_msg_count > 0 {
            persisted.latest.message_count = Some(best_msg_count);
        }
        if persisted.latest.evidence_count == 0 {
            persisted.latest.evidence_count = if meta.step_count > 0 {
                meta.step_count
            } else {
                meta.fts_turn_count
            };
        }
        if persisted.latest.total_tokens == 0 && meta.fts_text_bytes > 0 {
            let est_total = ((meta.fts_text_bytes as f64) / 4.0).round().max(1.0) as u64;
            let est_input = ((est_total as f64) * ESTIMATED_PROMPT_RATIO).round() as u64;
            persisted.latest.total_tokens = est_total;
            persisted.latest.input_tokens = est_input;
            persisted.latest.output_tokens = est_total.saturating_sub(est_input);
        }
        if meta.last_modified_ms > persisted.latest.last_modified_ms {
            persisted.latest.last_modified_ms = meta.last_modified_ms;
            persisted.lifecycle.last_seen_at =
                persisted.lifecycle.last_seen_at.max(meta.last_modified_ms);
        }
    }

    if annotation_ms > persisted.latest.last_modified_ms {
        persisted.latest.last_modified_ms = annotation_ms;
        persisted.lifecycle.last_seen_at = persisted.lifecycle.last_seen_at.max(annotation_ms);
    }
}

#[allow(clippy::too_many_arguments)]
/// Builds a `PersistedSessionState` from token files and metadata for a single session.
fn build_session_state(
    session_id: &str,
    label_dir: &Path,
    storage_dir: &Path,
    label_hint: &str,
    token_file_paths: &[PathBuf],
    last_modified_ms: u64,
    source: &str,
    lifecycle_status: SessionLifecycleStatus,
) -> PersistedSessionState {
    let (aggregate, message_count, estimated_text) = parse_token_files(token_file_paths);
    let label = resolve_label(label_dir, label_hint);
    let is_reported = aggregate.record_count > 0;
    let total_tokens = if is_reported {
        aggregate.total_tokens
    } else {
        estimate_tokens(&estimated_text)
    };
    let estimated_input_tokens = ((total_tokens as f64) * ESTIMATED_PROMPT_RATIO).round() as u64;

    let latest = SessionTotals {
        session_id: session_id.to_string(),
        label,
        file_path: storage_dir.to_string_lossy().to_string(),
        last_modified_ms,
        mode: if is_reported {
            "reported".to_string()
        } else {
            "estimated".to_string()
        },
        source: source.to_string(),
        evidence_count: if aggregate.record_count > 0 {
            aggregate.record_count
        } else {
            message_count
        },
        message_count: Some(if message_count > 0 {
            message_count
        } else {
            aggregate.record_count
        }),
        input_tokens: if is_reported {
            aggregate.input_tokens
        } else {
            estimated_input_tokens
        },
        output_tokens: if is_reported {
            aggregate.output_tokens
        } else {
            total_tokens.saturating_sub(estimated_input_tokens)
        },
        cache_read_tokens: aggregate.cache_read_tokens,
        cache_write_tokens: aggregate.cache_write_tokens,
        reasoning_tokens: aggregate.reasoning_tokens,
        total_tokens,
        model_totals: if aggregate.model_totals.is_empty() {
            None
        } else {
            Some(aggregate.model_totals)
        },
    };

    let signature = format!("{source}:{session_id}:{last_modified_ms}");
    let last_seen_at = aggregate.last_seen_ms.unwrap_or(last_modified_ms);
    let archived_at =
        matches!(lifecycle_status, SessionLifecycleStatus::Archived).then_some(last_modified_ms);

    PersistedSessionState {
        signature,
        latest,
        snapshots: vec![],
        lifecycle: SessionLifecycle {
            status: lifecycle_status,
            last_seen_at,
            archived_at,
        },
    }
}

/// Builds the full `AntigravityState` by scanning the antigravity root directory:
/// first from `brain/` candidates, then from the RPC cache directory, and finally
/// from `conversation_summaries.db` and `conversations/*.db`.
/// Sessions from the `brain/` directory and the rpc cache. A path that is
/// there but cannot be looked at is recorded in `report` (it passes for an
/// absent one otherwise).
fn build_state_from_token_monitor_sources(
    root: &Path,
    report: &ScanReport,
) -> Result<AntigravityState, String> {
    let rpc_root = get_antigravity_rpc_cache_root(root);
    let summaries_map = load_conversation_summaries_map(root);
    let mut sessions = HashMap::new();
    let mut seen_ids = HashSet::new();
    let exists = |path: &Path| report.metadata(path).is_some();

    for candidate in scan_brain_candidates(root, report)? {
        let rpc_dir = rpc_root.join(&candidate.session_id);
        let manifest = read_rpc_manifest(&rpc_dir);
        let usage_path = rpc_dir.join("usage.jsonl");
        let steps_path = rpc_dir.join("steps.jsonl");
        let has_rpc_artifact = exists(&usage_path) || exists(&steps_path);

        let (token_file_paths, source, effective_last_modified) = if has_rpc_artifact {
            let mut token_paths = Vec::new();
            if exists(&usage_path) {
                token_paths.push(usage_path.clone());
            }
            if exists(&steps_path) {
                token_paths.push(steps_path.clone());
            }
            let last_modified = [
                candidate.last_modified_ms,
                file_mtime_ms(&usage_path),
                file_mtime_ms(&steps_path),
                manifest.exported_at_ms,
                manifest.server_last_modified_ms,
            ]
            .into_iter()
            .max()
            .unwrap_or(candidate.last_modified_ms);
            (token_paths, "rpc-artifact", last_modified)
        } else {
            (
                candidate.file_paths.clone(),
                "filesystem",
                candidate.last_modified_ms,
            )
        };

        let storage_dir = if has_rpc_artifact {
            rpc_dir.clone()
        } else {
            candidate.session_dir.clone()
        };
        let mut persisted = build_session_state(
            &candidate.session_id,
            &candidate.session_dir,
            &storage_dir,
            &candidate.label_hint,
            &token_file_paths,
            effective_last_modified,
            source,
            SessionLifecycleStatus::Active,
        );
        enrich_session_with_metadata(
            root,
            &candidate.session_id,
            &mut persisted,
            summaries_map.get(&candidate.session_id),
        );
        // Reject completely empty brain directories that have no files, no rpc artifact, and no summary/db metadata
        if !has_rpc_artifact
            && candidate.file_paths.is_empty()
            && !summaries_map.contains_key(&candidate.session_id)
            && !root
                .join("conversations")
                .join(format!("{}.db", candidate.session_id))
                .is_file()
        {
            continue;
        }
        seen_ids.insert(candidate.session_id.clone());
        sessions.insert(candidate.session_id, persisted);
    }

    if exists(&rpc_root) {
        let entries = std::fs::read_dir(&rpc_root)
            .map_err(|e| format!("Failed to read {}: {}", rpc_root.display(), e))?;
        for entry in entries.filter_map(|entry| report.read(&rpc_root, entry)) {
            let session_dir = entry.path();
            let Some(file_type) = report.read(&session_dir, entry.file_type()) else {
                continue;
            };
            if file_type.is_symlink() || !file_type.is_dir() {
                continue;
            }
            let session_id = entry.file_name().to_string_lossy().to_string();
            if !is_valid_antigravity_session_id(&session_id) {
                continue;
            }
            if seen_ids.contains(&session_id) {
                continue;
            }

            let usage_path = session_dir.join("usage.jsonl");
            let steps_path = session_dir.join("steps.jsonl");
            let mut token_paths = Vec::new();
            if exists(&usage_path) {
                token_paths.push(usage_path.clone());
            }
            if exists(&steps_path) {
                token_paths.push(steps_path.clone());
            }
            if token_paths.is_empty() {
                continue;
            }

            let manifest = read_rpc_manifest(&session_dir);
            let last_modified = [
                file_mtime_ms(&usage_path),
                file_mtime_ms(&steps_path),
                manifest.exported_at_ms,
                manifest.server_last_modified_ms,
            ]
            .into_iter()
            .max()
            .unwrap_or_else(|| file_mtime_ms(&session_dir));

            let mut persisted = build_session_state(
                &session_id,
                &session_dir,
                &session_dir,
                &session_id,
                &token_paths,
                last_modified,
                "rpc-artifact",
                SessionLifecycleStatus::Archived,
            );
            enrich_session_with_metadata(
                root,
                &session_id,
                &mut persisted,
                summaries_map.get(&session_id),
            );
            seen_ids.insert(session_id.clone());
            sessions.insert(session_id, persisted);
        }
    }

    // Discover sessions present in `conversation_summaries.db` or `conversations/*.db`
    // that do not have a `brain/<session_id>` directory on disk.
    let mut extra_ids: Vec<String> = summaries_map
        .keys()
        .filter(|id| !seen_ids.contains(*id))
        .cloned()
        .collect();

    let conversations_dir = root.join("conversations");
    if let Ok(entries) = std::fs::read_dir(&conversations_dir) {
        for entry in entries.flatten() {
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if ft.is_symlink() || !ft.is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("db") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if is_valid_antigravity_session_id(stem)
                && !seen_ids.contains(stem)
                && !extra_ids.iter().any(|x| x == stem)
            {
                extra_ids.push(stem.to_string());
            }
        }
    }

    for session_id in extra_ids {
        let brain_session_dir = root.join("brain").join(&session_id);
        let mut token_files = Vec::new();
        if let Some(legacy_dir) = legacy_ide_brain_session_dir(root, &session_id) {
            let _ = collect_files(&legacy_dir, &mut token_files);
        }
        let db_path = conversations_dir.join(format!("{session_id}.db"));
        let has_db = std::fs::symlink_metadata(&db_path)
            .map(|m| !m.file_type().is_symlink() && m.file_type().is_file())
            .unwrap_or(false);
        let mut last_modified = token_files
            .iter()
            .map(|p| file_mtime_ms(p))
            .max()
            .unwrap_or(0);
        if has_db {
            last_modified = last_modified.max(file_mtime_ms(&db_path));
        }

        let storage_dir = if root.join("brain").is_dir() || !has_db {
            brain_session_dir.clone()
        } else {
            db_path.clone()
        };
        let label_dir = legacy_ide_brain_session_dir(root, &session_id)
            .unwrap_or_else(|| brain_session_dir.clone());

        let mut persisted = build_session_state(
            &session_id,
            &label_dir,
            &storage_dir,
            &session_id,
            &token_files,
            last_modified,
            "filesystem",
            SessionLifecycleStatus::Active,
        );
        enrich_session_with_metadata(
            root,
            &session_id,
            &mut persisted,
            summaries_map.get(&session_id),
        );
        seen_ids.insert(session_id.clone());
        sessions.insert(session_id, persisted);
    }

    Ok(AntigravityState {
        last_poll_at: None,
        sessions,
    })
}

/// Alias for `build_state_from_token_monitor_sources` — discovers sessions
/// from both the `brain/` directory and the RPC cache.
fn build_state_from_rpc_cache(
    root: &Path,
    report: &ScanReport,
) -> Result<AntigravityState, String> {
    build_state_from_token_monitor_sources(root, report)
}

/// 从单个 JSON 文件读取 `AntigravityState`
pub fn load_state_file(path: &Path) -> Result<AntigravityState, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    serde_json::from_str::<AntigravityState>(&content)
        .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))
}

/// 读取活跃状态 `monitor-state.json`
pub fn load_active_state(root: &Path) -> Option<AntigravityState> {
    load_active_state_reporting(root, &ScanReport::default())
}

/// [`load_active_state`], recording in `report` a state file that is there
/// but cannot be read (one that does not parse is not a state).
fn load_active_state_reporting(root: &Path, report: &ScanReport) -> Option<AntigravityState> {
    let active_path = root.join("monitor-state.json");
    // Defense-in-depth: refuse to follow a symlinked monitor-state.json
    // even though the parent directory is trusted. `symlink_metadata`
    // also implicitly checks for existence.
    let meta = report.symlink_metadata(&active_path)?;
    if meta.file_type().is_symlink() || !meta.file_type().is_file() {
        return None;
    }
    read_state_file(&active_path, report)
}

/// A state file's contents: a read failure is recorded in `report`.
fn read_state_file(path: &Path, report: &ScanReport) -> Option<AntigravityState> {
    serde_json::from_str(&report.read_to_string(path)?).ok()
}

/// 扫描并读取所有归档文件 `monitor-state.archive-YYYY-MM.json`
pub fn load_archive_states(root: &Path) -> Vec<AntigravityState> {
    load_archive_states_reporting(root, &ScanReport::default())
}

/// [`load_archive_states`], recording in `report` what it cannot read.
fn load_archive_states_reporting(root: &Path, report: &ScanReport) -> Vec<AntigravityState> {
    let mut named = Vec::new();
    for entry in report.read_dir(root) {
        let name = entry.file_name();
        let name_str = name.to_string_lossy().to_string();
        if name_str.starts_with("monitor-state.archive-")
            && Path::new(&name_str)
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
        {
            let archive_path = entry.path();
            // Same defense-in-depth as load_active_state: refuse
            // symlinked archive files regardless of platform
            // (DirEntry::file_type follows symlinks on some targets).
            let Some(meta) = report.symlink_metadata(&archive_path) else {
                continue;
            };
            if meta.file_type().is_symlink() || !meta.file_type().is_file() {
                continue;
            }
            if let Some(state) = read_state_file(&archive_path, report) {
                named.push((name_str, state));
            }
        }
    }
    named.sort_by(|a, b| a.0.cmp(&b.0));
    named.into_iter().map(|(_, s)| s).collect()
}

/// 合并多个状态：后者（active）覆盖前者（archive）中的相同 `session_id`
///
/// 与 antigravity-token-monitor 的 `mergeSessionMaps` 逻辑一致
pub fn merge_states(
    archive_states: Vec<AntigravityState>,
    active: Option<AntigravityState>,
) -> AntigravityState {
    let mut merged: HashMap<String, PersistedSessionState> = HashMap::new();

    // Apply archives first (oldest → newest)
    for archive in archive_states {
        for (id, session) in archive.sessions {
            merged.insert(id, session);
        }
    }

    // Active overrides archives; preserve its last_poll_at so the
    // frontend can show when the monitor last refreshed.
    let last_poll_at = active.as_ref().and_then(|a| a.last_poll_at);
    if let Some(active_state) = active {
        for (id, session) in active_state.sessions {
            merged.insert(id, session);
        }
    }

    AntigravityState {
        last_poll_at,
        sessions: merged,
    }
}

/// 聚合计算项目汇总 — 纯函数，易于测试
pub fn compute_project_summary(state: &AntigravityState) -> AntigravityProjectSummary {
    let mut total_input = 0u64;
    let mut total_output = 0u64;
    let mut total_cache_read = 0u64;
    let mut total_cache_write = 0u64;
    let mut total_reasoning = 0u64;
    let mut total_tokens = 0u64;
    let mut active_count = 0usize;
    let mut archived_count = 0usize;
    let mut snapshots_total = 0usize;
    let mut sessions_info: Vec<AntigravitySessionInfo> = Vec::new();

    for (session_id, session_state) in &state.sessions {
        let totals = &session_state.latest;
        total_input += totals.input_tokens;
        total_output += totals.output_tokens;
        total_cache_read += totals.cache_read_tokens;
        total_cache_write += totals.cache_write_tokens;
        total_reasoning += totals.reasoning_tokens;
        total_tokens += totals.total_tokens;
        snapshots_total += session_state.snapshots.len();

        let lifecycle_str = match session_state.lifecycle.status {
            SessionLifecycleStatus::Active => {
                active_count += 1;
                "active".to_string()
            }
            SessionLifecycleStatus::Archived => {
                archived_count += 1;
                "archived".to_string()
            }
        };

        sessions_info.push(AntigravitySessionInfo {
            session_id: session_id.clone(),
            label: totals.label.clone(),
            lifecycle: lifecycle_str,
            last_seen_at: session_state.lifecycle.last_seen_at,
            total_tokens: totals.total_tokens,
            snapshots_count: session_state.snapshots.len(),
        });
    }

    sessions_info.sort_by_key(|s| std::cmp::Reverse(s.total_tokens));

    AntigravityProjectSummary {
        session_count: state.sessions.len(),
        active_sessions: active_count,
        archived_sessions: archived_count,
        total_input_tokens: total_input,
        total_output_tokens: total_output,
        total_cache_read_tokens: total_cache_read,
        total_cache_write_tokens: total_cache_write,
        total_reasoning_tokens: total_reasoning,
        total_tokens,
        snapshots_count: snapshots_total,
        sessions: sessions_info,
    }
}

/// 加载并合并状态（可注入根路径，便于测试）
pub fn load_antigravity_state_impl(root: &Path) -> Result<AntigravityState, String> {
    load_antigravity_state_reporting(root, &ScanReport::default())
}

/// [`load_antigravity_state_impl`], recording in `report` the state files,
/// directories and session artifacts that are there but cannot be read.
pub(crate) fn load_antigravity_state_reporting(
    root: &Path,
    report: &ScanReport,
) -> Result<AntigravityState, String> {
    if report.metadata(root).is_some() {
        let active = load_active_state_reporting(root, report);
        let archive_states = load_archive_states_reporting(root, report);
        let merged = merge_states(archive_states, active);
        if !merged.sessions.is_empty() {
            return Ok(merged);
        }

        let rpc_state = build_state_from_rpc_cache(root, report)?;
        if !rpc_state.sessions.is_empty() {
            return Ok(rpc_state);
        }
    }

    for external_root in discover_external_state_dirs() {
        let external_active = load_active_state_reporting(&external_root, report);
        let external_archives = load_archive_states_reporting(&external_root, report);
        let external_merged = merge_states(external_archives, external_active);
        if !external_merged.sessions.is_empty() {
            return Ok(external_merged);
        }
    }

    Ok(AntigravityState::default())
}

// ============================================================================
// Tauri commands
// ============================================================================

#[tauri::command]
pub async fn load_antigravity_state() -> Result<AntigravityState, String> {
    let root = resolve_antigravity_root().ok_or("Cannot determine antigravity root directory")?;
    load_antigravity_state_impl(&root)
}

#[tauri::command]
pub async fn get_antigravity_session(
    session_id: String,
) -> Result<Option<PersistedSessionState>, String> {
    if !is_valid_antigravity_session_id(&session_id) {
        return Err("Invalid antigravity session_id".to_string());
    }
    let root = resolve_antigravity_root().ok_or("Cannot determine antigravity root directory")?;
    let state = load_antigravity_state_impl(&root)?;
    Ok(state.sessions.get(&session_id).cloned())
}

#[tauri::command]
pub async fn get_antigravity_project_summary(
    root_path: Option<String>,
) -> Result<AntigravityProjectSummary, String> {
    // Resolution order: marker-anchored root from the supplied path,
    // then the platform-discovered default. The previous middle step
    // (accept `PathBuf::from(root_path)` directly) weakened the marker
    // contract — it would admit any supplied path even when the marker
    // walk failed.
    let root = root_path
        .as_deref()
        .and_then(antigravity_root_from_path)
        .or_else(resolve_antigravity_root)
        .ok_or("Cannot determine antigravity root directory")?;
    let state = load_antigravity_state_impl(&root)?;
    Ok(compute_project_summary(&state))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        PersistedSessionState, SessionLifecycle, SessionLifecycleStatus, SessionTotals,
    };
    use serial_test::serial;
    use tempfile::TempDir;

    fn make_session(
        id: &str,
        total_tokens: u64,
        status: SessionLifecycleStatus,
    ) -> PersistedSessionState {
        PersistedSessionState {
            signature: format!("sig-{id}"),
            latest: SessionTotals {
                session_id: id.to_string(),
                label: format!("Session {id}"),
                total_tokens,
                input_tokens: total_tokens / 2,
                output_tokens: total_tokens / 4,
                cache_read_tokens: total_tokens / 8,
                cache_write_tokens: total_tokens / 8,
                ..Default::default()
            },
            snapshots: vec![],
            lifecycle: SessionLifecycle {
                status,
                last_seen_at: 1_700_000_000_000,
                archived_at: None,
            },
        }
    }

    #[test]
    fn test_merge_states_active_overrides_archive() {
        let mut archive_sessions = HashMap::new();
        archive_sessions.insert(
            "sess-001".to_string(),
            make_session("sess-001", 1000, SessionLifecycleStatus::Archived),
        );
        let archive = AntigravityState {
            last_poll_at: None,
            sessions: archive_sessions,
        };

        let mut active_sessions = HashMap::new();
        active_sessions.insert(
            "sess-001".to_string(),
            make_session("sess-001", 5000, SessionLifecycleStatus::Active),
        );
        let active = AntigravityState {
            last_poll_at: Some(1_700_000_001_000),
            sessions: active_sessions,
        };

        let merged = merge_states(vec![archive], Some(active));
        let session = merged.sessions.get("sess-001").unwrap();
        // Active value (5000) should win over archive value (1000)
        assert_eq!(session.latest.total_tokens, 5000);
    }

    #[test]
    fn test_merge_states_preserves_archive_only_sessions() {
        let mut archive_sessions = HashMap::new();
        archive_sessions.insert(
            "old-sess".to_string(),
            make_session("old-sess", 999, SessionLifecycleStatus::Archived),
        );
        let archive = AntigravityState {
            last_poll_at: None,
            sessions: archive_sessions,
        };

        let merged = merge_states(vec![archive], None);
        assert!(merged.sessions.contains_key("old-sess"));
        assert_eq!(merged.sessions.len(), 1);
    }

    #[test]
    fn test_merge_states_empty() {
        let merged = merge_states(vec![], None);
        assert!(merged.sessions.is_empty());
        assert!(merged.last_poll_at.is_none());
    }

    #[test]
    fn test_merge_states_preserves_active_last_poll_at() {
        let archive = AntigravityState {
            last_poll_at: None,
            sessions: HashMap::new(),
        };
        let active = AntigravityState {
            last_poll_at: Some(1_700_000_002_000),
            sessions: HashMap::new(),
        };

        let merged = merge_states(vec![archive], Some(active));
        assert_eq!(merged.last_poll_at, Some(1_700_000_002_000));
    }

    #[test]
    fn test_merge_states_no_active_drops_archive_last_poll_at() {
        // Archive states intentionally don't carry their own poll time,
        // so a merge without an active state results in `None`.
        let archive = AntigravityState {
            last_poll_at: Some(1_700_000_000_000),
            sessions: HashMap::new(),
        };
        let merged = merge_states(vec![archive], None);
        assert!(merged.last_poll_at.is_none());
    }

    #[test]
    fn test_compute_project_summary_counts() {
        let mut sessions = HashMap::new();
        sessions.insert(
            "s1".to_string(),
            make_session("s1", 2000, SessionLifecycleStatus::Active),
        );
        sessions.insert(
            "s2".to_string(),
            make_session("s2", 1000, SessionLifecycleStatus::Archived),
        );
        let state = AntigravityState {
            last_poll_at: None,
            sessions,
        };

        let summary = compute_project_summary(&state);
        assert_eq!(summary.session_count, 2);
        assert_eq!(summary.active_sessions, 1);
        assert_eq!(summary.archived_sessions, 1);
        assert_eq!(summary.total_tokens, 3000);
    }

    #[test]
    fn test_compute_project_summary_sorted_by_tokens() {
        let mut sessions = HashMap::new();
        sessions.insert(
            "a".to_string(),
            make_session("a", 100, SessionLifecycleStatus::Active),
        );
        sessions.insert(
            "b".to_string(),
            make_session("b", 9000, SessionLifecycleStatus::Active),
        );
        sessions.insert(
            "c".to_string(),
            make_session("c", 500, SessionLifecycleStatus::Active),
        );
        let state = AntigravityState {
            last_poll_at: None,
            sessions,
        };

        let summary = compute_project_summary(&state);
        // Should be sorted descending by tokens
        assert_eq!(summary.sessions[0].total_tokens, 9000);
        assert_eq!(summary.sessions[2].total_tokens, 100);
    }

    #[test]
    fn test_load_state_file_invalid_json() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("bad.json");
        std::fs::write(&path, "not valid json").unwrap();
        let result = load_state_file(&path);
        assert!(result.is_err());
    }

    #[test]
    fn test_load_state_file_valid() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("monitor-state.json");
        let state = AntigravityState::default();
        let json = serde_json::to_string(&state).unwrap();
        std::fs::write(&path, &json).unwrap();

        let loaded = load_state_file(&path).unwrap();
        assert!(loaded.sessions.is_empty());
    }

    #[test]
    fn test_load_archive_states_filters_correctly() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();

        // Valid archive files
        let state = AntigravityState::default();
        let json = serde_json::to_string(&state).unwrap();
        std::fs::write(root.join("monitor-state.archive-2025-06.json"), &json).unwrap();
        std::fs::write(root.join("monitor-state.archive-2025-07.json"), &json).unwrap();

        // Should NOT be picked up
        std::fs::write(root.join("monitor-state.json"), &json).unwrap();
        std::fs::write(root.join("other-file.json"), &json).unwrap();

        let archives = load_archive_states(root);
        assert_eq!(archives.len(), 2);
    }

    #[test]
    #[serial]
    fn test_load_antigravity_state_impl_missing_dir() {
        let _home = crate::test_utils::SandboxHome::new();
        let state = load_antigravity_state_impl(Path::new("/nonexistent/path/xyz")).unwrap();
        assert!(state.sessions.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn test_load_active_state_rejects_symlink() {
        let dir = TempDir::new().unwrap();
        // Real, valid state file lives outside the root we'll scan from.
        let target = dir.path().join("real-state.json");
        let state = AntigravityState::default();
        std::fs::write(&target, serde_json::to_string(&state).unwrap()).unwrap();

        // Inside the scanned root, monitor-state.json is a symlink to it.
        let root = dir.path().join("scan-root");
        std::fs::create_dir(&root).unwrap();
        std::os::unix::fs::symlink(&target, root.join("monitor-state.json")).unwrap();

        // Defense-in-depth: refuse to follow the symlink even though
        // the link target is valid JSON.
        assert!(load_active_state(&root).is_none());
    }

    #[cfg(unix)]
    #[test]
    fn test_load_archive_states_rejects_symlinked_archive() {
        let dir = TempDir::new().unwrap();
        let target = dir.path().join("real-archive.json");
        let state = AntigravityState::default();
        std::fs::write(&target, serde_json::to_string(&state).unwrap()).unwrap();

        let root = dir.path().join("scan-root");
        std::fs::create_dir(&root).unwrap();
        std::os::unix::fs::symlink(&target, root.join("monitor-state.archive-2025-06.json"))
            .unwrap();
        // A real archive file alongside the symlink should still be picked up.
        std::fs::write(
            root.join("monitor-state.archive-2025-07.json"),
            serde_json::to_string(&state).unwrap(),
        )
        .unwrap();

        let archives = load_archive_states(&root);
        assert_eq!(archives.len(), 1);
    }

    #[test]
    #[serial]
    fn test_antigravity_root_from_path_returns_none_when_marker_absent() {
        let _home = crate::test_utils::SandboxHome::new();
        // A temp directory that has none of the antigravity layout
        // (no `.token-monitor/rpc-cache/v1`) and is outside the default
        // root must NOT resolve to anything — the function used to fall
        // back to `default_root` here, silently making the supplied
        // path look legitimate.
        let dir = TempDir::new().unwrap();
        let unrelated_dir = dir.path().join("not-antigravity");
        std::fs::create_dir(&unrelated_dir).unwrap();

        let resolved = antigravity_root_from_path(&unrelated_dir.to_string_lossy());
        assert!(
            resolved.is_none(),
            "expected None for marker-absent path, got {resolved:?}",
        );
    }

    #[test]
    #[serial]
    fn test_antigravity_root_from_path_finds_marker_in_parent() {
        let _home = crate::test_utils::SandboxHome::new();
        // Sanity check that the happy path (the supplied path lives
        // under a directory that has the `.token-monitor/rpc-cache/v1`
        // marker) still resolves to that root.
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("project");
        std::fs::create_dir_all(root.join(".token-monitor").join("rpc-cache").join("v1")).unwrap();
        let nested = root.join("brain").join("sess-x");
        std::fs::create_dir_all(&nested).unwrap();

        let resolved = antigravity_root_from_path(&nested.to_string_lossy()).unwrap();
        assert_eq!(resolved, root);
    }

    #[test]
    fn test_build_state_includes_filesystem_only_brain_session() {
        // Regression: a brain/ candidate that has token-bearing files
        // but no rpc-cache directory was previously dropped on the
        // floor. It should be synthesized from the filesystem source.
        let dir = TempDir::new().unwrap();
        let root = dir.path();

        std::fs::create_dir_all(root.join(".token-monitor").join("rpc-cache").join("v1")).unwrap();
        let session_dir = root.join("brain").join("sess-fs");
        std::fs::create_dir_all(&session_dir).unwrap();
        // Drop a minimal text-bearing file so the candidate is admitted.
        std::fs::write(session_dir.join("task.md"), "# Test session\n").unwrap();

        let state = build_state_from_token_monitor_sources(root, &ScanReport::default()).unwrap();
        assert!(state.sessions.contains_key("sess-fs"));
        let session = state.sessions.get("sess-fs").unwrap();
        assert_eq!(session.latest.source, "filesystem");
        // file_path must point at the on-disk brain/ directory, not
        // the (non-existent) rpc-cache sibling. UI "Reveal in Finder"
        // and similar actions depend on this being a real path.
        assert_eq!(
            session.latest.file_path,
            session_dir.to_string_lossy().to_string()
        );
    }

    #[test]
    fn test_scan_brain_candidates_rejects_invalid_session_id() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();

        let brain_dir = root.join("brain");
        std::fs::create_dir_all(&brain_dir).unwrap();
        // Names outside the [A-Za-z0-9_-]+ allowlist must be ignored
        // even when they hold token-bearing files. Stick to characters
        // that are legal on every supported filesystem (Windows
        // disallows `:`, `/`, etc.) so the test runs cross-platform.
        for bad in ["..weird", "has space", "has.dot", "has+plus"] {
            let s = brain_dir.join(bad);
            std::fs::create_dir_all(&s).unwrap();
            std::fs::write(s.join("task.md"), "# bad\n").unwrap();
        }
        // Sanity: a well-formed name in the same directory is still picked up.
        let good = brain_dir.join("good-session-1");
        std::fs::create_dir_all(&good).unwrap();
        std::fs::write(good.join("task.md"), "# good\n").unwrap();

        let candidates = scan_brain_candidates(root, &ScanReport::default()).unwrap();
        let ids: Vec<&str> = candidates.iter().map(|c| c.session_id.as_str()).collect();
        assert_eq!(ids, vec!["good-session-1"]);
    }

    #[test]
    fn test_load_antigravity_state_impl_falls_back_to_rpc_cache() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        let rpc_dir = root
            .join(".token-monitor")
            .join("rpc-cache")
            .join("v1")
            .join("sess-rpc");
        std::fs::create_dir_all(&rpc_dir).unwrap();
        std::fs::create_dir_all(root.join("brain").join("sess-rpc")).unwrap();

        let usage = r#"{"recordType":"usage","sessionId":"sess-rpc","sequence":0,"model":"gemini-3-pro-high","inputTokens":100,"outputTokens":50,"cacheReadTokens":25,"cacheWriteTokens":10,"reasoningTokens":5,"totalTokens":190,"raw":{"chatModel":{"chatStartMetadata":{"createdAt":"2026-04-12T00:00:00Z"}}}}"#;
        std::fs::write(rpc_dir.join("usage.jsonl"), format!("{usage}\n")).unwrap();

        let state = load_antigravity_state_impl(root).unwrap();
        let session = state.sessions.get("sess-rpc").unwrap();
        assert_eq!(state.sessions.len(), 1);
        assert_eq!(session.latest.total_tokens, 190);
        assert_eq!(session.latest.input_tokens, 100);
        assert_eq!(session.latest.cache_write_tokens, 10);
        assert_eq!(session.latest.reasoning_tokens, 5);
        assert_eq!(
            session.latest.file_path,
            rpc_dir.to_string_lossy().to_string()
        );
    }

    #[tokio::test]
    #[serial]
    async fn test_get_antigravity_project_summary_uses_explicit_root_path() {
        let _home = crate::test_utils::SandboxHome::new();
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        let rpc_dir = root
            .join(".token-monitor")
            .join("rpc-cache")
            .join("v1")
            .join("sess-explicit-root");
        std::fs::create_dir_all(&rpc_dir).unwrap();
        std::fs::create_dir_all(root.join("brain").join("sess-explicit-root")).unwrap();

        let usage = r#"{"recordType":"usage","sessionId":"sess-explicit-root","sequence":0,"model":"gemini-3-pro-high","inputTokens":120,"outputTokens":80,"cacheReadTokens":40,"cacheWriteTokens":20,"reasoningTokens":10,"totalTokens":270,"raw":{"chatModel":{"chatStartMetadata":{"createdAt":"2026-04-12T00:00:00Z"}}}}"#;
        std::fs::write(rpc_dir.join("usage.jsonl"), format!("{usage}\n")).unwrap();

        let summary = get_antigravity_project_summary(Some(root.to_string_lossy().to_string()))
            .await
            .unwrap();

        assert_eq!(summary.session_count, 1);
        assert_eq!(summary.total_tokens, 270);
        assert_eq!(summary.sessions[0].session_id, "sess-explicit-root");
    }
}
