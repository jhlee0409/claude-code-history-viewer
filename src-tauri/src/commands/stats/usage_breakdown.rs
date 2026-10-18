//! Usage-breakdown data contract (ADR 0002).
//!
//! Types for the `get_usage_breakdown` command: priced per-interval and
//! per-session usage over **frontend-supplied** `[start, end)` intervals.
//! `AN0a` fixes the wire shape, the request validation and the half-open
//! membership rule; the computation, the contribution cache and the
//! Tauri/Axum registration land in `AN0b`. Nothing here is registered as a
//! command yet.
//!
//! The wire shape is pinned against the TypeScript types by the shared
//! fixture `src/test/fixtures/usageBreakdown.contract.json`.

use crate::commands::multi_provider::CustomClaudePathParam;
use crate::models::ModelStats;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fmt;

#[cfg(test)]
mod fixture;
#[cfg(test)]
mod reconciliation_tests;
#[cfg(test)]
mod tests;

/// Command name shared by the Tauri command and the Axum route.
pub const USAGE_BREAKDOWN_COMMAND: &str = "get_usage_breakdown";

/// Upper bound on intervals per request (a year of days plus split days).
pub const MAX_INTERVALS: usize = 1_000;

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
    /// Every row carried a provider-reported cost; `stats.cost_usd` is their sum.
    Source,
    /// No row carried a cost; `stats.cost_usd` is absent and the frontend
    /// prices the tokens with the price table.
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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
}

/// How much of a provider's priced usage carried a provider-reported cost.
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageBreakdownResponse {
    pub intervals: Vec<IntervalUsage>,
    pub sessions: Vec<SessionUsage>,
    pub coverage: UsageCoverage,
}
