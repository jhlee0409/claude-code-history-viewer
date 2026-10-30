use super::hashing::message_hash;
use super::{build_api_view, MessageSource};
use serde_json::{json, Value};

fn transcript(lines: &[Value]) -> String {
    lines
        .iter()
        .map(Value::to_string)
        .collect::<Vec<_>>()
        .join("\n")
}

fn source_lines(source: &MessageSource) -> Vec<usize> {
    match source {
        MessageSource::Blob { line } => vec![*line],
        MessageSource::Lines { lines } => lines.clone(),
        MessageSource::Unresolved { .. } => Vec::new(),
    }
}

#[test]
fn message_hash_matches_claude_code() {
    // Reference: Python json.dumps(sort_keys=True, separators=(",", ":"),
    // ensure_ascii=False) | sha256, which reproduces Claude Code's tail hashes.
    let content = json!([{"type": "text", "text": "привет \"мир\"\n", "n": 1, "cache": null}]);
    assert_eq!(
        message_hash("user", &content),
        "e1c178f781a5c7d3919f075a17081850562e987dd0170a404db150c5ced04d34"
    );
}

fn recorded_transcript() -> String {
    let first = json!([{"type": "text", "text": "hello there friend\n\nhook says something long"}]);
    let turn = json!([
        {"type": "thinking", "thinking": "let me look"},
        {"type": "tool_use", "id": "toolu_1", "name": "Bash", "input": {"command": "ls"}}
    ]);
    let result =
        json!([{"type": "tool_result", "tool_use_id": "toolu_1", "content": "file-a file-b"}]);
    let queued = json!([{"type": "text", "text": "queued message long text"}]);
    let h1 = message_hash("user", &first);
    let h2 = message_hash("user", &queued);
    transcript(&[
        json!({"type": "api-request-shape", "shapeHash": "s1", "shape": {"system": []}}),
        json!({"type": "user", "uuid": "u1", "parentUuid": null, "timestamp": "2026-01-01T00:00:00Z",
               "message": {"role": "user", "content": "hello there friend"}}),
        json!({"type": "attachment", "uuid": "a1", "parentUuid": "u1", "timestamp": "2026-01-01T00:00:01Z",
               "attachment": {"type": "hook_success", "hookName": "UserPromptSubmit"},
               "rendered": [{"content": "hook says something long"}]}),
        json!({"type": "api-request-blob", "hash": h1, "message": {"role": "user", "content": first}}),
        json!({"type": "api-request", "id": "R1", "keep": 0, "tail": [h1], "shapeHash": "s1",
               "timestamp": "2026-01-01T00:00:02Z", "params": {"model": "m"}}),
        json!({"type": "assistant", "uuid": "x1", "parentUuid": "a1", "requestRef": "R1", "requestId": "req_1",
               "message": {"id": "msg_1", "role": "assistant", "content": [turn[0]]}}),
        json!({"type": "assistant", "uuid": "x2", "parentUuid": "x1", "requestRef": "R1", "requestId": "req_1",
               "message": {"id": "msg_1", "role": "assistant", "content": [turn[1]], "stop_reason": "tool_use"}}),
        json!({"type": "user", "uuid": "u2", "parentUuid": "x2", "timestamp": "2026-01-01T00:00:05Z",
               "message": {"role": "user", "content": result}}),
        json!({"type": "queue-operation", "operation": "remove", "timestamp": "2026-01-01T00:00:06Z",
               "content": "queued message long text"}),
        json!({"type": "mode", "mode": "default"}),
        json!({"type": "api-request", "id": "R2", "base": "R1", "keep": 1, "timestamp": "2026-01-01T00:00:07Z",
               "tail": [message_hash("assistant", &turn), message_hash("user", &result), h2]}),
        json!({"type": "api-request-blob", "hash": h2, "message": {"role": "user", "content": queued}}),
        json!({"type": "assistant", "uuid": "x3", "parentUuid": "u2", "requestRef": "R2",
               "message": {"id": "msg_2", "role": "assistant", "content": [{"type": "text", "text": "done"}]}}),
        json!({"type": "system", "uuid": "s9", "subtype": "stop_hook_summary", "content": "stop hook ran fine"}),
    ])
}

