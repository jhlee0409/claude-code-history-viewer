//! The session list, the subagent list, archives, the expiring-session list,
//! the project list and search stay inside the history folders (v1.32.1).
//!
//! A symlink planted below a Claude root is never followed: not a session
//! file, not a session's subagent folder (`<session>/` in the native layout,
//! `subagents/` in the archive layout). The root itself may be reached
//! through one (a symlinked `~/.claude`, #355, or a project folder that is a
//! link). Only regular files are opened: a directory named like a session
//! used to stall the session list, since every read of it fails and the
//! failure was retried, and a FIFO blocks the reader that opens it.

use super::{
    find_project_session_by_path, get_recent_edits, get_session_message_count,
    get_session_message_offset, get_session_subagents, load_project_sessions,
    load_project_sessions_page, load_session_messages, load_session_messages_paginated,
    search_messages,
};
use crate::commands::{archive, multi_provider, project, stats};
use crate::models::ClaudeSession;
use crate::test_utils::SandboxHome;
use serial_test::serial;
use std::fs;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;
use tempfile::TempDir;

/// A user prompt `text` and a 100-token assistant reply in `session`.
fn transcript(session: &str, text: &str) -> String {
    let prompt = serde_json::json!({
        "type": "user", "sessionId": session, "uuid": format!("{session}-u"),
        "timestamp": "2026-10-15T12:00:00Z",
        "message": {"role": "user", "content": text}
    });
    let reply = serde_json::json!({
        "type": "assistant", "sessionId": session, "uuid": format!("{session}-a"),
        "timestamp": "2026-10-15T12:00:01Z",
        "message": {
            "id": format!("msg-{session}"), "role": "assistant",
            "model": "claude-sonnet-4-5-20250929",
            "content": [{"type": "text", "text": "reply"}],
            "usage": {"input_tokens": 100, "output_tokens": 0}
        }
    });
    format!("{prompt}\n{reply}\n")
}

fn write(path: &Path, session: &str, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, transcript(session, text)).unwrap();
}

fn mkfifo(path: &Path) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let made = std::process::Command::new("mkfifo")
        .arg(path)
        .status()
        .unwrap();
    assert!(made.success(), "mkfifo {}", path.display());
}

fn text(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .unwrap()
        .to_string_lossy()
        .to_string()
}

/// `file: summary` for each listed session, sorted.
fn listed(sessions: &[ClaudeSession]) -> Vec<String> {
    let mut listed: Vec<String> = sessions
        .iter()
        .map(|session| {
            format!(
                "{}: {}",
                file_name(&session.file_path),
                session.summary.clone().unwrap_or_default()
            )
        })
        .collect();
    listed.sort();
    listed
}

/// `agent: summary` for each subagent the subagent list shows for `session`.
async fn subagents(session: &Path) -> Result<Vec<String>, String> {
    Ok(get_session_subagents(text(session))
        .await?
        .iter()
        .map(|agent| {
            format!(
                "{}: {}",
                agent.agent_id,
                agent.summary.clone().unwrap_or_default()
            )
        })
        .collect())
}

/// `file: subagent count` for each session the expiring list shows, sorted.
async fn expiring(project: &Path) -> Result<Vec<String>, String> {
    let mut expiring: Vec<String> = archive::get_expiring_sessions(text(project), 100_000)
        .await?
        .iter()
        .map(|entry| {
            format!(
                "{}: {}",
                file_name(&entry.session.file_path),
                entry.subagent_count
            )
        })
        .collect();
    expiring.sort();
    Ok(expiring)
}

/// The session files the expiring list shows, sorted.
async fn expiring_files(project: &Path) -> Result<Vec<String>, String> {
    let mut files: Vec<String> = archive::get_expiring_sessions(text(project), 100_000)
        .await?
        .iter()
        .map(|entry| file_name(&entry.session.file_path))
        .collect();
    files.sort();
    Ok(files)
}

/// Archive `sessions` of `project` with their subagents. The `*.jsonl` files
/// in the archive, relative to it, marked when they hold text from outside
/// the root.
async fn archived(project: &Path, sessions: &[PathBuf]) -> Result<Vec<String>, String> {
    let entry = archive::create_archive(
        "probe".to_string(),
        None,
        sessions.iter().map(|session| text(session)).collect(),
        "claude".to_string(),
        text(project),
        "p".to_string(),
        true,
    )
    .await?;
    let dir = archive::get_archives_dir()?.join(&entry.id);
    let mut files: Vec<String> = walkdir::WalkDir::new(&dir)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "jsonl"))
        .map(|entry| {
            let outside = fs::read_to_string(entry.path())
                .unwrap()
                .contains("outside");
            format!(
                "{}{}",
                entry.path().strip_prefix(&dir).unwrap().display(),
                if outside { " (outside)" } else { "" }
            )
        })
        .collect();
    files.sort();
    Ok(files)
}

