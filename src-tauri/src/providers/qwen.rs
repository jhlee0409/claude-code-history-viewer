//! Qwen Code provider (Alibaba's Gemini-CLI-derived terminal agent).
//!
//! Qwen Code auto-saves the full transcript (user + assistant + tool results)
//! as per-session JSONL at
//! `<runtime-base>/projects/<sanitizedCwd>/chats/<sessionId>.jsonl`, where the
//! runtime base is `$QWEN_RUNTIME_DIR` / `$QWEN_HOME` / `~/.qwen` and
//! `sanitizedCwd` is the project path with every non-alphanumeric char replaced
//! by `-`. Each line is a `ChatRecord`:
//! ```json
//! { "uuid": "...", "parentUuid": null, "sessionId": "...", "timestamp": "...",
//!   "type": "user"|"assistant"|"tool_result"|"system", "cwd": "/abs/path",
//!   "model": "qwen3-coder-plus", "usageMetadata": {...},
//!   "message": { "role": "user"|"model", "parts": [Part, ...] } }
//! ```
//! `Part` is the `@google/genai` shape: `{text}` / `{text,thought:true}` /
//! `{functionCall:{name,args,id}}` / `{functionResponse:{name,response,id}}`.
//! We map these to the viewer's Claude-style content blocks. Projects group by
//! the real `cwd` carried on each record.

use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession, TokenUsage};
use crate::providers::ProviderInfo;
use crate::utils::{build_provider_message, search_json_value_case_insensitive};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const PROVIDER: &str = "qwen";
const SCHEME: &str = "qwen://";
const SUMMARY_MAX_CHARS: usize = 80;

/// Runtime base dir: `$QWEN_RUNTIME_DIR` / `$QWEN_HOME` / `~/.qwen`.
fn runtime_base() -> Option<PathBuf> {
    for env in ["QWEN_RUNTIME_DIR", "QWEN_HOME"] {
        if let Ok(v) = std::env::var(env) {
            let v = v.trim();
            if !v.is_empty() {
                return Some(PathBuf::from(v));
            }
        }
    }
    Some(dirs::home_dir()?.join(".qwen"))
}

fn projects_dir() -> Option<PathBuf> {
    let dir = runtime_base()?.join("projects");
    if dir.is_dir() {
        Some(dir)
    } else {
        None
    }
}

/// Detect a Qwen Code installation.
pub fn detect() -> Option<ProviderInfo> {
    let base = projects_dir()?;
    Some(ProviderInfo {
        id: PROVIDER.to_string(),
        display_name: "Qwen Code".to_string(),
        is_available: !session_files(&base).is_empty(),
        base_path: base.to_string_lossy().to_string(),
    })
}

/// Base path (`<runtime-base>/projects`), for the file watcher.
pub fn get_base_path() -> Option<String> {
    projects_dir().map(|p| p.to_string_lossy().to_string())
}

/// All `<projects>/<dir>/chats/*.jsonl` session files.
fn session_files(projects: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for project in WalkDir::new(projects)
        .min_depth(1)
        .max_depth(1)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| !e.path_is_symlink())
        .filter(|e| e.file_type().is_dir())
    {
        let chats = project.path().join("chats");
        if !chats.is_dir() {
            continue;
        }
        for entry in WalkDir::new(&chats)
            .min_depth(1)
            .max_depth(1)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file())
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
            .filter(|e| !is_symlink(e.path()))
        {
            files.push(entry.path().to_path_buf());
        }
    }
    files
}

/// Scan Qwen projects (sessions grouped by the real `cwd`).
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let Some(base) = projects_dir() else {
        return Ok(vec![]);
    };
    struct Agg {
        session_count: usize,
        message_count: usize,
        last_modified: String,
    }
    let mut by_cwd: HashMap<String, Agg> = HashMap::new();

    for file in session_files(&base) {
        let Ok(data) = fs::read_to_string(&file) else {
            continue;
        };
        let Some(meta) = session_meta(&data) else {
            continue;
        };
        if meta.message_count == 0 {
            continue;
        }
        let cwd = meta.cwd.unwrap_or_else(|| "unknown".to_string());
        let mtime = file_mtime_rfc3339(&file);
        let entry = by_cwd.entry(cwd).or_insert_with(|| Agg {
            session_count: 0,
            message_count: 0,
            last_modified: String::new(),
        });
        entry.session_count += 1;
        entry.message_count += meta.message_count;
        let last = meta.last_ts.clone().unwrap_or(mtime);
        if last > entry.last_modified {
            entry.last_modified = last;
        }
    }

    let mut projects: Vec<ClaudeProject> = by_cwd
        .into_iter()
        .map(|(cwd, agg)| {
            let name = Path::new(&cwd)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| cwd.clone());
            ClaudeProject {
                name,
                path: format!("{SCHEME}{cwd}"),
                actual_path: cwd,
                session_count: agg.session_count,
                message_count: agg.message_count,
                last_modified: agg.last_modified,
                git_info: None,
                provider: Some(PROVIDER.to_string()),
                storage_type: None,
                custom_directory_label: None,
            }
        })
        .collect();
    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

