use super::ProviderInfo;
use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::utils::{build_provider_message, find_line_ranges, search_json_value_case_insensitive};
use chrono::{DateTime, Utc};
use memmap2::Mmap;
use serde_json::Value;
use std::fs::File;
use std::path::Path;
use walkdir::WalkDir;

const PROVIDER_ID: &str = "codebuddy";

/// Detect `CodeBuddy Code` installation
pub fn detect() -> Option<ProviderInfo> {
    let base_path = get_base_path()?;
    let projects_path = Path::new(&base_path);

    Some(ProviderInfo {
        id: PROVIDER_ID.to_string(),
        display_name: "CodeBuddy Code".to_string(),
        base_path: base_path.clone(),
        is_available: projects_path.exists() && projects_path.is_dir(),
    })
}

/// Get the `CodeBuddy` projects base path (`~/.codebuddy/projects`)
pub fn get_base_path() -> Option<String> {
    let home = dirs::home_dir()?;
    let projects_path = home.join(".codebuddy").join("projects");
    if projects_path.exists() && projects_path.is_dir() {
        Some(projects_path.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Scan `CodeBuddy` projects
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let base_path = get_base_path().ok_or("CodeBuddy projects path not found")?;
    let base = Path::new(&base_path);

    let mut projects = Vec::new();

    for entry in WalkDir::new(base)
        .min_depth(1)
        .max_depth(1)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_dir())
    {
        let project_dir = entry.path();

        // Count JSONL files
        let mut session_count = 0usize;
        let mut message_count = 0usize;
        let mut last_modified_ts = 0u64;

        for jsonl_entry in WalkDir::new(project_dir)
            .min_depth(1)
            .max_depth(1)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
        {
            session_count += 1;
            if let Ok(metadata) = jsonl_entry.metadata() {
                message_count += (metadata.len() / 500) as usize;
                if let Ok(modified) = metadata.modified() {
                    if let Ok(dur) = modified.duration_since(std::time::SystemTime::UNIX_EPOCH) {
                        last_modified_ts = last_modified_ts.max(dur.as_secs());
                    }
                }
            }
        }

        if session_count == 0 {
            continue;
        }

        let dir_name = project_dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown");

        let display_name = dir_name.rsplit('-').next().unwrap_or(dir_name).to_string();

        #[allow(clippy::cast_possible_wrap)]
        let last_modified = if last_modified_ts > 0 {
            DateTime::from_timestamp(last_modified_ts as i64, 0)
                .unwrap_or_else(Utc::now)
                .to_rfc3339()
        } else {
            Utc::now().to_rfc3339()
        };

        projects.push(ClaudeProject {
            name: display_name,
            path: project_dir.to_string_lossy().to_string(),
            actual_path: project_dir.to_string_lossy().to_string(),
            session_count,
            message_count,
            last_modified,
            git_info: None,
            provider: Some(PROVIDER_ID.to_string()),
            storage_type: None,
            custom_directory_label: None,
        });
    }

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

/// Load sessions for a `CodeBuddy` project
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    if project_path.trim().is_empty() {
        return Err("project_path is required".to_string());
    }

    let project_dir = Path::new(project_path);
    if !project_dir.exists() || !project_dir.is_dir() {
        return Ok(vec![]);
    }

    // Defense-in-depth: confine traversal to ~/.codebuddy/projects/<project>.
    // Reject paths outside this root (path traversal) and reject the project
    // dir itself if it is a symlink (potential symlink attack).
    validate_session_path(project_dir)?;
    if std::fs::symlink_metadata(project_dir)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(format!(
            "Project path must not be a symlink: {}",
            project_dir.display()
        ));
    }

    let mut sessions = Vec::new();

    for entry in WalkDir::new(project_dir)
        .min_depth(1)
        .max_depth(1)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
    {
        let file_path = entry.path();
        // Skip symlinked .jsonl files — they could point outside the
        // project root we just validated.
        if std::fs::symlink_metadata(file_path)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false)
        {
            continue;
        }
        if let Some(session) = extract_session_info(file_path) {
            sessions.push(session);
        }
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

/// Load messages from a `CodeBuddy` session file
#[allow(unsafe_code)]
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let path = Path::new(session_path);
    if !path.exists() {
        return Err(format!("Session file not found: {session_path}"));
    }

    validate_session_path(path)?;

    let file = File::open(path).map_err(|e| e.to_string())?;
    // SAFETY: File is read-only and we only read from the mapping
    let mmap = unsafe { Mmap::map(&file) }.map_err(|e| e.to_string())?;
    let ranges = find_line_ranges(&mmap);

    let mut messages = Vec::new();
    let mut session_id = String::new();
    let mut msg_counter = 0u64;

    for &(start, end) in &ranges {
        let line = &mmap[start..end];
        let mut buf = line.to_vec();
        let val: Value = match simd_json::from_slice(&mut buf) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let line_type = val.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let timestamp = convert_timestamp(&val);

        if session_id.is_empty() {
            if let Some(sid) = val.get("sessionId").and_then(|v| v.as_str()) {
                session_id = sid.to_string();
            }
        }

        match line_type {
            "message" => {
                if let Some(msg) = convert_message(&val, &session_id, &timestamp, &mut msg_counter)
                {
                    messages.push(msg);
                }
            }
            "function_call" => {
                messages.push(convert_function_call(
                    &val,
                    &session_id,
                    &timestamp,
                    &mut msg_counter,
                ));
            }
            "function_call_result" => {
                messages.push(convert_function_call_result(
                    &val,
                    &session_id,
                    &timestamp,
                    &mut msg_counter,
                ));
            }
            _ => {}
        }
    }

    Ok(messages)
}

