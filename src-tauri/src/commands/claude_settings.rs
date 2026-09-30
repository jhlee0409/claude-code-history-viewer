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
    /// Local/Project-scoped MCP from `~/.claude.json` → `projects.<path>.mcpServers` (official)
    pub local_claude_json: Option<serde_json::Value>,
}

/// The home directory these settings paths hang off.
///
/// In a normal build this is exactly `crate::utils::home_dir()`.
///
/// # Why this indirection exists
///
/// The tests below intended to sandbox themselves with
/// `env::set_var("HOME", temp_dir)`. That is inert on Windows: `crate::utils::home_dir()`
/// resolves through the known-folder API and consults neither `HOME` nor
/// `USERPROFILE`. So `test_save_and_retrieve_user_settings` wrote
/// `{"theme":"dark","fontSize":14}` straight over the developer's real
/// `~/.claude/settings.json`, and because `save_settings` replaces rather than
/// merges, every other key went with it. It destroyed a 22-key config twice
/// before anyone connected it to `cargo test`, and the test reported `ok` each
/// time.
///
/// Under `cfg(test)` this reads `CCHV_TEST_HOME` instead, and **panics if that
/// variable is unset**. Falling back to the real home would leave the same
/// landmine armed for the next test that forgets to sandbox itself; a panic
/// turns that mistake into a loud failure instead of silent data loss.
#[cfg(not(test))]
fn settings_home_dir() -> Option<PathBuf> {
    crate::utils::home_dir()
}

#[cfg(test)]
// Always Some or a panic under cfg(test); the Option matches the real
// signature above so callers stay identical in both builds.
#[allow(clippy::unnecessary_wraps)]
fn settings_home_dir() -> Option<PathBuf> {
    match std::env::var_os("CCHV_TEST_HOME") {
        Some(value) => Some(PathBuf::from(value)),
        None => panic!(
            "a test resolved a real ~/.claude path without a sandbox. \
             Call `setup_test_env()` first: writing here would overwrite the \
             developer's own settings.json."
        ),
    }
}

/// Get the user settings path (~/.claude/settings.json)
fn get_user_settings_path() -> Result<PathBuf, String> {
    let home = settings_home_dir().ok_or("Could not find home directory")?;
    Ok(home.join(".claude").join("settings.json"))
}

/// Get the user MCP settings path (~/.claude/.mcp.json)
fn get_user_mcp_path() -> Result<PathBuf, String> {
    let home = settings_home_dir().ok_or("Could not find home directory")?;
    Ok(home.join(".claude").join(".mcp.json"))
}

/// Get the main Claude config path (~/.claude.json) - the official config file
fn get_claude_json_path() -> Result<PathBuf, String> {
    let home = settings_home_dir().ok_or("Could not find home directory")?;
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

/// Get the project MCP settings path (`<project>/.mcp.json`)
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

    // Atomic write pattern: write to temp file then rename. The temp file is
    // created fresh (`create_new`) so a leftover entry at that name, including
    // a link to somewhere else, is removed rather than written through. The
    // rename then replaces a linked target instead of following it.
    let temp_path = path.with_extension("json.tmp");
    let _ = fs::remove_file(&temp_path);
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp_path)
        .map_err(|e| format!("Failed to create temp file: {e}"))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write temp file: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("Failed to sync temp file: {e}"))?;

    super::fs_utils::atomic_rename(&temp_path, path)?;

    Ok(())
}

