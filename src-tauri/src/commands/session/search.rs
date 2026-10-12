//! Session search functions

use crate::models::{ClaudeMessage, RawLogEntry};
use crate::utils::find_line_ranges;
use aho_corasick::AhoCorasick;
use chrono::{DateTime, Utc};
use lru::LruCache;
use memmap2::Mmap;
use rayon::prelude::*;
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;
use uuid::Uuid;
use walkdir::WalkDir;

/// Initial buffer capacity for JSON parsing (4KB covers most messages)
const PARSE_BUFFER_INITIAL_CAPACITY: usize = 4096;

/// Initial capacity for search results (most searches find few matches)
const SEARCH_RESULTS_INITIAL_CAPACITY: usize = 8;

/// LRU cache capacity — distinct (`claude_path`, query) pairs.
const SEARCH_CACHE_CAPACITY: usize = 64;

/// Upper bound on cached raw matches per query entry; a query matching huge
/// portions of the corpus is computed but not stored, keeping worst-case
/// memory bounded.
const MAX_CACHED_MATCHES_PER_QUERY: usize = 10_000;

lazy_static::lazy_static! {
    static ref ERROR_MATCHER: AhoCorasick = build_matcher("error");
    static ref SEARCH_CACHE: Mutex<LruCache<u64, CachedQuerySearch>> =
        Mutex::new(LruCache::new(NonZeroUsize::new(SEARCH_CACHE_CAPACITY).expect("non-zero")));
}

/// (size, mtime) identity of a session file, captured BEFORE scanning so a
/// concurrent append can never be cached under a newer signature (worst
/// case: an unnecessary re-scan on the next call). Same validation scheme as
/// `stats::cache`, kept separate on purpose — the two caches must not couple.
#[derive(Clone, Copy, PartialEq, Eq)]
struct FileSignature {
    size: u64,
    mtime: Option<SystemTime>,
}

impl FileSignature {
    fn of(path: &Path) -> Option<Self> {
        let metadata = fs::metadata(path).ok()?;
        Some(Self {
            size: metadata.len(),
            mtime: metadata.modified().ok(),
        })
    }
}

/// Raw (unfiltered, untruncated) matches of one query in one file, valid
/// while the file's signature is unchanged.
#[derive(Clone)]
struct FileMatches {
    signature: FileSignature,
    matches: Arc<Vec<ClaudeMessage>>,
}

/// Per-file match sets for one (`claude_path`, query) pair. Filters and limit
/// are applied at serve time, so one entry answers every filter/limit
/// combination for its query.
struct CachedQuerySearch {
    files: HashMap<PathBuf, FileMatches>,
}

/// Drop one file's cached matches from every cached query.
///
/// Needed for the session-rename commands, which REWRITE a session file via
/// temp+rename: a rewrite can produce the same byte size within the mtime
/// resolution window, which the `(size, mtime)` signature cannot distinguish
/// (append-only growth always changes the size, so the watcher path needs no
/// such hook). Hashing content instead would cost a full read per file per
/// search — defeating the cache — so targeted eviction at the rewrite site is
/// the cheap, precise fix.
pub fn evict_file_from_search_cache(path: &Path) {
    let Ok(mut cache) = SEARCH_CACHE.lock() else {
        return;
    };
    let canonical = path.canonicalize().ok();
    for (_, entry) in cache.iter_mut() {
        entry.files.remove(path);
        if let Some(ref canonical) = canonical {
            entry.files.remove(canonical);
        }
    }
}

fn cache_key(claude_path: &str, query: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    claude_path.hash(&mut hasher);
    query.to_lowercase().hash(&mut hasher);
    hasher.finish()
}

/// Recursively search for a query within a `serde_json::Value` using aho-corasick.
/// Case-insensitive matching without per-string heap allocation from `.to_lowercase()`.
#[inline]
fn search_in_value(value: &serde_json::Value, matcher: &AhoCorasick) -> bool {
    match value {
        serde_json::Value::String(s) => matcher.is_match(s),
        serde_json::Value::Array(arr) => arr.iter().any(|item| search_in_value(item, matcher)),
        serde_json::Value::Object(obj) => obj.values().any(|val| search_in_value(val, matcher)),
        _ => false,
    }
}

/// Build an aho-corasick matcher for case-insensitive single-pattern search.
/// Uses ASCII case-insensitive mode (sufficient for most search queries).
fn build_matcher(query: &str) -> AhoCorasick {
    AhoCorasick::builder()
        .ascii_case_insensitive(true)
        .build([query])
        .expect("single-pattern AhoCorasick build should never fail")
}

/// Whether raw-line prefiltering is sound for `query`.
///
/// A parsed JSON string is made of bytes copied verbatim from the raw line
/// plus characters produced by escapes. The two-character escapes only ever
/// produce `"`, `\`, `/` or control characters, so a query free of those
/// characters can only match a parsed string if it also matches the raw
/// bytes — provided no `\uXXXX` escape produces something else (see
/// [`unicode_escapes_only_produce_controls`]).
fn raw_prefilter_is_sound(query: &str) -> bool {
    !query
        .bytes()
        .any(|b| b == b'"' || b == b'\\' || b == b'/' || b < 0x20)
}

/// True when every `\u` in the raw line is followed by `00[01]X`, i.e. every
/// `\uXXXX` escape decodes to a control character (`< U+0020`), which a
/// prefilter-eligible query never contains. Searching for the byte pair `\u`
/// over-approximates the real escapes (`\\u...` is a literal backslash), which
/// only makes the check more conservative. Common case: ANSI colour codes in
/// command output, stored as `\u001b`.
fn unicode_escapes_only_produce_controls(raw: &[u8]) -> bool {
    memchr::memmem::find_iter(raw, b"\\u").all(|pos| {
        matches!(
            raw.get(pos + 2..pos + 6),
            Some([b'0', b'0', b'0' | b'1', last]) if last.is_ascii_hexdigit()
        )
    })
}

/// Cheap pre-parse check: `false` only when the line provably cannot match.
/// False positives (a key name, an unsearched field) fall through to the
/// exact check after parsing.
#[inline]
fn raw_line_may_match(raw: &[u8], matcher: &AhoCorasick) -> bool {
    matcher.is_match(raw) || !unicode_escapes_only_produce_controls(raw)
}

/// Extract project name from file path
/// Path format: ~/.claude/projects/[project-name]/[session-file].jsonl
fn extract_project_name(file_path: &PathBuf) -> Option<String> {
    file_path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .map(std::string::ToString::to_string)
}

