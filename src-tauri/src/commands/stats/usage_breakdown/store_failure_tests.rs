//! A store that is there but cannot be read in part is never a `scanned`
//! zero (ADR 0003 §7, `AN0b` re-review P2).
//!
//! For every token-reporting provider, each directory or file of a present
//! store that its scan reads is locked (mode 000) in turn while it holds
//! the store's only session. The provider must then be `unreadable`: the
//! scan may keep going past what it cannot read, but it has to say so.

use super::fixture::*;
use super::*;
use crate::test_utils::SandboxHome;
use serde_json::{json, Value};
use serial_test::serial;
use std::fs;
use std::path::{Path, PathBuf};

/// One provider's store in a sandbox home, holding one session.
struct Store {
    provider: &'static str,
    /// Points the provider at the sandbox where its default path would not.
    env: Vec<EnvGuard>,
    /// Parts of the store its scan reads; each one alone at mode 000 leaves
    /// the session unreadable.
    locks: Vec<PathBuf>,
}

impl Store {
    fn new(provider: &'static str, locks: Vec<PathBuf>) -> Self {
        Self {
            provider,
            env: Vec::new(),
            locks,
        }
    }

    fn with_env(mut self, key: &'static str, value: &Path) -> Self {
        self.env.push(EnvGuard::set(key, value));
        self
    }
}

type Fixture = fn(&Path) -> Store;

const READABLE: &str = "scanned, 1 session read";
const UNREADABLE: &str = "unreadable, 0 sessions read";

/// The provider's coverage in an `all` request for it alone. Each request
/// starts with a cold contribution cache: it keys on size and mtime, which a
/// chmod leaves alone, so it would answer for a locked file it read before.
async fn coverage_of(provider: &str, home: &Path) -> String {
    super::contribution_cache::contribution_cache().clear();
    let request = UsageBreakdownRequest {
        scope: UsageScope::All {
            providers: vec![provider.to_string()],
            claude_path: home.join(".claude").to_string_lossy().to_string(),
            custom_claude_paths: Vec::new(),
        },
        stats_mode: UsageStatsMode::BillingTotal,
        intervals: vec![interval(
            "2020s",
            "2020-01-01T00:00:00Z",
            "2030-01-01T00:00:00Z",
        )],
    };
    let response = get_usage_breakdown(request).await.expect("breakdown");
    let coverage = &response.coverage.providers[0];
    let status = serde_json::to_value(coverage.status).unwrap();
    let read = coverage.sessions_scanned;
    let noun = if read == 1 { "session" } else { "sessions" };
    format!("{}, {read} {noun} read", status.as_str().unwrap())
}

/// Every fixture readable, then each of its locks in turn: one assertion
/// over every provider, so a failure shows the whole matrix.
async fn check(fixtures: &[Fixture]) {
    let mut seen = Vec::new();
    let mut expected = Vec::new();
    for fixture in fixtures {
        let home = SandboxHome::new();
        let _cleared = without_store_env();
        // `_env` holds the store's own env overrides until the next store.
        let Store {
            provider,
            env: _env,
            locks,
        } = fixture(home.path());
        seen.push((
            provider,
            "-".to_string(),
            coverage_of(provider, home.path()).await,
        ));
        expected.push((provider, "-".to_string(), READABLE.to_string()));
        for lock in &locks {
            let part = lock
                .strip_prefix(home.path())
                .unwrap()
                .display()
                .to_string();
            // As root, mode 000 locks nothing: this store's lock rows are
            // skipped, and its readable row and the other stores still count.
            let Some(_locked) = Unreadable::new(lock) else {
                break;
            };
            seen.push((
                provider,
                part.clone(),
                coverage_of(provider, home.path()).await,
            ));
            expected.push((provider, part, UNREADABLE.to_string()));
        }
    }
    assert_eq!(seen, expected);
}

#[tokio::test]
#[serial]
async fn an_unreadable_part_of_a_file_store_is_never_a_scanned_zero() {
    check(&[
        claude,
        codex,
        openinterpreter,
        gemini,
        qwen,
        pi,
        ompi,
        grok,
        kimi,
        kimi_code,
        cline,
        copilot_cli,
        copilot_vscode,
        antigravity,
    ])
    .await;
}

#[tokio::test]
#[serial]
async fn an_unreadable_part_of_a_database_store_is_never_a_scanned_zero() {
    check(&[opencode, kilo, forgecode, zcode, llm, cursor]).await;
}

