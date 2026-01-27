//! Session loading functions

use crate::models::{ClaudeMessage, ClaudeSession, MessagePage, RawLogEntry};
use crate::utils::{extract_project_name, find_line_ranges, find_line_starts};
use chrono::{DateTime, Utc};
use memmap2::Mmap;
use rayon::prelude::*;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::time::SystemTime;
use uuid::Uuid;
use walkdir::WalkDir;

/// Cache entry for a single session file (supports incremental parsing)
#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct CachedSessionMetadata {
    /// File modification time (as Unix timestamp)
    modified_time: u64,
    /// File size in bytes (for detecting append-only changes)
    file_size: u64,
    /// Last byte offset processed (for incremental parsing)
    last_byte_offset: u64,
    /// Cached session data (None if file had no valid messages)
    session: Option<ClaudeSession>,
    /// Number of sidechain messages (for filtering adjustment)
    sidechain_count: usize,
    /// Whether `tool_use` was detected (for incremental updates)
    has_tool_use: bool,
    /// Whether errors were detected (for incremental updates)
    has_errors: bool,
}

/// Session metadata cache file structure
#[derive(serde::Serialize, serde::Deserialize, Default)]
struct SessionMetadataCache {
    /// Version for cache invalidation on format changes
    version: u32,
    /// Map of file path -> cached metadata
    entries: HashMap<String, CachedSessionMetadata>,
}

const CACHE_VERSION: u32 = 4;

/// Get the cache file path for a project
fn get_cache_path(project_path: &str) -> PathBuf {
    PathBuf::from(project_path).join(".session_cache.json")
}

/// Load cache from disk
fn load_cache(project_path: &str) -> SessionMetadataCache {
    let cache_path = get_cache_path(project_path);
    if let Ok(content) = fs::read_to_string(&cache_path) {
        if let Ok(cache) = serde_json::from_str::<SessionMetadataCache>(&content) {
            if cache.version == CACHE_VERSION {
                return cache;
            }
        }
    }
    SessionMetadataCache::default()
}

/// Save cache to disk (best effort, errors are ignored)
fn save_cache(project_path: &str, cache: &SessionMetadataCache) {
    let cache_path = get_cache_path(project_path);
    if let Ok(content) = serde_json::to_string(cache) {
        let _ = fs::File::create(&cache_path).and_then(|mut f| f.write_all(content.as_bytes()));
    }
}

/// Get file modification time as Unix timestamp
fn get_modified_time(path: &PathBuf) -> Option<u64> {
    path.metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
}

/// Get file size in bytes
fn get_file_size(path: &PathBuf) -> Option<u64> {
    path.metadata().ok().map(|m| m.len())
}

/// Data needed for incremental parsing continuation
#[derive(Clone)]
struct IncrementalParseState {
    /// Byte offset to start reading from
    start_offset: u64,
    /// Previous message count
    message_count: usize,
    /// Previous sidechain count
    sidechain_count: usize,
    /// Previous last timestamp
    last_timestamp: Option<String>,
    /// Already detected `tool_use`
    has_tool_use: bool,
    /// Already detected errors
    has_errors: bool,
    /// Session ID (already known)
    session_id: Option<String>,
    /// First timestamp (already known)
    first_timestamp: Option<String>,
    /// Summary (already known)
    summary: Option<String>,
    /// First user content (already known)
    first_user_content: Option<String>,
}

/// Minimal struct for fast line classification (avoids full parsing)
#[derive(serde::Deserialize)]
struct LineClassifier {
    #[serde(rename = "type")]
    message_type: String,
    #[serde(rename = "isSidechain")]
    is_sidechain: Option<bool>,
    #[serde(rename = "isMeta")]
    is_meta: Option<bool>,
}

/// Minimal struct for extracting session metadata without full message parsing
#[derive(serde::Deserialize)]
struct SessionMetadataEntry {
    #[serde(rename = "type")]
    message_type: String,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    timestamp: Option<String>,
    #[serde(rename = "isSidechain")]
    is_sidechain: Option<bool>,
    #[serde(rename = "isMeta")]
    is_meta: Option<bool>,
    summary: Option<String>,
    #[serde(rename = "toolUse")]
    tool_use: Option<serde_json::Value>,
    #[serde(rename = "toolUseResult")]
    tool_use_result: Option<serde_json::Value>,
    message: Option<SessionMetadataMessage>,
}

#[derive(serde::Deserialize)]
struct SessionMetadataMessage {
    content: Option<serde_json::Value>,
}

