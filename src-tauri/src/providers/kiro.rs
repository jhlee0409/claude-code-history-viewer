use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::providers::ProviderInfo;
use crate::utils::{build_provider_message, ms_to_iso, search_json_value_case_insensitive};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::path::PathBuf;

const PROVIDER: &str = "kiro";

/// Detect Kiro CLI installation
pub fn detect() -> Option<ProviderInfo> {
    let db = get_db_path()?;
    Some(ProviderInfo {
        id: PROVIDER.to_string(),
        display_name: "Kiro CLI".to_string(),
        base_path: db.parent()?.to_string_lossy().to_string(),
        is_available: db.is_file(),
    })
}

fn get_db_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;

    #[cfg(target_os = "macos")]
    let path = home.join("Library/Application Support/kiro-cli/data.sqlite3");

    #[cfg(target_os = "linux")]
    let path = home.join(".local/share/kiro-cli/data.sqlite3");

    #[cfg(target_os = "windows")]
    let path = home.join("AppData/Roaming/kiro-cli/data.sqlite3");

    Some(path)
}

fn open_db() -> Result<Connection, String> {
    let path = get_db_path().ok_or("Kiro CLI not found")?;
    let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open Kiro DB: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to set busy timeout: {e}"))?;
    Ok(conn)
}

/// Scan Kiro projects (grouped by cwd/key)
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT key, COUNT(*) as cnt, MAX(updated_at) as last_upd
             FROM conversations_v2 GROUP BY key ORDER BY last_upd DESC",
        )
        .map_err(|e| e.to_string())?;

    let projects = stmt
        .query_map([], |row| {
            let key: String = row.get(0)?;
            let count: usize = row.get(1)?;
            let updated: u64 = row.get(2)?;
            Ok((key, count, updated))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|(key, count, updated)| {
            let name = PathBuf::from(&key)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            ClaudeProject {
                name,
                path: format!("kiro://{key}"),
                actual_path: key,
                session_count: count,
                message_count: 0,
                last_modified: ms_to_iso(updated),
                git_info: None,
                provider: Some(PROVIDER.to_string()),
                storage_type: Some("sqlite".to_string()),
                custom_directory_label: None,
            }
        })
        .collect();

    Ok(projects)
}

