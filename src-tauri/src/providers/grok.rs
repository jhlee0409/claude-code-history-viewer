use super::ProviderInfo;
use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession, TokenUsage};
use crate::utils::{
    build_provider_message, detect_git_worktree_info, is_symlink,
    search_json_value_case_insensitive,
};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

const PROVIDER_ID: &str = "grok";
const SESSIONS_DIR: &str = "sessions";
const SUMMARY_FILE: &str = "summary.json";
const CHAT_HISTORY_FILE: &str = "chat_history.jsonl";

pub fn detect() -> Option<ProviderInfo> {
    let base = get_base_path()?;
    let sessions_path = Path::new(&base).join(SESSIONS_DIR);

    Some(ProviderInfo {
        id: PROVIDER_ID.to_string(),
        display_name: "Grok CLI".to_string(),
        base_path: base,
        is_available: sessions_path.exists() && sessions_path.is_dir(),
    })
}

pub fn get_base_path() -> Option<String> {
    if let Ok(env_val) = std::env::var("GROK_HOME") {
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

    let default = crate::utils::home_dir()?.join(".grok");
    if default.exists() {
        let normalized = default.canonicalize().unwrap_or(default);
        Some(normalized.to_string_lossy().to_string())
    } else {
        None
    }
}

pub fn scan_projects_from_path(base_path: &str) -> Result<Vec<ClaudeProject>, String> {
    crate::utils::require_absolute_path(base_path, "Grok base path")?;
    let base = Path::new(base_path);
    let sessions_root = base.join(SESSIONS_DIR);

    if is_symlink(&sessions_root) || !sessions_root.is_dir() {
        return Ok(Vec::new());
    }

    let canonical_base = canonical_existing(base, "Grok base path")?;
    let mut projects = Vec::new();

    for entry in
        fs::read_dir(&sessions_root).map_err(|e| format!("Failed to read Grok sessions: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read Grok project entry: {e}"))?;
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
            .map_err(|e| format!("Failed to read Grok project dir: {e}"))?
        {
            let session_entry =
                session_entry.map_err(|e| format!("Failed to read Grok session entry: {e}"))?;
            if session_entry
                .file_type()
                .map_or(true, |ft| ft.is_symlink() || !ft.is_dir())
            {
                continue;
            }
            if let Some(info) = extract_session_info(&session_entry.path()) {
                infos.push(info);
            }
        }

        if infos.is_empty() {
            continue;
        }

        let encoded_name = project_dir
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "grok".to_string());
        let actual_path = infos
            .iter()
            .find_map(|info| info.cwd.clone())
            .unwrap_or_else(|| decode_cwd_dirname(&encoded_name));
        let name = project_name_from_actual_path(&actual_path, &encoded_name);
        let message_count = infos.iter().map(|info| info.message_count).sum();
        let last_modified = infos
            .iter()
            .map(|info| info.last_modified.as_str())
            .max()
            .unwrap_or_default()
            .to_string();

        let project_uri_path = project_dir
            .canonicalize()
            .unwrap_or_else(|_| project_dir.clone());

        projects.push(ClaudeProject {
            name,
            path: format!("grok://{}", project_uri_path.to_string_lossy()),
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
    let base = get_base_path().ok_or("Grok base path not found")?;
    scan_projects_from_path(&base)
}

pub fn load_sessions(
    project_path: &str,
    exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let base = get_base_path().ok_or("Grok base path not found")?;
    load_sessions_from_base_path(&base, project_path, exclude_sidechain)
}

pub fn load_sessions_from_base_path(
    base_path: &str,
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    crate::utils::require_absolute_path(base_path, "Grok base path")?;
    let base = Path::new(base_path);
    let project_dir = resolve_project_dir(base, project_path)?;
    let canonical_base = canonical_existing(base, "Grok base path")?;
    if !path_is_inside(&project_dir, &canonical_base)? {
        return Err("Grok project path is outside Grok base path".to_string());
    }

    let fallback_project_name = project_dir
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "grok".to_string());

    let mut sessions = Vec::new();
    for entry in
        fs::read_dir(&project_dir).map_err(|e| format!("Failed to read Grok project dir: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read Grok session entry: {e}"))?;
        if entry
            .file_type()
            .map_or(true, |ft| ft.is_symlink() || !ft.is_dir())
        {
            continue;
        }

        let session_dir = entry.path();
        let Some(info) = extract_session_info(&session_dir) else {
            continue;
        };
        let project_name = info
            .cwd
            .as_deref()
            .map(|cwd| project_name_from_actual_path(cwd, &fallback_project_name))
            .unwrap_or_else(|| {
                project_name_from_actual_path(
                    &decode_cwd_dirname(&fallback_project_name),
                    &fallback_project_name,
                )
            });

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
    let base = get_base_path().ok_or("Grok base path not found")?;
    load_messages_from_base_path(&base, session_path)
}

pub fn load_messages_from_base_path(
    base_path: &str,
    session_path: &str,
) -> Result<Vec<ClaudeMessage>, String> {
    crate::utils::require_absolute_path(base_path, "Grok base path")?;
    let base = Path::new(base_path);
    let session_dir = PathBuf::from(session_path);
    let canonical_base = canonical_existing(base, "Grok base path")?;
    if !session_dir.is_absolute() || !path_is_inside(&session_dir, &canonical_base)? {
        return Err("Grok session path is outside Grok base path".to_string());
    }
    if is_symlink(&session_dir) || !session_dir.is_dir() {
        return Err("Grok session path is not a directory".to_string());
    }

    let session_id = session_dir
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let summary = read_json_file(&session_dir.join(SUMMARY_FILE)).unwrap_or(Value::Null);
    let created_at = summary
        .get("created_at")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let updated_at = summary
        .get("updated_at")
        .or_else(|| summary.get("last_active_at"))
        .and_then(Value::as_str)
        .unwrap_or(created_at.as_str())
        .to_string();
    let model = summary
        .get("current_model_id")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);

    let mut messages = Vec::new();
    let mut counter = 0u64;

    for value in read_jsonl_values(&session_dir.join(CHAT_HISTORY_FILE))? {
        if let Some(message) = convert_chat_message(
            &value,
            &session_id,
            &created_at,
            model.clone(),
            &mut counter,
        ) {
            messages.push(message);
        }
    }

    if let Some(last) = messages.last_mut() {
        if !updated_at.is_empty() {
            last.timestamp.clone_from(&updated_at);
        }
    }

    attach_session_token_usage(&session_dir, &mut messages);

    Ok(messages)
}

pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let base = get_base_path().ok_or("Grok base path not found")?;
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
        let sessions = match load_sessions_from_base_path(base_path, &project.path, false) {
            Ok(sessions) => sessions,
            Err(error) => {
                log::warn!(
                    "Skipping unreadable Grok project during search {}: {error}",
                    project.path
                );
                continue;
            }
        };
        for session in sessions {
            let messages = match load_messages_from_base_path(base_path, &session.file_path) {
                Ok(messages) => messages,
                Err(error) => {
                    log::warn!(
                        "Skipping unreadable Grok session during search {}: {error}",
                        session.file_path
                    );
                    continue;
                }
            };
            for mut message in messages {
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

fn extract_session_info(session_dir: &Path) -> Option<SessionInfo> {
    if is_symlink(session_dir) || !session_dir.is_dir() {
        return None;
    }
    let summary_path = session_dir.join(SUMMARY_FILE);
    let chat_path = session_dir.join(CHAT_HISTORY_FILE);
    if is_symlink(&summary_path) || !summary_path.is_file() {
        return None;
    }
    if is_symlink(&chat_path) || !chat_path.is_file() {
        return None;
    }

    let summary = read_json_file(&summary_path).ok()?;
    let session_id = summary
        .pointer("/info/id")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .or_else(|| {
            session_dir
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
        })?;

    let cwd = summary
        .pointer("/info/cwd")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|cwd| !cwd.is_empty())
        .map(ToOwned::to_owned);

    let title = summary
        .get("generated_title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .or_else(|| {
            summary
                .get("session_summary")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|title| !title.is_empty())
        })
        .map(ToOwned::to_owned);

    let created_at = summary
        .get("created_at")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let updated_at = summary
        .get("updated_at")
        .or_else(|| summary.get("last_active_at"))
        .and_then(Value::as_str)
        .unwrap_or(created_at.as_str())
        .to_string();

    let mut message_count = summary
        .get("num_chat_messages")
        .or_else(|| summary.get("num_messages"))
        .and_then(Value::as_u64)
        .map(|n| n as usize)
        .unwrap_or(0);

    let signals = read_json_file(&session_dir.join("signals.json")).unwrap_or(Value::Null);
    let mut has_tool_use = signals
        .get("toolCallCount")
        .and_then(Value::as_u64)
        .is_some_and(|n| n > 0);

    if message_count == 0 {
        if let Ok(values) = read_jsonl_values(&chat_path) {
            message_count = values
                .iter()
                .filter(|value| {
                    matches!(
                        value.get("type").and_then(Value::as_str),
                        Some("user" | "assistant" | "tool_result" | "reasoning" | "system")
                    )
                })
                .count();
            if !has_tool_use {
                has_tool_use = values.iter().any(value_has_tool_use);
            }
        }
    } else if !has_tool_use {
        has_tool_use = chat_history_has_tool_use(&chat_path);
    }

    if message_count == 0 {
        return None;
    }

    let last_modified = if updated_at.is_empty() {
        file_modified_iso(&summary_path).unwrap_or_default()
    } else {
        updated_at.clone()
    };

    Some(SessionInfo {
        session_id,
        cwd,
        message_count,
        first_message_time: created_at,
        last_message_time: updated_at,
        last_modified,
        has_tool_use,
        summary: title,
    })
}