/// Antigravity's project scan falls back to its CLI projects when the
/// desktop scan fails; the reporting variant still records that failure
/// (a review finding on #708). The desktop scan fails on a `brain` that is
/// a file for every user, root included (mode 000 does not stop root), so
/// this test always reaches its assertion.
#[test]
#[serial]
fn an_antigravity_desktop_failure_beside_cli_projects_is_recorded() {
    let home = SandboxHome::new();
    let _cleared = without_store_env();
    let Store { env: _env, .. } = antigravity(home.path());
    let brain = home.path().join(".gemini/antigravity/brain");
    fs::write(&brain, "").unwrap();
    let cli = home.path().join(".gemini/antigravity-cli");
    write_lines(
        &cli.join("history.jsonl"),
        &[json!({"display": "hi", "timestamp": 1_792_141_200_000_u64,
                 "workspace": "/work/app", "conversationId": "conv-1"})],
    );
    write_lines(
        &cli.join("brain/conv-1/.system_generated/logs/transcript_full.jsonl"),
        &[
            json!({"step_index": 0, "source": "USER_EXPLICIT", "type": "USER_INPUT",
                 "status": "DONE", "content": "hi",
                 "created_at": "2026-10-16T09:00:00Z"}),
        ],
    );
    let report = crate::providers::scan_report::ScanReport::default();
    let projects =
        crate::providers::antigravity::scan_projects_reporting(&report).expect("the CLI projects");
    let paths: Vec<&str> = projects.iter().map(|p| p.path.as_str()).collect();
    assert_eq!(
        (paths, report.is_empty()),
        (vec!["antigravity-cli:///work/app"], false)
    );
}

// ---- the other commands -------------------------------------------------------

/// The commands other than `get_usage_breakdown` do not read the coverage
/// report: with a store absent or a part of it unreadable, each answers as
/// develop (733c3260) did — an error stays that error, never an empty page
/// or zero usage (a review finding on #708: the llm and Z Code project
/// statistics turned a database they could not open into zero usage).
///
/// Rows per store: readable, absent (its top part moved away), then each of
/// its locks in turn, as in [`check`]. The answers are [`old_commands`].
#[tokio::test]
#[serial]
async fn the_other_commands_answer_an_unreadable_store_as_before() {
    let mut seen = Vec::new();
    let mut expected = Vec::new();
    for (fixture, before) in DEVELOP_ANSWERS {
        let home = SandboxHome::new();
        let _cleared = without_store_env();
        let Store {
            provider,
            env: _env,
            locks,
        } = fixture(home.path());
        assert_eq!(
            before.len(),
            locks.len() + 2,
            "{provider}: one answer a row"
        );
        let mut projects: Vec<String> = provider_scan(provider)
            .expect("the readable store scans")
            .into_iter()
            .map(|project| project.path)
            .collect();
        projects.sort();
        let project = projects.first().expect("the store's project").clone();
        let session = crate::commands::multi_provider::load_provider_sessions(
            provider.to_string(),
            project.clone(),
            Some(false),
        )
        .await
        .expect("the readable store's sessions")
        .first()
        .expect("the store's session")
        .file_path
        .clone();
        let ask = || old_commands(provider, home.path(), &project, &session);

        let mut rows = vec![("readable".to_string(), ask().await)];
        let away = locks[0].with_extension("away");
        fs::rename(&locks[0], &away).unwrap();
        rows.push(("absent".to_string(), ask().await));
        fs::rename(&away, &locks[0]).unwrap();
        for lock in &locks {
            let part = lock
                .strip_prefix(home.path())
                .unwrap()
                .display()
                .to_string();
            // As root, mode 000 locks nothing (see `check`).
            let Some(_locked) = Unreadable::new(lock) else {
                break;
            };
            rows.push((part, ask().await));
        }
        for ((part, answer), before) in rows.into_iter().zip(before.iter()) {
            seen.push((provider, part.clone(), answer));
            expected.push((provider, part, (*before).to_string()));
        }
    }
    assert_eq!(seen, expected);
}

type Scanner = fn() -> Result<Vec<crate::models::ClaudeProject>, String>;

/// The project scans behind the project tree, by provider id.
const PROVIDER_SCANS: [(&str, Scanner); 17] = [
    ("antigravity", crate::providers::antigravity::scan_projects),
    ("cline", crate::providers::cline::scan_projects),
    ("codex", crate::providers::codex::scan_projects),
    ("copilot", crate::providers::copilot::scan_projects),
    ("cursor", crate::providers::cursor::scan_projects),
    ("forgecode", crate::providers::forgecode::scan_projects),
    ("gemini", crate::providers::gemini::scan_projects),
    ("grok", crate::providers::grok::scan_projects),
    ("kilo", crate::providers::kilo::scan_projects),
    ("kimi", crate::providers::kimi::scan_projects),
    ("llm", crate::providers::llm::scan_projects),
    ("ompi", crate::providers::ompi::scan_projects),
    ("opencode", crate::providers::opencode::scan_projects),
    (
        "openinterpreter",
        crate::providers::openinterpreter::scan_projects,
    ),
    ("pi", crate::providers::pi::scan_projects),
    ("qwen", crate::providers::qwen::scan_projects),
    ("zcode", crate::providers::zcode::scan_projects),
];

fn provider_scan(provider: &str) -> Result<Vec<crate::models::ClaudeProject>, String> {
    let (_, scan) = PROVIDER_SCANS
        .iter()
        .find(|(id, _)| *id == provider)
        .expect("a provider with a project scan");
    scan()
}