/// Minimal classifier for fast line counting (smaller than `SessionMetadataEntry`)
#[derive(serde::Deserialize)]
struct QuickLineClassifier {
    #[serde(rename = "type")]
    message_type: String,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    timestamp: Option<String>,
    #[serde(rename = "isSidechain")]
    is_sidechain: Option<bool>,
    #[serde(rename = "isMeta")]
    is_meta: Option<bool>,
}

/// Fast session metadata extraction result
struct SessionExtractionResult {
    session: ClaudeSession,
    sidechain_count: usize,
    /// Final byte offset after parsing (for incremental updates)
    final_byte_offset: u64,
    /// Whether `tool_use` was detected
    has_tool_use: bool,
    /// Whether errors were detected
    has_errors: bool,
}

/// Fast session metadata extraction with two-phase parsing:
/// Phase 1: Extract essential metadata from first ~50 lines
/// Phase 2: Count remaining messages with minimal parsing
/// Always extracts total count (without sidechain filtering) for caching purposes
fn extract_session_metadata_from_file(file_path: &PathBuf) -> Option<SessionExtractionResult> {
    extract_session_metadata_internal(file_path, None)
}

/// Incremental session metadata extraction - only parses new content from given offset
fn extract_session_metadata_incremental(
    file_path: &PathBuf,
    state: IncrementalParseState,
) -> Option<SessionExtractionResult> {
    extract_session_metadata_internal(file_path, Some(state))
}

