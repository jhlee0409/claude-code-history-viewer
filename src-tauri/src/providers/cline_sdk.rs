//! Cline's SDK-era session store, read by the `cline` provider (#582).
//!
//! Current Cline releases — the VS Code extension included — no longer keep
//! tasks under the editor's `globalStorage`. Each session is a directory under
//! the Cline data dir:
//!
//! ```text
//! ~/.cline/data/sessions/<sessionId>/
//!   <sessionId>.json             manifest: cwd, title, timestamps, model
//!   <sessionId>.messages.json    canonical transcript (contract v1)
//!   <sessionId>.compaction.json  compacted model context — skipped (duplicate)
//!   <agentId>.messages.json      subagent / team-task transcripts — skipped
//! ```
//!
//! The transcript format is specified upstream in
//! `sdk/packages/core/docs/messages-contract-v1.md` (cline/cline): content
//! blocks are already Anthropic-native (`text`, `thinking`, `tool_use`,
//! `tool_result`), and the terminal assistant message of each turn carries
//! `modelInfo` and `metrics` (tokens and cost).
//!
//! Paths from this store are `cline://sdk:<cwd>` (projects) and
//! `cline://sdk:<sessionId>` (sessions). The store root is resolved at call
//! time rather than carried in the path, so Windows drive colons never have to
//! be parsed back out of it.

use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession, TokenUsage};
use crate::utils::{build_provider_message, is_symlink, search_json_value_case_insensitive};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Scheme prefix for projects and sessions that live in this store.
pub(super) const PREFIX: &str = "cline://sdk:";

const PROVIDER_ID: &str = "cline";
const SUMMARY_MAX_CHARS: usize = 100;

/// The Cline data dir, resolved the way upstream `paths.ts` does:
/// `CLINE_DATA_DIR`, else `CLINE_DIR/data`, else `<home>/.cline/data`.
fn data_dir() -> Option<PathBuf> {
    if let Some(dir) = env_dir("CLINE_DATA_DIR") {
        return Some(dir);
    }
    if let Some(dir) = env_dir("CLINE_DIR") {
        return Some(dir.join("data"));
    }
    crate::utils::home_dir().map(|home| home.join(".cline").join("data"))
}

fn env_dir(key: &str) -> Option<PathBuf> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// The sessions root (`CLINE_SESSION_DATA_DIR`, else `<data dir>/sessions`),
/// when it exists as a real directory.
pub(super) fn sessions_dir() -> Option<PathBuf> {
    let dir = env_dir("CLINE_SESSION_DATA_DIR").or_else(|| Some(data_dir()?.join("sessions")))?;
    (dir.is_dir() && !is_symlink(&dir)).then_some(dir)
}

/// Upstream session ids are `<epoch ms>_<nanoid>`; anything else is rejected
/// before it is joined into a path.
fn is_valid_session_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// The fields of `<id>.json` this reader uses.
struct Manifest {
    id: String,
    cwd: String,
    title: Option<String>,
    started_at: Option<String>,
    ended_at: Option<String>,
}

fn read_manifest(session_dir: &Path, id: &str) -> Option<Manifest> {
    let path = session_dir.join(format!("{id}.json"));
    if !path.is_file() || is_symlink(&path) {
        return None;
    }
    let value: Value = serde_json::from_str(&fs::read_to_string(&path).ok()?).ok()?;
    let text = |v: Option<&Value>| {
        v.and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
    };
    Some(Manifest {
        id: id.to_string(),
        cwd: text(value.get("cwd"))
            .or_else(|| text(value.get("workspace_root")))
            .unwrap_or_else(|| "unknown".to_string()),
        title: text(value.pointer("/metadata/title")),
        started_at: text(value.get("started_at")),
        ended_at: text(value.get("ended_at")),
    })
}

/// Every session in the store that has a readable manifest.
fn read_manifests(root: &Path) -> Vec<Manifest> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let id = entry.file_name().to_str()?.to_string();
            let dir = entry.path();
            if !is_valid_session_id(&id) || is_symlink(&dir) || !dir.is_dir() {
                return None;
            }
            read_manifest(&dir, &id)
        })
        .collect()
}

