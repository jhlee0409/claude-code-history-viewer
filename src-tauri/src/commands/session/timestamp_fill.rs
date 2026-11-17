//! Timestamp fallback for transcript lines that carry no `timestamp`.
//!
//! Claude Code writes bookkeeping records (`api-request-blob`, `mode`,
//! `last-prompt`, ...) without a top-level `timestamp`. Stamping them with
//! the current time makes them look like they happened "now" and sorts them
//! after every dated message (#729). Instead they inherit the timestamp of
//! the nearest dated line around them in the file.

use crate::models::ClaudeMessage;
use chrono::Utc;
use serde::Deserialize;

#[derive(Deserialize)]
struct TimestampOnly {
    timestamp: Option<String>,
}

fn line_timestamp(line: &[u8]) -> Option<String> {
    serde_json::from_slice::<TimestampOnly>(line)
        .ok()?
        .timestamp
        .filter(|ts| !ts.is_empty())
}

/// Fill empty timestamps in `messages` (pairs of line index and message,
/// sorted by line index) from the nearest earlier dated line of the file,
/// or the nearest later one when nothing earlier is dated. A file with no
/// dated line at all falls back to the current time, as before.
///
/// `line_at(i)` returns the raw bytes of line `i`, for `i < line_count`.
pub(super) fn fill_missing_timestamps<'a>(
    line_count: usize,
    line_at: impl Fn(usize) -> &'a [u8],
    messages: &mut [(usize, ClaudeMessage)],
) {
    // Previous message: (line index, timestamp). Lines at or before it never
    // need to be scanned again.
    let mut anchor: Option<(usize, String)> = None;

    for (line_idx, msg) in messages.iter_mut() {
        if msg.timestamp.is_empty() {
            let scan_from = anchor.as_ref().map_or(0, |(line, _)| line + 1);
            let earlier = (scan_from..*line_idx)
                .rev()
                .find_map(|i| line_timestamp(line_at(i)))
                .or_else(|| anchor.as_ref().map(|(_, ts)| ts.clone()));
            let resolved = earlier
                .or_else(|| (*line_idx + 1..line_count).find_map(|i| line_timestamp(line_at(i))));
            msg.timestamp = resolved.unwrap_or_else(|| Utc::now().to_rfc3339());
        }
        anchor = Some((*line_idx, msg.timestamp.clone()));
    }
}
