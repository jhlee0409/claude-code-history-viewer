//! Kilo Code (`~/.local/share/kilo`) — OpenCode-core store.
//!
//! Kilo Code left the Cline/Roo fork lineage in May 2026 and now runs on the
//! OpenCode core: sessions live in a drizzle-managed SQLite database
//! (`kilo.db`) whose schema and `message`/`part` JSON shapes are identical to
//! OpenCode's. The reader therefore delegates to the OpenCode provider's
//! store-parameterized functions and rebrands the `opencode://` scheme to
//! `kilo://` so the two stores can never cross-reference each other's ids.
//!
//! The pre-migration Cline-family store (VS Code
//! `globalStorage/kilocode.kilo-code`, task index in globalState) is still
//! read by [`crate::providers::cline`] for installations that never ran
//! Kilo's own legacy migration; migrated installs keep no task index there,
//! so the two readers do not double-report the same conversations.

use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::providers::opencode::{self, ChildSession};
use crate::providers::ProviderInfo;
use std::path::{Path, PathBuf};

/// `SQLite` database file inside the Kilo store root.
pub const DB_FILE: &str = "kilo.db";

const SCHEME: &str = "kilo://";
const OPENCODE_SCHEME: &str = "opencode://";
const PROVIDER_ID: &str = "kilo";
const DISPLAY_NAME: &str = "Kilo Code";

/// Get the Kilo store root: `$KILO_HOME`, `$XDG_DATA_HOME/kilo`, or
/// `~/.local/share/kilo`.
pub fn get_base_path() -> Option<String> {
    if let Ok(home) = std::env::var("KILO_HOME") {
        let path = PathBuf::from(&home);
        if path.exists() {
            return Some(home);
        }
    }

    if let Ok(xdg_data) = std::env::var("XDG_DATA_HOME") {
        let path = PathBuf::from(&xdg_data).join("kilo");
        if path.exists() {
            return Some(path.to_string_lossy().to_string());
        }
    }

    let home = crate::utils::home_dir()?;
    let kilo_path = home.join(".local").join("share").join("kilo");
    if kilo_path.exists() {
        Some(kilo_path.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Detect a Kilo Code installation (OpenCode-core store).
///
/// Unlike `OpenCode`, Kilo never had a file-backed `storage/` tree — the
/// database is the only session store — so availability is `kilo.db` alone.
pub fn detect() -> Option<ProviderInfo> {
    let base_path = get_base_path()?;
    let db_path = Path::new(&base_path).join(DB_FILE);

    Some(ProviderInfo {
        id: PROVIDER_ID.to_string(),
        display_name: DISPLAY_NAME.to_string(),
        base_path: base_path.clone(),
        is_available: db_path.is_file(),
    })
}

/// Rewrite a `kilo://` path into the `opencode://` scheme the shared reader
/// parses. Paths without the prefix pass through unchanged.
fn to_store_scheme(path: &str) -> String {
    path.strip_prefix(SCHEME)
        .map(|rest| format!("{OPENCODE_SCHEME}{rest}"))
        .unwrap_or_else(|| path.to_string())
}

/// Rewrite an `opencode://` path produced by the shared reader into
/// `kilo://`. Paths without the prefix pass through unchanged.
fn to_kilo_scheme(path: &str) -> String {
    path.strip_prefix(OPENCODE_SCHEME)
        .map(|rest| format!("{SCHEME}{rest}"))
        .unwrap_or_else(|| path.to_string())
}

/// The shared reader reports failures in `OpenCode` terms (`"OpenCode base
/// path"`, `opencode://…` paths); restate them for Kilo so users see the store
/// they actually configured.
fn rebrand_error(error: String) -> String {
    error
        .replace("OpenCode", DISPLAY_NAME)
        .replace(OPENCODE_SCHEME, SCHEME)
}

fn rebrand_project(mut project: ClaudeProject) -> ClaudeProject {
    project.path = to_kilo_scheme(&project.path);
    project.provider = Some(PROVIDER_ID.to_string());
    project
}

fn rebrand_session(mut session: ClaudeSession) -> ClaudeSession {
    session.session_id = to_kilo_scheme(&session.session_id);
    session.file_path = to_kilo_scheme(&session.file_path);
    session.provider = Some(PROVIDER_ID.to_string());
    session
}

/// Scan Kilo projects from the default store root.
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let base = get_base_path().ok_or("Kilo base path not found")?;
    scan_projects_at(&base)
}

/// [`scan_projects`] against an explicit store root.
pub fn scan_projects_at(base_path: &str) -> Result<Vec<ClaudeProject>, String> {
    opencode::scan_projects_from_store(base_path, DB_FILE)
        .map(|projects| projects.into_iter().map(rebrand_project).collect())
        .map_err(rebrand_error)
}

/// Load sessions for a Kilo project (`kilo://<project_id>`).
pub fn load_sessions(
    project_path: &str,
    exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let base_path = get_base_path().ok_or_else(|| "Kilo not found".to_string())?;
    load_sessions_at(&base_path, project_path, exclude_sidechain)
}

/// [`load_sessions`] against an explicit store root.
pub fn load_sessions_at(
    base_path: &str,
    project_path: &str,
    exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    opencode::load_sessions_at(
        base_path,
        DB_FILE,
        &to_store_scheme(project_path),
        exclude_sidechain,
    )
    .map(|sessions| sessions.into_iter().map(rebrand_session).collect())
    .map_err(rebrand_error)
}

/// Load messages for a Kilo session (`kilo://<project_id>/<session_id>` or
/// `kilo://<session_id>`).
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let base_path = get_base_path().ok_or_else(|| "Kilo not found".to_string())?;
    load_messages_at(&base_path, session_path)
}

/// [`load_messages`] against an explicit store root.
pub fn load_messages_at(base_path: &str, session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    opencode::load_messages_at(base_path, DB_FILE, &to_store_scheme(session_path))
        .map(|messages| {
            messages
                .into_iter()
                .map(|mut message| {
                    message.provider = Some(PROVIDER_ID.to_string());
                    message
                })
                .collect()
        })
        .map_err(rebrand_error)
}

/// Search across all Kilo sessions.
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let base_path = get_base_path().ok_or_else(|| "Kilo not found".to_string())?;
    search_at(&base_path, query, limit)
}