/// The session count the project list shows for the project folder `name`.
async fn project_sessions(claude: &Path, name: &str) -> Result<Vec<usize>, String> {
    Ok(project::scan_projects(text(claude))
        .await?
        .iter()
        .filter(|project| file_name(&project.path) == name)
        .map(|project| project.session_count)
        .collect())
}

/// The sessions search finds `query` in, sorted.
async fn found(claude: &Path, query: &str) -> Result<Vec<String>, String> {
    let mut sessions: Vec<String> =
        search_messages(text(claude), query.to_string(), serde_json::json!({}), None)
            .await?
            .into_iter()
            .map(|message| message.session_id)
            .collect();
    sessions.sort();
    sessions.dedup();
    Ok(sessions)
}

/// Project `p` under a sandboxed `~/.claude`: sessions `s1` and `s2` inside
/// the root, `s2` with a subagent inside it. Links planted in the project
/// lead out of the root: a session file, `s1`'s native subagent folder and
/// the project's archive-layout subagent folder.
struct Planted {
    home: SandboxHome,
    outside: TempDir,
}

impl Planted {
    fn new() -> Self {
        let planted = Self {
            home: SandboxHome::new(),
            outside: TempDir::new().unwrap(),
        };
        let project = planted.project();
        let outside = planted.outside.path();
        write(&project.join("s1.jsonl"), "s1", "inside s1");
        write(&project.join("s2.jsonl"), "s2", "inside s2");
        write(
            &project.join("s2/subagents/agent-r.jsonl"),
            "s2",
            "inside s2's subagent",
        );
        write(&outside.join("private.jsonl"), "private", "outside file");
        write(
            &outside.join("native/subagents/agent-x.jsonl"),
            "s1",
            "outside native subagent",
        );
        write(
            &outside.join("archive/s1/agent-y.jsonl"),
            "s1",
            "outside archive subagent",
        );
        symlink(outside.join("private.jsonl"), project.join("escaped.jsonl")).unwrap();
        symlink(outside.join("native"), project.join("s1")).unwrap();
        symlink(outside.join("archive"), project.join("subagents")).unwrap();
        planted
    }

    fn claude(&self) -> PathBuf {
        self.home.path().join(".claude")
    }

    fn project(&self) -> PathBuf {
        self.claude().join("projects").join("p")
    }
}

/// The lists that read the session files of a project (or of every project)
/// never read one through a symlink.
#[tokio::test]
#[serial]
async fn the_session_lists_never_read_a_session_file_through_a_symlink() {
    let planted = Planted::new();
    let project = planted.project();

    let read = (
        load_project_sessions(text(&project), None)
            .await
            .map(|sessions| listed(&sessions)),
        multi_provider::load_provider_sessions("claude".to_string(), text(&project), None)
            .await
            .map(|sessions| listed(&sessions)),
        expiring_files(&project).await,
        project_sessions(&planted.claude(), "p").await,
        found(&planted.claude(), "file").await,
    );

    let sessions = Ok(vec![
        "agent-r.jsonl: inside s2's subagent".to_string(),
        "s1.jsonl: inside s1".to_string(),
        "s2.jsonl: inside s2".to_string(),
    ]);
    assert_eq!(
        read,
        (
            sessions.clone(),
            sessions,
            Ok(vec!["s1.jsonl".to_string(), "s2.jsonl".to_string()]),
            Ok(vec![2]),
            Ok(vec![]),
        )
    );
}

/// The readers that list, count or archive a session's subagent
/// transcripts never follow a symlinked folder to them.
#[tokio::test]
#[serial]
async fn the_subagent_readers_never_follow_a_symlinked_folder() {
    let planted = Planted::new();
    let project = planted.project();
    let (s1, s2) = (project.join("s1.jsonl"), project.join("s2.jsonl"));

    let read = (
        subagents(&s1).await,
        subagents(&s2).await,
        expiring(&project).await,
        archived(&project, &[s1, s2]).await,
    );

    assert_eq!(
        read,
        (
            Ok(vec![]),
            Ok(vec!["r: inside s2's subagent".to_string()]),
            Ok(vec!["s1.jsonl: 0".to_string(), "s2.jsonl: 1".to_string()]),
            Ok(vec![
                "sessions/s1.jsonl".to_string(),
                "sessions/s2.jsonl".to_string(),
                "subagents/s2/agent-r.jsonl".to_string(),
            ]),
        )
    );
}

