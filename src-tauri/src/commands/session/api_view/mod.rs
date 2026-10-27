//! API request view: the session laid out as the requests Claude Code sent.
//!
//! Since Claude Code 2.1.301 a transcript records every API request
//! (`api-request`, `api-request-blob`, `api-request-shape`). Each request
//! keeps the first `keep` messages of the request it builds on (`base`) and
//! appends `tail`, a list of message hashes that resolve to blobs or to the
//! transcript's own user / assistant lines. This module rebuilds those
//! requests, ties each one to its response (`requestRef` on assistant lines)
//! and to the transcript lines that fed it (the `parentUuid` chain), and lists
//! every line that belongs to no request.
//!
//! Older transcripts carry no request records; there requests are inferred
//! from the assistant `requestId`s, with inputs but no message bodies. A
//! session resumed across that version boundary gets both kinds.

mod attribution;
mod hashing;
mod lines;
mod requests;
#[cfg(test)]
mod tests;
mod text;

use serde::Serialize;
use serde_json::Value;

/// The whole session as API requests.
#[derive(Debug, Serialize)]
pub struct ApiView {
    /// `true` when the transcript records requests. Requests with no `line`
    /// were inferred from responses, which can happen in either case.
    pub recorded: bool,
    pub line_count: usize,
    pub shapes: Vec<ApiShape>,
    pub requests: Vec<ApiRequest>,
    /// Lines tied to no request, in file order.
    pub unattributed: Vec<SourceLine>,
}

/// System prompt and tools, stored once per distinct value.
#[derive(Debug, Serialize)]
pub struct ApiShape {
    pub hash: String,
    pub line: usize,
    pub shape: Value,
}

#[derive(Debug, Serialize)]
pub struct ApiRequest {
    /// The record's `id`, or the response `requestId` for inferred requests.
    pub id: String,
    /// 1-based line of the `api-request` record.
    pub line: Option<usize>,
    pub timestamp: Option<String>,
    pub query_source: Option<String>,
    pub shape_hash: Option<String>,
    pub base: Option<String>,
    pub params: Value,
    pub cache_control: Value,
    /// Messages carried over unchanged from `base`.
    pub keep: usize,
    /// `keep` plus the new messages.
    pub total_messages: usize,
    /// The messages this request appended, `messages[keep..]`.
    pub new_messages: Vec<ApiMessage>,
    pub response: Option<ApiResponse>,
    /// Transcript lines that fed this request, oldest first.
    pub inputs: Vec<SourceLine>,
}

#[derive(Debug, Serialize)]
pub struct ApiMessage {
    /// Position in the request's `messages`.
    pub index: usize,
    pub role: String,
    pub content: Value,
    pub source: MessageSource,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MessageSource {
    /// An `api-request-blob` line.
    Blob { line: usize },
    /// One user line, or the lines of one assistant turn.
    Lines { lines: Vec<usize> },
    /// No line in the file hashes to this.
    Unresolved { hash: String },
}

#[derive(Debug, Serialize)]
pub struct ApiResponse {
    pub request_id: Option<String>,
    pub message_ids: Vec<String>,
    pub lines: Vec<usize>,
    pub uuids: Vec<String>,
    pub timestamp: Option<String>,
    pub model: Option<String>,
    pub stop_reason: Option<String>,
    pub usage: Value,
    pub content: Vec<Value>,
}

/// A transcript line shown by reference.
#[derive(Debug, Clone, Serialize)]
pub struct SourceLine {
    pub line: usize,
    pub uuid: Option<String>,
    /// `type`, refined by subtype / attachment type, e.g. `attachment:hook_success`.
    pub kind: String,
    /// Hook name, queue operation and similar detail.
    pub label: Option<String>,
    pub timestamp: Option<String>,
    pub preview: String,
    /// Whether the line's text appears in the request's new messages;
    /// `None` when that cannot be checked.
    pub in_request: Option<bool>,
}

/// Build the API view of one transcript file's contents.
pub fn build_api_view(text: &str) -> ApiView {
    let parsed = lines::ParsedLines::parse(text);
    let recorded_requests = requests::reconstruct(&parsed);
    let recorded = !recorded_requests.is_empty();
    let mut requests = requests::merge(recorded_requests, requests::infer_from_responses(&parsed));
    let unattributed = attribution::attribute(&parsed, &mut requests);
    ApiView {
        recorded,
        line_count: parsed.len(),
        shapes: requests::shapes(&parsed),
        requests,
        unattributed,
    }
}

/// Load the API request view of a session file.
#[tauri::command]
pub async fn load_session_api_view(session_path: String) -> Result<ApiView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let text = std::fs::read_to_string(&session_path)
            .map_err(|e| format!("Failed to read session file: {e}"))?;
        Ok(build_api_view(&text))
    })
    .await
    .map_err(|e| format!("API view task failed: {e}"))?
}
