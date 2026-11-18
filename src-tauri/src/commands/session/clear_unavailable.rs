//! Clearing the sessions of a project whose last-known location is gone (#780).
//!
//! "Unavailable" only means the folder is not there right now: an unmounted
//! drive, a network share, history synced from another machine and a renamed
//! folder all look the same. So nothing here decides on its own:
//!
//! - [`preview_unavailable_session_cleanup`] resolves, per project, the exact
//!   files and folders the per-session delete resolvers would move to the
//!   trash, and the sessions that cannot be cleared and why.
//! - [`clear_unavailable_sessions`] moves only the sessions the user confirmed
//!   from that preview, re-validating each one at that moment: the project is
//!   still inside its provider's session root, its location is still missing,
//!   and the session still resolves to a target inside the project.
//!
//! Only stores whose delete moves everything to the system trash take part:
//! Claude Code and Codex transcripts and Cursor Agent transcript folders. A
//! failed trash is an error here, never the permanent-delete fallback the
//! single-session Claude delete uses (#256). Cursor and `ForgeCode`
//! conversations are database rows deleted permanently, and every other
//! provider has no verified delete: their projects are reported, not cleared.

use super::delete::{resolve_cursor_agent_targets, resolve_transcript_targets, trash_only};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// A project as the scan listed it.
#[derive(Debug, Clone, Deserialize)]
pub struct UnavailableProjectRef {
    /// Provider id; absent means Claude Code, as on `ClaudeProject`.
    #[serde(default)]
    pub provider: Option<String>,
    /// The project's `path` (its session store, or a `codex://` id).
    pub path: String,
}

/// Why a project's sessions are not cleared.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CleanupExclusion {
    /// The provider deletes permanently (database rows); there is no trash.
    PermanentDelete,
    /// The provider has no verified session delete.
    Unsupported,
    /// The project's last-known location exists.
    LocationAvailable,
    /// Not a session store of that provider (outside its root, a symlink, gone).
    InvalidProject,
}

/// One session that would be moved to the trash.
#[derive(Debug, Serialize)]
pub struct CleanupTarget {
    pub session_path: String,
    /// Everything moved to the trash for this session, the session itself first.
    pub trash_paths: Vec<String>,
}

/// One session of an eligible project that is not cleared.
#[derive(Debug, Serialize)]
pub struct SkippedSession {
    pub session_path: String,
    pub reason: String,
}

#[derive(Debug, Serialize)]
pub struct UnavailableCleanupPreview {
    pub provider: String,
    pub project_path: String,
    /// The project's last-known location, when the project was resolved.
    pub location: Option<String>,
    pub excluded: Option<CleanupExclusion>,
    /// What made the project invalid, for [`CleanupExclusion::InvalidProject`].
    pub detail: Option<String>,
    pub targets: Vec<CleanupTarget>,
    pub skipped: Vec<SkippedSession>,
}

/// The previewed sessions of one project the user confirmed.
#[derive(Debug, Clone, Deserialize)]
pub struct ConfirmedCleanup {
    #[serde(default)]
    pub provider: Option<String>,
    pub path: String,
    pub session_paths: Vec<String>,
}

/// The outcome for one confirmed session: `error` is `None` when everything
/// was moved to the trash.
#[derive(Debug, Serialize)]
pub struct ClearedSession {
    pub provider: String,
    pub project_path: String,
    pub session_path: String,
    pub error: Option<String>,
}

const LOCATION_IS_BACK: &str =
    "The project's location exists again; nothing was moved to the trash";
const NOT_IN_PROJECT: &str = "The session is not in this project's folder";

#[derive(Debug)]
struct Excluded {
    reason: CleanupExclusion,
    detail: Option<String>,
    location: Option<String>,
}

impl Excluded {
    fn invalid(detail: impl Into<String>) -> Self {
        Self {
            reason: CleanupExclusion::InvalidProject,
            detail: Some(detail.into()),
            location: None,
        }
    }

    fn of(reason: CleanupExclusion) -> Self {
        Self {
            reason,
            detail: None,
            location: None,
        }
    }

