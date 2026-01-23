//! Session loading functions

use crate::models::*;
use crate::utils::extract_project_name;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use walkdir::WalkDir;
use chrono::{DateTime, Utc};
use uuid::Uuid;
use rayon::prelude::*;

/// Minimal struct for fast line classification (avoids full parsing)
#[derive(serde::Deserialize)]
struct LineClassifier {
    #[serde(rename = "type")]
    message_type: String,
    #[serde(rename = "isSidechain")]
    is_sidechain: Option<bool>,
}

/// Fast classification of a line without full parsing
/// Returns true if the line should be counted as a valid message
#[inline]
fn classify_line(line: &str, exclude_sidechain: bool) -> bool {
    if line.trim().is_empty() {
        return false;
    }

    // Fast path: try to extract just the type field
    if let Ok(classifier) = serde_json::from_str::<LineClassifier>(line) {
        if classifier.message_type == "summary" {
            return false;
        }
        if exclude_sidechain && classifier.is_sidechain.unwrap_or(false) {
            return false;
        }
        return true;
    }
    false
}


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
    const SYSTEM_PHRASES: [&str; 4] = [
        "Session Cleared",
        "session cleared",
        "Caveat:",
        "Tool execution",
    ];
    for phrase in &SYSTEM_PHRASES {
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

/// 단일 JSONL 파일에서 세션 정보를 추출
fn load_session_from_file(file_path: &PathBuf, exclude_sidechain: bool) -> Option<ClaudeSession> {
    let metadata = file_path.metadata().ok();
    let last_modified = metadata.as_ref()
        .and_then(|m| m.modified().ok())
        .map(|t| {
            let dt: DateTime<Utc> = t.into();
            dt.to_rfc3339()
        })
        .unwrap_or_else(|| Utc::now().to_rfc3339());

    // Pre-allocate based on file size (estimate ~2KB per message)
    let estimated_capacity = metadata
        .map(|m| std::cmp::max(16, m.len() as usize / 2048))
        .unwrap_or(64);

    let file = fs::File::open(file_path).ok()?;
    let reader = BufReader::new(file);
    let mut messages: Vec<ClaudeMessage> = Vec::with_capacity(estimated_capacity);
    let mut session_summary: Option<String> = None;
    let file_path_str = file_path.to_string_lossy().to_string();

    for (line_num, line_result) in reader.lines().enumerate() {
        let line = match line_result {
            Ok(l) => l,
            Err(_) => continue,
        };

        if line.trim().is_empty() {
            continue;
        }

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
                        format!("{}-line-{}", Uuid::new_v4(), line_num + 1)
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
                        session_id: log_entry.session_id.unwrap_or_else(|| "unknown-session".to_string()),
                        timestamp: log_entry.timestamp.unwrap_or_else(|| Utc::now().to_rfc3339()),
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
                        message_id: message_id.or(log_entry.message_id),
                        snapshot: log_entry.snapshot,
                        is_snapshot_update: log_entry.is_snapshot_update,
                        data: log_entry.data,
                        tool_use_id: log_entry.tool_use_id,
                        parent_tool_use_id: log_entry.parent_tool_use_id,
                        operation: log_entry.operation,
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
            Err(_e) => {
                // 파싱 에러는 무시 (병렬 처리 시 로깅 복잡)
            }
        }
    }

    if messages.is_empty() {
        return None;
    }

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

    let session_id = file_path_str.clone();

    let raw_project_name = file_path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let project_name = extract_project_name(&raw_project_name);

    let message_count = if exclude_sidechain {
        messages.iter().filter(|m| !m.is_sidechain.unwrap_or(false)).count()
    } else {
        messages.len()
    };

    // Skip sessions with 0 messages
    if message_count == 0 {
        return None;
    }

    let first_message_time = messages[0].timestamp.clone();
    let last_message_time = messages.last().unwrap().timestamp.clone();

    let has_tool_use = messages.iter().any(|m| {
        if m.message_type == "assistant" {
            if let Some(content) = &m.content {
                if let Some(content_array) = content.as_array() {
                    for item in content_array {
                        if item.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                            return true;
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

    // Find first genuine user message for summary fallback
    let final_summary = session_summary.or_else(|| {
        messages.iter()
            .filter(|m| m.message_type == "user")
            .find_map(|m| m.content.as_ref().and_then(extract_user_text))
    });

    Some(ClaudeSession {
        session_id,
        actual_session_id,
        file_path: file_path_str,
        project_name,
        message_count,
        first_message_time,
        last_message_time,
        last_modified,
        has_tool_use,
        has_errors,
        summary: final_summary,
    })
}

#[tauri::command]
pub async fn load_project_sessions(
    project_path: String,
    exclude_sidechain: Option<bool>,
) -> Result<Vec<ClaudeSession>, String> {
    #[cfg(debug_assertions)]
    let start_time = std::time::Instant::now();

    let exclude = exclude_sidechain.unwrap_or(false);

    // 1. 모든 JSONL 파일 경로 수집
    let file_paths: Vec<PathBuf> = WalkDir::new(&project_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
        .map(|e| e.path().to_path_buf())
        .collect();

    #[cfg(debug_assertions)]
    eprintln!("🔍 load_project_sessions: {}개 파일 처리 시작", file_paths.len());

    // 2. rayon을 사용한 병렬 처리
    let mut sessions: Vec<ClaudeSession> = file_paths
        .par_iter()
        .filter_map(|path| load_session_from_file(path, exclude))
        .collect();

    // 3. 정렬
    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));

    // 4. Summary propagation
    // Multiple JSONL files can share the same actual_session_id,
    // but only some files contain a summary message.
    let mut summary_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    for session in &sessions {
        if let Some(ref summary) = session.summary {
            if !summary.is_empty() {
                summary_map.insert(session.actual_session_id.clone(), summary.clone());
            }
        }
    }

    for session in &mut sessions {
        if session.summary.is_none() || session.summary.as_ref().is_some_and(|s| s.is_empty()) {
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

/// 단일 라인을 파싱하여 ClaudeMessage로 변환 (라인 번호 포함)
fn parse_line_to_message(line_num: usize, line: &str, include_summary: bool) -> Option<ClaudeMessage> {
    if line.trim().is_empty() {
        return None;
    }

    let log_entry: RawLogEntry = serde_json::from_str(line).ok()?;

    if log_entry.message_type == "summary" {
        if !include_summary {
            return None;
        }
        let summary_text = log_entry.summary?;
        let uuid = log_entry.uuid.unwrap_or_else(|| Uuid::new_v4().to_string());

        return Some(ClaudeMessage {
            uuid,
            parent_uuid: log_entry.leaf_uuid,
            session_id: log_entry.session_id.unwrap_or_else(|| "unknown-session".to_string()),
            timestamp: log_entry.timestamp.unwrap_or_else(|| Utc::now().to_rfc3339()),
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
        });
    }

    // Skip entries without session_id and timestamp
    if log_entry.session_id.is_none() && log_entry.timestamp.is_none() {
        return None;
    }

    let uuid = log_entry.uuid.unwrap_or_else(|| {
        format!("{}-line-{}", Uuid::new_v4(), line_num + 1)
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

    Some(ClaudeMessage {
        uuid,
        parent_uuid: log_entry.parent_uuid,
        session_id: log_entry.session_id.unwrap_or_else(|| "unknown-session".to_string()),
        timestamp: log_entry.timestamp.unwrap_or_else(|| Utc::now().to_rfc3339()),
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
        message_id: message_id.or(log_entry.message_id),
        snapshot: log_entry.snapshot,
        is_snapshot_update: log_entry.is_snapshot_update,
        data: log_entry.data,
        tool_use_id: log_entry.tool_use_id,
        parent_tool_use_id: log_entry.parent_tool_use_id,
        operation: log_entry.operation,
        subtype: log_entry.subtype,
        level: log_entry.level,
        hook_count: log_entry.hook_count,
        hook_infos: log_entry.hook_infos,
        stop_reason_system: log_entry.stop_reason_system,
        prevented_continuation: log_entry.prevented_continuation,
        compact_metadata: log_entry.compact_metadata,
        microcompact_metadata: log_entry.microcompact_metadata,
    })
}

#[tauri::command]
pub async fn load_session_messages(session_path: String) -> Result<Vec<ClaudeMessage>, String> {
    #[cfg(debug_assertions)]
    let start_time = std::time::Instant::now();

    let content = fs::read_to_string(&session_path)
        .map_err(|e| format!("Failed to read session file: {}", e))?;

    // 라인을 수집하고 병렬로 파싱
    let lines: Vec<(usize, &str)> = content.lines().enumerate().collect();

    let mut messages: Vec<(usize, ClaudeMessage)> = lines
        .par_iter()
        .filter_map(|(line_num, line)| {
            parse_line_to_message(*line_num, line, true)
                .map(|msg| (*line_num, msg))
        })
        .collect();

    // 원래 순서 유지를 위해 라인 번호로 정렬
    messages.sort_by_key(|(line_num, _)| *line_num);
    let messages: Vec<ClaudeMessage> = messages.into_iter().map(|(_, msg)| msg).collect();

    #[cfg(debug_assertions)]
    {
        let elapsed = start_time.elapsed();
        let system_msgs: Vec<_> = messages.iter()
            .filter(|m| m.message_type == "system")
            .collect();
        eprintln!("📤 [load_session_messages] {}개 메시지, {}ms 소요, {} system messages",
            messages.len(), elapsed.as_millis(), system_msgs.len());
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

    // Single file read - avoid double I/O
    let content = fs::read_to_string(&session_path)
        .map_err(|e| format!("Failed to read session file: {}", e))?;

    let exclude = exclude_sidechain.unwrap_or(false);

    // Phase 1: Build valid line indices (fast classification, single pass)
    let lines: Vec<&str> = content.lines().collect();
    let valid_indices: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter(|(_, line)| classify_line(line, exclude))
        .map(|(idx, _)| idx)
        .collect();

    let total_count = valid_indices.len();

    // Chat-style pagination: offset=0 means newest messages (at the end)
    if total_count == 0 {
        return Ok(MessagePage {
            messages: vec![],
            total_count: 0,
            has_more: false,
            next_offset: 0,
        });
    }

    let already_loaded = offset;
    let remaining_messages = total_count.saturating_sub(already_loaded);
    let messages_to_load = std::cmp::min(limit, remaining_messages);

    let (start_idx, end_idx) = if remaining_messages == 0 {
        (0, 0)
    } else {
        let start = total_count - already_loaded - messages_to_load;
        let end = total_count - already_loaded;
        (start, end)
    };

    // Phase 2: Parse only the target lines (parallel)
    let target_indices = &valid_indices[start_idx..end_idx];
    let mut parsed: Vec<(usize, ClaudeMessage)> = target_indices
        .par_iter()
        .filter_map(|&line_idx| {
            let line = lines[line_idx];
            let msg = parse_line_to_message(line_idx, line, false)?;
            Some((line_idx, msg))
        })
        .collect();

    // Sort by line number to maintain original order
    parsed.sort_by_key(|(line_num, _)| *line_num);
    let messages: Vec<ClaudeMessage> = parsed.into_iter().map(|(_, msg)| msg).collect();

    let has_more = start_idx > 0;
    let next_offset = offset + messages.len();

    #[cfg(debug_assertions)]
    {
        let elapsed = start_time.elapsed();
        eprintln!("📊 load_session_messages_paginated 성능: {}개/{}개 메시지, {}ms 소요 (최적화됨)",
                 messages.len(), total_count, elapsed.as_millis());
    }

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

    let exclude = exclude_sidechain.unwrap_or(false);

    // Parallel counting with fast classification (LineClassifier instead of full RawLogEntry)
    let count: usize = content
        .par_lines()
        .filter(|line| classify_line(line, exclude))
        .count();

    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::fs::File;
    use std::io::Write;
    use std::path::PathBuf;

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
