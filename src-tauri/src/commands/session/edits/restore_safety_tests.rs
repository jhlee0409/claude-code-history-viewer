//! Restore must never write something that is not a whole file.
//!
//! Every test drives the path the Edits screen drives: the real provider
//! loader, then `get_recent_edits_blocking` with the default grouping (the row
//! the screen shows), then `row.content_after_change` (what
//! `useFileEditActions.confirmRestore` sends), then `restore_file` (the Tauri
//! command; the Axum handler calls the same function).
//!
//! Invariant: after Restore the disk holds either the true full file version,
//! or, when Restore is refused, exactly what it held before. Patch text, a
//! one-line fragment or a tool-input JSON blob must never land on disk.

use super::*;
use crate::test_utils::SandboxHome;
use serial_test::serial;

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
            Some(v) => std::env::set_var(self.key, v),
            None => std::env::remove_var(self.key),
        }
    }
}

const ORIGINAL: &str =
    "fn alpha() {\n    1\n}\n\nfn beta() {\n    2\n}\n\nfn gamma() {\n    3\n}\n";
const EXPECTED_AFTER: &str =
    "fn alpha() {\n    1\n}\n\nfn beta() {\n    20\n}\n\nfn gamma() {\n    3\n}\n";

fn row_for<'a>(page: &'a PaginatedRecentEdits, file: &Path) -> &'a RecentFileEdit {
    let wanted = file_identity(&file.to_string_lossy());
    page.files
        .iter()
        .find(|e| file_identity(&e.file_path) == wanted)
        .unwrap_or_else(|| panic!("no row for {}: {:#?}", file.display(), page.files))
}

/// Run Restore the way the UI does: send the row's content verbatim.
async fn restore_like_ui(project_path: &str, row: &RecentFileEdit) -> Result<(), String> {
    restore_file(
        row.file_path.clone(),
        row.content_after_change.clone(),
        project_path.to_string(),
        None,
    )
    .await
}

/// After Restore the file is either the full version or untouched.
fn assert_full_or_untouched(label: &str, res: &Result<(), String>, file: &Path, before: &str) {
    let disk = fs::read_to_string(file).unwrap_or_default();
    match res {
        Ok(()) => assert_eq!(
            disk,
            EXPECTED_AFTER,
            "[{label}] Restore succeeded but wrote non-file content \
             ({} bytes of real code became {} bytes):\n{disk}",
            before.len(),
            disk.len()
        ),
        Err(_) => assert_eq!(
            disk, before,
            "[{label}] a refused restore must not touch the file"
        ),
    }
}

// ---------------------------------------------------------------------------
// Codex: `custom_tool_call` apply_patch, the only edit tool Codex has.
// ---------------------------------------------------------------------------

