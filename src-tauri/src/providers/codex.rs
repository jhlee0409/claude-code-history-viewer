use super::ProviderInfo;
use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession, TokenUsage};
use crate::utils::{find_line_ranges, search_json_value_case_insensitive};
use chrono::{DateTime, Utc};
use memmap2::Mmap;
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File};
use std::path::Path;
use std::path::PathBuf;
use walkdir::WalkDir;

/// Detect Codex CLI installation
pub fn detect() -> Option<ProviderInfo> {
    let base_path = get_base_path()?;
    let sessions_path = Path::new(&base_path).join("sessions");
    let archived_sessions_path = Path::new(&base_path).join("archived_sessions");

    Some(ProviderInfo {
        id: "codex".to_string(),
        display_name: "Codex CLI".to_string(),
        base_path: base_path.clone(),
        is_available: (sessions_path.exists() && sessions_path.is_dir())
            || (archived_sessions_path.exists() && archived_sessions_path.is_dir()),
    })
}

/// Get the Codex base path
pub fn get_base_path() -> Option<String> {
    // Check $CODEX_HOME first
    if let Ok(codex_home) = std::env::var("CODEX_HOME") {
        let path = PathBuf::from(&codex_home);
        if path.exists() {
            return Some(codex_home);
        }
    }

    // Default: ~/.codex
    let home = dirs::home_dir()?;
    let codex_path = home.join(".codex");
    if codex_path.exists() {
        Some(codex_path.to_string_lossy().to_string())
    } else {
        None
    }
}

fn get_sessions_dir() -> Result<PathBuf, String> {
    let base_path = get_base_path().ok_or_else(|| "Codex not found".to_string())?;
    Ok(Path::new(&base_path).join("sessions"))
}

fn get_archived_sessions_dir() -> Result<PathBuf, String> {
    let base_path = get_base_path().ok_or_else(|| "Codex not found".to_string())?;
    Ok(Path::new(&base_path).join("archived_sessions"))
}

fn get_existing_session_dirs() -> Result<Vec<PathBuf>, String> {
    let sessions_dir = get_sessions_dir()?;
    let archived_sessions_dir = get_archived_sessions_dir()?;

    Ok([sessions_dir, archived_sessions_dir]
        .into_iter()
        .filter(|path| path.exists() && path.is_dir())
        .collect())
}

fn is_rollout_jsonl(path: &Path) -> bool {
    path.file_name()
        .map(|name| name.to_string_lossy().starts_with("rollout-"))
        .unwrap_or(false)
        && path.extension().is_some_and(|ext| ext == "jsonl")
}

fn validate_session_path(session_path: &Path, raw_session_path: &str) -> Result<PathBuf, String> {
    let canonical_session = session_path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve session path: {e}"))?;

    let mut canonical_session_dirs = Vec::new();
    for dir in [get_sessions_dir()?, get_archived_sessions_dir()?] {
        if !dir.exists() || !dir.is_dir() {
            continue;
        }
        canonical_session_dirs.push(
            dir.canonicalize()
                .map_err(|e| format!("Failed to resolve Codex session directory: {e}"))?,
        );
    }

    if canonical_session_dirs.is_empty() {
        return Err("No Codex session directories found".to_string());
    }

    let is_allowed = canonical_session_dirs
        .iter()
        .any(|allowed_dir| canonical_session.starts_with(allowed_dir));

    if !is_allowed {
        return Err(format!(
            "Session path is outside Codex session directories: {raw_session_path}"
        ));
    }

    Ok(canonical_session)
}

/// Session metadata extracted from rollout files
struct SessionInfo {
    session_id: String,
    cwd: Option<String>,
    #[allow(dead_code)]
    model: Option<String>,
    message_count: usize,
    first_message_time: String,
    last_message_time: String,
    last_modified: String,
    file_path: String,
    has_tool_use: bool,
    summary: Option<String>,
}

/// Scan Codex projects (grouped by cwd from session metadata)
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let session_dirs = get_existing_session_dirs()?;

    if session_dirs.is_empty() {
        return Ok(vec![]);
    }

    // Group sessions by cwd
    let mut project_map: HashMap<String, Vec<SessionInfo>> = HashMap::new();

    for session_dir in session_dirs {
        for entry in WalkDir::new(session_dir)
            .min_depth(1)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file())
            .filter(|e| is_rollout_jsonl(e.path()))
        {
            let rollout_path = entry.path();

            if let Ok(info) = extract_session_info(rollout_path) {
                let cwd = info.cwd.clone().unwrap_or_else(|| "unknown".to_string());
                project_map.entry(cwd).or_default().push(info);
            }
        }
    }

    let mut projects: Vec<ClaudeProject> = project_map
        .into_iter()
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
                path: format!("codex://{cwd}"),
                actual_path: cwd,
                session_count,
                message_count,
                last_modified,
                git_info: None,
                provider: Some("codex".to_string()),
            }
        })
        .collect();

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

/// Load sessions for a Codex project (filtered by cwd)
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let session_dirs = get_existing_session_dirs()?;

    if session_dirs.is_empty() {
        return Ok(vec![]);
    }

    // Extract cwd from virtual path "codex://{cwd}"
    let target_cwd = project_path
        .strip_prefix("codex://")
        .unwrap_or(project_path);

    let mut sessions = Vec::new();

    for session_dir in session_dirs {
        for entry in WalkDir::new(session_dir)
            .min_depth(1)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file())
            .filter(|e| is_rollout_jsonl(e.path()))
        {
            let rollout_path = entry.path();

            if let Ok(info) = extract_session_info(rollout_path) {
                let session_cwd = info.cwd.as_deref().unwrap_or("");
                if session_cwd != target_cwd {
                    continue;
                }

                sessions.push(ClaudeSession {
                    session_id: info.file_path.clone(),
                    actual_session_id: info.session_id,
                    file_path: info.file_path,
                    project_name: Path::new(target_cwd)
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
                    provider: Some("codex".to_string()),
                });
            }
        }
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

