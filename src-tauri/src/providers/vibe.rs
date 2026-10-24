//! Mistral Vibe CLI provider.
//!
//! Two on-disk layouts are supported:
//!
//! - **Legacy transcript** — `~/.vibe/logs/session/<session>/` holding
//!   `meta.json` + `messages.jsonl` (one OpenAI-style message per line).
//! - **Unified session store** (current Vibe) —
//!   `~/.vibe/logs/session/unified/<session-id>/` holding `meta.json` plus an
//!   event-sourced store: content-addressed `chunks/<sha256>.json` files and
//!   `generations/<seq>/` snapshots. The conversation is recovered from the
//!   latest generation's `manifest.json`, whose `checkpoint.chunks` list names
//!   the chunks of the model-facing history in order. Each chunk is a JSON
//!   array of history entries wrapping an OpenAI-style message
//!   (`{ "message": { "role": ..., "content": [...] }, "source": "history" }`).

use super::ProviderInfo;
use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::utils::{build_provider_message, is_symlink, search_json_value_case_insensitive};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const PROVIDER_ID: &str = "vibe";
const SESSIONS_DIR: &str = "logs/session";
const UNIFIED_SESSIONS_DIR: &str = "logs/session/unified";
const METADATA_FILE: &str = "meta.json";
const MESSAGES_FILE: &str = "messages.jsonl";
const CHUNKS_DIR: &str = "chunks";
const GENERATIONS_DIR: &str = "generations";
const MANIFEST_FILE: &str = "manifest.json";
const CURRENT_FILE: &str = "CURRENT";
const SCHEME: &str = "vibe://";

pub fn detect() -> Option<ProviderInfo> {
    let base = get_base_path()?;
    let sessions_path = Path::new(&base).join(SESSIONS_DIR);

    Some(ProviderInfo {
        id: PROVIDER_ID.to_string(),
        display_name: "Mistral Vibe".to_string(),
        base_path: base,
        is_available: sessions_path.exists() && sessions_path.is_dir(),
    })
}

pub fn get_base_path() -> Option<String> {
    if let Ok(env_val) = std::env::var("VIBE_HOME") {
        let path = PathBuf::from(&env_val);
        let absolute_path = if path.is_absolute() {
            path
        } else {
            std::env::current_dir().ok()?.join(path)
        };
        if absolute_path.exists() {
            let normalized = absolute_path.canonicalize().unwrap_or(absolute_path);
            return Some(normalized.to_string_lossy().to_string());
        }
    }

    let default = crate::utils::home_dir()?.join(".vibe");
    if default.exists() {
        let normalized = default.canonicalize().unwrap_or(default);
        Some(normalized.to_string_lossy().to_string())
    } else {
        None
    }
}

pub fn scan_projects_from_path(base_path: &str) -> Result<Vec<ClaudeProject>, String> {
    crate::utils::require_absolute_path(base_path, "Vibe base path")?;
    let base = Path::new(base_path);

    let mut by_cwd: HashMap<String, ProjectAccumulator> = HashMap::new();

    for session_dir in collect_session_dirs(base) {
        if let Some(info) = extract_session_info(&session_dir) {
            let cwd = info.cwd.unwrap_or_else(|| "unknown".to_string());
            let agg = by_cwd.entry(cwd).or_default();
            agg.session_count += 1;
            agg.message_count += info.message_count;
            agg.storage_type = Some(info.storage_type.to_string());
            if info.last_modified > agg.last_modified {
                agg.last_modified = info.last_modified;
            }
        }
    }

    let mut projects: Vec<ClaudeProject> = by_cwd
        .into_iter()
        .map(|(cwd, agg)| {
            let name = Path::new(&cwd)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| cwd.clone());

            ClaudeProject {
                name,
                path: format!("{SCHEME}{cwd}"),
                actual_path: cwd,
                session_count: agg.session_count,
                message_count: agg.message_count,
                last_modified: agg.last_modified,
                git_info: None,
                provider: Some(PROVIDER_ID.to_string()),
                storage_type: agg.storage_type,
                custom_directory_label: None,
            }
        })
        .collect();

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let base = get_base_path().ok_or("Vibe base path not found")?;
    scan_projects_from_path(&base)
}

pub fn load_sessions(
    project_path: &str,
    exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let base = get_base_path().ok_or("Vibe base path not found")?;
    load_sessions_from_base_path(&base, project_path, exclude_sidechain)
}

pub fn load_sessions_from_base_path(
    base_path: &str,
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let target_cwd = project_path.strip_prefix(SCHEME).unwrap_or(project_path);
    let mut sessions = Vec::new();

    for session_dir in collect_session_dirs(Path::new(base_path)) {
        let Some(info) = extract_session_info(&session_dir) else {
            continue;
        };
        if info.cwd.as_deref().unwrap_or("unknown") != target_cwd {
            continue;
        }

        let project_name = Path::new(target_cwd)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| target_cwd.to_string());

        sessions.push(ClaudeSession {
            session_id: info.session_id.clone(),
            actual_session_id: info.session_id,
            file_path: session_dir.to_string_lossy().to_string(),
            project_name,
            message_count: info.message_count,
            first_message_time: info.first_message_time,
            last_message_time: info.last_message_time,
            last_modified: info.last_modified,
            has_tool_use: info.has_tool_use,
            has_errors: false,
            summary: info.summary,
            is_renamed: info.is_renamed,
            provider: Some(PROVIDER_ID.to_string()),
            storage_type: Some(info.storage_type.to_string()),
            entrypoint: None,
        });
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let base = get_base_path().ok_or("Vibe base path not found")?;
    load_messages_from_base_path(&base, session_path)
}

pub fn load_messages_from_base_path(
    base_path: &str,
    session_path: &str,
) -> Result<Vec<ClaudeMessage>, String> {
    let session_dir = validate_session_dir(base_path, session_path)?;
    let metadata = read_json_file(&session_dir.join(METADATA_FILE))?;
    let session_id = metadata
        .get("session_id")
        .and_then(Value::as_str)
        .or_else(|| session_dir.file_name().and_then(|n| n.to_str()))
        .unwrap_or("vibe-session")
        .to_string();
    let timestamp = metadata
        .get("start_time")
        .and_then(Value::as_str)
        .map(normalize_timestamp)
        .unwrap_or_default();

    // Unified session store: conversation comes from the checkpoint chunks.
    if session_dir.join(CHUNKS_DIR).is_dir() {
        let entries = load_history_entries(&session_dir);
        let mut messages = Vec::new();
        let mut counter = 0u64;
        for entry in &entries {
            if let Some(message) =
                convert_history_entry(entry, &session_id, &timestamp, &mut counter)
            {
                messages.push(message);
            }
        }
        return Ok(messages);
    }

    // Legacy transcript: one OpenAI-style message per line.
    let values = read_jsonl_values(&session_dir.join(MESSAGES_FILE))?;
    let mut messages = Vec::new();
    let mut counter = 0u64;

    for value in values {
        let role = value.get("role").and_then(Value::as_str).unwrap_or("");
        if role == "system" {
            continue;
        }
        if let Some(message) = convert_message(
            &value,
            role,
            &session_id,
            &timestamp,
            &mut counter,
            &session_dir,
        ) {
            messages.push(message);
        }
    }

    Ok(messages)
}

pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let base = get_base_path().ok_or("Vibe base path not found")?;
    search_from_base_path(&base, query, limit)
}

pub fn search_from_base_path(
    base_path: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<ClaudeMessage>, String> {
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for project in scan_projects_from_path(base_path)? {
        for session in load_sessions_from_base_path(base_path, &project.path, false)? {
            for mut message in load_messages_from_base_path(base_path, &session.file_path)? {
                if let Some(content) = &message.content {
                    if search_json_value_case_insensitive(content, &query_lower) {
                        message.project_name = Some(project.name.clone());
                        results.push(message);
                        if results.len() >= limit {
                            return Ok(results);
                        }
                    }
                }
            }
        }
    }

    Ok(results)
}

/// Collect Vibe session directories under `logs/session`.
///
/// Legacy sessions live directly under `logs/session/<session>/` (with
/// `meta.json` + `messages.jsonl`); current Vibe stores them one level deeper
/// under `logs/session/unified/<session-id>/` (with `meta.json` + `chunks/`).
/// Sibling directories such as `active/` (lock files) and `plugins/` carry no
/// `meta.json` and are skipped.
fn collect_session_dirs(base: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    for container in [base.join(SESSIONS_DIR), base.join(UNIFIED_SESSIONS_DIR)] {
        let Ok(read_dir) = fs::read_dir(&container) else {
            continue;
        };
        for entry in read_dir.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() || !file_type.is_dir() {
                continue;
            }
            let dir = entry.path();
            if is_session_dir(&dir) {
                dirs.push(dir);
            }
        }
    }
    dirs
}

fn is_session_dir(dir: &Path) -> bool {
    if is_symlink(dir) || !dir.is_dir() {
        return false;
    }
    let metadata = dir.join(METADATA_FILE);
    if is_symlink(&metadata) || !metadata.is_file() {
        return false;
    }
    if dir.join(CHUNKS_DIR).is_dir() {
        return true;
    }
    let messages = dir.join(MESSAGES_FILE);
    !is_symlink(&messages) && messages.is_file()
}

/// Read the ordered conversation history from a unified session store.
///
/// The latest generation's `manifest.json` lists the ordered
/// `checkpoint.chunks` that make up the model-facing history, so the manifest
/// is the source of truth for both membership and ordering. When no manifest
/// is readable (crashed or in-progress session), fall back to every chunk
/// ordered by modification time.
fn load_history_entries(session_dir: &Path) -> Vec<Value> {
    let chunks_dir = session_dir.join(CHUNKS_DIR);
    let mut entries = Vec::new();

    if let Some(hashes) = resolve_checkpoint_chunks(session_dir) {
        for hash in hashes {
            entries.extend(read_chunk_file(&chunks_dir.join(format!("{hash}.json"))));
        }
        return entries;
    }

    let mut chunk_files: Vec<PathBuf> = Vec::new();
    if let Ok(read_dir) = fs::read_dir(&chunks_dir) {
        for entry in read_dir.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            if is_symlink(&path) {
                continue;
            }
            chunk_files.push(path);
        }
    }
    chunk_files.sort_by_key(|path| {
        fs::metadata(path)
            .and_then(|meta| meta.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
    });
    for path in chunk_files {
        entries.extend(read_chunk_file(&path));
    }
    entries
}

/// Resolve the ordered checkpoint chunk hashes of the latest generation.
fn resolve_checkpoint_chunks(session_dir: &Path) -> Option<Vec<String>> {
    let generations = session_dir.join(GENERATIONS_DIR);
    let generation = current_generation(session_dir)
        .filter(|name| generations.join(name).join(MANIFEST_FILE).is_file())
        .or_else(|| latest_generation(&generations))?;
    let manifest = read_json_file(&generations.join(&generation).join(MANIFEST_FILE)).ok()?;
    let chunks: Vec<String> = manifest
        .get("checkpoint")?
        .get("chunks")?
        .as_array()?
        .iter()
        .filter_map(|chunk| chunk.as_str().map(str::to_owned))
        .collect();
    if chunks.is_empty() {
        None
    } else {
        Some(chunks)
    }
}

/// The `CURRENT` file points at the newest generation of a session.
fn current_generation(session_dir: &Path) -> Option<String> {
    let current = read_json_file(&session_dir.join(CURRENT_FILE)).ok()?;
    current.get("generation")?.as_str().map(str::to_owned)
}

/// Generation directories are zero-padded sequence numbers, so the maximum
/// file name is the latest generation.
fn latest_generation(generations: &Path) -> Option<String> {
    fs::read_dir(generations)
        .ok()?
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|ft| ft.is_dir()))
        .filter_map(|entry| entry.file_name().into_string().ok())
        .max()
}

/// A chunk is a JSON array of history entries. A torn write on an active
/// session can leave a truncated final chunk — skip it instead of failing
/// the whole session.
fn read_chunk_file(path: &Path) -> Vec<Value> {
    if is_symlink(path) {
        return Vec::new();
    }
    let Ok(content) = fs::read_to_string(path) else {
        return Vec::new();
    };
    match serde_json::from_str::<Value>(&content) {
        Ok(Value::Array(items)) => items,
        _ => Vec::new(),
    }
}

