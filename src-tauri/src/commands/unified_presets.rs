//! Tauri commands for unified preset management
//!
//! Unified presets combine settings.json content and MCP server config
//! into a single preset for complete configuration backup/restore.
//!
//! Storage: ~/.claude-history-viewer/unified-presets/*.json

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use uuid::Uuid;

// ============================================================================
// Types
// ============================================================================

/// Summary metadata for UI display
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedPresetSummary {
    pub settings_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub mcp_server_count: usize,
    pub mcp_server_names: Vec<String>,
    pub has_permissions: bool,
    pub has_hooks: bool,
    pub has_env_vars: bool,
}

/// Unified preset data structure
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedPresetData {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,

    // Content as JSON strings
    pub settings: String,
    pub mcp_servers: String,

    // Summary for display
    pub summary: UnifiedPresetSummary,
}

/// Input for creating/updating unified presets
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedPresetInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub settings: String,
    pub mcp_servers: String,
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Get the unified presets folder path
fn get_presets_folder() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    Ok(home.join(".claude-history-viewer").join("unified-presets"))
}

/// Ensure the presets folder exists
fn ensure_presets_folder() -> Result<PathBuf, String> {
    let folder = get_presets_folder()?;
    if !folder.exists() {
        fs::create_dir_all(&folder)
            .map_err(|e| format!("Failed to create unified presets folder: {e}"))?;
    }
    Ok(folder)
}

/// Validate preset ID to prevent path traversal attacks
fn validate_preset_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("Preset ID cannot be empty".to_string());
    }
    if id.len() > 64 {
        return Err("Preset ID too long (max 64 characters)".to_string());
    }
    if !id.chars().all(|c| c.is_alphanumeric() || c == '-') {
        return Err("Preset ID must contain only alphanumeric characters and hyphens".to_string());
    }
    Ok(())
}

/// Get path to a preset file
fn get_preset_path(id: &str) -> Result<PathBuf, String> {
    validate_preset_id(id)?;
    let folder = get_presets_folder()?;
    Ok(folder.join(format!("{id}.json")))
}

/// Check if a path is safe to operate on (not a symlink, is a regular file if exists)
/// Returns Ok(true) if file exists and is safe, Ok(false) if file doesn't exist, Err if unsafe
fn validate_path_safety(path: &PathBuf) -> Result<bool, String> {
    // Use symlink_metadata to not follow symlinks
    match std::fs::symlink_metadata(path) {
        Ok(metadata) => {
            let file_type = metadata.file_type();
            if file_type.is_symlink() {
                return Err("Refusing to operate on symlink".to_string());
            }
            if !file_type.is_file() {
                return Err("Path is not a regular file".to_string());
            }
            Ok(true)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(format!("Failed to check path safety: {e}")),
    }
}

/// Validate that the input JSON strings are valid JSON objects
fn validate_preset_input(input: &UnifiedPresetInput) -> Result<(), String> {
    // Validate settings is a valid JSON object
    let settings: serde_json::Value =
        serde_json::from_str(&input.settings).map_err(|e| format!("Invalid settings JSON: {e}"))?;
    if !settings.is_object() {
        return Err("Settings must be a JSON object".to_string());
    }

    // Validate mcp_servers is a valid JSON object
    let mcp_servers: serde_json::Value = serde_json::from_str(&input.mcp_servers)
        .map_err(|e| format!("Invalid mcp_servers JSON: {e}"))?;
    if !mcp_servers.is_object() {
        return Err("MCP servers must be a JSON object".to_string());
    }

    Ok(())
}

/// Write file atomically using temp file + rename pattern
fn atomic_write(path: &PathBuf, content: &str) -> Result<(), String> {
    let temp_path = path.with_extension("json.tmp");

    // Write to temp file
    let mut file =
        fs::File::create(&temp_path).map_err(|e| format!("Failed to create temp file: {e}"))?;

    file.write_all(content.as_bytes()).map_err(|e| {
        // Clean up temp file on write failure
        let _ = fs::remove_file(&temp_path);
        format!("Failed to write temp file: {e}")
    })?;

    // Flush and sync to ensure data is on disk
    file.sync_all().map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        format!("Failed to sync temp file: {e}")
    })?;

    // Drop the file handle before renaming
    drop(file);

    // Cross-platform atomic rename
    super::fs_utils::atomic_rename(&temp_path, path)?;

    Ok(())
}