/// Search `CodeBuddy` sessions for a query string
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let base_path = get_base_path().ok_or("CodeBuddy not found")?;
    let base = Path::new(&base_path);
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for entry in WalkDir::new(base)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
    {
        if results.len() >= limit {
            break;
        }

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

/// Validate that a session path is within `~/.codebuddy/projects`
fn validate_session_path(path: &Path) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let allowed = home.join(".codebuddy").join("projects");

    let canonical = if path.exists() {
        path.canonicalize()
            .map_err(|e| format!("Path canonicalization error: {e}"))?
    } else {
        path.to_path_buf()
    };

    let canonical_allowed = if allowed.exists() {
        allowed
            .canonicalize()
            .map_err(|e| format!("Path canonicalization error: {e}"))?
    } else {
        allowed
    };

    if canonical.starts_with(&canonical_allowed) {
        Ok(())
    } else {
        Err(format!(
            "Session path is outside CodeBuddy projects directory: {}",
            path.display()
        ))
    }
}

/// Convert a numeric or string timestamp to ISO 8601 string.
///
/// `CodeBuddy` uses Unix milliseconds (numeric), while Claude uses ISO 8601 strings.
fn convert_timestamp(val: &Value) -> String {
    match val.get("timestamp") {
        Some(Value::Number(n)) => {
            if let Some(ms) = n.as_i64() {
                DateTime::from_timestamp_millis(ms)
                    .unwrap_or_else(Utc::now)
                    .to_rfc3339()
            } else {
                Utc::now().to_rfc3339()
            }
        }
        Some(Value::String(s)) => s.clone(),
        _ => Utc::now().to_rfc3339(),
    }
}

