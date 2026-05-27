//! GitHub Copilot CLI provider (`~/.copilot/`).
//!
//! The newer agentic Copilot CLI keeps one directory per session under
//! `~/.copilot/session-state/<sessionId>/`. The relevant file is
//! `events.jsonl`, an append-only stream of typed events:
//!
//! * `session.start` / `session.resume` — carry `data.context.cwd`,
//!   `data.copilotVersion`, the session UUID, etc.
//! * `session.model_change` — `data.newModel`.
//! * `system.message` — system prompt (rendered as a system-level note).
//! * `user.message` — user prompt; `data.content` is the literal input,
//!   `data.transformedContent` is the wrapped version sent to the model
//!   (we skip it because it duplicates the prompt and bloats the view).
//! * `assistant.message` — assistant text plus `data.toolRequests[]`, each
//!   describing a tool call with `toolCallId`, `name`, `arguments`.
//! * `tool.execution_start` — informational; we let the assistant message's
//!   `tool_use` block represent the call.
//! * `tool.execution_complete` — emitted as a `tool_result` block which is
//!   merged into the assistant message that owns the matching `toolCallId`
//!   (same trick as the Codex provider).
//!
//! Projects are virtual groupings keyed by `cwd`, mirroring the Codex
//! provider (`copilot-cli://<cwd>`).

use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession, TokenUsage};
use crate::providers::ProviderInfo;
use crate::utils::{build_provider_message, find_line_ranges, search_json_value_case_insensitive};
use chrono::{DateTime, Utc};
use memmap2::Mmap;
use serde_json::Value;
use std::collections::HashMap;
use std::fs::File;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const PROVIDER_ID: &str = "copilot-cli";

/// Detect a Copilot CLI installation.
pub fn detect() -> Option<ProviderInfo> {
    let base = get_base_path()?;
    let session_dir = Path::new(&base).join("session-state");
    let is_available = session_dir.is_dir();
    Some(ProviderInfo {
        id: PROVIDER_ID.to_string(),
        display_name: "Copilot CLI".to_string(),
        base_path: base,
        is_available,
    })
}

/// Resolve the Copilot CLI base directory.
///
/// Honours `$COPILOT_CLI_HOME` if it points to an existing directory,
/// otherwise falls back to `~/.copilot`.
pub fn get_base_path() -> Option<String> {
    if let Ok(env) = std::env::var("COPILOT_CLI_HOME") {
        let path = PathBuf::from(&env);
        if path.is_dir() {
            return Some(env);
        }
    }
    let home = dirs::home_dir()?;
    let candidate = home.join(".copilot");
    if candidate.is_dir() {
        Some(candidate.to_string_lossy().to_string())
    } else {
        None
    }
}

fn get_session_root() -> Result<PathBuf, String> {
    let base = get_base_path().ok_or_else(|| "Copilot CLI not found".to_string())?;
    Ok(Path::new(&base).join("session-state"))
}

fn get_session_root_from_base(base_path: &str) -> PathBuf {
    Path::new(base_path).join("session-state")
}

fn is_events_jsonl(path: &Path) -> bool {
    path.file_name().is_some_and(|n| n == "events.jsonl")
}

/// Reject session paths outside `~/.copilot/session-state/`.
fn validate_session_path(session_path: &Path, raw: &str) -> Result<PathBuf, String> {
    let canonical = session_path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve session path: {e}"))?;
    let root = get_session_root()?
        .canonicalize()
        .map_err(|e| format!("Failed to resolve Copilot CLI session root: {e}"))?;
    if !canonical.starts_with(&root) {
        return Err(format!(
            "Session path is outside Copilot CLI session directory: {raw}"
        ));
    }
    Ok(canonical)
}

