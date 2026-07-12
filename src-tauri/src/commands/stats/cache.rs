//! In-memory per-file stats cache for the Claude-provider stats commands.
//!
//! # Design
//!
//! The four stats commands (`get_global_stats_summary`,
//! `get_project_stats_summary`, `get_project_token_stats`,
//! `get_session_comparison`) used to re-read and re-parse every session JSONL
//! file on every call. This module caches a **date-filter-independent**
//! per-file aggregate so repeat calls only re-parse files whose
//! `(size, mtime)` changed.
//!
//! ## Cached shape
//!
//! One [`FileAggregate`] per file, per parse pipeline, per [`StatsMode`]:
//! per-UTC-day [`DayBucket`]s (message count, deduped token sums,
//! tool/skill/subagent counters, per-model aggregates, hourly activity,
//! first/last timestamps, gap-split activity runs) plus an `undated` bucket
//! for rows whose timestamp does not parse, and the session `summary` text.
//!
//! Two caches exist because the commands use two different parse pipelines
//! whose row acceptance differs in edge cases (byte-identical results are
//! required):
//! - [`global_stats_cache`] — the lightweight `GlobalStatsLogEntry` pipeline
//!   used by `get_global_stats_summary`.
//! - [`message_stats_cache`] — the `RawLogEntry → ClaudeMessage` pipeline
//!   shared by project stats, project token stats, and session comparison.
//!
//! ## Key / validation
//!
//! Entries are keyed by canonical path and validated against the file's
//! `(size, mtime)` captured **before** parsing, so a concurrent append can
//! never be cached under a newer signature (worst case: an unnecessary
//! rebuild on the next call). Each entry holds one slot per stats mode.
//! In-memory only; capped at [`MAX_CACHE_ENTRIES`] per cache — beyond the cap
//! new files are computed but not stored.
//!
//! ## Composition / fallback to full scan
//!
//! Without a date filter the composed result uses every bucket and is always
//! exact. With a filter, a day bucket is used only when it is **wholly**
//! inside `[start, end]` (checked against the bucket's real min/max
//! timestamps, so arbitrary sub-day filters stay exact); wholly-outside
//! buckets are skipped; a partially-covered bucket forces a fall back to the
//! original full scan for that file. Composition also falls back when a
//! deduped usage key (#283) spans two buckets, because the cold scan would
//! re-attribute the usage to the first *in-range* row. The `scan_*` functions
//! in the parent module remain the reference implementation.
//!
//! Known envelope: Claude rows missing a timestamp are stamped with
//! `Utc::now()` by `ClaudeMessage::try_from` (pre-existing behavior), so the
//! message pipeline's day bucket for such rows is frozen at build time — the
//! cold scan itself is already nondeterministic for them. Provider
//! (non-Claude) stats paths are not cached: their session paths are virtual
//! (`opencode://` …) and carry no `(size, mtime)` identity.

use super::{
    dedup_usage_key, extract_token_usage, extract_token_usage_from_global_entry,
    parse_global_stats_entry_simd, parse_raw_log_entry_simd, parse_timestamp_utc,
    should_include_stats_entry, token_usage_has_token_fields, token_usage_totals,
    track_skill_and_subagent_usage, track_skill_and_subagent_usage_from_global_entry,
    track_tool_usage, track_tool_usage_from_global_entry, ModelUsageAggregate,
    ProjectSessionFileStats, SessionComparisonStats, SessionFileStats, StatsMode, StatsProvider,
};
use crate::models::{ClaudeMessage, DailyStats, SessionTokenStats, TokenUsage, ToolUsageStats};
use crate::utils::find_line_ranges;
use chrono::{DateTime, Datelike, Timelike, Utc};
use memmap2::Mmap;
use std::collections::hash_map::Entry;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::SystemTime;

/// Mirrors the session-break threshold used by the scan paths.
const SESSION_BREAK_THRESHOLD_MINUTES: i64 = 120;

/// Upper bound on cached files per cache; keeps worst-case memory in the
/// tens of MB even for very large histories (aggregates are a few KB each).
const MAX_CACHE_ENTRIES: usize = 16_384;

/// Filter-independent aggregates for one UTC day (or the undated bucket).
#[derive(Default)]
pub(super) struct DayBucket {
    message_count: u32,
    input_tokens: u64,
    output_tokens: u64,
    cache_creation_tokens: u64,
    cache_read_tokens: u64,
    tool_usage: HashMap<String, (u32, u32)>,
    skill_usage: HashMap<String, (u32, u32)>,
    subagent_usage: HashMap<String, (u32, u32)>,
    /// Populated by the global builder only; message-pipeline composers do
    /// not read model breakdowns.
    model_usage: HashMap<String, ModelUsageAggregate>,
    /// hour-of-day → (message count, deduped tokens).
    hourly_activity: HashMap<u8, (u32, u64)>,
    first_ts: Option<DateTime<Utc>>,
    last_ts: Option<DateTime<Utc>>,
    /// Raw timestamp strings backing `first_ts`/`last_ts` —
    /// `SessionTokenStats` reports the original strings, not re-serialized
    /// datetimes.
    first_ts_raw: Option<String>,
    last_ts_raw: Option<String>,
    /// Session id of the first included row in this bucket (message pipeline
    /// only) and its file-order sequence, so composition can reproduce the
    /// scan's "first included row wins" session-id selection.
    first_session_id: Option<String>,
    first_row_seq: u64,
    /// Activity runs (start, end) split at gaps > 120 minutes; lets session
    /// duration recompose exactly across day boundaries.
    runs: Vec<(DateTime<Utc>, DateTime<Utc>)>,
}

impl DayBucket {
    fn token_total(&self) -> u64 {
        self.input_tokens + self.output_tokens + self.cache_creation_tokens + self.cache_read_tokens
    }
}

/// Date-filter-independent per-file aggregate (one per parse pipeline/mode).
#[derive(Default)]
pub(super) struct FileAggregate {
    /// UTC date ("%Y-%m-%d") → bucket; `BTreeMap` keeps chronological order
    /// for run merging.
    days: BTreeMap<String, DayBucket>,
    /// Rows whose timestamp does not parse; included only when no date filter
    /// is active (mirrors `is_within_date_limits(None, ..)`).
    undated: DayBucket,
    /// Last summary-row text in file order (filter-independent).
    summary: Option<String>,
    /// A deduped usage key was first seen in one bucket and repeated in
    /// another; filtered composition would misattribute its tokens.
    dedup_spans_buckets: bool,
}

impl FileAggregate {
    fn bucket_mut(&mut self, date: Option<&str>) -> &mut DayBucket {
        match date {
            Some(day) => self.days.entry(day.to_string()).or_default(),
            None => &mut self.undated,
        }
    }
}

/// Result of composing a cached aggregate for a specific date filter.
pub(super) enum Composed<T> {
    Ready(T),
    /// The filter cannot be answered from daily buckets; run the full scan.
    NeedsFullScan,
}

struct CacheEntry {
    size: u64,
    mtime: Option<SystemTime>,
    /// One slot per `StatsMode` (`billing_total` / `conversation_only`).
    slots: [Option<Arc<FileAggregate>>; 2],
}

/// Process-global cache of per-file aggregates, validated by (size, mtime).
pub(super) struct StatsFileCache {
    entries: Mutex<HashMap<PathBuf, CacheEntry>>,
}

fn mode_slot(mode: StatsMode) -> usize {
    match mode {
        StatsMode::BillingTotal => 0,
        StatsMode::ConversationOnly => 1,
    }
}

static GLOBAL_STATS_CACHE: OnceLock<StatsFileCache> = OnceLock::new();
static MESSAGE_STATS_CACHE: OnceLock<StatsFileCache> = OnceLock::new();

