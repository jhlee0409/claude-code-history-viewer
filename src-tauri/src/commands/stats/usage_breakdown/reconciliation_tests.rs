//! Reconciliation reference tests (ADR 0002 §8).
//!
//! Green now: the reference scan reproduces the **old** commands on the same
//! rows (inclusive filter, dedup, per-model cost), pins the old inclusive end
//! and the old $1 merge of a mixed source-cost group, and shows that the
//! half-open split keeps range totals.
//!
//! Ignored with the reason `AN0b`: the same fixtures against the new command. They are
//! written against [`usage_breakdown`], which `AN0b` replaces with the real
//! command; until then they would fail, so they stay ignored rather than
//! pretending to pass.

use super::fixture::*;
use super::*;
use crate::commands::stats::get_project_token_stats;
use crate::commands::stats::{get_global_stats_summary, get_project_stats_summary};
use serial_test::serial;
use std::collections::BTreeMap;
use std::ffi::OsString;

/// `AN0b`: replace with `crate::commands::stats::usage_breakdown::get_usage_breakdown`.
fn usage_breakdown(
    _request: UsageBreakdownRequest,
) -> impl std::future::Future<Output = Result<UsageBreakdownResponse, String>> {
    std::future::ready(Err(format!(
        "AN0b: {USAGE_BREAKDOWN_COMMAND} is not implemented"
    )))
}

/// Keeps provider detection away from the developer's home (#540).
struct HomeGuard(Option<OsString>);

impl HomeGuard {
    fn set(path: &std::path::Path) -> Self {
        let original = std::env::var_os("CCHV_TEST_HOME");
        std::env::set_var("CCHV_TEST_HOME", path);
        Self(original)
    }
}

impl Drop for HomeGuard {
    fn drop(&mut self) {
        match self.0.take() {
            Some(value) => std::env::set_var("CCHV_TEST_HOME", value),
            None => std::env::remove_var("CCHV_TEST_HOME"),
        }
    }
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

fn totals_of(stats: &ModelStats) -> RefTotals {
    RefTotals {
        message_count: u64::from(stats.message_count),
        input: stats.input_tokens,
        output: stats.output_tokens,
        cache_creation: stats.cache_creation_tokens,
        cache_read: stats.cache_read_tokens,
        cost_usd: stats.cost_usd,
    }
}

fn add_into(target: &mut RefTotals, source: &RefTotals) {
    target.message_count += source.message_count;
    target.input += source.input;
    target.output += source.output;
    target.cache_creation += source.cache_creation;
    target.cache_read += source.cache_read;
    if let Some(cost) = source.cost_usd {
        *target.cost_usd.get_or_insert(0.0) += cost;
    }
}

/// Sum priced buckets by (model, tier, pricing source).
fn bucket_map<'a>(
    groups: impl IntoIterator<Item = &'a Vec<PricedModelStats>>,
) -> BTreeMap<RefKey, RefTotals> {
    let mut out: BTreeMap<RefKey, RefTotals> = BTreeMap::new();
    for models in groups {
        for bucket in models {
            let key = (
                bucket.stats.model_name.clone(),
                bucket.stats.service_tier.clone(),
                bucket.pricing_source,
            );
            add_into(out.entry(key).or_default(), &totals_of(&bucket.stats));
        }
    }
    out
}

fn assert_cost_eq(actual: Option<f64>, expected: Option<f64>) {
    match (actual, expected) {
        (Some(a), Some(e)) => assert!((a - e).abs() < 1e-9, "cost {a} != {e}"),
        (a, e) => assert_eq!(a, e),
    }
}

fn assert_totals_eq(actual: &RefTotals, expected: &RefTotals) {
    let strip = |t: &RefTotals| RefTotals {
        cost_usd: None,
        ..t.clone()
    };
    assert_eq!(strip(actual), strip(expected));
    assert_cost_eq(actual.cost_usd, expected.cost_usd);
}

fn assert_bucket_maps_eq(
    actual: &BTreeMap<RefKey, RefTotals>,
    expected: &BTreeMap<RefKey, RefTotals>,
) {
    assert_eq!(
        actual.keys().collect::<Vec<_>>(),
        expected.keys().collect::<Vec<_>>()
    );
    for (key, totals) in expected {
        assert_totals_eq(&actual[key], totals);
    }
}

// ---- fixtures ---------------------------------------------------------------

/// Every (model, tier) is all-source or all-estimate; no undated or edge rows.
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
        row("s2", "b2", "2026-10-16T15:30:00Z")
            .tokens(800, 80, 20, 0)
            .cost(0.125),
        row("s3", "c1", "2026-10-17T08:00:00Z")
            .model(HAIKU)
            .tokens(300, 30, 0, 0),
    ]
}

/// Same model and tier, 1M input on each of two days, a provider cost on day A
/// only — the C2 counterexample (`scratch/inner-ui/probe/c2.probe.test.ts`).
fn mixed_by_day_rows() -> Vec<FixtureRow> {
    vec![
        row("s1", "dayA", "2026-10-15T12:00:00Z")
            .tokens(1_000_000, 0, 0, 0)
            .cost(1.0),
        row("s1", "dayB", "2026-10-16T12:00:00Z").tokens(1_000_000, 0, 0, 0),
    ]
}

