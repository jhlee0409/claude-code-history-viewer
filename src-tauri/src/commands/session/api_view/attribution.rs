//! Ties transcript lines to requests: responses by `requestRef` (or
//! `requestId`), inputs by the `parentUuid` chain from the response back to
//! the previous assistant line, and the remaining lines (queue operations,
//! hooks around tool calls) by their text.

use super::lines::{str_field, ParsedLines};
use super::source_line::{locate, message_texts, source_line, MessageTexts};
use super::text::{line_text, snippet};
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
    let texts: Vec<MessageTexts> = requests.iter().map(message_texts).collect();

    attach_responses(parsed, requests, &mut claimed);
    for (r, request) in requests.iter_mut().enumerate() {
        let lines = chain_inputs(parsed, request, &mut claimed);
        request.inputs = lines
            .into_iter()
            .map(|i| source_line(parsed, i, Some(&texts[r])))
            .collect();
    }
    attach_siblings(parsed, requests, &texts, &mut claimed);
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
        let Some(id) = response_key(first) else {
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

/// Lines between the previous response and this request's response,
/// walking `parentUuid` back from the response. Results of parallel calls
/// are written between the lines of the response that made the calls, so
/// the walk goes on through that response while it has such lines.
fn chain_inputs(parsed: &ParsedLines, request: &ApiRequest, claimed: &mut [bool]) -> Vec<usize> {
    let Some(start) = request.response.as_ref().and_then(|r| r.lines.first()) else {
        return Vec::new();
    };
    let parent_of = |i: usize| {
        parsed
            .get(i)
            .and_then(|v| str_field(v, "parentUuid"))
            .and_then(|p| parsed.by_uuid(p))
    };
    let mut lines = Vec::new();
    // The response the walk has reached, once it has.
    let mut previous: Option<&str> = None;
    let mut next = parent_of(start - 1);
    // A chain without a cycle visits each line at most once; a broken
    // transcript can point a response line back at itself.
    let mut steps = 0;
    while let Some(i) = next {
        steps += 1;
        if steps > parsed.len() {
            break;
        }
        if parsed.line_type(i) == Some("assistant") {
            let key = parsed.get(i).and_then(response_key);
            if key.is_none() || previous.is_some_and(|p| Some(p) != key) {
                break;
            }
            previous = key;
        } else {
            let between = previous.is_some()
                && parent_of(i)
                    .and_then(|p| parsed.get(p))
                    .and_then(response_key)
                    == previous;
            if claimed[i] || (previous.is_some() && !between) {
                break;
            }
            claimed[i] = true;
            lines.push(i);
        }
        next = parent_of(i);
    }
    lines
}

/// The request an assistant line answers.
fn response_key(value: &Value) -> Option<&str> {
    str_field(value, "requestRef").or_else(|| str_field(value, "requestId"))
}

/// The response a line answers, when its parent is a line of one.
fn parent_response(parsed: &ParsedLines, i: usize) -> Option<&str> {
    let parent = parsed
        .get(i)
        .and_then(|v| str_field(v, "parentUuid"))
        .and_then(|p| parsed.by_uuid(p))?;
    if parsed.line_type(parent) != Some("assistant") {
        return None;
    }
    parsed.get(parent).and_then(response_key)
}

/// A line no chain reaches whose parent is a line of a response (a result of
/// one of several parallel calls, written after all of them) goes where the
/// other children of that response went.
fn attach_siblings(
    parsed: &ParsedLines,
    requests: &mut [ApiRequest],
    texts: &[MessageTexts],
    claimed: &mut [bool],
) {
    let mut next: HashMap<&str, usize> = HashMap::new();
    for (r, request) in requests.iter().enumerate() {
        for input in &request.inputs {
            if let Some(key) = parent_response(parsed, input.line - 1) {
                if key != request.id {
                    next.entry(key).or_insert(r);
                }
            }
        }
    }
    for (i, value) in parsed.iter() {
        if claimed[i] || !TEXT_SOURCES.contains(&str_field(value, "type").unwrap_or_default()) {
            continue;
        }
        let Some(&r) = parent_response(parsed, i).and_then(|key| next.get(key)) else {
            continue;
        };
        claimed[i] = true;
        requests[r]
            .inputs
            .push(source_line(parsed, i, Some(&texts[r])));
    }
}

/// A line no chain reaches belongs to the first request, at or after its
/// time, whose new messages carry its text.
fn attach_by_text(
    parsed: &ParsedLines,
    requests: &mut [ApiRequest],
    texts: &[MessageTexts],
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
        let found = (first..last).find(|&r| locate(&texts[r], &needle).is_some());
        if let Some(r) = found {
            claimed[i] = true;
            requests[r]
                .inputs
                .push(source_line(parsed, i, Some(&texts[r])));
        }
    }
}
