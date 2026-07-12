use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::providers::ProviderInfo;
use crate::utils::{
    build_provider_message, is_symlink, ms_to_iso, search_json_value_case_insensitive,
};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Known Cline-family extension IDs and their display names
const EXTENSIONS: &[(&str, &str)] = &[
    ("saoudrizwan.claude-dev", "Cline"),
    ("rooveterinaryinc.roo-cline", "Roo Code"),
    // Kilo Code is a Cline/Roo fork: per-task files (api_conversation_history.json,
    // ui_messages.json, task_metadata.json) are byte-identical. But unlike Cline
    // (disk state/taskHistory.json) and Roo (disk tasks/_index.json), Kilo keeps its
    // task index ONLY in VS Code globalState — one row in the global state.vscdb keyed
    // by the extension id — so load_task_history falls back to reading that. The cwd
    // field there is `workspace`, not `cwdOnTaskInitialization` (see task_cwd).
    ("kilocode.kilo-code", "Kilo Code"),
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
            let cwd = task_cwd(item).unwrap_or("unknown");
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
        .filter(|item| task_cwd(item).unwrap_or("") == target_cwd)
        .filter_map(|item| {
            let id = item.get("id").and_then(Value::as_str)?;
            let ts = item.get("ts").and_then(Value::as_f64).unwrap_or(0.0) as u64;
            let task = item
                .get("task")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let label = task_label(item);

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
                summary: session_summary(&task, label),
                is_renamed: false,
                provider: Some("cline".to_string()),
                storage_type: Some("json".to_string()),
                entrypoint: None,
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

            let project_name = task_cwd(item)
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

    paths
}

/// A task's working directory. Cline names this `cwdOnTaskInitialization`; the
/// Roo Code / Kilo Code lineage renames it to `workspace`. Try both so projects
/// group correctly across the whole family.
fn task_cwd(item: &Value) -> Option<&str> {
    item.get("cwdOnTaskInitialization")
        .and_then(Value::as_str)
        .or_else(|| item.get("workspace").and_then(Value::as_str))
}

/// A short model/profile label for a task, used as the session summary when the
/// task text is empty. Cline stores `modelId`; the Roo/Kilo lineage uses
/// `apiConfigName` (or `mode`) instead.
fn task_label(item: &Value) -> Option<String> {
    ["modelId", "apiConfigName", "mode"]
        .iter()
        .find_map(|k| item.get(*k).and_then(Value::as_str))
        .map(str::to_string)
}

/// Session summary: the task text (truncated), or a model/profile label when the
/// task is empty.
fn session_summary(task: &str, label: Option<String>) -> Option<String> {
    if task.is_empty() {
        label
    } else {
        Some(truncate_chars(task, 100, "..."))
    }
}

/// Truncate `text` to at most `max_chars` **characters** (not bytes), appending
/// `suffix` only when truncation occurs. Char-safe: never panics by splitting a
/// multibyte UTF-8 character — Cline/Roo summaries and tool results are often CJK.
fn truncate_chars(text: &str, max_chars: usize, suffix: &str) -> String {
    match text.char_indices().nth(max_chars) {
        Some((idx, _)) => format!("{}{}", &text[..idx], suffix),
        None => text.to_string(),
    }
}

fn load_task_history(base_path: &Path) -> Vec<Value> {
    // Cline format: state/taskHistory.json
    let cline_path = base_path.join("state/taskHistory.json");
    if cline_path.is_file() {
        if let Ok(data) = fs::read_to_string(&cline_path) {
            if let Ok(items) = serde_json::from_str::<Vec<Value>>(&data) {
                if !items.is_empty() {
                    return items;
                }
            }
        }
    }

    // Roo Code format: tasks/_index.json (entries array)
    let roo_index = base_path.join("tasks/_index.json");
    if roo_index.is_file() {
        if let Ok(data) = fs::read_to_string(&roo_index) {
            if let Ok(index) = serde_json::from_str::<Value>(&data) {
                if let Some(entries) = index.get("entries").and_then(Value::as_array) {
                    if !entries.is_empty() {
                        return entries.clone();
                    }
                }
            }
        }
    }

    // Kilo Code (and modern Cline/Roo before they flush to disk) keep the task
    // index only in VS Code globalState. Fall back to reading it from the global
    // state.vscdb that sits beside the extension dir.
    load_task_history_from_global_state(base_path).unwrap_or_default()
}

/// Read the task-history index from VS Code's globalState. VS Code persists each
/// extension's globalState as a single `ItemTable` row in the GLOBAL `state.vscdb`
/// (the sibling of the per-extension dir), keyed by the extension id, whose value
/// is a flat JSON object; the Cline/Roo/Kilo lineage stores its task list under
/// `taskHistory`. This is the only place Kilo Code's history can be found.
fn load_task_history_from_global_state(base_path: &Path) -> Option<Vec<Value>> {
    let ext_id = base_path.file_name()?.to_str()?;
    let db_path = base_path.parent()?.join("state.vscdb");
    if !db_path.is_file() {
        return None;
    }

    let conn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    conn.busy_timeout(std::time::Duration::from_secs(5)).ok()?;
    let raw: String = conn
        .query_row(
            "SELECT value FROM ItemTable WHERE key = ?1",
            [ext_id],
            |row| {
                // VS Code stores the value as TEXT; tolerate BLOB-stored bytes too.
                row.get::<_, String>(0).or_else(|_| {
                    row.get::<_, Vec<u8>>(0)
                        .map(|b| String::from_utf8_lossy(&b).into_owned())
                })
            },
        )
        .ok()?;

    let value: Value = serde_json::from_str(&raw).ok()?;
    let history = value.get("taskHistory")?.as_array()?;
    if history.is_empty() {
        None
    } else {
        Some(history.clone())
    }
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
                    "content": truncate_chars(result_text, 2000, "...(truncated)")
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

    #[test]
    fn test_task_cwd_field_fallback() {
        // Cline uses cwdOnTaskInitialization
        assert_eq!(
            task_cwd(&json!({"cwdOnTaskInitialization": "/c"})),
            Some("/c")
        );
        // Roo Code / Kilo Code rename it to `workspace`
        assert_eq!(task_cwd(&json!({"workspace": "/r"})), Some("/r"));
        // Cline name wins when both are present
        assert_eq!(
            task_cwd(&json!({"cwdOnTaskInitialization": "/c", "workspace": "/r"})),
            Some("/c")
        );
        // Neither present
        assert_eq!(task_cwd(&json!({"id": "x"})), None);
    }

    #[test]
    fn test_load_task_history_from_kilo_global_state() {
        use rusqlite::params;

        let tmp = tempfile::TempDir::new().unwrap();
        let global_storage = tmp.path().join("globalStorage");
        let ext_dir = global_storage.join("kilocode.kilo-code");
        fs::create_dir_all(&ext_dir).unwrap();

        // Mirror how VS Code persists globalState: one ItemTable row per
        // extension id, value = flat JSON of that extension's state.
        let db_path = global_storage.join("state.vscdb");
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute(
                "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
                [],
            )
            .unwrap();
            let value = json!({
                "taskHistory": [
                    {
                        "id": "task-1",
                        "ts": 1_700_000_000_000u64,
                        "task": "Implement Kilo",
                        "workspace": "/Users/jack/proj",
                        "tokensIn": 10,
                        "tokensOut": 20
                    }
                ],
                "someOtherKey": 1
            })
            .to_string();
            conn.execute(
                "INSERT INTO ItemTable (key, value) VALUES (?1, ?2)",
                params!["kilocode.kilo-code", value],
            )
            .unwrap();
        }

        // No disk index exists, so this exercises the globalState fallback.
        let history = load_task_history(&ext_dir);
        assert_eq!(history.len(), 1);
        assert_eq!(task_cwd(&history[0]), Some("/Users/jack/proj"));
        assert_eq!(history[0]["task"], "Implement Kilo");
    }

    #[test]
    fn test_load_task_history_no_index_is_empty() {
        let tmp = tempfile::TempDir::new().unwrap();
        let ext_dir = tmp.path().join("globalStorage").join("kilocode.kilo-code");
        fs::create_dir_all(&ext_dir).unwrap();
        // Neither a disk index nor a state.vscdb → empty, no panic.
        assert!(load_task_history(&ext_dir).is_empty());
    }

    #[test]
    fn test_truncate_chars_is_utf8_safe() {
        // Regression: `&task[..100]` byte-slicing panicked on multibyte text
        // (byte 100 falls mid-character for 3-byte CJK). Char-based never does.
        let cjk = "한".repeat(150);
        let out = truncate_chars(&cjk, 100, "...");
        assert_eq!(out.chars().count(), 103); // 100 chars + "..."
        assert!(out.ends_with("..."));
        // Shorter-than-limit text is returned unchanged (no suffix).
        assert_eq!(truncate_chars("hi", 100, "..."), "hi");
        // Exactly the limit is not truncated.
        let exact = "a".repeat(100);
        assert_eq!(truncate_chars(&exact, 100, "..."), exact);
        // Custom suffix.
        assert_eq!(
            truncate_chars(&"x".repeat(2001), 2000, "...(truncated)"),
            format!("{}...(truncated)", "x".repeat(2000))
        );
    }

    #[test]
    fn test_task_label_field_fallback() {
        assert_eq!(
            task_label(&json!({ "modelId": "claude" })).as_deref(),
            Some("claude")
        );
        // Roo/Kilo have no modelId; they use apiConfigName / mode.
        assert_eq!(
            task_label(&json!({ "apiConfigName": "default" })).as_deref(),
            Some("default")
        );
        assert_eq!(
            task_label(&json!({ "mode": "code" })).as_deref(),
            Some("code")
        );
        assert_eq!(task_label(&json!({ "other": "x" })), None);
    }

    #[test]
    fn test_session_summary() {
        // Non-empty task -> truncated task (char-safe), label ignored.
        assert_eq!(
            session_summary("hello", Some("claude".into())).as_deref(),
            Some("hello")
        );
        // Empty task -> falls back to the label.
        assert_eq!(
            session_summary("", Some("default".into())).as_deref(),
            Some("default")
        );
        // Empty task, no label -> None.
        assert_eq!(session_summary("", None), None);
    }
}
