//! Budget measurement (ADR 0002 §10) on the reference fixture: 25 projects
//! and a synthetic 90-day, 50,000-message Claude history.
//!
//! Ignored by default (each run writes ~50 MB). Run in release for the
//! numbers the ADR budgets refer to:
//!
//! ```text
//! cargo test --release --lib perf_budget -- --ignored --nocapture --test-threads=1
//! ```
//!
//! Three runs: the reference fixture (one model per session) and the same
//! history with every session mixing two and three models, whose session
//! rows are the largest the cap has to bound (ADR 0003 §6). Time and memory
//! budgets are asserted only in release builds; a debug run prints the same
//! table for information. The response size does not depend on the build and
//! is asserted in every run.

use super::contribution_cache::contribution_cache;
use super::*;
use crate::commands::stats::get_global_stats_summary;
use crate::test_utils::SandboxHome;
use serde_json::json;
use serial_test::serial;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::time::{Duration, Instant};

const PROJECTS: usize = 25;
const DAYS: i64 = 90;
const MESSAGES: usize = 50_000;
/// Rows per session (half prompts, half assistant rows); override with
/// `CCHV_PERF_ROWS_PER_SESSION` to see how the response grows with sessions.
const DEFAULT_ROWS_PER_SESSION: usize = 50;

fn rows_per_session() -> usize {
    std::env::var("CCHV_PERF_ROWS_PER_SESSION")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|n: &usize| *n >= 2 && n % 2 == 0)
        .unwrap_or(DEFAULT_ROWS_PER_SESSION)
}

const DAY_MS: i64 = 86_400_000;
/// 2026-07-21T00:00:00+09:00 — the first local (KST) day of the fixture.
const FIRST_DAY_START_MS: i64 = 1_784_559_600_000;

const MODELS: [&str; 3] = [
    "claude-sonnet-4-5-20250929",
    "claude-haiku-5-5",
    "claude-opus-5-5",
];

/// Deterministic xorshift, so every run writes the same history.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

