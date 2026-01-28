//! Tauri commands for Claude Code settings management
//!
//! This module provides commands for reading and writing Claude Code settings
//! across different scopes (user, project, local, managed) and MCP server configurations.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// All settings scopes in a single structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllSettings {
    pub user: Option<String>,
    pub project: Option<String>,
    pub local: Option<String>,
    pub managed: Option<String>,
}

/// MCP servers from both settings.json and .mcp.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPServers {
    pub servers: serde_json::Value,
}

/// All MCP servers across all scopes
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllMCPServers {
    /// User-level from settings.json mcpServers (legacy)
    pub user_settings: Option<serde_json::Value>,
    /// User-level from ~/.claude/.mcp.json (legacy)
    pub user_mcp_file: Option<serde_json::Value>,
    /// Project-level from .mcp.json (in project root)
    pub project_mcp_file: Option<serde_json::Value>,
    /// User-scoped MCP from ~/.claude.json → mcpServers (official)
    pub user_claude_json: Option<serde_json::Value>,
    /// Local/Project-scoped MCP from ~/.claude.json → projects.<path>.mcpServers (official)
    pub local_claude_json: Option<serde_json::Value>,
}

/// Get the user settings path (~/.claude/settings.json)
fn get_user_settings_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    Ok(home.join(".claude").join("settings.json"))
}

/// Get the user MCP settings path (~/.claude/.mcp.json)
fn get_user_mcp_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    Ok(home.join(".claude").join(".mcp.json"))
}

/// Get the main Claude config path (~/.claude.json) - the official config file
fn get_claude_json_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    Ok(home.join(".claude.json"))
}

/// Validate project path to prevent path traversal attacks
///
/// # Security
/// - Ensures path is absolute
/// - Prevents ".." path traversal components
/// - Canonicalizes existing paths
///
/// # Arguments
/// * `path` - Project path to validate
///
/// # Returns
/// Validated `PathBuf` or error message
fn validate_project_path(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);

    if !path.is_absolute() {
        return Err("Project path must be absolute".to_string());
    }

    // Check for path traversal
    if path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("Project path cannot contain '..' components".to_string());
    }

    // Canonicalize if exists, otherwise return as-is
    if path.exists() {
        path.canonicalize()
            .map_err(|e| format!("Failed to canonicalize path: {e}"))
    } else {
        Ok(path)
    }
}

/// Get the project MCP settings path (<project>/.mcp.json)
fn get_project_mcp_path(project_path: &str) -> Result<PathBuf, String> {
    let validated = validate_project_path(project_path)?;
    Ok(validated.join(".mcp.json"))
}

/// Get the managed settings path (macOS only)
#[cfg(target_os = "macos")]
#[allow(clippy::unnecessary_wraps)]
fn get_managed_settings_path() -> Result<PathBuf, String> {
    Ok(PathBuf::from(
        "/Library/Application Support/ClaudeCode/managed-settings.json",
    ))
}

#[cfg(not(target_os = "macos"))]
fn get_managed_settings_path() -> Result<PathBuf, String> {
    Err("Managed settings are only available on macOS".to_string())
}

/// Get settings path for a specific scope
fn get_settings_path(scope: &str, project_path: Option<&str>) -> Result<PathBuf, String> {
    match scope {
        "user" => get_user_settings_path(),
        "project" => {
            let path = project_path.ok_or("project_path required for 'project' scope")?;
            let validated = validate_project_path(path)?;
            Ok(validated.join(".claude").join("settings.json"))
        }
        "local" => {
            let path = project_path.ok_or("project_path required for 'local' scope")?;
            let validated = validate_project_path(path)?;
            Ok(validated.join(".claude").join("settings.local.json"))
        }
        "managed" => get_managed_settings_path(),
        _ => Err(format!("Invalid scope: {scope}")),
    }
}

/// Read a settings file, returns JSON string or empty object if not exists
fn read_settings_file(path: &Path) -> Result<String, String> {
    if !path.exists() {
        return Ok("{}".to_string());
    }

    fs::read_to_string(path).map_err(|e| format!("Failed to read settings file: {e}"))
}