/// The answers of the other commands, in [`DEVELOP_ANSWERS`]' columns.
async fn old_commands(provider: &str, home: &Path, project: &str, session: &str) -> String {
    let claude = home.join(".claude").to_string_lossy().to_string();
    let mode = || Some("billing_total".to_string());
    let projects = provider_scan(provider);
    let sessions = crate::commands::multi_provider::load_provider_sessions(
        provider.to_string(),
        project.to_string(),
        Some(false),
    )
    .await;
    let hits = crate::commands::multi_provider::search_all_providers(
        Some(claude.clone()),
        "hi".to_string(),
        Some(vec![provider.to_string()]),
        None,
        None,
        Some(100),
        None,
        Some(false),
        None,
    )
    .await;
    let tokens = crate::commands::stats::get_project_token_stats(
        project.to_string(),
        Some(0),
        Some(100),
        None,
        None,
        mode(),
    )
    .await;
    let summary =
        crate::commands::stats::get_project_stats_summary(project.to_string(), None, None, mode())
            .await;
    let global = crate::commands::stats::get_global_stats_summary(
        claude,
        Some(vec![provider.to_string()]),
        mode(),
        None,
        None,
        None,
    )
    .await;
    let session_stats =
        crate::commands::stats::get_session_token_stats(session.to_string(), None, None, mode())
            .await;
    [
        answer(&projects, Vec::len),
        answer(&sessions, Vec::len),
        answer(&hits, Vec::len),
        same_error(&tokens, |page| page.total_count, &sessions),
        same_error(&summary, |summary| summary.total_sessions, &sessions),
        answer(&global, |summary| summary.total_sessions as usize),
        answer(&session_stats, |stats| stats.message_count),
    ]
    .join(" ")
}

/// `E` for an error, else how many `count` finds in the answer.
fn answer<T>(result: &Result<T, String>, count: impl Fn(&T) -> usize) -> String {
    match result {
        Ok(value) => count(value).to_string(),
        Err(_) => "E".to_string(),
    }
}

/// [`answer`] of a command that loads the session list: when that list is an
/// error, so is the command — the same one (`E≠` marks another error).
fn same_error<T>(
    result: &Result<T, String>,
    count: impl Fn(&T) -> usize,
    sessions: &Result<Vec<crate::models::ClaudeSession>, String>,
) -> String {
    match (result, sessions) {
        (Err(error), Err(list_error)) if error != list_error => "E≠".to_string(),
        _ => answer(result, count),
    }
}

