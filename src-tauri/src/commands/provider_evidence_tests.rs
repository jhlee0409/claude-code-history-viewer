//! Family-specific raw evidence → public commands; complete legacy snapshots.
#[tokio::test]
#[serial_test::serial]
async fn family_openhands_merged_replayed_calls_keep_observation_ownership() {
    let home = crate::test_utils::SandboxHome::new();
    let events =
        crate::test_utils::native_fixture_path(home.path(), ".openhands/sessions/linked/events");
    std::fs::create_dir_all(&events).unwrap();
    let records = json!([
        {"id":0,"action":"message","source":"user","args":{"content":"fixture"}},
        {"id":99,"action":"run","source":"agent","args":{"command":"first"}},
        {"id":100,"action":"run","source":"agent","args":{"command":"parallel"}},
        {"id":1,"observation":"run","cause":100,"content":"same","extras":{"metadata":{"exit_code":0}}},
        {"id":2,"observation":"run","cause":99,"content":"same","extras":null},
        {"id":99,"action":"run","source":"agent","args":{"command":"replayed"}},
        {"id":3,"observation":"run","cause":99,"content":"same","extras":{"metadata":{"exit_code":2}}},
        {"id":4,"observation":"run","cause":404,"content":"same","extras":false}
    ]);
    for (i, record) in records.as_array().unwrap().iter().enumerate() {
        std::fs::write(events.join(format!("{i}.json")), record.to_string()).unwrap();
    }
    let full = load_provider_messages("openhands".into(), "openhands://linked".into())
        .await
        .unwrap();
    assert_eq!(full.len(), 5);
    for (owner, position, ordinal) in [(1, 1, 4), (2, 1, 3), (3, 1, 6), (4, 0, 7)] {
        let message = serde_json::to_value(&full[owner]).unwrap();
        let result = &message["content"][position];
        assert_eq!(result["content"], "same");
        assert_eq!(result.get("toolUseResult"), records[ordinal].get("extras"));
        assert_eq!(
            result["toolUseResultSource"],
            json!({"messageUuid":format!("linked-{}",records[ordinal]["id"]),"sessionId":"linked","contentIndex":0,"association":"single_result"})
        );
    }
    for (offset, limit) in [(0, 1), (1, 2), (2, 2), (4, 3), (5, 2), (99, 1)] {
        let page = load_provider_messages_paginated(
            "openhands".into(),
            "openhands://linked".into(),
            Some(offset),
            Some(limit),
            None,
        )
        .await
        .unwrap();
        let end = full.len().saturating_sub(offset);
        let start = end.saturating_sub(limit);
        assert_eq!(
            serde_json::to_value(page.messages).unwrap(),
            serde_json::to_value(&full[start..end]).unwrap()
        );
    }
}

