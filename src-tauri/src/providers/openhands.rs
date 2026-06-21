//! `OpenHands` provider (classic `All-Hands-AI` 0.x local session store).
//!
//! Reads `~/.openhands/sessions/<sid>/events/<N>.json` (N = integer event id,
//! 0-based) plus `metadata.json`. Each event JSON is `event_to_dict()`:
//! - top-level `action` (an `ActionType` string) OR `observation` (an
//!   `ObservationType` string) is the discriminator;
//! - `source` is `"user" | "agent" | "environment"`;
//! - a chat turn is `action == "message"` (`source` "user"/"agent"); a tool call
//!   is any other `action` (run/read/write/…); a tool result is an
//!   `observation`, linked to its call via `cause` (= the action's `id`).
//!
//! Displayable text: `args.content` for messages, top-level `content` for
//! observations, `args.{command,code,path,thought}` for tool calls. We map these
//! to the viewer's Claude-style blocks. All sessions surface under one synthetic
//! "`OpenHands`" project (the store has no project/cwd grouping).
//!
//! Scope: this targets classic `OpenHands` 0.x (`openhands/events`); the newer V1
//! `software-agent-sdk` uses a different, cwd-relative layout and is not covered.

use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::providers::ProviderInfo;
use crate::utils::{build_provider_message, search_json_value_case_insensitive};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const PROVIDER: &str = "openhands";
const SCHEME: &str = "openhands://";
const PROJECT_KEY: &str = "__workspace__";
const SUMMARY_MAX_CHARS: usize = 80;

/// `~/.openhands/sessions` (the classic `file_store_path` default).
fn sessions_dir() -> Option<PathBuf> {
    let dir = dirs::home_dir()?.join(".openhands").join("sessions");
    if dir.is_dir() {
        Some(dir)
    } else {
        None
    }
}

/// Detect an `OpenHands` installation.
pub fn detect() -> Option<ProviderInfo> {
    let dir = sessions_dir()?;
    Some(ProviderInfo {
        id: PROVIDER.to_string(),
        display_name: "OpenHands".to_string(),
        is_available: !session_ids(&dir).is_empty(),
        base_path: dir.to_string_lossy().to_string(),
    })
}

/// Base path (`~/.openhands/sessions`), for the file watcher.
pub fn get_base_path() -> Option<String> {
    sessions_dir().map(|p| p.to_string_lossy().to_string())
}

/// Conversation ids = immediate subdirectories of `sessions/` that have an
/// `events/` dir.
fn session_ids(sessions: &Path) -> Vec<String> {
    WalkDir::new(sessions)
        .min_depth(1)
        .max_depth(1)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| !e.path_is_symlink())
        .filter(|e| e.file_type().is_dir())
        .filter(|e| e.path().join("events").is_dir())
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .collect()
}

/// One synthetic project holding every `OpenHands` conversation.
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let Some(dir) = sessions_dir() else {
        return Ok(vec![]);
    };
    let ids = session_ids(&dir);
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let mut message_count = 0usize;
    let mut last_modified = String::new();
    for sid in &ids {
        let events = dir.join(sid).join("events");
        message_count += event_files(&events).len();
        let mtime = dir_mtime_rfc3339(&dir.join(sid));
        if mtime > last_modified {
            last_modified = mtime;
        }
    }
    Ok(vec![ClaudeProject {
        name: "OpenHands".to_string(),
        path: format!("{SCHEME}{PROJECT_KEY}"),
        actual_path: "OpenHands".to_string(),
        session_count: ids.len(),
        message_count,
        last_modified,
        git_info: None,
        provider: Some(PROVIDER.to_string()),
        storage_type: Some("json".to_string()),
        custom_directory_label: None,
    }])
}