/// Compute summary from settings and MCP servers JSON
fn compute_summary(settings_json: &str, mcp_json: &str) -> UnifiedPresetSummary {
    // Parse settings for summary
    let settings: serde_json::Value = serde_json::from_str(settings_json).unwrap_or_default();
    let mcp: serde_json::Value = serde_json::from_str(mcp_json).unwrap_or_default();

    // Count settings fields
    let mut settings_count = 0;
    if settings.get("model").is_some() {
        settings_count += 1;
    }
    if settings.get("language").is_some() {
        settings_count += 1;
    }
    if settings.get("permissions").is_some() {
        settings_count += 1;
    }
    if settings.get("hooks").is_some() {
        settings_count += 1;
    }
    if settings.get("env").is_some() {
        settings_count += 1;
    }
    if settings.get("alwaysThinkingEnabled").is_some() {
        settings_count += 1;
    }
    if settings.get("autoUpdatesChannel").is_some() {
        settings_count += 1;
    }
    if settings.get("attribution").is_some() {
        settings_count += 1;
    }

    // Extract model
    let model = settings
        .get("model")
        .and_then(|v| v.as_str())
        .map(str::to_string);

    // Count MCP servers
    let mcp_server_names: Vec<String> = mcp
        .as_object()
        .map(|obj| obj.keys().take(5).cloned().collect())
        .unwrap_or_default();
    let mcp_server_count = mcp.as_object().map(serde_json::Map::len).unwrap_or(0);

    // Check for permissions
    let has_permissions = settings
        .get("permissions")
        .and_then(|p| p.as_object())
        .map(|p| {
            p.get("allow")
                .and_then(|v| v.as_array())
                .map(|a| !a.is_empty())
                .unwrap_or(false)
                || p.get("deny")
                    .and_then(|v| v.as_array())
                    .map(|a| !a.is_empty())
                    .unwrap_or(false)
                || p.get("ask")
                    .and_then(|v| v.as_array())
                    .map(|a| !a.is_empty())
                    .unwrap_or(false)
        })
        .unwrap_or(false);

    // Check for hooks
    let has_hooks = settings
        .get("hooks")
        .and_then(|h| h.as_object())
        .map(|h| !h.is_empty())
        .unwrap_or(false);

    // Check for env vars
    let has_env_vars = settings
        .get("env")
        .and_then(|e| e.as_object())
        .map(|e| !e.is_empty())
        .unwrap_or(false);

    UnifiedPresetSummary {
        settings_count,
        model,
        mcp_server_count,
        mcp_server_names,
        has_permissions,
        has_hooks,
        has_env_vars,
    }
}

// ============================================================================
// Commands
// ============================================================================

/// Load all unified presets
#[tauri::command]
pub async fn load_unified_presets() -> Result<Vec<UnifiedPresetData>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let folder = match get_presets_folder() {
            Ok(f) => f,
            Err(_) => return Ok(vec![]), // No presets folder = no presets
        };

        if !folder.exists() {
            return Ok(vec![]);
        }

        let mut presets = Vec::new();

        let entries =
            fs::read_dir(&folder).map_err(|e| format!("Failed to read presets folder: {e}"))?;

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                // Skip symlinks and non-regular files for security
                if validate_path_safety(&path).unwrap_or(false) {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Ok(preset) = serde_json::from_str::<UnifiedPresetData>(&content) {
                            presets.push(preset);
                        }
                    }
                }
            }
        }

        // Sort by updated_at descending
        presets.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

        Ok(presets)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

