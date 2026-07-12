//! Pi coding agent (badlogic's `pi`, <https://pi.dev>).
//!
//! Pi auto-saves the full transcript as per-session JSONL under
//! `~/.pi/agent/sessions/<escaped-cwd>/<timestamp>_<uuid>.jsonl`, where
//! `<escaped-cwd>` is the working directory with path separators replaced by
//! `-` and wrapped in a leading/trailing `--` (e.g. `/Users/ac/dev/herdr` ->
//! `--Users-ac-dev-herdr--`). We never decode that escaped name to recover the
//! real path: every session file's header record carries the exact `cwd`.
//!
//! Each session file is one JSON object per line, all sharing `id`/`parentId`/
//! `timestamp` except the header:
//! ```json
//! {"type":"session","version":3,"id":"<uuid>","timestamp":"…","cwd":"/abs/path"}
//! {"type":"model_change","id":"…","parentId":"…","timestamp":"…","provider":"anthropic","modelId":"claude-opus-4-8"}
//! {"type":"thinking_level_change","id":"…","parentId":"…","timestamp":"…","thinkingLevel":"high"}
//! {"type":"message","id":"…","parentId":"…","timestamp":"…","message":{…}}
//! ```
//! `model_change`/`thinking_level_change` records are metadata, not messages,
//! and are excluded from message counts. A `message` record's nested
//! `message.role` is `"user"`, `"assistant"`, or `"toolResult"` (a distinct
//! record for tool output, not a content item on the calling message).
//! `message.content` items are `{"type":"text","text":…}`,
//! `{"type":"thinking","thinking":…,"thinkingSignature":…}`, or
//! `{"type":"toolCall","id":…,"name":…,"arguments":{…}}`; unknown item types
//! are skipped rather than erroring. Assistant records additionally carry
//! `model`, `stopReason`, an optional `errorMessage`, and
//! `usage:{input,output,cacheRead,cacheWrite,totalTokens,cost}`.
//!
//! Since the store already partitions sessions by cwd (one directory per
//! working directory), each session subdirectory maps directly to one
//! `ClaudeProject` — mirroring how `claude.rs`/`aider.rs` treat a store
//! subdirectory as the project unit, rather than qwen's cross-store
//! cwd-grouping (Pi doesn't need that: the physical layout already groups by
//! cwd, we just never trust the *directory name* for the real path).
//!
//! The same on-disk format is written by oh-my-pi (`omp`, a `pi` fork) under
//! `~/.omp/agent/sessions`; `ompi.rs` reuses this module's store-parameterized
//! core for that root.

use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession, TokenUsage};
use crate::providers::ProviderInfo;
use crate::utils::{
    build_provider_message, is_symlink, ms_to_iso, search_json_value_case_insensitive,
};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const SUMMARY_MAX_CHARS: usize = 80;

/// A Pi-format session store: the `pi` original and any fork that keeps the
/// format but relocates the dot-directory (oh-my-pi's `~/.omp`).
pub(crate) struct PiStore {
    /// Provider id as registered in `ProviderId` (`"pi"` / `"ompi"`).
    pub id: &'static str,
    pub display_name: &'static str,
    /// Home-relative dot directory holding `agent/sessions` (`".pi"` / `".omp"`).
    pub dot_dir: &'static str,
}

pub(crate) const PI_STORE: PiStore = PiStore {
    id: "pi",
    display_name: "Pi",
    dot_dir: ".pi",
};

impl PiStore {
    /// Store root: `~/<dot_dir>/agent/sessions`.
    fn sessions_root(&self) -> Option<PathBuf> {
        Some(
            dirs::home_dir()?
                .join(self.dot_dir)
                .join("agent")
                .join("sessions"),
        )
    }
}

/// Detect a Pi installation.
pub fn detect() -> Option<ProviderInfo> {
    detect_store(&PI_STORE)
}

/// Base path (`~/.pi/agent/sessions`), for the file watcher.
pub fn get_base_path() -> Option<String> {
    base_path_of(&PI_STORE)
}

/// Scan Pi projects at the default store root (`~/.pi/agent/sessions`).
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    Ok(scan_store(&PI_STORE))
}

/// Load the sessions in one Pi project directory.
pub fn load_sessions(
    project_path: &str,
    exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    load_sessions_of(&PI_STORE, project_path, exclude_sidechain)
}

