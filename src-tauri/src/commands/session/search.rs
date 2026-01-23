//! Session search functions

use crate::models::*;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use walkdir::WalkDir;
use chrono::Utc;
use uuid::Uuid;
use rayon::prelude::*;

/// Recursively search for a query within a serde_json::Value
/// Returns true if the query is found in any string value.
/// This avoids the expensive JSON serialization that was previously used.
#[inline]
fn search_in_value(value: &serde_json::Value, query: &str) -> bool {
    match value {
        serde_json::Value::String(s) => s.to_lowercase().contains(query),
        serde_json::Value::Array(arr) => arr.iter().any(|item| search_in_value(item, query)),
        serde_json::Value::Object(obj) => obj.values().any(|val| search_in_value(val, query)),
        _ => false, // Numbers, booleans, null don't contain searchable text
    }
}

/// 단일 파일에서 쿼리와 매칭되는 메시지를 검색
fn search_in_file(file_path: &PathBuf, query: &str) -> Vec<ClaudeMessage> {
    let query_lower = query.to_lowercase();

    let file = match fs::File::open(file_path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };
    // Pre-allocate with small capacity (most searches find few matches)
    let mut results = Vec::with_capacity(8);
    let reader = BufReader::new(file);

    for (line_num, line_result) in reader.lines().enumerate() {
        let line = match line_result {
            Ok(l) => l,
            Err(_) => continue,
        };

        if line.trim().is_empty() {
            continue;
        }

        let log_entry: RawLogEntry = match serde_json::from_str(&line) {
            Ok(entry) => entry,
            Err(_) => continue,
        };

        if log_entry.message_type != "user" && log_entry.message_type != "assistant" {
            continue;
        }

        let message_content = match &log_entry.message {
            Some(mc) => mc,
            None => continue,
        };

        // Use recursive search to avoid JSON serialization overhead
        let matches = match &message_content.content {
            serde_json::Value::String(s) => s.to_lowercase().contains(&query_lower),
            serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
                search_in_value(&message_content.content, &query_lower)
            }
            _ => false,
        };

        if !matches {
            continue;
        }

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
            message_id: message_content.id.clone(),
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
        };
        results.push(claude_message);
    }

    results
}

#[tauri::command]
pub async fn search_messages(
    claude_path: String,
    query: String,
    _filters: serde_json::Value
) -> Result<Vec<ClaudeMessage>, String> {
    #[cfg(debug_assertions)]
    let start_time = std::time::Instant::now();

    let projects_path = PathBuf::from(&claude_path).join("projects");

    if !projects_path.exists() {
        return Ok(vec![]);
    }

    // 1. 모든 JSONL 파일 경로 수집
    let file_paths: Vec<PathBuf> = WalkDir::new(&projects_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
        .map(|e| e.path().to_path_buf())
        .collect();

    #[cfg(debug_assertions)]
    eprintln!("🔍 search_messages: {}개 파일에서 검색 시작", file_paths.len());

    // 2. rayon을 사용한 병렬 검색
    let all_messages: Vec<ClaudeMessage> = file_paths
        .par_iter()
        .flat_map(|path| search_in_file(path, &query))
        .collect();

    #[cfg(debug_assertions)]
    {
        let elapsed = start_time.elapsed();
        eprintln!("📊 search_messages 성능: {}개 결과, {}ms 소요",
                 all_messages.len(), elapsed.as_millis());
    }

    Ok(all_messages)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::fs::File;
    use std::io::Write;

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
}