/// The root itself may be reached through a symlink: a symlinked `~/.claude`
/// (#355) and a project folder that is a link are read as before, subagent
/// folders included.
#[tokio::test]
#[serial]
async fn the_history_readers_still_read_a_root_reached_through_a_symlink() {
    let home = SandboxHome::new();
    let store = home.path().join("store");
    write(&store.join("projects/p/s1.jsonl"), "s1", "inside s1");
    write(
        &store.join("projects/p/s1/subagents/agent-a.jsonl"),
        "s1",
        "inside s1's subagent",
    );
    symlink(&store, home.path().join(".claude")).unwrap();
    symlink(store.join("projects/p"), store.join("projects/alias")).unwrap();

    let mut read = Vec::new();
    for project in ["p", "alias"].map(|name| home.path().join(".claude/projects").join(name)) {
        let s1 = project.join("s1.jsonl");
        read.push((
            load_project_sessions(text(&project), None)
                .await
                .map(|sessions| listed(&sessions)),
            subagents(&s1).await,
            expiring(&project).await,
            archived(&project, &[s1]).await,
        ));
    }

    let expected = (
        Ok(vec![
            "agent-a.jsonl: inside s1's subagent".to_string(),
            "s1.jsonl: inside s1".to_string(),
        ]),
        Ok(vec!["a: inside s1's subagent".to_string()]),
        Ok(vec!["s1.jsonl: 1".to_string()]),
        Ok(vec![
            "sessions/s1.jsonl".to_string(),
            "subagents/s1/agent-a.jsonl".to_string(),
        ]),
    );
    assert_eq!(read, [expected.clone(), expected]);
}

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(future)
}

type Read = Box<dyn FnOnce() -> String + Send>;

/// Each reader on a thread of its own: its result, or `stalled` when it has
/// not returned in time. A stalled thread is left behind.
fn within_deadline(reads: Vec<(&'static str, Read)>) -> Vec<(&'static str, String)> {
    reads
        .into_iter()
        .map(|(reader, read)| {
            let (sent, received) = mpsc::channel();
            std::thread::spawn(move || sent.send(read()));
            let result = received
                .recv_timeout(Duration::from_secs(10))
                .unwrap_or_else(|_| "stalled".to_string());
            (reader, result)
        })
        .collect()
}

/// `read(path)` as a [`Read`], its result shown with `{:?}`.
fn read_path<T: std::fmt::Debug + 'static>(path: &Path, read: fn(PathBuf) -> T) -> Read {
    let path = path.to_path_buf();
    Box::new(move || format!("{:?}", read(path)))
}

/// A project `q` under a sandboxed `~/.claude` holding session `s9` and its
/// subagent `r`.
fn project_q(home: &SandboxHome) -> (PathBuf, PathBuf) {
    let project = home.path().join(".claude").join("projects").join("q");
    write(&project.join("s9.jsonl"), "s9", "inside s9");
    write(
        &project.join("s9/subagents/agent-r.jsonl"),
        "s9",
        "inside s9's subagent",
    );
    (project.clone(), project.join("s9.jsonl"))
}

