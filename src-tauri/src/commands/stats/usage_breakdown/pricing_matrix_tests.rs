//! Table-wide pricing drift matrix (`AN0b` review, ADR 0003 §3).
//!
//! The golden reconciliation file pins the ranking mirror to the frontend on
//! the sessions of a few scenarios. This matrix covers the table: for every
//! model in `src/data/model-pricing.json`, its base rates (every token class,
//! with and without a context breakdown), each context tier at and just below
//! its threshold, each service tier and its context tiers, and a dated,
//! decorated form of its name; plus the bucket rules that do not depend on a
//! model (source cost, source-cost-only providers, token-unsupported models,
//! name forms). Each case is priced with [`bucket_cost`] and written to
//! `src/test/fixtures/usageBreakdown.pricingMatrix.json`;
//! `usageBreakdown.pricingMatrix.test.ts` rebuilds every case and requires
//! `summarizeBucketCost` to produce the same `f64`.
//!
//! A price-table change makes the stored file stale (here, compared as text)
//! and the frontend's prices differ from it (there). Regenerate with
//! `CCHV_UPDATE_GOLDEN=1 cargo test --lib pricing_matrix -- --test-threads=1`.

use super::{bucket_cost, matches_model_key, price_table, Pricing, SOURCE_COST_ONLY_PROVIDER_IDS};
use crate::commands::stats::usage_breakdown::{PricedModelStats, PricingSource};
use crate::models::{ModelContextStats, ModelStats};
use serde::Serialize;
use std::path::PathBuf;

/// The tokens of every context bucket of a case: each rate of a row adds a
/// distinct amount (reasoning bills at the output rate, the 1-hour writes at
/// the 1-hour rate or the default write rate).
#[derive(Debug, Clone, Copy, Serialize)]
struct Tokens {
    input: u64,
    output: u64,
    cache_creation_5m: u64,
    cache_creation_1h: u64,
    cache_read: u64,
    reasoning: u64,
}

const TOKENS: Tokens = Tokens {
    input: 1_234_567,
    output: 234_567,
    cache_creation_5m: 34_567,
    cache_creation_1h: 4_567,
    cache_read: 567_891,
    reasoning: 6_789,
};

impl Tokens {
    fn total(self) -> u64 {
        self.input
            + self.output
            + self.cache_creation_5m
            + self.cache_creation_1h
            + self.cache_read
            + self.reasoning
    }
}

/// How many rate rows of each kind the table has; the frontend test counts
/// the live table the same way, so a new model or tier fails there until the
/// file is regenerated.
#[derive(Debug, Serialize)]
struct Coverage {
    models: usize,
    context_tiers: usize,
    service_tiers: usize,
    service_tier_context_tiers: usize,
}

/// One bucket to price. Every context bucket holds [`TOKENS`]; without
/// `contexts` the bucket has totals only (the default-tier path).
#[derive(Debug, Clone, Serialize)]
struct Case {
    rule: String,
    model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    contexts: Option<Vec<u64>>,
    #[serde(skip_serializing_if = "is_estimate")]
    pricing_source: PricingSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    cost_usd: Option<f64>,
    /// [`bucket_cost`] of the bucket; `None` = no price.
    cost: Option<f64>,
}

// serde's `skip_serializing_if` passes a reference.
#[allow(clippy::trivially_copy_pass_by_ref)]
fn is_estimate(source: &PricingSource) -> bool {
    *source == PricingSource::Estimate
}

