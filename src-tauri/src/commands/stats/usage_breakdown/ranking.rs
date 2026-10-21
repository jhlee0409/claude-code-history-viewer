//! Session ranking for the session cap (ADR 0003).
//!
//! `sessions` keeps the sessions that carry the cost, so the cut needs each
//! session's cost: the provider-reported part (source buckets) plus the
//! price-table estimate (estimate buckets). Pricing belongs to the frontend
//! (ADR 0002 §5). This module **mirrors** `summarizeBucketCost` →
//! `calculateGlobalCostSummary` (`src/components/AnalyticsDashboard/utils/
//! globalCalculations.ts` and `calculations.ts`) over the **same** price
//! table, `src/data/model-pricing.json`, embedded at compile time the way the
//! menu embeds `src/commands/manifest.json`. The value only orders sessions:
//! it is never sent, and every cost the user sees is still the frontend's.
//!
//! Drift guards: the table is the same file; the two rule lists that live in
//! TypeScript code are compared with `calculations.ts` by a test here; the
//! golden file pins [`session_cost`] to `summarizeBucketCost` for the
//! sessions of the golden scenarios (`usageBreakdown.reconciliation.test.ts`);
//! and the pricing matrix pins every rate row of every model in the table —
//! base, context tiers, service tiers and their context tiers, name
//! matching — to the same function (`pricing_matrix_tests.rs`,
//! `usageBreakdown.pricingMatrix.test.ts`).

use super::{PricedModelStats, PricingSource, SessionRef};
use crate::models::ModelStats;
use regex::RegexSet;
use serde::Deserialize;
use std::cmp::Ordering;
use std::collections::HashMap;
use std::sync::OnceLock;

/// The frontend's price table (USD per 1M tokens), the file it imports.
const PRICE_TABLE_JSON: &str = include_str!("../../../../../src/data/model-pricing.json");

/// `TOKEN_UNSUPPORTED_MODEL_PATTERNS` in `calculations.ts`: audio, image,
/// video or flat-unit models the token fields cannot bill.
const TOKEN_UNSUPPORTED_MODEL_PATTERNS: [&str; 10] = [
    r"^(?:gemini-2\.5-(?:flash|pro)-preview-tts)(?:-|$)",
    r"^gemini-2\.5-flash-(?:native-audio|image)(?:-|$)",
    r"^gemini-.*-(?:tts|native-audio|audio|live|image|image-generation|video-generation)(?:-|$)",
    r"^gemini-omni-flash(?:-|$)",
    r"^gemini-nano-banana(?:-|$)",
    r"^gemini-(?:3\.5-live-translate|3\.1-flash-live)(?:-|$)",
    r"^gpt-(?:4o(?:-mini)?|4\.1(?:-mini)?)-(?:audio|realtime|tts|transcribe|search-preview)(?:-|$)",
    r"^gpt-(?:realtime|image)(?:-|$)",
    r"^sora(?:-|$)",
    r"^grok-imagine(?:-|$)",
];

/// `SOURCE_COST_ONLY_PROVIDER_IDS` in `calculations.ts`: providers whose
/// usage only their own reported cost can price.
const SOURCE_COST_ONLY_PROVIDER_IDS: [&str; 6] = [
    "antigravity",
    "copilot",
    "cursor",
    "cursor-agent",
    "kilo",
    "opencode",
];

/// One rate row of the table (`ModelPricing` in `calculations.ts`).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pricing {
    input: f64,
    output: f64,
    #[serde(default)]
    cache_write: Option<f64>,
    cache_read: f64,
    #[serde(default)]
    min_context_tokens: Option<u64>,
    #[serde(default)]
    cache_write_one_hour: Option<f64>,
    #[serde(default)]
    context_tiers: Vec<Pricing>,
    #[serde(default)]
    service_tiers: HashMap<String, Pricing>,
}

#[derive(Debug, Deserialize)]
struct PriceTable {
    models: HashMap<String, Pricing>,
}

fn price_table() -> &'static PriceTable {
    static TABLE: OnceLock<PriceTable> = OnceLock::new();
    TABLE.get_or_init(|| {
        serde_json::from_str(PRICE_TABLE_JSON).expect("src/data/model-pricing.json")
    })
}

fn unsupported_models() -> &'static RegexSet {
    static PATTERNS: OnceLock<RegexSet> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        RegexSet::new(TOKEN_UNSUPPORTED_MODEL_PATTERNS).expect("TOKEN_UNSUPPORTED_MODEL_PATTERNS")
    })
}

