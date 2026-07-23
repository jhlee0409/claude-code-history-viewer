use super::ProviderInfo;
use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::utils::{
    build_provider_message, detect_git_worktree_info, is_symlink,
    search_json_value_case_insensitive,
};
use chrono::{DateTime, TimeZone, Utc};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const PROVIDER_ID: &str = "kimi-code";
const SESSIONS_DIR: &str = "sessions";
const SESSION_INDEX_FILE: &str = "session_index.jsonl";
const STATE_FILE: &str = "state.json";
const WIRE_FILE: &str = "agents/main/wire.jsonl";

pub fn detect() -> Option<ProviderInfo> {
    let base = get_base_path()?;
    let sessions_path = Path::new(&base).join(SESSIONS_DIR);

    Some(ProviderInfo {
        id: PROVIDER_ID.to_string(),
        display_name: "Kimi Code CLI".to_string(),
        base_path: base,
        is_available: sessions_path.exists() && sessions_path.is_dir(),
    })
}

pub fn get_base_path() -> Option<String> {
    if let Ok(env_val) = std::env::var("KIMI_CODE_HOME") {
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

    let default = dirs::home_dir()?.join(".kimi-code");
    if default.exists() {
        let normalized = default.canonicalize().unwrap_or(default);
        Some(normalized.to_string_lossy().to_string())
    } else {
        None
    }
}

pub fn scan_projects_from_path(base_path: &str) -> Result<Vec<ClaudeProject>, String> {
    crate::utils::require_absolute_path(base_path, "Kimi Code base path")?;
    let base = Path::new(base_path);
    let sessions_root = base.join(SESSIONS_DIR);

    if is_symlink(&sessions_root) || !sessions_root.is_dir() {
        return Ok(Vec::new());
    }

    let canonical_base = canonical_existing(base, "Kimi Code base path")?;
    let mut projects = Vec::new();

    for entry in fs::read_dir(&sessions_root)
        .map_err(|e| format!("Failed to read Kimi Code sessions: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read Kimi Code project entry: {e}"))?;
        if entry
            .file_type()
            .map_or(true, |ft| ft.is_symlink() || !ft.is_dir())
        {
            continue;
        }

        let project_dir = entry.path();
        if !path_is_inside(&project_dir, &canonical_base)? {
            continue;
        }

        let mut infos = Vec::new();
        for session_entry in fs::read_dir(&project_dir)
            .map_err(|e| format!("Failed to read Kimi Code project dir: {e}"))?
        {
            let session_entry = session_entry
                .map_err(|e| format!("Failed to read Kimi Code session entry: {e}"))?;
            if session_entry
                .file_type()
                .map_or(true, |ft| ft.is_symlink() || !ft.is_dir())
            {
                continue;
            }
            if let Some(info) = extract_session_info(base, &session_entry.path()) {
                infos.push(info);
            }
        }

        if infos.is_empty() {
            continue;
        }

        let fallback_name = workdir_key_slug(
            &project_dir
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default(),
        );
        let fallback_name = if fallback_name.is_empty() {
            "kimi-code".to_string()
        } else {
            fallback_name
        };
        let actual_path = infos
            .iter()
            .find_map(|info| info.cwd.clone())
            .unwrap_or_else(|| fallback_name.clone());
        let name = project_name_from_actual_path(&actual_path, &fallback_name);
        let message_count = infos.iter().map(|info| info.message_count).sum();
        let last_modified = infos
            .iter()
            .map(|info| info.last_modified.as_str())
            .max()
            .unwrap_or_default()
            .to_string();

        projects.push(ClaudeProject {
            name,
            path: format!("kimicode://{}", project_dir.to_string_lossy()),
            actual_path: actual_path.clone(),
            session_count: infos.len(),
            message_count,
            last_modified,
            git_info: if Path::new(&actual_path).is_absolute() {
                detect_git_worktree_info(&actual_path)
            } else {
                None
            },
            provider: Some(PROVIDER_ID.to_string()),
            storage_type: Some("jsonl".to_string()),
            custom_directory_label: None,
        });
    }

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let base = get_base_path().ok_or("Kimi Code base path not found")?;
    scan_projects_from_path(&base)
}

pub fn load_sessions(
    project_path: &str,
    exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let base = get_base_path().ok_or("Kimi Code base path not found")?;
    load_sessions_from_base_path(&base, project_path, exclude_sidechain)
}