/// Search for messages matching the query in a single file
///
/// Uses a reusable buffer to avoid repeated heap allocations during JSON parsing.
/// Accepts a pre-built `AhoCorasick` matcher to avoid rebuilding per file.
/// With `prefilter_raw_lines` (only pass `raw_prefilter_is_sound(query)`),
/// lines that provably cannot match are skipped before the costly parse.
#[allow(unsafe_code)] // Required for mmap performance optimization
fn search_in_file(
    file_path: &PathBuf,
    matcher: &AhoCorasick,
    prefilter_raw_lines: bool,
) -> Vec<ClaudeMessage> {
    let project_name = extract_project_name(file_path);

    let file = match fs::File::open(file_path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };

    // SAFETY: We're only reading the file, and the file handle is kept open
    // for the duration of the mmap's lifetime. Session files are append-only.
    let mmap = match unsafe { Mmap::map(&file) } {
        Ok(m) => m,
        Err(_) => return Vec::new(),
    };

    // Use SIMD-accelerated line detection
    let line_ranges = find_line_ranges(&mmap);

    let mut results = Vec::with_capacity(SEARCH_RESULTS_INITIAL_CAPACITY);

    // Reusable buffer for simd-json parsing (requires mutable slice)
    // This avoids heap allocation per line
    let mut parse_buffer = Vec::with_capacity(PARSE_BUFFER_INITIAL_CAPACITY);

    for (line_num, (start, end)) in line_ranges.iter().enumerate() {
        let raw_line = &mmap[*start..*end];
        if prefilter_raw_lines && !raw_line_may_match(raw_line, matcher) {
            continue;
        }

        // Reuse buffer instead of allocating new Vec each iteration
        parse_buffer.clear();
        parse_buffer.extend_from_slice(raw_line);

        let log_entry: RawLogEntry = match simd_json::serde::from_slice(&mut parse_buffer) {
            Ok(entry) => entry,
            Err(_) => continue,
        };

        if log_entry.message_type != "user" && log_entry.message_type != "assistant" {
            continue;
        }

        // Owned, so a match moves its fields instead of cloning them.
        let message_content = match log_entry.message {
            Some(mc) => mc,
            None => continue,
        };

        // Use aho-corasick for case-insensitive matching without heap allocation
        let content_matches = match &message_content.content {
            serde_json::Value::String(s) => matcher.is_match(s),
            serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
                search_in_value(&message_content.content, matcher)
            }
            _ => false,
        };

        // Also search the tool-call payloads. The in-session FlexSearch index
        // covers `toolUseResult` (file contents, command stdout/stderr) and tool
        // names, so global search must too — otherwise a query that only appears
        // in a tool result is found inside a conversation but missed by the
        // global search (issue #394). `search_in_value` already recurses every
        // nested string (e.g. `toolUseResult.file.content`, `.stdout`).
        let matches = content_matches
            || log_entry
                .tool_use_result
                .as_ref()
                .is_some_and(|v| search_in_value(v, matcher))
            || log_entry
                .tool_use
                .as_ref()
                .is_some_and(|v| search_in_value(v, matcher));

        if !matches {
            continue;
        }

        let claude_message = ClaudeMessage {
            uuid: log_entry
                .uuid
                .unwrap_or_else(|| format!("{}-line-{}", Uuid::new_v4(), line_num + 1)),
            parent_uuid: log_entry.parent_uuid,
            session_id: log_entry
                .session_id
                .unwrap_or_else(|| "unknown-session".to_string()),
            timestamp: log_entry
                .timestamp
                .unwrap_or_else(|| Utc::now().to_rfc3339()),
            message_type: log_entry.message_type,
            content: Some(message_content.content),
            project_name: project_name.clone(),
            tool_use: log_entry.tool_use,
            tool_use_result: log_entry.tool_use_result,
            is_sidechain: log_entry.is_sidechain,
            usage: message_content.usage,
            role: Some(message_content.role),
            model: message_content.model,
            stop_reason: message_content.stop_reason,
            cost_usd: log_entry.cost_usd,
            duration_ms: log_entry.duration_ms,
            message_id: message_content.id,
            ..Default::default()
        };
        results.push(claude_message);
    }

    results
}

/// Default limit for search results
const DEFAULT_SEARCH_LIMIT: usize = 100;

fn has_tool_calls(message: &ClaudeMessage) -> bool {
    message.tool_use.is_some()
        || message.tool_use_result.is_some()
        || message
            .content
            .as_ref()
            .and_then(serde_json::Value::as_array)
            .map(|arr| {
                arr.iter().any(|item| {
                    item.get("type").and_then(serde_json::Value::as_str) == Some("tool_use")
                        || item.get("type").and_then(serde_json::Value::as_str)
                            == Some("tool_result")
                })
            })
            .unwrap_or(false)
}

fn has_errors(message: &ClaudeMessage) -> bool {
    message.message_type == "error"
        || message.level.as_deref() == Some("error")
        || message
            .stop_reason_system
            .as_deref()
            .map(|s| ERROR_MATCHER.is_match(s))
            .unwrap_or(false)
        || message
            .content
            .as_ref()
            .map(|v| search_in_value(v, &ERROR_MATCHER))
            .unwrap_or(false)
}

fn has_file_changes(message: &ClaudeMessage) -> bool {
    let Some(content) = message
        .content
        .as_ref()
        .and_then(serde_json::Value::as_array)
    else {
        return false;
    };

    content.iter().any(|item| {
        if item.get("type").and_then(serde_json::Value::as_str) != Some("tool_use") {
            return false;
        }

        matches!(
            item.get("name").and_then(serde_json::Value::as_str),
            Some("Write" | "Edit" | "MultiEdit" | "NotebookEdit")
        )
    })
}

fn parse_filter_date(value: &serde_json::Value) -> Option<DateTime<Utc>> {
    value.as_str().and_then(|s| {
        DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|dt| dt.with_timezone(&Utc))
    })
}

fn filter_value_to_string(value: &serde_json::Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

pub(crate) fn validate_search_filters(filters: &serde_json::Value) -> Result<(), String> {
    let Some(obj) = filters.as_object() else {
        return Ok(());
    };

    match obj.get("sessionIds") {
        None | Some(serde_json::Value::Null) => {}
        Some(serde_json::Value::Array(ids)) if ids.iter().all(serde_json::Value::is_string) => {}
        Some(other) => {
            return Err(format!(
                "Invalid sessionIds filter: expected an array of strings, got {other}"
            ));
        }
    }

    let Some(date_range) = obj.get("dateRange").and_then(serde_json::Value::as_array) else {
        return Ok(());
    };

    if date_range.len() != 2 {
        return Err(format!(
            "Invalid dateRange filter: expected [start, end], got {} item(s)",
            date_range.len()
        ));
    }

    let start_raw = filter_value_to_string(&date_range[0]);
    let end_raw = filter_value_to_string(&date_range[1]);

    let Some(start_at) = parse_filter_date(&date_range[0]) else {
        return Err(format!(
            "Invalid dateRange start: {start_raw} (expected RFC3339 datetime)"
        ));
    };
    let Some(end_at) = parse_filter_date(&date_range[1]) else {
        return Err(format!(
            "Invalid dateRange end: {end_raw} (expected RFC3339 datetime)"
        ));
    };

    if start_at > end_at {
        return Err(format!(
            "Invalid dateRange filter: start ({start_raw}) is after end ({end_raw})"
        ));
    }

    Ok(())
}

/// String members of a filter array (`projects`, `sessionIds`), or `None`
/// when the key is absent or selects nothing — an empty selection means
/// "no restriction", not "match nothing".
fn selected_strings<'a>(
    obj: &'a serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<HashSet<&'a str>> {
    let selected: HashSet<&str> = obj
        .get(key)?
        .as_array()?
        .iter()
        .filter_map(serde_json::Value::as_str)
        .collect();
    (!selected.is_empty()).then_some(selected)
}

/// The `dateRange` filter: absent (or not a two-item array, which validation
/// rejects), a parsed range, or a two-item range that does not parse — which
/// rejects every message.
#[derive(Clone, Copy)]
enum DateRangeFilter {
    Any,
    Within(DateTime<Utc>, DateTime<Utc>),
    RejectAll,
}

/// Search filters parsed once per request instead of once per message.
struct SearchFilters<'a> {
    message_type: Option<&'a str>,
    projects: Option<HashSet<&'a str>>,
    session_ids: Option<HashSet<&'a str>>,
    has_tool_calls: Option<bool>,
    has_errors: Option<bool>,
    has_file_changes: Option<bool>,
    date_range: DateRangeFilter,
}