#[tokio::test]
#[serial_test::serial]
async fn family_pi_merged_replayed_calls_keep_result_ownership() {
    let home = crate::test_utils::SandboxHome::new();
    for provider in ["pi", "ompi"] {
        let (path, _) = pi_fixture(home.path(), provider);
        let records = json!([
            {"type":"session","version":3,"id":"linked-pi","cwd":"/fixture"},
            {"type":"message","id":"first","message":{"role":"assistant","content":[{"type":"toolCall","id":"duplicate","name":"bash","arguments":{}},{"type":"toolCall","id":"parallel","name":"bash","arguments":{}}]}},
            {"type":"message","id":"r1","parentId":"first","message":{"role":"toolResult","toolCallId":"parallel","content":"same","details":null}},
            {"type":"message","id":"r2","parentId":"r1","message":{"role":"toolResult","toolCallId":"duplicate","content":"same","details":false}},
            {"type":"compaction","id":"compact","parentId":"r2","summary":"fixture summary"},
            {"type":"message","id":"replay","parentId":"compact","message":{"role":"assistant","content":[{"type":"toolCall","id":"duplicate","name":"bash","arguments":{}}]}},
            {"type":"message","id":"r3","parentId":"replay","message":{"role":"toolResult","toolCallId":"duplicate","content":"same","details":0}},
            {"type":"message","id":"orphan","parentId":"r3","message":{"role":"toolResult","toolCallId":"unknown","content":"same","details":""}}
        ]);
        let mut data = String::new();
        for record in records.as_array().unwrap() {
            data.push_str(&record.to_string());
            data.push('\n');
        }
        std::fs::write(&path, data).unwrap();
        let full = load_provider_messages(provider.into(), path.clone())
            .await
            .unwrap();
        assert_eq!(full.len(), 4);
        for (owner, position, ordinal) in [(0, 2, 2), (0, 3, 3), (2, 1, 6), (3, 0, 7)] {
            let message = serde_json::to_value(&full[owner]).unwrap();
            let result = &message["content"][position];
            assert_eq!(result.get("toolUseResult"), records[ordinal].get("message"));
            assert_eq!(
                result["toolUseResultSource"],
                json!({"messageUuid":records[ordinal]["id"],"sessionId":"linked-pi","contentIndex":0,"association":"single_result"})
            );
        }
        for (offset, limit) in [(0, 1), (1, 2), (2, 2), (4, 3), (99, 1)] {
            let page = load_provider_messages_paginated(
                provider.into(),
                path.clone(),
                Some(offset),
                Some(limit),
                None,
            )
            .await
            .unwrap();
            let end = full.len().saturating_sub(offset);
            let start = end.saturating_sub(limit);
            assert_eq!(
                serde_json::to_value(page.messages).unwrap(),
                serde_json::to_value(&full[start..end]).unwrap()
            );
        }
    }
}

pub(crate) fn assert_pi_bash(page: &Value) {
    let records: Vec<Value> = include_str!("../../tests/fixtures/tool-result-evidence-pi.jsonl")
        .lines()
        .map(|s| serde_json::from_str(s).unwrap())
        .collect();
    for message in page["messages"].as_array().unwrap() {
        let uuid = message["uuid"].as_str().unwrap();
        if let Some(i) = uuid.strip_prefix("bash-") {
            let ordinal: usize = i.parse().unwrap();
            let raw = &records[ordinal + 10]["message"];
            assert_eq!(
                message["sourceExecution"],
                json!({"messageUuid":uuid,"sessionId":"pi-evidence","association":"local_execution","message":raw})
            );
            assert_eq!(message["type"], "system");
            assert_eq!(message["subtype"], "bash_execution");
            assert!(
                message["content"].is_string(),
                "local ! command must not become a synthetic tool result"
            );
            assert!(message["toolUseResult"].is_null());
        } else {
            assert!(message.get("sourceExecution").is_none());
        }
    }
}

#[tokio::test]
#[serial_test::serial]
async fn family_pi_bash_execution_preserves_raw_not_tool_result() {
    let home = crate::test_utils::SandboxHome::new();
    for provider in ["pi", "ompi"] {
        let (path, _) = pi_fixture(home.path(), provider);
        let page = load_provider_messages_paginated(provider.into(), path, None, None, None)
            .await
            .unwrap();
        assert_eq!(
            page.messages
                .iter()
                .filter(|m| m.uuid.starts_with("bash-"))
                .count(),
            6
        );
        assert_pi_bash(&serde_json::to_value(page).unwrap());
    }
}

pub(crate) fn pi_fixture(home: &Path, provider: &str) -> (String, String) {
    let project = crate::test_utils::native_fixture_path(
        home,
        if provider == "pi" {
            ".pi/agent/sessions/--fixture--"
        } else {
            ".omp/agent/sessions/--fixture--"
        },
    );
    std::fs::create_dir_all(&project).unwrap();
    let path = project.join("evidence.jsonl");
    std::fs::write(
        &path,
        include_str!("../../tests/fixtures/tool-result-evidence-pi.jsonl"),
    )
    .unwrap();
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
    (
        path.to_string_lossy().into(),
        project.to_string_lossy().into(),
    )
}