/// Convert content array: `input_text`/`output_text` -> `text`
fn convert_content_array(content: Option<&Value>) -> Option<Value> {
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
                "image_blob_ref" => Some(item.clone()),
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

/// Convert a `"message"` type entry to `ClaudeMessage`
fn convert_message(
    val: &Value,
    session_id: &str,
    timestamp: &str,
    counter: &mut u64,
) -> Option<ClaudeMessage> {
    let role = val.get("role").and_then(|r| r.as_str())?;

    // Skip system-injected messages (providerData.skipRun with XML content)
    if val
        .get("providerData")
        .and_then(|pd| pd.get("skipRun"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        if let Some(content) = val.get("content") {
            if let Some(arr) = content.as_array() {
                if let Some(first) = arr.first() {
                    if let Some(text) = first.get("text").and_then(|t| t.as_str()) {
                        if text.starts_with("<system-reminder")
                            || text.starts_with("<command-name>")
                            || text.starts_with("<local-command-stdout>")
                        {
                            return None;
                        }
                    }
                }
            }
        }
    }

    *counter += 1;
    let uuid = val
        .get("id")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| format!("codebuddy-{counter}"));

    let message_type = match role {
        "assistant" => "assistant",
        "system" => "system",
        _ => "user",
    };

    let content = convert_content_array(val.get("content"));

    Some(build_provider_message(
        PROVIDER_ID,
        uuid,
        session_id,
        timestamp.to_string(),
        message_type,
        Some(role),
        content,
        None,
    ))
}

/// Convert a `"function_call"` entry to a Claude-native `tool_use` message.
///
/// Output mirrors Claude Code's assistant-with-`tool_use` format:
///   - top-level type: "assistant"
///   - content: `[{type:"tool_use", id:<callId>, name, input:<parsed object>}]`
///
/// Note `arguments` in `CodeBuddy` JSONL is a JSON-encoded **string** (e.g.
/// `"{\"command\":\"ls\"}"`), not an object. We parse it so the frontend
/// renderers (`BashCard`, `GrepCard`, etc.) can read individual params.
fn convert_function_call(
    val: &Value,
    session_id: &str,
    timestamp: &str,
    counter: &mut u64,
) -> ClaudeMessage {
    *counter += 1;
    let uuid = val
        .get("id")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| format!("codebuddy-fc-{counter}"));

    let name = val
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown_tool");
    // Use callId as the tool_use id — that's what frontend pairs results by.
    let call_id = val.get("callId").and_then(|v| v.as_str()).unwrap_or("");

    // arguments is a JSON-encoded string in CodeBuddy. Parse to object so
    // BashCard etc. can read input.command, input.pattern, input.file_path.
    let input = match val.get("arguments") {
        Some(Value::String(s)) => serde_json::from_str::<Value>(s).unwrap_or(Value::Null),
        Some(other) => other.clone(),
        None => Value::Null,
    };

    let tool_use = serde_json::json!({
        "type": "tool_use",
        "id": call_id,
        "name": name,
        "input": input,
    });

    let content = Some(Value::Array(vec![tool_use.clone()]));

    let mut msg = build_provider_message(
        PROVIDER_ID,
        uuid,
        session_id,
        timestamp.to_string(),
        "assistant",
        Some("assistant"),
        content,
        None,
    );
    msg.tool_use = Some(tool_use);
    msg
}

