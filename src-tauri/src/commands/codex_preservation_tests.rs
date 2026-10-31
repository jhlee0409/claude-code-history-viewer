//! Synthetic structures pinned to Codex protocol; never private history text.
use super::multi_provider::{load_provider_messages, load_provider_messages_paginated};
use serde_json::{json, Value};

pub(crate) const FIXTURE: &str = include_str!("../../tests/fixtures/codex-preservation.jsonl");

pub(crate) fn assert_evidence(messages: &[Value]) {
    let find = |uuid: &str| messages.iter().find(|m| m["uuid"] == uuid).unwrap();
    assert_eq!(find("use-one")["content"][1]["codexOutput"]["exitCode"], 0);
    assert_eq!(find("use-two")["content"][1]["codexOutput"]["exitCode"], 2);
    assert_eq!(
        find("use-one")["content"][1]["codexOutput"]["sourceMessageUuid"],
        "result-one"
    );
    assert_eq!(
        find("use-two")["content"][1]["codexOutput"]["sourceMessageUuid"],
        "result-two"
    );
    assert!(find("no-header")["content"][0].get("codexOutput").is_none());
    assert!(find("before-turn")["codexEvidence"].get("turn").is_none());
    assert_eq!(
        find("use-one")["codexEvidence"]["turn"]["context"]["extension"],
        json!({"null":null,"false":false,"zero":0,"empty":""})
    );
    assert_eq!(
        find("goal-context")["codexEvidence"]["turn"]["started"]["turn_id"],
        "goal-turn"
    );
    assert!(find("goal-context")["codexEvidence"]["turn"]
        .get("context")
        .is_none());
    assert_eq!(
        find("explicit-null-turn")["codexEvidence"]["turn"]["context"].get("turn_id"),
        Some(&Value::Null)
    );
    assert_eq!(
        find("goal-context")["codexEvidence"]["contentItems"],
        json!([
            {"type":"input_text"},{"type":"input_image"},{"type":"input_audio"},{"type":"future_kind"},{"type":null},{}
        ])
    );
    assert_eq!(
        find("goal-context")["codexEvidence"]["contentItemKinds"],
        json!(["user.text", null, false, 0, ""])
    );
    let events = find("result-orphan")["codexEvidence"]["fileChanges"]
        .as_array()
        .unwrap();
    let records: Vec<Value> = FIXTURE
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(events.len(), 2);
    for (event, line) in events.iter().zip([9, 10]) {
        assert_eq!(event["sourceLine"], line);
        assert_eq!(event["record"], records[line]);
    }
    assert_eq!(
        find("result-orphan")["content"][0]["content"],
        records[8]["payload"]["output"]
    );
}

async fn responses(path: &std::path::Path) -> Vec<Value> {
    let path = path.to_string_lossy().to_string();
    let mut responses = vec![serde_json::to_value(
        load_provider_messages("codex".into(), path.clone())
            .await
            .unwrap(),
    )
    .unwrap()];
    for (offset, limit) in [(0, 200), (0, 1), (1, 2), (3, 3), (6, 4), (99, 2), (0, 0)] {
        responses.push(
            serde_json::to_value(
                load_provider_messages_paginated(
                    "codex".into(),
                    path.clone(),
                    Some(offset),
                    Some(limit),
                    Some(false),
                )
                .await
                .unwrap(),
            )
            .unwrap(),
        );
    }
    responses
}

fn strip_additive(response: &mut Value) {
    let messages = if response.is_array() {
        response.as_array_mut().unwrap()
    } else {
        response["messages"].as_array_mut().unwrap()
    };
    for message in messages {
        message.as_object_mut().unwrap().remove("codexEvidence");
        if let Some(blocks) = message["content"].as_array_mut() {
            for block in blocks {
                if block["type"] == "tool_result" {
                    block.as_object_mut().unwrap().remove("codexOutput");
                    block.as_object_mut().unwrap().remove("codexEvidence");
                }
            }
        }
    }
}