fn write_codex_rollout(codex_home: &Path, cwd: &Path, patch: &str) {
    let sessions = codex_home
        .join("sessions")
        .join("2026")
        .join("10")
        .join("19");
    fs::create_dir_all(&sessions).unwrap();
    let lines = [
        serde_json::json!({"timestamp":"2026-10-19T01:00:00Z","type":"session_meta",
            "payload":{"id":"sess-restore","cwd": cwd.to_string_lossy(),"originator":"codex_cli_rs","cli_version":"0.46.0"}}),
        serde_json::json!({"timestamp":"2026-10-19T01:00:01Z","type":"turn_context",
            "payload":{"cwd": cwd.to_string_lossy(),"model":"gpt-5-codex"}}),
        serde_json::json!({"timestamp":"2026-10-19T01:00:02Z","type":"response_item",
            "payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"bump beta"}]}}),
        serde_json::json!({"timestamp":"2026-10-19T01:00:03Z","type":"response_item",
            "payload":{"type":"custom_tool_call","status":"completed","call_id":"call_p1",
                       "name":"apply_patch","input": patch}}),
        serde_json::json!({"timestamp":"2026-10-19T01:00:04Z","type":"response_item",
            "payload":{"type":"custom_tool_call_output","call_id":"call_p1",
                       "output":"{\"output\":\"Success.\\n\",\"metadata\":{\"exit_code\":0}}"}}),
    ];
    let body: String = lines.iter().map(|l| l.to_string() + "\n").collect();
    fs::write(
        sessions.join("rollout-2026-10-19T01-00-00-sess-restore.jsonl"),
        body,
    )
    .unwrap();
}

#[tokio::test]
#[serial]
async fn codex_apply_patch_restore_does_not_write_patch_text() {
    let home = SandboxHome::new();
    let codex_home = home.path().join(".codex");
    let _g = EnvVarGuard::set("CODEX_HOME", &codex_home);

    let project = home.path().join("work").join("repo");
    fs::create_dir_all(project.join("src")).unwrap();
    let target = project.join("src").join("lib.rs");
    fs::write(&target, EXPECTED_AFTER).unwrap();
    fs::write(project.join("src").join("other.rs"), "new\n").unwrap();
    // Multi-file patch with relative paths, as Codex emits them.
    write_codex_rollout(
        &codex_home,
        &project,
        "*** Begin Patch\n*** Update File: src/lib.rs\n@@ fn beta() {\n-    2\n+    20\n\
         *** Update File: src/other.rs\n@@\n-old\n+new\n*** End Patch\n",
    );

    let project_path = format!("codex://{}", project.to_string_lossy());
    let page = get_recent_edits_blocking(project_path.clone(), None, None, None, None)
        .expect("recent edits for codex project");
    let row = row_for(&page, &target).clone();

    let res = restore_like_ui(&project_path, &row).await;
    let disk = fs::read_to_string(&target).unwrap();
    assert!(
        !disk.contains("*** Begin Patch"),
        "Restore wrote raw apply_patch text over {}:\n{disk}",
        target.display()
    );
    assert_full_or_untouched("codex apply_patch", &res, &target, EXPECTED_AFTER);
}

#[tokio::test]
#[serial]
async fn codex_delete_file_restore_does_not_recreate_the_file_as_patch_text() {
    let home = SandboxHome::new();
    let codex_home = home.path().join(".codex");
    let _g = EnvVarGuard::set("CODEX_HOME", &codex_home);

    let project = home.path().join("work").join("repo");
    fs::create_dir_all(project.join("src")).unwrap();
    // The patch deleted the file, so it is gone from disk: the compact row
    // leads with Restore for exactly this case.
    let deleted = project.join("src").join("gone.rs");
    write_codex_rollout(
        &codex_home,
        &project,
        "*** Begin Patch\n*** Delete File: src/gone.rs\n*** End Patch\n",
    );

    let project_path = format!("codex://{}", project.to_string_lossy());
    let page = get_recent_edits_blocking(project_path.clone(), None, None, None, None)
        .expect("recent edits for codex project");
    let row = row_for(&page, &deleted).clone();

    let res = restore_like_ui(&project_path, &row).await;
    assert!(
        res.is_err(),
        "a delete patch holds no file content to restore, got {res:?}"
    );
    assert!(
        !deleted.exists(),
        "Restore recreated a deleted file as patch text:\n{}",
        fs::read_to_string(&deleted).unwrap_or_default()
    );
}

// ---------------------------------------------------------------------------
// OpenCode and Kilo share one SQLite loader (`opencode::load_messages_at`).
// ---------------------------------------------------------------------------

/// Where a store lives and how its project paths are spelled.
struct SqliteStore {
    home_env: &'static str,
    db_file: &'static str,
    scheme: &'static str,
}

const OPENCODE: SqliteStore = SqliteStore {
    home_env: "OPENCODE_HOME",
    db_file: "opencode.db",
    scheme: "opencode",
};

const KILO: SqliteStore = SqliteStore {
    home_env: "KILO_HOME",
    db_file: "kilo.db",
    scheme: "kilo",
};

fn create_store_db(base: &Path, db_file: &str, worktree: &Path, tool_part: &serde_json::Value) {
    fs::create_dir_all(base).unwrap();
    let conn = rusqlite::Connection::open(base.join(db_file)).unwrap();
    conn.execute_batch(
        "CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL, name TEXT,
            time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
            sandboxes TEXT NOT NULL DEFAULT '[]', vcs TEXT, icon_url TEXT,
            icon_color TEXT, time_initialized INTEGER, commands TEXT);
         CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
            slug TEXT NOT NULL DEFAULT '', directory TEXT NOT NULL DEFAULT '',
            version TEXT NOT NULL DEFAULT '1.0', time_created INTEGER NOT NULL,
            time_updated INTEGER NOT NULL, parent_id TEXT, share_url TEXT,
            summary_additions INTEGER, summary_deletions INTEGER, summary_files INTEGER,
            summary_diffs TEXT, revert TEXT, permission TEXT, time_compacting INTEGER,
            time_archived INTEGER, workspace_id TEXT);
         CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
            time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
         CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
            time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);",
    )
    .unwrap();
    let wt = worktree.to_string_lossy().to_string();
    conn.execute(
        "INSERT INTO project (id, worktree, name, time_created, time_updated)
         VALUES ('proj1', ?1, 'repo', 1760835600000, 1760835700000)",
        rusqlite::params![wt],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO session (id, project_id, title, directory, time_created, time_updated)
         VALUES ('ses_1', 'proj1', 'restore', ?1, 1760835600000, 1760835700000)",
        rusqlite::params![wt],
    )
    .unwrap();
    conn.execute_batch(
        "INSERT INTO message (id, session_id, time_created, time_updated, data)
         VALUES ('msg_1', 'ses_1', 1760835610000, 1760835610000,
                 '{\"role\":\"user\",\"time\":{\"created\":1760835610000}}');
         INSERT INTO message (id, session_id, time_created, time_updated, data)
         VALUES ('msg_2', 'ses_1', 1760835620000, 1760835620000,
                 '{\"role\":\"assistant\",\"time\":{\"created\":1760835620000},\"parentID\":\"msg_1\",\"modelID\":\"claude-sonnet-4\"}');
         INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
         VALUES ('prt_1', 'msg_1', 'ses_1', 1760835610000, 1760835610000,
                 '{\"type\":\"text\",\"text\":\"bump beta\"}');",
    )
    .unwrap();
    conn.execute(
        "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
         VALUES ('prt_t0', 'msg_2', 'ses_1', 1760835620000, 1760835620000, ?1)",
        rusqlite::params![tool_part.to_string()],
    )
    .unwrap();
}