/// What develop answered, row by row ([`old_commands`]; the same at 733c3260
/// and at 84e068f9). Columns:
/// projects scanned, sessions listed, search hits, the project token stats
/// page and the project summary (sessions), the global summary (sessions),
/// the session token stats (messages); `E` is an error.
const DEVELOP_ANSWERS: &[(Fixture, &[&str])] = &[
    (
        codex,
        &[
            "1 1 1 1 1 1 2", // readable
            "0 0 0 0 0 0 E", // absent
            "0 0 0 0 0 0 E", // sessions
            "0 0 0 0 0 0 E", // 16
            "0 0 0 0 0 0 E", // rollout-2026-10-16T09-00-00-codex-s1.jsonl
        ],
    ),
    (
        openinterpreter,
        &[
            "1 1 1 1 1 1 2", // readable
            "0 0 0 0 0 0 E", // absent
            "0 0 0 0 0 0 E", // sessions
            "0 0 0 0 0 0 E", // 16
            "0 0 0 0 0 0 E", // rollout-2026-10-16T09-00-00-oi-s1.jsonl
        ],
    ),
    (
        gemini,
        &[
            "1 1 1 1 1 1 2", // readable
            "0 E 0 E E 0 E", // absent
            "E E 0 E E 0 E", // tmp
            "0 0 0 0 0 0 E", // projhash
            "0 E 0 E E 0 E", // chats
            "0 0 0 0 0 0 E", // session-2026-10-16T01-00-abc.json
        ],
    ),
    (
        qwen,
        &[
            "1 1 1 1 1 1 2", // readable
            "0 0 0 0 0 0 E", // absent
            "0 0 0 0 0 0 E", // .qwen
            "0 0 0 0 0 0 E", // projects
            "0 0 0 0 0 0 E", // -work-app
            "0 0 0 0 0 0 E", // chats
            "0 0 0 0 0 0 E", // sess-q1.jsonl
        ],
    ),
    (
        pi,
        &[
            "1 1 1 1 1 1 2", // readable
            "0 0 0 0 0 0 E", // absent
            "0 0 0 0 0 0 E", // .pi
            "0 0 0 0 0 0 E", // agent
            "0 0 0 0 0 0 E", // sessions
            "0 0 0 0 0 0 E", // --work-app--
            "0 0 0 0 0 0 E", // 2026-10-16T09-00-00-000Z_s1.jsonl
        ],
    ),
    (
        ompi,
        &[
            "1 1 1 1 1 1 2", // readable
            "0 0 0 0 0 0 E", // absent
            "0 0 0 0 0 0 E", // .omp
            "0 0 0 0 0 0 E", // agent
            "0 0 0 0 0 0 E", // sessions
            "0 0 0 0 0 0 E", // --work-app--
            "0 0 0 0 0 0 E", // 2026-10-16T09-00-00-000Z_s1.jsonl
        ],
    ),
    (
        grok,
        &[
            "1 1 1 1 1 1 2", // readable
            "E E 0 E E 0 E", // absent
            "0 E 0 E E 0 E", // .grok
            "E E 0 E E 0 E", // sessions
            "E E 0 E E 0 E", // %2Fwork%2Fapp
            "0 0 0 0 0 0 E", // 019fa555-791c-71e2-8c92-ff2e6fa26d6e
            "0 0 0 0 0 0 2", // summary.json
            "1 1 0 E E 0 E", // chat_history.jsonl
        ],
    ),
    (
        kimi,
        &[
            "1 1 1 1 1 1 2", // readable
            "0 E 0 E E 0 E", // absent
            "0 E 0 E E 0 E", // .kimi
            "E E 0 E E 0 E", // sessions
            "E E 0 E E 0 E", // proj-hash
            "0 0 0 0 0 0 E", // sess-k1
            "0 0 0 0 0 0 E", // context.jsonl
        ],
    ),
    (
        kimi_code,
        &[
            "1 1 1 1 1 1 1", // readable
            "0 0 0 0 0 0 E", // absent
            "0 E 0 E E 0 E", // .kimi-code
            "0 E 0 E E 0 E", // sessions
            "0 0 0 0 0 0 E", // wd_demo
            "0 0 0 0 0 0 E", // session_one
            "0 0 0 0 0 0 E", // agents
            "0 0 0 0 0 0 E", // main
            "0 0 0 0 0 0 E", // wire.jsonl
        ],
    ),
    (
        cline,
        &[
            "1 1 0 E E 0 E", // readable
            "0 E 0 E E 0 E", // absent
            "0 E 0 E E 0 E", // globalStorage
            "0 0 0 0 0 0 E", // saoudrizwan.claude-dev
            "0 0 0 0 0 0 E", // state
            "0 0 0 0 0 0 E", // taskHistory.json
            "1 1 0 E E 0 E", // tasks
            "1 1 0 E E 0 E", // task-1
            "1 1 0 E E 0 E", // ui_messages.json
        ],
    ),
    (
        copilot_cli,
        &[
            "1 1 1 1 1 1 1", // readable
            "0 0 0 0 0 0 E", // absent
            "0 0 0 0 0 0 E", // .copilot
            "0 0 0 0 0 0 E", // session-state
            "0 0 0 0 0 0 E", // 11111111-1111-1111-1111-111111111111
            "1 1 0 E E 0 E", // events.jsonl
        ],
    ),
    (
        copilot_vscode,
        &[
            "1 1 1 1 1 1 E", // readable
            "0 0 0 0 0 0 E", // absent
            "0 0 0 0 0 0 E", // User
            "0 0 0 0 0 0 E", // workspaceStorage
            "0 0 0 0 0 0 E", // abc123
            "0 1 1 1 1 0 E", // workspace.json
            "0 0 0 0 0 0 E", // chatSessions
            "0 0 0 0 0 0 E", // vs-1.json
        ],
    ),
    (
        antigravity,
        &[
            "1 1 1 1 1 1 1", // readable
            "0 0 0 0 0 0 E", // absent
            "0 0 0 0 0 0 E", // antigravity
            "0 0 0 0 0 0 E", // .token-monitor
            "0 0 0 0 0 0 E", // rpc-cache
            "E E 0 E E 0 E", // v1
            "0 0 0 0 0 0 E", // sess-a1
            "1 1 0 E E 0 E", // usage.jsonl
        ],
    ),
    (
        opencode,
        &[
            "1 1 1 1 1 1 2", // readable
            "0 0 0 0 0 0 E", // absent
            "0 0 0 0 0 0 E", // opencode.db
        ],
    ),
    (
        kilo,
        &[
            "1 1 1 1 1 1 2", // readable
            "0 0 0 0 0 0 E", // absent
            "0 0 0 0 0 0 E", // kilo.db
        ],
    ),
    (
        forgecode,
        &[
            "1 1 1 1 1 1 2", // readable
            "E E 0 E E 0 E", // absent
            "0 0 0 0 0 0 E", // .forge
            "0 0 0 0 0 0 E", // .forge.db
        ],
    ),
    (
        zcode,
        &[
            "1 1 0 0 0 0 E", // readable
            "0 0 0 0 0 0 E", // absent
            "0 0 0 0 0 0 E", // .zcode
            "0 0 0 0 0 0 E", // cli
            "0 0 0 0 0 0 E", // db
            "E E 0 E E 0 E", // db.sqlite
        ],
    ),
    (
        llm,
        &[
            "1 1 1 1 1 1 2", // readable
            "E E 0 E E 0 E", // absent
            "E E 0 E E 0 E", // llm-user
            "E E 0 E E 0 E", // logs.db
        ],
    ),
    (
        cursor,
        &[
            "1 1 0 1 1 1 2", // readable
            "E E 0 E E 0 E", // absent
            "0 0 0 0 0 0 E", // cursor-user
            "0 0 0 0 0 0 E", // globalStorage
            "E E 0 E E 0 E", // state.vscdb
        ],
    ),
];

