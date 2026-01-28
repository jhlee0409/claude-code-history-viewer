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

/// Compute summary from settings and MCP servers JSON
fn compute_summary(settings_json: &str, mcp_json: &str) -> UnifiedPresetSummary {
    // Parse settings for summary
    let settings: serde_json::Value = serde_json::from_str(settings_json).unwrap_or_default();
    let mcp: serde_json::Value = serde_json::from_str(mcp_json).unwrap_or_default();

    // Count settings fields
    let mut settings_count = 0;
    if settings.get("model").is_some() { settings_count += 1; }
    if settings.get("language").is_some() { settings_count += 1; }
    if settings.get("permissions").is_some() { settings_count += 1; }
    if settings.get("hooks").is_some() { settings_count += 1; }
    if settings.get("env").is_some() { settings_count += 1; }
    if settings.get("alwaysThinkingEnabled").is_some() { settings_count += 1; }
    if settings.get("autoUpdatesChannel").is_some() { settings_count += 1; }
    if settings.get("attribution").is_some() { settings_count += 1; }

    // Extract model
    let model = settings.get("model")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Count MCP servers
    let mcp_server_names: Vec<String> = mcp.as_object()
        .map(|obj| obj.keys().take(5).cloned().collect())
        .unwrap_or_default();
    let mcp_server_count = mcp.as_object().map(|obj| obj.len()).unwrap_or(0);

    // Check for permissions
    let has_permissions = settings.get("permissions")
        .and_then(|p| p.as_object())
        .map(|p| {
            p.get("allow").and_then(|v| v.as_array()).map(|a| !a.is_empty()).unwrap_or(false) ||
            p.get("deny").and_then(|v| v.as_array()).map(|a| !a.is_empty()).unwrap_or(false) ||
            p.get("ask").and_then(|v| v.as_array()).map(|a| !a.is_empty()).unwrap_or(false)
        })
        .unwrap_or(false);

    // Check for hooks
    let has_hooks = settings.get("hooks")
        .and_then(|h| h.as_object())
        .map(|h| !h.is_empty())
        .unwrap_or(false);

    // Check for env vars
    let has_env_vars = settings.get("env")
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

        let entries = fs::read_dir(&folder)
            .map_err(|e| format!("Failed to read presets folder: {e}"))?;

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(preset) = serde_json::from_str::<UnifiedPresetData>(&content) {
                        presets.push(preset);
                    }
                }
            }
        }

        // Sort by updated_at descending
        presets.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

        Ok(presets)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Save a unified preset (create or update)
#[tauri::command]
pub async fn save_unified_preset(input: UnifiedPresetInput) -> Result<UnifiedPresetData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_presets_folder()?;

        let now = chrono::Utc::now().to_rfc3339();
        let summary = compute_summary(&input.settings, &input.mcp_servers);

        let preset = if let Some(id) = &input.id {
            // Update existing
            let path = get_preset_path(id)?;
            let existing: UnifiedPresetData = if path.exists() {
                let content = fs::read_to_string(&path)
                    .map_err(|e| format!("Failed to read preset: {e}"))?;
                serde_json::from_str(&content)
                    .map_err(|e| format!("Failed to parse preset: {e}"))?
            } else {
                return Err("Preset not found".to_string());
            };

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

        // Write to file
        let path = get_preset_path(&preset.id)?;
        let json = serde_json::to_string_pretty(&preset)
            .map_err(|e| format!("Failed to serialize preset: {e}"))?;

        let mut file = fs::File::create(&path)
            .map_err(|e| format!("Failed to create preset file: {e}"))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("Failed to write preset file: {e}"))?;

        Ok(preset)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Delete a unified preset
#[tauri::command]
pub async fn delete_unified_preset(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_preset_id(&id)?;
        let path = get_preset_path(&id)?;

        if path.exists() {
            fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete preset: {e}"))?;
        }

        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Get a single unified preset by ID
#[tauri::command]
pub async fn get_unified_preset(id: String) -> Result<Option<UnifiedPresetData>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_preset_id(&id)?;
        let path = get_preset_path(&id)?;

        if !path.exists() {
            return Ok(None);
        }

        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read preset: {e}"))?;

        let preset: UnifiedPresetData = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse preset: {e}"))?;

        Ok(Some(preset))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
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
}