impl Case {
    fn new(rule: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            rule: rule.into(),
            model: model.into(),
            provider: None,
            tier: None,
            contexts: Some(vec![0]),
            pricing_source: PricingSource::Estimate,
            cost_usd: None,
            cost: None,
        }
    }

    fn contexts(mut self, contexts: Vec<u64>) -> Self {
        self.contexts = Some(contexts);
        self
    }

    fn totals_only(mut self) -> Self {
        self.contexts = None;
        self
    }

    fn tier(mut self, tier: &str) -> Self {
        self.tier = Some(tier.to_string());
        self
    }

    fn provider(mut self, provider: &str) -> Self {
        self.provider = Some(provider.to_string());
        self
    }

    fn source(mut self, cost_usd: Option<f64>) -> Self {
        self.pricing_source = PricingSource::Source;
        self.cost_usd = cost_usd;
        self
    }

    fn reported_cost(mut self, cost_usd: f64) -> Self {
        self.cost_usd = Some(cost_usd);
        self
    }

    fn bucket(&self) -> PricedModelStats {
        let breakdown: Vec<ModelContextStats> = self
            .contexts
            .iter()
            .flatten()
            .map(|&min_context_tokens| ModelContextStats {
                min_context_tokens,
                token_count: TOKENS.total(),
                input_tokens: TOKENS.input,
                output_tokens: TOKENS.output,
                cache_creation_tokens: TOKENS.cache_creation_5m + TOKENS.cache_creation_1h,
                cache_creation_tokens_5m: TOKENS.cache_creation_5m,
                cache_creation_tokens_1h: TOKENS.cache_creation_1h,
                cache_read_tokens: TOKENS.cache_read,
                reasoning_tokens: TOKENS.reasoning,
            })
            .collect();
        let n = breakdown.len().max(1) as u64;
        PricedModelStats {
            pricing_source: self.pricing_source,
            stats: ModelStats {
                provider_id: self.provider.clone(),
                model_name: self.model.clone(),
                service_tier: self.tier.clone(),
                message_count: 1,
                token_count: TOKENS.total() * n,
                input_tokens: TOKENS.input * n,
                output_tokens: TOKENS.output * n,
                cache_creation_tokens: (TOKENS.cache_creation_5m + TOKENS.cache_creation_1h) * n,
                cache_read_tokens: TOKENS.cache_read * n,
                reasoning_tokens: TOKENS.reasoning * n,
                cost_usd: self.cost_usd,
                context_breakdown: breakdown,
            },
        }
    }
}

fn tier_thresholds(pricing: &Pricing) -> Vec<u64> {
    pricing
        .context_tiers
        .iter()
        .map(|tier| tier.min_context_tokens.unwrap_or(0))
        .collect()
}

/// A tier name no row has.
const UNKNOWN_TIER: &str = "matrix-unknown-tier";

/// Every rate row of one model.
fn model_cases(key: &str, row: &Pricing) -> Vec<Case> {
    let mut cases = vec![
        Case::new(format!("{key}: base rates"), key),
        Case::new(format!("{key}: totals without a breakdown"), key).totals_only(),
        Case::new(
            format!("{key}: dated, decorated name"),
            format!(" Models/{}-20990101[1m] ", key.to_uppercase()),
        ),
    ];
    let base_thresholds = tier_thresholds(row);
    for &min in &base_thresholds {
        cases.push(Case::new(format!("{key}: context tier from {min}"), key).contexts(vec![min]));
        cases.push(
            Case::new(format!("{key}: just below context tier {min}"), key)
                .contexts(vec![min.saturating_sub(1)]),
        );
    }
    if !base_thresholds.is_empty() {
        let every = std::iter::once(0)
            .chain(base_thresholds.iter().copied())
            .collect();
        cases
            .push(Case::new(format!("{key}: every context tier in one list"), key).contexts(every));
    }

    let mut service_tiers: Vec<(&String, &Pricing)> = row.service_tiers.iter().collect();
    service_tiers.sort_by(|a, b| a.0.cmp(b.0));
    for (name, service) in &service_tiers {
        cases.push(Case::new(format!("{key}: service tier {name}"), key).tier(name));
        if name.as_str() == "fast" {
            cases.push(
                Case::new(format!("{key}: priority is the fast tier"), key).tier(" Priority "),
            );
        }
        let service_thresholds = tier_thresholds(service);
        for &min in &service_thresholds {
            cases.push(
                Case::new(
                    format!("{key}: service tier {name}, context tier from {min}"),
                    key,
                )
                .tier(name)
                .contexts(vec![min]),
            );
            cases.push(
                Case::new(
                    format!("{key}: service tier {name}, just below context tier {min}"),
                    key,
                )
                .tier(name)
                .contexts(vec![min.saturating_sub(1)]),
            );
        }
        // The service tier's rows replace the base rows, context tiers included.
        let mut every: Vec<u64> = std::iter::once(0)
            .chain(base_thresholds.iter().copied())
            .chain(service_thresholds)
            .collect();
        every.sort_unstable();
        every.dedup();
        cases.push(
            Case::new(
                format!("{key}: service tier {name} over every context tier"),
                key,
            )
            .tier(name)
            .contexts(every),
        );
    }
    if !service_tiers.is_empty() {
        cases.push(
            Case::new(
                format!("{key}: an unknown service tier is the base rates"),
                key,
            )
            .tier(UNKNOWN_TIER),
        );
    }
    cases
}

