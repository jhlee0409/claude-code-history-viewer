//! Provider paths, coverage, subagent folding and cache invalidation through
//! the real command (ADR 0002 §7, §9).

use super::fixture::*;
use super::sources::{parse_provider_id, reports_token_usage};
use super::*;
use crate::commands::stats::{
    all_stats_providers, get_global_stats_summary, get_project_stats_summary,
    get_project_token_stats, stats_provider_id,
};
use crate::test_utils::SandboxHome;
use serde_json::{json, Value};
use serial_test::serial;
use std::fs;
use std::path::{Path, PathBuf};

/// (id, wire status, sessions scanned, sessions failed) per provider.
fn wire_statuses(response: &UsageBreakdownResponse) -> Vec<(String, String, u64, u64)> {
    response
        .coverage
        .providers
        .iter()
        .map(|p| {
            let status = serde_json::to_value(p.status).unwrap();
            (
                p.id.clone(),
                status.as_str().unwrap().to_string(),
                p.sessions_scanned,
                p.sessions_failed,
            )
        })
        .collect()
}

fn supported_provider_ids() -> Vec<&'static str> {
    let mut ids: Vec<&str> = all_stats_providers()
        .into_iter()
        .filter(|p| reports_token_usage(*p))
        .map(stats_provider_id)
        .collect();
    ids.sort_unstable();
    ids
}

fn days() -> Vec<UsageInterval> {
    vec![
        interval("2026-10-15", "2026-10-15T00:00:00Z", "2026-10-16T00:00:00Z"),
        interval("2026-10-16", "2026-10-16T00:00:00Z", "2026-10-17T00:00:00Z"),
        interval("2026-10-17", "2026-10-17T00:00:00Z", "2026-10-18T00:00:00Z"),
    ]
}

fn project_request(provider: &str, project_path: String) -> UsageBreakdownRequest {
    UsageBreakdownRequest {
        scope: UsageScope::Project {
            project_path,
            provider: provider.to_string(),
        },
        stats_mode: UsageStatsMode::BillingTotal,
        intervals: days(),
    }
}

