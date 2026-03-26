use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::providers::ProviderInfo;
use crate::utils::{build_provider_message, ms_to_iso, search_json_value_case_insensitive};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

/// Detect Cursor installation
pub fn detect() -> Option<ProviderInfo> {
    let base = get_base_path()?;
    let global_db = base.join("globalStorage/state.vscdb");
    let is_available = global_db.is_file();

    Some(ProviderInfo {
        id: "cursor".to_string(),
        display_name: "Cursor".to_string(),
        base_path: base.to_string_lossy().to_string(),
        is_available,
    })
}

/// Get Cursor user data path
pub fn get_base_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;

    #[cfg(target_os = "macos")]
    let base = home.join("Library/Application Support/Cursor/User");

    #[cfg(target_os = "linux")]
    let base = home.join(".config/Cursor/User");

    #[cfg(target_os = "windows")]
    let base = home.join("AppData/Roaming/Cursor/User");

    if base.is_dir() {
        Some(base)
    } else {
        None
    }
}

/// Scan Cursor projects by reading workspace directories
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let base = get_base_path().ok_or("Cursor not found")?;
    let ws_dir = base.join("workspaceStorage");

    if !ws_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut projects = Vec::new();

    for entry in fs::read_dir(&ws_dir).map_err(|e| e.to_string())?.flatten() {
        let ws_path = entry.path();
        if !ws_path.is_dir() {
            continue;
        }

        // Read workspace.json to get project folder
        let workspace_json = ws_path.join("workspace.json");
        let project_folder = match read_workspace_folder(&workspace_json) {
            Some(f) => f,
            None => continue,
        };

        // Read composer list from workspace state DB
        let ws_db_path = ws_path.join("state.vscdb");
        let composers = match read_workspace_composers(&ws_db_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        if composers.is_empty() {
            continue;
        }

        let project_name = PathBuf::from(&project_folder)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let session_count = composers.len();
        let last_modified = composers
            .iter()
            .filter_map(|c| c.get("lastUpdatedAt").and_then(Value::as_f64))
            .fold(0.0f64, f64::max);

        projects.push(ClaudeProject {
            name: project_name,
            path: format!("cursor://{}", ws_path.to_string_lossy()),
            actual_path: project_folder,
            session_count,
            message_count: 0, // Loaded on demand
            last_modified: ms_to_iso(last_modified as u64),
            git_info: None,
            provider: Some("cursor".to_string()),
            storage_type: Some("sqlite".to_string()),
            custom_directory_label: None,
        });
    }

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

/// Load sessions (composers) for a Cursor project
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let ws_path = project_path
        .strip_prefix("cursor://")
        .unwrap_or(project_path);

    let ws_db_path = PathBuf::from(ws_path).join("state.vscdb");
    let composers = read_workspace_composers(&ws_db_path)?;

    // Read workspace.json to get the real project folder name
    let workspace_json = PathBuf::from(ws_path).join("workspace.json");
    let project_name = read_workspace_folder(&workspace_json)
        .and_then(|folder| {
            PathBuf::from(&folder)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| "Cursor".to_string());

    let mut sessions: Vec<ClaudeSession> = composers
        .iter()
        .filter_map(|c| {
            let id = c.get("composerId").and_then(Value::as_str)?;
            let name = c.get("name").and_then(Value::as_str).unwrap_or("Untitled");
            let created = c.get("createdAt").and_then(Value::as_f64).unwrap_or(0.0) as u64;
            let updated = c
                .get("lastUpdatedAt")
                .and_then(Value::as_f64)
                .unwrap_or(0.0) as u64;
            let mode = c
                .get("unifiedMode")
                .and_then(Value::as_str)
                .unwrap_or("chat");
            let is_archived = c
                .get("isArchived")
                .and_then(Value::as_bool)
                .unwrap_or(false);

            if is_archived {
                return None;
            }

            Some(ClaudeSession {
                session_id: format!("cursor://{id}"),
                actual_session_id: id.to_string(),
                file_path: format!("cursor://{id}"),
                project_name: project_name.clone(),
                message_count: 0, // Loaded on demand
                first_message_time: ms_to_iso(created),
                last_message_time: ms_to_iso(updated),
                last_modified: ms_to_iso(updated),
                has_tool_use: mode == "agent",
                has_errors: false,
                summary: Some(name.to_string()),
                is_renamed: false,
                provider: Some("cursor".to_string()),
                storage_type: Some("sqlite".to_string()),
            })
        })
        .collect();

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

/// Load messages from a Cursor composer
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let composer_id = session_path
        .strip_prefix("cursor://")
        .unwrap_or(session_path);

    let base = get_base_path().ok_or("Cursor not found")?;
    let global_db_path = base.join("globalStorage/state.vscdb");

    let conn = Connection::open_with_flags(&global_db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open Cursor DB: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to set busy timeout: {e}"))?;

    // Get composer data (ordered bubble list)
    let composer_key = format!("composerData:{composer_id}");
    let composer_data: String = conn
        .query_row(
            "SELECT value FROM cursorDiskKV WHERE key = ?1",
            [&composer_key],
            |row| row.get(0),
        )
        .map_err(|e| format!("Composer not found: {e}"))?;

    let composer: Value = parse_cursor_json(&composer_data)?;

    let headers = composer
        .get("fullConversationHeadersOnly")
        .and_then(Value::as_array)
        .ok_or("No conversation headers found")?;

    // Batch load all bubbles for this composer in a single query
    let prefix = format!("bubbleId:{composer_id}:");
    let mut stmt = conn
        .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE ?1")
        .map_err(|e| format!("Query failed: {e}"))?;
    let pattern = format!("{prefix}%");
    let mut bubble_map: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let rows = stmt
        .query_map([&pattern], |row| {
            let key: String = row.get(0)?;
            let value: String = row.get(1)?;
            Ok((key, value))
        })
        .map_err(|e| format!("Query failed: {e}"))?;
    for row in rows.flatten() {
        let (key, value) = row;
        if let Some(bid) = key.strip_prefix(&prefix) {
            bubble_map.insert(bid.to_string(), value);
        }
    }

    let mut messages = Vec::with_capacity(headers.len());

    for header in headers {
        let bubble_id = match header.get("bubbleId").and_then(Value::as_str) {
            Some(id) => id,
            None => continue,
        };
        let bubble_type = header.get("type").and_then(Value::as_u64).unwrap_or(0);

        let bubble_data = match bubble_map.get(bubble_id) {
            Some(d) => d,
            None => continue,
        };

        let bubble: Value = match parse_cursor_json(bubble_data) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if let Some(msg) = convert_cursor_bubble(&bubble, bubble_type, composer_id) {
            messages.push(msg);
        }
    }

    Ok(messages)
}

/// Search across all Cursor conversations
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let base = get_base_path().ok_or("Cursor not found")?;
    let global_db_path = base.join("globalStorage/state.vscdb");

    if !global_db_path.is_file() {
        return Ok(Vec::new());
    }

    let conn = Connection::open_with_flags(&global_db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open Cursor DB: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to set busy timeout: {e}"))?;

    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    // Search through bubble content using SQL LIKE for efficiency
    let mut stmt = conn
        .prepare(
            "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' AND value LIKE ?1",
        )
        .map_err(|e| format!("Query failed: {e}"))?;

    let pattern = format!("%{query}%");
    let rows = stmt
        .query_map([&pattern], |row| {
            let key: String = row.get(0)?;
            let value: String = row.get(1)?;
            Ok((key, value))
        })
        .map_err(|e| format!("Query failed: {e}"))?;

    for row in rows.flatten() {
        let (key, data) = row;
        let bubble: Value = match parse_cursor_json(&data) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // Extract composer ID from key: bubbleId:<composerId>:<bubbleId>
        let parts: Vec<&str> = key.splitn(3, ':').collect();
        let composer_id = if parts.len() >= 3 { parts[1] } else { "" };

        let bubble_type = bubble.get("type").and_then(Value::as_u64).unwrap_or(0);

        if let Some(mut msg) = convert_cursor_bubble(&bubble, bubble_type, composer_id) {
            if let Some(ref c) = msg.content {
                if search_json_value_case_insensitive(c, &query_lower) {
                    msg.project_name = Some("Cursor".to_string());
                    results.push(msg);
                    if results.len() >= limit {
                        return Ok(results);
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

fn read_workspace_folder(workspace_json_path: &Path) -> Option<String> {
    let data = fs::read_to_string(workspace_json_path).ok()?;
    let json: Value = serde_json::from_str(&data).ok()?;
    let folder = json.get("folder").and_then(Value::as_str)?;
    // "file:///Users/jack/project" → "/Users/jack/project"
    folder.strip_prefix("file://").map(|s| {
        // Handle Windows drive letters: file:///C:/Users/...
        if s.len() > 2 && s.as_bytes()[2] == b':' {
            s[1..].to_string()
        } else {
            s.to_string()
        }
    })
}

fn read_workspace_composers(ws_db_path: &Path) -> Result<Vec<Value>, String> {
    if !ws_db_path.is_file() {
        return Ok(Vec::new());
    }

    let conn = Connection::open_with_flags(ws_db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open workspace DB: {e}"))?;
    let _ = conn.busy_timeout(std::time::Duration::from_secs(5));

    let data: Result<String, _> = conn.query_row(
        "SELECT value FROM ItemTable WHERE key = 'composer.composerData'",
        [],
        |row| row.get(0),
    );

    let data = match data {
        Ok(d) => d,
        Err(_) => return Ok(Vec::new()),
    };

    let json: Value =
        serde_json::from_str(&data).map_err(|e| format!("Failed to parse composer data: {e}"))?;

    let composers = json
        .get("allComposers")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    Ok(composers)
}

/// Parse Cursor's JSON which may contain control characters
fn parse_cursor_json(data: &str) -> Result<Value, String> {
    // Cursor data can contain embedded control characters — sanitize first
    let sanitized: String = data
        .chars()
        .map(|c| {
            if c.is_control() && c != '\n' && c != '\r' && c != '\t' {
                ' '
            } else {
                c
            }
        })
        .collect();

    serde_json::from_str(&sanitized).map_err(|e| format!("JSON parse error: {e}"))
}

/// Convert a Cursor bubble to `ClaudeMessage`
fn convert_cursor_bubble(
    bubble: &Value,
    bubble_type: u64,
    session_id: &str,
) -> Option<ClaudeMessage> {
    let text = bubble.get("text").and_then(Value::as_str).unwrap_or("");
    let bubble_id = bubble
        .get("bubbleId")
        .and_then(Value::as_str)
        .unwrap_or("unknown");

    match bubble_type {
        1 => convert_user_bubble(bubble, text, bubble_id, session_id),
        2 => convert_assistant_bubble(bubble, text, bubble_id, session_id),
        _ => None,
    }
}

fn convert_user_bubble(
    bubble: &Value,
    text: &str,
    bubble_id: &str,
    session_id: &str,
) -> Option<ClaudeMessage> {
    if text.is_empty() {
        return None;
    }

    let mut content_blocks = vec![serde_json::json!({"type": "text", "text": text})];

    // Add image attachments if present
    if let Some(images) = bubble.get("images").and_then(Value::as_array) {
        for img in images {
            if let Some(url) = img.as_str() {
                if url.starts_with("data:image/") {
                    // Parse mime type from data URI: "data:image/png;base64,..."
                    if let Some((header, data)) = url.split_once(',') {
                        let media_type = header
                            .strip_prefix("data:")
                            .and_then(|h| h.split_once(';'))
                            .map(|(mime, _)| mime)
                            .unwrap_or("image/png");
                        content_blocks.push(serde_json::json!({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": data
                            }
                        }));
                    }
                }
            }
        }
    }

    Some(build_provider_message(
        "cursor",
        bubble_id.to_string(),
        session_id,
        String::new(),
        "user",
        Some("user"),
        Some(Value::Array(content_blocks)),
        None,
    ))
}

fn convert_assistant_bubble(
    bubble: &Value,
    text: &str,
    bubble_id: &str,
    session_id: &str,
) -> Option<ClaudeMessage> {
    let mut content_blocks: Vec<Value> = Vec::new();

    // Check for tool call
    if let Some(tool_data) = bubble.get("toolFormerData") {
        let tool_name = tool_data
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let tool_call_id = tool_data
            .get("toolCallId")
            .and_then(Value::as_str)
            .unwrap_or(bubble_id);
        let status = tool_data
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("completed");
        let raw_args = tool_data
            .get("rawArgs")
            .and_then(Value::as_str)
            .unwrap_or("{}");
        let args: Value =
            serde_json::from_str(raw_args).unwrap_or(Value::Object(serde_json::Map::default()));

        let mapped_name = map_cursor_tool_name(tool_name);

        content_blocks.push(serde_json::json!({
            "type": "tool_use",
            "id": tool_call_id,
            "name": mapped_name,
            "input": args
        }));

        // Add text as result if present
        if !text.is_empty() {
            content_blocks.push(serde_json::json!({
                "type": "tool_result",
                "tool_use_id": tool_call_id,
                "content": text,
                "is_error": status == "error" || status == "rejected"
            }));
        }
    } else if !text.is_empty() {
        // Check if this is a thinking bubble
        if bubble
            .get("isThought")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            content_blocks.push(serde_json::json!({
                "type": "thinking",
                "thinking": text
            }));
        } else {
            content_blocks.push(serde_json::json!({"type": "text", "text": text}));
        }
    }

    if content_blocks.is_empty() {
        return None;
    }

    Some(build_provider_message(
        "cursor",
        bubble_id.to_string(),
        session_id,
        String::new(),
        "assistant",
        Some("assistant"),
        Some(Value::Array(content_blocks)),
        None,
    ))
}

fn map_cursor_tool_name(name: &str) -> &str {
    match name {
        "read_file" | "view_file" => "Read",
        "write_to_file" | "create_file" | "edit_file" => "Write",
        "execute_command" | "run_terminal_cmd" => "Bash",
        "list_directory" | "list_dir" => "Glob",
        "search_files" | "codebase_search" | "grep_search" => "Grep",
        "web_search" => "WebSearch",
        "web_fetch" | "fetch_url" => "WebFetch",
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
    fn test_convert_user_bubble() {
        let bubble = json!({
            "type": 1,
            "bubbleId": "user-1",
            "text": "Hello from Cursor",
            "images": []
        });
        let result = convert_cursor_bubble(&bubble, 1, "session-1").unwrap();
        assert_eq!(result.message_type, "user");
        assert_eq!(result.provider, Some("cursor".to_string()));
    }

    #[test]
    fn test_convert_assistant_text_bubble() {
        let bubble = json!({
            "type": 2,
            "bubbleId": "asst-1",
            "text": "Here is the answer"
        });
        let result = convert_cursor_bubble(&bubble, 2, "session-1").unwrap();
        assert_eq!(result.message_type, "assistant");
        let content = result.content.unwrap();
        let arr = content.as_array().unwrap();
        assert_eq!(arr[0]["type"], "text");
    }

    #[test]
    fn test_convert_assistant_tool_bubble() {
        let bubble = json!({
            "type": 2,
            "bubbleId": "asst-2",
            "text": "file contents here",
            "toolFormerData": {
                "tool": 7,
                "toolCallId": "toolu_123",
                "status": "completed",
                "name": "read_file",
                "rawArgs": "{\"target_file\": \"src/main.rs\"}"
            }
        });
        let result = convert_cursor_bubble(&bubble, 2, "session-1").unwrap();
        let content = result.content.unwrap();
        let arr = content.as_array().unwrap();
        assert_eq!(arr[0]["type"], "tool_use");
        assert_eq!(arr[0]["name"], "Read");
        assert_eq!(arr[1]["type"], "tool_result");
    }

    #[test]
    fn test_convert_thinking_bubble() {
        let bubble = json!({
            "type": 2,
            "bubbleId": "asst-3",
            "text": "Let me think about this...",
            "isThought": true
        });
        let result = convert_cursor_bubble(&bubble, 2, "session-1").unwrap();
        let content = result.content.unwrap();
        let arr = content.as_array().unwrap();
        assert_eq!(arr[0]["type"], "thinking");
    }

    #[test]
    fn test_map_cursor_tool_names() {
        assert_eq!(map_cursor_tool_name("read_file"), "Read");
        assert_eq!(map_cursor_tool_name("execute_command"), "Bash");
        assert_eq!(map_cursor_tool_name("codebase_search"), "Grep");
        assert_eq!(map_cursor_tool_name("write_to_file"), "Write");
        assert_eq!(map_cursor_tool_name("unknown_tool"), "unknown_tool");
    }

    #[test]
    fn test_parse_cursor_json_with_control_chars() {
        let data = "{\"text\": \"hello\x01world\"}";
        let result = parse_cursor_json(data).unwrap();
        assert!(result["text"].as_str().unwrap().contains("hello"));
    }

    #[test]
    fn test_read_workspace_folder_format() {
        // Test the folder URL parsing logic
        let folder = "file:///Users/jack/project";
        let result = folder.strip_prefix("file://").unwrap();
        assert_eq!(result, "/Users/jack/project");
    }

    #[test]
    fn test_ms_to_iso() {
        let result = ms_to_iso(1700000000000);
        assert!(result.starts_with("2023-11-14T"));
    }

    #[test]
    fn test_empty_bubble() {
        let bubble = json!({"type": 2, "bubbleId": "empty", "text": ""});
        assert!(convert_cursor_bubble(&bubble, 2, "session-1").is_none());
    }
}
