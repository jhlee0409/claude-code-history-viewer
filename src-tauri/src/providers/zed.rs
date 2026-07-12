//! Zed provider (Agent Panel thread history).
//!
//! Zed stores agent threads in a single `SQLite` DB under its data dir, which
//! mirrors Zed's own `paths::data_dir()`: macOS
//! `~/Library/Application Support/Zed`, Linux/FreeBSD `$XDG_DATA_HOME/zed`
//! (lowercase!), Windows `%LOCALAPPDATA%\Zed` — then `/threads/threads.db`.
//! The `threads` table holds metadata plus a `data` BLOB that is the serialized
//! `DbThread` JSON — stored either plain (`data_type = "json"`) or
//! Zstd-compressed (`data_type = "zstd"`). The optional columns `folder_paths`
//! and `created_at` are absent on older Zed schemas, so the SELECTs adapt via
//! `PRAGMA table_info`.
//!
//! `DbThread.messages` is an array of externally-tagged `Message` values:
//! `{"User":{content:[{Text}|{Mention}|{Image}]}}` /
//! `{"Agent":{content:[{Text}|{Thinking}|{RedactedThinking}|{ToolUse}],
//!  tool_results:{<id>:{...}}}}` / `"Resume"` / `{"Compaction":...}`. A legacy
//! `SerializedThread` shape (internally-tagged segments) is handled as a
//! fallback. Tool results live in a sibling `tool_results` map keyed by
//! tool-use id and are surfaced as a following user turn (Claude convention).
//!
//! Projects group by the thread's first workspace folder (`folder_paths`).
//! Schema is undocumented/unstable across Zed releases (see the `zed-chat-export`
//! reference tool); tool inputs/results are treated as opaque JSON.

use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::providers::ProviderInfo;
use crate::utils::{build_provider_message, search_json_value_case_insensitive};
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

const PROVIDER: &str = "zed";
const SCHEME: &str = "zed://";
const UNKNOWN_WORKSPACE: &str = "unknown";

fn get_db_path() -> Option<PathBuf> {
    // Mirror Zed's own `paths::data_dir()`. macOS uses ~/Library/Application
    // Support (== dirs::data_dir); Linux/FreeBSD and Windows use the *local*
    // data dir (XDG_DATA_HOME / %LOCALAPPDATA%, == dirs::data_local_dir), NOT
    // the roaming dir. The app folder is lowercase "zed" only on Linux/FreeBSD.
    let base = if cfg!(target_os = "macos") {
        dirs::data_dir()?
    } else {
        dirs::data_local_dir()?
    };
    let app_name = if cfg!(any(target_os = "linux", target_os = "freebsd")) {
        "zed"
    } else {
        "Zed"
    };
    Some(base.join(app_name).join("threads").join("threads.db"))
}

/// Detect a Zed installation.
pub fn detect() -> Option<ProviderInfo> {
    let db = get_db_path()?;
    Some(ProviderInfo {
        id: PROVIDER.to_string(),
        display_name: "Zed".to_string(),
        base_path: db
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        is_available: db.is_file(),
    })
}

/// Base path (the `threads` dir holding `threads.db`), for the file watcher.
pub fn get_base_path() -> Option<String> {
    get_db_path()?
        .parent()
        .map(|p| p.to_string_lossy().to_string())
}

fn open_db() -> Result<Connection, String> {
    let path = get_db_path().ok_or("Zed threads DB not found")?;
    if !path.is_file() {
        return Err("Zed threads database not found".to_string());
    }
    let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open Zed DB: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to set busy timeout: {e}"))?;
    Ok(conn)
}

/// First workspace folder of a thread (from the `folder_paths` JSON array),
/// used as the project grouping key.
fn workspace_of(folder_paths: Option<&str>) -> String {
    folder_paths
        .and_then(|fp| serde_json::from_str::<Value>(fp).ok())
        .and_then(|v| {
            v.as_array()
                .and_then(|a| a.first())
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| UNKNOWN_WORKSPACE.to_string())
}

/// Column names present in `table` (via `PRAGMA table_info`). Lets SELECTs adapt
/// to Zed's schema drift — older `threads` tables lack `folder_paths`/`created_at`.
fn table_columns(conn: &Connection, table: &str) -> HashSet<String> {
    let mut cols = HashSet::new();
    if let Ok(mut stmt) = conn.prepare(&format!("PRAGMA table_info({table})")) {
        if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(1)) {
            cols.extend(rows.flatten());
        }
    }
    cols
}