/// The same counterexample as two turns of one session on one day.
fn mixed_by_turn_rows() -> Vec<FixtureRow> {
    vec![
        row("s1", "turn1", "2026-10-15T12:00:00Z")
            .tokens(1_000_000, 0, 0, 0)
            .cost(1.0),
        row("s1", "turn2", "2026-10-15T12:10:00Z").tokens(1_000_000, 0, 0, 0),
    ]
}

/// Rows on the start edge, inside, exactly on the end edge and just before it.
fn edge_rows() -> Vec<FixtureRow> {
    vec![
        row("s1", "start", "2026-10-17T00:00:00Z").tokens(10, 0, 0, 0),
        row("s1", "inside", "2026-10-17T12:00:00Z").tokens(20, 0, 0, 0),
        row("s1", "sub-ms", "2026-10-17T23:59:59.999999Z").tokens(40, 0, 0, 0),
        row("s1", "end", "2026-10-18T00:00:00Z").tokens(80, 0, 0, 0),
    ]
}

/// A streamed turn (one message id, growing output) whose rows straddle UTC
/// midnight, plus a second streamed turn that repeats its full source cost on
/// every row while its output grows.
fn dedup_rows() -> Vec<FixtureRow> {
    vec![
        row("s1", "t1-a", "2026-10-16T23:59:00Z")
            .message_id("m-stream")
            .tokens(1_000, 10, 0, 500),
        row("s1", "t1-b", "2026-10-17T00:01:00Z")
            .message_id("m-stream")
            .tokens(1_000, 90, 0, 500),
        row("s1", "t2-a", "2026-10-17T03:00:00Z")
            .message_id("m-cost")
            .tokens(200, 20, 0, 0)
            .cost(0.01),
        row("s1", "t2-b", "2026-10-17T03:00:01Z")
            .message_id("m-cost")
            .tokens(200, 60, 0, 0)
            .cost(0.01),
    ]
}

/// Rows that production's `dedup_usage_key` keeps apart although a naive
/// "message id, else uuid" key would merge them. Each row has 100 input and
/// a $1 source cost.
fn empty_message_id_rows() -> Vec<FixtureRow> {
    // An empty message id is no id: the rows fall back to their uuids.
    vec![
        row("s-empty", "e1", "2026-10-15T10:00:00Z")
            .message_id("")
            .tokens(100, 0, 0, 0)
            .cost(1.0),
        row("s-empty", "e2", "2026-10-15T10:01:00Z")
            .message_id("")
            .tokens(100, 0, 0, 0)
            .cost(1.0),
    ]
}

fn message_id_uuid_collision_rows() -> Vec<FixtureRow> {
    // One row's message id equals another row's fallback uuid.
    vec![
        row("s-collide", "c1", "2026-10-15T11:00:00Z")
            .message_id("same")
            .tokens(100, 0, 0, 0)
            .cost(1.0),
        row("s-collide", "same", "2026-10-15T11:01:00Z")
            .no_message_id()
            .tokens(100, 0, 0, 0)
            .cost(1.0),
    ]
}

fn same_message_id_two_sessions_rows() -> Vec<FixtureRow> {
    // One file, two session ids, the same message id.
    vec![
        row("s-sessions", "x1", "2026-10-15T12:00:00Z")
            .session("session-a")
            .message_id("shared")
            .tokens(100, 0, 0, 0)
            .cost(1.0),
        row("s-sessions", "x2", "2026-10-15T12:01:00Z")
            .session("session-b")
            .message_id("shared")
            .tokens(100, 0, 0, 0)
            .cost(1.0),
    ]
}

fn unkeyed_rows() -> Vec<FixtureRow> {
    // No usable message id or uuid (missing or empty): every row counts on
    // its own, never merged with another unkeyed row.
    vec![
        row("s-unkeyed", "", "2026-10-15T13:00:00Z")
            .no_message_id()
            .no_uuid()
            .tokens(100, 0, 0, 0)
            .cost(1.0),
        row("s-unkeyed", "", "2026-10-15T13:01:00Z")
            .no_message_id()
            .no_uuid()
            .tokens(100, 0, 0, 0)
            .cost(1.0),
        row("s-unkeyed", "", "2026-10-15T13:02:00Z")
            .message_id("")
            .tokens(100, 0, 0, 0)
            .cost(1.0),
        row("s-unkeyed", "", "2026-10-15T13:03:00Z")
            .message_id("")
            .tokens(100, 0, 0, 0)
            .cost(1.0),
    ]
}

fn day(key: &str, start: &str, end: &str) -> UsageInterval {
    interval(key, start, end)
}

fn utc_days_15_to_17() -> Vec<UsageInterval> {
    vec![
        day("2026-10-15", "2026-10-15T00:00:00Z", "2026-10-16T00:00:00Z"),
        day("2026-10-16", "2026-10-16T00:00:00Z", "2026-10-17T00:00:00Z"),
        day("2026-10-17", "2026-10-17T00:00:00Z", "2026-10-18T00:00:00Z"),
    ]
}