pub(crate) fn assert_pi_results(page: &Value) {
    let records: Vec<Value> = include_str!("../../tests/fixtures/tool-result-evidence-pi.jsonl")
        .lines()
        .map(|s| serde_json::from_str(s).unwrap())
        .collect();
    for message in page["messages"].as_array().unwrap() {
        let uuid = message["uuid"].as_str().unwrap();
        if let Some(i) = uuid.strip_prefix("result-") {
            let ordinal: usize = i.parse().unwrap();
            let result = &message["content"][0];
            assert_eq!(result["type"], "tool_result");
            assert_eq!(
                result.get("toolUseResult"),
                Some(&records[ordinal + 2]["message"])
            );
            assert_eq!(
                result["toolUseResultSource"],
                json!({"messageUuid":uuid,"sessionId":"pi-evidence","contentIndex":0,"association":"single_result"})
            );
            assert!(
                result["toolUseResult"].get("exitCode").is_none(),
                "do not fabricate a standard exit field from details or prose"
            );
        }
    }
}

#[tokio::test]
#[serial_test::serial]
async fn family_pi_preserves_tool_result_message() {
    let home = crate::test_utils::SandboxHome::new();
    for provider in ["pi", "ompi"] {
        let (path, _) = pi_fixture(home.path(), provider);
        let page = load_provider_messages_paginated(provider.into(), path, None, None, None)
            .await
            .unwrap();
        assert_eq!(page.total_count, 15);
        assert_eq!(
            page.messages
                .iter()
                .filter(|m| m.uuid.starts_with("result-"))
                .count(),
            8
        );
        assert_pi_results(&serde_json::to_value(page).unwrap());
    }
}

#[tokio::test]
#[serial_test::serial]
async fn family_pi_fixture_spelling_matches_discovery() {
    let home = crate::test_utils::SandboxHome::new();
    // A redundant component reproduces the same string-identity mismatch on
    // Unix as mixed separators do on Windows. Do not change the stats resolver
    // to make a malformed fixture match a discovered session.
    let fixture_home = home.path().join(".");
    let mut observed = Vec::new();
    for provider in ["pi", "ompi"] {
        let (path, project) = pi_fixture(&fixture_home, provider);
        observed.push(responses(provider, &path, &project, home.path()).await);
    }
    let expected: Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/tool-result-evidence-pi-legacy.json"
    ))
    .unwrap();
    assert_eq!(
        json!(observed),
        expected,
        "whole responses with native fixture paths"
    );
}

#[tokio::test]
#[serial_test::serial]
async fn family_pi_legacy_consumers() {
    let home = crate::test_utils::SandboxHome::new();
    let mut observed = Vec::new();
    for provider in ["pi", "ompi"] {
        let (path, project) = pi_fixture(home.path(), provider);
        observed.push(responses(provider, &path, &project, home.path()).await);
    }
    let observed = json!(observed);
    let expected: Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/tool-result-evidence-pi-legacy.json"
    ))
    .unwrap();
    assert_eq!(
        observed, expected,
        "whole Pi/OMP legacy responses and consumers"
    );
}

pub(crate) struct StoreEnv(Vec<(String, Option<std::ffi::OsString>)>);
impl StoreEnv {
    fn set(key: &str, value: &Path) -> Self {
        let old = std::env::var_os(key);
        std::env::set_var(key, value);
        Self(vec![(key.into(), old)])
    }
}
impl Drop for StoreEnv {
    fn drop(&mut self) {
        for (key, value) in &self.0 {
            match value {
                Some(v) => std::env::set_var(key, v),
                None => std::env::remove_var(key),
            }
        }
    }
}

