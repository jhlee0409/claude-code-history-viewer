//! Amazon Q Developer CLI provider (`q chat`).
//!
//! Reads `dirs::data_local_dir()/amazon-q/data.sqlite3`, table
//! `conversations (key TEXT PRIMARY KEY, value TEXT)` where `key` is the working
//! directory and `value` is a serialized `ConversationState` — i.e. exactly ONE
//! conversation per cwd (the `q chat --resume` state). This is the v1 schema;
//! the rebranded Kiro CLI uses a richer `conversations_v2` table handled by the
//! [`super::kiro`] provider. Both share the same `value` shape, so message
//! conversion is delegated to [`super::q_conversation`].

use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::providers::{q_conversation, ProviderInfo};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use std::path::{Path, PathBuf};

const PROVIDER: &str = "amazonq";
const SCHEME: &str = "amazonq://";
const SUMMARY_MAX_CHARS: usize = 100;

fn get_db_path() -> Option<PathBuf> {
    Some(
        dirs::data_local_dir()?
            .join("amazon-q")
            .join("data.sqlite3"),
    )
}

/// Detect an Amazon Q CLI installation.
pub fn detect() -> Option<ProviderInfo> {
    let db = get_db_path()?;
    Some(ProviderInfo {
        id: PROVIDER.to_string(),
        display_name: "Amazon Q CLI".to_string(),
        base_path: db
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        is_available: db.is_file(),
    })
}

/// Base path (the `amazon-q` dir holding `data.sqlite3`), for the file watcher.
pub fn get_base_path() -> Option<String> {
    get_db_path()?
        .parent()
        .map(|p| p.to_string_lossy().to_string())
}

fn open_db() -> Result<Connection, String> {
    let path = get_db_path().ok_or("Amazon Q CLI not found")?;
    if !path.is_file() {
        return Err("Amazon Q CLI database not found".to_string());
    }
    let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open Amazon Q DB: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to set busy timeout: {e}"))?;
    Ok(conn)
}

/// `data.sqlite3` mtime as an RFC3339 string, for conversations that carry no
/// in-history timestamps.
fn db_mtime_iso() -> String {
    get_db_path()
        .and_then(|p| std::fs::metadata(p).ok())
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
        .map(|d| ms_to_iso_secs(d.as_secs()))
        .unwrap_or_default()
}

#[allow(clippy::cast_possible_wrap)]
fn ms_to_iso_secs(secs: u64) -> String {
    use chrono::{DateTime, Utc};
    DateTime::from_timestamp(secs as i64, 0)
        .unwrap_or_else(Utc::now)
        .to_rfc3339()
}

/// Scan Amazon Q projects — one per `conversations.key` (cwd).
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let conn = open_db()?;
    let fallback = db_mtime_iso();
    let mut stmt = conn
        .prepare("SELECT key, value FROM conversations")
        .map_err(|e| e.to_string())?;

    let projects = stmt
        .query_map([], |row| {
            let key: String = row.get(0)?;
            let value: String = row.get(1)?;
            Ok((key, value))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|(key, value)| {
            let msg_count = q_conversation::message_count(&value);
            if msg_count == 0 {
                return None;
            }
            let (_, last) = q_conversation::history_time_bounds(&value);
            let name = Path::new(&key)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| key.clone());
            Some(ClaudeProject {
                name,
                path: format!("{SCHEME}{key}"),
                actual_path: key,
                session_count: 1,
                message_count: msg_count,
                last_modified: last.unwrap_or_else(|| fallback.clone()),
                git_info: None,
                provider: Some(PROVIDER.to_string()),
                storage_type: Some("sqlite".to_string()),
                custom_directory_label: None,
            })
        })
        .collect();

    Ok(projects)
}

/// Load the (single) session for one Amazon Q project (`amazonq://<cwd>`).
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let key = project_path.strip_prefix(SCHEME).unwrap_or(project_path);
    let conn = open_db()?;

    // .optional(): "no row" -> Ok(None) (stale project path -> empty), but a real
    // DB error propagates instead of being silently swallowed as an empty list.
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM conversations WHERE key = ?1",
            [key],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to load Amazon Q conversation: {e}"))?;
    let Some(value) = value else {
        return Ok(vec![]);
    };
    let msg_count = q_conversation::message_count(&value);
    if msg_count == 0 {
        return Ok(vec![]);
    }

    let project_name = Path::new(key)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let (first, last) = q_conversation::history_time_bounds(&value);
    let fallback = db_mtime_iso();
    let first = first.unwrap_or_else(|| fallback.clone());
    let last = last.unwrap_or(fallback);
    let summary = q_conversation::first_prompt_summary(&value, SUMMARY_MAX_CHARS);

    Ok(vec![ClaudeSession {
        // One conversation per cwd → the session is addressed by the cwd key.
        session_id: format!("{SCHEME}{key}"),
        actual_session_id: key.to_string(),
        file_path: format!("{SCHEME}{key}"),
        project_name,
        message_count: msg_count,
        first_message_time: first,
        last_message_time: last.clone(),
        last_modified: last,
        has_tool_use: false,
        has_errors: false,
        summary,
        is_renamed: false,
        provider: Some(PROVIDER.to_string()),
        storage_type: Some("sqlite".to_string()),
        entrypoint: None,
    }])
}