/// `name` when the column exists, else `NULL AS name` so the SELECT keeps the
/// expected column positions on older schemas. `name` is always a hardcoded
/// literal, so the interpolated SQL is safe.
fn optional_col(cols: &HashSet<String>, name: &str) -> String {
    if cols.contains(name) {
        name.to_string()
    } else {
        format!("NULL AS {name}")
    }
}

/// Scan Zed projects (threads grouped by first workspace folder).
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    scan_projects_conn(&open_db()?)
}

fn scan_projects_conn(conn: &Connection) -> Result<Vec<ClaudeProject>, String> {
    let cols = table_columns(conn, "threads");
    let sql = format!(
        "SELECT {}, updated_at FROM threads",
        optional_col(&cols, "folder_paths")
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    struct Agg {
        session_count: usize,
        last_modified: String,
    }
    let mut by_ws: HashMap<String, Agg> = HashMap::new();

    let rows = stmt
        .query_map([], |row| {
            let folder_paths: Option<String> = row.get(0)?;
            let updated_at: Option<String> = row.get(1)?;
            Ok((folder_paths, updated_at))
        })
        .map_err(|e| e.to_string())?;
    for (folder_paths, updated_at) in rows.flatten() {
        let ws = workspace_of(folder_paths.as_deref());
        let entry = by_ws.entry(ws).or_insert_with(|| Agg {
            session_count: 0,
            last_modified: String::new(),
        });
        entry.session_count += 1;
        let last = updated_at.unwrap_or_default();
        if last > entry.last_modified {
            entry.last_modified = last;
        }
    }

    let mut projects: Vec<ClaudeProject> = by_ws
        .into_iter()
        .map(|(ws, agg)| {
            let name = PathBuf::from(&ws)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| ws.clone());
            ClaudeProject {
                name,
                path: format!("{SCHEME}{ws}"),
                actual_path: ws,
                session_count: agg.session_count,
                message_count: 0,
                last_modified: agg.last_modified,
                git_info: None,
                provider: Some(PROVIDER.to_string()),
                storage_type: Some("sqlite".to_string()),
                custom_directory_label: None,
            }
        })
        .collect();
    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

/// Load the threads (sessions) for one Zed project (workspace folder).
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let target_ws = project_path.strip_prefix(SCHEME).unwrap_or(project_path);
    load_sessions_conn(&open_db()?, target_ws)
}

fn load_sessions_conn(conn: &Connection, target_ws: &str) -> Result<Vec<ClaudeSession>, String> {
    let cols = table_columns(conn, "threads");
    let sql = format!(
        "SELECT id, summary, {}, {}, updated_at FROM threads ORDER BY updated_at DESC",
        optional_col(&cols, "folder_paths"),
        optional_col(&cols, "created_at"),
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let project_name = PathBuf::from(target_ws)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let sessions = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let summary: Option<String> = row.get(1)?;
            let folder_paths: Option<String> = row.get(2)?;
            let created_at: Option<String> = row.get(3)?;
            let updated_at: Option<String> = row.get(4)?;
            Ok((id, summary, folder_paths, created_at, updated_at))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|(_, _, folder_paths, _, _)| workspace_of(folder_paths.as_deref()) == target_ws)
        .map(|(id, summary, _, created_at, updated_at)| {
            let created = created_at.unwrap_or_default();
            let updated = updated_at.unwrap_or_default();
            ClaudeSession {
                session_id: format!("{SCHEME}{id}"),
                actual_session_id: id.clone(),
                file_path: format!("{SCHEME}{id}"),
                project_name: project_name.clone(),
                message_count: 0,
                first_message_time: created.clone(),
                last_message_time: updated.clone(),
                last_modified: updated,
                has_tool_use: false,
                has_errors: false,
                summary: summary.filter(|s| !s.trim().is_empty()).or(Some(id)),
                is_renamed: false,
                provider: Some(PROVIDER.to_string()),
                storage_type: Some("sqlite".to_string()),
                entrypoint: None,
            }
        })
        .collect();

    Ok(sessions)
}