/// Cache for the lightweight global-stats parse pipeline.
pub(super) fn global_stats_cache() -> &'static StatsFileCache {
    GLOBAL_STATS_CACHE.get_or_init(StatsFileCache::new)
}

/// Cache for the `RawLogEntry → ClaudeMessage` parse pipeline.
pub(super) fn message_stats_cache() -> &'static StatsFileCache {
    MESSAGE_STATS_CACHE.get_or_init(StatsFileCache::new)
}

impl StatsFileCache {
    fn new() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
        }
    }

    /// Return the cached aggregate for `path`/`mode`, rebuilding via `build`
    /// when the entry is missing or the file's (size, mtime) changed.
    pub(super) fn get_or_build<F>(
        &self,
        path: &Path,
        mode: StatsMode,
        build: F,
    ) -> Option<Arc<FileAggregate>>
    where
        F: FnOnce() -> Option<FileAggregate>,
    {
        // Files that cannot be canonicalized or stat'ed (e.g. vanished
        // mid-scan) are computed without caching.
        let Ok(key) = fs::canonicalize(path) else {
            return build().map(Arc::new);
        };
        // The signature is taken BEFORE parsing: a concurrent append after
        // this stat makes the stored entry look stale on the next call,
        // never the other way around.
        let Ok(metadata) = fs::metadata(&key) else {
            return build().map(Arc::new);
        };
        let size = metadata.len();
        let mtime = metadata.modified().ok();
        let slot = mode_slot(mode);

        {
            let entries = self.lock_entries();
            if let Some(entry) = entries.get(&key) {
                if entry.size == size && entry.mtime == mtime {
                    if let Some(aggregate) = &entry.slots[slot] {
                        return Some(Arc::clone(aggregate));
                    }
                }
            }
        }

        #[cfg(test)]
        note_build(&key);
        let built = Arc::new(build()?);

        let mut entries = self.lock_entries();
        match entries.get_mut(&key) {
            Some(entry) => {
                if entry.size != size || entry.mtime != mtime {
                    entry.size = size;
                    entry.mtime = mtime;
                    entry.slots = [None, None];
                }
                entry.slots[slot] = Some(Arc::clone(&built));
            }
            None => {
                // Memory bound: past the cap new files are computed but not
                // stored, keeping already-hot entries intact.
                if entries.len() < MAX_CACHE_ENTRIES {
                    let mut slots = [None, None];
                    slots[slot] = Some(Arc::clone(&built));
                    entries.insert(key, CacheEntry { size, mtime, slots });
                }
            }
        }
        Some(built)
    }

    /// Lock the entry map, recovering from a poisoned lock — a panic in an
    /// unrelated parse must not disable stats for the rest of the process.
    fn lock_entries(&self) -> std::sync::MutexGuard<'_, HashMap<PathBuf, CacheEntry>> {
        match self.entries.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

#[cfg(test)]
fn note_build(key: &Path) {
    if let Ok(mut counts) = build_counts().lock() {
        *counts.entry(key.to_path_buf()).or_insert(0) += 1;
    }
}

/// Dedup-aware token totals that also record which bucket first claimed the
/// usage key (#283). A duplicate landing in a different bucket than its
/// first occurrence makes filtered composition unsound — the cold scan would
/// re-attribute the usage to the first *in-range* row — so it flips
/// `spans_buckets` and filtered queries fall back to the full scan.
fn bucketed_dedup_totals(
    first_bucket_by_key: &mut HashMap<String, Option<String>>,
    dedup_key: Option<String>,
    bucket: Option<&str>,
    usage: &TokenUsage,
    spans_buckets: &mut bool,
) -> (u64, u64, u64, u64, u64) {
    let Some(key) = dedup_key else {
        return token_usage_totals(usage);
    };
    match first_bucket_by_key.entry(key) {
        Entry::Vacant(vacant) => {
            vacant.insert(bucket.map(str::to_string));
            token_usage_totals(usage)
        }
        Entry::Occupied(occupied) => {
            if occupied.get().as_deref() != bucket {
                *spans_buckets = true;
            }
            (0, 0, 0, 0, 0)
        }
    }
}

impl DayBucket {
    /// Token, timestamp, and session-id bookkeeping shared by both builders.
    fn record_row(
        &mut self,
        totals: (u64, u64, u64, u64, u64),
        timestamp: Option<(DateTime<Utc>, &str)>,
        session_id: Option<&str>,
        row_seq: u64,
    ) {
        let (input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, tokens) =
            totals;
        self.message_count = self.message_count.saturating_add(1);
        self.input_tokens += input_tokens;
        self.output_tokens += output_tokens;
        self.cache_creation_tokens += cache_creation_tokens;
        self.cache_read_tokens += cache_read_tokens;

        if self.first_session_id.is_none() {
            if let Some(session_id) = session_id {
                self.first_session_id = Some(session_id.to_string());
                self.first_row_seq = row_seq;
            }
        }

        if let Some((ts, raw)) = timestamp {
            // Strict comparisons: on ties the first row in file order wins,
            // matching the scan paths.
            if self.first_ts.map_or(true, |current| ts < current) {
                self.first_ts = Some(ts);
                self.first_ts_raw = Some(raw.to_string());
            }
            if self.last_ts.map_or(true, |current| ts > current) {
                self.last_ts = Some(ts);
                self.last_ts_raw = Some(raw.to_string());
            }
            let activity = self
                .hourly_activity
                .entry(ts.hour() as u8)
                .or_insert((0, 0));
            activity.0 += 1;
            activity.1 += tokens;
        }
    }

    fn record_model_usage(&mut self, model_name: &str, totals: (u64, u64, u64, u64, u64)) {
        let (input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, tokens) =
            totals;
        let entry = self
            .model_usage
            .entry(model_name.to_string())
            .or_insert((0, 0, 0, 0, 0, 0, 0));
        entry.0 += 1;
        entry.1 += tokens;
        entry.2 += input_tokens;
        entry.3 += output_tokens;
        entry.4 += cache_creation_tokens;
        entry.5 += cache_read_tokens;
        entry.6 += 0;
    }
}

/// Sort each day's timestamps and store gap-split activity runs.
fn finalize_runs(
    aggregate: &mut FileAggregate,
    day_timestamps: HashMap<String, Vec<DateTime<Utc>>>,
) {
    for (date, mut timestamps) in day_timestamps {
        timestamps.sort_unstable();
        if let Some(bucket) = aggregate.days.get_mut(&date) {
            bucket.runs = split_into_runs(&timestamps);
        }
    }
}

/// Split sorted timestamps into maximal runs whose internal gaps stay within
/// the session-break threshold.
fn split_into_runs(sorted: &[DateTime<Utc>]) -> Vec<(DateTime<Utc>, DateTime<Utc>)> {
    let Some(&first) = sorted.first() else {
        return Vec::new();
    };
    let mut runs = Vec::new();
    let mut run_start = first;
    let mut previous = first;
    for &ts in &sorted[1..] {
        if (ts - previous).num_minutes() > SESSION_BREAK_THRESHOLD_MINUTES {
            runs.push((run_start, previous));
            run_start = ts;
        }
        previous = ts;
    }
    runs.push((run_start, previous));
    runs
}

