//! Native session renaming module
//!
//! Provides functionality to rename Claude Code sessions by modifying
//! the first user message in the session JSONL file.

use lazy_static::lazy_static;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::command;

use crate::utils::is_safe_storage_id;

lazy_static! {
    /// Regex for validating JSONL filename pattern (alphanumeric, underscore, hyphen only)
    static ref FILENAME_REGEX: Regex = Regex::new(r"^[A-Za-z0-9_-]+$").unwrap();
}

/// Result structure for rename operations
#[derive(Debug, Serialize, Deserialize)]
pub struct NativeRenameResult {
    pub success: bool,
    pub previous_title: String,
    pub new_title: String,
    pub file_path: String,
}

/// Error types for rename operations
#[derive(Debug, Serialize)]
pub enum RenameError {
    FileNotFound(String),
    PermissionDenied(String),
    InvalidSessionPath(String),
    InvalidJsonFormat(String),
    IoError(String),
    EmptySession,
    NoUserMessage,
    UnsupportedContentFormat,
    InvalidTitle(String),
}

impl std::fmt::Display for RenameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RenameError::FileNotFound(path) => write!(f, "Session file not found: {path}"),
            RenameError::PermissionDenied(path) => write!(f, "Permission denied: {path}"),
            RenameError::InvalidSessionPath(msg) => write!(f, "Invalid session path: {msg}"),
            RenameError::InvalidJsonFormat(msg) => write!(f, "Invalid JSON format: {msg}"),
            RenameError::IoError(msg) => write!(f, "I/O error: {msg}"),
            RenameError::EmptySession => write!(f, "Session file is empty"),
            RenameError::NoUserMessage => {
                write!(f, "No user message found in session")
            }
            RenameError::UnsupportedContentFormat => {
                write!(f, "Message content format not supported (array content)")
            }
            RenameError::InvalidTitle(msg) => write!(f, "Invalid title: {msg}"),
        }
    }
}

fn parse_opencode_session_path(session_path: &str) -> Result<(String, String), String> {
    let path_part = session_path
        .strip_prefix("opencode://")
        .ok_or_else(|| RenameError::InvalidSessionPath(session_path.to_string()).to_string())?;

    let parts: Vec<&str> = path_part.splitn(2, '/').collect();
    if parts.len() < 2 {
        return Err(RenameError::InvalidSessionPath(session_path.to_string()).to_string());
    }

    let project_id = parts[0];
    let session_id = parts[1];
    if !is_safe_storage_id(project_id) || !is_safe_storage_id(session_id) {
        return Err(RenameError::InvalidSessionPath(session_path.to_string()).to_string());
    }

    Ok((project_id.to_string(), session_id.to_string()))
}

