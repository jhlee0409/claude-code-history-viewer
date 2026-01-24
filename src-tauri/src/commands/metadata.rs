//! Tauri commands for user metadata management
//!
//! This module provides commands for loading, saving, and updating
//! user metadata stored in ~/.claude-history-viewer/user-data.json

use crate::models::{ProjectMetadata, SessionMetadata, UserMetadata, UserSettings};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// Application state for metadata management
pub struct MetadataState {
    /// Cached metadata with mutex for thread-safe access
    pub metadata: Mutex<Option<UserMetadata>>,
}

impl Default for MetadataState {
    fn default() -> Self {
        Self {
            metadata: Mutex::new(None),
        }
    }
}

/// Get the metadata folder path (~/.claude-history-viewer)
fn get_metadata_folder() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    Ok(home.join(".claude-history-viewer"))
}

/// Get the user data file path (~/.claude-history-viewer/user-data.json)
fn get_user_data_path() -> Result<PathBuf, String> {
    Ok(get_metadata_folder()?.join("user-data.json"))
}

/// Ensure the metadata folder exists
fn ensure_metadata_folder() -> Result<PathBuf, String> {
    let folder = get_metadata_folder()?;
    if !folder.exists() {
        fs::create_dir_all(&folder).map_err(|e| format!("Failed to create metadata folder: {}", e))?;
    }
    Ok(folder)
}

/// Get the metadata folder path
#[tauri::command]
pub fn get_metadata_folder_path() -> Result<String, String> {
    let path = get_metadata_folder()?;
    Ok(path.to_string_lossy().to_string())
}

/// Load user metadata from disk
/// Creates default metadata if file doesn't exist
#[tauri::command]
pub fn load_user_metadata(state: State<'_, MetadataState>) -> Result<UserMetadata, String> {
    let path = get_user_data_path()?;

    let metadata = if path.exists() {
        let content =
            fs::read_to_string(&path).map_err(|e| format!("Failed to read metadata file: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse metadata: {}", e))?
    } else {
        UserMetadata::new()
    };

    // Cache the metadata
    let mut cached = state
        .metadata
        .lock()
        .map_err(|e| format!("Failed to lock metadata: {}", e))?;
    *cached = Some(metadata.clone());

    Ok(metadata)
}

/// Save user metadata to disk with atomic write
#[tauri::command]
pub fn save_user_metadata(
    metadata: UserMetadata,
    state: State<'_, MetadataState>,
) -> Result<(), String> {
    ensure_metadata_folder()?;
    let path = get_user_data_path()?;

    // Write to temp file first (atomic write pattern)
    let temp_path = path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(&metadata)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;

    let mut file = fs::File::create(&temp_path)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write temp file: {}", e))?;
    file.sync_all()
        .map_err(|e| format!("Failed to sync temp file: {}", e))?;

    // Rename temp file to actual file (atomic on most filesystems)
    fs::rename(&temp_path, &path).map_err(|e| format!("Failed to rename temp file: {}", e))?;

    // Update cache
    let mut cached = state
        .metadata
        .lock()
        .map_err(|e| format!("Failed to lock metadata: {}", e))?;
    *cached = Some(metadata);

    Ok(())
}

/// Update metadata for a specific session
#[tauri::command]
pub fn update_session_metadata(
    session_id: String,
    update: SessionMetadata,
    state: State<'_, MetadataState>,
) -> Result<UserMetadata, String> {
    let mut cached = state
        .metadata
        .lock()
        .map_err(|e| format!("Failed to lock metadata: {}", e))?;

    let metadata = cached.get_or_insert_with(UserMetadata::new);

    // Update or insert session metadata
    if update.is_empty() {
        // Remove if empty
        metadata.sessions.remove(&session_id);
    } else {
        metadata.sessions.insert(session_id, update);
    }

    // Save to disk
    drop(cached); // Release lock before save
    let metadata = state
        .metadata
        .lock()
        .map_err(|e| format!("Failed to lock metadata: {}", e))?
        .clone()
        .unwrap_or_default();

    save_user_metadata(metadata.clone(), state)?;

    Ok(metadata)
}