async fn legacy_summary(
    fixture: &UsageFixture,
    start: Option<&str>,
    end: Option<&str>,
) -> crate::models::ProjectStatsSummary {
    get_project_stats_summary(
        fixture.project_path(),
        start.map(str::to_string),
        end.map(str::to_string),
        Some("billing_total".to_string()),
    )
    .await
    .expect("legacy project summary")
}

fn legacy_model_map(
    summary: &crate::models::ProjectStatsSummary,
) -> BTreeMap<(String, Option<String>), RefTotals> {
    summary
        .model_distribution
        .iter()
        .map(|m| ((m.model_name.clone(), m.service_tier.clone()), totals_of(m)))
        .collect()
}

/// Reference buckets folded over the pricing source, as the old commands do.
fn reference_model_map(scan: &RefScan) -> BTreeMap<(String, Option<String>), RefTotals> {
    let mut out: BTreeMap<(String, Option<String>), RefTotals> = BTreeMap::new();
    for ((model, tier, _), totals) in &scan.buckets {
        add_into(
            out.entry((model.clone(), tier.clone())).or_default(),
            totals,
        );
    }
    out
}

// ---- green: the reference scan against the old commands -------------------

#[tokio::test]
#[serial]
async fn reference_scan_reproduces_legacy_project_summary_on_same_policy_fixture() {
    let fixture = UsageFixture::write("same-policy", same_policy_rows());
    let _home = HomeGuard::set(fixture.root());
    let summary = legacy_summary(&fixture, None, None).await;
    let scan = reference_scan(&fixture.rows, every_dated_row);

    let legacy = legacy_model_map(&summary);
    let reference = reference_model_map(&scan);
    assert_eq!(
        legacy.keys().collect::<Vec<_>>(),
        reference.keys().collect::<Vec<_>>()
    );
    for (key, expected) in &reference {
        assert_totals_eq(&legacy[key], expected);
    }
    let total: u64 = scan.buckets.values().map(RefTotals::token_count).sum();
    assert_eq!(summary.total_tokens, total);
    assert_eq!(summary.total_sessions, 3);
}

#[tokio::test]
#[serial]
async fn reference_scan_reproduces_legacy_token_stats_over_every_page() {
    let fixture = UsageFixture::write("same-policy-pages", same_policy_rows());
    let _home = HomeGuard::set(fixture.root());
    let mut offset = 0;
    let mut tokens = 0;
    let mut sessions = 0;
    loop {
        let page = get_project_token_stats(
            fixture.project_path(),
            Some(offset),
            Some(1),
            None,
            None,
            Some("billing_total".to_string()),
        )
        .await
        .expect("legacy token stats page");
        tokens += page.items.iter().map(|s| s.total_tokens).sum::<u64>();
        sessions += page.items.len();
        offset += page.items.len();
        if !page.has_more {
            break;
        }
    }
    let scan = reference_scan(&fixture.rows, every_dated_row);
    assert_eq!(sessions, scan.sessions.len());
    assert_eq!(
        tokens,
        scan.buckets
            .values()
            .map(RefTotals::token_count)
            .sum::<u64>()
    );
}

#[tokio::test]
#[serial]
async fn legacy_date_filter_counts_a_row_exactly_at_end() {
    let fixture = UsageFixture::write("edges", edge_rows());
    let _home = HomeGuard::set(fixture.root());
    let summary = legacy_summary(
        &fixture,
        Some("2026-10-17T00:00:00Z"),
        Some("2026-10-18T00:00:00Z"),
    )
    .await;
    // Old rule: start, inside, sub-ms and the row exactly at end.
    assert_eq!(summary.total_tokens, 10 + 20 + 40 + 80);
    let inclusive = reference_scan(
        &fixture.rows,
        legacy_inclusive(ms("2026-10-17T00:00:00Z"), ms("2026-10-18T00:00:00Z")),
    );
    assert_eq!(
        inclusive
            .buckets
            .values()
            .map(RefTotals::token_count)
            .sum::<u64>(),
        summary.total_tokens
    );

    // New rule: the row at end belongs to the next interval only.
    let d17 = day("2026-10-17", "2026-10-17T00:00:00Z", "2026-10-18T00:00:00Z");
    let d18 = day("2026-10-18", "2026-10-18T00:00:00Z", "2026-10-19T00:00:00Z");
    let in17 = reference_scan(&fixture.rows, half_open(&d17));
    let in18 = reference_scan(&fixture.rows, half_open(&d18));
    assert_eq!(
        in17.buckets
            .values()
            .map(RefTotals::token_count)
            .sum::<u64>(),
        70
    );
    assert_eq!(
        in18.buckets
            .values()
            .map(RefTotals::token_count)
            .sum::<u64>(),
        80
    );
}