    /// The error reported for each confirmed session of an excluded project.
    fn message(&self) -> String {
        match self.reason {
            CleanupExclusion::PermanentDelete => {
                "This provider deletes permanently, so its sessions are not cleared in bulk"
                    .to_string()
            }
            CleanupExclusion::Unsupported => {
                "This provider's sessions cannot be deleted".to_string()
            }
            CleanupExclusion::LocationAvailable => LOCATION_IS_BACK.to_string(),
            CleanupExclusion::InvalidProject => self
                .detail
                .clone()
                .unwrap_or_else(|| "Not a session folder of this provider".to_string()),
        }
    }
}

enum Store {
    /// A folder directly inside a Claude `projects/` directory (resolved).
    Claude { project_dir: PathBuf },
    /// Codex rollouts whose recorded cwd is `cwd`.
    Codex { project_path: String, cwd: String },
    /// A folder directly inside `~/.cursor/projects` (both resolved).
    CursorAgent {
        root: PathBuf,
        chats: Option<PathBuf>,
        project_dir: PathBuf,
    },
}

struct Project {
    store: Store,
    location: String,
}

fn provider_id(provider: Option<&str>) -> &str {
    provider.unwrap_or("claude")
}

/// Providers whose projects the cleanup resolves and clears; every other one
/// is reported as excluded without being opened. Keep in sync with
/// `resolve_store` below and `TRASH_CLEANUP_PROVIDER_IDS` in
/// `src/utils/providers.ts`.
#[cfg(feature = "webui-server")]
pub fn is_trash_cleanup_provider(provider: Option<&str>) -> bool {
    matches!(provider_id(provider), "claude" | "codex" | "cursor-agent")
}

/// The location a project was listed under is unavailable: an absolute path
/// that is not a directory, exactly as the sidebar decides it.
fn location_missing(location: &str) -> bool {
    crate::models::project_path_status(location).is_some()
}

/// `path` is a real directory (not a symlink) directly inside one of
/// `roots`; returns it resolved.
fn folder_directly_inside(roots: &[PathBuf], path: &str) -> Result<PathBuf, Excluded> {
    let dir = Path::new(path);
    let meta =
        fs::symlink_metadata(dir).map_err(|_| Excluded::invalid("Project folder not found"))?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err(Excluded::invalid("Project folder must be a real directory"));
    }
    let resolved = dir
        .canonicalize()
        .map_err(|_| Excluded::invalid("Project folder not found"))?;
    if roots
        .iter()
        .any(|root| resolved.parent() == Some(root.as_path()))
    {
        Ok(resolved)
    } else {
        Err(Excluded::invalid(
            "Project folder is not inside the provider's session folder",
        ))
    }
}

/// Every Claude `projects/` directory the app reads, resolved: the default
/// root plus the configured ones (Settings, `CLAUDE_CONFIG_DIR`).
fn claude_projects_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = crate::providers::claude::base_path_or_default("")
        .map(|base| base.join("projects"))
        .into_iter()
        .collect();
    for dir in super::rename::configured_claude_dirs() {
        if let Ok(projects) = crate::utils::validate_custom_claude_path(Path::new(&dir)) {
            roots.push(projects);
        }
    }
    roots
        .into_iter()
        .filter_map(|root| root.canonicalize().ok())
        .collect()
}

fn resolve_store(provider: &str, path: &str) -> Result<Project, Excluded> {
    match provider {
        "claude" => {
            let project_dir = folder_directly_inside(&claude_projects_roots(), path)?;
            let location = crate::commands::project::claude_project_location(&project_dir)
                .ok_or_else(|| Excluded::invalid("Project folder has no sessions"))?;
            Ok(Project {
                store: Store::Claude { project_dir },
                location,
            })
        }
        "codex" => {
            let cwd = path
                .strip_prefix("codex://")
                .filter(|cwd| !cwd.is_empty())
                .ok_or_else(|| Excluded::invalid("Not a Codex project"))?;
            Ok(Project {
                store: Store::Codex {
                    project_path: path.to_string(),
                    cwd: cwd.to_string(),
                },
                location: cwd.to_string(),
            })
        }
        "cursor-agent" => {
            let root = crate::providers::cursor_agent::get_base_path()
                .and_then(|root| Path::new(&root).canonicalize().ok())
                .ok_or_else(|| Excluded::invalid("Cursor Agent projects folder not found"))?;
            let project_dir = folder_directly_inside(std::slice::from_ref(&root), path)?;
            let (_, location) = crate::providers::cursor_agent::project_display(&project_dir);
            Ok(Project {
                store: Store::CursorAgent {
                    root,
                    chats: crate::providers::cursor_agent::chats_root(),
                    project_dir,
                },
                location,
            })
        }
        "cursor" | "forgecode" => Err(Excluded::of(CleanupExclusion::PermanentDelete)),
        _ => Err(Excluded::of(CleanupExclusion::Unsupported)),
    }
}