/// Load the conversations (sessions) of the synthetic `OpenHands` project.
pub fn load_sessions(
    _project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let Some(dir) = sessions_dir() else {
        return Ok(vec![]);
    };
    let mut sessions = Vec::new();
    for sid in session_ids(&dir) {
        let session_dir = dir.join(&sid);
        let events = session_dir.join("events");
        let files = event_files(&events);
        if files.is_empty() {
            continue;
        }
        let (summary, first_ts, last_ts, has_tool_use) = session_overview(&files);
        let title = read_metadata_title(&session_dir);
        let mtime = dir_mtime_rfc3339(&session_dir);
        let first = first_ts.unwrap_or_else(|| mtime.clone());
        let last = last_ts.unwrap_or(mtime);
        sessions.push(ClaudeSession {
            session_id: format!("{SCHEME}{sid}"),
            actual_session_id: sid.clone(),
            file_path: format!("{SCHEME}{sid}"),
            project_name: "OpenHands".to_string(),
            message_count: files.len(),
            first_message_time: first,
            last_message_time: last.clone(),
            last_modified: last,
            has_tool_use,
            has_errors: false,
            summary: title
                .filter(|t| !t.trim().is_empty())
                .or(summary)
                .or_else(|| Some(sid.clone())),
            is_renamed: false,
            provider: Some(PROVIDER.to_string()),
            storage_type: Some("json".to_string()),
            entrypoint: None,
        });
    }
    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

/// Load messages for one `OpenHands` conversation (`openhands://<sid>`).
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let sid = session_path.strip_prefix(SCHEME).unwrap_or(session_path);
    let events = events_dir_for(sid)?;
    let mut messages = Vec::new();
    for (idx, path) in event_files(&events).into_iter().enumerate() {
        let Ok(data) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(event) = serde_json::from_str::<Value>(&data) else {
            continue;
        };
        if let Some(msg) = convert_event(&event, sid, idx) {
            messages.push(msg);
        }
    }
    Ok(messages)
}

/// Search across all `OpenHands` conversations.
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let Some(dir) = sessions_dir() else {
        return Ok(vec![]);
    };
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();
    for sid in session_ids(&dir) {
        let events = dir.join(&sid).join("events");
        for (idx, path) in event_files(&events).into_iter().enumerate() {
            if results.len() >= limit {
                return Ok(results);
            }
            let Ok(data) = fs::read_to_string(&path) else {
                continue;
            };
            let Ok(event) = serde_json::from_str::<Value>(&data) else {
                continue;
            };
            if let Some(mut msg) = convert_event(&event, &sid, idx) {
                let matched = msg
                    .content
                    .as_ref()
                    .map(|c| search_json_value_case_insensitive(c, &query_lower))
                    .unwrap_or(false);
                if matched {
                    msg.project_name = Some("OpenHands".to_string());
                    results.push(msg);
                }
            }
        }
    }
    Ok(results)
}

// ============================================================================
// Event handling
// ============================================================================

/// `events/<N>.json` files sorted by their integer id.
fn event_files(events: &Path) -> Vec<PathBuf> {
    let mut files: Vec<(i64, PathBuf)> = WalkDir::new(events)
        .min_depth(1)
        .max_depth(1)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| !e.path_is_symlink())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) != Some("json") {
                return None;
            }
            let n: i64 = p.file_stem().and_then(|s| s.to_str())?.parse().ok()?;
            Some((n, p.to_path_buf()))
        })
        .collect();
    files.sort_by_key(|(n, _)| *n);
    files.into_iter().map(|(_, p)| p).collect()
}

fn events_dir_for(sid: &str) -> Result<PathBuf, String> {
    // sid must be a single safe path component (no traversal).
    if sid.is_empty() || sid.contains('/') || sid.contains('\\') || sid.contains("..") {
        return Err(format!("Invalid OpenHands session id: {sid}"));
    }
    let dir = sessions_dir().ok_or("OpenHands sessions path not found")?;
    let events = dir.join(sid).join("events");
    if events.is_dir() {
        Ok(events)
    } else {
        Err(format!("OpenHands session not found: {sid}"))
    }
}

