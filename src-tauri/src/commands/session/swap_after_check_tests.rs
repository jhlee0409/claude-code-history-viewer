//! A history file swapped for a symlink or a FIFO after the check that found
//! it, and before the reader opens it, is never read and never blocks the
//! reader (#698). A walk and the open that follows it are separate system
//! calls; the swap goes between them through `session_files::swap_after_check`,
//! which runs right after a check has found the file to be a regular one
//! (the walk's own check, or the one an open helper makes before it opens).
//!
//! Each reader runs on a thread of its own with a deadline, so a reader that
//! blocks on the FIFO fails the test instead of hanging it. Every run also
//! asserts that the swap happened, so a reader that no longer checks the file
//! cannot pass without being tested.

use super::{
    find_project_session_by_path, get_recent_edits, get_session_message_count,
    get_session_message_offset, get_session_subagents, load_project_sessions,
    load_project_sessions_page, load_session_messages, load_session_messages_paginated,
    search_messages,
};
use crate::commands::stats::session_files::swap_after_check;
use crate::commands::stats::usage_breakdown::{
    get_usage_breakdown, UsageBreakdownRequest, UsageInterval, UsageScope, UsageStatsMode,
};
use crate::commands::{archive, multi_provider, project, stats};
use crate::test_utils::SandboxHome;
use serial_test::serial;
use std::fs;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;
use tempfile::TempDir;

/// What the file outside the root holds, so that any part of it a reader
/// returns is recognised: `SECRET` in every text and path, 4,242,000 input
/// tokens and 4,242 messages.
const SECRET: &str = "SECRET";
const OUTSIDE_TOKENS: u64 = 4_242_000;
const OUTSIDE_MESSAGES: usize = 4_242;

const DEADLINE: Duration = Duration::from_secs(10);

fn text(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn mkfifo(path: &Path) {
    let made = std::process::Command::new("mkfifo")
        .arg(path)
        .status()
        .unwrap();
    assert!(made.success(), "mkfifo {}", path.display());
}

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(future)
}

/// A session inside the root: a prompt `text` and a 100-token reply that
/// wrote one file, both run in `/inside-cwd`.
fn inside_transcript(session: &str, text: &str) -> String {
    let prompt = serde_json::json!({
        "type": "user", "sessionId": session, "uuid": format!("{session}-u"),
        "timestamp": "2026-10-15T12:00:00Z", "cwd": "/inside-cwd",
        "message": {"role": "user", "content": text}
    });
    let reply = serde_json::json!({
        "type": "assistant", "sessionId": session, "uuid": format!("{session}-a"),
        "timestamp": "2026-10-15T12:00:01Z", "cwd": "/inside-cwd",
        "message": {
            "id": format!("msg-{session}"), "role": "assistant",
            "model": "claude-sonnet-4-5-20250929",
            "content": [{"type": "text", "text": "reply"}],
            "usage": {"input_tokens": 100, "output_tokens": 0}
        },
        "toolUseResult": {
            "type": "create", "filePath": format!("/inside-cwd/{session}.txt"),
            "content": "inside"
        }
    });
    format!("{prompt}\n{reply}\n")
}

/// The file outside the root: 4,241 prompts and one 4,242,000-token reply
/// that wrote a file, all run in `/SECRET-cwd`.
fn outside_transcript() -> String {
    let mut rows = String::new();
    for i in 0..OUTSIDE_MESSAGES - 1 {
        let prompt = serde_json::json!({
            "type": "user", "sessionId": "outside", "uuid": format!("outside-u{i}"),
            "timestamp": "2026-10-16T12:00:00Z", "cwd": format!("/{SECRET}-cwd"),
            "message": {"role": "user", "content": format!("{SECRET} prompt {i}")}
        });
        rows.push_str(&format!("{prompt}\n"));
    }
    let reply = serde_json::json!({
        "type": "assistant", "sessionId": "outside", "uuid": "outside-a",
        "timestamp": "2026-10-16T12:00:01Z", "cwd": format!("/{SECRET}-cwd"),
        "message": {
            "id": "msg-outside", "role": "assistant", "model": "claude-sonnet-4-5-20250929",
            "content": [{"type": "text", "text": format!("{SECRET} reply side")}],
            "usage": {"input_tokens": OUTSIDE_TOKENS, "output_tokens": 0}
        },
        "toolUseResult": {
            "type": "create", "filePath": format!("/{SECRET}-cwd/{SECRET}.txt"),
            "content": SECRET
        }
    });
    rows.push_str(&format!("{reply}\n"));
    rows
}

