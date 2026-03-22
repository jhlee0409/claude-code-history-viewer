use crate::utils::is_safe_storage_id;
use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebouncedEvent, DebouncedEventKind, Debouncer};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWatchEvent {
    pub project_path: String,
    pub session_path: String,
    pub event_type: String,
}

type WatcherMap = Arc<Mutex<Option<Debouncer<RecommendedWatcher>>>>;
type OpenCodeSessionCache = HashMap<String, String>;

static OPENCODE_SESSION_PROJECT_CACHE: std::sync::OnceLock<Mutex<OpenCodeSessionCache>> =
    std::sync::OnceLock::new();

/// Start watching the Claude projects directory for file changes
#[tauri::command]
pub async fn start_file_watcher(
    app_handle: AppHandle,
    claude_folder_path: String,
    custom_claude_paths: Option<Vec<super::multi_provider::CustomClaudePathParam>>,
) -> Result<String, String> {
    let base_path = PathBuf::from(&claude_folder_path);
    let projects_path = base_path.join("projects");

    // Reject symlinks to prevent symlink attacks
    let base_meta = std::fs::symlink_metadata(&base_path)
        .map_err(|e| format!("Cannot read metadata for base path: {e}"))?;
    if base_meta.file_type().is_symlink() {
        return Err("Claude folder path must not be a symlink".to_string());
    }

    let projects_meta = std::fs::symlink_metadata(&projects_path)
        .map_err(|e| format!("Cannot read metadata for projects path: {e}"))?;
    if projects_meta.file_type().is_symlink() {
        return Err("Projects directory must not be a symlink".to_string());
    }

    // Canonicalize and verify path traversal safety
    let canonical_base = std::fs::canonicalize(&base_path)
        .map_err(|e| format!("Failed to canonicalize base path: {e}"))?;
    let canonical_projects = std::fs::canonicalize(&projects_path)
        .map_err(|e| format!("Failed to canonicalize projects path: {e}"))?;

    if !canonical_projects.starts_with(&canonical_base) {
        return Err("Projects path escapes the allowed base directory".to_string());
    }

    // Verify it is a directory
    if !canonical_projects.is_dir() {
        return Err(format!(
            "Projects path is not a directory: {}",
            canonical_projects.display()
        ));
    }

    // Create a debounced watcher
    let app_handle_clone = app_handle.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(500),
        move |result: Result<Vec<DebouncedEvent>, notify::Error>| match result {
            Ok(events) => {
                for event in events {
                    handle_file_event(&app_handle_clone, &event);
                }
            }
            Err(error) => {
                log::error!("File watcher error: {error:?}");
            }
        },
    )
    .map_err(|e| format!("Failed to create file watcher: {e}"))?;

    // Start watching the canonicalized projects directory recursively
    debouncer
        .watcher()
        .watch(&canonical_projects, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch directory: {e}"))?;

    // Also watch custom Claude directories if provided
    if let Some(custom_paths) = custom_claude_paths {
        for custom in &custom_paths {
            let custom_base = PathBuf::from(&custom.path);
            match crate::utils::validate_custom_claude_path(&custom_base) {
                Ok(canonical_projects) => {
                    if debouncer
                        .watcher()
                        .watch(&canonical_projects, RecursiveMode::Recursive)
                        .is_ok()
                    {
                        log::info!(
                            "File watcher added custom path: {}",
                            canonical_projects.display()
                        );
                    }
                }
                Err(e) => {
                    log::warn!("Skipping invalid custom watch path: {e}");
                }
            }
        }
    }

    // Store the debouncer in app state to prevent it from being dropped
    let watcher_state: tauri::State<WatcherMap> = app_handle.state();
    let mut watcher = watcher_state.lock().unwrap();
    *watcher = Some(debouncer);

    log::info!("File watcher started for: {}", canonical_projects.display());
    Ok("watcher-started".to_string())
}

/// Stop the file watcher
#[tauri::command]
pub async fn stop_file_watcher(app_handle: AppHandle) -> Result<(), String> {
    let watcher_state: tauri::State<WatcherMap> = app_handle.state();
    let mut watcher = watcher_state.lock().unwrap();

    if watcher.is_some() {
        *watcher = None;
        log::info!("File watcher stopped");
        Ok(())
    } else {
        Err("No active file watcher found".to_string())
    }
}