pub(crate) fn opencode_fixture(
    home: &Path,
    provider: &str,
    sqlite: bool,
) -> (String, String, StoreEnv) {
    let root = crate::test_utils::native_fixture_path(
        home,
        &format!(
            ".local/share/{provider}-{}",
            if sqlite { "sqlite" } else { "json" }
        ),
    );
    std::fs::create_dir_all(&root).unwrap();
    let env = StoreEnv::set(
        if provider == "kilo" {
            "KILO_HOME"
        } else {
            "OPENCODE_HOME"
        },
        &root,
    );
    let parts: Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/tool-result-evidence-opencode.json"
    ))
    .unwrap();
    let message = json!({"id":"msg_001","role":"assistant","time":{"created":1759276800000_u64},"tokens":{"input":10,"output":5},"cost":0.1});
    if sqlite {
        let conn =
            crate::providers::kilo::test_support::create_db(&root.join(if provider == "kilo" {
                "kilo.db"
            } else {
                "opencode.db"
            }));
        conn.execute("INSERT INTO project (id,worktree,name,time_created,time_updated) VALUES ('proj1','/fixture','fixture',1759276800000,1759276800000)",[]).unwrap();
        conn.execute("INSERT INTO session (id,project_id,title,directory,time_created,time_updated) VALUES ('ses_001','proj1','fixture','/fixture',1759276800000,1759276800000)",[]).unwrap();
        conn.execute(
            "INSERT INTO message VALUES ('msg_001','ses_001',1759276800000,1759276800000,?1)",
            [message.to_string()],
        )
        .unwrap();
        for (i, part) in parts.as_array().unwrap().iter().enumerate() {
            conn.execute(
                "INSERT INTO part VALUES (?1,'msg_001','ses_001',1759276800000,1759276800000,?2)",
                rusqlite::params![format!("part_{i:02}"), part.to_string()],
            )
            .unwrap();
        }
    } else {
        for (path, value) in [
            (
                "session/proj1/ses_001.json",
                json!({"id":"ses_001","projectID":"proj1","title":"fixture","directory":"/fixture","time":{"created":1759276800000_u64,"updated":1759276800000_u64}}),
            ),
            ("message/ses_001/msg_001.json", message),
        ] {
            let path = crate::test_utils::native_fixture_path(&root.join("storage"), path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, value.to_string()).unwrap();
        }
        let dir = crate::test_utils::native_fixture_path(&root, "storage/part/msg_001");
        std::fs::create_dir_all(&dir).unwrap();
        for (i, part) in parts.as_array().unwrap().iter().enumerate() {
            std::fs::write(dir.join(format!("part_{i:02}.json")), part.to_string()).unwrap();
        }
    }
    (
        format!("{provider}://proj1/ses_001"),
        format!("{provider}://proj1"),
        env,
    )
}

pub(crate) fn assert_opencode(page: &Value) {
    let raw: Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/tool-result-evidence-opencode.json"
    ))
    .unwrap();
    for message in page["messages"].as_array().unwrap() {
        assert_eq!(message["uuid"], "msg_001");
        let blocks = message["content"].as_array().unwrap();
        for (position, ordinal) in [(2, 1), (4, 2), (6, 3), (8, 4), (13, 8)] {
            let result = &blocks[position];
            assert_eq!(result["type"], "tool_result");
            assert_eq!(result.get("toolUseResult"), raw[ordinal].get("state"));
            assert_eq!(
                result["toolUseResultSource"],
                json!({"messageUuid":"msg_001","sessionId":"ses_001","contentIndex":position,"association":"single_result","partIndex":ordinal})
            );
        }
        assert_eq!(
            blocks.iter().filter(|b| b["type"] == "tool_result").count(),
            5
        );
        for block in blocks.iter().filter(|b| b["type"] != "tool_result") {
            assert!(block.get("toolUseResult").is_none());
        }
    }
}

#[tokio::test]
#[serial_test::serial]
async fn family_opencode_preserves_exact_part_state() {
    let home = crate::test_utils::SandboxHome::new();
    for (provider, sqlite) in [("opencode", false), ("opencode", true), ("kilo", true)] {
        let (path, _, _env) = opencode_fixture(home.path(), provider, sqlite);
        let page = load_provider_messages_paginated(provider.into(), path, None, None, None)
            .await
            .unwrap();
        assert_eq!(page.total_count, 1);
        assert_opencode(&serde_json::to_value(page).unwrap());
    }
}