/// Resolves a listed project, refusing one whose location exists.
fn resolve_project(provider: &str, path: &str) -> Result<Project, Excluded> {
    let project = resolve_store(provider, path)?;
    if !location_missing(&project.location) {
        return Err(Excluded {
            reason: CleanupExclusion::LocationAvailable,
            detail: None,
            location: Some(project.location),
        });
    }
    Ok(project)
}

impl Project {
    /// The project's sessions, as its provider lists them.
    fn sessions(&self) -> Result<Vec<PathBuf>, String> {
        match &self.store {
            Store::Claude { project_dir } => {
                let mut sessions: Vec<PathBuf> = fs::read_dir(project_dir)
                    .map_err(|e| format!("Failed to read the project folder: {e}"))?
                    .filter_map(Result::ok)
                    .map(|entry| entry.path())
                    .filter(|path| path.extension().and_then(|e| e.to_str()) == Some("jsonl"))
                    .collect();
                sessions.sort();
                Ok(sessions)
            }
            Store::Codex { project_path, .. } => {
                crate::providers::codex::load_sessions(project_path, false)
                    .map(|sessions| sessions.into_iter().map(|s| s.file_path.into()).collect())
            }
            Store::CursorAgent { project_dir, .. } => {
                let mut sessions = crate::providers::cursor_agent::transcript_paths(project_dir);
                sessions.sort();
                Ok(sessions)
            }
        }
    }

    /// What clearing `session` moves to the trash, the session itself first,
    /// resolved by the provider's per-session delete resolver and confined to
    /// this project.
    fn targets(&self, session: &Path) -> Result<Vec<PathBuf>, String> {
        match &self.store {
            Store::Claude { project_dir } => {
                let parent = session.parent().and_then(|p| p.canonicalize().ok());
                if parent.as_deref() != Some(project_dir.as_path()) {
                    return Err(NOT_IN_PROJECT.to_string());
                }
                let targets = resolve_transcript_targets(session)?;
                // The project's location comes from its newest session; an
                // older one may have run in a folder that still exists.
                if let Some(cwd) =
                    crate::commands::project::extract_cwd_from_session_file(session, project_dir)
                {
                    if !location_missing(&cwd) {
                        return Err(format!("This session's working folder still exists: {cwd}"));
                    }
                }
                Ok(std::iter::once(targets.file)
                    .chain(targets.folder)
                    .collect())
            }
            Store::Codex { cwd, .. } => {
                let session_str = session.to_string_lossy();
                if !crate::providers::codex::is_session_path(&session_str) {
                    return Err("Not a Codex rollout inside the Codex session folders".to_string());
                }
                match crate::providers::codex::extract_session_cwd(session) {
                    Ok(Some(session_cwd)) if session_cwd == *cwd => {}
                    _ => return Err(NOT_IN_PROJECT.to_string()),
                }
                let targets = resolve_transcript_targets(session)?;
                Ok(std::iter::once(targets.file)
                    .chain(targets.folder)
                    .collect())
            }
            Store::CursorAgent {
                root,
                chats,
                project_dir,
            } => {
                let targets = resolve_cursor_agent_targets(root, chats.as_deref(), session)?;
                if Some(targets.project.as_str())
                    != project_dir.file_name().and_then(|n| n.to_str())
                {
                    return Err(NOT_IN_PROJECT.to_string());
                }
                Ok(std::iter::once(targets.session_dir)
                    .chain(targets.metadata_dirs)
                    .collect())
            }
        }
    }

    /// Re-validates one confirmed session and moves its targets to the trash.
    fn clear(&self, session: &str) -> Result<(), String> {
        if !location_missing(&self.location) {
            return Err(LOCATION_IS_BACK.to_string());
        }
        let session = Path::new(session);
        let targets = self.targets(session)?;
        let (first, rest) = targets
            .split_first()
            .ok_or_else(|| "Nothing to move to the trash".to_string())?;

        if let Store::Codex { .. } = self.store {
            // As the single-session delete does: drop the native-rename row
            // before the rollout goes. Best-effort.
            let session_str = session.to_string_lossy();
            if let Err(e) = crate::providers::codex::delete_session_title(&session_str) {
                log::warn!("Codex thread-row cleanup failed for {session_str}: {e}");
            }
        }

        trash_only(first)?;
        for path in rest {
            trash_only(path).map_err(|e| {
                format!(
                    "The session was moved to the trash, but {} was not: {e}",
                    path.display()
                )
            })?;
        }
        Ok(())
    }
}