/// Convert a `"function_call_result"` entry to a Claude-native `tool_result`
/// message.
///
/// Output mirrors Claude Code's user-with-`tool_result` format:
///   - top-level type: "user"
///   - content: `[{type:"tool_result", tool_use_id:<callId>, content:<text>}]`
///   - top-level `toolUseResult` field (so the legacy `ToolExecutionResultRouter`
///     also renders it, matching Claude's UI behavior).
///
/// Source field shape: `CodeBuddy` puts result text under `output` (not
/// `content`) and looks like `{type:"text", text:"..."}` or
/// `{type:"text", text:"...", title:"..."}`.
fn convert_function_call_result(
    val: &Value,
    session_id: &str,
    timestamp: &str,
    counter: &mut u64,
) -> ClaudeMessage {
    *counter += 1;
    let uuid = val
        .get("id")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| format!("codebuddy-fcr-{counter}"));

    let call_id = val.get("callId").and_then(|v| v.as_str()).unwrap_or("");

    // Extract text from `output` (CodeBuddy's actual field). Fall back to
    // `content`/`message.content` for forward-compat with format changes.
    let text = val
        .get("output")
        .and_then(|o| {
            o.get("text")
                .and_then(|t| t.as_str())
                .map(String::from)
                .or_else(|| {
                    // output may itself be a string in some variants
                    o.as_str().map(String::from)
                })
        })
        .or_else(|| {
            val.get("content")
                .and_then(|c| c.as_str())
                .map(String::from)
        })
        .or_else(|| {
            val.get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
                .map(String::from)
        })
        .unwrap_or_default();

    let is_error = val.get("status").and_then(|s| s.as_str()) == Some("error");

    // Build inline tool_result item — frontend matches by tool_use_id.
    let mut tool_result_item = serde_json::json!({
        "type": "tool_result",
        "tool_use_id": call_id,
        "content": text,
    });
    if is_error {
        tool_result_item["is_error"] = Value::Bool(true);
    }

    let content = Some(Value::Array(vec![tool_result_item.clone()]));

    let mut msg = build_provider_message(
        PROVIDER_ID,
        uuid,
        session_id,
        timestamp.to_string(),
        "user",
        Some("user"),
        content,
        None,
    );
    // Also set the legacy top-level toolUseResult field so the
    // ToolExecutionResultRouter renders the result block (matches Claude).
    msg.tool_use_result = Some(tool_result_item);
    msg
}