/// Write a settings file that lives inside a project directory.
///
/// A project directory is often a checked-out repository, and a repository
/// can carry links (e.g. `.claude -> /elsewhere`). Every directory between
/// `project_dir` and the file must be a real directory, so a save cannot land
/// outside the project. Checked before writing; a link swapped in between the
/// check and the write is not caught.
fn write_project_settings_file(
    project_dir: &Path,
    path: &Path,
    content: &str,
) -> Result<(), String> {
    let relative_dir = path
        .parent()
        .and_then(|parent| parent.strip_prefix(project_dir).ok())
        .ok_or("Settings file is not inside the project directory")?;
    let mut dir = project_dir.to_path_buf();
    for component in relative_dir.components() {
        dir.push(component);
        if dir
            .symlink_metadata()
            .is_ok_and(|m| m.file_type().is_symlink())
        {
            return Err(format!(
                "Refusing to write through a symlink: {}",
                dir.display()
            ));
        }
    }
    write_settings_file(path, content)
}

/// Key of a project in `~/.claude.json` `projects`: the absolute path without
/// a trailing separator, symlinks resolved, as Claude Code records it.
fn claude_json_project_key(project_path: &str) -> Result<String, String> {
    let validated = validate_project_path(project_path)?;
    Ok(strip_windows_prefix(&validated)
        .to_string_lossy()
        .into_owned())
}

/// Read an existing JSON config that is about to be updated in place.
///
/// A missing or empty file is treated as `{}`. A file that exists but does
/// not parse is an error: the caller writes the whole object back, so
/// falling back to `{}` would replace e.g. every key of `~/.claude.json`
/// (account, per-project state, ...) with just the field being saved. A
/// transient partial write by a running Claude Code, a hand edit with a
/// trailing comma, or a BOM from a Windows editor is enough to trigger that.
fn read_json_for_update(path: &Path) -> Result<serde_json::Value, String> {
    let content = read_settings_file(path)?;
    let content = content.strip_prefix('\u{feff}').unwrap_or(&content);
    if content.trim().is_empty() {
        return Ok(serde_json::json!({}));
    }
    serde_json::from_str(content).map_err(|e| {
        format!(
            "Refusing to overwrite {}: it is not valid JSON ({e}). Fix or remove the file and try again.",
            path.display()
        )
    })
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
        match (scope.as_str(), project_path.as_deref()) {
            ("project" | "local", Some(pp)) => {
                write_project_settings_file(&validate_project_path(pp)?, &path, &content)
            }
            _ => write_settings_file(&path, &content),
        }
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
            let key = claude_json_project_key(pp).ok()?;
            claude_json.as_ref().and_then(|json| {
                json.get("projects")
                    .and_then(|projects| projects.get(&key))
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
                let mut settings = read_json_for_update(&path)?;

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
                write_project_settings_file(&validate_project_path(&pp)?, &path, &content)?;
            }
            "user_claude_json" => {
                // Update mcpServers field in ~/.claude.json (official)
                let path = get_claude_json_path()?;
                let mut claude_json = read_json_for_update(&path)?;

                claude_json["mcpServers"] = servers_value;
                let content = serde_json::to_string_pretty(&claude_json)
                    .map_err(|e| format!("Failed to serialize claude.json: {e}"))?;
                write_settings_file(&path, &content)?;
            }
            "local_claude_json" => {
                // Update projects.<path>.mcpServers in ~/.claude.json (official)
                let pp = claude_json_project_key(
                    &project_path.ok_or("project_path required for local_claude_json source")?,
                )?;
                let path = get_claude_json_path()?;
                let mut claude_json = read_json_for_update(&path)?;

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
    /// Project settings from `projects.<path>`
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
            let key = claude_json_project_key(&pp).ok()?;
            raw.get("projects")
                .and_then(|projects| projects.get(&key).cloned())
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

/// Validate a path chosen by user via native file dialog.
///
/// Checks: absolute path, no `..` traversal, parent directory exists.
/// Used by [`write_text_file`], [`read_text_file`], and [`save_screenshot`].
pub(crate) fn validate_dialog_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Path must be absolute".to_string());
    }
    if path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("Path cannot contain '..' components".to_string());
    }
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            return Err(format!(
                "Parent directory does not exist: {}",
                parent.display()
            ));
        }
        let metadata = parent.symlink_metadata().map_err(|e| {
            format!(
                "Failed to read metadata for parent directory {}: {}",
                parent.display(),
                e
            )
        })?;
        if metadata.file_type().is_symlink() {
            return Err("Symlink parent directories are not allowed".to_string());
        }
    }
    Ok(())
}