fn preview_project(project: &UnavailableProjectRef) -> UnavailableCleanupPreview {
    let provider = provider_id(project.provider.as_deref()).to_string();
    let mut preview = UnavailableCleanupPreview {
        provider: provider.clone(),
        project_path: project.path.clone(),
        location: None,
        excluded: None,
        detail: None,
        targets: Vec::new(),
        skipped: Vec::new(),
    };

    let resolved = match resolve_project(&provider, &project.path) {
        Ok(resolved) => resolved,
        Err(excluded) => {
            preview.excluded = Some(excluded.reason);
            preview.detail = excluded.detail;
            preview.location = excluded.location;
            return preview;
        }
    };
    preview.location = Some(resolved.location.clone());

    let sessions = match resolved.sessions() {
        Ok(sessions) => sessions,
        Err(e) => {
            preview.excluded = Some(CleanupExclusion::InvalidProject);
            preview.detail = Some(e);
            return preview;
        }
    };
    for session in sessions {
        let session_path = session.to_string_lossy().to_string();
        match resolved.targets(&session) {
            Ok(paths) => preview.targets.push(CleanupTarget {
                session_path,
                trash_paths: paths
                    .iter()
                    .map(|p| p.to_string_lossy().to_string())
                    .collect(),
            }),
            Err(reason) => preview.skipped.push(SkippedSession {
                session_path,
                reason,
            }),
        }
    }
    preview
}

fn clear_project(confirmed: &ConfirmedCleanup) -> Vec<ClearedSession> {
    let provider = provider_id(confirmed.provider.as_deref()).to_string();
    let project = resolve_project(&provider, &confirmed.path);
    confirmed
        .session_paths
        .iter()
        .map(|session_path| ClearedSession {
            provider: provider.clone(),
            project_path: confirmed.path.clone(),
            session_path: session_path.clone(),
            error: match &project {
                Ok(project) => project.clear(session_path).err(),
                Err(excluded) => Some(excluded.message()),
            },
        })
        .collect()
}

/// Resolves, for each project, exactly what clearing it would move to the
/// trash. Changes nothing.
#[tauri::command]
pub async fn preview_unavailable_session_cleanup(
    projects: Vec<UnavailableProjectRef>,
) -> Result<Vec<UnavailableCleanupPreview>, String> {
    tauri::async_runtime::spawn_blocking(move || projects.iter().map(preview_project).collect())
        .await
        .map_err(|e| format!("Task join error: {e}"))
}

