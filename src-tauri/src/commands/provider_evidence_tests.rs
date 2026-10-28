//! Family-specific raw evidence → public commands; complete legacy snapshots.
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
    let root = home.join(format!(
        ".local/share/{provider}-{}",
        if sqlite { "sqlite" } else { "json" }
    ));
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
            let path = root.join("storage").join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, value.to_string()).unwrap();
        }
        let dir = root.join("storage/part/msg_001");
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
    let events = home.join(".openhands/sessions/evidence/events");
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
            if object.get("type").and_then(Value::as_str) == Some("tool_result") {
                object.remove("toolUseResult");
                object.remove("toolUseResultSource");
            }
            for v in object.values_mut() {
                strip_additions(v);
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
