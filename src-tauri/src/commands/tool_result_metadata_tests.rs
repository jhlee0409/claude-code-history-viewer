//! Public-command regression: source user metadata must survive display merging.
use super::multi_provider::load_provider_messages_paginated;
use serde_json::{json, Value};

pub(crate) const CLAUDE_FIXTURE: &str =
    include_str!("../../tests/fixtures/tool-result-metadata.jsonl");
pub(crate) const CODEX_FIXTURE: &str =
    include_str!("../../tests/fixtures/tool-result-metadata-codex.jsonl");

pub(crate) const CODEX_STRUCTURED_FIXTURE: &str =
    include_str!("../../tests/fixtures/tool-result-metadata-codex-structured.jsonl");

/// The source position, not equal content or a tool ID, specifies the oracle.
pub(crate) fn assert_codex_structured_metadata(page: &Value) {
    let expected = [
        ("use-function", 1, "result-function", 2),
        ("use-custom", 1, "result-custom", 6),
        ("use-replay", 1, "result-replay", 5),
        ("result-orphan", 0, "result-orphan", 7),
        ("result-empty", 0, "result-empty", 9),
        ("result-missing", 0, "result-missing", 10),
    ];
    let records: Vec<Value> = CODEX_STRUCTURED_FIXTURE
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let mut checked = 0;
    for message in page["messages"].as_array().unwrap() {
        for (owner, position, source, line) in expected {
            if message["uuid"] != owner {
                continue;
            }
            let result = &message["content"][position];
            let wrapper: Value =
                serde_json::from_str(records[line]["payload"]["output"].as_str().unwrap()).unwrap();
            assert_eq!(result["type"], "tool_result");
            assert_eq!(result["content"], wrapper["output"]);
            assert_eq!(
                result.get("toolUseResult"),
                Some(&wrapper),
                "source {source}"
            );
            assert_eq!(
                result["toolUseResultSource"],
                json!({
                    "messageUuid":source, "sessionId":"codex-structured",
                    "contentIndex":0, "association":"single_result"
                })
            );
            checked += 1;
        }
        if message["uuid"] == "result-plain" {
            let result = &message["content"][0];
            assert_eq!(result["content"], "Error: stdout only\n");
            assert!(result.get("toolUseResult").is_none());
            assert!(result.get("toolUseResultSource").is_none());
        }
    }
    if page["messages"].as_array().unwrap().len() == 7 {
        assert_eq!(checked, 6, "full fixture must exercise every source result");
    }
}

#[tokio::test]
#[serial_test::serial]
async fn codex_structured_result_metadata_survives_public_api() {
    let home = crate::test_utils::SandboxHome::new();
    let path = home.path().join(".codex/sessions/rollout-structured.jsonl");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, CODEX_STRUCTURED_FIXTURE).unwrap();
    let page = load_provider_messages_paginated(
        "codex".into(),
        path.to_string_lossy().into(),
        None,
        None,
        None,
    )
    .await
    .unwrap();
    assert_eq!(page.total_count, 7);
    assert_codex_structured_metadata(&serde_json::to_value(page).unwrap());
}

#[tokio::test]
#[serial_test::serial]
async fn codex_structured_legacy_response_parity() {
    let home = crate::test_utils::SandboxHome::new();
    let path = home.path().join(".codex/sessions/rollout-structured.jsonl");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, CODEX_STRUCTURED_FIXTURE).unwrap();
    let mut responses = Vec::new();
    responses.push(
        serde_json::to_value(
            super::multi_provider::load_provider_messages(
                "codex".into(),
                path.to_string_lossy().into(),
            )
            .await
            .unwrap(),
        )
        .unwrap(),
    );
    for (offset, limit) in [
        (0, 200),
        (0, 1),
        (1, 2),
        (3, 3),
        (6, 4),
        (7, 2),
        (99, 2),
        (0, 0),
    ] {
        responses.push(
            serde_json::to_value(
                load_provider_messages_paginated(
                    "codex".into(),
                    path.to_string_lossy().into(),
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
    let mut responses = json!(responses);
    for response in responses.as_array_mut().unwrap() {
        let messages = if response.is_array() {
            response.as_array_mut().unwrap()
        } else {
            response["messages"].as_array_mut().unwrap()
        };
        for message in messages {
            for block in message["content"].as_array_mut().unwrap() {
                if block["type"] == "tool_result" {
                    block.as_object_mut().unwrap().remove("toolUseResult");
                    block.as_object_mut().unwrap().remove("toolUseResultSource");
                }
            }
        }
    }
    // Recorded from d63f524d before the provider implementation changed.
    let expected: Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/tool-result-metadata-codex-legacy.json"
    ))
    .unwrap();
    assert_eq!(
        responses, expected,
        "complete legacy responses, only two additive result properties stripped"
    );
}

#[tokio::test]
#[serial_test::serial]
async fn codex_structured_consumer_response_parity() {
    let home = crate::test_utils::SandboxHome::new();
    let path = home.path().join(".codex/sessions/rollout-structured.jsonl");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, CODEX_STRUCTURED_FIXTURE).unwrap();
    std::fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(
            std::fs::FileTimes::new().set_modified(
                std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_759_276_800),
            ),
        )
        .unwrap();
    let sessions = super::multi_provider::load_provider_sessions(
        "codex".into(),
        "codex:///fixture".into(),
        None,
    )
    .await
    .unwrap();
    assert_eq!(sessions.len(), 1);
    let stats =
        super::stats::get_session_token_stats(path.to_string_lossy().into(), None, None, None)
            .await
            .unwrap();
    let mut searches = Vec::new();
    for query in [
        "same",
        "result-function",
        "codex-structured",
        "Output",
        "Error",
    ] {
        for filters in [
            json!({}),
            json!({"hasToolCalls":true}),
            json!({"hasErrors":false}),
        ] {
            let found = crate::providers::codex::search(query, 100, &filters).unwrap();
            searches.push(json!({"query":query,"filters":filters,"messages":found}));
        }
    }
    let mut observed = json!({"sessions":sessions,"stats":stats,"searches":searches});
    fn normalize(value: &mut Value, root: &str) {
        match value {
            Value::String(s) => {
                if let Some(suffix) = s.strip_prefix(root) {
                    *s = format!("$HOME{}", suffix.replace('\\', "/"));
                }
            }
            Value::Array(values) => values.iter_mut().for_each(|v| normalize(v, root)),
            Value::Object(object) => {
                if object.get("type").and_then(Value::as_str) == Some("tool_result") {
                    object.remove("toolUseResult");
                    object.remove("toolUseResultSource");
                }
                for v in object.values_mut() {
                    normalize(v, root);
                }
            }
            _ => {}
        }
    }
    normalize(&mut observed, &home.path().to_string_lossy());
    // Only the sandbox root is substituted; file mtime is fixed above.
    let expected: Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/tool-result-metadata-codex-consumers.json"
    ))
    .unwrap();
    assert_eq!(
        observed, expected,
        "full discovery, filtered-search and stats responses"
    );
}