/// Convert one unified-store history entry into a viewer message.
///
/// History entries wrap an OpenAI-style message
/// (`{ "message": { "role": ..., "content": [...] }, "source": "history" }`).
/// Tool results arrive as `role: "tool"` messages linked to their call by
/// `tool_call_id`. Entries carry no per-message id or timestamp, so messages
/// are numbered in conversation order and stamped with the session start.
fn convert_history_entry(
    entry: &Value,
    session_id: &str,
    timestamp: &str,
    counter: &mut u64,
) -> Option<ClaudeMessage> {
    let message = entry.get("message")?;
    let role = message.get("role").and_then(Value::as_str)?;
    let content = message.get("content");
    *counter += 1;
    let uuid = format!("{session_id}-{counter}");

    match role {
        "user" => Some(build_provider_message(
            PROVIDER_ID,
            uuid,
            session_id,
            timestamp.to_string(),
            "user",
            Some("user"),
            Some(history_content_to_blocks(content)),
            None,
        )),
        "assistant" => Some(build_provider_message(
            PROVIDER_ID,
            uuid,
            session_id,
            timestamp.to_string(),
            "assistant",
            Some("assistant"),
            Some(history_content_to_blocks(content)),
            None,
        )),
        "tool" => {
            let tool_call_id = message
                .get("tool_call_id")
                .and_then(Value::as_str)
                .unwrap_or("");
            let is_error = message.get("outcome").and_then(Value::as_str) == Some("failure");
            let mut result = json!({
                "type": "tool_result",
                "tool_use_id": tool_call_id,
                "content": history_text_content(content),
            });
            if is_error {
                result["is_error"] = Value::Bool(true);
            }
            Some(build_provider_message(
                PROVIDER_ID,
                uuid,
                session_id,
                timestamp.to_string(),
                "tool",
                Some("tool"),
                Some(json!([result])),
                None,
            ))
        }
        _ => None,
    }
}

/// Map unified-store content blocks to viewer blocks: `text` passes through,
/// `reasoning` becomes a thinking block, `tool_call` becomes a `tool_use`
/// block, `image` and `resource` attachments are converted to the viewer's
/// native shapes. Unknown block types are kept as-is for forward
/// compatibility.
fn history_content_to_blocks(content: Option<&Value>) -> Value {
    if let Some(text) = content.and_then(Value::as_str) {
        return json!([{ "type": "text", "text": text }]);
    }
    let Some(items) = content.and_then(Value::as_array) else {
        return Value::Array(Vec::new());
    };

    let mut blocks = Vec::new();
    for item in items {
        match item.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(text) = item.get("text").and_then(Value::as_str) {
                    blocks.push(json!({ "type": "text", "text": text }));
                }
            }
            Some("reasoning") => {
                let thinking = reasoning_text(item);
                if !thinking.is_empty() {
                    blocks.push(json!({ "type": "thinking", "thinking": thinking }));
                }
            }
            Some("tool_call") => blocks.push(convert_history_tool_call(item)),
            Some("image") => {
                if let Some(block) = convert_history_image(item) {
                    blocks.push(block);
                }
            }
            Some("resource") => {
                if let Some(block) = convert_history_resource(item) {
                    blocks.push(block);
                }
            }
            _ => blocks.push(item.clone()),
        }
    }
    Value::Array(blocks)
}

/// Vibe stores pasted images inline as
/// `{ "type": "image", "data": <base64>, "mimeType": ... }`; map to the
/// viewer's base64 image block shape.
fn convert_history_image(item: &Value) -> Option<Value> {
    let data = item.get("data").and_then(Value::as_str)?;
    let mime_type = item
        .get("mimeType")
        .and_then(Value::as_str)
        .or_else(|| {
            item.get("_meta")
                .and_then(|meta| meta.get("mistralai.vibe.harness/file-image-resource-link"))
                .and_then(|link| link.get("mimeType"))
                .and_then(Value::as_str)
        })
        .unwrap_or("image/png");
    Some(json!({
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": mime_type,
            "data": data,
        }
    }))
}

/// Vibe attaches `@file` mentions as
/// `{ "type": "resource", "resource": { "text": ..., "uri": "file://..." } }`;
/// map to a plain-text document block so the viewer renders the file content
/// instead of an unknown-type warning.
fn convert_history_resource(item: &Value) -> Option<Value> {
    let resource = item.get("resource")?;
    let text = resource.get("text").and_then(Value::as_str)?;
    let title = resource
        .get("uri")
        .and_then(Value::as_str)
        .and_then(|uri| uri.strip_prefix("file://"))
        .and_then(|path| Path::new(path).file_name())
        .map(|name| name.to_string_lossy().to_string());
    let mut block = json!({
        "type": "document",
        "source": {
            "type": "text",
            "media_type": "text/plain",
            "data": text,
        }
    });
    if let Some(title) = title {
        block["title"] = Value::String(title);
    }
    Some(block)
}

/// Reasoning blocks nest their text in a content array
/// (`{ "type": "reasoning", "content": [{ "text": ... }] }`); accept a flat
/// `text` field too.
fn reasoning_text(item: &Value) -> String {
    if let Some(text) = item.get("text").and_then(Value::as_str) {
        return text.to_string();
    }
    item.get("content")
        .and_then(Value::as_array)
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
}

fn convert_history_tool_call(call: &Value) -> Value {
    let arguments = call.get("arguments");
    let input = arguments
        .and_then(|args| args.get("value"))
        .cloned()
        .filter(|value| !value.is_null())
        .or_else(|| {
            arguments
                .and_then(|args| args.get("raw"))
                .and_then(Value::as_str)
                .and_then(|raw| serde_json::from_str(raw).ok())
        })
        .unwrap_or(Value::Null);

    json!({
        "type": "tool_use",
        "id": call.get("id").and_then(Value::as_str).unwrap_or(""),
        "name": call.get("name").and_then(Value::as_str).unwrap_or("tool"),
        "input": input,
    })
}

/// Flatten tool-result content blocks to the plain text the viewer renders.
fn history_text_content(content: Option<&Value>) -> Value {
    match content {
        Some(Value::String(text)) => Value::String(text.clone()),
        Some(Value::Array(items)) => {
            let text = items
                .iter()
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n");
            Value::String(text)
        }
        other => other.cloned().unwrap_or(Value::Null),
    }
}

#[derive(Debug, Default)]
struct ProjectAccumulator {
    session_count: usize,
    message_count: usize,
    last_modified: String,
    storage_type: Option<String>,
}

#[derive(Debug, Clone)]
struct SessionInfo {
    session_id: String,
    cwd: Option<String>,
    message_count: usize,
    first_message_time: String,
    last_message_time: String,
    last_modified: String,
    has_tool_use: bool,
    summary: Option<String>,
    is_renamed: bool,
    storage_type: &'static str,
}

#[derive(Debug, Default)]
struct HistorySummary {
    message_count: usize,
    has_tool_use: bool,
    first_user_text: Option<String>,
}