#[tokio::test]
#[serial]
async fn legacy_summary_merges_mixed_source_cost_into_one_dollar() {
    for (name, rows) in [
        ("by-day", mixed_by_day_rows()),
        ("by-turn", mixed_by_turn_rows()),
    ] {
        let fixture = UsageFixture::write(name, rows);
        let _home = HomeGuard::set(fixture.root());
        let summary = legacy_summary(&fixture, None, None).await;
        let sonnet = summary
            .model_distribution
            .iter()
            .find(|m| m.model_name == SONNET)
            .expect("sonnet row");
        // Old behaviour, kept on purpose: tokens of both rows, cost of one.
        // Priced by the frontend this is $1 for 2M input; the policy says $4.
        assert_eq!(sonnet.input_tokens, 2_000_000, "{name}");
        assert_cost_eq(sonnet.cost_usd, Some(1.0));

        // The policy keeps the two parts apart.
        let scan = reference_scan(&fixture.rows, every_dated_row);
        let source = &scan.buckets[&(SONNET.to_string(), None, PricingSource::Source)];
        let estimate = &scan.buckets[&(SONNET.to_string(), None, PricingSource::Estimate)];
        assert_eq!(
            (source.input, source.cost_usd),
            (1_000_000, Some(1.0)),
            "{name}"
        );
        assert_eq!(
            (estimate.input, estimate.cost_usd),
            (1_000_000, None),
            "{name}"
        );
    }
}

#[tokio::test]
#[serial]
async fn reference_dedup_matches_legacy_for_streamed_turn_and_repeated_cost() {
    let fixture = UsageFixture::write("dedup", dedup_rows());
    let _home = HomeGuard::set(fixture.root());
    let summary = legacy_summary(&fixture, None, None).await;
    let scan = reference_scan(&fixture.rows, every_dated_row);
    assert_eq!(
        summary.total_tokens,
        scan.buckets
            .values()
            .map(RefTotals::token_count)
            .sum::<u64>()
    );
    // Turn 1 counts its final usage once; turn 2's repeated cost counts once.
    assert_eq!(summary.total_tokens, (1_000 + 90 + 500) + (200 + 60));
    let sonnet = legacy_model_map(&summary)[&(SONNET.to_string(), None)].clone();
    assert_cost_eq(sonnet.cost_usd, Some(0.01));

    // Pricing source is per dedup identity: the growth of turn 2's later
    // row stays in the source bucket even though its repeated cost is dropped.
    let source = &scan.buckets[&(SONNET.to_string(), None, PricingSource::Source)];
    assert_eq!(
        (source.message_count, source.input, source.output),
        (2, 200, 60)
    );
    assert_cost_eq(source.cost_usd, Some(0.01));
    let estimate = &scan.buckets[&(SONNET.to_string(), None, PricingSource::Estimate)];
    assert_eq!(estimate.token_count(), 1_000 + 90 + 500);
}

#[test]
fn reference_half_open_split_preserves_range_totals_across_midnight() {
    // Dedup state runs over the whole file before interval assignment, so a
    // streamed turn across midnight is split, never double counted.
    let rows = dedup_rows();
    let d16 = day("2026-10-16", "2026-10-16T00:00:00Z", "2026-10-17T00:00:00Z");
    let d17 = day("2026-10-17", "2026-10-17T00:00:00Z", "2026-10-18T00:00:00Z");
    let a = reference_scan(&rows, half_open(&d16));
    let b = reference_scan(&rows, half_open(&d17));
    let range = reference_scan(&rows, |ts| {
        ts.is_some_and(|t| d16.contains_ms(t) || d17.contains_ms(t))
    });
    let sum = |s: &RefScan| s.buckets.values().map(RefTotals::token_count).sum::<u64>();
    assert_eq!(sum(&a), 1_000 + 10 + 500);
    assert_eq!(sum(&b), 80 + 260);
    assert_eq!(sum(&a) + sum(&b), sum(&range));

    // Turn 2's cost is counted once, on its first row; a split never repeats it.
    let mut rows = dedup_rows();
    rows[3].timestamp = Some("2026-10-18T00:00:01Z".to_string());
    let d18 = day("2026-10-18", "2026-10-18T00:00:00Z", "2026-10-19T00:00:00Z");
    let late = reference_scan(&rows, half_open(&d18));
    let source = &late.buckets[&(SONNET.to_string(), None, PricingSource::Source)];
    assert_eq!((source.output, source.cost_usd), (40, Some(0.0)));
}

/// The old summary and the reference scan agree on `rows`, and every row is
/// its own identity: N rows of 100 input and $1 count as 100·N input and
/// $N, all in the source bucket.
async fn assert_reference_keeps_identities_apart(project: &str, rows: Vec<FixtureRow>) {
    let n = rows.len() as u64;
    let fixture = UsageFixture::write(project, rows);
    let _home = HomeGuard::set(fixture.root());
    let summary = legacy_summary(&fixture, None, None).await;
    let scan = reference_scan(&fixture.rows, every_dated_row);

    let legacy = legacy_model_map(&summary);
    let reference = reference_model_map(&scan);
    assert_eq!(
        legacy.keys().collect::<Vec<_>>(),
        reference.keys().collect::<Vec<_>>()
    );
    for (key, expected) in &reference {
        assert_totals_eq(&legacy[key], expected);
    }

    assert_eq!(scan.buckets.len(), 1, "one source bucket");
    let source = &scan.buckets[&(SONNET.to_string(), None, PricingSource::Source)];
    assert_totals_eq(
        source,
        &RefTotals {
            message_count: n,
            input: 100 * n,
            cost_usd: Some(n as f64),
            ..RefTotals::default()
        },
    );
    assert_eq!(summary.total_tokens, 100 * n);
}

