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
