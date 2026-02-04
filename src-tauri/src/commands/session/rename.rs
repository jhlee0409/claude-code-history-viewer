//! Native session renaming module
//!
//! Provides functionality to rename Claude Code sessions by modifying
//! the first user message in the session JSONL file.

use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use tauri::command;

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
    InvalidJsonFormat(String),
    IoError(String),
    EmptySession,
    NoUserMessage,
    UnsupportedContentFormat,
}

impl std::fmt::Display for RenameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RenameError::FileNotFound(path) => write!(f, "Session file not found: {path}"),
            RenameError::PermissionDenied(path) => write!(f, "Permission denied: {path}"),
            RenameError::InvalidJsonFormat(msg) => write!(f, "Invalid JSON format: {msg}"),
            RenameError::IoError(msg) => write!(f, "I/O error: {msg}"),
            RenameError::EmptySession => write!(f, "Session file is empty"),
            RenameError::NoUserMessage => {
                write!(f, "No user message found in session")
            }
            RenameError::UnsupportedContentFormat => {
                write!(f, "Message content format not supported (array content)")
            }
        }
    }
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

    // 12. Write atomically (write to temp, then rename)
    let temp_path = format!("{file_path}.tmp");
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
fn validate_claude_path(file_path: &str) -> Result<(), String> {
    let file_path_buf = std::path::PathBuf::from(file_path);

    // Canonicalize to resolve symlinks and .. components
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

/// Strips existing [Title] prefix from message
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
