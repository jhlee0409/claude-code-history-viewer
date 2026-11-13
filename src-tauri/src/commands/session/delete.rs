use std::fs;
use std::path::{Path, PathBuf};
use tauri::command;

/// Removes a file or directory: tries the system trash first, falls back to permanent deletion.
///
/// `trash::delete` can fail on Windows when the Recycle Bin is disabled, on network drives,
/// or when the file is locked. In those cases we permanently delete rather than surfacing an
/// opaque "delete session failed" to the user (issue #256).
fn remove_path(path: &Path) -> Result<(), String> {
    if let Err(trash_err) = trash::delete(path) {
        if path.is_dir() {
            fs::remove_dir_all(path).map_err(|e| {
                format!("Trash failed: {trash_err}; permanent delete also failed: {e}")
            })?;
        } else {
            fs::remove_file(path).map_err(|e| {
                format!("Trash failed: {trash_err}; permanent delete also failed: {e}")
            })?;
        }
    }
    Ok(())
}

fn is_safe_session_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Fixed transcript filenames that live inside a per-session directory. Deleting
/// only the file would leave the rest of the session behind, so the parent
/// directory is the delete target instead.
fn is_session_bundle_filename(name: &str) -> bool {
    matches!(
        name,
        "events.jsonl" | "ui_messages.json" | "messages.jsonl" | "usage.jsonl"
    )
}

/// `<sessionId>.messages.json` (Cline SDK) → `sessionId`.
fn messages_json_session_id(file_name: &str) -> Option<&str> {
    file_name
        .strip_suffix(".messages.json")
        .filter(|id| is_safe_session_id(id))
}

/// Stem for a flat `.json` / `.jsonl` transcript (`session-abc.jsonl` → `session-abc`).
fn flat_transcript_session_id(path: &Path) -> Option<&str> {
    let ext = path.extension().and_then(|e| e.to_str())?;
    if !matches!(ext, "jsonl" | "json") {
        return None;
    }
    let stem = path.file_stem().and_then(|s| s.to_str())?;
    // `foo.messages.json` is handled as a session-bundle / parent-dir delete,
    // not as a flat transcript whose stem still contains a dot.
    if stem.contains('.') {
        return None;
    }
    is_safe_session_id(stem).then_some(stem)
}

/// What to trash for a filesystem session artifact.
enum DeletePlan {
    /// Trash this path (a session directory, or a whole session bundle).
    Target(PathBuf),
    /// Trash the transcript file, then best-effort its Claude-style sibling dir.
    FileAndSiblingDir(PathBuf),
}

fn unsupported_session_artifact() -> String {
    "Only .jsonl/.json session files or session directories can be deleted".to_string()
}

fn resolve_filesystem_delete_plan(path: &Path) -> Result<DeletePlan, String> {
    if !path.is_absolute() {
        return Err("Session path must be absolute".to_string());
    }

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid session filename".to_string())?;

    // Never treat a session-index file as a deletable session.
    if file_name == "sessions.json" {
        return Err("Session index files cannot be deleted as sessions".to_string());
    }

    // Shape-check file-like paths before touching the filesystem so missing
    // targets still report "unsupported" / "invalid id" rather than "not found".
    let looks_like_file = path.extension().is_some();
    if looks_like_file {
        let is_bundle = is_session_bundle_filename(file_name);
        let is_messages = messages_json_session_id(file_name).is_some();
        let is_flat = flat_transcript_session_id(path).is_some();
        if !is_bundle && !is_messages && !is_flat {
            return Err(unsupported_session_artifact());
        }
    }

    let metadata = fs::symlink_metadata(path)
        .map_err(|_| format!("Session path not found: {}", path.display()))?;

    if metadata.file_type().is_symlink() {
        return Err("Session path cannot be a symlink".to_string());
    }

    if metadata.is_dir() {
        if !is_safe_session_id(file_name) {
            return Err("Invalid session directory name".to_string());
        }
        return Ok(DeletePlan::Target(path.to_path_buf()));
    }

    if !metadata.is_file() {
        return Err("Session target must be a regular file or directory".to_string());
    }

    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| "Session file has no parent directory".to_string())?;
    let parent_name = parent.file_name().and_then(|n| n.to_str());

    if is_session_bundle_filename(file_name) {
        match parent_name {
            Some(name) if is_safe_session_id(name) => {
                return Ok(DeletePlan::Target(parent.to_path_buf()));
            }
            _ => return Err("Invalid session directory name".to_string()),
        }
    }

    if let Some(session_id) = messages_json_session_id(file_name) {
        if parent_name == Some(session_id) {
            return Ok(DeletePlan::Target(parent.to_path_buf()));
        }
        return Err("Cline transcript is not inside its session directory".to_string());
    }

    let session_id = flat_transcript_session_id(path).ok_or_else(unsupported_session_artifact)?;

    // `<uuid>/<uuid>.jsonl` (Cursor Agent) — trash the whole session folder.
    if parent_name == Some(session_id) {
        return Ok(DeletePlan::Target(parent.to_path_buf()));
    }

    Ok(DeletePlan::FileAndSiblingDir(path.to_path_buf()))
}

