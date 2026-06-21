//! `llm` provider (Simon Willison's `llm` CLI, `github.com/simonw/llm`).
//!
//! Reads the `SQLite` log at `<app-dir>/logs.db` where `<app-dir>` =
//! `click.get_app_dir("io.datasette.llm")` (which matches `dirs::config_dir()`
//! on every OS) — overridable via `LLM_USER_PATH`. Logging is on by default.
//!
//! `llm` has no project/`cwd` concept, so everything is surfaced under one
//! synthetic project. Each `conversations` row is a session; responses with no
//! conversation (`conversation_id IS NULL`, the common one-shot case) are
//! bucketed into a single "Ungrouped" session. Each `responses` row becomes a
//! user turn (the prompt) followed by an assistant turn (the response, carrying
//! token usage + model).

use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession, TokenUsage};
use crate::providers::ProviderInfo;
use crate::utils::{build_provider_message, search_json_value_case_insensitive};
use rusqlite::{Connection, OpenFlags};
use serde_json::json;
use std::path::PathBuf;

const PROVIDER: &str = "llm";
const SCHEME: &str = "llm://";
/// Single synthetic project bucket.
const PROJECT_KEY: &str = "__all__";
/// Sentinel session id for responses with no conversation.
const NO_CONVERSATION: &str = "__none__";

fn get_db_path() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("LLM_USER_PATH") {
        let p = p.trim();
        if !p.is_empty() {
            return Some(PathBuf::from(p).join("logs.db"));
        }
    }
    Some(dirs::config_dir()?.join("io.datasette.llm").join("logs.db"))
}

/// Detect an `llm` installation (only when the logs DB exists).
pub fn detect() -> Option<ProviderInfo> {
    let db = get_db_path()?;
    if !db.is_file() {
        return None;
    }
    Some(ProviderInfo {
        id: PROVIDER.to_string(),
        display_name: "llm".to_string(),
        base_path: db
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        is_available: true,
    })
}

/// Base path (the dir holding `logs.db`), for the file watcher.
pub fn get_base_path() -> Option<String> {
    Some(get_db_path()?.parent()?.to_string_lossy().to_string())
}

fn open_db() -> Result<Connection, String> {
    let path = get_db_path().ok_or("llm logs DB not found")?;
    let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open llm DB: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to set busy timeout: {e}"))?;
    Ok(conn)
}

/// `datetime_utc` is a UTC value stored without a timezone designator (e.g.
/// `2026-06-20T10:00:00`). Mark it explicitly UTC so downstream date parsing
/// doesn't treat it as local time. Values that already carry a tz, or have no
/// time component, are returned unchanged.
fn normalize_utc_ts(ts: &str) -> String {
    let t = ts.trim().replace(' ', "T");
    if t.is_empty() || t.ends_with('Z') {
        return t;
    }
    match t.split_once('T') {
        // A time component with an explicit offset (+hh:mm / -hh:mm) is left as-is.
        Some((_, time)) if time.contains('+') || time.contains('-') => t,
        Some((_, _)) => format!("{t}Z"),
        None => t, // date-only / unparseable: don't fabricate a time zone
    }
}

/// One synthetic project containing every `llm` conversation.
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    scan_in_conn(&open_db()?)
}

fn scan_in_conn(conn: &Connection) -> Result<Vec<ClaudeProject>, String> {
    let (session_count, message_count, last) = project_stats(conn)?;
    if message_count == 0 {
        return Ok(Vec::new());
    }
    Ok(vec![ClaudeProject {
        name: "llm".to_string(),
        path: format!("{SCHEME}{PROJECT_KEY}"),
        actual_path: "llm".to_string(),
        session_count,
        message_count,
        last_modified: last,
        git_info: None,
        provider: Some(PROVIDER.to_string()),
        storage_type: Some("sqlite".to_string()),
        custom_directory_label: None,
    }])
}

