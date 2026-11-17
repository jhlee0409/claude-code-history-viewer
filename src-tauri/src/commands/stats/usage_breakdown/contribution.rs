//! Usage contributions (ADR 0002 §7): one record per accepted row of one
//! session file, computed once per file and summed per request into
//! whichever interval contains the row.
//!
//! The file-wide state runs **before** interval assignment, in file order:
//! the stats-mode filter, the streamed-turn growth rule (#575) and the
//! source-cost dedup (#283) — all through the production helpers in
//! `stats.rs` — and the pricing source, which is decided per dedup identity
//! once every row of the file has been seen (§4). Each contribution keeps only
//! its own row's growth, so splitting a file at any interval edge never
//! double counts.

use super::{timestamp_ms_floor, PricingSource};
use crate::commands::stats::session_files::open_session_file;
use crate::commands::stats::{
    capture_session_title, context_tier_min_tokens, dedup_source_cost, dedup_token_totals,
    dedup_usage_key, extract_token_usage, normalize_service_tier, parse_raw_log_entry_simd,
    parse_timestamp_utc, should_include_stats_entry, should_include_stats_message,
    token_usage_has_token_fields, usage_context_tokens, AntigravityUsageRecord, StatsMode,
    UsageDedupState, UsageGrowth,
};
use crate::models::{ClaudeMessage, TokenUsage};
use crate::utils::find_line_ranges;
use memmap2::Mmap;
use std::collections::{HashMap, HashSet};
use std::path::Path;

/// One row's token growth per class. `u32` like the `TokenUsage` counters it
/// comes from (a row's growth never exceeds its own counter).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) struct TokenClasses {
    pub input: u32,
    pub output: u32,
    pub cache_creation: u32,
    /// 1-hour share of `cache_creation` (the rest is 5-minute writes).
    pub cache_creation_1h: u32,
    pub cache_read: u32,
    pub reasoning: u32,
}

impl TokenClasses {
    pub fn total(&self) -> u64 {
        u64::from(self.input)
            + u64::from(self.output)
            + u64::from(self.cache_creation)
            + u64::from(self.cache_read)
            + u64::from(self.reasoning)
    }

    fn from_growth(growth: &UsageGrowth) -> Self {
        let (input, output, cache_creation, cache_read, reasoning, _) = growth.totals;
        Self {
            input: saturate(input),
            output: saturate(output),
            cache_creation: saturate(cache_creation),
            cache_creation_1h: saturate(growth.cache_creation_tokens_1h.min(cache_creation)),
            cache_read: saturate(cache_read),
            reasoning: saturate(reasoning),
        }
    }
}

fn saturate(value: u64) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

/// The model bucket of a contribution inside its file. `model: None` is a row
/// without a model name (the `unknown` bucket, ADR §6).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(super) struct FileBucket {
    pub model: Option<String>,
    pub service_tier: Option<String>,
    pub pricing_source: PricingSource,
}

/// Marks a counted row that carries no usage (e.g. a user prompt): it counts
/// as a message of its interval and session but enters no model bucket.
const MESSAGE_ONLY: u32 = u32::MAX;

/// One accepted, dated row. 48 bytes; the cache budget assumes that size.
#[derive(Debug, Clone, Copy)]
pub(super) struct Contribution {
    /// Row timestamp, epoch ms floored (`timestamp_ms_floor`).
    pub ts_ms: i64,
    /// Provider cost charged on this row after dedup; 0 when none.
    pub cost_usd: f64,
    pub tokens: TokenClasses,
    /// Long-context pricing tier (`ModelContextStats::min_context_tokens`).
    pub context_tier: u32,
    bucket: u32,
}

impl Contribution {
    /// Index into [`FileContributions::buckets`], `None` for a message-only row.
    pub fn bucket(&self) -> Option<usize> {
        (self.bucket != MESSAGE_ONLY).then_some(self.bucket as usize)
    }
}

/// Every contribution of one session file, for one stats mode.
#[derive(Debug, Default)]
pub(super) struct FileContributions {
    pub buckets: Vec<FileBucket>,
    /// Dated rows in file order.
    pub contributions: Vec<Contribution>,
    /// Accepted rows without a parseable timestamp (ADR §6): in no total.
    pub undated_rows: u64,
    /// Session id of the first accepted row (as the old session stats pick it).
    pub session_id: Option<String>,
    /// Last `ai-title`, else last legacy `summary` row (Claude only).
    pub title: Option<String>,
}

