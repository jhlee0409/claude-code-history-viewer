//! Session search functions

use crate::models::{ClaudeMessage, RawLogEntry};
use crate::utils::find_line_ranges;
use chrono::Utc;
use memmap2::Mmap;
use rayon::prelude::*;
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;
use walkdir::WalkDir;

/// Initial buffer capacity for JSON parsing (4KB covers most messages)
const PARSE_BUFFER_INITIAL_CAPACITY: usize = 4096;

/// Initial capacity for search results (most searches find few matches)
const SEARCH_RESULTS_INITIAL_CAPACITY: usize = 8;

/// Recursively search for a query within a `serde_json::Value`
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

/// Extract project name from file path
/// Path format: ~/.claude/projects/[project-name]/[session-file].jsonl
fn extract_project_name(file_path: &PathBuf) -> Option<String> {
    file_path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
}

/// Search for messages matching the query in a single file
///
/// Uses a reusable buffer to avoid repeated heap allocations during JSON parsing.
#[allow(unsafe_code)] // Required for mmap performance optimization
fn search_in_file(file_path: &PathBuf, query: &str) -> Vec<ClaudeMessage> {
    let query_lower = query.to_lowercase();
    let project_name = extract_project_name(file_path);

    let file = match fs::File::open(file_path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };

    // SAFETY: We're only reading the file, and the file handle is kept open
    // for the duration of the mmap's lifetime. Session files are append-only.
    let mmap = match unsafe { Mmap::map(&file) } {
        Ok(m) => m,
        Err(_) => return Vec::new(),
    };

    // Use SIMD-accelerated line detection
    let line_ranges = find_line_ranges(&mmap);

    let mut results = Vec::with_capacity(SEARCH_RESULTS_INITIAL_CAPACITY);

    // Reusable buffer for simd-json parsing (requires mutable slice)
    // This avoids heap allocation per line
    let mut parse_buffer = Vec::with_capacity(PARSE_BUFFER_INITIAL_CAPACITY);

    for (line_num, (start, end)) in line_ranges.iter().enumerate() {
        // Reuse buffer instead of allocating new Vec each iteration
        parse_buffer.clear();
        parse_buffer.extend_from_slice(&mmap[*start..*end]);

        let log_entry: RawLogEntry = match simd_json::serde::from_slice(&mut parse_buffer) {
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
            uuid: log_entry
                .uuid
                .unwrap_or_else(|| format!("{}-line-{}", Uuid::new_v4(), line_num + 1)),
            parent_uuid: log_entry.parent_uuid,
            session_id: log_entry
                .session_id
                .unwrap_or_else(|| "unknown-session".to_string()),
            timestamp: log_entry
                .timestamp
                .unwrap_or_else(|| Utc::now().to_rfc3339()),
            message_type: log_entry.message_type,
            content: Some(message_content.content.clone()),
            project_name: project_name.clone(),
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

/// Default limit for search results
const DEFAULT_SEARCH_LIMIT: usize = 100;

#[tauri::command]
pub async fn search_messages(
    claude_path: String,
    query: String,
    _filters: serde_json::Value,
    limit: Option<usize>,
) -> Result<Vec<ClaudeMessage>, String> {
    #[cfg(debug_assertions)]
    let start_time = std::time::Instant::now();

    let max_results = limit.unwrap_or(DEFAULT_SEARCH_LIMIT);
    let projects_path = PathBuf::from(&claude_path).join("projects");

    if !projects_path.exists() {
        return Ok(vec![]);
    }

    // 1. Collect all JSONL file paths
    let file_paths: Vec<PathBuf> = WalkDir::new(&projects_path)
        .into_iter()
        .filter_map(std::result::Result::ok)
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
        .map(|e| e.path().to_path_buf())
        .collect();

    #[cfg(debug_assertions)]
    eprintln!("🔍 search_messages: searching {} files", file_paths.len());

    // 2. Parallel search using rayon
    let mut all_messages: Vec<ClaudeMessage> = file_paths
        .par_iter()
        .flat_map(|path| search_in_file(path, &query))
        .collect();

    // 3. Truncate to limit
    all_messages.truncate(max_results);

    #[cfg(debug_assertions)]
    {
        let elapsed = start_time.elapsed();
        eprintln!(
            "📊 search_messages performance: {} results (limit: {}), {}ms elapsed",
            all_messages.len(),
            max_results,
            elapsed.as_millis()
        );
    }

    Ok(all_messages)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::TempDir;

    fn create_sample_user_message(uuid: &str, session_id: &str, content: &str) -> String {
        format!(
            r#"{{"uuid":"{uuid}","sessionId":"{session_id}","timestamp":"2025-06-26T10:00:00Z","type":"user","message":{{"role":"user","content":"{content}"}}}}"#
        )
    }

    fn create_sample_assistant_message(uuid: &str, session_id: &str, content: &str) -> String {
        format!(
            r#"{{"uuid":"{uuid}","sessionId":"{session_id}","timestamp":"2025-06-26T10:01:00Z","type":"assistant","message":{{"role":"assistant","content":[{{"type":"text","text":"{content}"}}],"id":"msg_123","model":"claude-opus-4-20250514","usage":{{"input_tokens":100,"output_tokens":50}}}}}}"#
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
            serde_json::json!({}),
        )
        .await;

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
            serde_json::json!({}),
        )
        .await;

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
            serde_json::json!({}),
        )
        .await;

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
            serde_json::json!({}),
        )
        .await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }
}
