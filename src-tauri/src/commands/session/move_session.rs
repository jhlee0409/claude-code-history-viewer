//! Move a Claude Code session to another project folder.
//!
//! A Claude Code session lives at `<claude root>/projects/<project>/<id>.jsonl`,
//! optionally with a companion `<id>/` folder (subagents, tool results). Claude
//! Code's `/resume` only lists sessions from the project folder that matches the
//! current working directory, so moving the files is all it takes to make a
//! session resumable from another project. File contents (including the `cwd`
//! recorded in each message) are left untouched.
//!
//! A session still open in a running Claude Code process would keep appending
//! to the old path (recreating it), so the move is refused while the session
//! looks active.

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::command;

use super::rename::{allowed_claude_roots, normalize_path_for_comparison};

/// Error code: a running Claude Code process has this session open.
pub const ERR_SESSION_ACTIVE: &str = "SESSION_ACTIVE";
/// Error code: the session file was written very recently (fallback heuristic).
pub const ERR_SESSION_RECENTLY_MODIFIED: &str = "SESSION_RECENTLY_MODIFIED";
/// Error code: the target project already holds a session with the same id.
pub const ERR_TARGET_EXISTS: &str = "TARGET_EXISTS";

/// A session file written within this window is treated as possibly in use.
const RECENT_WRITE_WINDOW: Duration = Duration::from_secs(120);

/// Registry entries are tiny; anything larger is not one and is skipped.
const MAX_REGISTRY_ENTRY_BYTES: u64 = 64 * 1024;

#[derive(Debug, Serialize)]
pub struct MoveSessionResult {
    pub new_file_path: String,
    pub target_project_path: String,
}

/// Why a session is considered active.
#[derive(Debug, PartialEq, Eq)]
pub enum SessionActivity {
    /// A live process in `<claude root>/sessions/*.json` references the session.
    RunningProcess(u32),
    /// No registry hit, but the transcript was modified within the window.
    RecentlyModified,
}

/// Moves `session_path` (and its companion folder) into `target_project_path`.
///
/// Both must sit in the same `projects/` folder of an allowed Claude root
/// (`~/.claude` or a registered custom directory). Refuses symlinks, name
/// collisions, and sessions that look active in Claude Code.
#[command]
pub async fn move_session_to_project(
    session_path: String,
    target_project_path: String,
) -> Result<MoveSessionResult, String> {
    move_session_with(
        Path::new(&session_path),
        Path::new(&target_project_path),
        &allowed_claude_roots(),
        RECENT_WRITE_WINDOW,
        &move_path,
    )
}

/// Validated source/target locations of a move.
#[derive(Debug)]
struct MovePlan {
    claude_root: PathBuf,
    session_id: String,
    src_file: PathBuf,
    dst_file: PathBuf,
    /// `(from, to)` for the companion folder, when it exists.
    companion: Option<(PathBuf, PathBuf)>,
}

fn move_session_with(
    session_path: &Path,
    target_project: &Path,
    allowed_roots: &[PathBuf],
    recent_window: Duration,
    mover: &dyn Fn(&Path, &Path) -> io::Result<()>,
) -> Result<MoveSessionResult, String> {
    let plan = plan_move(session_path, target_project, allowed_roots)?;

    match is_claude_session_active(
        &plan.claude_root,
        &plan.session_id,
        &plan.src_file,
        recent_window,
    ) {
        Some(SessionActivity::RunningProcess(pid)) => {
            return Err(format!(
                "{ERR_SESSION_ACTIVE}: session is open in a running Claude Code process (pid {pid})"
            ));
        }
        Some(SessionActivity::RecentlyModified) => {
            return Err(format!(
                "{ERR_SESSION_RECENTLY_MODIFIED}: session file was modified in the last {} seconds",
                recent_window.as_secs()
            ));
        }
        None => {}
    }

    // Drop cached search matches for the old path while it still resolves.
    super::evict_file_from_search_cache(&plan.src_file);

    move_session_files(&plan, mover)?;

    Ok(MoveSessionResult {
        new_file_path: plan.dst_file.to_string_lossy().to_string(),
        target_project_path: target_project.to_string_lossy().to_string(),
    })
}

fn has_traversal(path: &Path) -> bool {
    path.components()
        .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
}