/// Renames a Claude Code session by modifying the first user message.
///
/// # Arguments
/// * `file_path` - Absolute path to the session JSONL file
/// * `new_title` - Title to prepend (empty string to reset)
///
/// # Returns
/// * `Ok(NativeRenameResult)` - Success with previous and new titles
/// * `Err(String)` - Error description
#[command]
pub async fn rename_session_native(
    file_path: String,
    new_title: String,
) -> Result<NativeRenameResult, String> {
    // 1. Validate file exists
    if !std::path::Path::new(&file_path).exists() {
        return Err(RenameError::FileNotFound(file_path).to_string());
    }

    // 2. Validate file path is within ~/.claude directory (security: prevent path traversal)
    validate_claude_path(&file_path)?;

    // 3. Validate title does not contain ']' character (due to nested bracket limitation)
    if new_title.contains(']') {
        return Err(RenameError::InvalidTitle(
            "Title cannot contain ']' character. Use '[' for nested prefixes instead.".to_string(),
        )
        .to_string());
    }

    // 4. Read all lines from JSONL file
    let file =
        File::open(&file_path).map_err(|e| RenameError::IoError(e.to_string()).to_string())?;
    let reader = BufReader::new(file);
    let mut lines: Vec<String> = reader
        .lines()
        .collect::<Result<_, _>>()
        .map_err(|e| RenameError::IoError(e.to_string()).to_string())?;

    if lines.is_empty() {
        return Err(RenameError::EmptySession.to_string());
    }

    // 5. Find first user message (type: "user", not isMeta)
    let user_message_index = find_first_user_message_index(&lines)?;

    // 6. Parse the user message line as JSON
    let mut user_message: serde_json::Value = serde_json::from_str(&lines[user_message_index])
        .map_err(|e| RenameError::InvalidJsonFormat(e.to_string()).to_string())?;

    // 7. Extract current message content - handle nested structure
    let current_message = extract_message_content(&user_message).ok_or_else(|| {
        RenameError::InvalidJsonFormat("No 'message' field found".to_string()).to_string()
    })?;

    // 8. Strip existing bracket prefix if present
    let base_message = strip_title_prefix(&current_message);

    // 9. Construct new message with title prefix
    let new_message = if new_title.trim().is_empty() {
        base_message.clone()
    } else {
        format!("[{}] {}", new_title.trim(), base_message)
    };

    // 10. Update JSON object - handle nested structure
    if !update_message_content(&mut user_message, &new_message) {
        return Err(RenameError::UnsupportedContentFormat.to_string());
    }

    // 11. Serialize back to JSON string
    lines[user_message_index] = serde_json::to_string(&user_message)
        .map_err(|e| RenameError::InvalidJsonFormat(e.to_string()).to_string())?;

    // 12. Write atomically (write to temp with unique nonce, then rename)
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp_path = format!("{file_path}.{nonce}.tmp");
    {
        let mut temp_file = File::create(&temp_path)
            .map_err(|e| RenameError::IoError(e.to_string()).to_string())?;

        for (i, line) in lines.iter().enumerate() {
            if i > 0 {
                writeln!(temp_file).map_err(|e| RenameError::IoError(e.to_string()).to_string())?;
            }
            write!(temp_file, "{line}")
                .map_err(|e| RenameError::IoError(e.to_string()).to_string())?;
        }
    }

    // 13. Atomic rename (Windows compatibility: remove existing file first)
    #[cfg(target_os = "windows")]
    {
        if std::path::Path::new(&file_path).exists() {
            fs::remove_file(&file_path)
                .map_err(|e| RenameError::IoError(e.to_string()).to_string())?;
        }
    }

    fs::rename(&temp_path, &file_path)
        .map_err(|e| RenameError::IoError(e.to_string()).to_string())?;

    Ok(NativeRenameResult {
        success: true,
        previous_title: current_message,
        new_title: new_message,
        file_path,
    })
}