#[tokio::test]
#[serial]
async fn reference_treats_empty_message_id_as_missing_like_legacy() {
    assert_reference_keeps_identities_apart("empty-id", empty_message_id_rows()).await;
}

#[tokio::test]
#[serial]
async fn reference_keeps_message_id_and_uuid_keys_apart_like_legacy() {
    assert_reference_keeps_identities_apart("id-uuid", message_id_uuid_collision_rows()).await;
}

#[tokio::test]
#[serial]
async fn reference_scopes_message_id_by_session_like_legacy() {
    assert_reference_keeps_identities_apart("two-sessions", same_message_id_two_sessions_rows())
        .await;
}

#[tokio::test]
#[serial]
async fn reference_counts_rows_without_any_id_individually_like_legacy() {
    assert_reference_keeps_identities_apart("unkeyed", unkeyed_rows()).await;
}

#[tokio::test]
#[serial]
async fn legacy_summary_stamps_undated_rows_but_reference_only_counts_them() {
    let rows = vec![
        row("s1", "dated", "2026-10-15T12:00:00Z").tokens(100, 0, 0, 0),
        row("s1", "undated", "").undated().tokens(7, 0, 0, 0),
    ];
    let fixture = UsageFixture::write("undated", rows);
    let _home = HomeGuard::set(fixture.root());
    let summary = legacy_summary(&fixture, None, None).await;
    let scan = reference_scan(&fixture.rows, every_dated_row);
    assert_eq!(scan.undated_rows, 1);
    let dated: u64 = scan.buckets.values().map(RefTotals::token_count).sum();
    // The old summary counts the undated row; the difference is exactly it.
    assert_eq!(summary.total_tokens - dated, 7);
}

// ---- AN0b: the new command against the same fixtures ----------------------

#[tokio::test]
#[serial]
#[ignore = "AN0b"]
async fn an0b_interval_sum_equals_range_and_session_sums() {
    let fixture = UsageFixture::write("an0b-sums", same_policy_rows());
    let _home = HomeGuard::set(fixture.root());
    let days = usage_breakdown(project_request(&fixture, utc_days_15_to_17()))
        .await
        .expect("AN0b");
    let range = usage_breakdown(project_request(
        &fixture,
        vec![day("all", "2026-10-15T00:00:00Z", "2026-10-18T00:00:00Z")],
    ))
    .await
    .expect("AN0b");
    let by_days = bucket_map(days.intervals.iter().map(|i| &i.models));
    let once = bucket_map(range.intervals.iter().map(|i| &i.models));
    let by_sessions = bucket_map(days.sessions.iter().map(|s| &s.models));
    assert_bucket_maps_eq(&by_days, &once);
    assert_bucket_maps_eq(&by_sessions, &once);
    assert_bucket_maps_eq(
        &once,
        &reference_scan(&fixture.rows, every_dated_row).buckets,
    );
}

#[tokio::test]
#[serial]
#[ignore = "AN0b"]
async fn an0b_matches_legacy_on_same_policy_fixture() {
    let fixture = UsageFixture::write("an0b-legacy", same_policy_rows());
    let _home = HomeGuard::set(fixture.root());
    let legacy = legacy_model_map(&legacy_summary(&fixture, None, None).await);
    let response = usage_breakdown(project_request(&fixture, utc_days_15_to_17()))
        .await
        .expect("AN0b");
    let mut folded: BTreeMap<(String, Option<String>), RefTotals> = BTreeMap::new();
    for ((model, tier, _), totals) in bucket_map(response.intervals.iter().map(|i| &i.models)) {
        add_into(folded.entry((model, tier)).or_default(), &totals);
    }
    assert_eq!(
        folded.keys().collect::<Vec<_>>(),
        legacy.keys().collect::<Vec<_>>()
    );
    for (key, totals) in &legacy {
        assert_totals_eq(&folded[key], totals);
    }
}

