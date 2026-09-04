//! Pi coding agent (badlogic's `pi`, <https://pi.dev>).
//!
//! Pi auto-saves the full transcript as per-session JSONL under
//! `~/.pi/agent/sessions/<escaped-cwd>/<timestamp>_<uuid>.jsonl`, where
//! `<escaped-cwd>` is the working directory with path separators replaced by
//! `-` and wrapped in a leading/trailing `--` (e.g. `/Users/ac/dev/herdr` ->
//! `--Users-ac-dev-herdr--`). We never decode that escaped name to recover the
//! real path: every session file's header record carries the exact `cwd`.
//!
//! Each session file is one JSON object per line. Non-header entries form a
//! tree through `id`/`parentId`; metadata entries can sit between transcript
//! entries and therefore must remain ancestry bridges even when not rendered:
//! ```json
//! {"type":"session","version":3,"id":"<uuid>","timestamp":"…","cwd":"/abs/path"}
//! {"type":"model_change","id":"…","parentId":null,"timestamp":"…","provider":"anthropic","modelId":"claude-opus-4-8"}
//! {"type":"message","id":"…","parentId":"…","timestamp":"…","message":{…}}
//! {"type":"session_info","id":"…","parentId":"…","timestamp":"…","name":"Display name"}
//! ```
//! Base messages include user, assistant, tool-result, local shell, custom,
//! branch-summary, and compaction-summary roles. User/developer/custom content
//! can be a string or text/image block array. Known content is normalized to
//! the Claude-style frontend contract; unknown blocks are preserved for its
//! generic JSON fallback.
//!
//! Since the store already partitions sessions by cwd (one directory per
//! working directory), each session subdirectory maps directly to one
//! `ClaudeProject` — mirroring how `claude.rs`/`aider.rs` treat a store
//! subdirectory as the project unit, rather than qwen's cross-store
//! cwd-grouping (Pi doesn't need that: the physical layout already groups by
//! cwd, we just never trust the *directory name* for the real path).
//!
//! oh-my-pi (`omp`) keeps the version-3 tree under `~/.omp/agent/sessions` but
//! adds current-title, auxiliary-usage, compaction, and harness record types.
//! `ompi.rs` reuses this format-aware core with the OMP store root.

use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession, TokenUsage};
use crate::providers::ProviderInfo;
use crate::utils::{
    build_provider_message, is_symlink, ms_to_iso, search_json_value_case_insensitive,
};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use std::collections::HashMap;
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
            crate::utils::home_dir()?
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

/// Load messages plus non-transcript model calls for aggregate statistics.
pub fn load_stats_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    load_stats_messages_of(&PI_STORE, session_path)
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
            is_renamed: meta.is_renamed,
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
    load_messages_with_mode(store, session_path, ParseMode::Transcript)
}

pub(crate) fn load_stats_messages_of(
    store: &PiStore,
    session_path: &str,
) -> Result<Vec<ClaudeMessage>, String> {
    load_messages_with_mode(store, session_path, ParseMode::Stats)
}

