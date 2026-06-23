use crate::utils::is_safe_storage_id;
use lru::LruCache;
use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebouncedEvent, DebouncedEventKind, Debouncer};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWatchEvent {
    pub project_path: String,
    pub session_path: String,
    pub event_type: String,
}

type WatcherMap = Arc<Mutex<Option<Debouncer<RecommendedWatcher>>>>;

/// LRU cache for `OpenCode` session-to-project mappings, capped at 10,000 entries.
/// Each entry is ~150 bytes, bounding memory at ~1.5MB regardless of watcher activity.
///
/// Motivation: the file watcher calls `remember_opencode_project_id()` on every
/// `.jsonl` change event (debounced to 500ms). With a plain `HashMap` the cache
/// grew without bound for long-lived sessions — observed at multiple GB after a
/// few days of continuous use. An LRU evicts the least-recently-used keys once
/// capacity is reached, so memory stays flat.
type OpenCodeSessionCache = LruCache<String, String>;

static OPENCODE_SESSION_PROJECT_CACHE: std::sync::OnceLock<Mutex<OpenCodeSessionCache>> =
    std::sync::OnceLock::new();

/// Build the bounded `OpenCode` session-project cache (10,000-entry LRU).
fn create_opencode_cache() -> Mutex<OpenCodeSessionCache> {
    // 10,000 entries × ~150 bytes/entry ≈ 1.5MB peak.
    let capacity = NonZeroUsize::new(10_000).expect("10,000 is non-zero");
    Mutex::new(LruCache::new(capacity))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileSignature {
    len: u64,
    modified_unix_nanos: u64,
}

static WATCHED_FILE_SIGNATURES: OnceLock<Mutex<HashMap<PathBuf, FileSignature>>> = OnceLock::new();

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
    prime_watch_signatures(&canonical_projects);

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
                        prime_watch_signatures(&canonical_projects);
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

    if !record_content_signature_change(path) {
        return None;
    }

    // Note: `notify_debouncer_mini` only provides `Any` / `AnyContinuous` kinds,
    // so content-change filtering is handled with the file signature cache above.
    let event_type = match event.kind {
        DebouncedEventKind::Any | DebouncedEventKind::AnyContinuous | _ => "session-file-changed",
    };

    Some(FileWatchEvent {
        project_path,
        session_path,
        event_type: event_type.to_string(),
    })
}

/// Seed the file signature cache for a watched tree.
///
/// `notify_debouncer_mini` intentionally collapses raw filesystem events into
/// ambiguous `Any` events. On Linux, simply reading a `.jsonl` can surface as an
/// access event; without a content signature check, `WebUI` reloads the selected
/// session, which reads the file again and creates a refresh loop.
pub fn prime_watch_signatures(root: &Path) {
    let Some(mut signatures) = watched_file_signatures().lock().ok() else {
        return;
    };

    for entry in walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if extract_provider_paths(path).is_none() {
            continue;
        }
        if let Some(signature) = file_signature(path) {
            signatures.insert(file_signature_key(path), signature);
        }
    }
}

fn watched_file_signatures() -> &'static Mutex<HashMap<PathBuf, FileSignature>> {
    WATCHED_FILE_SIGNATURES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn record_content_signature_change(path: &Path) -> bool {
    let signature = file_signature(path);
    let signature_key = file_signature_key(path);
    let Ok(mut signatures) = watched_file_signatures().lock() else {
        return true;
    };

    if let Some(current) = signature {
        match signatures.get(&signature_key) {
            Some(previous) if *previous == current => false,
            _ => {
                signatures.insert(signature_key, current);
                true
            }
        }
    } else {
        signatures.remove(&signature_key);
        true
    }
}

fn file_signature_key(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn file_signature(path: &Path) -> Option<FileSignature> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }

    let modified = metadata.modified().ok()?;
    let modified_duration = modified.duration_since(UNIX_EPOCH).ok()?;
    let modified_unix_nanos = modified_duration
        .as_secs()
        .saturating_mul(1_000_000_000)
        .saturating_add(u64::from(modified_duration.subsec_nanos()));

    Some(FileSignature {
        len: metadata.len(),
        modified_unix_nanos,
    })
}