/// Load the sessions for one Qwen project (filtered by `cwd`).
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let Some(base) = projects_dir() else {
        return Ok(vec![]);
    };
    let target_cwd = project_path.strip_prefix(SCHEME).unwrap_or(project_path);
    let mut sessions = Vec::new();

    for file in session_files(&base) {
        let Ok(data) = fs::read_to_string(&file) else {
            continue;
        };
        let Some(meta) = session_meta(&data) else {
            continue;
        };
        if meta.message_count == 0 {
            continue;
        }
        if meta.cwd.as_deref().unwrap_or("unknown") != target_cwd {
            continue;
        }
        let mtime = file_mtime_rfc3339(&file);
        let first = meta.first_ts.clone().unwrap_or_else(|| mtime.clone());
        let last = meta.last_ts.clone().unwrap_or(mtime);
        sessions.push(ClaudeSession {
            session_id: file.to_string_lossy().to_string(),
            actual_session_id: meta.session_id,
            file_path: file.to_string_lossy().to_string(),
            project_name: Path::new(target_cwd)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            message_count: meta.message_count,
            first_message_time: first,
            last_message_time: last.clone(),
            last_modified: last,
            has_tool_use: meta.has_tool_use,
            has_errors: false,
            summary: meta.summary,
            is_renamed: false,
            provider: Some(PROVIDER.to_string()),
            storage_type: None,
            entrypoint: None,
        });
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

/// Load all messages from one Qwen session file.
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let path = Path::new(session_path);
    if !path.exists() {
        return Err(format!("Session file not found: {session_path}"));
    }
    validate_under_base(path)?;
    if is_symlink(path) {
        return Err("Session file must not be a symlink".to_string());
    }
    let data = fs::read_to_string(path).map_err(|e| format!("Failed to read session file: {e}"))?;
    Ok(parse_messages(&data))
}

/// Search across all Qwen sessions.
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let Some(base) = projects_dir() else {
        return Ok(vec![]);
    };
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();
    for file in session_files(&base) {
        let Ok(data) = fs::read_to_string(&file) else {
            continue;
        };
        let cwd = session_meta(&data).and_then(|m| m.cwd);
        let project_name = cwd
            .as_deref()
            .map(|c| {
                Path::new(c)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| c.to_string())
            })
            .unwrap_or_default();
        for mut msg in parse_messages(&data) {
            if results.len() >= limit {
                return Ok(results);
            }
            let matched = msg
                .content
                .as_ref()
                .map(|c| search_json_value_case_insensitive(c, &query_lower))
                .unwrap_or(false);
            if matched {
                msg.project_name = Some(project_name.clone());
                results.push(msg);
            }
        }
    }
    Ok(results)
}

// ============================================================================
// Pure parsing (unit-testable)
// ============================================================================

struct SessionMeta {
    session_id: String,
    cwd: Option<String>,
    message_count: usize,
    summary: Option<String>,
    first_ts: Option<String>,
    last_ts: Option<String>,
    has_tool_use: bool,
}

/// Lightweight per-session metadata from a chat JSONL (one parse).
fn session_meta(data: &str) -> Option<SessionMeta> {
    let mut session_id = String::new();
    let mut cwd = None;
    let mut message_count = 0usize;
    let mut summary = None;
    let mut first_ts = None;
    let mut last_ts = None;
    let mut has_tool_use = false;

    for line in data.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(rec) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if session_id.is_empty() {
            if let Some(s) = rec.get("sessionId").and_then(Value::as_str) {
                session_id = s.to_string();
            }
        }
        if cwd.is_none() {
            cwd = rec.get("cwd").and_then(Value::as_str).map(str::to_string);
        }
        let rec_type = rec.get("type").and_then(Value::as_str).unwrap_or("");
        if !matches!(rec_type, "user" | "assistant" | "tool_result") {
            continue;
        }
        message_count += 1;
        if let Some(ts) = rec.get("timestamp").and_then(Value::as_str) {
            if first_ts.is_none() {
                first_ts = Some(ts.to_string());
            }
            last_ts = Some(ts.to_string());
        }
        if summary.is_none() && rec_type == "user" {
            summary = first_text(&rec).map(|t| summarize(&t));
        }
        if rec_type == "tool_result" || record_has_function_call(&rec) {
            has_tool_use = true;
        }
    }

    if session_id.is_empty() && cwd.is_none() && message_count == 0 {
        return None;
    }
    Some(SessionMeta {
        session_id,
        cwd,
        message_count,
        summary,
        first_ts,
        last_ts,
        has_tool_use,
    })
}