fn is_wsl_unc_path(path: &Path) -> bool {
    let path = path.to_string_lossy();
    path.starts_with(r"\\wsl.localhost\")
        || path.starts_with(r"\\wsl$\")
        || path.starts_with(r"\\?\UNC\wsl.localhost\")
        || path.starts_with(r"\\?\UNC\wsl$\")
}

fn validate_wsl_session_path(session_path: &Path, raw: &str) -> Result<PathBuf, String> {
    if !is_events_jsonl(session_path) {
        return Err(format!(
            "Copilot CLI session path must end with events.jsonl: {raw}"
        ));
    }

    let canonical = session_path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve WSL Copilot CLI session path: {e}"))?;

    if !is_wsl_unc_path(&canonical) {
        return Err(format!(
            "Session path is outside Copilot CLI session directory: {raw}"
        ));
    }

    let path = canonical.to_string_lossy().replace('/', "\\");
    if !path.contains(r"\.copilot\session-state\") {
        return Err(format!(
            "WSL Copilot CLI session path is outside .copilot\\session-state: {raw}"
        ));
    }

    Ok(canonical)
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopilotProjectPath {
    base_path: String,
    cwd: String,
}

fn build_project_path(cwd: &str, base_path: Option<&str>) -> String {
    match base_path {
        Some(base_path) => format!(
            "copilot-cli://{}",
            serde_json::to_string(&CopilotProjectPath {
                base_path: base_path.to_string(),
                cwd: cwd.to_string(),
            })
            .expect("CopilotProjectPath serialization cannot fail")
        ),
        None => format!("copilot-cli://{cwd}"),
    }
}

fn parse_project_path(project_path: &str) -> Result<(Option<String>, String), String> {
    let value = project_path
        .strip_prefix("copilot-cli://")
        .unwrap_or(project_path);
    if value.trim_start().starts_with('{') {
        let parsed: CopilotProjectPath = serde_json::from_str(value)
            .map_err(|e| format!("Invalid Copilot CLI project path: {e}"))?;
        return Ok((Some(parsed.base_path), parsed.cwd));
    }
    Ok((None, value.to_string()))
}

#[derive(Debug)]
struct SessionInfo {
    session_id: String,
    cwd: Option<String>,
    message_count: usize,
    first_message_time: String,
    last_message_time: String,
    last_modified: String,
    file_path: String,
    has_tool_use: bool,
    summary: Option<String>,
}

/// Group sessions by `cwd` to expose virtual `copilot-cli://<cwd>` projects.
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let base = match get_base_path() {
        Some(base) => base,
        None => return Ok(Vec::new()),
    };
    scan_projects_from_path(&base, None)
}

pub fn scan_projects_from_path(
    base_path: &str,
    custom_directory_label: Option<&str>,
) -> Result<Vec<ClaudeProject>, String> {
    let root = get_session_root_from_base(base_path);
    if !root.is_dir() {
        return Ok(Vec::new());
    }

    let mut project_map: HashMap<String, Vec<SessionInfo>> = HashMap::new();

    for entry in WalkDir::new(&root)
        .follow_links(false)
        .min_depth(2)
        .max_depth(2)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter(|e| is_events_jsonl(e.path()))
    {
        if let Ok(info) = extract_session_info(entry.path()) {
            // Skip empty sessions (e.g., terminals where Copilot CLI was
            // launched but no prompt was sent).
            if info.message_count == 0 {
                continue;
            }
            let cwd = info.cwd.clone().unwrap_or_else(|| "unknown".to_string());
            project_map.entry(cwd).or_default().push(info);
        }
    }

    let mut projects: Vec<ClaudeProject> = project_map
        .into_iter()
        .filter(|(_, sessions)| !sessions.is_empty())
        .map(|(cwd, sessions)| {
            let name = Path::new(&cwd)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| cwd.clone());
            let session_count = sessions.len();
            let message_count: usize = sessions.iter().map(|s| s.message_count).sum();
            let last_modified = sessions
                .iter()
                .map(|s| s.last_modified.as_str())
                .max()
                .unwrap_or("")
                .to_string();
            ClaudeProject {
                name,
                path: build_project_path(&cwd, custom_directory_label.map(|_| base_path)),
                actual_path: cwd,
                session_count,
                message_count,
                last_modified,
                git_info: None,
                provider: Some(PROVIDER_ID.to_string()),
                storage_type: None,
                custom_directory_label: custom_directory_label.map(ToString::to_string),
            }
        })
        .collect();

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

/// Load every session whose recorded `cwd` matches `project_path`.
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let (base_path, target_cwd) = parse_project_path(project_path)?;
    let root = match base_path {
        Some(base_path) => {
            let base = Path::new(&base_path);
            if !is_wsl_unc_path(base) {
                return Err("Copilot CLI project path has an unsupported base path".to_string());
            }
            get_session_root_from_base(&base_path)
        }
        None => match get_session_root() {
            Ok(p) => p,
            Err(_) => return Ok(Vec::new()),
        },
    };
    if !root.is_dir() {
        return Ok(Vec::new());
    }

    let mut sessions = Vec::new();

    for entry in WalkDir::new(&root)
        .follow_links(false)
        .min_depth(2)
        .max_depth(2)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter(|e| is_events_jsonl(e.path()))
    {
        if let Ok(info) = extract_session_info(entry.path()) {
            // Skip empty sessions to match scan_projects.
            if info.message_count == 0 {
                continue;
            }
            let session_cwd = info.cwd.as_deref().unwrap_or("");
            if session_cwd != target_cwd {
                continue;
            }
            sessions.push(ClaudeSession {
                session_id: info.file_path.clone(),
                actual_session_id: info.session_id,
                file_path: info.file_path,
                project_name: Path::new(&target_cwd)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
                message_count: info.message_count,
                first_message_time: info.first_message_time,
                last_message_time: info.last_message_time,
                last_modified: info.last_modified,
                has_tool_use: info.has_tool_use,
                has_errors: false,
                summary: info.summary,
                is_renamed: false,
                provider: Some(PROVIDER_ID.to_string()),
                storage_type: None,
                entrypoint: None,
            });
        }
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

/// Stream messages out of `events.jsonl`.
#[allow(unsafe_code)] // Required for mmap performance optimization
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let path = Path::new(session_path);
    if !path.exists() {
        return Err(format!("Session file not found: {session_path}"));
    }
    let canonical = validate_session_path(path, session_path)
        .or_else(|_| validate_wsl_session_path(path, session_path))?;

    let file = File::open(&canonical).map_err(|e| e.to_string())?;
    // SAFETY: file is opened read-only and we only read the mapping.
    let mmap = unsafe { Mmap::map(&file) }.map_err(|e| e.to_string())?;
    let ranges = find_line_ranges(&mmap);

    let mut messages: Vec<ClaudeMessage> = Vec::new();
    let mut session_id = String::new();
    let mut current_model: Option<String> = None;
    let mut counter: u64 = 0;

    for &(start, end) in &ranges {
        let mut buf = mmap[start..end].to_vec();
        let val: Value = match simd_json::from_slice(&mut buf) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let event_type = val.get("type").and_then(Value::as_str).unwrap_or("");
        let timestamp = val
            .get("timestamp")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let data = match val.get("data") {
            Some(d) => d,
            None => continue,
        };

        match event_type {
            "session.start" | "session.resume" => {
                if session_id.is_empty() {
                    if let Some(id) = data.get("sessionId").and_then(Value::as_str) {
                        session_id = id.to_string();
                    }
                }
                if let Some(model) = data.get("selectedModel").and_then(Value::as_str) {
                    current_model = Some(model.to_string());
                }
            }
            "session.model_change" => {
                if let Some(model) = data.get("newModel").and_then(Value::as_str) {
                    current_model = Some(model.to_string());
                }
            }
            "system.message" => {
                if let Some(msg) =
                    convert_system_message(data, &session_id, &timestamp, &mut counter)
                {
                    messages.push(msg);
                }
            }
            "user.message" => {
                if let Some(msg) = convert_user_message(
                    data,
                    val.get("id").and_then(Value::as_str),
                    &session_id,
                    &timestamp,
                    &mut counter,
                ) {
                    messages.push(msg);
                }
            }
            "assistant.message" => {
                if let Some(msg) = convert_assistant_message(
                    data,
                    val.get("id").and_then(Value::as_str),
                    &session_id,
                    &timestamp,
                    current_model.as_deref(),
                    &mut counter,
                ) {
                    messages.push(msg);
                }
            }
            "tool.execution_complete" => {
                if let Some((tool_use_id, block)) = build_tool_result_block(data) {
                    merge_tool_result_into_assistant(&mut messages, &tool_use_id, block);
                }
            }
            _ => {}
        }
    }

    Ok(messages)
}

/// Naive case-insensitive search across every events.jsonl.
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let base = match get_base_path() {
        Some(base) => base,
        None => return Ok(Vec::new()),
    };
    search_from_path(&base, query, limit)
}

pub fn search_from_path(
    base_path: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<ClaudeMessage>, String> {
    let root = get_session_root_from_base(base_path);
    if !root.is_dir() {
        return Ok(Vec::new());
    }

    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for entry in WalkDir::new(&root)
        .follow_links(false)
        .min_depth(2)
        .max_depth(2)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter(|e| is_events_jsonl(e.path()))
    {
        if let Ok(messages) = load_messages(&entry.path().to_string_lossy()) {
            for msg in messages {
                if results.len() >= limit {
                    return Ok(results);
                }
                if let Some(content) = &msg.content {
                    if search_json_value_case_insensitive(content, &query_lower) {
                        results.push(msg);
                    }
                }
            }
        }
    }

    Ok(results)
}

// ============================================================================
// Internal helpers
// ============================================================================

#[allow(unsafe_code)] // mmap is needed for performance over large event logs
fn extract_session_info(events_path: &Path) -> Result<SessionInfo, String> {
    let file = File::open(events_path).map_err(|e| e.to_string())?;
    // SAFETY: file is opened read-only and only read via the mapping.
    let mmap = unsafe { Mmap::map(&file) }.map_err(|e| e.to_string())?;
    let ranges = find_line_ranges(&mmap);

    let mut session_id = String::new();
    let mut cwd: Option<String> = None;
    let mut message_count = 0usize;
    let mut first_time = String::new();
    let mut last_time = String::new();
    let mut has_tool_use = false;
    let mut summary: Option<String> = None;

    for &(start, end) in &ranges {
        let mut buf = mmap[start..end].to_vec();
        let val: Value = match simd_json::from_slice(&mut buf) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let event_type = val.get("type").and_then(Value::as_str).unwrap_or("");
        let ts = val
            .get("timestamp")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let data = val.get("data");

        match event_type {
            "session.start" | "session.resume" => {
                if let Some(d) = data {
                    if session_id.is_empty() {
                        if let Some(id) = d.get("sessionId").and_then(Value::as_str) {
                            session_id = id.to_string();
                        }
                    }
                    if cwd.is_none() {
                        cwd = d
                            .get("context")
                            .and_then(|c| c.get("cwd"))
                            .and_then(Value::as_str)
                            .map(String::from);
                    }
                }
            }
            "user.message" | "assistant.message" | "system.message" => {
                message_count += 1;
                if first_time.is_empty() && !ts.is_empty() {
                    first_time.clone_from(&ts);
                }
                if !ts.is_empty() {
                    last_time.clone_from(&ts);
                }
                if summary.is_none() && event_type == "user.message" {
                    if let Some(text) = data.and_then(|d| d.get("content")).and_then(Value::as_str)
                    {
                        let preview = truncate_preview(text, 200);
                        if !preview.is_empty() {
                            summary = Some(preview);
                        }
                    }
                }
            }
            "tool.execution_start" | "tool.execution_complete" => {
                has_tool_use = true;
            }
            // "assistant.turn_start" / "assistant.turn_end" and other unknown
            // event types are intentionally skipped.
            _ => {}
        }
    }

    let last_modified = if last_time.is_empty() {
        std::fs::metadata(events_path)
            .ok()
            .and_then(|m| m.modified().ok())
            .map(|t| {
                let dt: DateTime<Utc> = t.into();
                dt.to_rfc3339()
            })
            .unwrap_or_else(|| Utc::now().to_rfc3339())
    } else {
        last_time.clone()
    };

    Ok(SessionInfo {
        session_id,
        cwd,
        message_count,
        first_message_time: first_time,
        last_message_time: last_time,
        last_modified,
        file_path: events_path.to_string_lossy().to_string(),
        has_tool_use,
        summary,
    })
}

fn truncate_preview(text: &str, max_chars: usize) -> String {
    match text.char_indices().nth(max_chars) {
        Some((idx, _)) => format!("{}...", &text[..idx]),
        None => text.to_string(),
    }
}

fn convert_system_message(
    data: &Value,
    session_id: &str,
    timestamp: &str,
    counter: &mut u64,
) -> Option<ClaudeMessage> {
    let content = data.get("content").and_then(Value::as_str)?;
    if content.is_empty() {
        return None;
    }
    *counter += 1;
    let body = serde_json::json!([{ "type": "text", "text": content }]);
    let mut msg = build_provider_message(
        PROVIDER_ID,
        format!("copilot-cli-system-{counter}"),
        session_id,
        timestamp.to_string(),
        "system",
        Some("system"),
        Some(body),
        None,
    );
    msg.subtype = Some("system_prompt".to_string());
    msg.level = Some("info".to_string());
    Some(msg)
}

fn convert_user_message(
    data: &Value,
    event_id: Option<&str>,
    session_id: &str,
    timestamp: &str,
    counter: &mut u64,
) -> Option<ClaudeMessage> {
    let content = data.get("content").and_then(Value::as_str)?;
    if content.is_empty() {
        return None;
    }
    *counter += 1;
    let body = serde_json::json!([{ "type": "text", "text": content }]);
    let uuid = event_id
        .map(str::to_string)
        .unwrap_or_else(|| format!("copilot-cli-user-{counter}"));
    Some(build_provider_message(
        PROVIDER_ID,
        uuid,
        session_id,
        timestamp.to_string(),
        "user",
        Some("user"),
        Some(body),
        None,
    ))
}

fn convert_assistant_message(
    data: &Value,
    event_id: Option<&str>,
    session_id: &str,
    timestamp: &str,
    model: Option<&str>,
    counter: &mut u64,
) -> Option<ClaudeMessage> {
    *counter += 1;
    let uuid = event_id
        .map(str::to_string)
        .unwrap_or_else(|| format!("copilot-cli-assistant-{counter}"));

    let mut blocks: Vec<Value> = Vec::new();

    if let Some(text) = data.get("content").and_then(Value::as_str) {
        if !text.is_empty() {
            blocks.push(serde_json::json!({ "type": "text", "text": text }));
        }
    }

    if let Some(requests) = data.get("toolRequests").and_then(Value::as_array) {
        for req in requests {
            let id = req
                .get("toolCallId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let name = req
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("tool")
                .to_string();
            let input = req
                .get("arguments")
                .cloned()
                .unwrap_or(Value::Object(serde_json::Map::default()));
            blocks.push(serde_json::json!({
                "type": "tool_use",
                "id": id,
                "name": name,
                "input": input,
            }));
        }
    }

    if blocks.is_empty() {
        return None;
    }

    let output_tokens = data
        .get("outputTokens")
        .and_then(Value::as_u64)
        .map(|n| n as u32);
    let usage = output_tokens.map(|out| TokenUsage {
        input_tokens: None,
        output_tokens: Some(out),
        cache_creation_input_tokens: None,
        cache_read_input_tokens: None,
        service_tier: None,
    });

    let message_id = data
        .get("messageId")
        .and_then(Value::as_str)
        .map(String::from);

    let tool_use = blocks
        .iter()
        .find(|b| b.get("type").and_then(Value::as_str) == Some("tool_use"))
        .cloned();

    let mut msg = build_provider_message(
        PROVIDER_ID,
        uuid,
        session_id,
        timestamp.to_string(),
        "assistant",
        Some("assistant"),
        Some(Value::Array(blocks)),
        model.map(String::from),
    );
    msg.tool_use = tool_use;
    msg.usage = usage;
    msg.message_id = message_id;
    Some(msg)
}

fn build_tool_result_block(data: &Value) -> Option<(String, Value)> {
    let tool_use_id = data
        .get("toolCallId")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())?
        .to_string();
    let success = data.get("success").and_then(Value::as_bool).unwrap_or(true);
    let content = data
        .get("result")
        .and_then(|r| r.get("content"))
        .or_else(|| data.get("error"))
        .cloned()
        .unwrap_or(Value::String(String::new()));

    let mut block = serde_json::json!({
        "type": "tool_result",
        "tool_use_id": tool_use_id,
        "content": content,
    });
    if !success {
        if let Some(obj) = block.as_object_mut() {
            obj.insert("is_error".to_string(), Value::Bool(true));
        }
    }
    Some((tool_use_id, block))
}

fn merge_tool_result_into_assistant(
    messages: &mut [ClaudeMessage],
    tool_use_id: &str,
    block: Value,
) {
    for prev in messages.iter_mut().rev() {
        if prev.message_type != "assistant" {
            continue;
        }
        let matches = prev
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
        if matches {
            if let Some(Value::Array(arr)) = prev.content.as_mut() {
                arr.push(block);
            }
            return;
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use serial_test::serial;
    use std::ffi::OsString;
    use std::fs;
    use tempfile::TempDir;

    struct EnvVarGuard {
        key: &'static str,
        original: Option<OsString>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: &std::path::Path) -> Self {
            let original = std::env::var_os(key);
            std::env::set_var(key, value);
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

    fn write_events(dir: &Path, lines: &[Value]) -> PathBuf {
        fs::create_dir_all(dir).unwrap();
        let path = dir.join("events.jsonl");
        let body = lines
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&path, body).unwrap();
        path
    }

    fn write_session(root: &Path, session_id: &str, lines: &[Value]) -> PathBuf {
        let session_dir = root.join("session-state").join(session_id);
        write_events(&session_dir, lines)
    }

    #[test]
    #[serial]
    fn detect_uses_copilot_cli_home_env() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("session-state")).unwrap();
        let _home_guard = EnvVarGuard::set("HOME", tmp.path());
        let _env_guard = EnvVarGuard::set("COPILOT_CLI_HOME", tmp.path());

        let info = detect().expect("provider detected");
        assert_eq!(info.id, "copilot-cli");
        assert!(info.is_available);
        assert_eq!(info.base_path, tmp.path().to_string_lossy());
    }

    #[test]
    #[serial]
    fn scan_groups_sessions_by_cwd() {
        let tmp = TempDir::new().unwrap();
        let _env_guard = EnvVarGuard::set("COPILOT_CLI_HOME", tmp.path());

        write_session(
            tmp.path(),
            "11111111-1111-1111-1111-111111111111",
            &[
                json!({
                    "type": "session.start",
                    "data": {
                        "sessionId": "11111111-1111-1111-1111-111111111111",
                        "context": {"cwd": "/repo/a"}
                    },
                    "timestamp": "2026-01-01T00:00:00.000Z"
                }),
                json!({
                    "type": "user.message",
                    "data": {"content": "hello"},
                    "timestamp": "2026-01-01T00:00:01.000Z"
                }),
            ],
        );
        write_session(
            tmp.path(),
            "22222222-2222-2222-2222-222222222222",
            &[
                json!({
                    "type": "session.start",
                    "data": {
                        "sessionId": "22222222-2222-2222-2222-222222222222",
                        "context": {"cwd": "/repo/a"}
                    },
                    "timestamp": "2026-01-02T00:00:00.000Z"
                }),
                json!({
                    "type": "user.message",
                    "data": {"content": "second"},
                    "timestamp": "2026-01-02T00:00:01.000Z"
                }),
            ],
        );
        write_session(
            tmp.path(),
            "33333333-3333-3333-3333-333333333333",
            &[
                json!({
                    "type": "session.start",
                    "data": {
                        "sessionId": "33333333-3333-3333-3333-333333333333",
                        "context": {"cwd": "/repo/b"}
                    },
                    "timestamp": "2026-01-03T00:00:00.000Z"
                }),
                json!({
                    "type": "user.message",
                    "data": {"content": "third"},
                    "timestamp": "2026-01-03T00:00:01.000Z"
                }),
            ],
        );

        let projects = scan_projects().unwrap();
        assert_eq!(projects.len(), 2);
        let project_a = projects
            .iter()
            .find(|p| p.actual_path == "/repo/a")
            .expect("project /repo/a present");
        assert_eq!(project_a.session_count, 2);
        assert!(project_a.path.starts_with("copilot-cli://"));
        assert_eq!(project_a.provider.as_deref(), Some("copilot-cli"));
    }

    #[test]
    #[serial]
    fn scan_and_load_skip_empty_sessions() {
        let tmp = TempDir::new().unwrap();
        let _env_guard = EnvVarGuard::set("COPILOT_CLI_HOME", tmp.path());

        // session with no user/assistant messages
        write_session(
            tmp.path(),
            "44444444-4444-4444-4444-444444444444",
            &[json!({
                "type": "session.start",
                "data": {
                    "sessionId": "44444444-4444-4444-4444-444444444444",
                    "context": {"cwd": "/repo/empty"}
                },
                "timestamp": "2026-01-04T00:00:00.000Z"
            })],
        );
        // session with at least one user message
        write_session(
            tmp.path(),
            "55555555-5555-5555-5555-555555555555",
            &[
                json!({
                    "type": "session.start",
                    "data": {
                        "sessionId": "55555555-5555-5555-5555-555555555555",
                        "context": {"cwd": "/repo/used"}
                    },
                    "timestamp": "2026-01-05T00:00:00.000Z"
                }),
                json!({
                    "type": "user.message",
                    "data": {"content": "hi"},
                    "timestamp": "2026-01-05T00:00:01.000Z"
                }),
            ],
        );

        let projects = scan_projects().unwrap();
        let paths: Vec<_> = projects.iter().map(|p| p.actual_path.as_str()).collect();
        assert!(
            paths.contains(&"/repo/used"),
            "non-empty session's project must be listed: {paths:?}",
        );
        assert!(
            !paths.contains(&"/repo/empty"),
            "empty-session-only project must be skipped: {paths:?}",
        );

        let sessions = load_sessions("copilot-cli:///repo/empty", false).unwrap();
        assert!(
            sessions.is_empty(),
            "empty sessions must not surface in load_sessions: {sessions:?}",
        );
    }

    #[test]
    #[serial]
    fn load_messages_pairs_tool_use_and_result() {
        let tmp = TempDir::new().unwrap();
        let _env_guard = EnvVarGuard::set("COPILOT_CLI_HOME", tmp.path());

        let session_path = write_session(
            tmp.path(),
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            &[
                json!({
                    "type": "session.start",
                    "data": {
                        "sessionId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                        "context": {"cwd": "/repo"}
                    },
                    "timestamp": "2026-01-01T00:00:00.000Z"
                }),
                json!({
                    "type": "user.message",
                    "data": {"content": "ls"},
                    "timestamp": "2026-01-01T00:00:01.000Z"
                }),
                json!({
                    "type": "assistant.message",
                    "data": {
                        "messageId": "asst-1",
                        "content": "running ls",
                        "toolRequests": [{
                            "toolCallId": "tool-1",
                            "name": "bash",
                            "arguments": {"command": "ls"}
                        }],
                        "outputTokens": 42
                    },
                    "timestamp": "2026-01-01T00:00:02.000Z"
                }),
                json!({
                    "type": "tool.execution_complete",
                    "data": {
                        "toolCallId": "tool-1",
                        "success": true,
                        "result": {"content": "file1\nfile2"}
                    },
                    "timestamp": "2026-01-01T00:00:03.000Z"
                }),
            ],
        );

        let messages = load_messages(&session_path.to_string_lossy()).unwrap();
        assert_eq!(messages.len(), 2, "expected user + merged assistant");
        let assistant = &messages[1];
        assert_eq!(assistant.message_type, "assistant");
        let blocks = assistant.content.as_ref().unwrap().as_array().unwrap();
        let kinds: Vec<&str> = blocks
            .iter()
            .map(|b| b.get("type").and_then(Value::as_str).unwrap_or(""))
            .collect();
        assert_eq!(kinds, vec!["text", "tool_use", "tool_result"]);
        let tool_result = blocks.last().unwrap();
        assert_eq!(
            tool_result.get("tool_use_id").and_then(Value::as_str),
            Some("tool-1")
        );
        assert_eq!(
            assistant
                .usage
                .as_ref()
                .and_then(|u| u.output_tokens)
                .unwrap(),
            42
        );
        assert_eq!(assistant.message_id.as_deref(), Some("asst-1"));
    }

    #[test]
    #[serial]
    fn load_messages_skips_malformed_lines() {
        let tmp = TempDir::new().unwrap();
        let _env_guard = EnvVarGuard::set("COPILOT_CLI_HOME", tmp.path());

        let session_dir = tmp
            .path()
            .join("session-state")
            .join("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
        fs::create_dir_all(&session_dir).unwrap();
        let path = session_dir.join("events.jsonl");
        let body = format!(
            "{}\n{}\n{}",
            json!({
                "type": "session.start",
                "data": {"sessionId": "x", "context": {"cwd": "/repo"}},
                "timestamp": "2026-01-01T00:00:00.000Z"
            }),
            "not json at all",
            json!({
                "type": "user.message",
                "data": {"content": "hi"},
                "timestamp": "2026-01-01T00:00:01.000Z"
            })
        );
        fs::write(&path, body).unwrap();

        let messages = load_messages(&path.to_string_lossy()).unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].message_type, "user");
    }

    #[test]
    #[serial]
    fn load_messages_rejects_path_outside_root() {
        let tmp = TempDir::new().unwrap();
        let _env_guard = EnvVarGuard::set("COPILOT_CLI_HOME", tmp.path());
        fs::create_dir_all(tmp.path().join("session-state")).unwrap();

        let outside = TempDir::new().unwrap();
        let outside_file = outside.path().join("events.jsonl");
        fs::write(&outside_file, "{}").unwrap();
        let err =
            load_messages(&outside_file.to_string_lossy()).expect_err("path should be rejected");
        assert!(err.contains("outside Copilot CLI"));
    }
}