fn all_request(providers: &[&str], claude_root: &Path) -> UsageBreakdownRequest {
    UsageBreakdownRequest {
        scope: UsageScope::All {
            providers: providers.iter().map(|p| (*p).to_string()).collect(),
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

fn coverage<'a>(response: &'a UsageBreakdownResponse, id: &str) -> &'a ProviderCoverage {
    response
        .coverage
        .providers
        .iter()
        .find(|p| p.id == id)
        .unwrap_or_else(|| panic!("{id} coverage"))
}

/// A Codex home with one rollout in `cwd` carrying token usage.
fn write_codex_home(home: &Path, cwd: &str) -> PathBuf {
    let codex_home = home.join(".codex");
    let day_dir = codex_home.join("sessions/2026/10/16");
    fs::create_dir_all(&day_dir).unwrap();
    let lines = [
        json!({"timestamp": "2026-10-16T09:00:00Z", "type": "session_meta",
               "payload": {"id": "codex-s1", "cwd": cwd}}),
        json!({"timestamp": "2026-10-16T09:00:01Z", "type": "turn_context",
               "payload": {"model": "gpt-5-codex", "cwd": cwd}}),
        json!({"timestamp": "2026-10-16T09:00:02Z", "type": "response_item",
               "payload": {"type": "message", "role": "user",
                           "content": [{"type": "input_text", "text": "hi"}]}}),
        json!({"timestamp": "2026-10-16T09:00:03Z", "type": "response_item",
               "payload": {"type": "message", "role": "assistant",
                           "content": [{"type": "output_text", "text": "done"}]}}),
        json!({"timestamp": "2026-10-16T09:00:04Z", "type": "event_msg",
               "payload": {"type": "token_count", "info": {"total_token_usage":
                           {"input_tokens": 1200, "cached_input_tokens": 200, "output_tokens": 80}}}}),
    ];
    let body: String = lines.iter().map(|l| l.to_string() + "\n").collect();
    fs::write(
        day_dir.join("rollout-2026-10-16T09-00-00-codex-s1.jsonl"),
        body,
    )
    .unwrap();
    codex_home
}

#[test]
fn every_provider_is_classified_and_the_unsupported_set_is_pinned() {
    let mut unsupported: Vec<&str> = all_stats_providers()
        .into_iter()
        .filter(|p| !reports_token_usage(*p))
        .map(stats_provider_id)
        .collect();
    unsupported.sort_unstable();
    assert_eq!(
        unsupported,
        [
            "aider",
            "amazonq",
            "codebuddy",
            "continue",
            "crush",
            "cursor-agent",
            "goose",
            "kiro",
            "openhands",
            "pearai",
            "trae",
            "vibe",
            "zed"
        ]
    );
    for provider in all_stats_providers() {
        assert_eq!(parse_provider_id(stats_provider_id(provider)), Ok(provider));
    }
}

#[tokio::test]
#[serial]
async fn unknown_provider_and_mismatched_project_are_request_errors() {
    let _home = SandboxHome::new();
    let err = get_usage_breakdown(project_request("nope", "/tmp/p".to_string()))
        .await
        .unwrap_err();
    assert_eq!(err, "usage breakdown: unknown provider 'nope'");

    let err = get_usage_breakdown(project_request("claude", "codex:///work/app".to_string()))
        .await
        .unwrap_err();
    assert!(err.contains("belongs to provider 'codex'"), "{err}");

    let mut request = all_request(&["claude", "bogus"], Path::new("/tmp"));
    request.stats_mode = UsageStatsMode::BillingTotal;
    assert!(get_usage_breakdown(request).await.is_err());
}

#[tokio::test]
#[serial]
async fn codex_virtual_path_project_matches_legacy_summary() {
    let home = SandboxHome::new();
    let codex_home = write_codex_home(home.path(), "/work/app");
    let _codex = EnvGuard::set("CODEX_HOME", &codex_home);

    let project_path = "codex:///work/app".to_string();
    let legacy = get_project_stats_summary(project_path.clone(), None, None, None)
        .await
        .expect("legacy codex summary");
    assert!(legacy.total_tokens > 0, "fixture carries usage");

    let response = get_usage_breakdown(project_request("codex", project_path.clone()))
        .await
        .expect("breakdown");
    assert_eq!(total_tokens(&response), legacy.total_tokens);
    let codex = coverage(&response, "codex");
    assert_eq!(codex.status, ProviderScanStatus::Scanned);
    assert_eq!((codex.sessions_scanned, codex.sessions_failed), (1, 0));
    assert!(!codex.sidechain_metadata);
    assert_eq!(codex.source_cost, SourceCostCoverage::None);

    let session = &response.sessions[0];
    assert_eq!(session.session_ref.provider, "codex");
    assert_eq!(session.session_ref.project_path, project_path);
    assert!(session.models.iter().all(|m| {
        m.pricing_source == PricingSource::Estimate
            && m.stats.cost_usd.is_none()
            && m.stats.provider_id.as_deref() == Some("codex")
    }));
}

#[tokio::test]
#[serial]
async fn all_scope_reports_each_provider_and_matches_legacy_global_total() {
    let home = SandboxHome::new();
    let claude = UsageFixture::write(
        "p1",
        vec![row("s1", "a1", "2026-10-15T12:00:00Z").tokens(100, 10, 0, 0)],
    );
    let codex_home = write_codex_home(home.path(), "/work/app");
    let _codex = EnvGuard::set("CODEX_HOME", &codex_home);

    let providers = ["claude", "codex", "aider"];
    let legacy = get_global_stats_summary(
        claude.root().to_string_lossy().to_string(),
        Some(providers.iter().map(|p| (*p).to_string()).collect()),
        Some("billing_total".to_string()),
        None,
        None,
        None,
    )
    .await
    .expect("legacy global");
    let response = get_usage_breakdown(all_request(&providers, claude.root()))
        .await
        .expect("breakdown");
    assert_eq!(total_tokens(&response), legacy.total_tokens);

    let ids: Vec<_> = response
        .coverage
        .providers
        .iter()
        .map(|p| p.id.as_str())
        .collect();
    assert_eq!(ids, providers, "request order");
    assert_eq!(
        coverage(&response, "claude").status,
        ProviderScanStatus::Scanned
    );
    assert_eq!(
        coverage(&response, "codex").status,
        ProviderScanStatus::Scanned
    );
    let aider = coverage(&response, "aider");
    assert_eq!(aider.status, ProviderScanStatus::NotSupported);
    assert_eq!(aider.sessions_scanned, 0);
}

/// The legacy scanners answer `Ok([])` both for an empty store and for no
/// store at all, so availability is decided before they run: every
/// supported provider whose store is not on disk is `not_found`, never a
/// `scanned` zero (`AN0b` review P2).
#[tokio::test]
#[serial]
async fn every_supported_provider_without_a_store_is_not_found() {
    let home = SandboxHome::new();
    let _env = without_store_env();
    let supported = supported_provider_ids();
    assert_eq!(supported.len(), 18);

    let response = get_usage_breakdown(all_request(&supported, &home.path().join(".claude")))
        .await
        .expect("breakdown");
    let expected: Vec<(String, String, u64, u64)> = supported
        .iter()
        .map(|id| ((*id).to_string(), "not_found".to_string(), 0, 0))
        .collect();
    assert_eq!(wire_statuses(&response), expected);
    assert_eq!(total_tokens(&response), 0);
}

#[tokio::test]
#[serial]
async fn a_missing_store_or_project_is_not_found_and_never_zero_usage() {
    let home = SandboxHome::new();
    let claude = UsageFixture::write(
        "p1",
        vec![row("s1", "a1", "2026-10-15T12:00:00Z").tokens(100, 0, 0, 0)],
    );
    // No Codex home anywhere: CODEX_HOME points at a missing directory and
    // the sandbox has no ~/.codex.
    let _codex = EnvGuard::set("CODEX_HOME", &home.path().join("missing"));
    let response = get_usage_breakdown(all_request(&["claude", "codex"], claude.root()))
        .await
        .expect("breakdown");
    assert_eq!(
        wire_statuses(&response),
        [
            ("claude".to_string(), "scanned".to_string(), 1, 0),
            ("codex".to_string(), "not_found".to_string(), 0, 0)
        ]
    );
    assert_eq!(total_tokens(&response), 100);

    // A Claude project that is not there is not found either.
    let response = get_usage_breakdown(project_request(
        "claude",
        claude
            .root()
            .join("projects/gone")
            .to_string_lossy()
            .to_string(),
    ))
    .await
    .expect("breakdown");
    assert_eq!(
        wire_statuses(&response),
        [("claude".to_string(), "not_found".to_string(), 0, 0)]
    );
}

/// A store that is there but cannot be listed is `unreadable`, not a
/// `scanned` zero and not `not_found` (Pi keeps `~/.pi/agent/sessions`).
#[cfg(unix)]
#[tokio::test]
#[serial]
async fn a_store_that_exists_but_cannot_be_read_is_unreadable() {
    let home = SandboxHome::new();
    let sessions = home.path().join(".pi/agent/sessions");
    fs::create_dir_all(sessions.join("--work-app--")).unwrap();
    let Some(_unreadable) = Unreadable::new(&sessions) else {
        return;
    };
    let response = get_usage_breakdown(all_request(&["pi"], &home.path().join(".claude")))
        .await
        .expect("breakdown");
    assert_eq!(
        wire_statuses(&response),
        [("pi".to_string(), "unreadable".to_string(), 0, 0)]
    );
}

/// The other side of the line: a store that exists and holds nothing was
/// read, so it is `scanned` with zero sessions, not `not_found`.
#[tokio::test]
#[serial]
async fn an_empty_store_that_exists_is_scanned() {
    let home = SandboxHome::new();
    let _gemini = EnvGuard::remove("GEMINI_HOME");
    fs::create_dir_all(home.path().join(".gemini/tmp")).unwrap();
    let response = get_usage_breakdown(all_request(&["gemini"], &home.path().join(".claude")))
        .await
        .expect("breakdown");
    assert_eq!(
        wire_statuses(&response),
        [("gemini".to_string(), "scanned".to_string(), 0, 0)]
    );
}

/// 2026-10-16T09:00:00Z, inside [`days`].
const CLINE_TS_MS: u64 = 1_792_141_200_000;

/// A task of Cline's VS Code extension in `cwd`. It lists its
/// `tasks/<id>/ui_messages.json` as its file; its session id is
/// `cline://<extension dir>:<id>`.
fn write_cline_task(home: &Path, cwd: &str) {
    let ext = crate::utils::config_dir()
        .unwrap()
        .join("Code/User/globalStorage/saoudrizwan.claude-dev");
    assert!(ext.starts_with(home), "{}", ext.display());
    let history = json!([{"id": "task-1", "ts": CLINE_TS_MS, "task": "hi",
                          "tokensIn": 100, "tokensOut": 50,
                          "cwdOnTaskInitialization": cwd}]);
    fs::create_dir_all(ext.join("state")).unwrap();
    fs::write(ext.join("state/taskHistory.json"), history.to_string()).unwrap();
    let messages = json!([
        {"type": "say", "say": "task", "text": "hi", "ts": CLINE_TS_MS},
        {"type": "say", "say": "text", "text": "hello", "ts": CLINE_TS_MS + 1_000}
    ]);
    fs::create_dir_all(ext.join("tasks/task-1")).unwrap();
    fs::write(
        ext.join("tasks/task-1/ui_messages.json"),
        messages.to_string(),
    )
    .unwrap();
}

/// A session of Cline's SDK store (`~/.cline/data/sessions/<id>/`) in `cwd`
/// whose reply carries usage (21 in, 8 out, 3 cache read, 1 cache write).
/// It lists its `<id>.messages.json` as its file; its session id is
/// `cline://sdk:<id>`.
fn write_cline_sdk_session(home: &Path, cwd: &str) {
    let id = "1792141200000_sdk01";
    let dir = home.join(".cline/data/sessions").join(id);
    fs::create_dir_all(&dir).unwrap();
    let manifest = json!({"version": 1, "session_id": id, "cwd": cwd,
                          "started_at": "2026-10-16T09:00:00.000Z",
                          "ended_at": "2026-10-16T09:00:02.000Z",
                          "metadata": {"title": "Demo"}});
    fs::write(dir.join(format!("{id}.json")), manifest.to_string()).unwrap();
    let transcript = json!({"version": 1, "agent": "lead", "sessionId": id, "messages": [
        {"id": "u1", "role": "user", "content": [{"type": "text", "text": "hi"}]},
        {"id": "a1", "role": "assistant", "ts": CLINE_TS_MS + 2_000,
         "modelInfo": {"id": "claude-sonnet-4-6", "provider": "anthropic"},
         "metrics": {"inputTokens": 21, "outputTokens": 8, "cacheReadTokens": 3,
                     "cacheWriteTokens": 1, "cost": 0.13},
         "content": [{"type": "text", "text": "ok"}]}
    ]});
    fs::write(
        dir.join(format!("{id}.messages.json")),
        transcript.to_string(),
    )
    .unwrap();
}

/// A Cline session is loaded by its `cline://` session id (`AN0b` review):
/// the file it lists is not a path the Cline loader takes, so loading by
/// it failed every Cline session and dropped its usage.
#[tokio::test]
#[serial]
async fn cline_sessions_load_by_their_session_id() {
    let home = SandboxHome::new();
    let _env = without_store_env();
    write_cline_task(home.path(), "/work/app");
    write_cline_sdk_session(home.path(), "/work/app");

    let response = get_usage_breakdown(all_request(&["cline"], &home.path().join(".claude")))
        .await
        .expect("breakdown");
    assert_eq!(
        (wire_statuses(&response), total_tokens(&response)),
        (vec![("cline".to_string(), "scanned".to_string(), 2, 0)], 33)
    );
}

fn write_rows(path: &Path, rows: &[FixtureRow]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let body: String = rows
        .iter()
        .map(|r| r.to_json().to_string() + "\n")
        .collect();
    fs::write(path, body).unwrap();
}

#[tokio::test]
#[serial]
async fn subagent_transcripts_fold_into_their_session_like_legacy() {
    let _home = SandboxHome::new();
    let fixture = UsageFixture::write(
        "folding",
        vec![row("s1", "main", "2026-10-15T12:00:00Z").tokens(100, 10, 0, 0)],
    );
    let project = PathBuf::from(fixture.project_path());
    write_rows(
        &project.join("s1/subagents/agent-a.jsonl"),
        &[row("agent-a", "sub", "2026-10-15T12:05:00Z")
            .session("s1")
            .sidechain()
            .tokens(40, 4, 0, 0)],
    );

    for mode in [
        UsageStatsMode::BillingTotal,
        UsageStatsMode::ConversationOnly,
    ] {
        let mode_name = serde_json::to_value(mode).unwrap();
        let mode_name = mode_name.as_str().unwrap().to_string();
        let legacy =
            get_project_stats_summary(fixture.project_path(), None, None, Some(mode_name.clone()))
                .await
                .unwrap();
        let pages = get_project_token_stats(
            fixture.project_path(),
            Some(0),
            Some(100),
            None,
            None,
            Some(mode_name.clone()),
        )
        .await
        .unwrap();
        let mut request = project_request("claude", fixture.project_path());
        request.stats_mode = mode;
        let response = get_usage_breakdown(request).await.unwrap();

        assert_eq!(total_tokens(&response), legacy.total_tokens, "{mode_name}");
        assert_eq!(response.sessions.len(), 1, "{mode_name}: one session");
        assert_eq!(pages.items.len(), 1, "{mode_name}");
        let session_tokens: u64 = response.sessions[0]
            .models
            .iter()
            .map(|m| m.stats.token_count)
            .sum();
        assert_eq!(session_tokens, pages.items[0].total_tokens, "{mode_name}");
        assert_eq!(response.sessions[0].session_ref.session_id, "s1");
    }
}

#[tokio::test]
#[serial]
async fn a_changed_session_file_is_read_again() {
    let _home = SandboxHome::new();
    let fixture = UsageFixture::write(
        "cache-change",
        vec![row("s1", "a1", "2026-10-15T12:00:00Z").tokens(100, 0, 0, 0)],
    );
    let request = || project_request("claude", fixture.project_path());
    let first = get_usage_breakdown(request()).await.unwrap();
    let warm = get_usage_breakdown(request()).await.unwrap();
    assert_eq!(
        serde_json::to_value(&first).unwrap(),
        serde_json::to_value(&warm).unwrap(),
        "a warm request returns the same answer"
    );

    let path = Path::new(&fixture.project_path()).join("s1.jsonl");
    let mut body = fs::read_to_string(&path).unwrap();
    body.push_str(&format!(
        "{}\n",
        row("s1", "a2", "2026-10-16T12:00:00Z")
            .tokens(7, 0, 0, 0)
            .to_json()
    ));
    fs::write(&path, body).unwrap();
    let after = get_usage_breakdown(request()).await.unwrap();
    assert_eq!(total_tokens(&after), 107);
    assert_eq!(after.intervals[1].message_count, 1);
}

#[tokio::test]
#[serial]
async fn interval_and_session_counts_cover_rows_without_usage() {
    let _home = SandboxHome::new();
    let fixture = UsageFixture::write(
        "counts",
        vec![
            row("s1", "a1", "2026-10-15T12:00:00Z").tokens(100, 0, 0, 0),
            row("s2", "b1", "2026-10-15T13:00:00Z").tokens(5, 0, 0, 0),
            row("s2", "b2", "2026-10-16T13:00:00Z").tokens(5, 0, 0, 0),
        ],
    );
    // A user prompt: counted as a message, in no model bucket.
    let user = json!({"type": "user", "sessionId": "s1", "uuid": "u1",
                      "timestamp": "2026-10-15T11:59:00Z",
                      "message": {"role": "user", "content": "hello"}});
    let path = Path::new(&fixture.project_path()).join("s1.jsonl");
    let body = fs::read_to_string(&path).unwrap();
    fs::write(&path, format!("{user}\n{body}")).unwrap();

    let response = get_usage_breakdown(project_request("claude", fixture.project_path()))
        .await
        .unwrap();
    let day = &response.intervals[0];
    assert_eq!((day.message_count, day.session_count), (3, 2));
    assert_eq!(
        day.models
            .iter()
            .map(|m| m.stats.message_count)
            .sum::<u32>(),
        2
    );
    assert_eq!(
        (
            response.intervals[1].message_count,
            response.intervals[1].session_count
        ),
        (1, 1)
    );
    let s1 = response
        .sessions
        .iter()
        .find(|s| s.session_ref.session_id == "s1")
        .unwrap();
    assert_eq!(s1.message_count, 2);
    assert_eq!(s1.first_ts, ms("2026-10-15T11:59:00Z"));
    assert_eq!(s1.last_ts, ms("2026-10-15T12:00:00Z"));
    // Largest session first.
    assert_eq!(response.sessions[0].session_ref.session_id, "s1");
    let wire: Value = serde_json::to_value(&response).unwrap();
    assert!(wire["sessions"][0]["ref"]["file_path"]
        .as_str()
        .unwrap()
        .ends_with("s1.jsonl"));
}
