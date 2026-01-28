//! Tauri commands for MCP server preset management
//!
//! This module provides commands for saving, loading, and managing
//! MCP server presets stored in ~/.claude-history-viewer/mcp-presets/

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use uuid::Uuid;

/// MCP server configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MCPServerConfig {
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "type")]
    pub server_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Data structure for an MCP preset
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MCPPresetData {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub servers: String, // JSON string of MCP servers
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// Input structure for creating/updating MCP presets
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MCPPresetInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub servers: String, // JSON string of MCP servers
}

/// Get the MCP presets folder path (~/.claude-history-viewer/mcp-presets)
fn get_mcp_presets_folder() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    Ok(home.join(".claude-history-viewer").join("mcp-presets"))
}

/// Ensure the MCP presets folder exists
fn ensure_mcp_presets_folder() -> Result<PathBuf, String> {
    let folder = get_mcp_presets_folder()?;
    if folder.exists() {
        if !folder.is_dir() {
            return Err(format!(
                "MCP presets path exists but is not a directory: {}",
                folder.display()
            ));
        }
    } else {
        fs::create_dir_all(&folder)
            .map_err(|e| format!("Failed to create MCP presets folder: {e}"))?;
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

/// Get the path to an MCP preset file
fn get_mcp_preset_path(id: &str) -> Result<PathBuf, String> {
    validate_preset_id(id)?;
    let folder = get_mcp_presets_folder()?;
    Ok(folder.join(format!("{id}.json")))
}

/// Validate that the servers JSON is parseable
fn validate_servers_json(servers_json: &str) -> Result<(), String> {
    serde_json::from_str::<HashMap<String, MCPServerConfig>>(servers_json)
        .map_err(|e| format!("Invalid MCP servers JSON: {e}"))?;
    Ok(())
}

/// Save an MCP preset to disk
#[tauri::command]
pub async fn save_mcp_preset(input: MCPPresetInput) -> Result<MCPPresetData, String> {
    // Validate servers JSON
    validate_servers_json(&input.servers)?;

    // Generate ID if not provided
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = chrono::Utc::now().to_rfc3339();

    // Check if preset already exists to preserve created_at
    let created_at = tauri::async_runtime::spawn_blocking({
        let id = id.clone();
        let now = now.clone();
        move || {
            let path = get_mcp_preset_path(&id)?;
            if path.exists() {
                let content = fs::read_to_string(&path)
                    .map_err(|e| format!("Failed to read existing MCP preset: {e}"))?;
                let existing: MCPPresetData = serde_json::from_str(&content)
                    .map_err(|e| format!("Failed to parse existing MCP preset: {e}"))?;
                Ok::<String, String>(existing.created_at)
            } else {
                Ok(now)
            }
        }
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))??;

    let preset = MCPPresetData {
        id: id.clone(),
        name: input.name,
        description: input.description,
        servers: input.servers,
        created_at,
        updated_at: Some(now),
    };

    // Perform blocking file I/O
    let preset_clone = preset.clone();
    tauri::async_runtime::spawn_blocking(move || {
        ensure_mcp_presets_folder()?;
        let path = get_mcp_preset_path(&preset_clone.id)?;

        // Write to temp file with unique name to avoid collisions
        let nonce: u64 = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;
        let temp_path = path.with_extension(format!("json.{nonce}.tmp"));
        let content = serde_json::to_string_pretty(&preset_clone)
            .map_err(|e| format!("Failed to serialize MCP preset: {e}"))?;

        let mut file =
            fs::File::create(&temp_path).map_err(|e| format!("Failed to create temp file: {e}"))?;
        file.write_all(content.as_bytes())
            .map_err(|e| format!("Failed to write temp file: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("Failed to sync temp file: {e}"))?;

        // Cross-platform atomic rename (handles Windows remove internally)
        super::fs_utils::atomic_rename(&temp_path, &path)?;

        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))??;

    Ok(preset)
}

/// Load all MCP presets from disk
#[tauri::command]
pub async fn load_mcp_presets() -> Result<Vec<MCPPresetData>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let folder = get_mcp_presets_folder()?;

        // Return empty vec if folder doesn't exist yet
        if !folder.exists() {
            return Ok(Vec::new());
        }

        let mut presets = Vec::new();
        let entries =
            fs::read_dir(&folder).map_err(|e| format!("Failed to read MCP presets folder: {e}"))?;

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
                    eprintln!(
                        "Warning: Failed to read MCP preset at {}: {e}",
                        path.display()
                    );
                    continue;
                }
            };

            match serde_json::from_str::<MCPPresetData>(&content) {
                Ok(preset) => presets.push(preset),
                Err(e) => {
                    eprintln!(
                        "Warning: Failed to parse MCP preset at {}: {e}",
                        path.display()
                    );
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

/// Load a single MCP preset by ID
#[tauri::command]
pub async fn get_mcp_preset(id: String) -> Result<Option<MCPPresetData>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = get_mcp_preset_path(&id)?;

        if !path.exists() {
            return Ok(None);
        }

        let content =
            fs::read_to_string(&path).map_err(|e| format!("Failed to read MCP preset: {e}"))?;

        let preset: MCPPresetData = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse MCP preset: {e}"))?;

        Ok(Some(preset))
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Delete an MCP preset by ID
#[tauri::command]
pub async fn delete_mcp_preset(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = get_mcp_preset_path(&id)?;

        if !path.exists() {
            return Err(format!("MCP preset not found: {id}"));
        }

        fs::remove_file(&path).map_err(|e| format!("Failed to delete MCP preset: {e}"))?;

        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}
