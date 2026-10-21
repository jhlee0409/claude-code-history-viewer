//! Cross-language reconciliation fixture (ADR 0002 §8, plan task `AN0b`).
//!
//! Runs the real command on small fixtures and pins the responses in
//! `src/test/fixtures/usageBreakdown.reconciliation.json`, which the
//! TypeScript tests price with the existing `calculateGlobalCostSummary`
//! and compare with `localDayIntervals`. Every scenario also records the
//! backend's ranking cost of each listed session (ADR 0003), which the
//! TypeScript test compares with `summarizeBucketCost`; `session_cap` runs
//! the same pipeline under a cap of 3 to show a cut. A change in the
//! command's output fails here first; regenerate deliberately with
//! `CCHV_UPDATE_GOLDEN=1 cargo test golden -- --test-threads=1`.

use super::fixture::*;
use super::*;
use crate::commands::stats::get_project_stats_summary;
use crate::test_utils::SandboxHome;
use serde_json::{json, Value};
use serial_test::serial;
use std::path::PathBuf;

fn golden_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../src/test/fixtures/usageBreakdown.reconciliation.json")
}

/// Replace the temporary root in every string so the file is stable, and
/// record a path under the root with `/` separators, so the file is the same
/// on Windows (`<root>\projects\p` there).
fn normalize(value: Value, root: &str) -> Value {
    match value {
        Value::String(s) if s.contains(root) => {
            Value::String(s.replace(root, "<root>").replace('\\', "/"))
        }
        Value::Array(items) => {
            Value::Array(items.into_iter().map(|v| normalize(v, root)).collect())
        }
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(k, v)| (k, normalize(v, root)))
                .collect(),
        ),
        other => other,
    }
}

/// The backend's ranking cost of each listed session, in order.
fn ranking_costs(response: &UsageBreakdownResponse) -> Vec<f64> {
    response
        .sessions
        .iter()
        .map(|session| super::ranking::session_cost(&session.models))
        .collect()
}

fn project_request(fixture: &UsageFixture, intervals: Vec<UsageInterval>) -> UsageBreakdownRequest {
    UsageBreakdownRequest {
        scope: UsageScope::Project {
            project_path: fixture.project_path(),
            provider: "claude".to_string(),
        },
        stats_mode: UsageStatsMode::BillingTotal,
        intervals,
    }
}

async fn scenario(name: &str, rows: Vec<FixtureRow>, intervals: Vec<UsageInterval>) -> Value {
    let fixture = UsageFixture::write(name, rows);
    let request = project_request(&fixture, intervals);
    let response = get_usage_breakdown(request.clone())
        .await
        .unwrap_or_else(|e| panic!("{name}: {e}"));
    let legacy = get_project_stats_summary(fixture.project_path(), None, None, None)
        .await
        .unwrap_or_else(|e| panic!("{name}: legacy {e}"));
    let root = fixture.root().to_string_lossy().to_string();
    normalize(
        json!({
            "request": request,
            "ranking_costs": ranking_costs(&response),
            "response": response,
            "legacy_model_distribution": legacy.model_distribution,
        }),
        &root,
    )
}

/// Cap of the `session_cap` scenario: small enough to cut its fixture.
const GOLDEN_SESSION_CAP: usize = 3;

/// Six sessions whose cost order is not their token order, over the
/// pricing dimensions the ranking mirrors: a fast tier, 1-hour cache
/// writes, provider cost, a mixed session, a long-context tier and a model
/// without a price.
fn session_cap_rows() -> Vec<FixtureRow> {
    vec![
        row("s-opus-fast", "o1", "2026-10-15T09:00:00Z")
            .model(OPUS)
            .tier("fast")
            .tokens(0, 2_000, 0, 0),
        row("s-sonnet-1h", "w1", "2026-10-15T10:00:00Z")
            .tokens(1_000, 0, 10_000, 0)
            .cache_1h(10_000),
        row("s-source", "c1", "2026-10-16T09:00:00Z")
            .tokens(3_000, 0, 0, 0)
            .cost(0.05),
        row("s-mixed", "m1", "2026-10-16T10:00:00Z")
            .tokens(1_000, 0, 0, 0)
            .cost(0.01),
        row("s-mixed", "m2", "2026-10-16T10:05:00Z").tokens(2_000, 0, 0, 0),
        row("s-haiku-long", "h1", "2026-10-17T09:00:00Z")
            .model(HAIKU)
            .tokens(0, 0, 0, 150_000),
        row("s-unpriced", "u1", "2026-10-17T10:00:00Z")
            .model("my-local-model")
            .tokens(50_000, 0, 0, 0),
    ]
}