/// Moves the confirmed sessions to the trash, one at a time, re-validating
/// each first. Returns one outcome per confirmed session, in order; a failed
/// session never stops the others.
#[tauri::command]
pub async fn clear_unavailable_sessions(
    projects: Vec<ConfirmedCleanup>,
) -> Result<Vec<ClearedSession>, String> {
    tauri::async_runtime::spawn_blocking(move || projects.iter().flat_map(clear_project).collect())
        .await
        .map_err(|e| format!("Task join error: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::SandboxHome;
    use serial_test::serial;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;

    /// A Claude project folder in the sandbox whose sessions ran in `cwd`.
    fn claude_project(home: &Path, folder: &str, cwd: &Path, sessions: &[&str]) -> PathBuf {
        let dir = home.join(".claude").join("projects").join(folder);
        fs::create_dir_all(&dir).unwrap();
        for id in sessions {
            write_session(&dir, id, cwd);
        }
        dir
    }

    fn write_session(dir: &Path, id: &str, cwd: &Path) -> PathBuf {
        let file = dir.join(format!("{id}.jsonl"));
        let line = serde_json::json!({ "type": "user", "cwd": cwd.to_string_lossy() });
        fs::write(&file, format!("{line}\n")).unwrap();
        file
    }

    fn reference(path: &Path) -> UnavailableProjectRef {
        UnavailableProjectRef {
            provider: None,
            path: path.to_string_lossy().to_string(),
        }
    }

    fn preview(project: UnavailableProjectRef) -> UnavailableCleanupPreview {
        preview_project(&project)
    }

    fn confirm(project: &Path, sessions: &[&Path]) -> ConfirmedCleanup {
        ConfirmedCleanup {
            provider: None,
            path: project.to_string_lossy().to_string(),
            session_paths: sessions
                .iter()
                .map(|s| s.to_string_lossy().to_string())
                .collect(),
        }
    }

    #[test]
    #[serial]
    fn preview_lists_each_session_and_its_folder_without_touching_them() {
        let home = SandboxHome::new();
        let gone = home.path().join("removed").join("app");
        let dir = claude_project(home.path(), "-removed-app", &gone, &["s-1", "s-2"]);
        fs::create_dir(dir.join("s-1")).unwrap();
        fs::write(dir.join("s-1").join("subagent.jsonl"), "{}\n").unwrap();
        fs::write(dir.join("notes.md"), "kept").unwrap();

        let result = preview(reference(&dir));

        assert_eq!(result.excluded, None);
        assert_eq!(result.location.as_deref(), Some(&*gone.to_string_lossy()));
        let targets: Vec<_> = result
            .targets
            .iter()
            .map(|t| t.trash_paths.clone())
            .collect();
        let canonical = dir.canonicalize().unwrap();
        assert_eq!(
            targets,
            vec![
                vec![
                    canonical.join("s-1.jsonl").to_string_lossy().to_string(),
                    canonical.join("s-1").to_string_lossy().to_string(),
                ],
                vec![canonical.join("s-2.jsonl").to_string_lossy().to_string()],
            ]
        );
        assert!(dir.join("s-1.jsonl").exists() && dir.join("s-1").exists());
    }

    #[test]
    #[serial]
    fn preview_excludes_permanent_and_unsupported_providers() {
        let _home = SandboxHome::new();
        for (provider, reason) in [
            ("cursor", CleanupExclusion::PermanentDelete),
            ("forgecode", CleanupExclusion::PermanentDelete),
            ("gemini", CleanupExclusion::Unsupported),
            ("cline", CleanupExclusion::Unsupported),
        ] {
            let result = preview(UnavailableProjectRef {
                provider: Some(provider.to_string()),
                path: crate::test_utils::abs("gone/project"),
            });
            assert_eq!(result.excluded, Some(reason), "{provider}");
            assert!(result.targets.is_empty());
        }
    }

    #[test]
    #[serial]
    fn preview_refuses_a_project_whose_location_exists() {
        let home = SandboxHome::new();
        let here = home.path().join("work").join("app");
        fs::create_dir_all(&here).unwrap();
        let dir = claude_project(home.path(), "-elsewhere-app", &here, &["s-1"]);

        let result = preview(reference(&dir));

        assert_eq!(result.excluded, Some(CleanupExclusion::LocationAvailable));
        assert!(result.targets.is_empty());
    }

    /// Only a folder directly inside a provider's session root is a project:
    /// the root itself, a folder outside every root and a nested folder are not.
    #[test]
    #[serial]
    fn preview_refuses_folders_that_are_not_a_project_of_the_root() {
        let home = SandboxHome::new();
        let gone = home.path().join("gone");
        let dir = claude_project(home.path(), "-gone", &gone, &["s-1"]);
        let nested = dir.join("s-1");
        fs::create_dir(&nested).unwrap();
        let outside = home.path().join("elsewhere").join("-gone");
        fs::create_dir_all(&outside).unwrap();
        write_session(&outside, "s-1", &gone);

        for bad in [
            home.path().join(".claude").join("projects"),
            outside.clone(),
            nested,
        ] {
            let result = preview(reference(&bad));
            assert_eq!(
                result.excluded,
                Some(CleanupExclusion::InvalidProject),
                "{}",
                bad.display()
            );
        }
        assert!(outside.join("s-1.jsonl").exists());
    }

    #[test]
    #[serial]
    fn preview_skips_a_session_whose_own_folder_still_exists() {
        let home = SandboxHome::new();
        let gone = home.path().join("gone").join("app");
        let alive = home.path().join("alive");
        fs::create_dir_all(&alive).unwrap();
        let dir = claude_project(home.path(), "-gone-app", &gone, &["new"]);
        let old = write_session(&dir, "old", &alive);
        // The newest session decides the project's location.
        let past = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        fs::File::options()
            .write(true)
            .open(&old)
            .unwrap()
            .set_modified(past)
            .unwrap();

        let result = preview(reference(&dir));

        assert_eq!(result.targets.len(), 1);
        assert!(result.targets[0].session_path.ends_with("new.jsonl"));
        assert_eq!(result.skipped.len(), 1);
        assert!(result.skipped[0].reason.contains("still exists"));
    }

    #[cfg(unix)]
    #[test]
    #[serial]
    fn preview_skips_a_symlinked_session_file() {
        let home = SandboxHome::new();
        let gone = home.path().join("gone");
        let dir = claude_project(home.path(), "-gone", &gone, &["s-1"]);
        let outside = home.path().join("outside.jsonl");
        fs::write(&outside, "{}\n").unwrap();
        symlink(&outside, dir.join("linked.jsonl")).unwrap();

        let result = preview(reference(&dir));

        assert_eq!(result.targets.len(), 1);
        assert_eq!(result.skipped.len(), 1);
        assert_eq!(result.skipped[0].reason, "Session file cannot be a symlink");
    }

    #[test]
    #[serial]
    fn clear_moves_only_the_confirmed_sessions_and_reports_each() {
        let home = SandboxHome::new();
        let gone = home.path().join("gone").join("app");
        let dir = claude_project(home.path(), "-gone-app", &gone, &["a", "b"]);
        fs::create_dir(dir.join("a")).unwrap();
        // Written after the preview: never confirmed, so never cleared.
        let late = write_session(&dir, "late", &gone);
        let missing = dir.join("vanished.jsonl");

        let results = clear_project(&confirm(&dir, &[&dir.join("a.jsonl"), &missing]));

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].error, None);
        assert!(results[1].error.as_deref().unwrap().contains("not found"));
        assert!(!dir.join("a.jsonl").exists());
        assert!(!dir.join("a").exists());
        assert!(dir.join("b.jsonl").exists());
        assert!(late.exists());
    }

    /// The location coming back between preview and confirm stops the clear.
    #[test]
    #[serial]
    fn clear_refuses_when_the_location_is_back() {
        let home = SandboxHome::new();
        let gone = home.path().join("drive").join("app");
        let dir = claude_project(home.path(), "-drive-app", &gone, &["a"]);
        assert_eq!(preview(reference(&dir)).targets.len(), 1);

        fs::create_dir_all(&gone).unwrap();
        let results = clear_project(&confirm(&dir, &[&dir.join("a.jsonl")]));

        assert_eq!(results[0].error.as_deref(), Some(LOCATION_IS_BACK));
        assert!(dir.join("a.jsonl").exists());
    }

    /// A confirmed path is re-resolved: one outside the project's folder is
    /// refused even when it is a valid session elsewhere.
    #[test]
    #[serial]
    fn clear_refuses_a_session_outside_the_confirmed_project() {
        let home = SandboxHome::new();
        let gone = home.path().join("gone");
        let dir = claude_project(home.path(), "-gone", &gone, &["a"]);
        let other = claude_project(home.path(), "-other", &gone, &["b"]);
        let elsewhere = home.path().join("elsewhere");
        fs::create_dir_all(&elsewhere).unwrap();
        let loose = write_session(&elsewhere, "c", &gone);

        let results = clear_project(&confirm(&dir, &[&other.join("b.jsonl"), &loose]));

        for result in &results {
            assert_eq!(result.error.as_deref(), Some(NOT_IN_PROJECT));
        }
        assert!(other.join("b.jsonl").exists());
        assert!(loose.exists());
    }

    #[test]
    #[serial]
    fn clear_reports_every_session_of_an_excluded_project() {
        let _home = SandboxHome::new();
        let results = clear_project(&ConfirmedCleanup {
            provider: Some("cursor".to_string()),
            path: crate::test_utils::abs("gone"),
            session_paths: vec!["cursor://a".to_string(), "cursor://b".to_string()],
        });

        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|r| r
            .error
            .as_deref()
            .is_some_and(|e| e.contains("permanently"))));
    }

    #[test]
    #[serial]
    fn cursor_agent_targets_are_the_transcript_folder_and_chat_metadata() {
        let home = SandboxHome::new();
        let id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        let project_dir = home
            .path()
            .join(".cursor")
            .join("projects")
            .join("Users-me-gone");
        let session_dir = project_dir.join("agent-transcripts").join(id);
        fs::create_dir_all(&session_dir).unwrap();
        let transcript = session_dir.join(format!("{id}.jsonl"));
        fs::write(&transcript, "{}\n").unwrap();
        let meta = home
            .path()
            .join(".cursor")
            .join("chats")
            .join("0123abcd")
            .join(id);
        fs::create_dir_all(&meta).unwrap();
        let root = home
            .path()
            .join(".cursor")
            .join("projects")
            .canonicalize()
            .unwrap();
        let project = Project {
            store: Store::CursorAgent {
                root: root.clone(),
                chats: crate::providers::cursor_agent::chats_root(),
                project_dir: project_dir.canonicalize().unwrap(),
            },
            location: crate::test_utils::abs("gone"),
        };

        let targets = project.targets(&transcript).unwrap();
        assert_eq!(
            targets,
            vec![
                root.join("Users-me-gone")
                    .join("agent-transcripts")
                    .join(id),
                meta.canonicalize().unwrap(),
            ]
        );
        // The same transcript is not in another project of the root.
        let other = Project {
            store: Store::CursorAgent {
                root: root.clone(),
                chats: None,
                project_dir: root.join("Users-me-other"),
            },
            location: crate::test_utils::abs("gone"),
        };
        assert_eq!(other.targets(&transcript).unwrap_err(), NOT_IN_PROJECT);
    }
}

