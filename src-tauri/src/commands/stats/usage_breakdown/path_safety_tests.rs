//! A request never leaves its history roots through a symlink, and a part
//! of a root the walk cannot read is reported, never counted as complete
//! (ADR 0003 §7, `AN0b` review P1 and P2). The old stats commands walk
//! Claude history with the same helper, so the symlink scenarios assert
//! them too: old and new read the same file set.

use super::contribution::read_claude_file;
use super::fixture::*;
use super::*;
use crate::commands::stats::{
    get_global_stats_summary, get_project_stats_summary, get_project_token_stats,
    get_session_comparison,
};
use crate::test_utils::SandboxHome;
use serial_test::serial;
use std::fs;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

/// The review probe's numbers: 100 tokens inside the root, 4,242 outside.
const INSIDE_TOKENS: u64 = 100;
const OUTSIDE_TOKENS: u64 = 4_242;

fn write_rows(path: &Path, rows: &[FixtureRow]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let body: String = rows
        .iter()
        .map(|r| r.to_json().to_string() + "\n")
        .collect();
    fs::write(path, body).unwrap();
}

/// A Claude root with project `p` holding one 100-token session, `s1`.
fn inside_fixture() -> UsageFixture {
    UsageFixture::write(
        "p",
        vec![row("s1", "a1", "2026-10-15T12:00:00Z").tokens(INSIDE_TOKENS, 0, 0, 0)],
    )
}

/// A 4,242-token session file outside every history root.
fn outside_session(dir: &TempDir) -> PathBuf {
    let path = dir.path().join("private.jsonl");
    write_rows(
        &path,
        &[row("private", "x1", "2026-10-16T12:00:00Z").tokens(OUTSIDE_TOKENS, 0, 0, 0)],
    );
    path
}

fn days() -> Vec<UsageInterval> {
    vec![
        interval("2026-10-15", "2026-10-15T00:00:00Z", "2026-10-16T00:00:00Z"),
        interval("2026-10-16", "2026-10-16T00:00:00Z", "2026-10-17T00:00:00Z"),
    ]
}

fn project_request(project_path: String) -> UsageBreakdownRequest {
    UsageBreakdownRequest {
        scope: UsageScope::Project {
            project_path,
            provider: "claude".to_string(),
        },
        stats_mode: UsageStatsMode::BillingTotal,
        intervals: days(),
    }
}

fn all_request(claude_root: &Path) -> UsageBreakdownRequest {
    UsageBreakdownRequest {
        scope: UsageScope::All {
            providers: vec!["claude".to_string()],
            claude_path: claude_root.to_string_lossy().to_string(),
            custom_claude_paths: Vec::new(),
        },
        stats_mode: UsageStatsMode::BillingTotal,
        intervals: days(),
    }
}

fn total_tokens(response: &UsageBreakdownResponse) -> u64 {
    response
        .intervals
        .iter()
        .flat_map(|i| &i.models)
        .map(|m| m.stats.token_count)
        .sum()
}

/// (status, sessions scanned, sessions failed) of the Claude provider.
fn claude(response: &UsageBreakdownResponse) -> (ProviderScanStatus, u64, u64) {
    let claude = response
        .coverage
        .providers
        .iter()
        .find(|p| p.id == "claude")
        .expect("claude coverage");
    (
        claude.status,
        claude.sessions_scanned,
        claude.sessions_failed,
    )
}

async fn legacy_project_total(project_path: &str) -> u64 {
    get_project_stats_summary(project_path.to_string(), None, None, None)
        .await
        .expect("legacy project summary")
        .total_tokens
}

async fn legacy_global_total(claude_root: &Path) -> u64 {
    get_global_stats_summary(
        claude_root.to_string_lossy().to_string(),
        Some(vec!["claude".to_string()]),
        None,
        None,
        None,
        None,
    )
    .await
    .expect("legacy global summary")
    .total_tokens
}

#[tokio::test]
#[serial]
async fn a_symlinked_session_file_is_never_read() {
    let _home = SandboxHome::new();
    let fixture = inside_fixture();
    let outside = TempDir::new().unwrap();
    let link = Path::new(&fixture.project_path()).join("escaped.jsonl");
    symlink(outside_session(&outside), &link).unwrap();

    let response = get_usage_breakdown(project_request(fixture.project_path()))
        .await
        .unwrap();
    assert_eq!(total_tokens(&response), INSIDE_TOKENS);
    assert!(response
        .sessions
        .iter()
        .all(|s| !s.session_ref.file_path.ends_with("escaped.jsonl")));
    // Refused, not followed: a source that was not read, so not complete.
    assert_eq!(claude(&response), (ProviderScanStatus::Partial, 1, 0));
}