/// [`search`] against an explicit store root.
pub fn search_at(base_path: &str, query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    opencode::search_at(base_path, DB_FILE, query, limit)
        .map(|messages| {
            messages
                .into_iter()
                .map(|mut message| {
                    message.provider = Some(PROVIDER_ID.to_string());
                    message
                })
                .collect()
        })
        .map_err(rebrand_error)
}

/// Child sessions (subagent runs) of a Kilo session, read from `kilo.db`.
pub fn load_child_sessions(project_id: &str, session_id: &str) -> Vec<ChildSession> {
    let Some(base_path) = get_base_path() else {
        return Vec::new();
    };
    load_child_sessions_at(&base_path, project_id, session_id)
}

/// [`load_child_sessions`] against an explicit store root.
pub fn load_child_sessions_at(
    base_path: &str,
    project_id: &str,
    session_id: &str,
) -> Vec<ChildSession> {
    opencode::load_child_sessions_from_db(base_path, DB_FILE, project_id, session_id)
}

/// Fixture helpers for a minimal `kilo.db`, shared with stats tests that need
/// a Kilo store behind `KILO_HOME`.
#[cfg(test)]
pub(crate) mod test_support {
    use super::DB_FILE;
    use std::path::Path;

    pub(crate) fn create_test_db(dir: &Path) -> rusqlite::Connection {
        let conn = rusqlite::Connection::open(dir.join(DB_FILE)).expect("open kilo.db");
        conn.execute_batch(
            "CREATE TABLE project (
                id TEXT PRIMARY KEY, worktree TEXT NOT NULL, name TEXT,
                time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
                sandboxes TEXT NOT NULL DEFAULT '[]', vcs TEXT, icon_url TEXT,
                icon_color TEXT, time_initialized INTEGER, commands TEXT
            );
            CREATE TABLE session (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
                slug TEXT NOT NULL DEFAULT '', directory TEXT NOT NULL DEFAULT '',
                version TEXT NOT NULL DEFAULT '1.0', time_created INTEGER NOT NULL,
                time_updated INTEGER NOT NULL, parent_id TEXT, share_url TEXT,
                summary_additions INTEGER, summary_deletions INTEGER, summary_files INTEGER,
                summary_diffs TEXT, revert TEXT, permission TEXT, time_compacting INTEGER,
                time_archived INTEGER, workspace_id TEXT
            );
            CREATE TABLE message (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL,
                time_updated INTEGER NOT NULL, data TEXT NOT NULL
            );
            CREATE TABLE part (
                id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
                time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
            );",
        )
        .expect("create kilo tables");
        conn
    }

    /// One project, one session, one user text message.
    pub(crate) fn seed(conn: &rusqlite::Connection) {
        conn.execute(
            "INSERT INTO project (id, worktree, name, time_created, time_updated)
             VALUES ('proj1', '/tmp/kilo-project', 'kilo-project', 1700000000000, 1700000100000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO session (id, project_id, title, directory, time_created, time_updated)
             VALUES ('ses_001', 'proj1', 'Kilo session', '/tmp/kilo-project',
                     1700000000000, 1700000050000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO message (id, session_id, time_created, time_updated, data)
             VALUES ('msg_001', 'ses_001', 1700000010000, 1700000010000,
                     '{\"role\":\"user\",\"time\":{\"created\":1700000010000}}')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
             VALUES ('prt_001', 'msg_001', 'ses_001', 1700000010000, 1700000010000,
                     '{\"type\":\"text\",\"text\":\"Hello from Kilo\"}')",
            [],
        )
        .unwrap();
    }

    /// Add an assistant reply to `ses_001` carrying token usage, so stats
    /// code has something to aggregate.
    pub(crate) fn seed_assistant_usage(conn: &rusqlite::Connection, input: u32, output: u32) {
        conn.execute(
            "INSERT INTO message (id, session_id, time_created, time_updated, data)
             VALUES ('msg_002', 'ses_001', 1700000020000, 1700000020000, ?1)",
            [format!(
                "{{\"role\":\"assistant\",\"modelID\":\"kilo-test-model\",\"providerID\":\"kilo\",\
                 \"time\":{{\"created\":1700000020000}},\
                 \"tokens\":{{\"input\":{input},\"output\":{output},\"reasoning\":0,\
                 \"cache\":{{\"read\":0,\"write\":0}}}},\"cost\":0.0}}"
            )],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
             VALUES ('prt_002', 'msg_002', 'ses_001', 1700000020000, 1700000020000,
                     '{\"type\":\"text\",\"text\":\"Hi from the Kilo assistant\"}')",
            [],
        )
        .unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{create_test_db, seed};
    use super::*;

    #[test]
    fn scan_projects_rebrands_to_kilo_scheme() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = create_test_db(tmp.path());
        seed(&conn);
        drop(conn);

        let projects = scan_projects_at(&tmp.path().to_string_lossy()).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].path, "kilo://proj1");
        assert_eq!(projects[0].provider.as_deref(), Some("kilo"));
        assert_eq!(projects[0].session_count, 1);
        assert_eq!(projects[0].name, "kilo-project");
    }

    #[test]
    fn load_sessions_and_messages_roundtrip_through_kilo_scheme() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = create_test_db(tmp.path());
        seed(&conn);
        drop(conn);

        let base = tmp.path().to_string_lossy().to_string();
        let sessions = load_sessions_at(&base, "kilo://proj1", false).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "kilo://ses_001");
        assert_eq!(sessions[0].file_path, "kilo://proj1/ses_001");
        assert_eq!(sessions[0].provider.as_deref(), Some("kilo"));

        let messages = load_messages_at(&base, &sessions[0].file_path).unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].provider.as_deref(), Some("kilo"));
        let text = messages[0]
            .content
            .as_ref()
            .and_then(|c| c.get(0))
            .and_then(|item| item.get("text"))
            .and_then(|t| t.as_str())
            .unwrap_or_default();
        assert!(
            text.contains("Hello from Kilo"),
            "unexpected content: {text}"
        );
    }

    #[test]
    fn search_finds_text_and_rebrands_provider() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = create_test_db(tmp.path());
        seed(&conn);
        drop(conn);

        let results = search_at(&tmp.path().to_string_lossy(), "hello from kilo", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].provider.as_deref(), Some("kilo"));
    }

    #[test]
    fn errors_are_reported_in_kilo_terms() {
        let tmp = tempfile::tempdir().unwrap();
        drop(create_test_db(tmp.path()));
        let base = tmp.path().to_string_lossy().to_string();

        let err = load_sessions_at(&base, "kilo://../escape", false).unwrap_err();
        assert_eq!(err, "Invalid Kilo Code project path: kilo://../escape");

        let err = load_messages_at(&base, "kilo://no-session-part").unwrap_err();
        assert_eq!(
            err,
            "Invalid Kilo Code session path: kilo://no-session-part"
        );

        let err = scan_projects_at("relative/kilo").unwrap_err();
        assert!(
            err.contains("Kilo Code base path") && !err.contains("OpenCode"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn child_sessions_read_from_kilo_db() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = create_test_db(tmp.path());
        seed(&conn);
        conn.execute(
            "INSERT INTO session (id, project_id, title, directory, time_created, time_updated, parent_id)
             VALUES ('ses_child', 'proj1', 'Subagent run', '/tmp/kilo-project',
                     1700000060000, 1700000070000, 'ses_001')",
            [],
        )
        .unwrap();
        drop(conn);

        let children = load_child_sessions_at(&tmp.path().to_string_lossy(), "proj1", "ses_001");
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].id, "ses_child");
    }

    #[test]
    #[ignore = "requires a real Kilo store on this machine (KILO_HOME or ~/.local/share/kilo)"]
    fn real_store_smoke_scan_and_load() {
        let Some(base) = get_base_path() else {
            eprintln!("no Kilo store on this machine; nothing to verify");
            return;
        };
        let projects = scan_projects_at(&base).expect("scan real store");
        eprintln!("projects: {}", projects.len());
        assert!(!projects.is_empty(), "real Kilo store should have projects");

        let first = &projects[0];
        let sessions = load_sessions_at(&base, &first.path, false).expect("load sessions");
        eprintln!("sessions in {}: {}", first.name, sessions.len());
        assert!(!sessions.is_empty(), "first project should have sessions");

        let messages = load_messages_at(&base, &sessions[0].file_path).expect("load messages");
        eprintln!("messages in first session: {}", messages.len());
        assert!(!messages.is_empty(), "first session should have messages");
        assert_eq!(messages[0].provider.as_deref(), Some("kilo"));
    }

    #[test]
    fn detect_uses_kilo_home_override() {
        struct EnvVarGuard(&'static str);
        impl EnvVarGuard {
            fn set(key: &'static str, value: &std::ffi::OsStr) -> Self {
                std::env::set_var(key, value);
                Self(key)
            }
        }
        impl Drop for EnvVarGuard {
            fn drop(&mut self) {
                std::env::remove_var(self.0);
            }
        }

        let tmp = tempfile::tempdir().unwrap();
        let conn = create_test_db(tmp.path());
        drop(conn);

        let _guard = EnvVarGuard::set("KILO_HOME", tmp.path().as_os_str());
        let info = detect().expect("KILO_HOME store should be detected");
        assert_eq!(info.id, "kilo");
        assert_eq!(info.display_name, "Kilo Code");
        assert_eq!(info.base_path, tmp.path().to_string_lossy());
        assert!(info.is_available);
    }
}
