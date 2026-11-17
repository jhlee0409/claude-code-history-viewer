//! Usage breakdown (ADR 0002): priced per-interval and per-session usage over
//! **frontend-supplied** `[start, end)` intervals.
//!
//! - this file: the wire contract, request validation, the half-open
//!   membership rule and the [`get_usage_breakdown`] command (Tauri and the
//!   Axum route `/api/get_usage_breakdown` call the same function);
//! - [`contribution`]: one record per accepted row, file-wide dedup and
//!   pricing source before any interval is applied;
//! - [`contribution_cache`]: per-file cache, `(size, mtime)`-validated, 64 MiB LRU;
//! - [`sources`]: scope → session files per provider, and what failed;
//! - [`aggregate`]: contributions → intervals, sessions and coverage, and
//!   the session cap with its remainder row (ADR 0003);
//! - [`ranking`]: the session order of the cap, priced like the frontend.
//!
//! The wire shape is pinned against the TypeScript types by the shared
//! fixture `src/test/fixtures/usageBreakdown.contract.json`.

use crate::commands::multi_provider::CustomClaudePathParam;
use crate::commands::stats::StatsMode;
use crate::models::ModelStats;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fmt;

mod aggregate;
mod availability;
mod contribution;
mod contribution_cache;
mod ranking;
mod sources;

#[cfg(test)]
mod fixture;
#[cfg(test)]
mod golden_tests;
#[cfg(all(test, unix))]
mod path_safety_tests;
#[cfg(test)]
mod perf_tests;
#[cfg(test)]
mod provider_tests;
#[cfg(test)]
mod reconciliation_tests;
#[cfg(all(test, unix))]
mod store_failure_tests;
#[cfg(test)]
mod tests;

/// Command name shared by the Tauri command and the Axum route.
pub const USAGE_BREAKDOWN_COMMAND: &str = "get_usage_breakdown";

/// Upper bound on intervals per request (a year of days plus split days).
pub const MAX_INTERVALS: usize = 1_000;

/// Sessions listed per response (ADR 0003); every other session of the
/// response is merged into [`UsageBreakdownResponse::session_remainder`].
/// 100 keeps the reference fixture under the 1 MiB budget even when every
/// session mixes three models (the asserted perf gate); AN1 lists 5.
pub const MAX_SESSIONS: usize = 100;

/// Which history the breakdown reads.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum UsageScope {
    /// One project of one provider (Claude directory or provider virtual path).
    Project {
        project_path: String,
        provider: String,
    },
    /// Every project of the selected providers, with the same Claude roots as
    /// `get_global_stats_summary` (default root + user custom roots).
    All {
        providers: Vec<String>,
        /// The default Claude root (`~/.claude`-shaped); empty means
        /// `~/.claude` itself.
        claude_path: String,
        custom_claude_paths: Vec<CustomClaudePathParam>,
    },
}

/// Same meaning as the existing stats mode; parsed strictly here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageStatsMode {
    BillingTotal,
    ConversationOnly,
}

/// One half-open interval `[start_utc, end_utc)` in epoch milliseconds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageInterval {
    /// Caller-chosen label, unique per request (e.g. local date `2026-10-17`).
    pub key: String,
    pub start_utc: i64,
    pub end_utc: i64,
}

impl UsageInterval {
    /// Half-open membership on a millisecond timestamp: `start <= ts < end`.
    pub fn contains_ms(&self, ts_ms: i64) -> bool {
        self.start_utc <= ts_ms && ts_ms < self.end_utc
    }

    /// Half-open membership on a full-precision timestamp. Both edges are
    /// whole milliseconds, so flooring the timestamp never changes the answer.
    pub fn contains(&self, ts: &DateTime<Utc>) -> bool {
        self.contains_ms(timestamp_ms_floor(ts))
    }
}