impl FileContributions {
    /// Heap + inline footprint used by the cache's byte budget.
    pub fn approx_bytes(&self) -> usize {
        let strings: usize = self
            .buckets
            .iter()
            .map(|b| {
                b.model.as_ref().map_or(0, String::len)
                    + b.service_tier.as_ref().map_or(0, String::len)
            })
            .sum();
        std::mem::size_of::<Self>()
            + self.contributions.capacity() * std::mem::size_of::<Contribution>()
            + self.buckets.capacity() * std::mem::size_of::<FileBucket>()
            + strings
            + self.session_id.as_ref().map_or(0, String::len)
            + self.title.as_ref().map_or(0, String::len)
    }
}

/// One accepted row as the dedup state sees it.
pub(super) struct RowInput<'a> {
    pub ts_ms: Option<i64>,
    pub session_id: &'a str,
    pub message_id: Option<&'a str>,
    pub uuid: &'a str,
    pub usage: &'a TokenUsage,
    pub model: Option<&'a str>,
    pub cost_usd: Option<f64>,
}

/// A row after dedup, waiting for its identity's pricing source.
struct PendingRow {
    ts_ms: Option<i64>,
    identity: usize,
    tokens: TokenClasses,
    cost_usd: Option<f64>,
    /// Index into `model_keys`; `None` for a message-only row.
    model_key: Option<usize>,
    context_tier: u32,
}

/// Folds the accepted rows of one file into [`FileContributions`].
#[derive(Default)]
pub(super) struct ContributionBuilder {
    seen_usage: UsageDedupState,
    seen_cost: HashSet<String>,
    identities: HashMap<String, usize>,
    /// Per identity: whether any of its rows reports a cost.
    costed: Vec<bool>,
    model_keys: Vec<(Option<String>, Option<String>)>,
    model_key_index: HashMap<(Option<String>, Option<String>), usize>,
    rows: Vec<PendingRow>,
    session_id: Option<String>,
}

impl ContributionBuilder {
    /// Add one row that passed the stats-mode filter.
    pub fn push(&mut self, row: RowInput<'_>) {
        if self.session_id.is_none() {
            self.session_id = Some(row.session_id.to_string());
        }
        let identity = self.identity_of(row.session_id, row.message_id, row.uuid);
        if row.cost_usd.is_some() {
            self.costed[identity] = true;
        }
        let growth = dedup_token_totals(
            &mut self.seen_usage,
            row.session_id,
            row.message_id,
            row.uuid,
            row.usage,
        );
        let cost_usd = dedup_source_cost(
            &mut self.seen_cost,
            row.session_id,
            row.message_id,
            row.uuid,
            row.cost_usd,
        );
        let tokens = TokenClasses::from_growth(&growth);
        // Same bucket rule as the old aggregators.
        let in_bucket = row.model.is_some() || tokens.total() > 0 || cost_usd.is_some();
        let model_key = in_bucket.then(|| {
            self.model_key(
                row.model.map(str::to_string),
                normalize_service_tier(row.usage.service_tier.as_deref()),
            )
        });
        let model_name = row
            .model
            .unwrap_or(crate::commands::stats::UNKNOWN_MODEL_NAME);
        self.rows.push(PendingRow {
            ts_ms: row.ts_ms,
            identity,
            tokens,
            cost_usd,
            model_key,
            context_tier: saturate(context_tier_min_tokens(
                model_name,
                usage_context_tokens(row.usage),
            )),
        });
    }

    /// Add one pre-aggregated request record (Antigravity): its own identity,
    /// no dedup and no provider cost.
    fn push_record(
        &mut self,
        ts_ms: i64,
        session_id: &str,
        model: &str,
        tokens: TokenClasses,
        context_tokens: u64,
    ) {
        if self.session_id.is_none() {
            self.session_id = Some(session_id.to_string());
        }
        let identity = self.fresh_identity();
        let model_key = self.model_key(Some(model.to_string()), None);
        self.rows.push(PendingRow {
            ts_ms: Some(ts_ms),
            identity,
            tokens,
            cost_usd: None,
            model_key: Some(model_key),
            context_tier: saturate(context_tier_min_tokens(model, context_tokens)),
        });
    }