/// Load sessions for a Kiro project
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let key = project_path.strip_prefix("kiro://").unwrap_or(project_path);
    let conn = open_db()?;

    let mut stmt = conn
        .prepare(
            "SELECT conversation_id, value, created_at, updated_at
             FROM conversations_v2 WHERE key = ?1 ORDER BY updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let project_name = PathBuf::from(key)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let sessions = stmt
        .query_map([key], |row| {
            let conv_id: String = row.get(0)?;
            let value: String = row.get(1)?;
            let created: u64 = row.get(2)?;
            let updated: u64 = row.get(3)?;
            Ok((conv_id, value, created, updated))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|(conv_id, value, created, updated)| {
            let json: Value = serde_json::from_str(&value).ok()?;
            let history = json.get("history")?.as_array()?;
            let msg_count = history.len();

            // Extract summary from first user prompt
            let summary = history.first().and_then(|h| {
                h.get("user")?
                    .get("content")?
                    .get("Prompt")?
                    .get("prompt")?
                    .as_str()
                    .map(|s| s.chars().take(100).collect::<String>())
            });

            let has_tool_use = history
                .iter()
                .any(|h| h.get("assistant").and_then(|a| a.get("ToolUse")).is_some());

            Some(ClaudeSession {
                session_id: format!("kiro://{conv_id}"),
                actual_session_id: conv_id.clone(),
                // Must be the conversation id (not the project key) — load_messages
                // strips `kiro://` and queries `WHERE conversation_id = ?` (#324).
                file_path: format!("kiro://{conv_id}"),
                project_name: project_name.clone(),
                message_count: msg_count,
                first_message_time: ms_to_iso(created),
                last_message_time: ms_to_iso(updated),
                last_modified: ms_to_iso(updated),
                has_tool_use,
                has_errors: false,
                summary,
                is_renamed: false,
                provider: Some(PROVIDER.to_string()),
                storage_type: Some("sqlite".to_string()),
                entrypoint: None,
            })
        })
        .collect();

    Ok(sessions)
}

/// Load messages from a Kiro conversation
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let conv_id = session_path.strip_prefix("kiro://").unwrap_or(session_path);
    let conn = open_db()?;

    let value: String = conn
        .query_row(
            "SELECT value FROM conversations_v2 WHERE conversation_id = ?1",
            [conv_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Conversation not found: {e}"))?;

    let json: Value = serde_json::from_str(&value).map_err(|e| e.to_string())?;
    let history = json
        .get("history")
        .and_then(Value::as_array)
        .ok_or("No history found")?;

    let mut messages = Vec::new();

    for (i, entry) in history.iter().enumerate() {
        // User message
        if let Some(user) = entry.get("user") {
            if let Some(msg) = convert_user_message(user, conv_id, i) {
                messages.push(msg);
            }
        }
        // Assistant message
        if let Some(assistant) = entry.get("assistant") {
            if let Some(msg) = convert_assistant_message(assistant, conv_id, i) {
                messages.push(msg);
            }
        }
    }

    Ok(messages)
}

/// Search across all Kiro conversations
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    if query.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }

    let conn = open_db()?;
    let pattern = format!("%{query}%");
    let query_lower = query.to_lowercase();

    let mut stmt = conn
        .prepare("SELECT key, conversation_id, value FROM conversations_v2 WHERE value LIKE ?1")
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();

    let rows = stmt
        .query_map([&pattern], |row| {
            let key: String = row.get(0)?;
            let conv_id: String = row.get(1)?;
            let value: String = row.get(2)?;
            Ok((key, conv_id, value))
        })
        .map_err(|e| e.to_string())?;

    for row in rows.flatten() {
        let (_key, conv_id, value) = row;
        let json: Value = match serde_json::from_str(&value) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let history = match json.get("history").and_then(Value::as_array) {
            Some(h) => h,
            None => continue,
        };

        for (i, entry) in history.iter().enumerate() {
            if results.len() >= limit {
                return Ok(results);
            }
            if let Some(user) = entry.get("user") {
                if let Some(mut msg) = convert_user_message(user, &conv_id, i) {
                    if let Some(ref c) = msg.content {
                        if search_json_value_case_insensitive(c, &query_lower) {
                            msg.project_name = Some("Kiro CLI".to_string());
                            results.push(msg);
                        }
                    }
                }
            }
            if results.len() >= limit {
                return Ok(results);
            }
            if let Some(assistant) = entry.get("assistant") {
                if let Some(mut msg) = convert_assistant_message(assistant, &conv_id, i) {
                    if let Some(ref c) = msg.content {
                        if search_json_value_case_insensitive(c, &query_lower) {
                            msg.project_name = Some("Kiro CLI".to_string());
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
// Private helpers
// ============================================================================

fn convert_user_message(user: &Value, session_id: &str, idx: usize) -> Option<ClaudeMessage> {
    let timestamp = user
        .get("timestamp")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let content_obj = user.get("content")?;
    let mut blocks: Vec<Value> = Vec::new();

    if let Some(prompt) = content_obj.get("Prompt") {
        let text = prompt.get("prompt").and_then(Value::as_str).unwrap_or("");
        if !text.is_empty() {
            blocks.push(serde_json::json!({"type": "text", "text": text}));
        }
    } else if let Some(tool_results) = content_obj.get("ToolUseResults") {
        if let Some(results) = tool_results
            .get("tool_use_results")
            .and_then(Value::as_array)
        {
            for tr in results {
                let tool_use_id = tr.get("tool_use_id").and_then(Value::as_str).unwrap_or("");
                let content_arr = tr.get("content").and_then(Value::as_array);
                let text = content_arr
                    .and_then(|arr| arr.first())
                    .and_then(|c| c.get("Text").and_then(Value::as_str))
                    .unwrap_or("");
                blocks.push(serde_json::json!({
                    "type": "tool_result",
                    "tool_use_id": tool_use_id,
                    "content": text
                }));
            }
        }
    }

    if blocks.is_empty() {
        return None;
    }

    Some(build_provider_message(
        PROVIDER,
        format!("{session_id}-user-{idx}"),
        session_id,
        timestamp,
        "user",
        Some("user"),
        Some(Value::Array(blocks)),
        None,
    ))
}

fn convert_assistant_message(
    assistant: &Value,
    session_id: &str,
    idx: usize,
) -> Option<ClaudeMessage> {
    let mut blocks: Vec<Value> = Vec::new();

    if let Some(response) = assistant.get("Response") {
        let text = response
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("");
        if !text.is_empty() {
            blocks.push(serde_json::json!({"type": "text", "text": text}));
        }
    } else if let Some(tool_use) = assistant.get("ToolUse") {
        let text = tool_use
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("");
        if !text.is_empty() {
            blocks.push(serde_json::json!({"type": "text", "text": text}));
        }
        if let Some(tools) = tool_use.get("tool_uses").and_then(Value::as_array) {
            for tool in tools {
                let id = tool.get("id").and_then(Value::as_str).unwrap_or("");
                let name = tool
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                let args = tool
                    .get("args")
                    .cloned()
                    .unwrap_or(Value::Object(serde_json::Map::default()));
                blocks.push(serde_json::json!({
                    "type": "tool_use",
                    "id": id,
                    "name": map_tool_name(name),
                    "input": args
                }));
            }
        }
    }

    if blocks.is_empty() {
        return None;
    }

    let msg_id = assistant
        .get("Response")
        .or_else(|| assistant.get("ToolUse"))
        .and_then(|v| v.get("message_id"))
        .and_then(Value::as_str)
        .unwrap_or("");

    Some(build_provider_message(
        PROVIDER,
        if msg_id.is_empty() {
            format!("{session_id}-asst-{idx}")
        } else {
            msg_id.to_string()
        },
        session_id,
        String::new(),
        "assistant",
        Some("assistant"),
        Some(Value::Array(blocks)),
        None,
    ))
}

fn map_tool_name(name: &str) -> &str {
    match name {
        "execute_bash" => "Bash",
        "read_file" | "file_read" => "Read",
        "write_file" | "file_write" | "create_file" => "Write",
        "list_directory" => "Glob",
        "search_files" | "grep" => "Grep",
        "web_search" => "WebSearch",
        "web_fetch" => "WebFetch",
        _ => name,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_convert_user_prompt() {
        let user = json!({
            "content": {"Prompt": {"prompt": "hello world"}},
            "timestamp": "2025-10-08T10:50:49.220865-07:00"
        });
        let msg = convert_user_message(&user, "sess-1", 0).unwrap();
        assert_eq!(msg.message_type, "user");
        assert_eq!(msg.provider, Some("kiro".to_string()));
    }

    #[test]
    fn test_convert_assistant_response() {
        let asst = json!({"Response": {"message_id": "abc", "content": "Hello!"}});
        let msg = convert_assistant_message(&asst, "sess-1", 0).unwrap();
        assert_eq!(msg.message_type, "assistant");
        let arr = msg.content.unwrap();
        assert_eq!(arr[0]["text"], "Hello!");
    }

    #[test]
    fn test_convert_assistant_tool_use() {
        let asst = json!({
            "ToolUse": {
                "message_id": "xyz",
                "content": "Let me run that",
                "tool_uses": [{"id": "t1", "name": "execute_bash", "args": {"command": "ls"}, "orig_name": "", "orig_args": {}}]
            }
        });
        let msg = convert_assistant_message(&asst, "sess-1", 1).unwrap();
        let arr = msg.content.unwrap().as_array().unwrap().clone();
        assert_eq!(arr[0]["type"], "text");
        assert_eq!(arr[1]["type"], "tool_use");
        assert_eq!(arr[1]["name"], "Bash");
    }

    #[test]
    fn test_convert_user_tool_results() {
        let user = json!({
            "content": {"ToolUseResults": {"tool_use_results": [
                {"tool_use_id": "t1", "content": [{"Text": "output here"}]}
            ]}},
            "timestamp": "2025-10-08T10:51:00-07:00"
        });
        let msg = convert_user_message(&user, "sess-1", 1).unwrap();
        let arr = msg.content.unwrap().as_array().unwrap().clone();
        assert_eq!(arr[0]["type"], "tool_result");
        assert_eq!(arr[0]["tool_use_id"], "t1");
    }

    #[test]
    fn test_map_tool_names() {
        assert_eq!(map_tool_name("execute_bash"), "Bash");
        assert_eq!(map_tool_name("read_file"), "Read");
        assert_eq!(map_tool_name("unknown_thing"), "unknown_thing");
    }
}