/// Convert one classic-`OpenHands` event dict to a `ClaudeMessage`.
fn convert_event(event: &Value, sid: &str, idx: usize) -> Option<ClaudeMessage> {
    let source = event.get("source").and_then(Value::as_str).unwrap_or("");
    let timestamp = event
        .get("timestamp")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let event_id = event
        .get("id")
        .map(ToString::to_string)
        .unwrap_or_else(|| idx.to_string());
    let uuid = format!("{sid}-{event_id}");

    if let Some(action) = event.get("action").and_then(Value::as_str) {
        match action {
            "system" | "null" | "change_agent_state" => None,
            "message" => {
                let text = event
                    .get("args")
                    .and_then(|a| a.get("content"))
                    .and_then(Value::as_str)
                    .or_else(|| event.get("message").and_then(Value::as_str))
                    .unwrap_or("");
                if text.is_empty() {
                    return None;
                }
                let role = if source == "user" {
                    "user"
                } else {
                    "assistant"
                };
                Some(make_msg(
                    PROVIDER,
                    uuid,
                    sid,
                    timestamp,
                    role,
                    vec![json!({ "type": "text", "text": text })],
                ))
            }
            // Any other action is an agent tool call.
            _ => {
                let mut blocks = Vec::new();
                if let Some(thought) = event
                    .get("args")
                    .and_then(|a| a.get("thought"))
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                {
                    blocks.push(json!({ "type": "text", "text": thought }));
                }
                let input = event.get("args").cloned().unwrap_or_else(|| json!({}));
                blocks.push(json!({
                    "type": "tool_use",
                    "id": event_id,
                    "name": action,
                    "input": input
                }));
                Some(make_msg(
                    PROVIDER,
                    uuid,
                    sid,
                    timestamp,
                    "assistant",
                    blocks,
                ))
            }
        }
    } else if let Some(_obs) = event.get("observation").and_then(Value::as_str) {
        let content = event
            .get("content")
            .map(|c| match c {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            })
            .unwrap_or_default();
        let tool_use_id = event
            .get("cause")
            .map(ToString::to_string)
            .unwrap_or_default();
        let is_error = event.get("observation").and_then(Value::as_str) == Some("error");
        Some(make_msg(
            PROVIDER,
            uuid,
            sid,
            timestamp,
            "user",
            vec![json!({
                "type": "tool_result",
                "tool_use_id": tool_use_id,
                "content": content,
                "is_error": is_error
            })],
        ))
    } else {
        None
    }
}

fn make_msg(
    provider: &str,
    uuid: String,
    sid: &str,
    timestamp: String,
    role: &str,
    blocks: Vec<Value>,
) -> ClaudeMessage {
    build_provider_message(
        provider,
        uuid,
        sid,
        timestamp,
        role,
        Some(role),
        Some(Value::Array(blocks)),
        None,
    )
}

/// `(summary, first_ts, last_ts, has_tool_use)` over a session's event files.
fn session_overview(files: &[PathBuf]) -> (Option<String>, Option<String>, Option<String>, bool) {
    let mut summary = None;
    let mut first_ts = None;
    let mut last_ts = None;
    let mut has_tool_use = false;
    for path in files {
        let Ok(data) = fs::read_to_string(path) else {
            continue;
        };
        let Ok(event) = serde_json::from_str::<Value>(&data) else {
            continue;
        };
        if let Some(ts) = event.get("timestamp").and_then(Value::as_str) {
            if first_ts.is_none() {
                first_ts = Some(ts.to_string());
            }
            last_ts = Some(ts.to_string());
        }
        let action = event.get("action").and_then(Value::as_str);
        if matches!(action, Some(a) if !matches!(a, "message" | "system" | "null" | "change_agent_state"))
            || event.get("observation").is_some()
        {
            has_tool_use = true;
        }
        if summary.is_none()
            && action == Some("message")
            && event.get("source").and_then(Value::as_str) == Some("user")
        {
            summary = event
                .get("args")
                .and_then(|a| a.get("content"))
                .and_then(Value::as_str)
                .map(summarize);
        }
    }
    (summary, first_ts, last_ts, has_tool_use)
}