/// Parse a chat JSONL into messages.
fn parse_messages(data: &str) -> Vec<ClaudeMessage> {
    let mut messages = Vec::new();
    for line in data.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(rec) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if let Some(msg) = convert_record(&rec) {
            messages.push(msg);
        }
    }
    messages
}

fn convert_record(rec: &Value) -> Option<ClaudeMessage> {
    let rec_type = rec.get("type").and_then(Value::as_str)?;
    // tool_result records carry role 'user' in genai but are their own record
    // type; surface them in the user lane like Claude tool results.
    let (message_type, role) = match rec_type {
        "user" | "tool_result" => ("user", "user"),
        "assistant" => ("assistant", "assistant"),
        _ => return None, // skip system / UI records
    };

    let parts = rec
        .get("message")
        .and_then(|m| m.get("parts"))
        .and_then(Value::as_array);
    let blocks: Vec<Value> = parts
        .map(|ps| ps.iter().filter_map(convert_part).collect())
        .unwrap_or_default();
    if blocks.is_empty() {
        return None;
    }

    let session_id = rec.get("sessionId").and_then(Value::as_str).unwrap_or("");
    let uuid = rec
        .get("uuid")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or(session_id)
        .to_string();
    let timestamp = rec
        .get("timestamp")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let model = rec.get("model").and_then(Value::as_str).map(str::to_string);

    let mut msg = build_provider_message(
        PROVIDER,
        uuid,
        session_id,
        timestamp,
        message_type,
        Some(role),
        Some(Value::Array(blocks)),
        model,
    );
    msg.parent_uuid = rec
        .get("parentUuid")
        .and_then(Value::as_str)
        .map(str::to_string);
    if let Some(usage) = rec.get("usageMetadata") {
        msg.usage = Some(convert_usage(usage));
    }
    Some(msg)
}

/// Map a `@google/genai` `Part` to a Claude-style content block.
fn convert_part(part: &Value) -> Option<Value> {
    if let Some(call) = part.get("functionCall") {
        let name = call
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let id = call.get("id").and_then(Value::as_str).unwrap_or("");
        let input = call.get("args").cloned().unwrap_or_else(|| json!({}));
        return Some(json!({ "type": "tool_use", "id": id, "name": name, "input": input }));
    }
    if let Some(resp) = part.get("functionResponse") {
        let id = resp.get("id").and_then(Value::as_str).unwrap_or("");
        // response is usually { output: <string|object> }.
        let content = resp
            .get("response")
            .and_then(|r| r.get("output"))
            .map(stringify_value)
            .or_else(|| resp.get("response").map(stringify_value))
            .unwrap_or_default();
        return Some(json!({ "type": "tool_result", "tool_use_id": id, "content": content }));
    }
    if let Some(text) = part.get("text").and_then(Value::as_str) {
        if text.is_empty() {
            return None;
        }
        // A part flagged thought:true is reasoning, not user-visible text.
        if part
            .get("thought")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return Some(json!({ "type": "thinking", "thinking": text, "signature": "" }));
        }
        return Some(json!({ "type": "text", "text": text }));
    }
    // inlineData / fileData / executableCode / codeExecutionResult: not rendered
    // in this MVP.
    None
}

fn convert_usage(usage: &Value) -> TokenUsage {
    let g = |k: &str| usage.get(k).and_then(Value::as_u64).map(|n| n as u32);
    TokenUsage {
        input_tokens: g("promptTokenCount"),
        output_tokens: g("candidatesTokenCount"),
        cache_creation_input_tokens: None,
        cache_read_input_tokens: g("cachedContentTokenCount"),
        service_tier: None,
    }
}

fn record_has_function_call(rec: &Value) -> bool {
    rec.get("message")
        .and_then(|m| m.get("parts"))
        .and_then(Value::as_array)
        .is_some_and(|ps| ps.iter().any(|p| p.get("functionCall").is_some()))
}

/// First non-thought text of a record's message (for the session summary).
fn first_text(rec: &Value) -> Option<String> {
    let parts = rec
        .get("message")
        .and_then(|m| m.get("parts"))
        .and_then(Value::as_array)?;
    parts.iter().find_map(|p| {
        if p.get("thought").and_then(Value::as_bool).unwrap_or(false) {
            return None;
        }
        p.get("text")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    })
}