pub fn load_sessions_from_base_path(
    base_path: &str,
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    crate::utils::require_absolute_path(base_path, "Kimi Code base path")?;
    let base = Path::new(base_path);
    let project_dir = resolve_project_dir(base, project_path)?;
    let canonical_base = canonical_existing(base, "Kimi Code base path")?;
    if !path_is_inside(&project_dir, &canonical_base)? {
        return Err("Kimi Code project path is outside Kimi Code base path".to_string());
    }

    let fallback_project_name = workdir_key_slug(
        &project_dir
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default(),
    );
    let fallback_project_name = if fallback_project_name.is_empty() {
        "kimi-code".to_string()
    } else {
        fallback_project_name
    };

    let mut sessions = Vec::new();
    for entry in fs::read_dir(&project_dir)
        .map_err(|e| format!("Failed to read Kimi Code project dir: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read Kimi Code session entry: {e}"))?;
        if entry
            .file_type()
            .map_or(true, |ft| ft.is_symlink() || !ft.is_dir())
        {
            continue;
        }

        let session_dir = entry.path();
        let Some(info) = extract_session_info(base, &session_dir) else {
            continue;
        };
        let project_name = info
            .cwd
            .as_deref()
            .map(|cwd| project_name_from_actual_path(cwd, &fallback_project_name))
            .unwrap_or_else(|| fallback_project_name.clone());

        sessions.push(ClaudeSession {
            session_id: session_dir.to_string_lossy().to_string(),
            actual_session_id: info.session_id.clone(),
            file_path: session_dir.to_string_lossy().to_string(),
            project_name,
            message_count: info.message_count,
            first_message_time: info.first_message_time,
            last_message_time: info.last_message_time,
            last_modified: info.last_modified,
            has_tool_use: info.has_tool_use,
            has_errors: false,
            summary: info.summary,
            is_renamed: false,
            provider: Some(PROVIDER_ID.to_string()),
            storage_type: Some("jsonl".to_string()),
            entrypoint: None,
        });
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let base = get_base_path().ok_or("Kimi Code base path not found")?;
    load_messages_from_base_path(&base, session_path)
}

pub fn load_messages_from_base_path(
    base_path: &str,
    session_path: &str,
) -> Result<Vec<ClaudeMessage>, String> {
    crate::utils::require_absolute_path(base_path, "Kimi Code base path")?;
    let base = Path::new(base_path);
    let session_dir = PathBuf::from(session_path);
    let canonical_base = canonical_existing(base, "Kimi Code base path")?;
    if !session_dir.is_absolute() || !path_is_inside(&session_dir, &canonical_base)? {
        return Err("Kimi Code session path is outside Kimi Code base path".to_string());
    }
    if is_symlink(&session_dir) || !session_dir.is_dir() {
        return Err("Kimi Code session path is not a directory".to_string());
    }

    let session_id = session_dir
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let values = read_jsonl_values(&session_dir.join(WIRE_FILE))?;
    Ok(convert_wire_events(&values, &session_id).messages)
}

pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let base = get_base_path().ok_or("Kimi Code base path not found")?;
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
}