/// `normalizeModelName`: trim, lower-case, drop a leading `models/` and one
/// final bracket group (`claude-opus-5-5[1m]` is a client-side marker).
fn normalize_model_name(model_name: &str) -> String {
    let lower = model_name.trim().to_lowercase();
    let name = lower.strip_prefix("models/").unwrap_or(&lower);
    strip_final_bracket_group(name).to_string()
}

/// `name.replace(/\[[^\]]*\]$/, "")`: the earliest `[` whose run up to the
/// final `]` contains no other `]`.
fn strip_final_bracket_group(name: &str) -> &str {
    let Some(body) = name.strip_suffix(']') else {
        return name;
    };
    let after_last_close = body.rfind(']').map_or(0, |index| index + 1);
    match body[after_last_close..].find('[') {
        Some(open) => &name[..after_last_close + open],
        None => name,
    }
}

/// The last `/` segment (`split("/").at(-1)`).
fn model_segment(normalized: &str) -> &str {
    normalized.rsplit('/').next().unwrap_or(normalized)
}

/// `matchesModelKey`: the segment is the key or the key plus `-`, `@`, `:`.
fn matches_model_key(segment: &str, key: &str) -> bool {
    segment
        .strip_prefix(key)
        .is_some_and(|rest| rest.is_empty() || rest.starts_with(['-', '@', ':']))
}

/// `findModelPricing`: the longest matching key; inside it the requested
/// service tier (`priority` = `fast`) or the base rates, then the highest
/// context tier the request reached.
fn find_pricing(
    model_name: &str,
    provider_id: Option<&str>,
    context_tokens: u64,
    service_tier: Option<&str>,
) -> Option<&'static Pricing> {
    let provider = provider_id.map(|id| id.trim().to_lowercase());
    if provider.is_some_and(|id| SOURCE_COST_ONLY_PROVIDER_IDS.contains(&id.as_str())) {
        return None;
    }
    let normalized = normalize_model_name(model_name);
    let segment = model_segment(&normalized);
    if unsupported_models().is_match(segment) {
        return None;
    }
    let tier = service_tier
        .map(|tier| tier.trim().to_lowercase())
        .filter(|tier| !tier.is_empty())
        .map(|tier| {
            if tier == "priority" {
                "fast".to_string()
            } else {
                tier
            }
        });

    // (key length, context threshold) of the best candidate so far; keys of
    // equal length cannot both match one segment, so this is the frontend's
    // sort-then-first.
    let mut best: Option<((usize, u64), &'static Pricing)> = None;
    for (key, base) in &price_table().models {
        if !matches_model_key(segment, key) {
            continue;
        }
        let pricing = tier
            .as_deref()
            .and_then(|tier| base.service_tiers.get(tier))
            .unwrap_or(base);
        for candidate in std::iter::once(pricing).chain(&pricing.context_tiers) {
            if candidate
                .min_context_tokens
                .is_some_and(|min| context_tokens < min)
            {
                continue;
            }
            let rank = (key.len(), candidate.min_context_tokens.unwrap_or(0));
            match best {
                Some((best_rank, _)) if best_rank >= rank => {}
                _ => best = Some((rank, candidate)),
            }
        }
    }
    best.map(|(_, pricing)| pricing)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum CacheWriteTtl {
    FiveMinutes,
    OneHour,
}

/// `calculateModelPrice` with a found rate row. Same operations in the same
/// order, so both sides produce the same `f64`.
fn token_price(
    pricing: &Pricing,
    [input, output, cache_creation, cache_read, reasoning]: [u64; 5],
    ttl: CacheWriteTtl,
) -> f64 {
    let per_million = |tokens: u64| tokens as f64 / 1_000_000.0;
    let input_cost = per_million(input) * pricing.input;
    let output_cost = per_million(output + reasoning) * pricing.output;
    let cache_write_rate = match ttl {
        CacheWriteTtl::OneHour => pricing.cache_write_one_hour.or(pricing.cache_write),
        CacheWriteTtl::FiveMinutes => pricing.cache_write,
    };
    let cache_write_cost = cache_write_rate.map_or(0.0, |rate| per_million(cache_creation) * rate);
    let cache_read_cost = per_million(cache_read) * pricing.cache_read;
    input_cost + output_cost + cache_write_cost + cache_read_cost
}

/// `calculateContextBreakdownPrice`: each context bucket at its own tier,
/// 1-hour cache writes at the 1-hour rate; rows without a breakdown are
/// priced in the default tier.
fn table_price(stats: &ModelStats) -> Option<f64> {
    let provider = stats.provider_id.as_deref();
    let tier = stats.service_tier.as_deref();
    if stats.context_breakdown.is_empty() {
        let pricing = find_pricing(&stats.model_name, provider, 0, tier)?;
        return Some(token_price(
            pricing,
            [
                stats.input_tokens,
                stats.output_tokens,
                stats.cache_creation_tokens,
                stats.cache_read_tokens,
                stats.reasoning_tokens,
            ],
            CacheWriteTtl::FiveMinutes,
        ));
    }
    let mut total = 0.0;
    for bucket in &stats.context_breakdown {
        let pricing = find_pricing(&stats.model_name, provider, bucket.min_context_tokens, tier)?;
        let base = token_price(
            pricing,
            [
                bucket.input_tokens,
                bucket.output_tokens,
                bucket.cache_creation_tokens_5m,
                bucket.cache_read_tokens,
                bucket.reasoning_tokens,
            ],
            CacheWriteTtl::FiveMinutes,
        );
        let one_hour = if bucket.cache_creation_tokens_1h > 0 {
            token_price(
                pricing,
                [0, 0, bucket.cache_creation_tokens_1h, 0, 0],
                CacheWriteTtl::OneHour,
            )
        } else {
            0.0
        };
        total += base + one_hour;
    }
    Some(total)
}

/// Cost of one session for ranking: the sum of [`bucket_cost`] over its
/// buckets, in order; an unpriced bucket counts 0 (the frontend's
/// `totalEstimatedCost`).
pub(super) fn session_cost(models: &[PricedModelStats]) -> f64 {
    let mut total = 0.0;
    for bucket in models {
        if let Some(cost) = bucket_cost(bucket) {
            total += cost;
        }
    }
    total
}

/// Cost of one bucket as the frontend prices it, `None` when it has no
/// price: a source bucket's reported cost, else the table estimate
/// (`toCostInputs` never lets an estimate bucket keep a cost).
fn bucket_cost(bucket: &PricedModelStats) -> Option<f64> {
    match (bucket.pricing_source, bucket.stats.cost_usd) {
        (PricingSource::Source, Some(cost)) => Some(cost),
        _ => table_price(&bucket.stats),
    }
}

/// Sort key of one session (ADR 0003 §2).
#[derive(Debug, Clone, Copy)]
pub(super) struct RankKey<'a> {
    pub cost: f64,
    pub tokens: u64,
    pub last_ts: i64,
    pub session_ref: &'a SessionRef,
}