/// Load messages for one Zed thread (`zed://<thread_id>`).
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let id = session_path.strip_prefix(SCHEME).unwrap_or(session_path);
    let conn = open_db()?;
    let (data_type, data, updated_at): (String, Vec<u8>, Option<String>) = conn
        .query_row(
            "SELECT data_type, data, updated_at FROM threads WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| format!("Thread not found: {e}"))?;

    let json = decode_thread_data(&data_type, &data)?;
    Ok(parse_thread(&json, id, updated_at.as_deref().unwrap_or("")))
}

/// Search across all Zed threads.
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    if query.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }
    let conn = open_db()?;
    let query_lower = query.to_lowercase();
    let mut stmt = conn
        .prepare("SELECT id, data_type, data, updated_at FROM threads")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Vec<u8>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for (id, data_type, data, updated_at) in rows.flatten() {
        let Ok(json) = decode_thread_data(&data_type, &data) else {
            continue;
        };
        for msg in parse_thread(&json, &id, updated_at.as_deref().unwrap_or("")) {
            if results.len() >= limit {
                return Ok(results);
            }
            let matched = msg
                .content
                .as_ref()
                .map(|c| search_json_value_case_insensitive(c, &query_lower))
                .unwrap_or(false);
            if matched {
                results.push(msg);
            }
        }
    }
    Ok(results)
}

// ============================================================================
// Decoding + parsing (pure where possible)
// ============================================================================

/// Decode a `threads.data` BLOB to its `DbThread` JSON string.
fn decode_thread_data(data_type: &str, data: &[u8]) -> Result<Value, String> {
    let bytes = if data_type == "zstd" {
        zstd::decode_all(data).map_err(|e| format!("Failed to zstd-decode Zed thread: {e}"))?
    } else {
        data.to_vec()
    };
    serde_json::from_slice(&bytes).map_err(|e| format!("Failed to parse Zed thread JSON: {e}"))
}

/// Parse a decoded `DbThread` (or legacy `SerializedThread`) JSON into messages.
fn parse_thread(thread: &Value, thread_id: &str, ts: &str) -> Vec<ClaudeMessage> {
    let Some(messages) = thread.get("messages").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (idx, msg) in messages.iter().enumerate() {
        convert_message(msg, thread_id, idx, ts, &mut out);
    }
    out
}

/// Convert one `Message` (current `DbThread` shape, or legacy `SerializedMessage`)
/// and push the resulting message(s).
fn convert_message(
    msg: &Value,
    thread_id: &str,
    idx: usize,
    ts: &str,
    out: &mut Vec<ClaudeMessage>,
) {
    // Current externally-tagged shape: {"User":{...}} / {"Agent":{...}}.
    if let Some(user) = msg.get("User") {
        let blocks = user_blocks(user.get("content"));
        if !blocks.is_empty() {
            out.push(make_msg(thread_id, idx, "user", ts, blocks, None));
        }
        return;
    }
    if let Some(agent) = msg.get("Agent") {
        let blocks = agent_blocks(agent.get("content"));
        if !blocks.is_empty() {
            out.push(make_msg(thread_id, idx, "assistant", ts, blocks, None));
        }
        // Tool results live in a sibling map keyed by tool-use id -> surface as a
        // following user turn (Claude convention).
        if let Some(results) = agent.get("tool_results").and_then(Value::as_object) {
            let tr_blocks: Vec<Value> = results
                .iter()
                .map(|(tool_use_id, res)| {
                    let is_error = res.get("is_error").and_then(Value::as_bool).unwrap_or(false);
                    let content = res
                        .get("content")
                        .map(tool_result_content)
                        .unwrap_or_default();
                    json!({ "type": "tool_result", "tool_use_id": tool_use_id, "content": content, "is_error": is_error })
                })
                .collect();
            if !tr_blocks.is_empty() {
                out.push(make_msg(thread_id, idx, "user", ts, tr_blocks, Some("-tr")));
            }
        }
        return;
    }
    // Legacy SerializedMessage: {"role":"user"|"assistant"|"system","segments":[{"type":"text",...}],...}
    if let Some(role) = msg.get("role").and_then(Value::as_str) {
        let blocks = legacy_segments(msg.get("segments"));
        if !blocks.is_empty() {
            let mapped = if role == "assistant" {
                "assistant"
            } else {
                "user"
            };
            out.push(make_msg(thread_id, idx, mapped, ts, blocks, None));
        }
    }
    // "Resume" / {"Compaction":...} -> ignored.
}