#[tokio::test]
#[serial_test::serial]
async fn family_opencode_legacy_consumers() {
    let home = crate::test_utils::SandboxHome::new();
    let mut observed = Vec::new();
    for (provider, sqlite) in [("opencode", false), ("opencode", true), ("kilo", true)] {
        let (path, project, _env) = opencode_fixture(home.path(), provider, sqlite);
        observed.push(responses(provider, &path, &project, home.path()).await);
    }
    let observed = json!(observed);
    let expected: Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/tool-result-evidence-opencode-legacy.json"
    ))
    .unwrap();
    assert_eq!(
        observed, expected,
        "whole legacy responses: JSON / SQLite / Kilo"
    );
}
use super::multi_provider::{
    load_provider_messages, load_provider_messages_paginated, load_provider_sessions,
    search_all_providers,
};
use serde_json::{json, Value};
use std::path::Path;

pub(crate) fn openhands_fixture(home: &Path) -> String {
    let events =
        crate::test_utils::native_fixture_path(home, ".openhands/sessions/evidence/events");
    std::fs::create_dir_all(&events).unwrap();
    let fixture: Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/tool-result-evidence-openhands.json"
    ))
    .unwrap();
    for (i, record) in fixture.as_array().unwrap().iter().enumerate() {
        std::fs::write(events.join(format!("{i}.json")), record.to_string()).unwrap();
    }
    "openhands://evidence".into()
}

pub(crate) fn assert_openhands(page: &Value) {
    let records: Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/tool-result-evidence-openhands.json"
    ))
    .unwrap();
    let mut checked = 0;
    for message in page["messages"].as_array().unwrap() {
        for result in message["content"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|b| b["type"] == "tool_result")
        {
            // Independent source ordinal: the result source owns its payload,
            // even with repeated cause IDs and identical output.
            let source = message["uuid"].as_str().unwrap();
            let ordinal: usize = source.strip_prefix("evidence-").unwrap().parse().unwrap();
            let raw = &records[ordinal];
            assert_eq!(result.get("toolUseResult"), raw.get("extras"));
            if raw.get("extras").is_some() {
                assert_eq!(
                    result["toolUseResultSource"],
                    json!({"messageUuid":source,"sessionId":"evidence","contentIndex":0,"association":"single_result"})
                );
            } else {
                assert!(result.get("toolUseResultSource").is_none());
            }
            checked += 1;
        }
    }
    if page["messages"].as_array().unwrap().len() == 10 {
        assert_eq!(checked, 9);
    }
}

pub(crate) fn strip_additions(value: &mut Value) {
    match value {
        Value::Array(values) => values.iter_mut().for_each(strip_additions),
        Value::Object(object) => {
            // Strip only declared transport additions at actual message/result locations,
            // never same-named properties inside arbitrary recorded JSON.
            if object.contains_key("uuid")
                && object.contains_key("sessionId")
                && object.contains_key("provider")
            {
                if object.get("subtype").and_then(Value::as_str) == Some("bash_execution") {
                    object.remove("sourceExecution");
                }
                if let Some(blocks) = object.get_mut("content").and_then(Value::as_array_mut) {
                    for block in blocks {
                        if block["type"] == "tool_result" {
                            block.as_object_mut().unwrap().remove("toolUseResult");
                            block.as_object_mut().unwrap().remove("toolUseResultSource");
                        }
                    }
                }
            } else {
                for v in object.values_mut() {
                    strip_additions(v);
                }
            }
        }
        _ => {}
    }
}

fn normalize_root(value: &mut Value, home: &str) {
    match value {
        Value::String(s) => {
            if let Some(suffix) = s.strip_prefix(home) {
                *s = format!("$HOME{}", suffix.replace('\\', "/"));
            }
        }
        Value::Array(values) => values.iter_mut().for_each(|v| normalize_root(v, home)),
        Value::Object(object) => object.values_mut().for_each(|v| normalize_root(v, home)),
        _ => {}
    }
}