/// The order of `sessions`: cost (source + estimate) descending, then total
/// tokens descending, then the latest last row first, then the session ref
/// ascending, so equal sessions always come out in the same order.
pub(super) fn rank_order(a: &RankKey<'_>, b: &RankKey<'_>) -> Ordering {
    b.cost
        .total_cmp(&a.cost)
        .then_with(|| b.tokens.cmp(&a.tokens))
        .then_with(|| b.last_ts.cmp(&a.last_ts))
        .then_with(|| a.session_ref.cmp(b.session_ref))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ModelContextStats;

    const M: u64 = 1_000_000;
    const SONNET_4_5: &str = "claude-sonnet-4-5-20250929";

    /// One context bucket: input, output, 5-minute and 1-hour cache writes,
    /// cache reads, reasoning.
    fn ctx(
        min_context_tokens: u64,
        [input, output, cache_5m, cache_1h, cache_read, reasoning]: [u64; 6],
    ) -> ModelContextStats {
        ModelContextStats {
            min_context_tokens,
            token_count: input + output + cache_5m + cache_1h + cache_read + reasoning,
            input_tokens: input,
            output_tokens: output,
            cache_creation_tokens: cache_5m + cache_1h,
            cache_creation_tokens_5m: cache_5m,
            cache_creation_tokens_1h: cache_1h,
            cache_read_tokens: cache_read,
            reasoning_tokens: reasoning,
        }
    }

    /// An estimate bucket of `model` whose totals are the sum of `breakdown`.
    fn bucket(model: &str, breakdown: Vec<ModelContextStats>) -> PricedModelStats {
        let sum = |field: fn(&ModelContextStats) -> u64| breakdown.iter().map(field).sum::<u64>();
        PricedModelStats {
            pricing_source: PricingSource::Estimate,
            stats: ModelStats {
                provider_id: Some("claude".to_string()),
                model_name: model.to_string(),
                service_tier: None,
                message_count: 1,
                token_count: sum(|c| c.token_count),
                input_tokens: sum(|c| c.input_tokens),
                output_tokens: sum(|c| c.output_tokens),
                cache_creation_tokens: sum(|c| c.cache_creation_tokens),
                cache_read_tokens: sum(|c| c.cache_read_tokens),
                reasoning_tokens: sum(|c| c.reasoning_tokens),
                cost_usd: None,
                context_breakdown: breakdown,
            },
        }
    }

    fn input_only(model: &str, input: u64) -> PricedModelStats {
        bucket(model, vec![ctx(0, [input, 0, 0, 0, 0, 0])])
    }

    fn with_tier(mut bucket: PricedModelStats, tier: &str) -> PricedModelStats {
        bucket.stats.service_tier = Some(tier.to_string());
        bucket
    }

    fn with_provider(mut bucket: PricedModelStats, provider: &str) -> PricedModelStats {
        bucket.stats.provider_id = Some(provider.to_string());
        bucket
    }

    /// A table entry, read from the same file the frontend imports, so the
    /// tests pin the rules and survive price updates.
    fn entry(key: &str) -> &'static Pricing {
        &price_table().models[key]
    }

    fn assert_price(actual: Option<f64>, expected: f64) {
        let actual = actual.expect("priced");
        assert!(
            (actual - expected).abs() < 1e-12,
            "price {actual} != {expected}"
        );
    }

    // ---- prices ---------------------------------------------------------------

    #[test]
    fn prices_every_token_class_at_its_rate() {
        let p = entry("claude-sonnet-4-5");
        let all = bucket(SONNET_4_5, vec![ctx(0, [M, M, M, M, M, 0])]);
        assert_price(
            bucket_cost(&all),
            p.input
                + p.output
                + p.cache_write.expect("5m rate")
                + p.cache_read
                + p.cache_write_one_hour.expect("1h rate"),
        );
        // The canonical example of ADR 0002 §8 (3): Sonnet input is $3 / 1M.
        assert_price(bucket_cost(&input_only(SONNET_4_5, M)), 3.0);
    }

    #[test]
    fn bills_reasoning_at_the_output_rate() {
        let reasoning = bucket(SONNET_4_5, vec![ctx(0, [0, 0, 0, 0, 0, M])]);
        assert_price(bucket_cost(&reasoning), entry("claude-sonnet-4-5").output);
    }

    #[test]
    fn the_longest_matching_key_wins() {
        let (mini, base) = (entry("gpt-5-mini"), entry("gpt-5"));
        assert_ne!(mini.input, base.input, "the fixture must tell them apart");
        assert_price(
            bucket_cost(&input_only("gpt-5-mini-2025-08-07", M)),
            mini.input,
        );
        assert_price(bucket_cost(&input_only("gpt-5-2025-08-07", M)), base.input);
    }

    #[test]
    fn one_hour_cache_writes_fall_back_to_the_default_write_rate() {
        let p = entry("minimax-m2.7");
        assert!(p.cache_write_one_hour.is_none(), "no 1h rate in the table");
        let one_hour = bucket("minimax-m2.7", vec![ctx(0, [0, 0, 0, M, 0, 0])]);
        assert_price(bucket_cost(&one_hour), p.cache_write.expect("rate"));
    }

    #[test]
    fn cache_writes_cost_nothing_without_a_write_rate() {
        assert!(entry("gpt-5").cache_write.is_none());
        let writes = bucket("gpt-5", vec![ctx(0, [0, 0, M, M, 0, 0])]);
        assert_price(bucket_cost(&writes), 0.0);
    }

    #[test]
    fn each_context_bucket_uses_its_own_context_tier() {
        let p = entry("claude-haiku-5-5");
        let long = &p.context_tiers[0];
        assert_ne!(long.input, p.input);
        let two_tiers = bucket(
            "claude-haiku-5-5",
            vec![
                ctx(0, [M, 0, 0, 0, 0, 0]),
                ctx(
                    long.min_context_tokens.expect("threshold"),
                    [M, 0, 0, 0, 0, 0],
                ),
            ],
        );
        assert_price(bucket_cost(&two_tiers), p.input + long.input);
    }

    #[test]
    fn rows_without_a_breakdown_price_their_totals_in_the_default_tier() {
        let p = entry("claude-haiku-5-5");
        let mut legacy = input_only("claude-haiku-5-5", 10 * M);
        legacy.stats.cache_creation_tokens = M;
        legacy.stats.context_breakdown.clear();
        assert_price(
            bucket_cost(&legacy),
            10.0 * p.input + p.cache_write.expect("5m rate"),
        );
    }

    #[test]
    fn fast_and_priority_tiers_use_the_fast_rates() {
        let p = entry("claude-opus-5-5");
        let fast = p.service_tiers["fast"].input;
        assert_ne!(fast, p.input);
        for tier in ["fast", "priority", " FAST "] {
            assert_price(
                bucket_cost(&with_tier(input_only("claude-opus-5-5", M), tier)),
                fast,
            );
        }
        for tier in ["flex", ""] {
            assert_price(
                bucket_cost(&with_tier(input_only("claude-opus-5-5", M), tier)),
                p.input,
            );
        }
    }

    #[test]
    fn a_service_tier_replaces_the_base_context_tiers() {
        // gpt-5.5: the base has a long-context tier, the fast tier has none.
        let p = entry("gpt-5.5");
        let fast_long = with_tier(
            bucket("gpt-5.5", vec![ctx(272_001, [M, 0, 0, 0, 0, 0])]),
            "fast",
        );
        assert_price(bucket_cost(&fast_long), p.service_tiers["fast"].input);
        // gpt-6-sol: the fast tier has its own long-context tier.
        let nested = &entry("gpt-6-sol").service_tiers["fast"].context_tiers[0];
        let fast_long = with_tier(
            bucket("gpt-6-sol", vec![ctx(272_001, [M, 0, 0, 0, 0, 0])]),
            "fast",
        );
        assert_price(bucket_cost(&fast_long), nested.input);
    }

    #[test]
    fn normalizes_model_names_like_the_frontend() {
        let sonnet = entry("claude-sonnet-4-5").input;
        for name in [
            "Models/Claude-Sonnet-4-5-20250929[1m]",
            "  anthropic/claude-sonnet-4-5  ",
            "claude-sonnet-4-5@20250929",
        ] {
            assert_price(bucket_cost(&input_only(name, M)), sonnet);
        }
        assert_eq!(bucket_cost(&input_only("not-claude-sonnet-4-5", M)), None);
        // Only one final bracket group is dropped (`/\[[^\]]*\]$/`): the rest
        // keeps `claude-sonnet-4-5[x]`, which only the shorter key matches.
        assert_price(
            bucket_cost(&input_only("claude-sonnet-4-5[x][1m]", M)),
            entry("claude-sonnet-4").input,
        );
    }

    #[test]
    fn models_the_token_fields_cannot_bill_have_no_price() {
        assert!(bucket_cost(&input_only("gemini-2.5-flash", M)).is_some());
        for name in [
            "gemini-2.5-flash-preview-tts",
            "models/gemini-2.5-flash-native-audio-latest",
            "gpt-realtime-2025-08-28",
        ] {
            assert_eq!(bucket_cost(&input_only(name, M)), None, "{name}");
        }
    }

    #[test]
    fn source_cost_only_providers_have_no_estimate() {
        assert!(bucket_cost(&input_only(SONNET_4_5, M)).is_some());
        for provider in ["opencode", " Cursor ", "copilot"] {
            let routed = with_provider(input_only(SONNET_4_5, M), provider);
            assert_eq!(bucket_cost(&routed), None, "{provider}");
        }
    }

    #[test]
    fn unknown_models_have_no_price() {
        for name in ["unknown", "my-local-model", ""] {
            assert_eq!(bucket_cost(&input_only(name, M)), None, "{name}");
        }
    }

    #[test]
    fn a_source_bucket_costs_its_reported_cost() {
        let mut source = with_provider(input_only("my-local-model", M), "opencode");
        source.pricing_source = PricingSource::Source;
        source.stats.cost_usd = Some(0.42);
        assert_price(bucket_cost(&source), 0.42);
        source.stats.cost_usd = Some(0.0);
        assert_price(bucket_cost(&source), 0.0);
    }

    #[test]
    fn an_estimate_bucket_is_priced_from_the_table_even_with_a_cost() {
        // `toCostInputs` drops `cost_usd` from estimate buckets.
        let mut estimate = input_only(SONNET_4_5, M);
        estimate.stats.cost_usd = Some(9.0);
        assert_price(bucket_cost(&estimate), entry("claude-sonnet-4-5").input);
    }

    #[test]
    fn session_cost_adds_buckets_and_counts_unpriced_ones_as_zero() {
        let mut source = input_only(SONNET_4_5, M);
        source.pricing_source = PricingSource::Source;
        source.stats.cost_usd = Some(0.5);
        let models = vec![
            source,
            input_only(SONNET_4_5, M),
            input_only("my-local-model", M),
        ];
        let expected = 0.5 + entry("claude-sonnet-4-5").input;
        assert!((session_cost(&models) - expected).abs() < 1e-12);
        assert_eq!(session_cost(&[]), 0.0);
    }

    /// The two rule lists that live in TypeScript code, read from
    /// `calculations.ts` itself: a change on one side fails here.
    #[test]
    fn rule_lists_match_the_frontend_pricing_module() {
        const CALCULATIONS_TS: &str =
            include_str!("../../../../../src/components/AnalyticsDashboard/utils/calculations.ts");
        let block = |start: &str, end: &str| -> &str {
            let from = CALCULATIONS_TS.find(start).expect(start) + start.len();
            let to = from + CALCULATIONS_TS[from..].find(end).expect(end);
            &CALCULATIONS_TS[from..to]
        };
        let patterns: Vec<&str> = block("const TOKEN_UNSUPPORTED_MODEL_PATTERNS = [", "];")
            .lines()
            .map(str::trim)
            .filter(|line| line.starts_with('/') && !line.starts_with("//"))
            .map(|line| {
                line.trim_end_matches(',')
                    .strip_prefix('/')
                    .and_then(|l| l.strip_suffix('/'))
                    .unwrap_or_else(|| panic!("regex literal without flags: {line}"))
            })
            .collect();
        assert_eq!(patterns, TOKEN_UNSUPPORTED_MODEL_PATTERNS);
        let providers: Vec<&str> = block("const SOURCE_COST_ONLY_PROVIDER_IDS = new Set([", "]);")
            .split(',')
            .map(|id| id.trim().trim_matches('"'))
            .filter(|id| !id.is_empty())
            .collect();
        assert_eq!(providers, SOURCE_COST_ONLY_PROVIDER_IDS);
    }

    // ---- order ----------------------------------------------------------------

    fn session_ref(file: &str) -> SessionRef {
        SessionRef {
            provider: "claude".to_string(),
            file_path: file.to_string(),
            session_id: file.to_string(),
            project_path: "/p".to_string(),
        }
    }

    #[test]
    fn rank_order_is_cost_then_tokens_then_latest_then_ref() {
        let (a, b) = (session_ref("/p/a.jsonl"), session_ref("/p/b.jsonl"));
        let key = |cost, tokens, last_ts, session_ref| RankKey {
            cost,
            tokens,
            last_ts,
            session_ref,
        };
        let cases = [
            // (first, second, why the first ranks first)
            (key(2.0, 1, 0, &b), key(1.0, 9, 9, &a), "higher cost"),
            (
                key(1.0, 9, 0, &b),
                key(1.0, 1, 9, &a),
                "same cost, more tokens",
            ),
            (
                key(1.0, 1, 9, &b),
                key(1.0, 1, 0, &a),
                "same cost and tokens, later",
            ),
            (
                key(1.0, 1, 0, &a),
                key(1.0, 1, 0, &b),
                "full tie, smaller ref",
            ),
        ];
        for (first, second, why) in cases {
            assert_eq!(rank_order(&first, &second), Ordering::Less, "{why}");
            assert_eq!(rank_order(&second, &first), Ordering::Greater, "{why}");
        }
        let same = key(1.0, 1, 0, &a);
        assert_eq!(rank_order(&same, &same), Ordering::Equal);
    }

    #[test]
    fn rank_order_compares_unequal_refs_field_by_field() {
        let mut other_provider = session_ref("/p/a.jsonl");
        other_provider.provider = "codex".to_string();
        let claude = session_ref("/p/a.jsonl");
        let key = |session_ref| RankKey {
            cost: 0.0,
            tokens: 0,
            last_ts: 0,
            session_ref,
        };
        assert_eq!(
            rank_order(&key(&claude), &key(&other_provider)),
            Ordering::Less,
            "provider first"
        );
    }
}

#[cfg(test)]
#[path = "pricing_matrix_tests.rs"]
mod pricing_matrix_tests;