fn convert_chat_message(
    value: &Value,
    session_id: &str,
    timestamp: &str,
    model: Option<String>,
    counter: &mut u64,
) -> Option<ClaudeMessage> {
    let msg_type = value.get("type").and_then(Value::as_str)?;
    *counter += 1;
    let uuid = value
        .get("id")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("{session_id}-{counter}"));

    match msg_type {
        "system" => {
            let content = content_to_blocks(value.get("content"));
            if content_is_empty(&content) {
                return None;
            }
            Some(build_provider_message(
                PROVIDER_ID,
                uuid,
                session_id,
                timestamp.to_string(),
                "system",
                Some("system"),
                Some(content),
                None,
            ))
        }
        "user" => Some(build_provider_message(
            PROVIDER_ID,
            uuid,
            session_id,
            timestamp.to_string(),
            "user",
            Some("user"),
            Some(content_to_blocks(value.get("content"))),
            None,
        )),
        "assistant" => {
            let mut blocks = content_to_blocks(value.get("content"));
            if let Some(calls) = value.get("tool_calls").and_then(Value::as_array) {
                if let Some(arr) = blocks.as_array_mut() {
                    for call in calls {
                        arr.push(convert_tool_call(call));
                    }
                }
            }
            let model_id = value
                .get("model_id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
                .or(model);
            Some(build_provider_message(
                PROVIDER_ID,
                uuid,
                session_id,
                timestamp.to_string(),
                "assistant",
                Some("assistant"),
                Some(blocks),
                model_id,
            ))
        }
        "reasoning" => {
            let thinking = extract_reasoning_text(value);
            if thinking.trim().is_empty() {
                return None;
            }
            Some(build_provider_message(
                PROVIDER_ID,
                uuid,
                session_id,
                timestamp.to_string(),
                "assistant",
                Some("assistant"),
                Some(json!([{ "type": "thinking", "thinking": thinking }])),
                model,
            ))
        }
        "tool_result" => Some(build_provider_message(
            PROVIDER_ID,
            uuid,
            session_id,
            timestamp.to_string(),
            "user",
            Some("user"),
            Some(json!([{
                "type": "tool_result",
                "tool_use_id": value.get("tool_call_id").and_then(Value::as_str).unwrap_or(""),
                "content": value.get("content").cloned().unwrap_or(Value::Null)
            }])),
            None,
        )),
        "backend_tool_call" => convert_backend_tool_call(value, &uuid, session_id, timestamp),
        _ => None,
    }
}