/// Session-count / message-count / latest-time for the synthetic project.
fn project_stats(conn: &Connection) -> Result<(usize, usize, String), String> {
    // Sessions = distinct conversations + 1 for the orphan bucket (if any exist).
    let convs: usize = conn
        .query_row(
            "SELECT COUNT(DISTINCT conversation_id) FROM responses WHERE conversation_id IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let orphans: usize = conn
        .query_row(
            "SELECT COUNT(*) FROM responses WHERE conversation_id IS NULL",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    // Each response yields a user + assistant message.
    let responses: usize = conn
        .query_row("SELECT COUNT(*) FROM responses", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let last: Option<String> = conn
        .query_row("SELECT MAX(datetime_utc) FROM responses", [], |r| r.get(0))
        .unwrap_or(None);
    let session_count = convs + usize::from(orphans > 0);
    Ok((
        session_count,
        responses * 2,
        normalize_utc_ts(&last.unwrap_or_default()),
    ))
}

/// Load the sessions (conversations) for the synthetic `llm` project.
pub fn load_sessions(
    _project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    load_sessions_conn(&open_db()?)
}

fn load_sessions_conn(conn: &Connection) -> Result<Vec<ClaudeSession>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT r.conversation_id, c.name, MIN(r.datetime_utc) AS first, \
                    MAX(r.datetime_utc) AS last, COUNT(*) AS cnt \
             FROM responses r LEFT JOIN conversations c ON c.id = r.conversation_id \
             GROUP BY r.conversation_id ORDER BY last DESC",
        )
        .map_err(|e| e.to_string())?;

    let sessions = stmt
        .query_map([], |row| {
            let conv_id: Option<String> = row.get(0)?;
            let name: Option<String> = row.get(1)?;
            let first: Option<String> = row.get(2)?;
            let last: Option<String> = row.get(3)?;
            let cnt: usize = row.get(4)?;
            Ok((conv_id, name, first, last, cnt))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|(conv_id, name, first, last, cnt)| {
            let id = conv_id
                .clone()
                .unwrap_or_else(|| NO_CONVERSATION.to_string());
            let summary = if conv_id.is_none() {
                Some("Ungrouped prompts".to_string())
            } else {
                name.filter(|n| !n.trim().is_empty())
                    .or_else(|| Some(id.clone()))
            };
            let first = normalize_utc_ts(&first.unwrap_or_default());
            let last = normalize_utc_ts(&last.unwrap_or_default());
            ClaudeSession {
                session_id: format!("{SCHEME}{id}"),
                actual_session_id: id.clone(),
                file_path: format!("{SCHEME}{id}"),
                project_name: "llm".to_string(),
                message_count: cnt * 2,
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
            }
        })
        .collect();

    Ok(sessions)
}

/// Load messages for one `llm` conversation (`llm://<conversation_id>`).
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let conv_id = session_path.strip_prefix(SCHEME).unwrap_or(session_path);
    load_messages_conn(&open_db()?, conv_id)
}

fn load_messages_conn(conn: &Connection, conv_id: &str) -> Result<Vec<ClaudeMessage>, String> {
    // The orphan bucket selects rows with a NULL conversation_id; named
    // conversations select by id.
    let sql = if conv_id == NO_CONVERSATION {
        "SELECT id, prompt, response, model, datetime_utc, input_tokens, output_tokens \
         FROM responses WHERE conversation_id IS NULL ORDER BY datetime_utc, id"
    } else {
        "SELECT id, prompt, response, model, datetime_utc, input_tokens, output_tokens \
         FROM responses WHERE conversation_id = ?1 ORDER BY datetime_utc, id"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;

    let map_row = |row: &rusqlite::Row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<i64>>(5)?,
            row.get::<_, Option<i64>>(6)?,
        ))
    };
    let rows = if conv_id == NO_CONVERSATION {
        stmt.query_map([], map_row)
    } else {
        stmt.query_map([conv_id], map_row)
    }
    .map_err(|e| e.to_string())?;

    let mut messages = Vec::new();
    for row in rows.flatten() {
        let (id, prompt, response, model, dt, input_tokens, output_tokens) = row;
        let ts = normalize_utc_ts(&dt.unwrap_or_default());
        if let Some(p) = prompt.filter(|p| !p.is_empty()) {
            messages.push(build_provider_message(
                PROVIDER,
                format!("{id}-user"),
                conv_id,
                ts.clone(),
                "user",
                Some("user"),
                Some(json!([{ "type": "text", "text": p }])),
                None,
            ));
        }
        if let Some(r) = response.filter(|r| !r.is_empty()) {
            let mut msg = build_provider_message(
                PROVIDER,
                format!("{id}-asst"),
                conv_id,
                ts,
                "assistant",
                Some("assistant"),
                Some(json!([{ "type": "text", "text": r }])),
                model,
            );
            if input_tokens.is_some() || output_tokens.is_some() {
                msg.usage = Some(TokenUsage {
                    input_tokens: input_tokens.map(|t| t.max(0) as u32),
                    output_tokens: output_tokens.map(|t| t.max(0) as u32),
                    cache_creation_input_tokens: None,
                    cache_read_input_tokens: None,
                    service_tier: None,
                });
            }
            messages.push(msg);
        }
    }
    Ok(messages)
}