/// Write settings file with atomic write pattern
fn write_settings_file(path: &Path, content: &str) -> Result<(), String> {
    // Validate JSON before writing
    serde_json::from_str::<serde_json::Value>(content)
        .map_err(|e| format!("Invalid JSON content: {e}"))?;

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory: {e}"))?;
    }

    // Atomic write pattern: write to temp file then rename
    let temp_path = path.with_extension("json.tmp");
    let mut file =
        fs::File::create(&temp_path).map_err(|e| format!("Failed to create temp file: {e}"))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write temp file: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("Failed to sync temp file: {e}"))?;

    super::fs_utils::atomic_rename(&temp_path, path)?;

    Ok(())
}

/// Get settings for a specific scope
///
/// # Arguments
/// * `scope` - One of: "user", "project", "local", "managed"
/// * `project_path` - Required for "project" and "local" scopes (must be absolute path)
///
/// # Returns
/// JSON string of settings, or empty object "{}" if file doesn't exist
#[tauri::command]
pub async fn get_settings_by_scope(
    scope: String,
    project_path: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = get_settings_path(&scope, project_path.as_deref())?;
        read_settings_file(&path)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Save settings to a specific scope
///
/// # Arguments
/// * `scope` - One of: "user", "project", "local" (NOT "managed" - read-only)
/// * `content` - JSON string to save
/// * `project_path` - Required for "project" and "local" scopes (must be absolute path)
///
/// # Errors
/// Returns error if scope is "managed" or if JSON is invalid
#[tauri::command]
pub async fn save_settings(
    scope: String,
    content: String,
    project_path: Option<String>,
) -> Result<(), String> {
    // Managed settings are read-only
    if scope == "managed" {
        return Err("Cannot modify managed settings (read-only)".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let path = get_settings_path(&scope, project_path.as_deref())?;
        write_settings_file(&path, &content)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Get all settings scopes at once
///
/// # Arguments
/// * `project_path` - Optional project path for project/local settings (must be absolute)
///
/// # Returns
/// `AllSettings` struct with all 4 scopes (each is `Option<String>`)
#[tauri::command]
pub async fn get_all_settings(project_path: Option<String>) -> Result<AllSettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let user = get_user_settings_path()
            .ok()
            .and_then(|p| read_settings_file(&p).ok());

        let project = project_path
            .as_deref()
            .and_then(|pp| get_settings_path("project", Some(pp)).ok())
            .and_then(|p| read_settings_file(&p).ok());

        let local = project_path
            .as_deref()
            .and_then(|pp| get_settings_path("local", Some(pp)).ok())
            .and_then(|p| read_settings_file(&p).ok());

        let managed = get_managed_settings_path()
            .ok()
            .and_then(|p| read_settings_file(&p).ok());

        Ok(AllSettings {
            user,
            project,
            local,
            managed,
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Get MCP servers from both settings.json (mcpServers field) and .mcp.json
///
/// # Returns
/// `MCPServers` struct with merged servers from both sources
#[tauri::command]
pub async fn get_mcp_servers() -> Result<MCPServers, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut merged = serde_json::Map::new();

        // Read from ~/.claude/settings.json (mcpServers field)
        if let Ok(user_path) = get_user_settings_path() {
            if let Ok(content) = read_settings_file(&user_path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(mcp_servers) = json.get("mcpServers") {
                        if let Some(obj) = mcp_servers.as_object() {
                            merged.extend(obj.clone());
                        }
                    }
                }
            }
        }

        // Read from ~/.claude/.mcp.json
        if let Ok(mcp_path) = get_user_mcp_path() {
            if let Ok(content) = read_settings_file(&mcp_path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    // Check if it has mcpServers key or is the servers object directly
                    if let Some(mcp_servers) = json.get("mcpServers") {
                        if let Some(obj) = mcp_servers.as_object() {
                            merged.extend(obj.clone());
                        }
                    } else if let Some(obj) = json.as_object() {
                        // .mcp.json might be servers directly without mcpServers wrapper
                        merged.extend(obj.clone());
                    }
                }
            }
        }

        Ok(MCPServers {
            servers: serde_json::Value::Object(merged),
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Get all MCP servers from all sources (user settings, user .mcp.json, project .mcp.json, ~/.claude.json)
///
/// # Arguments
/// * `project_path` - Optional project path for project-level .mcp.json and local scope in ~/.claude.json
///
/// # Returns
/// `AllMCPServers` struct with servers from each source separately
#[tauri::command]
pub async fn get_all_mcp_servers(project_path: Option<String>) -> Result<AllMCPServers, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // User settings.json mcpServers (legacy)
        let user_settings = get_user_settings_path().ok().and_then(|p| {
            read_settings_file(&p).ok().and_then(|content| {
                serde_json::from_str::<serde_json::Value>(&content)
                    .ok()
                    .and_then(|json| json.get("mcpServers").cloned())
            })
        });

        // User .mcp.json (legacy)
        let user_mcp_file = get_user_mcp_path().ok().and_then(|p| {
            if !p.exists() {
                return None;
            }
            read_settings_file(&p).ok().and_then(|content| {
                serde_json::from_str::<serde_json::Value>(&content)
                    .ok()
                    .map(|json| {
                        // Check if it has mcpServers key or is servers directly
                        if let Some(servers) = json.get("mcpServers") {
                            servers.clone()
                        } else {
                            json
                        }
                    })
            })
        });

        // Project .mcp.json
        let project_mcp_file = project_path.as_deref().and_then(|pp| {
            let p = get_project_mcp_path(pp).ok()?;
            if !p.exists() {
                return None;
            }
            read_settings_file(&p).ok().and_then(|content| {
                serde_json::from_str::<serde_json::Value>(&content)
                    .ok()
                    .map(|json| {
                        // Check if it has mcpServers key or is servers directly
                        if let Some(servers) = json.get("mcpServers") {
                            servers.clone()
                        } else {
                            json
                        }
                    })
            })
        });

        // Read ~/.claude.json (official config file)
        let claude_json = get_claude_json_path().ok().and_then(|p| {
            if !p.exists() {
                return None;
            }
            read_settings_file(&p)
                .ok()
                .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
        });

        // User-scoped MCP from ~/.claude.json → mcpServers
        let user_claude_json = claude_json
            .as_ref()
            .and_then(|json| json.get("mcpServers").cloned());

        // Local/Project-scoped MCP from ~/.claude.json → projects.<path>.mcpServers
        let local_claude_json = project_path.as_deref().and_then(|pp| {
            claude_json.as_ref().and_then(|json| {
                json.get("projects")
                    .and_then(|projects| projects.get(pp))
                    .and_then(|project| project.get("mcpServers").cloned())
            })
        });

        Ok(AllMCPServers {
            user_settings,
            user_mcp_file,
            project_mcp_file,
            user_claude_json,
            local_claude_json,
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Save MCP servers to a specific source
///
/// # Arguments
/// * `source` - One of: `user_settings`, `user_mcp`, `project_mcp`, `user_claude_json`, `local_claude_json`
/// * `servers` - JSON string of MCP servers object
/// * `project_path` - Required for `project_mcp` and `local_claude_json` sources
#[tauri::command]
pub async fn save_mcp_servers(
    source: String,
    servers: String,
    project_path: Option<String>,
) -> Result<(), String> {
    // Validate servers JSON
    let servers_value: serde_json::Value =
        serde_json::from_str(&servers).map_err(|e| format!("Invalid MCP servers JSON: {e}"))?;

    tauri::async_runtime::spawn_blocking(move || {
        match source.as_str() {
            "user_settings" => {
                // Update mcpServers field in ~/.claude/settings.json (legacy)
                let path = get_user_settings_path()?;
                let mut settings: serde_json::Value = if path.exists() {
                    let content = read_settings_file(&path)?;
                    serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
                } else {
                    serde_json::json!({})
                };

                settings["mcpServers"] = servers_value;
                let content = serde_json::to_string_pretty(&settings)
                    .map_err(|e| format!("Failed to serialize settings: {e}"))?;
                write_settings_file(&path, &content)?;
            }
            "user_mcp" => {
                // Write to ~/.claude/.mcp.json (legacy)
                let path = get_user_mcp_path()?;
                // Store with mcpServers wrapper for consistency
                let mcp_json = serde_json::json!({ "mcpServers": servers_value });
                let content = serde_json::to_string_pretty(&mcp_json)
                    .map_err(|e| format!("Failed to serialize MCP config: {e}"))?;
                write_settings_file(&path, &content)?;
            }
            "project_mcp" => {
                // Write to <project>/.mcp.json
                let pp = project_path.ok_or("project_path required for project_mcp source")?;
                let path = get_project_mcp_path(&pp)?;
                // Store with mcpServers wrapper for consistency
                let mcp_json = serde_json::json!({ "mcpServers": servers_value });
                let content = serde_json::to_string_pretty(&mcp_json)
                    .map_err(|e| format!("Failed to serialize MCP config: {e}"))?;
                write_settings_file(&path, &content)?;
            }
            "user_claude_json" => {
                // Update mcpServers field in ~/.claude.json (official)
                let path = get_claude_json_path()?;
                let mut claude_json: serde_json::Value = if path.exists() {
                    let content = read_settings_file(&path)?;
                    serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
                } else {
                    serde_json::json!({})
                };

                claude_json["mcpServers"] = servers_value;
                let content = serde_json::to_string_pretty(&claude_json)
                    .map_err(|e| format!("Failed to serialize claude.json: {e}"))?;
                write_settings_file(&path, &content)?;
            }
            "local_claude_json" => {
                // Update projects.<path>.mcpServers in ~/.claude.json (official)
                let pp =
                    project_path.ok_or("project_path required for local_claude_json source")?;
                let path = get_claude_json_path()?;
                let mut claude_json: serde_json::Value = if path.exists() {
                    let content = read_settings_file(&path)?;
                    serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
                } else {
                    serde_json::json!({})
                };

                // Ensure projects object exists
                if claude_json.get("projects").is_none() {
                    claude_json["projects"] = serde_json::json!({});
                }

                // Ensure project entry exists
                if claude_json["projects"].get(&pp).is_none() {
                    claude_json["projects"][&pp] = serde_json::json!({});
                }

                claude_json["projects"][&pp]["mcpServers"] = servers_value;
                let content = serde_json::to_string_pretty(&claude_json)
                    .map_err(|e| format!("Failed to serialize claude.json: {e}"))?;
                write_settings_file(&path, &content)?;
            }
            _ => return Err(format!("Invalid source: {source}")),
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Claude.json configuration structure for reading
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeJsonConfig {
    /// Full raw JSON content
    pub raw: serde_json::Value,
    /// User-scoped MCP servers
    pub mcp_servers: Option<serde_json::Value>,
    /// Project settings from projects.<path>
    pub project_settings: Option<serde_json::Value>,
    /// File path for reference
    pub file_path: String,
}

/// Get the full ~/.claude.json configuration
///
/// # Arguments
/// * `project_path` - Optional project path to extract project-specific settings
///
/// # Returns
/// `ClaudeJsonConfig` with raw JSON and extracted fields
#[tauri::command]
pub async fn get_claude_json_config(
    project_path: Option<String>,
) -> Result<ClaudeJsonConfig, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = get_claude_json_path()?;
        let file_path = path.to_string_lossy().to_string();

        if !path.exists() {
            return Ok(ClaudeJsonConfig {
                raw: serde_json::json!({}),
                mcp_servers: None,
                project_settings: None,
                file_path,
            });
        }

        let content = read_settings_file(&path)?;
        let raw: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse claude.json: {e}"))?;

        let mcp_servers = raw.get("mcpServers").cloned();

        let project_settings = project_path.and_then(|pp| {
            raw.get("projects")
                .and_then(|projects| projects.get(&pp).cloned())
        });

        Ok(ClaudeJsonConfig {
            raw,
            mcp_servers,
            project_settings,
            file_path,
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Validate that a path is within allowed directories
///
/// # Security
/// Prevents unauthorized file system access by restricting operations to safe directories.
///
/// # Arguments
/// * `path` - Path to validate
///
/// # Returns
/// Ok(()) if path is safe, error message if not
fn is_safe_path(path: &Path) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let allowed_dirs = [
        home.join(".claude-history-viewer").join("exports"),
        home.join("Downloads"),
        home.join("Documents"),
    ];

    // For non-existing paths, canonicalize parent
    let canonical = if path.exists() {
        path.canonicalize()
            .map_err(|e| format!("Path canonicalization error: {e}"))?
    } else {
        path.parent()
            .and_then(|p| p.canonicalize().ok())
            .map(|p| p.join(path.file_name().unwrap_or_default()))
            .ok_or_else(|| "Invalid path".to_string())?
    };

    if allowed_dirs.iter().any(|d| canonical.starts_with(d)) {
        Ok(())
    } else {
        Err(format!(
            "Path not in allowed directories. Allowed: {allowed_dirs:?}"
        ))
    }
}

/// Write text content to a file
///
/// # Arguments
/// * `path` - Absolute path to the file to write
/// * `content` - Text content to write
///
/// # Returns
/// Ok(()) on success, error message on failure
#[tauri::command]
pub async fn write_text_file(path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(path);

        // Validate path is in allowed directories
        is_safe_path(&path)?;

        // Atomic write: write to temp file then rename
        let temp_path = path.with_extension("tmp");
        let mut file = fs::File::create(&temp_path)
            .map_err(|e| format!("Failed to create temp file {}: {}", temp_path.display(), e))?;
        file.write_all(content.as_bytes()).map_err(|e| {
            format!(
                "Failed to write to temp file {}: {}",
                temp_path.display(),
                e
            )
        })?;
        file.sync_all()
            .map_err(|e| format!("Failed to sync temp file: {e}"))?;
        super::fs_utils::atomic_rename(&temp_path, &path)?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Read text content from a file
///
/// # Arguments
/// * `path` - Absolute path to the file to read
///
/// # Returns
/// File content as string on success, error message on failure
#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(path);

        // Validate path is in allowed directories
        is_safe_path(&path)?;

        fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read file {}: {}", path.display(), e))
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

#[cfg(test)]
#[allow(clippy::await_holding_lock)]
mod tests {
    use super::*;
    use std::env;
    use std::sync::{LazyLock, Mutex, MutexGuard};
    use tempfile::TempDir;

    /// Static mutex to serialize tests that modify the HOME environment variable
    static TEST_ENV_MUTEX: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    /// Sets up a test environment with a temporary HOME directory
    fn setup_test_env() -> (MutexGuard<'static, ()>, TempDir) {
        // Recover from poisoned mutex (happens when previous test panicked)
        let guard = TEST_ENV_MUTEX
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let temp_dir = TempDir::new().unwrap();
        env::set_var("HOME", temp_dir.path());
        (guard, temp_dir)
    }

    #[test]
    fn test_get_user_settings_path() {
        let (_guard, temp) = setup_test_env();
        let path = get_user_settings_path().unwrap();
        assert!(path.to_string_lossy().contains(".claude"));
        assert!(path.to_string_lossy().ends_with("settings.json"));
        drop(temp);
    }

    #[test]
    fn test_read_nonexistent_settings() {
        let (_guard, temp) = setup_test_env();
        let path = temp.path().join("nonexistent.json");
        let result = read_settings_file(&path).unwrap();
        assert_eq!(result, "{}");
        drop(temp);
    }

    #[test]
    fn test_write_and_read_settings() {
        let (_guard, temp) = setup_test_env();
        let claude_dir = temp.path().join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();

        let path = claude_dir.join("test-settings.json");
        let content = r#"{"theme":"dark","autoSave":true}"#;

        write_settings_file(&path, content).unwrap();
        assert!(path.exists());

        let read_content = read_settings_file(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&read_content).unwrap();
        assert_eq!(parsed["theme"], "dark");
        assert_eq!(parsed["autoSave"], true);

        drop(temp);
    }

    #[test]
    fn test_write_invalid_json() {
        let (_guard, temp) = setup_test_env();
        let path = temp.path().join("invalid.json");
        let result = write_settings_file(&path, "not valid json");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid JSON"));
        drop(temp);
    }

    #[test]
    fn test_atomic_write_creates_dirs() {
        let (_guard, temp) = setup_test_env();
        let nested_path = temp
            .path()
            .join("deep")
            .join("nested")
            .join("settings.json");
        let content = r#"{"test":true}"#;

        write_settings_file(&nested_path, content).unwrap();
        assert!(nested_path.exists());

        drop(temp);
    }

    #[test]
    fn test_get_settings_path_invalid_scope() {
        let result = get_settings_path("invalid", None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid scope"));
    }

    #[test]
    fn test_get_settings_path_project_without_path() {
        let result = get_settings_path("project", None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("project_path required"));
    }

    #[tokio::test]
    async fn test_get_settings_by_scope_user() {
        let (_guard, temp) = setup_test_env();
        let claude_dir = temp.path().join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();

        let settings_path = claude_dir.join("settings.json");
        fs::write(&settings_path, r#"{"user":"test"}"#).unwrap();

        let result = get_settings_by_scope("user".to_string(), None).await;
        assert!(result.is_ok());
        let content = result.unwrap();
        assert!(content.contains("user"));

        drop(temp);
    }

    #[tokio::test]
    async fn test_save_settings_managed_readonly() {
        let result = save_settings("managed".to_string(), "{}".to_string(), None).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("read-only"));
    }

    #[tokio::test]
    async fn test_get_all_settings_empty() {
        let (_guard, temp) = setup_test_env();
        let result = get_all_settings(None).await;
        assert!(result.is_ok());

        let all = result.unwrap();
        // User settings file doesn't exist yet
        assert_eq!(all.user, Some("{}".to_string()));
        assert!(all.project.is_none());
        assert!(all.local.is_none());

        drop(temp);
    }

    #[tokio::test]
    async fn test_get_mcp_servers_empty() {
        let (_guard, temp) = setup_test_env();
        let result = get_mcp_servers().await;
        assert!(result.is_ok());

        let mcp = result.unwrap();
        assert!(mcp.servers.is_object());
        assert_eq!(mcp.servers.as_object().unwrap().len(), 0);

        drop(temp);
    }

    #[tokio::test]
    async fn test_get_mcp_servers_merges_sources() {
        let (_guard, temp) = setup_test_env();
        let claude_dir = temp.path().join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();

        // Create settings.json with mcpServers
        let settings_path = claude_dir.join("settings.json");
        fs::write(
            &settings_path,
            r#"{"mcpServers":{"server1":{"command":"cmd1"}}}"#,
        )
        .unwrap();

        // Create .mcp.json
        let mcp_path = claude_dir.join(".mcp.json");
        fs::write(&mcp_path, r#"{"server2":{"command":"cmd2"}}"#).unwrap();

        let result = get_mcp_servers().await;
        assert!(result.is_ok());

        let mcp = result.unwrap();
        let servers = mcp.servers.as_object().unwrap();
        assert_eq!(servers.len(), 2);
        assert!(servers.contains_key("server1"));
        assert!(servers.contains_key("server2"));

        drop(temp);
    }

    #[tokio::test]
    async fn test_mcp_json_overrides_settings_json() {
        let (_guard, temp) = setup_test_env();
        let claude_dir = temp.path().join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();

        // Both define "server1" - .mcp.json should win
        let settings_path = claude_dir.join("settings.json");
        fs::write(
            &settings_path,
            r#"{"mcpServers":{"server1":{"priority":"low"}}}"#,
        )
        .unwrap();

        let mcp_path = claude_dir.join(".mcp.json");
        fs::write(&mcp_path, r#"{"server1":{"priority":"high"}}"#).unwrap();

        let result = get_mcp_servers().await;
        assert!(result.is_ok());

        let mcp = result.unwrap();
        let servers = mcp.servers.as_object().unwrap();
        assert_eq!(servers.len(), 1);
        assert_eq!(servers["server1"]["priority"], "high");

        drop(temp);
    }

    #[tokio::test]
    async fn test_save_and_retrieve_user_settings() {
        let (_guard, temp) = setup_test_env();
        let content = r#"{"theme":"dark","fontSize":14}"#;

        // Save
        let save_result = save_settings("user".to_string(), content.to_string(), None).await;
        assert!(save_result.is_ok());

        // Retrieve
        let get_result = get_settings_by_scope("user".to_string(), None).await;
        assert!(get_result.is_ok());

        let retrieved = get_result.unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&retrieved).unwrap();
        assert_eq!(parsed["theme"], "dark");
        assert_eq!(parsed["fontSize"], 14);

        drop(temp);
    }
}
