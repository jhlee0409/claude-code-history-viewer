//! oh-my-pi (`omp`, <https://github.com/can1357/oh-my-pi>) — a fork of
//! badlogic's `pi` that stores sessions under
//! `~/.omp/agent/sessions/<escaped-cwd>/<timestamp>_<sessionId>.jsonl`.
//!
//! OMP retains Pi's version-3 message tree while extending it with a mutable
//! title slot, title audit entries, standalone model usage, service-tier and
//! harness metadata, reset boundaries, and additional custom message types.
//! This module registers the OMP store over the format-aware shared parser.

use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::providers::pi::{
    base_path_of, detect_store, load_messages_of, load_sessions_of, load_stats_messages_of,
    scan_store, search_store, PiStore,
};
use crate::providers::ProviderInfo;

const OMPI_STORE: PiStore = PiStore {
    id: "ompi",
    display_name: "oh-my-pi",
    dot_dir: ".omp",
};

/// Detect an oh-my-pi installation.
pub fn detect() -> Option<ProviderInfo> {
    detect_store(&OMPI_STORE)
}

/// Base path (`~/.omp/agent/sessions`), for the file watcher.
pub fn get_base_path() -> Option<String> {
    base_path_of(&OMPI_STORE)
}

/// Scan oh-my-pi projects at the default store root (`~/.omp/agent/sessions`).
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    Ok(scan_store(&OMPI_STORE))
}

/// Load the sessions in one oh-my-pi project directory.
pub fn load_sessions(
    project_path: &str,
    exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    load_sessions_of(&OMPI_STORE, project_path, exclude_sidechain)
}

/// Load all messages from one oh-my-pi session file.
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    load_messages_of(&OMPI_STORE, session_path)
}

/// Load transcript messages plus non-transcript model calls for statistics.
pub fn load_stats_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    load_stats_messages_of(&OMPI_STORE, session_path)
}