/// Update metadata for a specific project
#[tauri::command]
pub fn update_project_metadata(
    project_path: String,
    update: ProjectMetadata,
    state: State<'_, MetadataState>,
) -> Result<UserMetadata, String> {
    let mut cached = state
        .metadata
        .lock()
        .map_err(|e| format!("Failed to lock metadata: {}", e))?;

    let metadata = cached.get_or_insert_with(UserMetadata::new);

    // Update or insert project metadata
    if update.is_empty() {
        // Remove if empty
        metadata.projects.remove(&project_path);
    } else {
        metadata.projects.insert(project_path, update);
    }

    // Save to disk
    drop(cached); // Release lock before save
    let metadata = state
        .metadata
        .lock()
        .map_err(|e| format!("Failed to lock metadata: {}", e))?
        .clone()
        .unwrap_or_default();

    save_user_metadata(metadata.clone(), state)?;

    Ok(metadata)
}

/// Update global user settings
#[tauri::command]
pub fn update_user_settings(
    settings: UserSettings,
    state: State<'_, MetadataState>,
) -> Result<UserMetadata, String> {
    let mut cached = state
        .metadata
        .lock()
        .map_err(|e| format!("Failed to lock metadata: {}", e))?;

    let metadata = cached.get_or_insert_with(UserMetadata::new);
    metadata.settings = settings;

    // Save to disk
    drop(cached); // Release lock before save
    let metadata = state
        .metadata
        .lock()
        .map_err(|e| format!("Failed to lock metadata: {}", e))?
        .clone()
        .unwrap_or_default();

    save_user_metadata(metadata.clone(), state)?;

    Ok(metadata)
}

/// Check if a project should be hidden based on metadata
#[tauri::command]
pub fn is_project_hidden(
    project_path: String,
    state: State<'_, MetadataState>,
) -> Result<bool, String> {
    let cached = state
        .metadata
        .lock()
        .map_err(|e| format!("Failed to lock metadata: {}", e))?;

    let is_hidden = cached
        .as_ref()
        .map(|m| m.is_project_hidden(&project_path))
        .unwrap_or(false);

    Ok(is_hidden)
}

/// Get the display name for a session (custom name or fallback to summary)
#[tauri::command]
pub fn get_session_display_name(
    session_id: String,
    fallback_summary: Option<String>,
    state: State<'_, MetadataState>,
) -> Result<Option<String>, String> {
    let cached = state
        .metadata
        .lock()
        .map_err(|e| format!("Failed to lock metadata: {}", e))?;

    let display_name = cached
        .as_ref()
        .and_then(|m| m.get_session(&session_id))
        .and_then(|s| s.custom_name.clone())
        .or(fallback_summary);

    Ok(display_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use tempfile::TempDir;

    fn setup_test_env() -> TempDir {
        let temp_dir = TempDir::new().unwrap();
        env::set_var("HOME", temp_dir.path());
        temp_dir
    }

    #[test]
    fn test_get_metadata_folder() {
        let _temp = setup_test_env();
        let folder = get_metadata_folder().unwrap();
        assert!(folder.to_string_lossy().contains(".claude-history-viewer"));
    }

    #[test]
    fn test_ensure_metadata_folder() {
        let _temp = setup_test_env();
        let folder = ensure_metadata_folder().unwrap();
        assert!(folder.exists());
    }

    #[test]
    fn test_atomic_write() {
        let temp = setup_test_env();

        // Manually create the metadata folder since HOME is mocked
        let metadata_folder = temp.path().join(".claude-history-viewer");
        fs::create_dir_all(&metadata_folder).unwrap();

        let metadata = UserMetadata::new();
        let path = metadata_folder.join("user-data.json");

        // Write metadata
        let content = serde_json::to_string_pretty(&metadata).unwrap();
        let temp_path = path.with_extension("json.tmp");

        let mut file = fs::File::create(&temp_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();
        file.sync_all().unwrap();
        fs::rename(&temp_path, &path).unwrap();

        // Verify
        assert!(path.exists());
        assert!(!temp_path.exists());

        let loaded_content = fs::read_to_string(&path).unwrap();
        let loaded: UserMetadata = serde_json::from_str(&loaded_content).unwrap();
        assert_eq!(loaded.version, metadata.version);

        drop(temp);
    }
}
