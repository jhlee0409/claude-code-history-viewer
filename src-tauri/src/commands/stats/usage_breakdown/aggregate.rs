//! Sum contributions into the requested intervals and sessions (ADR 0002
//! §3–§6, §9) and cap the session list (ADR 0003). Pure: no file access.

use super::contribution::{Contribution, FileBucket};
use super::ranking::{self, RankKey};
use super::sources::{records_sidechains, ProviderScan, SessionInput};
use super::{
    IntervalUsage, PricedModelStats, PricingSource, ProviderCoverage, SessionRef, SessionRemainder,
    SessionUsage, SourceCostCoverage, UsageBreakdownResponse, UsageCoverage, UsageInterval,
};
use crate::commands::stats::{stats_provider_id, StatsProvider, UNKNOWN_MODEL_NAME};
use crate::models::{ModelContextStats, ModelStats};
use std::cmp::Reverse;
use std::collections::{BTreeMap, HashMap};

/// Bucket key of the response: (provider, model, service tier, pricing source).
type BucketKey = (&'static str, String, Option<String>, PricingSource);

#[derive(Default, Clone)]
struct BucketTotals {
    message_count: u32,
    input: u64,
    output: u64,
    cache_creation: u64,
    cache_read: u64,
    reasoning: u64,
    cost_usd: f64,
    context: BTreeMap<u64, ModelContextStats>,
}

impl BucketTotals {
    fn add(&mut self, contribution: &Contribution) {
        let t = contribution.tokens;
        let total = t.total();
        let cache_1h = u64::from(t.cache_creation_1h.min(t.cache_creation));
        let cache_creation = u64::from(t.cache_creation);
        self.message_count = self.message_count.saturating_add(1);
        self.input += u64::from(t.input);
        self.output += u64::from(t.output);
        self.cache_creation += cache_creation;
        self.cache_read += u64::from(t.cache_read);
        self.reasoning += u64::from(t.reasoning);
        self.cost_usd += contribution.cost_usd;
        let context = self.context_tier(u64::from(contribution.context_tier));
        context.token_count += total;
        context.input_tokens += u64::from(t.input);
        context.output_tokens += u64::from(t.output);
        context.cache_creation_tokens += cache_creation;
        context.cache_creation_tokens_1h += cache_1h;
        context.cache_creation_tokens_5m += cache_creation - cache_1h;
        context.cache_read_tokens += u64::from(t.cache_read);
        context.reasoning_tokens += u64::from(t.reasoning);
    }

    /// Add another bucket of the same key (the session remainder).
    fn merge(&mut self, other: BucketTotals) {
        self.message_count = self.message_count.saturating_add(other.message_count);
        self.input += other.input;
        self.output += other.output;
        self.cache_creation += other.cache_creation;
        self.cache_read += other.cache_read;
        self.reasoning += other.reasoning;
        self.cost_usd += other.cost_usd;
        for (tier, other) in other.context {
            let context = self.context_tier(tier);
            context.token_count += other.token_count;
            context.input_tokens += other.input_tokens;
            context.output_tokens += other.output_tokens;
            context.cache_creation_tokens += other.cache_creation_tokens;
            context.cache_creation_tokens_1h += other.cache_creation_tokens_1h;
            context.cache_creation_tokens_5m += other.cache_creation_tokens_5m;
            context.cache_read_tokens += other.cache_read_tokens;
            context.reasoning_tokens += other.reasoning_tokens;
        }
    }

    fn context_tier(&mut self, tier: u64) -> &mut ModelContextStats {
        self.context
            .entry(tier)
            .or_insert_with(|| ModelContextStats {
                min_context_tokens: tier,
                ..ModelContextStats::default()
            })
    }

    fn token_count(&self) -> u64 {
        self.input + self.output + self.cache_creation + self.cache_read + self.reasoning
    }
}

#[derive(Default, Clone)]
struct BucketMap(BTreeMap<BucketKey, BucketTotals>);

impl BucketMap {
    fn add(&mut self, provider: &'static str, bucket: &FileBucket, contribution: &Contribution) {
        let key = (
            provider,
            bucket
                .model
                .clone()
                .unwrap_or_else(|| UNKNOWN_MODEL_NAME.to_string()),
            bucket.service_tier.clone(),
            bucket.pricing_source,
        );
        self.0.entry(key).or_default().add(contribution);
    }

    fn merge(&mut self, other: BucketMap) {
        for (key, totals) in other.0 {
            self.0.entry(key).or_default().merge(totals);
        }
    }

    /// Buckets by token count, largest first; ties in key order.
    fn into_priced(self) -> Vec<PricedModelStats> {
        let mut priced: Vec<PricedModelStats> = self
            .0
            .into_iter()
            .map(
                |((provider, model_name, service_tier, pricing_source), totals)| PricedModelStats {
                    pricing_source,
                    stats: ModelStats {
                        provider_id: Some(provider.to_string()),
                        model_name,
                        service_tier,
                        message_count: totals.message_count,
                        token_count: totals.token_count(),
                        input_tokens: totals.input,
                        output_tokens: totals.output,
                        cache_creation_tokens: totals.cache_creation,
                        cache_read_tokens: totals.cache_read,
                        reasoning_tokens: totals.reasoning,
                        cost_usd: (pricing_source == PricingSource::Source)
                            .then_some(totals.cost_usd),
                        context_breakdown: totals.context.into_values().collect(),
                    },
                },
            )
            .collect();
        priced.sort_by_key(|bucket| Reverse(bucket.stats.token_count));
        priced
    }
}

#[derive(Default)]
struct IntervalTotals {
    buckets: BucketMap,
    message_count: u64,
    session_count: u64,
    /// Last session counted, so each session counts once per interval.
    last_session: Option<usize>,
}

/// Priced rows of one provider inside the intervals, by pricing source.
#[derive(Default, Clone, Copy)]
struct SourceShare {
    source_rows: u64,
    estimate_rows: u64,
}

impl SourceShare {
    fn coverage(self) -> SourceCostCoverage {
        match (self.source_rows, self.estimate_rows) {
            (0, _) => SourceCostCoverage::None,
            (_, 0) => SourceCostCoverage::All,
            _ => SourceCostCoverage::Some,
        }
    }
}

/// Index of the interval containing `ts_ms` (half-open), if any. Intervals
/// are sorted and non-overlapping (validated), so their ends are sorted too.
fn interval_of(intervals: &[UsageInterval], ts_ms: i64) -> Option<usize> {
    let index = intervals.partition_point(|interval| interval.end_utc <= ts_ms);
    intervals
        .get(index)
        .filter(|interval| interval.contains_ms(ts_ms))
        .map(|_| index)
}

/// One session of the response with its rank, and its buckets kept for the
/// remainder row in case the cap cuts it.
struct RankedSession {
    usage: SessionUsage,
    buckets: BucketMap,
    cost: f64,
    tokens: u64,
}

impl RankedSession {
    fn new(usage: SessionUsage, buckets: BucketMap) -> Self {
        let cost = ranking::session_cost(&usage.models);
        let tokens = usage.models.iter().map(|m| m.stats.token_count).sum();
        Self {
            usage,
            buckets,
            cost,
            tokens,
        }
    }

    fn key(&self) -> RankKey<'_> {
        RankKey {
            cost: self.cost,
            tokens: self.tokens,
            last_ts: self.usage.last_ts,
            session_ref: &self.usage.session_ref,
        }
    }
}