/// Extract provider-specific project/session identifiers from changed file path.
fn extract_provider_paths(path: &Path) -> Option<(String, String)> {
    let ext = path.extension()?.to_str()?;
    match ext {
        // Claude + Codex rollout logs
        "jsonl" => {
            if let Some(paths) = extract_kimi_paths(path) {
                return Some(paths);
            }
            if let Some((project_path, session_path)) = extract_paths(path) {
                return Some((
                    project_path.to_string_lossy().to_string(),
                    session_path.to_string_lossy().to_string(),
                ));
            }
            extract_codex_paths(path)
        }
        // Kimi state files and OpenCode storage files
        "json" => extract_kimi_paths(path).or_else(|| extract_opencode_paths(path)),
        // OpenCode SQLite database change — emit broad refresh for all OpenCode projects
        "db" | "db-wal" => extract_opencode_db_event(path),
        _ => None,
    }
}

fn handle_file_event(app_handle: &AppHandle, event: &DebouncedEvent) {
    let Some(watch_event) = to_file_watch_event(event) else {
        return;
    };

    super::session::invalidate_search_cache();

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

/// Extract Kimi session identifiers from files under
/// `~/.kimi/sessions/{project_hash}/{session_id}/`.
fn extract_kimi_paths(path: &Path) -> Option<(String, String)> {
    let filename = path.file_name()?.to_str()?;
    if !matches!(filename, "context.jsonl" | "wire.jsonl" | "state.json") {
        return None;
    }

    let sessions_root = crate::providers::kimi::get_base_path()
        .map(PathBuf::from)
        .map(|base| base.join("sessions"))?;
    // `get_base_path()` canonicalizes, but the watcher event path may not be
    // (e.g. on macOS `/var` is a symlink to `/private/var`), so a raw
    // `strip_prefix` would miss and the Kimi change event would be silently
    // dropped — breaking watcher auto-refresh on macOS. Canonicalize the event
    // path so both sides are like-for-like; fall back to the original path if it
    // no longer exists (e.g. a delete event).
    let canonical_path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let relative = canonical_path.strip_prefix(&sessions_root).ok()?;
    let parts: Vec<_> = relative.components().collect();
    if parts.len() != 3 {
        return None;
    }

    let project_path = sessions_root.join(parts[0].as_os_str());
    let session_path = project_path.join(parts[1].as_os_str());

    Some((
        format!("kimi://{}", project_path.to_string_lossy()),
        session_path.to_string_lossy().to_string(),
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
    let cache = OPENCODE_SESSION_PROJECT_CACHE.get_or_init(create_opencode_cache);
    let key = opencode_cache_key(storage_root, session_id);
    // LRU `get` needs `&mut` because a hit refreshes recency ordering.
    let mut guard = cache.lock().ok()?;
    guard.get(&key).cloned()
}

fn remember_opencode_project_id(storage_root: &Path, session_id: &str, project_id: &str) {
    let cache = OPENCODE_SESSION_PROJECT_CACHE.get_or_init(create_opencode_cache);
    let key = opencode_cache_key(storage_root, session_id);
    if let Ok(mut guard) = cache.lock() {
        // `put` evicts the least-recently-used entry once at capacity.
        guard.put(key, project_id.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
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
    fn test_to_file_watch_event_ignores_unchanged_content_signature() {
        let temp = TempDir::new().unwrap();
        let project_dir = temp
            .path()
            .join(".claude")
            .join("projects")
            .join("my-project");
        std::fs::create_dir_all(&project_dir).unwrap();

        let session_path = project_dir.join("session.jsonl");
        std::fs::write(&session_path, "{}\n").unwrap();
        prime_watch_signatures(&project_dir);

        let unchanged = DebouncedEvent {
            path: session_path.clone(),
            kind: DebouncedEventKind::Any,
        };
        assert!(to_file_watch_event(&unchanged).is_none());

        std::fs::write(&session_path, "{}\n{\"type\":\"user\"}\n").unwrap();
        let changed = DebouncedEvent {
            path: session_path.clone(),
            kind: DebouncedEventKind::Any,
        };
        assert!(to_file_watch_event(&changed).is_some());

        let repeated = DebouncedEvent {
            path: session_path,
            kind: DebouncedEventKind::Any,
        };
        assert!(to_file_watch_event(&repeated).is_none());
    }

    #[test]
    fn test_extract_codex_paths() {
        let path = PathBuf::from("/Users/test/.codex/sessions/2025/10/rollout-abc.jsonl");
        let result = extract_codex_paths(&path).unwrap();

        assert_eq!(result.0, "codex://watch");
        assert_eq!(result.1, path.to_string_lossy());
    }

    #[test]
    #[serial]
    fn test_extract_kimi_context_paths() {
        let temp = TempDir::new().unwrap();
        let old_kimi_home = std::env::var_os("KIMI_HOME");
        std::env::set_var("KIMI_HOME", temp.path());

        let path = temp
            .path()
            .join("sessions")
            .join("project_hash")
            .join("session_1")
            .join("context.jsonl");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{}\n").unwrap();

        let result = extract_provider_paths(&path).unwrap();

        if let Some(kimi_home) = old_kimi_home {
            std::env::set_var("KIMI_HOME", kimi_home);
        } else {
            std::env::remove_var("KIMI_HOME");
        }

        assert_eq!(
            result.0,
            format!(
                "kimi://{}",
                temp.path()
                    .canonicalize()
                    .unwrap()
                    .join("sessions/project_hash")
                    .display()
            )
        );
        assert_eq!(
            result.1,
            temp.path()
                .canonicalize()
                .unwrap()
                .join("sessions/project_hash/session_1")
                .to_string_lossy()
        );
    }

    #[test]
    #[serial]
    fn test_extract_kimi_state_paths() {
        let temp = TempDir::new().unwrap();
        let old_kimi_home = std::env::var_os("KIMI_HOME");
        std::env::set_var("KIMI_HOME", temp.path());

        let path = temp
            .path()
            .join("sessions")
            .join("project_hash")
            .join("session_1")
            .join("state.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{}\n").unwrap();

        let result = extract_provider_paths(&path).unwrap();

        if let Some(kimi_home) = old_kimi_home {
            std::env::set_var("KIMI_HOME", kimi_home);
        } else {
            std::env::remove_var("KIMI_HOME");
        }

        assert_eq!(
            result.0,
            format!(
                "kimi://{}",
                temp.path()
                    .canonicalize()
                    .unwrap()
                    .join("sessions/project_hash")
                    .display()
            )
        );
        assert_eq!(
            result.1,
            temp.path()
                .canonicalize()
                .unwrap()
                .join("sessions/project_hash/session_1")
                .to_string_lossy()
        );
    }

    #[test]
    #[serial]
    fn test_extract_kimi_paths_from_custom_home() {
        let temp = TempDir::new().unwrap();
        let old_kimi_home = std::env::var_os("KIMI_HOME");
        std::env::set_var("KIMI_HOME", temp.path());

        let path = temp
            .path()
            .join("sessions")
            .join("project_hash")
            .join("session_1")
            .join("wire.jsonl");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{}\n").unwrap();

        let result = extract_provider_paths(&path);

        if let Some(kimi_home) = old_kimi_home {
            std::env::set_var("KIMI_HOME", kimi_home);
        } else {
            std::env::remove_var("KIMI_HOME");
        }

        let result = result.unwrap();
        assert_eq!(
            result.0,
            format!(
                "kimi://{}",
                temp.path()
                    .canonicalize()
                    .unwrap()
                    .join("sessions/project_hash")
                    .display()
            )
        );
        assert_eq!(
            result.1,
            temp.path()
                .canonicalize()
                .unwrap()
                .join("sessions/project_hash/session_1")
                .to_string_lossy()
        );
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

    /// Regression test for the unbounded-cache memory leak: the `OpenCode`
    /// session-project cache must evict entries once it reaches its capacity
    /// so that long-running watcher activity cannot grow it without bound.
    /// Before the LRU fix this used a plain `HashMap`, so `len()` would equal
    /// the full insert count (10,100) and this assertion would fail.
    #[test]
    #[serial]
    fn test_opencode_cache_is_bounded() {
        let cache = OPENCODE_SESSION_PROJECT_CACHE.get_or_init(create_opencode_cache);
        let mut guard = cache.lock().unwrap();
        guard.clear();

        for i in 0..10_100 {
            guard.put(format!("key_{i}"), format!("value_{i}"));
        }

        assert!(
            guard.len() <= 10_000,
            "OpenCode cache must stay bounded at 10,000 entries, got {}",
            guard.len()
        );
    }
}