fn user_blocks(content: Option<&Value>) -> Vec<Value> {
    let Some(items) = content.and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut blocks = Vec::new();
    for item in items {
        if let Some(text) = item.get("Text").and_then(Value::as_str) {
            if !text.is_empty() {
                blocks.push(json!({ "type": "text", "text": text }));
            }
        } else if let Some(mention) = item.get("Mention") {
            if let Some(text) = mention.get("content").and_then(Value::as_str) {
                if !text.is_empty() {
                    blocks.push(json!({ "type": "text", "text": text }));
                }
            }
        }
        // Image -> skipped in this MVP.
    }
    blocks
}

fn agent_blocks(content: Option<&Value>) -> Vec<Value> {
    let Some(items) = content.and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut blocks = Vec::new();
    for item in items {
        if let Some(text) = item.get("Text").and_then(Value::as_str) {
            if !text.is_empty() {
                blocks.push(json!({ "type": "text", "text": text }));
            }
        } else if let Some(thinking) = item.get("Thinking") {
            let text = thinking.get("text").and_then(Value::as_str).unwrap_or("");
            blocks.push(json!({
                "type": "thinking",
                "thinking": text,
                "signature": thinking.get("signature").and_then(Value::as_str).unwrap_or("")
            }));
        } else if let Some(rt) = item.get("RedactedThinking").and_then(Value::as_str) {
            blocks.push(json!({ "type": "redacted_thinking", "data": rt }));
        } else if let Some(tool) = item.get("ToolUse") {
            let id = tool.get("id").and_then(Value::as_str).unwrap_or("");
            let name = tool
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let input = tool
                .get("input")
                .or_else(|| tool.get("raw_input"))
                .cloned()
                .unwrap_or_else(|| json!({}));
            blocks.push(json!({ "type": "tool_use", "id": id, "name": name, "input": input }));
        }
    }
    blocks
}

fn legacy_segments(segments: Option<&Value>) -> Vec<Value> {
    let Some(items) = segments.and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut blocks = Vec::new();
    for seg in items {
        match seg.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(t) = seg.get("text").and_then(Value::as_str) {
                    if !t.is_empty() {
                        blocks.push(json!({ "type": "text", "text": t }));
                    }
                }
            }
            Some("thinking") => {
                let t = seg.get("text").and_then(Value::as_str).unwrap_or("");
                blocks.push(json!({
                    "type": "thinking",
                    "thinking": t,
                    "signature": seg.get("signature").and_then(Value::as_str).unwrap_or("")
                }));
            }
            _ => {}
        }
    }
    blocks
}

fn make_msg(
    thread_id: &str,
    idx: usize,
    role: &str,
    ts: &str,
    blocks: Vec<Value>,
    suffix: Option<&str>,
) -> ClaudeMessage {
    let uuid = format!("{thread_id}-{idx}{}", suffix.unwrap_or(""));
    build_provider_message(
        PROVIDER,
        uuid,
        thread_id,
        ts.to_string(),
        role,
        Some(role),
        Some(Value::Array(blocks)),
        None,
    )
}

/// Extract human-readable text from a Zed tool-result `content`. Zed serializes
/// this as `Vec<LanguageModelToolResultContent>` — a JSON array of externally
/// tagged items `{"Text": "..."}` / `{"Image": {...}}`. The wire format also
/// tolerates a bare string or a single item, so handle all three rather than
/// JSON-encoding the value verbatim (which would leak the enum tags into the
/// rendered result, e.g. `[{"Text":"auth.rs:42"}]`).
fn tool_result_content(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Array(items) => items
            .iter()
            .map(tool_result_content_part)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(_) => tool_result_content_part(v),
        other => other.to_string(),
    }
}