/// The old commands walk Claude history with the same helper: a symlinked
/// session file, a symlinked project directory and an alias change nothing.
#[tokio::test]
#[serial]
async fn the_old_stats_commands_never_follow_a_symlink_either() {
    let _home = SandboxHome::new();
    let fixture = inside_fixture();
    let project = PathBuf::from(fixture.project_path());
    let outside = TempDir::new().unwrap();
    symlink(outside_session(&outside), project.join("escaped.jsonl")).unwrap();
    symlink(outside.path(), fixture.root().join("projects/evil")).unwrap();
    symlink(project.join("s1.jsonl"), project.join("copy.jsonl")).unwrap();
    symlink(&project, fixture.root().join("projects/alias")).unwrap();

    let project_total = legacy_project_total(&fixture.project_path()).await;
    let pages =
        get_project_token_stats(fixture.project_path(), Some(0), Some(100), None, None, None)
            .await
            .unwrap();
    let comparison =
        get_session_comparison("s1".to_string(), fixture.project_path(), None, None, None)
            .await
            .unwrap();
    let global_total = legacy_global_total(fixture.root()).await;
    // One assertion over every command, so a failure shows all of them.
    assert_eq!(
        (
            ("get_project_stats_summary", project_total),
            ("get_project_token_stats", pages.items.len() as u64),
            (
                "get_session_comparison %",
                f64::from(comparison.percentage_of_project_tokens).round() as u64
            ),
            ("get_global_stats_summary", global_total),
        ),
        (
            ("get_project_stats_summary", INSIDE_TOKENS),
            ("get_project_token_stats", 1),
            ("get_session_comparison %", 100),
            ("get_global_stats_summary", INSIDE_TOKENS),
        )
    );
}

#[tokio::test]
#[serial]
async fn a_symlinked_project_directory_is_never_walked() {
    let _home = SandboxHome::new();
    let fixture = inside_fixture();
    let outside = TempDir::new().unwrap();
    outside_session(&outside);
    symlink(outside.path(), fixture.root().join("projects/evil")).unwrap();

    let response = get_usage_breakdown(all_request(fixture.root()))
        .await
        .unwrap();
    assert_eq!(total_tokens(&response), INSIDE_TOKENS);
    assert_eq!(claude(&response), (ProviderScanStatus::Partial, 1, 0));
    assert_eq!(legacy_global_total(fixture.root()).await, INSIDE_TOKENS);
}

#[tokio::test]
#[serial]
async fn a_symlink_that_stays_inside_the_root_is_an_alias_not_a_failure() {
    let _home = SandboxHome::new();
    let fixture = inside_fixture();
    let project = PathBuf::from(fixture.project_path());
    symlink(project.join("s1.jsonl"), project.join("copy.jsonl")).unwrap();
    symlink(&project, fixture.root().join("projects/alias")).unwrap();

    let all = get_usage_breakdown(all_request(fixture.root()))
        .await
        .unwrap();
    assert_eq!(total_tokens(&all), INSIDE_TOKENS, "counted once");
    assert_eq!(claude(&all), (ProviderScanStatus::Scanned, 1, 0));
    assert_eq!(legacy_global_total(fixture.root()).await, INSIDE_TOKENS);

    let one = get_usage_breakdown(project_request(fixture.project_path()))
        .await
        .unwrap();
    assert_eq!(total_tokens(&one), INSIDE_TOKENS);
    assert_eq!(claude(&one), (ProviderScanStatus::Scanned, 1, 0));
    assert_eq!(
        legacy_project_total(&fixture.project_path()).await,
        INSIDE_TOKENS
    );
}

