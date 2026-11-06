//! Requests: rebuilt from `api-request` records, or inferred from responses.

use super::lines::{str_field, ParsedLines};
use super::{ApiMessage, ApiRequest, ApiShape, MessageSource};
use serde_json::Value;
use std::collections::HashSet;

/// Requests recorded in the transcript, in file order. Only the messages a
/// request appended are materialised; the first `keep` are its base's.
pub(super) fn reconstruct(parsed: &ParsedLines) -> Vec<ApiRequest> {
    let records: Vec<(usize, &Value)> = parsed
        .iter()
        .filter(|(_, v)| str_field(v, "type") == Some("api-request"))
        .collect();
    if records.is_empty() {
        return Vec::new();
    }
    let wanted: HashSet<&str> = records
        .iter()
        .filter_map(|(_, record)| record.get("tail")?.as_array())
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    let hashes = parsed.hash_index(&wanted);
    records
        .into_iter()
        .map(|(i, record)| {
            let keep = record.get("keep").and_then(Value::as_u64).unwrap_or(0) as usize;
            let tail: Vec<&str> = record
                .get("tail")
                .and_then(Value::as_array)
                .map(|t| t.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            let new_messages = tail
                .iter()
                .enumerate()
                .map(|(offset, hash)| {
                    let (role, content, source) = match hashes.get(*hash) {
                        Some((role, content, source)) => {
                            (role.clone(), content.clone(), source.clone())
                        }
                        None => (
                            String::new(),
                            Value::Null,
                            MessageSource::Unresolved {
                                hash: (*hash).to_string(),
                            },
                        ),
                    };
                    ApiMessage {
                        index: keep + offset,
                        role,
                        content,
                        source,
                    }
                })
                .collect();
            ApiRequest {
                id: str_field(record, "id").unwrap_or_default().to_string(),
                line: Some(i + 1),
                timestamp: owned(record, "timestamp"),
                query_source: owned(record, "querySource"),
                shape_hash: owned(record, "shapeHash"),
                base: owned(record, "base"),
                params: record.get("params").cloned().unwrap_or(Value::Null),
                cache_control: record.get("cacheControl").cloned().unwrap_or(Value::Null),
                keep,
                total_messages: keep + tail.len(),
                new_messages,
                response: None,
                inputs: Vec::new(),
            }
        })
        .collect()
}

/// One request per distinct `requestId` among responses that name no
/// recorded request: the whole file before Claude Code recorded requests,
/// or the part of a resumed session written by an older version. Each comes
/// with the 1-based line of its first response, for ordering. The send time
/// is approximated by the timestamp of the line the response answers.
/// Responses without a `requestId` (synthetic error notices) were never sent.
pub(super) fn infer_from_responses(parsed: &ParsedLines) -> Vec<(usize, ApiRequest)> {
    let mut requests = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for turn in parsed.assistant_turns() {
        let first = turn.lines[0];
        let Some(value) = parsed.get(first) else {
            continue;
        };
        if str_field(value, "requestRef").is_some() {
            continue;
        }
        let Some(id) = str_field(value, "requestId") else {
            continue;
        };
        if !seen.insert(id.to_string()) {
            continue;
        }
        let sent_at = str_field(value, "parentUuid")
            .and_then(|p| parsed.by_uuid(p))
            .and_then(|p| parsed.get(p))
            .and_then(|p| owned(p, "timestamp"));
        let request = ApiRequest {
            id: id.to_string(),
            line: None,
            timestamp: sent_at,
            query_source: None,
            shape_hash: None,
            base: None,
            params: Value::Null,
            cache_control: Value::Null,
            keep: 0,
            total_messages: 0,
            new_messages: Vec::new(),
            response: None,
            inputs: Vec::new(),
        };
        requests.push((first + 1, request));
    }
    requests
}

/// Recorded and inferred requests together, in file order.
pub(super) fn merge(
    recorded: Vec<ApiRequest>,
    inferred: Vec<(usize, ApiRequest)>,
) -> Vec<ApiRequest> {
    if inferred.is_empty() {
        return recorded;
    }
    let mut all: Vec<(usize, ApiRequest)> = recorded
        .into_iter()
        .map(|r| (r.line.unwrap_or(usize::MAX), r))
        .chain(inferred)
        .collect();
    all.sort_by_key(|(line, _)| *line);
    all.into_iter().map(|(_, r)| r).collect()
}

/// Every distinct request shape (system prompt and tools).
pub(super) fn shapes(parsed: &ParsedLines) -> Vec<ApiShape> {
    parsed
        .iter()
        .filter(|(_, v)| str_field(v, "type") == Some("api-request-shape"))
        .map(|(i, v)| ApiShape {
            hash: str_field(v, "shapeHash").unwrap_or_default().to_string(),
            line: i + 1,
            shape: v.get("shape").cloned().unwrap_or(Value::Null),
        })
        .collect()
}

fn owned(value: &Value, key: &str) -> Option<String> {
    str_field(value, key).map(str::to_string)
}
