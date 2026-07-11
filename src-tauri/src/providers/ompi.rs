//! oh-my-pi (`omp`, <https://github.com/can1357/oh-my-pi>) — a fork of
//! badlogic's `pi` that keeps the session format but relocates the store to
//! `~/.omp/agent/sessions/<escaped-cwd>/<timestamp>_<sessionId>.jsonl`.
//!
//! The on-disk format is byte-compatible with Pi's (same `type:"session"`
//! header, same `message`/`model_change`/`thinking_level_change` entry union,
//! same nested message shape), so this module is a thin registration over the
//! store-parameterized core in [`pi`](super::pi).

use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::providers::pi::{
    base_path_of, detect_store, load_messages_of, load_sessions_of, scan_store, search_store,
    PiStore,
};
use crate::providers::ProviderInfo;

const OMPI_STORE: PiStore = PiStore {
    id: "ompi",
    display_name: "oh-my-pi",
    dot_dir: ".omp",
};

/// Detect an oh-my-pi installation.
pub fn detect() -> Option<ProviderInfo> {
    detect_store(&OMPI_STORE)
}

/// Base path (`~/.omp/agent/sessions`), for the file watcher.
pub fn get_base_path() -> Option<String> {
    base_path_of(&OMPI_STORE)
}

/// Scan oh-my-pi projects at the default store root (`~/.omp/agent/sessions`).
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    Ok(scan_store(&OMPI_STORE))
}

/// Load the sessions in one oh-my-pi project directory.
pub fn load_sessions(
    project_path: &str,
    exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    load_sessions_of(&OMPI_STORE, project_path, exclude_sidechain)
}

/// Load all messages from one oh-my-pi session file.
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    load_messages_of(&OMPI_STORE, session_path)
}

/// Search across all oh-my-pi sessions.
pub fn search(query: &str, max_results: usize) -> Result<Vec<ClaudeMessage>, String> {
    Ok(search_store(&OMPI_STORE, query, max_results))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::fs;
    use std::path::Path;

    const SESSION: &str = concat!(
        r#"{"type":"session","version":3,"id":"omp-1","timestamp":"2026-06-03T14:57:13.623Z","cwd":"/Users/ac/dev/omp-fixture"}"#,
        "\n",
        // oh-my-pi writes `model` as one combined string where pi splits
        // provider/modelId — irrelevant either way (metadata, not a message).
        r#"{"type":"model_change","id":"m1","parentId":null,"timestamp":"2026-06-03T14:57:14.649Z","model":"anthropic/claude-opus-4-8"}"#,
        "\n",
        r#"{"type":"message","id":"u1","parentId":"m1","timestamp":"2026-06-03T14:57:24.001Z","message":{"role":"user","content":[{"type":"text","text":"hello omp"}],"timestamp":1748962644001}}"#,
        "\n",
    );

    struct HomeGuard {
        original: Option<String>,
    }
    impl HomeGuard {
        fn set(path: &Path) -> Self {
            let original = std::env::var("HOME").ok();
            std::env::set_var("HOME", path);
            Self { original }
        }
    }
    impl Drop for HomeGuard {
        fn drop(&mut self) {
            match self.original.as_ref() {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
        }
    }

    /// The full pipeline resolves against `~/.omp/agent/sessions` and stamps
    /// the `ompi` provider id — the only two things this thin module adds
    /// over the shared Pi core.
    #[test]
    #[serial]
    fn ompi_reads_omp_store_and_stamps_provider_id() {
        let home = tempfile::tempdir().expect("tempdir");
        let _guard = HomeGuard::set(home.path());
        let dir = home
            .path()
            .join(".omp")
            .join("agent")
            .join("sessions")
            .join("-Users-ac-dev-omp-fixture");
        fs::create_dir_all(&dir).expect("create fixture dir");
        let file = dir.join("2026-06-03T14-57-13-623Z_omp-1.jsonl");
        fs::write(&file, SESSION).expect("write fixture session");

        let projects = scan_projects().expect("scan_projects must not error");
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].provider.as_deref(), Some("ompi"));
        assert_eq!(projects[0].actual_path, "/Users/ac/dev/omp-fixture");

        let sessions =
            load_sessions(&dir.to_string_lossy(), false).expect("load_sessions must not error");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].provider.as_deref(), Some("ompi"));

        let messages =
            load_messages(&file.to_string_lossy()).expect("load_messages must not error");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].provider.as_deref(), Some("ompi"));
        assert_eq!(messages[0].uuid, "u1");
    }
}