fn rfc3339(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .expect("in range")
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Writes the history, every session mixing `models_per_session` models (a
/// main model plus small ones); returns the number of rows written.
fn write_history(root: &Path, models_per_session: usize) -> usize {
    assert!((1..=MODELS.len()).contains(&models_per_session));
    let mut rng = Rng(0x5eed_cafe);
    let filler = "lorem ipsum dolor sit amet ".repeat(24); // ~650 bytes of text
    let rows_per_session = rows_per_session();
    let sessions = MESSAGES / rows_per_session;
    let mut rows = 0;
    for s in 0..sessions {
        let project = root
            .join("projects")
            .join(format!("-work-project-{:02}", s % PROJECTS));
        fs::create_dir_all(&project).unwrap();
        let session_id = format!("{s:08x}-0000-4000-8000-000000000000");
        let day = i64::try_from(s).unwrap() * DAYS / i64::try_from(sessions).unwrap();
        let mut ts =
            FIRST_DAY_START_MS + day * DAY_MS + i64::try_from(rng.below(12 * 3_600_000)).unwrap();
        let mut file = std::io::BufWriter::new(
            fs::File::create(project.join(format!("{session_id}.jsonl"))).unwrap(),
        );
        for turn in 0..rows_per_session / 2 {
            let model = MODELS[(s + turn % models_per_session) % MODELS.len()];
            ts += i64::try_from(10_000 + rng.below(120_000)).unwrap();
            let user = json!({
                "type": "user", "sessionId": session_id, "uuid": format!("{s}-u{turn}"),
                "timestamp": rfc3339(ts), "isSidechain": false,
                "message": {"role": "user", "content": format!("question {turn}: {filler}")}
            });
            ts += i64::try_from(2_000 + rng.below(30_000)).unwrap();
            let mut assistant = json!({
                "type": "assistant", "sessionId": session_id, "uuid": format!("{s}-a{turn}"),
                "timestamp": rfc3339(ts), "isSidechain": false,
                "message": {
                    "id": format!("msg_{s}_{turn}"), "role": "assistant", "model": model,
                    "content": [
                        {"type": "text", "text": filler},
                        {"type": "tool_use", "id": format!("tu_{s}_{turn}"), "name": "Read",
                         "input": {"file_path": "/work/src/main.rs"}}
                    ],
                    "usage": {
                        "input_tokens": 1_000 + rng.below(20_000),
                        "output_tokens": 50 + rng.below(2_000),
                        "cache_creation_input_tokens": rng.below(5_000),
                        "cache_read_input_tokens": rng.below(150_000),
                        "service_tier": "standard"
                    }
                }
            });
            if rng.below(5) == 0 {
                assistant["costUSD"] = json!(0.001 * rng.below(100) as f64);
            }
            writeln!(file, "{user}").unwrap();
            writeln!(file, "{assistant}").unwrap();
            rows += 2;
        }
    }
    rows
}

fn kst_days() -> Vec<UsageInterval> {
    (0..DAYS)
        .map(|d| UsageInterval {
            key: format!("day-{d:02}"),
            start_utc: FIRST_DAY_START_MS + d * DAY_MS,
            end_utc: FIRST_DAY_START_MS + (d + 1) * DAY_MS,
        })
        .collect()
}

fn median(mut samples: Vec<Duration>) -> Duration {
    samples.sort();
    samples[samples.len() / 2]
}

#[tokio::test]
#[serial]
#[ignore = "perf: writes ~50 MB; run with --release --ignored --nocapture"]
async fn perf_budget_on_reference_fixture() {
    budget_run(1).await;
}

/// Every session mixes two models.
#[tokio::test]
#[serial]
#[ignore = "perf: writes ~50 MB; run with --release --ignored --nocapture"]
async fn perf_budget_with_two_models_per_session() {
    budget_run(2).await;
}

/// Every session mixes three models: the size gate that decided
/// `MAX_SESSIONS` (ADR 0003 §6). At a cap of 250 this response was
/// 1,236.8 KiB, over the budget.
#[tokio::test]
#[serial]
#[ignore = "perf: writes ~50 MB; run with --release --ignored --nocapture"]
async fn perf_budget_with_three_models_per_session() {
    budget_run(3).await;
}

/// One measured run; asserts the budgets (size always, time and memory in
/// release builds).
async fn budget_run(models_per_session: usize) {
    let home = SandboxHome::new();
    let root = home.path().join(".claude");
    let rows = write_history(&root, models_per_session);
    let bytes_on_disk: u64 = walkdir::WalkDir::new(&root)
        .into_iter()
        .filter_map(Result::ok)
        .filter_map(|e| e.metadata().ok())
        .filter(std::fs::Metadata::is_file)
        .map(|m| m.len())
        .sum();
    let request = UsageBreakdownRequest {
        scope: UsageScope::All {
            providers: vec!["claude".to_string()],
            claude_path: root.to_string_lossy().to_string(),
            custom_claude_paths: Vec::new(),
        },
        stats_mode: UsageStatsMode::BillingTotal,
        intervals: kst_days(),
    };

    contribution_cache().clear();
    let started = Instant::now();
    let cold_response = get_usage_breakdown(request.clone()).await.expect("cold");
    let cold = started.elapsed();

    let mut warm_samples = Vec::new();
    for _ in 0..5 {
        let started = Instant::now();
        let response = get_usage_breakdown(request.clone()).await.expect("warm");
        warm_samples.push(started.elapsed());
        assert_eq!(response.intervals.len(), cold_response.intervals.len());
    }
    let warm = median(warm_samples);
    let cache = contribution_cache().usage();
    let response_bytes = serde_json::to_vec(&cold_response).unwrap().len();
    let intervals_bytes = serde_json::to_vec(&cold_response.intervals).unwrap().len();
    let sessions_bytes = serde_json::to_vec(&cold_response.sessions).unwrap().len();
    let remainder_bytes = serde_json::to_vec(&cold_response.session_remainder)
        .unwrap()
        .len();
    let interval_buckets: usize = cold_response.intervals.iter().map(|i| i.models.len()).sum();
    let session_buckets: usize = cold_response.sessions.iter().map(|s| s.models.len()).sum();

    // The old global summary over the same files, for reference only.
    let started = Instant::now();
    let legacy = get_global_stats_summary(
        root.to_string_lossy().to_string(),
        Some(vec!["claude".to_string()]),
        Some("billing_total".to_string()),
        None,
        None,
        None,
    )
    .await
    .expect("legacy");
    let legacy_time = started.elapsed();

    let tokens: u64 = cold_response
        .intervals
        .iter()
        .flat_map(|i| &i.models)
        .map(|m| m.stats.token_count)
        .sum();
    let messages: u64 = cold_response
        .intervals
        .iter()
        .map(|i| i.message_count)
        .sum();

    let build = if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    };
    let mib = |bytes: usize| bytes as f64 / 1_048_576.0;
    let kib = |bytes: usize| bytes as f64 / 1024.0;
    let ms = |d: Duration| d.as_secs_f64() * 1e3;
    let verdict = |ok: bool| if ok { "within" } else { "OVER" };
    let cold_ok = cold <= Duration::from_secs(3);
    let warm_ok = warm <= Duration::from_millis(300);
    let cache_ok = cache.bytes <= 64 * 1024 * 1024;
    let response_ok = response_bytes <= 1024 * 1024;
    println!(
        "usage-breakdown perf ({build}): {PROJECTS} projects, {DAYS} KST days, {rows} rows, {} sessions ({} model(s) each), {:.1} MiB on disk",
        cold_response.sessions.len() as u64 + cold_response.session_remainder.session_count,
        models_per_session,
        mib(usize::try_from(bytes_on_disk).unwrap_or(usize::MAX))
    );
    println!("| Measure | Result | Budget | |");
    println!("|---|---|---|---|");
    println!(
        "| Cold request (empty contribution cache) | {:.0} ms | ≤ 3000 ms | {} |",
        ms(cold),
        verdict(cold_ok)
    );
    println!(
        "| Warm request (median of 5) | {:.1} ms | ≤ 300 ms | {} |",
        ms(warm),
        verdict(warm_ok)
    );
    println!(
        "| Contribution cache | {:.2} MiB ({} files) | ≤ 64 MiB | {} |",
        mib(cache.bytes),
        cache.entries,
        verdict(cache_ok)
    );
    println!(
        "| Response size | {:.1} KiB | ≤ 1024 KiB | {} |",
        kib(response_bytes),
        verdict(response_ok)
    );
    println!(
        "| · intervals | {:.1} KiB ({interval_buckets} buckets) | | |",
        kib(intervals_bytes)
    );
    println!(
        "| · sessions | {:.1} KiB ({} listed, {session_buckets} buckets) | | |",
        kib(sessions_bytes),
        cold_response.sessions.len()
    );
    println!(
        "| · session_remainder | {:.1} KiB ({} sessions, {} buckets) | | |",
        kib(remainder_bytes),
        cold_response.session_remainder.session_count,
        cold_response.session_remainder.models.len()
    );
    println!(
        "| (reference) old get_global_stats_summary, cold | {:.0} ms | | |",
        ms(legacy_time)
    );
    println!(
        "tokens: new {tokens} / old {}; messages in intervals: {messages}",
        legacy.total_tokens
    );

    assert_eq!(
        messages, rows as u64,
        "every row lies in the 90 requested days"
    );
    assert_eq!(
        tokens, legacy.total_tokens,
        "same population as the old summary"
    );
    // The response size is deterministic, so it is asserted in every build
    // (ADR 0003 caps `sessions`); time and memory only in release builds.
    assert!(response_ok, "response {response_bytes} B over 1 MiB");
    if !cfg!(debug_assertions) {
        assert!(cold_ok, "cold {cold:?}");
        assert!(warm_ok, "warm {warm:?}");
        assert!(cache_ok, "cache {} B", cache.bytes);
    }
}
