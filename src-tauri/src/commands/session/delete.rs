use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::command;

/// Moves `path` to the desktop trash.
///
/// Inside a Flatpak sandbox every granted directory (`~/.claude`, `~/.codex`,
/// …) is its own bind mount, so the `trash` crate sees it as a separate
/// "volume": it cannot rename into the home trash across the mount and would
/// instead create a `.Trash-<uid>` folder inside the provider's store, where no
/// file manager looks. GIO hands the file to the Trash portal instead
/// (`g_file_trash` uses `org.freedesktop.portal.Trash` whenever
/// `/.flatpak-info` exists), which trashes it on the host into the real trash.
/// The portal only accepts files the sandbox may write.
fn move_to_trash(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    if crate::utils::is_flatpak() {
        use gio::prelude::FileExt;
        return gio::File::for_path(path)
            .trash(gio::Cancellable::NONE)
            .map_err(|e| e.to_string());
    }
    trash::delete(path).map_err(|e| e.to_string())
}

/// Removes a file or directory: tries the system trash first, falls back to permanent deletion.
///
/// `trash::delete` can fail on Windows when the Recycle Bin is disabled, on network drives,
/// or when the file is locked. In those cases we permanently delete rather than surfacing an
/// opaque "delete session failed" to the user (issue #256).
fn remove_path(path: &Path) -> Result<(), String> {
    if let Err(trash_err) = move_to_trash(path) {
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

/// Moves `path` to the system trash, with no permanent-delete fallback: for
/// provider stores other than Claude's, and for every bulk clear, a failed
/// trash is an error the user sees, never a silent irreversible delete.
pub(super) fn trash_only(path: &Path) -> Result<(), String> {
    move_to_trash(path).map_err(|e| format!("Could not move to the trash: {e}"))
}

/// True if `path` names something under `root` (lexically, or once both are
/// resolved — `root` itself may sit behind a symlink).
fn is_under(root: &Path, path: &Path) -> bool {
    path.starts_with(root)
        || matches!(
            (root.canonicalize(), path.canonicalize()),
            (Ok(root), Ok(path)) if path.starts_with(&root)
        )
}

/// The normal components of `path` below `root`, after resolving both, or an
/// error if `path` does not lie strictly inside `root`.
fn components_inside(root: &Path, path: &Path) -> Result<(PathBuf, Vec<String>), String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("Failed to resolve session root: {e}"))?;
    let resolved = path
        .canonicalize()
        .map_err(|_| format!("Session path not found: {}", path.display()))?;
    let rel = resolved
        .strip_prefix(&root)
        .map_err(|_| "Session path is outside the provider's session root".to_string())?;
    let parts = rel
        .components()
        .map(|c| match c {
            Component::Normal(part) => part.to_str().map(str::to_string),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()
        .ok_or("Invalid session path")?;
    if parts.is_empty() {
        return Err("Session path is outside the provider's session root".to_string());
    }
    Ok((root, parts))
}

fn is_safe_session_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// What deleting one Cursor Agent CLI session removes.
pub(super) struct CursorAgentTargets {
    /// The `<projects>/<project>/agent-transcripts/<id>/` folder.
    pub session_dir: PathBuf,
    /// The `<project>` folder name the transcript sits in.
    pub project: String,
    /// The CLI's `<chats>/<workspace-hash>/<id>/` metadata folders.
    pub metadata_dirs: Vec<PathBuf>,
}

/// Cursor Agent CLI session: `<projects>/<project>/agent-transcripts/<id>/<id>.jsonl`
/// plus the CLI's chat metadata at `<chats>/<workspace-hash>/<id>/`.
///
/// The delete target is resolved here from the transcript path and must be the
/// `<id>/` transcript folder strictly inside `projects_root`; the metadata
/// folders must be strictly inside `chats_root`.
pub(super) fn resolve_cursor_agent_targets(
    projects_root: &Path,
    chats_root: Option<&Path>,
    transcript: &Path,
) -> Result<CursorAgentTargets, String> {
    let metadata = fs::symlink_metadata(transcript)
        .map_err(|_| format!("Session file not found: {}", transcript.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Session target must be a regular .jsonl file".to_string());
    }

    let (root, parts) = components_inside(projects_root, transcript)?;
    let [project, transcripts, id, file] = parts.as_slice() else {
        return Err("Not a Cursor Agent transcript path".to_string());
    };
    if transcripts != "agent-transcripts"
        || !is_safe_session_id(id)
        || *file != format!("{id}.jsonl")
        || !crate::utils::is_safe_storage_id(project)
    {
        return Err("Not a Cursor Agent transcript path".to_string());
    }
    let session_dir = root.join(project).join(transcripts).join(id);

    let metadata_dirs: Vec<PathBuf> = match chats_root.map(Path::canonicalize) {
        Some(Ok(chats)) => fs::read_dir(&chats)
            .map_err(|e| format!("Failed to read Cursor Agent chats: {e}"))?
            .filter_map(Result::ok)
            .map(|workspace| workspace.path().join(id))
            .filter(|dir| {
                fs::symlink_metadata(dir).is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink())
            })
            .filter(|dir| !crate::utils::is_symlink(dir.parent().unwrap_or(dir)))
            .collect(),
        _ => Vec::new(),
    };

    Ok(CursorAgentTargets {
        session_dir,
        project: project.clone(),
        metadata_dirs,
    })
}

/// Resolves a Cursor Agent session with [`resolve_cursor_agent_targets`] and
/// moves everything to the trash, or the delete fails.
fn delete_cursor_agent_session(
    projects_root: &Path,
    chats_root: Option<&Path>,
    transcript: &Path,
) -> Result<(), String> {
    let targets = resolve_cursor_agent_targets(projects_root, chats_root, transcript)?;
    trash_only(&targets.session_dir).map_err(|e| format!("Failed to delete session: {e}"))?;
    for dir in targets.metadata_dirs {
        trash_only(&dir).map_err(|e| {
            format!("The transcript was moved to the trash, but its Cursor Agent chat data was not: {e}")
        })?;
    }
    Ok(())
}

/// What deleting one Claude Code / Codex transcript removes.
pub(super) struct TranscriptTargets {
    /// The `<uuid>.jsonl` session file.
    pub file: PathBuf,
    /// Its `<dir>/<uuid>/` folder (subagents, tool-results), when one exists
    /// as a real directory.
    pub folder: Option<PathBuf>,
}

/// A Claude Code / Codex `<uuid>.jsonl`: the target must be an absolute,
/// plain `.jsonl` file (not a symlink) with a well-formed session ID.
pub(super) fn resolve_transcript_targets(path: &Path) -> Result<TranscriptTargets, String> {
    if !path.is_absolute() {
        return Err("Session path must be absolute".to_string());
    }
    if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
        return Err("Only .jsonl session files can be deleted".to_string());
    }

    let session_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "Invalid session filename".to_string())?;
    if !is_safe_session_id(session_id) {
        return Err("Invalid session ID format".to_string());
    }

    let metadata = fs::symlink_metadata(path)
        .map_err(|_| format!("Session file not found: {}", path.display()))?;
    if metadata.file_type().is_symlink() {
        return Err("Session file cannot be a symlink".to_string());
    }
    if !metadata.file_type().is_file() {
        return Err("Session target must be a regular .jsonl file".to_string());
    }

    let folder = path.with_extension("");
    let folder = fs::symlink_metadata(&folder)
        .is_ok_and(|m| !m.file_type().is_symlink() && m.is_dir())
        .then_some(folder);
    Ok(TranscriptTargets {
        file: path.to_path_buf(),
        folder,
    })
}

