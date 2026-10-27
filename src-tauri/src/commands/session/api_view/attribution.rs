//! Ties transcript lines to requests: responses by `requestRef` (or
//! `requestId`), inputs by the `parentUuid` chain from the response back to
//! the previous assistant line, and the remaining lines (queue operations,
//! hooks around tool calls) by their text.

use super::lines::{str_field, ParsedLines};
use super::text::{all_strings, line_text, preview, snippet};
use super::{ApiRequest, ApiResponse, SourceLine};
use serde_json::Value;
use std::collections::HashMap;

/// How many requests after a line may still carry its text.
const TEXT_LOOKAHEAD: usize = 4;

/// Line types whose text can reach a request.
const TEXT_SOURCES: [&str; 4] = ["queue-operation", "attachment", "user", "system"];

/// Record types the request view itself shows.
const REQUEST_RECORDS: [&str; 3] = ["api-request", "api-request-blob", "api-request-shape"];

/// Fill each request's response and inputs; return the lines left over.
pub(super) fn attribute(parsed: &ParsedLines, requests: &mut [ApiRequest]) -> Vec<SourceLine> {
    let mut claimed = vec![false; parsed.len()];
    for (i, value) in parsed.iter() {
        if REQUEST_RECORDS.contains(&str_field(value, "type").unwrap_or_default()) {
            claimed[i] = true;
        }
    }
    let texts: Vec<Option<String>> = requests.iter().map(request_text).collect();

    attach_responses(parsed, requests, &mut claimed);
    for (r, request) in requests.iter_mut().enumerate() {
        let lines = chain_inputs(parsed, request, &mut claimed);
        request.inputs = lines
            .into_iter()
            .map(|i| source_line(parsed, i, texts[r].as_deref()))
            .collect();
    }
    attach_by_text(parsed, requests, &texts, &mut claimed);
    for request in requests.iter_mut() {
        request.inputs.sort_by_key(|s| s.line);
    }

    parsed
        .iter()
        .filter(|(i, _)| !claimed[*i])
        .map(|(i, _)| source_line(parsed, i, None))
        .collect()
}

fn attach_responses(parsed: &ParsedLines, requests: &mut [ApiRequest], claimed: &mut [bool]) {
    let by_id: HashMap<String, usize> = requests
        .iter()
        .enumerate()
        .map(|(i, r)| (r.id.clone(), i))
        .collect();

    for turn in parsed.assistant_turns() {
        let Some(first) = parsed.get(turn.lines[0]) else {
            continue;
        };
        // A recorded response names its request; an older one only has the
        // `requestId` that `infer_from_responses` keyed its request by.
        let Some(id) = str_field(first, "requestRef").or_else(|| str_field(first, "requestId"))
        else {
            continue;
        };
        let Some(&r) = by_id.get(id) else {
            continue;
        };
        let response = requests[r].response.get_or_insert_with(|| ApiResponse {
            request_id: str_field(first, "requestId").map(str::to_string),
            message_ids: Vec::new(),
            lines: Vec::new(),
            uuids: Vec::new(),
            timestamp: str_field(first, "timestamp").map(str::to_string),
            model: None,
            stop_reason: None,
            usage: Value::Null,
            content: Vec::new(),
        });
        response.message_ids.push(turn.message_id.clone());
        response.content.extend(parsed.merged_content(&turn.lines));
        for &i in &turn.lines {
            claimed[i] = true;
            response.lines.push(i + 1);
            let Some(value) = parsed.get(i) else { continue };
            if let Some(uuid) = str_field(value, "uuid") {
                response.uuids.push(uuid.to_string());
            }
            let message = value.get("message").unwrap_or(&Value::Null);
            if let Some(model) = str_field(message, "model") {
                response.model = Some(model.to_string());
            }
            if let Some(reason) = str_field(message, "stop_reason") {
                response.stop_reason = Some(reason.to_string());
            }
            if let Some(usage) = message.get("usage") {
                response.usage = usage.clone();
            }
        }
    }
}

/// Lines between the previous assistant line and this request's response,
/// walking `parentUuid` back from the response.
fn chain_inputs(parsed: &ParsedLines, request: &ApiRequest, claimed: &mut [bool]) -> Vec<usize> {
    let Some(start) = request.response.as_ref().and_then(|r| r.lines.first()) else {
        return Vec::new();
    };
    let mut lines = Vec::new();
    let mut parent = parsed
        .get(start - 1)
        .and_then(|v| str_field(v, "parentUuid"));
    while let Some(i) = parent.and_then(|p| parsed.by_uuid(p)) {
        if claimed[i] || parsed.line_type(i) == Some("assistant") {
            break;
        }
        claimed[i] = true;
        lines.push(i);
        parent = parsed.get(i).and_then(|v| str_field(v, "parentUuid"));
    }
    lines
}

/// A line no chain reaches belongs to the first request, at or after its
/// time, whose new messages carry its text.
fn attach_by_text(
    parsed: &ParsedLines,
    requests: &mut [ApiRequest],
    texts: &[Option<String>],
    claimed: &mut [bool],
) {
    for (i, value) in parsed.iter() {
        if claimed[i] || !TEXT_SOURCES.contains(&str_field(value, "type").unwrap_or_default()) {
            continue;
        }
        let (Some(at), Some(needle)) = (str_field(value, "timestamp"), snippet(&line_text(value)))
        else {
            continue;
        };
        let first = requests
            .iter()
            .position(|r| r.timestamp.as_deref().is_some_and(|t| t >= at));
        let Some(first) = first else { continue };
        let last = (first + TEXT_LOOKAHEAD).min(requests.len());
        let found = (first..last).find(|&r| {
            texts[r]
                .as_deref()
                .is_some_and(|text| text.contains(&needle))
        });
        if let Some(r) = found {
            claimed[i] = true;
            requests[r]
                .inputs
                .push(source_line(parsed, i, texts[r].as_deref()));
        }
    }
}

/// Everything the request's new messages say; `None` when it has none.
fn request_text(request: &ApiRequest) -> Option<String> {
    if request.new_messages.is_empty() {
        return None;
    }
    let mut out = String::new();
    for message in &request.new_messages {
        all_strings(&message.content, &mut out);
    }
    Some(out)
}

fn source_line(parsed: &ParsedLines, i: usize, request_text: Option<&str>) -> SourceLine {
    let value = parsed.get(i).unwrap_or(&Value::Null);
    let text = line_text(value);
    let in_request =
        request_text.and_then(|haystack| snippet(&text).map(|needle| haystack.contains(&needle)));
    SourceLine {
        line: i + 1,
        uuid: str_field(value, "uuid").map(str::to_string),
        kind: kind(value),
        label: label(value),
        timestamp: str_field(value, "timestamp").map(str::to_string),
        preview: preview(&text, value),
        in_request,
    }
}

fn kind(value: &Value) -> String {
    let base = str_field(value, "type").unwrap_or("unknown");
    let detail = value
        .pointer("/attachment/type")
        .and_then(Value::as_str)
        .or_else(|| str_field(value, "subtype"))
        .or_else(|| str_field(value, "operation"));
    match detail {
        Some(detail) => format!("{base}:{detail}"),
        None => base.to_string(),
    }
}

fn label(value: &Value) -> Option<String> {
    let attachment = value.get("attachment")?;
    str_field(attachment, "hookName")
        .or_else(|| str_field(attachment, "hookEvent"))
        .map(str::to_string)
}
