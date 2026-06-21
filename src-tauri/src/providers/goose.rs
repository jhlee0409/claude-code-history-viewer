//! Goose provider (Block's open-source on-machine agent).
//!
//! Reads the single `SQLite` store Goose has used since ~v1.10.0:
//! `<data-dir>/sessions/sessions.db`, with a `sessions` table (one row per
//! session, grouped here by `working_dir`) and a `messages` table (one row per
//! message; `content_json` holds a JSON array of Goose `MessageContent` items).
//!
//! Path resolution mirrors Goose's `etcetera` strategy with a tolerant fallback
//! list (the macOS location is reported inconsistently upstream, so we probe
//! both the XDG and Apple locations). `GOOSE_PATH_ROOT` overrides the root.
//!
//! `content_json` items are internally tagged (`{"type":"text",...}` /
//! `{"type":"toolRequest",...}` / `{"type":"toolResponse",...}` /
//! `{"type":"thinking",...}`); we map them to the viewer's Claude-style content
//! blocks so the existing renderers light up.

use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::providers::ProviderInfo;
use crate::utils::{build_provider_message, ms_to_iso, search_json_value_case_insensitive};
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::path::PathBuf;

const PROVIDER: &str = "goose";
const SCHEME: &str = "goose://";

/// Candidate `sessions.db` locations, most-specific first.
fn candidate_db_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    // GOOSE_PATH_ROOT override → <root>/data/sessions/sessions.db
    if let Ok(root) = std::env::var("GOOSE_PATH_ROOT") {
        let root = root.trim();
        if !root.is_empty() {
            paths.push(PathBuf::from(root).join("data/sessions/sessions.db"));
        }
    }
    // $XDG_DATA_HOME/goose/sessions/sessions.db
    if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
        let xdg = xdg.trim();
        if !xdg.is_empty() {
            paths.push(PathBuf::from(xdg).join("goose/sessions/sessions.db"));
        }
    }
    if let Some(home) = dirs::home_dir() {
        // XDG default (Linux, and macOS under Goose's etcetera strategy).
        paths.push(home.join(".local/share/goose/sessions/sessions.db"));
        // macOS Apple-strategy fallback.
        #[cfg(target_os = "macos")]
        paths.push(home.join("Library/Application Support/Block/goose/sessions/sessions.db"));
    }
    // Windows: %APPDATA%\Block\goose\data\sessions\sessions.db
    #[cfg(target_os = "windows")]
    if let Some(data) = dirs::data_dir() {
        paths.push(data.join("Block/goose/data/sessions/sessions.db"));
    }

    paths
}

fn get_db_path() -> Option<PathBuf> {
    candidate_db_paths().into_iter().find(|p| p.is_file())
}

/// Detect a Goose installation (only when the sessions DB exists).
pub fn detect() -> Option<ProviderInfo> {
    let db = get_db_path()?;
    Some(ProviderInfo {
        id: PROVIDER.to_string(),
        display_name: "Goose".to_string(),
        base_path: db
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        is_available: true,
    })
}

/// Base path (the `sessions` dir holding `sessions.db`), for the file watcher.
pub fn get_base_path() -> Option<String> {
    Some(get_db_path()?.parent()?.to_string_lossy().to_string())
}

fn open_db() -> Result<Connection, String> {
    let path = get_db_path().ok_or("Goose sessions DB not found")?;
    let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open Goose DB: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to set busy timeout: {e}"))?;
    Ok(conn)
}

/// Scan Goose projects (grouped by `working_dir`).
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    scan_in_conn(&open_db()?)
}