#[tokio::test]
#[serial]
#[ignore = "AN0b"]
async fn an0b_mixed_source_cost_by_day_splits_source_and_estimate_buckets() {
    let fixture = UsageFixture::write("an0b-mixed-day", mixed_by_day_rows());
    let _home = HomeGuard::set(fixture.root());
    let response = usage_breakdown(project_request(&fixture, utc_days_15_to_17()))
        .await
        .expect("AN0b");
    let day_a = bucket_map([&response.intervals[0].models]);
    let day_b = bucket_map([&response.intervals[1].models]);
    let source = (SONNET.to_string(), None, PricingSource::Source);
    let estimate = (SONNET.to_string(), None, PricingSource::Estimate);
    assert_eq!(day_a.keys().collect::<Vec<_>>(), vec![&source]);
    assert_cost_eq(day_a[&source].cost_usd, Some(1.0));
    assert_eq!(day_b.keys().collect::<Vec<_>>(), vec![&estimate]);
    assert_eq!(
        (day_b[&estimate].input, day_b[&estimate].cost_usd),
        (1_000_000, None)
    );
    // Priced by calculateGlobalCostSummary: $1 exact + $3 estimated = $4
    // (pricedBuckets.additivity.test.ts); the old summary says $1.
}

#[tokio::test]
#[serial]
#[ignore = "AN0b"]
async fn an0b_mixed_source_cost_by_turn_in_one_day_splits_buckets() {
    let fixture = UsageFixture::write("an0b-mixed-turn", mixed_by_turn_rows());
    let _home = HomeGuard::set(fixture.root());
    let response = usage_breakdown(project_request(&fixture, utc_days_15_to_17()))
        .await
        .expect("AN0b");
    let expected = reference_scan(&fixture.rows, every_dated_row).buckets;
    assert_eq!(expected.len(), 2, "one source and one estimate bucket");
    assert_bucket_maps_eq(&bucket_map([&response.intervals[0].models]), &expected);
    assert_bucket_maps_eq(&bucket_map([&response.sessions[0].models]), &expected);
}

#[tokio::test]
#[serial]
#[ignore = "AN0b"]
async fn an0b_row_exactly_at_end_belongs_to_next_interval_only() {
    let fixture = UsageFixture::write("an0b-edges", edge_rows());
    let _home = HomeGuard::set(fixture.root());
    let d17 = day("2026-10-17", "2026-10-17T00:00:00Z", "2026-10-18T00:00:00Z");
    let d18 = day("2026-10-18", "2026-10-18T00:00:00Z", "2026-10-19T00:00:00Z");
    let response = usage_breakdown(project_request(&fixture, vec![d17.clone(), d18.clone()]))
        .await
        .expect("AN0b");
    assert_bucket_maps_eq(
        &bucket_map([&response.intervals[0].models]),
        &reference_scan(&fixture.rows, half_open(&d17)).buckets,
    );
    assert_bucket_maps_eq(
        &bucket_map([&response.intervals[1].models]),
        &reference_scan(&fixture.rows, half_open(&d18)).buckets,
    );
}

#[tokio::test]
#[serial]
#[ignore = "AN0b"]
async fn an0b_sub_millisecond_row_before_end_stays_in_its_day() {
    let fixture = UsageFixture::write("an0b-sub-ms", edge_rows());
    let _home = HomeGuard::set(fixture.root());
    let d17 = day("2026-10-17", "2026-10-17T00:00:00Z", "2026-10-18T00:00:00Z");
    let response = usage_breakdown(project_request(&fixture, vec![d17]))
        .await
        .expect("AN0b");
    let tokens: u64 = response.intervals[0]
        .models
        .iter()
        .map(|m| m.stats.token_count)
        .sum();
    assert_eq!(tokens, 10 + 20 + 40);
}

#[tokio::test]
#[serial]
#[ignore = "AN0b"]
async fn an0b_zero_length_interval_is_returned_empty_and_in_order() {
    let fixture = UsageFixture::write("an0b-zero", edge_rows());
    let _home = HomeGuard::set(fixture.root());
    let intervals = vec![
        day("before", "2026-10-16T00:00:00Z", "2026-10-17T00:00:00Z"),
        day("gap", "2026-10-17T00:00:00Z", "2026-10-17T00:00:00Z"),
        day("after", "2026-10-17T00:00:00Z", "2026-10-18T00:00:00Z"),
    ];
    let response = usage_breakdown(project_request(&fixture, intervals))
        .await
        .expect("AN0b");
    let keys: Vec<_> = response.intervals.iter().map(|i| i.key.as_str()).collect();
    assert_eq!(keys, ["before", "gap", "after"]);
    assert!(response.intervals[0].models.is_empty());
    assert!(response.intervals[1].models.is_empty());
    assert_eq!(response.intervals[1].message_count, 0);
}

#[tokio::test]
#[serial]
#[ignore = "AN0b"]
async fn an0b_undated_rows_are_only_counted_in_coverage() {
    let rows = vec![
        row("s1", "dated", "2026-10-15T12:00:00Z").tokens(100, 0, 0, 0),
        row("s1", "undated", "").undated().tokens(7, 0, 0, 0),
    ];
    let fixture = UsageFixture::write("an0b-undated", rows);
    let _home = HomeGuard::set(fixture.root());
    let response = usage_breakdown(project_request(&fixture, utc_days_15_to_17()))
        .await
        .expect("AN0b");
    assert_eq!(response.coverage.undated_rows, 1);
    let tokens: u64 = response
        .intervals
        .iter()
        .flat_map(|i| &i.models)
        .map(|m| m.stats.token_count)
        .sum();
    assert_eq!(tokens, 100);
    // Old summary − new total is explained by the undated row alone.
    let legacy = legacy_summary(&fixture, None, None).await;
    assert_eq!(legacy.total_tokens - tokens, 7);
}

