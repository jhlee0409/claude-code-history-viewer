//! Tauri commands for user metadata management
//!
//! This module provides commands for loading, saving, and updating
//! user metadata stored in ~/.claude-history-viewer/user-data.json

use crate::models::{ProjectMetadata, SessionMetadata, UserMetadata, UserSettings};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

/// Validate a metadata project key.
///
/// Allowed formats:
/// - absolute filesystem paths (Claude projects)
/// - `codex://<cwd>` virtual project keys
/// - `opencode://<project_id>` virtual project keys
pub(crate) fn validate_project_metadata_key(project_path: &str) -> Result<(), String> {
    if let Some(cwd) = project_path.strip_prefix("codex://") {
        if !cwd.trim().is_empty() {
            return Ok(());
        }
        return Err("Codex project key must not be empty".to_string());
    }

    if let Some(project_id) = project_path.strip_prefix("opencode://") {
        if crate::utils::is_safe_storage_id(project_id) {
            return Ok(());
        }
        return Err(format!("Invalid OpenCode project key: {project_path}"));
    }

    let path = Path::new(project_path);
    if !path.is_absolute() {
        return Err(format!(
            "Project key must be absolute path or provider virtual path, got: {project_path}"
        ));
    }

    Ok(())
}

/// Application state for metadata management
pub struct MetadataState {
    /// Cached metadata with mutex for thread-safe access
    pub metadata: Mutex<Option<UserMetadata>>,
    /// Held across read → merge → disk write → cache update so concurrent
    /// writers cannot overwrite each other's changes. Async so it may be held
    /// across `.await`; readers only take the `metadata` lock.
    pub(crate) write_lock: tauri::async_runtime::Mutex<()>,
}

impl Default for MetadataState {
    fn default() -> Self {
        Self {
            metadata: Mutex::new(None),
            write_lock: tauri::async_runtime::Mutex::new(()),
        }
    }
}

/// Apply `mutate` to the current metadata, persist it, then update the cache,
/// all under `write_lock`. Every metadata writer goes through here. The cache
/// is only replaced once the disk write succeeded.
pub(crate) async fn mutate_and_save<F>(
    state: &MetadataState,
    mutate: F,
) -> Result<UserMetadata, String>
where
    F: FnOnce(&mut UserMetadata) + Send + 'static,
{
    let _write = state.write_lock.lock().await;
    let mut metadata = state
        .metadata
        .lock()
        .map_err(|e| format!("Failed to lock metadata: {e}"))?
        .clone()
        .unwrap_or_else(UserMetadata::new);

    let saved = tauri::async_runtime::spawn_blocking(move || {
        mutate(&mut metadata);
        save_metadata_to_disk(&metadata).map(|()| metadata)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))??;

    *state
        .metadata
        .lock()
        .map_err(|e| format!("Failed to lock metadata: {e}"))? = Some(saved.clone());
    Ok(saved)
}

/// Get the metadata folder path (~/.claude-history-viewer)
fn get_metadata_folder() -> Result<PathBuf, String> {
    let home = crate::utils::home_dir().ok_or("Could not find home directory")?;
    Ok(home.join(".claude-history-viewer"))
}

/// Get the user data file path (~/.claude-history-viewer/user-data.json)
pub(crate) fn get_user_data_path() -> Result<PathBuf, String> {
    Ok(get_metadata_folder()?.join("user-data.json"))
}

/// Ensure the metadata folder exists
fn ensure_metadata_folder() -> Result<PathBuf, String> {
    let folder = get_metadata_folder()?;
    if !folder.exists() {
        fs::create_dir_all(&folder)
            .map_err(|e| format!("Failed to create metadata folder: {e}"))?;
    }
    Ok(folder)
}