fn read_metadata_title(session_dir: &Path) -> Option<String> {
    let data = fs::read_to_string(session_dir.join("metadata.json")).ok()?;
    let meta: Value = serde_json::from_str(&data).ok()?;
    meta.get("title")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn summarize(text: &str) -> String {
    let cleaned = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.chars().count() > SUMMARY_MAX_CHARS {
        format!(
            "{}…",
            cleaned.chars().take(SUMMARY_MAX_CHARS).collect::<String>()
        )
    } else {
        cleaned
    }
}

fn dir_mtime_rfc3339(path: &Path) -> String {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
        .map(|d| {
            #[allow(clippy::cast_possible_wrap)]
            DateTime::from_timestamp(d.as_secs() as i64, 0)
                .unwrap_or_else(Utc::now)
                .to_rfc3339()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user_event() -> Value {
        json!({ "id": 1, "timestamp": "2026-06-20T10:00:00", "source": "user",
            "message": "run ls", "action": "message",
            "args": { "content": "run ls" } })
    }
    fn assistant_event() -> Value {
        json!({ "id": 7, "timestamp": "2026-06-20T10:00:05", "source": "agent",
            "message": "Sure", "action": "message", "args": { "content": "Sure, listing." } })
    }
    fn toolcall_event() -> Value {
        json!({ "id": 8, "timestamp": "2026-06-20T10:00:06", "source": "agent",
            "message": "Running command: ls -la", "action": "run",
            "args": { "command": "ls -la", "thought": "let me list" } })
    }
    fn observation_event() -> Value {
        json!({ "id": 9, "timestamp": "2026-06-20T10:00:07", "source": "agent",
            "cause": 8, "observation": "run", "content": "total 8\nfile.rs",
            "extras": { "metadata": { "exit_code": 0 } } })
    }
    fn system_event() -> Value {
        json!({ "id": 0, "source": "agent", "action": "system", "args": { "content": "sys prompt" } })
    }

    #[test]
    fn convert_user_and_assistant_messages() {
        let u = convert_event(&user_event(), "s1", 0).unwrap();
        assert_eq!(u.role.as_deref(), Some("user"));
        assert_eq!(u.uuid, "s1-1");
        assert_eq!(u.provider.as_deref(), Some("openhands"));
        assert_eq!(u.content.as_ref().unwrap()[0]["text"], "run ls");

        let a = convert_event(&assistant_event(), "s1", 1).unwrap();
        assert_eq!(a.role.as_deref(), Some("assistant"));
        assert_eq!(a.content.as_ref().unwrap()[0]["text"], "Sure, listing.");
    }

    #[test]
    fn convert_tool_call_and_observation_link_by_cause() {
        let call = convert_event(&toolcall_event(), "s1", 2).unwrap();
        assert_eq!(call.role.as_deref(), Some("assistant"));
        let cb = call.content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(cb[0]["type"], "text"); // thought
        assert_eq!(cb[1]["type"], "tool_use");
        assert_eq!(cb[1]["id"], "8");
        assert_eq!(cb[1]["name"], "run");
        assert_eq!(cb[1]["input"]["command"], "ls -la");

        let obs = convert_event(&observation_event(), "s1", 3).unwrap();
        assert_eq!(obs.role.as_deref(), Some("user"));
        let ob = obs.content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(ob[0]["type"], "tool_result");
        assert_eq!(ob[0]["tool_use_id"], "8"); // == toolcall id (cause)
        assert!(ob[0]["content"].as_str().unwrap().contains("file.rs"));
    }

    #[test]
    fn system_and_unknown_records_are_skipped() {
        assert!(convert_event(&system_event(), "s1", 0).is_none());
        assert!(convert_event(&json!({ "id": 1, "source": "agent" }), "s1", 0).is_none());
    }

    #[test]
    fn events_dir_rejects_traversal() {
        assert!(events_dir_for("../../etc").is_err());
        assert!(events_dir_for("a/b").is_err());
        assert!(events_dir_for("").is_err());
    }
}