/// Project `p` under a sandboxed `~/.claude`: sessions `s1` and `s2`, and
/// `s2`'s subagent `r`, inside the root; a file outside it.
#[derive(Clone)]
struct Paths {
    claude: PathBuf,
    project: PathBuf,
    s1: PathBuf,
    s2: PathBuf,
    agent: PathBuf,
    outside: PathBuf,
}

impl Paths {
    fn new(home: &SandboxHome, outside: &TempDir) -> Self {
        let claude = home.path().join(".claude");
        let project = claude.join("projects").join("p");
        let paths = Self {
            s1: project.join("s1.jsonl"),
            s2: project.join("s2.jsonl"),
            agent: project.join("s2/subagents/agent-r.jsonl"),
            outside: outside.path().join("private.jsonl"),
            claude,
            project,
        };
        fs::create_dir_all(paths.agent.parent().unwrap()).unwrap();
        fs::write(&paths.outside, outside_transcript()).unwrap();
        // The newest file, so a reader that picks the latest session (the
        // project list's `cwd`) would pick it.
        fs::File::options()
            .write(true)
            .open(&paths.outside)
            .unwrap()
            .set_modified(std::time::SystemTime::now() + Duration::from_secs(86_400))
            .unwrap();
        paths.restore();
        paths
    }

    /// Every file inside the root as a regular file again.
    fn restore(&self) {
        for (path, session, text) in [
            (&self.s1, "s1", "inside s1"),
            (&self.s2, "s2", "inside s2"),
            (&self.agent, "s2", "inside r"),
        ] {
            // A file, or the link or FIFO it was swapped for.
            let _ = fs::remove_file(path);
            fs::write(path, inside_transcript(session, text)).unwrap();
        }
    }
}

/// What the file a reader is about to open is swapped for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Swap {
    /// A symlink to the file outside the root.
    Link,
    /// A FIFO: opening it blocks until something writes to it.
    Fifo,
}

/// Which file of [`Paths`] is swapped.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Target {
    S1,
    Agent,
}

impl Target {
    fn path(self, paths: &Paths) -> &Path {
        match self {
            Self::S1 => &paths.s1,
            Self::Agent => &paths.agent,
        }
    }
}

/// A reader, its result as text: JSON when it answers, the error otherwise.
type Reader = fn(&Paths) -> String;

fn json<T: serde::Serialize>(result: Result<T, String>) -> String {
    match result {
        Ok(value) => serde_json::to_string(&value).unwrap(),
        Err(error) => format!("Err({error})"),
    }
}

fn usage_request(project: &Path) -> UsageBreakdownRequest {
    UsageBreakdownRequest {
        scope: UsageScope::Project {
            project_path: text(project),
            provider: "claude".to_string(),
        },
        stats_mode: UsageStatsMode::BillingTotal,
        intervals: vec![UsageInterval {
            key: "2026-10-15..17".to_string(),
            start_utc: 1_792_022_400_000,
            end_utc: 1_792_195_200_000,
        }],
    }
}