fn is_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

fn same_path(a: &Path, b: &Path) -> bool {
    normalize_path_for_comparison(a) == normalize_path_for_comparison(b)
}

fn plan_move(
    session_path: &Path,
    target_project: &Path,
    allowed_roots: &[PathBuf],
) -> Result<MovePlan, String> {
    if !session_path.is_absolute() || !target_project.is_absolute() {
        return Err("Session and target paths must be absolute".to_string());
    }
    if has_traversal(session_path) || has_traversal(target_project) {
        return Err("Paths must not contain '.' or '..' components".to_string());
    }

    if session_path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
        return Err("Only .jsonl session files can be moved".to_string());
    }
    let session_id = session_path
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|id| {
            !id.is_empty()
                && id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        })
        .ok_or_else(|| "Invalid session ID format".to_string())?
        .to_string();

    let file_meta = fs::symlink_metadata(session_path)
        .map_err(|_| format!("Session file not found: {}", session_path.display()))?;
    if file_meta.file_type().is_symlink() {
        return Err("Session file cannot be a symlink".to_string());
    }
    if !file_meta.is_file() {
        return Err("Session target must be a regular .jsonl file".to_string());
    }

    // Layout: <claude root>/projects/<project>/<id>.jsonl
    let source_project = session_path
        .parent()
        .ok_or("Session file has no project folder")?;
    let projects_dir = source_project
        .parent()
        .filter(|p| p.file_name().and_then(|n| n.to_str()) == Some("projects"))
        .ok_or("Session must sit directly inside a Claude project folder")?;
    let claude_root = projects_dir
        .parent()
        .ok_or("Claude projects folder has no parent")?;

    if !allowed_roots
        .iter()
        .any(|root| same_path(&root.join("projects"), projects_dir))
    {
        return Err(
            "Session must be within ~/.claude/projects or a registered custom Claude directory"
                .to_string(),
        );
    }
    if is_symlink(projects_dir) || is_symlink(source_project) {
        return Err("Symlinked project folders cannot be moved from".to_string());
    }

    let target_meta = fs::symlink_metadata(target_project)
        .map_err(|_| format!("Target project not found: {}", target_project.display()))?;
    if target_meta.file_type().is_symlink() {
        return Err("Target project folder cannot be a symlink".to_string());
    }
    if !target_meta.is_dir() {
        return Err("Target project must be a directory".to_string());
    }
    if !target_project
        .parent()
        .is_some_and(|parent| same_path(parent, projects_dir))
    {
        return Err("Target must be a project in the same Claude projects folder".to_string());
    }
    if same_path(target_project, source_project) {
        return Err("Session is already in this project".to_string());
    }

    let file_name = session_path.file_name().ok_or("Invalid session filename")?;
    let dst_file = target_project.join(file_name);
    if fs::symlink_metadata(&dst_file).is_ok() {
        return Err(format!(
            "{ERR_TARGET_EXISTS}: target project already contains {}",
            file_name.to_string_lossy()
        ));
    }

    let src_dir = source_project.join(&session_id);
    let companion = match fs::symlink_metadata(&src_dir) {
        Ok(meta) if meta.file_type().is_symlink() => {
            return Err("Session folder cannot be a symlink".to_string());
        }
        Ok(meta) if meta.is_dir() => {
            let dst_dir = target_project.join(&session_id);
            if fs::symlink_metadata(&dst_dir).is_ok() {
                return Err(format!(
                    "{ERR_TARGET_EXISTS}: target project already contains a {session_id}/ folder"
                ));
            }
            Some((src_dir, dst_dir))
        }
        _ => None,
    };

    Ok(MovePlan {
        claude_root: claude_root.to_path_buf(),
        session_id,
        src_file: session_path.to_path_buf(),
        dst_file,
        companion,
    })
}