/// Load all messages from a Codex rollout file
#[allow(unsafe_code)] // Required for mmap performance optimization
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let path = Path::new(session_path);
    if !path.exists() {
        return Err(format!("Session file not found: {session_path}"));
    }
    let canonical_path = validate_session_path(path, session_path)?;

    let file = File::open(&canonical_path).map_err(|e| e.to_string())?;
    // SAFETY: File is read-only and we only read from the mapping
    let mmap = unsafe { Mmap::map(&file) }.map_err(|e| e.to_string())?;
    let ranges = find_line_ranges(&mmap);

    let mut messages = Vec::new();
    let mut session_id = String::new();
    let mut current_model: Option<String> = None;
    let mut prev_input_tokens: u32 = 0;
    let mut prev_output_tokens: u32 = 0;
    let mut msg_counter = 0u64;

    for &(start, end) in &ranges {
        let line = &mmap[start..end];
        let mut buf = line.to_vec();
        let val: Value = match simd_json::from_slice(&mut buf) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let line_timestamp = val
            .get("timestamp")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let line_type = val.get("type").and_then(|t| t.as_str()).unwrap_or("");

        match line_type {
            "session_meta" => {
                if let Some(payload) = val.get("payload") {
                    session_id = payload
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                }
            }
            "turn_context" => {
                if let Some(payload) = val.get("payload") {
                    if let Some(m) = payload.get("model").and_then(|v| v.as_str()) {
                        current_model = Some(m.to_string());
                    }
                }
            }
            "response_item" => {
                if let Some(payload) = val.get("payload") {
                    if let Some(msg) = convert_codex_item(
                        payload,
                        &session_id,
                        current_model.as_ref(),
                        &line_timestamp,
                        &mut msg_counter,
                    ) {
                        if try_merge_tool_result_into_previous(&mut messages, &msg) {
                            continue;
                        }
                        messages.push(msg);
                    }
                }
            }
            "event_msg" => {
                // Extract token counts and apply to last assistant message
                if let Some(payload) = val.get("payload") {
                    let event_type = payload.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    if event_type == "token_count" {
                        let usage_totals = extract_token_totals(payload)
                            .or_else(|| extract_last_token_usage(payload));
                        let Some((input, output)) = usage_totals else {
                            continue;
                        };

                        let (delta_input, delta_output) =
                            if prev_input_tokens == 0 && prev_output_tokens == 0 {
                                (input, output)
                            } else {
                                (
                                    input.saturating_sub(prev_input_tokens),
                                    output.saturating_sub(prev_output_tokens),
                                )
                            };
                        prev_input_tokens = input;
                        prev_output_tokens = output;

                        // Apply to last assistant message without usage
                        if let Some(last_msg) = messages.last_mut() {
                            if last_msg.message_type == "assistant" && last_msg.usage.is_none() {
                                last_msg.usage = Some(TokenUsage {
                                    input_tokens: Some(delta_input),
                                    output_tokens: Some(delta_output),
                                    cache_creation_input_tokens: None,
                                    cache_read_input_tokens: None,
                                    service_tier: None,
                                });
                            }
                        }
                    } else if let Some(msg) =
                        convert_codex_event(payload, &session_id, &line_timestamp, &mut msg_counter)
                    {
                        messages.push(msg);
                    }
                }
            }
            "compacted" => {
                if let Some(payload) = val.get("payload") {
                    let msg = convert_codex_compacted(
                        payload,
                        &session_id,
                        &line_timestamp,
                        &mut msg_counter,
                    );
                    messages.push(msg);
                }
            }
            _ => {}
        }
    }

    Ok(messages)
}

/// Search Codex sessions for a query string
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let session_dirs = get_existing_session_dirs()?;

    if session_dirs.is_empty() {
        return Ok(vec![]);
    }

    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for session_dir in session_dirs {
        for entry in WalkDir::new(session_dir)
            .min_depth(1)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file())
            .filter(|e| is_rollout_jsonl(e.path()))
        {
            let rollout_path = entry.path();

            if let Ok(messages) = load_messages(&rollout_path.to_string_lossy()) {
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
    }

    Ok(results)
}

// ============================================================================
// Internal helpers
// ============================================================================