/// A user folder from the OS, or `None` under `cfg(test)`.
///
/// Production uses the known-folder APIs so Windows folder redirection - a
/// Downloads moved into `OneDrive`, say - is honoured. Those APIs read the
/// account's real profile and consult neither `HOME` nor `CCHV_TEST_HOME`,
/// which is deliberate but leaves `is_safe_path` untestable: the allowlist
/// would name the developer's own Downloads, and the only way to exercise the
/// accept path would be to write there. That is exactly the mistake #536 and
/// #540 were about.
///
/// Returning `None` under test collapses each entry to its home-relative
/// fallback, so the whole allowlist derives from the sandboxed home and the
/// accept path becomes testable. The redirection branch itself is an OS call
/// with nothing to assert about (#541).
#[cfg(feature = "webui-server")]
fn known_folder(lookup: fn() -> Option<PathBuf>) -> Option<PathBuf> {
    if cfg!(test) {
        None
    } else {
        lookup()
    }
}

/// Validate that a path is within allowed directories.
///
/// Used by `WebUI` HTTP handlers to restrict file operations to safe directories.
/// Tauri desktop commands use [`validate_dialog_path`] instead (OS dialog guarantees user intent).
///
/// # Arguments
/// * `path` - Path to validate
///
/// # Returns
/// `Ok(())` if path is safe, error message if not
#[cfg(feature = "webui-server")]
pub(crate) fn is_safe_path(path: &Path) -> Result<(), String> {
    let home_raw = crate::utils::home_dir().ok_or("Could not find home directory")?;
    // Canonicalize home to resolve symlinks (e.g. macOS /var → /private/var)
    let home = home_raw.canonicalize().unwrap_or_else(|_| home_raw.clone());
    let home = strip_windows_prefix(&home);
    let mut allowed_dirs = vec![home.join(".claude-history-viewer").join("exports")];
    for (api_dir, fallback_name) in [
        (known_folder(dirs::download_dir), "Downloads"),
        (known_folder(dirs::document_dir), "Documents"),
        (known_folder(dirs::desktop_dir), "Desktop"),
    ] {
        let resolved = api_dir.unwrap_or_else(|| home.join(fallback_name));
        let resolved =
            strip_windows_prefix(&resolved.canonicalize().unwrap_or_else(|_| resolved.clone()));
        allowed_dirs.push(resolved);
    }

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

    // Strip \\?\ prefix on Windows for consistent comparison
    // (canonicalize() returns \\?\C:\... but home_dir() returns C:\...)
    let canonical = strip_windows_prefix(&canonical);

    if allowed_dirs.iter().any(|d| canonical.starts_with(d)) {
        Ok(())
    } else {
        Err("Path not in allowed directories".to_string())
    }
}

/// Strip the `\\?\` extended-length path prefix that Windows `canonicalize()` adds.
///
/// On non-Windows platforms this is a no-op (the prefix never appears).
fn strip_windows_prefix(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path.to_path_buf()
    }
}

