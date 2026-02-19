use super::ProviderInfo;
use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession, TokenUsage};
use crate::utils::find_line_ranges;
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

    Some(ProviderInfo {
        id: "codex".to_string(),
        display_name: "Codex CLI".to_string(),
        base_path: base_path.clone(),
        is_available: sessions_path.exists() && sessions_path.is_dir(),
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
    let base_path = get_base_path().ok_or_else(|| "Codex not found".to_string())?;
    let sessions_dir = Path::new(&base_path).join("sessions");

    if !sessions_dir.exists() {
        return Ok(vec![]);
    }

    // Group sessions by cwd
    let mut project_map: HashMap<String, Vec<SessionInfo>> = HashMap::new();

    for entry in WalkDir::new(&sessions_dir)
        .min_depth(1)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter(|e| {
            e.file_name().to_string_lossy().starts_with("rollout-")
                && e.path().extension().is_some_and(|ext| ext == "jsonl")
        })
    {
        let rollout_path = entry.path();

        if let Ok(info) = extract_session_info(rollout_path) {
            let cwd = info.cwd.clone().unwrap_or_else(|| "unknown".to_string());
            project_map.entry(cwd).or_default().push(info);
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
    let base_path = get_base_path().ok_or_else(|| "Codex not found".to_string())?;
    let sessions_dir = Path::new(&base_path).join("sessions");

    if !sessions_dir.exists() {
        return Ok(vec![]);
    }

    // Extract cwd from virtual path "codex://{cwd}"
    let target_cwd = project_path
        .strip_prefix("codex://")
        .unwrap_or(project_path);

    let mut sessions = Vec::new();

    for entry in WalkDir::new(&sessions_dir)
        .min_depth(1)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter(|e| {
            e.file_name().to_string_lossy().starts_with("rollout-")
                && e.path().extension().is_some_and(|ext| ext == "jsonl")
        })
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

    let file = File::open(path).map_err(|e| e.to_string())?;
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
                        &mut msg_counter,
                    ) {
                        messages.push(msg);
                    }
                }
            }
            "event_msg" => {
                // Extract token counts and apply to last assistant message
                if let Some(payload) = val.get("payload") {
                    let event_type = payload.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    if event_type == "token_count" {
                        let input = payload
                            .get("input_tokens")
                            .and_then(Value::as_u64)
                            .unwrap_or(0) as u32;
                        let output = payload
                            .get("output_tokens")
                            .and_then(Value::as_u64)
                            .unwrap_or(0) as u32;

                        let delta_input = input.saturating_sub(prev_input_tokens);
                        let delta_output = output.saturating_sub(prev_output_tokens);
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
                    }
                }
            }
            _ => {}
        }
    }

    Ok(messages)
}

/// Search Codex sessions for a query string
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let base_path = get_base_path().ok_or_else(|| "Codex not found".to_string())?;
    let sessions_dir = Path::new(&base_path).join("sessions");

    if !sessions_dir.exists() {
        return Ok(vec![]);
    }

    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for entry in WalkDir::new(&sessions_dir)
        .min_depth(1)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter(|e| {
            e.file_name().to_string_lossy().starts_with("rollout-")
                && e.path().extension().is_some_and(|ext| ext == "jsonl")
        })
    {
        let rollout_path = entry.path();

        if let Ok(messages) = load_messages(&rollout_path.to_string_lossy()) {
            for msg in messages {
                if results.len() >= limit {
                    return Ok(results);
                }

                if let Some(content) = &msg.content {
                    let content_str = content.to_string().to_lowercase();
                    if content_str.contains(&query_lower) {
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
                    } else if item_type == "local_shell_call" || item_type == "function_call" {
                        has_tool_use = true;
                        message_count += 1;
                    } else if item_type == "function_call_output" {
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
                let truncated = if text.len() > 200 {
                    format!("{}...", &text[..200])
                } else {
                    text.to_string()
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
        .unwrap_or("")
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
            let name = item
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let call_id = item
                .get("call_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let arguments = item
                .get("arguments")
                .and_then(|v| v.as_str())
                .unwrap_or("{}");

            let input: Value = serde_json::from_str(arguments)
                .unwrap_or(Value::Object(serde_json::Map::default()));

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
            let output = item.get("output").and_then(|v| v.as_str()).unwrap_or("");
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
    ClaudeMessage {
        uuid,
        parent_uuid: None,
        session_id: session_id.to_string(),
        timestamp,
        message_type: message_type.to_string(),
        content,
        project_name: None,
        tool_use: None,
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