#[test]
fn family_root_normalization_keeps_embedded_and_json_escaped_paths() {
    for (home, path) in [
        ("/sandbox", "/sandbox/.pi/agent/sessions/evidence.jsonl"),
        (
            r"C:\sandbox",
            r"C:\sandbox\.pi\agent\sessions\evidence.jsonl",
        ),
    ] {
        let embedded = format!("see {path}\n\u{1b}[31mError\u{1b}[0m\n");
        let encoded = serde_json::to_string(&json!({"path":path})).unwrap();
        let double_encoded = serde_json::to_string(&encoded).unwrap();
        let mut observed = json!({
            "path":path,
            "messages":[{"content":embedded,"json":encoded,"nestedJson":double_encoded}],
            "flags":[null,false,0,"",[]]
        });
        normalize_root(&mut observed, home);
        assert_eq!(
            observed,
            json!({
                "path":"$HOME/.pi/agent/sessions/evidence.jsonl",
                "messages":[{"content":embedded,"json":encoded,"nestedJson":double_encoded}],
                "flags":[null,false,0,"",[]]
            }),
            "only standalone sandbox-root paths may change"
        );
    }
}

async fn responses(provider: &str, path: &str, project: &str, home: &Path) -> Value {
    let mut pages = vec![serde_json::to_value(
        load_provider_messages(provider.into(), path.into())
            .await
            .unwrap(),
    )
    .unwrap()];
    for (offset, limit) in [
        (0, 200),
        (0, 1),
        (1, 2),
        (3, 3),
        (6, 4),
        (9, 2),
        (99, 2),
        (0, 0),
    ] {
        pages.push(
            serde_json::to_value(
                load_provider_messages_paginated(
                    provider.into(),
                    path.into(),
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
    let sessions = load_provider_sessions(provider.into(), project.into(), Some(false))
        .await
        .unwrap();
    assert_eq!(sessions.len(), 1, "fixture must be discoverable");
    let stats = super::stats::get_session_token_stats(path.into(), None, None, None).await;
    let mut searches = Vec::new();
    for query in [
        "same",
        "evidence-only-needle",
        "Error",
        "cancelled",
        "evidence",
    ] {
        for filters in [
            json!({}),
            json!({"hasToolCalls":true}),
            json!({"hasErrors":true}),
            json!({"hasErrors":false}),
        ] {
            let found = search_all_providers(
                None,
                query.into(),
                Some(vec![provider.into()]),
                None,
                Some(filters.clone()),
                Some(100),
                None,
                Some(false),
                None,
            )
            .await
            .unwrap();
            searches.push(json!({"query":query,"filters":filters,"messages":found}));
        }
    }
    let mut observed =
        json!({"responses":pages,"sessions":sessions,"stats":stats,"searches":searches});
    strip_additions(&mut observed);
    normalize_root(&mut observed, &home.to_string_lossy());
    observed
}

#[tokio::test]
#[serial_test::serial]
async fn family_openhands_preserves_source_observation() {
    let home = crate::test_utils::SandboxHome::new();
    let path = openhands_fixture(home.path());
    let page = load_provider_messages_paginated("openhands".into(), path, None, None, None)
        .await
        .unwrap();
    assert_eq!(page.total_count, 10);
    assert_openhands(&serde_json::to_value(page).unwrap());
}

#[tokio::test]
#[serial_test::serial]
async fn family_openhands_legacy_consumers() {
    let home = crate::test_utils::SandboxHome::new();
    let path = openhands_fixture(home.path());
    let observed = responses("openhands", &path, "openhands://__workspace__", home.path()).await;
    let expected: Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/tool-result-evidence-openhands-legacy.json"
    ))
    .unwrap();
    assert_eq!(
        observed, expected,
        "whole legacy response / discovery / filtered search / stats"
    );
}