fn extract_session_info(base: &Path, session_dir: &Path) -> Option<SessionInfo> {
    if is_symlink(session_dir) || !session_dir.is_dir() {
        return None;
    }
    let wire_path = session_dir.join(WIRE_FILE);
    if is_symlink(&wire_path) || !wire_path.is_file() {
        return None;
    }

    let session_id = session_dir.file_name()?.to_string_lossy().to_string();
    let state = read_json_file(&session_dir.join(STATE_FILE)).unwrap_or(Value::Null);
    let title = state
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(ToOwned::to_owned);

    let values = read_jsonl_values(&wire_path).ok()?;
    let converted = convert_wire_events(&values, &session_id);
    if converted.messages.is_empty() {
        return None;
    }

    let cwd = find_work_dir_in_index(base, session_dir)
        .or(converted.cwd_from_system_prompt)
        .or_else(|| {
            session_dir
                .parent()
                .and_then(|parent| parent.file_name())
                .map(|name| workdir_key_slug(&name.to_string_lossy()))
                .filter(|slug| !slug.is_empty())
        });

    let first_user = title
        .is_none()
        .then(|| {
            converted.messages.iter().find_map(|message| {
                if message.message_type != "user" {
                    return None;
                }
                message.content.as_ref().and_then(extract_content_summary)
            })
        })
        .flatten();

    let first_message_time = converted
        .messages
        .first()
        .map(|message| message.timestamp.clone())
        .filter(|ts| !ts.is_empty())
        .or_else(|| {
            state
                .get("createdAt")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .unwrap_or_default();
    let last_message_time = converted
        .messages
        .last()
        .map(|message| message.timestamp.clone())
        .filter(|ts| !ts.is_empty())
        .or_else(|| {
            state
                .get("updatedAt")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| first_message_time.clone());
    let last_modified = if last_message_time.is_empty() {
        file_modified_iso(&wire_path).unwrap_or_default()
    } else {
        last_message_time.clone()
    };

    Some(SessionInfo {
        session_id,
        cwd,
        message_count: converted.messages.len(),
        first_message_time,
        last_message_time,
        last_modified,
        has_tool_use: converted.has_tool_use,
        summary: title.or(first_user),
    })
}

struct ConvertedWire {
    messages: Vec<ClaudeMessage>,
    has_tool_use: bool,
    cwd_from_system_prompt: Option<String>,
}

/// Convert `wire.jsonl` events into provider messages.
///
/// Loop events (`step.begin` / `content.part` / `tool.call` / `step.end`) are
/// aggregated per `stepUuid` and flushed as one assistant message when the
/// matching `step.end` arrives (or at EOF for unterminated steps).
/// `tool.result` becomes a standalone `tool` message. All other event types
/// (`metadata`, `config.update`, `llm.*`, `usage.record`, `tools.*`,
/// `permission.*`, `mcp.*`, `turn.prompt`, `turn.steer`, …) are skipped.
fn convert_wire_events(values: &[Value], session_id: &str) -> ConvertedWire {
    let mut messages = Vec::new();
    let mut counter = 0u64;
    let mut has_tool_use = false;
    let mut cwd_from_system_prompt = None;
    // Insertion-ordered step aggregation.
    let mut step_order: Vec<String> = Vec::new();
    let mut step_blocks: HashMap<String, Vec<Value>> = HashMap::new();
    // tool.result events arrive mid-step (before `step.end`) and carry no
    // `stepUuid`, so they are attributed to the step open at arrival time and
    // buffered — emitting them immediately would place the result BEFORE the
    // assistant message holding its tool_use, the reverse of every other
    // provider's conversation order. Drained right after the step's flush.
    let mut pending_results: Vec<PendingResult> = Vec::new();
    // Timestamp of the most recent event — used when flushing steps that
    // never saw their `step.end` before EOF.
    let mut last_event_time = String::new();

    let next_uuid = |value: &Value, counter: &mut u64| -> String {
        *counter += 1;
        value
            .get("uuid")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| format!("{session_id}-{counter}"))
    };

    for value in values {
        let timestamp = value
            .get("time")
            .and_then(Value::as_f64)
            .and_then(epoch_ms_to_iso)
            .unwrap_or_default();
        if !timestamp.is_empty() {
            last_event_time.clone_from(&timestamp);
        }

        match value.get("type").and_then(Value::as_str).unwrap_or("") {
            "context.append_message" => {
                let message = value.get("message").cloned().unwrap_or(Value::Null);
                if message.get("role").and_then(Value::as_str) != Some("user") {
                    continue;
                }
                let uuid = message
                    .get("uuid")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| next_uuid(value, &mut counter));
                messages.push(build_provider_message(
                    PROVIDER_ID,
                    uuid,
                    session_id,
                    timestamp,
                    "user",
                    Some("user"),
                    Some(content_to_blocks(message.get("content"))),
                    None,
                ));
            }
            "config.update" => {
                if cwd_from_system_prompt.is_none() {
                    cwd_from_system_prompt = value
                        .get("systemPrompt")
                        .and_then(Value::as_str)
                        .and_then(extract_working_directory);
                }
            }
            "context.append_loop_event" => {
                let event = value.get("event").cloned().unwrap_or(Value::Null);
                let step_uuid = event
                    .get("stepUuid")
                    .or_else(|| event.get("uuid"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();

                match event.get("type").and_then(Value::as_str).unwrap_or("") {
                    "step.begin" => {
                        if !step_uuid.is_empty() && !step_blocks.contains_key(&step_uuid) {
                            step_blocks.insert(step_uuid.clone(), Vec::new());
                            step_order.push(step_uuid);
                        }
                    }
                    "content.part" => {
                        let part = event.get("part").cloned().unwrap_or(Value::Null);
                        let block = match part.get("type").and_then(Value::as_str) {
                            Some("think") => Some(json!({
                                "type": "thinking",
                                "thinking": part.get("think").and_then(Value::as_str).unwrap_or("")
                            })),
                            Some("text") => Some(json!({
                                "type": "text",
                                "text": part.get("text").and_then(Value::as_str).unwrap_or("")
                            })),
                            _ => None,
                        };
                        if let (Some(block), false) = (block, step_uuid.is_empty()) {
                            let blocks =
                                step_blocks.entry(step_uuid.clone()).or_insert_with(|| {
                                    step_order.push(step_uuid.clone());
                                    Vec::new()
                                });
                            blocks.push(block);
                        }
                    }
                    "tool.call" => {
                        has_tool_use = true;
                        if !step_uuid.is_empty() {
                            let tool_call_id = event
                                .get("toolCallId")
                                .and_then(Value::as_str)
                                .map(ToOwned::to_owned)
                                .unwrap_or_else(|| next_uuid(&event, &mut counter));
                            let block = json!({
                                "type": "tool_use",
                                "id": tool_call_id,
                                "name": event.get("name").and_then(Value::as_str).unwrap_or("tool"),
                                "input": event.get("args").cloned().unwrap_or(Value::Null)
                            });
                            let blocks =
                                step_blocks.entry(step_uuid.clone()).or_insert_with(|| {
                                    step_order.push(step_uuid.clone());
                                    Vec::new()
                                });
                            blocks.push(block);
                        }
                    }
                    "tool.result" => {
                        let tool_call_id = event
                            .get("toolCallId")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        let output = event
                            .get("result")
                            .and_then(|result| result.get("output"))
                            .cloned()
                            .unwrap_or(Value::Null);
                        let uuid = next_uuid(&event, &mut counter);
                        if let Some(open_step) = step_order.last() {
                            pending_results.push(PendingResult {
                                step_uuid: open_step.clone(),
                                uuid,
                                timestamp,
                                tool_call_id,
                                output,
                            });
                        } else {
                            // No open step (truncated file) — merge into an
                            // earlier assistant message by tool_use id, or
                            // fall back to a standalone tool message.
                            let block = tool_result_block(&tool_call_id, output);
                            if !merge_result_block(&mut messages, &block) {
                                messages.push(build_tool_result_message(
                                    uuid, session_id, timestamp, block,
                                ));
                            }
                        }
                    }
                    "step.end" => {
                        let flushed = flush_step(
                            &step_uuid,
                            &mut step_order,
                            &mut step_blocks,
                            &mut messages,
                            session_id,
                            &timestamp,
                            &mut counter,
                        );
                        drain_step_results(
                            &step_uuid,
                            &mut pending_results,
                            &mut messages,
                            session_id,
                            flushed,
                        );
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    // Flush steps that never saw their `step.end` (e.g. truncated files).
    for step_uuid in std::mem::take(&mut step_order) {
        let flushed = flush_step(
            &step_uuid,
            &mut Vec::new(),
            &mut step_blocks,
            &mut messages,
            session_id,
            &last_event_time,
            &mut counter,
        );
        drain_step_results(
            &step_uuid,
            &mut pending_results,
            &mut messages,
            session_id,
            flushed,
        );
    }
    // Results whose step never began (or whose stepUuid was lost) — merge by
    // tool_use id when possible, else keep them as standalone tool messages
    // in arrival order rather than dropping them.
    for result in std::mem::take(&mut pending_results) {
        let block = tool_result_block(&result.tool_call_id, result.output);
        if !merge_result_block(&mut messages, &block) {
            messages.push(build_tool_result_message(
                result.uuid,
                session_id,
                result.timestamp,
                block,
            ));
        }
    }

    ConvertedWire {
        messages,
        has_tool_use,
        cwd_from_system_prompt,
    }
}

/// A `tool.result` buffered until its step's assistant message is flushed.
struct PendingResult {
    step_uuid: String,
    uuid: String,
    timestamp: String,
    tool_call_id: String,
    output: Value,
}

fn tool_result_block(tool_call_id: &str, output: Value) -> Value {
    json!({
        "type": "tool_result",
        "tool_use_id": tool_call_id,
        "content": output
    })
}

/// Append a `tool_result` block to the most recent assistant message holding
/// the matching `tool_use` (same convention as codex / `copilot_cli`), so the
/// unified tool card renders call and result together. Returns false when no
/// earlier message carries that `tool_use`.
fn merge_result_block(messages: &mut [ClaudeMessage], block: &Value) -> bool {
    let tool_use_id = block
        .get("tool_use_id")
        .and_then(Value::as_str)
        .unwrap_or("");
    for prev in messages.iter_mut().rev() {
        if prev.message_type != "assistant" {
            continue;
        }
        let has_matching_tool_use = prev
            .content
            .as_ref()
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter().any(|item| {
                    item.get("type").and_then(Value::as_str) == Some("tool_use")
                        && item.get("id").and_then(Value::as_str) == Some(tool_use_id)
                })
            })
            .unwrap_or(false);
        if has_matching_tool_use {
            append_content_block(prev, block.clone());
            return true;
        }
    }
    false
}

fn append_content_block(message: &mut ClaudeMessage, block: Value) {
    match &mut message.content {
        Some(Value::Array(arr)) => arr.push(block),
        other => *other = Some(Value::Array(vec![block])),
    }
}

/// Fallback for results that no assistant message claims: a standalone
/// `tool` message (same shape as legacy kimi / vibe).
fn build_tool_result_message(
    uuid: String,
    session_id: &str,
    timestamp: String,
    block: Value,
) -> ClaudeMessage {
    build_provider_message(
        PROVIDER_ID,
        uuid,
        session_id,
        timestamp,
        "tool",
        Some("tool"),
        Some(Value::Array(vec![block])),
        None,
    )
}

/// Drain buffered tool results belonging to `step_uuid`, preserving arrival
/// order. Called right after the step's flush; `flushed` is the index of the
/// step's assistant message when one was emitted.
fn drain_step_results(
    step_uuid: &str,
    pending_results: &mut Vec<PendingResult>,
    messages: &mut Vec<ClaudeMessage>,
    session_id: &str,
    flushed: Option<usize>,
) {
    let mut i = 0;
    while i < pending_results.len() {
        if pending_results[i].step_uuid != step_uuid {
            i += 1;
            continue;
        }
        let result = pending_results.remove(i);
        let block = tool_result_block(&result.tool_call_id, result.output);
        let merged_into_step = match flushed {
            Some(idx) => merge_result_block(&mut messages[idx..=idx], &block),
            None => false,
        };
        if !merged_into_step && !merge_result_block(messages, &block) {
            messages.push(build_tool_result_message(
                result.uuid,
                session_id,
                result.timestamp,
                block,
            ));
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn flush_step(
    step_uuid: &str,
    step_order: &mut Vec<String>,
    step_blocks: &mut HashMap<String, Vec<Value>>,
    messages: &mut Vec<ClaudeMessage>,
    session_id: &str,
    timestamp: &str,
    counter: &mut u64,
) -> Option<usize> {
    let blocks = step_blocks.remove(step_uuid)?;
    step_order.retain(|uuid| uuid != step_uuid);
    if blocks.is_empty() {
        return None;
    }
    *counter += 1;
    messages.push(build_provider_message(
        PROVIDER_ID,
        format!("{session_id}-{counter}"),
        session_id,
        timestamp.to_string(),
        "assistant",
        Some("assistant"),
        Some(Value::Array(blocks)),
        None,
    ));
    Some(messages.len() - 1)
}

/// Look up the session's `workDir` in `session_index.jsonl` by matching the
/// `sessionDir` entry (compared canonicalized on both sides).
fn find_work_dir_in_index(base: &Path, session_dir: &Path) -> Option<String> {
    let index_path = base.join(SESSION_INDEX_FILE);
    if is_symlink(&index_path) || !index_path.is_file() {
        return None;
    }
    let canonical_session = session_dir
        .canonicalize()
        .unwrap_or_else(|_| session_dir.to_path_buf());

    for value in read_jsonl_values(&index_path).ok()? {
        let entry_dir = value
            .get("sessionDir")
            .and_then(Value::as_str)
            .unwrap_or("");
        if entry_dir.is_empty() {
            continue;
        }
        let entry_path = PathBuf::from(entry_dir);
        let canonical_entry = entry_path.canonicalize().unwrap_or(entry_path);
        if canonical_entry == canonical_session {
            return value
                .get("workDir")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
        }
    }
    None
}

/// Extract the human-readable slug from a `wd_<slug>_<sha256-12>` key.
fn workdir_key_slug(key: &str) -> String {
    let stripped = key.strip_prefix("wd_").unwrap_or(key);
    match stripped.rsplit_once('_') {
        Some((slug, hash)) if hash.len() == 12 && hash.chars().all(|c| c.is_ascii_hexdigit()) => {
            slug.to_string()
        }
        _ => stripped.to_string(),
    }
}

/// Normalize user message content. Pure-text content becomes a plain string
/// (Claude's simple string format) — wrapping a lone text block in an array
/// renders the same text twice in the UI (bubble + text box), because the
/// array renderer's `skipText` dedup only applies to assistant messages.
fn content_to_blocks(content: Option<&Value>) -> Value {
    match content {
        Some(Value::Array(items)) => {
            if let [item] = items.as_slice() {
                if item.get("type").and_then(Value::as_str) == Some("text") {
                    if let Some(text) = item.get("text").and_then(Value::as_str) {
                        return Value::String(text.to_string());
                    }
                }
            }
            Value::Array(items.iter().map(normalize_content_block).collect())
        }
        Some(Value::String(text)) => Value::String(text.clone()),
        Some(Value::Null) | None => Value::Array(Vec::new()),
        Some(other) => Value::String(other.to_string()),
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

fn extract_content_summary(content: &Value) -> Option<String> {
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

fn extract_working_directory(system_prompt: &str) -> Option<String> {
    const MARKER: &str = "The current working directory is `";
    let start = system_prompt.find(MARKER)? + MARKER.len();
    let rest = &system_prompt[start..];
    let end = rest.find('`')?;
    let cwd = &rest[..end];
    if is_absolute_working_directory(cwd) {
        Some(cwd.to_string())
    } else {
        None
    }
}

fn is_absolute_working_directory(cwd: &str) -> bool {
    Path::new(cwd).is_absolute() || looks_like_windows_absolute_path(cwd)
}

fn looks_like_windows_absolute_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    // Drive-letter path: C:\ or C:/
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/')
    {
        return true;
    }
    // UNC path: \\server\share or //server/share
    if bytes.len() >= 2 && matches!(bytes[0], b'\\' | b'/') && bytes[0] == bytes[1] {
        return true;
    }
    false
}

fn read_json_file(path: &Path) -> Result<Value, String> {
    if is_symlink(path) {
        return Err("Refusing to read symlinked Kimi Code JSON file".to_string());
    }
    let content = fs::read_to_string(path).map_err(|e| format!("Failed to read JSON file: {e}"))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse JSON file: {e}"))
}

fn read_jsonl_values(path: &Path) -> Result<Vec<Value>, String> {
    if is_symlink(path) {
        return Err("Refusing to read symlinked Kimi Code JSONL file".to_string());
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

/// Epoch **milliseconds** → RFC3339 (the `time` field in `wire.jsonl` is in
/// milliseconds, unlike the seconds-based timestamps of other providers).
fn epoch_ms_to_iso(millis: f64) -> Option<String> {
    // Valid range: 1970-2100 (Unix milliseconds 0 ~ 4_102_444_800_000)
    if !(0.0..=4_102_444_800_000.0).contains(&millis) {
        return None;
    }
    let whole = millis.trunc() as i64;
    Utc.timestamp_millis_opt(whole)
        .single()
        .map(|dt| dt.to_rfc3339())
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

fn resolve_project_dir(base: &Path, project_path: &str) -> Result<PathBuf, String> {
    let raw = project_path
        .strip_prefix("kimicode://")
        .unwrap_or(project_path);
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err("Kimi Code project path must be absolute".to_string());
    }
    if is_symlink(&path) || !path.is_dir() {
        return Err("Kimi Code project path is not a directory".to_string());
    }
    let sessions_root = base.join(SESSIONS_DIR);
    if !path.starts_with(&sessions_root) {
        return Err("Kimi Code project path is outside Kimi Code sessions directory".to_string());
    }
    Ok(path)
}

fn canonical_existing(path: &Path, label: &str) -> Result<PathBuf, String> {
    path.canonicalize()
        .map_err(|e| format!("Failed to resolve {label}: {e}"))
}

fn path_is_inside(path: &Path, canonical_base: &Path) -> Result<bool, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve path: {e}"))?;
    Ok(canonical.starts_with(canonical_base))
}

fn project_name_from_actual_path(actual_path: &str, fallback: &str) -> String {
    Path::new(actual_path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::fs;
    use tempfile::TempDir;

    struct EnvVarGuard {
        key: &'static str,
        original: Option<std::ffi::OsString>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: std::ffi::OsString) -> Self {
            let original = std::env::var_os(key);
            std::env::set_var(key, value);
            Self { key, original }
        }

        fn remove(key: &'static str) -> Self {
            let original = std::env::var_os(key);
            std::env::remove_var(key);
            Self { key, original }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            if let Some(value) = self.original.as_ref() {
                std::env::set_var(self.key, value);
            } else {
                std::env::remove_var(self.key);
            }
        }
    }

    #[test]
    fn epoch_ms_to_iso_converts_millisecond_timestamps() {
        assert_eq!(
            epoch_ms_to_iso(1_784_600_295_956.0).as_deref(),
            Some("2026-07-21T02:18:15.956+00:00")
        );
        assert_eq!(
            epoch_ms_to_iso(0.0).as_deref(),
            Some("1970-01-01T00:00:00+00:00")
        );
    }

    #[test]
    fn epoch_ms_to_iso_rejects_out_of_range_values() {
        assert!(epoch_ms_to_iso(-1.0).is_none());
        assert!(epoch_ms_to_iso(4_102_444_800_001.0).is_none());
    }

    #[test]
    fn extract_working_directory_reads_marker_from_system_prompt() {
        let prompt = "You are Kimi Code CLI.\nThe current working directory is `/Users/max/repo`.\nMore text.";
        assert_eq!(
            extract_working_directory(prompt).as_deref(),
            Some("/Users/max/repo")
        );
    }

    #[test]
    fn workdir_key_slug_strips_prefix_and_hash() {
        assert_eq!(
            workdir_key_slug("wd_claude-code-haha_83f822167b2e"),
            "claude-code-haha"
        );
        assert_eq!(workdir_key_slug("wd_plain"), "plain");
        assert_eq!(workdir_key_slug("wd_a_b_nothex12zz"), "a_b_nothex12zz");
    }

    #[test]
    #[serial]
    fn get_base_path_prefers_kimi_code_home_env() {
        let temp = TempDir::new().unwrap();
        let base_dir = temp.path().join("kimi-code-home");
        fs::create_dir_all(&base_dir).unwrap();
        let _env = EnvVarGuard::set("KIMI_CODE_HOME", base_dir.as_os_str().to_owned());
        let path = get_base_path().unwrap();
        assert_eq!(
            std::path::PathBuf::from(path),
            base_dir.canonicalize().unwrap()
        );
    }

    #[test]
    #[serial]
    fn get_base_path_returns_none_when_default_dir_absent() {
        let _env = EnvVarGuard::remove("KIMI_CODE_HOME");
        if dirs::home_dir()
            .map(|h| h.join(".kimi-code").exists())
            .unwrap_or(false)
        {
            return;
        }
        assert!(get_base_path().is_none());
    }

    #[test]
    fn find_work_dir_in_index_matches_session_dir() {
        let temp = TempDir::new().unwrap();
        let base = temp.path();
        let session_dir = base
            .join("sessions")
            .join("wd_demo-project_a1b2c3d4e5f6")
            .join("session_abc");
        fs::create_dir_all(&session_dir).unwrap();
        fs::write(
            base.join(SESSION_INDEX_FILE),
            format!(
                "{{\"sessionId\":\"session_other\",\"sessionDir\":\"/somewhere/else\",\"workDir\":\"/other\"}}\n{{\"sessionId\":\"session_abc\",\"sessionDir\":\"{}\",\"workDir\":\"/Users/dev/demo-project\"}}\n",
                session_dir.display()
            ),
        )
        .unwrap();

        assert_eq!(
            find_work_dir_in_index(base, &session_dir).as_deref(),
            Some("/Users/dev/demo-project")
        );
        assert!(find_work_dir_in_index(base, &base.join("sessions")).is_none());
    }
}