/// Build the aggregate with the lightweight global-stats parse pipeline.
/// Mirrors `scan_session_file_for_global_stats` row handling, minus the date
/// filter (applied at composition time).
#[allow(unsafe_code)] // mmap read-only access, same pattern as the scan paths
pub(super) fn build_global_file_aggregate(
    session_path: &Path,
    mode: StatsMode,
) -> Option<FileAggregate> {
    let file = fs::File::open(session_path).ok()?;
    // SAFETY: read-only mmap; the file handle outlives the map. Session
    // files are append-only, and concurrent growth is caught by the
    // (size, mtime) signature taken before this builder runs.
    let mmap = unsafe { Mmap::map(&file) }.ok()?;

    let mut aggregate = FileAggregate::default();
    let mut first_bucket_by_key: HashMap<String, Option<String>> = HashMap::new();
    let mut day_timestamps: HashMap<String, Vec<DateTime<Utc>>> = HashMap::new();
    let mut row_seq = 0u64;

    for (start, end) in find_line_ranges(&mmap) {
        let mut line_bytes = mmap[start..end].to_vec();
        let Some(entry) = parse_global_stats_entry_simd(&mut line_bytes) else {
            continue;
        };

        let usage = extract_token_usage_from_global_entry(&entry);
        let has_usage = token_usage_has_token_fields(&usage);
        if !should_include_stats_entry(&entry.message_type, entry.is_sidechain, has_usage, mode) {
            continue;
        }

        let raw_timestamp = entry.timestamp.as_deref().unwrap_or("");
        let parsed_ts = parse_timestamp_utc(raw_timestamp);
        let date = parsed_ts.map(|ts| ts.format("%Y-%m-%d").to_string());
        row_seq += 1;

        // The global pipeline dedups without a session-id prefix (#283).
        let message_id = entry.message.as_ref().and_then(|m| m.id.as_deref());
        let uuid = entry.uuid.as_deref().unwrap_or("");
        let dedup_key = dedup_usage_key("", message_id, uuid);
        let totals = bucketed_dedup_totals(
            &mut first_bucket_by_key,
            dedup_key,
            date.as_deref(),
            &usage,
            &mut aggregate.dedup_spans_buckets,
        );

        if let Some(ts) = parsed_ts {
            day_timestamps
                .entry(date.clone().expect("dated row has a date key"))
                .or_default()
                .push(ts);
        }

        let bucket = aggregate.bucket_mut(date.as_deref());
        bucket.record_row(
            totals,
            parsed_ts.map(|ts| (ts, raw_timestamp)),
            None,
            row_seq,
        );
        if let Some(model_name) = entry.message.as_ref().and_then(|m| m.model.as_deref()) {
            bucket.record_model_usage(model_name, totals);
        }
        track_tool_usage_from_global_entry(&entry, &mut bucket.tool_usage);
        track_skill_and_subagent_usage_from_global_entry(
            &entry,
            &mut bucket.skill_usage,
            &mut bucket.subagent_usage,
        );
    }

    finalize_runs(&mut aggregate, day_timestamps);
    Some(aggregate)
}

/// Build the aggregate with the `RawLogEntry → ClaudeMessage` pipeline.
/// Mirrors the row handling shared by `scan_session_file_for_project_stats`,
/// `scan_session_token_stats`, and `scan_session_file_for_comparison`, minus
/// the date filter (applied at composition time).
#[allow(unsafe_code)] // mmap read-only access, same pattern as the scan paths
pub(super) fn build_message_file_aggregate(
    session_path: &Path,
    mode: StatsMode,
) -> Option<FileAggregate> {
    let file = fs::File::open(session_path).ok()?;
    // SAFETY: read-only mmap; the file handle outlives the map. Session
    // files are append-only, and concurrent growth is caught by the
    // (size, mtime) signature taken before this builder runs.
    let mmap = unsafe { Mmap::map(&file) }.ok()?;

    let mut aggregate = FileAggregate::default();
    let mut first_bucket_by_key: HashMap<String, Option<String>> = HashMap::new();
    let mut day_timestamps: HashMap<String, Vec<DateTime<Utc>>> = HashMap::new();
    let mut row_seq = 0u64;

    for (start, end) in find_line_ranges(&mmap) {
        let mut line_bytes = mmap[start..end].to_vec();
        let Some(log_entry) = parse_raw_log_entry_simd(&mut line_bytes) else {
            continue;
        };
        // Summary text is captured before ClaudeMessage::try_from rejects
        // the row, mirroring scan_session_token_stats (filter-independent).
        if log_entry.message_type == "summary" {
            if let Some(summary) = &log_entry.summary {
                aggregate.summary = Some(summary.clone());
            }
        }
        let Ok(message) = ClaudeMessage::try_from(log_entry) else {
            continue;
        };

        let usage = extract_token_usage(&message);
        let has_usage = token_usage_has_token_fields(&usage);
        if !should_include_stats_entry(&message.message_type, message.is_sidechain, has_usage, mode)
        {
            continue;
        }

        let parsed_ts = parse_timestamp_utc(&message.timestamp);
        let date = parsed_ts.map(|ts| ts.format("%Y-%m-%d").to_string());
        row_seq += 1;

        let dedup_key = dedup_usage_key(
            &message.session_id,
            message.message_id.as_deref(),
            &message.uuid,
        );
        let totals = bucketed_dedup_totals(
            &mut first_bucket_by_key,
            dedup_key,
            date.as_deref(),
            &usage,
            &mut aggregate.dedup_spans_buckets,
        );

        if let Some(ts) = parsed_ts {
            day_timestamps
                .entry(date.clone().expect("dated row has a date key"))
                .or_default()
                .push(ts);
        }

        let bucket = aggregate.bucket_mut(date.as_deref());
        bucket.record_row(
            totals,
            parsed_ts.map(|ts| (ts, message.timestamp.as_str())),
            Some(&message.session_id),
            row_seq,
        );
        track_tool_usage(&message, &mut bucket.tool_usage);
        track_skill_and_subagent_usage(
            &message,
            &mut bucket.skill_usage,
            &mut bucket.subagent_usage,
        );
    }

    finalize_runs(&mut aggregate, day_timestamps);
    Some(aggregate)
}

/// Day buckets answering a date filter, or `None` when the filter cannot be
/// composed from daily buckets and the caller must run the full scan.
struct BucketSelection<'a> {
    days: Vec<(&'a String, &'a DayBucket)>,
    /// Undated rows are only included when no filter is active, mirroring
    /// `is_within_date_limits(None, ..)`.
    include_undated: bool,
}

fn included_buckets<'a>(
    aggregate: &'a FileAggregate,
    s_limit: Option<&DateTime<Utc>>,
    e_limit: Option<&DateTime<Utc>>,
) -> Option<BucketSelection<'a>> {
    if s_limit.is_none() && e_limit.is_none() {
        return Some(BucketSelection {
            days: aggregate.days.iter().collect(),
            include_undated: true,
        });
    }
    if aggregate.dedup_spans_buckets {
        return None;
    }
    let mut days = Vec::new();
    for (date, bucket) in &aggregate.days {
        let (Some(first), Some(last)) = (bucket.first_ts, bucket.last_ts) else {
            // A dated bucket always carries timestamps; treat anything else
            // as non-composable rather than guessing.
            return None;
        };
        let starts_in = s_limit.map_or(true, |s| first >= *s);
        let ends_in = e_limit.map_or(true, |e| last <= *e);
        if starts_in && ends_in {
            days.push((date, bucket));
            continue;
        }
        let fully_before = s_limit.is_some_and(|s| last < *s);
        let fully_after = e_limit.is_some_and(|e| first > *e);
        if fully_before || fully_after {
            continue;
        }
        // The filter boundary lands inside this day's data: per-row
        // filtering is required.
        return None;
    }
    Some(BucketSelection {
        days,
        include_undated: false,
    })
}

fn merge_counter_map(
    target: &mut HashMap<String, (u32, u32)>,
    source: &HashMap<String, (u32, u32)>,
) {
    for (name, (uses, successes)) in source {
        let entry = target.entry(name.clone()).or_insert((0, 0));
        entry.0 += uses;
        entry.1 += successes;
    }
}