// ---- fixtures ----------------------------------------------------------------

fn write_lines(path: &Path, lines: &[Value]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut body = String::new();
    for line in lines {
        body.push_str(&line.to_string());
        body.push('\n');
    }
    fs::write(path, body).unwrap();
}

/// A Codex-format rollout (Codex and Open Interpreter) with token usage.
fn write_rollout(day_dir: &Path, id: &str) -> PathBuf {
    let path = day_dir.join(format!("rollout-2026-10-16T09-00-00-{id}.jsonl"));
    write_lines(
        &path,
        &[
            json!({"timestamp": "2026-10-16T09:00:00Z", "type": "session_meta",
                   "payload": {"id": id, "cwd": "/work/app"}}),
            json!({"timestamp": "2026-10-16T09:00:01Z", "type": "turn_context",
                   "payload": {"model": "gpt-5-codex", "cwd": "/work/app"}}),
            json!({"timestamp": "2026-10-16T09:00:02Z", "type": "response_item",
                   "payload": {"type": "message", "role": "user",
                               "content": [{"type": "input_text", "text": "hi"}]}}),
            json!({"timestamp": "2026-10-16T09:00:03Z", "type": "response_item",
                   "payload": {"type": "message", "role": "assistant",
                               "content": [{"type": "output_text", "text": "done"}]}}),
            json!({"timestamp": "2026-10-16T09:00:04Z", "type": "event_msg",
                   "payload": {"type": "token_count", "info": {"total_token_usage":
                               {"input_tokens": 1200, "cached_input_tokens": 200,
                                "output_tokens": 80}}}}),
        ],
    );
    path
}

/// `~/.codex/sessions/<y>/<m>/<d>/rollout-*.jsonl`.
fn codex(home: &Path) -> Store {
    let sessions = home.join(".codex/sessions");
    let rollout = write_rollout(&sessions.join("2026/10/16"), "codex-s1");
    Store::new(
        "codex",
        vec![sessions.clone(), sessions.join("2026/10/16"), rollout],
    )
}

/// `~/.openinterpreter/sessions/…`: the Codex rollout format.
fn openinterpreter(home: &Path) -> Store {
    let sessions = home.join(".openinterpreter/sessions");
    let rollout = write_rollout(&sessions.join("2026/10/16"), "oi-s1");
    Store::new(
        "openinterpreter",
        vec![sessions.clone(), sessions.join("2026/10/16"), rollout],
    )
}

/// `~/.gemini/tmp/<project hash>/chats/session-*.json`.
fn gemini(home: &Path) -> Store {
    let tmp = home.join(".gemini/tmp");
    let project = tmp.join("projhash");
    let session = project.join("chats/session-2026-10-16T01-00-abc.json");
    write_lines(
        &session,
        &[json!({
            "sessionId": "abc", "projectHash": "projhash", "kind": "main",
            "startTime": "2026-10-16T01:00:00Z", "lastUpdated": "2026-10-16T01:00:00Z",
            "messages": [
                {"id": "u1", "type": "user", "timestamp": "2026-10-16T01:00:00Z", "content": "hi"},
                {"id": "g1", "type": "gemini", "timestamp": "2026-10-16T01:00:01Z",
                 "model": "gemini-2.5-pro", "content": [{"text": "sure"}],
                 "tokens": {"input": 70, "output": 7, "cached": 0}}
            ]
        })],
    );
    Store::new(
        "gemini",
        vec![tmp, project.clone(), project.join("chats"), session],
    )
}

/// An OpenCode-core database (`opencode.db`, `kilo.db`) with one session.
fn write_opencode_core_db(path: &Path) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let conn = crate::providers::kilo::test_support::create_db(path);
    crate::providers::kilo::test_support::seed(&conn);
    crate::providers::kilo::test_support::seed_assistant_usage(&conn, 100, 50);
}

/// `~/.local/share/opencode/opencode.db`.
fn opencode(home: &Path) -> Store {
    let db = home.join(".local/share/opencode/opencode.db");
    write_opencode_core_db(&db);
    Store::new("opencode", vec![db])
}

/// `~/.local/share/kilo/kilo.db`.
fn kilo(home: &Path) -> Store {
    let db = home.join(".local/share/kilo/kilo.db");
    write_opencode_core_db(&db);
    Store::new("kilo", vec![db])
}

