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
}

impl std::fmt::Display for RenameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RenameError::FileNotFound(path) => write!(f, "Session file not found: {path}"),
            RenameError::PermissionDenied(path) => write!(f, "Permission denied: {path}"),
            RenameError::InvalidJsonFormat(msg) => write!(f, "Invalid JSON format: {msg}"),
            RenameError::IoError(msg) => write!(f, "I/O error: {msg}"),
            RenameError::EmptySession => write!(f, "Session file is empty"),
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

    // 3. Parse first line as JSON
    let mut first_message: serde_json::Value = serde_json::from_str(&lines[0])
        .map_err(|e| RenameError::InvalidJsonFormat(e.to_string()).to_string())?;

    // 4. Extract current message content - handle nested structure
    let current_message = extract_message_content(&first_message).ok_or_else(|| {
        RenameError::InvalidJsonFormat("No 'message' field found".to_string()).to_string()
    })?;

    // 5. Strip existing bracket prefix if present
    let base_message = strip_title_prefix(&current_message);

    // 6. Construct new message with title prefix
    let new_message = if new_title.trim().is_empty() {
        base_message.clone()
    } else {
        format!("[{}] {}", new_title.trim(), base_message)
    };

    // 7. Update JSON object - handle nested structure
    update_message_content(&mut first_message, &new_message);

    // 8. Serialize back to JSON string
    lines[0] = serde_json::to_string(&first_message)
        .map_err(|e| RenameError::InvalidJsonFormat(e.to_string()).to_string())?;

    // 9. Write atomically (write to temp, then rename)
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