/// Epoch milliseconds, floored (sub-millisecond digits are dropped toward
/// negative infinity, also before 1970).
pub fn timestamp_ms_floor(ts: &DateTime<Utc>) -> i64 {
    ts.timestamp_millis()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageBreakdownRequest {
    pub scope: UsageScope,
    pub stats_mode: UsageStatsMode,
    pub intervals: Vec<UsageInterval>,
}

/// Why a request was rejected before any file was read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UsageBreakdownRequestError {
    NoIntervals,
    TooManyIntervals { count: usize },
    EmptyKey { index: usize },
    DuplicateKey { key: String },
    ReversedInterval { key: String },
    UnsortedOrOverlapping { previous: String, next: String },
}

impl fmt::Display for UsageBreakdownRequestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoIntervals => write!(f, "usage breakdown: no intervals requested"),
            Self::TooManyIntervals { count } => write!(
                f,
                "usage breakdown: {count} intervals requested, at most {MAX_INTERVALS}"
            ),
            Self::EmptyKey { index } => {
                write!(f, "usage breakdown: interval #{index} has an empty key")
            }
            Self::DuplicateKey { key } => {
                write!(f, "usage breakdown: interval key '{key}' is repeated")
            }
            Self::ReversedInterval { key } => {
                write!(f, "usage breakdown: interval '{key}' ends before it starts")
            }
            Self::UnsortedOrOverlapping { previous, next } => write!(
                f,
                "usage breakdown: interval '{next}' starts before '{previous}' ends"
            ),
        }
    }
}

impl std::error::Error for UsageBreakdownRequestError {}

impl UsageBreakdownRequest {
    /// Check the interval list: `1..=MAX_INTERVALS`, non-empty unique keys,
    /// `start <= end`, sorted and pairwise non-overlapping (touching is fine).
    pub fn validate(&self) -> Result<(), UsageBreakdownRequestError> {
        let intervals = &self.intervals;
        if intervals.is_empty() {
            return Err(UsageBreakdownRequestError::NoIntervals);
        }
        if intervals.len() > MAX_INTERVALS {
            return Err(UsageBreakdownRequestError::TooManyIntervals {
                count: intervals.len(),
            });
        }
        let mut keys = HashSet::with_capacity(intervals.len());
        for (index, interval) in intervals.iter().enumerate() {
            if interval.key.is_empty() {
                return Err(UsageBreakdownRequestError::EmptyKey { index });
            }
            if !keys.insert(interval.key.as_str()) {
                return Err(UsageBreakdownRequestError::DuplicateKey {
                    key: interval.key.clone(),
                });
            }
            if interval.start_utc > interval.end_utc {
                return Err(UsageBreakdownRequestError::ReversedInterval {
                    key: interval.key.clone(),
                });
            }
        }
        for pair in intervals.windows(2) {
            if pair[1].start_utc < pair[0].end_utc {
                return Err(UsageBreakdownRequestError::UnsortedOrOverlapping {
                    previous: pair[0].key.clone(),
                    next: pair[1].key.clone(),
                });
            }
        }
        Ok(())
    }
}

/// Where a bucket's cost comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PricingSource {
    /// Usage of dedup identities (one API request/message, keyed like
    /// `dedup_usage_key`, not a user conversation turn) that carry a
    /// provider-reported cost on at least one row. All of such an
    /// identity's token growth is source, including rows without a cost;
    /// its cost is charged once, on its first costed row. `stats.cost_usd`
    /// is the sum of the costs charged in this bucket and may be 0 when the
    /// costed row lies in another interval.
    Source,
    /// Usage of identities with no reported cost on any row; `stats.cost_usd`
    /// is absent and the frontend prices the tokens with the price table.
    Estimate,
}

/// `ModelStats` wrapped with its pricing source. One (provider, model, tier)
/// may have a source bucket and an estimate bucket side by side.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PricedModelStats {
    pub pricing_source: PricingSource,
    pub stats: ModelStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntervalUsage {
    pub key: String,
    pub models: Vec<PricedModelStats>,
    pub message_count: u64,
    pub session_count: u64,
}

/// Field order is the ref tie-break of the session ranking (ADR 0003).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct SessionRef {
    pub provider: String,
    pub file_path: String,
    pub session_id: String,
    pub project_path: String,
}