/// Load all messages from one Pi session file.
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    load_messages_of(&PI_STORE, session_path)
}

/// Search across all Pi sessions.
pub fn search(query: &str, max_results: usize) -> Result<Vec<ClaudeMessage>, String> {
    Ok(search_store(&PI_STORE, query, max_results))
}

// ============================================================================
// Store-parameterized core (shared with `ompi.rs`)
// ============================================================================

pub(crate) fn detect_store(store: &PiStore) -> Option<ProviderInfo> {
    let root = store.sessions_root()?;
    Some(ProviderInfo {
        id: store.id.to_string(),
        display_name: store.display_name.to_string(),
        is_available: root.is_dir() && !project_dirs(&root).is_empty(),
        base_path: root.to_string_lossy().to_string(),
    })
}

pub(crate) fn base_path_of(store: &PiStore) -> Option<String> {
    let root = store.sessions_root()?;
    if root.is_dir() {
        Some(root.to_string_lossy().to_string())
    } else {
        None
    }
}

pub(crate) fn scan_store(store: &PiStore) -> Vec<ClaudeProject> {
    let Some(root) = store.sessions_root() else {
        return vec![];
    };
    scan_projects_in(&root, store.id)
}

pub(crate) fn load_sessions_of(
    store: &PiStore,
    project_path: &str,
    _exclude_sidechain: bool, // Pi has no sidechains
) -> Result<Vec<ClaudeSession>, String> {
    let dir = Path::new(project_path);
    if !dir.is_dir() {
        return Ok(vec![]);
    }
    validate_under_root(store, dir)?;

    let mut sessions = Vec::new();
    for file in session_files(dir) {
        let Ok(data) = fs::read_to_string(&file) else {
            continue;
        };
        let Some(meta) = session_meta(&data) else {
            continue;
        };
        let mtime = file_mtime_rfc3339(&file);
        let first = meta.first_ts.clone().unwrap_or_else(|| mtime.clone());
        let last = meta.last_ts.clone().unwrap_or(mtime);
        let project_name = meta
            .cwd
            .as_deref()
            .and_then(|c| Path::new(c).file_name())
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        sessions.push(ClaudeSession {
            session_id: file.to_string_lossy().to_string(),
            actual_session_id: meta.id,
            file_path: file.to_string_lossy().to_string(),
            project_name,
            message_count: meta.message_count,
            first_message_time: first,
            last_message_time: last.clone(),
            last_modified: last,
            has_tool_use: meta.has_tool_use,
            has_errors: meta.has_errors,
            summary: meta.summary,
            is_renamed: false,
            provider: Some(store.id.to_string()),
            storage_type: None,
            entrypoint: None,
        });
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

pub(crate) fn load_messages_of(
    store: &PiStore,
    session_path: &str,
) -> Result<Vec<ClaudeMessage>, String> {
    let path = Path::new(session_path);
    if !path.exists() {
        return Err(format!("Session file not found: {session_path}"));
    }
    validate_under_root(store, path)?;
    let data = fs::read_to_string(path).map_err(|e| format!("Failed to read session file: {e}"))?;
    Ok(parse_messages(&data, store.id))
}

pub(crate) fn search_store(store: &PiStore, query: &str, max_results: usize) -> Vec<ClaudeMessage> {
    let Some(root) = store.sessions_root() else {
        return vec![];
    };
    if !root.is_dir() {
        return vec![];
    }
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for dir in project_dirs(&root) {
        for file in session_files(&dir) {
            let Ok(data) = fs::read_to_string(&file) else {
                continue;
            };
            let project_name = session_meta(&data)
                .and_then(|m| m.cwd)
                .as_deref()
                .map(|c| {
                    Path::new(c)
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| c.to_string())
                })
                .unwrap_or_default();
            for mut msg in parse_messages(&data, store.id) {
                if results.len() >= max_results {
                    return results;
                }
                let matched = msg
                    .content
                    .as_ref()
                    .map(|c| search_json_value_case_insensitive(c, &query_lower))
                    .unwrap_or(false);
                if matched {
                    msg.project_name = Some(project_name.clone());
                    results.push(msg);
                }
            }
        }
    }
    results
}

/// Immediate subdirectories of the sessions root (each one project).
fn project_dirs(root: &Path) -> Vec<PathBuf> {
    WalkDir::new(root)
        .min_depth(1)
        .max_depth(1)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| !e.path_is_symlink() && e.file_type().is_dir())
        .map(|e| e.path().to_path_buf())
        .collect()
}

