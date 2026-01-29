//! Tauri commands for settings preset management
//!
//! This module provides commands for saving, loading, and managing
//! user settings presets stored in ~/.claude-history-viewer/presets/

use crate::models::UserSettings;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tempfile::Builder;
use uuid::Uuid;

/// Data structure for a settings preset
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetData {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub settings: String,   // JSON string of UserSettings
    pub created_at: String, // ISO 8601 timestamp
    pub updated_at: String,
}

/// Input structure for creating/updating presets
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>, // Auto-generate if not provided
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub settings: String, // JSON string of UserSettings
}

/// Get the presets folder path (~/.claude-history-viewer/presets)
fn get_presets_folder() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    Ok(home.join(".claude-history-viewer").join("presets"))
}

/// Ensure the presets folder exists and is a directory
fn ensure_presets_folder() -> Result<PathBuf, String> {
    let folder = get_presets_folder()?;
    if folder.exists() {
        if !folder.is_dir() {
            return Err(format!(
                "Presets path exists but is not a directory: {}",
                folder.display()
            ));
        }
    } else {
        fs::create_dir_all(&folder).map_err(|e| format!("Failed to create presets folder: {e}"))?;
    }
    Ok(folder)
}

/// Validate that a preset ID contains only safe characters
fn validate_preset_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("Preset ID must not be empty".to_string());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!(
            "Invalid preset ID '{id}': only ASCII letters, digits, '-' and '_' are allowed"
        ));
    }
    Ok(())
}

/// Get the path to a preset file
fn get_preset_path(id: &str) -> Result<PathBuf, String> {
    validate_preset_id(id)?;
    let folder = get_presets_folder()?;
    Ok(folder.join(format!("{id}.json")))
}

/// Validate that the settings JSON is parseable
fn validate_settings_json(settings_json: &str) -> Result<(), String> {
    serde_json::from_str::<UserSettings>(settings_json)
        .map_err(|e| format!("Invalid settings JSON: {e}"))?;
    Ok(())
}

/// Save a preset to disk with atomic write
#[tauri::command]
pub async fn save_preset(input: PresetInput) -> Result<PresetData, String> {
    // Validate settings JSON
    validate_settings_json(&input.settings)?;

    // Generate ID if not provided
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = Utc::now().to_rfc3339();

    // Check if preset already exists to preserve created_at
    let created_at = tauri::async_runtime::spawn_blocking({
        let id = id.clone();
        let now = now.clone();
        move || {
            let path = get_preset_path(&id)?;
            if path.exists() {
                let content = fs::read_to_string(&path)
                    .map_err(|e| format!("Failed to read existing preset: {e}"))?;
                let existing: PresetData = serde_json::from_str(&content)
                    .map_err(|e| format!("Failed to parse existing preset: {e}"))?;
                Ok::<String, String>(existing.created_at)
            } else {
                Ok(now)
            }
        }
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))??;

    let preset = PresetData {
        id: id.clone(),
        name: input.name,
        description: input.description,
        settings: input.settings,
        created_at,
        updated_at: now,
    };

    // Perform blocking file I/O
    let preset_clone = preset.clone();
    tauri::async_runtime::spawn_blocking(move || {
        ensure_presets_folder()?;
        let path = get_preset_path(&preset_clone.id)?;

        // Write to temp file first (atomic write pattern)
        let content = serde_json::to_string_pretty(&preset_clone)
            .map_err(|e| format!("Failed to serialize preset: {e}"))?;

        let dir = path
            .parent()
            .ok_or_else(|| "Failed to get parent directory".to_string())?;
        let mut tmp_file = Builder::new()
            .prefix(".preset-")
            .suffix(".tmp")
            .tempfile_in(dir)
            .map_err(|e| format!("Failed to create temp file: {e}"))?;

        tmp_file
            .write_all(content.as_bytes())
            .map_err(|e| format!("Failed to write temp file: {e}"))?;
        tmp_file
            .as_file()
            .sync_all()
            .map_err(|e| format!("Failed to sync temp file: {e}"))?;

        let temp_path = tmp_file.into_temp_path();
        // Cross-platform atomic rename
        super::fs_utils::atomic_rename(&temp_path, &path)?;

        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))??;

    Ok(preset)
}

/// Load all presets from disk
#[tauri::command]
pub async fn load_presets() -> Result<Vec<PresetData>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let folder = get_presets_folder()?;

        // Return empty vec if folder doesn't exist yet
        if !folder.exists() {
            return Ok(Vec::new());
        }

        let mut presets = Vec::new();
        let entries =
            fs::read_dir(&folder).map_err(|e| format!("Failed to read presets folder: {e}"))?;

        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read directory entry: {e}"))?;
            let path = entry.path();

            // Skip non-JSON files and temp files
            if !path.extension().is_some_and(|ext| ext == "json") {
                continue;
            }

            let content = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Warning: Failed to read preset at {}: {e}", path.display());
                    continue;
                }
            };

            match serde_json::from_str::<PresetData>(&content) {
                Ok(preset) => presets.push(preset),
                Err(e) => {
                    eprintln!("Warning: Failed to parse preset at {}: {e}", path.display());
                }
            }
        }

        // Sort by name for consistent ordering
        presets.sort_by(|a, b| a.name.cmp(&b.name));

        Ok(presets)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Load a single preset by ID
