//! Crush provider (Charmbracelet's agentic coding TUI).
//!
//! Crush stores history **per project** in `<project>/.crush/crush.db` (`SQLite`)
//! — there is no global root — so discovery mirrors the Aider provider: a
//! depth-limited scan of common code roots (`~/{client,projects,code,src,dev,
//! work,repos}` + `$HOME`) for `.crush/crush.db`. Each such DB is one project.
//!
//! Tables: `sessions(id,title,...,created_at,updated_at INTEGER)` and
//! `messages(id,session_id,role,parts TEXT,created_at,...)`. `parts` is a JSON
//! array of `{"type":..,"data":..}` items (`text`/`tool_call`/`tool_result`/
//! `reasoning`/…); we map them to the viewer's Claude-style content blocks.
//!
//! NOTE: because DBs are scattered, Crush is not tracked by the file watcher or
//! the `WebUI` session-path allowlist (the desktop IPC path works; the `WebUI`
//! headless server cannot read arbitrary per-project DBs).

use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::providers::ProviderInfo;
use crate::utils::{build_provider_message, ms_to_iso, search_json_value_case_insensitive};
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

const PROVIDER: &str = "crush";
const SCHEME: &str = "crush://";
/// Separator between the project dir and session id in a session path.
const SESSION_SEP: char = '#';
/// Max `.crush/crush.db` files to discover (guards the recursive scan).
const MAX_DBS: usize = 200;
const MAX_DEPTH: usize = 4;

/// Detect a Crush installation (shallow scan for any `.crush/crush.db`).
pub fn detect() -> Option<ProviderInfo> {
    let dbs = discover_dbs(1);
    let base = dbs
        .first()
        .and_then(|p| p.parent())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    if dbs.is_empty() {
        return None;
    }
    Some(ProviderInfo {
        id: PROVIDER.to_string(),
        display_name: "Crush".to_string(),
        base_path: base,
        is_available: true,
    })
}

/// Crush has no single root (per-project DBs), so the watcher / `WebUI`
/// allowlist don't track it.
pub fn get_base_path() -> Option<String> {
    None
}

/// Scan Crush projects — one per discovered `<project>/.crush/crush.db`.
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let mut projects = Vec::new();
    for db_path in discover_dbs(MAX_DBS) {
        let Some(project_dir) = project_dir_of(&db_path) else {
            continue;
        };
        let Ok(conn) = open_db(&db_path) else {
            continue;
        };
        if let Ok((session_count, message_count, last_modified)) = project_stats(&conn) {
            if session_count == 0 {
                continue;
            }
            let name = Path::new(&project_dir)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| project_dir.clone());
            projects.push(ClaudeProject {
                name,
                path: format!("{SCHEME}{project_dir}"),
                actual_path: project_dir,
                session_count,
                message_count,
                last_modified,
                git_info: None,
                provider: Some(PROVIDER.to_string()),
                storage_type: Some("sqlite".to_string()),
                custom_directory_label: None,
            });
        }
    }
    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

/// Load the sessions for one Crush project (`crush://<project_dir>`).
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let project_dir = project_path.strip_prefix(SCHEME).unwrap_or(project_path);
    let db_path = db_path_for(project_dir)?;
    let conn = open_db(&db_path)?;
    load_sessions_conn(&conn, project_dir)
}

fn load_sessions_conn(conn: &Connection, project_dir: &str) -> Result<Vec<ClaudeSession>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.title, s.created_at, s.updated_at, \
                    (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS msg_cnt \
             FROM sessions s ORDER BY s.updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let project_name = Path::new(project_dir)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let sessions = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let title: Option<String> = row.get(1)?;
            let created: Option<i64> = row.get(2)?;
            let updated: Option<i64> = row.get(3)?;
            let msg_cnt: usize = row.get(4)?;
            Ok((id, title, created, updated, msg_cnt))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|(id, title, created, updated, msg_cnt)| {
            let created_iso = epoch_to_iso(created.unwrap_or(0));
            let updated_iso = epoch_to_iso(updated.unwrap_or(0));
            ClaudeSession {
                session_id: format!("{SCHEME}{project_dir}{SESSION_SEP}{id}"),
                actual_session_id: id.clone(),
                file_path: format!("{SCHEME}{project_dir}{SESSION_SEP}{id}"),
                project_name: project_name.clone(),
                message_count: msg_cnt,
                first_message_time: created_iso.clone(),
                last_message_time: updated_iso.clone(),
                last_modified: updated_iso,
                has_tool_use: false,
                has_errors: false,
                summary: title.filter(|t| !t.trim().is_empty()).or(Some(id)),
                is_renamed: false,
                provider: Some(PROVIDER.to_string()),
                storage_type: Some("sqlite".to_string()),
                entrypoint: None,
            }
        })
        .collect();

    Ok(sessions)
}