fn scan_in_conn(conn: &Connection) -> Result<Vec<ClaudeProject>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT COALESCE(NULLIF(s.working_dir, ''), 'unknown') AS working_dir, \
                    COUNT(DISTINCT s.id) AS sess_cnt, \
                    COUNT(m.id) AS msg_cnt, MAX(s.updated_at) AS last_upd \
             FROM sessions s LEFT JOIN messages m ON m.session_id = s.id \
             GROUP BY COALESCE(NULLIF(s.working_dir, ''), 'unknown') ORDER BY last_upd DESC",
        )
        .map_err(|e| e.to_string())?;

    let projects = stmt
        .query_map([], |row| {
            let working_dir: Option<String> = row.get(0)?;
            let sess_cnt: usize = row.get(1)?;
            let msg_cnt: usize = row.get(2)?;
            let last_upd: Option<String> = row.get(3)?;
            Ok((working_dir, sess_cnt, msg_cnt, last_upd))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|(working_dir, sess_cnt, msg_cnt, last_upd)| {
            let cwd = working_dir
                .filter(|w| !w.is_empty())
                .unwrap_or_else(|| "unknown".to_string());
            let name = PathBuf::from(&cwd)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| cwd.clone());
            ClaudeProject {
                name,
                path: format!("{SCHEME}{cwd}"),
                actual_path: cwd,
                session_count: sess_cnt,
                message_count: msg_cnt,
                last_modified: normalize_ts(last_upd.as_deref().unwrap_or_default()),
                git_info: None,
                provider: Some(PROVIDER.to_string()),
                storage_type: Some("sqlite".to_string()),
                custom_directory_label: None,
            }
        })
        .collect();

    Ok(projects)
}

/// Load the sessions for one Goose project (`working_dir`).
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let working_dir = project_path.strip_prefix(SCHEME).unwrap_or(project_path);
    load_sessions_conn(&open_db()?, working_dir)
}

fn load_sessions_conn(conn: &Connection, working_dir: &str) -> Result<Vec<ClaudeSession>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.name, s.description, s.created_at, s.updated_at, \
                    (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS msg_cnt \
             FROM sessions s \
             WHERE COALESCE(NULLIF(s.working_dir, ''), 'unknown') = ?1 \
             ORDER BY s.updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let project_name = PathBuf::from(working_dir)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let sessions = stmt
        .query_map([working_dir], |row| {
            let id: String = row.get(0)?;
            let name: Option<String> = row.get(1)?;
            let description: Option<String> = row.get(2)?;
            let created: Option<String> = row.get(3)?;
            let updated: Option<String> = row.get(4)?;
            let msg_cnt: usize = row.get(5)?;
            Ok((id, name, description, created, updated, msg_cnt))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|(id, name, description, created, updated, msg_cnt)| {
            let summary = description
                .filter(|d| !d.trim().is_empty())
                .or(name.filter(|n| !n.trim().is_empty()))
                .or_else(|| Some(id.clone()));
            let created_iso = normalize_ts(created.as_deref().unwrap_or_default());
            let updated_iso = normalize_ts(updated.as_deref().unwrap_or_default());
            ClaudeSession {
                session_id: format!("{SCHEME}{id}"),
                actual_session_id: id.clone(),
                file_path: format!("{SCHEME}{id}"),
                project_name: project_name.clone(),
                message_count: msg_cnt,
                first_message_time: created_iso.clone(),
                last_message_time: updated_iso.clone(),
                last_modified: updated_iso,
                has_tool_use: false,
                has_errors: false,
                summary,
                is_renamed: false,
                provider: Some(PROVIDER.to_string()),
                storage_type: Some("sqlite".to_string()),
                entrypoint: None,
            }
        })
        .collect();

    Ok(sessions)
}

/// Load messages for one Goose session.
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let session_id = session_path.strip_prefix(SCHEME).unwrap_or(session_path);
    load_messages_conn(&open_db()?, session_id)
}