/// Load the row for one tool call from a fresh store and restore it like the UI.
async fn restore_store_tool_call(
    store: &SqliteStore,
    label: &str,
    mut tool_part: serde_json::Value,
) -> Result<(), String> {
    let home = SandboxHome::new();
    let base = home.path().join(".local").join("share").join(store.scheme);
    let _g = EnvVarGuard::set(store.home_env, &base);
    let project = home.path().join("work").join("repo");
    fs::create_dir_all(project.join("src")).unwrap();
    let target = project.join("src").join("lib.rs");
    fs::write(&target, EXPECTED_AFTER).unwrap();

    tool_part["state"]["input"]["filePath"] =
        serde_json::Value::String(target.to_string_lossy().into());
    create_store_db(&base, store.db_file, &project, &tool_part);

    let project_path = format!("{}://proj1", store.scheme);
    let page = get_recent_edits_blocking(project_path.clone(), None, None, None, None)
        .unwrap_or_else(|e| panic!("[{label}] recent edits: {e}"));
    let row = row_for(&page, &target).clone();

    let res = restore_like_ui(&project_path, &row).await;
    assert_full_or_untouched(label, &res, &target, EXPECTED_AFTER);
    res
}

fn edit_tool_part() -> serde_json::Value {
    serde_json::json!({"type":"tool","tool":"edit","callID":"call_e1",
        "state":{"status":"completed",
                 "input":{"oldString":"    2\n","newString":"    20\n"},
                 "output":"Edit applied successfully."}})
}

#[tokio::test]
#[serial]
async fn opencode_edit_restore_does_not_write_the_new_string_fragment() {
    let res = restore_store_tool_call(&OPENCODE, "opencode edit", edit_tool_part()).await;
    assert!(
        res.is_err(),
        "a new_string fragment is not a file version: {res:?}"
    );
}

#[tokio::test]
#[serial]
async fn kilo_edit_restore_does_not_write_the_new_string_fragment() {
    let res = restore_store_tool_call(&KILO, "kilo edit", edit_tool_part()).await;
    assert!(
        res.is_err(),
        "a new_string fragment is not a file version: {res:?}"
    );
}