/// Extract session metadata from a JSONL file
#[allow(unsafe_code)]
fn extract_session_info(file_path: &Path) -> Option<ClaudeSession> {
    let file = File::open(file_path).ok()?;
    // SAFETY: File is read-only
    let mmap = unsafe { Mmap::map(&file) }.ok()?;
    let ranges = find_line_ranges(&mmap);

    let mut session_id = String::new();
    let mut message_count = 0usize;
    let mut first_time = String::new();
    let mut last_time = String::new();
    let mut has_tool_use = false;
    let mut summary: Option<String> = None;
    let mut first_user_text: Option<String> = None;

    for &(start, end) in &ranges {
        let line = &mmap[start..end];
        let mut buf = line.to_vec();
        let val: Value = match simd_json::from_slice(&mut buf) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let line_type = val.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let timestamp = convert_timestamp(&val);

        match line_type {
            "message" => {
                let role = val.get("role").and_then(|r| r.as_str()).unwrap_or("");

                if val
                    .get("providerData")
                    .and_then(|pd| pd.get("skipRun"))
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                {
                    continue;
                }

                if session_id.is_empty() {
                    if let Some(sid) = val.get("sessionId").and_then(|v| v.as_str()) {
                        session_id = sid.to_string();
                    }
                }

                message_count += 1;

                if first_time.is_empty() {
                    first_time.clone_from(&timestamp);
                }
                last_time = timestamp;

                if first_user_text.is_none() && role == "user" {
                    if let Some(content) = val.get("content").and_then(|c| c.as_array()) {
                        for item in content {
                            if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                                if !text.starts_with('<') {
                                    let truncated = if text.chars().count() > 100 {
                                        format!("{}...", text.chars().take(100).collect::<String>())
                                    } else {
                                        text.to_string()
                                    };
                                    first_user_text = Some(truncated);
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            "function_call" | "function_call_result" => {
                message_count += 1;
                has_tool_use = true;

                if first_time.is_empty() {
                    first_time.clone_from(&timestamp);
                }
                last_time = timestamp;
            }
            "summary" => {
                if let Some(s) = val.get("summary").and_then(|v| v.as_str()) {
                    summary = Some(s.to_string());
                }
            }
            "topic" => {
                if summary.is_none() {
                    if let Some(topic) = val.get("topic").and_then(|v| v.as_str()) {
                        summary = Some(topic.to_string());
                    }
                }
            }
            _ => {}
        }
    }

    if message_count == 0 {
        return None;
    }

    let file_path_str = file_path.to_string_lossy().to_string();
    let project_name = file_path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let last_modified = file_path
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .map(|t| {
            let dt: DateTime<Utc> = t.into();
            dt.to_rfc3339()
        })
        .unwrap_or_else(|| Utc::now().to_rfc3339());

    let final_summary = summary.or(first_user_text);

    Some(ClaudeSession {
        session_id: file_path_str.clone(),
        actual_session_id: if session_id.is_empty() {
            file_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string()
        } else {
            session_id
        },
        file_path: file_path_str,
        project_name,
        message_count,
        first_message_time: if first_time.is_empty() {
            Utc::now().to_rfc3339()
        } else {
            first_time
        },
        last_message_time: if last_time.is_empty() {
            Utc::now().to_rfc3339()
        } else {
            last_time
        },
        last_modified,
        has_tool_use,
        has_errors: false,
        summary: final_summary,
        is_renamed: false,
        provider: Some(PROVIDER_ID.to_string()),
        storage_type: None,
        entrypoint: Some("cli".to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// `function_call.arguments` is a JSON string in `CodeBuddy`. Verify we
    /// parse it into a real object so frontend renderers can read individual
    /// params (e.g. `BashCard` reads `input.command`).
    #[test]
    fn function_call_parses_arguments_string_to_object() {
        let raw = json!({
            "type": "function_call",
            "id": "fc-1",
            "callId": "toolu_abc",
            "name": "Bash",
            "arguments": "{\"command\":\"ls -la\",\"description\":\"list files\"}",
            "timestamp": 1779785490404_i64,
        });

        let mut counter = 0u64;
        let msg = convert_function_call(&raw, "session-1", "2026-05-29T00:00:00Z", &mut counter);

        let content = msg.content.expect("content present");
        let arr = content.as_array().expect("content is array");
        assert_eq!(arr.len(), 1);
        let tool_use = &arr[0];

        assert_eq!(tool_use["type"], "tool_use");
        assert_eq!(tool_use["id"], "toolu_abc");
        assert_eq!(tool_use["name"], "Bash");
        // Critical: input must be an OBJECT, not a string
        let input = &tool_use["input"];
        assert!(input.is_object(), "input must be parsed object, got: {input:?}");
        assert_eq!(input["command"], "ls -la");
        assert_eq!(input["description"], "list files");
    }

    /// Even when arguments is malformed JSON, conversion shouldn't panic —
    /// it should fall back to `Value::Null` so the message still renders.
    #[test]
    fn function_call_handles_malformed_arguments_gracefully() {
        let raw = json!({
            "type": "function_call",
            "callId": "toolu_x",
            "name": "Bash",
            "arguments": "this is not json",
        });
        let mut counter = 0u64;
        let msg = convert_function_call(&raw, "s", "t", &mut counter);
        let content = msg.content.unwrap();
        let tool_use = &content[0];
        // Either Null or a string — but must NOT panic
        assert!(tool_use["input"].is_null() || tool_use["input"].is_string());
    }

    /// `function_call_result.output` is the result text source (NOT `content`).
    /// Verify we extract it and produce a Claude-native `tool_result` with
    /// `tool_use_id` matching the original `callId`.
    #[test]
    fn function_call_result_extracts_output_field() {
        let raw = json!({
            "type": "function_call_result",
            "id": "fcr-1",
            "callId": "toolu_abc",
            "name": "Bash",
            "status": "completed",
            "output": {
                "type": "text",
                "text": "file1.txt\nfile2.txt\n"
            },
        });

        let mut counter = 0u64;
        let msg = convert_function_call_result(&raw, "session-1", "2026-05-29T00:00:00Z", &mut counter);

        // Should be a "user" type message (Claude-native shape)
        assert_eq!(msg.message_type, "user");

        let content = msg.content.expect("content present");
        let arr = content.as_array().expect("array");
        assert_eq!(arr.len(), 1);

        let tool_result = &arr[0];
        assert_eq!(tool_result["type"], "tool_result");
        // Critical: tool_use_id must equal original callId so frontend can pair
        assert_eq!(tool_result["tool_use_id"], "toolu_abc");
        // Critical: text from output.text — not from content
        assert_eq!(tool_result["content"], "file1.txt\nfile2.txt\n");
        // Status "completed" should NOT set is_error
        assert!(tool_result.get("is_error").is_none());

        // Top-level toolUseResult also set (so legacy router renders it)
        assert!(msg.tool_use_result.is_some());
    }

    /// Error status should mark the result as `is_error: true` so the
    /// `StatusBadge` shows the red "error" state instead of green "completed".
    #[test]
    fn function_call_result_marks_errors() {
        let raw = json!({
            "type": "function_call_result",
            "callId": "toolu_y",
            "status": "error",
            "output": { "type": "text", "text": "command not found" },
        });
        let mut counter = 0u64;
        let msg = convert_function_call_result(&raw, "s", "t", &mut counter);
        let content = msg.content.unwrap();
        let tool_result = &content[0];
        assert_eq!(tool_result["is_error"], true);
    }

    /// `convert_message` must preserve the `system` role rather than coerce it
    /// into `user`. The previous `if/else` collapsed everything non-assistant
    /// into "user", which mislabeled system reminders / command output messages
    /// and broke filtering & visual distinction in the UI.
    #[test]
    fn convert_message_preserves_system_role() {
        let raw = json!({
            "type": "message",
            "id": "msg-sys-1",
            "role": "system",
            "sessionId": "session-1",
            "timestamp": 1779785490404_i64,
            "content": [{"type": "text", "text": "system reminder"}],
        });

        let mut counter = 0u64;
        let msg = convert_message(&raw, "session-1", "2026-05-29T00:00:00Z", &mut counter)
            .expect("system message should not be filtered out");

        assert_eq!(
            msg.message_type, "system",
            "system role must produce message_type == \"system\""
        );
        assert_eq!(msg.role.as_deref(), Some("system"));
    }

    /// Sanity check: assistant role still maps to "assistant".
    #[test]
    fn convert_message_preserves_assistant_role() {
        let raw = json!({
            "type": "message",
            "id": "msg-a-1",
            "role": "assistant",
            "sessionId": "session-1",
            "timestamp": 1779785490404_i64,
            "content": [{"type": "output_text", "text": "hi"}],
        });
        let mut counter = 0u64;
        let msg = convert_message(&raw, "session-1", "2026-05-29T00:00:00Z", &mut counter).unwrap();
        assert_eq!(msg.message_type, "assistant");
    }

    /// `load_sessions` must reject empty paths up-front. Defense in depth:
    /// caller code should not pass empty paths, but if it does we want a clear
    /// error rather than silently scanning whatever `Path::new("")` resolves to.
    #[test]
    fn load_sessions_rejects_empty_path() {
        let result = load_sessions("", false);
        assert!(result.is_err(), "empty path must error, got: {result:?}");
        assert!(
            result.unwrap_err().contains("required"),
            "error message should mention the missing parameter"
        );
    }

    /// `load_sessions` must reject paths outside `~/.codebuddy/projects` to
    /// prevent path-traversal-style reads of arbitrary directories on disk.
    #[test]
    fn load_sessions_rejects_path_outside_codebuddy_root() {
        // /tmp definitely exists on macOS/Linux and is outside the codebuddy
        // root. The function checks existence first, so we need a real path.
        let result = load_sessions("/tmp", false);
        // Either errors with the "outside" message, or — if /tmp doesn't
        // canonicalize on this platform — errors with a canonicalize message.
        // Both are acceptable; what we want to guard against is `Ok(...)`.
        assert!(
            result.is_err(),
            "path outside codebuddy root must error, got: {result:?}"
        );
    }
}