fn merge_model_map(
    target: &mut HashMap<String, ModelUsageAggregate>,
    source: &HashMap<String, ModelUsageAggregate>,
) {
    for (model, values) in source {
        let entry = target.entry(model.clone()).or_insert((0, 0, 0, 0, 0, 0, 0));
        entry.0 += values.0;
        entry.1 += values.1;
        entry.2 += values.2;
        entry.3 += values.3;
        entry.4 += values.4;
        entry.5 += values.5;
        entry.6 += values.6;
    }
}

/// Session id of the first included row in file order across the selection.
fn first_included_session_id<'a>(
    selection: &'a BucketSelection<'a>,
    undated: &'a DayBucket,
) -> Option<&'a str> {
    let mut best: Option<(u64, &str)> = None;
    let undated_iter = selection.include_undated.then_some(undated).into_iter();
    for bucket in selection
        .days
        .iter()
        .map(|(_, bucket)| *bucket)
        .chain(undated_iter)
    {
        if let Some(session_id) = &bucket.first_session_id {
            if best.map_or(true, |(seq, _)| bucket.first_row_seq < seq) {
                best = Some((bucket.first_row_seq, session_id));
            }
        }
    }
    best.map(|(_, session_id)| session_id)
}

/// Compose the global-stats per-file result from the cached aggregate.
pub(super) fn compose_global(
    aggregate: &FileAggregate,
    project_name: String,
    s_limit: Option<&DateTime<Utc>>,
    e_limit: Option<&DateTime<Utc>>,
) -> Composed<SessionFileStats> {
    let Some(selection) = included_buckets(aggregate, s_limit, e_limit) else {
        return Composed::NeedsFullScan;
    };

    let mut stats = SessionFileStats {
        project_name,
        provider: StatsProvider::Claude,
        ..Default::default()
    };
    let mut runs: Vec<(DateTime<Utc>, DateTime<Utc>)> = Vec::new();

    for (date, bucket) in &selection.days {
        stats.total_messages = stats.total_messages.saturating_add(bucket.message_count);
        stats.total_tokens += bucket.token_total();
        stats.token_distribution.input += bucket.input_tokens;
        stats.token_distribution.output += bucket.output_tokens;
        stats.token_distribution.cache_creation += bucket.cache_creation_tokens;
        stats.token_distribution.cache_read += bucket.cache_read_tokens;
        merge_counter_map(&mut stats.tool_usage, &bucket.tool_usage);
        merge_counter_map(&mut stats.skill_usage, &bucket.skill_usage);
        merge_counter_map(&mut stats.subagent_usage, &bucket.subagent_usage);
        merge_model_map(&mut stats.model_usage, &bucket.model_usage);

        stats.daily_stats.insert(
            (*date).clone(),
            DailyStats {
                date: (*date).clone(),
                total_tokens: bucket.token_total(),
                input_tokens: bucket.input_tokens,
                output_tokens: bucket.output_tokens,
                message_count: bucket.message_count as usize,
                ..Default::default()
            },
        );

        // All rows of a UTC-day bucket share one weekday.
        if let Some(day_of_week) = bucket
            .first_ts
            .map(|ts| ts.weekday().num_days_from_sunday() as u8)
        {
            for (&hour, &(count, tokens)) in &bucket.hourly_activity {
                let entry = stats
                    .activity_data
                    .entry((hour, day_of_week))
                    .or_insert((0, 0));
                entry.0 += count;
                entry.1 += tokens;
            }
        }

        if let Some(first) = bucket.first_ts {
            if stats.first_message.map_or(true, |current| first < current) {
                stats.first_message = Some(first);
            }
        }
        if let Some(last) = bucket.last_ts {
            if stats.last_message.map_or(true, |current| last > current) {
                stats.last_message = Some(last);
            }
        }
        runs.extend(bucket.runs.iter().copied());
    }

    if selection.include_undated {
        let undated = &aggregate.undated;
        stats.total_messages = stats.total_messages.saturating_add(undated.message_count);
        stats.total_tokens += undated.token_total();
        stats.token_distribution.input += undated.input_tokens;
        stats.token_distribution.output += undated.output_tokens;
        stats.token_distribution.cache_creation += undated.cache_creation_tokens;
        stats.token_distribution.cache_read += undated.cache_read_tokens;
        merge_counter_map(&mut stats.tool_usage, &undated.tool_usage);
        merge_counter_map(&mut stats.skill_usage, &undated.skill_usage);
        merge_counter_map(&mut stats.subagent_usage, &undated.subagent_usage);
        merge_model_map(&mut stats.model_usage, &undated.model_usage);
    }

    stats.session_duration_minutes = merged_active_minutes(&runs);
    Composed::Ready(stats)
}

/// Compose the project-stats per-file result from the cached aggregate.
pub(super) fn compose_project(
    aggregate: &FileAggregate,
    s_limit: Option<&DateTime<Utc>>,
    e_limit: Option<&DateTime<Utc>>,
) -> Composed<Option<ProjectSessionFileStats>> {
    let Some(selection) = included_buckets(aggregate, s_limit, e_limit) else {
        return Composed::NeedsFullScan;
    };

    let mut stats = ProjectSessionFileStats::default();
    let mut runs: Vec<(DateTime<Utc>, DateTime<Utc>)> = Vec::new();

    for (date, bucket) in &selection.days {
        stats.total_messages += bucket.message_count;
        stats.token_distribution.input += bucket.input_tokens;
        stats.token_distribution.output += bucket.output_tokens;
        stats.token_distribution.cache_creation += bucket.cache_creation_tokens;
        stats.token_distribution.cache_read += bucket.cache_read_tokens;
        merge_counter_map(&mut stats.tool_usage, &bucket.tool_usage);
        merge_counter_map(&mut stats.skill_usage, &bucket.skill_usage);
        merge_counter_map(&mut stats.subagent_usage, &bucket.subagent_usage);

        stats.session_dates.insert((*date).clone());
        stats.daily_stats.insert(
            (*date).clone(),
            DailyStats {
                date: (*date).clone(),
                total_tokens: bucket.token_total(),
                input_tokens: bucket.input_tokens,
                output_tokens: bucket.output_tokens,
                message_count: bucket.message_count as usize,
                ..Default::default()
            },
        );

        if let Some(day_of_week) = bucket
            .first_ts
            .map(|ts| ts.weekday().num_days_from_sunday() as u8)
        {
            for (&hour, &(count, tokens)) in &bucket.hourly_activity {
                let entry = stats
                    .activity_data
                    .entry((hour, day_of_week))
                    .or_insert((0, 0));
                entry.0 += count;
                entry.1 += tokens;
            }
        }
        runs.extend(bucket.runs.iter().copied());
    }

    if selection.include_undated {
        let undated = &aggregate.undated;
        stats.total_messages += undated.message_count;
        stats.token_distribution.input += undated.input_tokens;
        stats.token_distribution.output += undated.output_tokens;
        stats.token_distribution.cache_creation += undated.cache_creation_tokens;
        stats.token_distribution.cache_read += undated.cache_read_tokens;
        merge_counter_map(&mut stats.tool_usage, &undated.tool_usage);
        merge_counter_map(&mut stats.skill_usage, &undated.skill_usage);
        merge_counter_map(&mut stats.subagent_usage, &undated.subagent_usage);
    }

    if stats.total_messages == 0 {
        return Composed::Ready(None);
    }
    stats.session_duration_minutes = merged_active_minutes(&runs) as u32;
    // `timestamps` stays empty: the aggregation phase in
    // `get_project_stats_summary` never reads it.
    Composed::Ready(Some(stats))
}

