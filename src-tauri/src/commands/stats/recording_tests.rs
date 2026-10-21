use super::*;
use serde_json::{json, Value};

fn row(usage: Option<Value>, id: &str, timestamp: &str) -> Value {
    let mut row = json!({
        "uuid": id, "sessionId": "recording", "timestamp": timestamp,
        "type": "assistant", "isSidechain": false,
        "message": {"role": "assistant", "id": id, "model": "claude-sonnet-4",
                    "content": [{"type": "text", "text": "synthetic"}]}
    });
    if let Some(usage) = usage {
        row["message"]["usage"] = usage;
    }
    row
}

fn full_usage(input: u32, output: u32) -> Value {
    json!({"input_tokens": input, "output_tokens": output,
           "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0,
           "reasoning_tokens": 0})
}

fn write_rows(path: &Path, rows: &[Value]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(
        path,
        rows.iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n")
            + "\n",
    )
    .unwrap();
}

/// Raw matrix shared by scan, cache and transport tests.
fn usage_cases() -> Vec<(Option<Value>, &'static str, u64)> {
    vec![
        (None, "absent", 0),
        (Some(Value::Null), "absent", 0),
        (Some(json!({})), "absent", 0),
        (Some(json!({"service_tier":"standard"})), "absent", 0),
        (Some(full_usage(0, 0)), "recorded", 0),
        (Some(full_usage(13, 7)), "recorded", 20),
        (
            Some(json!({"input_tokens":13,"output_tokens":7})),
            "partial",
            20,
        ),
        (Some(json!({"input_tokens":0})), "partial", 0),
        (Some(json!({"output_tokens":0})), "partial", 0),
        (Some(json!({"cache_read_input_tokens":0})), "partial", 0),
        (Some(json!({"reasoning_tokens":0})), "partial", 0),
        (Some(json!({"cache_creation":{}})), "absent", 0),
        (
            Some(
                json!({"cache_creation":{"ephemeral_5m_input_tokens":null,"ephemeral_1h_input_tokens":null}}),
            ),
            "absent",
            0,
        ),
        (
            Some(json!({"cache_creation":{"ephemeral_5m_input_tokens":0}})),
            "partial",
            0,
        ),
        (
            Some(json!({"cache_creation":{"ephemeral_5m_input_tokens":3}})),
            "partial",
            3,
        ),
        (
            Some(
                json!({"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"reasoning_tokens":0,
                     "cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":0}}),
            ),
            "recorded",
            0,
        ),
        (
            Some(
                json!({"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"reasoning_tokens":0,
                     "cache_creation":{"ephemeral_5m_input_tokens":0}}),
            ),
            "partial",
            0,
        ),
    ]
}

#[test]
fn native_recording_observes_raw_counters_before_defaults() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("project/matrix.jsonl");
    for mode in [StatsMode::BillingTotal, StatsMode::ConversationOnly] {
        for (index, (usage, expected, total)) in usage_cases().into_iter().enumerate() {
            let raw = row(usage, "matrix", "2025-01-01T12:00:00Z");
            write_rows(&path, std::slice::from_ref(&raw));
            let root = session_files::own_folder(&path).unwrap();
            let stats = scan_session_token_stats(&path, &root, mode, None, None).unwrap();
            assert_eq!(stats.total_tokens, total, "case {index}: {raw}");
            assert_eq!(recording(&stats), expected, "case {index}: {raw}");
        }
    }
}

#[test]
fn native_recording_fallback_precedence_and_invalid_values() {
    for location in ["content", "tool"] {
        for (usage, expected, _) in usage_cases() {
            let mut raw = row(None, "fallback", "2025-01-01T12:00:00Z");
            if location == "content" {
                raw["message"]["content"] = json!({"usage":usage});
            } else {
                raw["toolUseResult"] = json!({"usage":usage});
            }
            let message =
                ClaudeMessage::try_from(serde_json::from_value::<RawLogEntry>(raw).unwrap())
                    .unwrap();
            let mut evidence = TokenRecordingEvidence::default();
            evidence.observe(&message);
            assert_eq!(
                serde_json::to_value(evidence.finish()).unwrap(),
                expected,
                "{location}"
            );
        }
    }
    for (raw_usage, expected) in [
        (
            json!({"input_tokens":-1,"output_tokens":"0","reasoning_tokens":4294967296_u64}),
            "absent",
        ),
        (
            json!({"inputTokens":0,"outputTokens":0,"cacheWrite":0,"cacheRead":0,"reasoning":0}),
            "recorded",
        ),
    ] {
        let message = ClaudeMessage {
            content: Some(json!({"usage":raw_usage})),
            ..Default::default()
        };
        let mut evidence = TokenRecordingEvidence::default();
        evidence.observe(&message);
        assert_eq!(serde_json::to_value(evidence.finish()).unwrap(), expected);
    }
    for total in [0, 20] {
        let message = ClaudeMessage {
            message_type: "assistant".into(),
            tool_use_result: Some(json!({"totalTokens":total})),
            ..Default::default()
        };
        let mut evidence = TokenRecordingEvidence::default();
        evidence.observe(&message);
        assert_eq!(serde_json::to_value(evidence.finish()).unwrap(), "partial");
        assert_eq!(token_usage_totals(&extract_token_usage(&message)).5, total);
    }
    let message = ClaudeMessage {
        usage: Some(TokenUsage::default()),
        tool_use_result: Some(json!({"usage":full_usage(13,7)})),
        ..Default::default()
    };
    let mut evidence = TokenRecordingEvidence::default();
    evidence.observe(&message);
    assert_eq!(
        serde_json::to_value(evidence.finish()).unwrap(),
        "absent",
        "direct empty suppresses fallback"
    );
    assert_eq!(token_usage_totals(&extract_token_usage(&message)).5, 0);
}

fn recording(stats: &SessionTokenStats) -> Value {
    serde_json::to_value(stats).unwrap()["token_usage_recording"].clone()
}

#[test]
fn native_recording_distinguishes_absence_from_explicit_zero() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("project/session.jsonl");
    for mode in [StatsMode::BillingTotal, StatsMode::ConversationOnly] {
        let mut responses = Vec::new();
        for (usage, expected) in [(None, "absent"), (Some(full_usage(0, 0)), "recorded")] {
            write_rows(&path, &[row(usage, "same-id", "2025-01-01T12:00:00Z")]);
            let root = session_files::own_folder(&path).unwrap();
            let stats = scan_session_token_stats(&path, &root, mode, None, None).unwrap();
            assert_eq!(stats.total_tokens, 0);
            assert_eq!(recording(&stats), expected);
            let mut value = serde_json::to_value(stats).unwrap();
            value
                .as_object_mut()
                .unwrap()
                .remove("token_usage_recording");
            responses.push(value);
        }
        assert_eq!(
            responses[0], responses[1],
            "only recording metadata changes"
        );
    }
}