/// Moves the transcript, then its companion folder. If the folder cannot be
/// moved, the transcript is moved back so the session stays in one piece.
fn move_session_files(
    plan: &MovePlan,
    mover: &dyn Fn(&Path, &Path) -> io::Result<()>,
) -> Result<(), String> {
    mover(&plan.src_file, &plan.dst_file)
        .map_err(|e| format!("Failed to move session file: {e}"))?;

    if let Some((src_dir, dst_dir)) = &plan.companion {
        if let Err(e) = mover(src_dir, dst_dir) {
            return match mover(&plan.dst_file, &plan.src_file) {
                Ok(()) => Err(format!(
                    "Failed to move session folder (nothing was moved): {e}"
                )),
                Err(rollback) => Err(format!(
                    "Failed to move session folder: {e}; restoring the session file also \
                     failed ({rollback}). It is now at {}",
                    plan.dst_file.display()
                )),
            };
        }
    }
    Ok(())
}

/// Rename, falling back to copy + remove (e.g. across devices). The callers
/// guarantee `to` does not exist, which also sidesteps Windows `fs::rename`
/// failing on an existing destination.
fn move_path(from: &Path, to: &Path) -> io::Result<()> {
    let Err(rename_err) = fs::rename(from, to) else {
        return Ok(());
    };
    if fs::symlink_metadata(to).is_ok() {
        return Err(rename_err);
    }

    let copied = if from.is_dir() {
        copy_dir_recursive(from, to)
    } else {
        fs::copy(from, to).map(|_| ())
    };
    let cleanup = |e: io::Error| {
        let _ = if to.is_dir() {
            fs::remove_dir_all(to)
        } else {
            fs::remove_file(to)
        };
        e
    };
    copied.map_err(cleanup)?;

    let removed = if from.is_dir() {
        fs::remove_dir_all(from)
    } else {
        fs::remove_file(from)
    };
    // Keep the source authoritative: undo the copy if the original stays.
    removed.map_err(cleanup)
}

fn copy_dir_recursive(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let dst = to.join(entry.file_name());
        if file_type.is_symlink() {
            return Err(io::Error::other(format!(
                "refusing to copy symlink {}",
                entry.path().display()
            )));
        } else if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &dst)?;
        } else {
            fs::copy(entry.path(), &dst)?;
        }
    }
    Ok(())
}

/// Best-effort check whether Claude Code currently has `session_id` open.
///
/// 1. Claude Code keeps a per-process registry at `<claude root>/sessions/<pid>.json`
///    (`{"pid": …, "sessionId": …, "cwd": …}`); a live pid referencing this
///    session means it is open.
/// 2. Older versions have no registry, so a transcript modified within
///    `recent_window` is also treated as possibly active.
pub fn is_claude_session_active(
    claude_root: &Path,
    session_id: &str,
    file_path: &Path,
    recent_window: Duration,
) -> Option<SessionActivity> {
    if let Some(pid) = registry_pid_for_session(claude_root, session_id) {
        return Some(SessionActivity::RunningProcess(pid));
    }

    let modified = fs::metadata(file_path).and_then(|m| m.modified()).ok()?;
    // A timestamp in the future (clock skew) counts as "just now".
    let age = SystemTime::now()
        .duration_since(modified)
        .unwrap_or(Duration::ZERO);
    (age < recent_window).then_some(SessionActivity::RecentlyModified)
}

/// Pid of a live process whose registry entry references `session_id`.
/// Tolerates a missing registry and entries of an unexpected shape.
fn registry_pid_for_session(claude_root: &Path, session_id: &str) -> Option<u32> {
    let entries = fs::read_dir(claude_root.join("sessions")).ok()?;
    entries.filter_map(Result::ok).find_map(|entry| {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            return None;
        }
        let meta = fs::symlink_metadata(&path).ok()?;
        if !meta.is_file() || meta.len() > MAX_REGISTRY_ENTRY_BYTES {
            return None;
        }
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).ok()?).ok()?;
        if value.get("sessionId").and_then(|v| v.as_str()) != Some(session_id) {
            return None;
        }
        let pid = u32::try_from(value.get("pid")?.as_u64()?).ok()?;
        is_pid_alive(pid).then_some(pid)
    })
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn is_pid_alive(pid: u32) -> bool {
    pid != 0 && Path::new("/proc").join(pid.to_string()).exists()
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "android"))))]
fn is_pid_alive(pid: u32) -> bool {
    // `kill -0` probes for the process without signalling it.
    pid != 0
        && std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
}

#[cfg(windows)]
fn is_pid_alive(pid: u32) -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    if pid == 0 {
        return false;
    }
    match std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        Ok(out) => String::from_utf8_lossy(&out.stdout).contains(&format!("\"{pid}\"")),
        // Cannot tell: err on the side of "alive" so an open session is not moved.
        Err(_) => true,
    }
}