/// `~/.claude/projects/<project>/<session>.jsonl`.
fn claude(home: &Path) -> Store {
    let projects = home.join(".claude/projects");
    let project = projects.join("-work-app");
    let session = project.join("s1.jsonl");
    write_lines(
        &session,
        &[row("s1", "a1", "2026-10-16T09:00:00Z")
            .tokens(100, 10, 0, 0)
            .to_json()],
    );
    Store::new(
        "claude",
        vec![home.join(".claude"), projects, project, session],
    )
}

/// `~/.qwen/projects/<dir>/chats/<session>.jsonl`.
fn qwen(home: &Path) -> Store {
    let qwen = home.join(".qwen");
    let project = qwen.join("projects/-work-app");
    let session = project.join("chats/sess-q1.jsonl");
    write_lines(
        &session,
        &[
            json!({"uuid": "u1", "sessionId": "sess-q1", "timestamp": "2026-10-16T09:00:00Z",
                   "type": "user", "cwd": "/work/app",
                   "message": {"role": "user", "parts": [{"text": "hi"}]}}),
            json!({"uuid": "a1", "parentUuid": "u1", "sessionId": "sess-q1",
                   "timestamp": "2026-10-16T09:00:01Z", "type": "assistant",
                   "model": "qwen3-coder-plus",
                   "usageMetadata": {"promptTokenCount": 12, "candidatesTokenCount": 34},
                   "message": {"role": "model", "parts": [{"text": "ok"}]}}),
        ],
    );
    Store::new(
        "qwen",
        vec![
            qwen.clone(),
            qwen.join("projects"),
            project.clone(),
            project.join("chats"),
            session,
        ],
    )
}

/// `~/<dot dir>/agent/sessions/<project>/<session>.jsonl` (Pi, oh-my-pi).
fn pi_layout(home: &Path, dot_dir: &str, provider: &'static str) -> Store {
    let top = home.join(dot_dir);
    let sessions = top.join("agent/sessions");
    let project = sessions.join("--work-app--");
    let session = project.join("2026-10-16T09-00-00-000Z_s1.jsonl");
    write_lines(
        &session,
        &[
            json!({"type": "session", "version": 3, "id": "s1",
                   "timestamp": "2026-10-16T09:00:00.000Z", "cwd": "/work/app"}),
            json!({"type": "message", "id": "u1", "timestamp": "2026-10-16T09:00:01.000Z",
                   "message": {"role": "user", "content": "hi"}}),
            json!({"type": "message", "id": "a1", "parentId": "u1",
                   "timestamp": "2026-10-16T09:00:02.000Z",
                   "message": {"role": "assistant", "provider": "anthropic",
                               "model": "claude-opus-4-8",
                               "content": [{"type": "text", "text": "ok"}],
                               "usage": {"input": 12, "output": 34, "cacheRead": 0,
                                         "cacheWrite": 0, "totalTokens": 46}}}),
        ],
    );
    Store::new(
        provider,
        vec![top.clone(), top.join("agent"), sessions, project, session],
    )
}

fn pi(home: &Path) -> Store {
    pi_layout(home, ".pi", "pi")
}

fn ompi(home: &Path) -> Store {
    pi_layout(home, ".omp", "ompi")
}

/// `~/.grok/sessions/<encoded cwd>/<session>/{summary.json,chat_history.jsonl}`.
fn grok(home: &Path) -> Store {
    let top = home.join(".grok");
    let project = top.join("sessions/%2Fwork%2Fapp");
    let session = project.join("019fa555-791c-71e2-8c92-ff2e6fa26d6e");
    let summary = session.join("summary.json");
    let chat = session.join("chat_history.jsonl");
    write_lines(
        &summary,
        &[json!({
            "info": {"id": "019fa555-791c-71e2-8c92-ff2e6fa26d6e", "cwd": "/work/app"},
            "session_summary": "Demo", "created_at": "2026-10-16T09:00:00Z",
            "updated_at": "2026-10-16T09:01:00Z", "num_chat_messages": 2,
            "current_model_id": "grok-4.5"
        })],
    );
    write_lines(
        &chat,
        &[
            json!({"type": "user", "content": [{"type": "text", "text": "hi"}]}),
            json!({"type": "assistant", "content": "ok", "model_id": "grok-4.5"}),
        ],
    );
    Store::new(
        "grok",
        vec![
            top.clone(),
            top.join("sessions"),
            project,
            session,
            summary,
            chat,
        ],
    )
}

/// The old Kimi CLI: `~/.kimi/sessions/<project>/<session>/context.jsonl`.
fn kimi(home: &Path) -> Store {
    let top = home.join(".kimi");
    let project = top.join("sessions/proj-hash");
    let session = project.join("sess-k1");
    let context = session.join("context.jsonl");
    write_lines(
        &context,
        &[
            json!({"role": "user", "content": "hi"}),
            json!({"role": "assistant", "content": "ok"}),
        ],
    );
    write_lines(
        &session.join("wire.jsonl"),
        &[json!({"timestamp": 1_760_605_200.0})],
    );
    Store::new(
        "kimi",
        vec![top.clone(), top.join("sessions"), project, session, context],
    )
}

