//! Session search functions

use crate::models::{ClaudeMessage, RawLogEntry};
use crate::utils::find_line_ranges;
use aho_corasick::AhoCorasick;
use chrono::{DateTime, Utc};
use lru::LruCache;
use memmap2::Mmap;
use rayon::prelude::*;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::num::NonZeroUsize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use uuid::Uuid;
use walkdir::WalkDir;

/// Initial buffer capacity for JSON parsing (4KB covers most messages)
const PARSE_BUFFER_INITIAL_CAPACITY: usize = 4096;

/// Initial capacity for search results (most searches find few matches)
const SEARCH_RESULTS_INITIAL_CAPACITY: usize = 8;

/// LRU cache capacity
const SEARCH_CACHE_CAPACITY: usize = 64;

lazy_static::lazy_static! {
    static ref ERROR_MATCHER: AhoCorasick = build_matcher("error");
    static ref SEARCH_CACHE: Mutex<LruCache<u64, CachedSearchResult>> =
        Mutex::new(LruCache::new(NonZeroUsize::new(SEARCH_CACHE_CAPACITY).expect("non-zero")));
}

/// Generation counter — incremented on any file change to invalidate cache
static CACHE_GENERATION: AtomicU64 = AtomicU64::new(0);

struct CachedSearchResult {
    generation: u64,
    results: Vec<ClaudeMessage>,
}

/// Called by the file watcher when session files change.
pub fn invalidate_search_cache() {
    CACHE_GENERATION.fetch_add(1, Ordering::Release);
}

fn cache_key(claude_path: &str, query: &str, filters: &serde_json::Value, limit: usize) -> u64 {
    let mut hasher = DefaultHasher::new();
    claude_path.hash(&mut hasher);
    query.to_lowercase().hash(&mut hasher);
    filters.to_string().hash(&mut hasher);
    limit.hash(&mut hasher);
    hasher.finish()
}

/// Recursively search for a query within a `serde_json::Value` using aho-corasick.
/// Case-insensitive matching without per-string heap allocation from `.to_lowercase()`.
#[inline]
fn search_in_value(value: &serde_json::Value, matcher: &AhoCorasick) -> bool {
    match value {
        serde_json::Value::String(s) => matcher.is_match(s),
        serde_json::Value::Array(arr) => arr.iter().any(|item| search_in_value(item, matcher)),
        serde_json::Value::Object(obj) => obj.values().any(|val| search_in_value(val, matcher)),
        _ => false,
    }
}

/// Build an aho-corasick matcher for case-insensitive single-pattern search.
/// Uses ASCII case-insensitive mode (sufficient for most search queries).
fn build_matcher(query: &str) -> AhoCorasick {
    AhoCorasick::builder()
        .ascii_case_insensitive(true)
        .build([query])
        .expect("single-pattern AhoCorasick build should never fail")
}

/// Extract project name from file path
/// Path format: ~/.claude/projects/[project-name]/[session-file].jsonl
fn extract_project_name(file_path: &PathBuf) -> Option<String> {
    file_path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .map(std::string::ToString::to_string)
}

/// Search for messages matching the query in a single file
///
/// Uses a reusable buffer to avoid repeated heap allocations during JSON parsing.
/// Accepts a pre-built `AhoCorasick` matcher to avoid rebuilding per file.
#[allow(unsafe_code)] // Required for mmap performance optimization
fn search_in_file(file_path: &PathBuf, matcher: &AhoCorasick) -> Vec<ClaudeMessage> {
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

        // Use aho-corasick for case-insensitive matching without heap allocation
        let content_matches = match &message_content.content {
            serde_json::Value::String(s) => matcher.is_match(s),
            serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
                search_in_value(&message_content.content, matcher)
            }
            _ => false,
        };

        // Also search the tool-call payloads. The in-session FlexSearch index
        // covers `toolUseResult` (file contents, command stdout/stderr) and tool
        // names, so global search must too — otherwise a query that only appears
        // in a tool result is found inside a conversation but missed by the
        // global search (issue #394). `search_in_value` already recurses every
        // nested string (e.g. `toolUseResult.file.content`, `.stdout`).
        let matches = content_matches
            || log_entry
                .tool_use_result
                .as_ref()
                .is_some_and(|v| search_in_value(v, matcher))
            || log_entry
                .tool_use
                .as_ref()
                .is_some_and(|v| search_in_value(v, matcher));

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
            provider: None,
        };
        results.push(claude_message);
    }

    results
}

/// Default limit for search results
const DEFAULT_SEARCH_LIMIT: usize = 100;

fn has_tool_calls(message: &ClaudeMessage) -> bool {
    message.tool_use.is_some()
        || message.tool_use_result.is_some()
        || message
            .content
            .as_ref()
            .and_then(serde_json::Value::as_array)
            .map(|arr| {
                arr.iter().any(|item| {
                    item.get("type").and_then(serde_json::Value::as_str) == Some("tool_use")
                        || item.get("type").and_then(serde_json::Value::as_str)
                            == Some("tool_result")
                })
            })
            .unwrap_or(false)
}