    fn identity_of(&mut self, session_id: &str, message_id: Option<&str>, uuid: &str) -> usize {
        // A row without any id has no identity and is never merged.
        let Some(key) = dedup_usage_key(session_id, message_id, uuid) else {
            return self.fresh_identity();
        };
        if let Some(&id) = self.identities.get(&key) {
            return id;
        }
        let id = self.fresh_identity();
        self.identities.insert(key, id);
        id
    }

    fn fresh_identity(&mut self) -> usize {
        self.costed.push(false);
        self.costed.len() - 1
    }

    fn model_key(&mut self, model: Option<String>, service_tier: Option<String>) -> usize {
        let key = (model, service_tier);
        if let Some(&index) = self.model_key_index.get(&key) {
            return index;
        }
        self.model_keys.push(key.clone());
        self.model_key_index.insert(key, self.model_keys.len() - 1);
        self.model_keys.len() - 1
    }

    /// Decide every row's pricing source from its identity and drop undated
    /// rows into the count.
    pub fn finish(self, title: Option<String>) -> FileContributions {
        let mut out = FileContributions {
            session_id: self.session_id,
            title,
            ..FileContributions::default()
        };
        let mut bucket_index: HashMap<(usize, PricingSource), u32> = HashMap::new();
        out.contributions.reserve_exact(self.rows.len());
        for row in self.rows {
            let Some(ts_ms) = row.ts_ms else {
                out.undated_rows += 1;
                continue;
            };
            let pricing_source = if self.costed[row.identity] {
                PricingSource::Source
            } else {
                PricingSource::Estimate
            };
            let bucket = row.model_key.map_or(MESSAGE_ONLY, |model_key| {
                *bucket_index
                    .entry((model_key, pricing_source))
                    .or_insert_with(|| {
                        let (model, service_tier) = self.model_keys[model_key].clone();
                        out.buckets.push(FileBucket {
                            model,
                            service_tier,
                            pricing_source,
                        });
                        u32::try_from(out.buckets.len() - 1).unwrap_or(MESSAGE_ONLY - 1)
                    })
            });
            out.contributions.push(Contribution {
                ts_ms,
                cost_usd: row.cost_usd.unwrap_or(0.0),
                tokens: row.tokens,
                context_tier: row.context_tier,
                bucket,
            });
        }
        out
    }
}

/// Read one Claude session file through the same pipeline as the old
/// project stats (`RawLogEntry → ClaudeMessage`, `should_include_stats_entry`).
///
/// `root` is the canonical directory the file was found under: the file is
/// opened only as a regular file inside it, never through a symlink
/// (`session_files::open_session_file`).
///
/// The timestamp is read from the raw row, before `ClaudeMessage::try_from`
/// stamps `Utc::now()` on undated rows.
#[allow(unsafe_code)] // Read-only mmap, as in the old scan paths.
pub(super) fn read_claude_file(
    path: &Path,
    root: &Path,
    mode: StatsMode,
) -> Result<FileContributions, String> {
    let (file, _) = open_session_file(path, root)?;
    // SAFETY: the file is only read and the handle outlives the map. Session
    // files are append-only.
    let mmap = unsafe { Mmap::map(&file) }.map_err(|e| format!("{}: {e}", path.display()))?;

    let mut builder = ContributionBuilder::default();
    let mut ai_title = None;
    let mut summary = None;
    for (start, end) in find_line_ranges(&mmap) {
        let mut line = mmap[start..end].to_vec();
        let Some(entry) = parse_raw_log_entry_simd(&mut line) else {
            continue;
        };
        capture_session_title(&entry, &mut ai_title, &mut summary);
        let ts_ms = entry
            .timestamp
            .as_deref()
            .and_then(parse_timestamp_utc)
            .map(|ts| timestamp_ms_floor(&ts));
        let Ok(message) = ClaudeMessage::try_from(entry) else {
            continue;
        };
        let usage = extract_token_usage(&message);
        if !should_include_stats_entry(
            &message.message_type,
            message.is_sidechain,
            token_usage_has_token_fields(&usage),
            mode,
        ) {
            continue;
        }
        builder.push(message_row(&message, ts_ms, &usage));
    }
    Ok(builder.finish(ai_title.or(summary)))
}