/// Load messages for one Crush session (`crush://<project_dir>#<session_id>`).
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let (project_dir, session_id) = parse_session_path(session_path)?;
    let db_path = db_path_for(&project_dir)?;
    let conn = open_db(&db_path)?;
    load_messages_conn(&conn, &session_id)
}

fn load_messages_conn(conn: &Connection, session_id: &str) -> Result<Vec<ClaudeMessage>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, role, parts, created_at FROM messages \
             WHERE session_id = ?1 ORDER BY created_at, id",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([session_id], |row| {
            let id: String = row.get(0)?;
            let role: String = row.get(1)?;
            let parts: String = row.get(2)?;
            let created: Option<i64> = row.get(3)?;
            Ok((id, role, parts, created))
        })
        .map_err(|e| e.to_string())?;

    let mut messages = Vec::new();
    for row in rows.flatten() {
        let (id, role, parts, created) = row;
        if let Some(msg) = build_message(session_id, &id, &role, &parts, created.unwrap_or(0)) {
            messages.push(msg);
        }
    }
    Ok(messages)
}

/// Search across every discovered Crush DB.
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    if query.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }
    let pattern = format!("%{query}%");
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for db_path in discover_dbs(MAX_DBS) {
        if results.len() >= limit {
            break;
        }
        let Some(project_dir) = project_dir_of(&db_path) else {
            continue;
        };
        let project_name = Path::new(&project_dir)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let Ok(conn) = open_db(&db_path) else {
            continue;
        };
        search_one_db(
            &conn,
            &pattern,
            &query_lower,
            &project_name,
            limit,
            &mut results,
        );
    }
    Ok(results)
}

fn search_one_db(
    conn: &Connection,
    pattern: &str,
    query_lower: &str,
    project_name: &str,
    limit: usize,
    results: &mut Vec<ClaudeMessage>,
) {
    let Ok(mut stmt) = conn.prepare(
        "SELECT id, session_id, role, parts, created_at FROM messages WHERE parts LIKE ?1",
    ) else {
        return;
    };
    let Ok(rows) = stmt.query_map([pattern], |row| {
        let id: String = row.get(0)?;
        let session_id: String = row.get(1)?;
        let role: String = row.get(2)?;
        let parts: String = row.get(3)?;
        let created: Option<i64> = row.get(4)?;
        Ok((id, session_id, role, parts, created))
    }) else {
        return;
    };
    for row in rows.flatten() {
        if results.len() >= limit {
            return;
        }
        // Use the real session id (matching load_messages) so a search hit
        // resolves back to its session; project_name is set separately below.
        let (id, session_id, role, parts, created) = row;
        let Some(mut msg) = build_message(&session_id, &id, &role, &parts, created.unwrap_or(0))
        else {
            continue;
        };
        let matched = msg
            .content
            .as_ref()
            .map(|c| search_json_value_case_insensitive(c, query_lower))
            .unwrap_or(false);
        if matched {
            msg.project_name = Some(project_name.to_string());
            results.push(msg);
        }
    }
}

// ============================================================================
// Discovery
// ============================================================================

/// Common code roots to scan (mirrors the Aider provider).
fn search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = dirs::home_dir() {
        for subdir in ["client", "projects", "code", "src", "dev", "work", "repos"] {
            let d = home.join(subdir);
            if d.is_dir() {
                dirs.push(d);
            }
        }
        dirs.push(home);
    }
    dirs
}

/// Find up to `max` `.crush/crush.db` files under the common code roots.
fn discover_dbs(max: usize) -> Vec<PathBuf> {
    let mut results = Vec::new();
    for root in search_dirs() {
        if results.len() >= max {
            break;
        }
        find_crush_db(&root, &mut results, max, 0);
    }
    results.sort();
    results.dedup();
    results
}

fn find_crush_db(dir: &Path, results: &mut Vec<PathBuf>, max: usize, depth: usize) {
    if depth > MAX_DEPTH || results.len() >= max || is_symlink(dir) {
        return;
    }
    let db = dir.join(".crush").join("crush.db");
    if db.is_file() && !is_symlink(&db) {
        results.push(db);
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if results.len() >= max {
            return;
        }
        let path = entry.path();
        if !path.is_dir() || is_symlink(&path) {
            continue;
        }
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        if name.starts_with('.')
            || name == "node_modules"
            || name == "target"
            || name == "dist"
            || name == "build"
        {
            continue;
        }
        find_crush_db(&path, results, max, depth + 1);
    }
}

// ============================================================================
// Helpers
// ============================================================================

fn project_dir_of(db_path: &Path) -> Option<String> {
    // <project>/.crush/crush.db -> <project>
    db_path
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_string_lossy().to_string())
}