/// Search across all `llm` responses (prompts + responses).
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
            "SELECT id, conversation_id, prompt, response, model, datetime_utc \
             FROM responses WHERE prompt LIKE ?1 OR response LIKE ?1 \
             ORDER BY datetime_utc DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([&pattern], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows.flatten() {
        if results.len() >= limit {
            break;
        }
        let (id, conv_id, prompt, response, model, dt) = row;
        let conv = conv_id.unwrap_or_else(|| NO_CONVERSATION.to_string());
        let ts = normalize_utc_ts(&dt.unwrap_or_default());
        // Emit whichever side matches the query.
        for (suffix, role, text, model) in [
            ("user", "user", prompt, None),
            ("asst", "assistant", response, model),
        ] {
            let Some(text) = text.filter(|t| !t.is_empty()) else {
                continue;
            };
            let content = json!([{ "type": "text", "text": text }]);
            if !search_json_value_case_insensitive(&content, &query_lower) {
                continue;
            }
            let mut msg = build_provider_message(
                PROVIDER,
                format!("{id}-{suffix}"),
                &conv,
                ts.clone(),
                role,
                Some(role),
                Some(content),
                model,
            );
            msg.project_name = Some("llm".to_string());
            results.push(msg);
            if results.len() >= limit {
                break;
            }
        }
    }
    Ok(results)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE conversations (id TEXT PRIMARY KEY, name TEXT, model TEXT);
             CREATE TABLE responses (id TEXT PRIMARY KEY, model TEXT, prompt TEXT, response TEXT, \
                 conversation_id TEXT, datetime_utc TEXT, input_tokens INTEGER, output_tokens INTEGER);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO conversations VALUES ('c1','Debug LOGIN','gpt-4')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO responses VALUES ('r1','gpt-4','why does LOGIN fail?','Checking auth','c1','2026-06-20T10:00:00',12,34)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO responses VALUES ('r2','gpt-4','more detail?','Here it is','c1','2026-06-20T10:01:00',5,8)",
            [],
        )
        .unwrap();
        // Orphan (no conversation).
        conn.execute(
            "INSERT INTO responses VALUES ('r3','gpt-4','one-shot question','one-shot answer',NULL,'2026-06-19T09:00:00',NULL,NULL)",
            [],
        )
        .unwrap();
        conn
    }

    #[test]
    fn scan_single_project_counts_messages() {
        let conn = fixture_db();
        let projects = scan_in_conn(&conn).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "llm");
        assert_eq!(projects[0].path, "llm://__all__");
        // 1 named conversation + 1 orphan bucket.
        assert_eq!(projects[0].session_count, 2);
        // 3 responses * 2 messages each.
        assert_eq!(projects[0].message_count, 6);
        assert_eq!(projects[0].provider.as_deref(), Some("llm"));
    }

    #[test]
    fn load_sessions_groups_conversations_and_orphans() {
        let conn = fixture_db();
        let sessions = load_sessions_conn(&conn).unwrap();
        assert_eq!(sessions.len(), 2);
        let c1 = sessions
            .iter()
            .find(|s| s.actual_session_id == "c1")
            .unwrap();
        assert_eq!(c1.summary.as_deref(), Some("Debug LOGIN"));
        assert_eq!(c1.message_count, 4); // 2 responses * 2
        let orphan = sessions
            .iter()
            .find(|s| s.actual_session_id == NO_CONVERSATION)
            .unwrap();
        assert_eq!(orphan.summary.as_deref(), Some("Ungrouped prompts"));
        assert_eq!(orphan.message_count, 2);
    }

    #[test]
    fn load_messages_makes_user_assistant_pairs_with_usage() {
        let conn = fixture_db();
        let msgs = load_messages_conn(&conn, "c1").unwrap();
        assert_eq!(msgs.len(), 4);
        assert_eq!(msgs[0].role.as_deref(), Some("user"));
        assert_eq!(msgs[0].uuid, "r1-user");
        assert_eq!(msgs[1].role.as_deref(), Some("assistant"));
        assert_eq!(msgs[1].uuid, "r1-asst");
        assert_eq!(msgs[1].model.as_deref(), Some("gpt-4"));
        let usage = msgs[1].usage.as_ref().unwrap();
        assert_eq!(usage.input_tokens, Some(12));
        assert_eq!(usage.output_tokens, Some(34));
    }

    #[test]
    fn load_messages_orphan_bucket_selects_null_conversation() {
        let conn = fixture_db();
        let msgs = load_messages_conn(&conn, NO_CONVERSATION).unwrap();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].uuid, "r3-user");
        // Orphan response had NULL tokens -> no usage attached.
        assert!(msgs[1].usage.is_none());
    }

    #[test]
    fn search_matches_prompt_or_response_and_tags_project() {
        let conn = fixture_db();
        let results = search_conn(&conn, "LOGIN", 10).unwrap();
        assert_eq!(results.len(), 1); // only the prompt of r1 matches
        assert_eq!(results[0].project_name.as_deref(), Some("llm"));
        assert_eq!(results[0].role.as_deref(), Some("user"));

        let resp = search_conn(&conn, "one-shot answer", 10).unwrap();
        assert_eq!(resp.len(), 1);
        assert_eq!(resp[0].role.as_deref(), Some("assistant"));
    }

    #[test]
    fn timestamps_are_normalized_to_utc() {
        assert_eq!(
            normalize_utc_ts("2026-06-20T10:00:00"),
            "2026-06-20T10:00:00Z"
        );
        assert_eq!(
            normalize_utc_ts("2026-06-20 10:00:00"),
            "2026-06-20T10:00:00Z"
        );
        // Already-zoned values pass through unchanged.
        assert_eq!(
            normalize_utc_ts("2026-06-20T10:00:00Z"),
            "2026-06-20T10:00:00Z"
        );
        assert_eq!(
            normalize_utc_ts("2026-06-20T10:00:00+09:00"),
            "2026-06-20T10:00:00+09:00"
        );
        assert_eq!(normalize_utc_ts(""), "");

        // The fixture's bare datetimes surface with a Z on real messages.
        let conn = fixture_db();
        let msgs = load_messages_conn(&conn, "c1").unwrap();
        assert!(msgs[0].timestamp.ends_with('Z'));
    }
}