fn stringify_value(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
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

fn is_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

fn validate_under_base(path: &Path) -> Result<(), String> {
    let base = projects_dir().ok_or("Qwen projects path not found")?;
    let canon_base = base
        .canonicalize()
        .map_err(|e| format!("Failed to resolve Qwen base: {e}"))?;
    let canon_path = path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve session path: {e}"))?;
    if canon_path.starts_with(&canon_base) {
        Ok(())
    } else {
        Err(format!(
            "Path is outside the Qwen projects root: {}",
            path.display()
        ))
    }
}

fn file_mtime_rfc3339(path: &Path) -> String {
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

    const SESSION: &str = concat!(
        r#"{"uuid":"u1","parentUuid":null,"sessionId":"sess-1","timestamp":"2026-06-20T10:00:00Z","type":"user","cwd":"/Users/jack/proj","message":{"role":"user","parts":[{"text":"why does LOGIN fail?"}]}}"#,
        "\n",
        r#"{"uuid":"u2","parentUuid":"u1","sessionId":"sess-1","timestamp":"2026-06-20T10:00:01Z","type":"assistant","model":"qwen3-coder-plus","usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":34,"cachedContentTokenCount":5},"message":{"role":"model","parts":[{"text":"let me reason","thought":true},{"text":"Checking auth"},{"functionCall":{"id":"c1","name":"run_shell_command","args":{"command":"grep -r login"}}}]}}"#,
        "\n",
        r#"{"uuid":"u3","parentUuid":"u2","sessionId":"sess-1","timestamp":"2026-06-20T10:00:02Z","type":"tool_result","cwd":"/Users/jack/proj","message":{"role":"user","parts":[{"functionResponse":{"id":"c1","name":"run_shell_command","response":{"output":"login.rs:42"}}}]}}"#,
        "\n",
        r#"{"uuid":"s1","sessionId":"sess-1","timestamp":"2026-06-20T10:00:03Z","type":"system","subtype":"custom_title","message":{"role":"user","parts":[{"text":"ignored"}]}}"#,
        "\n",
    );

    #[test]
    fn session_meta_extracts_cwd_count_summary() {
        let m = session_meta(SESSION).unwrap();
        assert_eq!(m.session_id, "sess-1");
        assert_eq!(m.cwd.as_deref(), Some("/Users/jack/proj"));
        // user + assistant + tool_result (system excluded) = 3
        assert_eq!(m.message_count, 3);
        assert_eq!(m.summary.as_deref(), Some("why does LOGIN fail?"));
        assert!(m.has_tool_use);
        assert_eq!(m.first_ts.as_deref(), Some("2026-06-20T10:00:00Z"));
        assert_eq!(m.last_ts.as_deref(), Some("2026-06-20T10:00:02Z"));
    }

    #[test]
    fn parse_messages_maps_parts_to_blocks() {
        let msgs = parse_messages(SESSION);
        // system record is skipped.
        assert_eq!(msgs.len(), 3);

        // user
        assert_eq!(msgs[0].role.as_deref(), Some("user"));
        assert_eq!(msgs[0].uuid, "u1");
        assert_eq!(msgs[0].provider.as_deref(), Some("qwen"));

        // assistant: thinking + text + tool_use, with usage + model + parent
        let a = &msgs[1];
        assert_eq!(a.role.as_deref(), Some("assistant"));
        assert_eq!(a.parent_uuid.as_deref(), Some("u1"));
        assert_eq!(a.model.as_deref(), Some("qwen3-coder-plus"));
        assert_eq!(a.usage.as_ref().unwrap().input_tokens, Some(12));
        assert_eq!(a.usage.as_ref().unwrap().output_tokens, Some(34));
        assert_eq!(a.usage.as_ref().unwrap().cache_read_input_tokens, Some(5));
        let ab = a.content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(ab[0]["type"], "thinking");
        assert_eq!(ab[1]["type"], "text");
        assert_eq!(ab[2]["type"], "tool_use");
        assert_eq!(ab[2]["name"], "run_shell_command");
        assert_eq!(ab[2]["id"], "c1");

        // tool_result -> user lane, tool_result block with extracted output
        assert_eq!(msgs[2].role.as_deref(), Some("user"));
        let tr = msgs[2].content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(tr[0]["type"], "tool_result");
        assert_eq!(tr[0]["tool_use_id"], "c1");
        assert_eq!(tr[0]["content"], "login.rs:42");
    }

    #[test]
    fn convert_part_kinds() {
        assert!(convert_part(&json!({"text":""})).is_none());
        assert_eq!(convert_part(&json!({"text":"hi"})).unwrap()["type"], "text");
        assert_eq!(
            convert_part(&json!({"text":"r","thought":true})).unwrap()["type"],
            "thinking"
        );
        // functionResponse with object output is stringified.
        let tr =
            convert_part(&json!({"functionResponse":{"id":"x","response":{"output":{"k":1}}}}))
                .unwrap();
        assert_eq!(tr["type"], "tool_result");
        assert!(tr["content"].as_str().unwrap().contains("\"k\""));
    }
}
