//! Z Code provider (Z.ai's GLM-powered coding agent, <https://zcode.z.ai>).
//!
//! Z Code keeps the authoritative transcript history in a single SQLite store
//! at `<home>/.zcode/cli/db/db.sqlite` (WAL). Relevant tables:
//! - `session(id, directory, title, title_source, task_type, parent_id,
//!   time_created, time_updated, time_archived)` — `directory` is the session
//!   cwd, `title` a generated/first-input title, epoch-ms timestamps.
//! - `message(id, session_id, sequence, time_created, data)` — `data` JSON:
//!   `{role, time:{created,completed}, parentID, modelID, tokens:{...},
//!   finish}`.
//! - `part(id, message_id, session_id, sequence, data)` — content blocks in
//!   order: `{type:"text"|"reasoning"|"tool"|"file"|"timeline"|"step-start"|
//!   "step-finish", ...}`. A `tool` part merges the call and its result:
//!   `{callID, tool, state:{status, input, output}}`.
//!
//! We map parts to the viewer's Claude-style content blocks; merged tool
//! call/results are split into a `tool_use` block on the assistant message
//! plus a synthesized user-lane `tool_result` message, mirroring how Claude
//! Code transcripts record them. Subagent sessions (`task_type =
//! 'subagent_child'`) are skipped, matching the sidechain exclusion elsewhere.

use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession, TokenUsage};
use crate::providers::ProviderInfo;
use crate::utils::{build_provider_message, ms_to_iso, search_json_value_case_insensitive};
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;

const PROVIDER: &str = "zcode";
const SCHEME: &str = "zcode://";
/// Separator between the project directory and session id in a session path.
const SESSION_SEP: char = '#';
const SUMMARY_MAX_CHARS: usize = 80;

/// Base dir: `$ZCODE_HOME` (relative values resolve against the cwd) or
/// `~/.zcode` — the same override convention as `CODEX_HOME`/`GEMINI_HOME`.
fn runtime_base() -> Option<PathBuf> {
    if let Ok(env_val) = std::env::var("ZCODE_HOME") {
        let path = PathBuf::from(&env_val);
        return Some(if path.is_absolute() {
            path
        } else {
            std::env::current_dir().ok()?.join(path)
        });
    }
    Some(crate::utils::home_dir()?.join(".zcode"))
}

fn db_path() -> Option<PathBuf> {
    let path = runtime_base()?.join("cli").join("db").join("db.sqlite");
    path.is_file().then_some(path)
}

/// Open the store read-only (WAL readers are fine alongside a live writer).
fn open_db(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open Z Code db: {e}"))?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| format!("Failed to set Z Code db busy timeout: {e}"))?;
    Ok(conn)
}

/// Detect a Z Code installation.
pub fn detect() -> Option<ProviderInfo> {
    let base = runtime_base()?;
    let db = db_path()?;
    Some(ProviderInfo {
        id: PROVIDER.to_string(),
        display_name: "Z Code".to_string(),
        base_path: base.to_string_lossy().to_string(),
        is_available: db.is_file(),
    })
}

/// Watched root (the db directory, so WAL checkpoints trigger refreshes).
pub fn get_base_path() -> Option<String> {
    db_path()?.parent().map(|p| p.to_string_lossy().to_string())
}

/// Scan Z Code projects (sessions grouped by their `directory` cwd).
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let Some(path) = db_path() else {
        return Ok(vec![]);
    };
    let conn = open_db(&path)?;
    scan_projects_conn(&conn)
}