fn extract_session_info(session_dir: &Path) -> Option<SessionInfo> {
    if is_symlink(session_dir) || !session_dir.is_dir() {
        return None;
    }

    let metadata_path = session_dir.join(METADATA_FILE);
    if is_symlink(&metadata_path) || !metadata_path.is_file() {
        return None;
    }

    let metadata = read_json_file(&metadata_path).ok()?;
    let session_id = metadata
        .get("session_id")
        .and_then(Value::as_str)?
        .to_string();
    let cwd = metadata
        .get("environment")
        .and_then(|env| env.get("working_directory"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let title = metadata
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(ToOwned::to_owned);
    let is_renamed = metadata
        .get("title_source")
        .and_then(Value::as_str)
        .is_some_and(|source| source == "manual");
    let start_time = metadata
        .get("start_time")
        .and_then(Value::as_str)
        .map(normalize_timestamp)
        .unwrap_or_default();
    let end_time = metadata
        .get("end_time")
        .and_then(Value::as_str)
        .map(normalize_timestamp)
        .unwrap_or_else(|| start_time.clone());

    let (summary, storage_type, last_modified) = if session_dir.join(CHUNKS_DIR).is_dir() {
        let entries = load_history_entries(session_dir);
        let summary = summarize_history_entries(&entries);
        let last_modified = if end_time.is_empty() {
            file_modified_iso(&metadata_path).unwrap_or_default()
        } else {
            end_time.clone()
        };
        (summary, "json", last_modified)
    } else {
        let messages_path = session_dir.join(MESSAGES_FILE);
        if is_symlink(&messages_path) || !messages_path.is_file() {
            return None;
        }
        let values = read_jsonl_values(&messages_path).ok()?;
        let summary = summarize_transcript_values(&values);
        let last_modified = if end_time.is_empty() {
            file_modified_iso(&messages_path).unwrap_or_default()
        } else {
            end_time.clone()
        };
        (summary, "jsonl", last_modified)
    };

    if summary.message_count == 0 {
        return None;
    }

    Some(SessionInfo {
        session_id,
        cwd,
        message_count: summary.message_count,
        first_message_time: start_time.clone(),
        last_message_time: end_time,
        last_modified,
        has_tool_use: summary.has_tool_use,
        summary: title.or(summary.first_user_text),
        is_renamed,
        storage_type,
    })
}

/// Summarize unified-store history entries: message count, tool usage and
/// the first user text (used as a fallback session summary).
fn summarize_history_entries(entries: &[Value]) -> HistorySummary {
    let mut summary = HistorySummary::default();

    for entry in entries {
        let Some(message) = entry.get("message") else {
            continue;
        };
        let Some(role) = message.get("role").and_then(Value::as_str) else {
            continue;
        };
        if !matches!(role, "user" | "assistant" | "tool") {
            continue;
        }
        summary.message_count += 1;
        if role == "tool" {
            summary.has_tool_use = true;
        }
        let Some(items) = message.get("content").and_then(Value::as_array) else {
            continue;
        };
        if items
            .iter()
            .any(|block| block.get("type").and_then(Value::as_str) == Some("tool_call"))
        {
            summary.has_tool_use = true;
        }
        if role == "user" && summary.first_user_text.is_none() {
            summary.first_user_text = items
                .iter()
                .find_map(|block| block.get("text").and_then(Value::as_str))
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(|text| truncate_chars(text, 200));
        }
    }

    summary
}

/// Summarize legacy `messages.jsonl` records.
fn summarize_transcript_values(values: &[Value]) -> HistorySummary {
    let mut summary = HistorySummary::default();

    for value in values {
        let role = value.get("role").and_then(Value::as_str).unwrap_or("");
        if role == "system" {
            continue;
        }
        if matches!(role, "user" | "assistant" | "tool") {
            summary.message_count += 1;
        }
        if role == "tool"
            || value
                .get("tool_calls")
                .and_then(Value::as_array)
                .is_some_and(|calls| !calls.is_empty())
        {
            summary.has_tool_use = true;
        }
        if role == "user" && summary.first_user_text.is_none() {
            summary.first_user_text = extract_content_summary(value);
        }
    }

    summary
}

fn convert_message(
    value: &Value,
    role: &str,
    session_id: &str,
    timestamp: &str,
    counter: &mut u64,
    session_dir: &Path,
) -> Option<ClaudeMessage> {
    *counter += 1;
    let uuid = value
        .get("message_id")
        .or_else(|| value.get("id"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("{session_id}-{counter}"));

    match role {
        "user" => {
            let mut blocks = content_to_blocks(value.get("content"));
            if let Some(arr) = blocks.as_array_mut() {
                arr.extend(image_blocks(value, session_dir));
            }
            Some(build_provider_message(
                PROVIDER_ID,
                uuid,
                session_id,
                timestamp.to_string(),
                "user",
                Some("user"),
                Some(blocks),
                None,
            ))
        }
        "assistant" => {
            let mut blocks = content_to_blocks(value.get("content"));
            if let Some(arr) = blocks.as_array_mut() {
                arr.extend(image_blocks(value, session_dir));
            }
            if let Some(reasoning) = value
                .get("reasoning_content")
                .and_then(Value::as_str)
                .filter(|text| !text.trim().is_empty())
            {
                if let Some(arr) = blocks.as_array_mut() {
                    arr.insert(
                        0,
                        json!({
                            "type": "thinking",
                            "thinking": reasoning
                        }),
                    );
                }
            }
            if let Some(calls) = value.get("tool_calls").and_then(Value::as_array) {
                if let Some(arr) = blocks.as_array_mut() {
                    for call in calls {
                        arr.push(convert_tool_call(call));
                    }
                }
            }
            Some(build_provider_message(
                PROVIDER_ID,
                uuid,
                session_id,
                timestamp.to_string(),
                "assistant",
                Some("assistant"),
                Some(blocks),
                None,
            ))
        }
        "tool" => Some(build_provider_message(
            PROVIDER_ID,
            uuid,
            session_id,
            timestamp.to_string(),
            "tool",
            Some("tool"),
            Some(json!([{
                "type": "tool_result",
                "tool_use_id": value.get("tool_call_id").and_then(Value::as_str).unwrap_or(""),
                "content": value.get("content").cloned().unwrap_or(Value::Null)
            }])),
            None,
        )),
        _ => None,
    }
}

/// Convert a Vibe message's `images` attachments into viewer image blocks.
///
/// Upstream persists pasted/attached images either inline
/// (`source: {kind: "inline", data: <base64>}`) or as a snapshot file inside
/// the session directory (`source: {kind: "file", path}`); older transcripts
/// use a flat `{data}` / `{path}` shape. File sources are read from disk only
/// when they resolve inside the session directory — everything else is
/// skipped rather than erroring the message.
fn image_blocks(value: &Value, session_dir: &Path) -> Vec<Value> {
    let Some(images) = value.get("images").and_then(Value::as_array) else {
        return Vec::new();
    };

    let mut blocks = Vec::new();
    for image in images {
        let mime_type = image
            .get("mime_type")
            .and_then(Value::as_str)
            .unwrap_or("image/png");
        let source = image.get("source");

        let inline_data = source
            .filter(|s| s.get("kind").and_then(Value::as_str) == Some("inline"))
            .and_then(|s| s.get("data"))
            .or_else(|| image.get("data"))
            .and_then(Value::as_str);
        let file_path = source
            .filter(|s| s.get("kind").and_then(Value::as_str) == Some("file"))
            .and_then(|s| s.get("path"))
            .or_else(|| image.get("path"))
            .and_then(Value::as_str);

        let data = if let Some(data) = inline_data {
            Some(data.to_string())
        } else {
            file_path.and_then(|path| read_session_image(session_dir, Path::new(path)))
        };

        if let Some(data) = data {
            blocks.push(json!({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": mime_type,
                    "data": data
                }
            }));
        }
    }
    blocks
}

/// Sanity cap for snapshot files read back into memory; upstream rejects
/// anything larger at capture time.
const MAX_IMAGE_SNAPSHOT_BYTES: u64 = 10 * 1024 * 1024;

/// Read an image snapshot, base64-encoded, only when the (possibly relative)
/// path resolves inside the session directory and is not a symlink.
fn read_session_image(session_dir: &Path, path: &Path) -> Option<String> {
    use base64::Engine as _;

    let canonical_dir = session_dir.canonicalize().ok()?;
    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        canonical_dir.join(path)
    };
    if fs::symlink_metadata(&candidate)
        .ok()?
        .file_type()
        .is_symlink()
    {
        return None;
    }
    let canonical = candidate.canonicalize().ok()?;
    if !canonical.starts_with(&canonical_dir) {
        return None;
    }
    if fs::metadata(&canonical).ok()?.len() > MAX_IMAGE_SNAPSHOT_BYTES {
        return None;
    }
    let bytes = fs::read(&canonical).ok()?;
    Some(base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn content_to_blocks(content: Option<&Value>) -> Value {
    match content {
        Some(Value::Array(items)) => {
            Value::Array(items.iter().map(normalize_content_block).collect())
        }
        Some(Value::String(text)) => json!([{ "type": "text", "text": text }]),
        Some(Value::Null) | None => Value::Array(Vec::new()),
        Some(other) => json!([{ "type": "text", "text": other.to_string() }]),
    }
}

fn normalize_content_block(item: &Value) -> Value {
    if item.get("type").and_then(Value::as_str) == Some("think") {
        return json!({
            "type": "thinking",
            "thinking": item.get("think").and_then(Value::as_str).unwrap_or("")
        });
    }

    item.clone()
}

fn convert_tool_call(call: &Value) -> Value {
    let function = call.get("function").unwrap_or(&Value::Null);
    let name = function
        .get("name")
        .or_else(|| call.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("tool");
    let input = function
        .get("arguments")
        .or_else(|| call.get("arguments"))
        .cloned()
        .unwrap_or(Value::Null);

    json!({
        "type": "tool_use",
        "id": call.get("id").and_then(Value::as_str).unwrap_or(""),
        "name": name,
        "input": normalize_tool_input(input)
    })
}

fn normalize_tool_input(input: Value) -> Value {
    if let Some(s) = input.as_str() {
        serde_json::from_str(s).unwrap_or_else(|_| json!({"input": s }))
    } else {
        input
    }
}

fn extract_content_summary(value: &Value) -> Option<String> {
    let content = value.get("content")?;
    let text = if let Some(text) = content.as_str() {
        text.to_string()
    } else {
        content
            .as_array()?
            .iter()
            .find_map(|item| item.get("text").and_then(Value::as_str))
            .unwrap_or("")
            .to_string()
    };

    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(truncate_chars(trimmed, 200))
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    match text.char_indices().nth(max_chars) {
        Some((idx, _)) => format!("{}...", &text[..idx]),
        None => text.to_string(),
    }
}

fn normalize_timestamp(raw: &str) -> String {
    DateTime::parse_from_rfc3339(raw)
        .map(|dt| dt.with_timezone(&Utc).to_rfc3339())
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%S%.f")
                .map(|dt| dt.and_utc().to_rfc3339())
        })
        .unwrap_or_else(|_| raw.to_string())
}

fn read_json_file(path: &Path) -> Result<Value, String> {
    if is_symlink(path) {
        return Err("Refusing to read symlinked Vibe JSON file".to_string());
    }
    let content = fs::read_to_string(path).map_err(|e| format!("Failed to read JSON file: {e}"))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse JSON file: {e}"))
}

fn read_jsonl_values(path: &Path) -> Result<Vec<Value>, String> {
    if is_symlink(path) {
        return Err("Refusing to read symlinked Vibe JSONL file".to_string());
    }
    let content =
        fs::read_to_string(path).map_err(|e| format!("Failed to read JSONL file: {e}"))?;
    let mut values = Vec::new();
    for line in content.lines().filter(|line| !line.trim().is_empty()) {
        if let Ok(value) = serde_json::from_str::<Value>(line) {
            values.push(value);
        }
    }
    Ok(values)
}

fn file_modified_iso(path: &Path) -> Option<String> {
    fs::metadata(path)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .map(|time| {
            let dt: DateTime<Utc> = time.into();
            dt.to_rfc3339()
        })
}

fn validate_session_dir(base_path: &str, session_path: &str) -> Result<PathBuf, String> {
    let session_dir = Path::new(session_path);
    if !session_dir.is_absolute() {
        return Err("Vibe session path must be absolute".to_string());
    }
    if is_symlink(session_dir) || !session_dir.is_dir() {
        return Err("Vibe session path is not a directory".to_string());
    }

    let sessions_root = Path::new(base_path).join(SESSIONS_DIR);
    let canonical_root = sessions_root
        .canonicalize()
        .map_err(|e| format!("Failed to resolve Vibe sessions root: {e}"))?;
    let canonical_session = session_dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve Vibe session path: {e}"))?;
    if !canonical_session.starts_with(&canonical_root) {
        return Err("Vibe session path is outside Vibe sessions directory".to_string());
    }

    Ok(canonical_session)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn write_fixture(base: &Path) -> (String, String) {
        let session_dir = base.join("logs/session/session_20260202_120000_abc123");
        fs::create_dir_all(&session_dir).expect("create session dir");

        let cwd = "/tmp/vibe-demo";
        let metadata = json!({
            "session_id": "full-session-id-abc123",
            "start_time": "2026-02-02T12:00:00+00:00",
            "end_time": "2026-02-02T12:05:00+00:00",
            "environment": { "working_directory": cwd },
            "title": "Fix Vibe provider",
            "title_source": "manual",
            "stats": {
                "session_prompt_tokens": 120,
                "session_completion_tokens": 45
            }
        });
        fs::write(
            session_dir.join(METADATA_FILE),
            serde_json::to_string_pretty(&metadata).unwrap(),
        )
        .expect("write metadata");

        let messages = [
            json!({
                "role": "user",
                "content": "Add Mistral Vibe support",
                "message_id": "msg-1"
            }),
            json!({
                "role": "assistant",
                "content": "I'll inspect the provider registry.",
                "reasoning_content": "The registry must list the Vibe provider.",
                "message_id": "msg-2",
                "tool_calls": [{
                    "id": "call-1",
                    "type": "function",
                    "function": {
                        "name": "read_file",
                        "arguments": "{\"path\":\"providers/mod.rs\"}"
                    }
                }]
            }),
            json!({
                "role": "tool",
                "tool_call_id": "call-1",
                "content": "mod vibe;",
                "message_id": "msg-3"
            }),
        ];
        let jsonl = messages
            .iter()
            .map(|line| serde_json::to_string(line).unwrap())
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(session_dir.join(MESSAGES_FILE), jsonl).expect("write messages");

        (cwd.to_string(), session_dir.to_string_lossy().to_string())
    }

    /// Build a unified session store fixture (`logs/session/unified/<id>/`)
    /// with two checkpoint chunks and a `CURRENT` pointer.
    fn write_unified_fixture(base: &Path) -> (String, String) {
        let session_dir = base.join("logs/session/unified/7abdeb96-ca90-7e2a-1257-a26093d8f6e9");
        let chunks_dir = session_dir.join(CHUNKS_DIR);
        let generation_dir = session_dir.join(GENERATIONS_DIR).join("0000000000000042");
        fs::create_dir_all(&chunks_dir).expect("create chunks dir");
        fs::create_dir_all(&generation_dir).expect("create generation dir");

        let cwd = "/tmp/vibe-unified-demo";
        let metadata = json!({
            "session_id": "7abdeb96-ca90-7e2a-1257-a26093d8f6e9",
            "start_time": "2026-10-24T10:00:00+00:00",
            "end_time": "2026-10-24T10:30:00+00:00",
            "environment": { "working_directory": cwd },
            "title": "Unified store session",
            "title_source": "auto",
        });
        fs::write(
            session_dir.join(METADATA_FILE),
            serde_json::to_string_pretty(&metadata).unwrap(),
        )
        .expect("write metadata");

        fs::write(
            session_dir.join(CURRENT_FILE),
            json!({
                "generation": "0000000000000042",
                "session_id": "7abdeb96-ca90-7e2a-1257-a26093d8f6e9",
                "store_format": "mistral.vibe.unified-session-store/v1",
            })
            .to_string(),
        )
        .expect("write CURRENT");

        let chunk_a = json!([
            {
                "message": {
                    "role": "user",
                    "content": [
                        { "type": "text", "text": "Lance le serveur en mode dev" },
                        { "type": "image", "data": "aW1hZ2U=", "mimeType": "image/png" },
                        {
                            "type": "resource",
                            "resource": {
                                "text": "contenu de dev.log",
                                "uri": "file:///tmp/vibe-unified-demo/dev.log"
                            }
                        }
                    ]
                },
                "source": "history",
                "turn_index": 0
            },
            {
                "message": {
                    "role": "assistant",
                    "content": [
                        { "type": "reasoning", "content": [{ "type": "text", "text": "Je reflechis au build" }] },
                        { "type": "text", "text": "Je regarde le justfile." }
                    ]
                },
                "source": "history",
                "turn_index": 0
            }
        ]);
        let chunk_b = json!([
            {
                "message": {
                    "role": "assistant",
                    "content": [{
                        "type": "tool_call",
                        "id": "call-1",
                        "name": "file_system.bash",
                        "arguments": {
                            "type": "json",
                            "raw": "{\"command\":\"just dev\"}",
                            "value": { "command": "just dev" }
                        }
                    }]
                },
                "source": "history",
                "turn_index": 0
            },
            {
                "message": {
                    "role": "tool",
                    "name": "file_system.bash",
                    "outcome": "failure",
                    "tool_call_id": "call-1",
                    "content": [{ "type": "text", "text": "{\"returncode\":1,\"stderr\":\"boom\"}" }]
                },
                "source": "history",
                "turn_index": 0
            }
        ]);
        fs::write(chunks_dir.join("aaa.json"), chunk_a.to_string()).expect("write chunk a");
        fs::write(chunks_dir.join("bbb.json"), chunk_b.to_string()).expect("write chunk b");

        let manifest = json!({
            "manifest_version": 1,
            "generation": "0000000000000042",
            "checkpoint": { "chunks": ["aaa", "bbb"], "path": "checkpoint.json" },
            "projection_state": { "chunks": [] }
        });
        fs::write(
            generation_dir.join(MANIFEST_FILE),
            serde_json::to_string_pretty(&manifest).unwrap(),
        )
        .expect("write manifest");

        (cwd.to_string(), session_dir.to_string_lossy().to_string())
    }

    #[test]
    fn scan_projects_groups_sessions_by_working_directory() {
        let temp = TempDir::new().expect("temp dir");
        let (cwd, _) = write_fixture(temp.path());

        let projects = scan_projects_from_path(temp.path().to_str().unwrap()).expect("scan");
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].path, format!("{SCHEME}{cwd}"));
        assert_eq!(projects[0].session_count, 1);
        assert_eq!(projects[0].message_count, 3);
        assert_eq!(projects[0].provider.as_deref(), Some(PROVIDER_ID));
    }

    #[test]
    fn load_sessions_and_messages_parse_openai_format() {
        let temp = TempDir::new().expect("temp dir");
        let (cwd, session_dir) = write_fixture(temp.path());
        let base = temp.path().to_str().unwrap();
        let project_path = format!("{SCHEME}{cwd}");

        let sessions =
            load_sessions_from_base_path(base, &project_path, false).expect("load sessions");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].summary.as_deref(), Some("Fix Vibe provider"));
        assert!(sessions[0].is_renamed);
        assert!(sessions[0].has_tool_use);

        let messages = load_messages_from_base_path(base, &session_dir).expect("load messages");
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0].message_type, "user");
        assert_eq!(messages[1].message_type, "assistant");
        assert_eq!(messages[1].content.as_ref().unwrap()[0]["type"], "thinking");
        assert_eq!(messages[2].message_type, "tool");
    }

    #[test]
    fn scan_projects_groups_unified_sessions_by_working_directory() {
        let temp = TempDir::new().expect("temp dir");
        let (cwd, _) = write_unified_fixture(temp.path());

        let projects = scan_projects_from_path(temp.path().to_str().unwrap()).expect("scan");
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].path, format!("{SCHEME}{cwd}"));
        assert_eq!(projects[0].session_count, 1);
        assert_eq!(projects[0].message_count, 4);
        assert_eq!(projects[0].provider.as_deref(), Some(PROVIDER_ID));
    }

    #[test]
    fn load_sessions_and_messages_parse_unified_store() {
        let temp = TempDir::new().expect("temp dir");
        let (cwd, session_dir) = write_unified_fixture(temp.path());
        let base = temp.path().to_str().unwrap();
        let project_path = format!("{SCHEME}{cwd}");

        let sessions =
            load_sessions_from_base_path(base, &project_path, false).expect("load sessions");
        assert_eq!(sessions.len(), 1);
        assert_eq!(
            sessions[0].summary.as_deref(),
            Some("Unified store session")
        );
        assert!(!sessions[0].is_renamed);
        assert!(sessions[0].has_tool_use);
        assert_eq!(sessions[0].message_count, 4);
        assert_eq!(sessions[0].storage_type.as_deref(), Some("json"));

        let messages = load_messages_from_base_path(base, &session_dir).expect("load messages");
        assert_eq!(messages.len(), 4);

        assert_eq!(messages[0].message_type, "user");
        let user_blocks = messages[0].content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(user_blocks[0]["text"], "Lance le serveur en mode dev");
        // Pasted images map to the viewer's base64 image block shape.
        assert_eq!(user_blocks[1]["type"], "image");
        assert_eq!(user_blocks[1]["source"]["media_type"], "image/png");
        assert_eq!(user_blocks[1]["source"]["data"], "aW1hZ2U=");
        // `@file` attachments map to a plain-text document block.
        assert_eq!(user_blocks[2]["type"], "document");
        assert_eq!(user_blocks[2]["title"], "dev.log");
        assert_eq!(user_blocks[2]["source"]["data"], "contenu de dev.log");

        assert_eq!(messages[1].message_type, "assistant");
        let blocks = messages[1].content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(blocks[0]["type"], "thinking");
        assert_eq!(blocks[0]["thinking"], "Je reflechis au build");
        assert_eq!(blocks[1]["type"], "text");

        assert_eq!(messages[2].message_type, "assistant");
        let tool_use = &messages[2].content.as_ref().unwrap()[0];
        assert_eq!(tool_use["type"], "tool_use");
        assert_eq!(tool_use["id"], "call-1");
        assert_eq!(tool_use["name"], "file_system.bash");
        assert_eq!(tool_use["input"], json!({ "command": "just dev" }));

        assert_eq!(messages[3].message_type, "tool");
        let result = &messages[3].content.as_ref().unwrap()[0];
        assert_eq!(result["type"], "tool_result");
        assert_eq!(result["tool_use_id"], "call-1");
        assert_eq!(result["content"], "{\"returncode\":1,\"stderr\":\"boom\"}");
        assert_eq!(result["is_error"], Value::Bool(true));
    }

    #[test]
    /// Without a readable manifest (crashed or in-progress session), every
    /// chunk is read in modification-time order.
    fn load_messages_unified_falls_back_to_all_chunks_without_manifest() {
        let temp = TempDir::new().expect("temp dir");
        let (_cwd, session_dir) = write_unified_fixture(temp.path());
        let session_dir = PathBuf::from(&session_dir);
        let base = temp.path().to_str().unwrap();

        fs::remove_file(session_dir.join(CURRENT_FILE)).expect("remove CURRENT");
        fs::remove_file(
            session_dir
                .join(GENERATIONS_DIR)
                .join("0000000000000042")
                .join(MANIFEST_FILE),
        )
        .expect("remove manifest");

        let messages = load_messages_from_base_path(base, session_dir.to_str().unwrap())
            .expect("load messages");
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[0].message_type, "user");
        assert_eq!(messages[3].message_type, "tool");
    }

    #[test]
    /// A session directory without any message content is not surfaced.
    fn unified_session_without_messages_is_skipped() {
        let temp = TempDir::new().expect("temp dir");
        let session_dir = temp.path().join("logs/session/unified/empty-session");
        fs::create_dir_all(&session_dir).expect("create session dir");
        fs::write(
            session_dir.join(METADATA_FILE),
            json!({
                "session_id": "empty-session",
                "start_time": "2026-10-24T10:00:00+00:00",
                "environment": { "working_directory": "/tmp/vibe-empty" },
            })
            .to_string(),
        )
        .expect("write metadata");

        let projects = scan_projects_from_path(temp.path().to_str().unwrap()).expect("scan");
        assert!(projects.is_empty());
    }

    #[test]
    /// `CURRENT` wins over the lexicographically-latest generation directory.
    fn unified_store_prefers_current_generation() {
        let temp = TempDir::new().expect("temp dir");
        let (_cwd, session_dir) = write_unified_fixture(temp.path());
        let session_dir = PathBuf::from(&session_dir);
        let base = temp.path().to_str().unwrap();

        // An older generation that only knows the first chunk.
        let old_dir = session_dir.join(GENERATIONS_DIR).join("0000000000000007");
        fs::create_dir_all(&old_dir).expect("create old generation");
        fs::write(
            old_dir.join(MANIFEST_FILE),
            json!({
                "manifest_version": 1,
                "generation": "0000000000000007",
                "checkpoint": { "chunks": ["aaa"], "path": "checkpoint.json" },
            })
            .to_string(),
        )
        .expect("write old manifest");

        let messages = load_messages_from_base_path(base, session_dir.to_str().unwrap())
            .expect("load messages");
        assert_eq!(
            messages.len(),
            4,
            "CURRENT points at generation 42 which lists both chunks"
        );
    }

    #[test]
    fn get_base_path_honors_vibe_home() {
        let temp = TempDir::new().expect("temp dir");
        let vibe_home = temp.path().join(".vibe");
        fs::create_dir_all(&vibe_home).expect("create vibe home");

        let original = std::env::var("VIBE_HOME").ok();
        std::env::set_var("VIBE_HOME", &vibe_home);
        let detected = get_base_path().expect("detect vibe home");
        if let Some(value) = original {
            std::env::set_var("VIBE_HOME", value);
        } else {
            std::env::remove_var("VIBE_HOME");
        }

        assert_eq!(
            PathBuf::from(detected),
            vibe_home.canonicalize().unwrap_or(vibe_home)
        );
    }

    #[test]
    /// A corrupt line in messages.jsonl must be skipped, not fail the load —
    /// crashed Vibe sessions can leave a truncated final line.
    fn load_messages_skips_malformed_jsonl_lines() {
        let temp = TempDir::new().expect("temp dir");
        let (_cwd, session_dir) = write_fixture(temp.path());
        let base = temp.path().to_string_lossy().to_string();

        let messages_path = Path::new(&session_dir).join(MESSAGES_FILE);
        let mut content = fs::read_to_string(&messages_path).expect("read messages");
        content.push('\n'); // fixture jsonl has no trailing newline
        content.push_str("{ this is not json\n");
        content.push_str(
            "{\"role\":\"user\",\"content\":\"after corrupt line\",\"message_id\":\"msg-4\"}\n",
        );
        fs::write(&messages_path, content).expect("write messages");

        let messages = load_messages_from_base_path(&base, &session_dir).expect("load messages");
        assert_eq!(
            messages.len(),
            4,
            "corrupt line skipped, valid lines before and after kept"
        );
    }

    #[test]
    /// A torn final chunk (truncated JSON while the session is still being
    /// written) is skipped without failing the whole session load.
    fn load_messages_unified_skips_torn_chunk() {
        let temp = TempDir::new().expect("temp dir");
        let (_cwd, session_dir) = write_unified_fixture(temp.path());
        let session_dir = PathBuf::from(&session_dir);
        let base = temp.path().to_str().unwrap();

        fs::write(
            session_dir.join(CHUNKS_DIR).join("ccc.json"),
            "[{\"message\": {\"role\": \"user\", \"content\": [{\"type\": \"te",
        )
        .expect("write torn chunk");
        // The torn chunk is not referenced by the manifest, so the manifest
        // path is unaffected; force the mtime fallback to prove it is skipped.
        fs::remove_file(session_dir.join(CURRENT_FILE)).expect("remove CURRENT");
        fs::remove_file(
            session_dir
                .join(GENERATIONS_DIR)
                .join("0000000000000042")
                .join(MANIFEST_FILE),
        )
        .expect("remove manifest");

        let messages = load_messages_from_base_path(base, session_dir.to_str().unwrap())
            .expect("load messages");
        assert_eq!(messages.len(), 4, "torn chunk skipped, valid chunks kept");
    }

    #[cfg(unix)]
    #[test]
    /// A symlinked session directory must be rejected by the path guard.
    fn load_messages_rejects_symlinked_session_dir() {
        use std::os::unix::fs as unix_fs;

        let temp = TempDir::new().expect("temp dir");
        let (_cwd, session_dir) = write_fixture(temp.path());
        let base = temp.path().to_string_lossy().to_string();

        // Symlink target is itself a VALID session dir in a foreign root, so a
        // rejection can only come from the path guard, not from missing files.
        let outside = TempDir::new().expect("outside dir");
        let (_ocwd, outside_session) = write_fixture(outside.path());
        let link = temp
            .path()
            .join("logs/session/session_20260202_130000_link");
        unix_fs::symlink(Path::new(&outside_session), &link).expect("create symlink");

        load_messages_from_base_path(&base, &link.to_string_lossy())
            .expect_err("symlinked session dir must be rejected");

        // The real session still loads fine alongside the rejected link.
        assert!(load_messages_from_base_path(&base, &session_dir).is_ok());
    }

    #[cfg(unix)]
    #[test]
    /// A symlinked session directory must be rejected by the path guard, in
    /// the unified layout too.
    fn load_messages_unified_rejects_symlinked_session_dir() {
        use std::os::unix::fs as unix_fs;

        let temp = TempDir::new().expect("temp dir");
        let (_cwd, session_dir) = write_unified_fixture(temp.path());
        let base = temp.path().to_string_lossy().to_string();

        let outside = TempDir::new().expect("outside dir");
        let (_ocwd, outside_session) = write_unified_fixture(outside.path());
        let link = temp.path().join("logs/session/unified/linked-session");
        unix_fs::symlink(Path::new(&outside_session), &link).expect("create symlink");

        load_messages_from_base_path(&base, &link.to_string_lossy())
            .expect_err("symlinked session dir must be rejected");

        assert!(load_messages_from_base_path(&base, &session_dir).is_ok());
    }

    #[test]
    /// Pasted/attached images render: inline sources decode from the record,
    /// file sources are read from the session directory, and paths escaping
    /// the session dir are skipped (issue #438 follow-up).
    fn load_messages_renders_image_attachments() {
        use base64::Engine as _;

        let temp = TempDir::new().expect("temp dir");
        let (_cwd, session_dir) = write_fixture(temp.path());
        let base = temp.path().to_string_lossy().to_string();

        let png_bytes: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        fs::write(Path::new(&session_dir).join("img_1.png"), png_bytes).expect("write snapshot");

        let inline_b64 = base64::engine::general_purpose::STANDARD.encode(b"inline-bytes");
        let record = json!({
            "role": "user",
            "content": "look at these",
            "message_id": "msg-img",
            "images": [
                { "source": { "kind": "inline", "data": inline_b64 }, "alias": "a", "mime_type": "image/jpeg" },
                { "source": { "kind": "file", "path": "img_1.png" }, "alias": "b", "mime_type": "image/png" },
                { "source": { "kind": "file", "path": "../outside.png" }, "alias": "c", "mime_type": "image/png" },
                { "path": "img_1.png", "alias": "legacy-flat", "mime_type": "image/png" }
            ]
        });
        let messages_path = Path::new(&session_dir).join(MESSAGES_FILE);
        let mut content = fs::read_to_string(&messages_path).expect("read messages");
        content.push('\n');
        content.push_str(&record.to_string());
        content.push('\n');
        fs::write(&messages_path, content).expect("write messages");

        let messages = load_messages_from_base_path(&base, &session_dir).expect("load messages");
        let with_images = messages
            .iter()
            .find(|m| m.uuid == "msg-img")
            .expect("image message present");
        let blocks = with_images.content.as_ref().expect("content blocks");
        let image_blocks: Vec<_> = blocks
            .as_array()
            .expect("array")
            .iter()
            .filter(|b| b["type"] == "image")
            .collect();

        // inline + in-dir file + legacy flat = 3; the escaping path is skipped.
        assert_eq!(image_blocks.len(), 3);
        assert_eq!(image_blocks[0]["source"]["media_type"], "image/jpeg");
        assert_eq!(image_blocks[0]["source"]["data"], json!(inline_b64));
        let expected_png = base64::engine::general_purpose::STANDARD.encode(png_bytes);
        assert_eq!(image_blocks[1]["source"]["data"], json!(expected_png));
    }
}
