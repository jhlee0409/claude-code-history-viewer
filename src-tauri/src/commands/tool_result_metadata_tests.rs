//! Public-command regression: source user metadata must survive display merging.
use super::multi_provider::load_provider_messages_paginated;
use serde_json::{json, Value};

pub(crate) const CLAUDE_FIXTURE: &str =
    include_str!("../../tests/fixtures/tool-result-metadata.jsonl");
pub(crate) const CODEX_FIXTURE: &str =
    include_str!("../../tests/fixtures/tool-result-metadata-codex.jsonl");

/// Validate result provenance independently of assistant placement/ID lookup.
pub(crate) fn assert_source_metadata(page: &Value) {
    let records: Vec<Value> = CLAUDE_FIXTURE
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    for result in page["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|m| m["content"].as_array())
        .flatten()
        .filter(|b| b["type"] == "tool_result")
    {
        let (record, index, original) = records
            .iter()
            .flat_map(|r| {
                r["message"]["content"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .enumerate()
                    .map(move |(i, b)| (r, i, b))
            })
            .find(|(_, _, b)| b["type"] == "tool_result" && b["content"] == result["content"])
            .unwrap();
        let indices: Vec<usize> = record["message"]["content"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
            .filter(|(_, b)| b["type"] == "tool_result")
            .map(|(i, _)| i)
            .collect();
        let mut expected = original.clone();
        if let Some(raw) = record.get("toolUseResult") {
            if indices.len() == 1 && original.get("toolUseResult").is_none() {
                expected["toolUseResult"] = raw.clone();
                expected["toolUseResultSource"] = json!({"messageUuid":record["uuid"],"sessionId":record["sessionId"],"contentIndex":index,"association":"single_result"});
            } else if index == indices[0] {
                expected["toolUseResultSource"] = json!({"messageUuid":record["uuid"],"sessionId":record["sessionId"],"contentIndex":index,"association":"unassigned","resultContentIndices":indices,"unassignedToolUseResult":raw});
            }
        }
        assert_eq!(
            *result, expected,
            "source {} result index {index}",
            record["uuid"]
        );
    }
}

#[tokio::test]
async fn result_metadata_keeps_ambiguous_payload_once_and_exact_source_across_pages() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("matrix.jsonl");
    std::fs::write(&path, CLAUDE_FIXTURE).unwrap();
    for (offset, limit) in [(0, 200), (0, 1), (1, 2), (3, 3), (6, 4), (10, 3), (99, 2)] {
        let page = load_provider_messages_paginated(
            "claude".into(),
            path.to_string_lossy().into(),
            Some(offset),
            Some(limit),
            None,
        )
        .await
        .unwrap();
        assert_eq!(page.total_count, 13);
        assert_source_metadata(&serde_json::to_value(page).unwrap());
    }
}

#[tokio::test]
async fn result_metadata_does_not_change_codex_normalized_results() {
    let home = crate::test_utils::SandboxHome::new();
    let path = home.path().join(".codex/sessions/codex.jsonl");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, CODEX_FIXTURE).unwrap();
    let page = load_provider_messages_paginated(
        "codex".into(),
        path.to_string_lossy().into(),
        None,
        None,
        None,
    )
    .await
    .unwrap();
    assert_eq!(page.total_count, 2);
    let results: Vec<&Value> = page
        .messages
        .iter()
        .filter_map(|m| m.content.as_ref()?.as_array())
        .flatten()
        .filter(|b| b["type"] == "tool_result")
        .collect();
    assert_eq!(results.len(), 2);
    assert_eq!(results[0]["content"], "  unchanged\n\n");
    for block in results {
        assert!(block.get("toolUseResult").is_none());
        assert!(block.get("toolUseResultSource").is_none());
    }
}

#[tokio::test]
async fn result_metadata_distinguishes_null_missing_false_zero_and_empty() {
    let dir = tempfile::tempdir().unwrap();
    for raw in [
        None,
        Some(Value::Null),
        Some(json!(false)),
        Some(json!(0)),
        Some(json!("")),
    ] {
        let mut record = json!({"uuid":"r","sessionId":"s","timestamp":"2026-10-01T00:00:01Z","type":"user","message":{"role":"user","content":[{"type":"tool_result","content":null}]}});
        if let Some(value) = &raw {
            record["toolUseResult"] = value.clone();
        }
        let path = dir.path().join(format!("{}.jsonl", uuid::Uuid::new_v4()));
        std::fs::write(&path, format!("{record}\n")).unwrap();
        let page = load_provider_messages_paginated(
            "claude".into(),
            path.to_string_lossy().into(),
            None,
            None,
            None,
        )
        .await
        .unwrap();
        let result = &page.messages[0].content.as_ref().unwrap()[0];
        assert_eq!(
            result.get("toolUseResult"),
            raw.as_ref(),
            "null is present, not missing: {record}"
        );
        assert_eq!(result.get("toolUseResultSource").is_some(), raw.is_some());
    }
}

#[tokio::test]
async fn result_metadata_survives_public_paginated_command() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("session.jsonl");
    let metadata = json!({"stdout":"  \u{1b}[32mok\u{1b}[0m\n\n", "stderr":"warning\n", "exitCode":0, "interrupted":false, "future":{"n":null,"empty":[]}});
    let records = [
        json!({"uuid":"a","sessionId":"s","timestamp":"2026-10-01T00:00:00Z","type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"call","name":"Bash","input":{}}]}}),
        json!({"uuid":"r","sessionId":"s","timestamp":"2026-10-01T00:00:01Z","type":"user","toolUseResult":metadata,"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"call","content":"  original\n\n","is_error":false}]}}),
    ];
    std::fs::write(
        &path,
        records
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n")
            + "\n",
    )
    .unwrap();
    for limit in [1, 2] {
        let page = load_provider_messages_paginated(
            "claude".into(),
            path.to_string_lossy().into(),
            Some(0),
            Some(limit),
            None,
        )
        .await
        .unwrap();
        assert_eq!(page.total_count, 2);
        assert_eq!(page.next_offset, limit);
        assert_eq!(page.has_more, limit == 1);
        let value = serde_json::to_value(page).unwrap();
        let result = value["messages"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|m| m["content"].as_array().unwrap())
            .find(|b| b["type"] == "tool_result")
            .unwrap();
        assert_eq!(
            result.get("toolUseResult"),
            Some(&metadata),
            "exact source metadata lost at limit={limit}"
        );
        assert_eq!(result["content"], "  original\n\n");
        assert_eq!(result["is_error"], false);
        assert_eq!(
            result["toolUseResultSource"],
            json!({"messageUuid":"r","sessionId":"s","contentIndex":0,"association":"single_result"})
        );
        assert!(result["toolUseResult"].get("invented").is_none());
        let _: Value = value;
    }
}