#[test]
fn recorded_requests_resolve_tail_messages_to_their_lines() {
    let view = build_api_view(&recorded_transcript());
    assert!(view.recorded);
    assert_eq!(view.shapes.len(), 1);
    assert_eq!(view.requests.len(), 2);

    let first = &view.requests[0];
    assert_eq!(first.new_messages.len(), 1);
    assert_eq!(source_lines(&first.new_messages[0].source), vec![4]);

    let second = &view.requests[1];
    assert_eq!((second.keep, second.total_messages), (1, 4));
    let sources: Vec<Vec<usize>> = second
        .new_messages
        .iter()
        .map(|m| source_lines(&m.source))
        .collect();
    assert_eq!(sources, vec![vec![6, 7], vec![8], vec![12]]);
    let indices: Vec<usize> = second.new_messages.iter().map(|m| m.index).collect();
    assert_eq!(indices, vec![1, 2, 3]);
}

#[test]
fn responses_and_inputs_attach_to_their_request() {
    let view = build_api_view(&recorded_transcript());
    let first = &view.requests[0];
    let response = first.response.as_ref().expect("response");
    assert_eq!(response.lines, vec![6, 7]);
    assert_eq!(response.content.len(), 2);
    assert_eq!(response.stop_reason.as_deref(), Some("tool_use"));
    let inputs: Vec<(usize, Option<bool>)> = first
        .inputs
        .iter()
        .map(|s| (s.line, s.in_request))
        .collect();
    assert_eq!(inputs, vec![(2, Some(true)), (3, Some(true))]);
    assert_eq!(first.inputs[1].kind, "attachment:hook_success");
    assert_eq!(first.inputs[1].label.as_deref(), Some("UserPromptSubmit"));

    let second: Vec<(usize, Option<bool>)> = view.requests[1]
        .inputs
        .iter()
        .map(|s| (s.line, s.in_request))
        .collect();
    assert_eq!(second, vec![(8, Some(true)), (9, Some(true))]);
}

#[test]
fn lines_outside_every_request_are_listed() {
    let view = build_api_view(&recorded_transcript());
    let left: Vec<(usize, &str)> = view
        .unattributed
        .iter()
        .map(|s| (s.line, s.kind.as_str()))
        .collect();
    assert_eq!(left, vec![(10, "mode"), (14, "system:stop_hook_summary")]);
}

#[test]
fn unknown_tail_hash_stays_visible_as_unresolved() {
    let text =
        transcript(&[json!({"type": "api-request", "id": "R1", "keep": 0, "tail": ["abc"]})]);
    let view = build_api_view(&text);
    assert!(matches!(
        &view.requests[0].new_messages[0].source,
        MessageSource::Unresolved { hash } if hash == "abc"
    ));
}

/// Request id, send time, input lines, response lines.
type RequestSummary<'a> = (&'a str, Option<&'a str>, Vec<usize>, Vec<usize>);