#[tokio::test]
#[serial]
async fn opencode_multiedit_restore_does_not_write_the_tool_input_json() {
    let res = restore_store_tool_call(
        &OPENCODE,
        "opencode multiedit",
        serde_json::json!({"type":"tool","tool":"multiedit","callID":"call_m1",
            "state":{"status":"completed",
                     "input":{"edits":[{"oldString":"    2\n","newString":"    20\n"}]},
                     "output":"ok"}}),
    )
    .await;
    assert!(
        res.is_err(),
        "tool-input JSON is not a file version: {res:?}"
    );
}

/// Control: a `write` records the whole file, so Restore keeps working.
#[tokio::test]
#[serial]
async fn opencode_write_restore_writes_the_whole_file() {
    let res = restore_store_tool_call(
        &OPENCODE,
        "opencode write",
        serde_json::json!({"type":"tool","tool":"write","callID":"call_w1",
            "state":{"status":"completed",
                     "input":{"content": EXPECTED_AFTER},
                     "output":"ok"}}),
    )
    .await;
    assert!(
        res.is_ok(),
        "a recorded whole-file write must stay restorable: {res:?}"
    );
}

/// A write of empty `content` records a whole file: the empty file.
#[tokio::test]
#[serial]
async fn opencode_empty_write_restores_an_empty_file() {
    let home = SandboxHome::new();
    let base = home.path().join(".local").join("share").join("opencode");
    let _g = EnvVarGuard::set("OPENCODE_HOME", &base);
    let project = home.path().join("work").join("repo");
    fs::create_dir_all(project.join("src")).unwrap();
    let target = project.join("src").join("lib.rs");
    fs::write(&target, EXPECTED_AFTER).unwrap();
    let part = serde_json::json!({"type":"tool","tool":"write","callID":"call_w0",
        "state":{"status":"completed",
                 "input":{"filePath": target.to_string_lossy(), "content": ""},
                 "output":"ok"}});
    create_store_db(&base, "opencode.db", &project, &part);

    let project_path = "opencode://proj1".to_string();
    let page = get_recent_edits_blocking(project_path.clone(), None, None, None, None).unwrap();
    let row = row_for(&page, &target).clone();
    assert_eq!(
        row.content_after_change, "",
        "the row holds the empty file, not the tool input"
    );

    let res = restore_like_ui(&project_path, &row).await;
    assert!(
        res.is_ok(),
        "an empty whole-file write is restorable: {res:?}"
    );
    assert_eq!(fs::read_to_string(&target).unwrap(), "");
}

// ---------------------------------------------------------------------------
// Claude: Edit replays onto `originalFile`, so its rows are whole files.
// ---------------------------------------------------------------------------

fn claude_edit_line(cwd: &Path, file: &Path, old: &str, original: Option<&str>) -> String {
    let mut result = serde_json::json!({
        "filePath": file.to_string_lossy(),
        "oldString": old,
        "newString": "    20\n",
        "replaceAll": false,
        "userModified": false,
        "structuredPatch": []
    });
    if let Some(original) = original {
        result["originalFile"] = serde_json::Value::String(original.to_string());
    }
    serde_json::json!({
        "uuid":"u-1","parentUuid":"a-1","sessionId":"s-1","timestamp":"2026-10-19T01:00:00Z",
        "type":"user","cwd": cwd.to_string_lossy(),
        "message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"ok"}]},
        "toolUseResult": result
    })
    .to_string()
}

fn claude_write_line(cwd: &Path, file: &Path, uuid: &str, ts: &str, content: &str) -> String {
    serde_json::json!({
        "uuid": uuid, "sessionId":"s-1","timestamp": ts,
        "type":"user","cwd": cwd.to_string_lossy(),
        "toolUseResult": {"type":"create","filePath": file.to_string_lossy(),"content": content}
    })
    .to_string()
}

/// A Claude project directory whose one session is built by `lines` from the
/// repo root and the edited file, and the file itself.
struct ClaudeProject {
    _tmp: tempfile::TempDir,
    project_path: String,
    target: PathBuf,
}

