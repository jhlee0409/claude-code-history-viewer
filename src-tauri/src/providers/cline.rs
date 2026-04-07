use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::providers::ProviderInfo;
use crate::utils::{
    build_provider_message, is_symlink, ms_to_iso, search_json_value_case_insensitive,
};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Known Cline-family extension IDs and their display names
const EXTENSIONS: &[(&str, &str)] = &[
    ("saoudrizwan.claude-dev", "Cline"),
    ("rooveterinaryinc.roo-cline", "Roo Code"),
];

/// Detect Cline/Roo Code installations
pub fn detect() -> Option<ProviderInfo> {
    let paths = get_all_base_paths();
    let is_available = !paths.is_empty();

    Some(ProviderInfo {
        id: "cline".to_string(),
        display_name: "Cline".to_string(),
        base_path: paths
            .first()
            .map(|(p, _)| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        is_available,
    })
}

/// Scan all Cline/Roo Code projects
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let mut projects = Vec::new();

    for (base_path, label) in get_all_base_paths() {
        let task_history = load_task_history(&base_path);
        if task_history.is_empty() {
            continue;
        }

        // Group tasks by cwd
        let mut by_cwd: HashMap<String, Vec<&Value>> = HashMap::new();
        for item in &task_history {
            let cwd = item
                .get("cwdOnTaskInitialization")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            by_cwd.entry(cwd.to_string()).or_default().push(item);
        }

        for (cwd, tasks) in &by_cwd {
            let project_name = PathBuf::from(cwd)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            let session_count = tasks.len();
            let message_count: usize = tasks
                .iter()
                .filter_map(|t| t.get("tokensIn").and_then(Value::as_u64))
                .count()
                * 2; // rough estimate

            let last_modified = tasks
                .iter()
                .filter_map(|t| t.get("ts").and_then(Value::as_f64))
                .fold(0.0f64, f64::max);

            let last_modified_str = ms_to_iso(last_modified as u64);

            projects.push(ClaudeProject {
                name: project_name,
                path: format!("cline://{}:{}", base_path.to_string_lossy(), cwd),
                actual_path: cwd.clone(),
                session_count,
                message_count,
                last_modified: last_modified_str,
                git_info: None,
                provider: Some("cline".to_string()),
                storage_type: Some("json".to_string()),
                custom_directory_label: Some(label.clone()),
            });
        }
    }

    Ok(projects)
}

/// Load sessions for a Cline project
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let (base_path, target_cwd) = parse_project_path(project_path)?;
    let task_history = load_task_history(&base_path);

    let project_name = PathBuf::from(&target_cwd)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let mut sessions: Vec<ClaudeSession> = task_history
        .iter()
        .filter(|item| {
            item.get("cwdOnTaskInitialization")
                .and_then(Value::as_str)
                .unwrap_or("")
                == target_cwd
        })
        .filter_map(|item| {
            let id = item.get("id").and_then(Value::as_str)?;
            let ts = item.get("ts").and_then(Value::as_f64).unwrap_or(0.0) as u64;
            let task = item
                .get("task")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let model = item.get("modelId").and_then(Value::as_str);

            let ui_messages_path = base_path.join("tasks").join(id).join("ui_messages.json");
            // Use token counts as a proxy for message count to avoid reading full JSON
            let tokens_in = item.get("tokensIn").and_then(Value::as_u64).unwrap_or(0);
            let tokens_out = item.get("tokensOut").and_then(Value::as_u64).unwrap_or(0);
            let message_count = if tokens_in > 0 || tokens_out > 0 {
                2
            } else {
                0
            };

            let timestamp = ms_to_iso(ts);

            Some(ClaudeSession {
                session_id: format!("cline://{}:{}", base_path.to_string_lossy(), id),
                actual_session_id: id.to_string(),
                file_path: ui_messages_path.to_string_lossy().to_string(),
                project_name: project_name.clone(),
                message_count,
                first_message_time: timestamp.clone(),
                last_message_time: timestamp.clone(),
                last_modified: timestamp,
                has_tool_use: true, // Cline is heavily tool-based
                has_errors: false,
                summary: if task.len() > 100 {
                    Some(format!("{}...", &task[..100]))
                } else if task.is_empty() {
                    model.map(String::from)
                } else {
                    Some(task)
                },
                is_renamed: false,
                provider: Some("cline".to_string()),
                storage_type: Some("json".to_string()),
            })
        })
        .collect();

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