/// `.jsonl` session files directly inside a project directory.
fn session_files(dir: &Path) -> Vec<PathBuf> {
    WalkDir::new(dir)
        .min_depth(1)
        .max_depth(1)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
        .filter(|e| !is_symlink(e.path()))
        .map(|e| e.path().to_path_buf())
        .collect()
}

/// [`scan_store`] parameterized by the sessions root, so tests can point it at
/// a fixture store (mirrors `continue_dev::scan_projects_in`). One project per
/// session subdirectory, real path from the header `cwd` of its session files
/// (never the escaped directory name).
pub(crate) fn scan_projects_in(root: &Path, provider: &'static str) -> Vec<ClaudeProject> {
    if !root.is_dir() {
        return vec![];
    }

    let mut projects = Vec::new();
    for dir in project_dirs(root) {
        let mut session_count = 0usize;
        let mut message_count = 0usize;
        let mut last_modified = String::new();
        let mut actual_path: Option<String> = None;

        for file in session_files(&dir) {
            let Ok(data) = fs::read_to_string(&file) else {
                continue;
            };
            let Some(meta) = session_meta(&data) else {
                continue;
            };
            session_count += 1;
            message_count += meta.message_count;
            if actual_path.is_none() {
                actual_path.clone_from(&meta.cwd);
            }
            let mtime = file_mtime_rfc3339(&file);
            let last = meta.last_ts.unwrap_or(mtime);
            if last > last_modified {
                last_modified = last;
            }
        }

        if session_count == 0 {
            continue;
        }
        let actual_path = actual_path.unwrap_or_else(|| "unknown".to_string());
        let name = Path::new(&actual_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| actual_path.clone());

        projects.push(ClaudeProject {
            name,
            path: dir.to_string_lossy().to_string(),
            actual_path,
            session_count,
            message_count,
            last_modified,
            git_info: None,
            provider: Some(provider.to_string()),
            storage_type: None,
            custom_directory_label: None,
        });
    }

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    projects
}

// ============================================================================
// Pure parsing (unit-testable)
// ============================================================================

struct SessionMeta {
    id: String,
    cwd: Option<String>,
    message_count: usize,
    summary: Option<String>,
    first_ts: Option<String>,
    last_ts: Option<String>,
    has_tool_use: bool,
    has_errors: bool,
}

/// Lightweight per-session metadata from a session JSONL (one parse).
fn session_meta(data: &str) -> Option<SessionMeta> {
    let mut id = String::new();
    let mut cwd = None;
    let mut message_count = 0usize;
    let mut summary = None;
    let mut first_ts = None;
    let mut last_ts = None;
    let mut has_tool_use = false;
    let mut has_errors = false;
    let mut seen_header = false;

    for line in data.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(rec) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let rec_type = rec.get("type").and_then(Value::as_str).unwrap_or("");

        if rec_type == "session" {
            seen_header = true;
            id = rec
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            cwd = rec.get("cwd").and_then(Value::as_str).map(str::to_string);
            continue;
        }
        if rec_type != "message" {
            // model_change / thinking_level_change / unknown: metadata, not a message.
            continue;
        }

        message_count += 1;
        let Some(msg) = rec.get("message") else {
            continue;
        };
        // Match `convert_record`'s precedence: the authoritative per-message
        // time is the epoch-millis `message.timestamp`; fall back to the
        // envelope record's ISO `timestamp` only when it's absent. Keeps
        // session sort order (first/last message time) consistent with the
        // timestamps shown on individual messages.
        let ts = msg
            .get("timestamp")
            .and_then(Value::as_u64)
            .map(ms_to_iso)
            .or_else(|| {
                rec.get("timestamp")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            });
        if let Some(ts) = ts {
            if first_ts.is_none() {
                first_ts = Some(ts.clone());
            }
            last_ts = Some(ts);
        }
        let role = msg.get("role").and_then(Value::as_str).unwrap_or("");
        if role == "user" && summary.is_none() {
            summary = first_text(msg).map(|t| summarize(&t));
        }
        if role == "assistant" {
            let stop_reason = msg.get("stopReason").and_then(Value::as_str);
            if stop_reason == Some("error") || msg.get("errorMessage").is_some() {
                has_errors = true;
            }
            if msg
                .get("content")
                .and_then(Value::as_array)
                .is_some_and(|items| {
                    items
                        .iter()
                        .any(|i| i.get("type").and_then(Value::as_str) == Some("toolCall"))
                })
            {
                has_tool_use = true;
            }
        }
    }

    if !seen_header && message_count == 0 {
        return None;
    }
    Some(SessionMeta {
        id,
        cwd,
        message_count,
        summary,
        first_ts,
        last_ts,
        has_tool_use,
        has_errors,
    })
}