/// One session with at least one dated row inside the requested intervals.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionUsage {
    #[serde(rename = "ref")]
    pub session_ref: SessionRef,
    pub title: Option<String>,
    pub models: Vec<PricedModelStats>,
    /// First / last counted row inside the intervals, epoch ms.
    pub first_ts: i64,
    pub last_ts: i64,
    pub message_count: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderScanStatus {
    Scanned,
    Partial,
    Unreadable,
    NotSupported,
    /// No history store of the provider on this machine, or the requested
    /// project directory does not exist: nothing to read, which is not the
    /// same as a store that was read and held no usage (ADR 0003 §7).
    NotFound,
}

/// How much of a provider's priced usage is in [`PricingSource::Source`]
/// buckets (covered by a cost-bearing dedup identity).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceCostCoverage {
    All,
    Some,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCoverage {
    pub id: String,
    pub status: ProviderScanStatus,
    pub sessions_scanned: u64,
    pub sessions_failed: u64,
    pub sidechain_metadata: bool,
    pub source_cost: SourceCostCoverage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageCoverage {
    pub providers: Vec<ProviderCoverage>,
    /// Rows without a parseable timestamp: in no interval or session total.
    pub undated_rows: u64,
    /// Tokens of rows without a model name (also in the `unknown` bucket).
    pub unknown_model_tokens: u64,
}

/// The sessions of a response that `sessions` does not list (ADR 0003),
/// merged: buckets by (provider, model, tier, pricing source) like an
/// interval's, so source and estimate stay apart. All zero, with no
/// buckets, when nothing was cut; never absent or null.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionRemainder {
    pub models: Vec<PricedModelStats>,
    pub message_count: u64,
    pub session_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageBreakdownResponse {
    pub intervals: Vec<IntervalUsage>,
    /// At most [`MAX_SESSIONS`], ranked by cost (source + estimate), then
    /// tokens, then the latest last row, then the ref (ADR 0003).
    pub sessions: Vec<SessionUsage>,
    pub session_remainder: SessionRemainder,
    pub coverage: UsageCoverage,
}

impl UsageStatsMode {
    fn stats_mode(self) -> StatsMode {
        match self {
            Self::BillingTotal => StatsMode::BillingTotal,
            Self::ConversationOnly => StatsMode::ConversationOnly,
        }
    }
}

/// Priced usage per requested interval and per session, with coverage
/// (ADR 0002); `sessions` capped at [`MAX_SESSIONS`] plus the remainder row
/// (ADR 0003). Read-only. The request is validated (intervals and scope)
/// before any file is read; the scan runs on the blocking pool with per-file
/// parallelism.
#[tauri::command]
pub async fn get_usage_breakdown(
    request: UsageBreakdownRequest,
) -> Result<UsageBreakdownResponse, String> {
    breakdown(request, MAX_SESSIONS).await
}

/// [`get_usage_breakdown`] with the session cap as a parameter, so a golden
/// scenario can show a cut on a small fixture.
async fn breakdown(
    request: UsageBreakdownRequest,
    max_sessions: usize,
) -> Result<UsageBreakdownResponse, String> {
    request.validate().map_err(|error| error.to_string())?;
    let plan = sources::ScopePlan::parse(&request.scope)?;
    tauri::async_runtime::spawn_blocking(move || compute(&request, &plan, max_sessions))
        .await
        .map_err(|error| format!("usage breakdown: task failed: {error}"))
}

fn compute(
    request: &UsageBreakdownRequest,
    plan: &sources::ScopePlan,
    max_sessions: usize,
) -> UsageBreakdownResponse {
    let started = std::time::Instant::now();
    let collected = sources::collect(plan, request.stats_mode.stats_mode());
    let response = aggregate::aggregate(
        &request.intervals,
        &collected.sessions,
        &collected.scans,
        max_sessions,
    );
    let cache = contribution_cache::contribution_cache().usage();
    log::debug!(
        "{USAGE_BREAKDOWN_COMMAND}: {} intervals, {} sessions listed + {} in the remainder, {} ms; cache {} files, {} bytes",
        request.intervals.len(),
        response.sessions.len(),
        response.session_remainder.session_count,
        started.elapsed().as_millis(),
        cache.entries,
        cache.bytes
    );
    response
}