#[allow(unsafe_code)] // Required for mmap performance optimization
fn extract_session_info(rollout_path: &Path) -> Result<SessionInfo, String> {
    let file = File::open(rollout_path).map_err(|e| e.to_string())?;
    // SAFETY: File is read-only and we only read from the mapping
    let mmap = unsafe { Mmap::map(&file) }.map_err(|e| e.to_string())?;
    let ranges = find_line_ranges(&mmap);

    let mut session_id = String::new();
    let mut cwd = None;
    let mut model = None;
    let mut message_count = 0usize;
    let mut first_time = String::new();
    let mut last_time = String::new();
    let mut has_tool_use = false;
    let mut summary = None;

    for &(start, end) in &ranges {
        let line = &mmap[start..end];
        let mut buf = line.to_vec();
        let val: Value = match simd_json::from_slice(&mut buf) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let line_type = val.get("type").and_then(|t| t.as_str()).unwrap_or("");

        match line_type {
            "session_meta" => {
                if let Some(payload) = val.get("payload") {
                    session_id = payload
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    cwd = payload
                        .get("cwd")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                }
            }
            "turn_context" => {
                if model.is_none() {
                    if let Some(payload) = val.get("payload") {
                        model = payload
                            .get("model")
                            .and_then(|v| v.as_str())
                            .map(String::from);
                    }
                }
            }
            "response_item" => {
                if let Some(payload) = val.get("payload") {
                    let item_type = payload.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    if item_type == "message" {
                        message_count += 1;

                        let ts = payload
                            .get("created_at")
                            .or_else(|| val.get("timestamp"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();

                        if first_time.is_empty() && !ts.is_empty() {
                            first_time.clone_from(&ts);
                        }
                        if !ts.is_empty() {
                            last_time.clone_from(&ts);
                        }

                        // Extract first user message as summary
                        if summary.is_none() {
                            if let Some(role) = payload.get("role").and_then(|r| r.as_str()) {
                                if role == "user" {
                                    summary = extract_text_from_content(payload);
                                }
                            }
                        }
                    } else if item_type == "local_shell_call"
                        || item_type == "function_call"
                        || item_type == "custom_tool_call"
                        || item_type == "web_search_call"
                    {
                        has_tool_use = true;
                        message_count += 1;
                    } else if item_type == "function_call_output"
                        || item_type == "custom_tool_call_output"
                    {
                        message_count += 1;
                    }
                }
            }
            _ => {}
        }
    }

    let last_modified = if last_time.is_empty() {
        fs::metadata(rollout_path)
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
        model,
        message_count,
        first_message_time: first_time,
        last_message_time: last_time,
        last_modified,
        file_path: rollout_path.to_string_lossy().to_string(),
        has_tool_use,
        summary,
    })
}

fn extract_text_from_content(item: &Value) -> Option<String> {
    let content = item.get("content")?.as_array()?;
    for c in content {
        let ctype = c.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if ctype == "input_text" || ctype == "output_text" || ctype == "text" {
            if let Some(text) = c.get("text").and_then(|t| t.as_str()) {
                let truncated = match text.char_indices().nth(200) {
                    Some((idx, _)) => format!("{}...", &text[..idx]),
                    None => text.to_string(),
                };
                return Some(truncated);
            }
        }
    }
    None
}

fn convert_codex_item(
    item: &Value,
    session_id: &str,
    model: Option<&String>,
    line_timestamp: &str,
    counter: &mut u64,
) -> Option<ClaudeMessage> {
    let item_type = item.get("type").and_then(|t| t.as_str())?;
    *counter += 1;

    let uuid = item
        .get("id")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| format!("codex-{counter}"));

    let timestamp = item
        .get("created_at")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(line_timestamp)
        .to_string();

    match item_type {
        "message" => {
            let role = item.get("role").and_then(|r| r.as_str()).unwrap_or("user");
            let content = convert_codex_content_array(item.get("content"));

            Some(build_codex_message(
                uuid,
                session_id,
                timestamp,
                if role == "user" { "user" } else { "assistant" },
                Some(role),
                content,
                if role == "assistant" {
                    model.cloned()
                } else {
                    None
                },
            ))
        }
        "local_shell_call" => {
            let command = item
                .get("action")
                .and_then(|a| a.get("command"))
                .cloned()
                .unwrap_or(Value::Null);

            let command_str = if let Some(arr) = command.as_array() {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .collect::<Vec<_>>()
                    .join(" ")
            } else {
                command.as_str().unwrap_or("").to_string()
            };

            let call_id = item
                .get("call_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let content = serde_json::json!([{
                "type": "tool_use",
                "id": call_id,
                "name": "Bash",
                "input": { "command": command_str }
            }]);

            Some(build_codex_message(
                uuid,
                session_id,
                timestamp,
                "assistant",
                Some("assistant"),
                Some(content),
                model.cloned(),
            ))
        }
        "function_call" => {
            let raw_name = item
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let name = map_codex_tool_name(raw_name);
            let call_id = item
                .get("call_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let arguments = item.get("arguments");
            let mut input = parse_tool_arguments(arguments);
            normalize_tool_input(name, &mut input);

            let content = serde_json::json!([{
                "type": "tool_use",
                "id": call_id,
                "name": name,
                "input": input
            }]);

            Some(build_codex_message(
                uuid,
                session_id,
                timestamp,
                "assistant",
                Some("assistant"),
                Some(content),
                model.cloned(),
            ))
        }
        "function_call_output" => {
            let output = item.get("output").cloned().unwrap_or(Value::Null);
            let output = normalize_tool_output(output);
            let call_id = item
                .get("call_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let content = serde_json::json!([{
                "type": "tool_result",
                "tool_use_id": call_id,
                "content": output
            }]);

            Some(build_codex_message(
                uuid,
                session_id,
                timestamp,
                "user",
                Some("user"),
                Some(content),
                None,
            ))
        }
        "custom_tool_call" => {
            let name = item
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("custom_tool");
            let call_id = item
                .get("call_id")
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| uuid.clone());
            let mut input = item.get("input").cloned().unwrap_or(Value::Null);
            normalize_custom_tool_input(name, &mut input);

            let content = serde_json::json!([{
                "type": "tool_use",
                "id": call_id,
                "name": name,
                "input": input
            }]);

            Some(build_codex_message(
                uuid,
                session_id,
                timestamp,
                "assistant",
                Some("assistant"),
                Some(content),
                model.cloned(),
            ))
        }
        "custom_tool_call_output" => {
            let output = item.get("output").cloned().unwrap_or(Value::Null);
            let output = normalize_tool_output(output);
            let call_id = item
                .get("call_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let content = serde_json::json!([{
                "type": "tool_result",
                "tool_use_id": call_id,
                "content": output
            }]);

            Some(build_codex_message(
                uuid,
                session_id,
                timestamp,
                "user",
                Some("user"),
                Some(content),
                None,
            ))
        }
        "web_search_call" => {
            let search_id = item
                .get("call_id")
                .or_else(|| item.get("id"))
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| uuid.clone());
            let action = item
                .get("action")
                .cloned()
                .unwrap_or_else(|| Value::Object(serde_json::Map::default()));
            let input = normalize_web_search_input(action);

            let content = serde_json::json!([{
                "type": "tool_use",
                "id": search_id,
                "name": "WebSearch",
                "input": input
            }]);

            Some(build_codex_message(
                uuid,
                session_id,
                timestamp,
                "assistant",
                Some("assistant"),
                Some(content),
                model.cloned(),
            ))
        }
        "reasoning" => {
            let thinking_text = item
                .get("summary")
                .and_then(|s| s.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.get("text").and_then(|t| t.as_str()))
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .unwrap_or_default();

            if thinking_text.is_empty() {
                return None;
            }

            let content = serde_json::json!([{
                "type": "thinking",
                "thinking": thinking_text
            }]);

            Some(build_codex_message(
                uuid,
                session_id,
                timestamp,
                "assistant",
                Some("assistant"),
                Some(content),
                model.cloned(),
            ))
        }
        _ => None,
    }
}