/// Moves a session artifact to the system trash (permanent delete on trash failure).
///
/// Supports:
/// - Claude/Codex-style `<id>.jsonl` (+ optional sibling `<id>/`)
/// - Flat `.json` transcripts (Gemini legacy, Continue, …)
/// - Session directories (Vibe, Antigravity, Kimi, …)
/// - Session-bundle files whose parent directory is the session
///   (`events.jsonl`, `ui_messages.json`, `<id>.messages.json`, …)
///
/// Virtual URI schemes are dispatched to provider-specific deleters.
#[command]
pub async fn delete_session(file_path: String) -> Result<(), String> {
    if file_path.starts_with("forgecode://") || file_path.starts_with("forgecode-db://") {
        return crate::providers::forgecode::delete_conversation(&file_path);
    }
    if file_path.starts_with("cursor://") {
        return crate::providers::cursor::delete_session(&file_path);
    }

    let path = Path::new(&file_path);
    let plan = resolve_filesystem_delete_plan(path)?;

    // Codex title cleanup only applies to flat rollout files, not whole dirs.
    if matches!(plan, DeletePlan::FileAndSiblingDir(_))
        && crate::providers::codex::is_session_path(&file_path)
    {
        if let Err(e) = crate::providers::codex::delete_session_title(&file_path) {
            log::warn!("Codex thread-row cleanup failed for {file_path}: {e}");
        }
    }

    match plan {
        DeletePlan::Target(target) => {
            remove_path(&target).map_err(|e| format!("Failed to delete session: {e}"))?;
        }
        DeletePlan::FileAndSiblingDir(file) => {
            remove_path(&file).map_err(|e| format!("Failed to delete session file: {e}"))?;

            // Best-effort sibling folder (`<uuid>/` next to `<uuid>.jsonl`).
            let associated_dir = file.with_extension("");
            if let Ok(dir_meta) = fs::symlink_metadata(&associated_dir) {
                if !dir_meta.file_type().is_symlink() && dir_meta.is_dir() {
                    let _ = remove_path(&associated_dir);
                }
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;
    use tempfile::TempDir;

    #[tokio::test]
    async fn reject_relative_path() {
        let err = delete_session("relative/path.jsonl".into())
            .await
            .unwrap_err();
        assert_eq!(err, "Session path must be absolute");
    }

    #[tokio::test]
    async fn reject_unsupported_extension() {
        let err = delete_session(crate::test_utils::abs("tmp/session.txt"))
            .await
            .unwrap_err();
        assert_eq!(
            err,
            "Only .jsonl/.json session files or session directories can be deleted"
        );
    }

    #[tokio::test]
    async fn reject_session_id_with_dots() {
        let err = delete_session(crate::test_utils::abs("tmp/a..b.jsonl"))
            .await
            .unwrap_err();
        assert_eq!(
            err,
            "Only .jsonl/.json session files or session directories can be deleted"
        );
    }

    #[tokio::test]
    async fn reject_session_id_with_spaces() {
        let err = delete_session(crate::test_utils::abs("tmp/bad name.jsonl"))
            .await
            .unwrap_err();
        assert_eq!(
            err,
            "Only .jsonl/.json session files or session directories can be deleted"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn reject_symlink() {
        let dir = TempDir::new().unwrap();
        let real_file = dir.path().join("real.jsonl");
        fs::write(&real_file, "{}").unwrap();

        let link_path = dir.path().join("link.jsonl");
        symlink(&real_file, &link_path).unwrap();

        let err = delete_session(link_path.to_string_lossy().into())
            .await
            .unwrap_err();
        assert_eq!(err, "Session path cannot be a symlink");
    }

    #[tokio::test]
    async fn reject_directory_named_like_jsonl_file() {
        // A directory whose name ends in `.jsonl` is not a safe session id
        // (contains a dot), so it must be rejected rather than trashed.
        let dir = TempDir::new().unwrap();
        let subdir = dir.path().join("session.jsonl");
        fs::create_dir(&subdir).unwrap();

        let err = delete_session(subdir.to_string_lossy().into())
            .await
            .unwrap_err();
        assert_eq!(err, "Invalid session directory name");
    }

    #[tokio::test]
    #[serial]
    async fn trash_valid_jsonl_file() {
        let _home = crate::test_utils::SandboxHome::new();
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("abc-123.jsonl");
        fs::write(&file, "{}\n").unwrap();

        delete_session(file.to_string_lossy().into()).await.unwrap();
        assert!(!file.exists());
    }

    #[tokio::test]
    #[serial]
    async fn trash_jsonl_and_associated_directory() {
        let _home = crate::test_utils::SandboxHome::new();
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("session-1.jsonl");
        let assoc_dir = dir.path().join("session-1");

        fs::write(&file, "{}\n").unwrap();
        fs::create_dir(&assoc_dir).unwrap();
        fs::write(assoc_dir.join("subagent.json"), "{}").unwrap();

        delete_session(file.to_string_lossy().into()).await.unwrap();
        assert!(!file.exists());
        assert!(!assoc_dir.exists());
    }

    #[tokio::test]
    #[serial]
    async fn trash_flat_json_transcript() {
        let _home = crate::test_utils::SandboxHome::new();
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("session-abc.json");
        fs::write(&file, "{}").unwrap();

        delete_session(file.to_string_lossy().into()).await.unwrap();
        assert!(!file.exists());
    }

    #[tokio::test]
    #[serial]
    async fn trash_session_directory() {
        let _home = crate::test_utils::SandboxHome::new();
        let dir = TempDir::new().unwrap();
        let session_dir = dir.path().join("sess-dir-1");
        fs::create_dir(&session_dir).unwrap();
        fs::write(session_dir.join("messages.jsonl"), "{}\n").unwrap();

        delete_session(session_dir.to_string_lossy().into())
            .await
            .unwrap();
        assert!(!session_dir.exists());
    }

    #[tokio::test]
    #[serial]
    async fn trash_copilot_session_bundle_via_events_jsonl() {
        let _home = crate::test_utils::SandboxHome::new();
        let dir = TempDir::new().unwrap();
        let session_dir = dir.path().join("db7c8929-0512-4bef-ab71-812df5a3f37c");
        fs::create_dir(&session_dir).unwrap();
        let events = session_dir.join("events.jsonl");
        fs::write(&events, "{}\n").unwrap();
        fs::write(session_dir.join("workspace.yaml"), "name: x\n").unwrap();

        delete_session(events.to_string_lossy().into())
            .await
            .unwrap();
        assert!(!session_dir.exists());
    }

    #[tokio::test]
    #[serial]
    async fn trash_cline_sdk_session_via_messages_json() {
        let _home = crate::test_utils::SandboxHome::new();
        let dir = TempDir::new().unwrap();
        let session_id = "1789440631474_h3yr0";
        let session_dir = dir.path().join(session_id);
        fs::create_dir(&session_dir).unwrap();
        let transcript = session_dir.join(format!("{session_id}.messages.json"));
        fs::write(&transcript, r#"{"messages":[]}"#).unwrap();
        fs::write(session_dir.join(format!("{session_id}.json")), "{}").unwrap();

        delete_session(transcript.to_string_lossy().into())
            .await
            .unwrap();
        assert!(!session_dir.exists());
    }

    #[tokio::test]
    #[serial]
    async fn trash_cursor_agent_transcript_directory() {
        let _home = crate::test_utils::SandboxHome::new();
        let dir = TempDir::new().unwrap();
        let session_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        let session_dir = dir.path().join(session_id);
        fs::create_dir(&session_dir).unwrap();
        let transcript = session_dir.join(format!("{session_id}.jsonl"));
        fs::write(&transcript, "{}\n").unwrap();

        delete_session(transcript.to_string_lossy().into())
            .await
            .unwrap();
        assert!(!session_dir.exists());
    }

    #[tokio::test]
    async fn reject_sessions_index_file() {
        let err = delete_session(crate::test_utils::abs("tmp/sessions.json"))
            .await
            .unwrap_err();
        assert_eq!(err, "Session index files cannot be deleted as sessions");
    }

    #[test]
    fn remove_path_deletes_file() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("test.txt");
        fs::write(&file, "data").unwrap();

        remove_path(&file).unwrap();
        assert!(!file.exists());
    }

    #[test]
    fn remove_path_deletes_directory() {
        let dir = TempDir::new().unwrap();
        let sub = dir.path().join("subdir");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("child.txt"), "data").unwrap();

        remove_path(&sub).unwrap();
        assert!(!sub.exists());
    }
}
