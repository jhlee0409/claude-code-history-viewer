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

    let mut allowed: Vec<PathBuf> = vec![
        home.join(".claude").join("projects"),
        home.join(".codex").join("sessions"),
        home.join(".codex").join("archived_sessions"),
        home.join(".gemini"),
        home.join(".local").join("share").join("opencode"),
        home.join(".cline").join("tasks"),
        home.join(".cursor"),
    ];

    if let Some(codex_base) = crate::providers::codex::get_base_path() {
        let codex_raw = PathBuf::from(codex_base);
        let codex_base = codex_raw.canonicalize().unwrap_or(codex_raw);
        let codex_base = strip_windows_prefix(&codex_base);
        allowed.push(codex_base.join("sessions"));
        allowed.push(codex_base.join("archived_sessions"));
    }

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

#[cfg(all(test, feature = "webui-server"))]
mod tests {
    use super::is_safe_session_path;
    use serial_test::serial;
    use std::path::Path;

    struct EnvVarGuard {
        key: &'static str,
        previous: Option<String>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: &Path) -> Self {
            let previous = std::env::var(key).ok();
            std::env::set_var(key, value);
            Self { key, previous }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.previous {
                Some(value) => std::env::set_var(self.key, value),
                None => std::env::remove_var(self.key),
            }
        }
    }

    #[test]
    #[serial]
    fn safe_session_path_allows_codex_home_sessions() {
        let temp = tempfile::tempdir().unwrap();
        let codex_home = temp.path().join("custom-codex");
        let sessions = codex_home.join("sessions");
        std::fs::create_dir_all(&sessions).unwrap();
        let _guard = EnvVarGuard::set("CODEX_HOME", &codex_home);

        let session_file = sessions.join("rollout-test.jsonl");
        std::fs::write(&session_file, "{}").unwrap();

        assert!(is_safe_session_path(&session_file).is_ok());
    }

    #[test]
    #[serial]
    fn safe_session_path_allows_codex_home_archived_sessions() {
        let temp = tempfile::tempdir().unwrap();
        let codex_home = temp.path().join("custom-codex");
        let archived_sessions = codex_home.join("archived_sessions");
        std::fs::create_dir_all(&archived_sessions).unwrap();
        let _guard = EnvVarGuard::set("CODEX_HOME", &codex_home);

        let session_file = archived_sessions.join("rollout-archived.jsonl");
        std::fs::write(&session_file, "{}").unwrap();

        assert!(is_safe_session_path(&session_file).is_ok());
    }
}