#[cfg(not(any(unix, windows)))]
fn is_pid_alive(pid: u32) -> bool {
    pid != 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const NO_WINDOW: Duration = Duration::ZERO;

    struct Fixture {
        _tmp: TempDir,
        root: PathBuf,
        source: PathBuf,
        target: PathBuf,
        session: PathBuf,
    }

    /// `<tmp>/.claude/projects/{-src,-dst}` with `<id>.jsonl` in `-src`.
    fn fixture(id: &str) -> Fixture {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path().canonicalize().unwrap();
        let root = base.join(".claude");
        let source = root.join("projects").join("-src");
        let target = root.join("projects").join("-dst");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&target).unwrap();
        let session = source.join(format!("{id}.jsonl"));
        fs::write(&session, "{\"cwd\":\"/src\"}\n").unwrap();
        Fixture {
            _tmp: tmp,
            root,
            source,
            target,
            session,
        }
    }

    fn run(f: &Fixture, target: &Path) -> Result<MoveSessionResult, String> {
        move_session_with(
            &f.session,
            target,
            std::slice::from_ref(&f.root),
            NO_WINDOW,
            &move_path,
        )
    }

    #[test]
    fn moves_file_and_companion_dir_without_touching_contents() {
        let f = fixture("abc-1");
        let companion = f.source.join("abc-1").join("subagents");
        fs::create_dir_all(&companion).unwrap();
        fs::write(companion.join("agent-1.jsonl"), "{}\n").unwrap();

        let result = run(&f, &f.target).unwrap();

        let moved = f.target.join("abc-1.jsonl");
        assert_eq!(result.new_file_path, moved.to_string_lossy());
        assert!(!f.session.exists());
        assert_eq!(fs::read_to_string(&moved).unwrap(), "{\"cwd\":\"/src\"}\n");
        assert!(f.target.join("abc-1/subagents/agent-1.jsonl").is_file());
        assert!(!f.source.join("abc-1").exists());
    }

    #[test]
    fn refuses_target_outside_the_same_projects_folder() {
        let f = fixture("abc-1");
        let elsewhere = f.root.join("not-projects").join("-dst");
        fs::create_dir_all(&elsewhere).unwrap();

        let err = run(&f, &elsewhere).unwrap_err();
        assert!(err.contains("same Claude projects folder"), "{err}");
        assert!(f.session.exists());
    }

    #[test]
    fn refuses_unregistered_claude_root() {
        let f = fixture("abc-1");
        let err = move_session_with(&f.session, &f.target, &[], NO_WINDOW, &move_path).unwrap_err();
        assert!(err.contains("registered custom Claude directory"), "{err}");
    }

    #[test]
    fn refuses_bad_ids_traversal_and_same_project() {
        let f = fixture("abc-1");
        let bad = f.source.join("bad name.jsonl");
        fs::write(&bad, "{}\n").unwrap();
        let err = move_session_with(
            &bad,
            &f.target,
            std::slice::from_ref(&f.root),
            NO_WINDOW,
            &move_path,
        )
        .unwrap_err();
        assert_eq!(err, "Invalid session ID format");

        let traversal = f.target.join("..").join("-dst");
        assert!(run(&f, &traversal).unwrap_err().contains("'..'"));

        assert!(run(&f, &f.source)
            .unwrap_err()
            .contains("already in this project"));
        assert!(run(&f, Path::new("relative"))
            .unwrap_err()
            .contains("absolute"));
    }

    #[test]
    fn refuses_collisions_for_file_and_companion_dir() {
        let f = fixture("abc-1");
        fs::write(f.target.join("abc-1.jsonl"), "other\n").unwrap();
        let err = run(&f, &f.target).unwrap_err();
        assert!(err.starts_with(ERR_TARGET_EXISTS), "{err}");
        assert_eq!(
            fs::read_to_string(f.target.join("abc-1.jsonl")).unwrap(),
            "other\n"
        );

        let g = fixture("abc-2");
        fs::create_dir_all(g.source.join("abc-2")).unwrap();
        fs::create_dir_all(g.target.join("abc-2")).unwrap();
        let err = run(&g, &g.target).unwrap_err();
        assert!(err.starts_with(ERR_TARGET_EXISTS), "{err}");
        assert!(g.session.exists());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinks() {
        use std::os::unix::fs::symlink;

        let f = fixture("abc-1");
        let linked_target = f.root.join("projects").join("-link");
        symlink(&f.target, &linked_target).unwrap();
        assert!(run(&f, &linked_target).unwrap_err().contains("symlink"));

        let link = f.source.join("abc-2.jsonl");
        symlink(&f.session, &link).unwrap();
        let err = move_session_with(
            &link,
            &f.target,
            std::slice::from_ref(&f.root),
            NO_WINDOW,
            &move_path,
        )
        .unwrap_err();
        assert_eq!(err, "Session file cannot be a symlink");
    }

    #[test]
    fn rolls_back_file_when_companion_dir_move_fails() {
        let f = fixture("abc-1");
        fs::create_dir_all(f.source.join("abc-1")).unwrap();

        let failing_dir_mover = |from: &Path, to: &Path| -> io::Result<()> {
            if from.is_dir() {
                Err(io::Error::other("simulated"))
            } else {
                move_path(from, to)
            }
        };
        let err = move_session_with(
            &f.session,
            &f.target,
            std::slice::from_ref(&f.root),
            NO_WINDOW,
            &failing_dir_mover,
        )
        .unwrap_err();

        assert!(err.contains("nothing was moved"), "{err}");
        assert!(f.session.is_file());
        assert!(f.source.join("abc-1").is_dir());
        assert!(!f.target.join("abc-1.jsonl").exists());
    }

    #[test]
    fn copy_fallback_moves_directories() {
        let tmp = TempDir::new().unwrap();
        let from = tmp.path().join("a");
        fs::create_dir_all(from.join("nested")).unwrap();
        fs::write(from.join("nested/file.txt"), "x").unwrap();
        let to = tmp.path().join("b");

        copy_dir_recursive(&from, &to).unwrap();
        assert_eq!(fs::read_to_string(to.join("nested/file.txt")).unwrap(), "x");
    }

    fn write_registry(root: &Path, pid: u64, session_id: &str) {
        let dir = root.join("sessions");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join(format!("{pid}.json")),
            format!(r#"{{"pid":{pid},"sessionId":"{session_id}","cwd":"/src"}}"#),
        )
        .unwrap();
    }

    #[test]
    fn registry_with_live_pid_marks_session_active() {
        let f = fixture("abc-1");
        let pid = std::process::id();
        write_registry(&f.root, u64::from(pid), "abc-1");

        assert_eq!(
            is_claude_session_active(&f.root, "abc-1", &f.session, NO_WINDOW),
            Some(SessionActivity::RunningProcess(pid))
        );
        let err = run(&f, &f.target).unwrap_err();
        assert!(err.starts_with(ERR_SESSION_ACTIVE), "{err}");
        assert!(f.session.exists());
        // Another session id in the registry does not count.
        assert_eq!(
            is_claude_session_active(&f.root, "other", &f.session, NO_WINDOW),
            None
        );
    }

    #[test]
    fn registry_with_dead_pid_is_ignored() {
        let f = fixture("abc-1");
        // Above the Linux pid_max ceiling (2^22), so no live process has it.
        write_registry(&f.root, 4_194_304 + 7, "abc-1");
        // Malformed entries are skipped, not fatal.
        fs::write(f.root.join("sessions/garbage.json"), "not json").unwrap();

        assert_eq!(
            is_claude_session_active(&f.root, "abc-1", &f.session, NO_WINDOW),
            None
        );
        assert!(run(&f, &f.target).is_ok());
    }

    #[test]
    fn recent_modification_is_treated_as_active() {
        let f = fixture("abc-1");
        let window = Duration::from_secs(3600);

        assert_eq!(
            is_claude_session_active(&f.root, "abc-1", &f.session, window),
            Some(SessionActivity::RecentlyModified)
        );
        let err = move_session_with(
            &f.session,
            &f.target,
            std::slice::from_ref(&f.root),
            window,
            &move_path,
        )
        .unwrap_err();
        assert!(err.starts_with(ERR_SESSION_RECENTLY_MODIFIED), "{err}");
    }
}
