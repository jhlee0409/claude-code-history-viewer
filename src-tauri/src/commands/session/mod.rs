//! Session commands module
//!
//! This module contains all session-related Tauri commands organized into submodules:
//! - `load`: Session and message loading functions
//! - `search`: Message search functions
//! - `edits`: File edit tracking and restore functions
//! - `rename`: Native session renaming functions
//! - `delete`: Session deletion

mod delete;
mod edits;
mod load;
mod rename;
mod search;

// Re-export all commands
pub use delete::*;
pub use edits::*;
pub use load::*;
pub use rename::*;
pub use search::*;

/// Reject session file paths that fall outside the on-disk roots used by
/// the supported providers. Defends `WebUI` handlers (which accept untrusted
/// HTTP input) against being pointed at arbitrary `.jsonl` files on the host.
///
/// Desktop builds do not need this guard — those paths flow from
/// `scan_projects` / `load_sessions` output, never raw user input.
#[cfg(feature = "webui-server")]
pub(crate) fn is_safe_session_path(path: &std::path::Path) -> Result<(), String> {
    use std::path::PathBuf;

    fn strip_windows_prefix(p: &std::path::Path) -> PathBuf {
        let s = p.to_string_lossy();
        s.strip_prefix(r"\\?\")
            .map(PathBuf::from)
            .unwrap_or_else(|| p.to_path_buf())
    }

    let home_raw = dirs::home_dir().ok_or("Could not find home directory")?;
    let home = home_raw.canonicalize().unwrap_or_else(|_| home_raw.clone());
    let home = strip_windows_prefix(&home);

    let allowed: [PathBuf; 6] = [
        home.join(".claude").join("projects"),
        home.join(".codex").join("sessions"),
        home.join(".gemini"),
        home.join(".local").join("share").join("opencode"),
        home.join(".cline").join("tasks"),
        home.join(".cursor"),
    ];

    let canonical = if path.exists() {
        path.canonicalize()
            .map_err(|e| format!("Path canonicalization error: {e}"))?
    } else {
        path.parent()
            .and_then(|p| p.canonicalize().ok())
            .map(|p| p.join(path.file_name().unwrap_or_default()))
            .ok_or_else(|| "Invalid path".to_string())?
    };
    let canonical = strip_windows_prefix(&canonical);

    if allowed.iter().any(|d| canonical.starts_with(d)) {
        Ok(())
    } else {
        Err("Session path not in allowed provider directories".to_string())
    }
}