#[tokio::test]
#[serial]
#[ignore = "AN0b"]
async fn an0b_rows_without_model_count_unknown_model_tokens() {
    let rows = vec![
        row("s1", "named", "2026-10-15T12:00:00Z").tokens(100, 0, 0, 0),
        row("s1", "anon", "2026-10-15T12:01:00Z")
            .no_model()
            .tokens(30, 10, 0, 0),
    ];
    let fixture = UsageFixture::write("an0b-unknown-model", rows);
    let _home = HomeGuard::set(fixture.root());
    let response = usage_breakdown(project_request(&fixture, utc_days_15_to_17()))
        .await
        .expect("AN0b");
    assert_eq!(response.coverage.unknown_model_tokens, 40);
    let unknown = bucket_map([&response.intervals[0].models]);
    assert_eq!(
        unknown[&("unknown".to_string(), None, PricingSource::Estimate)].input,
        30
    );
}

#[tokio::test]
#[serial]
#[ignore = "AN0b"]
async fn an0b_streamed_turn_across_midnight_is_split_without_double_count() {
    let fixture = UsageFixture::write("an0b-dedup", dedup_rows());
    let _home = HomeGuard::set(fixture.root());
    let d16 = day("2026-10-16", "2026-10-16T00:00:00Z", "2026-10-17T00:00:00Z");
    let d17 = day("2026-10-17", "2026-10-17T00:00:00Z", "2026-10-18T00:00:00Z");
    let response = usage_breakdown(project_request(&fixture, vec![d16.clone(), d17.clone()]))
        .await
        .expect("AN0b");
    assert_bucket_maps_eq(
        &bucket_map([&response.intervals[0].models]),
        &reference_scan(&fixture.rows, half_open(&d16)).buckets,
    );
    assert_bucket_maps_eq(
        &bucket_map([&response.intervals[1].models]),
        &reference_scan(&fixture.rows, half_open(&d17)).buckets,
    );
    let legacy = legacy_summary(&fixture, None, None).await;
    let total: u64 = response
        .intervals
        .iter()
        .flat_map(|i| &i.models)
        .map(|m| m.stats.token_count)
        .sum();
    assert_eq!(total, legacy.total_tokens);
}

#[tokio::test]
#[serial]
#[ignore = "AN0b"]
async fn an0b_dedup_identity_follows_production_key_rules() {
    // Empty message id, message-id/uuid collision, one id in two sessions,
    // rows without any id: each row is its own identity.
    let rows: Vec<FixtureRow> = [
        empty_message_id_rows(),
        message_id_uuid_collision_rows(),
        same_message_id_two_sessions_rows(),
        unkeyed_rows(),
    ]
    .concat();
    let fixture = UsageFixture::write("an0b-identity", rows);
    let _home = HomeGuard::set(fixture.root());
    let d15 = day("2026-10-15", "2026-10-15T00:00:00Z", "2026-10-16T00:00:00Z");
    let response = usage_breakdown(project_request(&fixture, vec![d15.clone()]))
        .await
        .expect("AN0b");
    let expected = reference_scan(&fixture.rows, half_open(&d15)).buckets;
    assert_bucket_maps_eq(&bucket_map([&response.intervals[0].models]), &expected);
    let source = &expected[&(SONNET.to_string(), None, PricingSource::Source)];
    assert_eq!((source.message_count, source.input), (10, 1_000));
    assert_cost_eq(source.cost_usd, Some(10.0));
}

#[tokio::test]
#[serial]
#[ignore = "AN0b"]
async fn an0b_conversation_only_excludes_sidechain_like_legacy() {
    let rows = vec![
        row("s1", "main", "2026-10-15T12:00:00Z").tokens(100, 0, 0, 0),
        row("s1", "side", "2026-10-15T12:01:00Z")
            .sidechain()
            .tokens(50, 0, 0, 0),
    ];
    let fixture = UsageFixture::write("an0b-sidechain", rows);
    let _home = HomeGuard::set(fixture.root());
    let legacy = get_project_stats_summary(
        fixture.project_path(),
        None,
        None,
        Some("conversation_only".to_string()),
    )
    .await
    .expect("legacy");
    let mut request = project_request(&fixture, utc_days_15_to_17());
    request.stats_mode = UsageStatsMode::ConversationOnly;
    let response = usage_breakdown(request).await.expect("AN0b");
    let tokens: u64 = response
        .intervals
        .iter()
        .flat_map(|i| &i.models)
        .map(|m| m.stats.token_count)
        .sum();
    assert_eq!(tokens, legacy.total_tokens);
    assert_eq!(tokens, 100);
}