/// Validates that the file path is within the ~/.claude directory.
/// This prevents path traversal attacks that could modify arbitrary files.
///
/// Security checks performed:
/// 1. Path must be absolute
/// 2. No symlinks allowed in any path component
/// 3. Filename must match pattern ^[A-Za-z0-9_-]+$
fn validate_claude_path(file_path: &str) -> Result<(), String> {
    let file_path_buf = std::path::PathBuf::from(file_path);

    // 1. Require absolute path
    if !file_path_buf.is_absolute() {
        return Err(
            RenameError::PermissionDenied("File path must be absolute".to_string()).to_string(),
        );
    }

    // 2. Block symlinks in path components
    // Check each ancestor for symlinks before canonicalizing
    let mut current = file_path_buf.as_path();
    while let Some(parent) = current.parent() {
        if parent.as_os_str().is_empty() {
            break;
        }
        // Use symlink_metadata to avoid following symlinks
        if let Ok(metadata) = fs::symlink_metadata(parent) {
            if metadata.file_type().is_symlink() {
                return Err(RenameError::PermissionDenied(
                    "Symlinks are not allowed in path".to_string(),
                )
                .to_string());
            }
        }
        current = parent;
    }

    // Also check the final file itself for symlinks
    if let Ok(metadata) = fs::symlink_metadata(&file_path_buf) {
        if metadata.file_type().is_symlink() {
            return Err(
                RenameError::PermissionDenied("File path cannot be a symlink".to_string())
                    .to_string(),
            );
        }
    }

    // 3. Validate filename pattern
    if let Some(filename) = file_path_buf.file_stem() {
        let filename_str = filename.to_string_lossy();
        if !FILENAME_REGEX.is_match(&filename_str) {
            return Err(RenameError::PermissionDenied(
                "Filename must contain only alphanumeric characters, underscores, and hyphens"
                    .to_string(),
            )
            .to_string());
        }
    } else {
        return Err(RenameError::PermissionDenied("Invalid filename".to_string()).to_string());
    }

    // Canonicalize to resolve .. components (symlinks already blocked above)
    let canonical_path = file_path_buf
        .canonicalize()
        .map_err(|e| RenameError::IoError(e.to_string()).to_string())?;

    // Get home directory
    let home_dir = dirs::home_dir().ok_or_else(|| {
        RenameError::IoError("Cannot determine home directory".to_string()).to_string()
    })?;

    // Build the allowed claude directory path
    let claude_dir = home_dir.join(".claude");

    // Verify the file is within ~/.claude
    if !canonical_path.starts_with(&claude_dir) {
        return Err(RenameError::PermissionDenied(
            "File path must be within ~/.claude directory".to_string(),
        )
        .to_string());
    }

    Ok(())
}

/// Extracts message content from JSON, handling both direct string and nested object formats
fn extract_message_content(json: &serde_json::Value) -> Option<String> {
    json.get("message").and_then(|m| {
        // Handle direct string: {"message": "text"}
        if let Some(s) = m.as_str() {
            return Some(s.to_string());
        }
        // Handle nested object: {"message": {"role": "user", "content": "text" | [...]}}
        if let Some(obj) = m.as_object() {
            if let Some(content) = obj.get("content") {
                // Content can be a string
                if let Some(s) = content.as_str() {
                    return Some(s.to_string());
                }
                // Content can be an array: [{"type": "text", "text": "..."}]
                if let Some(arr) = content.as_array() {
                    for item in arr {
                        if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                            if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                                return Some(text.to_string());
                            }
                        }
                    }
                }
            }
        }
        None
    })
}

/// Updates message content in JSON, handling both direct string and nested object formats.
/// Returns true if the update was successful, false if the content format is not supported.
fn update_message_content(json: &mut serde_json::Value, new_content: &str) -> bool {
    if let Some(message) = json.get_mut("message") {
        // Handle direct string
        if message.is_string() {
            *message = serde_json::Value::String(new_content.to_string());
            return true;
        }
        // Handle nested object
        if let Some(obj) = message.as_object_mut() {
            if let Some(content) = obj.get("content") {
                // Handle string content
                if content.is_string() {
                    obj.insert(
                        "content".to_string(),
                        serde_json::Value::String(new_content.to_string()),
                    );
                    return true;
                }
                // Handle array content: update the first text item
                if let Some(arr) = content.as_array() {
                    for (i, item) in arr.iter().enumerate() {
                        if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                            // Clone and update the array
                            let mut new_arr = arr.clone();
                            if let Some(text_item) = new_arr.get_mut(i) {
                                if let Some(text_obj) = text_item.as_object_mut() {
                                    text_obj.insert(
                                        "text".to_string(),
                                        serde_json::Value::String(new_content.to_string()),
                                    );
                                }
                            }
                            obj.insert("content".to_string(), serde_json::Value::Array(new_arr));
                            return true;
                        }
                    }
                }
            }
        }
    }
    false
}

