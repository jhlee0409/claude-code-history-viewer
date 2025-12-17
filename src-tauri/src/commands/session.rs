use crate::models::*;
use crate::utils::extract_project_name;
use std::fs;
use std::path::PathBuf;
use walkdir::WalkDir;
use chrono::{DateTime, Utc};
use uuid::Uuid;

#[tauri::command]
pub async fn load_project_sessions(
    project_path: String,
    exclude_sidechain: Option<bool>,
) -> Result<Vec<ClaudeSession>, String> {
    let start_time = std::time::Instant::now();
    let mut sessions = Vec::new();

    for entry in WalkDir::new(&project_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
    {
        let file_path = entry.path().to_string_lossy().to_string();
        
        let last_modified = if let Ok(metadata) = entry.metadata() {
            if let Ok(modified) = metadata.modified() {
                let dt: DateTime<Utc> = modified.into();
                dt.to_rfc3339()
            } else {
                Utc::now().to_rfc3339()
            }
        } else {
            Utc::now().to_rfc3339()
        };
        
        // 파일을 스트리밍으로 읽어서 메모리 사용량 줄이기
        if let Ok(file) = std::fs::File::open(entry.path()) {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(file);
            let mut messages: Vec<ClaudeMessage> = Vec::new();
            let mut session_summary: Option<String> = None;

            for (line_num, line_result) in reader.lines().enumerate() {
                if let Ok(line) = line_result {
                    if line.trim().is_empty() { continue; }

                    match serde_json::from_str::<RawLogEntry>(&line) {
                    Ok(log_entry) => {
                        if log_entry.message_type == "summary" {
                            if session_summary.is_none() { 
                                session_summary = log_entry.summary;
                            }
                        } else {
                            if log_entry.session_id.is_none() && log_entry.timestamp.is_none() {
                                continue;
                            }

                            let uuid = log_entry.uuid.unwrap_or_else(|| {
                                let new_uuid = format!("{}-line-{}", Uuid::new_v4(), line_num + 1);
                                eprintln!("Warning: Missing UUID in line {} of {}, generated: {}", line_num + 1, file_path, new_uuid);
                                new_uuid
                            });
                            
                            let (role, message_id, model, stop_reason, usage) = if let Some(ref msg) = log_entry.message {
                                (
                                    Some(msg.role.clone()),
                                    msg.id.clone(),
                                    msg.model.clone(),
                                    msg.stop_reason.clone(),
                                    msg.usage.clone()
                                )
                            } else {
                                (None, None, None, None, None)
                            };
                            
                            let claude_message = ClaudeMessage {
                                uuid,
                                parent_uuid: log_entry.parent_uuid,
                                session_id: log_entry.session_id.unwrap_or_else(|| {
                                    eprintln!("Warning: Missing session_id in line {} of {}", line_num + 1, file_path);
                                    "unknown-session".to_string()
                                }),
                                timestamp: log_entry.timestamp.unwrap_or_else(|| {
                                    let now = Utc::now().to_rfc3339();
                                    eprintln!("Warning: Missing timestamp in line {} of {}, using current time: {}", line_num + 1, file_path, now);
                                    now
                                }),
                                message_type: log_entry.message_type,
                                content: log_entry.message.map(|m| m.content),
                                tool_use: log_entry.tool_use,
                                tool_use_result: log_entry.tool_use_result,
                                is_sidechain: log_entry.is_sidechain,
                                usage,
                                role,
                                message_id,
                                model,
                                stop_reason,
                            };
                            messages.push(claude_message);
                        }
                    },
                        Err(e) => {
                            eprintln!("Error: Failed to parse JSONL at line {} in {}", line_num + 1, file_path);
                            eprintln!("  Parse error: {}", e);
                            if line.len() > 200 {
                                eprintln!("  Line content (truncated): {}...", &line[..200]);
                            } else {
                                eprintln!("  Line content: {}", line);
                            }
                        }
                    }
                }
            }

            if !messages.is_empty() {
                // Extract actual session ID from messages
                let actual_session_id = messages.iter()
                    .find_map(|m| {
                        if m.session_id != "unknown-session" {
                            Some(m.session_id.clone())
                        } else {
                            None
                        }
                    })
                    .unwrap_or_else(|| "unknown-session".to_string());
                
                // Create unique session ID based on file path
                let session_id = file_path.clone();
                
                let raw_project_name = entry.path()
                    .parent()
                    .and_then(|p| p.file_name())
                    .and_then(|n| n.to_str())
                    .unwrap_or("Unknown")
                    .to_string();

                let project_name = extract_project_name(&raw_project_name);

                let filtered_messages: Vec<&ClaudeMessage> = if exclude_sidechain.unwrap_or(false) {
                    messages.iter().filter(|m| !m.is_sidechain.unwrap_or(false)).collect()
                } else {
                    messages.iter().collect()
                };

                let message_count = filtered_messages.len();

                // Skip sessions with 0 messages (e.g., compacted sessions)
                if message_count == 0 {
                    continue;
                }

                let first_message_time = messages[0].timestamp.clone();
                let last_message_time = messages.last().unwrap().timestamp.clone();

                let has_tool_use = messages.iter().any(|m| {
                    if m.message_type == "assistant" {
                        if let Some(content) = &m.content {
                            if let Some(content_array) = content.as_array() {
                                for item in content_array {
                                    if let Some(item_type) = item.get("type").and_then(|v| v.as_str()) {
                                        if item_type == "tool_use" {
                                            return true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    m.tool_use.is_some() || m.tool_use_result.is_some()
                });
                let has_errors = messages.iter().any(|m| {
                    if let Some(result) = &m.tool_use_result {
                        if let Some(stderr) = result.get("stderr") {
                            return !stderr.as_str().unwrap_or("").is_empty();
                        }
                    }
                    false
                });

                // summary가 없을 때만 첫 번째 사용자 메시지에서 텍스트 추출
                let final_summary = if session_summary.is_none() {
                    messages.iter()
                        .find(|m| m.message_type == "user")
                        .and_then(|m| {
                            if let Some(content) = &m.content {
                                match content {
                                    // 단순 문자열인 경우
                                    serde_json::Value::String(text) => {
                                        if text.trim().is_empty() {
                                            None
                                        } else if text.chars().count() > 100 {
                                            let truncated: String = text.chars().take(100).collect();
                                            Some(format!("{}...", truncated))
                                        } else {
                                            Some(text.clone())
                                        }
                                    },
                                    // 배열인 경우 type="text" 찾기
                                    serde_json::Value::Array(arr) => {
                                        for item in arr {
                                            if let Some(item_type) = item.get("type").and_then(|v| v.as_str()) {
                                                if item_type == "text" {
                                                    if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                                                        if !text.trim().is_empty() {
                                                            return if text.chars().count() > 100 {
                                                                let truncated: String = text.chars().take(100).collect();
                                                                Some(format!("{}...", truncated))
                                                            } else {
                                                                Some(text.to_string())
                                                            };
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                        None
                                    },
                                    _ => None
                                }
                            } else {
                                None
                            }
                        })
                } else {
                    session_summary
                };

                sessions.push(ClaudeSession {
                    session_id,
                    actual_session_id,
                    file_path,
                    project_name,
                    message_count,
                    first_message_time,
                    last_message_time,
                    last_modified: last_modified.clone(),
                    has_tool_use,
                    has_errors,
                    summary: final_summary,
                });
            }
        }
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));

    // Summary propagation logic:
    // Multiple JSONL files can share the same actual_session_id (from the messages inside),
    // but only some files contain a summary message. This two-pass approach ensures all
    // sessions with the same actual_session_id display consistent summaries:
    // 1. First pass: Collect all existing summaries mapped by actual_session_id
    // 2. Second pass: Apply collected summaries to any session that's missing one
    // This provides a better user experience by showing the same summary for related sessions.
    
    // Create a map of actual_session_id to summary
    let mut summary_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    
    // First pass: collect all summaries
    for session in &sessions {
        if let Some(ref summary) = session.summary {
            if !summary.is_empty() {
                summary_map.insert(session.actual_session_id.clone(), summary.clone());
            }
        }
    }
    
    // Second pass: apply summaries to sessions that don't have them
    for session in &mut sessions {
        if session.summary.is_none() || session.summary.as_ref().map(|s| s.is_empty()).unwrap_or(false) {
            if let Some(summary) = summary_map.get(&session.actual_session_id) {
                session.summary = Some(summary.clone());
            }
        }
    }

    let elapsed = start_time.elapsed();
    #[cfg(debug_assertions)]
    println!("📊 load_project_sessions 성능: {}개 세션, {}ms 소요", 
             sessions.len(), elapsed.as_millis());

    Ok(sessions)
}

#[tauri::command]
pub async fn load_session_messages(session_path: String) -> Result<Vec<ClaudeMessage>, String> {
    let content = fs::read_to_string(&session_path)
        .map_err(|e| format!("Failed to read session file: {}", e))?;

    let mut messages = Vec::new();

    for (line_num, line) in content.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }

        match serde_json::from_str::<RawLogEntry>(line) {
            Ok(log_entry) => {
                if log_entry.message_type == "summary" {
                    if let Some(summary_text) = log_entry.summary {
                        let uuid = log_entry.uuid.unwrap_or_else(|| {
                            let new_uuid = Uuid::new_v4().to_string();
                            eprintln!("Warning: Missing UUID for summary in line {} of {}, generated: {}", line_num + 1, session_path, new_uuid);
                            new_uuid
                        });
                        
                        let summary_message = ClaudeMessage {
                            uuid,
                            parent_uuid: None,
                            session_id: log_entry.session_id.unwrap_or_else(|| {
                                eprintln!("Warning: Missing session_id for summary in line {} of {}", line_num + 1, session_path);
                                "unknown-session".to_string()
                            }),
                            timestamp: log_entry.timestamp.unwrap_or_else(|| {
                                let now = Utc::now().to_rfc3339();
                                eprintln!("Warning: Missing timestamp for summary in line {} of {}, using current time: {}", line_num + 1, session_path, now);
                                now
                            }),
                            message_type: "summary".to_string(),
                            content: Some(serde_json::Value::String(summary_text)),
                            tool_use: None,
                            tool_use_result: None,
                            is_sidechain: None,
                            usage: None,
                            role: None,
                            message_id: None,
                            model: None,
                            stop_reason: None,
                        };
                        messages.push(summary_message);
                    }
                } else {
                    if log_entry.session_id.is_none() && log_entry.timestamp.is_none() {
                        continue;
                    }

                    let uuid = log_entry.uuid.unwrap_or_else(|| {
                        let new_uuid = format!("{}-line-{}", Uuid::new_v4(), line_num + 1);
                        eprintln!("Warning: Missing UUID in line {} of {}, generated: {}", line_num + 1, session_path, new_uuid);
                        new_uuid
                    });
                    
                    let (role, message_id, model, stop_reason, usage) = if let Some(ref msg) = log_entry.message {
                        (
                            Some(msg.role.clone()),
                            msg.id.clone(),
                            msg.model.clone(),
                            msg.stop_reason.clone(),
                            msg.usage.clone()
                        )
                    } else {
                        (None, None, None, None, None)
                    };
                    
                    let claude_message = ClaudeMessage {
                        uuid,
                        parent_uuid: log_entry.parent_uuid,
                        session_id: log_entry.session_id.unwrap_or_else(|| {
                            eprintln!("Warning: Missing session_id in line {} of {}", line_num + 1, session_path);
                            "unknown-session".to_string()
                        }),
                        timestamp: log_entry.timestamp.unwrap_or_else(|| {
                            let now = Utc::now().to_rfc3339();
                            eprintln!("Warning: Missing timestamp in line {} of {}, using current time: {}", line_num + 1, session_path, now);
                            now
                        }),
                        message_type: log_entry.message_type.clone(),
                        content: log_entry.message.map(|m| m.content),
                        tool_use: log_entry.tool_use,
                        tool_use_result: log_entry.tool_use_result,
                        is_sidechain: log_entry.is_sidechain,
                        usage,
                        role,
                        message_id,
                        model,
                        stop_reason,
                    };
                    messages.push(claude_message);
                }
            },
            Err(e) => {
                eprintln!("Failed to parse line {} in {}: {}. Line: {}", line_num + 1, session_path, e, line);
            }
        }
    }

    Ok(messages)
}

#[tauri::command]
pub async fn load_session_messages_paginated(
    session_path: String,
    offset: usize,
    limit: usize,
    exclude_sidechain: Option<bool>,
) -> Result<MessagePage, String> {
    let start_time = std::time::Instant::now();
    use std::io::{BufRead, BufReader};
    use std::fs::File;
    
    let file = File::open(&session_path)
        .map_err(|e| format!("Failed to open session file: {}", e))?;
    let reader = BufReader::new(file);
    
    // First pass: collect all messages to get total count and support reverse ordering
    let mut all_messages: Vec<ClaudeMessage> = Vec::new();
    
    for (line_num, line_result) in reader.lines().enumerate() {
        let line = line_result.map_err(|e| format!("Failed to read line: {}", e))?;
        
        if line.trim().is_empty() {
            continue;
        }
        
        match serde_json::from_str::<RawLogEntry>(&line) {
            Ok(log_entry) => {
                if log_entry.message_type != "summary" {
                    if log_entry.session_id.is_none() && log_entry.timestamp.is_none() {
                        continue;
                    }
                    
                    if exclude_sidechain.unwrap_or(false) && log_entry.is_sidechain.unwrap_or(false) {
                        continue;
                    }
                    
                    let (role, message_id, model, stop_reason, usage) = if let Some(ref msg) = log_entry.message {
                        (
                            Some(msg.role.clone()),
                            msg.id.clone(),
                            msg.model.clone(),
                            msg.stop_reason.clone(),
                            msg.usage.clone()
                        )
                    } else {
                        (None, None, None, None, None)
                    };
                    
                    let claude_message = ClaudeMessage {
                        uuid: log_entry.uuid.unwrap_or_else(|| format!("{}-line-{}", Uuid::new_v4(), line_num + 1)),
                        parent_uuid: log_entry.parent_uuid,
                        session_id: log_entry.session_id.unwrap_or_else(|| "unknown-session".to_string()),
                        timestamp: log_entry.timestamp.unwrap_or_else(|| Utc::now().to_rfc3339()),
                        message_type: log_entry.message_type.clone(),
                        content: log_entry.message.map(|m| m.content),
                        tool_use: log_entry.tool_use,
                        tool_use_result: log_entry.tool_use_result,
                        is_sidechain: log_entry.is_sidechain,
                        usage,
                        role,
                        message_id,
                        model,
                        stop_reason,
                    };
                    all_messages.push(claude_message);
                }
            },
            Err(e) => {
                eprintln!("Failed to parse line {} in {}: {}. Line: {}", line_num + 1, session_path, e, line);
            }
        }
    }
    
    let total_count = all_messages.len();
    
    #[cfg(debug_assertions)]
    eprintln!("Pagination Debug - Total: {}, Offset: {}, Limit: {}", total_count, offset, limit);
    
    // Chat-style pagination: offset=0 means we want the newest messages (at the end)
    // offset=100 means we want messages starting 100 from the newest
    if total_count == 0 {
        #[cfg(debug_assertions)]
        eprintln!("No messages found");
        return Ok(MessagePage {
            messages: vec![],
            total_count: 0,
            has_more: false,
            next_offset: 0,
        });
    }
    
    // Calculate how many messages are already loaded (from newest)
    let already_loaded = offset;

    // Calculate remaining messages that can be loaded
    let remaining_messages = total_count.saturating_sub(already_loaded);
    
    // Actual messages to load: minimum of limit and remaining messages
    let messages_to_load = std::cmp::min(limit, remaining_messages);
    
    #[cfg(debug_assertions)]
    eprintln!("Load calculation: total={}, already_loaded={}, remaining={}, will_load={}", 
              total_count, already_loaded, remaining_messages, messages_to_load);
    
    let (start_idx, end_idx) = if remaining_messages == 0 {
        // No more messages to load
        #[cfg(debug_assertions)]
        eprintln!("No more messages available");
        (0, 0)
    } else {
        // Load from (total_count - already_loaded - messages_to_load) to (total_count - already_loaded)
        let start = total_count - already_loaded - messages_to_load;
        let end = total_count - already_loaded;
        #[cfg(debug_assertions)]
        eprintln!("Loading messages: start={}, end={} (will load {} messages)", start, end, messages_to_load);
        (start, end)
    };
    
    // Get the slice of messages we need
    let messages: Vec<ClaudeMessage> = all_messages
        .into_iter()
        .skip(start_idx)
        .take(end_idx - start_idx)
        .collect();
    
    // has_more is true if there are still older messages to load
    let has_more = start_idx > 0;
    let next_offset = offset + messages.len();
    
    let elapsed = start_time.elapsed();
    #[cfg(debug_assertions)]
    eprintln!("📊 load_session_messages_paginated 성능: {}개 메시지, {}ms 소요", messages.len(), elapsed.as_millis());
    #[cfg(debug_assertions)]
    eprintln!("Result: {} messages returned, has_more={}, next_offset={}", messages.len(), has_more, next_offset);
    
    Ok(MessagePage {
        messages,
        total_count,
        has_more,
        next_offset,
    })
}

#[tauri::command]
pub async fn get_session_message_count(
    session_path: String,
    exclude_sidechain: Option<bool>,
) -> Result<usize, String> {
    let content = fs::read_to_string(&session_path)
        .map_err(|e| format!("Failed to read session file: {}", e))?;

    let mut count = 0;
    
    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        
        if let Ok(log_entry) = serde_json::from_str::<RawLogEntry>(line) {
            if log_entry.message_type != "summary" {
                if exclude_sidechain.unwrap_or(false) && log_entry.is_sidechain.unwrap_or(false) {
                    continue;
                }
                count += 1;
            }
        }
    }

    Ok(count)
}

#[tauri::command]
pub async fn search_messages(
    claude_path: String,
    query: String,
    _filters: serde_json::Value
) -> Result<Vec<ClaudeMessage>, String> {
    let projects_path = PathBuf::from(&claude_path).join("projects");
    let mut all_messages = Vec::new();

    if !projects_path.exists() {
        return Ok(vec![]);
    }

    for entry in WalkDir::new(&projects_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
    {
        if let Ok(content) = fs::read_to_string(entry.path()) {
            for (line_num, line) in content.lines().enumerate() {
                if let Ok(log_entry) = serde_json::from_str::<RawLogEntry>(line) {
                    if log_entry.message_type == "user" || log_entry.message_type == "assistant" {
                        if let Some(message_content) = &log_entry.message {
                            let content_str = match &message_content.content {
                                serde_json::Value::String(s) => s.clone(),
                                serde_json::Value::Array(arr) => serde_json::to_string(arr).unwrap_or_default(),
                                _ => "".to_string(),
                            };

                            if content_str.to_lowercase().contains(&query.to_lowercase()) {
                                let claude_message = ClaudeMessage {
                                    uuid: log_entry.uuid.unwrap_or_else(|| format!("{}-line-{}", Uuid::new_v4(), line_num + 1)),
                                    parent_uuid: log_entry.parent_uuid,
                                    session_id: log_entry.session_id.unwrap_or_else(|| "unknown-session".to_string()),
                                    timestamp: log_entry.timestamp.unwrap_or_else(|| Utc::now().to_rfc3339()),
                                    message_type: log_entry.message_type,
                                    content: Some(message_content.content.clone()),
                                    tool_use: log_entry.tool_use,
                                    tool_use_result: log_entry.tool_use_result,
                                    is_sidechain: log_entry.is_sidechain,
                                    usage: message_content.usage.clone(),
                                    role: Some(message_content.role.clone()),
                                    message_id: message_content.id.clone(),
                                    model: message_content.model.clone(),
                                    stop_reason: message_content.stop_reason.clone(),
                                };
                                all_messages.push(claude_message);
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(all_messages)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::fs::File;
    use std::io::Write;

    fn create_test_jsonl_file(dir: &TempDir, filename: &str, content: &str) -> PathBuf {
        let file_path = dir.path().join(filename);
        let mut file = File::create(&file_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();
        file_path
    }

    fn create_sample_user_message(uuid: &str, session_id: &str, content: &str) -> String {
        format!(
            r#"{{"uuid":"{}","sessionId":"{}","timestamp":"2025-06-26T10:00:00Z","type":"user","message":{{"role":"user","content":"{}"}}}}"#,
            uuid, session_id, content
        )
    }

    fn create_sample_assistant_message(uuid: &str, session_id: &str, content: &str) -> String {
        format!(
            r#"{{"uuid":"{}","sessionId":"{}","timestamp":"2025-06-26T10:01:00Z","type":"assistant","message":{{"role":"assistant","content":[{{"type":"text","text":"{}"}}],"id":"msg_123","model":"claude-opus-4-20250514","usage":{{"input_tokens":100,"output_tokens":50}}}}}}"#,
            uuid, session_id, content
        )
    }

    fn create_sample_summary_message(summary: &str) -> String {
        format!(
            r#"{{"type":"summary","summary":"{}","leafUuid":"leaf-123"}}"#,
            summary
        )
    }

    #[tokio::test]
    async fn test_load_session_messages_basic() {
        let temp_dir = TempDir::new().unwrap();

        let content = format!(
            "{}\n{}\n",
            create_sample_user_message("uuid-1", "session-1", "Hello"),
            create_sample_assistant_message("uuid-2", "session-1", "Hi there!")
        );

        let file_path = create_test_jsonl_file(&temp_dir, "test.jsonl", &content);

        let result = load_session_messages(file_path.to_string_lossy().to_string()).await;

        assert!(result.is_ok());
        let messages = result.unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].message_type, "user");
        assert_eq!(messages[1].message_type, "assistant");
    }

    #[tokio::test]
    async fn test_load_session_messages_with_summary() {
        let temp_dir = TempDir::new().unwrap();

        let content = format!(
            "{}\n{}\n{}\n",
            create_sample_user_message("uuid-1", "session-1", "Hello"),
            create_sample_assistant_message("uuid-2", "session-1", "Hi!"),
            create_sample_summary_message("Test conversation summary")
        );

        let file_path = create_test_jsonl_file(&temp_dir, "test.jsonl", &content);

        let result = load_session_messages(file_path.to_string_lossy().to_string()).await;

        assert!(result.is_ok());
        let messages = result.unwrap();
        assert_eq!(messages.len(), 3);

        // Find summary message
        let summary_msg = messages.iter().find(|m| m.message_type == "summary");
        assert!(summary_msg.is_some());
        if let Some(content) = &summary_msg.unwrap().content {
            assert_eq!(content.as_str().unwrap(), "Test conversation summary");
        }
    }

    #[tokio::test]
    async fn test_load_session_messages_empty_file() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = create_test_jsonl_file(&temp_dir, "empty.jsonl", "");

        let result = load_session_messages(file_path.to_string_lossy().to_string()).await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_load_session_messages_with_empty_lines() {
        let temp_dir = TempDir::new().unwrap();

        let content = format!(
            "\n{}\n\n{}\n\n",
            create_sample_user_message("uuid-1", "session-1", "Hello"),
            create_sample_assistant_message("uuid-2", "session-1", "Hi!")
        );

        let file_path = create_test_jsonl_file(&temp_dir, "test.jsonl", &content);

        let result = load_session_messages(file_path.to_string_lossy().to_string()).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn test_load_session_messages_file_not_found() {
        let result = load_session_messages("/nonexistent/path/file.jsonl".to_string()).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to read session file"));
    }

    #[tokio::test]
    async fn test_load_session_messages_with_malformed_json() {
        let temp_dir = TempDir::new().unwrap();

        // First line is valid, second is malformed
        let content = format!(
            "{}\n{{invalid json}}\n{}\n",
            create_sample_user_message("uuid-1", "session-1", "Hello"),
            create_sample_assistant_message("uuid-2", "session-1", "Hi!")
        );

        let file_path = create_test_jsonl_file(&temp_dir, "test.jsonl", &content);

        let result = load_session_messages(file_path.to_string_lossy().to_string()).await;

        // Should still succeed with valid messages
        assert!(result.is_ok());
        let messages = result.unwrap();
        assert_eq!(messages.len(), 2);
    }

    #[tokio::test]
    async fn test_load_session_messages_paginated_basic() {
        let temp_dir = TempDir::new().unwrap();

        // Create 5 messages
        let mut content = String::new();
        for i in 1..=5 {
            content.push_str(&format!(
                "{}\n",
                create_sample_user_message(&format!("uuid-{}", i), "session-1", &format!("Message {}", i))
            ));
        }

        let file_path = create_test_jsonl_file(&temp_dir, "test.jsonl", &content);

        let result = load_session_messages_paginated(
            file_path.to_string_lossy().to_string(),
            0,
            3,
            None
        ).await;

        assert!(result.is_ok());
        let page = result.unwrap();
        assert_eq!(page.total_count, 5);
        assert_eq!(page.messages.len(), 3);
        assert!(page.has_more);
    }

    #[tokio::test]
    async fn test_load_session_messages_paginated_offset() {
        let temp_dir = TempDir::new().unwrap();

        let mut content = String::new();
        for i in 1..=5 {
            content.push_str(&format!(
                "{}\n",
                create_sample_user_message(&format!("uuid-{}", i), "session-1", &format!("Message {}", i))
            ));
        }

        let file_path = create_test_jsonl_file(&temp_dir, "test.jsonl", &content);

        // Get second page
        let result = load_session_messages_paginated(
            file_path.to_string_lossy().to_string(),
            3,
            3,
            None
        ).await;

        assert!(result.is_ok());
        let page = result.unwrap();
        assert_eq!(page.total_count, 5);
        assert_eq!(page.messages.len(), 2); // Only 2 remaining
        assert!(!page.has_more);
    }

    #[tokio::test]
    async fn test_load_session_messages_paginated_exclude_sidechain() {
        let temp_dir = TempDir::new().unwrap();

        let content = r#"{"uuid":"uuid-1","sessionId":"session-1","timestamp":"2025-06-26T10:00:00Z","type":"user","message":{"role":"user","content":"Hello"},"isSidechain":false}
{"uuid":"uuid-2","sessionId":"session-1","timestamp":"2025-06-26T10:01:00Z","type":"user","message":{"role":"user","content":"Sidechain"},"isSidechain":true}
{"uuid":"uuid-3","sessionId":"session-1","timestamp":"2025-06-26T10:02:00Z","type":"user","message":{"role":"user","content":"World"},"isSidechain":false}
"#;

        let file_path = create_test_jsonl_file(&temp_dir, "test.jsonl", content);

        // With exclude_sidechain = true
        let result = load_session_messages_paginated(
            file_path.to_string_lossy().to_string(),
            0,
            10,
            Some(true)
        ).await;

        assert!(result.is_ok());
        let page = result.unwrap();
        assert_eq!(page.total_count, 2); // Sidechain message excluded
    }

    #[tokio::test]
    async fn test_get_session_message_count() {
        let temp_dir = TempDir::new().unwrap();

        let mut content = String::new();
        for i in 1..=10 {
            content.push_str(&format!(
                "{}\n",
                create_sample_user_message(&format!("uuid-{}", i), "session-1", &format!("Message {}", i))
            ));
        }
        // Add a summary (should not be counted)
        content.push_str(&format!("{}\n", create_sample_summary_message("Summary")));

        let file_path = create_test_jsonl_file(&temp_dir, "test.jsonl", &content);

        let result = get_session_message_count(
            file_path.to_string_lossy().to_string(),
            None
        ).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 10); // Summary not counted
    }

    #[tokio::test]
    async fn test_get_session_message_count_exclude_sidechain() {
        let temp_dir = TempDir::new().unwrap();

        let content = r#"{"uuid":"uuid-1","sessionId":"session-1","timestamp":"2025-06-26T10:00:00Z","type":"user","message":{"role":"user","content":"Hello"},"isSidechain":false}
{"uuid":"uuid-2","sessionId":"session-1","timestamp":"2025-06-26T10:01:00Z","type":"user","message":{"role":"user","content":"Sidechain"},"isSidechain":true}
{"uuid":"uuid-3","sessionId":"session-1","timestamp":"2025-06-26T10:02:00Z","type":"user","message":{"role":"user","content":"World"}}
"#;

        let file_path = create_test_jsonl_file(&temp_dir, "test.jsonl", content);

        // Without exclude
        let count_all = get_session_message_count(
            file_path.to_string_lossy().to_string(),
            None
        ).await.unwrap();
        assert_eq!(count_all, 3);

        // With exclude
        let count_filtered = get_session_message_count(
            file_path.to_string_lossy().to_string(),
            Some(true)
        ).await.unwrap();
        assert_eq!(count_filtered, 2);
    }

    #[tokio::test]
    async fn test_search_messages_basic() {
        let temp_dir = TempDir::new().unwrap();
        let projects_dir = temp_dir.path().join("projects");
        let project_dir = projects_dir.join("test-project");
        std::fs::create_dir_all(&project_dir).unwrap();

        let content = format!(
            "{}\n{}\n",
            create_sample_user_message("uuid-1", "session-1", "Hello Rust programming"),
            create_sample_assistant_message("uuid-2", "session-1", "Rust is great!")
        );

        let _file_path = create_test_jsonl_file(&TempDir::new_in(&project_dir).unwrap(), "test.jsonl", &content);

        // Create file directly in project dir
        let file_path = project_dir.join("test.jsonl");
        let mut file = File::create(&file_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();

        let result = search_messages(
            temp_dir.path().to_string_lossy().to_string(),
            "Rust".to_string(),
            serde_json::json!({})
        ).await;

        assert!(result.is_ok());
        let messages = result.unwrap();
        assert_eq!(messages.len(), 2); // Both messages contain "Rust"
    }

    #[tokio::test]
    async fn test_search_messages_case_insensitive() {
        let temp_dir = TempDir::new().unwrap();
        let projects_dir = temp_dir.path().join("projects");
        let project_dir = projects_dir.join("test-project");
        std::fs::create_dir_all(&project_dir).unwrap();

        let content = format!(
            "{}\n",
            create_sample_user_message("uuid-1", "session-1", "HELLO World")
        );

        let file_path = project_dir.join("test.jsonl");
        let mut file = File::create(&file_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();

        let result = search_messages(
            temp_dir.path().to_string_lossy().to_string(),
            "hello".to_string(), // lowercase
            serde_json::json!({})
        ).await;

        assert!(result.is_ok());
        let messages = result.unwrap();
        assert_eq!(messages.len(), 1);
    }

    #[tokio::test]
    async fn test_search_messages_no_results() {
        let temp_dir = TempDir::new().unwrap();
        let projects_dir = temp_dir.path().join("projects");
        let project_dir = projects_dir.join("test-project");
        std::fs::create_dir_all(&project_dir).unwrap();

        let content = format!(
            "{}\n",
            create_sample_user_message("uuid-1", "session-1", "Hello World")
        );

        let file_path = project_dir.join("test.jsonl");
        let mut file = File::create(&file_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();

        let result = search_messages(
            temp_dir.path().to_string_lossy().to_string(),
            "nonexistent".to_string(),
            serde_json::json!({})
        ).await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_search_messages_empty_projects_dir() {
        let temp_dir = TempDir::new().unwrap();
        // Don't create projects directory

        let result = search_messages(
            temp_dir.path().to_string_lossy().to_string(),
            "test".to_string(),
            serde_json::json!({})
        ).await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_load_project_sessions_basic() {
        let temp_dir = TempDir::new().unwrap();

        let content = format!(
            "{}\n{}\n",
            create_sample_user_message("uuid-1", "session-1", "Hello from test"),
            create_sample_assistant_message("uuid-2", "session-1", "Hi!")
        );

        let file_path = temp_dir.path().join("test.jsonl");
        let mut file = File::create(&file_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();

        let result = load_project_sessions(
            temp_dir.path().to_string_lossy().to_string(),
            None
        ).await;

        assert!(result.is_ok());
        let sessions = result.unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].message_count, 2);
    }

    #[tokio::test]
    async fn test_load_project_sessions_with_summary() {
        let temp_dir = TempDir::new().unwrap();

        let content = format!(
            "{}\n{}\n{}\n",
            create_sample_user_message("uuid-1", "session-1", "Hello"),
            create_sample_assistant_message("uuid-2", "session-1", "Hi!"),
            create_sample_summary_message("This is the session summary")
        );

        let file_path = temp_dir.path().join("test.jsonl");
        let mut file = File::create(&file_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();

        let result = load_project_sessions(
            temp_dir.path().to_string_lossy().to_string(),
            None
        ).await;

        assert!(result.is_ok());
        let sessions = result.unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].summary, Some("This is the session summary".to_string()));
    }

    #[tokio::test]
    async fn test_load_project_sessions_multiple_files() {
        let temp_dir = TempDir::new().unwrap();

        // Create first session file
        let content1 = format!(
            "{}\n",
            create_sample_user_message("uuid-1", "session-1", "Hello")
        );
        let file_path1 = temp_dir.path().join("session1.jsonl");
        let mut file1 = File::create(&file_path1).unwrap();
        file1.write_all(content1.as_bytes()).unwrap();

        // Create second session file
        let content2 = format!(
            "{}\n{}\n",
            create_sample_user_message("uuid-2", "session-2", "World"),
            create_sample_assistant_message("uuid-3", "session-2", "!")
        );
        let file_path2 = temp_dir.path().join("session2.jsonl");
        let mut file2 = File::create(&file_path2).unwrap();
        file2.write_all(content2.as_bytes()).unwrap();

        let result = load_project_sessions(
            temp_dir.path().to_string_lossy().to_string(),
            None
        ).await;

        assert!(result.is_ok());
        let sessions = result.unwrap();
        assert_eq!(sessions.len(), 2);
    }

    #[tokio::test]
    async fn test_load_project_sessions_exclude_sidechain() {
        let temp_dir = TempDir::new().unwrap();

        let content = r#"{"uuid":"uuid-1","sessionId":"session-1","timestamp":"2025-06-26T10:00:00Z","type":"user","message":{"role":"user","content":"Hello"},"isSidechain":false}
{"uuid":"uuid-2","sessionId":"session-1","timestamp":"2025-06-26T10:01:00Z","type":"user","message":{"role":"user","content":"Sidechain"},"isSidechain":true}
"#;

        let file_path = temp_dir.path().join("test.jsonl");
        let mut file = File::create(&file_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();

        // Without exclude
        let result_all = load_project_sessions(
            temp_dir.path().to_string_lossy().to_string(),
            None
        ).await.unwrap();
        assert_eq!(result_all[0].message_count, 2);

        // With exclude
        let result_filtered = load_project_sessions(
            temp_dir.path().to_string_lossy().to_string(),
            Some(true)
        ).await.unwrap();
        assert_eq!(result_filtered[0].message_count, 1);
    }

    #[tokio::test]
    async fn test_load_project_sessions_with_tool_use() {
        let temp_dir = TempDir::new().unwrap();

        let content = r#"{"uuid":"uuid-1","sessionId":"session-1","timestamp":"2025-06-26T10:00:00Z","type":"user","message":{"role":"user","content":"Read file"}}
{"uuid":"uuid-2","sessionId":"session-1","timestamp":"2025-06-26T10:01:00Z","type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"tool_1","name":"Read","input":{}}]}}
"#;

        let file_path = temp_dir.path().join("test.jsonl");
        let mut file = File::create(&file_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();

        let result = load_project_sessions(
            temp_dir.path().to_string_lossy().to_string(),
            None
        ).await;

        assert!(result.is_ok());
        let sessions = result.unwrap();
        assert!(sessions[0].has_tool_use);
    }

    #[tokio::test]
    async fn test_load_project_sessions_empty_directory() {
        let temp_dir = TempDir::new().unwrap();

        let result = load_project_sessions(
            temp_dir.path().to_string_lossy().to_string(),
            None
        ).await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_message_with_missing_uuid_generates_new_one() {
        let temp_dir = TempDir::new().unwrap();

        // Message without uuid
        let content = r#"{"sessionId":"session-1","timestamp":"2025-06-26T10:00:00Z","type":"user","message":{"role":"user","content":"Hello"}}
"#;

        let file_path = temp_dir.path().join("test.jsonl");
        let mut file = File::create(&file_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();

        let result = load_session_messages(file_path.to_string_lossy().to_string()).await;

        assert!(result.is_ok());
        let messages = result.unwrap();
        assert_eq!(messages.len(), 1);
        // Should have a generated UUID
        assert!(!messages[0].uuid.is_empty());
        assert!(messages[0].uuid.contains("-line-"));
    }

    #[tokio::test]
    async fn test_message_with_missing_session_id() {
        let temp_dir = TempDir::new().unwrap();

        // Message without sessionId
        let content = r#"{"uuid":"uuid-1","timestamp":"2025-06-26T10:00:00Z","type":"user","message":{"role":"user","content":"Hello"}}
"#;

        let file_path = temp_dir.path().join("test.jsonl");
        let mut file = File::create(&file_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();

        let result = load_session_messages(file_path.to_string_lossy().to_string()).await;

        assert!(result.is_ok());
        let messages = result.unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].session_id, "unknown-session");
    }

    #[tokio::test]
    async fn test_assistant_message_with_usage_stats() {
        let temp_dir = TempDir::new().unwrap();

        let content = r#"{"uuid":"uuid-1","sessionId":"session-1","timestamp":"2025-06-26T10:00:00Z","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hello!"}],"id":"msg_123","model":"claude-opus-4-20250514","stop_reason":"end_turn","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":20,"cache_read_input_tokens":10}}}
"#;

        let file_path = temp_dir.path().join("test.jsonl");
        let mut file = File::create(&file_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();

        let result = load_session_messages(file_path.to_string_lossy().to_string()).await;

        assert!(result.is_ok());
        let messages = result.unwrap();
        assert_eq!(messages.len(), 1);

        let msg = &messages[0];
        assert_eq!(msg.role, Some("assistant".to_string()));
        assert_eq!(msg.message_id, Some("msg_123".to_string()));
        assert_eq!(msg.model, Some("claude-opus-4-20250514".to_string()));
        assert_eq!(msg.stop_reason, Some("end_turn".to_string()));

        let usage = msg.usage.as_ref().unwrap();
        assert_eq!(usage.input_tokens, Some(100));
        assert_eq!(usage.output_tokens, Some(50));
        assert_eq!(usage.cache_creation_input_tokens, Some(20));
        assert_eq!(usage.cache_read_input_tokens, Some(10));
    }
}
