//! The old stats commands never read history through a symlink inside a
//! history root, so a link planted under `projects/` cannot pull a file from
//! outside the root into the numbers the HTTP routes serve (#691, backported
//! to v1.32.1). The walk root itself may be reached through a symlink (a
//! symlinked `~/.claude`, #355); nothing below it is followed.

use super::{
    get_global_stats_summary, get_project_stats_summary, get_project_token_stats,
    get_session_comparison, get_session_token_stats,
};
use crate::test_utils::SandboxHome;
use serial_test::serial;
use std::fs;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

/// 100 tokens inside the root, 4,242 outside it.
const INSIDE_TOKENS: u64 = 100;
const OUTSIDE_TOKENS: u64 = 4_242;

/// One assistant request row of `tokens` input tokens.
fn row(session: &str, uuid: &str, tokens: u64) -> String {
    let row = serde_json::json!({
        "sessionId": session,
        "type": "assistant",
        "isSidechain": false,
        "uuid": uuid,
        "timestamp": "2026-10-15T12:00:00Z",
        "message": {
            "id": format!("msg-{uuid}"),
            "role": "assistant",
            "model": "claude-sonnet-4-5-20250929",
            "content": [{"type": "text", "text": "fixture"}],
            "usage": {
                "input_tokens": tokens,
                "output_tokens": 0,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 0
            }
        }
    });
    format!("{row}\n")
}

fn write_session(path: &Path, session: &str, uuid: &str, tokens: u64) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, row(session, uuid, tokens)).unwrap();
}

/// A Claude root (`~/.claude`-shaped) with project `p` holding one
/// 100-token session, `s1`.
struct ClaudeRoot {
    dir: TempDir,
}

impl ClaudeRoot {
    fn new() -> Self {
        let root = Self {
            dir: TempDir::new().unwrap(),
        };
        write_session(&root.project().join("s1.jsonl"), "s1", "a1", INSIDE_TOKENS);
        root
    }

    fn base(&self) -> &Path {
        self.dir.path()
    }

    fn projects(&self) -> PathBuf {
        self.base().join("projects")
    }

    fn project(&self) -> PathBuf {
        self.projects().join("p")
    }
}