/// Get the metadata folder path
#[tauri::command]
pub async fn get_metadata_folder_path() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let path = get_metadata_folder()?;
        Ok(path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Load user metadata from disk
/// Creates default metadata if file doesn't exist
#[tauri::command]
pub async fn load_user_metadata(state: State<'_, MetadataState>) -> Result<UserMetadata, String> {
    // A load racing a save must not put the pre-save file back in the cache.
    let _write = state.write_lock.lock().await;
    let path = get_user_data_path()?;

    // Perform blocking file I/O off the async runtime
    let metadata = tauri::async_runtime::spawn_blocking(move || {
        if path.exists() {
            let content = fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read metadata file: {e}"))?;
            serde_json::from_str(&content).map_err(|e| format!("Failed to parse metadata: {e}"))
        } else {
            Ok(UserMetadata::new())
        }
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))??;

    // Cache the metadata (lock is quick, no need to spawn_blocking)
    let mut cached = state
        .metadata
        .lock()
        .map_err(|e| format!("Failed to lock metadata: {e}"))?;
    *cached = Some(metadata.clone());

    Ok(metadata)
}

/// Internal helper to save metadata to disk (blocking)
pub(crate) fn save_metadata_to_disk(metadata: &UserMetadata) -> Result<(), String> {
    ensure_metadata_folder()?;
    let path = get_user_data_path()?;

    // Write to temp file first (atomic write pattern)
    let temp_path = path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(metadata)
        .map_err(|e| format!("Failed to serialize metadata: {e}"))?;

    let mut file =
        fs::File::create(&temp_path).map_err(|e| format!("Failed to create temp file: {e}"))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write temp file: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("Failed to sync temp file: {e}"))?;

    // Cross-platform atomic rename
    super::fs_utils::atomic_rename(&temp_path, &path)?;

    Ok(())
}

/// Save user metadata to disk with atomic write
#[tauri::command]
pub async fn save_user_metadata(
    metadata: UserMetadata,
    state: State<'_, MetadataState>,
) -> Result<(), String> {
    mutate_and_save(state.inner(), move |m| *m = metadata).await?;
    Ok(())
}

/// Update metadata for a specific session
#[tauri::command]
pub async fn update_session_metadata(
    session_id: String,
    update: SessionMetadata,
    state: State<'_, MetadataState>,
) -> Result<UserMetadata, String> {
    update_session_metadata_in(state.inner(), session_id, update).await
}

pub(crate) async fn update_session_metadata_in(
    state: &MetadataState,
    session_id: String,
    update: SessionMetadata,
) -> Result<UserMetadata, String> {
    mutate_and_save(state, move |metadata| {
        if update.is_empty() {
            metadata.sessions.remove(&session_id);
        } else {
            metadata.sessions.insert(session_id, update);
        }
    })
    .await
}

/// Update metadata for a specific project
#[tauri::command]
pub async fn update_project_metadata(
    project_path: String,
    update: ProjectMetadata,
    state: State<'_, MetadataState>,
) -> Result<UserMetadata, String> {
    // Validate that project path is absolute
    validate_project_metadata_key(&project_path)?;

    mutate_and_save(state.inner(), move |metadata| {
        if update.is_empty() {
            metadata.projects.remove(&project_path);
        } else {
            metadata.projects.insert(project_path, update);
        }
    })
    .await
}

/// Update global user settings
#[tauri::command]
pub async fn update_user_settings(
    settings: UserSettings,
    state: State<'_, MetadataState>,
) -> Result<UserMetadata, String> {
    mutate_and_save(state.inner(), move |metadata| metadata.settings = settings).await
}

/// Check if a project should be hidden based on metadata
#[tauri::command]
pub async fn is_project_hidden(
    project_path: String,
    state: State<'_, MetadataState>,
) -> Result<bool, String> {
    // Validate that project path is absolute
    validate_project_metadata_key(&project_path)?;

    let cached = state
        .metadata
        .lock()
        .map_err(|e| format!("Failed to lock metadata: {e}"))?;

    let is_hidden = cached
        .as_ref()
        .map(|m| m.is_project_hidden(&project_path))
        .unwrap_or(false);

    Ok(is_hidden)
}