fn convert_codex_event(
    payload: &Value,
    session_id: &str,
    line_timestamp: &str,
    counter: &mut u64,
) -> Option<ClaudeMessage> {
    let event_type = payload.get("type").and_then(|t| t.as_str())?;

    match event_type {
        "task_started" => {
            *counter += 1;
            let mut msg = build_codex_message(
                format!("codex-event-{counter}"),
                session_id,
                line_timestamp.to_string(),
                "progress",
                None,
                None,
                None,
            );
            msg.data = Some(serde_json::json!({
                "type": "waiting_for_task",
                "status": "started",
                "taskId": payload.get("turn_id").and_then(Value::as_str).unwrap_or_default(),
                "message": "Task started"
            }));
            msg.tool_use_id = payload
                .get("turn_id")
                .and_then(Value::as_str)
                .map(str::to_string);
            Some(msg)
        }
        "task_complete" => {
            *counter += 1;
            let mut msg = build_codex_message(
                format!("codex-event-{counter}"),
                session_id,
                line_timestamp.to_string(),
                "progress",
                None,
                None,
                None,
            );
            msg.data = Some(serde_json::json!({
                "type": "waiting_for_task",
                "status": "completed",
                "taskId": payload.get("turn_id").and_then(Value::as_str).unwrap_or_default(),
                "message": "Task completed"
            }));
            msg.tool_use_id = payload
                .get("turn_id")
                .and_then(Value::as_str)
                .map(str::to_string);
            Some(msg)
        }
        "context_compacted" => {
            *counter += 1;
            let mut msg = build_codex_message(
                format!("codex-event-{counter}"),
                session_id,
                line_timestamp.to_string(),
                "system",
                None,
                Some(serde_json::json!("Context compacted")),
                None,
            );
            msg.subtype = Some("microcompact_boundary".to_string());
            msg.level = Some("info".to_string());
            msg.microcompact_metadata = Some(serde_json::json!({
                "trigger": "context_compacted"
            }));
            Some(msg)
        }
        "agent_reasoning" => {
            let text = payload.get("text").and_then(Value::as_str)?.trim();
            if text.is_empty() {
                return None;
            }
            *counter += 1;
            let content = serde_json::json!([{
                "type": "thinking",
                "thinking": text
            }]);
            Some(build_codex_message(
                format!("codex-event-{counter}"),
                session_id,
                line_timestamp.to_string(),
                "assistant",
                Some("assistant"),
                Some(content),
                None,
            ))
        }
        "agent_message" => {
            let text = payload.get("message").and_then(Value::as_str)?.trim();
            if text.is_empty() {
                return None;
            }
            *counter += 1;
            let content = serde_json::json!([{
                "type": "text",
                "text": text
            }]);
            Some(build_codex_message(
                format!("codex-event-{counter}"),
                session_id,
                line_timestamp.to_string(),
                "assistant",
                Some("assistant"),
                Some(content),
                None,
            ))
        }
        "user_message" => {
            let text = payload.get("message").and_then(Value::as_str)?.trim();
            if text.is_empty() {
                return None;
            }
            *counter += 1;
            let content = serde_json::json!([{
                "type": "text",
                "text": text
            }]);
            Some(build_codex_message(
                format!("codex-event-{counter}"),
                session_id,
                line_timestamp.to_string(),
                "user",
                Some("user"),
                Some(content),
                None,
            ))
        }
        // Unsupported/duplicated Codex events are intentionally ignored.
        _ => None,
    }
}

fn convert_codex_compacted(
    payload: &Value,
    session_id: &str,
    line_timestamp: &str,
    counter: &mut u64,
) -> ClaudeMessage {
    *counter += 1;
    let replacement_history_count = payload
        .get("replacement_history")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);

    let mut msg = build_codex_message(
        format!("codex-compacted-{counter}"),
        session_id,
        line_timestamp.to_string(),
        "system",
        None,
        Some(serde_json::json!("Conversation compacted")),
        None,
    );
    msg.subtype = Some("compact_boundary".to_string());
    msg.level = Some("info".to_string());
    msg.compact_metadata = Some(serde_json::json!({
        "trigger": "compacted",
        "replacementHistoryCount": replacement_history_count
    }));
    msg
}

fn extract_token_totals(payload: &Value) -> Option<(u32, u32)> {
    // Recent Codex logs store usage in payload.info.total_token_usage.
    let total = payload.get("info")?.get("total_token_usage")?;
    let input = total.get("input_tokens")?.as_u64()? as u32;
    let output = total.get("output_tokens")?.as_u64()? as u32;
    Some((input, output))
}

fn extract_last_token_usage(payload: &Value) -> Option<(u32, u32)> {
    // Fallback for older/newer variants that only include last token usage.
    let last = payload.get("info")?.get("last_token_usage")?;
    let input = last.get("input_tokens")?.as_u64()? as u32;
    let output = last.get("output_tokens")?.as_u64()? as u32;
    Some((input, output))
}

fn map_codex_tool_name(name: &str) -> &str {
    match name {
        "exec_command" | "shell" | "write_stdin" => "Bash",
        _ => name,
    }
}

fn parse_tool_arguments(arguments: Option<&Value>) -> Value {
    match arguments {
        Some(Value::String(s)) => {
            serde_json::from_str(s).unwrap_or_else(|_| Value::Object(serde_json::Map::default()))
        }
        Some(v) if v.is_object() || v.is_array() => v.clone(),
        _ => Value::Object(serde_json::Map::default()),
    }
}

fn normalize_tool_input(tool_name: &str, input: &mut Value) {
    if tool_name != "Bash" {
        return;
    }

    let Some(obj) = input.as_object_mut() else {
        return;
    };

    // Codex exec_command uses "cmd"; UI Bash renderer expects "command".
    if !obj.contains_key("command") {
        if let Some(cmd) = obj.get("cmd").cloned() {
            match cmd {
                Value::String(_) => {
                    obj.insert("command".to_string(), cmd);
                }
                Value::Array(arr) => {
                    let joined = arr
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(" ");
                    obj.insert("command".to_string(), Value::String(joined));
                }
                _ => {}
            }
        }
    }

    if let Some(Value::Array(arr)) = obj.get("command").cloned() {
        let joined = arr
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(" ");
        obj.insert("command".to_string(), Value::String(joined));
    }
}

fn normalize_custom_tool_input(tool_name: &str, input: &mut Value) {
    if input.is_object() {
        return;
    }

    if tool_name == "apply_patch" {
        let patch = input.as_str().unwrap_or("").to_string();
        *input = serde_json::json!({ "patch": patch });
        return;
    }

    *input = serde_json::json!({ "input": input.clone() });
}

fn normalize_web_search_input(action: Value) -> Value {
    let Some(action_obj) = action.as_object() else {
        return Value::Object(serde_json::Map::default());
    };

    let mut input = serde_json::Map::default();
    if let Some(query) = action_obj.get("query").and_then(Value::as_str) {
        input.insert("query".to_string(), Value::String(query.to_string()));
    } else if let Some(url) = action_obj.get("url").and_then(Value::as_str) {
        input.insert("query".to_string(), Value::String(url.to_string()));
    } else if let Some(pattern) = action_obj.get("pattern").and_then(Value::as_str) {
        input.insert("query".to_string(), Value::String(pattern.to_string()));
    }
    if let Some(queries) = action_obj.get("queries").cloned() {
        input.insert("queries".to_string(), queries);
    }
    if let Some(action_type) = action_obj.get("type").and_then(Value::as_str) {
        input.insert(
            "action_type".to_string(),
            Value::String(action_type.to_string()),
        );
    }

    Value::Object(input)
}

fn normalize_tool_output(output: Value) -> Value {
    let Value::String(raw) = output else {
        return output;
    };

    // exec_command tool output can be a JSON string: {"output":"...", ...}
    if let Ok(parsed) = serde_json::from_str::<Value>(&raw) {
        if let Some(inner_output) = parsed.get("output") {
            return inner_output.clone();
        }
    }

    // Codex function wrapper output usually embeds "Output:\n{actual stdout}".
    if let Some((_, out)) = raw.split_once("\nOutput:\n") {
        return Value::String(out.to_string());
    }

    Value::String(raw)
}

