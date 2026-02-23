#[cfg(test)]
use crate::models::MessageContent;
use crate::models::{
    ActivityHeatmap, ClaudeMessage, DailyStats, GlobalStatsSummary, ModelStats, ProjectRanking,
    ProjectStatsSummary, ProviderUsageStats, RawLogEntry, SessionComparison, SessionTokenStats,
    TokenDistribution, TokenUsage, ToolUsageStats,
};
use crate::providers;
use crate::utils::find_line_ranges;
use chrono::{DateTime, Datelike, Timelike, Utc};
use memmap2::Mmap;
use rayon::prelude::*;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use walkdir::WalkDir;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
enum StatsProvider {
    #[default]
    Claude,
    Codex,
    OpenCode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StatsMode {
    BillingTotal,
    ConversationOnly,
}

impl StatsMode {
    fn include_sidechain(self) -> bool {
        matches!(self, Self::BillingTotal)
    }
}

fn parse_stats_mode(stats_mode: Option<String>) -> StatsMode {
    match stats_mode.as_deref() {
        Some("conversation_only") => StatsMode::ConversationOnly,
        Some("billing_total") | None => StatsMode::BillingTotal,
        Some(raw) => {
            log::warn!("Unknown stats_mode '{raw}', defaulting to 'billing_total'");
            StatsMode::BillingTotal
        }
    }
}

fn stats_provider_id(provider: StatsProvider) -> &'static str {
    match provider {
        StatsProvider::Claude => "claude",
        StatsProvider::Codex => "codex",
        StatsProvider::OpenCode => "opencode",
    }
}

fn is_core_message_type(message_type: &str) -> bool {
    matches!(message_type, "user" | "assistant" | "system")
}

fn is_conversation_message_type(message_type: &str) -> bool {
    matches!(message_type, "user" | "assistant")
}

fn is_non_message_noise_type(message_type: &str) -> bool {
    matches!(
        message_type,
        "progress" | "queue-operation" | "file-history-snapshot"
    )
}

fn token_usage_has_token_fields(usage: &TokenUsage) -> bool {
    usage.input_tokens.is_some()
        || usage.output_tokens.is_some()
        || usage.cache_creation_input_tokens.is_some()
        || usage.cache_read_input_tokens.is_some()
}

fn token_usage_totals(usage: &TokenUsage) -> (u64, u64, u64, u64, u64) {
    let input_tokens = u64::from(usage.input_tokens.unwrap_or(0));
    let output_tokens = u64::from(usage.output_tokens.unwrap_or(0));
    let cache_creation_tokens = u64::from(usage.cache_creation_input_tokens.unwrap_or(0));
    let cache_read_tokens = u64::from(usage.cache_read_input_tokens.unwrap_or(0));
    let total_tokens = input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens;
    (
        input_tokens,
        output_tokens,
        cache_creation_tokens,
        cache_read_tokens,
        total_tokens,
    )
}

fn should_include_stats_entry(
    message_type: &str,
    is_sidechain: Option<bool>,
    has_usage: bool,
    mode: StatsMode,
) -> bool {
    if message_type == "summary" {
        return false;
    }

    if !mode.include_sidechain() && is_sidechain.unwrap_or(false) {
        return false;
    }

    if matches!(mode, StatsMode::ConversationOnly) {
        return is_conversation_message_type(message_type);
    }

    if is_core_message_type(message_type) {
        return true;
    }

    if is_non_message_noise_type(message_type) {
        return has_usage;
    }

    has_usage
}

fn all_stats_providers() -> HashSet<StatsProvider> {
    [
        StatsProvider::Claude,
        StatsProvider::Codex,
        StatsProvider::OpenCode,
    ]
    .into_iter()
    .collect()
}

fn parse_active_stats_providers(active_providers: Option<Vec<String>>) -> HashSet<StatsProvider> {
    let Some(raw_providers) = active_providers else {
        return all_stats_providers();
    };

    let mut unknown = Vec::new();
    let parsed: HashSet<StatsProvider> = raw_providers
        .into_iter()
        .filter_map(|provider| match provider.as_str() {
            "claude" => Some(StatsProvider::Claude),
            "codex" => Some(StatsProvider::Codex),
            "opencode" => Some(StatsProvider::OpenCode),
            _ => {
                unknown.push(provider);
                None
            }
        })
        .collect();

    if !unknown.is_empty() {
        log::warn!(
            "Ignoring unknown providers in active_providers: {}",
            unknown.join(", ")
        );
    }

    parsed
}

fn detect_project_provider(project_path: &str) -> StatsProvider {
    if project_path.starts_with("codex://") {
        StatsProvider::Codex
    } else if project_path.starts_with("opencode://") {
        StatsProvider::OpenCode
    } else {
        StatsProvider::Claude
    }
}

fn detect_session_provider(session_path: &str) -> StatsProvider {
    if session_path.starts_with("opencode://") {
        return StatsProvider::OpenCode;
    }

    let is_rollout = PathBuf::from(session_path)
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            name.starts_with("rollout-")
                && std::path::Path::new(name)
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("jsonl"))
        });

    if is_rollout {
        StatsProvider::Codex
    } else {
        StatsProvider::Claude
    }
}

/// Parse a line using simd-json (requires mutable slice)
/// Returns None if parsing fails
#[inline]
fn parse_raw_log_entry_simd(line: &mut [u8]) -> Option<RawLogEntry> {
    simd_json::serde::from_slice(line).ok()
}

// ---------------------------------------------------------------------------
// Lightweight struct for global stats: only the fields we actually need.
// Skips expensive fields like snapshot, data, hook_infos, etc.
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct GlobalStatsLogEntry {
    #[serde(rename = "type")]
    message_type: String,
    timestamp: Option<String>,
    #[serde(rename = "isSidechain")]
    is_sidechain: Option<bool>,
    message: Option<GlobalStatsMessageContent>,
    #[serde(rename = "toolUse")]
    tool_use: Option<GlobalStatsToolUse>,
    #[serde(rename = "toolUseResult")]
    tool_use_result: Option<GlobalStatsToolUseResult>,
}

#[derive(Debug, Deserialize)]
struct GlobalStatsMessageContent {
    #[allow(dead_code)]
    role: String,
    content: Option<serde_json::Value>,
    model: Option<String>,
    usage: Option<TokenUsage>,
}