#[tokio::test]
#[serial_test::serial]
async fn codex_structured_shared_openinterpreter_keeps_legacy_search() {
    struct InterpreterHome(Option<std::ffi::OsString>);
    impl Drop for InterpreterHome {
        fn drop(&mut self) {
            match &self.0 {
                Some(previous) => std::env::set_var("INTERPRETER_HOME", previous),
                None => std::env::remove_var("INTERPRETER_HOME"),
            }
        }
    }
    let home = crate::test_utils::SandboxHome::new();
    let _env = InterpreterHome(std::env::var_os("INTERPRETER_HOME"));
    let root = home.path().join(".openinterpreter");
    let path = root.join("sessions/rollout-structured.jsonl");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::env::set_var("INTERPRETER_HOME", &root);
    std::fs::write(&path, CODEX_STRUCTURED_FIXTURE).unwrap();
    for (offset, limit) in [(0, 200), (0, 1), (1, 2), (3, 3), (6, 4), (7, 2), (99, 2)] {
        let page = load_provider_messages_paginated(
            "openinterpreter".into(),
            path.to_string_lossy().into(),
            Some(offset),
            Some(limit),
            None,
        )
        .await
        .unwrap();
        assert_eq!(page.total_count, 7);
        assert!(page
            .messages
            .iter()
            .all(|message| message.provider.as_deref() == Some("openinterpreter")));
        assert_codex_structured_metadata(&serde_json::to_value(page).unwrap());
    }
    let found = crate::providers::openinterpreter::search("same", 100).unwrap();
    assert_eq!(found.len(), 3);
    assert!(
        crate::providers::openinterpreter::search("result-function", 100)
            .unwrap()
            .is_empty(),
        "source-only metadata must not create new search matches"
    );
}

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
#[serial_test::serial]
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
#[serial_test::serial]
async fn result_metadata_null_keeps_legacy_discovery_search_and_stats() {
    let home = crate::test_utils::SandboxHome::new();
    let claude = home.path().join(".claude");
    let mut observed = Vec::new();
    for (label, raw, expected) in [
        ("missing", None, false),
        ("null", Some(Value::Null), false),
        ("object", Some(json!({})), true),
        ("false", Some(json!(false)), true),
        ("zero", Some(json!(0)), true),
        ("empty", Some(json!("")), true),
    ] {
        let project = claude.join("projects").join(label);
        std::fs::create_dir_all(&project).unwrap();
        let path = project.join("plain.jsonl");
        let mut record = json!({"uuid":label,"sessionId":label,"timestamp":"2026-10-01T00:00:00Z","type":"user","message":{"role":"user","content":format!("needle-{label}")}});
        if let Some(value) = &raw {
            record["toolUseResult"] = value.clone();
        }
        std::fs::write(&path, format!("{record}\n")).unwrap();
        let sessions =
            crate::commands::session::load_project_sessions(project.to_string_lossy().into(), None)
                .await
                .unwrap();
        assert_eq!(sessions.len(), 1);
        let matches = crate::commands::session::search_messages(
            claude.to_string_lossy().into(),
            format!("needle-{label}"),
            json!({"hasToolCalls":true}),
            Some(100),
        )
        .await
        .unwrap();
        // A separate explicit tool record exercises legacy success counting.
        record["uuid"] = json!(format!("stats-{label}"));
        record["toolUse"] = json!({"name":"Synthetic"});
        let stats_path = project.join("stats.jsonl");
        std::fs::write(&stats_path, format!("{record}\n")).unwrap();
        let stats = crate::commands::stats::get_session_token_stats(
            stats_path.to_string_lossy().into(),
            None,
            None,
            None,
        )
        .await
        .unwrap();
        let tool = stats
            .most_used_tools
            .iter()
            .find(|tool| tool.tool_name == "Synthetic")
            .unwrap();
        observed.push((
            label,
            sessions[0].has_tool_use,
            matches.len(),
            tool.success_rate,
            expected,
        ));
    }
    assert_eq!(
        observed,
        vec![
            ("missing", false, 0, 0.0, false),
            ("null", false, 0, 0.0, false),
            ("object", true, 1, 100.0, true),
            ("false", true, 1, 100.0, true),
            ("zero", true, 1, 100.0, true),
            ("empty", true, 1, 100.0, true)
        ],
        "raw null preservation must not change legacy discovery/search/numeric semantics"
    );
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