#[test]
fn requests_are_inferred_from_responses_without_records() {
    let text = transcript(&[
        json!({"type": "user", "uuid": "u1", "timestamp": "2026-01-01T00:00:00Z",
               "message": {"role": "user", "content": "first prompt here"}}),
        json!({"type": "assistant", "uuid": "x1", "parentUuid": "u1", "requestId": "req_1",
               "message": {"id": "msg_1", "role": "assistant", "content": [{"type": "text", "text": "a"}]}}),
        json!({"type": "assistant", "uuid": "x2", "parentUuid": "x1", "requestId": "req_1",
               "message": {"id": "msg_1", "role": "assistant", "content": [{"type": "text", "text": "b"}]}}),
        json!({"type": "user", "uuid": "u2", "parentUuid": "x2", "timestamp": "2026-01-01T00:01:00Z",
               "message": {"role": "user", "content": "second prompt here"}}),
        json!({"type": "assistant", "uuid": "x3", "parentUuid": "u2", "requestId": "req_2",
               "message": {"id": "msg_2", "role": "assistant", "content": [{"type": "text", "text": "c"}]}}),
    ]);
    let view = build_api_view(&text);
    assert!(!view.recorded);
    let summary: Vec<RequestSummary> = view
        .requests
        .iter()
        .map(|r| {
            (
                r.id.as_str(),
                r.timestamp.as_deref(),
                r.inputs.iter().map(|s| s.line).collect(),
                r.response
                    .as_ref()
                    .map(|x| x.lines.clone())
                    .unwrap_or_default(),
            )
        })
        .collect();
    assert_eq!(
        summary,
        vec![
            ("req_1", Some("2026-01-01T00:00:00Z"), vec![1], vec![2, 3]),
            ("req_2", Some("2026-01-01T00:01:00Z"), vec![4], vec![5]),
        ]
    );
    assert!(view.requests[0].inputs[0].in_request.is_none());
    assert!(view.unattributed.is_empty());
}

#[test]
fn resumed_session_infers_requests_for_responses_written_before_recording() {
    let prompt = json!([{"type": "text", "text": "new prompt"}]);
    let h = message_hash("user", &prompt);
    let text = transcript(&[
        json!({"type": "user", "uuid": "u1", "timestamp": "2026-01-01T00:00:00Z",
               "message": {"role": "user", "content": "old prompt"}}),
        json!({"type": "assistant", "uuid": "x1", "parentUuid": "u1", "requestId": "req_old",
               "message": {"id": "msg_1", "role": "assistant", "content": [{"type": "text", "text": "a"}]}}),
        json!({"type": "assistant", "uuid": "x2", "parentUuid": "x1",
               "message": {"id": "msg_err", "model": "<synthetic>", "role": "assistant",
                           "content": [{"type": "text", "text": "API Error"}]}}),
        json!({"type": "api-request-blob", "hash": h, "message": {"role": "user", "content": prompt}}),
        json!({"type": "api-request", "id": "R1", "keep": 0, "tail": [h],
               "timestamp": "2026-01-02T00:00:00Z"}),
        json!({"type": "assistant", "uuid": "x3", "parentUuid": "x2", "requestRef": "R1",
               "requestId": "req_new",
               "message": {"id": "msg_2", "role": "assistant", "content": [{"type": "text", "text": "b"}]}}),
    ]);
    let view = build_api_view(&text);
    assert!(view.recorded);
    let summary: Vec<(&str, Option<usize>, Vec<usize>)> = view
        .requests
        .iter()
        .map(|r| {
            (
                r.id.as_str(),
                r.line,
                r.response
                    .as_ref()
                    .map(|x| x.lines.clone())
                    .unwrap_or_default(),
            )
        })
        .collect();
    assert_eq!(
        summary,
        vec![("req_old", None, vec![2]), ("R1", Some(5), vec![6])]
    );
    let left: Vec<usize> = view.unattributed.iter().map(|s| s.line).collect();
    assert_eq!(left, vec![3]);
}

#[test]
fn input_lines_carry_their_full_content_kind_and_message() {
    let view = build_api_view(&recorded_transcript());
    let hook = &view.requests[0].inputs[1];
    assert_eq!(hook.found_in, Some(0));
    assert_eq!(hook.content, json!("hook says something long"));

    let second = &view.requests[1].inputs;
    let result = &second[0];
    assert_eq!(result.kind, "user:tool_result");
    assert_eq!(result.tool_use_id.as_deref(), Some("toolu_1"));
    assert_eq!(result.found_in, Some(2));
    assert_eq!(result.content[0]["content"], json!("file-a file-b"));
    let queued = &second[1];
    assert_eq!(queued.found_in, Some(3));
    assert_eq!(queued.content, json!("queued message long text"));
}

#[test]
fn a_line_with_no_text_shows_its_whole_record() {
    let view = build_api_view(&recorded_transcript());
    let mode = &view.unattributed[0];
    assert!(mode.record);
    assert_eq!(mode.content["mode"], json!("default"));
    assert!(!view.requests[0].inputs[0].record);
}

