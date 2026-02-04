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

    // 2. Read all lines from JSONL file
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

    // 3. Find first user message (type: "user", not isMeta)
    let user_message_index = find_first_user_message_index(&lines)?;

    // 4. Parse the user message line as JSON
    let mut user_message: serde_json::Value = serde_json::from_str(&lines[user_message_index])
        .map_err(|e| RenameError::InvalidJsonFormat(e.to_string()).to_string())?;

    // 5. Extract current message content - handle nested structure
    let current_message = extract_message_content(&user_message).ok_or_else(|| {
        RenameError::InvalidJsonFormat("No 'message' field found".to_string()).to_string()
    })?;

    // 6. Strip existing bracket prefix if present
    let base_message = strip_title_prefix(&current_message);

    // 7. Construct new message with title prefix
    let new_message = if new_title.trim().is_empty() {
        base_message.clone()
    } else {
        format!("[{}] {}", new_title.trim(), base_message)
    };

    // 8. Update JSON object - handle nested structure
    update_message_content(&mut user_message, &new_message);

    // 9. Serialize back to JSON string
    lines[user_message_index] = serde_json::to_string(&user_message)
        .map_err(|e| RenameError::InvalidJsonFormat(e.to_string()).to_string())?;

    // 10. Write atomically (write to temp, then rename)
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

    // 10. Atomic rename (Windows compatibility: remove existing file first)
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

/// Extracts message content from JSON, handling both direct string and nested object formats
fn extract_message_content(json: &serde_json::Value) -> Option<String> {
    json.get("message").and_then(|m| {
        // Handle direct string: {"message": "text"}
        if let Some(s) = m.as_str() {
            return Some(s.to_string());
        }
        // Handle nested object: {"message": {"role": "user", "content": "text"}}
        if let Some(obj) = m.as_object() {
            if let Some(content) = obj.get("content") {
                // Content can be a string or an array
                if let Some(s) = content.as_str() {
                    return Some(s.to_string());
                }
            }
        }
        None
    })
}

/// Updates message content in JSON, handling both direct string and nested object formats
fn update_message_content(json: &mut serde_json::Value, new_content: &str) {
    if let Some(message) = json.get_mut("message") {
        // Handle direct string
        if message.is_string() {
            *message = serde_json::Value::String(new_content.to_string());
            return;
        }
        // Handle nested object
        if let Some(obj) = message.as_object_mut() {
            if obj.contains_key("content")
                && obj
                    .get("content")
                    .map(serde_json::Value::is_string)
                    .unwrap_or(false)
            {
                obj.insert(
                    "content".to_string(),
                    serde_json::Value::String(new_content.to_string()),
                );
            }
        }
    }
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
        assert_eq!(strip_title_prefix("[Nested [brackets]] Message"), "Message");
        assert_eq!(strip_title_prefix("[] Empty brackets"), "Empty brackets");
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
}