/// Get the display name for a session (custom name or fallback to summary)
#[tauri::command]
pub async fn get_session_display_name(
    session_id: String,
    fallback_summary: Option<String>,
    state: State<'_, MetadataState>,
) -> Result<Option<String>, String> {
    let cached = state
        .metadata
        .lock()
        .map_err(|e| format!("Failed to lock metadata: {e}"))?;

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
    use std::sync::{LazyLock, Mutex, MutexGuard};
    use tempfile::TempDir;

    /// Static mutex to serialize tests that modify the HOME environment variable.
    /// This prevents race conditions when multiple tests run in parallel.
    static TEST_ENV_MUTEX: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    /// Sets up a test environment with a temporary HOME directory.
    /// Returns both the mutex guard (to hold the lock) and the `TempDir`.
    /// The guard must be kept alive for the duration of the test.
    fn setup_test_env() -> (MutexGuard<'static, ()>, TempDir) {
        let guard = TEST_ENV_MUTEX.lock().unwrap();
        let temp_dir = TempDir::new().unwrap();
        env::set_var("HOME", temp_dir.path());
        // `HOME` is inert on Windows; this is what `crate::utils::home_dir()`
        // reads under `cfg(test)` (#540).
        env::set_var("CCHV_TEST_HOME", temp_dir.path());
        (guard, temp_dir)
    }

    #[test]
    fn test_get_metadata_folder() {
        let (_guard, _temp) = setup_test_env();
        let folder = get_metadata_folder().unwrap();
        assert!(folder.to_string_lossy().contains(".claude-history-viewer"));
    }

    #[test]
    fn test_ensure_metadata_folder() {
        let (_guard, _temp) = setup_test_env();
        let folder = ensure_metadata_folder().unwrap();
        assert!(folder.exists());
    }

    #[test]
    fn test_atomic_write() {
        let (_guard, temp) = setup_test_env();

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

    /// Concurrent updates to different sessions must all reach disk: each
    /// writer's read-merge-write has to be serialized, or an older snapshot
    /// overwrites a newer one.
    #[test]
    fn concurrent_session_updates_are_all_persisted() {
        const N: usize = 16;
        let (_guard, _temp) = setup_test_env();
        let state = MetadataState::default();
        let barrier = std::sync::Barrier::new(N);

        let results: Vec<Result<UserMetadata, String>> = std::thread::scope(|s| {
            let handles: Vec<_> = (0..N)
                .map(|i| {
                    let (state, barrier) = (&state, &barrier);
                    s.spawn(move || {
                        let update = SessionMetadata {
                            custom_name: Some(format!("name-{i}")),
                            ..Default::default()
                        };
                        barrier.wait();
                        tauri::async_runtime::block_on(update_session_metadata_in(
                            state,
                            format!("session-{i}"),
                            update,
                        ))
                    })
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });

        for r in &results {
            assert!(r.is_ok(), "update failed: {r:?}");
        }
        let on_disk: UserMetadata =
            serde_json::from_str(&fs::read_to_string(get_user_data_path().unwrap()).unwrap())
                .unwrap();
        assert_eq!(on_disk.sessions.len(), N, "disk lost updates");
        let cached = state.metadata.lock().unwrap().clone().unwrap();
        assert_eq!(cached.sessions.len(), N, "cache lost updates");
    }

    #[test]
    fn test_validate_project_metadata_key_absolute_path() {
        assert!(validate_project_metadata_key(&crate::test_utils::abs("tmp/project")).is_ok());
    }

    #[test]
    fn test_validate_project_metadata_key_virtual_provider_paths() {
        assert!(validate_project_metadata_key("codex:///Users/test/workspace").is_ok());
        assert!(validate_project_metadata_key("opencode://project_123").is_ok());
    }

    #[test]
    fn test_validate_project_metadata_key_rejects_invalid_values() {
        assert!(validate_project_metadata_key("relative/path").is_err());
        assert!(validate_project_metadata_key("codex://").is_err());
        assert!(validate_project_metadata_key("opencode://../etc").is_err());
    }
}