/// Load messages for one Amazon Q conversation (`amazonq://<cwd>`).
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let key = session_path.strip_prefix(SCHEME).unwrap_or(session_path);
    let conn = open_db()?;
    let value: String = conn
        .query_row(
            "SELECT value FROM conversations WHERE key = ?1",
            [key],
            |r| r.get(0),
        )
        .map_err(|e| format!("Conversation not found: {e}"))?;
    Ok(q_conversation::parse_history(PROVIDER, &value, key))
}

/// Search across all Amazon Q conversations.
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    if query.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }
    let conn = open_db()?;
    let pattern = format!("%{query}%");
    let query_lower = query.to_lowercase();

    let mut stmt = conn
        .prepare("SELECT key, value FROM conversations WHERE value LIKE ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&pattern], |row| {
            let key: String = row.get(0)?;
            let value: String = row.get(1)?;
            Ok((key, value))
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for (key, value) in rows.flatten() {
        let project_name = Path::new(&key)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        for mut msg in q_conversation::parse_history(PROVIDER, &value, &key) {
            let matched = msg
                .content
                .as_ref()
                .map(|c| crate::utils::search_json_value_case_insensitive(c, &query_lower))
                .unwrap_or(false);
            if !matched {
                continue;
            }
            msg.project_name = Some(project_name.clone());
            results.push(msg);
            if results.len() >= limit {
                return Ok(results);
            }
        }
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE conversations (key TEXT PRIMARY KEY, value TEXT)",
            [],
        )
        .unwrap();
        let value = serde_json::json!({
            "history": [
                {
                    "user": {"content": {"Prompt": {"prompt": "why does LOGIN fail?"}}, "timestamp": "2026-06-20T10:00:00Z"},
                    "assistant": {"Response": {"message_id": "a1", "content": "Checking auth"}}
                },
                {
                    "user": {"content": {"ToolUseResults": {"tool_use_results": [{"tool_use_id": "t1", "content": [{"Text": "ok"}]}]}}, "timestamp": "2026-06-20T10:01:00Z"},
                    "assistant": {"ToolUse": {"message_id": "a2", "content": "running", "tool_uses": [{"id": "t1", "name": "execute_bash", "args": {"command": "ls"}}]}}
                }
            ]
        })
        .to_string();
        conn.execute(
            "INSERT INTO conversations VALUES ('/Users/jack/proj', ?1)",
            [value],
        )
        .unwrap();
        // An empty conversation (no history) must be skipped by scan/load.
        conn.execute(
            "INSERT INTO conversations VALUES ('/Users/jack/empty', '{\"history\":[]}')",
            [],
        )
        .unwrap();
        conn
    }

    // The DB-backed public fns resolve the real ~/.../amazon-q path, so the
    // tests drive the SQL inline against an in-memory DB to stay isolated.
    fn scan_rows(conn: &Connection) -> Vec<(String, String)> {
        let mut stmt = conn
            .prepare("SELECT key, value FROM conversations")
            .unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .flatten()
            .collect()
    }

    #[test]
    fn parse_history_maps_amazon_q_conversation() {
        let conn = fixture_db();
        let (_, value) = scan_rows(&conn)
            .into_iter()
            .find(|(k, _)| k == "/Users/jack/proj")
            .unwrap();
        let msgs = q_conversation::parse_history(PROVIDER, &value, "/Users/jack/proj");
        // 2 user + 2 assistant.
        assert_eq!(msgs.len(), 4);
        assert_eq!(msgs[0].role.as_deref(), Some("user"));
        assert_eq!(msgs[0].provider.as_deref(), Some("amazonq"));
        // tool_use mapped through map_tool_name.
        let tu = msgs[3].content.as_ref().unwrap().as_array().unwrap();
        assert!(tu
            .iter()
            .any(|b| b["type"] == "tool_use" && b["name"] == "Bash"));
    }

    #[test]
    fn project_metadata_skips_empty_and_counts() {
        let conn = fixture_db();
        let rows = scan_rows(&conn);
        let non_empty: Vec<_> = rows
            .iter()
            .filter(|(_, v)| q_conversation::message_count(v) > 0)
            .collect();
        assert_eq!(non_empty.len(), 1, "empty conversation is skipped");
        let (key, value) = non_empty[0];
        assert_eq!(key, "/Users/jack/proj");
        assert_eq!(q_conversation::message_count(value), 4);
        let (first, last) = q_conversation::history_time_bounds(value);
        assert_eq!(first.as_deref(), Some("2026-06-20T10:00:00Z"));
        assert_eq!(last.as_deref(), Some("2026-06-20T10:01:00Z"));
        assert_eq!(
            q_conversation::first_prompt_summary(value, SUMMARY_MAX_CHARS).as_deref(),
            Some("why does LOGIN fail?")
        );
    }

    #[test]
    fn db_path_uses_amazon_q_under_data_local_dir() {
        // Sanity: path ends with the expected segments (don't assert the root,
        // which is host-specific).
        if let Some(p) = get_db_path() {
            let s = p.to_string_lossy();
            assert!(s.ends_with("amazon-q/data.sqlite3") || s.ends_with("amazon-q\\data.sqlite3"));
        }
    }
}