/// Fold normalized provider messages (the old provider stats path:
/// `should_include_stats_message`, then dedup per session file).
pub(super) fn from_messages(
    messages: &[ClaudeMessage],
    mode: StatsMode,
    title: Option<String>,
) -> FileContributions {
    let mut builder = ContributionBuilder::default();
    for message in messages {
        if !should_include_stats_message(message, mode) {
            continue;
        }
        let usage = extract_token_usage(message);
        let ts_ms = parse_timestamp_utc(&message.timestamp).map(|ts| timestamp_ms_floor(&ts));
        builder.push(message_row(message, ts_ms, &usage));
    }
    builder.finish(title)
}

fn message_row<'a>(
    message: &'a ClaudeMessage,
    ts_ms: Option<i64>,
    usage: &'a TokenUsage,
) -> RowInput<'a> {
    RowInput {
        ts_ms,
        session_id: &message.session_id,
        message_id: message.message_id.as_deref(),
        uuid: &message.uuid,
        usage,
        model: message.model.as_deref(),
        cost_usd: message.cost_usd,
    }
}

/// Fold Antigravity usage records with the old mode split (conversation-only
/// keeps the chat share of input and cache tokens).
pub(super) fn from_antigravity_records(
    records: &[AntigravityUsageRecord],
    mode: StatsMode,
    session_id: &str,
    title: Option<String>,
) -> FileContributions {
    let mut builder = ContributionBuilder::default();
    for record in records {
        let (input, cache_creation, cache_read) = match mode {
            StatsMode::BillingTotal => (
                record.input_tokens,
                record.cache_creation_tokens,
                record.cache_read_tokens,
            ),
            StatsMode::ConversationOnly => (
                record.conversation_input_tokens,
                record.conversation_cache_creation_tokens,
                record.conversation_cache_read_tokens,
            ),
        };
        let tokens = TokenClasses {
            input: saturate(input),
            output: saturate(record.output_tokens),
            cache_creation: saturate(cache_creation),
            cache_creation_1h: 0,
            cache_read: saturate(cache_read),
            reasoning: saturate(record.reasoning_tokens),
        };
        builder.push_record(
            timestamp_ms_floor(&record.timestamp),
            session_id,
            &record.model,
            tokens,
            input + cache_creation + cache_read,
        );
    }
    builder.finish(title)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contribution_fits_the_48_byte_budget() {
        assert_eq!(std::mem::size_of::<Contribution>(), 48);
    }

    fn usage(input: u32, output: u32) -> TokenUsage {
        TokenUsage {
            input_tokens: Some(input),
            output_tokens: Some(output),
            ..TokenUsage::default()
        }
    }

    fn push(
        builder: &mut ContributionBuilder,
        ts: Option<i64>,
        id: &str,
        u: &TokenUsage,
        cost: Option<f64>,
    ) {
        builder.push(RowInput {
            ts_ms: ts,
            session_id: "s",
            message_id: Some(id),
            uuid: "",
            usage: u,
            model: Some("m"),
            cost_usd: cost,
        });
    }

    #[test]
    fn a_cost_on_a_later_row_makes_the_whole_identity_source() {
        let mut builder = ContributionBuilder::default();
        push(&mut builder, Some(1), "a", &usage(10, 1), None);
        push(&mut builder, Some(2), "a", &usage(10, 5), Some(0.5));
        push(&mut builder, Some(3), "b", &usage(7, 0), None);
        let file = builder.finish(None);
        let sources: Vec<_> = file
            .contributions
            .iter()
            .map(|c| file.buckets[c.bucket().unwrap()].pricing_source)
            .collect();
        assert_eq!(
            sources,
            [
                PricingSource::Source,
                PricingSource::Source,
                PricingSource::Estimate
            ]
        );
        // Growth only: the second row adds 4 output, the first carries 11.
        assert_eq!(file.contributions[0].tokens.total(), 11);
        assert_eq!(file.contributions[1].tokens.total(), 4);
        assert_eq!(file.contributions[1].cost_usd, 0.5);
    }

    #[test]
    fn undated_rows_feed_dedup_but_are_only_counted() {
        let mut builder = ContributionBuilder::default();
        push(&mut builder, None, "a", &usage(10, 0), None);
        push(&mut builder, Some(5), "a", &usage(10, 3), None);
        let file = builder.finish(None);
        assert_eq!(file.undated_rows, 1);
        assert_eq!(file.contributions.len(), 1);
        assert_eq!(file.contributions[0].tokens.total(), 3);
    }
}