/// One `LanguageModelToolResultContent` item -> text. `{"Text": "..."}` yields the
/// text (Zed matches the key case-insensitively); `{"Image": ...}` becomes a
/// placeholder; a bare string passes through; anything else falls back to JSON.
fn tool_result_content_part(item: &Value) -> String {
    if let Value::String(s) = item {
        return s.clone();
    }
    if let Some(text) = item
        .get("Text")
        .or_else(|| item.get("text"))
        .and_then(Value::as_str)
    {
        return text.to_string();
    }
    if item.get("Image").is_some() || item.get("image").is_some() {
        return "[image]".to_string();
    }
    item.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db_thread() -> Value {
        json!({
            "title": "Fix LOGIN",
            "messages": [
                { "User": { "id": "u1", "content": [{ "Text": "why does LOGIN fail?" }, { "Mention": { "uri": "x", "content": "see auth.rs" } }] } },
                { "Agent": {
                    "content": [
                        { "Text": "Let me look" },
                        { "Thinking": { "text": "reasoning", "signature": "sig" } },
                        { "ToolUse": { "id": "t1", "name": "grep", "input": { "q": "login" } } }
                    ],
                    "tool_results": { "t1": { "content": [{ "Text": "auth.rs:42" }], "is_error": false } }
                } },
                "Resume"
            ]
        })
    }

    #[test]
    fn parse_thread_user_agent_and_tool_results() {
        let msgs = parse_thread(&db_thread(), "thread-1", "2026-06-20T10:00:00Z");
        // user, assistant, tool-result(user) ; "Resume" ignored
        assert_eq!(msgs.len(), 3);

        assert_eq!(msgs[0].role.as_deref(), Some("user"));
        assert_eq!(msgs[0].provider.as_deref(), Some("zed"));
        let u = msgs[0].content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(u[0]["text"], "why does LOGIN fail?");
        assert_eq!(u[1]["text"], "see auth.rs"); // Mention -> text

        let a = msgs[1].content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(a[0]["type"], "text");
        assert_eq!(a[1]["type"], "thinking");
        assert_eq!(a[2]["type"], "tool_use");
        assert_eq!(a[2]["id"], "t1");

        // tool_results -> following user turn with tool_result block joined by id
        assert_eq!(msgs[2].role.as_deref(), Some("user"));
        let tr = msgs[2].content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(tr[0]["type"], "tool_result");
        assert_eq!(tr[0]["tool_use_id"], "t1");
        assert_eq!(tr[0]["content"], "auth.rs:42");
    }

    #[test]
    fn tool_result_content_extracts_text_from_all_shapes() {
        // Legacy bare string passes through.
        assert_eq!(tool_result_content(&json!("auth.rs:42")), "auth.rs:42");
        // Modern Vec<LanguageModelToolResultContent>: array of externally-tagged items.
        assert_eq!(
            tool_result_content(&json!([{ "Text": "auth.rs:42" }])),
            "auth.rs:42"
        );
        // Multiple parts incl. an image placeholder, joined by newline.
        assert_eq!(
            tool_result_content(&json!([
                { "Text": "line 1" },
                { "Image": { "source": "data:...", "size": { "width": 1, "height": 1 } } },
                { "Text": "line 2" }
            ])),
            "line 1\n[image]\nline 2"
        );
        // A single item that wasn't wrapped in an array.
        assert_eq!(tool_result_content(&json!({ "Text": "single" })), "single");
        // The old behaviour would have leaked the enum tag; ensure it does not.
        assert!(!tool_result_content(&json!([{ "Text": "x" }])).contains("Text"));
    }

    #[test]
    fn parse_legacy_serialized_thread() {
        let legacy = json!({
            "version": "0.1.0",
            "summary": "old",
            "messages": [
                { "id": 1, "role": "user", "segments": [{ "type": "text", "text": "hi" }] },
                { "id": 2, "role": "assistant", "segments": [
                    { "type": "thinking", "text": "hmm", "signature": "s" },
                    { "type": "text", "text": "hello" }
                ] }
            ]
        });
        let msgs = parse_thread(&legacy, "t", "");
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].role.as_deref(), Some("user"));
        assert_eq!(msgs[1].role.as_deref(), Some("assistant"));
        let a = msgs[1].content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(a[0]["type"], "thinking");
        assert_eq!(a[1]["type"], "text");
    }

    #[test]
    fn workspace_grouping_from_folder_paths() {
        assert_eq!(
            workspace_of(Some(r#"["/Users/jack/proj","/other"]"#)),
            "/Users/jack/proj"
        );
        assert_eq!(workspace_of(Some("[]")), "unknown");
        assert_eq!(workspace_of(None), "unknown");
    }

    #[test]
    fn db_path_uses_platform_app_name() {
        let Some(p) = get_db_path() else { return };
        let s = p.to_string_lossy().replace('\\', "/");
        assert!(s.ends_with("threads/threads.db"), "got {s}");
        if cfg!(any(target_os = "linux", target_os = "freebsd")) {
            assert!(
                s.contains("/zed/threads"),
                "linux must use lowercase zed: {s}"
            );
        } else {
            assert!(s.contains("/Zed/threads"), "got {s}");
        }
    }

    #[test]
    fn table_columns_and_optional_col() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE threads (id TEXT, summary TEXT)", [])
            .unwrap();
        let cols = table_columns(&conn, "threads");
        assert!(cols.contains("id") && cols.contains("summary"));
        assert!(!cols.contains("folder_paths"));
        assert_eq!(optional_col(&cols, "id"), "id");
        assert_eq!(optional_col(&cols, "folder_paths"), "NULL AS folder_paths");
    }

    fn insert_thread(conn: &Connection, cols: &str, values: &[&dyn rusqlite::ToSql]) {
        let placeholders = (1..=values.len())
            .map(|i| format!("?{i}"))
            .collect::<Vec<_>>()
            .join(",");
        conn.execute(
            &format!("INSERT INTO threads ({cols}) VALUES ({placeholders})"),
            values,
        )
        .unwrap();
    }

    #[test]
    fn scan_and_load_tolerate_old_5col_schema() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE threads (id TEXT PRIMARY KEY, summary TEXT NOT NULL, \
             updated_at TEXT NOT NULL, data_type TEXT NOT NULL, data BLOB NOT NULL)",
            [],
        )
        .unwrap();
        let data = serde_json::to_vec(&json!({ "messages": [] })).unwrap();
        insert_thread(
            &conn,
            "id, summary, updated_at, data_type, data",
            &[
                &"t1",
                &"Old thread",
                &"2026-06-20T10:00:00Z",
                &"json",
                &data,
            ],
        );

        // No folder_paths / created_at columns -> must not error.
        let projects = scan_projects_conn(&conn).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].actual_path, "unknown"); // no folder_paths -> grouped as unknown
        assert_eq!(projects[0].session_count, 1);

        let sessions = load_sessions_conn(&conn, "unknown").unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].actual_session_id, "t1");
        assert_eq!(sessions[0].summary.as_deref(), Some("Old thread"));
    }

    #[test]
    fn scan_and_load_use_new_schema_columns() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE threads (id TEXT PRIMARY KEY, summary TEXT NOT NULL, \
             updated_at TEXT NOT NULL, data_type TEXT NOT NULL, data BLOB NOT NULL, \
             folder_paths TEXT, created_at TEXT)",
            [],
        )
        .unwrap();
        let data = serde_json::to_vec(&json!({ "messages": [] })).unwrap();
        insert_thread(
            &conn,
            "id, summary, updated_at, data_type, data, folder_paths, created_at",
            &[
                &"t1",
                &"New",
                &"2026-06-20T10:00:00Z",
                &"json",
                &data,
                &r#"["/Users/jack/proj"]"#,
                &"2026-06-20T09:00:00Z",
            ],
        );

        let projects = scan_projects_conn(&conn).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].actual_path, "/Users/jack/proj");

        let sessions = load_sessions_conn(&conn, "/Users/jack/proj").unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].first_message_time, "2026-06-20T09:00:00Z"); // created_at
    }

    #[test]
    fn decode_plain_and_zstd() {
        let value = json!({ "messages": [] });
        let json_bytes = serde_json::to_vec(&value).unwrap();
        // plain
        let got = decode_thread_data("json", &json_bytes).unwrap();
        assert!(got.get("messages").is_some());
        // zstd
        let compressed = zstd::encode_all(&json_bytes[..], 3).unwrap();
        let got = decode_thread_data("zstd", &compressed).unwrap();
        assert!(got.get("messages").is_some());
    }
}