fn claude_project(lines: impl Fn(&Path, &Path) -> Vec<String>) -> ClaudeProject {
    let tmp = tempfile::TempDir::new().unwrap();
    let project_dir = tmp.path().join("claude-proj");
    let cwd = tmp.path().join("repo");
    let target = cwd.join("src").join("lib.rs");
    fs::create_dir_all(&project_dir).unwrap();
    fs::create_dir_all(cwd.join("src")).unwrap();
    let body: String = lines(&cwd, &target)
        .iter()
        .map(|l| l.clone() + "\n")
        .collect();
    fs::write(project_dir.join("s.jsonl"), body).unwrap();
    ClaudeProject {
        project_path: project_dir.to_string_lossy().to_string(),
        _tmp: tmp,
        target,
    }
}

#[tokio::test]
#[serial]
async fn claude_edit_restore_writes_the_reconstructed_whole_file() {
    let p =
        claude_project(|cwd, file| vec![claude_edit_line(cwd, file, "    2\n", Some(ORIGINAL))]);
    fs::write(&p.target, "user changed it later\n").unwrap();

    let page = get_recent_edits_blocking(p.project_path.clone(), None, None, None, None).unwrap();
    let row = row_for(&page, &p.target).clone();
    assert_eq!(row.content_after_change, EXPECTED_AFTER);
    assert_eq!(row.content_kind, EditContentKind::Full);

    let res = restore_like_ui(&p.project_path, &row).await;
    assert!(res.is_ok(), "{res:?}");
    assert_eq!(fs::read_to_string(&p.target).unwrap(), EXPECTED_AFTER);
}

#[tokio::test]
#[serial]
async fn claude_edit_without_original_file_offers_no_row() {
    let p = claude_project(|cwd, file| vec![claude_edit_line(cwd, file, "    2\n", None)]);
    let page = get_recent_edits_blocking(p.project_path.clone(), None, None, None, None).unwrap();
    assert!(
        page.files.is_empty(),
        "no originalFile means no row, so nothing to restore"
    );
}

/// `old_string` absent from `originalFile`: replaying the edit changes
/// nothing, so the row is the pre-edit file presented as the post-edit one.
/// Restoring it would silently revert the edit.
#[tokio::test]
#[serial]
async fn claude_edit_whose_old_string_is_not_in_the_original_is_not_restorable() {
    let p =
        claude_project(|cwd, file| vec![claude_edit_line(cwd, file, "    7\n", Some(ORIGINAL))]);
    let before = "user changed it later\n";
    fs::write(&p.target, before).unwrap();

    let page = get_recent_edits_blocking(p.project_path.clone(), None, None, None, None).unwrap();
    let row = row_for(&page, &p.target).clone();
    assert_eq!(row.content_kind, EditContentKind::Unavailable);

    let res = restore_like_ui(&p.project_path, &row).await;
    assert!(
        res.is_err(),
        "an unreproducible edit must not restore: {res:?}"
    );
    assert_eq!(fs::read_to_string(&p.target).unwrap(), before);
}

// ---------------------------------------------------------------------------
// The backend enforces the rule itself, so an old frontend or a WebUI caller
// that sends arbitrary content cannot bypass it. The request is unchanged.
// ---------------------------------------------------------------------------

#[tokio::test]
#[serial]
async fn restore_refuses_content_that_is_not_a_recorded_whole_file_version() {
    let p = claude_project(|cwd, file| {
        vec![claude_write_line(
            cwd,
            file,
            "u-1",
            "2026-10-19T01:00:00Z",
            EXPECTED_AFTER,
        )]
    });
    fs::write(&p.target, EXPECTED_AFTER).unwrap();

    let res = restore_file(
        p.target.to_string_lossy().to_string(),
        "    20\n".to_string(),
        p.project_path.clone(),
        None,
    )
    .await;

    assert!(res.is_err(), "unrecorded content must be refused: {res:?}");
    assert_eq!(fs::read_to_string(&p.target).unwrap(), EXPECTED_AFTER);
}