/// Convert a debounced filesystem event into a [`FileWatchEvent`] if applicable.
///
/// Returns `None` for non-`.jsonl` files or if project/session paths cannot be
/// extracted.  This is the shared core used by both the Tauri desktop watcher
/// and the `WebUI` SSE server watcher.
pub fn to_file_watch_event(event: &DebouncedEvent) -> Option<FileWatchEvent> {
    let path = &event.path;
    let (project_path, session_path) = extract_provider_paths(path)?;

    // Note: `notify_debouncer_mini` only provides `Any` / `AnyContinuous` kinds —
    // it does not distinguish create vs modify vs delete.  All events are emitted
    // as "session-file-changed" and the frontend treats them uniformly as a
    // signal to refresh the affected session data.
    let event_type = match event.kind {
        DebouncedEventKind::Any | DebouncedEventKind::AnyContinuous | _ => "session-file-changed",
    };

    Some(FileWatchEvent {
        project_path,
        session_path,
        event_type: event_type.to_string(),
    })
}

/// Extract provider-specific project/session identifiers from changed file path.
fn extract_provider_paths(path: &Path) -> Option<(String, String)> {
    let ext = path.extension()?.to_str()?;
    match ext {
        // Claude + Codex rollout logs
        "jsonl" => {
            if let Some((project_path, session_path)) = extract_paths(path) {
                return Some((
                    project_path.to_string_lossy().to_string(),
                    session_path.to_string_lossy().to_string(),
                ));
            }
            extract_codex_paths(path)
        }
        // OpenCode storage files
        "json" => extract_opencode_paths(path),
        // OpenCode SQLite database change — emit broad refresh for all OpenCode projects
        "db" | "db-wal" => extract_opencode_db_event(path),
        _ => None,
    }
}

fn handle_file_event(app_handle: &AppHandle, event: &DebouncedEvent) {
    let Some(watch_event) = to_file_watch_event(event) else {
        return;
    };

    if let Err(e) = app_handle.emit(&watch_event.event_type, &watch_event) {
        log::error!("Failed to emit file watch event: {e}");
    }
}

/// Extract project path and session path from a `.jsonl` file path
///
/// Expected format: `~/.claude/projects/{project_name}/{session_file}.jsonl`
fn extract_paths(path: &Path) -> Option<(PathBuf, PathBuf)> {
    let components: Vec<_> = path.components().collect();
    let len = components.len();

    // Need at least: [..., "projects", "project_name", "file.jsonl"]
    if len < 3 {
        return None;
    }

    // Find the "projects" component
    let projects_idx = components
        .iter()
        .position(|c| c.as_os_str() == "projects")?;

    // Ensure we have at least project_name and filename after "projects"
    if projects_idx + 2 >= len {
        return None;
    }

    // Reconstruct project path: everything up to and including project_name
    let mut project_path = PathBuf::new();
    for component in &components[..=projects_idx + 1] {
        project_path.push(component);
    }

    // Session path is the full path
    let session_path = path.to_path_buf();

    Some((project_path, session_path))
}

/// Extract Codex session identifier from rollout log files.
///
/// Codex rollout files are watched from `~/.codex/sessions` and
/// `~/.codex/archived_sessions`. We always emit a stable pseudo-project key so
/// the frontend can at least refresh active sessions by `session_path`.
fn extract_codex_paths(path: &Path) -> Option<(String, String)> {
    let filename = path.file_name()?.to_string_lossy();
    if !filename.starts_with("rollout-") {
        return None;
    }

    let components: Vec<_> = path.components().collect();
    let has_codex_root = components.iter().any(|c| {
        let s = c.as_os_str();
        s == "sessions" || s == "archived_sessions"
    });
    if !has_codex_root {
        return None;
    }

    Some((
        "codex://watch".to_string(),
        path.to_string_lossy().to_string(),
    ))
}

/// Handle `OpenCode` `SQLite` database file changes.
///
/// Since we cannot determine which project/session changed from a DB write,
/// emit a broad event with `"opencode://*"` so the frontend refreshes all
/// `OpenCode` data.
fn extract_opencode_db_event(path: &Path) -> Option<(String, String)> {
    let filename = path.file_name()?.to_str()?;
    if filename.starts_with("opencode.") {
        Some(("opencode://*".to_string(), "opencode://*".to_string()))
    } else {
        None
    }
}

/// Extract `OpenCode` virtual identifiers from storage JSON files.
///
/// Supported paths:
/// - `<base>/storage/session/<project_id>/<session_id>.json`
/// - `<base>/storage/message/<session_id>/*.json`
fn extract_opencode_paths(path: &Path) -> Option<(String, String)> {
    let components: Vec<_> = path.components().collect();
    let storage_idx = components.iter().position(|c| c.as_os_str() == "storage")?;
    let kind = components.get(storage_idx + 1)?.as_os_str().to_str()?;

    match kind {
        "session" => {
            let storage_root = components_to_path(&components[..=storage_idx]);
            let project_id = components
                .get(storage_idx + 2)?
                .as_os_str()
                .to_string_lossy()
                .to_string();
            if !is_safe_storage_id(&project_id) {
                return None;
            }

            let session_id = path.file_stem()?.to_string_lossy().to_string();
            if !is_safe_storage_id(&session_id) {
                return None;
            }

            remember_opencode_project_id(&storage_root, &session_id, &project_id);
            Some((
                format!("opencode://{project_id}"),
                format!("opencode://{project_id}/{session_id}"),
            ))
        }
        "message" => {
            let session_id = components
                .get(storage_idx + 2)?
                .as_os_str()
                .to_string_lossy()
                .to_string();
            if !is_safe_storage_id(&session_id) {
                return None;
            }

            let storage_root = components_to_path(&components[..=storage_idx]);
            let project_id = find_opencode_project_id(&storage_root, &session_id)?;
            Some((
                format!("opencode://{project_id}"),
                format!("opencode://{project_id}/{session_id}"),
            ))
        }
        _ => None,
    }
}