/// The `*.jsonl` files of an archive of `s2` with its subagents, marked when
/// they hold text from outside the root.
fn archived(paths: &Paths) -> String {
    let entry = match block_on(archive::create_archive(
        "swap".to_string(),
        None,
        vec![text(&paths.s2)],
        "claude".to_string(),
        text(&paths.project),
        "p".to_string(),
        true,
    )) {
        Ok(entry) => entry,
        Err(error) => return format!("Err({error})"),
    };
    let dir = archive::get_archives_dir().unwrap().join(&entry.id);
    let mut files: Vec<String> = walkdir::WalkDir::new(&dir)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "jsonl"))
        .map(|entry| {
            let content = fs::read_to_string(entry.path()).unwrap_or_default();
            let relative = entry
                .path()
                .strip_prefix(&dir)
                .unwrap()
                .display()
                .to_string();
            if content.contains(SECRET) {
                format!("{relative} ({SECRET})")
            } else {
                relative
            }
        })
        .collect();
    files.sort();
    files.join(", ")
}

/// Every reader of history files, with the file swapped under it: a session
/// file, or a subagent transcript for the readers that open those.
fn readers() -> Vec<(&'static str, Target, Reader)> {
    vec![
        ("get_global_stats_summary", Target::S1, |p| {
            json(block_on(stats::get_global_stats_summary(
                text(&p.claude),
                Some(vec!["claude".to_string()]),
                None,
                None,
                None,
                None,
            )))
        }),
        ("get_project_stats_summary", Target::S1, |p| {
            json(block_on(stats::get_project_stats_summary(
                text(&p.project),
                None,
                None,
                None,
            )))
        }),
        ("get_project_token_stats", Target::S1, |p| {
            json(block_on(stats::get_project_token_stats(
                text(&p.project),
                Some(0),
                Some(100),
                None,
                None,
                None,
            )))
        }),
        ("get_session_comparison", Target::S1, |p| {
            // The session the swapped file would add: the one outside the
            // root. Comparing it at all means it was read.
            match block_on(stats::get_session_comparison(
                "outside".to_string(),
                text(&p.project),
                None,
                None,
                None,
            )) {
                Ok(comparison) => format!(
                    "{SECRET} session compared: {:.0}% of the project's tokens",
                    comparison.percentage_of_project_tokens
                ),
                Err(error) => format!("Err({error})"),
            }
        }),
        ("get_session_token_stats", Target::Agent, |p| {
            json(block_on(stats::get_session_token_stats(
                text(&p.s2),
                None,
                None,
                None,
            )))
        }),
        ("get_usage_breakdown", Target::S1, |p| {
            json(block_on(get_usage_breakdown(usage_request(&p.project))))
        }),
        ("search_messages", Target::S1, |p| {
            json(block_on(search_messages(
                text(&p.claude),
                "side".to_string(),
                serde_json::json!({}),
                None,
            )))
        }),
        ("scan_projects", Target::S1, |p| {
            json(block_on(project::scan_projects(text(&p.claude))))
        }),
        ("load_project_sessions", Target::S1, |p| {
            json(block_on(load_project_sessions(text(&p.project), None)))
        }),
        ("load_project_sessions_page", Target::S1, |p| {
            json(block_on(load_project_sessions_page(
                text(&p.project),
                None,
                None,
                None,
            )))
        }),
        ("find_project_session_by_path", Target::S1, |p| {
            json(find_project_session_by_path(
                &text(&p.project),
                &text(&p.s1),
                None,
            ))
        }),
        ("load_provider_sessions", Target::S1, |p| {
            json(block_on(multi_provider::load_provider_sessions(
                "claude".to_string(),
                text(&p.project),
                None,
            )))
        }),
        ("get_session_subagents", Target::Agent, |p| {
            json(block_on(get_session_subagents(text(&p.s2))))
        }),
        ("get_recent_edits", Target::S1, |p| {
            json(block_on(get_recent_edits(
                text(&p.project),
                None,
                None,
                None,
                None,
            )))
        }),
        ("get_recent_edits(session)", Target::S1, |p| {
            json(block_on(get_recent_edits(
                text(&p.project),
                None,
                None,
                Some(text(&p.s1)),
                None,
            )))
        }),
        ("get_expiring_sessions", Target::S1, |p| {
            json(block_on(archive::get_expiring_sessions(
                text(&p.project),
                100_000,
            )))
        }),
        ("create_archive", Target::Agent, archived),
        ("load_session_messages", Target::S1, |p| {
            json(block_on(load_session_messages(text(&p.s1))))
        }),
        ("load_session_messages_paginated", Target::S1, |p| {
            json(block_on(load_session_messages_paginated(
                text(&p.s1),
                0,
                20,
                None,
            )))
        }),
        ("get_session_message_count", Target::S1, |p| {
            json(block_on(get_session_message_count(text(&p.s1), None)))
        }),
        (
            "get_session_message_offset",
            Target::S1,
            |p| match get_session_message_offset(text(&p.s1), "outside-u0".to_string(), None) {
                Ok(Some(offset)) => format!("{SECRET} message found at {offset}"),
                other => format!("{other:?}"),
            },
        ),
        ("export_session", Target::S1, |p| {
            json(block_on(archive::export_session(
                text(&p.s1),
                "json".to_string(),
            )))
        }),
        ("load_provider_messages", Target::S1, |p| {
            json(block_on(multi_provider::load_provider_messages(
                "claude".to_string(),
                text(&p.s1),
            )))
        }),
    ]
}