/// kimi-code, also the `kimi` provider:
/// `~/.kimi-code/sessions/wd_*/session_*/agents/main/wire.jsonl`.
fn kimi_code(home: &Path) -> Store {
    let top = home.join(".kimi-code");
    let workspace = top.join("sessions/wd_demo");
    let session = workspace.join("session_one");
    let wire = session.join("agents/main/wire.jsonl");
    write_lines(
        &wire,
        &[json!({"type": "context.append_message",
                 "message": {"role": "user", "content": [{"type": "text", "text": "hi"}],
                             "toolCalls": [], "origin": {"kind": "user"},
                             "id": "session_one_u1"},
                 "time": 1_786_959_458_516_u64})],
    );
    Store::new(
        "kimi",
        vec![
            top.clone(),
            top.join("sessions"),
            workspace,
            session.clone(),
            session.join("agents"),
            session.join("agents/main"),
            wire,
        ],
    )
}

/// Cline's VS Code extension directory: `state/taskHistory.json` lists the
/// tasks, `tasks/<id>/ui_messages.json` holds each one.
fn cline(home: &Path) -> Store {
    let global = crate::utils::config_dir()
        .unwrap()
        .join("Code/User/globalStorage");
    let ext = global.join("saoudrizwan.claude-dev");
    let history = ext.join("state/taskHistory.json");
    write_lines(
        &history,
        &[
            json!([{"id": "task-1", "ts": 1_760_605_200_000_u64, "task": "hi",
                  "tokensIn": 100, "tokensOut": 50,
                  "cwdOnTaskInitialization": "/work/app"}]),
        ],
    );
    let task = ext.join("tasks/task-1");
    let messages = task.join("ui_messages.json");
    write_lines(
        &messages,
        &[json!([{"type": "say", "say": "text", "text": "hello",
                  "ts": 1_760_605_200_000_u64}])],
    );
    assert!(global.starts_with(home));
    Store::new(
        "cline",
        vec![
            global,
            ext.clone(),
            ext.join("state"),
            history,
            ext.join("tasks"),
            task,
            messages,
        ],
    )
}

/// Copilot CLI: `~/.copilot/session-state/<id>/events.jsonl`.
fn copilot_cli(home: &Path) -> Store {
    let top = home.join(".copilot");
    let session = top.join("session-state/11111111-1111-1111-1111-111111111111");
    let events = session.join("events.jsonl");
    write_lines(
        &events,
        &[
            json!({"type": "session.start",
                   "data": {"sessionId": "11111111-1111-1111-1111-111111111111",
                            "context": {"cwd": "/work/app"}},
                   "timestamp": "2026-10-16T09:00:00.000Z"}),
            json!({"type": "user.message", "data": {"content": "hi"},
                   "timestamp": "2026-10-16T09:00:01.000Z"}),
        ],
    );
    Store::new(
        "copilot",
        vec![top.clone(), top.join("session-state"), session, events],
    )
}

/// VS Code Copilot Chat, also the `copilot` provider:
/// `<user data>/workspaceStorage/<hash>/chatSessions/<session>.json`.
fn copilot_vscode(home: &Path) -> Store {
    let user = if cfg!(target_os = "macos") {
        home.join("Library/Application Support/Code/User")
    } else {
        home.join(".config/Code/User")
    };
    let workspace = user.join("workspaceStorage/abc123");
    let folder = workspace.join("workspace.json");
    write_lines(&folder, &[json!({"folder": "file:///work/app"})]);
    let session = workspace.join("chatSessions/vs-1.json");
    write_lines(
        &session,
        &[
            json!({"sessionId": "vs-1", "creationDate": 1_760_605_200_000_u64,
                 "requests": [{"message": {"text": "hi"},
                               "response": [{"value": "ok"}]}]}),
        ],
    );
    Store::new(
        "copilot",
        vec![
            user.clone(),
            user.join("workspaceStorage"),
            workspace.clone(),
            folder,
            workspace.join("chatSessions"),
            session,
        ],
    )
}

/// Antigravity's rpc cache:
/// `~/.gemini/antigravity/.token-monitor/rpc-cache/v1/<session>/usage.jsonl`.
fn antigravity(home: &Path) -> Store {
    let root = home.join(".gemini/antigravity");
    let monitor = root.join(".token-monitor");
    let cache = monitor.join("rpc-cache/v1");
    let session = cache.join("sess-a1");
    let usage = session.join("usage.jsonl");
    write_lines(
        &usage,
        &[
            json!({"recordType": "usage", "sequence": 1, "model": "gemini-3-pro-high",
                 "inputTokens": 100, "outputTokens": 200,
                 "raw": {"chatModel": {"chatStartMetadata":
                                       {"createdAt": "2026-10-16T09:00:00Z"}}}}),
        ],
    );
    Store::new(
        "antigravity",
        vec![
            root,
            monitor.clone(),
            monitor.join("rpc-cache"),
            cache,
            session,
            usage,
        ],
    )
}