/// A key that starts with a shorter key priced differently (`claude-opus-4-5`
/// and `claude-opus-4`), so a name resolved to the wrong key changes the
/// price instead of landing on equal rates.
fn discriminating_key() -> &'static str {
    let models = &price_table().models;
    let mut keys: Vec<&'static String> = models.keys().collect();
    keys.sort();
    keys.iter()
        .copied()
        .find(|long| {
            keys.iter().any(|short| {
                short.len() < long.len()
                    && matches_model_key(long, short)
                    && (models[*short].input, models[*short].output)
                        != (models[*long].input, models[*long].output)
            })
        })
        .expect("a key that starts with a differently priced shorter key")
}

/// Rules that do not depend on one model, on [`discriminating_key`].
fn bucket_rule_cases() -> Vec<Case> {
    let key = discriminating_key();
    let mut cases = Vec::new();
    for provider in SOURCE_COST_ONLY_PROVIDER_IDS {
        cases.push(
            Case::new(format!("provider {provider} has no estimate"), key).provider(provider),
        );
    }
    cases.extend([
        Case::new("a provider id is trimmed and lower-cased", key).provider(" Cursor "),
        Case::new("another provider is priced from the table", key).provider("claude"),
        Case::new("a source cost is the price", key).source(Some(1.234_567)),
        Case::new("a source cost needs no table row", "matrix-unknown-model").source(Some(0.5)),
        Case::new("a source cost of a source-cost-only provider", key)
            .provider("cursor")
            .source(Some(2.5)),
        Case::new(
            "a source bucket without a cost is priced from the table",
            key,
        )
        .source(None),
        Case::new("an estimate bucket ignores a reported cost", key).reported_cost(9.0),
        Case::new("an empty service tier is the base rates", key).tier("   "),
        Case::new("an unknown model has no price", "matrix-unknown-model"),
    ]);
    for model in [
        format!("openrouter/anthropic/{key}"),
        format!("{key}@20250929"),
        format!("{key}:latest"),
        format!("models/models/{key}"),
        format!("{key}[1m][2m]"),
        format!("{key}[a]b]"),
        format!("not-{key}"),
        format!("{key}x"),
        format!("{key}-"),
    ] {
        cases.push(Case::new(format!("name form {model}"), model));
    }
    for model in [
        "gemini-2.5-flash-preview-tts",
        "gemini-2.5-pro-preview-tts-0520",
        "gemini-2.5-flash-native-audio-dialog",
        "gemini-2.5-flash-image",
        "gemini-3-pro-image-preview",
        "gemini-2.0-flash-live-001",
        "gemini-omni-flash",
        "gemini-nano-banana-2",
        "gemini-3.5-live-translate",
        "gemini-3.1-flash-live",
        "gpt-4o-audio-preview",
        "gpt-4o-mini-realtime-preview",
        "gpt-4.1-mini-tts",
        "gpt-realtime-mini",
        "gpt-image-1",
        "sora-2",
        "grok-imagine-video",
        "openai/gpt-4o-transcribe",
    ] {
        cases.push(Case::new(format!("token-unsupported model {model}"), model));
    }
    cases
}

fn coverage() -> Coverage {
    let rows = price_table().models.values();
    let services: Vec<&Pricing> = rows
        .clone()
        .flat_map(|row| row.service_tiers.values())
        .collect();
    Coverage {
        models: price_table().models.len(),
        context_tiers: rows.map(|row| row.context_tiers.len()).sum(),
        service_tiers: services.len(),
        service_tier_context_tiers: services.iter().map(|tier| tier.context_tiers.len()).sum(),
    }
}

fn matrix_cases() -> Vec<Case> {
    let table = price_table();
    let mut keys: Vec<&String> = table.models.keys().collect();
    keys.sort();
    let mut cases: Vec<Case> = keys
        .iter()
        .flat_map(|key| model_cases(key, &table.models[*key]))
        .chain(bucket_rule_cases())
        .collect();
    for case in &mut cases {
        case.cost = bucket_cost(&case.bucket());
    }
    cases
}