/// Internal extraction function that supports both full and incremental parsing
fn extract_session_metadata_internal(
    file_path: &PathBuf,
    incremental_state: Option<IncrementalParseState>,
) -> Option<SessionExtractionResult> {
    let metadata = file_path.metadata().ok();
    let file_size = metadata.as_ref().map_or(0, std::fs::Metadata::len);
    let last_modified = metadata
        .as_ref()
        .and_then(|m| m.modified().ok())
        .map(|t| {
            let dt: DateTime<Utc> = t.into();
            dt.to_rfc3339()
        })
        .unwrap_or_else(|| Utc::now().to_rfc3339());

    let mut file = fs::File::open(file_path).ok()?;
    let file_path_str = file_path.to_string_lossy().to_string();

    // Initialize from incremental state or start fresh
    let (
        start_offset,
        mut message_count,
        mut sidechain_count,
        mut first_timestamp,
        mut last_timestamp,
        mut actual_session_id,
        mut session_summary,
        mut has_tool_use,
        mut has_errors,
        mut first_user_content,
    ) = if let Some(ref state) = incremental_state {
        (
            state.start_offset,
            state.message_count,
            state.sidechain_count,
            state.first_timestamp.clone(),
            state.last_timestamp.clone(),
            state.session_id.clone(),
            state.summary.clone(),
            state.has_tool_use,
            state.has_errors,
            state.first_user_content.clone(),
        )
    } else {
        (
            0u64, 0usize, 0usize, None, None, None, None, false, false, None,
        )
    };

    // Seek to start position for incremental parsing
    if start_offset > 0 && file.seek(SeekFrom::Start(start_offset)).is_err() {
        return None;
    }

    // Use larger buffer for better I/O performance on large files
    let reader = BufReader::with_capacity(64 * 1024, file);

    // For incremental parsing, we skip the metadata collection phase
    // since we already have it from the previous parse
    let is_incremental = incremental_state.is_some();
    let mut metadata_complete = is_incremental;
    let mut lines_processed = 0usize;
    const METADATA_PHASE_LINES: usize = 100; // Full parse first N lines

    for line_result in reader.lines() {
        let line = match line_result {
            Ok(l) => l,
            Err(_) => continue,
        };

        if line.trim().is_empty() {
            continue;
        }

        lines_processed += 1;

        // Phase 1: Full metadata extraction for first N lines (skip if incremental)
        if !metadata_complete && lines_processed <= METADATA_PHASE_LINES {
            if let Ok(entry) = serde_json::from_str::<SessionMetadataEntry>(&line) {
                // Handle summary messages
                if entry.message_type == "summary" {
                    if session_summary.is_none() {
                        session_summary = entry.summary;
                    }
                    continue;
                }

                // Skip system message types
                if is_system_message_type(&entry.message_type) {
                    continue;
                }

                // Need timestamp or session_id to be valid
                if entry.session_id.is_none() && entry.timestamp.is_none() {
                    continue;
                }

                // Skip meta messages (internal/command-related messages)
                if entry.is_meta.unwrap_or(false) {
                    continue;
                }

                // Track sidechain messages separately
                let is_sidechain = entry.is_sidechain.unwrap_or(false);
                if is_sidechain {
                    sidechain_count += 1;
                }
                message_count += 1;

                // Track timestamps
                if let Some(ref ts) = entry.timestamp {
                    if first_timestamp.is_none() {
                        first_timestamp = Some(ts.clone());
                    }
                    last_timestamp = Some(ts.clone());
                }

                // Track session ID
                if actual_session_id.is_none() {
                    if let Some(ref sid) = entry.session_id {
                        actual_session_id = Some(sid.clone());
                    }
                }

                // Check for tool use
                if !has_tool_use {
                    if entry.tool_use.is_some() || entry.tool_use_result.is_some() {
                        has_tool_use = true;
                    } else if entry.message_type == "assistant" {
                        if let Some(ref msg) = entry.message {
                            if let Some(ref content) = msg.content {
                                if let Some(arr) = content.as_array() {
                                    for item in arr {
                                        if item.get("type").and_then(|v| v.as_str())
                                            == Some("tool_use")
                                        {
                                            has_tool_use = true;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Check for errors
                if !has_errors {
                    if let Some(ref result) = entry.tool_use_result {
                        if let Some(stderr) = result.get("stderr") {
                            if !stderr.as_str().unwrap_or("").is_empty() {
                                has_errors = true;
                            }
                        }
                    }
                }

                // Extract first user message for summary fallback
                if first_user_content.is_none() && entry.message_type == "user" {
                    if let Some(ref msg) = entry.message {
                        if let Some(ref content) = msg.content {
                            first_user_content = extract_user_text(content);
                        }
                    }
                }

                // Check if we have all essential metadata
                if actual_session_id.is_some()
                    && first_timestamp.is_some()
                    && (first_user_content.is_some() || session_summary.is_some())
                {
                    metadata_complete = true;
                }
            }
            continue;
        }

        // Phase 2: Fast counting with minimal parsing
        if let Ok(classifier) = serde_json::from_str::<QuickLineClassifier>(&line) {
            // Skip summary
            if classifier.message_type == "summary" {
                // Still capture summary if we don't have one
                if session_summary.is_none() {
                    if let Ok(entry) = serde_json::from_str::<SessionMetadataEntry>(&line) {
                        session_summary = entry.summary;
                    }
                }
                continue;
            }

            // Skip system message types
            if is_system_message_type(&classifier.message_type) {
                continue;
            }

            // Need timestamp or session_id to be valid
            if classifier.session_id.is_none() && classifier.timestamp.is_none() {
                continue;
            }

            // Skip meta messages (internal/command-related messages)
            if classifier.is_meta.unwrap_or(false) {
                continue;
            }

            // Track sidechain messages separately
            let is_sidechain = classifier.is_sidechain.unwrap_or(false);
            if is_sidechain {
                sidechain_count += 1;
            }
            message_count += 1;

            // Update last timestamp
            if let Some(ts) = classifier.timestamp {
                last_timestamp = Some(ts);
            }

            // Quick tool_use check via string search (faster than full parse)
            if !has_tool_use
                && (line.contains("\"toolUse\"")
                    || line.contains("\"toolUseResult\"")
                    || line.contains("\"tool_use\""))
            {
                has_tool_use = true;
            }

            // Quick error check via string search
            if !has_errors && line.contains("\"stderr\"") && !line.contains("\"stderr\":\"\"") {
                has_errors = true;
            }
        }
    }

    if message_count == 0 {
        return None;
    }

    let raw_project_name = file_path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let project_name = extract_project_name(&raw_project_name);
    let final_summary = session_summary.or(first_user_content);

    Some(SessionExtractionResult {
        session: ClaudeSession {
            session_id: file_path_str.clone(),
            actual_session_id: actual_session_id.unwrap_or_else(|| "unknown-session".to_string()),
            file_path: file_path_str,
            project_name,
            message_count,
            first_message_time: first_timestamp.unwrap_or_else(|| Utc::now().to_rfc3339()),
            last_message_time: last_timestamp
                .clone()
                .unwrap_or_else(|| Utc::now().to_rfc3339()),
            last_modified,
            has_tool_use,
            has_errors,
            summary: final_summary,
        },
        sidechain_count,
        final_byte_offset: file_size,
        has_tool_use,
        has_errors,
    })
}

/// System message types that should be excluded from the viewer
/// These are internal system messages, not part of the conversation
const SYSTEM_MESSAGE_TYPES: [&str; 4] = [
    "progress",
    "queue-operation",
    "file-history-snapshot",
    "system",
];

/// Check if a message type is a system type (should be excluded)
#[inline]
fn is_system_message_type(message_type: &str) -> bool {
    SYSTEM_MESSAGE_TYPES.contains(&message_type)
}

/// Fast classification of a line without full parsing
/// Returns true if the line should be counted as a valid message
#[inline]
#[allow(dead_code)] // Keep for fallback and tests
fn classify_line(line: &str, exclude_sidechain: bool) -> bool {
    if line.trim().is_empty() {
        return false;
    }

    // Fast path: try to extract just the type field
    if let Ok(classifier) = serde_json::from_str::<LineClassifier>(line) {
        // Exclude summary messages
        if classifier.message_type == "summary" {
            return false;
        }
        // Exclude system message types (progress, queue-operation, file-history-snapshot, system)
        if is_system_message_type(&classifier.message_type) {
            return false;
        }
        // Exclude meta messages (internal/command-related messages)
        if classifier.is_meta.unwrap_or(false) {
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
        format!("{truncated}...")
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
        }
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
        }
        _ => None,
    }
}

/// Categorization of how to handle a file
enum FileParseStrategy {
    /// Use cached data as-is (file unchanged)
    UseCached(ClaudeSession, usize), // (session, sidechain_count)
    /// File grew - use incremental parsing from offset
    Incremental(PathBuf, IncrementalParseState),
    /// Full reparse needed (new file or file shrunk/modified in place)
    FullParse(PathBuf),
}

#[tauri::command]
pub async fn load_project_sessions(
    project_path: String,
    exclude_sidechain: Option<bool>,
) -> Result<Vec<ClaudeSession>, String> {
    #[cfg(debug_assertions)]
    let start_time = std::time::Instant::now();

    let exclude = exclude_sidechain.unwrap_or(false);

    // 1. Load existing cache
    let mut cache = load_cache(&project_path);
    let mut cache_updated = false;

    // 2. Collect all JSONL file paths
    let file_paths: Vec<PathBuf> = WalkDir::new(&project_path)
        .into_iter()
        .filter_map(std::result::Result::ok)
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
        .map(|e| e.path().to_path_buf())
        .collect();

    #[cfg(debug_assertions)]
    eprintln!(
        "🔍 load_project_sessions: processing {} files",
        file_paths.len()
    );

    // 3. Categorize files into: cached, incremental, full parse
    let mut strategies: Vec<FileParseStrategy> = Vec::with_capacity(file_paths.len());
    #[cfg(debug_assertions)]
    let mut cache_hit_count = 0usize;
    #[cfg(debug_assertions)]
    let mut incremental_count = 0usize;
    #[cfg(debug_assertions)]
    let mut full_parse_count = 0usize;

    for path in &file_paths {
        let path_str = path.to_string_lossy().to_string();
        let current_size = get_file_size(path).unwrap_or(0);
        let current_mtime = get_modified_time(path);

        if let Some(cached) = cache.entries.get(&path_str) {
            // Check if file hasn't changed at all
            if Some(cached.modified_time) == current_mtime && cached.file_size == current_size {
                if let Some(ref session) = cached.session {
                    #[cfg(debug_assertions)]
                    {
                        cache_hit_count += 1;
                    }
                    strategies.push(FileParseStrategy::UseCached(
                        session.clone(),
                        cached.sidechain_count,
                    ));
                    continue;
                }
            }

            // Check if file grew (append-only) - use incremental parsing
            if current_size > cached.file_size {
                if let Some(session) = cached.session.as_ref() {
                    #[cfg(debug_assertions)]
                    {
                        incremental_count += 1;
                    }
                    strategies.push(FileParseStrategy::Incremental(
                        path.clone(),
                        IncrementalParseState {
                            start_offset: cached.last_byte_offset,
                            message_count: session.message_count,
                            sidechain_count: cached.sidechain_count,
                            last_timestamp: Some(session.last_message_time.clone()),
                            has_tool_use: cached.has_tool_use,
                            has_errors: cached.has_errors,
                            session_id: Some(session.actual_session_id.clone()),
                            first_timestamp: Some(session.first_message_time.clone()),
                            summary: session.summary.clone(),
                            first_user_content: session.summary.clone(),
                        },
                    ));
                    continue;
                }
            }
        }

        // New file or file was modified (not just appended) - full parse
        #[cfg(debug_assertions)]
        {
            full_parse_count += 1;
        }
        strategies.push(FileParseStrategy::FullParse(path.clone()));
    }

    #[cfg(debug_assertions)]
    eprintln!(
        "📦 Cache hits: {cache_hit_count}, incremental parsing: {incremental_count}, full parsing: {full_parse_count}"
    );

    // 4. Process strategies in parallel
    let results: Vec<(FileParseStrategy, Option<SessionExtractionResult>)> = strategies
        .into_par_iter()
        .map(|strategy| match &strategy {
            FileParseStrategy::UseCached(_, _) => (strategy, None),
            FileParseStrategy::Incremental(path, state) => {
                let result = extract_session_metadata_incremental(path, state.clone());
                (strategy, result)
            }
            FileParseStrategy::FullParse(path) => {
                let result = extract_session_metadata_from_file(path);
                (strategy, result)
            }
        })
        .collect();

    // 5. Process results and update cache
    let mut sessions: Vec<ClaudeSession> = Vec::with_capacity(results.len());

    for (strategy, result_opt) in results {
        match strategy {
            FileParseStrategy::UseCached(session, sidechain_count) => {
                let mut session_clone = session;
                if exclude {
                    session_clone.message_count =
                        session_clone.message_count.saturating_sub(sidechain_count);
                    if session_clone.message_count == 0 {
                        continue;
                    }
                }
                sessions.push(session_clone);
            }
            FileParseStrategy::Incremental(path, _) | FileParseStrategy::FullParse(path) => {
                let path_str = path.to_string_lossy().to_string();
                let mtime = get_modified_time(&path).unwrap_or(0);
                let file_size = get_file_size(&path).unwrap_or(0);

                let (session_for_cache, sidechain_count, byte_offset, has_tool_use, has_errors) =
                    match &result_opt {
                        Some(result) => (
                            Some(result.session.clone()),
                            result.sidechain_count,
                            result.final_byte_offset,
                            result.has_tool_use,
                            result.has_errors,
                        ),
                        None => (None, 0, 0, false, false),
                    };

                cache.entries.insert(
                    path_str,
                    CachedSessionMetadata {
                        modified_time: mtime,
                        file_size,
                        last_byte_offset: byte_offset,
                        session: session_for_cache,
                        sidechain_count,
                        has_tool_use,
                        has_errors,
                    },
                );
                cache_updated = true;

                if let Some(result) = result_opt {
                    let mut session = result.session;
                    if exclude {
                        session.message_count =
                            session.message_count.saturating_sub(result.sidechain_count);
                        if session.message_count == 0 {
                            continue;
                        }
                    }
                    sessions.push(session);
                }
            }
        }
    }

    // 6. Sort
    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));

    // 8. Summary propagation
    let mut summary_map: HashMap<String, String> = HashMap::new();

    for session in &sessions {
        if let Some(ref summary) = session.summary {
            if !summary.is_empty() {
                summary_map.insert(session.actual_session_id.clone(), summary.clone());
            }
        }
    }

    for session in &mut sessions {
        if session.summary.is_none()
            || session
                .summary
                .as_ref()
                .is_some_and(std::string::String::is_empty)
        {
            if let Some(summary) = summary_map.get(&session.actual_session_id) {
                session.summary = Some(summary.clone());
            }
        }
    }

    // 9. Save updated cache
    if cache_updated {
        cache.version = CACHE_VERSION;
        save_cache(&project_path, &cache);
    }

    #[cfg(debug_assertions)]
    {
        let elapsed = start_time.elapsed();
        println!(
            "📊 load_project_sessions performance: {} sessions, {}ms elapsed",
            sessions.len(),
            elapsed.as_millis()
        );
    }

    Ok(sessions)
}

/// Parse a single line into `ClaudeMessage` (with line number)
#[allow(dead_code)] // Keep for fallback and tests
fn parse_line_to_message(
    line_num: usize,
    line: &str,
    include_summary: bool,
) -> Option<ClaudeMessage> {
    if line.trim().is_empty() {
        return None;
    }

    let log_entry: RawLogEntry = serde_json::from_str(line).ok()?;

    // Skip meta messages (internal/command-related messages)
    if log_entry.is_meta.unwrap_or(false) {
        return None;
    }

    if log_entry.message_type == "summary" {
        if !include_summary {
            return None;
        }
        let summary_text = log_entry.summary?;
        let uuid = log_entry.uuid.unwrap_or_else(|| Uuid::new_v4().to_string());

        return Some(ClaudeMessage {
            uuid,
            parent_uuid: log_entry.leaf_uuid,
            session_id: log_entry
                .session_id
                .unwrap_or_else(|| "unknown-session".to_string()),
            timestamp: log_entry
                .timestamp
                .unwrap_or_else(|| Utc::now().to_rfc3339()),
            message_type: "summary".to_string(),
            content: Some(serde_json::Value::String(summary_text)),
            project_name: None,
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

    let uuid = log_entry
        .uuid
        .unwrap_or_else(|| format!("{}-line-{}", Uuid::new_v4(), line_num + 1));

    let (role, message_id, model, stop_reason, usage) = if let Some(ref msg) = log_entry.message {
        (
            Some(msg.role.clone()),
            msg.id.clone(),
            msg.model.clone(),
            msg.stop_reason.clone(),
            msg.usage.clone(),
        )
    } else {
        (None, None, None, None, None)
    };

    Some(ClaudeMessage {
        uuid,
        parent_uuid: log_entry.parent_uuid,
        session_id: log_entry
            .session_id
            .unwrap_or_else(|| "unknown-session".to_string()),
        timestamp: log_entry
            .timestamp
            .unwrap_or_else(|| Utc::now().to_rfc3339()),
        message_type: log_entry.message_type,
        content: log_entry.message.map(|m| m.content).or(log_entry.content),
        project_name: None,
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

/// Parse a single line using simd-json for faster parsing
/// Returns None if the line is empty or fails to parse
fn parse_line_simd(
    line_num: usize,
    line: &mut [u8],
    include_summary: bool,
) -> Option<ClaudeMessage> {
    if line
        .iter()
        .all(|&b| b == b' ' || b == b'\t' || b == b'\n' || b == b'\r')
    {
        return None;
    }

    // Use simd_json for faster parsing
    let log_entry: RawLogEntry = simd_json::serde::from_slice(line).ok()?;

    // Skip meta messages
    if log_entry.is_meta.unwrap_or(false) {
        return None;
    }

    if log_entry.message_type == "summary" {
        if !include_summary {
            return None;
        }
        let summary_text = log_entry.summary?;
        let uuid = log_entry.uuid.unwrap_or_else(|| Uuid::new_v4().to_string());

        return Some(ClaudeMessage {
            uuid,
            parent_uuid: log_entry.leaf_uuid,
            session_id: log_entry
                .session_id
                .unwrap_or_else(|| "unknown-session".to_string()),
            timestamp: log_entry
                .timestamp
                .unwrap_or_else(|| Utc::now().to_rfc3339()),
            message_type: "summary".to_string(),
            content: Some(serde_json::Value::String(summary_text)),
            project_name: None,
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

    let uuid = log_entry
        .uuid
        .unwrap_or_else(|| format!("{}-line-{}", Uuid::new_v4(), line_num + 1));

    let (role, message_id, model, stop_reason, usage) = if let Some(ref msg) = log_entry.message {
        (
            Some(msg.role.clone()),
            msg.id.clone(),
            msg.model.clone(),
            msg.stop_reason.clone(),
            msg.usage.clone(),
        )
    } else {
        (None, None, None, None, None)
    };

    Some(ClaudeMessage {
        uuid,
        parent_uuid: log_entry.parent_uuid,
        session_id: log_entry
            .session_id
            .unwrap_or_else(|| "unknown-session".to_string()),
        timestamp: log_entry
            .timestamp
            .unwrap_or_else(|| Utc::now().to_rfc3339()),
        message_type: log_entry.message_type,
        content: log_entry.message.map(|m| m.content).or(log_entry.content),
        project_name: None,
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
#[allow(unsafe_code)] // Required for mmap performance optimization
pub async fn load_session_messages(session_path: String) -> Result<Vec<ClaudeMessage>, String> {
    #[cfg(debug_assertions)]
    let start_time = std::time::Instant::now();

    // Use memory-mapped file for faster I/O
    let file =
        fs::File::open(&session_path).map_err(|e| format!("Failed to open session file: {e}"))?;

    // SAFETY: We're only reading the file, and the file handle is kept open
    // for the duration of the mmap's lifetime. No concurrent modifications expected
    // as session files are append-only by Claude.
    let mmap = unsafe { Mmap::map(&file) }
        .map_err(|e| format!("Failed to memory-map session file: {e}"))?;

    // Find line boundaries efficiently using SIMD-accelerated memchr
    let line_starts = find_line_starts(&mmap);

    // Parse lines in parallel using simd-json
    let mut messages: Vec<(usize, ClaudeMessage)> = line_starts
        .par_iter()
        .enumerate()
        .filter_map(|(line_num, &start)| {
            let end = line_starts.get(line_num + 1).map_or(mmap.len(), |&e| e - 1);
            if start >= end {
                return None;
            }

            // Create a mutable copy for simd-json (it requires mutable slice)
            let mut line_bytes = mmap[start..end].to_vec();

            parse_line_simd(line_num, &mut line_bytes, false)
                .filter(|msg| !is_system_message_type(&msg.message_type))
                .map(|msg| (line_num, msg))
        })
        .collect();

    // Sort by line number to maintain original order
    messages.sort_by_key(|(line_num, _)| *line_num);
    let messages: Vec<ClaudeMessage> = messages.into_iter().map(|(_, msg)| msg).collect();

    #[cfg(debug_assertions)]
    {
        let elapsed = start_time.elapsed();
        eprintln!(
            "📤 [load_session_messages] {} messages, {}ms elapsed (simd-json + mmap optimized)",
            messages.len(),
            elapsed.as_millis()
        );
    }

    Ok(messages)
}

/// Fast line classifier for simd-json (mutable slice)
fn classify_line_fast(line: &[u8], exclude_sidechain: bool) -> bool {
    if line
        .iter()
        .all(|&b| b == b' ' || b == b'\t' || b == b'\n' || b == b'\r')
    {
        return false;
    }

    // Try fast simd-json parsing with minimal struct
    let mut line_copy = line.to_vec();
    if let Ok(classifier) = simd_json::serde::from_slice::<LineClassifier>(&mut line_copy) {
        if classifier.message_type == "summary" {
            return false;
        }
        if is_system_message_type(&classifier.message_type) {
            return false;
        }
        if classifier.is_meta.unwrap_or(false) {
            return false;
        }
        if exclude_sidechain && classifier.is_sidechain.unwrap_or(false) {
            return false;
        }
        return true;
    }
    false
}

#[tauri::command]
#[allow(unsafe_code)] // Required for mmap performance optimization
pub async fn load_session_messages_paginated(
    session_path: String,
    offset: usize,
    limit: usize,
    exclude_sidechain: Option<bool>,
) -> Result<MessagePage, String> {
    #[cfg(debug_assertions)]
    let start_time = std::time::Instant::now();

    // Use memory-mapped file for faster I/O
    let file =
        fs::File::open(&session_path).map_err(|e| format!("Failed to open session file: {e}"))?;

    // SAFETY: We're only reading the file, and the file handle is kept open
    // for the duration of the mmap's lifetime. No concurrent modifications expected
    // as session files are append-only by Claude.
    let mmap = unsafe { Mmap::map(&file) }
        .map_err(|e| format!("Failed to memory-map session file: {e}"))?;

    let exclude = exclude_sidechain.unwrap_or(false);

    // Find line boundaries efficiently using SIMD-accelerated memchr
    let line_ranges = find_line_ranges(&mmap);

    // Phase 1: Build valid line indices (fast classification)
    let valid_indices: Vec<usize> = line_ranges
        .iter()
        .enumerate()
        .filter(|(_, &(start, end))| {
            let line = &mmap[start..end];
            classify_line_fast(line, exclude)
        })
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

    // Phase 2: Parse only the target lines (parallel with simd-json)
    let target_indices = &valid_indices[start_idx..end_idx];
    let mut parsed: Vec<(usize, ClaudeMessage)> = target_indices
        .par_iter()
        .filter_map(|&range_idx| {
            let (start, end) = line_ranges[range_idx];
            let mut line_bytes = mmap[start..end].to_vec();
            let msg = parse_line_simd(range_idx, &mut line_bytes, false)?;
            Some((range_idx, msg))
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
        eprintln!("📊 load_session_messages_paginated performance: {}/{} messages, {}ms elapsed (simd-json + mmap)",
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
#[allow(unsafe_code)] // Required for mmap performance optimization
pub async fn get_session_message_count(
    session_path: String,
    exclude_sidechain: Option<bool>,
) -> Result<usize, String> {
    // Use memory-mapped file for faster I/O
    let file =
        fs::File::open(&session_path).map_err(|e| format!("Failed to open session file: {e}"))?;

    // SAFETY: We're only reading the file, and the file handle is kept open
    // for the duration of the mmap's lifetime. No concurrent modifications expected
    // as session files are append-only by Claude.
    let mmap = unsafe { Mmap::map(&file) }
        .map_err(|e| format!("Failed to memory-map session file: {e}"))?;

    let exclude = exclude_sidechain.unwrap_or(false);

    // Find line boundaries and count valid lines using SIMD-accelerated memchr
    let line_ranges = find_line_ranges(&mmap);

    // Parallel counting with fast classification
    let count: usize = line_ranges
        .par_iter()
        .filter(|&&(start, end)| {
            let line = &mmap[start..end];
            classify_line_fast(line, exclude)
        })
        .count();

    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn create_test_jsonl_file(dir: &TempDir, filename: &str, content: &str) -> PathBuf {
        let file_path = dir.path().join(filename);
        let mut file = File::create(&file_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();
        file_path
    }

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

    fn create_sample_summary_message(summary: &str) -> String {
        format!(r#"{{"type":"summary","summary":"{summary}","leafUuid":"leaf-123"}}"#)
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
    async fn test_load_session_messages_excludes_summary() {
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
        // Summary messages should be excluded
        assert_eq!(messages.len(), 2);

        // Verify no summary message is present
        let summary_msg = messages.iter().find(|m| m.message_type == "summary");
        assert!(summary_msg.is_none());
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
        assert!(result.unwrap_err().contains("Failed to open session file"));
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
                create_sample_user_message(
                    &format!("uuid-{i}"),
                    "session-1",
                    &format!("Message {i}")
                )
            ));
        }

        let file_path = create_test_jsonl_file(&temp_dir, "test.jsonl", &content);

        let result =
            load_session_messages_paginated(file_path.to_string_lossy().to_string(), 0, 3, None)
                .await;

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
                create_sample_user_message(
                    &format!("uuid-{i}"),
                    "session-1",
                    &format!("Message {i}")
                )
            ));
        }

        let file_path = create_test_jsonl_file(&temp_dir, "test.jsonl", &content);

        // Get second page
        let result =
            load_session_messages_paginated(file_path.to_string_lossy().to_string(), 3, 3, None)
                .await;

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
            Some(true),
        )
        .await;

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
                create_sample_user_message(
                    &format!("uuid-{i}"),
                    "session-1",
                    &format!("Message {i}")
                )
            ));
        }
        // Add a summary (should not be counted)
        content.push_str(&format!("{}\n", create_sample_summary_message("Summary")));

        let file_path = create_test_jsonl_file(&temp_dir, "test.jsonl", &content);

        let result = get_session_message_count(file_path.to_string_lossy().to_string(), None).await;

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
        let count_all = get_session_message_count(file_path.to_string_lossy().to_string(), None)
            .await
            .unwrap();
        assert_eq!(count_all, 3);

        // With exclude
        let count_filtered =
            get_session_message_count(file_path.to_string_lossy().to_string(), Some(true))
                .await
                .unwrap();
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

        let result =
            load_project_sessions(temp_dir.path().to_string_lossy().to_string(), None).await;

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

        let result =
            load_project_sessions(temp_dir.path().to_string_lossy().to_string(), None).await;

        assert!(result.is_ok());
        let sessions = result.unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(
            sessions[0].summary,
            Some("This is the session summary".to_string())
        );
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

        let result =
            load_project_sessions(temp_dir.path().to_string_lossy().to_string(), None).await;

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
        let result_all = load_project_sessions(temp_dir.path().to_string_lossy().to_string(), None)
            .await
            .unwrap();
        assert_eq!(result_all[0].message_count, 2);

        // With exclude
        let result_filtered =
            load_project_sessions(temp_dir.path().to_string_lossy().to_string(), Some(true))
                .await
                .unwrap();
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

        let result =
            load_project_sessions(temp_dir.path().to_string_lossy().to_string(), None).await;

        assert!(result.is_ok());
        let sessions = result.unwrap();
        assert!(sessions[0].has_tool_use);
    }

    #[tokio::test]
    async fn test_load_project_sessions_empty_directory() {
        let temp_dir = TempDir::new().unwrap();

        let result =
            load_project_sessions(temp_dir.path().to_string_lossy().to_string(), None).await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_incremental_parsing_on_file_append() {
        use std::io::Write;

        let temp_dir = TempDir::new().unwrap();

        // Initial content with 2 messages
        let initial_content = r#"{"uuid":"uuid-1","sessionId":"session-1","timestamp":"2025-06-26T10:00:00Z","type":"user","message":{"role":"user","content":"Hello"}}
{"uuid":"uuid-2","sessionId":"session-1","timestamp":"2025-06-26T10:01:00Z","type":"assistant","message":{"role":"assistant","content":"Hi there"}}
"#;

        let file_path = temp_dir.path().join("test.jsonl");
        std::fs::write(&file_path, initial_content).unwrap();

        // First load - creates cache
        let result1 = load_project_sessions(temp_dir.path().to_string_lossy().to_string(), None)
            .await
            .unwrap();
        assert_eq!(result1.len(), 1);
        assert_eq!(result1[0].message_count, 2);

        // Append more messages to the file
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&file_path)
            .unwrap();
        writeln!(file, r#"{{"uuid":"uuid-3","sessionId":"session-1","timestamp":"2025-06-26T10:02:00Z","type":"user","message":{{"role":"user","content":"How are you?"}}}}"#).unwrap();
        writeln!(file, r#"{{"uuid":"uuid-4","sessionId":"session-1","timestamp":"2025-06-26T10:03:00Z","type":"assistant","message":{{"role":"assistant","content":"I'm doing great!"}}}}"#).unwrap();
        drop(file);

        // Second load - should use incremental parsing
        let result2 = load_project_sessions(temp_dir.path().to_string_lossy().to_string(), None)
            .await
            .unwrap();
        assert_eq!(result2.len(), 1);
        assert_eq!(result2[0].message_count, 4); // 2 original + 2 appended
        assert_eq!(result2[0].last_message_time, "2025-06-26T10:03:00Z");
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