#[test]
fn results_of_parallel_calls_feed_the_next_request() {
    // Parallel calls are written call, result, call, result: the results
    // sit between the lines of the response that made the calls.
    let call = |id: &str| json!([{"type": "tool_use", "id": id, "name": "Read", "input": {}}]);
    let result = |id: &str| json!([{"type": "tool_result", "tool_use_id": id, "content": "ok"}]);
    let text = transcript(&[
        json!({"type": "user", "uuid": "u1", "timestamp": "2026-01-01T00:00:00Z",
               "message": {"role": "user", "content": "read both files"}}),
        json!({"type": "assistant", "uuid": "x1", "parentUuid": "u1", "requestId": "req_1",
               "message": {"id": "msg_1", "role": "assistant", "content": call("t1")}}),
        json!({"type": "user", "uuid": "r1", "parentUuid": "x1", "timestamp": "2026-01-01T00:00:01Z",
               "message": {"role": "user", "content": result("t1")}}),
        json!({"type": "assistant", "uuid": "x2", "parentUuid": "r1", "requestId": "req_1",
               "message": {"id": "msg_1", "role": "assistant", "content": call("t2")}}),
        json!({"type": "user", "uuid": "r2", "parentUuid": "x2", "timestamp": "2026-01-01T00:00:02Z",
               "message": {"role": "user", "content": result("t2")}}),
        json!({"type": "assistant", "uuid": "x3", "parentUuid": "r2", "requestId": "req_2",
               "message": {"id": "msg_2", "role": "assistant", "content": [{"type": "text", "text": "done"}]}}),
    ]);
    let view = build_api_view(&text);
    let inputs: Vec<Vec<usize>> = view
        .requests
        .iter()
        .map(|r| r.inputs.iter().map(|s| s.line).collect())
        .collect();
    assert_eq!(inputs, vec![vec![1], vec![3, 5]]);
    assert!(view.unattributed.is_empty());
}

#[test]
fn results_written_after_all_parallel_calls_feed_the_next_request() {
    // Both calls first, then both results, each a child of its own call:
    // only the last result is on the chain to the next response.
    let call = |id: &str| json!([{"type": "tool_use", "id": id, "name": "Read", "input": {}}]);
    let result = |id: &str| json!([{"type": "tool_result", "tool_use_id": id, "content": "ok"}]);
    let text = transcript(&[
        json!({"type": "user", "uuid": "u1", "timestamp": "2026-01-01T00:00:00Z",
               "message": {"role": "user", "content": "read both files"}}),
        json!({"type": "assistant", "uuid": "x1", "parentUuid": "u1", "requestId": "req_1",
               "message": {"id": "msg_1", "role": "assistant", "content": call("t1")}}),
        json!({"type": "assistant", "uuid": "x2", "parentUuid": "x1", "requestId": "req_1",
               "message": {"id": "msg_1", "role": "assistant", "content": call("t2")}}),
        json!({"type": "user", "uuid": "r1", "parentUuid": "x1", "timestamp": "2026-01-01T00:00:01Z",
               "message": {"role": "user", "content": result("t1")}}),
        json!({"type": "user", "uuid": "r2", "parentUuid": "x2", "timestamp": "2026-01-01T00:00:02Z",
               "message": {"role": "user", "content": result("t2")}}),
        json!({"type": "assistant", "uuid": "x3", "parentUuid": "r2", "requestId": "req_2",
               "message": {"id": "msg_2", "role": "assistant", "content": [{"type": "text", "text": "done"}]}}),
    ]);
    let view = build_api_view(&text);
    let inputs: Vec<Vec<usize>> = view
        .requests
        .iter()
        .map(|r| r.inputs.iter().map(|s| s.line).collect())
        .collect();
    assert_eq!(inputs, vec![vec![1], vec![4, 5]]);
    assert!(view.unattributed.is_empty());
}