/// Resolve `OpenCode` `project_id` for a given `session_id` by scanning session manifests.
fn find_opencode_project_id(storage_root: &Path, session_id: &str) -> Option<String> {
    if let Some(cached) = get_cached_opencode_project_id(storage_root, session_id) {
        return Some(cached);
    }

    let session_root = storage_root.join("session");
    let entries = std::fs::read_dir(session_root).ok()?;

    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }

        let project_id = entry.file_name().to_string_lossy().to_string();
        if !is_safe_storage_id(&project_id) {
            continue;
        }

        let manifest = entry.path().join(format!("{session_id}.json"));
        if manifest.is_file() {
            remember_opencode_project_id(storage_root, session_id, &project_id);
            return Some(project_id);
        }
    }

    None
}

fn components_to_path(components: &[std::path::Component<'_>]) -> PathBuf {
    let mut p = PathBuf::new();
    for component in components {
        p.push(component.as_os_str());
    }
    p
}

fn opencode_cache_key(storage_root: &Path, session_id: &str) -> String {
    format!("{}::{session_id}", storage_root.to_string_lossy())
}

fn get_cached_opencode_project_id(storage_root: &Path, session_id: &str) -> Option<String> {
    let cache = OPENCODE_SESSION_PROJECT_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let key = opencode_cache_key(storage_root, session_id);
    let guard = cache.lock().ok()?;
    guard.get(&key).cloned()
}

fn remember_opencode_project_id(storage_root: &Path, session_id: &str, project_id: &str) {
    let cache = OPENCODE_SESSION_PROJECT_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let key = opencode_cache_key(storage_root, session_id);
    if let Ok(mut guard) = cache.lock() {
        guard.insert(key, project_id.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_extract_paths() {
        let path = PathBuf::from("/Users/test/.claude/projects/my-project/session.jsonl");
        let result = extract_paths(&path);

        assert!(result.is_some());
        let (project_path, session_path) = result.unwrap();

        assert!(project_path.ends_with("projects/my-project"));
        assert_eq!(session_path, path);
    }

    #[test]
    fn test_extract_paths_nested() {
        let path = PathBuf::from("/Users/test/.claude/projects/my-project/subfolder/session.jsonl");
        let result = extract_paths(&path);

        assert!(result.is_some());
        let (project_path, session_path) = result.unwrap();

        assert!(project_path.ends_with("projects/my-project"));
        assert_eq!(session_path, path);
    }

    #[test]
    fn test_extract_paths_invalid() {
        let path = PathBuf::from("/Users/test/session.jsonl");
        let result = extract_paths(&path);

        assert!(result.is_none());
    }

    #[test]
    fn test_extract_codex_paths() {
        let path = PathBuf::from("/Users/test/.codex/sessions/2025/10/rollout-abc.jsonl");
        let result = extract_codex_paths(&path).unwrap();

        assert_eq!(result.0, "codex://watch");
        assert_eq!(result.1, path.to_string_lossy());
    }

    #[test]
    fn test_extract_opencode_session_paths() {
        let path = PathBuf::from(
            "/Users/test/.local/share/opencode/storage/session/project_1/session_1.json",
        );
        let result = extract_opencode_paths(&path).unwrap();

        assert_eq!(result.0, "opencode://project_1");
        assert_eq!(result.1, "opencode://project_1/session_1");
    }

    #[test]
    fn test_extract_opencode_message_paths_with_manifest_lookup() {
        let temp = TempDir::new().unwrap();
        let storage = temp.path().join("storage");
        let session_dir = storage.join("session").join("project_1");
        let message_dir = storage.join("message").join("session_1");

        std::fs::create_dir_all(&session_dir).unwrap();
        std::fs::create_dir_all(&message_dir).unwrap();
        std::fs::write(session_dir.join("session_1.json"), "{}").unwrap();
        std::fs::write(message_dir.join("msg_1.json"), "{}").unwrap();

        let path = message_dir.join("msg_1.json");
        let result = extract_opencode_paths(&path).unwrap();

        assert_eq!(result.0, "opencode://project_1");
        assert_eq!(result.1, "opencode://project_1/session_1");
    }
}
