//! Public-command regression: source user metadata must survive display merging.
use super::multi_provider::load_provider_messages_paginated;
use serde_json::{json, Value};

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