#[tauri::command]
pub async fn get_preset(id: String) -> Result<Option<PresetData>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = get_preset_path(&id)?;

        if !path.exists() {
            return Ok(None);
        }

        let content =
            fs::read_to_string(&path).map_err(|e| format!("Failed to read preset: {e}"))?;

        let preset: PresetData =
            serde_json::from_str(&content).map_err(|e| format!("Failed to parse preset: {e}"))?;

        Ok(Some(preset))
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Delete a preset by ID
#[tauri::command]
pub async fn delete_preset(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = get_preset_path(&id)?;

        if !path.exists() {
            return Err(format!("Preset not found: {id}"));
        }

        fs::remove_file(&path).map_err(|e| format!("Failed to delete preset: {e}"))?;

        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::sync::{LazyLock, Mutex, MutexGuard};
    use tempfile::TempDir;

    /// Static mutex to serialize tests that modify the HOME environment variable
    static TEST_ENV_MUTEX: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    /// Sets up a test environment with a temporary HOME directory
    fn setup_test_env() -> (MutexGuard<'static, ()>, TempDir) {
        let guard = TEST_ENV_MUTEX.lock().unwrap();
        let temp_dir = TempDir::new().unwrap();
        env::set_var("HOME", temp_dir.path());
        (guard, temp_dir)
    }

    #[test]
    fn test_get_presets_folder() {
        let (_guard, _temp) = setup_test_env();
        let folder = get_presets_folder().unwrap();
        assert!(folder
            .to_string_lossy()
            .contains(".claude-history-viewer/presets"));
    }

    #[test]
    fn test_ensure_presets_folder() {
        let (_guard, _temp) = setup_test_env();
        let folder = ensure_presets_folder().unwrap();
        assert!(folder.exists());
    }

    #[test]
    fn test_validate_settings_json() {
        let valid_settings = r#"{"hiddenPatterns":[]}"#;
        assert!(validate_settings_json(valid_settings).is_ok());

        let invalid_settings = r#"{"invalid":}"#;
        assert!(validate_settings_json(invalid_settings).is_err());
    }

    #[tokio::test]
    async fn test_save_and_load_preset() {
        let (guard, temp) = setup_test_env();
        // Use a unique subdirectory to avoid race conditions with other tests
        let unique_home = temp.path().join("test_save_and_load_preset");
        fs::create_dir_all(&unique_home).unwrap();
        env::set_var("HOME", &unique_home);
        drop(guard); // Drop the guard before any await calls

        let input = PresetInput {
            id: Some("test-preset".to_string()),
            name: "Test Preset".to_string(),
            description: Some("A test preset".to_string()),
            settings: r#"{"hiddenPatterns":["test-*"]}"#.to_string(),
        };

        // Save preset
        let saved = save_preset(input).await.unwrap();
        assert_eq!(saved.id, "test-preset");
        assert_eq!(saved.name, "Test Preset");

        // Load preset
        let loaded = get_preset("test-preset".to_string()).await.unwrap();
        assert!(loaded.is_some());
        let loaded = loaded.unwrap();
        assert_eq!(loaded.id, "test-preset");
        assert_eq!(loaded.name, "Test Preset");
    }

    #[tokio::test]
    async fn test_load_all_presets() {
        let (guard, _temp) = setup_test_env();
        drop(guard); // Drop the guard before any await calls

        // Create multiple presets
        for i in 1..=3 {
            let input = PresetInput {
                id: Some(format!("preset-{i}")),
                name: format!("Preset {i}"),
                description: None,
                settings: r#"{"hiddenPatterns":[]}"#.to_string(),
            };
            save_preset(input).await.unwrap();
        }

        // Load all
        let presets = load_presets().await.unwrap();
        assert_eq!(presets.len(), 3);
    }

    #[tokio::test]
    async fn test_delete_preset() {
        let (guard, _temp) = setup_test_env();
        drop(guard); // Drop the guard before any await calls

        let input = PresetInput {
            id: Some("to-delete".to_string()),
            name: "Delete Me".to_string(),
            description: None,
            settings: r#"{"hiddenPatterns":[]}"#.to_string(),
        };

        save_preset(input).await.unwrap();

        // Verify it exists
        let loaded = get_preset("to-delete".to_string()).await.unwrap();
        assert!(loaded.is_some());

        // Delete it
        delete_preset("to-delete".to_string()).await.unwrap();

        // Verify it's gone
        let loaded = get_preset("to-delete".to_string()).await.unwrap();
        assert!(loaded.is_none());
    }

    #[tokio::test]
    async fn test_auto_generate_id() {
        let (guard, _temp) = setup_test_env();
        drop(guard); // Drop the guard before any await calls

        let input = PresetInput {
            id: None, // No ID provided
            name: "Auto ID".to_string(),
            description: None,
            settings: r#"{"hiddenPatterns":[]}"#.to_string(),
        };

        let saved = save_preset(input).await.unwrap();
        assert!(!saved.id.is_empty());
        assert_ne!(saved.id, "Auto ID");
    }

    #[tokio::test]
    async fn test_update_preset_preserves_created_at() {
        let (guard, _temp) = setup_test_env();
        drop(guard); // Drop the guard before any await calls

        // Create initial preset
        let input1 = PresetInput {
            id: Some("update-test".to_string()),
            name: "Original".to_string(),
            description: None,
            settings: r#"{"hiddenPatterns":[]}"#.to_string(),
        };
        let saved1 = save_preset(input1).await.unwrap();
        let original_created_at = saved1.created_at.clone();

        // Wait a bit to ensure timestamps differ
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

        // Update preset
        let input2 = PresetInput {
            id: Some("update-test".to_string()),
            name: "Updated".to_string(),
            description: Some("Updated description".to_string()),
            settings: r#"{"hiddenPatterns":["new-*"]}"#.to_string(),
        };
        let saved2 = save_preset(input2).await.unwrap();

        // Verify created_at is preserved but updated_at changed
        assert_eq!(saved2.created_at, original_created_at);
        assert_ne!(saved2.updated_at, saved1.updated_at);
        assert_eq!(saved2.name, "Updated");
    }
}