/// `LEAK …` with the text around the first sign of the file outside the
/// root in a reader's result, or `ok`.
fn leak_or_ok(result: &str) -> String {
    let Some(at) = [SECRET, "4242"]
        .iter()
        .filter_map(|marker| result.find(marker))
        .min()
    else {
        return "ok".to_string();
    };
    let before: String = result[..at].chars().rev().take(60).collect();
    let after: String = result[at..].chars().take(80).collect();
    format!("LEAK …{}{after}…", before.chars().rev().collect::<String>())
}

/// One reader with `target` swapped right after its check: whether the swap
/// happened, and `ok`, `LEAK …` when the result holds anything of the file
/// outside the root, or `HANG` when it did not return in time.
fn run(paths: &Paths, target: Target, swap: Swap, read: Reader) -> (bool, String) {
    paths.restore();
    let swapped = target.path(paths).to_path_buf();
    let outside = paths.outside.clone();
    let at = swapped.clone();
    swap_after_check::arm(&swapped, move || {
        fs::remove_file(&at).unwrap();
        match swap {
            Swap::Link => symlink(&outside, &at).unwrap(),
            Swap::Fifo => mkfifo(&at),
        }
    });

    let (sent, received) = mpsc::channel();
    let reader_paths = paths.clone();
    std::thread::spawn(move || sent.send(read(&reader_paths)));
    let outcome = if let Ok(result) = received.recv_timeout(DEADLINE) {
        leak_or_ok(&result)
    } else {
        // Release the reader blocked opening the FIFO: a writer opening it
        // lets both opens return. It may block itself if the reader is
        // stuck elsewhere, so it gets a thread of its own.
        let fifo = swapped.clone();
        std::thread::spawn(move || fs::OpenOptions::new().write(true).open(fifo));
        format!("HANG >{}s", DEADLINE.as_secs())
    };
    (swap_after_check::disarm(), outcome)
}

#[test]
#[serial]
fn a_file_swapped_after_its_check_is_never_read_and_never_blocks_a_reader() {
    let home = SandboxHome::new();
    let outside = TempDir::new().unwrap();
    let paths = Paths::new(&home, &outside);

    let mut observed = Vec::new();
    let mut expected = Vec::new();
    for swap in [Swap::Link, Swap::Fifo] {
        for (reader, target, read) in readers() {
            let (swapped, outcome) = run(&paths, target, swap, read);
            println!("{reader} [{swap:?} {target:?}] => {outcome} (swapped: {swapped})");
            observed.push((reader, swap, swapped, outcome));
            expected.push((reader, swap, true, "ok".to_string()));
        }
    }
    paths.restore();
    assert_eq!(observed, expected);
}