#[derive(Debug, Deserialize)]
struct GlobalStatsToolUse {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GlobalStatsToolUseResult {
    is_error: Option<bool>,
    usage: Option<serde_json::Value>,
    #[serde(rename = "totalTokens")]
    total_tokens: Option<u64>,
}

#[inline]
fn parse_global_stats_entry_simd(line: &mut [u8]) -> Option<GlobalStatsLogEntry> {
    simd_json::serde::from_slice(line).ok()
}

fn apply_usage_fields_from_value(usage_obj: &serde_json::Value, usage: &mut TokenUsage) {
    if let Some(input) = usage_obj
        .get("input_tokens")
        .and_then(serde_json::Value::as_u64)
    {
        usage.input_tokens = Some(input as u32);
    }
    if let Some(output) = usage_obj
        .get("output_tokens")
        .and_then(serde_json::Value::as_u64)
    {
        usage.output_tokens = Some(output as u32);
    }
    if let Some(cache_creation) = usage_obj
        .get("cache_creation_input_tokens")
        .and_then(serde_json::Value::as_u64)
    {
        usage.cache_creation_input_tokens = Some(cache_creation as u32);
    }
    if let Some(cache_read) = usage_obj
        .get("cache_read_input_tokens")
        .and_then(serde_json::Value::as_u64)
    {
        usage.cache_read_input_tokens = Some(cache_read as u32);
    }
    if let Some(tier) = usage_obj
        .get("service_tier")
        .and_then(serde_json::Value::as_str)
    {
        usage.service_tier = Some(tier.to_string());
    }
}

/// Extract token usage from the lightweight global stats entry
fn extract_token_usage_from_global_entry(entry: &GlobalStatsLogEntry) -> TokenUsage {
    // 1. From message.usage (most common for assistant messages)
    if let Some(msg) = &entry.message {
        if let Some(usage) = &msg.usage {
            return usage.clone();
        }

        if let Some(content) = &msg.content {
            if content.is_object() && content.get("usage").is_some() {
                let mut usage = TokenUsage {
                    input_tokens: None,
                    output_tokens: None,
                    cache_creation_input_tokens: None,
                    cache_read_input_tokens: None,
                    service_tier: None,
                };
                if let Some(usage_obj) = content.get("usage") {
                    apply_usage_fields_from_value(usage_obj, &mut usage);
                    if token_usage_has_token_fields(&usage) {
                        return usage;
                    }
                }
            }
        }
    }

    let mut usage = TokenUsage {
        input_tokens: None,
        output_tokens: None,
        cache_creation_input_tokens: None,
        cache_read_input_tokens: None,
        service_tier: None,
    };

    // 2. From tool_use_result.usage
    if let Some(tur) = &entry.tool_use_result {
        if let Some(usage_obj) = &tur.usage {
            apply_usage_fields_from_value(usage_obj, &mut usage);
        }

        // 3. From tool_use_result.totalTokens fallback
        if usage.input_tokens.is_none() && usage.output_tokens.is_none() {
            if let Some(total) = tur.total_tokens {
                if entry.message_type == "assistant" {
                    usage.output_tokens = Some(total as u32);
                } else {
                    usage.input_tokens = Some(total as u32);
                }
            }
        }
    }

    usage
}

/// Track tool usage from the lightweight global stats entry
fn track_tool_usage_from_global_entry(
    entry: &GlobalStatsLogEntry,
    tool_usage: &mut HashMap<String, (u32, u32)>,
) {
    // From assistant content array
    if entry.message_type == "assistant" {
        if let Some(msg) = &entry.message {
            if let Some(content) = &msg.content {
                if let Some(arr) = content.as_array() {
                    for item in arr {
                        if item.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                            if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                                let e = tool_usage.entry(name.to_string()).or_insert((0, 0));
                                e.0 += 1;
                                let is_error = item
                                    .get("is_error")
                                    .and_then(serde_json::Value::as_bool)
                                    .unwrap_or(false);
                                if !is_error {
                                    e.1 += 1;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // From explicit tool_use field
    if let Some(tu) = &entry.tool_use {
        if let Some(name) = &tu.name {
            let e = tool_usage.entry(name.clone()).or_insert((0, 0));
            e.0 += 1;
            if let Some(tur) = &entry.tool_use_result {
                let is_error = tur.is_error.unwrap_or(false);
                if !is_error {
                    e.1 += 1;
                }
            }
        }
    }
}

/// Intermediate stats collected from a single session file (for parallel processing)
#[derive(Default)]
struct SessionFileStats {
    total_messages: u32,
    total_tokens: u64,
    token_distribution: TokenDistribution,
    tool_usage: HashMap<String, (u32, u32)>, // (usage_count, success_count)
    daily_stats: HashMap<String, DailyStats>,
    activity_data: HashMap<(u8, u8), (u32, u64)>, // (hour, day) -> (count, tokens)
    model_usage: HashMap<String, (u32, u64, u64, u64, u64, u64)>, // model -> (msg_count, total, input, output, cache_create, cache_read)
    session_duration_minutes: u64,
    first_message: Option<DateTime<Utc>>,
    last_message: Option<DateTime<Utc>>,
    project_name: String,
    provider: StatsProvider,
}

/// Process a single session file using lightweight deserialization for global stats.
/// Only parses fields needed for stats (timestamp, usage, model, tool names).
#[allow(unsafe_code)] // Required for mmap performance optimization
fn process_session_file_for_global_stats(
    session_path: &PathBuf,
    mode: StatsMode,
) -> Option<SessionFileStats> {
    let file = fs::File::open(session_path).ok()?;

    // SAFETY: We're only reading the file, and the file handle is kept open
    // for the duration of the mmap's lifetime. Session files are append-only.
    let mmap = unsafe { Mmap::map(&file) }.ok()?;

    let project_name = session_path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let mut stats = SessionFileStats {
        project_name,
        provider: StatsProvider::Claude,
        ..Default::default()
    };

    let mut session_timestamps: Vec<DateTime<Utc>> = Vec::new();

    // Use SIMD-accelerated line detection
    let line_ranges = find_line_ranges(&mmap);

    for (start, end) in line_ranges {
        let mut line_bytes = mmap[start..end].to_vec();

        let Some(entry) = parse_global_stats_entry_simd(&mut line_bytes) else {
            continue;
        };

        let usage = extract_token_usage_from_global_entry(&entry);
        let has_usage = token_usage_has_token_fields(&usage);

        if !should_include_stats_entry(&entry.message_type, entry.is_sidechain, has_usage, mode) {
            continue;
        }

        stats.total_messages = stats.total_messages.saturating_add(1);
        let (input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, tokens) =
            token_usage_totals(&usage);

        stats.total_tokens += tokens;
        stats.token_distribution.input += input_tokens;
        stats.token_distribution.output += output_tokens;
        stats.token_distribution.cache_creation += cache_creation_tokens;
        stats.token_distribution.cache_read += cache_read_tokens;
        if let Some(msg) = &entry.message {
            if let Some(model_name) = &msg.model {
                let model_entry = stats
                    .model_usage
                    .entry(model_name.clone())
                    .or_insert((0, 0, 0, 0, 0, 0));
                model_entry.0 += 1;
                model_entry.1 += tokens;
                model_entry.2 += input_tokens;
                model_entry.3 += output_tokens;
                model_entry.4 += cache_creation_tokens;
                model_entry.5 += cache_read_tokens;
            }
        }

        let Some(ts_str) = &entry.timestamp else {
            track_tool_usage_from_global_entry(&entry, &mut stats.tool_usage);
            continue;
        };

        let Ok(parsed_ts) = DateTime::parse_from_rfc3339(ts_str) else {
            track_tool_usage_from_global_entry(&entry, &mut stats.tool_usage);
            continue;
        };

        let timestamp = parsed_ts.with_timezone(&Utc);
        session_timestamps.push(timestamp);

        // Track first/last message
        if stats
            .first_message
            .map_or(true, |current| timestamp < current)
        {
            stats.first_message = Some(timestamp);
        }
        if stats
            .last_message
            .map_or(true, |current| timestamp > current)
        {
            stats.last_message = Some(timestamp);
        }

        let hour = timestamp.hour() as u8;
        let day = timestamp.weekday().num_days_from_sunday() as u8;

        // Activity data
        let activity_entry = stats.activity_data.entry((hour, day)).or_insert((0, 0));
        activity_entry.0 += 1;
        activity_entry.1 += tokens;

        // Daily stats
        let date = timestamp.format("%Y-%m-%d").to_string();
        let daily_entry = stats
            .daily_stats
            .entry(date.clone())
            .or_insert_with(|| DailyStats {
                date,
                ..Default::default()
            });
        daily_entry.total_tokens += tokens;
        daily_entry.input_tokens += input_tokens;
        daily_entry.output_tokens += output_tokens;
        daily_entry.message_count += 1;

        // Track tool usage
        track_tool_usage_from_global_entry(&entry, &mut stats.tool_usage);
    }

    // Calculate session duration
    calculate_session_duration(&mut session_timestamps, &mut stats);

    Some(stats)
}

/// Calculate active session duration from sorted timestamps
fn calculate_session_duration(
    session_timestamps: &mut Vec<DateTime<Utc>>,
    stats: &mut SessionFileStats,
) {
    const SESSION_BREAK_THRESHOLD_MINUTES: i64 = 120;

    if session_timestamps.len() >= 2 {
        session_timestamps.sort_unstable();
        let mut current_period_start = session_timestamps[0];
        let mut total_active_minutes = 0u64;

        for i in 0..session_timestamps.len() - 1 {
            let current = session_timestamps[i];
            let next = session_timestamps[i + 1];
            let gap_minutes = (next - current).num_minutes();

            if gap_minutes > SESSION_BREAK_THRESHOLD_MINUTES {
                let period_duration = (current - current_period_start).num_minutes();
                total_active_minutes += period_duration.max(1) as u64;
                current_period_start = next;
            }
        }

        let last_timestamp = session_timestamps[session_timestamps.len() - 1];
        let final_period = (last_timestamp - current_period_start).num_minutes();
        total_active_minutes += final_period.max(1) as u64;

        stats.session_duration_minutes = total_active_minutes;
    } else if session_timestamps.len() == 1 {
        stats.session_duration_minutes = 1;
    }
}

fn build_global_session_file_stats_from_messages(
    provider: StatsProvider,
    project_name: String,
    messages: &[ClaudeMessage],
    mode: StatsMode,
) -> Option<SessionFileStats> {
    if messages.is_empty() {
        return None;
    }

    let mut stats = SessionFileStats {
        project_name,
        provider,
        ..Default::default()
    };

    let mut session_timestamps: Vec<DateTime<Utc>> = Vec::new();

    for message in messages {
        let usage = extract_token_usage(message);
        let has_usage = token_usage_has_token_fields(&usage);
        if !should_include_stats_entry(&message.message_type, message.is_sidechain, has_usage, mode)
        {
            continue;
        }

        stats.total_messages = stats.total_messages.saturating_add(1);
        let (input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, tokens) =
            token_usage_totals(&usage);

        stats.total_tokens += tokens;
        stats.token_distribution.input += input_tokens;
        stats.token_distribution.output += output_tokens;
        stats.token_distribution.cache_creation += cache_creation_tokens;
        stats.token_distribution.cache_read += cache_read_tokens;
        if let Some(model_name) = &message.model {
            let model_entry = stats
                .model_usage
                .entry(model_name.clone())
                .or_insert((0, 0, 0, 0, 0, 0));
            model_entry.0 += 1;
            model_entry.1 += tokens;
            model_entry.2 += input_tokens;
            model_entry.3 += output_tokens;
            model_entry.4 += cache_creation_tokens;
            model_entry.5 += cache_read_tokens;
        }

        if let Some(timestamp) = parse_timestamp_utc(&message.timestamp) {
            session_timestamps.push(timestamp);

            // Track first/last message
            if stats.first_message.is_none() || timestamp < stats.first_message.unwrap() {
                stats.first_message = Some(timestamp);
            }
            if stats.last_message.is_none() || timestamp > stats.last_message.unwrap() {
                stats.last_message = Some(timestamp);
            }

            let hour = timestamp.hour() as u8;
            let day = timestamp.weekday().num_days_from_sunday() as u8;

            // Activity data
            let activity_entry = stats.activity_data.entry((hour, day)).or_insert((0, 0));
            activity_entry.0 += 1;
            activity_entry.1 += tokens;

            // Daily stats
            let date = timestamp.format("%Y-%m-%d").to_string();
            let daily_entry = stats
                .daily_stats
                .entry(date.clone())
                .or_insert_with(|| DailyStats {
                    date,
                    ..Default::default()
                });
            daily_entry.total_tokens += tokens;
            daily_entry.input_tokens += input_tokens;
            daily_entry.output_tokens += output_tokens;
            daily_entry.message_count += 1;
        }

        // Track tool usage
        track_tool_usage(message, &mut stats.tool_usage);
    }

    // Calculate session duration
    const SESSION_BREAK_THRESHOLD_MINUTES: i64 = 120;

    if session_timestamps.len() >= 2 {
        session_timestamps.sort();
        let mut current_period_start = session_timestamps[0];
        let mut total_active_minutes = 0u64;

        for i in 0..session_timestamps.len() - 1 {
            let current = session_timestamps[i];
            let next = session_timestamps[i + 1];
            let gap_minutes = (next - current).num_minutes();

            if gap_minutes > SESSION_BREAK_THRESHOLD_MINUTES {
                let period_duration = (current - current_period_start).num_minutes();
                total_active_minutes += period_duration.max(1) as u64;
                current_period_start = next;
            }
        }

        let last_timestamp = session_timestamps[session_timestamps.len() - 1];
        let final_period = (last_timestamp - current_period_start).num_minutes();
        total_active_minutes += final_period.max(1) as u64;

        stats.session_duration_minutes = total_active_minutes;
    } else if session_timestamps.len() == 1 {
        stats.session_duration_minutes = 1;
    }

    Some(stats)
}

fn collect_provider_global_file_stats(
    provider: StatsProvider,
    mode: StatsMode,
) -> (Vec<SessionFileStats>, HashSet<String>) {
    let mut project_keys = HashSet::new();

    let projects = match provider {
        StatsProvider::Codex => providers::codex::scan_projects().unwrap_or_default(),
        StatsProvider::OpenCode => providers::opencode::scan_projects().unwrap_or_default(),
        StatsProvider::Claude => Vec::new(),
    };

    let provider_tag = match provider {
        StatsProvider::Codex => "codex",
        StatsProvider::OpenCode => "opencode",
        StatsProvider::Claude => "claude",
    };

    // Collect all (project_display_name, session_file_path) pairs first
    let mut session_tasks: Vec<(String, String)> = Vec::new();

    for project in projects {
        let project_display_name = format!("{} [{}]", project.name, provider_tag);
        project_keys.insert(format!("{provider_tag}:{}", project.path));

        let sessions = match provider {
            StatsProvider::Codex => providers::codex::load_sessions(&project.path, false),
            StatsProvider::OpenCode => providers::opencode::load_sessions(&project.path, false),
            StatsProvider::Claude => Ok(Vec::new()),
        }
        .unwrap_or_default();

        for session in sessions {
            session_tasks.push((project_display_name.clone(), session.file_path));
        }
    }

    // Process all sessions in parallel
    let all_stats: Vec<SessionFileStats> = session_tasks
        .par_iter()
        .filter_map(|(project_name, file_path)| {
            let messages = match provider {
                StatsProvider::Codex => providers::codex::load_messages(file_path),
                StatsProvider::OpenCode => providers::opencode::load_messages(file_path),
                StatsProvider::Claude => Ok(Vec::new()),
            }
            .unwrap_or_default();

            build_global_session_file_stats_from_messages(
                provider,
                project_name.clone(),
                &messages,
                mode,
            )
        })
        .collect();

    (all_stats, project_keys)
}

/// Intermediate stats collected from a single session file (for project stats)
#[derive(Default)]
struct ProjectSessionFileStats {
    total_messages: u32,
    token_distribution: TokenDistribution,
    tool_usage: HashMap<String, (u32, u32)>,
    daily_stats: HashMap<String, DailyStats>,
    activity_data: HashMap<(u8, u8), (u32, u64)>,
    session_duration_minutes: u32,
    session_dates: HashSet<String>,
    timestamps: Vec<DateTime<Utc>>,
}

/// Process a single session file for project stats
#[allow(unsafe_code)] // Required for mmap performance optimization
fn process_session_file_for_project_stats(
    session_path: &PathBuf,
    mode: StatsMode,
) -> Option<ProjectSessionFileStats> {
    let file = fs::File::open(session_path).ok()?;

    // SAFETY: We're only reading the file, and the file handle is kept open
    // for the duration of the mmap's lifetime. Session files are append-only.
    let mmap = unsafe { Mmap::map(&file) }.ok()?;

    let mut stats = ProjectSessionFileStats::default();
    let mut session_timestamps: Vec<DateTime<Utc>> = Vec::new();

    // Use SIMD-accelerated line detection
    let line_ranges = find_line_ranges(&mmap);

    for (start, end) in line_ranges {
        // simd-json requires mutable slice
        let mut line_bytes = mmap[start..end].to_vec();

        if let Some(log_entry) = parse_raw_log_entry_simd(&mut line_bytes) {
            if let Ok(message) = ClaudeMessage::try_from(log_entry) {
                let usage = extract_token_usage(&message);
                let has_usage = token_usage_has_token_fields(&usage);
                if !should_include_stats_entry(
                    &message.message_type,
                    message.is_sidechain,
                    has_usage,
                    mode,
                ) {
                    continue;
                }

                stats.total_messages += 1;
                let (input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, tokens) =
                    token_usage_totals(&usage);

                stats.token_distribution.input += input_tokens;
                stats.token_distribution.output += output_tokens;
                stats.token_distribution.cache_creation += cache_creation_tokens;
                stats.token_distribution.cache_read += cache_read_tokens;

                if let Ok(timestamp) = DateTime::parse_from_rfc3339(&message.timestamp) {
                    let timestamp = timestamp.with_timezone(&Utc);
                    session_timestamps.push(timestamp);

                    let hour = timestamp.hour() as u8;
                    let day = timestamp.weekday().num_days_from_sunday() as u8;

                    let activity_entry = stats.activity_data.entry((hour, day)).or_insert((0, 0));
                    activity_entry.0 += 1;
                    activity_entry.1 += tokens;

                    let date = timestamp.format("%Y-%m-%d").to_string();
                    stats.session_dates.insert(date.clone());

                    let daily_entry =
                        stats
                            .daily_stats
                            .entry(date.clone())
                            .or_insert_with(|| DailyStats {
                                date,
                                ..Default::default()
                            });
                    daily_entry.total_tokens += tokens;
                    daily_entry.input_tokens += input_tokens;
                    daily_entry.output_tokens += output_tokens;
                    daily_entry.message_count += 1;
                }

                // Track tool usage
                track_tool_usage(&message, &mut stats.tool_usage);
            }
        }
    }

    if stats.total_messages == 0 {
        return None;
    }

    // Calculate session duration
    const SESSION_BREAK_THRESHOLD_MINUTES: i64 = 120;

    if session_timestamps.len() >= 2 {
        session_timestamps.sort();
        let mut current_period_start = session_timestamps[0];
        let mut session_total_minutes = 0u32;

        for i in 0..session_timestamps.len() - 1 {
            let current = session_timestamps[i];
            let next = session_timestamps[i + 1];
            let gap_minutes = (next - current).num_minutes();

            if gap_minutes > SESSION_BREAK_THRESHOLD_MINUTES {
                let period_duration = (current - current_period_start).num_minutes();
                session_total_minutes += period_duration.max(1) as u32;
                current_period_start = next;
            }
        }

        let last = session_timestamps[session_timestamps.len() - 1];
        let final_period = (last - current_period_start).num_minutes();
        session_total_minutes += final_period.max(1) as u32;

        stats.session_duration_minutes = session_total_minutes;
    } else if session_timestamps.len() == 1 {
        stats.session_duration_minutes = 1;
    }

    stats.timestamps = session_timestamps;
    Some(stats)
}

fn track_tool_usage(message: &ClaudeMessage, tool_usage: &mut HashMap<String, (u32, u32)>) {
    // Tool usage from assistant content
    if message.message_type == "assistant" {
        if let Some(content) = &message.content {
            if let Some(content_array) = content.as_array() {
                for item in content_array {
                    if let Some(item_type) = item.get("type").and_then(|v| v.as_str()) {
                        if item_type == "tool_use" {
                            if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                                let tool_entry =
                                    tool_usage.entry(name.to_string()).or_insert((0, 0));
                                tool_entry.0 += 1;
                                // Check for success/error similar to explicit tool_use
                                let is_error = item
                                    .get("is_error")
                                    .and_then(serde_json::Value::as_bool)
                                    .unwrap_or(false);
                                if !is_error {
                                    tool_entry.1 += 1;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Tool usage from explicit tool_use field
    if let Some(tool_use) = &message.tool_use {
        if let Some(name) = tool_use.get("name").and_then(|v| v.as_str()) {
            let tool_entry = tool_usage.entry(name.to_string()).or_insert((0, 0));
            tool_entry.0 += 1;
            if let Some(result) = &message.tool_use_result {
                let is_error = result
                    .get("is_error")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false);
                if !is_error {
                    tool_entry.1 += 1;
                }
            }
        }
    }
}

fn extract_token_usage(message: &ClaudeMessage) -> TokenUsage {
    if let Some(usage) = &message.usage {
        return usage.clone();
    }

    let mut usage = TokenUsage {
        input_tokens: None,
        output_tokens: None,
        cache_creation_input_tokens: None,
        cache_read_input_tokens: None,
        service_tier: None,
    };

    if let Some(content) = &message.content {
        let usage_obj = if content.is_object() && content.get("usage").is_some() {
            content.get("usage")
        } else {
            None
        };

        if let Some(usage_obj) = usage_obj {
            apply_usage_fields_from_value(usage_obj, &mut usage);
        }
    }

    if let Some(tool_result) = &message.tool_use_result {
        if let Some(usage_obj) = tool_result.get("usage") {
            apply_usage_fields_from_value(usage_obj, &mut usage);
        }

        if let Some(total_tokens) = tool_result
            .get("totalTokens")
            .and_then(serde_json::Value::as_u64)
        {
            if usage.input_tokens.is_none() && usage.output_tokens.is_none() {
                if message.message_type == "assistant" {
                    usage.output_tokens = Some(total_tokens as u32);
                } else {
                    usage.input_tokens = Some(total_tokens as u32);
                }
            }
        }
    }

    usage
}

fn parse_date_limit(date_str: Option<String>, label: &str) -> Option<DateTime<Utc>> {
    let raw = date_str?;
    match DateTime::parse_from_rfc3339(&raw) {
        Ok(dt) => Some(dt.with_timezone(&Utc)),
        Err(e) => {
            eprintln!("Warning: invalid RFC3339 {label} '{raw}': {e}");
            None
        }
    }
}

fn parse_timestamp_utc(timestamp: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(timestamp)
        .map(|dt| dt.with_timezone(&Utc))
        .ok()
}

fn is_within_date_limits(
    timestamp: Option<DateTime<Utc>>,
    s_limit: Option<&DateTime<Utc>>,
    e_limit: Option<&DateTime<Utc>>,
) -> bool {
    if s_limit.is_none() && e_limit.is_none() {
        return true;
    }

    let Some(ts) = timestamp else {
        return false;
    };

    let after_start = s_limit.map(|s| ts >= *s).unwrap_or(true);
    let before_end = e_limit.map(|e| ts <= *e).unwrap_or(true);
    after_start && before_end
}

fn calculate_session_active_minutes(timestamps: &mut [DateTime<Utc>]) -> u32 {
    const SESSION_BREAK_THRESHOLD_MINUTES: i64 = 120;

    if timestamps.is_empty() {
        return 0;
    }

    if timestamps.len() == 1 {
        return 1;
    }

    timestamps.sort();
    let mut current_period_start = timestamps[0];
    let mut session_total_minutes = 0u32;

    for i in 0..timestamps.len() - 1 {
        let current = timestamps[i];
        let next = timestamps[i + 1];
        let gap_minutes = (next - current).num_minutes();

        if gap_minutes > SESSION_BREAK_THRESHOLD_MINUTES {
            let period_duration = (current - current_period_start).num_minutes();
            session_total_minutes += period_duration.max(1) as u32;
            current_period_start = next;
        }
    }

    let last = timestamps[timestamps.len() - 1];
    let final_period = (last - current_period_start).num_minutes();
    session_total_minutes + final_period.max(1) as u32
}

fn build_tool_usage_stats(tool_usage: HashMap<String, (u32, u32)>) -> Vec<ToolUsageStats> {
    let mut tools = tool_usage
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
        .collect::<Vec<_>>();

    tools.sort_by(|a, b| b.usage_count.cmp(&a.usage_count));
    tools
}

fn resolve_provider_project_name(provider: StatsProvider, project_path: &str) -> String {
    match provider {
        StatsProvider::Claude => PathBuf::from(project_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown")
            .to_string(),
        StatsProvider::Codex => {
            let cwd = project_path
                .strip_prefix("codex://")
                .unwrap_or(project_path);
            PathBuf::from(cwd)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(cwd)
                .to_string()
        }
        StatsProvider::OpenCode => {
            if let Ok(projects) = providers::opencode::scan_projects() {
                if let Some(project) = projects.into_iter().find(|p| p.path == project_path) {
                    return project.name;
                }
            }
            project_path
                .strip_prefix("opencode://")
                .unwrap_or(project_path)
                .to_string()
        }
    }
}

fn resolve_provider_project_name_from_session(
    provider: StatsProvider,
    session_path: &str,
) -> String {
    match provider {
        StatsProvider::OpenCode => {
            let project_part = session_path
                .strip_prefix("opencode://")
                .and_then(|rest| rest.split('/').next())
                .unwrap_or("unknown");
            let project_path = format!("opencode://{project_part}");
            resolve_provider_project_name(provider, &project_path)
        }
        StatsProvider::Codex => {
            if let Ok(projects) = providers::codex::scan_projects() {
                for project in projects {
                    if let Ok(sessions) = providers::codex::load_sessions(&project.path, false) {
                        if sessions.iter().any(|s| s.file_path == session_path) {
                            return project.name;
                        }
                    }
                }
            }
            "codex".to_string()
        }
        StatsProvider::Claude => "unknown".to_string(),
    }
}

fn load_provider_sessions_for_stats(
    provider: StatsProvider,
    project_path: &str,
) -> Result<Vec<crate::models::ClaudeSession>, String> {
    match provider {
        StatsProvider::Codex => providers::codex::load_sessions(project_path, false),
        StatsProvider::OpenCode => providers::opencode::load_sessions(project_path, false),
        StatsProvider::Claude => {
            Err("Claude sessions are handled by legacy stats path".to_string())
        }
    }
}

fn load_provider_messages_for_stats(
    provider: StatsProvider,
    session: &crate::models::ClaudeSession,
) -> Result<Vec<ClaudeMessage>, String> {
    match provider {
        StatsProvider::Codex => providers::codex::load_messages(&session.file_path),
        StatsProvider::OpenCode => providers::opencode::load_messages(&session.file_path),
        StatsProvider::Claude => {
            Err("Claude messages are handled by legacy stats path".to_string())
        }
    }
}

fn build_session_token_stats_from_messages(
    session_id: String,
    project_name: String,
    summary: Option<String>,
    messages: &[ClaudeMessage],
    mode: StatsMode,
    s_limit: Option<&DateTime<Utc>>,
    e_limit: Option<&DateTime<Utc>>,
) -> Option<SessionTokenStats> {
    if messages.is_empty() {
        return None;
    }

    let mut total_input_tokens = 0u64;
    let mut total_output_tokens = 0u64;
    let mut total_cache_creation_tokens = 0u64;
    let mut total_cache_read_tokens = 0u64;
    let mut tool_usage: HashMap<String, (u32, u32)> = HashMap::new();

    let mut first_time: Option<DateTime<Utc>> = None;
    let mut last_time: Option<DateTime<Utc>> = None;
    let mut first_time_raw: Option<String> = None;
    let mut last_time_raw: Option<String> = None;
    let mut included_message_count = 0usize;

    for message in messages {
        let parsed_timestamp = parse_timestamp_utc(&message.timestamp);
        if !is_within_date_limits(parsed_timestamp, s_limit, e_limit) {
            continue;
        }

        let usage = extract_token_usage(message);
        let has_usage = token_usage_has_token_fields(&usage);
        if !should_include_stats_entry(&message.message_type, message.is_sidechain, has_usage, mode)
        {
            continue;
        }

        included_message_count += 1;
        total_input_tokens += u64::from(usage.input_tokens.unwrap_or(0));
        total_output_tokens += u64::from(usage.output_tokens.unwrap_or(0));
        total_cache_creation_tokens += u64::from(usage.cache_creation_input_tokens.unwrap_or(0));
        total_cache_read_tokens += u64::from(usage.cache_read_input_tokens.unwrap_or(0));

        if let Some(ts) = parsed_timestamp {
            if first_time.map_or(true, |current| ts < current) {
                first_time = Some(ts);
                first_time_raw = Some(message.timestamp.clone());
            }
            if last_time.map_or(true, |current| ts > current) {
                last_time = Some(ts);
                last_time_raw = Some(message.timestamp.clone());
            }
        }

        track_tool_usage(message, &mut tool_usage);
    }

    let total_tokens = total_input_tokens
        + total_output_tokens
        + total_cache_creation_tokens
        + total_cache_read_tokens;
    if included_message_count == 0 {
        return None;
    }

    Some(SessionTokenStats {
        session_id,
        project_name,
        total_input_tokens,
        total_output_tokens,
        total_cache_creation_tokens,
        total_cache_read_tokens,
        total_tokens,
        message_count: included_message_count,
        first_message_time: first_time_raw.unwrap_or_else(|| "unknown".to_string()),
        last_message_time: last_time_raw.unwrap_or_else(|| "unknown".to_string()),
        summary,
        most_used_tools: build_tool_usage_stats(tool_usage),
    })
}

fn get_provider_project_token_stats(
    provider: StatsProvider,
    project_path: &str,
    offset: usize,
    limit: usize,
    start_date: Option<String>,
    end_date: Option<String>,
    mode: StatsMode,
) -> Result<PaginatedTokenStats, String> {
    let project_name = resolve_provider_project_name(provider, project_path);
    let mut all_stats = Vec::new();
    let sessions = load_provider_sessions_for_stats(provider, project_path)?;

    for session in &sessions {
        let messages = load_provider_messages_for_stats(provider, session)?;
        if let Some(stats) = build_session_token_stats_from_messages(
            session.actual_session_id.clone(),
            if session.project_name.is_empty() {
                project_name.clone()
            } else {
                session.project_name.clone()
            },
            session.summary.clone(),
            &messages,
            mode,
            None,
            None,
        ) {
            all_stats.push(stats);
        }
    }

    let s_limit = parse_date_limit(start_date, "start_date");
    let e_limit = parse_date_limit(end_date, "end_date");

    if s_limit.is_some() || e_limit.is_some() {
        all_stats.retain(|stat| {
            if let Some(last_ts) = parse_timestamp_utc(&stat.last_message_time) {
                let after_start = s_limit.map(|s| last_ts >= s).unwrap_or(true);
                let before_end = e_limit.map(|e| last_ts <= e).unwrap_or(true);
                after_start && before_end
            } else {
                false
            }
        });
    }

    let total_count = all_stats.len();
    all_stats.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));
    let items = all_stats
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    let has_more = offset + items.len() < total_count;

    Ok(PaginatedTokenStats {
        items,
        total_count,
        offset,
        limit,
        has_more,
    })
}

fn get_provider_project_stats_summary(
    provider: StatsProvider,
    project_path: &str,
    start_date: Option<String>,
    end_date: Option<String>,
    mode: StatsMode,
) -> Result<ProjectStatsSummary, String> {
    let project_name = resolve_provider_project_name(provider, project_path);
    let sessions = load_provider_sessions_for_stats(provider, project_path)?;
    let s_limit = parse_date_limit(start_date, "start_date");
    let e_limit = parse_date_limit(end_date, "end_date");

    let mut summary = ProjectStatsSummary::default();
    summary.project_name = project_name;

    let mut session_durations: Vec<u32> = Vec::new();
    let mut tool_usage_map: HashMap<String, (u32, u32)> = HashMap::new();
    let mut daily_stats_map: HashMap<String, DailyStats> = HashMap::new();
    let mut activity_map: HashMap<(u8, u8), (u32, u64)> = HashMap::new();

    for session in &sessions {
        let messages = load_provider_messages_for_stats(provider, session)?;
        if messages.is_empty() {
            continue;
        }

        let mut parsed_timestamps = Vec::new();
        for message in &messages {
            if let Some(ts) = parse_timestamp_utc(&message.timestamp) {
                parsed_timestamps.push(ts);
            }
        }

        if parsed_timestamps.is_empty() {
            continue;
        }

        parsed_timestamps.sort();
        let Some(last_ts) = parsed_timestamps.last().copied() else {
            continue;
        };
        let is_after_start = s_limit.map(|s| last_ts >= s).unwrap_or(true);
        let is_before_end = e_limit.map(|e| last_ts <= e).unwrap_or(true);
        if !is_after_start || !is_before_end {
            continue;
        }

        let mut included_messages = 0usize;
        for message in &messages {
            let usage = extract_token_usage(message);
            let has_usage = token_usage_has_token_fields(&usage);
            if should_include_stats_entry(
                &message.message_type,
                message.is_sidechain,
                has_usage,
                mode,
            ) {
                included_messages += 1;
            }
        }
        if included_messages == 0 {
            continue;
        }

        summary.total_sessions += 1;
        summary.total_messages += included_messages;

        let mut session_dates = HashSet::new();
        for message in &messages {
            let usage = extract_token_usage(message);
            let has_usage = token_usage_has_token_fields(&usage);
            if !should_include_stats_entry(
                &message.message_type,
                message.is_sidechain,
                has_usage,
                mode,
            ) {
                continue;
            }

            let input_tokens = u64::from(usage.input_tokens.unwrap_or(0));
            let output_tokens = u64::from(usage.output_tokens.unwrap_or(0));
            let cache_creation_tokens = u64::from(usage.cache_creation_input_tokens.unwrap_or(0));
            let cache_read_tokens = u64::from(usage.cache_read_input_tokens.unwrap_or(0));
            let total_tokens =
                input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens;

            summary.token_distribution.input += input_tokens;
            summary.token_distribution.output += output_tokens;
            summary.token_distribution.cache_creation += cache_creation_tokens;
            summary.token_distribution.cache_read += cache_read_tokens;

            if let Some(timestamp) = parse_timestamp_utc(&message.timestamp) {
                let hour = timestamp.hour() as u8;
                let day = timestamp.weekday().num_days_from_sunday() as u8;
                let date = timestamp.format("%Y-%m-%d").to_string();
                session_dates.insert(date.clone());

                let activity_entry = activity_map.entry((hour, day)).or_insert((0, 0));
                activity_entry.0 += 1;
                activity_entry.1 += total_tokens;

                let daily_entry =
                    daily_stats_map
                        .entry(date.clone())
                        .or_insert_with(|| DailyStats {
                            date,
                            ..Default::default()
                        });
                daily_entry.total_tokens += total_tokens;
                daily_entry.input_tokens += input_tokens;
                daily_entry.output_tokens += output_tokens;
                daily_entry.message_count += 1;
            }

            track_tool_usage(message, &mut tool_usage_map);
        }

        for date in session_dates {
            let entry = daily_stats_map
                .entry(date.clone())
                .or_insert_with(|| DailyStats {
                    date,
                    ..Default::default()
                });
            entry.session_count += 1;
        }

        let duration = calculate_session_active_minutes(&mut parsed_timestamps);
        if duration > 0 {
            session_durations.push(duration);
        }
    }

    for daily_stat in daily_stats_map.values_mut() {
        daily_stat.active_hours = if daily_stat.message_count > 0 {
            std::cmp::min(24, std::cmp::max(1, daily_stat.message_count / 10))
        } else {
            0
        };
    }

    summary.most_used_tools = build_tool_usage_stats(tool_usage_map);
    summary.daily_stats = daily_stats_map.into_values().collect();
    summary.daily_stats.sort_by(|a, b| a.date.cmp(&b.date));
    summary.activity_heatmap = activity_map
        .into_iter()
        .map(|((hour, day), (count, tokens))| ActivityHeatmap {
            hour,
            day,
            activity_count: count,
            tokens_used: tokens,
        })
        .collect();

    summary.total_tokens = summary.token_distribution.input
        + summary.token_distribution.output
        + summary.token_distribution.cache_creation
        + summary.token_distribution.cache_read;
    summary.avg_tokens_per_session = if summary.total_sessions > 0 {
        summary.total_tokens / summary.total_sessions as u64
    } else {
        0
    };
    summary.total_session_duration = session_durations.iter().sum::<u32>();
    summary.avg_session_duration = if session_durations.is_empty() {
        0
    } else {
        summary.total_session_duration / session_durations.len() as u32
    };
    summary.most_active_hour = summary
        .activity_heatmap
        .iter()
        .max_by_key(|a| a.activity_count)
        .map_or(0, |a| a.hour);

    Ok(summary)
}

fn get_provider_session_comparison(
    provider: StatsProvider,
    session_id: &str,
    project_path: &str,
    mode: StatsMode,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<SessionComparison, String> {
    let sessions = load_provider_sessions_for_stats(provider, project_path)?;
    let mut all_sessions: Vec<SessionComparisonStats> = Vec::new();
    let s_limit = parse_date_limit(start_date, "start_date");
    let e_limit = parse_date_limit(end_date, "end_date");

    for session in &sessions {
        let messages = load_provider_messages_for_stats(provider, session)?;
        if messages.is_empty() {
            continue;
        }

        let mut total_tokens: u64 = 0;
        let mut included_message_count = 0usize;
        let mut first_time: Option<DateTime<Utc>> = None;
        let mut last_time: Option<DateTime<Utc>> = None;

        for message in &messages {
            let usage = extract_token_usage(message);
            let has_usage = token_usage_has_token_fields(&usage);
            if !should_include_stats_entry(
                &message.message_type,
                message.is_sidechain,
                has_usage,
                mode,
            ) {
                continue;
            }

            included_message_count += 1;
            total_tokens += u64::from(usage.input_tokens.unwrap_or(0))
                + u64::from(usage.output_tokens.unwrap_or(0))
                + u64::from(usage.cache_creation_input_tokens.unwrap_or(0))
                + u64::from(usage.cache_read_input_tokens.unwrap_or(0));

            if let Some(ts) = parse_timestamp_utc(&message.timestamp) {
                if first_time.map_or(true, |current| ts < current) {
                    first_time = Some(ts);
                }
                if last_time.map_or(true, |current| ts > current) {
                    last_time = Some(ts);
                }
            }
        }
        if included_message_count == 0 {
            continue;
        }

        let duration_seconds = match (first_time.as_ref(), last_time.as_ref()) {
            (Some(first), Some(last)) => (*last - *first).num_seconds(),
            _ => 0,
        };

        all_sessions.push(SessionComparisonStats {
            session_id: session.actual_session_id.clone(),
            total_tokens,
            message_count: included_message_count,
            duration_seconds,
            last_timestamp: last_time,
        });
    }

    if s_limit.is_some() || e_limit.is_some() {
        all_sessions.retain(|stats| {
            is_within_date_limits(stats.last_timestamp, s_limit.as_ref(), e_limit.as_ref())
        });
    }

    let target_session = all_sessions
        .iter()
        .find(|s| s.session_id == session_id)
        .ok_or("Session not found in project")?;

    let total_project_tokens: u64 = all_sessions.iter().map(|s| s.total_tokens).sum();
    let total_project_messages: usize = all_sessions.iter().map(|s| s.message_count).sum();

    let percentage_of_project_tokens = if total_project_tokens > 0 {
        (target_session.total_tokens as f32 / total_project_tokens as f32) * 100.0
    } else {
        0.0
    };

    let percentage_of_project_messages = if total_project_messages > 0 {
        (target_session.message_count as f32 / total_project_messages as f32) * 100.0
    } else {
        0.0
    };

    let mut sessions_by_tokens = all_sessions.clone();
    sessions_by_tokens.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));
    let rank_by_tokens = sessions_by_tokens
        .iter()
        .position(|s| s.session_id == session_id)
        .unwrap_or(0)
        + 1;

    let mut sessions_by_duration = all_sessions.clone();
    sessions_by_duration.sort_by(|a, b| b.duration_seconds.cmp(&a.duration_seconds));
    let rank_by_duration = sessions_by_duration
        .iter()
        .position(|s| s.session_id == session_id)
        .unwrap_or(0)
        + 1;

    let avg_tokens = if all_sessions.is_empty() {
        0
    } else {
        total_project_tokens / all_sessions.len() as u64
    };
    let is_above_average = target_session.total_tokens > avg_tokens;

    Ok(SessionComparison {
        session_id: session_id.to_string(),
        percentage_of_project_tokens,
        percentage_of_project_messages,
        rank_by_tokens,
        rank_by_duration,
        is_above_average,
    })
}

#[tauri::command]
pub async fn get_session_token_stats(
    session_path: String,
    start_date: Option<String>,
    end_date: Option<String>,
    stats_mode: Option<String>,
) -> Result<SessionTokenStats, String> {
    let start = std::time::Instant::now();
    let mode = parse_stats_mode(stats_mode);
    let provider = detect_session_provider(&session_path);
    let s_limit = parse_date_limit(start_date, "start_date");
    let e_limit = parse_date_limit(end_date, "end_date");

    if provider != StatsProvider::Claude {
        let messages = match provider {
            StatsProvider::Codex => providers::codex::load_messages(&session_path)?,
            StatsProvider::OpenCode => providers::opencode::load_messages(&session_path)?,
            StatsProvider::Claude => Vec::new(),
        };

        let session_id = messages
            .first()
            .map(|msg| msg.session_id.clone())
            .unwrap_or_else(|| session_path.clone());
        let project_name = resolve_provider_project_name_from_session(provider, &session_path);

        return build_session_token_stats_from_messages(
            session_id,
            project_name,
            None,
            &messages,
            mode,
            None,
            None,
        )
        .and_then(|stats| {
            if is_within_date_limits(
                parse_timestamp_utc(&stats.last_message_time),
                s_limit.as_ref(),
                e_limit.as_ref(),
            ) {
                Some(stats)
            } else {
                None
            }
        })
        .ok_or_else(|| "No valid messages found in session".to_string());
    }

    let session_path_buf = PathBuf::from(&session_path);
    let stats = extract_session_token_stats_sync(&session_path_buf, mode, None, None)
        .ok_or_else(|| "No valid messages found in session".to_string())?;
    if !is_within_date_limits(
        parse_timestamp_utc(&stats.last_message_time),
        s_limit.as_ref(),
        e_limit.as_ref(),
    ) {
        return Err("No valid messages found in session".to_string());
    }
    let total_time = start.elapsed();

    eprintln!(
        "📊 get_session_token_stats: {} messages, total={}ms",
        stats.message_count,
        total_time.as_millis()
    );

    Ok(stats)
}

/// Paginated response for project token stats
#[derive(Debug, Clone, serde::Serialize)]
pub struct PaginatedTokenStats {
    pub items: Vec<SessionTokenStats>,
    pub total_count: usize,
    pub offset: usize,
    pub limit: usize,
    pub has_more: bool,
}

/// Synchronous version of session token stats extraction for parallel processing
#[allow(unsafe_code)] // Required for mmap performance optimization
fn extract_session_token_stats_sync(
    session_path: &PathBuf,
    mode: StatsMode,
    s_limit: Option<&DateTime<Utc>>,
    e_limit: Option<&DateTime<Utc>>,
) -> Option<SessionTokenStats> {
    let file = fs::File::open(session_path).ok()?;

    // SAFETY: We're only reading the file, and the file handle is kept open
    // for the duration of the mmap's lifetime. Session files are append-only.
    let mmap = unsafe { Mmap::map(&file) }.ok()?;

    let project_name = session_path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let mut session_id: Option<String> = None;
    let mut total_input_tokens = 0u64;
    let mut total_output_tokens = 0u64;
    let mut total_cache_creation_tokens = 0u64;
    let mut total_cache_read_tokens = 0u64;
    let mut message_count = 0usize;
    let mut first_time: Option<String> = None;
    let mut last_time: Option<String> = None;
    let mut summary: Option<String> = None;
    let mut tool_usage: HashMap<String, (u32, u32)> = HashMap::new();
    let mut included_message_count = 0usize;

    // Use SIMD-accelerated line detection
    let line_ranges = find_line_ranges(&mmap);

    for (start, end) in line_ranges {
        // simd-json requires mutable slice
        let mut line_bytes = mmap[start..end].to_vec();

        if let Some(log_entry) = parse_raw_log_entry_simd(&mut line_bytes) {
            // Check for summary message type before converting
            if log_entry.message_type == "summary" {
                if let Some(s) = &log_entry.summary {
                    summary = Some(s.clone());
                }
            }

            if let Ok(message) = ClaudeMessage::try_from(log_entry) {
                let parsed_timestamp = parse_timestamp_utc(&message.timestamp);
                if !is_within_date_limits(parsed_timestamp, s_limit, e_limit) {
                    continue;
                }

                let usage = extract_token_usage(&message);
                let has_usage = token_usage_has_token_fields(&usage);
                if !should_include_stats_entry(
                    &message.message_type,
                    message.is_sidechain,
                    has_usage,
                    mode,
                ) {
                    continue;
                }

                if session_id.is_none() {
                    session_id = Some(message.session_id.clone());
                }

                message_count += 1;
                included_message_count += 1;

                total_input_tokens += u64::from(usage.input_tokens.unwrap_or(0));
                total_output_tokens += u64::from(usage.output_tokens.unwrap_or(0));
                total_cache_creation_tokens +=
                    u64::from(usage.cache_creation_input_tokens.unwrap_or(0));
                total_cache_read_tokens += u64::from(usage.cache_read_input_tokens.unwrap_or(0));

                if let Some(ts) = parsed_timestamp {
                    let should_set_first = first_time
                        .as_ref()
                        .and_then(|raw| parse_timestamp_utc(raw))
                        .map_or(true, |current| ts < current);
                    if should_set_first {
                        first_time = Some(message.timestamp.clone());
                    }

                    let should_set_last = last_time
                        .as_ref()
                        .and_then(|raw| parse_timestamp_utc(raw))
                        .map_or(true, |current| ts > current);
                    if should_set_last {
                        last_time = Some(message.timestamp.clone());
                    }
                }

                // Track tool usage
                track_tool_usage(&message, &mut tool_usage);
            }
        }
    }

    let session_id = session_id?;
    if message_count == 0 || included_message_count == 0 {
        return None;
    }

    let total_tokens = total_input_tokens
        + total_output_tokens
        + total_cache_creation_tokens
        + total_cache_read_tokens;

    Some(SessionTokenStats {
        session_id,
        project_name,
        total_input_tokens,
        total_output_tokens,
        total_cache_creation_tokens,
        total_cache_read_tokens,
        total_tokens,
        message_count: included_message_count,
        first_message_time: first_time.unwrap_or_else(|| "unknown".to_string()),
        last_message_time: last_time.unwrap_or_else(|| "unknown".to_string()),
        summary,
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
    })
}

#[tauri::command]
pub async fn get_project_token_stats(
    project_path: String,
    offset: Option<usize>,
    limit: Option<usize>,
    start_date: Option<String>,
    end_date: Option<String>,
    stats_mode: Option<String>,
) -> Result<PaginatedTokenStats, String> {
    let mode = parse_stats_mode(stats_mode);
    let provider = detect_project_provider(&project_path);
    if provider != StatsProvider::Claude {
        return get_provider_project_token_stats(
            provider,
            &project_path,
            offset.unwrap_or(0),
            limit.unwrap_or(20),
            start_date,
            end_date,
            mode,
        );
    }

    if project_path.trim().is_empty() {
        return Err("project_path is required".to_string());
    }
    let project_path_buf = PathBuf::from(&project_path);
    if !project_path_buf.is_absolute() {
        return Err("project_path must be absolute".to_string());
    }

    #[cfg(debug_assertions)]
    let start = std::time::Instant::now();
    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(20);

    // Collect all session files
    let session_files: Vec<PathBuf> = WalkDir::new(&project_path)
        .into_iter()
        .filter_map(std::result::Result::ok)
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
        .map(|e| e.path().to_path_buf())
        .collect();

    #[cfg(debug_assertions)]
    let scan_time = start.elapsed();

    // Process all sessions in parallel using sync function
    let mut all_stats: Vec<SessionTokenStats> = session_files
        .par_iter()
        .filter_map(|path| extract_session_token_stats_sync(path, mode, None, None))
        .collect();

    #[cfg(debug_assertions)]
    let process_time = start.elapsed();

    // Filter by date if provided
    let mut s_limit = None;
    let mut e_limit = None;

    if let Some(s_str) = start_date {
        match DateTime::parse_from_rfc3339(&s_str) {
            Ok(dt) => s_limit = Some(dt.with_timezone(&Utc)),
            Err(e) => eprintln!("Warning: invalid RFC3339 start_date '{s_str}': {e}"),
        }
    }

    if let Some(e_str) = end_date {
        match DateTime::parse_from_rfc3339(&e_str) {
            Ok(dt) => e_limit = Some(dt.with_timezone(&Utc)),
            Err(e) => eprintln!("Warning: invalid RFC3339 end_date '{e_str}': {e}"),
        }
    }

    if s_limit.is_some() || e_limit.is_some() {
        all_stats.retain(|stat| {
            if let Ok(ts_dt) = DateTime::parse_from_rfc3339(&stat.last_message_time) {
                let ts_utc = ts_dt.with_timezone(&Utc);
                let after_start = s_limit.map(|s| ts_utc >= s).unwrap_or(true);
                let before_end = e_limit.map(|e| ts_utc <= e).unwrap_or(true);
                after_start && before_end
            } else {
                false
            }
        });
    }

    let total_count = all_stats.len();

    // Sort by total tokens (descending)
    all_stats.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));

    // Apply pagination
    let paginated_items: Vec<SessionTokenStats> =
        all_stats.into_iter().skip(offset).take(limit).collect();

    let has_more = offset + paginated_items.len() < total_count;
    #[cfg(debug_assertions)]
    let total_time = start.elapsed();

    #[cfg(debug_assertions)]
    eprintln!(
        "📊 get_project_token_stats: {} sessions ({} after filter), scan={}ms, process={}ms, total={}ms",
        total_count,
        paginated_items.len(),
        scan_time.as_millis(),
        process_time.as_millis(),
        total_time.as_millis()
    );

    Ok(PaginatedTokenStats {
        items: paginated_items,
        total_count,
        offset,
        limit,
        has_more,
    })
}

#[tauri::command]
pub async fn get_project_stats_summary(
    project_path: String,
    start_date: Option<String>,
    end_date: Option<String>,
    stats_mode: Option<String>,
) -> Result<ProjectStatsSummary, String> {
    let mode = parse_stats_mode(stats_mode);
    let provider = detect_project_provider(&project_path);
    if provider != StatsProvider::Claude {
        return get_provider_project_stats_summary(
            provider,
            &project_path,
            start_date,
            end_date,
            mode,
        );
    }

    if project_path.trim().is_empty() {
        return Err("project_path is required".to_string());
    }
    let project_path_buf = PathBuf::from(&project_path);
    if !project_path_buf.is_absolute() {
        return Err("project_path must be absolute".to_string());
    }

    let start = std::time::Instant::now();
    let project_name = PathBuf::from(&project_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let mut s_limit = None;
    let mut e_limit = None;

    if let Some(s_str) = start_date {
        match DateTime::parse_from_rfc3339(&s_str) {
            Ok(dt) => s_limit = Some(dt.with_timezone(&Utc)),
            Err(e) => eprintln!("Warning: invalid RFC3339 start_date '{s_str}': {e}"),
        }
    }

    if let Some(e_str) = end_date {
        match DateTime::parse_from_rfc3339(&e_str) {
            Ok(dt) => e_limit = Some(dt.with_timezone(&Utc)),
            Err(e) => eprintln!("Warning: invalid RFC3339 end_date '{e_str}': {e}"),
        }
    }

    // Phase 1: Collect all session files
    let session_files: Vec<PathBuf> = WalkDir::new(&project_path)
        .into_iter()
        .filter_map(std::result::Result::ok)
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
        .map(|e| e.path().to_path_buf())
        .collect();
    let scan_time = start.elapsed();

    // Phase 2: Process all session files in parallel
    let mut file_stats: Vec<ProjectSessionFileStats> = session_files
        .par_iter()
        .filter_map(|path| process_session_file_for_project_stats(path, mode))
        .collect();

    // Filter by date
    if s_limit.is_some() || e_limit.is_some() {
        file_stats.retain(|stats| {
            if stats.timestamps.is_empty() {
                return false;
            }
            let last_ts = *stats.timestamps.last().unwrap();

            let is_after_start = s_limit.map(|s| last_ts >= s).unwrap_or(true);
            let is_before_end = e_limit.map(|e| last_ts <= e).unwrap_or(true);

            is_after_start && is_before_end
        });
    }
    let process_time = start.elapsed();

    // Phase 3: Aggregate results
    let mut summary = ProjectStatsSummary::default();
    summary.project_name = project_name;
    summary.total_sessions = file_stats.len();

    let mut session_durations: Vec<u32> = Vec::new();
    let mut tool_usage_map: HashMap<String, (u32, u32)> = HashMap::new();
    let mut daily_stats_map: HashMap<String, DailyStats> = HashMap::new();
    let mut activity_map: HashMap<(u8, u8), (u32, u64)> = HashMap::new();
    let mut session_dates: HashSet<String> = HashSet::new();

    for stats in file_stats {
        summary.total_messages += stats.total_messages as usize;

        // Aggregate token distribution
        summary.token_distribution.input += stats.token_distribution.input;
        summary.token_distribution.output += stats.token_distribution.output;
        summary.token_distribution.cache_creation += stats.token_distribution.cache_creation;
        summary.token_distribution.cache_read += stats.token_distribution.cache_read;

        // Aggregate tool usage
        for (name, (usage, success)) in stats.tool_usage {
            let entry = tool_usage_map.entry(name).or_insert((0, 0));
            entry.0 += usage;
            entry.1 += success;
        }

        // Aggregate daily stats
        for (date, daily) in stats.daily_stats {
            let entry = daily_stats_map
                .entry(date.clone())
                .or_insert_with(|| DailyStats {
                    date,
                    ..Default::default()
                });
            entry.total_tokens += daily.total_tokens;
            entry.input_tokens += daily.input_tokens;
            entry.output_tokens += daily.output_tokens;
            entry.message_count += daily.message_count;
        }

        // Aggregate activity data
        for ((hour, day), (count, tokens)) in stats.activity_data {
            let entry = activity_map.entry((hour, day)).or_insert((0, 0));
            entry.0 += count;
            entry.1 += tokens;
        }

        // Aggregate session dates
        session_dates.extend(stats.session_dates);

        // Collect session duration
        if stats.session_duration_minutes > 0 {
            session_durations.push(stats.session_duration_minutes);
        }

        // Add first date from timestamps if session has messages
        if !stats.timestamps.is_empty() {
            let date = stats.timestamps[0].format("%Y-%m-%d").to_string();
            session_dates.insert(date);
        }
    }

    // Phase 4: Finalize daily stats
    for (date, daily_stat) in &mut daily_stats_map {
        daily_stat.session_count = session_dates.iter().filter(|&d| d == date).count();
        daily_stat.active_hours = if daily_stat.message_count > 0 {
            std::cmp::min(24, std::cmp::max(1, daily_stat.message_count / 10))
        } else {
            0
        };
    }

    summary.most_used_tools = tool_usage_map
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
        .collect();
    summary
        .most_used_tools
        .sort_by(|a, b| b.usage_count.cmp(&a.usage_count));

    summary.daily_stats = daily_stats_map.into_values().collect();
    summary.daily_stats.sort_by(|a, b| a.date.cmp(&b.date));

    summary.activity_heatmap = activity_map
        .into_iter()
        .map(|((hour, day), (count, tokens))| ActivityHeatmap {
            hour,
            day,
            activity_count: count,
            tokens_used: tokens,
        })
        .collect();

    summary.total_tokens = summary.token_distribution.input
        + summary.token_distribution.output
        + summary.token_distribution.cache_creation
        + summary.token_distribution.cache_read;
    summary.avg_tokens_per_session = if summary.total_sessions > 0 {
        summary.total_tokens / summary.total_sessions as u64
    } else {
        0
    };
    summary.total_session_duration = session_durations.iter().sum::<u32>();
    summary.avg_session_duration = if session_durations.is_empty() {
        0
    } else {
        summary.total_session_duration / session_durations.len() as u32
    };

    summary.most_active_hour = summary
        .activity_heatmap
        .iter()
        .max_by_key(|a| a.activity_count)
        .map_or(0, |a| a.hour);

    let total_time = start.elapsed();
    eprintln!(
        "📊 get_project_stats_summary: {} sessions, scan={}ms, process={}ms, total={}ms",
        summary.total_sessions,
        scan_time.as_millis(),
        process_time.as_millis(),
        total_time.as_millis()
    );

    Ok(summary)
}

/// Lightweight session stats for comparison (parallel processing)
#[derive(Clone)]
struct SessionComparisonStats {
    session_id: String,
    total_tokens: u64,
    message_count: usize,
    duration_seconds: i64,
    last_timestamp: Option<DateTime<Utc>>,
}

/// Process a single session file for comparison stats (lightweight)
#[allow(unsafe_code)] // Required for mmap performance optimization
fn process_session_file_for_comparison(
    session_path: &PathBuf,
    mode: StatsMode,
) -> Option<SessionComparisonStats> {
    let file = fs::File::open(session_path).ok()?;

    // SAFETY: We're only reading the file, and the file handle is kept open
    // for the duration of the mmap's lifetime. Session files are append-only.
    let mmap = unsafe { Mmap::map(&file) }.ok()?;

    let mut session_id: Option<String> = None;
    let mut total_tokens: u64 = 0;
    let mut message_count: usize = 0;
    let mut first_time: Option<DateTime<Utc>> = None;
    let mut last_time: Option<DateTime<Utc>> = None;

    // Use SIMD-accelerated line detection
    let line_ranges = find_line_ranges(&mmap);

    for (start, end) in line_ranges {
        // simd-json requires mutable slice
        let mut line_bytes = mmap[start..end].to_vec();

        if let Some(log_entry) = parse_raw_log_entry_simd(&mut line_bytes) {
            if let Ok(message) = ClaudeMessage::try_from(log_entry) {
                let usage = extract_token_usage(&message);
                let has_usage = token_usage_has_token_fields(&usage);
                if !should_include_stats_entry(
                    &message.message_type,
                    message.is_sidechain,
                    has_usage,
                    mode,
                ) {
                    continue;
                }

                if session_id.is_none() {
                    session_id = Some(message.session_id.clone());
                }

                message_count += 1;

                total_tokens += u64::from(usage.input_tokens.unwrap_or(0))
                    + u64::from(usage.output_tokens.unwrap_or(0))
                    + u64::from(usage.cache_creation_input_tokens.unwrap_or(0))
                    + u64::from(usage.cache_read_input_tokens.unwrap_or(0));

                if let Ok(timestamp) = DateTime::parse_from_rfc3339(&message.timestamp) {
                    let timestamp = timestamp.with_timezone(&Utc);
                    if first_time
                        .as_ref()
                        .map_or(true, |current| timestamp < *current)
                    {
                        first_time = Some(timestamp);
                    }
                    if last_time
                        .as_ref()
                        .map_or(true, |current| timestamp > *current)
                    {
                        last_time = Some(timestamp);
                    }
                }
            }
        }
    }

    let duration_seconds = match (first_time.as_ref(), last_time.as_ref()) {
        (Some(first), Some(last)) => (*last - *first).num_seconds(),
        _ => 0,
    };

    Some(SessionComparisonStats {
        session_id: session_id?,
        total_tokens,
        message_count,
        duration_seconds,
        last_timestamp: last_time,
    })
}

#[tauri::command]
pub async fn get_session_comparison(
    session_id: String,
    project_path: String,
    start_date: Option<String>,
    end_date: Option<String>,
    stats_mode: Option<String>,
) -> Result<SessionComparison, String> {
    let mode = parse_stats_mode(stats_mode);
    let provider = detect_project_provider(&project_path);
    if provider != StatsProvider::Claude {
        return get_provider_session_comparison(
            provider,
            &session_id,
            &project_path,
            mode,
            start_date,
            end_date,
        );
    }

    let start = std::time::Instant::now();

    // Phase 1: Collect all session files
    let session_files: Vec<PathBuf> = WalkDir::new(&project_path)
        .into_iter()
        .filter_map(std::result::Result::ok)
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
        .map(|e| e.path().to_path_buf())
        .collect();
    let scan_time = start.elapsed();

    // Phase 2: Process all session files in parallel (lightweight processing)
    let all_sessions: Vec<SessionComparisonStats> = session_files
        .par_iter()
        .filter_map(|path| process_session_file_for_comparison(path, mode))
        .collect();
    let mut all_sessions = all_sessions;
    let s_limit = parse_date_limit(start_date, "start_date");
    let e_limit = parse_date_limit(end_date, "end_date");
    if s_limit.is_some() || e_limit.is_some() {
        all_sessions.retain(|stats| {
            is_within_date_limits(stats.last_timestamp, s_limit.as_ref(), e_limit.as_ref())
        });
    }
    let process_time = start.elapsed();

    let target_session = all_sessions
        .iter()
        .find(|s| s.session_id == session_id)
        .ok_or("Session not found in project")?;

    let total_project_tokens: u64 = all_sessions.iter().map(|s| s.total_tokens).sum();
    let total_project_messages: usize = all_sessions.iter().map(|s| s.message_count).sum();

    let percentage_of_project_tokens = if total_project_tokens > 0 {
        (target_session.total_tokens as f32 / total_project_tokens as f32) * 100.0
    } else {
        0.0
    };

    let percentage_of_project_messages = if total_project_messages > 0 {
        (target_session.message_count as f32 / total_project_messages as f32) * 100.0
    } else {
        0.0
    };

    // Sort by tokens to find rank
    let mut sessions_by_tokens = all_sessions.clone();
    sessions_by_tokens.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));

    let rank_by_tokens = sessions_by_tokens
        .iter()
        .position(|s| s.session_id == session_id)
        .unwrap_or(0)
        + 1;

    // Sort by duration to find rank
    let mut sessions_by_duration = all_sessions.clone();
    sessions_by_duration.sort_by(|a, b| b.duration_seconds.cmp(&a.duration_seconds));

    let rank_by_duration = sessions_by_duration
        .iter()
        .position(|s| s.session_id == session_id)
        .unwrap_or(0)
        + 1;

    let avg_tokens = if all_sessions.is_empty() {
        0
    } else {
        total_project_tokens / all_sessions.len() as u64
    };
    let is_above_average = target_session.total_tokens > avg_tokens;
    let total_time = start.elapsed();

    eprintln!(
        "📊 get_session_comparison: {} sessions, scan={}ms, process={}ms, total={}ms",
        all_sessions.len(),
        scan_time.as_millis(),
        process_time.as_millis(),
        total_time.as_millis()
    );

    Ok(SessionComparison {
        session_id,
        percentage_of_project_tokens,
        percentage_of_project_messages,
        rank_by_tokens,
        rank_by_duration,
        is_above_average,
    })
}

impl TryFrom<RawLogEntry> for ClaudeMessage {
    type Error = String;

    fn try_from(log_entry: RawLogEntry) -> Result<Self, Self::Error> {
        if log_entry.message_type == "summary" {
            return Err("Summary entries should be handled separately".to_string());
        }
        if log_entry.session_id.is_none() && log_entry.timestamp.is_none() {
            return Err("Missing session_id and timestamp".to_string());
        }

        let (role, message_id, model, stop_reason, usage) = if let Some(ref msg) = log_entry.message
        {
            (
                Some(msg.role.clone()),
                msg.id.clone(),
                msg.model.clone(),
                msg.stop_reason.clone(),
                msg.usage.clone(),
            )
        } else {
            (None, None, None, None, None)
        };

        Ok(ClaudeMessage {
            uuid: log_entry
                .uuid
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            parent_uuid: log_entry.parent_uuid,
            session_id: log_entry
                .session_id
                .unwrap_or_else(|| "unknown-session".to_string()),
            timestamp: log_entry
                .timestamp
                .unwrap_or_else(|| Utc::now().to_rfc3339()),
            message_type: log_entry.message_type.clone(),
            content: log_entry.message.map(|m| m.content).or(log_entry.content),
            project_name: None,
            tool_use: log_entry.tool_use,
            tool_use_result: log_entry.tool_use_result,
            is_sidechain: log_entry.is_sidechain,
            usage,
            role,
            model,
            stop_reason,
            cost_usd: log_entry.cost_usd,
            duration_ms: log_entry.duration_ms,
            // File history snapshot fields
            message_id: message_id.or(log_entry.message_id),
            snapshot: log_entry.snapshot,
            is_snapshot_update: log_entry.is_snapshot_update,
            // Progress message fields
            data: log_entry.data,
            tool_use_id: log_entry.tool_use_id,
            parent_tool_use_id: log_entry.parent_tool_use_id,
            // Queue operation fields
            operation: log_entry.operation,
            // System message fields
            subtype: log_entry.subtype,
            level: log_entry.level,
            hook_count: log_entry.hook_count,
            hook_infos: log_entry.hook_infos,
            stop_reason_system: log_entry.stop_reason_system,
            prevented_continuation: log_entry.prevented_continuation,
            compact_metadata: log_entry.compact_metadata,
            microcompact_metadata: log_entry.microcompact_metadata,
            provider: None,
        })
    }
}

#[tauri::command]
pub async fn get_global_stats_summary(
    claude_path: String,
    active_providers: Option<Vec<String>>,
    stats_mode: Option<String>,
) -> Result<GlobalStatsSummary, String> {
    let mode = parse_stats_mode(stats_mode);
    let providers_to_include = parse_active_stats_providers(active_providers);
    let projects_path = PathBuf::from(&claude_path).join("projects");

    // Phase 1: Collect all session files and their project names
    let mut session_files: Vec<PathBuf> = Vec::new();
    let mut project_names: HashSet<String> = HashSet::new();
    if providers_to_include.contains(&StatsProvider::Claude) && projects_path.exists() {
        match fs::read_dir(&projects_path) {
            Ok(entries) => {
                for project_entry in entries {
                    let project_entry = match project_entry {
                        Ok(entry) => entry,
                        Err(e) => {
                            log::warn!("Skipping unreadable Claude project entry: {e}");
                            continue;
                        }
                    };
                    let project_path = project_entry.path();

                    if !project_path.is_dir() {
                        continue;
                    }

                    let project_name = project_path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("Unknown")
                        .to_string();
                    project_names.insert(format!("claude:{project_name}"));

                    for entry in WalkDir::new(&project_path)
                        .into_iter()
                        .filter_map(std::result::Result::ok)
                        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
                    {
                        session_files.push(entry.path().to_path_buf());
                    }
                }
            }
            Err(e) => {
                log::warn!("Failed to read Claude projects directory: {e}");
            }
        }
    }

    // Phase 2: Process all session files in parallel
    let mut file_stats: Vec<SessionFileStats> = session_files
        .par_iter()
        .filter_map(|path| process_session_file_for_global_stats(path, mode))
        .collect();

    if providers_to_include.contains(&StatsProvider::Codex) {
        let (codex_stats, codex_projects) =
            collect_provider_global_file_stats(StatsProvider::Codex, mode);
        project_names.extend(codex_projects);
        file_stats.extend(codex_stats);
    }

    if providers_to_include.contains(&StatsProvider::OpenCode) {
        let (opencode_stats, opencode_projects) =
            collect_provider_global_file_stats(StatsProvider::OpenCode, mode);
        project_names.extend(opencode_projects);
        file_stats.extend(opencode_stats);
    }

    // Phase 3: Aggregate results
    let mut summary = GlobalStatsSummary::default();
    summary.total_projects = project_names.len() as u32;
    summary.total_sessions = file_stats.len() as u32;

    let mut tool_usage_map: HashMap<String, (u32, u32)> = HashMap::new();
    let mut daily_stats_map: HashMap<String, DailyStats> = HashMap::new();
    let mut activity_map: HashMap<(u8, u8), (u32, u64)> = HashMap::new();
    let mut model_usage_map: HashMap<String, (u32, u64, u64, u64, u64, u64)> = HashMap::new();
    let mut project_stats_map: HashMap<String, (u32, u32, u64)> = HashMap::new();
    let mut provider_stats_map: HashMap<StatsProvider, (u32, u32, u64)> = HashMap::new();
    let mut provider_projects_map: HashMap<StatsProvider, HashSet<String>> = HashMap::new();
    let mut global_first_message: Option<DateTime<Utc>> = None;
    let mut global_last_message: Option<DateTime<Utc>> = None;

    for stats in file_stats {
        let provider = stats.provider;
        let project_name = stats.project_name.clone();

        summary.total_messages += stats.total_messages;
        summary.total_tokens += stats.total_tokens;
        summary.total_session_duration_minutes += stats.session_duration_minutes;

        // Aggregate token distribution
        summary.token_distribution.input += stats.token_distribution.input;
        summary.token_distribution.output += stats.token_distribution.output;
        summary.token_distribution.cache_creation += stats.token_distribution.cache_creation;
        summary.token_distribution.cache_read += stats.token_distribution.cache_read;

        // Aggregate tool usage
        for (name, (usage, success)) in stats.tool_usage {
            let entry = tool_usage_map.entry(name).or_insert((0, 0));
            entry.0 += usage;
            entry.1 += success;
        }

        // Aggregate daily stats
        for (date, daily) in stats.daily_stats {
            let entry = daily_stats_map
                .entry(date.clone())
                .or_insert_with(|| DailyStats {
                    date,
                    ..Default::default()
                });
            entry.total_tokens += daily.total_tokens;
            entry.input_tokens += daily.input_tokens;
            entry.output_tokens += daily.output_tokens;
            entry.message_count += daily.message_count;
        }

        // Aggregate activity data
        for ((hour, day), (count, tokens)) in stats.activity_data {
            let entry = activity_map.entry((hour, day)).or_insert((0, 0));
            entry.0 += count;
            entry.1 += tokens;
        }

        // Aggregate model usage
        for (model, (msg_count, total, input, output, cache_create, cache_read)) in
            stats.model_usage
        {
            let entry = model_usage_map.entry(model).or_insert((0, 0, 0, 0, 0, 0));
            entry.0 += msg_count;
            entry.1 += total;
            entry.2 += input;
            entry.3 += output;
            entry.4 += cache_create;
            entry.5 += cache_read;
        }

        // Aggregate provider stats
        let provider_entry = provider_stats_map.entry(provider).or_insert((0, 0, 0));
        provider_entry.0 += 1; // sessions
        provider_entry.1 += stats.total_messages; // messages
        provider_entry.2 += stats.total_tokens; // tokens

        provider_projects_map
            .entry(provider)
            .or_default()
            .insert(project_name.clone());

        // Aggregate project stats
        let project_entry = project_stats_map.entry(project_name).or_insert((0, 0, 0));
        project_entry.0 += 1; // sessions
        project_entry.1 += stats.total_messages; // messages
        project_entry.2 += stats.total_tokens; // tokens

        // Track global first/last message
        if let Some(first) = stats.first_message {
            if global_first_message.is_none() || first < global_first_message.unwrap() {
                global_first_message = Some(first);
            }
        }
        if let Some(last) = stats.last_message {
            if global_last_message.is_none() || last > global_last_message.unwrap() {
                global_last_message = Some(last);
            }
        }
    }

    // Phase 4: Build final summary structures
    summary.most_used_tools = tool_usage_map
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
        .collect();
    summary
        .most_used_tools
        .sort_by(|a, b| b.usage_count.cmp(&a.usage_count));

    summary.provider_distribution = provider_stats_map
        .into_iter()
        .map(
            |(provider, (sessions, messages, tokens))| ProviderUsageStats {
                provider_id: stats_provider_id(provider).to_string(),
                projects: provider_projects_map
                    .get(&provider)
                    .map(|projects| projects.len() as u32)
                    .unwrap_or(0),
                sessions,
                messages,
                tokens,
            },
        )
        .collect();
    summary
        .provider_distribution
        .sort_by(|a, b| b.tokens.cmp(&a.tokens));

    summary.model_distribution = model_usage_map
        .into_iter()
        .map(
            |(
                model_name,
                (
                    message_count,
                    token_count,
                    input_tokens,
                    output_tokens,
                    cache_creation_tokens,
                    cache_read_tokens,
                ),
            )| ModelStats {
                model_name,
                message_count,
                token_count,
                input_tokens,
                output_tokens,
                cache_creation_tokens,
                cache_read_tokens,
            },
        )
        .collect();
    summary
        .model_distribution
        .sort_by(|a, b| b.token_count.cmp(&a.token_count));

    summary.top_projects = project_stats_map
        .into_iter()
        .map(
            |(project_name, (sessions, messages, tokens))| ProjectRanking {
                project_name,
                sessions,
                messages,
                tokens,
            },
        )
        .collect();
    summary.top_projects.sort_by(|a, b| b.tokens.cmp(&a.tokens));
    summary.top_projects.truncate(10);

    summary.daily_stats = daily_stats_map.into_values().collect();
    summary.daily_stats.sort_by(|a, b| a.date.cmp(&b.date));

    summary.activity_heatmap = activity_map
        .into_iter()
        .map(|((hour, day), (count, tokens))| ActivityHeatmap {
            hour,
            day,
            activity_count: count,
            tokens_used: tokens,
        })
        .collect();

    if let (Some(first), Some(last)) = (global_first_message, global_last_message) {
        summary.date_range.first_message = Some(first.to_rfc3339());
        summary.date_range.last_message = Some(last.to_rfc3339());
        summary.date_range.days_span = (last - first).num_days() as u32;
    }

    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use std::fs::File;
    use std::io::Write;
    use tempfile::TempDir;

    #[test]
    fn test_try_from_raw_log_entry_user_message() {
        let raw = RawLogEntry {
            uuid: Some("test-uuid".to_string()),
            parent_uuid: Some("parent-uuid".to_string()),
            session_id: Some("session-123".to_string()),
            timestamp: Some("2025-06-26T10:00:00Z".to_string()),
            message_type: "user".to_string(),
            summary: None,
            leaf_uuid: None,
            message: Some(MessageContent {
                role: "user".to_string(),
                content: json!("Hello, Claude!"),
                id: None,
                model: None,
                stop_reason: None,
                usage: None,
            }),
            tool_use: None,
            tool_use_result: None,
            is_sidechain: Some(false),
            cwd: Some("/home/user/project".to_string()),
            cost_usd: None,
            duration_ms: None,
            message_id: None,
            snapshot: None,
            is_snapshot_update: None,
            data: None,
            tool_use_id: None,
            parent_tool_use_id: None,
            operation: None,
            subtype: None,
            level: None,
            hook_count: None,
            hook_infos: None,
            stop_reason_system: None,
            prevented_continuation: None,
            compact_metadata: None,
            microcompact_metadata: None,
            content: None,
            is_meta: None,
        };

        let result = ClaudeMessage::try_from(raw);
        assert!(result.is_ok());

        let msg = result.unwrap();
        assert_eq!(msg.uuid, "test-uuid");
        assert_eq!(msg.session_id, "session-123");
        assert_eq!(msg.message_type, "user");
        assert_eq!(msg.role, Some("user".to_string()));
    }

    #[test]
    fn test_try_from_raw_log_entry_assistant_message() {
        let raw = RawLogEntry {
            uuid: Some("assistant-uuid".to_string()),
            parent_uuid: None,
            session_id: Some("session-123".to_string()),
            timestamp: Some("2025-06-26T10:01:00Z".to_string()),
            message_type: "assistant".to_string(),
            summary: None,
            leaf_uuid: None,
            message: Some(MessageContent {
                role: "assistant".to_string(),
                content: json!([{"type": "text", "text": "Hello!"}]),
                id: Some("msg_123".to_string()),
                model: Some("claude-opus-4-20250514".to_string()),
                stop_reason: Some("end_turn".to_string()),
                usage: Some(TokenUsage {
                    input_tokens: Some(100),
                    output_tokens: Some(50),
                    cache_creation_input_tokens: Some(20),
                    cache_read_input_tokens: Some(10),
                    service_tier: Some("standard".to_string()),
                }),
            }),
            tool_use: None,
            tool_use_result: None,
            is_sidechain: None,
            cwd: None,
            cost_usd: Some(0.005),
            duration_ms: Some(1500),
            message_id: None,
            snapshot: None,
            is_snapshot_update: None,
            data: None,
            tool_use_id: None,
            parent_tool_use_id: None,
            operation: None,
            subtype: None,
            level: None,
            hook_count: None,
            hook_infos: None,
            stop_reason_system: None,
            prevented_continuation: None,
            compact_metadata: None,
            microcompact_metadata: None,
            content: None,
            is_meta: None,
        };

        let result = ClaudeMessage::try_from(raw);
        assert!(result.is_ok());

        let msg = result.unwrap();
        assert_eq!(msg.message_type, "assistant");
        assert_eq!(msg.model, Some("claude-opus-4-20250514".to_string()));
        assert_eq!(msg.stop_reason, Some("end_turn".to_string()));
        assert_eq!(msg.cost_usd, Some(0.005));
        assert_eq!(msg.duration_ms, Some(1500));

        let usage = msg.usage.unwrap();
        assert_eq!(usage.input_tokens, Some(100));
        assert_eq!(usage.output_tokens, Some(50));
    }

    #[test]
    fn test_try_from_raw_log_entry_summary_fails() {
        let raw = RawLogEntry {
            uuid: None,
            parent_uuid: None,
            session_id: None,
            timestamp: None,
            message_type: "summary".to_string(),
            summary: Some("This is a summary".to_string()),
            leaf_uuid: Some("leaf-123".to_string()),
            message: None,
            tool_use: None,
            tool_use_result: None,
            is_sidechain: None,
            cwd: None,
            cost_usd: None,
            duration_ms: None,
            message_id: None,
            snapshot: None,
            is_snapshot_update: None,
            data: None,
            tool_use_id: None,
            parent_tool_use_id: None,
            operation: None,
            subtype: None,
            level: None,
            hook_count: None,
            hook_infos: None,
            stop_reason_system: None,
            prevented_continuation: None,
            compact_metadata: None,
            microcompact_metadata: None,
            content: None,
            is_meta: None,
        };

        let result = ClaudeMessage::try_from(raw);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Summary"));
    }

    #[test]
    fn test_try_from_raw_log_entry_missing_session_and_timestamp_fails() {
        let raw = RawLogEntry {
            uuid: Some("uuid".to_string()),
            parent_uuid: None,
            session_id: None,
            timestamp: None,
            message_type: "user".to_string(),
            summary: None,
            leaf_uuid: None,
            message: Some(MessageContent {
                role: "user".to_string(),
                content: json!("Hello"),
                id: None,
                model: None,
                stop_reason: None,
                usage: None,
            }),
            tool_use: None,
            tool_use_result: None,
            is_sidechain: None,
            cwd: None,
            cost_usd: None,
            duration_ms: None,
            message_id: None,
            snapshot: None,
            is_snapshot_update: None,
            data: None,
            tool_use_id: None,
            parent_tool_use_id: None,
            operation: None,
            subtype: None,
            level: None,
            hook_count: None,
            hook_infos: None,
            stop_reason_system: None,
            prevented_continuation: None,
            compact_metadata: None,
            microcompact_metadata: None,
            content: None,
            is_meta: None,
        };

        let result = ClaudeMessage::try_from(raw);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Missing"));
    }

    #[test]
    fn test_try_from_raw_log_entry_with_only_timestamp() {
        let raw = RawLogEntry {
            uuid: None,
            parent_uuid: None,
            session_id: None,
            timestamp: Some("2025-06-26T10:00:00Z".to_string()),
            message_type: "user".to_string(),
            summary: None,
            leaf_uuid: None,
            message: Some(MessageContent {
                role: "user".to_string(),
                content: json!("Hello"),
                id: None,
                model: None,
                stop_reason: None,
                usage: None,
            }),
            tool_use: None,
            tool_use_result: None,
            is_sidechain: None,
            cwd: None,
            cost_usd: None,
            duration_ms: None,
            message_id: None,
            snapshot: None,
            is_snapshot_update: None,
            data: None,
            tool_use_id: None,
            parent_tool_use_id: None,
            operation: None,
            subtype: None,
            level: None,
            hook_count: None,
            hook_infos: None,
            stop_reason_system: None,
            prevented_continuation: None,
            compact_metadata: None,
            microcompact_metadata: None,
            content: None,
            is_meta: None,
        };

        // Should succeed with timestamp even without session_id
        let result = ClaudeMessage::try_from(raw);
        assert!(result.is_ok());

        let msg = result.unwrap();
        assert_eq!(msg.session_id, "unknown-session");
    }

    #[test]
    fn test_extract_token_usage_from_usage_field() {
        let msg = ClaudeMessage {
            uuid: "uuid".to_string(),
            parent_uuid: None,
            session_id: "session".to_string(),
            timestamp: "2025-01-01T00:00:00Z".to_string(),
            message_type: "assistant".to_string(),
            content: None,
            project_name: None,
            tool_use: None,
            tool_use_result: None,
            is_sidechain: None,
            usage: Some(TokenUsage {
                input_tokens: Some(100),
                output_tokens: Some(50),
                cache_creation_input_tokens: Some(20),
                cache_read_input_tokens: Some(10),
                service_tier: Some("standard".to_string()),
            }),
            role: Some("assistant".to_string()),
            model: None,
            stop_reason: None,
            cost_usd: None,
            duration_ms: None,
            message_id: None,
            snapshot: None,
            is_snapshot_update: None,
            data: None,
            tool_use_id: None,
            parent_tool_use_id: None,
            operation: None,
            subtype: None,
            level: None,
            hook_count: None,
            hook_infos: None,
            stop_reason_system: None,
            prevented_continuation: None,
            compact_metadata: None,
            microcompact_metadata: None,
            provider: None,
        };

        let usage = extract_token_usage(&msg);
        assert_eq!(usage.input_tokens, Some(100));
        assert_eq!(usage.output_tokens, Some(50));
        assert_eq!(usage.cache_creation_input_tokens, Some(20));
        assert_eq!(usage.cache_read_input_tokens, Some(10));
    }

    #[test]
    fn test_extract_token_usage_from_content() {
        let msg = ClaudeMessage {
            uuid: "uuid".to_string(),
            parent_uuid: None,
            session_id: "session".to_string(),
            timestamp: "2025-01-01T00:00:00Z".to_string(),
            message_type: "assistant".to_string(),
            content: Some(json!({
                "usage": {
                    "input_tokens": 200,
                    "output_tokens": 100,
                    "service_tier": "premium"
                }
            })),
            project_name: None,
            tool_use: None,
            tool_use_result: None,
            is_sidechain: None,
            usage: None,
            role: None,
            model: None,
            stop_reason: None,
            cost_usd: None,
            duration_ms: None,
            message_id: None,
            snapshot: None,
            is_snapshot_update: None,
            data: None,
            tool_use_id: None,
            parent_tool_use_id: None,
            operation: None,
            subtype: None,
            level: None,
            hook_count: None,
            hook_infos: None,
            stop_reason_system: None,
            prevented_continuation: None,
            compact_metadata: None,
            microcompact_metadata: None,
            provider: None,
        };

        let usage = extract_token_usage(&msg);
        assert_eq!(usage.input_tokens, Some(200));
        assert_eq!(usage.output_tokens, Some(100));
        assert_eq!(usage.service_tier, Some("premium".to_string()));
    }

    #[test]
    fn test_extract_token_usage_from_tool_use_result() {
        let msg = ClaudeMessage {
            uuid: "uuid".to_string(),
            parent_uuid: None,
            session_id: "session".to_string(),
            timestamp: "2025-01-01T00:00:00Z".to_string(),
            message_type: "user".to_string(),
            content: None,
            project_name: None,
            tool_use: None,
            tool_use_result: Some(json!({
                "usage": {
                    "input_tokens": 150,
                    "output_tokens": 75
                }
            })),
            is_sidechain: None,
            usage: None,
            role: None,
            model: None,
            stop_reason: None,
            cost_usd: None,
            duration_ms: None,
            message_id: None,
            snapshot: None,
            is_snapshot_update: None,
            data: None,
            tool_use_id: None,
            parent_tool_use_id: None,
            operation: None,
            subtype: None,
            level: None,
            hook_count: None,
            hook_infos: None,
            stop_reason_system: None,
            prevented_continuation: None,
            compact_metadata: None,
            microcompact_metadata: None,
            provider: None,
        };

        let usage = extract_token_usage(&msg);
        assert_eq!(usage.input_tokens, Some(150));
        assert_eq!(usage.output_tokens, Some(75));
    }

    #[test]
    fn test_extract_token_usage_from_total_tokens() {
        let msg = ClaudeMessage {
            uuid: "uuid".to_string(),
            parent_uuid: None,
            session_id: "session".to_string(),
            timestamp: "2025-01-01T00:00:00Z".to_string(),
            message_type: "assistant".to_string(),
            content: None,
            project_name: None,
            tool_use: None,
            tool_use_result: Some(json!({
                "totalTokens": 500
            })),
            is_sidechain: None,
            usage: None,
            role: None,
            model: None,
            stop_reason: None,
            cost_usd: None,
            duration_ms: None,
            message_id: None,
            snapshot: None,
            is_snapshot_update: None,
            data: None,
            tool_use_id: None,
            parent_tool_use_id: None,
            operation: None,
            subtype: None,
            level: None,
            hook_count: None,
            hook_infos: None,
            stop_reason_system: None,
            prevented_continuation: None,
            compact_metadata: None,
            microcompact_metadata: None,
            provider: None,
        };

        let usage = extract_token_usage(&msg);
        // For assistant messages, totalTokens goes to output_tokens
        assert_eq!(usage.output_tokens, Some(500));
    }

    #[test]
    fn test_extract_token_usage_empty() {
        let msg = ClaudeMessage {
            uuid: "uuid".to_string(),
            parent_uuid: None,
            session_id: "session".to_string(),
            timestamp: "2025-01-01T00:00:00Z".to_string(),
            message_type: "user".to_string(),
            content: None,
            project_name: None,
            tool_use: None,
            tool_use_result: None,
            is_sidechain: None,
            usage: None,
            role: None,
            model: None,
            stop_reason: None,
            cost_usd: None,
            duration_ms: None,
            message_id: None,
            snapshot: None,
            is_snapshot_update: None,
            data: None,
            tool_use_id: None,
            parent_tool_use_id: None,
            operation: None,
            subtype: None,
            level: None,
            hook_count: None,
            hook_infos: None,
            stop_reason_system: None,
            prevented_continuation: None,
            compact_metadata: None,
            microcompact_metadata: None,
            provider: None,
        };

        let usage = extract_token_usage(&msg);
        assert!(usage.input_tokens.is_none());
        assert!(usage.output_tokens.is_none());
    }

    #[test]
    fn test_detect_project_provider_from_virtual_prefix() {
        assert_eq!(
            detect_project_provider("codex:///Users/jack/workspace"),
            StatsProvider::Codex
        );
        assert_eq!(
            detect_project_provider("opencode://project_123"),
            StatsProvider::OpenCode
        );
        assert_eq!(
            detect_project_provider("/Users/jack/.claude/projects/my-project"),
            StatsProvider::Claude
        );
    }

    #[test]
    fn test_detect_session_provider_from_path_pattern() {
        assert_eq!(
            detect_session_provider("opencode://project/ses_abc"),
            StatsProvider::OpenCode
        );
        assert_eq!(
            detect_session_provider(
                "/Users/jack/.codex/sessions/2026/02/20/rollout-2026-02-20T11-04-52-1234.jsonl"
            ),
            StatsProvider::Codex
        );
        assert_eq!(
            detect_session_provider(
                "/Users/jack/.claude/projects/-Users-jack-client-repo/1234-5678-90ab.jsonl"
            ),
            StatsProvider::Claude
        );
    }

    #[test]
    fn test_parse_active_stats_providers_defaults_to_all() {
        let providers = parse_active_stats_providers(None);
        assert!(providers.contains(&StatsProvider::Claude));
        assert!(providers.contains(&StatsProvider::Codex));
        assert!(providers.contains(&StatsProvider::OpenCode));
    }

    #[test]
    fn test_parse_active_stats_providers_filters_unknown_values() {
        let providers =
            parse_active_stats_providers(Some(vec!["claude".to_string(), "unknown".to_string()]));
        assert_eq!(providers.len(), 1);
        assert!(providers.contains(&StatsProvider::Claude));
    }

    #[test]
    fn test_parse_active_stats_providers_returns_empty_for_unknown_only_values() {
        let providers = parse_active_stats_providers(Some(vec!["invalid".to_string()]));
        assert!(providers.is_empty());
    }

    #[test]
    fn test_parse_active_stats_providers_returns_empty_for_empty_list() {
        let providers = parse_active_stats_providers(Some(vec![]));
        assert!(providers.is_empty());
    }

    #[test]
    fn test_parse_stats_mode_defaults_and_unknown() {
        assert_eq!(parse_stats_mode(None), StatsMode::BillingTotal);
        assert_eq!(
            parse_stats_mode(Some("billing_total".to_string())),
            StatsMode::BillingTotal
        );
        assert_eq!(
            parse_stats_mode(Some("conversation_only".to_string())),
            StatsMode::ConversationOnly
        );
        assert_eq!(
            parse_stats_mode(Some("invalid_mode".to_string())),
            StatsMode::BillingTotal
        );
    }

    #[test]
    fn test_should_include_stats_entry_sidechain_mode_switch() {
        assert!(should_include_stats_entry(
            "assistant",
            Some(true),
            true,
            StatsMode::BillingTotal
        ));
        assert!(!should_include_stats_entry(
            "assistant",
            Some(true),
            true,
            StatsMode::ConversationOnly
        ));
        assert!(!should_include_stats_entry(
            "summary",
            Some(false),
            true,
            StatsMode::BillingTotal
        ));
        assert!(!should_include_stats_entry(
            "progress",
            Some(false),
            false,
            StatsMode::BillingTotal
        ));
        assert!(should_include_stats_entry(
            "progress",
            Some(false),
            true,
            StatsMode::BillingTotal
        ));
        assert!(should_include_stats_entry(
            "system",
            Some(false),
            true,
            StatsMode::BillingTotal
        ));
        assert!(!should_include_stats_entry(
            "system",
            Some(false),
            true,
            StatsMode::ConversationOnly
        ));
        assert!(!should_include_stats_entry(
            "tool_result",
            Some(false),
            true,
            StatsMode::ConversationOnly
        ));
    }

    #[tokio::test]
    async fn test_project_summary_session_count_matches_token_list_in_conversation_mode() {
        let temp_dir = TempDir::new().expect("failed to create temp dir");
        let claude_path = temp_dir.path();
        let project_dir = claude_path.join("projects").join("demo-project");
        fs::create_dir_all(&project_dir).expect("failed to create project dir");

        let session_main = project_dir.join("session-main.jsonl");
        let session_sidechain = project_dir.join("session-sidechain.jsonl");

        let mut main_file = File::create(&session_main).expect("failed to create main session");
        let main_line = r#"{"uuid":"u1","sessionId":"s-main","timestamp":"2025-01-01T00:00:00Z","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"main"}],"id":"m1","model":"claude-sonnet-4","usage":{"input_tokens":50,"output_tokens":5}},"isSidechain":false}"#;
        writeln!(main_file, "{main_line}").expect("failed to write main line");

        let mut sidechain_file =
            File::create(&session_sidechain).expect("failed to create sidechain session");
        let sidechain_line = r#"{"uuid":"u2","sessionId":"s-side","timestamp":"2025-01-01T00:01:00Z","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"side"}],"id":"m2","model":"claude-sonnet-4","usage":{"input_tokens":70,"output_tokens":7}},"isSidechain":true}"#;
        writeln!(sidechain_file, "{sidechain_line}").expect("failed to write sidechain line");

        let project_path_str = project_dir.to_string_lossy().to_string();

        let project_summary = get_project_stats_summary(
            project_path_str.clone(),
            None,
            None,
            Some("conversation_only".to_string()),
        )
        .await
        .expect("failed to get project summary");

        let token_list = get_project_token_stats(
            project_path_str.clone(),
            Some(0),
            Some(20),
            None,
            None,
            Some("conversation_only".to_string()),
        )
        .await
        .expect("failed to get project token stats");

        assert_eq!(
            project_summary.total_sessions as usize,
            token_list.total_count
        );
        assert_eq!(project_summary.total_sessions, 1);
        assert_eq!(token_list.items.len(), 1);
        assert_eq!(token_list.items[0].session_id, "s-main");
    }

    #[tokio::test]
    async fn test_stats_mode_reconciles_global_project_and_session_totals() {
        let temp_dir = TempDir::new().expect("failed to create temp dir");
        let claude_path = temp_dir.path();
        let project_dir = claude_path.join("projects").join("demo-project");
        fs::create_dir_all(&project_dir).expect("failed to create project dir");
        let session_path = project_dir.join("session-1.jsonl");

        let mut file = File::create(&session_path).expect("failed to create session file");
        let line1 = r#"{"uuid":"u1","sessionId":"s1","timestamp":"2025-01-01T00:00:00Z","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"main"}],"id":"m1","model":"claude-sonnet-4","usage":{"input_tokens":100,"output_tokens":10}},"isSidechain":false}"#;
        let line2 = r#"{"uuid":"u2","sessionId":"s1","timestamp":"2025-01-01T00:01:00Z","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"sidechain"}],"id":"m2","model":"claude-sonnet-4","usage":{"input_tokens":200,"output_tokens":20}},"isSidechain":true}"#;
        writeln!(file, "{line1}").expect("failed to write line1");
        writeln!(file, "{line2}").expect("failed to write line2");

        let claude_path_str = claude_path.to_string_lossy().to_string();
        let project_path_str = project_dir.to_string_lossy().to_string();
        let session_path_str = session_path.to_string_lossy().to_string();

        let global_billing = get_global_stats_summary(
            claude_path_str.clone(),
            Some(vec!["claude".to_string()]),
            Some("billing_total".to_string()),
        )
        .await
        .expect("failed to get global billing stats");
        let global_conversation = get_global_stats_summary(
            claude_path_str,
            Some(vec!["claude".to_string()]),
            Some("conversation_only".to_string()),
        )
        .await
        .expect("failed to get global conversation stats");

        assert_eq!(global_billing.total_tokens, 330);
        assert_eq!(global_conversation.total_tokens, 110);

        let project_billing = get_project_stats_summary(
            project_path_str.clone(),
            None,
            None,
            Some("billing_total".to_string()),
        )
        .await
        .expect("failed to get project billing stats");
        let project_conversation = get_project_stats_summary(
            project_path_str.clone(),
            None,
            None,
            Some("conversation_only".to_string()),
        )
        .await
        .expect("failed to get project conversation stats");

        assert_eq!(project_billing.total_tokens, global_billing.total_tokens);
        assert_eq!(
            project_conversation.total_tokens,
            global_conversation.total_tokens
        );

        let project_token_billing = get_project_token_stats(
            project_path_str.clone(),
            Some(0),
            Some(20),
            None,
            None,
            Some("billing_total".to_string()),
        )
        .await
        .expect("failed to get project token billing stats");
        let project_token_conversation = get_project_token_stats(
            project_path_str,
            Some(0),
            Some(20),
            None,
            None,
            Some("conversation_only".to_string()),
        )
        .await
        .expect("failed to get project token conversation stats");

        let total_project_token_billing: u64 = project_token_billing
            .items
            .iter()
            .map(|s| s.total_tokens)
            .sum();
        let total_project_token_conversation: u64 = project_token_conversation
            .items
            .iter()
            .map(|s| s.total_tokens)
            .sum();
        assert_eq!(total_project_token_billing, global_billing.total_tokens);
        assert_eq!(
            total_project_token_conversation,
            global_conversation.total_tokens
        );

        let session_billing = get_session_token_stats(
            session_path_str.clone(),
            None,
            None,
            Some("billing_total".to_string()),
        )
        .await
        .expect("failed to get session billing stats");
        let session_conversation = get_session_token_stats(
            session_path_str,
            None,
            None,
            Some("conversation_only".to_string()),
        )
        .await
        .expect("failed to get session conversation stats");

        assert_eq!(session_billing.total_tokens, global_billing.total_tokens);
        assert_eq!(
            session_conversation.total_tokens,
            global_conversation.total_tokens
        );
    }

    #[tokio::test]
    async fn test_session_token_stats_respects_date_filter() {
        let temp_dir = TempDir::new().expect("failed to create temp dir");
        let project_dir = temp_dir.path().join("projects").join("demo-project");
        fs::create_dir_all(&project_dir).expect("failed to create project dir");
        let session_path = project_dir.join("session-date-filter.jsonl");

        let mut file = File::create(&session_path).expect("failed to create session file");
        let day1 = r#"{"uuid":"u1","sessionId":"s-date","timestamp":"2025-01-01T12:00:00Z","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"day1"}],"id":"m1","model":"claude-sonnet-4","usage":{"input_tokens":10,"output_tokens":1}},"isSidechain":false}"#;
        let day2 = r#"{"uuid":"u2","sessionId":"s-date","timestamp":"2025-01-02T12:00:00Z","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"day2"}],"id":"m2","model":"claude-sonnet-4","usage":{"input_tokens":20,"output_tokens":2}},"isSidechain":false}"#;
        writeln!(file, "{day1}").expect("failed to write day1");
        writeln!(file, "{day2}").expect("failed to write day2");

        let stats = get_session_token_stats(
            session_path.to_string_lossy().to_string(),
            Some("2025-01-02T00:00:00Z".to_string()),
            Some("2025-01-02T23:59:59.999Z".to_string()),
            Some("billing_total".to_string()),
        )
        .await
        .expect("failed to get filtered session stats");

        // Session-level filtering: include the whole session if last message is in range.
        assert_eq!(stats.message_count, 2);
        assert_eq!(stats.total_input_tokens, 30);
        assert_eq!(stats.total_output_tokens, 3);
        assert_eq!(stats.total_tokens, 33);

        let filtered_out = get_session_token_stats(
            session_path.to_string_lossy().to_string(),
            Some("2025-01-01T00:00:00Z".to_string()),
            Some("2025-01-01T23:59:59.999Z".to_string()),
            Some("billing_total".to_string()),
        )
        .await;
        assert!(filtered_out.is_err());
    }

    #[tokio::test]
    async fn test_session_comparison_respects_date_filter() {
        let temp_dir = TempDir::new().expect("failed to create temp dir");
        let project_dir = temp_dir.path().join("projects").join("demo-project");
        fs::create_dir_all(&project_dir).expect("failed to create project dir");

        let session_a = project_dir.join("session-a.jsonl");
        let session_b = project_dir.join("session-b.jsonl");

        let mut file_a = File::create(&session_a).expect("failed to create session a");
        let line_a = r#"{"uuid":"ua","sessionId":"s-a","timestamp":"2025-01-01T12:00:00Z","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"a"}],"id":"ma","model":"claude-sonnet-4","usage":{"input_tokens":10,"output_tokens":1}},"isSidechain":false}"#;
        writeln!(file_a, "{line_a}").expect("failed to write session a");

        let mut file_b = File::create(&session_b).expect("failed to create session b");
        let line_b = r#"{"uuid":"ub","sessionId":"s-b","timestamp":"2025-01-02T12:00:00Z","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"b"}],"id":"mb","model":"claude-sonnet-4","usage":{"input_tokens":20,"output_tokens":2}},"isSidechain":false}"#;
        writeln!(file_b, "{line_b}").expect("failed to write session b");

        let project_path = project_dir.to_string_lossy().to_string();

        let comparison = get_session_comparison(
            "s-b".to_string(),
            project_path.clone(),
            Some("2025-01-02T00:00:00Z".to_string()),
            Some("2025-01-02T23:59:59.999Z".to_string()),
            Some("billing_total".to_string()),
        )
        .await
        .expect("failed to get filtered comparison");
        assert_eq!(comparison.session_id, "s-b");
        assert_eq!(comparison.rank_by_tokens, 1);

        let filtered_out = get_session_comparison(
            "s-a".to_string(),
            project_path,
            Some("2025-01-02T00:00:00Z".to_string()),
            Some("2025-01-02T23:59:59.999Z".to_string()),
            Some("billing_total".to_string()),
        )
        .await;
        assert!(filtered_out.is_err());
    }

    #[test]
    fn test_calculate_session_active_minutes_handles_long_gaps() {
        let mut timestamps = vec![
            DateTime::parse_from_rfc3339("2026-02-20T10:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
            DateTime::parse_from_rfc3339("2026-02-20T10:20:00Z")
                .unwrap()
                .with_timezone(&Utc),
            DateTime::parse_from_rfc3339("2026-02-20T14:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
            DateTime::parse_from_rfc3339("2026-02-20T14:30:00Z")
                .unwrap()
                .with_timezone(&Utc),
        ];

        // 10:00~10:20(20분) + 14:00~14:30(30분) = 50분
        assert_eq!(calculate_session_active_minutes(&mut timestamps), 50);
    }
}