/// The same request through the real pipeline twice: under
/// [`GOLDEN_SESSION_CAP`] (`response`) and under the production cap, which
/// lists every session (`uncapped_response`).
async fn session_cap_scenario() -> Value {
    let fixture = UsageFixture::write("session-cap", session_cap_rows());
    let request = project_request(&fixture, utc_days());
    let capped = super::breakdown(request.clone(), GOLDEN_SESSION_CAP)
        .await
        .expect("session_cap: capped");
    let uncapped = get_usage_breakdown(request.clone())
        .await
        .expect("session_cap: uncapped");
    assert_eq!(uncapped.session_remainder.session_count, 0);
    let root = fixture.root().to_string_lossy().to_string();
    normalize(
        json!({
            "max_sessions": GOLDEN_SESSION_CAP,
            "request": request,
            "ranking_costs": ranking_costs(&uncapped),
            "response": capped,
            "uncapped_response": uncapped,
        }),
        &root,
    )
}

fn utc_days() -> Vec<UsageInterval> {
    vec![
        interval("2026-10-15", "2026-10-15T00:00:00Z", "2026-10-16T00:00:00Z"),
        interval("2026-10-16", "2026-10-16T00:00:00Z", "2026-10-17T00:00:00Z"),
        interval("2026-10-17", "2026-10-17T00:00:00Z", "2026-10-18T00:00:00Z"),
    ]
}

fn same_policy_rows() -> Vec<FixtureRow> {
    vec![
        row("s1", "a1", "2026-10-15T09:00:00Z")
            .tokens(1_000, 200, 50, 300)
            .cost(0.25),
        row("s1", "a2", "2026-10-15T09:05:00Z")
            .tokens(2_000, 100, 0, 600)
            .cost(0.5),
        row("s1", "a3", "2026-10-15T10:00:00Z")
            .model(HAIKU)
            .tokens(4_000, 400, 0, 0),
        row("s2", "b1", "2026-10-16T14:00:00Z")
            .model(HAIKU)
            .tier("fast")
            .tokens(500, 50, 0, 100),
        row("s3", "c1", "2026-10-17T08:00:00Z")
            .model(HAIKU)
            .tokens(300, 30, 0, 0),
    ]
}

fn mixed(second_ts: &str) -> Vec<FixtureRow> {
    vec![
        row("s1", "first", "2026-10-15T12:00:00Z")
            .tokens(1_000_000, 0, 0, 0)
            .cost(1.0),
        row("s1", "second", second_ts).tokens(1_000_000, 0, 0, 0),
    ]
}