#[tokio::test]
#[serial]
async fn restore_accepts_an_older_recorded_whole_file_version() {
    let p = claude_project(|cwd, file| {
        vec![
            claude_write_line(cwd, file, "u-1", "2026-10-19T01:00:00Z", ORIGINAL),
            claude_write_line(cwd, file, "u-2", "2026-10-19T02:00:00Z", EXPECTED_AFTER),
        ]
    });
    fs::write(&p.target, EXPECTED_AFTER).unwrap();

    restore_file(
        p.target.to_string_lossy().to_string(),
        ORIGINAL.to_string(),
        p.project_path.clone(),
        None,
    )
    .await
    .expect("every recorded whole-file version of the path is restorable");

    assert_eq!(fs::read_to_string(&p.target).unwrap(), ORIGINAL);
}

// ---------------------------------------------------------------------------
// Every row says what its content is, so the UI can offer Restore only for
// whole files.
// ---------------------------------------------------------------------------

#[test]
fn provider_rows_carry_the_kind_of_content_they_hold() {
    use EditContentKind::{Fragment, Full, Patch, Unavailable};
    let kinds = |tool: &str, input: serde_json::Value| -> Vec<EditContentKind> {
        build_tool_use_edits(tool, &input, "t", "s", None, Some("/repo"))
            .into_iter()
            .map(|edit| edit.content_kind)
            .collect()
    };

    let patch = "*** Begin Patch\n*** Update File: a.rs\n*** Delete File: b.rs\n*** End Patch\n";
    assert_eq!(
        kinds("apply_patch", serde_json::json!({ "patch": patch })),
        [Patch, Patch]
    );
    assert_eq!(
        kinds(
            "edit",
            serde_json::json!({"filePath": "/repo/a.rs", "old_string": "a", "new_string": "b"})
        ),
        [Fragment]
    );
    assert_eq!(
        kinds(
            "multiedit",
            serde_json::json!({"filePath": "/repo/a.rs", "edits": [{"old_string": "a", "new_string": "b"}]})
        ),
        [Unavailable]
    );
    assert_eq!(
        kinds(
            "write",
            serde_json::json!({"filePath": "/repo/a.rs", "content": "x"})
        ),
        [Full]
    );
    assert_eq!(
        kinds(
            "write_to_file",
            serde_json::json!({"TargetFile": "/repo/a.rs", "content": "x"})
        ),
        [Full]
    );
    // An empty write is the empty file, not missing content.
    let empty_write = build_tool_use_edits(
        "write",
        &serde_json::json!({"filePath": "/repo/a.rs", "content": ""}),
        "t",
        "s",
        None,
        Some("/repo"),
    );
    assert_eq!(empty_write.len(), 1);
    assert_eq!(empty_write[0].content_after_change, "");
    assert_eq!(empty_write[0].content_kind, Full);
    // An edit tool's `content` is not known to be the whole file.
    assert_eq!(
        kinds(
            "replace_file_content",
            serde_json::json!({"TargetFile": "/repo/a.rs", "content": "x"})
        ),
        [Fragment]
    );
}

#[tokio::test]
#[serial]
async fn claude_multiedit_row_is_unavailable_when_a_step_does_not_replay() {
    let multi = |cwd: &Path, file: &Path, olds: &[&str]| {
        let edits: Vec<_> = olds
            .iter()
            .map(|old| serde_json::json!({"old_string": old, "new_string": "x", "replace_all": false}))
            .collect();
        serde_json::json!({
            "uuid":"u-m","sessionId":"s-1","timestamp":"2026-10-19T03:00:00Z",
            "type":"user","cwd": cwd.to_string_lossy(),
            "toolUseResult": {"filePath": file.to_string_lossy(), "edits": edits, "originalFile": ORIGINAL}
        })
        .to_string()
    };

    let whole = claude_project(|cwd, file| vec![multi(cwd, file, &["    1\n", "    3\n"])]);
    let page =
        get_recent_edits_blocking(whole.project_path.clone(), None, None, None, None).unwrap();
    assert_eq!(
        row_for(&page, &whole.target).content_kind,
        EditContentKind::Full
    );

    // The second step's text is gone once the first step replaced it.
    let broken = claude_project(|cwd, file| vec![multi(cwd, file, &["    1\n", "    1\n"])]);
    let page =
        get_recent_edits_blocking(broken.project_path.clone(), None, None, None, None).unwrap();
    assert_eq!(
        row_for(&page, &broken.target).content_kind,
        EditContentKind::Unavailable
    );
}