fn text(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

/// A 4,242-token session file outside every history root.
fn outside_session(dir: &TempDir) -> PathBuf {
    let path = dir.path().join("private.jsonl");
    write_session(&path, "private", "x1", OUTSIDE_TOKENS);
    path
}

async fn global_total(base: &Path) -> u64 {
    get_global_stats_summary(
        text(base),
        Some(vec!["claude".to_string()]),
        None,
        None,
        None,
        None,
    )
    .await
    .expect("global summary")
    .total_tokens
}

/// The four commands of the #691 review probe. A session file linked out of
/// the root, a project directory linked out of the root, and two aliases
/// inside it (a session file and a project directory) change nothing: every
/// command reads `s1` once and nothing else.
#[tokio::test]
#[serial]
async fn the_old_stats_commands_never_follow_a_symlink_out_of_the_root() {
    let _home = SandboxHome::new();
    let claude = ClaudeRoot::new();
    let project = claude.project();
    let outside = TempDir::new().unwrap();
    symlink(outside_session(&outside), project.join("escaped.jsonl")).unwrap();
    symlink(outside.path(), claude.projects().join("evil")).unwrap();
    symlink(project.join("s1.jsonl"), project.join("copy.jsonl")).unwrap();
    symlink(&project, claude.projects().join("alias")).unwrap();

    let summary = get_project_stats_summary(text(&project), None, None, None)
        .await
        .unwrap();
    let pages = get_project_token_stats(text(&project), Some(0), Some(100), None, None, None)
        .await
        .unwrap();
    let comparison = get_session_comparison("s1".to_string(), text(&project), None, None, None)
        .await
        .unwrap();
    let global = global_total(claude.base()).await;
    // One assertion over every command, so a failure shows all of them.
    assert_eq!(
        (
            ("get_project_stats_summary", summary.total_tokens),
            ("get_project_token_stats", pages.items.len() as u64),
            (
                "get_session_comparison %",
                f64::from(comparison.percentage_of_project_tokens).round() as u64
            ),
            ("get_global_stats_summary", global),
        ),
        (
            ("get_project_stats_summary", INSIDE_TOKENS),
            ("get_project_token_stats", 1),
            ("get_session_comparison %", 100),
            ("get_global_stats_summary", INSIDE_TOKENS),
        )
    );
}

/// A Claude root whose `projects/` folder is itself reached through a
/// symlink (#355) is still read: only links below the walk root are refused.
#[tokio::test]
#[serial]
async fn a_root_reached_through_a_symlink_is_still_read() {
    let _home = SandboxHome::new();
    let claude = ClaudeRoot::new();
    let linked = TempDir::new().unwrap();
    let linked_base = linked.path().join("claude");
    symlink(claude.base(), &linked_base).unwrap();
    let linked_project = linked_base.join("projects").join("p");

    let summary = get_project_stats_summary(text(&linked_project), None, None, None)
        .await
        .unwrap();
    assert_eq!(summary.total_tokens, INSIDE_TOKENS);
    assert_eq!(global_total(&linked_base).await, INSIDE_TOKENS);
}

/// Subagent transcripts are folded into their session (#577), found beside
/// it as `<session>/subagents/` (native) or `subagents/<session>/` (archive).
/// A symlinked folder on that way leaves the root just as a symlinked
/// session file does, so what lies behind it is never folded in.
#[tokio::test]
#[serial]
async fn subagent_transcripts_behind_a_symlinked_folder_are_never_folded_in() {
    let _home = SandboxHome::new();
    let claude = ClaudeRoot::new();
    let project = claude.project();
    write_session(&project.join("s2.jsonl"), "s2", "b1", INSIDE_TOKENS);
    // Native layout: `p/s1` is a link to a folder holding `subagents/`.
    let native = TempDir::new().unwrap();
    write_session(
        &native.path().join("subagents").join("agent-n.jsonl"),
        "s1",
        "n1",
        OUTSIDE_TOKENS,
    );
    symlink(native.path(), project.join("s1")).unwrap();
    // Archive layout: `p/subagents` is a link to a folder holding `s1/`.
    let archive = TempDir::new().unwrap();
    write_session(
        &archive.path().join("s1").join("agent-a.jsonl"),
        "s1",
        "r1",
        OUTSIDE_TOKENS,
    );
    symlink(archive.path(), project.join("subagents")).unwrap();

    let pages = get_project_token_stats(text(&project), Some(0), Some(100), None, None, None)
        .await
        .unwrap();
    let s1_tokens = pages
        .items
        .iter()
        .find(|item| item.session_id == "s1")
        .map(|item| item.total_tokens);
    let single = get_session_token_stats(text(&project.join("s1.jsonl")), None, None, None)
        .await
        .unwrap();
    let comparison = get_session_comparison("s1".to_string(), text(&project), None, None, None)
        .await
        .unwrap();
    assert_eq!(
        (
            ("get_project_token_stats s1", s1_tokens),
            ("get_session_token_stats", single.total_tokens),
            (
                "get_session_comparison %",
                f64::from(comparison.percentage_of_project_tokens).round() as u64
            ),
        ),
        (
            ("get_project_token_stats s1", Some(INSIDE_TOKENS)),
            ("get_session_token_stats", INSIDE_TOKENS),
            // s1 and s2 hold 100 tokens each.
            ("get_session_comparison %", 50),
        )
    );
}

/// The same folders, real and inside the root: subagent transcripts are
/// still folded in under `billing_total`.
#[tokio::test]
#[serial]
async fn subagent_transcripts_inside_the_root_are_still_folded_in() {
    let _home = SandboxHome::new();
    let claude = ClaudeRoot::new();
    let project = claude.project();
    write_session(
        &project.join("s1").join("subagents").join("agent-n.jsonl"),
        "s1",
        "n1",
        7,
    );
    write_session(
        &project.join("subagents").join("s1").join("agent-a.jsonl"),
        "s1",
        "r1",
        11,
    );

    let single = get_session_token_stats(text(&project.join("s1.jsonl")), None, None, None)
        .await
        .unwrap();
    assert_eq!(single.total_tokens, INSIDE_TOKENS + 7 + 11);
}