async fn build_golden() -> Value {
    let undated = vec![
        row("s1", "dated", "2026-10-15T12:00:00Z").tokens(100, 0, 0, 0),
        row("s1", "undated", "").undated().tokens(7, 0, 0, 0),
    ];
    let mut scenarios = serde_json::Map::new();
    let mut add = |name: &str, value: Value| {
        scenarios.insert(name.to_string(), value);
    };
    add(
        "same_policy_days",
        scenario("same-policy", same_policy_rows(), utc_days()).await,
    );
    add(
        "same_policy_range",
        scenario(
            "same-policy",
            same_policy_rows(),
            vec![interval(
                "all",
                "2026-10-15T00:00:00Z",
                "2026-10-18T00:00:00Z",
            )],
        )
        .await,
    );
    add(
        "mixed_by_day",
        scenario("mixed-day", mixed("2026-10-16T12:00:00Z"), utc_days()).await,
    );
    add(
        "mixed_by_turn",
        scenario("mixed-turn", mixed("2026-10-15T12:10:00Z"), utc_days()).await,
    );
    // Asia/Kolkata (UTC+5:30): 18:20Z is 23:50 on the 17th, 18:40Z is
    // 00:10 on the 18th — one UTC hour, two local days.
    add(
        "kolkata",
        scenario(
            "kolkata",
            vec![
                row("s1", "k1", "2026-10-17T18:20:00Z").tokens(10, 0, 0, 0),
                row("s1", "k2", "2026-10-17T18:40:00Z").tokens(20, 0, 0, 0),
            ],
            vec![
                interval("2026-10-17", "2026-10-16T18:30:00Z", "2026-10-17T18:30:00Z"),
                interval("2026-10-18", "2026-10-17T18:30:00Z", "2026-10-18T18:30:00Z"),
            ],
        )
        .await,
    );
    // Pacific/Apia skipped 2011-12-30: UTC-10 until 2011-12-30T10:00Z, then
    // UTC+14, so the 30th is a zero-length interval.
    add(
        "apia",
        scenario(
            "apia",
            vec![
                row("s1", "p1", "2011-12-29T12:00:00Z").tokens(10, 0, 0, 0),
                row("s1", "p2", "2011-12-30T12:00:00Z").tokens(20, 0, 0, 0),
            ],
            vec![
                interval("2011-12-29", "2011-12-29T10:00:00Z", "2011-12-30T10:00:00Z"),
                interval("2011-12-30", "2011-12-30T10:00:00Z", "2011-12-30T10:00:00Z"),
                interval("2011-12-31", "2011-12-30T10:00:00Z", "2011-12-31T10:00:00Z"),
            ],
        )
        .await,
    );
    add(
        "undated",
        scenario("undated", undated.clone(), utc_days()).await,
    );
    add(
        "undated_removed",
        scenario("undated", undated[..1].to_vec(), utc_days()).await,
    );
    add("session_cap", session_cap_scenario().await);
    json!({
        "_comment": "Generated by src-tauri/src/commands/stats/usage_breakdown/golden_tests.rs from the real get_usage_breakdown command. Do not edit by hand; regenerate with CCHV_UPDATE_GOLDEN=1.",
        "scenarios": Value::Object(scenarios),
    })
}

/// The golden file is the same on every platform: a path under the fixture
/// root is recorded with `/` separators, whatever the platform joins with.
#[test]
fn normalize_records_paths_under_the_root_with_forward_slashes() {
    let root = r"C:\Users\RUNNER~1\AppData\Local\Temp\.tmpAbC";
    let value = json!({
        "project_path": format!(r"{root}\projects\apia"),
        "sessions": [{ "file_path": format!(r"{root}\projects\apia\s1.jsonl") }],
        "title": r"not\a\path",
    });
    assert_eq!(
        normalize(value, root),
        json!({
            "project_path": "<root>/projects/apia",
            "sessions": [{ "file_path": "<root>/projects/apia/s1.jsonl" }],
            "title": r"not\a\path",
        })
    );
}

#[tokio::test]
#[serial]
async fn golden_reconciliation_fixture_matches_the_command() {
    let _home = SandboxHome::new();
    let built = build_golden().await;
    let path = golden_path();
    // Compared as text, not as parsed JSON: the ranking costs are computed
    // floats, and serde_json's default parser (no `float_roundtrip`) can
    // read one back a unit in the last place off. The text is exact.
    let mut text = serde_json::to_string_pretty(&built).unwrap();
    text.push('\n');
    if std::env::var_os("CCHV_UPDATE_GOLDEN").is_some_and(|v| v == "1") {
        std::fs::write(&path, &text).expect("write golden");
    }
    let stored = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| {
            panic!(
                "{}: {e} (regenerate with CCHV_UPDATE_GOLDEN=1)",
                path.display()
            )
        })
        .replace("\r\n", "\n");
    if stored != text {
        let line = stored
            .lines()
            .zip(text.lines())
            .position(|(stored, built)| stored != built)
            .unwrap_or_else(|| stored.lines().count().min(text.lines().count()));
        let at = |s: &str| s.lines().nth(line).unwrap_or("<end of file>").to_string();
        panic!(
            "{} differs from the command's output at line {}\n  stored: {}\n  built:  {}\n(regenerate with CCHV_UPDATE_GOLDEN=1 if the change is intended)",
            path.display(),
            line + 1,
            at(&stored),
            at(&text),
        );
    }
}