fn convert_backend_tool_call(
    value: &Value,
    uuid: &str,
    session_id: &str,
    timestamp: &str,
) -> Option<ClaudeMessage> {
    let kind = value.get("kind")?;
    let name = kind
        .get("tool_type")
        .and_then(Value::as_str)
        .unwrap_or("backend_tool");
    Some(build_provider_message(
        PROVIDER_ID,
        uuid.to_string(),
        session_id,
        timestamp.to_string(),
        "assistant",
        Some("assistant"),
        Some(json!([{
            "type": "tool_use",
            "id": uuid,
            "name": name,
            "input": kind.get("action").cloned().unwrap_or_else(|| kind.clone())
        }])),
        None,
    ))
}

fn extract_reasoning_text(value: &Value) -> String {
    if let Some(text) = value.get("content").and_then(Value::as_str) {
        return text.to_string();
    }
    if let Some(text) = value.get("thinking").and_then(Value::as_str) {
        return text.to_string();
    }
    if let Some(items) = value.get("summary").and_then(Value::as_array) {
        return items
            .iter()
            .filter_map(|item| {
                item.get("text")
                    .and_then(Value::as_str)
                    .or_else(|| item.as_str())
            })
            .collect::<Vec<_>>()
            .join("\n");
    }
    String::new()
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
    item.clone()
}

fn content_is_empty(content: &Value) -> bool {
    match content {
        Value::Array(items) => {
            items.is_empty()
                || items.iter().all(|item| {
                    item.get("text")
                        .and_then(Value::as_str)
                        .map_or(true, |text| text.trim().is_empty())
                })
        }
        Value::String(text) => text.trim().is_empty(),
        Value::Null => true,
        _ => false,
    }
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
        serde_json::from_str(s).unwrap_or_else(|_| json!({ "input": s }))
    } else {
        input
    }
}

fn decode_cwd_dirname(encoded: &str) -> String {
    urlencoding::decode(encoded)
        .map(std::borrow::Cow::into_owned)
        .unwrap_or_else(|_| encoded.to_string())
}

fn attach_session_token_usage(session_dir: &Path, messages: &mut [ClaudeMessage]) {
    if messages.is_empty() {
        return;
    }

    let signals = read_json_file(&session_dir.join("signals.json")).unwrap_or(Value::Null);
    let tokens = signals
        .get("contextTokensUsed")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    if tokens == 0 {
        return;
    }

    let fallback_model = signals
        .get("primaryModelId")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);

    let capped = u32::try_from(tokens.min(u64::from(u32::MAX))).unwrap_or(u32::MAX);
    if let Some(message) = messages
        .iter_mut()
        .rev()
        .find(|message| message.message_type == "assistant")
    {
        // Grok exposes contextTokensUsed as a session-level context snapshot,
        // not per-response billing. The shared message schema has no context
        // field, so retain it as an explicitly approximate input count for
        // aggregate analytics.
        message.usage = Some(TokenUsage {
            input_tokens: Some(capped),
            output_tokens: None,
            cache_creation_input_tokens: None,
            cache_read_input_tokens: None,
            reasoning_tokens: None,
            service_tier: None,
            ..Default::default()
        });
        if message.model.is_none() {
            message.model = fallback_model;
        }
    }
}

fn read_json_file(path: &Path) -> Result<Value, String> {
    if is_symlink(path) {
        return Err("Refusing to read symlinked Grok JSON file".to_string());
    }
    let content = fs::read_to_string(path).map_err(|e| format!("Failed to read JSON file: {e}"))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse JSON file: {e}"))
}