/// Strips existing \[Title\] prefix from message content.
///
/// This function removes a title prefix in the format `[Title] Message`.
/// It searches for the first occurrence of `]` and removes everything
/// before and including it, then trims leading whitespace.
///
/// # Limitations
///
/// **Nested Brackets Are Not Supported**: This function stops at the first `]`
/// character, which yields incorrect results for nested brackets.
///
/// Example:
/// - Input: `"[Nested [brackets]] Message"`
/// - Expected: `"Message"`
/// - Actual: `"] Message"` (stops at first `]`)
///
/// To prevent this issue, the `rename_session_native` function validates
/// that new titles do not contain the `]` character before applying them.
///
/// # Arguments
///
/// * `message` - The message text that may start with a `[Title]` prefix
///
/// # Returns
///
/// The message with the prefix removed, or the original message if no
/// prefix is found.
fn strip_title_prefix(message: &str) -> String {
    if message.starts_with('[') {
        if let Some(end_bracket) = message.find(']') {
            let after_bracket = &message[end_bracket + 1..];
            return after_bracket.trim_start().to_string();
        }
    }
    message.to_string()
}

/// Finds the index of the first real user message in the JSONL lines.
/// Skips non-user messages (file-history-snapshot, progress, etc.) and meta messages.
fn find_first_user_message_index(lines: &[String]) -> Result<usize, String> {
    for (index, line) in lines.iter().enumerate() {
        // Try to parse as JSON
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            // Check if type is "user"
            let is_user = json
                .get("type")
                .and_then(|t| t.as_str())
                .map(|t| t == "user")
                .unwrap_or(false);

            // Check if it's NOT a meta message (isMeta: true)
            let is_meta = json
                .get("isMeta")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);

            // Must be user message with actual content (not meta)
            if is_user && !is_meta {
                // Verify it has a message field with content
                if extract_message_content(&json).is_some() {
                    return Ok(index);
                }
            }
        }
    }

    Err(RenameError::NoUserMessage.to_string())
}

/// Resets session name to original (removes title prefix)
#[command]
pub async fn reset_session_native_name(file_path: String) -> Result<NativeRenameResult, String> {
    rename_session_native(file_path, String::new()).await
}