/// Search across all oh-my-pi sessions.
pub fn search(query: &str, max_results: usize) -> Result<Vec<ClaudeMessage>, String> {
    Ok(search_store(&OMPI_STORE, query, max_results))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use serial_test::serial;
    use std::fs;

    const SESSION: &str = concat!(
        r#"{"type":"title","v":1,"title":"Current OMP title","updatedAt":"2026-06-03T15:00:00.000Z","pad":""}"#,
        "\n",
        r#"{"type":"session","version":3,"id":"omp-1","timestamp":"2026-06-03T14:57:13.623Z","cwd":"/Users/ac/dev/omp-fixture","title":"Stale header title","titleSource":"auto"}"#,
        "\n",
        r#"{"type":"model_change","id":"m1","parentId":null,"timestamp":"2026-06-03T14:57:14.649Z","model":"anthropic/claude-opus-4-8"}"#,
        "\n",
        r#"{"type":"title_change","id":"title1","parentId":"m1","timestamp":"2026-06-03T14:57:20.000Z","title":"Current OMP title","previousTitle":"Stale header title","source":"user"}"#,
        "\n",
        r#"{"type":"message","id":"u1","parentId":"title1","timestamp":"2026-06-03T14:57:24.001Z","message":{"role":"user","content":"hello omp","timestamp":1748962644001}}"#,
        "\n",
        r#"{"type":"custom","id":"c1","parentId":"u1","timestamp":"2026-06-03T14:57:25.000Z","customType":"tool_execution_start","data":{}}"#,
        "\n",
        r#"{"type":"custom_message","id":"hidden1","parentId":"c1","timestamp":"2026-06-03T14:57:26.000Z","customType":"internal","content":"do not render","display":false}"#,
        "\n",
        r#"{"type":"custom_message","id":"visible1","parentId":"hidden1","timestamp":"2026-06-03T14:57:27.000Z","customType":"async-result","content":[{"type":"text","text":"background job finished"}],"display":true}"#,
        "\n",
        r#"{"type":"thinking_level_change","id":"t1","parentId":"visible1","timestamp":"2026-06-03T14:57:28.000Z","thinkingLevel":"high"}"#,
        "\n",
        r#"{"type":"message","id":"d1","parentId":"t1","timestamp":"2026-06-03T14:57:29.000Z","message":{"role":"developer","content":"system reminder","timestamp":1748962649001}}"#,
        "\n",
        r#"{"type":"message","id":"a1","parentId":"d1","timestamp":"2026-06-03T14:57:30.000Z","message":{"role":"assistant","content":[{"type":"text","text":"first answer"}],"model":"claude-opus-4-8","usage":{"input":10,"output":5,"cacheRead":0,"cacheWrite":0,"totalTokens":15,"cost":{"total":0.001}},"stopReason":"stop","timestamp":1748962650001}}"#,
        "\n",
        r#"{"type":"compaction","id":"cmp1","parentId":"a1","timestamp":"2026-06-03T14:58:00.000Z","summary":"Earlier work summarized","shortSummary":"Earlier work","firstKeptEntryId":"d1","tokensBefore":50000,"tokensAfter":12000,"method":"threshold"}"#,
        "\n",
        r#"{"type":"credential_pin","id":"pin1","parentId":"cmp1","timestamp":"2026-06-03T14:58:01.000Z","provider":"anthropic","credentialId":"cred-1"}"#,
        "\n",
        r#"{"type":"message","id":"u2","parentId":"pin1","timestamp":"2026-06-03T14:58:02.000Z","message":{"role":"user","content":"continue","timestamp":1748962682001}}"#,
        "\n",
        r#"{"type":"branch_summary","id":"branch1","parentId":"u2","timestamp":"2026-06-03T14:58:03.000Z","fromId":"a1","summary":"Alternate branch context"}"#,
        "\n",
        r#"{"type":"model_usage","id":"usage1","parentId":"branch1","timestamp":"2026-06-03T14:58:04.000Z","purpose":"auto-thinking","role":"smol","api":"anthropic-messages","provider":"anthropic","model":"claude-haiku-4-5","usage":{"input":255,"output":4,"cacheRead":0,"cacheWrite":0,"totalTokens":259,"cost":{"total":0.0003}},"stopReason":"stop"}"#,
        "\n",
        r#"{"type":"custom","id":"c2","parentId":"usage1","timestamp":"2026-06-03T14:58:05.000Z","customType":"tool_execution_start","data":{}}"#,
        "\n",
        r#"{"type":"message","id":"a2","parentId":"c2","timestamp":"2026-06-03T14:58:06.000Z","message":{"role":"assistant","content":[{"type":"text","text":"second answer"}],"model":"claude-opus-4-8","stopReason":"stop","timestamp":1748962686001}}"#,
        "\n",
    );

    /// The production path must preserve OMP-specific transcript semantics,
    /// while the stats path additionally exposes non-transcript model calls.
    #[test]
    #[serial]
    fn ompi_reads_omp_store_and_stamps_provider_id() {
        let home = crate::test_utils::SandboxHome::new();
        let dir = home
            .path()
            .join(".omp")
            .join("agent")
            .join("sessions")
            .join("-Users-ac-dev-omp-fixture");
        fs::create_dir_all(&dir).expect("create fixture dir");
        let file = dir.join("2026-06-03T14-57-13-623Z_omp-1.jsonl");
        fs::write(&file, SESSION).expect("write fixture session");

        let projects = scan_projects().expect("scan_projects must not error");
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].provider.as_deref(), Some("ompi"));
        assert_eq!(projects[0].actual_path, "/Users/ac/dev/omp-fixture");

        let sessions =
            load_sessions(&dir.to_string_lossy(), false).expect("load_sessions must not error");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].provider.as_deref(), Some("ompi"));
        assert_eq!(sessions[0].summary.as_deref(), Some("Current OMP title"));
        assert!(sessions[0].is_renamed);
        assert_eq!(sessions[0].message_count, 5);

        let messages =
            load_messages(&file.to_string_lossy()).expect("load_messages must not error");
        assert_eq!(
            messages
                .iter()
                .map(|message| (message.uuid.as_str(), message.parent_uuid.as_deref()))
                .collect::<Vec<_>>(),
            vec![
                ("u1", None),
                ("visible1", Some("u1")),
                ("d1", Some("visible1")),
                ("a1", Some("d1")),
                ("cmp1", Some("a1")),
                ("u2", Some("cmp1")),
                ("branch1", Some("u2")),
                ("a2", Some("branch1")),
            ]
        );
        assert!(messages
            .iter()
            .all(|message| message.provider.as_deref() == Some("ompi")));
        assert_eq!(messages[1].subtype.as_deref(), Some("async-result"));
        assert_eq!(messages[2].message_type, "system");
        assert_eq!(messages[2].subtype.as_deref(), Some("system_prompt"));
        assert_eq!(messages[4].subtype.as_deref(), Some("compact_boundary"));
        assert_eq!(
            messages[4].content.as_ref().and_then(Value::as_str),
            Some("Earlier work summarized")
        );
        assert_eq!(
            messages[4].compact_metadata.as_ref().unwrap()["preTokens"],
            50000
        );
        assert_eq!(
            messages[4].compact_metadata.as_ref().unwrap()["postTokens"],
            12000
        );
        assert_eq!(messages[6].message_type, "summary");

        let stats = load_stats_messages(&file.to_string_lossy()).expect("load stats messages");
        assert_eq!(stats.len(), 6);
        let auxiliary = stats
            .iter()
            .find(|message| message.message_type == "model_usage")
            .expect("standalone model usage");
        assert_eq!(auxiliary.model.as_deref(), Some("claude-haiku-4-5"));
        assert_eq!(auxiliary.usage.as_ref().unwrap().input_tokens, Some(255));
        assert_eq!(auxiliary.cost_usd, Some(0.0003));
    }
}