/// Compose session token stats from the cached aggregate.
pub(super) fn compose_session_token(
    aggregate: &FileAggregate,
    project_name: String,
    s_limit: Option<&DateTime<Utc>>,
    e_limit: Option<&DateTime<Utc>>,
) -> Composed<Option<SessionTokenStats>> {
    let Some(selection) = included_buckets(aggregate, s_limit, e_limit) else {
        return Composed::NeedsFullScan;
    };
    let Some(session_id) = first_included_session_id(&selection, &aggregate.undated) else {
        // No included rows: the scan returns None.
        return Composed::Ready(None);
    };

    let mut total_input_tokens = 0u64;
    let mut total_output_tokens = 0u64;
    let mut total_cache_creation_tokens = 0u64;
    let mut total_cache_read_tokens = 0u64;
    let mut message_count = 0usize;
    let mut tool_usage: HashMap<String, (u32, u32)> = HashMap::new();
    let mut first: Option<(DateTime<Utc>, &String)> = None;
    let mut last: Option<(DateTime<Utc>, &String)> = None;

    let undated_iter = selection
        .include_undated
        .then_some(&aggregate.undated)
        .into_iter();
    for bucket in selection
        .days
        .iter()
        .map(|(_, bucket)| *bucket)
        .chain(undated_iter)
    {
        message_count += bucket.message_count as usize;
        total_input_tokens += bucket.input_tokens;
        total_output_tokens += bucket.output_tokens;
        total_cache_creation_tokens += bucket.cache_creation_tokens;
        total_cache_read_tokens += bucket.cache_read_tokens;
        merge_counter_map(&mut tool_usage, &bucket.tool_usage);

        if let (Some(ts), Some(raw)) = (bucket.first_ts, bucket.first_ts_raw.as_ref()) {
            if first.map_or(true, |(current, _)| ts < current) {
                first = Some((ts, raw));
            }
        }
        if let (Some(ts), Some(raw)) = (bucket.last_ts, bucket.last_ts_raw.as_ref()) {
            if last.map_or(true, |(current, _)| ts > current) {
                last = Some((ts, raw));
            }
        }
    }

    if message_count == 0 {
        return Composed::Ready(None);
    }

    let total_tokens = total_input_tokens
        + total_output_tokens
        + total_cache_creation_tokens
        + total_cache_read_tokens;

    Composed::Ready(Some(SessionTokenStats {
        session_id: session_id.to_string(),
        project_name,
        total_input_tokens,
        total_output_tokens,
        total_cache_creation_tokens,
        total_cache_read_tokens,
        total_reasoning_tokens: 0,
        total_tokens,
        message_count,
        first_message_time: first
            .map(|(_, raw)| raw.clone())
            .unwrap_or_else(|| "unknown".to_string()),
        last_message_time: last
            .map(|(_, raw)| raw.clone())
            .unwrap_or_else(|| "unknown".to_string()),
        summary: aggregate.summary.clone(),
        // The scan path emits the map unsorted; keep that shape.
        most_used_tools: tool_usage
            .into_iter()
            .map(|(name, (usage, success))| ToolUsageStats {
                tool_name: name,
                usage_count: usage,
                success_rate: if usage > 0 {
                    (success as f32 / usage as f32) * 100.0
                } else {
                    0.0
                },
                avg_execution_time: None,
            })
            .collect(),
    }))
}

/// Compose session comparison stats from the cached aggregate.
pub(super) fn compose_comparison(
    aggregate: &FileAggregate,
    s_limit: Option<&DateTime<Utc>>,
    e_limit: Option<&DateTime<Utc>>,
) -> Composed<Option<SessionComparisonStats>> {
    let Some(selection) = included_buckets(aggregate, s_limit, e_limit) else {
        return Composed::NeedsFullScan;
    };
    let Some(session_id) = first_included_session_id(&selection, &aggregate.undated) else {
        return Composed::Ready(None);
    };

    let mut total_tokens = 0u64;
    let mut message_count = 0usize;
    let mut first: Option<DateTime<Utc>> = None;
    let mut last: Option<DateTime<Utc>> = None;

    let undated_iter = selection
        .include_undated
        .then_some(&aggregate.undated)
        .into_iter();
    for bucket in selection
        .days
        .iter()
        .map(|(_, bucket)| *bucket)
        .chain(undated_iter)
    {
        message_count += bucket.message_count as usize;
        total_tokens += bucket.token_total();
        if let Some(ts) = bucket.first_ts {
            if first.map_or(true, |current| ts < current) {
                first = Some(ts);
            }
        }
        if let Some(ts) = bucket.last_ts {
            if last.map_or(true, |current| ts > current) {
                last = Some(ts);
            }
        }
    }

    let duration_seconds = match (first, last) {
        (Some(first), Some(last)) => (last - first).num_seconds(),
        _ => 0,
    };

    Composed::Ready(Some(SessionComparisonStats {
        session_id: session_id.to_string(),
        total_tokens,
        message_count,
        duration_seconds,
    }))
}

/// Total active minutes over date-ordered runs, merging adjacent runs whose
/// gap is within the session-break threshold — the exact semantics of the
/// scan paths' `calculate_session_active_minutes` on the raw timestamps.
fn merged_active_minutes(runs: &[(DateTime<Utc>, DateTime<Utc>)]) -> u64 {
    let Some(&(first_start, first_end)) = runs.first() else {
        return 0;
    };
    let mut total = 0u64;
    let mut period_start = first_start;
    let mut period_end = first_end;
    for &(run_start, run_end) in &runs[1..] {
        if (run_start - period_end).num_minutes() > SESSION_BREAK_THRESHOLD_MINUTES {
            total += (period_end - period_start).num_minutes().max(1) as u64;
            period_start = run_start;
        }
        period_end = run_end;
    }
    total + (period_end - period_start).num_minutes().max(1) as u64
}

/// Number of aggregate builds recorded for `path` (canonicalized), across
/// both caches. Test-only cache-hit observability.
#[cfg(test)]
pub(super) fn test_build_count(path: &Path) -> u64 {
    let key = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    build_counts()
        .lock()
        .map(|counts| counts.get(&key).copied().unwrap_or(0))
        .unwrap_or(0)
}

#[cfg(test)]
fn build_counts() -> &'static Mutex<HashMap<PathBuf, u64>> {
    static BUILD_COUNTS: OnceLock<Mutex<HashMap<PathBuf, u64>>> = OnceLock::new();
    BUILD_COUNTS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(test)]
mod tests {
    use super::super::{
        claude_session_project_name, process_session_file_for_global_stats,
        process_session_file_for_project_stats, scan_session_file_for_comparison,
        scan_session_file_for_global_stats, scan_session_file_for_project_stats,
        scan_session_token_stats,
    };
    use super::*;
    use crate::models::TokenDistribution;
    use std::fs::{File, OpenOptions};
    use std::io::Write;
    use tempfile::TempDir;

    /// (start, end) date-filter pair used by the equivalence tests.
    type FilterRange = (Option<DateTime<Utc>>, Option<DateTime<Utc>>);

    fn dt(raw: &str) -> DateTime<Utc> {
        parse_timestamp_utc(raw).expect("test timestamp must parse")
    }