fn try_merge_tool_result_into_previous(
    messages: &mut [ClaudeMessage],
    msg: &ClaudeMessage,
) -> bool {
    if msg.message_type != "user" {
        return false;
    }

    let Some((tool_use_id, tool_result_block)) = extract_tool_result_block(msg) else {
        return false;
    };

    for prev in messages.iter_mut().rev() {
        if prev.message_type != "assistant" {
            continue;
        }
        if has_matching_tool_use(prev, &tool_use_id) {
            append_content_block(prev, tool_result_block);
            return true;
        }
    }

    false
}

fn extract_tool_result_block(msg: &ClaudeMessage) -> Option<(String, Value)> {
    let arr = msg.content.as_ref()?.as_array()?;
    let first = arr.first()?;
    if first.get("type").and_then(Value::as_str) != Some("tool_result") {
        return None;
    }
    let tool_use_id = first
        .get("tool_use_id")
        .and_then(Value::as_str)?
        .to_string();
    Some((tool_use_id, first.clone()))
}

fn has_matching_tool_use(msg: &ClaudeMessage, tool_use_id: &str) -> bool {
    let Some(arr) = msg.content.as_ref().and_then(Value::as_array) else {
        return false;
    };
    arr.iter().any(|item| {
        item.get("type").and_then(Value::as_str) == Some("tool_use")
            && item.get("id").and_then(Value::as_str) == Some(tool_use_id)
    })
}

fn append_content_block(msg: &mut ClaudeMessage, block: Value) {
    match &mut msg.content {
        Some(Value::Array(arr)) => arr.push(block),
        _ => msg.content = Some(Value::Array(vec![block])),
    }
}

fn extract_first_tool_use(content: Option<&Value>) -> Option<Value> {
    let arr = content?.as_array()?;
    arr.iter()
        .find(|item| item.get("type").and_then(Value::as_str) == Some("tool_use"))
        .cloned()
}

fn convert_codex_content_array(content: Option<&Value>) -> Option<Value> {
    let arr = content?.as_array()?;

    let items: Vec<Value> = arr
        .iter()
        .filter_map(|item| {
            let ctype = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
            match ctype {
                "input_text" | "output_text" | "text" => {
                    let text = item.get("text").and_then(|t| t.as_str()).unwrap_or("");
                    Some(serde_json::json!({
                        "type": "text",
                        "text": text
                    }))
                }
                "input_image" => {
                    let image_url = item.get("image_url").and_then(Value::as_str).unwrap_or("");
                    if image_url.is_empty() {
                        return None;
                    }
                    Some(serde_json::json!({
                        "type": "image",
                        "source": {
                            "type": "url",
                            "url": image_url
                        }
                    }))
                }
                "refusal" => {
                    let refusal = item
                        .get("refusal")
                        .and_then(|t| t.as_str())
                        .unwrap_or("Refused");
                    Some(serde_json::json!({
                        "type": "text",
                        "text": format!("[Refusal] {refusal}")
                    }))
                }
                _ => None,
            }
        })
        .collect();

    if items.is_empty() {
        None
    } else {
        Some(Value::Array(items))
    }
}

