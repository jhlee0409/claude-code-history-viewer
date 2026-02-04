use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebouncedEvent, DebouncedEventKind, Debouncer};
use serde::{Deserialize, Serialize};
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

/// Start watching the Claude projects directory for file changes
#[tauri::command]
pub async fn start_file_watcher(
    app_handle: AppHandle,
    claude_folder_path: String,
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

fn handle_file_event(app_handle: &AppHandle, event: &DebouncedEvent) {
    let path = &event.path;

    // Only process .jsonl files
    if let Some(ext) = path.extension() {
        if ext != "jsonl" {
            return;
        }
    } else {
        return;
    }

    // Extract project path and session path
    let Some((project_path, session_path)) = extract_paths(path) else {
        log::warn!("Could not extract paths from: {}", path.display());
        return;
    };

    // Determine event type based on DebouncedEventKind
    // All events are treated as "changed" since debouncer aggregates events
    let event_type = match event.kind {
        DebouncedEventKind::Any | DebouncedEventKind::AnyContinuous | _ => "session-file-changed",
    };

    let watch_event = FileWatchEvent {
        project_path: project_path.to_string_lossy().to_string(),
        session_path: session_path.to_string_lossy().to_string(),
        event_type: event_type.to_string(),
    };

    // Emit Tauri event to frontend
    if let Err(e) = app_handle.emit(event_type, &watch_event) {
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