    /// Assistant row with usage; `extra` is spliced into the top-level object
    /// (e.g. `"isSidechain":true`). Content carries a Bash `tool_use`.
    fn asst_line(uuid: &str, mid: &str, ts: &str, input: u64, output: u64, extra: &str) -> String {
        let ts_field = if ts.is_empty() {
            String::new()
        } else {
            format!(r#""timestamp":"{ts}","#)
        };
        format!(
            r#"{{"uuid":"{uuid}","sessionId":"s1",{ts_field}"type":"assistant","message":{{"role":"assistant","content":[{{"type":"tool_use","name":"Bash","input":{{}}}}],"id":"{mid}","model":"claude-sonnet-4","usage":{{"input_tokens":{input},"output_tokens":{output}}}}}{extra}}}"#
        )
    }

    fn skill_line(uuid: &str, mid: &str, ts: &str, input: u64, output: u64) -> String {
        format!(
            r#"{{"uuid":"{uuid}","sessionId":"s1","timestamp":"{ts}","type":"assistant","message":{{"role":"assistant","content":[{{"type":"tool_use","name":"Skill","input":{{"skill":"triage"}}}},{{"type":"tool_use","name":"Agent","input":{{"subagent_type":"Explore"}}}}],"id":"{mid}","model":"claude-opus-4","usage":{{"input_tokens":{input},"output_tokens":{output}}}}}}}"#
        )
    }

    fn write_session(path: &Path, lines: &[String]) {
        let mut file = File::create(path).expect("create session file");
        for line in lines {
            writeln!(file, "{line}").expect("write session line");
        }
    }

    /// Multi-day fixture: dup message ids on one day, an intra-day >2h gap,
    /// a sidechain row, skill/agent usage, an unparseable timestamp, and a
    /// summary row.
    fn multi_day_fixture() -> Vec<String> {
        vec![
            asst_line("u1", "m1", "2025-03-01T10:00:00Z", 100, 10, ""),
            // duplicate of m1 on the same day: tokens dedup to zero
            asst_line("u2", "m1", "2025-03-01T10:05:00Z", 100, 10, ""),
            // >120min gap: second activity run on 2025-03-01
            asst_line("u3", "m2", "2025-03-01T13:30:00Z", 50, 5, ""),
            skill_line("u4", "m3", "2025-03-02T09:00:00Z", 30, 3),
            // sidechain: excluded in conversation_only mode
            asst_line(
                "u5",
                "m4",
                "2025-03-02T09:30:00Z",
                1000,
                100,
                r#","isSidechain":true"#,
            ),
            asst_line("u6", "m5", "2025-03-05T08:00:00Z", 7, 2, ""),
            // unparseable timestamp: undated bucket in both pipelines
            asst_line("u7", "m6", "not-a-timestamp", 11, 1, ""),
            r#"{"type":"summary","summary":"Cache fixture summary","leafUuid":"u1"}"#.to_string(),
        ]
    }

    fn daily_map(
        daily: &HashMap<String, DailyStats>,
    ) -> BTreeMap<String, (u64, u64, u64, usize, usize, usize)> {
        daily
            .iter()
            .map(|(date, d)| {
                (
                    date.clone(),
                    (
                        d.total_tokens,
                        d.input_tokens,
                        d.output_tokens,
                        d.message_count,
                        d.session_count,
                        d.active_hours,
                    ),
                )
            })
            .collect()
    }

    fn assert_token_distribution_eq(a: &TokenDistribution, b: &TokenDistribution) {
        assert_eq!(a.input, b.input, "token_distribution.input");
        assert_eq!(a.output, b.output, "token_distribution.output");
        assert_eq!(
            a.cache_creation, b.cache_creation,
            "token_distribution.cache_creation"
        );
        assert_eq!(a.cache_read, b.cache_read, "token_distribution.cache_read");
        assert_eq!(a.reasoning, b.reasoning, "token_distribution.reasoning");
    }

    fn assert_global_stats_eq(a: &SessionFileStats, b: &SessionFileStats) {
        assert_eq!(a.total_messages, b.total_messages, "total_messages");
        assert_eq!(a.total_tokens, b.total_tokens, "total_tokens");
        assert_token_distribution_eq(&a.token_distribution, &b.token_distribution);
        assert_eq!(a.tool_usage, b.tool_usage, "tool_usage");
        assert_eq!(a.skill_usage, b.skill_usage, "skill_usage");
        assert_eq!(a.subagent_usage, b.subagent_usage, "subagent_usage");
        assert_eq!(daily_map(&a.daily_stats), daily_map(&b.daily_stats));
        assert_eq!(a.activity_data, b.activity_data, "activity_data");
        assert_eq!(a.model_usage, b.model_usage, "model_usage");
        assert_eq!(
            a.session_duration_minutes, b.session_duration_minutes,
            "session_duration_minutes"
        );
        assert_eq!(a.first_message, b.first_message, "first_message");
        assert_eq!(a.last_message, b.last_message, "last_message");
        assert_eq!(a.project_name, b.project_name, "project_name");
        assert_eq!(a.provider, b.provider, "provider");
    }

    /// `timestamps` is intentionally not compared: the aggregation phase in
    /// `get_project_stats_summary` never reads it, and the cached composition
    /// leaves it empty.
    fn assert_project_stats_eq(a: &ProjectSessionFileStats, b: &ProjectSessionFileStats) {
        assert_eq!(a.total_messages, b.total_messages, "total_messages");
        assert_token_distribution_eq(&a.token_distribution, &b.token_distribution);
        assert_eq!(a.tool_usage, b.tool_usage, "tool_usage");
        assert_eq!(a.skill_usage, b.skill_usage, "skill_usage");
        assert_eq!(a.subagent_usage, b.subagent_usage, "subagent_usage");
        assert_eq!(daily_map(&a.daily_stats), daily_map(&b.daily_stats));
        assert_eq!(a.activity_data, b.activity_data, "activity_data");
        assert_eq!(
            a.session_duration_minutes, b.session_duration_minutes,
            "session_duration_minutes"
        );
        assert_eq!(a.session_dates, b.session_dates, "session_dates");
    }

    fn sorted_tools(tools: &[ToolUsageStats]) -> Vec<(String, u32, u32)> {
        let mut out: Vec<(String, u32, u32)> = tools
            .iter()
            .map(|t| (t.tool_name.clone(), t.usage_count, t.success_rate.to_bits()))
            .collect();
        out.sort();
        out
    }

    fn assert_token_stats_eq(a: &SessionTokenStats, b: &SessionTokenStats) {
        assert_eq!(a.session_id, b.session_id, "session_id");
        assert_eq!(a.project_name, b.project_name, "project_name");
        assert_eq!(a.total_input_tokens, b.total_input_tokens);
        assert_eq!(a.total_output_tokens, b.total_output_tokens);
        assert_eq!(a.total_cache_creation_tokens, b.total_cache_creation_tokens);
        assert_eq!(a.total_cache_read_tokens, b.total_cache_read_tokens);
        assert_eq!(a.total_reasoning_tokens, b.total_reasoning_tokens);
        assert_eq!(a.total_tokens, b.total_tokens, "total_tokens");
        assert_eq!(a.message_count, b.message_count, "message_count");
        assert_eq!(a.first_message_time, b.first_message_time);
        assert_eq!(a.last_message_time, b.last_message_time);
        assert_eq!(a.summary, b.summary, "summary");
        assert_eq!(
            sorted_tools(&a.most_used_tools),
            sorted_tools(&b.most_used_tools)
        );
    }

    fn assert_comparison_eq(a: &SessionComparisonStats, b: &SessionComparisonStats) {
        assert_eq!(a.session_id, b.session_id, "session_id");
        assert_eq!(a.total_tokens, b.total_tokens, "total_tokens");
        assert_eq!(a.message_count, b.message_count, "message_count");
        assert_eq!(a.duration_seconds, b.duration_seconds, "duration_seconds");
    }

    #[test]
    /// Repeat calls on an unchanged file are served from cache (single build);
    /// appending to the file changes (size, mtime) and forces a re-parse that
    /// reflects the new data, while a sibling file stays cached.
    fn test_cache_serves_unchanged_file_and_reparses_after_append() {
        let temp_dir = TempDir::new().expect("temp dir");
        let project_dir = temp_dir.path().join("demo-project");
        fs::create_dir_all(&project_dir).expect("project dir");
        let file_a = project_dir.join("session-a.jsonl");
        let file_b = project_dir.join("session-b.jsonl");
        write_session(
            &file_a,
            &[asst_line("a1", "am1", "2025-03-01T10:00:00Z", 100, 10, "")],
        );
        write_session(
            &file_b,
            &[asst_line("b1", "bm1", "2025-03-01T11:00:00Z", 40, 4, "")],
        );

        let mode = StatsMode::BillingTotal;
        let first_a = process_session_file_for_project_stats(&file_a, mode, None, None)
            .expect("stats for file a");
        let _first_b = process_session_file_for_project_stats(&file_b, mode, None, None)
            .expect("stats for file b");
        assert_eq!(test_build_count(&file_a), 1);
        assert_eq!(test_build_count(&file_b), 1);
        assert_eq!(first_a.token_distribution.input, 100);

        // Unchanged files: served from cache, no new builds.
        let second_a = process_session_file_for_project_stats(&file_a, mode, None, None)
            .expect("stats for file a (cached)");
        let _second_b = process_session_file_for_project_stats(&file_b, mode, None, None)
            .expect("stats for file b (cached)");
        assert_eq!(
            test_build_count(&file_a),
            1,
            "file a must be served from cache"
        );
        assert_eq!(
            test_build_count(&file_b),
            1,
            "file b must be served from cache"
        );
        assert_project_stats_eq(&second_a, &first_a);

        // Append to file a: (size, mtime) changes, so it must re-parse.
        let mut appender = OpenOptions::new()
            .append(true)
            .open(&file_a)
            .expect("open file a for append");
        writeln!(
            appender,
            "{}",
            asst_line("a2", "am2", "2025-03-01T10:30:00Z", 25, 5, "")
        )
        .expect("append to file a");
        drop(appender);

        let third_a = process_session_file_for_project_stats(&file_a, mode, None, None)
            .expect("stats for mutated file a");
        let _third_b = process_session_file_for_project_stats(&file_b, mode, None, None)
            .expect("stats for file b (still cached)");
        assert_eq!(test_build_count(&file_a), 2, "mutated file a must re-parse");
        assert_eq!(
            test_build_count(&file_b),
            1,
            "unchanged file b stays cached"
        );
        assert_eq!(third_a.token_distribution.input, 125);
        assert_eq!(third_a.total_messages, 2);
    }

    #[test]
    /// The two stats modes occupy independent slots of the same entry: each
    /// mode builds once, then both are served from cache.
    fn test_cache_keeps_separate_slots_per_stats_mode() {
        let temp_dir = TempDir::new().expect("temp dir");
        let file = temp_dir.path().join("modes.jsonl");
        write_session(
            &file,
            &[
                asst_line("u1", "m1", "2025-03-01T10:00:00Z", 100, 10, ""),
                asst_line(
                    "u2",
                    "m2",
                    "2025-03-01T10:05:00Z",
                    200,
                    20,
                    r#","isSidechain":true"#,
                ),
            ],
        );

        let billing =
            process_session_file_for_project_stats(&file, StatsMode::BillingTotal, None, None)
                .expect("billing stats");
        assert_eq!(test_build_count(&file), 1);
        let conversation =
            process_session_file_for_project_stats(&file, StatsMode::ConversationOnly, None, None)
                .expect("conversation stats");
        assert_eq!(test_build_count(&file), 2, "each mode builds its own slot");
        assert_eq!(billing.token_distribution.input, 300);
        assert_eq!(conversation.token_distribution.input, 100);

        let billing_again =
            process_session_file_for_project_stats(&file, StatsMode::BillingTotal, None, None)
                .expect("billing stats (cached)");
        let conversation_again =
            process_session_file_for_project_stats(&file, StatsMode::ConversationOnly, None, None)
                .expect("conversation stats (cached)");
        assert_eq!(
            test_build_count(&file),
            2,
            "both slots now served from cache"
        );
        assert_project_stats_eq(&billing_again, &billing);
        assert_project_stats_eq(&conversation_again, &conversation);
    }

    #[test]
    /// Composed global stats are identical to the full scan, unfiltered and
    /// with a day-aligned date filter, in both stats modes.
    fn test_global_compose_matches_full_scan_unfiltered_and_day_filtered() {
        let temp_dir = TempDir::new().expect("temp dir");
        let project_dir = temp_dir.path().join("demo-project");
        fs::create_dir_all(&project_dir).expect("project dir");
        let file = project_dir.join("session-global.jsonl");
        write_session(&file, &multi_day_fixture());

        let filters: [FilterRange; 3] = [
            (None, None),
            (
                Some(dt("2025-03-02T00:00:00Z")),
                Some(dt("2025-03-05T23:59:59.999Z")),
            ),
            (None, Some(dt("2025-03-01T23:59:59.999Z"))),
        ];

        for mode in [StatsMode::BillingTotal, StatsMode::ConversationOnly] {
            let aggregate =
                build_global_file_aggregate(&file, mode).expect("global aggregate builds");
            for (s, e) in &filters {
                let composed = match compose_global(
                    &aggregate,
                    claude_session_project_name(&file),
                    s.as_ref(),
                    e.as_ref(),
                ) {
                    Composed::Ready(stats) => stats,
                    Composed::NeedsFullScan => {
                        panic!("day-aligned filter must compose from daily buckets")
                    }
                };
                let scanned =
                    scan_session_file_for_global_stats(&file, mode, s.as_ref(), e.as_ref())
                        .expect("scan produces stats");
                assert_global_stats_eq(&composed, &scanned);
            }
        }
    }

    #[test]
    /// Composed message-pipeline results (project stats, token stats, session
    /// comparison) are identical to their full scans, unfiltered and with a
    /// day-aligned date filter.
    fn test_message_compose_matches_full_scan_for_project_token_and_comparison() {
        let temp_dir = TempDir::new().expect("temp dir");
        let project_dir = temp_dir.path().join("demo-project");
        fs::create_dir_all(&project_dir).expect("project dir");
        let file = project_dir.join("session-message.jsonl");
        write_session(&file, &multi_day_fixture());

        let filters: [FilterRange; 3] = [
            (None, None),
            (
                Some(dt("2025-03-02T00:00:00Z")),
                Some(dt("2025-03-05T23:59:59.999Z")),
            ),
            (Some(dt("2025-03-05T00:00:00Z")), None),
        ];

        for mode in [StatsMode::BillingTotal, StatsMode::ConversationOnly] {
            let aggregate =
                build_message_file_aggregate(&file, mode).expect("message aggregate builds");
            for (s, e) in &filters {
                let composed_project = match compose_project(&aggregate, s.as_ref(), e.as_ref()) {
                    Composed::Ready(stats) => stats,
                    Composed::NeedsFullScan => {
                        panic!("day-aligned filter must compose from daily buckets")
                    }
                };
                let scanned_project =
                    scan_session_file_for_project_stats(&file, mode, s.as_ref(), e.as_ref());
                match (&composed_project, &scanned_project) {
                    (Some(a), Some(b)) => assert_project_stats_eq(a, b),
                    (None, None) => {}
                    _ => panic!("composed/scanned project stats presence must match"),
                }

                let composed_token = match compose_session_token(
                    &aggregate,
                    claude_session_project_name(&file),
                    s.as_ref(),
                    e.as_ref(),
                ) {
                    Composed::Ready(stats) => stats,
                    Composed::NeedsFullScan => {
                        panic!("day-aligned filter must compose from daily buckets")
                    }
                };
                let scanned_token = scan_session_token_stats(&file, mode, s.as_ref(), e.as_ref());
                match (&composed_token, &scanned_token) {
                    (Some(a), Some(b)) => assert_token_stats_eq(a, b),
                    (None, None) => {}
                    _ => panic!("composed/scanned token stats presence must match"),
                }

                let composed_cmp = match compose_comparison(&aggregate, s.as_ref(), e.as_ref()) {
                    Composed::Ready(stats) => stats,
                    Composed::NeedsFullScan => {
                        panic!("day-aligned filter must compose from daily buckets")
                    }
                };
                let scanned_cmp =
                    scan_session_file_for_comparison(&file, mode, s.as_ref(), e.as_ref());
                match (&composed_cmp, &scanned_cmp) {
                    (Some(a), Some(b)) => assert_comparison_eq(a, b),
                    (None, None) => {}
                    _ => panic!("composed/scanned comparison presence must match"),
                }
            }
        }
    }

    #[test]
    /// A filter boundary that lands inside a day's data cannot be composed
    /// from daily buckets; composition must signal a full scan and the cached
    /// wrapper must return exactly the scan result.
    fn test_partial_day_filter_needs_full_scan() {
        let temp_dir = TempDir::new().expect("temp dir");
        let file = temp_dir.path().join("partial-day.jsonl");
        write_session(
            &file,
            &[
                asst_line("u1", "m1", "2025-03-01T10:00:00Z", 100, 10, ""),
                asst_line("u2", "m2", "2025-03-01T14:00:00Z", 50, 5, ""),
            ],
        );

        let mode = StatsMode::BillingTotal;
        let s = dt("2025-03-01T12:00:00Z");
        let aggregate = build_message_file_aggregate(&file, mode).expect("aggregate builds");
        assert!(
            matches!(
                compose_project(&aggregate, Some(&s), None),
                Composed::NeedsFullScan
            ),
            "mid-day filter boundary must fall back to the full scan"
        );

        let wrapped = process_session_file_for_project_stats(&file, mode, Some(&s), None)
            .expect("wrapper result");
        let scanned =
            scan_session_file_for_project_stats(&file, mode, Some(&s), None).expect("scan result");
        assert_project_stats_eq(&wrapped, &scanned);
        assert_eq!(wrapped.token_distribution.input, 50);
    }

    #[test]
    /// A deduped usage key spanning two days poisons filtered composition
    /// (the cold scan re-attributes usage to the first in-range row);
    /// unfiltered composition stays exact.
    fn test_dedup_spanning_days_needs_full_scan_when_filtered() {
        let temp_dir = TempDir::new().expect("temp dir");
        let file = temp_dir.path().join("dedup-span.jsonl");
        write_session(
            &file,
            &[
                asst_line("u1", "m1", "2025-03-01T23:59:00Z", 100, 10, ""),
                asst_line("u2", "m1", "2025-03-02T00:01:00Z", 100, 10, ""),
            ],
        );

        let mode = StatsMode::BillingTotal;
        let s = dt("2025-03-02T00:00:00Z");
        let e = dt("2025-03-02T23:59:59.999Z");

        for pipeline in ["global", "message"] {
            if pipeline == "global" {
                let aggregate = build_global_file_aggregate(&file, mode).expect("aggregate builds");
                assert!(matches!(
                    compose_global(&aggregate, "p".to_string(), Some(&s), Some(&e)),
                    Composed::NeedsFullScan
                ));
                // Unfiltered composition remains exact.
                let composed = match compose_global(
                    &aggregate,
                    claude_session_project_name(&file),
                    None,
                    None,
                ) {
                    Composed::Ready(stats) => stats,
                    Composed::NeedsFullScan => panic!("unfiltered composition is always exact"),
                };
                let scanned = scan_session_file_for_global_stats(&file, mode, None, None)
                    .expect("scan produces stats");
                assert_global_stats_eq(&composed, &scanned);
            } else {
                let aggregate =
                    build_message_file_aggregate(&file, mode).expect("aggregate builds");
                assert!(matches!(
                    compose_project(&aggregate, Some(&s), Some(&e)),
                    Composed::NeedsFullScan
                ));
            }
        }

        // The wrapper's filtered result equals the scan: usage counted once,
        // attributed to the first in-range row (the day-2 duplicate).
        let wrapped = process_session_file_for_global_stats(&file, mode, Some(&s), Some(&e))
            .expect("wrapper result");
        let scanned = scan_session_file_for_global_stats(&file, mode, Some(&s), Some(&e))
            .expect("scan result");
        assert_global_stats_eq(&wrapped, &scanned);
        assert_eq!(wrapped.total_tokens, 110);
    }

    #[test]
    /// Run-merging reproduces the scan's gap semantics: runs within the
    /// break threshold merge (including across days), larger gaps split, and
    /// every period counts at least one minute.
    fn test_merged_active_minutes_matches_gap_semantics() {
        // Two runs 30 minutes apart merge into one period of 70 minutes.
        let merged = merged_active_minutes(&[
            (dt("2025-03-01T10:00:00Z"), dt("2025-03-01T10:20:00Z")),
            (dt("2025-03-01T10:50:00Z"), dt("2025-03-01T11:10:00Z")),
        ]);
        assert_eq!(merged, 70);

        // A 3-hour gap splits: 20 + 1 (single-instant run counts 1 minute).
        let split = merged_active_minutes(&[
            (dt("2025-03-01T10:00:00Z"), dt("2025-03-01T10:20:00Z")),
            (dt("2025-03-01T14:00:00Z"), dt("2025-03-01T14:00:00Z")),
        ]);
        assert_eq!(split, 21);

        // Cross-midnight runs 60 minutes apart merge.
        let cross_day = merged_active_minutes(&[
            (dt("2025-03-01T23:00:00Z"), dt("2025-03-01T23:30:00Z")),
            (dt("2025-03-02T00:30:00Z"), dt("2025-03-02T01:00:00Z")),
        ]);
        assert_eq!(cross_day, 120);

        assert_eq!(merged_active_minutes(&[]), 0);
    }

    #[test]
    /// End-to-end through the cached wrapper: a warm cache answers a
    /// day-filtered query from daily buckets with the same result as a cold
    /// scan.
    fn test_wrapper_date_filter_output_matches_cold_scan() {
        let temp_dir = TempDir::new().expect("temp dir");
        let project_dir = temp_dir.path().join("demo-project");
        fs::create_dir_all(&project_dir).expect("project dir");
        let file = project_dir.join("session-filtered.jsonl");
        write_session(&file, &multi_day_fixture());

        let mode = StatsMode::BillingTotal;
        // Warm the cache with an unfiltered call.
        process_session_file_for_global_stats(&file, mode, None, None).expect("warm call");
        assert_eq!(test_build_count(&file), 1);

        let s = dt("2025-03-02T00:00:00Z");
        let e = dt("2025-03-02T23:59:59.999Z");
        let cached = process_session_file_for_global_stats(&file, mode, Some(&s), Some(&e))
            .expect("cached filtered result");
        assert_eq!(
            test_build_count(&file),
            1,
            "filtered call must not re-parse"
        );
        let scanned = scan_session_file_for_global_stats(&file, mode, Some(&s), Some(&e))
            .expect("cold filtered result");
        assert_global_stats_eq(&cached, &scanned);
        // Day 2 of the fixture: skill row (33) + sidechain row (1100).
        assert_eq!(cached.total_tokens, 1133);
    }
}