#[tokio::test]
#[serial_test::serial]
async fn codex_preservation_closed_turns_and_exec_only_headers() {
    let home = crate::test_utils::SandboxHome::new();
    let path = home.path().join(".codex/sessions/rollout-boundaries.jsonl");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(
        &path,
        include_str!("../../tests/fixtures/codex-boundaries.jsonl"),
    )
    .unwrap();
    let values = responses(&path).await;
    for messages in [
        values[0].as_array().unwrap(),
        values[1]["messages"].as_array().unwrap(),
    ] {
        let find = |id: &str| messages.iter().find(|m| m["uuid"] == id).unwrap();
        for id in ["after-complete", "after-abort", "after-alias"] {
            assert!(
                find(id)["codexEvidence"].get("turn").is_none(),
                "{id} inherited a closed turn"
            );
        }
        assert_eq!(
            find("exec-call")["content"][1]["codexOutput"]["exitCode"],
            0
        );
        assert_eq!(
            find("wait-call")["content"][1]["codexOutput"]["exitCode"],
            2
        );
        for id in ["mcp-call", "bad-call"] {
            assert!(
                find(id)["content"][1]["codexOutput"]
                    .get("exitCode")
                    .is_none(),
                "{id}"
            );
        }
        assert!(find("orphan-result")["content"][0]["codexOutput"]
            .get("exitCode")
            .is_none());
    }
}

#[test]
fn codex_preservation_turn_identity() {
    let messages = fixture_messages();
    let goal = messages
        .iter()
        .find(|m| m["uuid"] == "goal-context")
        .unwrap();
    assert_eq!(
        goal["codexEvidence"]["turn"]["started"]["turn_id"],
        "goal-turn"
    );
}

#[test]
fn codex_preservation_content_item_types() {
    let messages = fixture_messages();
    let goal = messages
        .iter()
        .find(|m| m["uuid"] == "goal-context")
        .unwrap();
    assert_eq!(
        goal["codexEvidence"]["contentItems"],
        json!([
            {"type":"input_text"},{"type":"input_image"},{"type":"input_audio"},{"type":"future_kind"},{"type":null},{}
        ])
    );
}

#[test]
fn codex_preservation_file_changes() {
    let messages = fixture_messages();
    let owner = messages
        .iter()
        .find(|m| m["uuid"] == "result-orphan")
        .unwrap();
    assert_eq!(
        owner["codexEvidence"]["fileChanges"][0]["record"]["payload"]["item"]["changes"]["a.txt"]
            ["unified_diff"],
        "@@ -1 +1 @@\n-old\n+new\n"
    );
}

fn fixture_messages() -> Vec<Value> {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("rollout-test.jsonl");
    std::fs::write(&path, FIXTURE).unwrap();
    crate::providers::codex::parse_rollout_file(&path)
        .unwrap()
        .iter()
        .map(|m| serde_json::to_value(m).unwrap())
        .collect()
}

#[tokio::test]
#[serial_test::serial]
async fn codex_preservation_public_evidence() {
    let home = crate::test_utils::SandboxHome::new();
    let path = home
        .path()
        .join(".codex")
        .join("sessions")
        .join("rollout-preservation.jsonl");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, FIXTURE).unwrap();
    let values = responses(&path).await;
    assert_evidence(values[0].as_array().unwrap());
    assert_evidence(values[1]["messages"].as_array().unwrap());
    let renderer_fixture: Value = serde_json::from_str(include_str!(
        "../../../src/test/fixtures/codex-preservation-public.json"
    ))
    .unwrap();
    assert_eq!(
        values[0], renderer_fixture,
        "frontend consumes the exact public command response"
    );
    if let Ok(destination) = std::env::var("BE1_PUBLIC_RESPONSE") {
        std::fs::write(
            destination,
            serde_json::to_string_pretty(&values[0]).unwrap(),
        )
        .unwrap();
    }
}

#[tokio::test]
#[serial_test::serial]
async fn codex_preservation_complete_legacy_parity() {
    let home = crate::test_utils::SandboxHome::new();
    let path = home
        .path()
        .join(".codex")
        .join("sessions")
        .join("rollout-preservation.jsonl");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, FIXTURE).unwrap();
    let mut values = responses(&path).await;
    for value in &mut values {
        strip_additive(value);
    }
    if let Ok(destination) = std::env::var("BE1_RECORD_BASE") {
        std::fs::write(destination, serde_json::to_string_pretty(&values).unwrap()).unwrap();
        return;
    }
    let expected: Value = serde_json::from_str(
        &std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/codex-preservation-legacy.json"
        ))
        .unwrap(),
    )
    .unwrap();
    assert_eq!(
        json!(values),
        expected,
        "whole legacy public responses, only declared additive locations stripped"
    );
}