impl<'a> SearchFilters<'a> {
    fn parse(filters: &'a serde_json::Value) -> Self {
        let Some(obj) = filters.as_object() else {
            return Self {
                message_type: None,
                projects: None,
                session_ids: None,
                has_tool_calls: None,
                has_errors: None,
                has_file_changes: None,
                date_range: DateRangeFilter::Any,
            };
        };
        let flag = |key: &str| obj.get(key).and_then(serde_json::Value::as_bool);

        Self {
            message_type: obj
                .get("messageType")
                .and_then(serde_json::Value::as_str)
                .filter(|message_type| *message_type != "all"),
            projects: selected_strings(obj, "projects"),
            session_ids: selected_strings(obj, "sessionIds"),
            has_tool_calls: flag("hasToolCalls"),
            has_errors: flag("hasErrors"),
            has_file_changes: flag("hasFileChanges"),
            date_range: obj
                .get("dateRange")
                .and_then(serde_json::Value::as_array)
                .filter(|range| range.len() == 2)
                .map_or(DateRangeFilter::Any, |range| {
                    match (parse_filter_date(&range[0]), parse_filter_date(&range[1])) {
                        (Some(start_at), Some(end_at)) => DateRangeFilter::Within(start_at, end_at),
                        _ => DateRangeFilter::RejectAll,
                    }
                }),
        }
    }

    fn matches(&self, message: &ClaudeMessage) -> bool {
        if let Some(message_type) = self.message_type {
            if message.message_type != message_type {
                return false;
            }
        }

        if let Some(projects) = &self.projects {
            let Some(project_name) = message.project_name.as_deref() else {
                return false;
            };
            if !projects.contains(project_name) {
                return false;
            }
        }

        if let Some(session_ids) = &self.session_ids {
            if !session_ids.contains(message.session_id.as_str()) {
                return false;
            }
        }

        if let Some(has_tool_calls_filter) = self.has_tool_calls {
            if has_tool_calls(message) != has_tool_calls_filter {
                return false;
            }
        }

        if let Some(has_errors_filter) = self.has_errors {
            if has_errors(message) != has_errors_filter {
                return false;
            }
        }

        if let Some(has_file_changes_filter) = self.has_file_changes {
            if has_file_changes(message) != has_file_changes_filter {
                return false;
            }
        }

        match self.date_range {
            DateRangeFilter::Any => {}
            DateRangeFilter::Within(start_at, end_at) => {
                let message_ts = DateTime::parse_from_rfc3339(&message.timestamp)
                    .ok()
                    .map(|dt| dt.with_timezone(&Utc));
                match message_ts {
                    Some(ts) if ts >= start_at && ts <= end_at => {}
                    _ => return false,
                }
            }
            DateRangeFilter::RejectAll => return false,
        }

        true
    }
}

pub fn apply_search_filters(
    messages: Vec<ClaudeMessage>,
    filters: &serde_json::Value,
) -> Vec<ClaudeMessage> {
    let filters = SearchFilters::parse(filters);
    messages
        .into_iter()
        .filter(|message| filters.matches(message))
        .collect()
}

/// Which part of `<claude_path>/projects` a search walks.
enum WalkScope {
    /// Every project directory (no `projects` filter).
    All,
    /// Only these project directories, in the same order the full walk would
    /// visit them.
    Projects(Vec<PathBuf>),
}

/// A `projects` filter entry usable as a single directory name: anything
/// that could escape `projects/` (separators, `.`, `..`) is ignored.
fn is_valid_project_dir_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\'])
}

/// Resolve the walk scope from the `projects` filter.
///
/// Every message's `project_name` is its file's parent directory name, so a
/// file outside `projects/<selected>/` could only pass the filter if it sat
/// in a nested directory that happens to share a selected project's name.
/// Selected names come from the top-level project list, so walking just
/// those directories yields the same results; nested files that are walked
/// (e.g. `<session>/subagents/*.jsonl`, project name "subagents") are still
/// dropped by the serve-time filter exactly as before.
///
/// Project directories are taken from `read_dir` order (the order `WalkDir`
/// itself uses), so the scoped file list is an in-order subsequence of the
/// full walk. Symlinked entries are skipped because the full walk does not
/// follow them either.
fn resolve_walk_scope(projects_path: &Path, filters: &serde_json::Value) -> WalkScope {
    let Some(selected) = filters
        .as_object()
        .and_then(|obj| selected_strings(obj, "projects"))
    else {
        return WalkScope::All;
    };
    let selected: HashSet<&str> = selected
        .into_iter()
        .filter(|name| is_valid_project_dir_name(name))
        .collect();

    let roots = fs::read_dir(projects_path)
        .map(|entries| {
            entries
                .filter_map(std::result::Result::ok)
                .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
                .filter(|entry| {
                    entry
                        .file_name()
                        .to_str()
                        .is_some_and(|name| selected.contains(name))
                })
                .map(|entry| entry.path())
                .collect()
        })
        .unwrap_or_default();
    WalkScope::Projects(roots)
}

/// Session files under each walk root, in `WalkDir` order.
fn collect_session_files(roots: &[PathBuf]) -> Vec<PathBuf> {
    roots
        .iter()
        .flat_map(|root| WalkDir::new(root).into_iter())
        .filter_map(std::result::Result::ok)
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
        .map(|e| e.path().to_path_buf())
        .collect()
}

/// Store this walk's per-file matches for `key`.
///
/// An unscoped walk saw every file, so it replaces the entry (dropping
/// deleted files). A scoped walk only saw its project directories: it
/// replaces just the entries under those roots, keeping every other
/// project's cached matches for the next search.
fn store_walk_matches(key: u64, scope: &WalkScope, walked: HashMap<PathBuf, FileMatches>) {
    let Ok(mut cache) = SEARCH_CACHE.lock() else {
        return;
    };
    let roots = match scope {
        WalkScope::Projects(roots) => roots,
        WalkScope::All => {
            cache.put(key, CachedQuerySearch { files: walked });
            return;
        }
    };
    let Some(entry) = cache.get_mut(&key) else {
        cache.put(key, CachedQuerySearch { files: walked });
        return;
    };

    let in_scope = |path: &Path| roots.iter().any(|root| path.starts_with(root));
    let kept_matches: usize = entry
        .files
        .iter()
        .filter(|(path, _)| !in_scope(path))
        .map(|(_, file)| file.matches.len())
        .sum();
    let walked_matches: usize = walked.values().map(|file| file.matches.len()).sum();
    if kept_matches + walked_matches > MAX_CACHED_MATCHES_PER_QUERY {
        // Keep the bound; stale entries are harmless (signature-checked).
        return;
    }
    entry.files.retain(|path, _| !in_scope(path));
    entry.files.extend(walked);
}