/// One-line JSON.
fn line<T: Serialize + ?Sized>(value: &T) -> String {
    serde_json::to_string(value).expect("serializable")
}

/// The fixture text: one case per line, so a price change diffs by rule.
fn matrix_text(cases: &[Case]) -> String {
    let body: Vec<String> = cases
        .iter()
        .map(|case| format!("    {}", line(case)))
        .collect();
    format!(
        "{{\n  \"_comment\": {},\n  \"tokens\": {},\n  \"coverage\": {},\n  \"cases\": [\n{}\n  ]\n}}\n",
        line(COMMENT),
        line(&TOKENS),
        line(&coverage()),
        body.join(",\n")
    )
}

const COMMENT: &str = "Generated by src-tauri/src/commands/stats/usage_breakdown/pricing_matrix_tests.rs: every rate row of src/data/model-pricing.json priced by ranking.rs. Do not edit by hand; regenerate with CCHV_UPDATE_GOLDEN=1.";

fn matrix_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../src/test/fixtures/usageBreakdown.pricingMatrix.json")
}

/// The stored matrix is the mirror's prices over the current table
/// (compared as text: `serde_json`'s default parser can read a computed float
/// back a unit in the last place off).
#[test]
fn pricing_matrix_fixture_matches_the_ranking_mirror() {
    let text = matrix_text(&matrix_cases());
    let path = matrix_path();
    if std::env::var_os("CCHV_UPDATE_GOLDEN").is_some_and(|v| v == "1") {
        std::fs::write(&path, &text).expect("write pricing matrix");
    }
    let stored = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| {
            panic!(
                "{}: {e} (regenerate with CCHV_UPDATE_GOLDEN=1)",
                path.display()
            )
        })
        .replace("\r\n", "\n");
    if let Some((line, (stored, built))) = stored
        .lines()
        .zip(text.lines())
        .enumerate()
        .find(|(_, (stored, built))| stored != built)
    {
        panic!(
            "{} is stale at line {}:\n  stored: {stored}\n  mirror: {built}\n(regenerate with CCHV_UPDATE_GOLDEN=1 if the table change is intended)",
            path.display(),
            line + 1
        );
    }
    assert_eq!(
        stored.lines().count(),
        text.lines().count(),
        "{} has a different number of cases (regenerate with CCHV_UPDATE_GOLDEN=1)",
        path.display()
    );
}

/// Every model prices its own name, and a dated, decorated form of it
/// resolves to the same row, never to a shorter key it starts with.
#[test]
fn every_model_prices_its_own_name_and_its_dated_forms() {
    let cases = matrix_cases();
    let cost = |rule: &str| {
        cases
            .iter()
            .find(|case| case.rule == rule)
            .unwrap_or_else(|| panic!("no case {rule}"))
            .cost
    };
    let mut unpriced = Vec::new();
    let mut misrouted = Vec::new();
    for key in price_table().models.keys() {
        let base = cost(&format!("{key}: base rates"));
        if base.is_none() {
            unpriced.push(key.clone());
        }
        if cost(&format!("{key}: dated, decorated name")) != base {
            misrouted.push(key.clone());
        }
    }
    assert_eq!(unpriced, Vec::<String>::new());
    assert_eq!(misrouted, Vec::<String>::new());
}

/// The matrix holds one case per rate row it claims to cover.
#[test]
fn the_matrix_has_a_case_for_every_rate_row() {
    let cases = matrix_cases();
    let count = |needle: &str| {
        cases
            .iter()
            .filter(|case| case.rule.contains(needle))
            .count()
    };
    let coverage = coverage();
    assert_eq!(count(": base rates"), coverage.models);
    assert_eq!(count(": context tier from "), coverage.context_tiers);
    assert_eq!(count(": just below context tier "), coverage.context_tiers);
    let service_tier_rows = cases
        .iter()
        .filter(|case| case.rule.contains(": service tier ") && !case.rule.contains(','))
        .filter(|case| !case.rule.contains(" over every "))
        .count();
    assert_eq!(service_tier_rows, coverage.service_tiers);
    assert_eq!(
        count(", context tier from "),
        coverage.service_tier_context_tiers
    );
    assert_eq!(
        count(", just below context tier "),
        coverage.service_tier_context_tiers
    );
}