/// The lead transcript of a session; subagent and team-task transcripts in the
/// same directory are other files and are never opened here.
fn read_transcript(root: &Path, id: &str) -> Result<Vec<Value>, String> {
    if !is_valid_session_id(id) {
        return Err(format!("Invalid Cline session id: {id}"));
    }
    let session_dir = root.join(id);
    let path = session_dir.join(format!("{id}.messages.json"));
    if is_symlink(&session_dir) || is_symlink(&path) || !path.is_file() {
        return Err(format!("Cline transcript not found for session {id}"));
    }
    let data =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read Cline transcript: {e}"))?;
    let value: Value = serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse Cline transcript: {e}"))?;
    Ok(value
        .get("messages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default())
}

/// Last path component, splitting on both separators so a Windows cwd names
/// its project correctly on any host.
fn project_name(cwd: &str) -> String {
    cwd.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(cwd)
        .to_string()
}

fn content_blocks(message: &Value) -> Vec<Value> {
    match message.get("content") {
        Some(Value::Array(blocks)) => blocks.clone(),
        Some(Value::String(text)) => vec![serde_json::json!({"type": "text", "text": text})],
        _ => Vec::new(),
    }
}

fn has_block(messages: &[Value], matches: impl Fn(&Value) -> bool) -> bool {
    messages
        .iter()
        .flat_map(content_blocks)
        .any(|block| matches(&block))
}

fn first_user_text(messages: &[Value]) -> Option<String> {
    messages
        .iter()
        .filter(|m| m.get("role").and_then(Value::as_str) == Some("user"))
        .flat_map(content_blocks)
        .find_map(|block| {
            (block.get("type").and_then(Value::as_str) == Some("text"))
                .then(|| block.get("text").and_then(Value::as_str))
                .flatten()
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(String::from)
        })
}

fn truncate(text: &str) -> String {
    if text.chars().count() <= SUMMARY_MAX_CHARS {
        text.to_string()
    } else {
        let head: String = text.chars().take(SUMMARY_MAX_CHARS).collect();
        format!("{head}...")
    }
}

fn metrics_usage(metrics: &Value) -> TokenUsage {
    let tokens = |key: &str| {
        metrics
            .get(key)
            .and_then(Value::as_u64)
            .map(|n| u32::try_from(n).unwrap_or(u32::MAX))
    };
    TokenUsage {
        input_tokens: tokens("inputTokens"),
        output_tokens: tokens("outputTokens"),
        cache_creation_input_tokens: tokens("cacheWriteTokens"),
        cache_read_input_tokens: tokens("cacheReadTokens"),
        ..Default::default()
    }
}

/// Map one stored message. `fallback_ts` stands in for user messages, which
/// carry no `ts` of their own.
fn convert_message(
    message: &Value,
    session_id: &str,
    index: usize,
    fallback_ts: &str,
) -> Option<ClaudeMessage> {
    let role = message.get("role").and_then(Value::as_str)?;
    if role != "user" && role != "assistant" {
        return None;
    }
    let uuid = message
        .get("id")
        .and_then(Value::as_str)
        .map_or_else(|| format!("{session_id}-{index}"), String::from);
    let timestamp = message
        .get("ts")
        .and_then(Value::as_u64)
        .map_or_else(|| fallback_ts.to_string(), crate::utils::ms_to_iso);
    let model = message
        .pointer("/modelInfo/id")
        .and_then(Value::as_str)
        .map(String::from);

    let mut converted = build_provider_message(
        PROVIDER_ID,
        uuid,
        session_id,
        timestamp,
        role,
        Some(role),
        Some(Value::Array(content_blocks(message))),
        model,
    );
    if let Some(metrics) = message.get("metrics") {
        converted.usage = Some(metrics_usage(metrics));
        converted.cost_usd = metrics.get("cost").and_then(Value::as_f64);
    }
    Some(converted)
}

fn convert_transcript(
    messages: &[Value],
    session_id: &str,
    started_at: &str,
) -> Vec<ClaudeMessage> {
    let mut last_ts = started_at.to_string();
    messages
        .iter()
        .enumerate()
        .filter_map(|(index, message)| {
            let converted = convert_message(message, session_id, index, &last_ts)?;
            last_ts.clone_from(&converted.timestamp);
            Some(converted)
        })
        .collect()
}

/// Projects in the store, grouped by each session's working directory.
pub(super) fn scan_projects_in(root: &Path) -> Vec<ClaudeProject> {
    let mut by_cwd: HashMap<String, Vec<Manifest>> = HashMap::new();
    for manifest in read_manifests(root) {
        by_cwd
            .entry(manifest.cwd.clone())
            .or_default()
            .push(manifest);
    }

    by_cwd
        .into_iter()
        .map(|(cwd, manifests)| {
            let last_modified = manifests
                .iter()
                .filter_map(|m| m.ended_at.as_ref().or(m.started_at.as_ref()))
                .max()
                .cloned()
                .unwrap_or_default();
            let message_count = manifests
                .iter()
                .map(|m| read_transcript(root, &m.id).map_or(0, |t| t.len()))
                .sum();
            ClaudeProject {
                name: project_name(&cwd),
                path: format!("{PREFIX}{cwd}"),
                actual_path: cwd,
                session_count: manifests.len(),
                message_count,
                last_modified,
                git_info: None,
                provider: Some(PROVIDER_ID.to_string()),
                storage_type: Some("json".to_string()),
                custom_directory_label: Some("Cline".to_string()),
            }
        })
        .collect()
}

/// Sessions of one project (`cwd`), newest first.
pub(super) fn load_sessions_in(root: &Path, cwd: &str) -> Vec<ClaudeSession> {
    let mut sessions: Vec<ClaudeSession> = read_manifests(root)
        .into_iter()
        .filter(|manifest| manifest.cwd == cwd)
        .map(|manifest| {
            let transcript = read_transcript(root, &manifest.id).unwrap_or_default();
            let started = manifest.started_at.clone().unwrap_or_default();
            let ended = manifest.ended_at.clone().unwrap_or_else(|| started.clone());
            let summary = manifest
                .title
                .clone()
                .or_else(|| first_user_text(&transcript))
                .map(|text| truncate(&text));
            ClaudeSession {
                session_id: format!("{PREFIX}{}", manifest.id),
                actual_session_id: manifest.id.clone(),
                file_path: root
                    .join(&manifest.id)
                    .join(format!("{}.messages.json", manifest.id))
                    .to_string_lossy()
                    .to_string(),
                project_name: project_name(cwd),
                message_count: transcript.len(),
                first_message_time: started,
                last_message_time: ended.clone(),
                last_modified: ended,
                has_tool_use: has_block(&transcript, |b| {
                    b.get("type").and_then(Value::as_str) == Some("tool_use")
                }),
                has_errors: has_block(&transcript, |b| {
                    b.get("type").and_then(Value::as_str) == Some("tool_result")
                        && b.get("is_error").and_then(Value::as_bool) == Some(true)
                }),
                summary,
                is_renamed: false,
                provider: Some(PROVIDER_ID.to_string()),
                storage_type: Some("json".to_string()),
                entrypoint: None,
            }
        })
        .collect();
    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    sessions
}

/// Messages of one session.
pub(super) fn load_messages_in(root: &Path, id: &str) -> Result<Vec<ClaudeMessage>, String> {
    let transcript = read_transcript(root, id)?;
    let started_at = read_manifest(&root.join(id), id)
        .and_then(|manifest| manifest.started_at)
        .unwrap_or_default();
    Ok(convert_transcript(&transcript, id, &started_at))
}

/// Append messages matching `query_lower` until `results` holds `limit`.
pub(super) fn search_in(
    root: &Path,
    query_lower: &str,
    limit: usize,
    results: &mut Vec<ClaudeMessage>,
) {
    for manifest in read_manifests(root) {
        if results.len() >= limit {
            return;
        }
        let Ok(transcript) = read_transcript(root, &manifest.id) else {
            continue;
        };
        let started = manifest.started_at.clone().unwrap_or_default();
        for mut message in convert_transcript(&transcript, &manifest.id, &started) {
            let matched = message
                .content
                .as_ref()
                .is_some_and(|content| search_json_value_case_insensitive(content, query_lower));
            if matched {
                message.project_name = Some(project_name(&manifest.cwd));
                results.push(message);
                if results.len() >= limit {
                    return;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `sdk/packages/core/fixtures/session/session.json` from cline/cline,
    /// verbatim.
    const UPSTREAM_MANIFEST: &str = r#"{
	"version": 1,
	"session_id": "1784094124598_rruoq",
	"source": "cli",
	"pid": 85916,
	"started_at": "2026-07-15T05:42:04.609Z",
	"ended_at": "2026-07-15T05:42:04.865Z",
	"exit_code": 0,
	"status": "completed",
	"interactive": true,
	"provider": "cline",
	"model": "mistralai/mixtral-8x22b-instruct",
	"cwd": "/Users/example/dev/cline",
	"workspace_root": "/Users/example/dev/cline",
	"team_name": "team-eE3xY",
	"enable_tools": true,
	"enable_spawn": true,
	"enable_teams": true,
	"metadata": {
		"source": "cli",
		"provider": "cline",
		"model": "mistralai/mixtral-8x22b-instruct",
		"enableTools": true,
		"enableSpawn": true,
		"enableTeams": true,
		"interactive": true,
		"mode": "act",
		"checkpointEnabled": true,
		"hubCapabilityOwnerClientId": "core-aimh1e01-mrlnkfkx",
		"messagesPath": "/Users/example/.cline/data/sessions/1784094053271_p8pzo/1784094053271_p8pzo.messages.json",
		"pid": 85916,
		"fork": {
			"forkedFromSessionId": "1784094053271_p8pzo",
			"forkedAt": "2026-07-15T05:42:01.804Z",
			"source": "cli"
		},
		"title": "can you update @apps/examples/desktop-app/webview/components/agent-sidebar.tsx so that the filter icon comes afte (fork)"
	},
	"messages_path": "/Users/example/.cline/data/sessions/1784094124598_rruoq/1784094124598_rruoq.messages.json"
}"#;

    /// `sdk/packages/core/fixtures/messages/success.messages.json` from
    /// cline/cline, verbatim: reasoning + tool call + tool result + final text,
    /// with `metrics` on the terminal assistant message.
    const UPSTREAM_MESSAGES: &str = r##"{
	"version": 1,
	"updated_at": "2026-04-22T17:42:10.123Z",
	"agent": "lead",
	"sessionId": "fixture-success-01",
	"messages": [
		{
			"id": "msg_user_1",
			"role": "user",
			"content": [
				{ "type": "text", "text": "Inspect the README and summarize it." }
			]
		},
		{
			"id": "msg_assistant_1",
			"role": "assistant",
			"ts": 1745343730123,
			"modelInfo": {
				"id": "claude-sonnet-4-6",
				"provider": "anthropic",
				"family": "claude-sonnet-4"
			},
			"content": [
				{
					"type": "thinking",
					"thinking": "I should read the README first before summarizing."
				},
				{
					"type": "tool_use",
					"id": "tool-call-1",
					"name": "read_files",
					"input": { "path": "/tmp/project/README.md" }
				}
			]
		},
		{
			"id": "msg_user_2",
			"role": "user",
			"content": [
				{
					"type": "tool_result",
					"tool_use_id": "tool-call-1",
					"content": "# Project\n\nA small test fixture.",
					"is_error": false
				}
			]
		},
		{
			"id": "msg_assistant_2",
			"role": "assistant",
			"ts": 1745343731456,
			"modelInfo": {
				"id": "claude-sonnet-4-6",
				"provider": "anthropic",
				"family": "claude-sonnet-4"
			},
			"metrics": {
				"inputTokens": 21,
				"outputTokens": 8,
				"cacheReadTokens": 3,
				"cacheWriteTokens": 1,
				"cost": 0.13
			},
			"content": [
				{
					"type": "text",
					"text": "The README describes a small test fixture project."
				}
			]
		}
	]
}"##;

    const ID: &str = "1784094124598_rruoq";
    const CWD: &str = "/Users/example/dev/cline";

    /// A store with the upstream session plus the sibling files that must not
    /// surface as sessions of their own.
    fn store() -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(ID);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{ID}.json")), UPSTREAM_MANIFEST).unwrap();
        fs::write(dir.join(format!("{ID}.messages.json")), UPSTREAM_MESSAGES).unwrap();
        // Compacted context of the same conversation — would duplicate it.
        fs::write(
            dir.join(format!("{ID}.compaction.json")),
            r#"{"version":1,"updated_at":"2026-07-15T05:42:04.865Z","source_message_count":4,"messages":[{"role":"user","content":"compacted"}]}"#,
        )
        .unwrap();
        // A subagent transcript in the same directory.
        fs::write(
            dir.join("agent_1.messages.json"),
            r#"{"version":1,"agent":"subagent","sessionId":"x","messages":[{"id":"s1","role":"user","content":[{"type":"text","text":"subagent work"}]}]}"#,
        )
        .unwrap();
        tmp
    }

    #[test]
    fn scan_groups_sessions_by_cwd() {
        let tmp = store();
        let projects = scan_projects_in(tmp.path());
        assert_eq!(projects.len(), 1);
        let project = &projects[0];
        assert_eq!(project.name, "cline");
        assert_eq!(project.path, format!("{PREFIX}{CWD}"));
        assert_eq!(project.actual_path, CWD);
        assert_eq!(project.session_count, 1, "sibling files are not sessions");
        assert_eq!(project.message_count, 4, "lead transcript only");
        assert_eq!(project.provider.as_deref(), Some("cline"));
    }

    #[test]
    fn sessions_use_the_manifest_title_and_times() {
        let tmp = store();
        let sessions = load_sessions_in(tmp.path(), CWD);
        assert_eq!(sessions.len(), 1);
        let session = &sessions[0];
        assert_eq!(session.session_id, format!("{PREFIX}{ID}"));
        assert_eq!(session.actual_session_id, ID);
        assert_eq!(session.message_count, 4);
        assert_eq!(session.first_message_time, "2026-07-15T05:42:04.609Z");
        assert_eq!(session.last_message_time, "2026-07-15T05:42:04.865Z");
        assert!(session.has_tool_use);
        assert!(!session.has_errors);
        assert!(session
            .summary
            .as_deref()
            .is_some_and(|s| s.starts_with("can you update")));
        assert!(load_sessions_in(tmp.path(), "/elsewhere").is_empty());
    }

    #[test]
    fn transcript_blocks_and_metrics_are_mapped() {
        let tmp = store();
        let messages = load_messages_in(tmp.path(), ID).unwrap();
        assert_eq!(messages.len(), 4, "compaction and subagent files ignored");

        let roles: Vec<_> = messages.iter().map(|m| m.message_type.as_str()).collect();
        assert_eq!(roles, ["user", "assistant", "user", "assistant"]);
        assert!(messages
            .iter()
            .all(|m| m.provider.as_deref() == Some("cline")));

        let tool_call = &messages[1];
        assert_eq!(tool_call.model.as_deref(), Some("claude-sonnet-4-6"));
        let blocks = tool_call.content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(blocks[0]["type"], "thinking");
        assert_eq!(blocks[1]["type"], "tool_use");
        assert!(
            tool_call.usage.is_none(),
            "only the terminal message has metrics"
        );

        let result = &messages[2];
        assert_eq!(
            result.content.as_ref().unwrap()[0]["tool_use_id"],
            "tool-call-1"
        );
        assert_eq!(
            result.timestamp, tool_call.timestamp,
            "user messages carry no ts and inherit the previous one"
        );

        let final_turn = &messages[3];
        let usage = final_turn.usage.as_ref().expect("metrics mapped to usage");
        assert_eq!(usage.input_tokens, Some(21));
        assert_eq!(usage.output_tokens, Some(8));
        assert_eq!(usage.cache_read_input_tokens, Some(3));
        assert_eq!(usage.cache_creation_input_tokens, Some(1));
        assert_eq!(final_turn.cost_usd, Some(0.13));
    }

    #[test]
    fn first_user_message_falls_back_to_manifest_start() {
        let tmp = store();
        let messages = load_messages_in(tmp.path(), ID).unwrap();
        assert_eq!(messages[0].timestamp, "2026-07-15T05:42:04.609Z");
    }

    #[test]
    fn string_content_is_wrapped_as_a_text_block() {
        let message = serde_json::json!({"id": "m", "role": "user", "content": "plain"});
        let converted = convert_message(&message, "s", 0, "t").unwrap();
        assert_eq!(
            converted.content,
            Some(serde_json::json!([{"type": "text", "text": "plain"}]))
        );
    }

    #[test]
    fn search_finds_matches_with_their_project() {
        let tmp = store();
        let mut results = Vec::new();
        search_in(tmp.path(), "small test fixture", 10, &mut results);
        assert_eq!(results.len(), 2, "tool result and final answer");
        assert!(results
            .iter()
            .all(|m| m.project_name.as_deref() == Some("cline")));

        let mut limited = Vec::new();
        search_in(tmp.path(), "small test fixture", 1, &mut limited);
        assert_eq!(limited.len(), 1);
    }

    #[test]
    fn unsafe_session_ids_are_rejected() {
        let tmp = store();
        for id in ["../escape", "a/b", r"a\b", ""] {
            assert!(load_messages_in(tmp.path(), id).is_err(), "{id:?}");
        }
    }

    #[test]
    fn windows_cwd_names_its_project() {
        assert_eq!(project_name(r"C:\Users\nikos\code\app"), "app");
        assert_eq!(project_name("/Users/example/dev/cline/"), "cline");
        assert_eq!(project_name("unknown"), "unknown");
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_session_dirs_are_skipped() {
        let tmp = store();
        let outside = tempfile::tempdir().unwrap();
        let target = outside.path().join("2_other");
        fs::create_dir_all(&target).unwrap();
        fs::write(
            target.join("2_other.json"),
            UPSTREAM_MANIFEST.replace(CWD, "/elsewhere"),
        )
        .unwrap();
        std::os::unix::fs::symlink(&target, tmp.path().join("2_other")).unwrap();

        let projects = scan_projects_in(tmp.path());
        assert_eq!(projects.len(), 1, "the symlinked session is not read");
    }

    #[test]
    #[serial_test::serial]
    fn sessions_dir_follows_upstream_env_precedence() {
        struct EnvVarGuard(&'static str);
        impl EnvVarGuard {
            fn set(key: &'static str, value: &Path) -> Self {
                std::env::set_var(key, value);
                Self(key)
            }
        }
        impl Drop for EnvVarGuard {
            fn drop(&mut self) {
                std::env::remove_var(self.0);
            }
        }

        let tmp = tempfile::tempdir().unwrap();
        let data = tmp.path().join("data");
        fs::create_dir_all(data.join("sessions")).unwrap();
        let explicit = tmp.path().join("explicit-sessions");
        fs::create_dir_all(&explicit).unwrap();

        let data_guard = EnvVarGuard::set("CLINE_DATA_DIR", &data);
        assert_eq!(sessions_dir(), Some(data.join("sessions")));

        let _session_guard = EnvVarGuard::set("CLINE_SESSION_DATA_DIR", &explicit);
        assert_eq!(sessions_dir(), Some(explicit.clone()), "most specific wins");
        drop(data_guard);
    }
}