/// Deletes one session.
///
/// - `forgecode://…` / `cursor://…` ids are rows in that provider's database
///   and are deleted there.
/// - A path under the Cursor Agent CLI's `~/.cursor/projects` is resolved by
///   `delete_cursor_agent_session`.
/// - Anything else is a Claude Code / Codex `<uuid>.jsonl` resolved by
///   `resolve_transcript_targets`: the file and its `<dir>/<uuid>/` folder
///   (subagents, tool-results) are moved to the trash. If the system trash is
///   unavailable (e.g. a disabled Recycle Bin on Windows), it falls back to
///   permanent deletion so the operation does not fail outright (#256).
#[command]
pub async fn delete_session(file_path: String) -> Result<(), String> {
    if file_path.starts_with("forgecode://") || file_path.starts_with("forgecode-db://") {
        return crate::providers::forgecode::delete_conversation(&file_path);
    }
    if file_path.starts_with("cursor://") {
        return crate::providers::cursor::delete_session(&file_path);
    }

    let path = Path::new(&file_path);

    if path.is_absolute() && path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
        if let Some(root) = crate::providers::cursor_agent::get_base_path() {
            let root = Path::new(&root);
            if is_under(root, path) {
                return delete_cursor_agent_session(
                    root,
                    crate::providers::cursor_agent::chats_root().as_deref(),
                    path,
                );
            }
        }
    }

    let targets = resolve_transcript_targets(path)?;

    // If this is a Codex rollout, clean up its native-rename row in
    // `state_5.sqlite` before the transcript is trashed (the session id is read
    // from the rollout). Best-effort — never block the delete on DB cleanup.
    if crate::providers::codex::is_session_path(&file_path) {
        if let Err(e) = crate::providers::codex::delete_session_title(&file_path) {
            log::warn!("Codex thread-row cleanup failed for {file_path}: {e}");
        }
    }

    // Delete the .jsonl first (authoritative artifact), then the associated folder.
    // Tries the system trash first, falls back to permanent deletion on failure.
    remove_path(&targets.file).map_err(|e| format!("Failed to delete session file: {e}"))?;

    // Best-effort removal of associated folder — don't fail if it can't be removed
    // since the primary .jsonl file is already gone
    if let Some(folder) = targets.folder {
        let _ = remove_path(&folder);
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
    async fn reject_non_jsonl_extension() {
        let err = delete_session(crate::test_utils::abs("tmp/session.txt"))
            .await
            .unwrap_err();
        assert_eq!(err, "Only .jsonl session files can be deleted");
    }

    #[tokio::test]
    #[serial]
    async fn reject_session_id_with_dots() {
        let _home = crate::test_utils::SandboxHome::new();
        let err = delete_session(crate::test_utils::abs("tmp/a..b.jsonl"))
            .await
            .unwrap_err();
        assert_eq!(err, "Invalid session ID format");
    }

    #[tokio::test]
    #[serial]
    async fn reject_session_id_with_spaces() {
        let _home = crate::test_utils::SandboxHome::new();
        let err = delete_session(crate::test_utils::abs("tmp/bad name.jsonl"))
            .await
            .unwrap_err();
        assert_eq!(err, "Invalid session ID format");
    }

    #[cfg(unix)]
    #[tokio::test]
    #[serial]
    async fn reject_symlink() {
        let _home = crate::test_utils::SandboxHome::new();
        let dir = TempDir::new().unwrap();
        let real_file = dir.path().join("real.jsonl");
        fs::write(&real_file, "{}").unwrap();

        let link_path = dir.path().join("link.jsonl");
        symlink(&real_file, &link_path).unwrap();

        let err = delete_session(link_path.to_string_lossy().into())
            .await
            .unwrap_err();
        assert_eq!(err, "Session file cannot be a symlink");
    }

    #[tokio::test]
    #[serial]
    async fn reject_directory_target() {
        let _home = crate::test_utils::SandboxHome::new();
        let dir = TempDir::new().unwrap();
        let subdir = dir.path().join("session.jsonl");
        fs::create_dir(&subdir).unwrap();

        let err = delete_session(subdir.to_string_lossy().into())
            .await
            .unwrap_err();
        assert_eq!(err, "Session target must be a regular .jsonl file");
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

    /// `~/.cursor/projects/<project>/agent-transcripts/<id>/<id>.jsonl` and
    /// `~/.cursor/chats/<hash>/<id>/` in a sandbox home.
    fn cursor_agent_session(home: &Path, id: &str) -> (PathBuf, PathBuf, PathBuf) {
        let session_dir = home
            .join(".cursor/projects/Users-me-proj/agent-transcripts")
            .join(id);
        fs::create_dir_all(&session_dir).unwrap();
        let transcript = session_dir.join(format!("{id}.jsonl"));
        fs::write(&transcript, "{}\n").unwrap();
        let meta_dir = home.join(".cursor/chats/0123abcd").join(id);
        fs::create_dir_all(&meta_dir).unwrap();
        fs::write(meta_dir.join("meta.json"), r#"{"title":"t"}"#).unwrap();
        (transcript, session_dir, meta_dir)
    }

    #[tokio::test]
    #[serial]
    async fn cursor_agent_delete_trashes_transcript_folder_and_chat_metadata() {
        let home = crate::test_utils::SandboxHome::new();
        let id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        let (transcript, session_dir, meta_dir) = cursor_agent_session(home.path(), id);
        let (_, other_dir, other_meta) = cursor_agent_session(home.path(), "keep-me");

        delete_session(transcript.to_string_lossy().into())
            .await
            .unwrap();
        assert!(!session_dir.exists());
        assert!(!meta_dir.exists());
        assert!(other_dir.exists());
        assert!(other_meta.exists());
        assert!(session_dir.parent().unwrap().is_dir());
    }

    /// Only `<id>/<id>.jsonl` names a Cursor Agent session; any other path
    /// under the root (the root, a project, a mismatched file) is refused
    /// rather than resolved to a parent folder.
    #[tokio::test]
    #[serial]
    async fn cursor_agent_delete_refuses_paths_that_are_not_a_transcript() {
        let home = crate::test_utils::SandboxHome::new();
        let (transcript, session_dir, _) = cursor_agent_session(home.path(), "sess-1");
        let stray = session_dir.join("other.jsonl");
        fs::write(&stray, "{}\n").unwrap();
        let root = home.path().join(".cursor/projects");

        for bad in [
            root.clone(),
            root.join("Users-me-proj"),
            session_dir.clone(),
            stray.clone(),
        ] {
            assert!(
                delete_session(bad.to_string_lossy().into()).await.is_err(),
                "{}",
                bad.display()
            );
        }
        assert!(transcript.exists());
        assert!(stray.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    #[serial]
    async fn cursor_agent_delete_refuses_a_transcript_reached_through_a_symlink() {
        let home = crate::test_utils::SandboxHome::new();
        let outside = TempDir::new().unwrap();
        let id = "sess-2";
        let real = outside.path().join("agent-transcripts").join(id);
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join(format!("{id}.jsonl")), "{}\n").unwrap();
        let projects = home.path().join(".cursor/projects");
        fs::create_dir_all(&projects).unwrap();
        symlink(outside.path(), projects.join("linked")).unwrap();

        let via_link = projects
            .join("linked/agent-transcripts")
            .join(id)
            .join(format!("{id}.jsonl"));
        let err = delete_session(via_link.to_string_lossy().into())
            .await
            .unwrap_err();
        assert_eq!(err, "Session path is outside the provider's session root");
        assert!(real.exists());
    }
}