/// An empty `claude_path` means the default root, `~/.claude`, as the HTTP
/// route's root guard reads it (`require_claude_base`: "empty means use the
/// default"), not a `projects/` folder relative to the working directory.
#[tokio::test]
#[serial]
async fn an_empty_claude_path_means_the_default_root() {
    let home = SandboxHome::new();
    write_rows(
        &home.path().join(".claude/projects/p/s1.jsonl"),
        &[row("s1", "a1", "2026-10-15T12:00:00Z").tokens(INSIDE_TOKENS, 0, 0, 0)],
    );

    let response = get_usage_breakdown(all_request(Path::new("")))
        .await
        .unwrap();
    assert_eq!(total_tokens(&response), INSIDE_TOKENS);
    assert_eq!(claude(&response), (ProviderScanStatus::Scanned, 1, 0));
    // The old global summary reads the same roots.
    assert_eq!(legacy_global_total(Path::new("")).await, INSIDE_TOKENS);

    fs::remove_dir_all(home.path().join(".claude")).unwrap();
    let response = get_usage_breakdown(all_request(Path::new("")))
        .await
        .unwrap();
    assert_eq!(claude(&response), (ProviderScanStatus::NotFound, 0, 0));
}

/// Defense in depth: even a path handed straight to the reader is opened
/// only as a regular file inside its canonical root.
#[test]
fn the_reader_opens_only_regular_files_inside_its_root() {
    let fixture = inside_fixture();
    let project = PathBuf::from(fixture.project_path());
    let root = fs::canonicalize(&project).unwrap();
    let outside = TempDir::new().unwrap();
    let secret = outside_session(&outside);
    let link = project.join("escaped.jsonl");
    symlink(&secret, &link).unwrap();
    let mode = StatsMode::BillingTotal;

    let error = read_claude_file(&link, &root, mode).unwrap_err();
    assert!(error.contains("symlink"), "{error}");
    let error = read_claude_file(&secret, &root, mode).unwrap_err();
    assert!(error.contains("outside the scanned root"), "{error}");
    let inside = read_claude_file(&project.join("s1.jsonl"), &root, mode).unwrap();
    assert_eq!(inside.contributions.len(), 1);
}

/// A 77-token session in `<project>/locked/`, as the review probe wrote it.
fn locked_session(project: &Path) -> PathBuf {
    let locked = project.join("locked");
    write_rows(
        &locked.join("hidden.jsonl"),
        &[row("hidden", "h1", "2026-10-15T13:00:00Z").tokens(77, 0, 0, 0)],
    );
    locked
}

#[tokio::test]
#[serial]
async fn an_unreadable_subdirectory_makes_the_project_partial_not_complete() {
    let _home = SandboxHome::new();
    let fixture = inside_fixture();
    let locked = locked_session(Path::new(&fixture.project_path()));
    let Some(_unreadable) = Unreadable::new(&locked) else {
        return;
    };

    let response = get_usage_breakdown(project_request(fixture.project_path()))
        .await
        .unwrap();
    assert_eq!(total_tokens(&response), INSIDE_TOKENS);
    assert_eq!(claude(&response), (ProviderScanStatus::Partial, 1, 0));
}

/// The review probe: the project's only history sits in a mode-000
/// directory. That is unreadable, not a project with zero usage.
#[tokio::test]
#[serial]
async fn a_project_whose_history_cannot_be_read_is_unreadable_not_zero() {
    let _home = SandboxHome::new();
    let fixture = UsageFixture::write("p", Vec::new());
    let locked = locked_session(Path::new(&fixture.project_path()));
    let Some(_unreadable) = Unreadable::new(&locked) else {
        return;
    };

    let response = get_usage_breakdown(project_request(fixture.project_path()))
        .await
        .unwrap();
    assert_eq!(total_tokens(&response), 0);
    assert_eq!(claude(&response), (ProviderScanStatus::Unreadable, 0, 0));
}

#[tokio::test]
#[serial]
async fn an_unreadable_project_directory_makes_the_all_scope_partial() {
    let _home = SandboxHome::new();
    let fixture = inside_fixture();
    let other = fixture.root().join("projects/q");
    write_rows(
        &other.join("s2.jsonl"),
        &[row("s2", "b1", "2026-10-15T14:00:00Z").tokens(5, 0, 0, 0)],
    );
    let Some(_unreadable) = Unreadable::new(&other) else {
        return;
    };

    let response = get_usage_breakdown(all_request(fixture.root()))
        .await
        .unwrap();
    assert_eq!(total_tokens(&response), INSIDE_TOKENS);
    assert_eq!(claude(&response), (ProviderScanStatus::Partial, 1, 0));
}