fn build_codex_message(
    uuid: String,
    session_id: &str,
    timestamp: String,
    message_type: &str,
    role: Option<&str>,
    content: Option<Value>,
    model: Option<String>,
) -> ClaudeMessage {
    let tool_use = if message_type == "assistant" {
        extract_first_tool_use(content.as_ref())
    } else {
        None
    };

    ClaudeMessage {
        uuid,
        parent_uuid: None,
        session_id: session_id.to_string(),
        timestamp,
        message_type: message_type.to_string(),
        content,
        project_name: None,
        tool_use,
        tool_use_result: None,
        is_sidechain: None,
        usage: None,
        role: role.map(String::from),
        model,
        stop_reason: None,
        cost_usd: None,
        duration_ms: None,
        message_id: None,
        snapshot: None,
        is_snapshot_update: None,
        data: None,
        tool_use_id: None,
        parent_tool_use_id: None,
        operation: None,
        subtype: None,
        level: None,
        hook_count: None,
        hook_infos: None,
        stop_reason_system: None,
        prevented_continuation: None,
        compact_metadata: None,
        microcompact_metadata: None,
        provider: Some("codex".to_string()),
    }
}

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

    #[test]
    fn map_exec_command_to_bash() {
        assert_eq!(map_codex_tool_name("exec_command"), "Bash");
        assert_eq!(map_codex_tool_name("shell"), "Bash");
        assert_eq!(map_codex_tool_name("write_stdin"), "Bash");
        assert_eq!(map_codex_tool_name("batch_execute"), "batch_execute");
    }

    #[test]
    fn normalize_bash_input_maps_cmd_to_command() {
        let mut input = json!({ "cmd": "pwd && ls -la" });
        normalize_tool_input("Bash", &mut input);
        assert_eq!(
            input.get("command").and_then(Value::as_str),
            Some("pwd && ls -la")
        );
    }

    #[test]
    fn normalize_bash_input_maps_command_array_to_string() {
        let mut input = json!({ "command": ["bash", "-lc", "pwd"] });
        normalize_tool_input("Bash", &mut input);
        assert_eq!(
            input.get("command").and_then(Value::as_str),
            Some("bash -lc pwd")
        );
    }

    #[test]
    fn normalize_tool_output_extracts_wrapped_output() {
        let wrapped = "Chunk ID: abc\nWall time: 0.01 seconds\nOutput:\nhello\nworld";
        let out = normalize_tool_output(Value::String(wrapped.to_string()));
        assert_eq!(out.as_str(), Some("hello\nworld"));
    }

    #[test]
    fn normalize_tool_output_extracts_json_output_field() {
        let out = normalize_tool_output(Value::String(
            r#"{"output":"done","metadata":{"exit_code":0}}"#.to_string(),
        ));
        assert_eq!(out.as_str(), Some("done"));
    }

    #[test]
    fn parse_nested_token_count_totals() {
        let payload = json!({
            "type": "token_count",
            "info": {
                "total_token_usage": {
                    "input_tokens": 120,
                    "output_tokens": 30
                }
            }
        });
        assert_eq!(extract_token_totals(&payload), Some((120, 30)));
    }

    #[test]
    fn normalize_custom_tool_input_wraps_apply_patch_text() {
        let mut input = Value::String("*** Begin Patch".to_string());
        normalize_custom_tool_input("apply_patch", &mut input);
        assert_eq!(
            input.get("patch").and_then(Value::as_str),
            Some("*** Begin Patch")
        );
    }

    #[test]
    fn normalize_web_search_input_extracts_query_and_type() {
        let input = normalize_web_search_input(json!({
            "type": "search",
            "query": "codex parser",
            "queries": ["codex parser", "codex rollout"]
        }));
        assert_eq!(
            input.get("query").and_then(Value::as_str),
            Some("codex parser")
        );
        assert_eq!(
            input.get("action_type").and_then(Value::as_str),
            Some("search")
        );
        assert!(input.get("queries").is_some());
    }

    #[test]
    fn convert_content_array_maps_input_image_to_image() {
        let converted = convert_codex_content_array(Some(&json!([
            {
                "type": "input_image",
                "image_url": "data:image/png;base64,abc"
            }
        ])))
        .expect("content should be converted");

        let arr = converted
            .as_array()
            .expect("converted content should be an array");
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0].get("type").and_then(Value::as_str), Some("image"));
        assert_eq!(
            arr[0]
                .get("source")
                .and_then(|v| v.get("url"))
                .and_then(Value::as_str),
            Some("data:image/png;base64,abc")
        );
    }

    #[test]
    fn convert_custom_tool_call_to_tool_use() {
        let mut counter = 0u64;
        let msg = convert_codex_item(
            &json!({
                "type": "custom_tool_call",
                "name": "apply_patch",
                "call_id": "call_patch_1",
                "input": "*** Begin Patch"
            }),
            "session-1",
            None,
            "2026-02-19T12:00:00Z",
            &mut counter,
        )
        .expect("custom_tool_call should be converted");

        assert_eq!(msg.message_type, "assistant");
        let arr = msg
            .content
            .as_ref()
            .and_then(Value::as_array)
            .expect("content should be an array");
        assert_eq!(arr[0].get("type").and_then(Value::as_str), Some("tool_use"));
        assert_eq!(
            arr[0].get("name").and_then(Value::as_str),
            Some("apply_patch")
        );
        assert_eq!(
            arr[0]
                .get("input")
                .and_then(|v| v.get("patch"))
                .and_then(Value::as_str),
            Some("*** Begin Patch")
        );
    }

    #[test]
    fn convert_custom_tool_call_output_to_tool_result() {
        let mut counter = 0u64;
        let msg = convert_codex_item(
            &json!({
                "type": "custom_tool_call_output",
                "call_id": "call_patch_1",
                "output": "{\"output\":\"Success. Updated files\",\"metadata\":{\"exit_code\":0}}"
            }),
            "session-1",
            None,
            "2026-02-19T12:00:01Z",
            &mut counter,
        )
        .expect("custom_tool_call_output should be converted");

        assert_eq!(msg.message_type, "user");
        let arr = msg
            .content
            .as_ref()
            .and_then(Value::as_array)
            .expect("content should be an array");
        assert_eq!(
            arr[0].get("type").and_then(Value::as_str),
            Some("tool_result")
        );
        assert_eq!(
            arr[0].get("tool_use_id").and_then(Value::as_str),
            Some("call_patch_1")
        );
        assert_eq!(
            arr[0].get("content").and_then(Value::as_str),
            Some("Success. Updated files")
        );
    }

    #[test]
    fn convert_web_search_call_to_web_search_tool_use() {
        let mut counter = 0u64;
        let msg = convert_codex_item(
            &json!({
                "type": "web_search_call",
                "action": {
                    "type": "open_page",
                    "url": "https://example.com"
                }
            }),
            "session-1",
            None,
            "2026-02-19T12:00:02Z",
            &mut counter,
        )
        .expect("web_search_call should be converted");

        assert_eq!(msg.message_type, "assistant");
        let arr = msg
            .content
            .as_ref()
            .and_then(Value::as_array)
            .expect("content should be an array");
        assert_eq!(arr[0].get("type").and_then(Value::as_str), Some("tool_use"));
        assert_eq!(
            arr[0].get("name").and_then(Value::as_str),
            Some("WebSearch")
        );
        assert_eq!(
            arr[0]
                .get("input")
                .and_then(|v| v.get("query"))
                .and_then(Value::as_str),
            Some("https://example.com")
        );
    }

    #[test]
    fn merge_tool_result_into_previous_tool_use_message() {
        let mut messages = vec![build_codex_message(
            "assistant-1".to_string(),
            "session-1",
            "2026-02-19T12:00:00Z".to_string(),
            "assistant",
            Some("assistant"),
            Some(json!([{
                "type": "tool_use",
                "id": "call_abc",
                "name": "Bash",
                "input": { "command": "pwd" }
            }])),
            None,
        )];

        let result_msg = build_codex_message(
            "user-1".to_string(),
            "session-1",
            "2026-02-19T12:00:01Z".to_string(),
            "user",
            Some("user"),
            Some(json!([{
                "type": "tool_result",
                "tool_use_id": "call_abc",
                "content": "ok"
            }])),
            None,
        );

        assert!(try_merge_tool_result_into_previous(
            &mut messages,
            &result_msg
        ));
        let merged_arr = messages[0]
            .content
            .as_ref()
            .and_then(Value::as_array)
            .expect("assistant message content should be an array");
        assert_eq!(merged_arr.len(), 2);
        assert_eq!(
            merged_arr[1].get("type").and_then(Value::as_str),
            Some("tool_result")
        );
    }

    #[test]
    fn build_codex_message_sets_tool_use_from_content() {
        let msg = build_codex_message(
            "assistant-1".to_string(),
            "session-1",
            "2026-02-19T12:00:00Z".to_string(),
            "assistant",
            Some("assistant"),
            Some(json!([{
                "type": "tool_use",
                "id": "call_1",
                "name": "Bash",
                "input": {"command": "pwd"}
            }])),
            None,
        );

        assert!(msg.tool_use.is_some());
        assert_eq!(
            msg.tool_use
                .as_ref()
                .and_then(|v| v.get("name"))
                .and_then(Value::as_str),
            Some("Bash")
        );
    }

    #[test]
    fn convert_task_started_event_to_progress_message() {
        let mut counter = 0u64;
        let msg = convert_codex_event(
            &json!({
                "type": "task_started",
                "turn_id": "turn_1"
            }),
            "session-1",
            "2026-02-19T12:00:00Z",
            &mut counter,
        )
        .expect("task_started should be converted");

        assert_eq!(msg.message_type, "progress");
        assert_eq!(
            msg.data
                .as_ref()
                .and_then(|v| v.get("status"))
                .and_then(Value::as_str),
            Some("started")
        );
    }

    #[test]
    fn convert_context_compacted_event_to_system_message() {
        let mut counter = 0u64;
        let msg = convert_codex_event(
            &json!({
                "type": "context_compacted"
            }),
            "session-1",
            "2026-02-19T12:00:00Z",
            &mut counter,
        )
        .expect("context_compacted should be converted");

        assert_eq!(msg.message_type, "system");
        assert_eq!(msg.subtype.as_deref(), Some("microcompact_boundary"));
    }

    #[test]
    fn convert_agent_reasoning_event_to_thinking_message() {
        let mut counter = 0u64;
        let msg = convert_codex_event(
            &json!({
                "type": "agent_reasoning",
                "text": "**Inspecting parsers**"
            }),
            "session-1",
            "2026-02-19T12:00:00Z",
            &mut counter,
        )
        .expect("agent_reasoning should be converted");

        assert_eq!(msg.message_type, "assistant");
        let arr = msg
            .content
            .as_ref()
            .and_then(Value::as_array)
            .expect("content should be an array");
        assert_eq!(arr[0].get("type").and_then(Value::as_str), Some("thinking"));
        assert_eq!(
            arr[0].get("thinking").and_then(Value::as_str),
            Some("**Inspecting parsers**")
        );
    }

    #[test]
    fn convert_agent_reasoning_event_skips_empty_text() {
        let mut counter = 0u64;
        let msg = convert_codex_event(
            &json!({
                "type": "agent_reasoning",
                "text": "   "
            }),
            "session-1",
            "2026-02-19T12:00:00Z",
            &mut counter,
        );

        assert!(msg.is_none());
        assert_eq!(counter, 0);
    }

    #[test]
    fn convert_agent_message_event_to_assistant_text_message() {
        let mut counter = 0u64;
        let msg = convert_codex_event(
            &json!({
                "type": "agent_message",
                "message": "Working on requested changes"
            }),
            "session-1",
            "2026-02-19T12:00:00Z",
            &mut counter,
        )
        .expect("agent_message should be converted");

        assert_eq!(msg.message_type, "assistant");
        let arr = msg
            .content
            .as_ref()
            .and_then(Value::as_array)
            .expect("content should be an array");
        assert_eq!(arr[0].get("type").and_then(Value::as_str), Some("text"));
        assert_eq!(
            arr[0].get("text").and_then(Value::as_str),
            Some("Working on requested changes")
        );
    }

    #[test]
    fn convert_agent_message_event_skips_missing_field() {
        let mut counter = 0u64;
        let msg = convert_codex_event(
            &json!({
                "type": "agent_message"
            }),
            "session-1",
            "2026-02-19T12:00:00Z",
            &mut counter,
        );

        assert!(msg.is_none());
        assert_eq!(counter, 0);
    }

    #[test]
    fn convert_user_message_event_to_user_text_message() {
        let mut counter = 0u64;
        let msg = convert_codex_event(
            &json!({
                "type": "user_message",
                "message": "Please patch this file"
            }),
            "session-1",
            "2026-02-19T12:00:00Z",
            &mut counter,
        )
        .expect("user_message should be converted");

        assert_eq!(msg.message_type, "user");
        let arr = msg
            .content
            .as_ref()
            .and_then(Value::as_array)
            .expect("content should be an array");
        assert_eq!(arr[0].get("type").and_then(Value::as_str), Some("text"));
        assert_eq!(
            arr[0].get("text").and_then(Value::as_str),
            Some("Please patch this file")
        );
    }

    #[test]
    fn convert_compacted_line_to_system_message() {
        let mut counter = 0u64;
        let msg = convert_codex_compacted(
            &json!({
                "message": "",
                "replacement_history": [{"type":"message"}]
            }),
            "session-1",
            "2026-02-19T12:00:00Z",
            &mut counter,
        );

        assert_eq!(msg.message_type, "system");
        assert_eq!(msg.subtype.as_deref(), Some("compact_boundary"));
        assert_eq!(
            msg.compact_metadata
                .as_ref()
                .and_then(|v| v.get("replacementHistoryCount"))
                .and_then(Value::as_u64),
            Some(1)
        );
    }

    #[test]
    #[serial]
    fn load_messages_parses_codex_rollout_end_to_end() {
        let tmp = TempDir::new().expect("temp dir should be created");
        let codex_home = tmp.path().join("codex-home");
        let sessions_dir = codex_home.join("sessions");
        fs::create_dir_all(&sessions_dir).expect("sessions dir should be created");
        let _guard = EnvVarGuard::set("CODEX_HOME", &codex_home);
        let rollout_path = sessions_dir.join("rollout-2026-02-19.jsonl");

        let lines = vec![
            json!({
                "timestamp": "2026-02-19T12:00:00Z",
                "type": "session_meta",
                "payload": { "id": "sess-1" }
            }),
            json!({
                "timestamp": "2026-02-19T12:00:01Z",
                "type": "turn_context",
                "payload": { "model": "gpt-5-codex" }
            }),
            json!({
                "timestamp": "2026-02-19T12:00:02Z",
                "type": "response_item",
                "payload": {
                    "id": "item-1",
                    "type": "function_call",
                    "name": "exec_command",
                    "call_id": "call_1",
                    "arguments": "{\"cmd\":\"pwd\"}"
                }
            }),
            json!({
                "timestamp": "2026-02-19T12:00:03Z",
                "type": "response_item",
                "payload": {
                    "id": "item-2",
                    "type": "function_call_output",
                    "call_id": "call_1",
                    "output": "{\"output\":\"/tmp\",\"metadata\":{\"exit_code\":0}}"
                }
            }),
            json!({
                "timestamp": "2026-02-19T12:00:04Z",
                "type": "response_item",
                "payload": {
                    "id": "item-3",
                    "type": "message",
                    "role": "assistant",
                    "content": [{ "type": "output_text", "text": "done" }]
                }
            }),
            json!({
                "timestamp": "2026-02-19T12:00:05Z",
                "type": "event_msg",
                "payload": {
                    "type": "token_count",
                    "info": {
                        "total_token_usage": {
                            "input_tokens": 100,
                            "output_tokens": 20
                        }
                    }
                }
            }),
            json!({
                "timestamp": "2026-02-19T12:00:06Z",
                "type": "event_msg",
                "payload": {
                    "type": "task_started",
                    "turn_id": "turn_1"
                }
            }),
            json!({
                "timestamp": "2026-02-19T12:00:07Z",
                "type": "event_msg",
                "payload": {
                    "type": "task_complete",
                    "turn_id": "turn_1"
                }
            }),
            json!({
                "timestamp": "2026-02-19T12:00:08Z",
                "type": "event_msg",
                "payload": {
                    "type": "context_compacted"
                }
            }),
            json!({
                "timestamp": "2026-02-19T12:00:09Z",
                "type": "compacted",
                "payload": {
                    "replacement_history": [{ "type": "message" }, { "type": "summary" }]
                }
            }),
        ];

        let content = lines
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&rollout_path, format!("{content}\n")).expect("fixture should be written");

        let messages = load_messages(
            rollout_path
                .to_str()
                .expect("rollout path should be valid UTF-8"),
        )
        .expect("rollout should be parsed");

        assert_eq!(messages.len(), 6);
        assert_eq!(messages[0].message_type, "assistant");
        assert_eq!(messages[1].message_type, "assistant");
        assert_eq!(messages[2].message_type, "progress");
        assert_eq!(messages[3].message_type, "progress");
        assert_eq!(messages[4].message_type, "system");
        assert_eq!(messages[5].message_type, "system");

        let first_blocks = messages[0]
            .content
            .as_ref()
            .and_then(Value::as_array)
            .expect("first message content should be an array");
        assert_eq!(first_blocks.len(), 2);
        assert_eq!(
            first_blocks[0].get("type").and_then(Value::as_str),
            Some("tool_use")
        );
        assert_eq!(
            first_blocks[1].get("type").and_then(Value::as_str),
            Some("tool_result")
        );
        assert_eq!(
            first_blocks[1].get("content").and_then(Value::as_str),
            Some("/tmp")
        );

        assert_eq!(
            messages[0]
                .tool_use
                .as_ref()
                .and_then(|v| v.get("name"))
                .and_then(Value::as_str),
            Some("Bash")
        );
        assert_eq!(messages[0].model.as_deref(), Some("gpt-5-codex"));
        assert_eq!(messages[1].model.as_deref(), Some("gpt-5-codex"));

        assert_eq!(
            messages[1].usage.as_ref().and_then(|u| u.input_tokens),
            Some(100)
        );
        assert_eq!(
            messages[1].usage.as_ref().and_then(|u| u.output_tokens),
            Some(20)
        );

        assert_eq!(
            messages[2]
                .data
                .as_ref()
                .and_then(|v| v.get("status"))
                .and_then(Value::as_str),
            Some("started")
        );
        assert_eq!(
            messages[3]
                .data
                .as_ref()
                .and_then(|v| v.get("status"))
                .and_then(Value::as_str),
            Some("completed")
        );
        assert_eq!(
            messages[4].subtype.as_deref(),
            Some("microcompact_boundary")
        );
        assert_eq!(messages[5].subtype.as_deref(), Some("compact_boundary"));
        assert_eq!(
            messages[5]
                .compact_metadata
                .as_ref()
                .and_then(|v| v.get("replacementHistoryCount"))
                .and_then(Value::as_u64),
            Some(2)
        );

        assert!(messages
            .iter()
            .all(|m| m.provider.as_deref() == Some("codex")));
        assert!(messages.iter().all(|m| m.session_id == "sess-1"));
    }

    #[test]
    #[serial]
    fn load_sessions_includes_archived_sessions() {
        let tmp = TempDir::new().expect("temp dir should be created");
        let codex_home = tmp.path().join("codex-home");
        let sessions_dir = codex_home
            .join("sessions")
            .join("2026")
            .join("02")
            .join("21");
        let archived_dir = codex_home.join("archived_sessions");
        fs::create_dir_all(&sessions_dir).expect("sessions dir should be created");
        fs::create_dir_all(&archived_dir).expect("archived dir should be created");
        let _guard = EnvVarGuard::set("CODEX_HOME", &codex_home);

        let project_cwd = "/Users/jack/client/claude-code-history-viewer";
        let active_rollout = sessions_dir.join("rollout-active.jsonl");
        let archived_rollout = archived_dir.join("rollout-archived.jsonl");
        let active_lines = [
            json!({
                "type": "session_meta",
                "payload": { "id": "active-session", "cwd": project_cwd }
            }),
            json!({
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "user",
                    "created_at": "2026-02-21T10:00:00Z",
                    "content": [{ "type": "input_text", "text": "active" }]
                }
            }),
        ];
        let archived_lines = [
            json!({
                "type": "session_meta",
                "payload": { "id": "archived-session", "cwd": project_cwd }
            }),
            json!({
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "user",
                    "created_at": "2026-02-21T11:00:00Z",
                    "content": [{ "type": "input_text", "text": "archived" }]
                }
            }),
        ];
        let active_content = active_lines
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        let archived_content = archived_lines
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&active_rollout, format!("{active_content}\n"))
            .expect("active fixture should be written");
        fs::write(&archived_rollout, format!("{archived_content}\n"))
            .expect("archived fixture should be written");

        let sessions = load_sessions(&format!("codex://{project_cwd}"), false)
            .expect("sessions should be loaded");

        assert_eq!(sessions.len(), 2);
        assert!(sessions.iter().any(|s| s.file_path.contains("/sessions/")));
        assert!(sessions
            .iter()
            .any(|s| s.file_path.contains("/archived_sessions/")));
    }

    #[test]
    #[serial]
    fn load_messages_accepts_archived_session_path() {
        let tmp = TempDir::new().expect("temp dir should be created");
        let codex_home = tmp.path().join("codex-home");
        let archived_dir = codex_home.join("archived_sessions");
        fs::create_dir_all(&archived_dir).expect("archived dir should be created");
        let _guard = EnvVarGuard::set("CODEX_HOME", &codex_home);
        let rollout_path = archived_dir.join("rollout-archived-only.jsonl");
        let lines = [
            json!({
                "type": "session_meta",
                "payload": { "id": "archived-session", "cwd": "/tmp/project" }
            }),
            json!({
                "type": "response_item",
                "payload": {
                    "id": "item-1",
                    "type": "message",
                    "role": "assistant",
                    "created_at": "2026-02-21T10:00:00Z",
                    "content": [{ "type": "output_text", "text": "ok" }]
                }
            }),
        ];
        let content = lines
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&rollout_path, format!("{content}\n")).expect("fixture should be written");

        let messages = load_messages(
            rollout_path
                .to_str()
                .expect("rollout path should be valid UTF-8"),
        )
        .expect("archived rollout should be parsed");

        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].session_id, "archived-session");
    }
}