fn read_jsonl_values(path: &Path) -> Result<Vec<Value>, String> {
    if is_symlink(path) {
        return Err("Refusing to read symlinked Grok JSONL file".to_string());
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

fn value_has_tool_use(value: &Value) -> bool {
    matches!(
        value.get("type").and_then(Value::as_str),
        Some("tool_result" | "backend_tool_call")
    ) || value
        .get("tool_calls")
        .and_then(Value::as_array)
        .is_some_and(|calls| !calls.is_empty())
}

fn chat_history_has_tool_use(path: &Path) -> bool {
    use std::io::{BufRead, BufReader};

    if is_symlink(path) || !path.is_file() {
        return false;
    }
    let Ok(file) = fs::File::open(path) else {
        return false;
    };
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(&line) {
            if value_has_tool_use(&value) {
                return true;
            }
        }
    }
    false
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
    let raw = project_path.strip_prefix("grok://").unwrap_or(project_path);
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err("Grok project path must be absolute".to_string());
    }
    if is_symlink(&path) || !path.is_dir() {
        return Err("Grok project path is not a directory".to_string());
    }

    let canonical_base = canonical_existing(base, "Grok base path")?;
    let sessions_root = canonical_base.join(SESSIONS_DIR);
    let canonical_sessions = sessions_root
        .canonicalize()
        .unwrap_or_else(|_| sessions_root.clone());
    let canonical_path = path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve Grok project path: {e}"))?;
    if !canonical_path.starts_with(&canonical_sessions) {
        return Err("Grok project path is outside Grok sessions directory".to_string());
    }
    Ok(canonical_path)
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

    fn write_fixture(root: &Path) -> (PathBuf, PathBuf) {
        let encoded = "%2FUsers%2Ftest%2Fdemo";
        let session_id = "019fa555-791c-71e2-8c92-ff2e6fa26d6e";
        let project_dir = root.join("sessions").join(encoded);
        let session_dir = project_dir.join(session_id);
        fs::create_dir_all(&session_dir).unwrap();

        let summary = json!({
            "info": {
                "id": session_id,
                "cwd": "/Users/test/demo"
            },
            "session_summary": "Demo session",
            "generated_title": "Demo Title",
            "created_at": "2026-07-27T20:47:50Z",
            "updated_at": "2026-07-27T21:11:25Z",
            "num_chat_messages": 4,
            "current_model_id": "grok-4.5"
        });
        fs::write(
            session_dir.join(SUMMARY_FILE),
            serde_json::to_string_pretty(&summary).unwrap(),
        )
        .unwrap();

        let lines = [
            r#"{"type":"system","content":"You are Grok."}"#,
            r#"{"type":"user","content":[{"type":"text","text":"Hello grok"}]}"#,
            r#"{"type":"reasoning","id":"rs_1","summary":[{"type":"summary_text","text":"Thinking about hello"}]}"#,
            r#"{"type":"assistant","content":"Hi there","tool_calls":[{"id":"call-1","name":"read_file","arguments":"{\"target_file\":\"/tmp/a.txt\"}"}],"model_id":"grok-4.5"}"#,
            r#"{"type":"tool_result","tool_call_id":"call-1","content":"file contents"}"#,
            r#"{"type":"backend_tool_call","kind":{"tool_type":"web_search","action":{"type":"search","query":"rust"}}}"#,
            r#"{"type":"assistant","content":"Final answer","model_id":"grok-4.5"}"#,
            r"not-json",
        ];
        fs::write(session_dir.join(CHAT_HISTORY_FILE), lines.join("\n")).unwrap();
        fs::write(
            session_dir.join("signals.json"),
            serde_json::to_string_pretty(&json!({
                "contextTokensUsed": 12345,
                "toolCallCount": 3,
                "primaryModelId": "grok-4.5",
                "modelsUsed": ["grok-4.5"]
            }))
            .unwrap(),
        )
        .unwrap();

        (project_dir, session_dir)
    }

    #[test]
    fn decode_cwd_dirname_percent_decodes_paths() {
        assert_eq!(
            decode_cwd_dirname("%2FUsers%2Flucashr%2FDownloads"),
            "/Users/lucashr/Downloads"
        );
    }

    #[test]
    #[serial]
    fn get_base_path_prefers_grok_home() {
        let temp = TempDir::new().unwrap();
        let home_dir = temp.path().join("grok-home");
        fs::create_dir_all(&home_dir).unwrap();
        let _env = EnvVarGuard::set("GROK_HOME", home_dir.as_os_str().to_owned());
        let path = get_base_path().unwrap();
        assert_eq!(PathBuf::from(path), home_dir.canonicalize().unwrap());
    }

    #[test]
    #[serial]
    fn get_base_path_returns_none_when_default_dir_absent() {
        let _env = EnvVarGuard::remove("GROK_HOME");
        if dirs::home_dir()
            .map(|h| h.join(".grok").exists())
            .unwrap_or(false)
        {
            return;
        }
        assert!(get_base_path().is_none());
    }

    #[test]
    #[serial]
    fn scan_load_and_search_fixture_session() {
        let temp = TempDir::new().unwrap();
        let (_project_dir, session_dir) = write_fixture(temp.path());
        let _env = EnvVarGuard::set("GROK_HOME", temp.path().as_os_str().to_owned());

        let projects = scan_projects().unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].provider.as_deref(), Some("grok"));
        assert_eq!(projects[0].actual_path, "/Users/test/demo");
        assert_eq!(projects[0].name, "demo");
        assert!(projects[0].path.starts_with("grok://"));

        let sessions = load_sessions(&projects[0].path, false).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(
            sessions[0].actual_session_id,
            "019fa555-791c-71e2-8c92-ff2e6fa26d6e"
        );
        assert_eq!(sessions[0].summary.as_deref(), Some("Demo Title"));
        assert!(sessions[0].has_tool_use);

        let messages = load_messages(&session_dir.to_string_lossy()).unwrap();
        assert!(messages.len() >= 5);
        assert!(messages.iter().any(|m| m.message_type == "user"));
        assert!(messages.iter().any(|m| {
            m.content
                .as_ref()
                .and_then(|c| c.as_array())
                .is_some_and(|arr| {
                    arr.iter()
                        .any(|item| item.get("type").and_then(Value::as_str) == Some("thinking"))
                })
        }));
        assert!(messages.iter().any(|m| {
            m.content
                .as_ref()
                .and_then(|c| c.as_array())
                .is_some_and(|arr| {
                    arr.iter()
                        .any(|item| item.get("type").and_then(Value::as_str) == Some("tool_use"))
                })
        }));
        assert!(messages.iter().any(|m| {
            m.usage
                .as_ref()
                .and_then(|usage| usage.input_tokens)
                .is_some_and(|tokens| tokens == 12345)
        }));
        let usage_message = messages
            .iter()
            .find(|message| message.usage.is_some())
            .unwrap();
        assert_eq!(usage_message.model.as_deref(), Some("grok-4.5"));

        let results = search("Hello grok", 10).unwrap();
        assert!(!results.is_empty());
    }

    #[test]
    fn convert_chat_message_maps_tool_result_and_backend_call() {
        let mut counter = 0u64;
        let tool_result = json!({
            "type": "tool_result",
            "tool_call_id": "call-1",
            "content": "ok"
        });
        let msg = convert_chat_message(
            &tool_result,
            "sess",
            "2026-01-01T00:00:00Z",
            None,
            &mut counter,
        )
        .unwrap();
        assert_eq!(msg.message_type, "user");

        let backend = json!({
            "type": "backend_tool_call",
            "kind": {
                "tool_type": "web_search",
                "action": { "query": "x" }
            }
        });
        let msg =
            convert_chat_message(&backend, "sess", "2026-01-01T00:00:00Z", None, &mut counter)
                .unwrap();
        assert_eq!(msg.message_type, "assistant");
        let name = msg
            .content
            .as_ref()
            .and_then(|c| c.as_array())
            .and_then(|arr| arr.first())
            .and_then(|item| item.get("name"))
            .and_then(Value::as_str);
        assert_eq!(name, Some("web_search"));
    }
}