#[cfg(test)]
mod codex_tests {
    use super::*;
    use crate::test_utils::SandboxHome;
    use serial_test::serial;

    /// Points `CODEX_HOME` at the sandbox for the test, restoring it after.
    struct CodexHome(Option<std::ffi::OsString>);

    impl CodexHome {
        fn set(path: &Path) -> Self {
            let previous = std::env::var_os("CODEX_HOME");
            std::env::set_var("CODEX_HOME", path);
            Self(previous)
        }
    }

    impl Drop for CodexHome {
        fn drop(&mut self) {
            match &self.0 {
                Some(value) => std::env::set_var("CODEX_HOME", value),
                None => std::env::remove_var("CODEX_HOME"),
            }
        }
    }

    fn rollout(sessions: &Path, id: &str, cwd: &Path) -> PathBuf {
        let file = sessions.join(format!("rollout-2025-01-01T00-00-00-{id}.jsonl"));
        let meta = serde_json::json!({
            "timestamp": "2025-01-01T00:00:00Z",
            "type": "session_meta",
            "payload": { "id": id, "cwd": cwd.to_string_lossy(), "timestamp": "2025-01-01T00:00:00Z" }
        });
        let user = serde_json::json!({
            "timestamp": "2025-01-01T00:00:01Z",
            "type": "response_item",
            "payload": { "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "hi" }] }
        });
        fs::write(&file, format!("{meta}\n{user}\n")).unwrap();
        file
    }

    #[test]
    #[serial]
    fn codex_clear_previews_and_trashes_only_rollouts_of_the_missing_cwd() {
        let home = SandboxHome::new();
        let codex = home.path().join(".codex");
        let sessions = codex.join("sessions").join("2025").join("01").join("01");
        fs::create_dir_all(&sessions).unwrap();
        let _codex_home = CodexHome::set(&codex);
        let gone = home.path().join("gone").join("app");
        let alive = home.path().join("alive");
        fs::create_dir_all(&alive).unwrap();
        let mine = rollout(&sessions, "11111111-1111-1111-1111-111111111111", &gone);
        let theirs = rollout(&sessions, "22222222-2222-2222-2222-222222222222", &alive);
        let project_path = format!("codex://{}", gone.to_string_lossy());

        let preview = preview_project(&UnavailableProjectRef {
            provider: Some("codex".to_string()),
            path: project_path.clone(),
        });
        assert_eq!(preview.excluded, None);
        let targets: Vec<String> = preview
            .targets
            .iter()
            .map(|t| t.session_path.clone())
            .collect();
        assert_eq!(targets, vec![mine.to_string_lossy().to_string()]);

        let results = clear_project(&ConfirmedCleanup {
            provider: Some("codex".to_string()),
            path: project_path,
            session_paths: vec![
                mine.to_string_lossy().to_string(),
                theirs.to_string_lossy().to_string(),
            ],
        });
        assert_eq!(results[0].error, None);
        assert_eq!(results[1].error.as_deref(), Some(NOT_IN_PROJECT));
        assert!(!mine.exists());
        assert!(theirs.exists());
    }
}