/// Search messages across a Claude storage directory.
///
/// Walks and scans every session file synchronously, so it runs on the blocking
/// pool. Search is the one command a user is most likely to fire repeatedly,
/// and holding the runtime meant each keystroke-triggered search froze
/// everything else until it finished.
#[tauri::command]
pub async fn search_messages(
    claude_path: String,
    query: String,
    filters: serde_json::Value,
    limit: Option<usize>,
) -> Result<Vec<ClaudeMessage>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        search_messages_blocking(claude_path, query, filters, limit)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// The search itself. Separate from the command so the body stays at one indent
/// level and the wrapper above is the only thing that had to change.
fn search_messages_blocking(
    claude_path: String,
    query: String,
    filters: serde_json::Value,
    limit: Option<usize>,
) -> Result<Vec<ClaudeMessage>, String> {
    #[cfg(debug_assertions)]
    let start_time = std::time::Instant::now();

    let max_results = limit.unwrap_or(DEFAULT_SEARCH_LIMIT);
    validate_search_filters(&filters)?;

    let projects_path = PathBuf::from(&claude_path).join("projects");
    if !projects_path.exists() {
        return Ok(vec![]);
    }

    let scope = resolve_walk_scope(&projects_path, &filters);
    let file_paths = match &scope {
        WalkScope::All => collect_session_files(std::slice::from_ref(&projects_path)),
        WalkScope::Projects(roots) => collect_session_files(roots),
    };
    let signatures: Vec<Option<FileSignature>> = file_paths
        .iter()
        .map(|path| FileSignature::of(path))
        .collect();

    // Per-file resolution: reuse cached matches when the file's (size, mtime)
    // signature is unchanged; anything else (changed, new, or unstat-able)
    // is re-scanned. Signatures are captured before taking the lock so no
    // filesystem I/O happens while other searches wait on it.
    let key = cache_key(&claude_path, &query);
    let mut per_file: Vec<Option<Arc<Vec<ClaudeMessage>>>> = {
        let mut cache = SEARCH_CACHE.lock().ok();
        let cached_files = cache.as_mut().and_then(|cache| cache.get(&key));
        file_paths
            .iter()
            .zip(&signatures)
            .map(|(path, signature)| {
                let entry = cached_files?.files.get(path)?;
                (Some(entry.signature) == *signature).then(|| Arc::clone(&entry.matches))
            })
            .collect()
    };

    let scan_indices: Vec<usize> = per_file
        .iter()
        .enumerate()
        .filter(|(_, cached)| cached.is_none())
        .map(|(idx, _)| idx)
        .collect();

    #[cfg(debug_assertions)]
    eprintln!(
        "🔍 search_messages: {} files ({} cached, {} scanned)",
        file_paths.len(),
        file_paths.len() - scan_indices.len(),
        scan_indices.len()
    );

    let matcher = build_matcher(&query);
    let prefilter_raw_lines = raw_prefilter_is_sound(&query);

    let scanned: Vec<(usize, Arc<Vec<ClaudeMessage>>)> = scan_indices
        .into_par_iter()
        .map(|idx| {
            #[cfg(test)]
            note_scan(&file_paths[idx]);
            let matches = search_in_file(&file_paths[idx], &matcher, prefilter_raw_lines);
            (idx, Arc::new(matches))
        })
        .collect();
    for (idx, matches) in scanned {
        per_file[idx] = Some(matches);
    }

    // Filter while flattening in walk order, borrowing from the shared match
    // sets: only the final page is cloned out. Ties on timestamp break by
    // walk order, so the selection is deterministic and a scoped walk (an
    // in-order subsequence of the full walk) selects the same messages.
    let search_filters = SearchFilters::parse(&filters);
    let mut selected: Vec<(usize, &ClaudeMessage)> = per_file
        .iter()
        .flatten()
        .flat_map(|matches| matches.iter())
        .filter(|message| search_filters.matches(message))
        .enumerate()
        .collect();
    let newest_first = |a: &(usize, &ClaudeMessage), b: &(usize, &ClaudeMessage)| {
        b.1.timestamp.cmp(&a.1.timestamp).then(a.0.cmp(&b.0))
    };
    if selected.len() > max_results {
        selected.select_nth_unstable_by(max_results, newest_first);
        selected.truncate(max_results);
    }
    selected.sort_unstable_by(newest_first);
    let results: Vec<ClaudeMessage> = selected
        .into_iter()
        .map(|(_, message)| message.clone())
        .collect();

    // Store the per-file map; files whose signature could not be captured are
    // computed without caching (re-scanned next call).
    let total_matches: usize = per_file.iter().flatten().map(|matches| matches.len()).sum();
    if total_matches <= MAX_CACHED_MATCHES_PER_QUERY {
        let walked: HashMap<PathBuf, FileMatches> = file_paths
            .into_iter()
            .zip(signatures)
            .zip(per_file)
            .filter_map(|((path, signature), matches)| {
                Some((
                    path,
                    FileMatches {
                        signature: signature?,
                        matches: matches?,
                    },
                ))
            })
            .collect();
        store_walk_matches(key, &scope, walked);
    }

    #[cfg(debug_assertions)]
    {
        let elapsed = start_time.elapsed();
        eprintln!(
            "📊 search_messages performance: {} results (limit: {}), {}ms elapsed",
            results.len(),
            max_results,
            elapsed.as_millis()
        );
    }

    Ok(results)
}

/// Number of `search_in_file` scans recorded for `path`. Test-only cache-hit
/// observability, mirroring `stats::cache::test_build_count`.
#[cfg(test)]
fn note_scan(path: &std::path::Path) {
    if let Ok(mut counts) = scan_counts().lock() {
        *counts.entry(path.to_path_buf()).or_insert(0) += 1;
    }
}

#[cfg(test)]
fn test_scan_count(path: &std::path::Path) -> u64 {
    scan_counts()
        .lock()
        .map(|counts| counts.get(path).copied().unwrap_or(0))
        .unwrap_or(0)
}

#[cfg(test)]
fn scan_counts() -> &'static Mutex<std::collections::HashMap<PathBuf, u64>> {
    static SCAN_COUNTS: std::sync::OnceLock<Mutex<std::collections::HashMap<PathBuf, u64>>> =
        std::sync::OnceLock::new();
    SCAN_COUNTS.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

