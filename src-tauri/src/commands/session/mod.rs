//! Session commands module
//!
//! This module contains all session-related Tauri commands organized into submodules:
//! - `load`: Session and message loading functions
//! - `search`: Message search functions
//! - `edits`: File edit tracking and restore functions
//! - `rename`: Native session renaming functions
//! - `delete`: Session deletion

mod chain;
mod delete;
mod edits;
mod load;
mod rename;
mod resume;
mod search;

// Re-export all commands
pub use chain::{resolve_session_chain, superseded_chain_paths};
pub use delete::*;
pub use edits::*;
pub use load::*;
pub use rename::*;
pub use resume::*;
pub use search::*;

/// Split a provider URI into its scheme and remainder, or `None` if the value
/// is an ordinary path.
///
/// Deliberately structural rather than a list of known schemes: those live as
/// per-module constants across seventeen providers, and a copy kept here would
/// silently fall behind the next one added — the failure mode being a provider
/// that works on desktop and is rejected over `--serve`.
#[cfg(feature = "webui-server")]
fn uri_parts(path: &std::path::Path) -> Option<(String, String)> {
    let raw = path.to_string_lossy();
    let (scheme, rest) = raw.split_once("://")?;
    let valid = !scheme.is_empty()
        && scheme.starts_with(|c: char| c.is_ascii_lowercase())
        && scheme
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '+');
    valid.then(|| (scheme.to_string(), rest.to_string()))
}

/// Reject session file paths that fall outside the on-disk roots used by
/// the supported providers. Defends `WebUI` handlers (which accept untrusted
/// HTTP input) against being pointed at arbitrary `.jsonl` files on the host.
///
/// Desktop builds do not need this guard — those paths flow from
/// `scan_projects` / `load_sessions` output, never raw user input.
#[cfg(feature = "webui-server")]
pub(crate) fn is_safe_session_path(path: &std::path::Path) -> Result<(), String> {
    use std::path::PathBuf;

    // A provider URI is not a filesystem path. Several providers keep their
    // sessions in a database rather than in files - OpenCode's SQLite store,
    // Zed, Trae, ForgeCode and a dozen others - and mint identifiers of the
    // form `scheme://…` for them. There is no file for an allowlist to
    // confine, and the command that receives one resolves it against its own
    // provider root, exactly as it does on desktop where this guard does not
    // run at all.
    //
    // Treating them as paths meant canonicalising a parent that does not
    // exist, so every guarded WebUI endpoint rejected them as "Invalid path"
    // under `--serve` (#560).
    //
    // Traversal is still refused: a URI is waved past the filesystem check, so
    // it must not be able to smuggle one through.
    if let Some((scheme, rest)) = uri_parts(path) {
        return if rest.split(['/', '\\']).any(|seg| seg == "..") {
            Err(format!("Invalid {scheme} session id"))
        } else {
            Ok(())
        };
    }

    fn strip_windows_prefix(p: &std::path::Path) -> PathBuf {
        let s = p.to_string_lossy();
        s.strip_prefix(r"\\?\")
            .map(PathBuf::from)
            .unwrap_or_else(|| p.to_path_buf())
    }

    let home_raw = crate::utils::home_dir().ok_or("Could not find home directory")?;
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
    // Kimi Code (the `~/.kimi-code` rewrite) sessions — surfaced through the
    // same `kimi` provider.
    if let Some(kimi_code_root) = crate::providers::kimi_code::default_root() {
        allowed.push(kimi_code_root.join("sessions"));
    }
    if let Some(vibe_base) = crate::providers::vibe::get_base_path() {
        allowed.push(PathBuf::from(vibe_base).join("logs/session"));
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
    if let Some(oi_base) = crate::providers::openinterpreter::get_base_path() {
        allowed.push(PathBuf::from(&oi_base).join("sessions"));
        allowed.push(PathBuf::from(&oi_base).join("archived_sessions"));
    }
    if let Some(qwen_base) = crate::providers::qwen::get_base_path() {
        allowed.push(PathBuf::from(qwen_base));
    }
    if let Some(zed_base) = crate::providers::zed::get_base_path() {
        allowed.push(PathBuf::from(zed_base));
    }
    if let Some(oh_base) = crate::providers::openhands::get_base_path() {
        allowed.push(PathBuf::from(oh_base));
    }
    if let Some(trae_base) = crate::providers::trae::get_base_path() {
        allowed.push(PathBuf::from(trae_base));
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
        // Built inside the guard's home. It used to create its own `TempDir`
        // and point `HOME` at it via `with_home`, which leaves
        // `CCHV_TEST_HOME` - the path actually resolved - somewhere else.
        let sandbox = crate::test_utils::SandboxHome::new();
        let home = sandbox.path();
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
        let res = is_safe_session_path(&via_symlink);
        assert!(
            res.is_ok(),
            "session under a symlinked .claude root should be allowed: {res:?}"
        );
    }

    #[test]
    #[serial]
    fn rejects_session_outside_allowlist() {
        let _home = crate::test_utils::SandboxHome::new();
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

    /// #560. Several providers mint session paths that are provider URIs, not
    /// filesystem paths - `OpenCode`'s `SQLite` store is one, and a dozen others do
    /// the same. The guard treated them as paths, failed to canonicalise a
    /// parent that does not exist, and rejected them as "Invalid path", which
    /// broke every guarded `WebUI` endpoint for those providers under `--serve`.
    #[test]
    #[serial]
    fn accepts_provider_uri_session_paths() {
        let _home = crate::test_utils::SandboxHome::new();

        for uri in [
            "opencode://proj-1/ses_abc123",
            "kimi-code://wd_demo/session_1",
            "forgecode-db://workspace/conv-1",
            "zed://thread-7",
        ] {
            let res = is_safe_session_path(&std::path::PathBuf::from(uri));
            assert!(res.is_ok(), "provider URI {uri} was rejected: {res:?}");
        }
    }

    /// A URI is waved past the filesystem allowlist, so it must not be able to
    /// smuggle a traversal through it.
    #[test]
    #[serial]
    fn rejects_traversal_inside_a_provider_uri() {
        let _home = crate::test_utils::SandboxHome::new();

        for uri in [
            "opencode://../../etc/passwd",
            "zed://thread/../../../root/.ssh/id_rsa",
        ] {
            let res = is_safe_session_path(&std::path::PathBuf::from(uri));
            assert!(res.is_err(), "traversal inside {uri} was accepted");
        }
    }

    // Kimi sessions live under ~/.kimi/sessions (or $KIMI_HOME) — #349.
    #[test]
    #[serial]
    fn test_safe_session_path_allows_kimi_sessions() {
        // The guard owns `HOME`; the fixture goes inside it. This used to
        // save/restore `HOME` around its own `TempDir`, which leaves
        // `CCHV_TEST_HOME` pointing somewhere else entirely - the path the
        // code under test actually resolves.
        let home = crate::test_utils::SandboxHome::new();

        let session_dir = home
            .path()
            .join(".kimi")
            .join("sessions")
            .join("project_hash")
            .join("session_1");
        std::fs::create_dir_all(&session_dir).unwrap();
        let session_file = session_dir.join("context.jsonl");
        std::fs::write(&session_file, "{}\n").unwrap();

        let result = is_safe_session_path(&session_file);

        assert!(result.is_ok(), "kimi session rejected: {result:?}");
    }

    #[test]
    #[serial]
    fn test_safe_session_path_allows_custom_kimi_home() {
        let _home = crate::test_utils::SandboxHome::new();
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
        let _home = crate::test_utils::SandboxHome::new();
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
        let _home = crate::test_utils::SandboxHome::new();
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
