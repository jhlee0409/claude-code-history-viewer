//! Contract tests: wire shape (shared with TypeScript), strict enums,
//! request validation and the half-open membership rule.

use super::fixture::{interval, ms};
use super::*;
use serde_json::{json, Value};

const CONTRACT_FIXTURE: &str =
    include_str!("../../../../../src/test/fixtures/usageBreakdown.contract.json");

fn contract() -> Value {
    serde_json::from_str(CONTRACT_FIXTURE).expect("contract fixture is JSON")
}

fn request_with(intervals: Vec<UsageInterval>) -> UsageBreakdownRequest {
    UsageBreakdownRequest {
        scope: UsageScope::Project {
            project_path: "/tmp/p".to_string(),
            provider: "claude".to_string(),
        },
        stats_mode: UsageStatsMode::BillingTotal,
        intervals,
    }
}

// ---- wire shape -----------------------------------------------------------

#[test]
fn contract_fixture_requests_round_trip_through_rust_types() {
    let fixture = contract();
    let requests = fixture["requests"].as_array().expect("requests");
    assert_eq!(requests.len(), 2, "project and all scopes");
    for raw in requests {
        let parsed: UsageBreakdownRequest =
            serde_json::from_value(raw.clone()).expect("request parses");
        assert_eq!(&serde_json::to_value(&parsed).unwrap(), raw);
    }
}

#[test]
fn contract_fixture_response_round_trips_through_rust_types() {
    let raw = contract()["response"].clone();
    let parsed: UsageBreakdownResponse =
        serde_json::from_value(raw.clone()).expect("response parses");
    assert_eq!(serde_json::to_value(&parsed).unwrap(), raw);
}

#[test]
fn custom_claude_path_label_may_be_omitted() {
    let mut raw = contract()["requests"][1].clone();
    raw["scope"]["custom_claude_paths"] = json!([{ "path": "/x/.claude" }]);
    let parsed: UsageBreakdownRequest = serde_json::from_value(raw).expect("label is optional");
    let UsageScope::All {
        custom_claude_paths,
        ..
    } = parsed.scope
    else {
        panic!("all scope");
    };
    assert_eq!(custom_claude_paths[0].label, None);
}

#[test]
fn estimate_bucket_omits_cost_and_source_bucket_carries_it() {
    let parsed: UsageBreakdownResponse =
        serde_json::from_value(contract()["response"].clone()).unwrap();
    let models = &parsed.intervals[0].models;
    let source = models
        .iter()
        .find(|m| m.pricing_source == PricingSource::Source)
        .unwrap();
    let estimate = models
        .iter()
        .find(|m| m.pricing_source == PricingSource::Estimate)
        .unwrap();
    assert_eq!(source.stats.cost_usd, Some(1.0));
    assert_eq!(estimate.stats.cost_usd, None);
    let wire = serde_json::to_value(estimate).unwrap();
    assert!(wire["stats"].get("cost_usd").is_none(), "absent, not null");
}

#[test]
fn session_ref_is_named_ref_on_the_wire() {
    let parsed: UsageBreakdownResponse =
        serde_json::from_value(contract()["response"].clone()).unwrap();
    let wire = serde_json::to_value(&parsed.sessions[0]).unwrap();
    assert_eq!(wire["ref"]["session_id"], json!("s1"));
    assert!(wire.get("session_ref").is_none());
}

#[test]
fn unknown_enum_values_are_rejected() {
    let mut raw = contract()["requests"][0].clone();
    raw["stats_mode"] = json!("everything");
    assert!(serde_json::from_value::<UsageBreakdownRequest>(raw).is_err());

    let mut raw = contract()["requests"][0].clone();
    raw["scope"]["kind"] = json!("workspace");
    assert!(serde_json::from_value::<UsageBreakdownRequest>(raw).is_err());

    let bucket = json!({ "pricing_source": "guess", "stats": contract()["response"]["intervals"][0]["models"][0]["stats"] });
    assert!(serde_json::from_value::<PricedModelStats>(bucket).is_err());
}

#[test]
fn command_name_is_stable() {
    assert_eq!(USAGE_BREAKDOWN_COMMAND, "get_usage_breakdown");
}

// ---- request validation ---------------------------------------------------

#[test]
fn validate_accepts_touching_and_zero_length_intervals() {
    let req = request_with(vec![
        interval("2011-12-29", "2011-12-29T10:00:00Z", "2011-12-30T10:00:00Z"),
        interval("2011-12-30", "2011-12-30T10:00:00Z", "2011-12-30T10:00:00Z"),
        interval("2011-12-31", "2011-12-30T10:00:00Z", "2011-12-31T10:00:00Z"),
    ]);
    assert_eq!(req.validate(), Ok(()));
}

#[test]
fn validate_rejects_empty_list() {
    assert_eq!(
        request_with(vec![]).validate(),
        Err(UsageBreakdownRequestError::NoIntervals)
    );
}