/// Drop every cached entry so the next search is a cold scan (test-only).
#[cfg(test)]
fn clear_search_cache_for_test() {
    if let Ok(mut cache) = SEARCH_CACHE.lock() {
        cache.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::TempDir;

    fn create_sample_user_message(uuid: &str, session_id: &str, content: &str) -> String {
        format!(
            r#"{{"uuid":"{uuid}","sessionId":"{session_id}","timestamp":"2025-06-26T10:00:00Z","type":"user","message":{{"role":"user","content":"{content}"}}}}"#
        )
    }

    fn create_sample_assistant_message(uuid: &str, session_id: &str, content: &str) -> String {
        format!(
            r#"{{"uuid":"{uuid}","sessionId":"{session_id}","timestamp":"2025-06-26T10:01:00Z","type":"assistant","message":{{"role":"assistant","content":[{{"type":"text","text":"{content}"}}],"id":"msg_123","model":"claude-opus-4-20250514","usage":{{"input_tokens":100,"output_tokens":50}}}}}}"#
        )
    }

    /// A user/tool-result message whose `message.content` text is `visible`, while
    /// `result_stdout` lives only in the top-level `toolUseResult` field (mirrors
    /// how Read/Bash results are stored on disk).
    fn create_tool_result_message(
        uuid: &str,
        session_id: &str,
        visible: &str,
        result_stdout: &str,
    ) -> String {
        format!(
            r#"{{"uuid":"{uuid}","sessionId":"{session_id}","timestamp":"2025-06-26T10:02:00Z","type":"user","message":{{"role":"user","content":[{{"type":"tool_result","tool_use_id":"toolu_1","content":"{visible}"}}]}},"toolUseResult":{{"stdout":"{result_stdout}","stderr":"","interrupted":false}}}}"#
        )
    }

    #[tokio::test]
    async fn test_search_messages_basic() {
        let temp_dir = TempDir::new().unwrap();
        let projects_dir = temp_dir.path().join("projects");
        let project_dir = projects_dir.join("test-project");
        std::fs::create_dir_all(&project_dir).unwrap();

        let content = format!(
            "{}\n{}\n",
            create_sample_user_message("uuid-1", "session-1", "Hello Rust programming"),
            create_sample_assistant_message("uuid-2", "session-1", "Rust is great!")
        );

        // Create file directly in project dir
        let file_path = project_dir.join("test.jsonl");
        let mut file = File::create(&file_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();

        let result = search_messages(
            temp_dir.path().to_string_lossy().to_string(),
            "Rust".to_string(),
            serde_json::json!({}),
            None,
        )
        .await;

        assert!(result.is_ok());
        let messages = result.unwrap();
        assert_eq!(messages.len(), 2); // Both messages contain "Rust"
    }

    #[tokio::test]
    async fn test_search_messages_matches_tool_use_result() {
        // Regression for #394: a query that appears ONLY in toolUseResult
        // (e.g. command output / file contents) must be found by global search,
        // mirroring the in-session FlexSearch index.
        let temp_dir = TempDir::new().unwrap();
        let project_dir = temp_dir.path().join("projects").join("test-project");
        std::fs::create_dir_all(&project_dir).unwrap();

        // The unique token only appears in toolUseResult.stdout, never in content.
        let content = format!(
            "{}\n",
            create_tool_result_message(
                "uuid-1",
                "session-1",
                "command output below",
                "ZmagicMarker99"
            )
        );
        let file_path = project_dir.join("test.jsonl");
        let mut file = File::create(&file_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();

        let result = search_messages(
            temp_dir.path().to_string_lossy().to_string(),
            "ZmagicMarker99".to_string(),
            serde_json::json!({}),
            None,
        )
        .await
        .unwrap();

        assert_eq!(
            result.len(),
            1,
            "global search must match text found only in toolUseResult (#394)"
        );
    }

    #[tokio::test]
    async fn test_search_messages_case_insensitive() {
        let temp_dir = TempDir::new().unwrap();
        let projects_dir = temp_dir.path().join("projects");
        let project_dir = projects_dir.join("test-project");
        std::fs::create_dir_all(&project_dir).unwrap();

        let content = format!(
            "{}\n",
            create_sample_user_message("uuid-1", "session-1", "HELLO World")
        );

        let file_path = project_dir.join("test.jsonl");
        let mut file = File::create(&file_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();

        let result = search_messages(
            temp_dir.path().to_string_lossy().to_string(),
            "hello".to_string(), // lowercase
            serde_json::json!({}),
            None,
        )
        .await;

        assert!(result.is_ok());
        let messages = result.unwrap();
        assert_eq!(messages.len(), 1);
    }

    #[tokio::test]
    async fn test_search_messages_no_results() {
        let temp_dir = TempDir::new().unwrap();
        let projects_dir = temp_dir.path().join("projects");
        let project_dir = projects_dir.join("test-project");
        std::fs::create_dir_all(&project_dir).unwrap();

        let content = format!(
            "{}\n",
            create_sample_user_message("uuid-1", "session-1", "Hello World")
        );

        let file_path = project_dir.join("test.jsonl");
        let mut file = File::create(&file_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();

        let result = search_messages(
            temp_dir.path().to_string_lossy().to_string(),
            "nonexistent".to_string(),
            serde_json::json!({}),
            None,
        )
        .await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_search_messages_empty_projects_dir() {
        let temp_dir = TempDir::new().unwrap();
        // Don't create projects directory

        let result = search_messages(
            temp_dir.path().to_string_lossy().to_string(),
            "test".to_string(),
            serde_json::json!({}),
            None,
        )
        .await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_search_messages_invalid_date_filter_returns_error() {
        let temp_dir = TempDir::new().unwrap();

        let result = search_messages(
            temp_dir.path().to_string_lossy().to_string(),
            "test".to_string(),
            serde_json::json!({
                "dateRange": ["invalid-date", "2026-02-20T00:00:00Z"]
            }),
            None,
        )
        .await;

        assert!(result.is_err());
        assert!(result
            .err()
            .unwrap_or_default()
            .contains("Invalid dateRange start"));
    }

    /// Two-file fixture: both files match `query_marker`, each with one
    /// message. Returns (`temp_dir`, `file_a`, `file_b`).
    fn two_file_fixture(query_marker: &str) -> (TempDir, PathBuf, PathBuf) {
        let temp_dir = TempDir::new().unwrap();
        let project_dir = temp_dir.path().join("projects").join("test-project");
        std::fs::create_dir_all(&project_dir).unwrap();

        let file_a = project_dir.join("session-a.jsonl");
        let mut writer = File::create(&file_a).unwrap();
        writeln!(
            writer,
            "{}",
            create_sample_user_message("uuid-a1", "session-a", &format!("{query_marker} in a"))
        )
        .unwrap();

        let file_b = project_dir.join("session-b.jsonl");
        let mut writer = File::create(&file_b).unwrap();
        writeln!(
            writer,
            "{}",
            create_sample_user_message("uuid-b1", "session-b", &format!("{query_marker} in b"))
        )
        .unwrap();

        (temp_dir, file_a, file_b)
    }

    async fn run_search(temp_dir: &TempDir, query: &str) -> Vec<ClaudeMessage> {
        search_messages(
            temp_dir.path().to_string_lossy().to_string(),
            query.to_string(),
            serde_json::json!({}),
            None,
        )
        .await
        .expect("search must succeed")
    }

    fn uuids(messages: &[ClaudeMessage]) -> Vec<&str> {
        let mut out: Vec<&str> = messages.iter().map(|m| m.uuid.as_str()).collect();
        out.sort_unstable();
        out
    }

    #[tokio::test]
    /// Core invalidation behavior: an unchanged file is served from cache
    /// (no re-scan), an appended file is re-scanned, and the merged result
    /// after the append equals a cold scan.
    async fn test_search_cache_rescans_only_appended_file() {
        let (temp_dir, file_a, file_b) = two_file_fixture("cacheProbe42");

        let first = run_search(&temp_dir, "cacheProbe42").await;
        assert_eq!(uuids(&first), ["uuid-a1", "uuid-b1"]);
        assert_eq!(test_scan_count(&file_a), 1);
        assert_eq!(test_scan_count(&file_b), 1);

        // Unchanged corpus: served entirely from cache.
        let second = run_search(&temp_dir, "cacheProbe42").await;
        assert_eq!(uuids(&second), ["uuid-a1", "uuid-b1"]);
        assert_eq!(
            test_scan_count(&file_a),
            1,
            "unchanged file a must not re-scan"
        );
        assert_eq!(
            test_scan_count(&file_b),
            1,
            "unchanged file b must not re-scan"
        );

        // Append a matching message to file a only.
        let mut appender = std::fs::OpenOptions::new()
            .append(true)
            .open(&file_a)
            .unwrap();
        writeln!(
            appender,
            "{}",
            create_sample_user_message("uuid-a2", "session-a", "cacheProbe42 appended")
        )
        .unwrap();
        drop(appender);

        let third = run_search(&temp_dir, "cacheProbe42").await;
        assert_eq!(
            uuids(&third),
            ["uuid-a1", "uuid-a2", "uuid-b1"],
            "results must reflect a's new content and keep b's cached contribution"
        );
        assert_eq!(test_scan_count(&file_a), 2, "appended file a must re-scan");
        assert_eq!(
            test_scan_count(&file_b),
            1,
            "a change to file a must not evict file b's cached matches"
        );

        // Warm result must equal a cold scan of the same corpus.
        clear_search_cache_for_test();
        let cold = run_search(&temp_dir, "cacheProbe42").await;
        assert_eq!(
            serde_json::to_value(&third).unwrap(),
            serde_json::to_value(&cold).unwrap(),
            "warm search must equal a cold scan"
        );
    }

    #[tokio::test]
    /// A change to an unrelated file evicts nothing: only the changed file
    /// is re-scanned, even when it never matched the query.
    async fn test_search_unrelated_file_change_does_not_evict() {
        let (temp_dir, file_a, file_b) = two_file_fixture("evictProbe7");

        // Third file that does NOT match the query.
        let file_c = file_a.parent().unwrap().join("session-c.jsonl");
        let mut writer = File::create(&file_c).unwrap();
        writeln!(
            writer,
            "{}",
            create_sample_user_message("uuid-c1", "session-c", "nothing to see")
        )
        .unwrap();
        drop(writer);

        let first = run_search(&temp_dir, "evictProbe7").await;
        assert_eq!(uuids(&first), ["uuid-a1", "uuid-b1"]);
        assert_eq!(test_scan_count(&file_a), 1);
        assert_eq!(test_scan_count(&file_b), 1);
        assert_eq!(test_scan_count(&file_c), 1);

        // Append to the unrelated file only.
        let mut appender = std::fs::OpenOptions::new()
            .append(true)
            .open(&file_c)
            .unwrap();
        writeln!(
            appender,
            "{}",
            create_sample_user_message("uuid-c2", "session-c", "still unrelated")
        )
        .unwrap();
        drop(appender);

        let second = run_search(&temp_dir, "evictProbe7").await;
        assert_eq!(uuids(&second), ["uuid-a1", "uuid-b1"]);
        assert_eq!(
            test_scan_count(&file_a),
            1,
            "unrelated change must not re-scan file a"
        );
        assert_eq!(
            test_scan_count(&file_b),
            1,
            "unrelated change must not re-scan file b"
        );
        assert_eq!(test_scan_count(&file_c), 2, "changed file c must re-scan");
    }

    #[tokio::test]
    /// A temp+rename rewrite can keep the same (size, mtime) signature —
    /// explicit eviction must force a re-scan of that file only.
    async fn test_evict_file_forces_rescan_without_signature_change() {
        let (temp_dir, file_a, file_b) = two_file_fixture("evictExplicit3");

        let first = run_search(&temp_dir, "evictExplicit3").await;
        assert_eq!(uuids(&first), ["uuid-a1", "uuid-b1"]);
        assert_eq!(test_scan_count(&file_a), 1);
        assert_eq!(test_scan_count(&file_b), 1);

        // No file change at all — eviction alone must invalidate file a.
        evict_file_from_search_cache(&file_a);

        let second = run_search(&temp_dir, "evictExplicit3").await;
        assert_eq!(uuids(&second), ["uuid-a1", "uuid-b1"]);
        assert_eq!(test_scan_count(&file_a), 2, "evicted file must re-scan");
        assert_eq!(test_scan_count(&file_b), 1, "other files must stay cached");
    }

    #[tokio::test]
    /// Filters and limit are applied at serve time over cached raw matches:
    /// changing them must not trigger any re-scan.
    async fn test_search_filter_and_limit_changes_reuse_cached_matches() {
        let (temp_dir, file_a, file_b) = two_file_fixture("filterProbe9");

        let unfiltered = run_search(&temp_dir, "filterProbe9").await;
        assert_eq!(uuids(&unfiltered), ["uuid-a1", "uuid-b1"]);
        assert_eq!(test_scan_count(&file_a), 1);
        assert_eq!(test_scan_count(&file_b), 1);

        // Same query with a filter and a limit: served from cached matches.
        let limited = search_messages(
            temp_dir.path().to_string_lossy().to_string(),
            "filterProbe9".to_string(),
            serde_json::json!({ "messageType": "user" }),
            Some(1),
        )
        .await
        .expect("filtered search must succeed");
        assert_eq!(limited.len(), 1);
        assert_eq!(
            test_scan_count(&file_a),
            1,
            "filter/limit change must not re-scan file a"
        );
        assert_eq!(
            test_scan_count(&file_b),
            1,
            "filter/limit change must not re-scan file b"
        );

        // Cold-scan equivalence for the filtered call.
        clear_search_cache_for_test();
        let cold = search_messages(
            temp_dir.path().to_string_lossy().to_string(),
            "filterProbe9".to_string(),
            serde_json::json!({ "messageType": "user" }),
            Some(1),
        )
        .await
        .expect("cold filtered search must succeed");
        assert_eq!(
            serde_json::to_value(&limited).unwrap(),
            serde_json::to_value(&cold).unwrap()
        );
    }

    #[tokio::test]
    /// Deleted files drop out of the merged result and new files are picked
    /// up, while untouched files stay cached.
    async fn test_search_detects_deleted_and_new_files() {
        let (temp_dir, file_a, file_b) = two_file_fixture("lifecycleProbe3");

        let first = run_search(&temp_dir, "lifecycleProbe3").await;
        assert_eq!(uuids(&first), ["uuid-a1", "uuid-b1"]);

        std::fs::remove_file(&file_b).unwrap();
        let file_c = file_a.parent().unwrap().join("session-c.jsonl");
        let mut writer = File::create(&file_c).unwrap();
        writeln!(
            writer,
            "{}",
            create_sample_user_message("uuid-c1", "session-c", "lifecycleProbe3 in c")
        )
        .unwrap();
        drop(writer);

        let second = run_search(&temp_dir, "lifecycleProbe3").await;
        assert_eq!(
            uuids(&second),
            ["uuid-a1", "uuid-c1"],
            "deleted file b must drop out; new file c must be picked up"
        );
        assert_eq!(test_scan_count(&file_a), 1, "untouched file a stays cached");
        assert_eq!(test_scan_count(&file_c), 1);
    }

    // ---- Raw-line prefilter equivalence ----

    /// Scan `lines` (one JSONL file) with and without the raw-line
    /// prefilter; the prefilter is only enabled when sound for `query`,
    /// exactly as `search_messages_blocking` does.
    fn scan_with_and_without_prefilter(
        lines: &[String],
        query: &str,
    ) -> (Vec<ClaudeMessage>, Vec<ClaudeMessage>) {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("session.jsonl");
        std::fs::write(&file_path, lines.join("\n")).unwrap();
        let matcher = build_matcher(query);
        let prefiltered = search_in_file(&file_path, &matcher, raw_prefilter_is_sound(query));
        let unfiltered = search_in_file(&file_path, &matcher, false);
        (prefiltered, unfiltered)
    }

    /// A user line whose `message.content` is the already-JSON-encoded
    /// string body `encoded` (written verbatim between the quotes).
    fn raw_user_line(uuid: &str, encoded: &str) -> String {
        format!(
            r#"{{"uuid":"{uuid}","sessionId":"s","timestamp":"2025-06-26T10:00:00Z","type":"user","message":{{"role":"user","content":"{encoded}"}}}}"#
        )
    }

    fn assert_prefilter_equivalent(lines: &[String], query: &str, expected_uuids: &[&str]) {
        let (prefiltered, unfiltered) = scan_with_and_without_prefilter(lines, query);
        assert_eq!(
            serde_json::to_value(&prefiltered).unwrap(),
            serde_json::to_value(&unfiltered).unwrap(),
            "prefiltered scan must equal the unfiltered scan for {query:?}"
        );
        assert_eq!(uuids(&prefiltered), expected_uuids, "query {query:?}");
    }

    #[test]
    fn test_raw_prefilter_disabled_for_characters_json_may_escape() {
        assert!(raw_prefilter_is_sound("plain text 테스트 🦀"));
        for query in [
            "say \"hi\"",
            r"C:\Users",
            "a/b",
            "line1\nline2",
            "tab\there",
        ] {
            assert!(!raw_prefilter_is_sound(query), "{query:?}");
        }
    }

    #[test]
    fn test_raw_prefilter_matches_escaped_quotes_backslashes_slashes_and_newlines() {
        let lines = vec![
            raw_user_line("quote", r#"she said \"hi\" twice"#),
            raw_user_line("backslash", r"path C:\\Users\\dev"),
            raw_user_line("slash-escaped", r"open a\/b now"),
            raw_user_line("slash-literal", "open a/b now"),
            raw_user_line("newline", r"line1\nline2"),
            raw_user_line("unrelated", "nothing here"),
        ];
        assert_prefilter_equivalent(&lines, "said \"hi\"", &["quote"]);
        assert_prefilter_equivalent(&lines, r"C:\Users", &["backslash"]);
        assert_prefilter_equivalent(&lines, "a/b", &["slash-escaped", "slash-literal"]);
        assert_prefilter_equivalent(&lines, "line1\nline2", &["newline"]);
    }

    #[test]
    fn test_raw_prefilter_matches_non_ascii_stored_literally_and_escaped() {
        let lines = vec![
            raw_user_line("korean-literal", "테스트 통과"),
            raw_user_line("korean-escaped", r"\uD14C\uC2A4\uD2B8 \uD1B5\uACFC"),
            raw_user_line("emoji-literal", "rust 🦀 crab"),
            raw_user_line("emoji-escaped", r"rust \ud83e\udd80 crab"),
            raw_user_line("ascii-escaped", r"\u0041BC def"),
            raw_user_line("unrelated", "nothing here"),
        ];
        assert_prefilter_equivalent(&lines, "테스트", &["korean-escaped", "korean-literal"]);
        assert_prefilter_equivalent(&lines, "🦀", &["emoji-escaped", "emoji-literal"]);
        assert_prefilter_equivalent(&lines, "abc", &["ascii-escaped"]);
    }

    #[test]
    fn test_raw_prefilter_is_case_insensitive_and_skips_control_escapes() {
        let lines = vec![
            raw_user_line("upper", "HELLO World"),
            raw_user_line("ansi", r"\u001b[32mok\u001B[0m 128 tests passed"),
            raw_user_line("ansi-other", r"\u001b[33mwarning\u001b[0m"),
        ];
        assert_prefilter_equivalent(&lines, "hello world", &["upper"]);
        assert_prefilter_equivalent(&lines, "Tests Passed", &["ansi"]);

        // Control-only `\u` escapes cannot form a prefilter-eligible query,
        // so such lines are still skipped without parsing.
        assert!(unicode_escapes_only_produce_controls(
            br"a \u001b[0m \u001F b"
        ));
        assert!(!unicode_escapes_only_produce_controls(br"\u0041"));
        assert!(!unicode_escapes_only_produce_controls(br"\ud83e\udd80"));
        assert!(!unicode_escapes_only_produce_controls(br"truncated \u00"));
    }

    #[test]
    fn test_raw_prefilter_searches_tool_payloads_like_unfiltered_scan() {
        let lines = vec![
            create_tool_result_message("tool", "s", "visible", r"Zmarker\u0031 out"),
            create_sample_assistant_message("assistant", "s", "has zmarker1 too"),
            r#"{"uuid":"summary","type":"summary","summary":"zmarker1 in summary"}"#.to_string(),
            r#"{"uuid":"key-only","type":"user","message":{"role":"user","content":"x"},"toolUse":{"zmarker1":1}}"#.to_string(),
        ];
        assert_prefilter_equivalent(&lines, "zmarker1", &["assistant", "tool"]);
    }

    /// Characters chosen to exercise every escape class: plain ASCII (both
    /// cases), escapable punctuation, control characters, multi-byte BMP
    /// and astral (surrogate pair) characters.
    const PROP_ALPHABET: &[char] = &[
        'a', 'b', 'A', 'B', ' ', '"', '\\', '/', '\n', '\t', '\u{1b}', '가', 'é', '🦀',
    ];

    /// JSON-encode `chars` choosing, per character, between a literal byte
    /// sequence (when legal), a short escape and a `\uXXXX` escape.
    fn encode_json_string(chars: &[(usize, u8)]) -> String {
        let mut out = String::new();
        for &(index, style) in chars {
            let c = PROP_ALPHABET[index % PROP_ALPHABET.len()];
            let short = match c {
                '"' => Some("\\\""),
                '\\' => Some("\\\\"),
                '/' => Some("\\/"),
                '\n' => Some("\\n"),
                '\t' => Some("\\t"),
                _ => None,
            };
            let literal_ok = c != '"' && c != '\\' && c >= ' ';
            match (style % 3, short) {
                (0, _) if literal_ok => out.push(c),
                (0 | 1, Some(short)) => out.push_str(short),
                _ => {
                    let mut units = [0u16; 2];
                    for unit in c.encode_utf16(&mut units) {
                        if style % 2 == 0 {
                            out.push_str(&format!("\\u{unit:04x}"));
                        } else {
                            out.push_str(&format!("\\u{unit:04X}"));
                        }
                    }
                }
            }
        }
        out
    }

    proptest::proptest! {
        #![proptest_config(proptest::prelude::ProptestConfig::with_cases(256))]

        #[test]
        fn prop_raw_prefilter_never_changes_scan_results(
            entries in proptest::collection::vec(
                (
                    0usize..3,
                    proptest::collection::vec((0usize..64, 0u8..6), 0..12),
                    proptest::collection::vec((0usize..64, 0u8..6), 0..12),
                ),
                1..8,
            ),
            query in proptest::collection::vec(0usize..64, 1..4),
        ) {
            let lines: Vec<String> = entries
                .iter()
                .enumerate()
                .map(|(i, (kind, content, stdout))| {
                    let message_type = ["user", "assistant", "summary"][*kind];
                    format!(
                        r#"{{"uuid":"u{i}","sessionId":"s","timestamp":"2025-06-26T10:00:00Z","type":"{message_type}","message":{{"role":"{message_type}","content":[{{"type":"text","text":"{}"}}]}},"toolUseResult":{{"stdout":"{}"}}}}"#,
                        encode_json_string(content),
                        encode_json_string(stdout),
                    )
                })
                .collect();
            let query: String = query
                .iter()
                .map(|index| PROP_ALPHABET[index % PROP_ALPHABET.len()])
                .collect();

            let (prefiltered, unfiltered) = scan_with_and_without_prefilter(&lines, &query);
            proptest::prop_assert_eq!(
                serde_json::to_value(&prefiltered).unwrap(),
                serde_json::to_value(&unfiltered).unwrap()
            );
        }
    }

    // ---- Project-scoped walk ----

    fn write_session(dir: &Path, file_name: &str, lines: &[String]) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let path = dir.join(file_name);
        std::fs::write(&path, lines.join("\n") + "\n").unwrap();
        path
    }

    fn user_line_at(uuid: &str, session_id: &str, minute: u32, content: &str) -> String {
        format!(
            r#"{{"uuid":"{uuid}","sessionId":"{session_id}","timestamp":"2025-06-26T10:{minute:02}:00Z","type":"user","message":{{"role":"user","content":"{content}"}}}}"#
        )
    }

    /// Three projects (alpha, beta, gamma), alpha with a nested subagent
    /// file, every message matching `marker` at a distinct timestamp.
    /// Returns the temp dir and every session file by name.
    fn three_project_fixture(marker: &str) -> (TempDir, HashMap<&'static str, PathBuf>) {
        let temp_dir = TempDir::new().unwrap();
        let projects = temp_dir.path().join("projects");
        let line = |uuid: &str, session: &str, minute: u32| {
            user_line_at(uuid, session, minute, &format!("{marker} {uuid}"))
        };
        let mut files = HashMap::new();
        files.insert(
            "alpha-1",
            write_session(
                &projects.join("alpha"),
                "a1.jsonl",
                &[line("a1-1", "a1", 1), line("a1-2", "a1", 2)],
            ),
        );
        files.insert(
            "alpha-2",
            write_session(
                &projects.join("alpha"),
                "a2.jsonl",
                &[line("a2-1", "a2", 3)],
            ),
        );
        files.insert(
            "alpha-subagent",
            write_session(
                &projects.join("alpha").join("a1").join("subagents"),
                "agent-x.jsonl",
                &[line("sub-1", "a1", 4)],
            ),
        );
        files.insert(
            "beta-1",
            write_session(
                &projects.join("beta"),
                "b1.jsonl",
                &[line("b1-1", "b1", 5), line("b1-2", "b1", 6)],
            ),
        );
        files.insert(
            "gamma-1",
            write_session(
                &projects.join("gamma"),
                "g1.jsonl",
                &[line("g1-1", "g1", 7)],
            ),
        );
        (temp_dir, files)
    }

    async fn run_filtered(
        temp_dir: &TempDir,
        query: &str,
        filters: serde_json::Value,
        limit: Option<usize>,
    ) -> Vec<ClaudeMessage> {
        search_messages(
            temp_dir.path().to_string_lossy().to_string(),
            query.to_string(),
            filters,
            limit,
        )
        .await
        .expect("search must succeed")
    }

    /// Reference for a `projects` filter: the unscoped (full-walk) result,
    /// filtered and limited afterwards — the pre-scoping behavior.
    async fn unscoped_reference(
        temp_dir: &TempDir,
        query: &str,
        projects: &[&str],
        limit: usize,
    ) -> serde_json::Value {
        let all = run_filtered(temp_dir, query, serde_json::json!({}), Some(usize::MAX)).await;
        let mut kept: Vec<ClaudeMessage> = all
            .into_iter()
            .filter(|m| {
                m.project_name
                    .as_deref()
                    .is_some_and(|name| projects.contains(&name))
            })
            .collect();
        kept.truncate(limit);
        serde_json::to_value(kept).unwrap()
    }

    #[tokio::test]
    async fn test_scoped_walk_matches_unscoped_filtering() {
        let (temp_dir, _files) = three_project_fixture("scopeProbe1");

        for (projects, limit) in [
            (vec!["alpha"], 100),
            (vec!["alpha", "gamma"], 100),
            (vec!["beta", "alpha"], 2),
        ] {
            let scoped = run_filtered(
                &temp_dir,
                "scopeProbe1",
                serde_json::json!({ "projects": projects }),
                Some(limit),
            )
            .await;
            let reference = unscoped_reference(&temp_dir, "scopeProbe1", &projects, limit).await;
            assert_eq!(
                serde_json::to_value(&scoped).unwrap(),
                reference,
                "scoped walk must equal unscoped filtering for {projects:?} (limit {limit})"
            );
        }

        // Subagent files are walked under their project but keep project name
        // "subagents", so the project filter still drops them.
        let alpha = run_filtered(
            &temp_dir,
            "scopeProbe1",
            serde_json::json!({ "projects": ["alpha"] }),
            None,
        )
        .await;
        assert_eq!(uuids(&alpha), ["a1-1", "a1-2", "a2-1"]);
    }

    #[tokio::test]
    async fn test_scoped_walk_ignores_invalid_duplicate_and_missing_names() {
        let (temp_dir, _files) = three_project_fixture("scopeProbe2");

        let messy = run_filtered(
            &temp_dir,
            "scopeProbe2",
            serde_json::json!({ "projects": ["alpha", "alpha", "", ".", "..", "../beta", "beta/x", "missing"] }),
            None,
        )
        .await;
        assert_eq!(uuids(&messy), ["a1-1", "a1-2", "a2-1"]);

        let only_invalid = run_filtered(
            &temp_dir,
            "scopeProbe2",
            serde_json::json!({ "projects": ["../beta", "missing"] }),
            None,
        )
        .await;
        assert!(
            only_invalid.is_empty(),
            "invalid names must never escape projects/"
        );

        // An empty selection is no restriction at all.
        let empty = run_filtered(
            &temp_dir,
            "scopeProbe2",
            serde_json::json!({ "projects": [] }),
            None,
        )
        .await;
        assert_eq!(empty.len(), 7);
    }

    #[tokio::test]
    async fn test_scoped_search_keeps_other_projects_cached() {
        let (temp_dir, files) = three_project_fixture("scopeCache3");
        let scoped = |name: &str| serde_json::json!({ "projects": [name] });

        // Scoped searches populate the per-query entry project by project.
        run_filtered(&temp_dir, "scopeCache3", scoped("alpha"), None).await;
        run_filtered(&temp_dir, "scopeCache3", scoped("beta"), None).await;
        assert_eq!(test_scan_count(&files["alpha-1"]), 1);
        assert_eq!(test_scan_count(&files["beta-1"]), 1);
        assert_eq!(
            test_scan_count(&files["gamma-1"]),
            0,
            "gamma is never walked"
        );

        // A scoped search must not evict the other project's cached matches.
        run_filtered(&temp_dir, "scopeCache3", scoped("alpha"), None).await;
        assert_eq!(test_scan_count(&files["alpha-1"]), 1, "alpha stays cached");

        // The unscoped search reuses both projects and scans only gamma.
        let all = run_search(&temp_dir, "scopeCache3").await;
        assert_eq!(all.len(), 7);
        for name in ["alpha-1", "alpha-2", "alpha-subagent", "beta-1", "gamma-1"] {
            assert_eq!(test_scan_count(&files[name]), 1, "{name} scanned once");
        }

        // A scoped search after an unscoped one is served from cache too.
        run_filtered(&temp_dir, "scopeCache3", scoped("beta"), None).await;
        assert_eq!(test_scan_count(&files["beta-1"]), 1);
    }

    #[tokio::test]
    async fn test_scoped_search_prunes_deleted_files_in_scope_only() {
        let (temp_dir, files) = three_project_fixture("scopePrune4");
        run_search(&temp_dir, "scopePrune4").await;

        std::fs::remove_file(&files["alpha-2"]).unwrap();
        let alpha = run_filtered(
            &temp_dir,
            "scopePrune4",
            serde_json::json!({ "projects": ["alpha"] }),
            None,
        )
        .await;
        assert_eq!(uuids(&alpha), ["a1-1", "a1-2"], "deleted file drops out");

        let all = run_search(&temp_dir, "scopePrune4").await;
        assert_eq!(
            uuids(&all),
            ["a1-1", "a1-2", "b1-1", "b1-2", "g1-1", "sub-1"]
        );
        assert_eq!(test_scan_count(&files["beta-1"]), 1, "beta stays cached");

        // Warm result equals a cold scan.
        clear_search_cache_for_test();
        let cold = run_search(&temp_dir, "scopePrune4").await;
        assert_eq!(
            serde_json::to_value(&all).unwrap(),
            serde_json::to_value(&cold).unwrap()
        );
    }

    // ---- sessionIds filter ----

    #[tokio::test]
    async fn test_session_ids_filter_applies_before_limit() {
        let (temp_dir, _files) = three_project_fixture("sessionProbe5");

        // Newer sessions exist, yet with limit 1 the newest a1 match must
        // still be returned: the filter runs before the limit.
        let a1 = run_filtered(
            &temp_dir,
            "sessionProbe5",
            serde_json::json!({ "sessionIds": ["a1"] }),
            Some(1),
        )
        .await;
        assert_eq!(
            uuids(&a1),
            ["sub-1"],
            "subagent lines carry the parent sessionId"
        );

        let several = run_filtered(
            &temp_dir,
            "sessionProbe5",
            serde_json::json!({ "sessionIds": ["a2", "g1", "unknown"] }),
            None,
        )
        .await;
        assert_eq!(uuids(&several), ["a2-1", "g1-1"]);

        let combined = run_filtered(
            &temp_dir,
            "sessionProbe5",
            serde_json::json!({ "sessionIds": ["a1", "b1"], "projects": ["alpha"] }),
            None,
        )
        .await;
        assert_eq!(uuids(&combined), ["a1-1", "a1-2"]);

        let empty = run_filtered(
            &temp_dir,
            "sessionProbe5",
            serde_json::json!({ "sessionIds": [] }),
            None,
        )
        .await;
        assert_eq!(empty.len(), 7, "an empty selection is no restriction");
    }

    #[test]
    fn test_validate_session_ids_filter() {
        assert!(validate_search_filters(&serde_json::json!({ "sessionIds": ["a", "b"] })).is_ok());
        assert!(validate_search_filters(&serde_json::json!({ "sessionIds": [] })).is_ok());
        assert!(validate_search_filters(&serde_json::json!({ "sessionIds": null })).is_ok());
        for invalid in [
            serde_json::json!({ "sessionIds": "a" }),
            serde_json::json!({ "sessionIds": ["a", 1] }),
            serde_json::json!({ "sessionIds": {} }),
        ] {
            let error = validate_search_filters(&invalid).unwrap_err();
            assert!(error.contains("Invalid sessionIds filter"), "{error}");
        }
    }
}