fn has_errors(message: &ClaudeMessage) -> bool {
    message.message_type == "error"
        || message.level.as_deref() == Some("error")
        || message
            .stop_reason_system
            .as_deref()
            .map(|s| ERROR_MATCHER.is_match(s))
            .unwrap_or(false)
        || message
            .content
            .as_ref()
            .map(|v| search_in_value(v, &ERROR_MATCHER))
            .unwrap_or(false)
}

fn has_file_changes(message: &ClaudeMessage) -> bool {
    let Some(content) = message
        .content
        .as_ref()
        .and_then(serde_json::Value::as_array)
    else {
        return false;
    };

    content.iter().any(|item| {
        if item.get("type").and_then(serde_json::Value::as_str) != Some("tool_use") {
            return false;
        }

        matches!(
            item.get("name").and_then(serde_json::Value::as_str),
            Some("Write" | "Edit" | "MultiEdit" | "NotebookEdit")
        )
    })
}

fn parse_filter_date(value: &serde_json::Value) -> Option<DateTime<Utc>> {
    value.as_str().and_then(|s| {
        DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|dt| dt.with_timezone(&Utc))
    })
}

fn filter_value_to_string(value: &serde_json::Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

pub(crate) fn validate_search_filters(filters: &serde_json::Value) -> Result<(), String> {
    let Some(obj) = filters.as_object() else {
        return Ok(());
    };

    let Some(date_range) = obj.get("dateRange").and_then(serde_json::Value::as_array) else {
        return Ok(());
    };

    if date_range.len() != 2 {
        return Err(format!(
            "Invalid dateRange filter: expected [start, end], got {} item(s)",
            date_range.len()
        ));
    }

    let start_raw = filter_value_to_string(&date_range[0]);
    let end_raw = filter_value_to_string(&date_range[1]);

    let Some(start_at) = parse_filter_date(&date_range[0]) else {
        return Err(format!(
            "Invalid dateRange start: {start_raw} (expected RFC3339 datetime)"
        ));
    };
    let Some(end_at) = parse_filter_date(&date_range[1]) else {
        return Err(format!(
            "Invalid dateRange end: {end_raw} (expected RFC3339 datetime)"
        ));
    };

    if start_at > end_at {
        return Err(format!(
            "Invalid dateRange filter: start ({start_raw}) is after end ({end_raw})"
        ));
    }

    Ok(())
}

fn matches_filters(message: &ClaudeMessage, filters: &serde_json::Value) -> bool {
    let Some(obj) = filters.as_object() else {
        return true;
    };

    if let Some(message_type) = obj.get("messageType").and_then(serde_json::Value::as_str) {
        if message_type != "all" && message.message_type != message_type {
            return false;
        }
    }

    if let Some(projects) = obj.get("projects").and_then(serde_json::Value::as_array) {
        let selected: Vec<&str> = projects
            .iter()
            .filter_map(serde_json::Value::as_str)
            .collect();
        if !selected.is_empty() {
            let Some(project_name) = message.project_name.as_deref() else {
                return false;
            };
            if !selected.contains(&project_name) {
                return false;
            }
        }
    }

    if let Some(has_tool_calls_filter) =
        obj.get("hasToolCalls").and_then(serde_json::Value::as_bool)
    {
        let has_calls = has_tool_calls(message);
        if has_calls != has_tool_calls_filter {
            return false;
        }
    }

    if let Some(has_errors_filter) = obj.get("hasErrors").and_then(serde_json::Value::as_bool) {
        let has_message_error = has_errors(message);
        if has_message_error != has_errors_filter {
            return false;
        }
    }

    if let Some(has_file_changes_filter) = obj
        .get("hasFileChanges")
        .and_then(serde_json::Value::as_bool)
    {
        let has_message_file_changes = has_file_changes(message);
        if has_message_file_changes != has_file_changes_filter {
            return false;
        }
    }

    if let Some(date_range) = obj.get("dateRange").and_then(serde_json::Value::as_array) {
        if date_range.len() == 2 {
            let start = parse_filter_date(&date_range[0]);
            let end = parse_filter_date(&date_range[1]);
            match (start, end) {
                (Some(start_at), Some(end_at)) => {
                    let message_ts = DateTime::parse_from_rfc3339(&message.timestamp)
                        .ok()
                        .map(|dt| dt.with_timezone(&Utc));
                    match message_ts {
                        Some(ts) if ts >= start_at && ts <= end_at => {}
                        _ => return false,
                    }
                }
                (None, _) | (_, None) => return false,
            }
        }
    }

    true
}

pub fn apply_search_filters(
    messages: Vec<ClaudeMessage>,
    filters: &serde_json::Value,
) -> Vec<ClaudeMessage> {
    messages
        .into_iter()
        .filter(|message| matches_filters(message, filters))
        .collect()
}

#[tauri::command]
pub async fn search_messages(
    claude_path: String,
    query: String,
    filters: serde_json::Value,
    limit: Option<usize>,
) -> Result<Vec<ClaudeMessage>, String> {
    #[cfg(debug_assertions)]
    let start_time = std::time::Instant::now();

    let max_results = limit.unwrap_or(DEFAULT_SEARCH_LIMIT);
    validate_search_filters(&filters)?;

    let key = cache_key(&claude_path, &query, &filters, max_results);
    let current_gen = CACHE_GENERATION.load(Ordering::Acquire);
    if let Ok(mut cache) = SEARCH_CACHE.lock() {
        if let Some(cached) = cache.get(&key) {
            if cached.generation == current_gen {
                #[cfg(debug_assertions)]
                eprintln!("📊 search_messages: cache hit");
                return Ok(cached.results.clone());
            }
        }
    }

    let projects_path = PathBuf::from(&claude_path).join("projects");
    if !projects_path.exists() {
        return Ok(vec![]);
    }

    let file_paths: Vec<PathBuf> = WalkDir::new(&projects_path)
        .into_iter()
        .filter_map(std::result::Result::ok)
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
        .map(|e| e.path().to_path_buf())
        .collect();

    #[cfg(debug_assertions)]
    eprintln!("🔍 search_messages: searching {} files", file_paths.len());

    let matcher = build_matcher(&query);

    let mut filtered: Vec<ClaudeMessage> = file_paths
        .par_iter()
        .flat_map(|path| search_in_file(path, &matcher))
        .collect();

    filtered = apply_search_filters(filtered, &filters);

    if filtered.len() > max_results {
        filtered.select_nth_unstable_by(max_results, |a, b| b.timestamp.cmp(&a.timestamp));
        filtered.truncate(max_results);
    }
    filtered.sort_unstable_by(|a, b| b.timestamp.cmp(&a.timestamp));

    if let Ok(mut cache) = SEARCH_CACHE.lock() {
        cache.put(
            key,
            CachedSearchResult {
                generation: current_gen,
                results: filtered.clone(),
            },
        );
    }

    #[cfg(debug_assertions)]
    {
        let elapsed = start_time.elapsed();
        eprintln!(
            "📊 search_messages performance: {} results (limit: {}), {}ms elapsed",
            filtered.len(),
            max_results,
            elapsed.as_millis()
        );
    }

    Ok(filtered)
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

    /// A user/tool-result message whose `message.content` text is `visible`, while
    /// `result_stdout` lives only in the top-level `toolUseResult` field (mirrors
    /// how Read/Bash results are stored on disk).
    fn create_tool_result_message(
        uuid: &str,
        session_id: &str,
        visible: &str,
        result_stdout: &str,
    ) -> String {
        format!(
            r#"{{"uuid":"{uuid}","sessionId":"{session_id}","timestamp":"2025-06-26T10:02:00Z","type":"user","message":{{"role":"user","content":[{{"type":"tool_result","tool_use_id":"toolu_1","content":"{visible}"}}]}},"toolUseResult":{{"stdout":"{result_stdout}","stderr":"","interrupted":false}}}}"#
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
            None,
        )
        .await;

        assert!(result.is_ok());
        let messages = result.unwrap();
        assert_eq!(messages.len(), 2); // Both messages contain "Rust"
    }

    #[tokio::test]
    async fn test_search_messages_matches_tool_use_result() {
        // Regression for #394: a query that appears ONLY in toolUseResult
        // (e.g. command output / file contents) must be found by global search,
        // mirroring the in-session FlexSearch index.
        let temp_dir = TempDir::new().unwrap();
        let project_dir = temp_dir.path().join("projects").join("test-project");
        std::fs::create_dir_all(&project_dir).unwrap();

        // The unique token only appears in toolUseResult.stdout, never in content.
        let content = format!(
            "{}\n",
            create_tool_result_message(
                "uuid-1",
                "session-1",
                "command output below",
                "ZmagicMarker99"
            )
        );
        let file_path = project_dir.join("test.jsonl");
        let mut file = File::create(&file_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();

        let result = search_messages(
            temp_dir.path().to_string_lossy().to_string(),
            "ZmagicMarker99".to_string(),
            serde_json::json!({}),
            None,
        )
        .await
        .unwrap();

        assert_eq!(
            result.len(),
            1,
            "global search must match text found only in toolUseResult (#394)"
        );
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
            None,
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
            None,
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
            None,
        )
        .await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_search_messages_invalid_date_filter_returns_error() {
        let temp_dir = TempDir::new().unwrap();

        let result = search_messages(
            temp_dir.path().to_string_lossy().to_string(),
            "test".to_string(),
            serde_json::json!({
                "dateRange": ["invalid-date", "2026-02-20T00:00:00Z"]
            }),
            None,
        )
        .await;

        assert!(result.is_err());
        assert!(result
            .err()
            .unwrap_or_default()
            .contains("Invalid dateRange start"));
    }
}