/// Parse a session JSONL into normalized messages (one per `type:"message"`
/// record; header/`model_change`/`thinking_level_change` records are skipped).
fn parse_messages(data: &str, provider: &'static str) -> Vec<ClaudeMessage> {
    let mut session_id = String::new();
    let mut messages = Vec::new();

    for line in data.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(rec) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let rec_type = rec.get("type").and_then(Value::as_str).unwrap_or("");

        if rec_type == "session" {
            session_id = rec
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            continue;
        }
        if rec_type != "message" {
            continue;
        }
        if let Some(msg) = convert_record(&rec, &session_id, provider) {
            messages.push(msg);
        }
    }
    messages
}

fn convert_record(rec: &Value, session_id: &str, provider: &'static str) -> Option<ClaudeMessage> {
    let msg = rec.get("message")?;
    let id = rec
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let parent_id = rec
        .get("parentId")
        .and_then(Value::as_str)
        .map(str::to_string);
    // The authoritative per-message time is the epoch-millis `message.timestamp`;
    // fall back to the envelope record's ISO `timestamp` when it's absent.
    let timestamp = msg
        .get("timestamp")
        .and_then(Value::as_u64)
        .map(ms_to_iso)
        .unwrap_or_else(|| {
            rec.get("timestamp")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        });
    let role = msg.get("role").and_then(Value::as_str).unwrap_or("user");

    let (message_type, out_role, blocks) = match role {
        "assistant" => ("assistant", "assistant", assistant_blocks(msg)),
        "toolResult" => ("user", "user", tool_result_blocks(msg)),
        _ => ("user", "user", content_blocks(msg)),
    };
    let model = if role == "assistant" {
        msg.get("model").and_then(Value::as_str).map(str::to_string)
    } else {
        None
    };

    let mut out = build_provider_message(
        provider,
        id,
        session_id,
        timestamp,
        message_type,
        Some(out_role),
        Some(Value::Array(blocks)),
        model,
    );
    out.parent_uuid = parent_id;
    if role == "assistant" {
        out.stop_reason = msg
            .get("stopReason")
            .and_then(Value::as_str)
            .map(str::to_string);
        if let Some(usage) = msg.get("usage") {
            out.usage = Some(convert_usage(usage));
        }
    }
    Some(out)
}

/// Map `message.content` items to Claude-style content blocks, skipping any
/// item type we don't recognize instead of erroring.
fn content_blocks(msg: &Value) -> Vec<Value> {
    msg.get("content")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(convert_content_item).collect())
        .unwrap_or_default()
}

/// Assistant content blocks, plus a synthetic error block when the turn
/// carries `errorMessage` (so a failed turn still surfaces its cause).
fn assistant_blocks(msg: &Value) -> Vec<Value> {
    let mut blocks = content_blocks(msg);
    if let Some(err) = msg.get("errorMessage").and_then(Value::as_str) {
        blocks.push(json!({ "type": "text", "text": err, "is_error": true }));
    }
    blocks
}

