//! Session path helpers.

use tauri::command;

/// Resolve provider-specific session locators to a human-copyable file path.
#[command]
pub async fn resolve_session_file_path(file_path: String) -> Result<String, String> {
    if file_path.starts_with("opencode://") || file_path.starts_with("opencode+path://") {
        return crate::providers::opencode::resolve_session_file_path(&file_path);
    }

    Ok(file_path)
}
