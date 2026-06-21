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
        home.join(".codebuddy").join("projects"),
    ];
    if let Some(kimi_base) = crate::providers::kimi::get_base_path() {
        allowed.push(PathBuf::from(kimi_base).join("sessions"));
    }
    // Continue stores sessions under ~/.continue/sessions (CONTINUE_GLOBAL_DIR
    // overridable); get_base_path() already resolves to that directory.
    if let Some(continue_base) = crate::providers::continue_dev::get_base_path() {
        allowed.push(PathBuf::from(continue_base));
    }
    if let Some(pearai_base) = crate::providers::pearai::get_base_path() {
        allowed.push(PathBuf::from(pearai_base));
    }
    if let Some(goose_base) = crate::providers::goose::get_base_path() {
        allowed.push(PathBuf::from(goose_base));
    }
    if let Some(llm_base) = crate::providers::llm::get_base_path() {
        allowed.push(PathBuf::from(llm_base));
    }
    if let Some(amazon_q_base) = crate::providers::amazon_q::get_base_path() {
        allowed.push(PathBuf::from(amazon_q_base));
    }

    // Canonicalize each allowlist entry so the comparison below is like-for-like
    // with the canonicalized candidate. Without this, a symlinked provider root
    // (e.g. `~/.claude -> ~/.claude-store`, common in container / persistent-volume
    // setups) makes the candidate resolve to the symlink target while the literal
    // allowlist entry does not — so `starts_with` fails and valid sessions are
    // wrongly rejected (#355). Entries that do not exist fall back to the literal
    // path, preserving the confinement guarantee for unused provider roots.
    let mut allowed: Vec<PathBuf> = allowed
        .into_iter()
        .map(|d| {
            let resolved = d.canonicalize().unwrap_or(d);
            strip_windows_prefix(&resolved)
        })
        .collect();

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

#[cfg(all(test, feature = "webui-server", unix))]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::os::unix::fs::symlink;
    use tempfile::TempDir;

    /// Run `body` with `$HOME` temporarily pointed at `home`, restoring it after.
    /// Serialized because `is_safe_session_path` resolves the home dir from the
    /// process environment (other suites also override `HOME`).
    fn with_home<T>(home: &std::path::Path, body: impl FnOnce() -> T) -> T {
        let prev = std::env::var_os("HOME");
        std::env::set_var("HOME", home);
        let out = body();
        match prev {
            Some(v) => std::env::set_var("HOME", v),
            None => std::env::remove_var("HOME"),
        }
        out
    }

    // Regression test for #355: when `~/.claude` is itself a symlink, the
    // candidate path canonicalizes to the symlink target, so the allowlist
    // entries must be canonicalized too or valid sessions are rejected.
    #[test]
    #[serial]
    fn accepts_session_under_symlinked_claude_root() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let home = tmp.path();
        let store_projects = home.join(".claude-store").join("projects").join("proj");
        std::fs::create_dir_all(&store_projects).expect("mk store");
        symlink(home.join(".claude-store"), home.join(".claude")).expect("symlink .claude");
        let session = store_projects.join("session.jsonl");
        std::fs::write(&session, b"{}").expect("write session");

        // Access via the symlinked path; canonicalize() resolves it to the store.
        let via_symlink = home
            .join(".claude")
            .join("projects")
            .join("proj")
            .join("session.jsonl");
        let res = with_home(home, || is_safe_session_path(&via_symlink));
        assert!(
            res.is_ok(),
            "session under a symlinked .claude root should be allowed: {res:?}"
        );
    }

    #[test]
    #[serial]
    fn rejects_session_outside_allowlist() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let home = tmp.path();
        std::fs::create_dir_all(home.join(".claude").join("projects")).expect("mk claude");
        let outside = home.join("not-a-provider");
        std::fs::create_dir_all(&outside).expect("mk outside");
        let session = outside.join("session.jsonl");
        std::fs::write(&session, b"{}").expect("write session");

        let res = with_home(home, || is_safe_session_path(&session));
        assert!(
            res.is_err(),
            "a path outside every provider root must be rejected"
        );
    }

    // Kimi sessions live under ~/.kimi/sessions (or $KIMI_HOME) — #349.
    #[test]
    #[serial]
    fn test_safe_session_path_allows_kimi_sessions() {
        let temp = TempDir::new().unwrap();
        let old_home = std::env::var_os("HOME");
        std::env::set_var("HOME", temp.path());

        let session_dir = temp
            .path()
            .join(".kimi")
            .join("sessions")
            .join("project_hash")
            .join("session_1");
        std::fs::create_dir_all(&session_dir).unwrap();
        let session_file = session_dir.join("context.jsonl");
        std::fs::write(&session_file, "{}\n").unwrap();

        let result = is_safe_session_path(&session_file);

        if let Some(home) = old_home {
            std::env::set_var("HOME", home);
        } else {
            std::env::remove_var("HOME");
        }

        assert!(result.is_ok());
    }

    #[test]
    #[serial]
    fn test_safe_session_path_allows_custom_kimi_home() {
        let temp = TempDir::new().unwrap();
        let old_kimi_home = std::env::var_os("KIMI_HOME");
        std::env::set_var("KIMI_HOME", temp.path());

        let session_dir = temp
            .path()
            .join("sessions")
            .join("project_hash")
            .join("session_1");
        std::fs::create_dir_all(&session_dir).unwrap();
        let session_file = session_dir.join("context.jsonl");
        std::fs::write(&session_file, "{}\n").unwrap();

        let result = is_safe_session_path(&session_file);

        if let Some(kimi_home) = old_kimi_home {
            std::env::set_var("KIMI_HOME", kimi_home);
        } else {
            std::env::remove_var("KIMI_HOME");
        }

        assert!(result.is_ok());
    }

    struct EnvVarGuard {
        key: &'static str,
        previous: Option<String>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: &std::path::Path) -> Self {
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