fn db_path_for(project_dir: &str) -> Result<PathBuf, String> {
    let db = Path::new(project_dir).join(".crush").join("crush.db");
    if db.is_file() && !is_symlink(&db) {
        Ok(db)
    } else {
        Err(format!("Crush DB not found for project: {project_dir}"))
    }
}

fn parse_session_path(session_path: &str) -> Result<(String, String), String> {
    let rest = session_path.strip_prefix(SCHEME).unwrap_or(session_path);
    rest.rsplit_once(SESSION_SEP)
        .map(|(dir, id)| (dir.to_string(), id.to_string()))
        .ok_or_else(|| format!("Invalid Crush session path: {session_path}"))
}

fn open_db(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open Crush DB: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to set busy timeout: {e}"))?;
    Ok(conn)
}

fn project_stats(conn: &Connection) -> Result<(usize, usize, String), String> {
    let session_count: usize = conn
        .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let message_count: usize = conn
        .query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))
        .unwrap_or(0);
    let last: Option<i64> = conn
        .query_row("SELECT MAX(updated_at) FROM sessions", [], |r| r.get(0))
        .unwrap_or(None);
    Ok((
        session_count,
        message_count,
        epoch_to_iso(last.unwrap_or(0)),
    ))
}

fn is_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

/// Convert an epoch timestamp (seconds or ms) to RFC3339.
fn epoch_to_iso(n: i64) -> String {
    if n <= 0 {
        return String::new();
    }
    let ms = if n > 1_000_000_000_000 { n } else { n * 1000 };
    ms_to_iso(ms as u64)
}

// ============================================================================
// Message conversion
// ============================================================================

fn build_message(
    session_id: &str,
    msg_id: &str,
    role: &str,
    parts_json: &str,
    created: i64,
) -> Option<ClaudeMessage> {
    // Tool results live on "tool" role rows; surface them in the user lane
    // (Claude convention) so the tool_result renderer picks them up.
    let mapped_role = match role {
        "assistant" => "assistant",
        "system" => "system",
        "user" | "tool" => "user",
        _ => return None,
    };
    let blocks = map_parts(parts_json);
    if blocks.is_empty() {
        return None;
    }
    Some(build_provider_message(
        PROVIDER,
        if msg_id.is_empty() {
            format!("{session_id}-{role}")
        } else {
            msg_id.to_string()
        },
        session_id,
        epoch_to_iso(created),
        mapped_role,
        Some(mapped_role),
        Some(Value::Array(blocks)),
        None,
    ))
}

/// Map the Crush `parts` JSON array into Claude-style content blocks.
fn map_parts(parts_json: &str) -> Vec<Value> {
    let Ok(Value::Array(items)) = serde_json::from_str::<Value>(parts_json) else {
        return Vec::new();
    };
    items.iter().filter_map(map_part).collect()
}