#[test]
fn validate_rejects_too_many_intervals() {
    let many = (0..=MAX_INTERVALS)
        .map(|i| {
            let start = i64::try_from(i).expect("small index");
            UsageInterval {
                key: format!("k{i}"),
                start_utc: start,
                end_utc: start + 1,
            }
        })
        .collect();
    assert_eq!(
        request_with(many).validate(),
        Err(UsageBreakdownRequestError::TooManyIntervals {
            count: MAX_INTERVALS + 1
        })
    );
}

#[test]
fn validate_rejects_empty_duplicate_reversed_and_overlapping() {
    let a = interval("a", "2026-10-17T00:00:00Z", "2026-10-18T00:00:00Z");
    let mut empty = a.clone();
    empty.key.clear();
    assert_eq!(
        request_with(vec![empty]).validate(),
        Err(UsageBreakdownRequestError::EmptyKey { index: 0 })
    );

    let mut dup = interval("a", "2026-10-18T00:00:00Z", "2026-10-19T00:00:00Z");
    assert_eq!(
        request_with(vec![a.clone(), dup.clone()]).validate(),
        Err(UsageBreakdownRequestError::DuplicateKey { key: "a".into() })
    );

    dup.key = "b".into();
    std::mem::swap(&mut dup.start_utc, &mut dup.end_utc);
    assert_eq!(
        request_with(vec![a.clone(), dup]).validate(),
        Err(UsageBreakdownRequestError::ReversedInterval { key: "b".into() })
    );

    let overlap = interval("b", "2026-10-17T23:00:00Z", "2026-10-19T00:00:00Z");
    assert_eq!(
        request_with(vec![a.clone(), overlap]).validate(),
        Err(UsageBreakdownRequestError::UnsortedOrOverlapping {
            previous: "a".into(),
            next: "b".into()
        })
    );

    let earlier = interval("z", "2026-10-15T00:00:00Z", "2026-10-16T00:00:00Z");
    assert!(matches!(
        request_with(vec![a, earlier]).validate(),
        Err(UsageBreakdownRequestError::UnsortedOrOverlapping { .. })
    ));
}

#[test]
fn validation_errors_name_the_interval() {
    let err = UsageBreakdownRequestError::UnsortedOrOverlapping {
        previous: "2026-10-17".into(),
        next: "2026-10-18".into(),
    };
    assert_eq!(
        err.to_string(),
        "usage breakdown: interval '2026-10-18' starts before '2026-10-17' ends"
    );
}

// ---- half-open membership ---------------------------------------------------

fn utc(rfc3339: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(rfc3339)
        .unwrap()
        .with_timezone(&Utc)
}

#[test]
fn half_open_includes_start_and_excludes_end() {
    // Kolkata 2026-10-17 = [2026-10-16T18:30Z, 2026-10-17T18:30Z).
    let day = interval("2026-10-17", "2026-10-16T18:30:00Z", "2026-10-17T18:30:00Z");
    assert!(day.contains(&utc("2026-10-16T18:30:00Z")));
    assert!(day.contains(&utc("2026-10-17T18:20:00Z")));
    assert!(!day.contains(&utc("2026-10-17T18:30:00Z")));
    assert!(!day.contains(&utc("2026-10-17T18:40:00Z")));
}

#[test]
fn half_open_sub_millisecond_digits_never_change_membership() {
    let day = interval("d", "2026-10-17T00:00:00Z", "2026-10-18T00:00:00Z");
    assert!(day.contains(&utc("2026-10-17T23:59:59.999999Z")));
    assert!(day.contains(&utc("2026-10-17T23:59:59.999999999Z")));
    assert!(!day.contains(&utc("2026-10-18T00:00:00.000500Z")));
    assert!(!day.contains(&utc("2026-10-16T23:59:59.999999Z")));
    assert_eq!(
        timestamp_ms_floor(&utc("2026-10-17T23:59:59.999999Z")),
        ms("2026-10-18T00:00:00Z") - 1
    );
}

#[test]
fn timestamp_floor_rounds_toward_negative_infinity_before_1970() {
    assert_eq!(timestamp_ms_floor(&utc("1969-12-31T23:59:59.999500Z")), -1);
}

#[test]
fn zero_length_interval_contains_nothing() {
    let gap = interval("2011-12-30", "2011-12-30T10:00:00Z", "2011-12-30T10:00:00Z");
    assert!(!gap.contains(&utc("2011-12-30T10:00:00Z")));
}

#[test]
fn legacy_date_filter_includes_the_end_where_the_new_rule_does_not() {
    // The old commands keep `ts <= end` (`is_within_date_limits`); this pins
    // the difference instead of changing them.
    let start = utc("2026-10-17T00:00:00Z");
    let end = utc("2026-10-18T00:00:00Z");
    let at_end = utc("2026-10-18T00:00:00Z");
    assert!(crate::commands::stats::is_within_date_limits(
        Some(at_end),
        Some(&start),
        Some(&end)
    ));
    let day = interval("d", "2026-10-17T00:00:00Z", "2026-10-18T00:00:00Z");
    assert!(!day.contains(&at_end));

    // start == end: the old filter keeps a row at that instant, the new one is empty.
    assert!(crate::commands::stats::is_within_date_limits(
        Some(start),
        Some(&start),
        Some(&start)
    ));
}