/// Save a unified preset (create or update)
#[tauri::command]
pub async fn save_unified_preset(input: UnifiedPresetInput) -> Result<UnifiedPresetData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_presets_folder()?;

        // Validate input JSON before any other operations
        validate_preset_input(&input)?;

        let now = chrono::Utc::now().to_rfc3339();
        let summary = compute_summary(&input.settings, &input.mcp_servers);

        let preset = if let Some(id) = &input.id {
            // Update existing
            let path = get_preset_path(id)?;

            // Check path safety (symlink protection)
            if !validate_path_safety(&path)? {
                return Err("Preset not found".to_string());
            }

            let content =
                fs::read_to_string(&path).map_err(|e| format!("Failed to read preset: {e}"))?;
            let existing: UnifiedPresetData = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse preset: {e}"))?;

            UnifiedPresetData {
                id: id.clone(),
                name: input.name,
                description: input.description,
                created_at: existing.created_at,
                updated_at: now,
                settings: input.settings,
                mcp_servers: input.mcp_servers,
                summary,
            }
        } else {
            // Create new
            UnifiedPresetData {
                id: Uuid::new_v4().to_string(),
                name: input.name,
                description: input.description,
                created_at: now.clone(),
                updated_at: now,
                settings: input.settings,
                mcp_servers: input.mcp_servers,
                summary,
            }
        };

        // Write to file atomically
        let path = get_preset_path(&preset.id)?;
        let json = serde_json::to_string_pretty(&preset)
            .map_err(|e| format!("Failed to serialize preset: {e}"))?;

        atomic_write(&path, &json)?;

        Ok(preset)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

/// Delete a unified preset
#[tauri::command]
pub async fn delete_unified_preset(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_preset_id(&id)?;
        let path = get_preset_path(&id)?;

        // Check path safety before deletion (symlink protection)
        if validate_path_safety(&path)? {
            fs::remove_file(&path).map_err(|e| format!("Failed to delete preset: {e}"))?;
        }
        // If validate_path_safety returns Ok(false), file doesn't exist - nothing to delete

        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

/// Get a single unified preset by ID
#[tauri::command]
pub async fn get_unified_preset(id: String) -> Result<Option<UnifiedPresetData>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_preset_id(&id)?;
        let path = get_preset_path(&id)?;

        // Check path safety before reading (symlink protection)
        if !validate_path_safety(&path)? {
            return Ok(None);
        }

        let content =
            fs::read_to_string(&path).map_err(|e| format!("Failed to read preset: {e}"))?;

        let preset: UnifiedPresetData =
            serde_json::from_str(&content).map_err(|e| format!("Failed to parse preset: {e}"))?;

        Ok(Some(preset))
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_summary() {
        let settings = r#"{"model":"opus","hooks":{"UserPromptSubmit":[]}}"#;
        let mcp = r#"{"server1":{"command":"test"},"server2":{"command":"test2"}}"#;

        let summary = compute_summary(settings, mcp);

        assert_eq!(summary.model, Some("opus".to_string()));
        assert_eq!(summary.mcp_server_count, 2);
        assert!(summary.mcp_server_names.contains(&"server1".to_string()));
    }

    #[test]
    fn test_validate_preset_input_valid() {
        let input = UnifiedPresetInput {
            id: None,
            name: "Test".to_string(),
            description: None,
            settings: r#"{"model":"opus"}"#.to_string(),
            mcp_servers: r#"{"server1":{"command":"test"}}"#.to_string(),
        };
        assert!(validate_preset_input(&input).is_ok());
    }

    #[test]
    fn test_validate_preset_input_invalid_settings() {
        let input = UnifiedPresetInput {
            id: None,
            name: "Test".to_string(),
            description: None,
            settings: "not valid json".to_string(),
            mcp_servers: "{}".to_string(),
        };
        let result = validate_preset_input(&input);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid settings JSON"));
    }

    #[test]
    fn test_validate_preset_input_settings_not_object() {
        let input = UnifiedPresetInput {
            id: None,
            name: "Test".to_string(),
            description: None,
            settings: r#"["array", "not", "object"]"#.to_string(),
            mcp_servers: "{}".to_string(),
        };
        let result = validate_preset_input(&input);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must be a JSON object"));
    }

    #[test]
    fn test_validate_preset_input_invalid_mcp() {
        let input = UnifiedPresetInput {
            id: None,
            name: "Test".to_string(),
            description: None,
            settings: "{}".to_string(),
            mcp_servers: "{invalid json".to_string(),
        };
        let result = validate_preset_input(&input);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid mcp_servers JSON"));
    }

    #[test]
    fn test_validate_path_safety_nonexistent() {
        let path = PathBuf::from("/nonexistent/path/to/file.json");
        let result = validate_path_safety(&path);
        assert!(result.is_ok());
        assert!(!result.unwrap()); // Returns false for nonexistent
    }
}