/// Rank the sessions (ADR 0003) and list the first `max_sessions`; every
/// other session is merged, bucket by bucket, into one remainder row.
fn cap_sessions(
    mut ranked: Vec<RankedSession>,
    max_sessions: usize,
) -> (Vec<SessionUsage>, SessionRemainder) {
    ranked.sort_by(|a, b| ranking::rank_order(&a.key(), &b.key()));
    let cut = ranked.split_off(max_sessions.min(ranked.len()));
    let mut buckets = BucketMap::default();
    let mut remainder = SessionRemainder::default();
    for session in cut {
        buckets.merge(session.buckets);
        remainder.message_count += session.usage.message_count;
        remainder.session_count += 1;
    }
    remainder.models = buckets.into_priced();
    let listed = ranked.into_iter().map(|session| session.usage).collect();
    (listed, remainder)
}

pub(super) fn aggregate(
    intervals: &[UsageInterval],
    sessions: &[SessionInput],
    scans: &[ProviderScan],
    max_sessions: usize,
) -> UsageBreakdownResponse {
    let mut interval_totals: Vec<IntervalTotals> = intervals
        .iter()
        .map(|_| IntervalTotals::default())
        .collect();
    let mut ranked = Vec::new();
    let mut undated_rows = 0u64;
    let mut unknown_model_tokens = 0u64;
    let mut shares: HashMap<StatsProvider, SourceShare> = HashMap::new();

    for (session_index, session) in sessions.iter().enumerate() {
        let provider = stats_provider_id(session.provider);
        let share = shares.entry(session.provider).or_default();
        let mut buckets = BucketMap::default();
        let mut message_count = 0u64;
        let mut first_ts = i64::MAX;
        let mut last_ts = i64::MIN;
        for file in &session.files {
            undated_rows += file.undated_rows;
            for contribution in &file.contributions {
                let Some(index) = interval_of(intervals, contribution.ts_ms) else {
                    continue;
                };
                let totals = &mut interval_totals[index];
                totals.message_count += 1;
                if totals.last_session != Some(session_index) {
                    totals.last_session = Some(session_index);
                    totals.session_count += 1;
                }
                message_count += 1;
                first_ts = first_ts.min(contribution.ts_ms);
                last_ts = last_ts.max(contribution.ts_ms);
                let Some(bucket_index) = contribution.bucket() else {
                    continue;
                };
                let bucket = &file.buckets[bucket_index];
                totals.buckets.add(provider, bucket, contribution);
                buckets.add(provider, bucket, contribution);
                if bucket.model.is_none() {
                    unknown_model_tokens += contribution.tokens.total();
                }
                match bucket.pricing_source {
                    PricingSource::Source => share.source_rows += 1,
                    PricingSource::Estimate => share.estimate_rows += 1,
                }
            }
        }
        if message_count == 0 {
            continue;
        }
        let usage = SessionUsage {
            session_ref: SessionRef {
                provider: provider.to_string(),
                file_path: session.file_path.clone(),
                session_id: session.session_id(),
                project_path: session.project_path.clone(),
            },
            title: session.title.clone(),
            models: buckets.clone().into_priced(),
            first_ts,
            last_ts,
            message_count,
        };
        ranked.push(RankedSession::new(usage, buckets));
    }
    let (sessions, session_remainder) = cap_sessions(ranked, max_sessions);

    UsageBreakdownResponse {
        intervals: intervals
            .iter()
            .zip(interval_totals)
            .map(|(interval, totals)| IntervalUsage {
                key: interval.key.clone(),
                models: totals.buckets.into_priced(),
                message_count: totals.message_count,
                session_count: totals.session_count,
            })
            .collect(),
        sessions,
        session_remainder,
        coverage: UsageCoverage {
            providers: scans
                .iter()
                .map(|scan| ProviderCoverage {
                    id: stats_provider_id(scan.provider).to_string(),
                    status: scan.status(),
                    sessions_scanned: scan.sessions_scanned,
                    sessions_failed: scan.sessions_failed,
                    sidechain_metadata: records_sidechains(scan.provider),
                    source_cost: shares
                        .get(&scan.provider)
                        .copied()
                        .unwrap_or_default()
                        .coverage(),
                })
                .collect(),
            undated_rows,
            unknown_model_tokens,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::stats::usage_breakdown::fixture::interval;

    #[test]
    fn interval_lookup_is_half_open_and_skips_zero_length_intervals() {
        let intervals = vec![
            interval("a", "2011-12-29T10:00:00Z", "2011-12-30T10:00:00Z"),
            interval("gap", "2011-12-30T10:00:00Z", "2011-12-30T10:00:00Z"),
            interval("b", "2011-12-30T10:00:00Z", "2011-12-31T10:00:00Z"),
            interval("c", "2012-01-02T00:00:00Z", "2012-01-03T00:00:00Z"),
        ];
        let at = |s: &str| interval_of(&intervals, super::super::fixture::ms(s));
        assert_eq!(at("2011-12-29T10:00:00Z"), Some(0));
        assert_eq!(at("2011-12-30T09:59:59.999Z"), Some(0));
        assert_eq!(at("2011-12-30T10:00:00Z"), Some(2));
        assert_eq!(at("2011-12-31T10:00:00Z"), None, "between b and c");
        assert_eq!(at("2011-12-29T09:59:59Z"), None, "before the first");
        assert_eq!(at("2012-01-03T00:00:00Z"), None, "end of the last");
    }

    #[test]
    fn source_cost_coverage_counts_priced_rows_by_source() {
        let share = |source_rows, estimate_rows| SourceShare {
            source_rows,
            estimate_rows,
        };
        assert_eq!(share(0, 0).coverage(), SourceCostCoverage::None);
        assert_eq!(share(0, 3).coverage(), SourceCostCoverage::None);
        assert_eq!(share(2, 0).coverage(), SourceCostCoverage::All);
        assert_eq!(share(2, 1).coverage(), SourceCostCoverage::Some);
    }
}