/// The lists answer, and read only the regular files, with a directory, a
/// link to it and a FIFO named like a session in the project.
#[test]
#[serial]
fn the_session_lists_skip_entries_that_are_not_regular_files() {
    let home = SandboxHome::new();
    let (project, _) = project_q(&home);
    let claude = home.path().join(".claude");
    fs::create_dir_all(project.join("folder.jsonl")).unwrap();
    symlink(
        project.join("folder.jsonl"),
        project.join("folder-link.jsonl"),
    )
    .unwrap();
    mkfifo(&project.join("fifo.jsonl"));

    let read = within_deadline(vec![
        (
            "load_project_sessions",
            read_path(&project, |project| {
                block_on(load_project_sessions(text(&project), None)).map(|s| listed(&s))
            }),
        ),
        (
            "load_project_sessions_page",
            read_path(&project, |project| {
                block_on(load_project_sessions_page(text(&project), None, None, None))
                    .map(|page| listed(&page.sessions))
            }),
        ),
        (
            "get_expiring_sessions",
            read_path(&project, |project| block_on(expiring_files(&project))),
        ),
        (
            "scan_projects",
            read_path(&claude, |claude| block_on(project_sessions(&claude, "q"))),
        ),
        (
            "search_messages",
            read_path(&claude, |claude| block_on(found(&claude, "inside"))),
        ),
        (
            "get_recent_edits",
            read_path(&project, |project| {
                block_on(get_recent_edits(text(&project), None, None, None, None))
                    .map(|edits| edits.files.len())
            }),
        ),
        (
            "get_project_stats_summary",
            read_path(&project, |project| {
                block_on(stats::get_project_stats_summary(
                    text(&project),
                    None,
                    None,
                    None,
                ))
                .map(|summary| summary.total_tokens)
            }),
        ),
        (
            "get_global_stats_summary",
            read_path(&claude, |claude| {
                let claude_only = Some(vec!["claude".to_string()]);
                block_on(stats::get_global_stats_summary(
                    text(&claude),
                    claude_only,
                    None,
                    None,
                    None,
                    None,
                ))
                .map(|summary| summary.total_tokens)
            }),
        ),
    ]);

    let sessions = r#"Ok(["agent-r.jsonl: inside s9's subagent", "s9.jsonl: inside s9"])"#;
    assert_eq!(
        read,
        [
            ("load_project_sessions", sessions.to_string()),
            ("load_project_sessions_page", sessions.to_string()),
            ("get_expiring_sessions", r#"Ok(["s9.jsonl"])"#.to_string()),
            ("scan_projects", "Ok([1])".to_string()),
            ("search_messages", r#"Ok(["s9"])"#.to_string()),
            ("get_recent_edits", "Ok(0)".to_string()),
            ("get_project_stats_summary", "Ok(200)".to_string()),
            ("get_global_stats_summary", "Ok(200)".to_string()),
        ]
    );
}

/// The subagent readers answer, and read only the regular transcripts, with
/// a directory and a FIFO named like a transcript in the subagent folder. An
/// archive leaves them out, as it does a link, instead of failing.
#[test]
#[serial]
fn the_subagent_readers_skip_entries_that_are_not_regular_files() {
    let home = SandboxHome::new();
    let (project, s9) = project_q(&home);
    fs::create_dir_all(project.join("s9/subagents/agent-folder.jsonl")).unwrap();
    let fifo = project.join("s9/subagents/agent-fifo.jsonl");
    mkfifo(&fifo);

    let read = within_deadline(vec![
        (
            "get_session_subagents",
            read_path(&s9, |s9| block_on(subagents(&s9))),
        ),
        (
            "get_expiring_sessions",
            read_path(&project, |project| block_on(expiring(&project))),
        ),
        (
            "create_archive",
            read_path(&s9, |s9| {
                block_on(archived(s9.parent().unwrap(), std::slice::from_ref(&s9)))
            }),
        ),
        (
            "get_session_token_stats",
            read_path(&s9, |s9| {
                block_on(stats::get_session_token_stats(text(&s9), None, None, None))
                    .map(|session| session.total_tokens)
            }),
        ),
        (
            "get_project_token_stats",
            read_path(&project, |project| {
                block_on(stats::get_project_token_stats(
                    text(&project),
                    Some(0),
                    Some(100),
                    None,
                    None,
                    None,
                ))
                .map(|page| {
                    page.items
                        .iter()
                        .map(|item| item.total_tokens)
                        .collect::<Vec<_>>()
                })
            }),
        ),
    ]);

    assert_eq!(
        read,
        [
            (
                "get_session_subagents",
                r#"Ok(["r: inside s9's subagent"])"#.to_string()
            ),
            (
                "get_expiring_sessions",
                r#"Ok(["s9.jsonl: 1"])"#.to_string()
            ),
            (
                "create_archive",
                r#"Ok(["sessions/s9.jsonl", "subagents/s9/agent-r.jsonl"])"#.to_string()
            ),
            ("get_session_token_stats", "Ok(200)".to_string()),
            ("get_project_token_stats", "Ok([200])".to_string()),
        ]
    );
}

/// A reader given one session refuses a directory or a FIFO named like a
/// session instead of reading it forever or blocking on it.
#[test]
#[serial]
fn the_single_session_readers_refuse_entries_that_are_not_regular_files() {
    let home = SandboxHome::new();
    let (project, _) = project_q(&home);
    fs::create_dir_all(project.join("folder.jsonl")).unwrap();
    let fifo = project.join("fifo.jsonl");
    mkfifo(&fifo);

    let read = within_deadline(vec![
        (
            "find_project_session_by_path(folder.jsonl)",
            read_path(&project, |project| {
                let folder = project.join("folder.jsonl");
                find_project_session_by_path(&text(&project), &text(&folder), None)
                    .map(|session| session.is_some())
            }),
        ),
        (
            "find_project_session_by_path(fifo.jsonl)",
            read_path(&project, |project| {
                let fifo = project.join("fifo.jsonl");
                find_project_session_by_path(&text(&project), &text(&fifo), None)
                    .map(|session| session.is_some())
            }),
        ),
        (
            "create_archive(fifo.jsonl)",
            read_path(&project, |project| {
                block_on(archived(&project, &[project.join("fifo.jsonl")]))
            }),
        ),
    ]);

    let refused: Result<bool, String> = Err("Session file is not a regular file".to_string());
    let not_archived: Result<Vec<String>, String> = Err(format!(
        "Session path is not a regular file: {}",
        fifo.display()
    ));
    assert_eq!(
        read,
        [
            (
                "find_project_session_by_path(folder.jsonl)",
                format!("{refused:?}")
            ),
            (
                "find_project_session_by_path(fifo.jsonl)",
                format!("{refused:?}")
            ),
            ("create_archive(fifo.jsonl)", format!("{not_archived:?}")),
        ]
    );
}

/// A reader of one session, given its path.
type ReadSession = fn(String) -> String;

/// `refused` when a reader refused its session as not a regular file,
/// otherwise what it returned.
fn refusal<T: std::fmt::Debug>(result: Result<T, String>) -> String {
    match result {
        Err(error) if error.contains("not a regular file") => "refused".to_string(),
        other => format!("{other:?}").chars().take(160).collect(),
    }
}

/// The readers of one session's messages refuse a directory and a FIFO named
/// like a session before opening either: opening a FIFO blocks until
/// something writes to it. The desktop app is the only caller that can hand
/// them such a path; over the `WebUI` the history-root guard refuses it first
/// (`server::tests::test_session_routes_answer_with_entries_that_are_not_regular_files`).
/// `get_session_token_stats` opened the session with a plain open, so a FIFO
/// stalled it (#700).
#[test]
#[serial]
fn the_message_readers_refuse_entries_that_are_not_regular_files() {
    let home = SandboxHome::new();
    let (project, _) = project_q(&home);
    fs::create_dir_all(project.join("folder.jsonl")).unwrap();
    mkfifo(&project.join("fifo.jsonl"));

    let readers: [(&'static str, ReadSession); 8] = [
        ("load_session_messages", |path| {
            refusal(block_on(load_session_messages(path)))
        }),
        ("load_session_messages_paginated", |path| {
            refusal(block_on(load_session_messages_paginated(path, 0, 20, None)))
        }),
        ("get_session_message_count", |path| {
            refusal(block_on(get_session_message_count(path, None)))
        }),
        ("get_session_message_offset", |path| {
            refusal(get_session_message_offset(path, "u1".to_string(), None))
        }),
        ("export_session", |path| {
            refusal(block_on(archive::export_session(path, "json".to_string())))
        }),
        ("load_provider_messages", |path| {
            refusal(block_on(multi_provider::load_provider_messages(
                "claude".to_string(),
                path,
            )))
        }),
        ("get_recent_edits", |path| {
            let project = text(Path::new(&path).parent().unwrap());
            refusal(block_on(get_recent_edits(project, None, None, Some(path), None)).map(|_| ()))
        }),
        ("get_session_token_stats", |path| {
            refusal(block_on(stats::get_session_token_stats(
                path, None, None, None,
            )))
        }),
    ];
    let mut read = Vec::new();
    let mut expected = Vec::new();
    for entry in ["folder.jsonl", "fifo.jsonl"] {
        let path = text(&project.join(entry));
        let reads = readers
            .iter()
            .map(|&(reader, read)| {
                let path = path.clone();
                (reader, Box::new(move || read(path)) as Read)
            })
            .collect();
        for (reader, result) in within_deadline(reads) {
            read.push((entry, reader, result));
            expected.push((entry, reader, "refused".to_string()));
        }
    }
    assert_eq!(read, expected);
}