/// Projects (one row per session `directory`) with session/message counts.
fn scan_projects_conn(conn: &Connection) -> Result<Vec<ClaudeProject>, String> {
    // One row per directory already: GROUP BY aggregates the counts and
    // `WHERE s.m_cnt > 0` keeps only sessions that would appear when loaded.
    let mut stmt = conn
        .prepare(
            "SELECT s.directory, COUNT(*), SUM(m_cnt), MAX(s.time_updated) FROM ( \
                SELECT s.directory AS directory, s.time_updated AS time_updated, \
                       (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) AS m_cnt \
                FROM session s \
                WHERE (s.task_type IS NULL OR s.task_type != 'subagent_child') \
                  AND (s.time_archived IS NULL OR s.time_archived = 0) \
             ) s WHERE s.m_cnt > 0 GROUP BY s.directory",
        )
        .map_err(|e| e.to_string())?;
    let mut projects: Vec<ClaudeProject> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, Option<i64>>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|(dir, sessions, messages, updated)| {
            let name = Path::new(&dir)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| dir.clone());
            ClaudeProject {
                name,
                path: format!("{SCHEME}{dir}"),
                actual_path: dir,
                session_count: sessions.max(0) as usize,
                message_count: messages.unwrap_or(0).max(0) as usize,
                last_modified: ms_to_iso(updated.unwrap_or(0).max(0) as u64),
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

/// Load the sessions for one Z Code project (`zcode://<directory>`).
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let Some(path) = db_path() else {
        return Ok(vec![]);
    };
    let directory = project_path.strip_prefix(SCHEME).unwrap_or(project_path);
    let conn = open_db(&path)?;
    load_sessions_conn(&conn, directory)
}

/// Sessions of one Z Code project (`directory`), newest first.
fn load_sessions_conn(conn: &Connection, directory: &str) -> Result<Vec<ClaudeSession>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.title, s.title_source, s.time_created, s.time_updated, \
                    (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) AS msg_cnt, \
                    EXISTS(SELECT 1 FROM part p WHERE p.session_id = s.id \
                           AND json_extract(p.data, '$.type') = 'tool') AS has_tool \
             FROM session s \
             WHERE s.directory = ?1 \
               AND (s.task_type IS NULL OR s.task_type != 'subagent_child') \
               AND (s.time_archived IS NULL OR s.time_archived = 0)",
        )
        .map_err(|e| e.to_string())?;
    let project_name = Path::new(directory)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let sessions = stmt
        .query_map([directory], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|(_, _, _, _, _, msg_cnt, _)| *msg_cnt > 0)
        .map(
            |(id, title, title_source, created, updated, msg_cnt, has_tool)| {
                let created_iso = ms_to_iso(created.max(0) as u64);
                let updated_iso = ms_to_iso(updated.max(0) as u64);
                let summary = title
                    .as_deref()
                    .map(str::trim)
                    .filter(|t| !t.is_empty())
                    .map(summarize);
                ClaudeSession {
                    session_id: format!("{SCHEME}{directory}{SESSION_SEP}{id}"),
                    actual_session_id: id.clone(),
                    file_path: format!("{SCHEME}{directory}{SESSION_SEP}{id}"),
                    project_name: project_name.clone(),
                    message_count: msg_cnt.max(0) as usize,
                    first_message_time: created_iso.clone(),
                    last_message_time: updated_iso.clone(),
                    last_modified: updated_iso,
                    has_tool_use: has_tool != 0,
                    has_errors: false,
                    summary,
                    is_renamed: title_source.as_deref() == Some("custom"),
                    provider: Some(PROVIDER.to_string()),
                    storage_type: Some("sqlite".to_string()),
                    entrypoint: None,
                }
            },
        )
        .collect();
    Ok(sessions)
}

/// Load all messages from one Z Code session (`zcode://<directory>#<session_id>`).
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let Some(path) = db_path() else {
        return Err("Z Code db not found".to_string());
    };
    let (_, session_id) = parse_session_path(session_path)?;
    let conn = open_db(&path)?;
    load_messages_conn(&conn, &session_id)
}

/// Split `zcode://<directory>#<session_id>` into its two parts.
fn parse_session_path(session_path: &str) -> Result<(String, String), String> {
    let stripped = session_path.strip_prefix(SCHEME).unwrap_or(session_path);
    stripped
        .rsplit_once(SESSION_SEP)
        .map(|(dir, id)| (dir.to_string(), id.to_string()))
        .ok_or_else(|| format!("Invalid Z Code session path: {session_path}"))
}