/// `~/.forge/.forge.db`.
fn forgecode(home: &Path) -> Store {
    let top = home.join(".forge");
    let db = top.join(".forge.db");
    fs::create_dir_all(&top).unwrap();
    let conn = rusqlite::Connection::open(&db).unwrap();
    conn.execute_batch(
        "CREATE TABLE conversations (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
             title TEXT, context TEXT, metrics TEXT, created_at TEXT, updated_at TEXT);",
    )
    .unwrap();
    let context = json!({
        "conversation_id": "conv-1", "cwd": "/work/app",
        "messages": [
            {"Text": {"role": "user", "content": "hi", "timestamp": "2026-10-16T09:00:00Z"}},
            {"message": {"text": {"role": "Assistant", "content": "ok",
                                  "model": "forge-model-v1"}},
             "usage": {"prompt_tokens": {"actual": 120}, "completion_tokens": {"actual": 45}},
             "timestamp": "2026-10-16T09:00:01Z"}
        ]
    });
    conn.execute(
        "INSERT INTO conversations VALUES ('conv-1', 'ws-1', 'Demo', ?1, NULL,
             '2026-10-16T09:00:00Z', '2026-10-16T09:01:00Z')",
        [context.to_string()],
    )
    .unwrap();
    Store::new("forgecode", vec![top, db])
}

/// `~/.zcode/cli/db/db.sqlite`.
fn zcode(home: &Path) -> Store {
    let top = home.join(".zcode");
    let db_dir = top.join("cli/db");
    let db = db_dir.join("db.sqlite");
    fs::create_dir_all(&db_dir).unwrap();
    let conn = rusqlite::Connection::open(&db).unwrap();
    conn.execute_batch(
        "CREATE TABLE session (id text primary key, project_id text not null,
             directory text not null, title text not null,
             task_type text default 'interactive', title_source text default 'first_input',
             parent_id text, time_created integer not null, time_updated integer not null,
             time_archived integer);
         CREATE TABLE message (id text primary key, session_id text not null,
             time_created integer not null, data text not null, sequence integer);
         CREATE TABLE part (id text primary key, message_id text not null,
             session_id text not null, time_created integer not null, data text not null,
             sequence integer);
         INSERT INTO session (id, project_id, directory, title, time_created, time_updated)
             VALUES ('sess-1', 'p', '/work/app', 'hi', 1788599956241, 1788599999999);
         INSERT INTO message (id, session_id, time_created, data, sequence)
             VALUES ('m1', 'sess-1', 1788599956241,
                     '{\"role\":\"user\",\"time\":{\"created\":1788599956241}}', 0);",
    )
    .unwrap();
    Store::new("zcode", vec![top.clone(), top.join("cli"), db_dir, db])
}

/// `$LLM_USER_PATH/logs.db`.
fn llm(home: &Path) -> Store {
    let dir = home.join("llm-user");
    let db = dir.join("logs.db");
    fs::create_dir_all(&dir).unwrap();
    let conn = rusqlite::Connection::open(&db).unwrap();
    conn.execute_batch(
        "CREATE TABLE conversations (id TEXT PRIMARY KEY, name TEXT, model TEXT);
         CREATE TABLE responses (id TEXT PRIMARY KEY, model TEXT, prompt TEXT, response TEXT,
             conversation_id TEXT, datetime_utc TEXT, input_tokens INTEGER,
             output_tokens INTEGER);
         INSERT INTO conversations VALUES ('c1', 'Demo', 'gpt-4');
         INSERT INTO responses VALUES ('r1', 'gpt-4', 'hi', 'ok', 'c1',
             '2026-10-16T09:00:00', 12, 34);",
    )
    .unwrap();
    Store::new("llm", vec![dir.clone(), db]).with_env("LLM_USER_PATH", &dir)
}

/// `$CURSOR_USER_DIR/globalStorage/state.vscdb`.
fn cursor(home: &Path) -> Store {
    let user = home.join("cursor-user");
    let global = user.join("globalStorage");
    let db = global.join("state.vscdb");
    fs::create_dir_all(&global).unwrap();
    let conn = rusqlite::Connection::open(&db).unwrap();
    conn.execute_batch(
        "CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value TEXT)",
    )
    .unwrap();
    let composer = json!({
        "composerId": "comp-1", "name": "Demo", "createdAt": 1_760_605_200_000_u64,
        "lastUpdatedAt": 1_760_605_260_000_u64, "isArchived": false, "unifiedMode": "agent",
        "workspaceIdentifier": {"id": "ws-1",
                                "uri": {"fsPath": "/work/app", "path": "/work/app"}},
        "fullConversationHeadersOnly": [{"bubbleId": "b1", "type": 1}],
        "promptTokenBreakdown": {"totalUsedTokens": 9001}
    });
    conn.execute(
        "INSERT INTO cursorDiskKV (key, value) VALUES ('composerData:comp-1', ?1)",
        [composer.to_string()],
    )
    .unwrap();
    Store::new("cursor", vec![user.clone(), global, db]).with_env("CURSOR_USER_DIR", &user)
}