fn load_messages_with_mode(
    store: &PiStore,
    session_path: &str,
    mode: ParseMode,
) -> Result<Vec<ClaudeMessage>, String> {
    let path = Path::new(session_path);
    if !path.exists() {
        return Err(format!("Session file not found: {session_path}"));
    }
    validate_under_root(store, path)?;
    let data = fs::read_to_string(path).map_err(|e| format!("Failed to read session file: {e}"))?;
    Ok(match mode {
        ParseMode::Transcript => parse_messages(&data, store.id),
        ParseMode::Stats => parse_stats_messages(&data, store.id),
    })
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
    is_renamed: bool,
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
    let mut first_user_summary = None;
    let mut title_slot: Option<(String, bool)> = None;
    let mut title_change: Option<(String, bool)> = None;
    let mut session_name: Option<(String, bool)> = None;
    let mut header_title: Option<(String, bool)> = None;
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

        if rec_type == "title" {
            if let Some(title) = non_empty_string(&rec, "title") {
                let is_renamed = rec.get("source").and_then(Value::as_str) == Some("user");
                title_slot = Some((title, is_renamed));
            }
            continue;
        }

        if rec_type == "session" {
            seen_header = true;
            id = rec
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            cwd = rec.get("cwd").and_then(Value::as_str).map(str::to_string);
            if let Some(title) = non_empty_string(&rec, "title") {
                let is_renamed = rec.get("titleSource").and_then(Value::as_str) == Some("user");
                header_title = Some((title, is_renamed));
            }
            continue;
        }
        if rec_type == "title_change" {
            if let Some(title) = non_empty_string(&rec, "title") {
                let is_renamed = rec.get("source").and_then(Value::as_str) == Some("user");
                title_change = Some((title, is_renamed));
            }
            continue;
        }
        if rec_type == "session_info" {
            if let Some(name) = non_empty_string(&rec, "name") {
                session_name = Some((name, true));
            }
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
        if role == "user" && first_user_summary.is_none() {
            first_user_summary = first_text(msg).map(|t| summarize(&t));
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
    let selected_title = if let Some((title, mut is_renamed)) = title_slot {
        is_renamed |= title_change
            .as_ref()
            .is_some_and(|(changed, changed_by_user)| *changed_by_user && changed == &title);
        Some((title, is_renamed))
    } else {
        title_change.or(session_name).or(header_title)
    };
    let (summary, is_renamed) = selected_title
        .map_or((first_user_summary, false), |(title, renamed)| {
            (Some(title), renamed)
        });
    Some(SessionMeta {
        id,
        cwd,
        message_count,
        summary,
        is_renamed,
        first_ts,
        last_ts,
        has_tool_use,
        has_errors,
    })
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ParseMode {
    Transcript,
    Stats,
}

/// Parse the user-visible transcript. Metadata records are retained as ancestry
/// bridges even when they do not produce a rendered message.
fn parse_messages(data: &str, provider: &'static str) -> Vec<ClaudeMessage> {
    parse_entries(data, provider, ParseMode::Transcript)
}

fn parse_stats_messages(data: &str, provider: &'static str) -> Vec<ClaudeMessage> {
    parse_entries(data, provider, ParseMode::Stats)
}

fn parsed_records(data: &str) -> impl Iterator<Item = Value> + '_ {
    data.lines().filter_map(|line| {
        let line = line.trim();
        if line.is_empty() {
            None
        } else {
            serde_json::from_str(line).ok()
        }
    })
}

fn session_identity(data: &str) -> (String, Option<u64>) {
    for record in parsed_records(data) {
        if record.get("type").and_then(Value::as_str) == Some("session") {
            let id = record
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let version = record.get("version").and_then(Value::as_u64).unwrap_or(1);
            return (id, Some(version));
        }
    }
    (String::new(), None)
}

/// Normalize one legacy Pi record in memory without modifying the source JSONL.
/// Version 1 entries were linear and gained `id`/`parentId` only during Pi's
/// v1→v2 migration; version 2 used the former `hookMessage` role name.
fn normalize_legacy_record(
    record: &mut Value,
    index: usize,
    version: Option<u64>,
    legacy_parent_id: &mut Option<String>,
) {
    let Some(version) = version else {
        return;
    };

    if version < 2
        && !matches!(
            record.get("type").and_then(Value::as_str),
            Some("session" | "title")
        )
    {
        if let Some(object) = record.as_object_mut() {
            let id = format!("legacy-{index:08x}");
            object.insert("id".to_string(), Value::String(id.clone()));
            object.insert(
                "parentId".to_string(),
                legacy_parent_id.clone().map_or(Value::Null, Value::String),
            );
            *legacy_parent_id = Some(id);
        }
    }

    if version < 3 && record.get("type").and_then(Value::as_str) == Some("message") {
        let Some(message) = record.get_mut("message").and_then(Value::as_object_mut) else {
            return;
        };
        if message.get("role").and_then(Value::as_str) == Some("hookMessage") {
            message.insert("role".to_string(), Value::String("custom".to_string()));
        }
    }
}

fn parse_entries(data: &str, provider: &'static str, mode: ParseMode) -> Vec<ClaudeMessage> {
    let (session_id, version) = session_identity(data);
    let mut legacy_parent_id = None;
    let mut nearest_visible_by_id: HashMap<String, Option<String>> = HashMap::new();
    let mut messages = Vec::new();

    // Session entries are append-only, so every valid parent has already been
    // seen. Retain only its nearest visible ancestor instead of every JSON DOM.
    for (index, mut record) in parsed_records(data).enumerate() {
        normalize_legacy_record(&mut record, index, version, &mut legacy_parent_id);

        let current_id = record_id(&record);
        let raw_parent_id = record_parent(&record);
        let visible_parent_id = raw_parent_id.as_ref().and_then(|parent_id| {
            if current_id.as_deref() == Some(parent_id) {
                None
            } else {
                nearest_visible_by_id.get(parent_id).cloned().flatten()
            }
        });
        let converted = match mode {
            ParseMode::Transcript => convert_transcript_entry(&record, &session_id, provider),
            ParseMode::Stats => convert_stats_entry(&record, &session_id, provider),
        };

        if let Some(mut message) = converted {
            message.parent_uuid = visible_parent_id;
            let visible_id = message.uuid.clone();
            nearest_visible_by_id.insert(visible_id.clone(), Some(visible_id));
            messages.push(message);
        } else if let Some(id) = current_id {
            nearest_visible_by_id.insert(id, visible_parent_id);
        }
    }
    messages
}

fn convert_transcript_entry(
    record: &Value,
    session_id: &str,
    provider: &'static str,
) -> Option<ClaudeMessage> {
    match record.get("type").and_then(Value::as_str) {
        Some("message") => convert_message_record(record, session_id, provider),
        Some("compaction") => convert_compaction_entry(record, session_id, provider),
        Some("branch_summary") => convert_branch_summary_entry(record, session_id, provider),
        Some("custom_message") if record.get("display").and_then(Value::as_bool) == Some(true) => {
            convert_custom_message_entry(record, session_id, provider)
        }
        _ => None,
    }
}

fn convert_stats_entry(
    record: &Value,
    session_id: &str,
    provider: &'static str,
) -> Option<ClaudeMessage> {
    match record.get("type").and_then(Value::as_str) {
        Some("message") => convert_message_record(record, session_id, provider),
        Some("model_usage") => convert_auxiliary_usage_entry(record, session_id, provider),
        Some("compaction" | "branch_summary") if record.get("usage").is_some() => {
            convert_auxiliary_usage_entry(record, session_id, provider)
        }
        _ => None,
    }
}

fn convert_message_record(
    record: &Value,
    session_id: &str,
    provider: &'static str,
) -> Option<ClaudeMessage> {
    let message = record.get("message")?;
    let role = message
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or("unknown");

    let (message_type, out_role, content, subtype, compact_metadata) = match role {
        "assistant" => (
            "assistant",
            Some("assistant"),
            Value::Array(assistant_blocks(message)),
            None,
            None,
        ),
        "toolResult" => (
            "user",
            Some("user"),
            Value::Array(tool_result_blocks(message)),
            None,
            None,
        ),
        "user" => (
            "user",
            Some("user"),
            Value::Array(content_blocks(message)),
            None,
            None,
        ),
        "developer" => (
            "system",
            Some("system"),
            Value::Array(content_blocks(message)),
            Some("system_prompt".to_string()),
            None,
        ),
        "bashExecution" => (
            "system",
            Some("system"),
            Value::String(bash_execution_content(message)),
            Some("bash_execution".to_string()),
            None,
        ),
        "custom" if message.get("display").and_then(Value::as_bool) != Some(true) => return None,
        "custom" => (
            "system",
            Some("system"),
            Value::Array(content_blocks(message)),
            Some(
                message
                    .get("customType")
                    .and_then(Value::as_str)
                    .unwrap_or("custom_message")
                    .to_string(),
            ),
            None,
        ),
        "branchSummary" => (
            "summary",
            None,
            Value::String(
                message
                    .get("summary")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            ),
            None,
            None,
        ),
        "compactionSummary" => (
            "system",
            Some("system"),
            Value::String(
                message
                    .get("summary")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            ),
            Some("compact_boundary".to_string()),
            Some(compact_metadata(message)),
        ),
        other => (
            "system",
            Some("system"),
            Value::String(display_content(message.get("content"))),
            Some(other.to_string()),
            None,
        ),
    };

    let mut out = build_provider_message(
        provider,
        record_id(record)?,
        session_id,
        message_timestamp(record, message),
        message_type,
        out_role,
        Some(content),
        message
            .get("model")
            .and_then(Value::as_str)
            .map(str::to_string),
    );
    out.parent_uuid = record_parent(record);
    out.subtype = subtype;
    out.compact_metadata = compact_metadata;
    out.stop_reason = message
        .get("stopReason")
        .and_then(Value::as_str)
        .map(str::to_string);
    if let Some(usage) = message.get("usage") {
        out.usage = Some(convert_usage(usage));
        out.cost_usd = usage_cost(usage);
    }
    Some(out)
}

fn record_id(record: &Value) -> Option<String> {
    record
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
}

fn record_parent(record: &Value) -> Option<String> {
    record
        .get("parentId")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn record_timestamp(record: &Value) -> String {
    record
        .get("timestamp")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn message_timestamp(record: &Value, message: &Value) -> String {
    message
        .get("timestamp")
        .and_then(Value::as_u64)
        .map(ms_to_iso)
        .unwrap_or_else(|| record_timestamp(record))
}

fn convert_compaction_entry(
    record: &Value,
    session_id: &str,
    provider: &'static str,
) -> Option<ClaudeMessage> {
    let content = record
        .get("summary")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let has_warning = record
        .get("warning")
        .and_then(Value::as_str)
        .map(str::trim)
        .is_some_and(|warning| !warning.is_empty());
    let mut out = build_provider_message(
        provider,
        record_id(record)?,
        session_id,
        record_timestamp(record),
        "system",
        Some("system"),
        Some(Value::String(content)),
        None,
    );
    out.parent_uuid = record_parent(record);
    out.subtype = Some("compact_boundary".to_string());
    out.level = Some(if has_warning { "warning" } else { "info" }.to_string());
    out.compact_metadata = Some(compact_metadata(record));
    Some(out)
}

fn convert_branch_summary_entry(
    record: &Value,
    session_id: &str,
    provider: &'static str,
) -> Option<ClaudeMessage> {
    let mut out = build_provider_message(
        provider,
        record_id(record)?,
        session_id,
        record_timestamp(record),
        "summary",
        None,
        Some(Value::String(
            record
                .get("summary")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        )),
        None,
    );
    out.parent_uuid = record_parent(record);
    Some(out)
}

fn convert_custom_message_entry(
    record: &Value,
    session_id: &str,
    provider: &'static str,
) -> Option<ClaudeMessage> {
    let mut out = build_provider_message(
        provider,
        record_id(record)?,
        session_id,
        record_timestamp(record),
        "system",
        Some("system"),
        Some(Value::Array(content_blocks(record))),
        None,
    );
    out.parent_uuid = record_parent(record);
    out.subtype = Some(
        record
            .get("customType")
            .and_then(Value::as_str)
            .unwrap_or("custom_message")
            .to_string(),
    );
    out.level = Some("info".to_string());
    Some(out)
}

fn convert_auxiliary_usage_entry(
    record: &Value,
    session_id: &str,
    provider: &'static str,
) -> Option<ClaudeMessage> {
    let usage = record.get("usage")?;
    let mut out = build_provider_message(
        provider,
        record_id(record)?,
        session_id,
        record_timestamp(record),
        "model_usage",
        None,
        None,
        record
            .get("model")
            .and_then(Value::as_str)
            .map(str::to_string),
    );
    out.parent_uuid = record_parent(record);
    out.usage = Some(convert_usage(usage));
    out.cost_usd = usage_cost(usage);
    out.stop_reason = record
        .get("stopReason")
        .and_then(Value::as_str)
        .map(str::to_string);
    Some(out)
}

fn compact_metadata(value: &Value) -> Value {
    let mut metadata = serde_json::Map::new();
    if let Some(tokens) = value.get("tokensBefore").and_then(Value::as_u64) {
        metadata.insert("preTokens".to_string(), Value::from(tokens));
    }
    if let Some(tokens) = value.get("tokensAfter").and_then(Value::as_u64) {
        metadata.insert("postTokens".to_string(), Value::from(tokens));
    }
    if let Some(method) = value.get("method").and_then(Value::as_str) {
        metadata.insert("trigger".to_string(), Value::String(method.to_string()));
    }
    if let Some(warning) = value
        .get("warning")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|warning| !warning.is_empty())
    {
        metadata.insert("warning".to_string(), Value::String(warning.to_string()));
    }
    Value::Object(metadata)
}

fn usage_cost(usage: &Value) -> Option<f64> {
    usage.get("cost").and_then(|cost| {
        cost.get("total")
            .and_then(Value::as_f64)
            .or_else(|| cost.as_f64())
    })
}

fn display_content(content: Option<&Value>) -> String {
    let Some(content) = content else {
        return String::new();
    };
    if let Some(text) = content.as_str() {
        return text.to_string();
    }
    content
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| match item.get("type").and_then(Value::as_str) {
            Some("text") => item.get("text").and_then(Value::as_str).map(str::to_string),
            Some("image") => Some(format!(
                "[Image attachment: {}]",
                item.get("mimeType")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown media type")
            )),
            _ => Some(item.to_string()),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn bash_execution_content(message: &Value) -> String {
    let command = message
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let output = message
        .get("output")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut sections = Vec::new();
    if !command.is_empty() {
        sections.push(format!("$ {command}"));
    }
    if !output.is_empty() {
        sections.push(output.to_string());
    }
    if message.get("cancelled").and_then(Value::as_bool) == Some(true) {
        sections.push("[cancelled]".to_string());
    } else if let Some(exit_code) = message.get("exitCode").and_then(Value::as_i64) {
        if exit_code != 0 {
            sections.push(format!("[exit code: {exit_code}]"));
        }
    }
    if message.get("truncated").and_then(Value::as_bool) == Some(true) {
        sections.push("[output truncated]".to_string());
    }
    sections.join("\n")
}

/// Map Pi/OMP content to Claude-style blocks. String content is valid for
/// user/developer messages; unknown blocks are preserved for the frontend's
/// generic fallback rather than silently discarded.
fn content_blocks(message: &Value) -> Vec<Value> {
    match message.get("content") {
        Some(Value::String(text)) => vec![json!({ "type": "text", "text": text })],
        Some(Value::Array(items)) => items.iter().filter_map(convert_content_item).collect(),
        _ => Vec::new(),
    }
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
fn tool_result_blocks(message: &Value) -> Vec<Value> {
    let tool_use_id = message
        .get("toolCallId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let is_error = message
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let blocks = content_blocks(message);
    let content = if blocks
        .iter()
        .all(|block| block.get("type").and_then(Value::as_str) == Some("text"))
    {
        Value::String(
            blocks
                .iter()
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n"),
        )
    } else {
        Value::Array(blocks)
    };
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
        Some("image") => convert_image_content(item),
        // The frontend has a bounded generic JSON fallback for unknown blocks.
        _ => Some(item.clone()),
    }
}

fn convert_image_content(item: &Value) -> Option<Value> {
    let data = item.get("data").and_then(Value::as_str)?;
    let mut media_type = item
        .get("mimeType")
        .or_else(|| item.get("mime_type"))
        .and_then(Value::as_str)
        .unwrap_or("unknown media type")
        .to_string();
    if data.starts_with("blob:") {
        return Some(json!({
            "type": "text",
            "text": format!("[Image attachment: {media_type}; external OMP blob]")
        }));
    }

    let mut payload = data;
    if let Some(data_url) = data.strip_prefix("data:") {
        if let Some((metadata, encoded)) = data_url.split_once(',') {
            if let Some(mime) = metadata.strip_suffix(";base64") {
                media_type = mime.to_string();
                payload = encoded;
            }
        }
    }
    if !media_type.starts_with("image/") {
        return Some(json!({
            "type": "text",
            "text": format!("[Image attachment: {media_type}]")
        }));
    }
    Some(json!({
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": media_type,
            "data": payload
        }
    }))
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
        reasoning_tokens: g("reasoning"),
        service_tier: None,
        ..Default::default()
    }
}

/// Read and trim one non-empty string field.
fn non_empty_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

/// First user text content (for the fallback session summary).
fn first_text(msg: &Value) -> Option<String> {
    let content = msg.get("content")?;
    if let Some(text) = content.as_str() {
        return (!text.is_empty()).then(|| text.to_string());
    }
    content.as_array()?.iter().find_map(|item| {
        if item.get("type").and_then(Value::as_str) != Some("text") {
            return None;
        }
        item.get("text")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
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
        r#"{"type":"message","id":"u1","parentId":"t1","timestamp":"2026-06-08T20:31:50.000Z","message":{"role":"user","content":"why does LOGIN fail?","timestamp":1749412310000}}"#,
        "\n",
        r#"{"type":"session_info","id":"n1","parentId":"u1","timestamp":"2026-06-08T20:31:55.000Z","name":"Investigate login failure"}"#,
        "\n",
        r#"{"type":"message","id":"a1","parentId":"n1","timestamp":"2026-06-08T20:32:10.000Z","message":{"role":"assistant","api":"anthropic-messages","provider":"anthropic","model":"claude-opus-4-8","stopReason":"tool_use","content":[{"type":"thinking","thinking":"let me check","thinkingSignature":"sig-1"},{"type":"toolCall","id":"call_1","name":"bash","arguments":{"command":"grep -r login"}}],"usage":{"input":12,"output":34,"cacheRead":5,"cacheWrite":0,"totalTokens":51,"cost":{"total":0.001}},"timestamp":1749412330000}}"#,
        "\n",
        r#"{"type":"message","id":"tr1","parentId":"a1","timestamp":"2026-06-08T20:32:11.000Z","message":{"role":"toolResult","toolCallId":"call_1","toolName":"bash","content":[{"type":"text","text":"login.rs:42"}],"isError":false,"timestamp":1749412331000}}"#,
        "\n",
    );

    const LEGACY_V1_SESSION: &str = concat!(
        r#"{"type":"session","id":"legacy-session","timestamp":"2024-12-03T14:00:00.000Z","cwd":"/Users/ac/dev/legacy"}"#,
        "\n",
        r#"{"type":"message","timestamp":"2024-12-03T14:00:01.000Z","message":{"role":"user","content":"legacy question","timestamp":1733234401000}}"#,
        "\n",
        r#"{"type":"model_change","timestamp":"2024-12-03T14:00:02.000Z","provider":"anthropic","modelId":"claude-sonnet-4-5"}"#,
        "\n",
        r#"{"type":"message","timestamp":"2024-12-03T14:00:03.000Z","message":{"role":"assistant","content":[{"type":"text","text":"legacy answer"}],"model":"claude-sonnet-4-5","usage":{"input":8,"output":3,"cacheRead":0,"cacheWrite":0,"totalTokens":11},"stopReason":"stop","timestamp":1733234403000}}"#,
        "\n",
        r#"{"type":"message","timestamp":"2024-12-03T14:00:04.000Z","message":{"role":"hookMessage","customType":"internal","content":"hidden hook","display":false,"timestamp":1733234404000}}"#,
        "\n",
        r#"{"type":"message","timestamp":"2024-12-03T14:00:05.000Z","message":{"role":"user","content":"legacy follow-up","timestamp":1733234405000}}"#,
        "\n",
    );

    #[test]
    fn session_meta_extracts_cwd_count_summary() {
        let m = session_meta(SESSION).unwrap();
        assert_eq!(m.id, "sess-1");
        assert_eq!(m.cwd.as_deref(), Some("/Users/ac/dev/herdr"));
        // user + assistant + toolResult (header/model_change/thinking_level_change excluded) = 3
        assert_eq!(m.message_count, 3);
        assert_eq!(m.summary.as_deref(), Some("Investigate login failure"));
        assert!(m.is_renamed);
        assert!(m.has_tool_use);
        assert!(!m.has_errors);
        // first/last session times follow `convert_message_record`'s precedence: the
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
        assert_eq!(msgs[0].parent_uuid, None);
        assert_eq!(
            msgs[0].content.as_ref().unwrap()[0]["text"],
            "why does LOGIN fail?"
        );
        // Timestamp comes from the nested `message.timestamp` epoch millis
        // (1749412310000), not the envelope record's ISO `timestamp`.
        assert_eq!(msgs[0].timestamp, ms_to_iso(1_749_412_310_000));

        let a = &msgs[1];
        assert_eq!(a.role.as_deref(), Some("assistant"));
        assert_eq!(a.parent_uuid.as_deref(), Some("u1"));
        assert_eq!(a.model.as_deref(), Some("claude-opus-4-8"));
        assert_eq!(a.cost_usd, Some(0.001));
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
    fn parse_messages_migrates_legacy_v1_ids_and_hook_role() {
        let messages = parse_messages(LEGACY_V1_SESSION, "pi");

        assert_eq!(messages.len(), 3);
        assert!(messages.iter().all(|message| !message.uuid.is_empty()));
        assert_eq!(messages[0].parent_uuid, None);
        assert_eq!(
            messages[1].parent_uuid.as_deref(),
            Some(messages[0].uuid.as_str())
        );
        assert_eq!(
            messages[2].parent_uuid.as_deref(),
            Some(messages[1].uuid.as_str())
        );
        assert_eq!(
            messages[2].content.as_ref().unwrap()[0]["text"],
            "legacy follow-up"
        );

        let stats = parse_stats_messages(LEGACY_V1_SESSION, "pi");
        assert_eq!(stats.len(), 3);
        assert_eq!(stats[1].usage.as_ref().unwrap().input_tokens, Some(8));
    }

    #[test]
    fn convert_content_item_kinds() {
        let unknown = json!({"type": "unknownKind", "future": true});
        assert_eq!(convert_content_item(&unknown), Some(unknown));
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
        let inline_image = convert_content_item(&json!({
            "type": "image",
            "data": "YWJj",
            "mimeType": "image/png"
        }))
        .unwrap();
        assert_eq!(inline_image["source"]["type"], "base64");
        assert_eq!(inline_image["source"]["media_type"], "image/png");

        let blob_image = convert_content_item(&json!({
            "type": "image",
            "data": "blob:sha256:deadbeef",
            "mimeType": "image/webp"
        }))
        .unwrap();
        assert_eq!(blob_image["type"], "text");
        assert!(blob_image["text"]
            .as_str()
            .is_some_and(|text| text.contains("external OMP blob")));
    }

    #[test]
    fn developer_and_custom_messages_preserve_inline_images() {
        let session = concat!(
            r#"{"type":"session","version":3,"id":"image-session","timestamp":"2026-06-08T20:31:45.261Z","cwd":"/Users/ac/dev/images"}"#,
            "\n",
            r#"{"type":"message","id":"developer","parentId":"image-session","timestamp":"2026-06-08T20:31:46.000Z","message":{"role":"developer","content":[{"type":"text","text":"Developer context"},{"type":"image","data":"YWJj","mimeType":"image/png"}]}}"#,
            "\n",
            r#"{"type":"message","id":"custom-role","parentId":"developer","timestamp":"2026-06-08T20:31:47.000Z","message":{"role":"custom","customType":"notice","display":true,"content":[{"type":"text","text":"Custom role context"},{"type":"image","data":"ZGVm","mimeType":"image/webp"}]}}"#,
            "\n",
            r#"{"type":"custom_message","id":"custom-entry","parentId":"custom-role","timestamp":"2026-06-08T20:31:48.000Z","customType":"banner","display":true,"content":[{"type":"text","text":"Custom entry context"},{"type":"image","data":"Z2hp","mimeType":"image/gif"}]}"#,
            "\n",
        );

        let messages = parse_messages(session, "ompi");
        assert_eq!(messages.len(), 3);

        for (message, expected_text, expected_data) in [
            (&messages[0], "Developer context", "YWJj"),
            (&messages[1], "Custom role context", "ZGVm"),
            (&messages[2], "Custom entry context", "Z2hp"),
        ] {
            let blocks = message
                .content
                .as_ref()
                .and_then(Value::as_array)
                .expect("structured content array");
            assert_eq!(blocks[0]["type"], "text");
            assert_eq!(blocks[0]["text"], expected_text);
            assert_eq!(blocks[1]["type"], "image");
            assert_eq!(blocks[1]["source"]["type"], "base64");
            assert_eq!(blocks[1]["source"]["data"], expected_data);
        }
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

    #[test]
    fn compaction_warning_is_metadata_not_summary_content() {
        let record = json!({
            "type": "compaction",
            "id": "cmp-warning",
            "parentId": "previous",
            "timestamp": "2026-06-08T20:33:00.000Z",
            "summary": "Retained context",
            "firstKeptEntryId": "u1",
            "tokensBefore": 50_000,
            "tokensAfter": 48_000,
            "method": "threshold",
            "warning": "Compaction freed too little context"
        });

        let message =
            convert_compaction_entry(&record, "sess-1", "ompi").expect("compaction message");
        assert_eq!(
            message.content.as_ref().and_then(Value::as_str),
            Some("Retained context")
        );
        assert_eq!(
            message.compact_metadata.as_ref().unwrap()["warning"],
            "Compaction freed too little context"
        );
        assert_eq!(message.level.as_deref(), Some("warning"));

        let serialized = serde_json::to_value(&message).expect("serialize compaction message");
        assert_eq!(
            serialized["compactMetadata"],
            json!({
                "trigger": "threshold",
                "preTokens": 50_000,
                "postTokens": 48_000,
                "warning": "Compaction freed too little context"
            })
        );
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

    /// `load_messages` must work against a literal session path under the
    /// fixture store that `$HOME` is pointed at, proving the store resolution
    /// works without requiring the real `~/.pi/agent/sessions`.
    #[test]
    #[serial]
    fn load_messages_succeeds_for_fixture_path_under_home_override() {
        let home = crate::test_utils::SandboxHome::new();
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
        let home = crate::test_utils::SandboxHome::new();
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
        let _home = crate::test_utils::SandboxHome::new();

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