/// Every viewer-visible message of one session, in `sequence` order.
fn load_messages_conn(conn: &Connection, session_id: &str) -> Result<Vec<ClaudeMessage>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, time_created, data FROM message \
             WHERE session_id = ?1 ORDER BY sequence, time_created, id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([session_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect::<Vec<_>>();

    let mut parts_stmt = conn
        .prepare(
            "SELECT data FROM part WHERE message_id = ?1 \
             ORDER BY sequence, time_created, id",
        )
        .map_err(|e| e.to_string())?;

    let mut messages = Vec::new();
    for (id, created, data) in rows {
        let Ok(rec) = serde_json::from_str::<Value>(&data) else {
            continue;
        };
        let parts = parts_stmt
            .query_map([&id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .flatten()
            .filter_map(|p| serde_json::from_str::<Value>(&p).ok())
            .collect::<Vec<_>>();
        append_message(&mut messages, session_id, &id, created, &rec, &parts);
    }
    Ok(messages)
}

/// Convert one DB message (plus its parts) into viewer messages, appending a
/// synthesized user-lane `tool_result` message when tool parts are present.
fn append_message(
    out: &mut Vec<ClaudeMessage>,
    session_id: &str,
    msg_id: &str,
    created_ms: i64,
    rec: &Value,
    parts: &[Value],
) {
    let role = rec.get("role").and_then(Value::as_str).unwrap_or("user");
    if !matches!(role, "user" | "assistant") {
        return;
    }
    let timestamp = rec
        .pointer("/time/created")
        .and_then(Value::as_i64)
        .map(|ms| ms_to_iso(ms.max(0) as u64))
        .unwrap_or_else(|| ms_to_iso(created_ms.max(0) as u64));

    let mut blocks: Vec<Value> = Vec::new();
    let mut tool_results: Vec<Value> = Vec::new();
    for part in parts {
        match part.get("type").and_then(Value::as_str).unwrap_or("") {
            "text" => {
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    if !text.is_empty() {
                        blocks.push(json!({ "type": "text", "text": text }));
                    }
                }
            }
            "reasoning" => {
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    if !text.is_empty() {
                        blocks
                            .push(json!({ "type": "thinking", "thinking": text, "signature": "" }));
                    }
                }
            }
            "tool" => {
                let call_id = part.get("callID").and_then(Value::as_str).unwrap_or("");
                let name = part
                    .get("tool")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                let state = part.get("state").cloned().unwrap_or_else(|| json!({}));
                let input = state.get("input").cloned().unwrap_or_else(|| json!({}));
                blocks.push(json!({
                    "type": "tool_use", "id": call_id, "name": name, "input": input
                }));
                let status = state.get("status").and_then(Value::as_str).unwrap_or("");
                let output = state.get("output").map(stringify_value).unwrap_or_default();
                tool_results.push(json!({
                    "type": "tool_result",
                    "tool_use_id": call_id,
                    "content": output,
                    "is_error": status == "failed" || status == "error",
                }));
            }
            // step-start / step-finish are agent-loop step markers, timeline is
            // a UI event, file is an attachment behind a zcode-artifact:// URL
            // the viewer cannot resolve — all skipped.
            _ => {}
        }
    }
    if blocks.is_empty() && tool_results.is_empty() {
        return;
    }

    let model = rec
        .get("modelID")
        .and_then(Value::as_str)
        .map(str::to_string);
    let mut msg = build_provider_message(
        PROVIDER,
        msg_id.to_string(),
        session_id,
        timestamp,
        role,
        Some(role),
        Some(Value::Array(blocks)),
        model,
    );
    msg.parent_uuid = rec
        .get("parentID")
        .and_then(Value::as_str)
        .map(str::to_string);
    if role == "assistant" {
        if let Some(tokens) = rec.get("tokens") {
            msg.usage = Some(convert_usage(tokens));
        }
        if let Some(finish) = rec.get("finish").and_then(Value::as_str) {
            msg.stop_reason = Some(match finish {
                "tool-calls" => "tool_use".to_string(),
                "stop" => "end_turn".to_string(),
                other => other.to_string(),
            });
        }
        if let Some(completed) = rec.pointer("/time/completed").and_then(Value::as_i64) {
            let started = rec
                .pointer("/time/created")
                .and_then(Value::as_i64)
                .unwrap_or(completed);
            msg.duration_ms = Some((completed - started).max(0) as u64);
        }
    }
    out.push(msg);

    if !tool_results.is_empty() {
        let done_at = rec
            .pointer("/time/completed")
            .and_then(Value::as_i64)
            .unwrap_or(created_ms);
        let mut result_msg = build_provider_message(
            PROVIDER,
            format!("{msg_id}-results"),
            session_id,
            ms_to_iso(done_at.max(0) as u64),
            "user",
            Some("user"),
            Some(Value::Array(tool_results)),
            None,
        );
        result_msg.parent_uuid = Some(msg_id.to_string());
        out.push(result_msg);
    }
}

/// Map a Z Code token report to viewer usage (input excludes cache reads).
fn convert_usage(tokens: &Value) -> TokenUsage {
    let g = |k: &str| {
        tokens
            .get(k)
            .and_then(Value::as_i64)
            .map(|n| n.max(0) as u32)
    };
    let input = g("input").unwrap_or(0);
    let cached = tokens
        .pointer("/cache/read")
        .and_then(Value::as_i64)
        .map(|n| n.max(0) as u32);
    TokenUsage {
        // Z Code reports input inclusive of the cached subset; keep only the
        // non-cached part so totals do not double-count cache reads.
        input_tokens: Some(input.saturating_sub(cached.unwrap_or(0))),
        output_tokens: g("output"),
        cache_creation_input_tokens: tokens
            .pointer("/cache/write")
            .and_then(Value::as_i64)
            .map(|n| n.max(0) as u32),
        cache_read_input_tokens: cached,
        reasoning_tokens: g("reasoning"),
        service_tier: None,
        ..Default::default()
    }
}

/// Stringify a tool output that Z Code stores as string or object.
fn stringify_value(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// Collapse whitespace and clip to the summary length with an ellipsis.
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

/// Search across all Z Code sessions.
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let Some(path) = db_path() else {
        return Ok(vec![]);
    };
    if query.is_empty() || limit == 0 {
        return Ok(vec![]);
    }
    let conn = open_db(&path)?;
    search_conn(&conn, query, limit)
}

/// Candidate-session filter pushed into SQL. Only applied when the query is
/// safe for a `LIKE` prefilter: SQLite's `LIKE` is case-insensitive for ASCII
/// only, and raw `part.data` is JSON — a query containing `"`/`\`/control
/// characters can be contiguous in parsed text but escaped in the raw column,
/// so those queries (and non-ASCII ones) fall back to scanning every session
/// and letting the Rust matcher decide, which cannot lose results.
fn like_prefilter_pattern(query: &str) -> Option<String> {
    let safe =
        query.is_ascii() && !query.contains(['"', '\\']) && !query.chars().any(char::is_control);
    safe.then(|| {
        let escaped: String = query
            .chars()
            .map(|c| match c {
                '\\' => "\\\\".to_string(),
                '%' => "\\%".to_string(),
                '_' => "\\_".to_string(),
                other => other.to_string(),
            })
            .collect();
        format!("%{escaped}%")
    })
}

/// Case-insensitive search over all sessions, `limit`-capped.
fn search_conn(conn: &Connection, query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    // Narrow to candidate sessions before any JSON parsing: one indexed
    // EXISTS probe per session instead of loading every message and part.
    let pattern = like_prefilter_pattern(query);
    let mut stmt = conn
        .prepare(
            "SELECT id, directory FROM session s \
             WHERE (task_type IS NULL OR task_type != 'subagent_child') \
               AND (time_archived IS NULL OR time_archived = 0) \
               AND (?1 IS NULL OR EXISTS ( \
                    SELECT 1 FROM part p WHERE p.session_id = s.id \
                      AND p.data LIKE ?1 ESCAPE '\\'))",
        )
        .map_err(|e| e.to_string())?;
    let sessions = stmt
        .query_map(rusqlite::params![pattern], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect::<Vec<_>>();

    for (session_id, directory) in sessions {
        if results.len() >= limit {
            break;
        }
        let project_name = Path::new(&directory)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| directory.clone());
        for mut msg in load_messages_conn(conn, &session_id)? {
            if results.len() >= limit {
                break;
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Schema subset we read. `task_type` is deliberately nullable here even
    /// though the wild store declares it NOT NULL — the queries guard against
    /// NULL so a future schema change degrades gracefully instead of hiding
    /// sessions.
    const TEST_SCHEMA: &str = "CREATE TABLE session (
                id text primary key, project_id text not null, directory text not null,
                title text not null, task_type text default 'interactive',
                title_source text default 'first_input',
                time_created integer not null, time_updated integer not null,
                time_archived integer
            );
            CREATE TABLE message (
                id text primary key, session_id text not null,
                time_created integer not null, data text not null, sequence integer
            );
            CREATE TABLE part (
                id text primary key, message_id text not null, session_id text not null,
                time_created integer not null, data text not null, sequence integer
            );";

    /// Build an in-memory DB mirroring the Z Code schema subset we read.
    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(TEST_SCHEMA).unwrap();
        conn
    }

    /// Build a real file-backed store under `<temp>/cli/db/db.sqlite` and
    /// point `ZCODE_HOME` at `<temp>`, returning the temp dir (keep it alive
    /// for the duration of the test) and the connection to seed with.
    fn temp_zcode_home() -> (tempfile::TempDir, Connection, Option<String>) {
        let temp = tempfile::TempDir::new().unwrap();
        let db_dir = temp.path().join("cli").join("db");
        std::fs::create_dir_all(&db_dir).unwrap();
        let conn = Connection::open(db_dir.join("db.sqlite")).unwrap();
        conn.execute_batch(TEST_SCHEMA).unwrap();
        let original = set_zcode_home(temp.path());
        (temp, conn, original)
    }

    /// Save/restore pattern from the vibe provider tests: the suite runs with
    /// `--test-threads=1`, so mutating `ZCODE_HOME` is safe as long as every
    /// test restores the previous value.
    fn set_zcode_home(path: &std::path::Path) -> Option<String> {
        let original = std::env::var("ZCODE_HOME").ok();
        std::env::set_var("ZCODE_HOME", path);
        original
    }

    fn restore_zcode_home(original: Option<String>) {
        if let Some(value) = original {
            std::env::set_var("ZCODE_HOME", value);
        } else {
            std::env::remove_var("ZCODE_HOME");
        }
    }

    fn insert_session(conn: &Connection, id: &str, dir: &str, title: &str, task_type: &str) {
        conn.execute(
            "INSERT INTO session (id, project_id, directory, title, task_type, time_created, time_updated) \
             VALUES (?1, 'p', ?2, ?3, ?4, 1788599956241, 1788599999999)",
            rusqlite::params![id, dir, title, task_type],
        )
        .unwrap();
    }

    fn insert_message(conn: &Connection, id: &str, session: &str, seq: i64, data: &str) {
        conn.execute(
            "INSERT INTO message (id, session_id, time_created, data, sequence) \
             VALUES (?1, ?2, 1788599956241, ?3, ?4)",
            rusqlite::params![id, session, data, seq],
        )
        .unwrap();
    }

    fn insert_part(conn: &Connection, id: &str, msg: &str, session: &str, seq: i64, data: &str) {
        conn.execute(
            "INSERT INTO part (id, message_id, session_id, time_created, data, sequence) \
             VALUES (?1, ?2, ?3, 1788599956241, ?4, ?5)",
            rusqlite::params![id, msg, session, data, seq],
        )
        .unwrap();
    }

    fn seed(conn: &Connection) {
        insert_session(
            conn,
            "sess-1",
            "/Users/jack/proj",
            "fix the login bug",
            "interactive",
        );
        insert_session(
            conn,
            "sess-2",
            "/Users/jack/proj",
            "other session",
            "interactive",
        );
        insert_session(
            conn,
            "sess-sub",
            "/Users/jack/proj",
            "subagent",
            "subagent_child",
        );
        insert_message(
            conn,
            "m1",
            "sess-1",
            0,
            r#"{"role":"user","time":{"created":1788599956241}}"#,
        );
        insert_part(
            conn,
            "p1",
            "m1",
            "sess-1",
            0,
            r#"{"type":"text","text":"why does LOGIN fail?"}"#,
        );
        insert_message(
            conn,
            "m2",
            "sess-1",
            1,
            concat!(
                r#"{"role":"assistant","time":{"created":1788599956241,"completed":1788599961259},"#,
                r#""modelID":"GLM-5.3","finish":"tool-calls","#,
                r#""tokens":{"total":13085,"input":12858,"output":227,"reasoning":10,"cache":{"read":9984,"write":0}}}"#
            ),
        );
        insert_part(conn, "p2", "m2", "sess-1", 0, r#"{"type":"step-start"}"#);
        insert_part(
            conn,
            "p3",
            "m2",
            "sess-1",
            1,
            r#"{"type":"reasoning","text":"checking auth"}"#,
        );
        insert_part(
            conn,
            "p4",
            "m2",
            "sess-1",
            2,
            r#"{"type":"tool","callID":"call-1","tool":"Read","state":{"status":"completed","input":{"file_path":"/x/HANDOFF.md"},"output":"line1"}}"#,
        );
        insert_part(conn, "p5", "m2", "sess-1", 3, r#"{"type":"step-finish"}"#);
    }

    #[test]
    fn scan_groups_by_directory_and_skips_subagents() {
        let conn = test_db();
        seed(&conn);
        let projects = scan_projects_conn(&conn).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].actual_path, "/Users/jack/proj");
        // sess-2 has no messages and is excluded from the count, matching
        // what load_sessions filters.
        assert_eq!(projects[0].session_count, 1);
        assert_eq!(projects[0].provider.as_deref(), Some("zcode"));
    }

    #[test]
    fn load_sessions_marks_tool_use_and_titles() {
        let conn = test_db();
        seed(&conn);
        let sessions = load_sessions_conn(&conn, "/Users/jack/proj").unwrap();
        // sess-2 has no messages and is filtered out.
        assert_eq!(sessions.len(), 1);
        let first = sessions
            .iter()
            .find(|s| s.actual_session_id == "sess-1")
            .unwrap();
        assert_eq!(first.summary.as_deref(), Some("fix the login bug"));
        assert!(first.has_tool_use);
        assert!(first
            .session_id
            .starts_with("zcode:///Users/jack/proj#sess-1"));
    }

    #[test]
    fn load_messages_splits_tool_call_and_result() {
        let conn = test_db();
        seed(&conn);
        let messages = load_messages_conn(&conn, "sess-1").unwrap();
        // user + assistant + synthesized tool_result lane
        assert_eq!(messages.len(), 3);

        assert_eq!(messages[0].role.as_deref(), Some("user"));
        let ub = messages[0].content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(ub[0]["type"], "text");
        assert_eq!(ub[0]["text"], "why does LOGIN fail?");

        let a = &messages[1];
        assert_eq!(a.role.as_deref(), Some("assistant"));
        assert_eq!(a.model.as_deref(), Some("GLM-5.3"));
        assert_eq!(a.stop_reason.as_deref(), Some("tool_use"));
        assert_eq!(a.duration_ms, Some(5018));
        let usage = a.usage.as_ref().unwrap();
        assert_eq!(usage.input_tokens, Some(2874)); // 12858 - 9984 cached
        assert_eq!(usage.cache_read_input_tokens, Some(9984));
        let ab = a.content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(ab[0]["type"], "thinking");
        assert_eq!(ab[1]["type"], "tool_use");
        assert_eq!(ab[1]["id"], "call-1");
        assert_eq!(ab[1]["name"], "Read");

        let r = &messages[2];
        assert_eq!(r.role.as_deref(), Some("user"));
        assert_eq!(r.parent_uuid.as_deref(), Some("m2"));
        let rb = r.content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(rb[0]["type"], "tool_result");
        assert_eq!(rb[0]["tool_use_id"], "call-1");
        assert_eq!(rb[0]["content"], "line1");
        assert_eq!(rb[0]["is_error"], false);
    }

    #[test]
    fn search_prefilters_ascii_queries() {
        let conn = test_db();
        seed(&conn);
        // "login" matches the "why does LOGIN fail?" text case-insensitively
        // via the SQL prefilter plus the Rust matcher.
        let hits = search_conn(&conn, "login", 10).unwrap();
        assert!(!hits.is_empty());
        assert!(hits.iter().all(|m| m.provider.as_deref() == Some("zcode")));
    }

    #[test]
    fn search_falls_back_to_full_scan_for_non_ascii() {
        let conn = test_db();
        seed(&conn);
        insert_message(
            &conn,
            "m9",
            "sess-2",
            0,
            r#"{"role":"user","time":{"created":1788599956241}}"#,
        );
        insert_part(
            &conn,
            "p9",
            "m9",
            "sess-2",
            0,
            r#"{"type":"text","text":"查看登录问题"}"#,
        );
        // Non-ASCII bypasses the LIKE prefilter and still matches.
        let hits = search_conn(&conn, "登录", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].session_id, "sess-2");
    }

    #[test]
    fn like_pattern_escapes_metacharacters_and_guards_unsafe_queries() {
        // LIKE metacharacters are escaped so the prefilter stays literal.
        assert_eq!(
            like_prefilter_pattern("a%b_c"),
            Some("%a\\%b\\_c%".to_string())
        );
        // Non-ASCII, quotes, backslashes and control chars cannot be safely
        // matched against the raw JSON column — those queries bypass the
        // prefilter entirely.
        assert_eq!(like_prefilter_pattern("登录"), None);
        assert_eq!(like_prefilter_pattern("say \"hi\""), None);
        assert_eq!(like_prefilter_pattern("a\\b"), None);
        assert_eq!(like_prefilter_pattern("a\nb"), None);
    }

    #[test]
    fn search_treats_percent_as_literal() {
        let conn = test_db();
        seed(&conn);
        // No content anywhere contains a literal '%'.
        assert!(search_conn(&conn, "%", 10).unwrap().is_empty());
    }

    #[test]
    fn public_api_round_trip_via_zcode_home() {
        let (_temp, conn, original_env) = temp_zcode_home();
        insert_session(
            &conn,
            "sess-1",
            "/Users/jack/proj",
            "fix the login bug",
            "interactive",
        );
        insert_message(
            &conn,
            "m1",
            "sess-1",
            0,
            r#"{"role":"user","time":{"created":1788599956241}}"#,
        );
        insert_part(
            &conn,
            "p1",
            "m1",
            "sess-1",
            0,
            r#"{"type":"text","text":"why does LOGIN fail?"}"#,
        );

        // detect + base path follow ZCODE_HOME.
        let info = detect().expect("detect with ZCODE_HOME set");
        assert!(info.is_available);
        // Compare path components, not a `/`-joined string: on Windows the
        // base path is `...\cli\db`.
        let base = get_base_path().expect("base path");
        assert!(std::path::Path::new(&base).ends_with(std::path::Path::new("cli").join("db")));

        // scan -> load_sessions -> load_messages through the public fns.
        let projects = scan_projects().unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].actual_path, "/Users/jack/proj");
        let sessions = load_sessions(&projects[0].path, false).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].actual_session_id, "sess-1");
        let messages = load_messages(&sessions[0].session_id).unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].role.as_deref(), Some("user"));

        // search hits the file-backed store too.
        let hits = search("login", 10).unwrap();
        assert_eq!(hits.len(), 1);

        restore_zcode_home(original_env);
    }

    #[test]
    fn public_api_tolerates_missing_store() {
        let temp = tempfile::TempDir::new().unwrap();
        let original = set_zcode_home(temp.path()); // exists, but no db.sqlite
        assert!(scan_projects().unwrap().is_empty());
        assert!(load_sessions("zcode:///any/dir", false).unwrap().is_empty());
        assert!(search("anything", 10).unwrap().is_empty());
        assert!(load_messages("zcode:///any/dir#sess-x").is_err());
        restore_zcode_home(original);
    }

    #[test]
    fn null_task_type_sessions_are_included() {
        let conn = test_db();
        insert_session(&conn, "sess-1", "/Users/jack/proj", "t", "interactive");
        insert_session(&conn, "sess-null", "/Users/jack/proj", "t", "");
        // NULL task_type via raw SQL (helper always binds a string).
        conn.execute(
            "INSERT INTO session (id, project_id, directory, title, task_type, time_created, time_updated)              VALUES ('sess-null2', 'p', '/Users/jack/proj', 't', NULL, 1, 2)",
            [],
        )
        .unwrap();
        for id in ["sess-1", "sess-null", "sess-null2"] {
            insert_message(
                &conn,
                &format!("m-{id}"),
                id,
                0,
                r#"{"role":"user","time":{"created":1}}"#,
            );
            insert_part(
                &conn,
                &format!("p-{id}"),
                &format!("m-{id}"),
                id,
                0,
                r#"{"type":"text","text":"x"}"#,
            );
        }
        // All three count toward the project and all three load.
        let projects = scan_projects_conn(&conn).unwrap();
        assert_eq!(projects[0].session_count, 3);
        let sessions = load_sessions_conn(&conn, "/Users/jack/proj").unwrap();
        assert_eq!(sessions.len(), 3);
    }

    #[test]
    fn session_path_roundtrip() {
        let (dir, id) = parse_session_path("zcode:///a/b#sess-9").unwrap();
        assert_eq!(dir, "/a/b");
        assert_eq!(id, "sess-9");
        assert!(parse_session_path("zcode:///no-separator").is_err());
    }
}