fn load_messages_conn(conn: &Connection, session_id: &str) -> Result<Vec<ClaudeMessage>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, role, content_json, created_timestamp, message_id \
             FROM messages WHERE session_id = ?1 ORDER BY id",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([session_id], |row| {
            let row_id: i64 = row.get(0)?;
            let role: String = row.get(1)?;
            let content_json: String = row.get(2)?;
            let created: i64 = row.get(3)?;
            let message_id: Option<String> = row.get(4)?;
            Ok((row_id, role, content_json, created, message_id))
        })
        .map_err(|e| e.to_string())?;

    let mut messages = Vec::new();
    for row in rows.flatten() {
        let (row_id, role, content_json, created, message_id) = row;
        if let Some(msg) = build_message(
            session_id,
            row_id,
            &role,
            &content_json,
            created,
            message_id,
        ) {
            messages.push(msg);
        }
    }
    Ok(messages)
}

/// Search across all Goose messages.
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    if query.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }
    search_conn(&open_db()?, query, limit)
}

fn search_conn(conn: &Connection, query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let pattern = format!("%{query}%");
    let query_lower = query.to_lowercase();

    let mut stmt = conn
        .prepare(
            "SELECT s.working_dir, m.id, m.session_id, m.role, m.content_json, \
                    m.created_timestamp, m.message_id \
             FROM messages m JOIN sessions s ON s.id = m.session_id \
             WHERE m.content_json LIKE ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([&pattern], |row| {
            let working_dir: Option<String> = row.get(0)?;
            let row_id: i64 = row.get(1)?;
            let session_id: String = row.get(2)?;
            let role: String = row.get(3)?;
            let content_json: String = row.get(4)?;
            let created: i64 = row.get(5)?;
            let message_id: Option<String> = row.get(6)?;
            Ok((
                working_dir,
                row_id,
                session_id,
                role,
                content_json,
                created,
                message_id,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows.flatten() {
        let (working_dir, row_id, session_id, role, content_json, created, message_id) = row;
        let Some(mut msg) = build_message(
            &session_id,
            row_id,
            &role,
            &content_json,
            created,
            message_id,
        ) else {
            continue;
        };
        let matched = msg
            .content
            .as_ref()
            .map(|c| search_json_value_case_insensitive(c, &query_lower))
            .unwrap_or(false);
        if !matched {
            continue;
        }
        let project_name = working_dir
            .as_deref()
            .map(|w| {
                PathBuf::from(w)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| w.to_string())
            })
            .unwrap_or_default();
        msg.project_name = Some(project_name);
        results.push(msg);
        if results.len() >= limit {
            break;
        }
    }
    Ok(results)
}

// ============================================================================
// Pure conversion (unit-testable)
// ============================================================================

/// Build one `ClaudeMessage` from a `messages` row. `None` when the row carries
/// no renderable content.
fn build_message(
    session_id: &str,
    row_id: i64,
    role: &str,
    content_json: &str,
    created: i64,
    message_id: Option<String>,
) -> Option<ClaudeMessage> {
    if !matches!(role, "user" | "assistant" | "system") {
        return None;
    }
    let blocks = map_content(content_json);
    if blocks.is_empty() {
        return None;
    }
    // Fall back to the stable DB row id (not an enumeration index) so a message's
    // UUID is identical whether produced by load_messages or search.
    let uuid = message_id
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| format!("{session_id}-{row_id}"));
    Some(build_provider_message(
        PROVIDER,
        uuid,
        session_id,
        epoch_to_iso(created),
        role,
        Some(role),
        Some(Value::Array(blocks)),
        None,
    ))
}

/// Map Goose `content_json` (a JSON array of internally-tagged `MessageContent`
/// items) into the viewer's Claude-style content blocks.
fn map_content(content_json: &str) -> Vec<Value> {
    let Ok(Value::Array(items)) = serde_json::from_str::<Value>(content_json) else {
        return Vec::new();
    };
    items.iter().filter_map(map_content_item).collect()
}

fn map_content_item(item: &Value) -> Option<Value> {
    match item.get("type").and_then(Value::as_str)? {
        "text" => {
            let text = item.get("text").and_then(Value::as_str).unwrap_or("");
            if text.is_empty() {
                None
            } else {
                Some(json!({ "type": "text", "text": text }))
            }
        }
        "thinking" => {
            let thinking = item.get("thinking").and_then(Value::as_str).unwrap_or("");
            Some(json!({
                "type": "thinking",
                "thinking": thinking,
                "signature": item.get("signature").and_then(Value::as_str).unwrap_or("")
            }))
        }
        "redactedThinking" => Some(json!({
            "type": "redacted_thinking",
            "data": item.get("data").and_then(Value::as_str).unwrap_or("")
        })),
        "toolRequest" => {
            let id = item.get("id").and_then(Value::as_str).unwrap_or("");
            let value = item.get("toolCall").and_then(|tc| tc.get("value"));
            let name = value
                .and_then(|v| v.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let input = value
                .and_then(|v| v.get("arguments"))
                .cloned()
                .unwrap_or_else(|| json!({}));
            Some(json!({ "type": "tool_use", "id": id, "name": name, "input": input }))
        }
        "toolResponse" => {
            let id = item.get("id").and_then(Value::as_str).unwrap_or("");
            let result = item.get("toolResult");
            let is_error =
                result.and_then(|r| r.get("status")).and_then(Value::as_str) == Some("error");
            let content = if is_error {
                result
                    .and_then(|r| r.get("error"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string()
            } else {
                // value.content is a Vec of MCP content items ({"type":"text","text":..}).
                result
                    .and_then(|r| r.get("value"))
                    .and_then(|v| v.get("content"))
                    .and_then(Value::as_array)
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|c| c.get("text").and_then(Value::as_str))
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                    .unwrap_or_default()
            };
            Some(json!({
                "type": "tool_result",
                "tool_use_id": id,
                "content": content,
                "is_error": is_error
            }))
        }
        _ => None,
    }
}

/// Convert an epoch timestamp (seconds or ms) to RFC3339.
fn epoch_to_iso(n: i64) -> String {
    if n <= 0 {
        return String::new();
    }
    let ms = if n > 1_000_000_000_000 { n } else { n * 1000 };
    ms_to_iso(ms as u64)
}

/// Normalize a `SQLite` `TIMESTAMP` text ("YYYY-MM-DD HH:MM:SS", UTC) to ISO
/// 8601. Values that already look ISO-ish (contain `T`) pass through.
fn normalize_ts(ts: &str) -> String {
    let ts = ts.trim();
    if ts.is_empty() || ts.contains('T') {
        return ts.to_string();
    }
    match ts.split_once(' ') {
        Some((date, time)) => format!("{date}T{time}Z"),
        None => ts.to_string(),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal Goose schema + fixtures in an in-memory DB.
    fn fixture_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (id TEXT PRIMARY KEY, name TEXT, description TEXT, \
                 working_dir TEXT NOT NULL, created_at TEXT, updated_at TEXT);
             CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT, \
                 session_id TEXT NOT NULL, role TEXT NOT NULL, content_json TEXT NOT NULL, \
                 created_timestamp INTEGER NOT NULL);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sessions VALUES ('s1','title-a','Fix login','/Users/jack/proj','2026-06-20 09:00:00','2026-06-21 10:00:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sessions VALUES ('s2',NULL,NULL,'/Users/jack/proj','2026-06-19 09:00:00','2026-06-19 09:30:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sessions VALUES ('s3','other',NULL,'/Users/jack/other','2026-06-18 09:00:00','2026-06-18 09:30:00')",
            [],
        )
        .unwrap();
        let user = r#"[{"type":"text","text":"why does LOGIN fail?"}]"#;
        let asst = r#"[{"type":"text","text":"Let me check"},{"type":"toolRequest","id":"call1","toolCall":{"status":"success","value":{"name":"developer__shell","arguments":{"command":"ls"}}}}]"#;
        let toolresp = r#"[{"type":"toolResponse","id":"call1","toolResult":{"status":"success","value":{"content":[{"type":"text","text":"file.rs"}]}}}]"#;
        conn.execute("INSERT INTO messages (message_id,session_id,role,content_json,created_timestamp) VALUES ('m1','s1','user',?1,1750500000)", [user]).unwrap();
        conn.execute("INSERT INTO messages (message_id,session_id,role,content_json,created_timestamp) VALUES ('m2','s1','assistant',?1,1750500001)", [asst]).unwrap();
        conn.execute("INSERT INTO messages (message_id,session_id,role,content_json,created_timestamp) VALUES ('m3','s1','user',?1,1750500002)", [toolresp]).unwrap();
        conn
    }

    #[test]
    fn scan_groups_by_working_dir() {
        let conn = fixture_db();
        let projects = scan_in_conn(&conn).unwrap();
        assert_eq!(projects.len(), 2);
        let proj = projects.iter().find(|p| p.name == "proj").unwrap();
        assert_eq!(proj.session_count, 2);
        assert_eq!(proj.message_count, 3);
        assert_eq!(proj.provider.as_deref(), Some("goose"));
        assert_eq!(proj.storage_type.as_deref(), Some("sqlite"));
        assert_eq!(proj.path, "goose:///Users/jack/proj");
        assert_eq!(proj.last_modified, "2026-06-21T10:00:00Z");
    }

    #[test]
    fn load_sessions_filters_and_summarizes() {
        let conn = fixture_db();
        let sessions = load_sessions_conn(&conn, "/Users/jack/proj").unwrap();
        assert_eq!(sessions.len(), 2);
        let s1 = sessions
            .iter()
            .find(|s| s.actual_session_id == "s1")
            .unwrap();
        assert_eq!(s1.message_count, 3);
        assert_eq!(s1.summary.as_deref(), Some("Fix login")); // description wins
        assert_eq!(s1.file_path, "goose://s1");
        // s2 has no name/description -> falls back to the session id.
        let s2 = sessions
            .iter()
            .find(|s| s.actual_session_id == "s2")
            .unwrap();
        assert_eq!(s2.summary.as_deref(), Some("s2"));
    }

    #[test]
    fn load_messages_maps_text_and_tools() {
        let conn = fixture_db();
        let msgs = load_messages_conn(&conn, "s1").unwrap();
        assert_eq!(msgs.len(), 3);

        assert_eq!(msgs[0].role.as_deref(), Some("user"));
        assert_eq!(msgs[0].uuid, "m1");

        // assistant: text + tool_use
        let asst = msgs[1].content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(asst[0]["type"], "text");
        assert_eq!(asst[1]["type"], "tool_use");
        assert_eq!(asst[1]["name"], "developer__shell");
        assert_eq!(asst[1]["id"], "call1");
        assert_eq!(asst[1]["input"]["command"], "ls");

        // tool response -> tool_result with extracted text
        let tr = msgs[2].content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(tr[0]["type"], "tool_result");
        assert_eq!(tr[0]["tool_use_id"], "call1");
        assert_eq!(tr[0]["content"], "file.rs");
        assert_eq!(tr[0]["is_error"], false);
    }

    #[test]
    fn search_matches_content_and_tags_project() {
        let conn = fixture_db();
        let results = search_conn(&conn, "LOGIN", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].project_name.as_deref(), Some("proj"));
        let none = search_conn(&conn, "nonexistent-xyz", 10).unwrap();
        assert!(none.is_empty());
    }

    #[test]
    fn map_tool_response_error() {
        let item = json!({
            "type": "toolResponse",
            "id": "c1",
            "toolResult": {"status": "error", "error": "boom"}
        });
        let block = map_content_item(&item).unwrap();
        assert_eq!(block["type"], "tool_result");
        assert_eq!(block["is_error"], true);
        assert_eq!(block["content"], "boom");
    }

    #[test]
    fn map_thinking_and_skips_unknown() {
        let think = json!({"type":"thinking","thinking":"hmm","signature":"sig"});
        let b = map_content_item(&think).unwrap();
        assert_eq!(b["type"], "thinking");
        assert_eq!(b["thinking"], "hmm");
        assert!(map_content_item(&json!({"type":"image","image":{}})).is_none());
        assert!(map_content_item(&json!({"type":"text","text":""})).is_none());
    }

    #[test]
    fn normalize_ts_and_epoch() {
        assert_eq!(normalize_ts("2026-06-21 10:00:00"), "2026-06-21T10:00:00Z");
        assert_eq!(normalize_ts("2026-06-21T10:00:00Z"), "2026-06-21T10:00:00Z");
        assert_eq!(normalize_ts(""), "");
        // epoch seconds -> iso (non-empty)
        assert!(!epoch_to_iso(1750500000).is_empty());
        assert_eq!(epoch_to_iso(0), "");
    }

    /// An empty `working_dir` must round-trip: it's grouped under "unknown" in
    /// scan and resolvable by `load_sessions("unknown")`.
    #[test]
    fn empty_working_dir_rounds_trips_as_unknown() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (id TEXT PRIMARY KEY, name TEXT, description TEXT, \
                 working_dir TEXT NOT NULL, created_at TEXT, updated_at TEXT);
             CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT, \
                 session_id TEXT NOT NULL, role TEXT NOT NULL, content_json TEXT NOT NULL, \
                 created_timestamp INTEGER NOT NULL);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sessions VALUES ('s1',NULL,NULL,'','2026-06-20 09:00:00','2026-06-20 09:30:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (message_id,session_id,role,content_json,created_timestamp) VALUES ('m1','s1','user',?1,1750500000)",
            [r#"[{"type":"text","text":"hi"}]"#],
        )
        .unwrap();

        let projects = scan_in_conn(&conn).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].actual_path, "unknown");
        assert_eq!(projects[0].path, "goose://unknown");

        // The key the project advertises must resolve back to its sessions.
        let sessions = load_sessions_conn(&conn, "unknown").unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].actual_session_id, "s1");
    }

    /// A NULL `message_id` must get the same UUID from load and search (stable
    /// DB row id), not divergent enumeration indices.
    #[test]
    fn null_message_id_uuid_is_stable_across_load_and_search() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (id TEXT PRIMARY KEY, name TEXT, description TEXT, \
                 working_dir TEXT NOT NULL, created_at TEXT, updated_at TEXT);
             CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT, \
                 session_id TEXT NOT NULL, role TEXT NOT NULL, content_json TEXT NOT NULL, \
                 created_timestamp INTEGER NOT NULL);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sessions VALUES ('s1',NULL,NULL,'/p','2026-06-20 09:00:00','2026-06-20 09:30:00')",
            [],
        )
        .unwrap();
        // A decoy message first so the search-filtered index differs from the
        // session index, then the NULL-message_id message we assert on.
        conn.execute(
            "INSERT INTO messages (message_id,session_id,role,content_json,created_timestamp) VALUES ('keep','s1','user',?1,1750500000)",
            [r#"[{"type":"text","text":"decoy"}]"#],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (message_id,session_id,role,content_json,created_timestamp) VALUES (NULL,'s1','assistant',?1,1750500001)",
            [r#"[{"type":"text","text":"NEEDLE here"}]"#],
        )
        .unwrap();

        let loaded = load_messages_conn(&conn, "s1").unwrap();
        let loaded_uuid = &loaded[1].uuid; // the NULL-message_id row
        assert!(loaded_uuid.starts_with("s1-"));

        let found = search_conn(&conn, "NEEDLE", 10).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(&found[0].uuid, loaded_uuid, "load and search must agree");
    }
}