#[tokio::test]
#[serial]
#[ignore = "AN0b"]
async fn an0b_session_with_several_models_and_tiers_keeps_separate_buckets() {
    let rows = vec![
        row("s1", "x1", "2026-10-15T12:00:00Z")
            .tokens(100, 0, 0, 0)
            .cost(0.1),
        row("s1", "x2", "2026-10-15T12:01:00Z")
            .tier("fast")
            .tokens(100, 0, 0, 0),
        row("s1", "x3", "2026-10-15T12:02:00Z")
            .model(HAIKU)
            .tokens(100, 0, 0, 0),
    ];
    let fixture = UsageFixture::write("an0b-multi", rows);
    let _home = HomeGuard::set(fixture.root());
    let response = usage_breakdown(project_request(&fixture, utc_days_15_to_17()))
        .await
        .expect("AN0b");
    assert_eq!(response.sessions.len(), 1);
    assert_bucket_maps_eq(
        &bucket_map([&response.sessions[0].models]),
        &reference_scan(&fixture.rows, every_dated_row).buckets,
    );
}

#[tokio::test]
#[serial]
#[ignore = "AN0b"]
async fn an0b_source_cost_only_provider_reports_source_cost_all() {
    let rows = vec![
        row("s1", "p1", "2026-10-15T12:00:00Z")
            .tokens(100, 0, 0, 0)
            .cost(0.1),
        row("s1", "p2", "2026-10-16T12:00:00Z")
            .tokens(100, 0, 0, 0)
            .cost(0.2),
    ];
    let fixture = UsageFixture::write("an0b-source-only", rows);
    let _home = HomeGuard::set(fixture.root());
    let response = usage_breakdown(project_request(&fixture, utc_days_15_to_17()))
        .await
        .expect("AN0b");
    let claude = response
        .coverage
        .providers
        .iter()
        .find(|p| p.id == "claude")
        .expect("claude coverage");
    assert_eq!(claude.source_cost, SourceCostCoverage::All);
    assert!(response
        .intervals
        .iter()
        .flat_map(|i| &i.models)
        .all(|m| m.pricing_source == PricingSource::Source));
}

#[tokio::test]
#[serial]
#[ignore = "AN0b"]
async fn an0b_unreadable_session_file_reports_partial_coverage() {
    let fixture = UsageFixture::write("an0b-partial", same_policy_rows());
    let _home = HomeGuard::set(fixture.root());
    // A directory where a session file is expected cannot be read.
    std::fs::create_dir_all(std::path::Path::new(&fixture.project_path()).join("broken.jsonl"))
        .expect("broken entry");
    let response = usage_breakdown(project_request(&fixture, utc_days_15_to_17()))
        .await
        .expect("AN0b");
    let claude = &response.coverage.providers[0];
    assert_eq!(claude.status, ProviderScanStatus::Partial);
    assert_eq!(claude.sessions_failed, 1);
    assert_bucket_maps_eq(
        &bucket_map(response.intervals.iter().map(|i| &i.models)),
        &reference_scan(&fixture.rows, every_dated_row).buckets,
    );
}

#[tokio::test]
#[serial]
#[ignore = "AN0b"]
async fn an0b_all_scope_uses_default_and_custom_claude_roots_like_legacy() {
    let default_root = UsageFixture::write("default-root", same_policy_rows());
    let custom_root = UsageFixture::write("custom-root", mixed_by_day_rows());
    let _home = HomeGuard::set(default_root.root());
    let custom = vec![CustomClaudePathParam {
        path: custom_root.root().to_string_lossy().to_string(),
        label: Some("custom".to_string()),
    }];
    let legacy = get_global_stats_summary(
        default_root.root().to_string_lossy().to_string(),
        Some(vec!["claude".to_string()]),
        Some("billing_total".to_string()),
        None,
        None,
        Some(custom.clone()),
    )
    .await
    .expect("legacy global");
    let response = usage_breakdown(UsageBreakdownRequest {
        scope: UsageScope::All {
            providers: vec!["claude".to_string()],
            claude_path: default_root.root().to_string_lossy().to_string(),
            custom_claude_paths: custom,
        },
        stats_mode: UsageStatsMode::BillingTotal,
        intervals: utc_days_15_to_17(),
    })
    .await
    .expect("AN0b");
    let tokens: u64 = response
        .intervals
        .iter()
        .flat_map(|i| &i.models)
        .map(|m| m.stats.token_count)
        .sum();
    assert_eq!(tokens, legacy.total_tokens);
}

#[tokio::test]
#[serial]
#[ignore = "AN0b"]
async fn an0b_invalid_request_is_rejected_before_reading_files() {
    let fixture = UsageFixture::write("an0b-invalid", same_policy_rows());
    let _home = HomeGuard::set(fixture.root());
    let overlapping = vec![
        day("a", "2026-10-15T00:00:00Z", "2026-10-16T00:00:00Z"),
        day("b", "2026-10-15T12:00:00Z", "2026-10-17T00:00:00Z"),
    ];
    let request = project_request(&fixture, overlapping);
    let expected = request.validate().expect_err("overlap").to_string();
    assert_eq!(
        usage_breakdown(request).await.expect_err("rejected"),
        expected
    );
}