/// Write text content to a file chosen by user via native dialog.
///
/// Path is validated for basic safety (absolute, no traversal, parent exists).
/// Directory allowlisting for `WebUI` callers is enforced at the HTTP handler layer.
///
/// # Arguments
/// * `path` - Absolute path chosen by user via save dialog
/// * `content` - Text content to write
#[tauri::command]
pub async fn write_text_file(path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(path);

        validate_dialog_path(&path)?;

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

/// Save screenshot binary data to a user-selected path.
///
/// The path is expected to come from a native save dialog and must be absolute.
/// Directory allowlisting for `WebUI` callers is enforced at the HTTP handler layer.
///
/// # Arguments
/// * `path` - Absolute path chosen by user via save dialog
/// * `data` - Base64-encoded PNG data
#[tauri::command]
pub async fn save_screenshot(path: String, data: String) -> Result<(), String> {
    use base64::Engine;
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&path);
        validate_dialog_path(&path)?;

        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&data)
            .map_err(|e| format!("Base64 decode error: {e}"))?;

        // Atomic write: temp file + rename
        let temp_path = path.with_extension("tmp");
        let mut file = fs::File::create(&temp_path)
            .map_err(|e| format!("Failed to create temp file {}: {}", temp_path.display(), e))?;
        file.write_all(&bytes)
            .map_err(|e| format!("Failed to write temp file: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("Failed to sync temp file: {e}"))?;
        super::fs_utils::atomic_rename(&temp_path, &path)?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Read text content from a file chosen by user via native dialog.
///
/// Path is validated for basic safety (absolute, no traversal, parent exists).
/// Directory allowlisting for `WebUI` callers is enforced at the HTTP handler layer.
///
/// # Arguments
/// * `path` - Absolute path chosen by user via open dialog
#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(path);

        validate_dialog_path(&path)?;

        fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read file {}: {}", path.display(), e))
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use tempfile::TempDir;

    /// Sets up a test environment with a temporary home directory.
    ///
    /// Sets `CCHV_TEST_HOME`, which `settings_home_dir()` reads under
    /// `cfg(test)`. It also still sets `HOME`, because other helpers reached
    /// from these tests resolve through `dirs::home_dir()` directly and behave
    /// correctly with it on Unix.
    ///
    /// `HOME` alone was the previous mechanism and is not enough: on Windows
    /// `dirs::home_dir()` uses the known-folder API and ignores it, so the
    /// sandbox silently did nothing and writes landed on the real
    /// `~/.claude/settings.json`.
    ///
    /// NOTE: Tests using this MUST run with --test-threads=1 because
    /// `env::set_var` is process-global and not thread-safe.
    fn setup_test_env() -> TempDir {
        let temp_dir = TempDir::new().unwrap();
        env::set_var("CCHV_TEST_HOME", temp_dir.path());
        env::set_var("HOME", temp_dir.path());
        temp_dir
    }

    #[test]
    fn test_get_user_settings_path() {
        let temp = setup_test_env();
        let path = get_user_settings_path().unwrap();
        assert!(path.to_string_lossy().contains(".claude"));
        assert!(path.to_string_lossy().ends_with("settings.json"));
        drop(temp);
    }

    /// The assertion the test above was missing.
    ///
    /// "contains `.claude`" and "ends with settings.json" were both true of the
    /// developer's REAL settings file, so that test passed happily while the
    /// sandbox did nothing on Windows and `test_save_and_retrieve_user_settings`
    /// overwrote a 22-key config with `{"theme":"dark","fontSize":14}`.
    ///
    /// Anchoring the resolved path inside the temp directory is what actually
    /// proves the sandbox holds. This fails on Windows without the
    /// `CCHV_TEST_HOME` indirection, which is the point.
    #[test]
    fn settings_paths_stay_inside_the_sandbox() {
        let temp = setup_test_env();
        for path in [
            get_user_settings_path().unwrap(),
            get_user_mcp_path().unwrap(),
            get_claude_json_path().unwrap(),
        ] {
            assert!(
                path.starts_with(temp.path()),
                "path escaped the test sandbox: {} is not under {}",
                path.display(),
                temp.path().display()
            );
        }
        drop(temp);
    }

    #[test]
    fn test_read_nonexistent_settings() {
        let temp = setup_test_env();
        let path = temp.path().join("nonexistent.json");
        let result = read_settings_file(&path).unwrap();
        assert_eq!(result, "{}");
        drop(temp);
    }

    #[test]
    fn test_write_and_read_settings() {
        let temp = setup_test_env();
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
        let temp = setup_test_env();
        let path = temp.path().join("invalid.json");
        let result = write_settings_file(&path, "not valid json");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid JSON"));
        drop(temp);
    }

    #[test]
    fn test_atomic_write_creates_dirs() {
        let temp = setup_test_env();
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
        let temp = setup_test_env();
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
        let temp = setup_test_env();
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
        let temp = setup_test_env();
        let result = get_mcp_servers().await;
        assert!(result.is_ok());

        let mcp = result.unwrap();
        assert!(mcp.servers.is_object());
        assert_eq!(mcp.servers.as_object().unwrap().len(), 0);

        drop(temp);
    }

    #[tokio::test]
    async fn test_get_mcp_servers_merges_sources() {
        let temp = setup_test_env();
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
        let temp = setup_test_env();
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
    async fn test_save_mcp_servers_merges_into_existing_claude_json() {
        let temp = setup_test_env();
        let path = temp.path().join(".claude.json");
        fs::write(&path, r#"{"oauthAccount":{"id":"a"},"projects":{}}"#).unwrap();

        save_mcp_servers(
            "user_claude_json".to_string(),
            r#"{"s":{"command":"c"}}"#.to_string(),
            None,
        )
        .await
        .unwrap();

        let saved: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved["oauthAccount"]["id"], "a");
        assert_eq!(saved["mcpServers"]["s"]["command"], "c");
        drop(temp);
    }

    #[tokio::test]
    async fn test_save_mcp_servers_refuses_to_clobber_unparseable_claude_json() {
        let temp = setup_test_env();
        let path = temp.path().join(".claude.json");
        // e.g. a hand edit with a trailing comma, or a partial write
        let original = r#"{"oauthAccount":{"id":"a"},"projects":{},}"#;
        fs::write(&path, original).unwrap();

        let project_dir = temp.path().join("project").to_string_lossy().to_string();
        for (source, project) in [
            ("user_claude_json", None),
            ("local_claude_json", Some(project_dir.clone())),
        ] {
            let result = save_mcp_servers(
                source.to_string(),
                r#"{"s":{"command":"c"}}"#.to_string(),
                project,
            )
            .await;
            assert!(result.is_err(), "{source} should refuse to overwrite");
            assert!(result.unwrap_err().contains("not valid JSON"));
            assert_eq!(fs::read_to_string(&path).unwrap(), original);
        }
        drop(temp);
    }

    #[tokio::test]
    async fn test_save_mcp_servers_refuses_to_clobber_unparseable_settings_json() {
        let temp = setup_test_env();
        let claude_dir = temp.path().join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        let path = claude_dir.join("settings.json");
        let original = r#"{"model":"opus""#;
        fs::write(&path, original).unwrap();

        let result = save_mcp_servers("user_settings".to_string(), "{}".to_string(), None).await;
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
        drop(temp);
    }

    #[tokio::test]
    async fn test_save_mcp_servers_accepts_bom_prefixed_claude_json() {
        let temp = setup_test_env();
        let path = temp.path().join(".claude.json");
        fs::write(&path, "\u{feff}{\"oauthAccount\":{\"id\":\"a\"}}").unwrap();

        save_mcp_servers("user_claude_json".to_string(), "{}".to_string(), None)
            .await
            .unwrap();

        let saved: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved["oauthAccount"]["id"], "a");
        drop(temp);
    }

    #[tokio::test]
    async fn test_save_and_retrieve_user_settings() {
        let temp = setup_test_env();
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

    #[test]
    fn test_validate_dialog_path_absolute_accepted() {
        let temp = setup_test_env();
        let path = temp.path().join("test.txt");
        assert!(validate_dialog_path(&path).is_ok());
        drop(temp);
    }

    #[test]
    fn test_validate_dialog_path_relative_rejected() {
        let path = Path::new("relative/path.txt");
        let result = validate_dialog_path(path);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("absolute"));
    }

    #[test]
    fn test_validate_dialog_path_parent_dir_rejected() {
        let raw = crate::test_utils::abs("some/path/../escape.txt");
        let path = Path::new(&raw);
        let result = validate_dialog_path(path);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("'..'"));
    }

    #[test]
    fn test_validate_dialog_path_nonexistent_parent_rejected() {
        let raw = crate::test_utils::abs("nonexistent_dir_abc123/file.txt");
        let path = Path::new(&raw);
        let result = validate_dialog_path(path);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[cfg(unix)]
    #[test]
    fn test_validate_dialog_path_symlink_parent_rejected() {
        let temp = setup_test_env();
        let real_dir = temp.path().join("real_dir");
        fs::create_dir_all(&real_dir).unwrap();
        let symlink_dir = temp.path().join("symlink_dir");
        std::os::unix::fs::symlink(&real_dir, &symlink_dir).unwrap();
        let file_path = symlink_dir.join("test.txt");

        let result = validate_dialog_path(&file_path);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Symlink"));
        drop(temp);
    }

    #[tokio::test]
    async fn test_write_text_file_to_temp_dir() {
        let temp = setup_test_env();
        let file_path = temp.path().join("export-test.md");
        let content = "# Test Export\nHello world".to_string();

        let result =
            write_text_file(file_path.to_string_lossy().to_string(), content.clone()).await;
        assert!(result.is_ok());
        assert_eq!(fs::read_to_string(&file_path).unwrap(), content);
        drop(temp);
    }

    #[tokio::test]
    async fn test_write_text_file_relative_path_rejected() {
        let result = write_text_file("relative/path.txt".to_string(), "content".to_string()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("absolute"));
    }

    #[tokio::test]
    async fn test_read_text_file_success() {
        let temp = setup_test_env();
        let file_path = temp.path().join("read-test.json");
        fs::write(&file_path, r#"{"key":"value"}"#).unwrap();

        let result = read_text_file(file_path.to_string_lossy().to_string()).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), r#"{"key":"value"}"#);
        drop(temp);
    }

    #[tokio::test]
    async fn test_read_text_file_nonexistent_returns_error() {
        let temp = setup_test_env();
        let file_path = temp.path().join("does-not-exist.json");

        let result = read_text_file(file_path.to_string_lossy().to_string()).await;
        assert!(result.is_err());
        drop(temp);
    }

    #[cfg(feature = "webui-server")]
    #[test]
    fn test_strip_windows_prefix_with_prefix() {
        let path = Path::new(r"\\?\C:\Users\test");
        let result = strip_windows_prefix(path);
        assert_eq!(result, PathBuf::from(r"C:\Users\test"));
    }

    #[cfg(feature = "webui-server")]
    #[test]
    fn test_strip_windows_prefix_without_prefix() {
        let path = Path::new("/normal/unix/path");
        let result = strip_windows_prefix(path);
        assert_eq!(result, PathBuf::from("/normal/unix/path"));
    }

    #[cfg(feature = "webui-server")]
    #[test]
    fn test_strip_windows_prefix_empty() {
        let path = Path::new("");
        let result = strip_windows_prefix(path);
        assert_eq!(result, PathBuf::from(""));
    }

    #[cfg(feature = "webui-server")]
    #[test]
    fn test_is_safe_path_downloads_accepted() {
        let temp = setup_test_env();
        let downloads = temp.path().join("Downloads");
        fs::create_dir_all(&downloads).unwrap();
        let file_path = downloads.join("export.md");
        fs::write(&file_path, "test").unwrap();

        let result = is_safe_path(&file_path);
        assert!(result.is_ok());
        drop(temp);
    }

    #[cfg(feature = "webui-server")]
    #[test]
    fn test_is_safe_path_desktop_accepted() {
        let temp = setup_test_env();
        let desktop = temp.path().join("Desktop");
        fs::create_dir_all(&desktop).unwrap();
        let file_path = desktop.join("export.md");
        fs::write(&file_path, "test").unwrap();

        let result = is_safe_path(&file_path);
        assert!(result.is_ok());
        drop(temp);
    }

    #[cfg(feature = "webui-server")]
    #[test]
    fn test_is_safe_path_disallowed_dir_rejected() {
        let temp = setup_test_env();
        let random_dir = temp.path().join("SomeRandomDir");
        fs::create_dir_all(&random_dir).unwrap();
        let file_path = random_dir.join("export.md");
        fs::write(&file_path, "test").unwrap();

        let result = is_safe_path(&file_path);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not in allowed directories"));
        drop(temp);
    }

    // ─── Symlinks inside a project directory ─────────────────────────────

    /// A project whose `.claude` is a link to another directory, the way a
    /// checked-out repository can ship it. Returns (project, link target).
    #[cfg(unix)]
    fn project_with_linked_claude_dir(temp: &TempDir) -> (PathBuf, PathBuf) {
        let project = temp.path().join("repo");
        let elsewhere = temp.path().join("elsewhere");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(&elsewhere).unwrap();
        std::os::unix::fs::symlink(&elsewhere, project.join(".claude")).unwrap();
        (project, elsewhere)
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn save_settings_refuses_linked_claude_dir() {
        let temp = setup_test_env();
        let (project, elsewhere) = project_with_linked_claude_dir(&temp);

        for scope in ["project", "local"] {
            let res = save_settings(
                scope.to_string(),
                "{}".to_string(),
                Some(project.to_string_lossy().to_string()),
            )
            .await;
            assert!(res.is_err(), "{scope}: wrote through a linked .claude");
        }
        assert_eq!(fs::read_dir(&elsewhere).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn write_settings_file_does_not_write_through_linked_temp_file() {
        let temp = setup_test_env();
        let dir = temp.path().join("repo");
        fs::create_dir_all(&dir).unwrap();
        let outside = temp.path().join("outside.json");
        fs::write(&outside, "original").unwrap();
        std::os::unix::fs::symlink(&outside, dir.join(".mcp.json.tmp")).unwrap();

        let target = dir.join(".mcp.json");
        write_settings_file(&target, "{}").unwrap();

        assert_eq!(fs::read_to_string(&outside).unwrap(), "original");
        assert_eq!(fs::read_to_string(&target).unwrap(), "{}");
    }

    #[cfg(unix)]
    #[test]
    fn write_settings_file_replaces_linked_target_instead_of_following_it() {
        let temp = setup_test_env();
        let dir = temp.path().join("repo");
        fs::create_dir_all(&dir).unwrap();
        let outside = temp.path().join("outside.json");
        fs::write(&outside, "original").unwrap();
        let target = dir.join(".mcp.json");
        std::os::unix::fs::symlink(&outside, &target).unwrap();

        write_settings_file(&target, "{}").unwrap();

        assert_eq!(fs::read_to_string(&outside).unwrap(), "original");
        assert!(!target.symlink_metadata().unwrap().file_type().is_symlink());
    }

    #[tokio::test]
    async fn local_claude_json_keys_projects_by_canonical_path() {
        let temp = setup_test_env();
        let project = temp.path().join("repo");
        fs::create_dir_all(&project).unwrap();
        let canonical = strip_windows_prefix(&project.canonicalize().unwrap())
            .to_string_lossy()
            .to_string();
        let with_trailing_separator = format!("{canonical}{}", std::path::MAIN_SEPARATOR);

        save_mcp_servers(
            "local_claude_json".to_string(),
            r#"{"s":{"command":"c"}}"#.to_string(),
            Some(with_trailing_separator),
        )
        .await
        .unwrap();

        let saved: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(temp.path().join(".claude.json")).unwrap())
                .unwrap();
        let keys: Vec<&String> = saved["projects"].as_object().unwrap().keys().collect();
        assert_eq!(keys, vec![&canonical]);
    }
}