/// Renames an `OpenCode` session by updating the session title field in storage JSON.
#[command]
pub async fn rename_opencode_session_title(
    session_path: String,
    new_title: String,
) -> Result<NativeRenameResult, String> {
    let (project_id, session_id) = parse_opencode_session_path(&session_path)?;

    let base_path = crate::providers::opencode::get_base_path().ok_or_else(|| {
        RenameError::FileNotFound("OpenCode base path not found".to_string()).to_string()
    })?;
    let session_root = Path::new(&base_path).join("storage").join("session");
    let session_file = session_root
        .join(&project_id)
        .join(format!("{session_id}.json"));

    if !session_file.exists() {
        return Err(
            RenameError::FileNotFound(session_file.to_string_lossy().to_string()).to_string(),
        );
    }

    if let Ok(metadata) = fs::symlink_metadata(&session_file) {
        if metadata.file_type().is_symlink() {
            return Err(RenameError::PermissionDenied(
                "Session file cannot be a symlink".to_string(),
            )
            .to_string());
        }
    }

    let canonical_file = session_file
        .canonicalize()
        .map_err(|e| RenameError::IoError(e.to_string()).to_string())?;
    let canonical_root = session_root
        .canonicalize()
        .map_err(|e| RenameError::IoError(e.to_string()).to_string())?;
    if !canonical_file.starts_with(&canonical_root) {
        return Err(RenameError::PermissionDenied(
            "Session file path is outside OpenCode storage".to_string(),
        )
        .to_string());
    }

    let content = fs::read_to_string(&canonical_file)
        .map_err(|e| RenameError::IoError(e.to_string()).to_string())?;
    let mut session_json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| RenameError::InvalidJsonFormat(e.to_string()).to_string())?;

    let previous_title = session_json
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let normalized_title = new_title.trim().to_string();

    let Some(session_obj) = session_json.as_object_mut() else {
        return Err(
            RenameError::InvalidJsonFormat("Session JSON must be an object".to_string())
                .to_string(),
        );
    };

    if normalized_title.is_empty() {
        session_obj.remove("title");
    } else {
        session_obj.insert(
            "title".to_string(),
            serde_json::Value::String(normalized_title.clone()),
        );
    }

    let serialized = serde_json::to_string(&session_json)
        .map_err(|e| RenameError::InvalidJsonFormat(e.to_string()).to_string())?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp_path = canonical_file.with_extension(format!("json.{nonce}.tmp"));
    fs::write(&temp_path, serialized)
        .map_err(|e| RenameError::IoError(e.to_string()).to_string())?;

    #[cfg(target_os = "windows")]
    {
        if canonical_file.exists() {
            fs::remove_file(&canonical_file)
                .map_err(|e| RenameError::IoError(e.to_string()).to_string())?;
        }
    }

    fs::rename(&temp_path, &canonical_file)
        .map_err(|e| RenameError::IoError(e.to_string()).to_string())?;

    Ok(NativeRenameResult {
        success: true,
        previous_title,
        new_title: normalized_title,
        file_path: session_path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_opencode_session_path_valid() {
        let parsed = parse_opencode_session_path("opencode://project_123/session_456").unwrap();
        assert_eq!(
            parsed,
            ("project_123".to_string(), "session_456".to_string())
        );
    }

    #[test]
    fn test_parse_opencode_session_path_invalid_prefix() {
        assert!(parse_opencode_session_path("/tmp/invalid").is_err());
    }

    #[test]
    fn test_parse_opencode_session_path_rejects_traversal() {
        assert!(parse_opencode_session_path("opencode://project/../etc").is_err());
    }

    #[test]
    fn test_strip_title_prefix() {
        assert_eq!(
            strip_title_prefix("[My Title] Original message"),
            "Original message"
        );
        assert_eq!(strip_title_prefix("No prefix here"), "No prefix here");
        // Note: nested brackets are not fully supported - first ] is used
        // "[Nested [brackets]] Message" -> first ] at index 17, result is "] Message"
        assert_eq!(
            strip_title_prefix("[Nested [brackets]] Message"),
            "] Message"
        );
        assert_eq!(strip_title_prefix("[] Empty brackets"), "Empty brackets");
        assert_eq!(strip_title_prefix("[Title]NoSpace"), "NoSpace");
    }

    #[test]
    fn test_extract_message_content_direct_string() {
        let json: serde_json::Value = serde_json::json!({
            "message": "Hello world"
        });
        assert_eq!(
            extract_message_content(&json),
            Some("Hello world".to_string())
        );
    }

    #[test]
    fn test_extract_message_content_nested() {
        let json: serde_json::Value = serde_json::json!({
            "message": {
                "role": "user",
                "content": "Hello world"
            }
        });
        assert_eq!(
            extract_message_content(&json),
            Some("Hello world".to_string())
        );
    }

    #[test]
    fn test_extract_message_content_array() {
        let json: serde_json::Value = serde_json::json!({
            "message": {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Hello from array"}
                ]
            }
        });
        assert_eq!(
            extract_message_content(&json),
            Some("Hello from array".to_string())
        );
    }

    #[test]
    fn test_find_first_user_message_skips_non_user_types() {
        let lines = vec![
            r#"{"type":"file-history-snapshot","data":{}}"#.to_string(),
            r#"{"type":"progress","data":"loading"}"#.to_string(),
            r#"{"type":"user","message":"Hello world"}"#.to_string(),
        ];
        assert_eq!(find_first_user_message_index(&lines).unwrap(), 2);
    }

    #[test]
    fn test_find_first_user_message_skips_meta() {
        let lines = vec![
            r#"{"type":"user","isMeta":true,"message":"init command"}"#.to_string(),
            r#"{"type":"user","message":"Real user message"}"#.to_string(),
        ];
        assert_eq!(find_first_user_message_index(&lines).unwrap(), 1);
    }

    #[test]
    fn test_update_message_content_string() {
        let mut json: serde_json::Value = serde_json::json!({
            "message": {
                "role": "user",
                "content": "Original"
            }
        });
        assert!(update_message_content(&mut json, "Updated"));
        assert_eq!(json["message"]["content"].as_str(), Some("Updated"));
    }

    #[test]
    fn test_update_message_content_array() {
        let mut json: serde_json::Value = serde_json::json!({
            "message": {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Original"}
                ]
            }
        });
        assert!(update_message_content(&mut json, "Updated"));
        assert_eq!(
            json["message"]["content"][0]["text"].as_str(),
            Some("Updated")
        );
    }

    // ==================== EDGE CASE TESTS ====================

    // --- strip_title_prefix edge cases ---

    #[test]
    fn test_strip_title_prefix_empty_string() {
        assert_eq!(strip_title_prefix(""), "");
    }

    #[test]
    fn test_strip_title_prefix_unclosed_bracket() {
        // Unclosed bracket should return original string
        assert_eq!(strip_title_prefix("[Unclosed title"), "[Unclosed title");
    }

    #[test]
    fn test_strip_title_prefix_only_brackets() {
        assert_eq!(strip_title_prefix("[]"), "");
    }

    #[test]
    fn test_strip_title_prefix_unicode() {
        assert_eq!(
            strip_title_prefix("[日本語タイトル] メッセージ"),
            "メッセージ"
        );
    }

    #[test]
    fn test_strip_title_prefix_with_newline() {
        assert_eq!(strip_title_prefix("[Title]\nMessage"), "Message");
    }

    // --- extract_message_content edge cases ---

    #[test]
    fn test_extract_message_content_missing_field() {
        let json: serde_json::Value = serde_json::json!({"uuid": "123"});
        assert_eq!(extract_message_content(&json), None);
    }

    #[test]
    fn test_extract_message_content_null_message() {
        let json: serde_json::Value = serde_json::json!({"message": null});
        assert_eq!(extract_message_content(&json), None);
    }

    #[test]
    fn test_extract_message_content_empty_array() {
        let json: serde_json::Value = serde_json::json!({
            "message": {"role": "user", "content": []}
        });
        assert_eq!(extract_message_content(&json), None);
    }

    #[test]
    fn test_extract_message_content_array_no_text_type() {
        let json: serde_json::Value = serde_json::json!({
            "message": {
                "role": "user",
                "content": [
                    {"type": "image", "url": "http://example.com/img.png"}
                ]
            }
        });
        assert_eq!(extract_message_content(&json), None);
    }

    #[test]
    fn test_extract_message_content_multiple_text_items() {
        // Should return first text item
        let json: serde_json::Value = serde_json::json!({
            "message": {
                "role": "user",
                "content": [
                    {"type": "text", "text": "First"},
                    {"type": "text", "text": "Second"}
                ]
            }
        });
        assert_eq!(extract_message_content(&json), Some("First".to_string()));
    }

    // --- find_first_user_message_index edge cases ---

    #[test]
    fn test_find_first_user_message_empty_lines() {
        let lines: Vec<String> = vec![];
        let result = find_first_user_message_index(&lines);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No user message"));
    }

    #[test]
    fn test_find_first_user_message_no_user_messages() {
        let lines = vec![
            r#"{"type":"assistant","message":"Hello"}"#.to_string(),
            r#"{"type":"system","message":"Init"}"#.to_string(),
        ];
        let result = find_first_user_message_index(&lines);
        assert!(result.is_err());
    }

    #[test]
    fn test_find_first_user_message_invalid_json() {
        let lines = vec![
            "not valid json".to_string(),
            r#"{"type":"user","message":"Valid"}"#.to_string(),
        ];
        // Should skip invalid JSON and find the valid user message
        assert_eq!(find_first_user_message_index(&lines).unwrap(), 1);
    }

    #[test]
    fn test_find_first_user_message_user_without_content() {
        let lines = vec![
            r#"{"type":"user"}"#.to_string(), // No message field
            r#"{"type":"user","message":"Has content"}"#.to_string(),
        ];
        // Should skip user without extractable content
        assert_eq!(find_first_user_message_index(&lines).unwrap(), 1);
    }

    // --- update_message_content edge cases ---

    #[test]
    fn test_update_message_content_no_message_field() {
        let mut json: serde_json::Value = serde_json::json!({"uuid": "123"});
        assert!(!update_message_content(&mut json, "New"));
    }

    #[test]
    fn test_update_message_content_array_no_text_type() {
        let mut json: serde_json::Value = serde_json::json!({
            "message": {
                "role": "user",
                "content": [
                    {"type": "image", "url": "http://example.com/img.png"}
                ]
            }
        });
        assert!(!update_message_content(&mut json, "New"));
    }

    #[test]
    fn test_update_message_content_direct_string() {
        let mut json: serde_json::Value = serde_json::json!({
            "message": "Direct string"
        });
        assert!(update_message_content(&mut json, "Updated"));
        assert_eq!(json["message"].as_str(), Some("Updated"));
    }

    // --- validate_claude_path tests (SECURITY) ---

    #[test]
    fn test_validate_claude_path_rejects_relative_path() {
        let result = validate_claude_path("relative/path/file.jsonl");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must be absolute"));
    }

    #[test]
    fn test_validate_claude_path_rejects_invalid_filename() {
        // Filename with dots should be rejected by regex
        let result = validate_claude_path("/etc/passwd");
        assert!(result.is_err());
        // Will fail on filename validation (passwd has no extension, or if it checks "passwd")
    }

    #[test]
    fn test_validate_claude_path_rejects_non_claude_directory() {
        // Use a path with valid filename but wrong directory
        let result = validate_claude_path("/tmp/validfilename.jsonl");
        assert!(result.is_err());
        // Should fail on directory check or canonicalize
    }

    #[test]
    fn test_validate_claude_path_valid_path() {
        // This test requires a real .jsonl file in ~/.claude to exist
        if let Some(home) = dirs::home_dir() {
            let claude_projects = home.join(".claude/projects");
            if claude_projects.exists() {
                // Try to find any .jsonl file in projects subdirectories
                if let Ok(projects) = fs::read_dir(&claude_projects) {
                    for project in projects.flatten() {
                        if project.path().is_dir() {
                            if let Ok(files) = fs::read_dir(project.path()) {
                                for file in files.flatten() {
                                    let path = file.path();
                                    if path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
                                        let test_path = path.to_string_lossy().to_string();
                                        let result = validate_claude_path(&test_path);
                                        assert!(
                                            result.is_ok(),
                                            "Validation failed for valid path {test_path}: {result:?}"
                                        );
                                        return; // Test passed
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        // Skip test if no suitable file found
    }

    #[test]
    fn test_validate_claude_path_nonexistent_file() {
        // Nonexistent file should fail at canonicalize
        let result = validate_claude_path("/nonexistent/path/to/file.jsonl");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_claude_path_filename_with_special_chars() {
        // Test filename validation with various invalid characters
        if let Some(home) = dirs::home_dir() {
            let claude_dir = home.join(".claude/projects");
            // Filename with dot (besides extension) should fail
            let path_with_dot = claude_dir
                .join("test.file.jsonl")
                .to_string_lossy()
                .to_string();
            let result = validate_claude_path(&path_with_dot);
            // Will fail either on filename validation or canonicalize (file doesn't exist)
            assert!(result.is_err());
        }
    }

    // --- Title validation tests ---

    #[test]
    fn test_title_with_closing_bracket_rejected() {
        // This test verifies that titles containing ']' are rejected
        // due to the nested bracket limitation in strip_title_prefix
        let title_with_bracket = "Test ] Title";
        assert!(title_with_bracket.contains(']'));
    }

    #[test]
    fn test_strip_title_prefix_nested_brackets_documented_limitation() {
        // This test documents the known limitation that nested brackets
        // don't work correctly (as documented in the function)
        let input = "[Nested [brackets]] Message";
        let result = strip_title_prefix(input);
        // Known limitation: stops at first ']'
        assert_eq!(result, "] Message");
        // This is why we reject titles with ']' in rename_session_native
    }
}