/// Load messages from a Cline task
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let (base_path, task_id) = parse_session_path(session_path)?;

    let ui_path = base_path
        .join("tasks")
        .join(&task_id)
        .join("ui_messages.json");
    if !ui_path.is_file() {
        return Err(format!("UI messages file not found for task {task_id}"));
    }

    let data =
        fs::read_to_string(&ui_path).map_err(|e| format!("Failed to read ui_messages: {e}"))?;
    let ui_messages: Vec<Value> =
        serde_json::from_str(&data).map_err(|e| format!("Failed to parse ui_messages: {e}"))?;

    let mut messages = Vec::new();
    let mut counter = 0u64;

    for msg in &ui_messages {
        if let Some(claude_msg) = convert_cline_message(msg, &task_id, &mut counter) {
            messages.push(claude_msg);
        }
    }

    Ok(messages)
}

/// Search across all Cline tasks
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for (base_path, _) in get_all_base_paths() {
        let task_history = load_task_history(&base_path);

        for item in &task_history {
            let id = match item.get("id").and_then(Value::as_str) {
                Some(id) => id,
                None => continue,
            };

            let project_name = item
                .get("cwdOnTaskInitialization")
                .and_then(Value::as_str)
                .and_then(|p| {
                    PathBuf::from(p)
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                })
                .unwrap_or_default();

            let ui_path = base_path.join("tasks").join(id).join("ui_messages.json");
            let data = match fs::read_to_string(&ui_path) {
                Ok(d) => d,
                Err(_) => continue,
            };
            let ui_messages: Vec<Value> = match serde_json::from_str(&data) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let mut counter = 0u64;
            for msg in &ui_messages {
                if let Some(mut claude_msg) = convert_cline_message(msg, id, &mut counter) {
                    if let Some(ref c) = claude_msg.content {
                        if search_json_value_case_insensitive(c, &query_lower) {
                            claude_msg.project_name = Some(project_name.clone());
                            results.push(claude_msg);
                            if results.len() >= limit {
                                return Ok(results);
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(results)
}

// ============================================================================
// Private helpers
// ============================================================================

fn get_all_base_paths() -> Vec<(PathBuf, String)> {
    let mut paths = Vec::new();

    let editors: &[(&str, &str)] = &[
        ("Code", "VS Code"),
        ("Cursor", "Cursor"),
        ("Code - Insiders", "VS Code Insiders"),
        ("Codium", "VSCodium"),
    ];

    // macOS: ~/Library/Application Support/<editor>/User/globalStorage/
    #[cfg(target_os = "macos")]
    if let Some(home) = dirs::home_dir() {
        let app_support = home.join("Library/Application Support");

        for (editor_dir, editor_label) in editors {
            let global_storage = app_support.join(editor_dir).join("User/globalStorage");
            if !global_storage.is_dir() {
                continue;
            }

            for (ext_id, ext_name) in EXTENSIONS {
                let ext_path = global_storage.join(ext_id);
                if ext_path.is_dir() && !is_symlink(&ext_path) {
                    let label = format!("{ext_name} ({editor_label})");
                    paths.push((ext_path, label));
                }
            }
        }
    }

    // Linux: ~/.config/<editor>/User/globalStorage/
    #[cfg(target_os = "linux")]
    if let Some(config) = dirs::config_dir() {
        for (editor_dir, editor_label) in editors {
            let global_storage = config.join(editor_dir).join("User/globalStorage");
            if !global_storage.is_dir() {
                continue;
            }
            for (ext_id, ext_name) in EXTENSIONS {
                let ext_path = global_storage.join(ext_id);
                if ext_path.is_dir() && !is_symlink(&ext_path) {
                    let label = format!("{ext_name} ({editor_label})");
                    paths.push((ext_path, label));
                }
            }
        }
    }

    // Windows: %APPDATA%\<editor>\User\globalStorage\
    #[cfg(target_os = "windows")]
    if let Some(home) = dirs::home_dir() {
        let app_data = home.join("AppData").join("Roaming");

        for (editor_dir, editor_label) in editors {
            let global_storage = app_data.join(editor_dir).join("User").join("globalStorage");
            if !global_storage.is_dir() {
                continue;
            }

            for (ext_id, ext_name) in EXTENSIONS {
                let ext_path = global_storage.join(ext_id);
                if ext_path.is_dir() && !is_symlink(&ext_path) {
                    let label = format!("{ext_name} ({editor_label})");
                    paths.push((ext_path, label));
                }
            }
        }
    }

    paths
}

fn load_task_history(base_path: &Path) -> Vec<Value> {
    // Cline format: state/taskHistory.json
    let cline_path = base_path.join("state/taskHistory.json");
    if cline_path.is_file() {
        if let Ok(data) = fs::read_to_string(&cline_path) {
            if let Ok(items) = serde_json::from_str::<Vec<Value>>(&data) {
                return items;
            }
        }
    }

    // Roo Code format: tasks/_index.json
    let roo_index = base_path.join("tasks/_index.json");
    if roo_index.is_file() {
        if let Ok(data) = fs::read_to_string(&roo_index) {
            if let Ok(index) = serde_json::from_str::<Value>(&data) {
                if let Some(entries) = index.get("entries").and_then(Value::as_array) {
                    return entries.clone();
                }
            }
        }
    }

    Vec::new()
}

fn parse_project_path(project_path: &str) -> Result<(PathBuf, String), String> {
    let path = project_path
        .strip_prefix("cline://")
        .unwrap_or(project_path);

    let (base, cwd) = path
        .split_once(':')
        .ok_or_else(|| format!("Invalid project path: {project_path}"))?;

    Ok((PathBuf::from(base), cwd.to_string()))
}

fn parse_session_path(session_path: &str) -> Result<(PathBuf, String), String> {
    let path = session_path
        .strip_prefix("cline://")
        .unwrap_or(session_path);

    let (base, task_id) = path
        .split_once(':')
        .ok_or_else(|| format!("Invalid session path: {session_path}"))?;

    let base_path = PathBuf::from(base);
    if !base_path.is_absolute() {
        return Err("Cline base path must be absolute".to_string());
    }

    // Reject path traversal in task_id
    if task_id.contains("..") || task_id.contains('/') || task_id.contains('\\') {
        return Err(format!("Invalid task ID: {task_id}"));
    }

    Ok((base_path, task_id.to_string()))
}

/// Convert a `ClineMessage` to `ClaudeMessage`
fn convert_cline_message(
    msg: &Value,
    session_id: &str,
    counter: &mut u64,
) -> Option<ClaudeMessage> {
    let msg_type = msg.get("type").and_then(Value::as_str)?;
    let ts = msg.get("ts").and_then(Value::as_f64).unwrap_or(0.0) as u64;
    let timestamp = ms_to_iso(ts);
    let text = msg.get("text").and_then(Value::as_str).unwrap_or("");

    *counter += 1;
    let uuid = format!("cline-{counter}");

    match msg_type {
        "say" => {
            let say = msg.get("say").and_then(Value::as_str).unwrap_or("");
            convert_say_message(say, text, msg, &uuid, session_id, &timestamp)
        }
        "ask" => {
            let ask = msg.get("ask").and_then(Value::as_str).unwrap_or("");
            convert_ask_message(ask, text, &uuid, session_id, &timestamp)
        }
        _ => None,
    }
}

fn convert_say_message(
    say: &str,
    text: &str,
    msg: &Value,
    uuid: &str,
    session_id: &str,
    timestamp: &str,
) -> Option<ClaudeMessage> {
    match say {
        "text" | "completion_result" => {
            if text.is_empty() {
                return None;
            }
            let content = serde_json::json!([{"type": "text", "text": text}]);
            Some(build_provider_message(
                "cline",
                uuid.to_string(),
                session_id,
                timestamp.to_string(),
                "assistant",
                Some("assistant"),
                Some(content),
                None,
            ))
        }
        "reasoning" => {
            let reasoning_text = msg.get("reasoning").and_then(Value::as_str).unwrap_or(text);
            if reasoning_text.is_empty() {
                return None;
            }
            let content = serde_json::json!([{"type": "thinking", "thinking": reasoning_text}]);
            Some(build_provider_message(
                "cline",
                uuid.to_string(),
                session_id,
                timestamp.to_string(),
                "assistant",
                Some("assistant"),
                Some(content),
                None,
            ))
        }
        "tool" => {
            let tool_data: Value = serde_json::from_str(text).unwrap_or(Value::Null);
            let tool_name = tool_data
                .get("tool")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let mapped = map_cline_tool_name(tool_name);
            let path = tool_data.get("path").and_then(Value::as_str).unwrap_or("");

            let mut blocks = vec![serde_json::json!({
                "type": "tool_use",
                "id": format!("cline_tool_{uuid}"),
                "name": mapped,
                "input": {"path": path}
            })];

            // If there's content (result), add tool_result
            if let Some(result_text) = tool_data.get("content").and_then(Value::as_str) {
                blocks.push(serde_json::json!({
                    "type": "tool_result",
                    "tool_use_id": format!("cline_tool_{uuid}"),
                    "content": if result_text.len() > 2000 {
                        format!("{}...(truncated)", &result_text[..2000])
                    } else {
                        result_text.to_string()
                    }
                }));
            }

            // If there's a diff, add it
            if let Some(diff) = tool_data.get("diff").and_then(Value::as_str) {
                blocks.push(serde_json::json!({
                    "type": "text",
                    "text": format!("```diff\n{diff}\n```")
                }));
            }

            Some(build_provider_message(
                "cline",
                uuid.to_string(),
                session_id,
                timestamp.to_string(),
                "assistant",
                Some("assistant"),
                Some(Value::Array(blocks)),
                None,
            ))
        }
        "command" => {
            if text.is_empty() {
                return None;
            }
            let content = serde_json::json!([{
                "type": "tool_use",
                "id": format!("cline_cmd_{uuid}"),
                "name": "Bash",
                "input": {"command": text}
            }]);
            Some(build_provider_message(
                "cline",
                uuid.to_string(),
                session_id,
                timestamp.to_string(),
                "assistant",
                Some("assistant"),
                Some(content),
                None,
            ))
        }
        "command_output" => {
            if text.is_empty() {
                return None;
            }
            // Render as a text block with terminal styling (the command tool_use
            // is in the preceding "command" message — they are paired by ordering)
            let content = serde_json::json!([{
                "type": "text",
                "text": format!("```\n{text}\n```")
            }]);
            Some(build_provider_message(
                "cline",
                uuid.to_string(),
                session_id,
                timestamp.to_string(),
                "assistant",
                Some("assistant"),
                Some(content),
                None,
            ))
        }
        "error" => {
            if text.is_empty() {
                return None;
            }
            let content = serde_json::json!([{"type": "text", "text": text}]);
            let mut msg = build_provider_message(
                "cline",
                uuid.to_string(),
                session_id,
                timestamp.to_string(),
                "system",
                None,
                Some(content),
                None,
            );
            msg.subtype = Some("error".to_string());
            msg.level = Some("error".to_string());
            Some(msg)
        }
        "user_feedback" | "user_feedback_diff" => {
            if text.is_empty() {
                return None;
            }
            let content = serde_json::json!([{"type": "text", "text": text}]);
            Some(build_provider_message(
                "cline",
                uuid.to_string(),
                session_id,
                timestamp.to_string(),
                "user",
                Some("user"),
                Some(content),
                None,
            ))
        }
        // Skip internal/metadata messages
        "api_req_started"
        | "api_req_finished"
        | "api_req_retried"
        | "deleted_api_reqs"
        | "shell_integration_warning"
        | "shell_integration_warning_with_suggestion"
        | "checkpoint_created"
        | "load_mcp_documentation"
        | "info"
        | "task_progress"
        | "hook_status"
        | "hook_output_stream"
        | "conditional_rules_applied" => None,
        _ => {
            // For any other say type with text, show as assistant text
            if text.is_empty() {
                return None;
            }
            let content = serde_json::json!([{"type": "text", "text": text}]);
            Some(build_provider_message(
                "cline",
                uuid.to_string(),
                session_id,
                timestamp.to_string(),
                "assistant",
                Some("assistant"),
                Some(content),
                None,
            ))
        }
    }
}

fn convert_ask_message(
    ask: &str,
    text: &str,
    uuid: &str,
    session_id: &str,
    timestamp: &str,
) -> Option<ClaudeMessage> {
    match ask {
        "followup" | "act_mode_respond" | "plan_mode_respond" => {
            if text.is_empty() {
                return None;
            }
            let content = serde_json::json!([{"type": "text", "text": text}]);
            Some(build_provider_message(
                "cline",
                uuid.to_string(),
                session_id,
                timestamp.to_string(),
                "user",
                Some("user"),
                Some(content),
                None,
            ))
        }
        // Skip permission/confirmation prompts
        _ => None,
    }
}

fn map_cline_tool_name(name: &str) -> &str {
    match name {
        "readFile" => "Read",
        "editedExistingFile" | "newFileCreated" | "fileDeleted" => "Write",
        "listFilesTopLevel" | "listFilesRecursive" | "listCodeDefinitionNames" => "Glob",
        "searchFiles" => "Grep",
        "webFetch" => "WebFetch",
        "webSearch" => "WebSearch",
        _ => name,
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_convert_say_text() {
        let msg = json!({
            "ts": 1700000000000u64,
            "type": "say",
            "say": "text",
            "text": "Hello from Cline"
        });
        let mut counter = 0;
        let result = convert_cline_message(&msg, "test", &mut counter).unwrap();
        assert_eq!(result.message_type, "assistant");
        assert_eq!(result.provider, Some("cline".to_string()));
    }

    #[test]
    fn test_convert_say_tool() {
        let msg = json!({
            "ts": 1700000000000u64,
            "type": "say",
            "say": "tool",
            "text": "{\"tool\":\"readFile\",\"path\":\"/test.txt\",\"content\":\"file contents\"}"
        });
        let mut counter = 0;
        let result = convert_cline_message(&msg, "test", &mut counter).unwrap();
        let content = result.content.unwrap();
        let arr = content.as_array().unwrap();
        assert_eq!(arr[0]["type"], "tool_use");
        assert_eq!(arr[0]["name"], "Read");
        assert_eq!(arr[1]["type"], "tool_result");
    }

    #[test]
    fn test_convert_say_command() {
        let msg = json!({
            "ts": 1700000000000u64,
            "type": "say",
            "say": "command",
            "text": "npm test"
        });
        let mut counter = 0;
        let result = convert_cline_message(&msg, "test", &mut counter).unwrap();
        let content = result.content.unwrap();
        let arr = content.as_array().unwrap();
        assert_eq!(arr[0]["name"], "Bash");
    }

    #[test]
    fn test_convert_say_reasoning() {
        let msg = json!({
            "ts": 1700000000000u64,
            "type": "say",
            "say": "reasoning",
            "text": "thinking about this..."
        });
        let mut counter = 0;
        let result = convert_cline_message(&msg, "test", &mut counter).unwrap();
        let content = result.content.unwrap();
        let arr = content.as_array().unwrap();
        assert_eq!(arr[0]["type"], "thinking");
    }

    #[test]
    fn test_convert_say_error() {
        let msg = json!({
            "ts": 1700000000000u64,
            "type": "say",
            "say": "error",
            "text": "Something went wrong"
        });
        let mut counter = 0;
        let result = convert_cline_message(&msg, "test", &mut counter).unwrap();
        assert_eq!(result.message_type, "system");
        assert_eq!(result.level, Some("error".to_string()));
    }

    #[test]
    fn test_convert_ask_followup() {
        let msg = json!({
            "ts": 1700000000000u64,
            "type": "ask",
            "ask": "followup",
            "text": "Can you explain more?"
        });
        let mut counter = 0;
        let result = convert_cline_message(&msg, "test", &mut counter).unwrap();
        assert_eq!(result.message_type, "user");
    }

    #[test]
    fn test_skip_api_metadata() {
        let msg = json!({
            "ts": 1700000000000u64,
            "type": "say",
            "say": "api_req_started",
            "text": "{}"
        });
        let mut counter = 0;
        assert!(convert_cline_message(&msg, "test", &mut counter).is_none());
    }

    #[test]
    fn test_map_cline_tool_names() {
        assert_eq!(map_cline_tool_name("readFile"), "Read");
        assert_eq!(map_cline_tool_name("editedExistingFile"), "Write");
        assert_eq!(map_cline_tool_name("searchFiles"), "Grep");
        assert_eq!(map_cline_tool_name("webSearch"), "WebSearch");
        assert_eq!(map_cline_tool_name("unknownTool"), "unknownTool");
    }

    #[test]
    fn test_ms_to_iso() {
        let result = ms_to_iso(1700000000000);
        assert!(result.starts_with("2023-11-14T"));
        assert!(result.ends_with('Z'));
    }

    #[test]
    fn test_parse_project_path() {
        let (base, cwd) =
            parse_project_path("cline:///path/to/globalStorage:/Users/jack/project").unwrap();
        assert_eq!(base, PathBuf::from("/path/to/globalStorage"));
        assert_eq!(cwd, "/Users/jack/project");
    }
}
