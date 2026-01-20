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
    #[cfg(debug_assertions)]
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
                                content: log_entry.message.map(|m| m.content).or(log_entry.content),
                                tool_use: log_entry.tool_use,
                                tool_use_result: log_entry.tool_use_result,
                                is_sidechain: log_entry.is_sidechain,
                                usage,
                                role,
                                model,
                                stop_reason,
                                cost_usd: log_entry.cost_usd,
                                duration_ms: log_entry.duration_ms,
                                // File history snapshot fields
                                message_id: message_id.or(log_entry.message_id),
                                snapshot: log_entry.snapshot,
                                is_snapshot_update: log_entry.is_snapshot_update,
                                // Progress message fields
                                data: log_entry.data,
                                tool_use_id: log_entry.tool_use_id,
                                parent_tool_use_id: log_entry.parent_tool_use_id,
                                // Queue operation fields
                                operation: log_entry.operation,
                                // System message fields
                                subtype: log_entry.subtype,
                                level: log_entry.level,
                                hook_count: log_entry.hook_count,
                                hook_infos: log_entry.hook_infos,
                                stop_reason_system: log_entry.stop_reason_system,
                                prevented_continuation: log_entry.prevented_continuation,
                                compact_metadata: log_entry.compact_metadata,
                                microcompact_metadata: log_entry.microcompact_metadata,
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

                // Helper to check if text is a genuine user message (not system-generated)
                fn is_genuine_user_text(text: &str) -> bool {
                    let trimmed = text.trim();
                    if trimmed.is_empty() {
                        return false;
                    }
                    // Skip XML/HTML-like tags (system messages)
                    if trimmed.starts_with('<') {
                        return false;
                    }
                    // Skip known system messages
                    let system_phrases = [
                        "Session Cleared",
                        "session cleared",
                        "Caveat:",
                        "Tool execution",
                    ];
                    for phrase in &system_phrases {
                        if trimmed.starts_with(phrase) {
                            return false;
                        }
                    }
                    true
                }

                fn truncate_text(text: &str, max_chars: usize) -> String {
                    if text.chars().count() > max_chars {
                        let truncated: String = text.chars().take(max_chars).collect();
                        format!("{}...", truncated)
                    } else {
                        text.to_string()
                    }
                }

                // Extract text from message content, filtering out system messages
                fn extract_user_text(content: &serde_json::Value) -> Option<String> {
                    match content {
                        serde_json::Value::String(text) => {
                            if is_genuine_user_text(text) {
                                Some(truncate_text(text, 100))
                            } else {
                                None
                            }
                        },
                        serde_json::Value::Array(arr) => {
                            for item in arr {
                                if let Some(item_type) = item.get("type").and_then(|v| v.as_str()) {
                                    if item_type == "text" {
                                        if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                                            if is_genuine_user_text(text) {
                                                return Some(truncate_text(text, 100));
                                            }
                                        }
                                    }
                                }
                            }
                            None
                        },
                        _ => None
                    }
                }

                // Find first genuine user message for summary fallback
                let final_summary = if session_summary.is_none() {
                    messages.iter()
                        .filter(|m| m.message_type == "user")
                        .find_map(|m| m.content.as_ref().and_then(extract_user_text))
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

    #[cfg(debug_assertions)]
    {
        let elapsed = start_time.elapsed();
        println!("📊 load_project_sessions 성능: {}개 세션, {}ms 소요",
                 sessions.len(), elapsed.as_millis());
    }

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
                            parent_uuid: log_entry.leaf_uuid, // Link to the leaf message
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
                            model: None,
                            stop_reason: None,
                            cost_usd: None,
                            duration_ms: None,
                            // File history snapshot fields (not applicable for summary)
                            message_id: None,
                            snapshot: None,
                            is_snapshot_update: None,
                            // Progress message fields (not applicable for summary)
                            data: None,
                            tool_use_id: None,
                            parent_tool_use_id: None,
                            // Queue operation fields (not applicable for summary)
                            operation: None,
                            // System message fields (not applicable for summary)
                            subtype: None,
                            level: None,
                            hook_count: None,
                            hook_infos: None,
                            stop_reason_system: None,
                            prevented_continuation: None,
                            compact_metadata: None,
                            microcompact_metadata: None,
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
                        content: log_entry.message.map(|m| m.content).or(log_entry.content),
                        tool_use: log_entry.tool_use,
                        tool_use_result: log_entry.tool_use_result,
                        is_sidechain: log_entry.is_sidechain,
                        usage,
                        role,
                        model,
                        stop_reason,
                        cost_usd: log_entry.cost_usd,
                        duration_ms: log_entry.duration_ms,
                        // File history snapshot fields
                        message_id: message_id.or(log_entry.message_id),
                        snapshot: log_entry.snapshot,
                        is_snapshot_update: log_entry.is_snapshot_update,
                        // Progress message fields
                        data: log_entry.data,
                        tool_use_id: log_entry.tool_use_id,
                        parent_tool_use_id: log_entry.parent_tool_use_id,
                        // Queue operation fields
                        operation: log_entry.operation,
                        // System message fields
                        subtype: log_entry.subtype,
                        level: log_entry.level,
                        hook_count: log_entry.hook_count,
                        hook_infos: log_entry.hook_infos,
                        stop_reason_system: log_entry.stop_reason_system,
                        prevented_continuation: log_entry.prevented_continuation,
                        compact_metadata: log_entry.compact_metadata,
                        microcompact_metadata: log_entry.microcompact_metadata,
                    };
                    messages.push(claude_message);
                }
            },
            Err(e) => {
                eprintln!("Failed to parse line {} in {}: {}. Line: {}", line_num + 1, session_path, e, line);
            }
        }
    }

    // Debug: Log system messages being returned
    #[cfg(debug_assertions)]
    {
        let system_msgs: Vec<_> = messages.iter()
            .filter(|m| m.message_type == "system")
            .collect();
        eprintln!("📤 [load_session_messages] Returning {} messages, {} are system messages",
            messages.len(), system_msgs.len());
        for (i, m) in system_msgs.iter().take(5).enumerate() {
            eprintln!("📤 [load_session_messages] System[{}]: subtype={:?} durationMs={:?} hookCount={:?} stopReasonSystem={:?}",
                i, m.subtype, m.duration_ms, m.hook_count, m.stop_reason_system);
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
    #[cfg(debug_assertions)]
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
                        content: log_entry.message.map(|m| m.content).or(log_entry.content),
                        tool_use: log_entry.tool_use,
                        tool_use_result: log_entry.tool_use_result,
                        is_sidechain: log_entry.is_sidechain,
                        usage,
                        role,
                        model,
                        stop_reason,
                        cost_usd: log_entry.cost_usd,
                        duration_ms: log_entry.duration_ms,
                        // File history snapshot fields
                        message_id: message_id.or(log_entry.message_id),
                        snapshot: log_entry.snapshot,
                        is_snapshot_update: log_entry.is_snapshot_update,
                        // Progress message fields
                        data: log_entry.data,
                        tool_use_id: log_entry.tool_use_id,
                        parent_tool_use_id: log_entry.parent_tool_use_id,
                        // Queue operation fields
                        operation: log_entry.operation,
                        // System message fields
                        subtype: log_entry.subtype,
                        level: log_entry.level,
                        hook_count: log_entry.hook_count,
                        hook_infos: log_entry.hook_infos,
                        stop_reason_system: log_entry.stop_reason_system,
                        prevented_continuation: log_entry.prevented_continuation,
                        compact_metadata: log_entry.compact_metadata,
                        microcompact_metadata: log_entry.microcompact_metadata,
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
    
    #[cfg(debug_assertions)]
    {
        let elapsed = start_time.elapsed();
        eprintln!("📊 load_session_messages_paginated 성능: {}개 메시지, {}ms 소요", messages.len(), elapsed.as_millis());
    }
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
                                    model: message_content.model.clone(),
                                    stop_reason: message_content.stop_reason.clone(),
                                    cost_usd: log_entry.cost_usd,
                                    duration_ms: log_entry.duration_ms,
                                    // File history snapshot fields (not applicable for search results)
                                    message_id: message_content.id.clone(),
                                    snapshot: None,
                                    is_snapshot_update: None,
                                    // Progress message fields (not applicable for search results)
                                    data: None,
                                    tool_use_id: None,
                                    parent_tool_use_id: None,
                                    // Queue operation fields (not applicable for search results)
                                    operation: None,
                                    // System message fields (not applicable for search results)
                                    subtype: None,
                                    level: None,
                                    hook_count: None,
                                    hook_infos: None,
                                    stop_reason_system: None,
                                    prevented_continuation: None,
                                    compact_metadata: None,
                                    microcompact_metadata: None,
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

/// Scan all JSONL files in a project and extract recent file edits/writes
/// Returns the LATEST content for each unique file path, sorted by timestamp descending
/// Only includes files that belong to the project's working directory
#[tauri::command]
pub async fn get_recent_edits(project_path: String) -> Result<crate::models::RecentEditsResult, String> {
    use std::collections::HashMap;

    let mut all_edits: Vec<crate::models::RecentFileEdit> = Vec::new();
    let mut cwd_counts: HashMap<String, usize> = HashMap::new();

    // Scan all JSONL files in the project directory
    for entry in WalkDir::new(&project_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
    {
        let file_path = entry.path();

        if let Ok(file) = std::fs::File::open(file_path) {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(file);

            for line_result in reader.lines() {
                if let Ok(line) = line_result {
                    if line.trim().is_empty() { continue; }

                    if let Ok(log_entry) = serde_json::from_str::<RawLogEntry>(&line) {
                        // Extract common fields
                        let timestamp = log_entry.timestamp.clone().unwrap_or_default();
                        let session_id = log_entry.session_id.clone().unwrap_or_else(|| "unknown".to_string());
                        let cwd = log_entry.cwd.clone();

                        // Track cwd frequency to determine project directory
                        if let Some(cwd_path) = cwd.as_ref() {
                            *cwd_counts.entry(cwd_path.to_string()).or_insert(0) += 1;
                        }

                        // Process tool use results for Edit and Write operations
                        if let Some(tool_use_result) = &log_entry.tool_use_result {

                            // Handle Write/Create tool results (type: "create")
                            // Format: { "type": "create", "filePath": "...", "content": "full content", ... }
                            if tool_use_result.get("type").and_then(|v| v.as_str()) == Some("create") {
                                if let (Some(file_path_str), Some(content)) = (
                                    tool_use_result.get("filePath").and_then(|v| v.as_str()),
                                    tool_use_result.get("content").and_then(|v| v.as_str())
                                ) {
                                    all_edits.push(crate::models::RecentFileEdit {
                                        file_path: file_path_str.to_string(),
                                        timestamp: timestamp.clone(),
                                        session_id: session_id.clone(),
                                        operation_type: "write".to_string(),
                                        content_after_change: content.to_string(),
                                        original_content: None,
                                        lines_added: content.lines().count(),
                                        lines_removed: 0,
                                        cwd: cwd.clone(),
                                    });
                                }
                            }

                            // Handle Edit tool results
                            // Format: { "filePath": "...", "oldString": "...", "newString": "...", "originalFile": "full content", ... }
                            if let Some(file_path_val) = tool_use_result.get("filePath") {
                                if let Some(file_path_str) = file_path_val.as_str() {
                                    // Check if this is an Edit result (has edits array or oldString/newString)
                                    if let Some(edits) = tool_use_result.get("edits") {
                                        // Multi-edit format (uses "originalFile" not "originalFileContents")
                                        if let Some(original) = tool_use_result.get("originalFile").and_then(|v| v.as_str()) {
                                            let mut content = original.to_string();
                                            let mut lines_added = 0usize;
                                            let mut lines_removed = 0usize;

                                            if let Some(edits_arr) = edits.as_array() {
                                                for edit in edits_arr {
                                                    if let (Some(old_str), Some(new_str)) = (
                                                        edit.get("old_string").and_then(|v| v.as_str()),
                                                        edit.get("new_string").and_then(|v| v.as_str())
                                                    ) {
                                                        content = content.replacen(old_str, new_str, 1);
                                                        lines_removed += old_str.lines().count();
                                                        lines_added += new_str.lines().count();
                                                    }
                                                }
                                            }

                                            all_edits.push(crate::models::RecentFileEdit {
                                                file_path: file_path_str.to_string(),
                                                timestamp: timestamp.clone(),
                                                session_id: session_id.clone(),
                                                operation_type: "edit".to_string(),
                                                content_after_change: content,
                                                original_content: Some(original.to_string()),
                                                lines_added,
                                                lines_removed,
                                                cwd: cwd.clone(),
                                            });
                                        }
                                    } else if let (Some(old_str), Some(new_str)) = (
                                        tool_use_result.get("oldString").and_then(|v| v.as_str()),
                                        tool_use_result.get("newString").and_then(|v| v.as_str())
                                    ) {
                                        // Single edit format with oldString/newString
                                        // Only include if we have originalFile (needed for full file reconstruction)
                                        if let Some(original) = tool_use_result.get("originalFile").and_then(|v| v.as_str()) {
                                            let content = original.replacen(old_str, new_str, 1);

                                            all_edits.push(crate::models::RecentFileEdit {
                                                file_path: file_path_str.to_string(),
                                                timestamp: timestamp.clone(),
                                                session_id: session_id.clone(),
                                                operation_type: "edit".to_string(),
                                                content_after_change: content,
                                                original_content: Some(original.to_string()),
                                                lines_added: new_str.lines().count(),
                                                lines_removed: old_str.lines().count(),
                                                cwd: cwd.clone(),
                                            });
                                        }
                                        // Skip edits without originalFile - we can't reconstruct full file
                                    }
                                }
                            }

                            // NOTE: toolUseResult.file is for READ operations (often truncated)
                            // We do NOT capture those - only Edit results with originalFile
                            // and Write results with type: "create"
                        }

                        // Also check tool_use for Write operations (input has file_path and content)
                        if let Some(tool_use) = &log_entry.tool_use {
                            if let Some(name) = tool_use.get("name").and_then(|v| v.as_str()) {
                                if name == "Write" {
                                    if let Some(input) = tool_use.get("input") {
                                        if let (Some(path), Some(content)) = (
                                            input.get("file_path").and_then(|v| v.as_str()),
                                            input.get("content").and_then(|v| v.as_str())
                                        ) {
                                            all_edits.push(crate::models::RecentFileEdit {
                                                file_path: path.to_string(),
                                                timestamp: timestamp.clone(),
                                                session_id: session_id.clone(),
                                                operation_type: "write".to_string(),
                                                content_after_change: content.to_string(),
                                                original_content: None,
                                                lines_added: content.lines().count(),
                                                lines_removed: 0,
                                                cwd: cwd.clone(),
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Find the most common cwd (project directory)
    let project_cwd = cwd_counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(cwd, _)| cwd);

    // Filter edits to only include files within the project directory
    // Use case-insensitive comparison on Windows for path matching
    let filtered_edits: Vec<crate::models::RecentFileEdit> = if let Some(ref cwd) = project_cwd {
        #[cfg(target_os = "windows")]
        let cwd_normalized = cwd.to_lowercase();
        #[cfg(not(target_os = "windows"))]
        let cwd_normalized = cwd.clone();

        all_edits
            .into_iter()
            .filter(|edit| {
                #[cfg(target_os = "windows")]
                let file_path_normalized = edit.file_path.to_lowercase();
                #[cfg(not(target_os = "windows"))]
                let file_path_normalized = edit.file_path.clone();

                file_path_normalized.starts_with(&cwd_normalized)
            })
            .collect()
    } else {
        all_edits
    };

    let total_edits_count = filtered_edits.len();

    // Sort by timestamp descending (newest first)
    let mut sorted_edits = filtered_edits;
    sorted_edits.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    // Group by file_path and keep only the LATEST edit for each file
    let mut latest_by_file: HashMap<String, crate::models::RecentFileEdit> = HashMap::new();
    for edit in sorted_edits {
        latest_by_file.entry(edit.file_path.clone()).or_insert(edit);
    }

    let unique_files_count = latest_by_file.len();

    // Convert to Vec and sort by timestamp descending
    let mut files: Vec<crate::models::RecentFileEdit> = latest_by_file.into_values().collect();
    files.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    Ok(crate::models::RecentEditsResult {
        files,
        total_edits_count,
        unique_files_count,
        project_cwd,
    })
}

/// Restore a file by writing content to the specified path
/// Security: Validates path to prevent path traversal attacks
#[tauri::command]
pub async fn restore_file(file_path: String, content: String) -> Result<(), String> {
    use std::fs;
    use std::path::Path;

    // Security validation: reject paths with null bytes
    if file_path.contains('\0') {
        return Err("Invalid file path: contains null bytes".to_string());
    }

    // Security validation: reject relative paths (must be absolute)
    let path = Path::new(&file_path);
    if !path.is_absolute() {
        return Err("Invalid file path: must be an absolute path".to_string());
    }

    // Security validation: reject paths with parent traversal segments
    for component in path.components() {
        if let std::path::Component::ParentDir = component {
            return Err("Invalid file path: path traversal not allowed".to_string());
        }
    }

    // Create parent directories if they don't exist
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories: {}", e))?;
    }

    // Write the content to the file
    fs::write(path, content).map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(())
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