/// A `toolResult`-role message is Pi's own record for tool output (not a
/// content item on the calling assistant message); surface it in the user
/// lane as a `tool_result` block, like the other providers do.
fn tool_result_blocks(msg: &Value) -> Vec<Value> {
    let tool_use_id = msg
        .get("toolCallId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let is_error = msg.get("isError").and_then(Value::as_bool).unwrap_or(false);
    let content = msg
        .get("content")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|i| i.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    vec![json!({
        "type": "tool_result",
        "tool_use_id": tool_use_id,
        "content": content,
        "is_error": is_error
    })]
}

fn convert_content_item(item: &Value) -> Option<Value> {
    match item.get("type").and_then(Value::as_str) {
        Some("text") => item
            .get("text")
            .and_then(Value::as_str)
            .map(|t| json!({ "type": "text", "text": t })),
        Some("thinking") => {
            let thinking = item.get("thinking").and_then(Value::as_str).unwrap_or("");
            let signature = item
                .get("thinkingSignature")
                .and_then(Value::as_str)
                .unwrap_or("");
            Some(json!({ "type": "thinking", "thinking": thinking, "signature": signature }))
        }
        Some("toolCall") => {
            let id = item.get("id").and_then(Value::as_str).unwrap_or("");
            let name = item
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let input = item.get("arguments").cloned().unwrap_or_else(|| json!({}));
            Some(json!({ "type": "tool_use", "id": id, "name": name, "input": input }))
        }
        // Unrecognized item type: skip gracefully rather than erroring.
        _ => None,
    }
}

fn convert_usage(usage: &Value) -> TokenUsage {
    let g = |k: &str| {
        usage
            .get(k)
            .and_then(Value::as_u64)
            .map(|n| u32::try_from(n).unwrap_or(u32::MAX))
    };
    TokenUsage {
        input_tokens: g("input"),
        output_tokens: g("output"),
        cache_creation_input_tokens: g("cacheWrite"),
        cache_read_input_tokens: g("cacheRead"),
        service_tier: None,
    }
}

/// First user text item (for the session summary).
fn first_text(msg: &Value) -> Option<String> {
    let items = msg.get("content").and_then(Value::as_array)?;
    items.iter().find_map(|item| {
        if item.get("type").and_then(Value::as_str) != Some("text") {
            return None;
        }
        item.get("text")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    })
}

fn summarize(text: &str) -> String {
    let cleaned = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.chars().count() > SUMMARY_MAX_CHARS {
        format!(
            "{}…",
            cleaned.chars().take(SUMMARY_MAX_CHARS).collect::<String>()
        )
    } else {
        cleaned
    }
}

/// Validate that a caller-supplied path (a project directory for
/// `load_sessions`, a session file for `load_messages`) is a real,
/// non-symlinked path canonicalizing to somewhere under the store's resolved
/// sessions root. Without this, `provider:"pi"` could be used to enumerate or
/// parse arbitrary directories/files on disk just by passing a path outside
/// `~/.pi/agent/sessions`.
fn validate_under_root(store: &PiStore, path: &Path) -> Result<(), String> {
    if is_symlink(path) {
        return Err("Path must not be a symlink".to_string());
    }
    let root = store
        .sessions_root()
        .ok_or_else(|| format!("{} sessions path not found", store.display_name))?;
    let canon_root = root.canonicalize().map_err(|e| {
        format!(
            "Failed to resolve {} sessions root: {e}",
            store.display_name
        )
    })?;
    let canon_path = path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve path: {e}"))?;
    if canon_path.starts_with(&canon_root) {
        Ok(())
    } else {
        Err(format!(
            "Path is outside the {} sessions root: {}",
            store.display_name,
            path.display()
        ))
    }
}

fn file_mtime_rfc3339(path: &Path) -> String {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
        .map(|d| {
            DateTime::from_timestamp(i64::try_from(d.as_secs()).unwrap_or(0), 0)
                .unwrap_or_else(Utc::now)
                .to_rfc3339()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    const SESSION: &str = concat!(
        r#"{"type":"session","version":3,"id":"sess-1","timestamp":"2026-06-08T20:31:45.261Z","cwd":"/Users/ac/dev/herdr"}"#,
        "\n",
        r#"{"type":"model_change","id":"m1","parentId":"sess-1","timestamp":"2026-06-08T20:31:46.000Z","provider":"anthropic","modelId":"claude-opus-4-8"}"#,
        "\n",
        r#"{"type":"thinking_level_change","id":"t1","parentId":"m1","timestamp":"2026-06-08T20:31:46.500Z","thinkingLevel":"high"}"#,
        "\n",
        r#"{"type":"message","id":"u1","parentId":"t1","timestamp":"2026-06-08T20:31:50.000Z","message":{"role":"user","content":[{"type":"text","text":"why does LOGIN fail?"}],"timestamp":1749412310000}}"#,
        "\n",
        r#"{"type":"message","id":"a1","parentId":"u1","timestamp":"2026-06-08T20:32:10.000Z","message":{"role":"assistant","api":"anthropic-messages","provider":"anthropic","model":"claude-opus-4-8","stopReason":"tool_use","content":[{"type":"thinking","thinking":"let me check","thinkingSignature":"sig-1"},{"type":"toolCall","id":"call_1","name":"bash","arguments":{"command":"grep -r login"}}],"usage":{"input":12,"output":34,"cacheRead":5,"cacheWrite":0,"totalTokens":51,"cost":{"total":0.001}},"timestamp":1749412330000}}"#,
        "\n",
        r#"{"type":"message","id":"tr1","parentId":"a1","timestamp":"2026-06-08T20:32:11.000Z","message":{"role":"toolResult","toolCallId":"call_1","toolName":"bash","content":[{"type":"text","text":"login.rs:42"}],"isError":false,"timestamp":1749412331000}}"#,
        "\n",
    );

    #[test]
    fn session_meta_extracts_cwd_count_summary() {
        let m = session_meta(SESSION).unwrap();
        assert_eq!(m.id, "sess-1");
        assert_eq!(m.cwd.as_deref(), Some("/Users/ac/dev/herdr"));
        // user + assistant + toolResult (header/model_change/thinking_level_change excluded) = 3
        assert_eq!(m.message_count, 3);
        assert_eq!(m.summary.as_deref(), Some("why does LOGIN fail?"));
        assert!(m.has_tool_use);
        assert!(!m.has_errors);
        // first/last session times follow `convert_record`'s precedence: the
        // nested `message.timestamp` epoch millis (2025 here), NOT the envelope
        // ISO `timestamp` (2026 in this fixture) — so session sort order stays
        // consistent with the timestamps shown on individual messages.
        assert_eq!(
            m.first_ts.as_deref(),
            Some(ms_to_iso(1_749_412_310_000).as_str())
        );
        assert_eq!(
            m.last_ts.as_deref(),
            Some(ms_to_iso(1_749_412_331_000).as_str())
        );
    }

    #[test]
    fn parse_messages_maps_records_to_normalized_messages() {
        let msgs = parse_messages(SESSION, "pi");
        // header/model_change/thinking_level_change are skipped.
        assert_eq!(msgs.len(), 3);

        assert_eq!(msgs[0].role.as_deref(), Some("user"));
        assert_eq!(msgs[0].uuid, "u1");
        // Timestamp comes from the nested `message.timestamp` epoch millis
        // (1749412310000), not the envelope record's ISO `timestamp`.
        assert_eq!(msgs[0].timestamp, ms_to_iso(1_749_412_310_000));

        let a = &msgs[1];
        assert_eq!(a.role.as_deref(), Some("assistant"));
        assert_eq!(a.parent_uuid.as_deref(), Some("u1"));
        assert_eq!(a.model.as_deref(), Some("claude-opus-4-8"));
        assert_eq!(a.timestamp, ms_to_iso(1_749_412_330_000));
        assert_eq!(a.usage.as_ref().unwrap().input_tokens, Some(12));
        assert_eq!(a.usage.as_ref().unwrap().output_tokens, Some(34));
        assert_eq!(a.usage.as_ref().unwrap().cache_read_input_tokens, Some(5));
        assert_eq!(
            a.usage.as_ref().unwrap().cache_creation_input_tokens,
            Some(0)
        );
        let ab = a.content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(ab[0]["type"], "thinking");
        assert_eq!(ab[0]["thinking"], "let me check");
        assert_eq!(ab[1]["type"], "tool_use");
        assert_eq!(ab[1]["name"], "bash");
        assert_eq!(ab[1]["id"], "call_1");

        // toolResult -> user lane, tool_result block with extracted text
        assert_eq!(msgs[2].role.as_deref(), Some("user"));
        let tr = msgs[2].content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(tr[0]["type"], "tool_result");
        assert_eq!(tr[0]["tool_use_id"], "call_1");
        assert_eq!(tr[0]["content"], "login.rs:42");
        assert_eq!(tr[0]["is_error"], false);
    }

    #[test]
    fn convert_content_item_kinds() {
        assert!(convert_content_item(&json!({"type": "unknownKind"})).is_none());
        assert_eq!(
            convert_content_item(&json!({"type": "text", "text": "hi"})).unwrap()["type"],
            "text"
        );
        assert_eq!(
            convert_content_item(
                &json!({"type": "thinking", "thinking": "r", "thinkingSignature": "s"})
            )
            .unwrap()["signature"],
            "s"
        );
    }

    #[test]
    fn assistant_blocks_appends_error_indication() {
        let msg = json!({
            "role": "assistant",
            "stopReason": "error",
            "errorMessage": "boom",
            "content": []
        });
        let blocks = assistant_blocks(&msg);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0]["text"], "boom");
        assert_eq!(blocks[0]["is_error"], true);
    }

    /// `scan_projects_in` must work against an arbitrary fixture root, not
    /// just the default `~/.pi/agent/sessions` — the real project path comes
    /// from the header `cwd`, never the escaped directory name.
    #[test]
    fn scan_projects_in_reads_arbitrary_fixture_root() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path().join("not-home").join("sessions");
        let dir = root.join("--Users-ac-dev-fixture--");
        fs::create_dir_all(&dir).expect("create fixture dir");
        fs::write(dir.join("2026-06-08T20-31-45-261Z_session.jsonl"), SESSION)
            .expect("write fixture session");

        let projects = scan_projects_in(&root, "pi");
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].actual_path, "/Users/ac/dev/herdr");
        assert_eq!(projects[0].provider.as_deref(), Some("pi"));
    }

    /// Saves/restores `HOME` around a test so `sessions_root()` resolves to a
    /// fixture store under a fresh `TempDir` rather than the real user home.
    /// `HOME` is process-global; combined with `#[serial]` so these tests
    /// don't race each other.
    struct HomeGuard {
        original: Option<String>,
    }
    impl HomeGuard {
        fn set(path: &Path) -> Self {
            let original = std::env::var("HOME").ok();
            std::env::set_var("HOME", path);
            Self { original }
        }
    }
    impl Drop for HomeGuard {
        fn drop(&mut self) {
            match self.original.as_ref() {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
        }
    }

    /// `load_messages` must work against a literal session path under the
    /// fixture store that `$HOME` is pointed at, proving the store resolution
    /// works without requiring the real `~/.pi/agent/sessions`.
    #[test]
    #[serial]
    fn load_messages_succeeds_for_fixture_path_under_home_override() {
        let home = tempfile::tempdir().expect("tempdir");
        let _guard = HomeGuard::set(home.path());
        let dir = home
            .path()
            .join(".pi")
            .join("agent")
            .join("sessions")
            .join("--Users-ac-dev-fixture--");
        fs::create_dir_all(&dir).expect("create fixture dir");
        let file = dir.join("2026-06-08T20-31-45-261Z_session.jsonl");
        fs::write(&file, SESSION).expect("write fixture session");

        let messages =
            load_messages(&file.to_string_lossy()).expect("load_messages must not error");
        assert_eq!(messages.len(), 3);
    }

    /// `load_sessions` likewise must work against a literal fixture directory
    /// path under the `$HOME`-resolved sessions root.
    #[test]
    #[serial]
    fn load_sessions_succeeds_for_fixture_dir_under_home_override() {
        let home = tempfile::tempdir().expect("tempdir");
        let _guard = HomeGuard::set(home.path());
        let dir = home
            .path()
            .join(".pi")
            .join("agent")
            .join("sessions")
            .join("--Users-ac-dev-fixture--");
        fs::create_dir_all(&dir).expect("create fixture dir");
        fs::write(dir.join("2026-06-08T20-31-45-261Z_session.jsonl"), SESSION)
            .expect("write fixture session");

        let sessions =
            load_sessions(&dir.to_string_lossy(), false).expect("load_sessions must not error");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].message_count, 3);
    }

    /// A path outside the `$HOME`-resolved sessions root must be rejected by
    /// both `load_sessions` and `load_messages`, even though it's a
    /// well-formed directory/file otherwise — this is the actual security
    /// property `validate_under_root` provides.
    #[test]
    #[serial]
    fn load_rejects_paths_outside_sessions_root() {
        let home = tempfile::tempdir().expect("tempdir");
        fs::create_dir_all(home.path().join(".pi").join("agent").join("sessions"))
            .expect("create sessions root");
        let _guard = HomeGuard::set(home.path());

        let outside = tempfile::tempdir().expect("outside tempdir");
        let dir = outside.path().join("--Users-ac-dev-fixture--");
        fs::create_dir_all(&dir).expect("create outside dir");
        let file = dir.join("2026-06-08T20-31-45-261Z_session.jsonl");
        fs::write(&file, SESSION).expect("write outside session");

        assert!(
            load_sessions(&dir.to_string_lossy(), false).is_err(),
            "load_sessions must reject a directory outside the sessions root"
        );
        assert!(
            load_messages(&file.to_string_lossy()).is_err(),
            "load_messages must reject a file outside the sessions root"
        );
    }
}