fn map_part(part: &Value) -> Option<Value> {
    let kind = part.get("type").and_then(Value::as_str)?;
    let data = part.get("data");
    match kind {
        "text" => {
            let text = data
                .and_then(|d| d.get("text"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if text.is_empty() {
                None
            } else {
                Some(json!({ "type": "text", "text": text }))
            }
        }
        "reasoning" => {
            let thinking = data
                .and_then(|d| d.get("thinking"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if thinking.is_empty() {
                None
            } else {
                Some(json!({
                    "type": "thinking",
                    "thinking": thinking,
                    "signature": data.and_then(|d| d.get("signature")).and_then(Value::as_str).unwrap_or("")
                }))
            }
        }
        "tool_call" => {
            let d = data?;
            let id = d.get("id").and_then(Value::as_str).unwrap_or("");
            let name = d.get("name").and_then(Value::as_str).unwrap_or("unknown");
            // `input` is a raw JSON string; parse it back to an object when possible.
            let input = d
                .get("input")
                .and_then(Value::as_str)
                .and_then(|s| serde_json::from_str::<Value>(s).ok())
                .or_else(|| d.get("input").cloned())
                .unwrap_or_else(|| json!({}));
            Some(json!({ "type": "tool_use", "id": id, "name": name, "input": input }))
        }
        "tool_result" => {
            let d = data?;
            let id = d.get("tool_call_id").and_then(Value::as_str).unwrap_or("");
            let content = d.get("content").and_then(Value::as_str).unwrap_or("");
            let is_error = d.get("is_error").and_then(Value::as_bool).unwrap_or(false);
            Some(json!({
                "type": "tool_result",
                "tool_use_id": id,
                "content": content,
                "is_error": is_error
            }))
        }
        // finish / image_url / binary / shell_command: not rendered for the MVP.
        _ => None,
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn fixture_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, created_at INTEGER, updated_at INTEGER);
             CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, parts TEXT NOT NULL DEFAULT '[]', created_at INTEGER);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sessions VALUES ('sess1','Fix the LOGIN bug',1750000000,1750000100)",
            [],
        )
        .unwrap();
        let user = r#"[{"type":"text","data":{"text":"why does LOGIN fail?"}}]"#;
        let asst = r#"[{"type":"text","data":{"text":"checking"}},{"type":"tool_call","data":{"id":"t1","name":"view","input":"{\"file_path\":\"/x.go\"}","finished":true}}]"#;
        let tool = r#"[{"type":"tool_result","data":{"tool_call_id":"t1","content":"file contents","is_error":false}}]"#;
        conn.execute(
            "INSERT INTO messages VALUES ('m1','sess1','user',?1,1750000000)",
            [user],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages VALUES ('m2','sess1','assistant',?1,1750000001)",
            [asst],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages VALUES ('m3','sess1','tool',?1,1750000002)",
            [tool],
        )
        .unwrap();
        conn
    }

    #[test]
    fn load_sessions_lists_with_title_and_counts() {
        let conn = fixture_db();
        let sessions = load_sessions_conn(&conn, "/Users/jack/proj").unwrap();
        assert_eq!(sessions.len(), 1);
        let s = &sessions[0];
        assert_eq!(s.actual_session_id, "sess1");
        assert_eq!(s.message_count, 3);
        assert_eq!(s.summary.as_deref(), Some("Fix the LOGIN bug"));
        assert_eq!(s.file_path, "crush:///Users/jack/proj#sess1");
        assert_eq!(s.provider.as_deref(), Some("crush"));
    }

    #[test]
    fn load_messages_maps_text_tool_call_and_result() {
        let conn = fixture_db();
        let msgs = load_messages_conn(&conn, "sess1").unwrap();
        assert_eq!(msgs.len(), 3);

        assert_eq!(msgs[0].role.as_deref(), Some("user"));
        assert_eq!(msgs[0].uuid, "m1");

        let asst = msgs[1].content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(asst[0]["type"], "text");
        assert_eq!(asst[1]["type"], "tool_use");
        assert_eq!(asst[1]["name"], "view");
        // input string is parsed back into an object.
        assert_eq!(asst[1]["input"]["file_path"], "/x.go");

        // "tool" role -> mapped to user lane, tool_result block.
        assert_eq!(msgs[2].role.as_deref(), Some("user"));
        let tr = msgs[2].content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(tr[0]["type"], "tool_result");
        assert_eq!(tr[0]["tool_use_id"], "t1");
        assert_eq!(tr[0]["content"], "file contents");
    }

    #[test]
    fn search_matches_and_tags_project() {
        let conn = fixture_db();
        let mut results = Vec::new();
        search_one_db(&conn, "%LOGIN%", "login", "proj", 10, &mut results);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].project_name.as_deref(), Some("proj"));
        // session id is the real session (matches load_messages), not the project name.
        assert_eq!(results[0].session_id, "sess1");
    }

    #[test]
    fn parse_session_path_splits_dir_and_id() {
        let (dir, id) = parse_session_path("crush:///Users/jack/proj#sess1").unwrap();
        assert_eq!(dir, "/Users/jack/proj");
        assert_eq!(id, "sess1");
        assert!(parse_session_path("crush:///no-separator").is_err());
    }

    #[test]
    fn discover_finds_crush_db() {
        let tmp = TempDir::new().unwrap();
        let proj = tmp.path().join("myproj");
        let crush_dir = proj.join(".crush");
        fs::create_dir_all(&crush_dir).unwrap();
        fs::write(crush_dir.join("crush.db"), b"x").unwrap();

        let mut found = Vec::new();
        find_crush_db(tmp.path(), &mut found, 10, 0);
        assert_eq!(found.len(), 1);
        assert!(found[0].ends_with(".crush/crush.db"));
        assert_eq!(project_dir_of(&found[0]).as_deref(), proj.to_str());
    }

    #[test]
    fn map_part_handles_kinds() {
        assert!(map_part(&json!({"type":"finish","data":{"reason":"end_turn"}})).is_none());
        let t = map_part(&json!({"type":"text","data":{"text":"hi"}})).unwrap();
        assert_eq!(t["text"], "hi");
        // tool_call input that isn't valid JSON falls back to the raw value.
        let tc =
            map_part(&json!({"type":"tool_call","data":{"id":"x","name":"n","input":"not json"}}))
                .unwrap();
        assert_eq!(tc["type"], "tool_use");
        assert_eq!(tc["input"], "not json");
    }

    #[test]
    fn epoch_handles_seconds_and_ms() {
        assert!(!epoch_to_iso(1_750_000_000).is_empty());
        assert!(!epoch_to_iso(1_750_000_000_000).is_empty());
        assert_eq!(epoch_to_iso(0), "");
    }
}
