use super::ProviderInfo;
use crate::commands::session::NativeRenameResult;
use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession, TokenUsage};
use crate::utils::{build_provider_message, search_json_value_case_insensitive};
use chrono::{DateTime, NaiveDateTime, Utc};
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::{Path, PathBuf};

const PROVIDER_ID: &str = "forgecode";
const STORAGE_TYPE: &str = "sqlite";

#[derive(Debug, Clone)]
struct ConversationColumns {
    id: String,
    workspace_id: String,
    title: Option<String>,
    context: String,
    metrics: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
}

#[derive(Debug, Default)]
struct ProjectAccumulator {
    session_count: usize,
    message_count: usize,
    last_modified: String,
    display_name_votes: BTreeMap<String, usize>,
    cwd_votes: BTreeMap<String, usize>,
}

#[derive(Debug)]
struct ConversationRow {
    conversation_id: String,
    workspace_id: String,
    title: Option<String>,
    context_json: String,
    metrics_json: Option<String>,
    created_at: String,
    updated_at: String,
}

/// Detect ``ForgeCode`` installation.
pub fn detect() -> Option<ProviderInfo> {
    let base_path = get_base_path()?;
    let base = Path::new(&base_path);
    let db_path = base.join(".forge.db");
    let logs_path = base.join("logs");
    let history_path = base.join(".forge_history");

    Some(ProviderInfo {
        id: PROVIDER_ID.to_string(),
        display_name: "ForgeCode".to_string(),
        base_path: base_path.clone(),
        is_available: db_path.is_file() || logs_path.is_dir() || history_path.is_file(),
    })
}

/// Resolve the ``ForgeCode`` base path.
///
/// Lookup precedence for v1:
/// 1. `$FORGE_CONFIG`
/// 2. `~/.forge`
///
/// `.forge.db` remains the authoritative transcript source, while `logs/` and
/// `.forge_history` are treated as secondary detection artifacts only.
pub fn get_base_path() -> Option<String> {
    if let Ok(config_dir) = std::env::var("FORGE_CONFIG") {
        let path = PathBuf::from(&config_dir);
        if path.exists() {
            return Some(path.to_string_lossy().to_string());
        }
    }

    let home = dirs::home_dir()?;
    let default_path = home.join(".forge");
    if default_path.exists() {
        Some(default_path.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Scan `ForgeCode` projects from the detected base path.
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let base_path = get_base_path().ok_or_else(|| "ForgeCode base path not found".to_string())?;
    scan_projects_from_path(&base_path)
}

/// Scan `ForgeCode` projects from an explicit base path.
pub fn scan_projects_from_path(base_path: &str) -> Result<Vec<ClaudeProject>, String> {
    crate::utils::require_absolute_path(base_path, "ForgeCode base path")?;
    if let Some(projects) = scan_projects_from_db(base_path) {
        return Ok(projects);
    }
    log::debug!("ForgeCode: no projects found or DB unavailable at {base_path}");
    Ok(Vec::new())
}

/// Load `ForgeCode` sessions for a virtual workspace path.
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let base_path = get_base_path().ok_or_else(|| "ForgeCode not found".to_string())?;
    let workspace_id = parse_workspace_project_path(project_path)
        .ok_or_else(|| format!("Invalid ForgeCode project path: {project_path}"))?;

    if let Some(sessions) = load_sessions_from_db(&base_path, &workspace_id) {
        return Ok(sessions);
    }
    log::debug!("ForgeCode: no sessions found for workspace {workspace_id}");
    Ok(Vec::new())
}

/// Load `ForgeCode` messages for a virtual conversation path.
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let base_path = get_base_path().ok_or_else(|| "ForgeCode not found".to_string())?;
    let (workspace_id, conversation_id) = parse_conversation_path(session_path)
        .ok_or_else(|| format!("Invalid ForgeCode session path: {session_path}"))?;

    if let Some(messages) = load_messages_from_db(&base_path, &workspace_id, &conversation_id) {
        return Ok(messages);
    }
    log::debug!(
        "ForgeCode: no messages found for workspace {workspace_id} conversation {conversation_id}"
    );
    Ok(Vec::new())
}

/// Search `ForgeCode` messages using the detected database path.
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let base_path = get_base_path().ok_or_else(|| "ForgeCode not found".to_string())?;
    Ok(search_from_path(&base_path, query, limit))
}

/// Search `ForgeCode` messages from an explicit base path.
fn search_from_path(base_path: &str, query: &str, limit: usize) -> Vec<ClaudeMessage> {
    let query_lower = query.to_lowercase();
    let Some(conn) = open_db(base_path) else {
        return Vec::new();
    };
    let Some(columns) = resolve_conversation_columns(&conn) else {
        return Vec::new();
    };
    let Some(rows) = load_search_rows(&conn, &columns) else {
        return Vec::new();
    };

    let mut results = Vec::new();

    for row in rows {
        let created_at = normalize_timestamp_text(&row.created_at);
        let updated_at = latest_timestamp(&row.created_at, &row.updated_at);
        let messages = map_context_messages(
            &row.workspace_id,
            &row.conversation_id,
            &parse_context_entries(&row.context_json),
            &created_at,
            &updated_at,
            row.metrics_json.as_deref(),
        );

        for message in messages {
            if results.len() >= limit {
                return results;
            }

            if let Some(content) = &message.content {
                if search_json_value_case_insensitive(content, &query_lower) {
                    results.push(message);
                }
            }
        }
    }

    results
}

/// Load conversation rows used by `ForgeCode` full-text search.
fn load_search_rows(
    conn: &Connection,
    columns: &ConversationColumns,
) -> Option<Vec<ConversationRow>> {
    let query = format!(
        "SELECT {conversation_id}, {workspace_id}, {title}, {context}, {metrics}, {created_at}, {updated_at}
         FROM conversations
         WHERE {workspace_id_raw} IS NOT NULL AND {context_raw} IS NOT NULL
         ORDER BY {updated_at_raw} DESC, {created_at_raw} DESC",
        conversation_id = cast_text_expr(&columns.id),
        workspace_id = cast_text_expr(&columns.workspace_id),
        title = optional_cast_text_expr(columns.title.as_deref()),
        context = cast_text_expr(&columns.context),
        metrics = optional_cast_text_expr(columns.metrics.as_deref()),
        created_at = optional_cast_text_expr(columns.created_at.as_deref()),
        updated_at = optional_cast_text_expr(columns.updated_at.as_deref()),
        workspace_id_raw = quote_ident(&columns.workspace_id),
        context_raw = quote_ident(&columns.context),
        updated_at_raw = optional_order_expr(columns.updated_at.as_deref()),
        created_at_raw = optional_order_expr(columns.created_at.as_deref()),
    );

    let mut stmt = conn.prepare(&query).ok()?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ConversationRow {
                conversation_id: row.get(0)?,
                workspace_id: row.get(1)?,
                title: empty_to_none(row.get::<_, String>(2)?),
                context_json: row.get(3)?,
                metrics_json: empty_to_none(row.get::<_, String>(4)?),
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .ok()?;

    Some(rows.filter_map(std::result::Result::ok).collect())
}

/// Rename a `ForgeCode` conversation title in the local database.
pub fn rename_session_title(
    session_path: &str,
    new_title: &str,
) -> Result<NativeRenameResult, String> {
    let base_path = get_base_path().ok_or_else(|| "ForgeCode not found".to_string())?;
    rename_session_title_from_path(&base_path, session_path, new_title)
}

/// Rename a `ForgeCode` conversation title from an explicit base path.
fn rename_session_title_from_path(
    base_path: &str,
    session_path: &str,
    new_title: &str,
) -> Result<NativeRenameResult, String> {
    let (workspace_id, conversation_id) = parse_conversation_path(session_path)
        .ok_or_else(|| format!("Invalid ForgeCode session path: {session_path}"))?;
    let conn = open_db_read_write(base_path)?;
    let columns = resolve_conversation_columns(&conn)
        .ok_or_else(|| "ForgeCode conversations schema not found".to_string())?;
    let title_column = columns
        .title
        .as_deref()
        .ok_or_else(|| "ForgeCode database does not expose a writable title column".to_string())?;
    let existing = load_conversation_row(&conn, &columns, &workspace_id, &conversation_id)
        .ok_or_else(|| format!("ForgeCode conversation not found: {session_path}"))?;
    let trimmed_title = new_title.trim();
    let next_title = if trimmed_title.is_empty() {
        None
    } else {
        Some(trimmed_title.to_string())
    };
    let previous_title = existing.title.unwrap_or_default();

    let affected_rows = if let Some(updated_at_column) = columns.updated_at.as_deref() {
        let query = format!(
            "UPDATE conversations
             SET {title_column} = ?1, {updated_at_column} = ?2
             WHERE CAST({workspace_id_column} AS TEXT) = ?3
               AND CAST({conversation_id_column} AS TEXT) = ?4",
            title_column = quote_ident(title_column),
            updated_at_column = quote_ident(updated_at_column),
            workspace_id_column = quote_ident(&columns.workspace_id),
            conversation_id_column = quote_ident(&columns.id),
        );
        conn.execute(
            &query,
            rusqlite::params![
                next_title.clone(),
                Utc::now().to_rfc3339(),
                workspace_id,
                conversation_id
            ],
        )
        .map_err(|e| format!("Failed to rename ForgeCode conversation: {e}"))?
    } else {
        let query = format!(
            "UPDATE conversations
             SET {title_column} = ?1
             WHERE CAST({workspace_id_column} AS TEXT) = ?2
               AND CAST({conversation_id_column} AS TEXT) = ?3",
            title_column = quote_ident(title_column),
            workspace_id_column = quote_ident(&columns.workspace_id),
            conversation_id_column = quote_ident(&columns.id),
        );
        conn.execute(
            &query,
            rusqlite::params![next_title.clone(), workspace_id, conversation_id],
        )
        .map_err(|e| format!("Failed to rename ForgeCode conversation: {e}"))?
    };

    if affected_rows == 0 {
        return Err(format!("ForgeCode conversation not found: {session_path}"));
    }

    Ok(NativeRenameResult {
        success: true,
        previous_title,
        new_title: next_title.unwrap_or_default(),
        file_path: session_path.to_string(),
    })
}

/// Delete a `ForgeCode` conversation from the detected database.
pub fn delete_conversation(session_path: &str) -> Result<(), String> {
    let base_path = get_base_path().ok_or_else(|| "ForgeCode not found".to_string())?;
    delete_conversation_from_path(&base_path, session_path)
}

/// Delete a `ForgeCode` conversation from an explicit base path.
fn delete_conversation_from_path(base_path: &str, session_path: &str) -> Result<(), String> {
    let (workspace_id, conversation_id) = parse_conversation_path(session_path)
        .ok_or_else(|| format!("Invalid ForgeCode session path: {session_path}"))?;
    let conn = open_db_read_write(base_path)?;
    let columns = resolve_conversation_columns(&conn)
        .ok_or_else(|| "ForgeCode conversations schema not found".to_string())?;

    let query = format!(
        "DELETE FROM conversations
         WHERE CAST({workspace_id_column} AS TEXT) = ?1
           AND CAST({conversation_id_column} AS TEXT) = ?2",
        workspace_id_column = quote_ident(&columns.workspace_id),
        conversation_id_column = quote_ident(&columns.id),
    );

    let affected_rows = conn
        .execute(&query, rusqlite::params![workspace_id, conversation_id])
        .map_err(|e| format!("Failed to delete ForgeCode conversation: {e}"))?;

    if affected_rows == 0 {
        return Err(format!("ForgeCode conversation not found: {session_path}"));
    }

    Ok(())
}

/// Open the `ForgeCode` `SQLite` database in read-only mode.
fn open_db(base_path: &str) -> Option<Connection> {
    let db_path = Path::new(base_path).join(".forge.db");
    if !db_path.is_file() {
        return None;
    }

    Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()
}

/// Open the `ForgeCode` `SQLite` database in read-write mode.
fn open_db_read_write(base_path: &str) -> Result<Connection, String> {
    let db_path = Path::new(base_path).join(".forge.db");
    if !db_path.is_file() {
        return Err(format!(
            "ForgeCode database not found: {}",
            db_path.display()
        ));
    }

    Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Failed to open ForgeCode database: {e}"))
}

/// Build project summaries from `ForgeCode` conversation rows.
fn scan_projects_from_db(base_path: &str) -> Option<Vec<ClaudeProject>> {
    let conn = open_db(base_path)?;
    let columns = resolve_conversation_columns(&conn)?;
    let rows = load_project_rows(&conn, &columns)?;

    let mut workspaces: BTreeMap<String, ProjectAccumulator> = BTreeMap::new();

    for row in rows {
        let message_count = parse_context_entries(&row.context_json).len();
        let last_modified = latest_timestamp(&row.created_at, &row.updated_at);
        let extracted_display_name =
            extract_workspace_display_name_from_context_json(&row.context_json);
        let extracted_cwds = extract_cwds_from_context_json(&row.context_json);

        let entry = workspaces.entry(row.workspace_id).or_default();
        entry.session_count += 1;
        entry.message_count += message_count;
        entry.last_modified = max_timestamp(&entry.last_modified, &last_modified);
        if let Some(display_name) = extracted_display_name {
            *entry.display_name_votes.entry(display_name).or_default() += 1;
        }
        for (cwd, count) in extracted_cwds {
            *entry.cwd_votes.entry(cwd).or_default() += count;
        }
    }

    let mut projects: Vec<ClaudeProject> = workspaces
        .into_iter()
        .map(|(workspace_id, acc)| {
            let actual_path = choose_best_cwd(&acc.cwd_votes)
                .unwrap_or_else(|| project_virtual_path(&workspace_id));
            ClaudeProject {
                name: choose_workspace_display_name(&workspace_id, &acc.display_name_votes),
                path: project_virtual_path(&workspace_id),
                actual_path,
                session_count: acc.session_count,
                message_count: acc.message_count,
                last_modified: acc.last_modified,
                git_info: None,
                provider: Some(PROVIDER_ID.to_string()),
                storage_type: Some(STORAGE_TYPE.to_string()),
                custom_directory_label: None,
            }
        })
        .collect();

    projects.sort_by(|a, b| compare_timestamps(&b.last_modified, &a.last_modified));
    Some(projects)
}

/// Load `ForgeCode` session summaries for a workspace.
fn load_sessions_from_db(base_path: &str, workspace_id: &str) -> Option<Vec<ClaudeSession>> {
    let conn = open_db(base_path)?;
    let columns = resolve_conversation_columns(&conn)?;
    let rows = load_workspace_rows(&conn, &columns, workspace_id)?;
    let project_name = resolve_workspace_display_name_from_rows(workspace_id, &rows);

    let mut sessions: Vec<ClaudeSession> = rows
        .into_iter()
        .filter(|row| !row.context_json.trim().is_empty())
        .map(|row| {
            let entries = parse_context_entries(&row.context_json);
            let has_tool_use = context_entries_have_tool_use(&entries);
            let first_message_time = normalize_timestamp_text(&row.created_at);
            let last_message_time = latest_timestamp(&row.created_at, &row.updated_at);

            ClaudeSession {
                session_id: session_virtual_path(&row.workspace_id, &row.conversation_id),
                actual_session_id: row.conversation_id.clone(),
                file_path: session_file_virtual_path(&row.workspace_id, &row.conversation_id),
                project_name: project_name.clone(),
                message_count: entries.len(),
                first_message_time,
                last_message_time: last_message_time.clone(),
                last_modified: last_message_time,
                has_tool_use,
                has_errors: false,
                summary: row.title.filter(|title| !title.trim().is_empty()),
                is_renamed: false,
                provider: Some(PROVIDER_ID.to_string()),
                storage_type: Some(STORAGE_TYPE.to_string()),
            }
        })
        .collect();

    sessions.sort_by(|a, b| compare_timestamps(&b.last_modified, &a.last_modified));
    Some(sessions)
}

/// Load `ForgeCode` messages for a workspace conversation pair.
fn load_messages_from_db(
    base_path: &str,
    workspace_id: &str,
    conversation_id: &str,
) -> Option<Vec<ClaudeMessage>> {
    let conn = open_db(base_path)?;
    let columns = resolve_conversation_columns(&conn)?;
    let row = load_conversation_row(&conn, &columns, workspace_id, conversation_id)?;
    let entries = parse_context_entries(&row.context_json);
    let created_at = normalize_timestamp_text(&row.created_at);
    let updated_at = latest_timestamp(&row.created_at, &row.updated_at);

    Some(map_context_messages(
        workspace_id,
        conversation_id,
        &entries,
        &created_at,
        &updated_at,
        row.metrics_json.as_deref(),
    ))
}

/// Resolve the conversation table columns exposed by the `ForgeCode` schema.
fn resolve_conversation_columns(conn: &Connection) -> Option<ConversationColumns> {
    let mut stmt = conn.prepare("PRAGMA table_info(conversations)").ok()?;
    let column_names: HashSet<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .ok()?
        .filter_map(std::result::Result::ok)
        .collect();

    let pick = |names: &[&str]| {
        names
            .iter()
            .find(|name| column_names.contains(**name))
            .map(|name| (*name).to_string())
    };

    Some(ConversationColumns {
        id: pick(&["conversation_id", "id"])?,
        workspace_id: pick(&["workspace_id"])?,
        title: pick(&["title"]),
        context: pick(&["context"])?,
        metrics: pick(&["metrics"]),
        created_at: pick(&["created_at", "createdAt"]),
        updated_at: pick(&["updated_at", "updatedAt"]),
    })
}

/// Load per-workspace aggregation rows from the conversations table.
fn load_project_rows(
    conn: &Connection,
    columns: &ConversationColumns,
) -> Option<Vec<ConversationRow>> {
    let query = format!(
        "SELECT {workspace_id}, {context}, {created_at}, {updated_at}
         FROM conversations
         WHERE {workspace_id_raw} IS NOT NULL AND {context_raw} IS NOT NULL",
        workspace_id = cast_text_expr(&columns.workspace_id),
        context = cast_text_expr(&columns.context),
        created_at = optional_cast_text_expr(columns.created_at.as_deref()),
        updated_at = optional_cast_text_expr(columns.updated_at.as_deref()),
        workspace_id_raw = quote_ident(&columns.workspace_id),
        context_raw = quote_ident(&columns.context),
    );

    let mut stmt = conn.prepare(&query).ok()?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ConversationRow {
                conversation_id: String::new(),
                workspace_id: row.get(0)?,
                title: None,
                context_json: row.get(1)?,
                metrics_json: None,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .ok()?;

    Some(rows.filter_map(std::result::Result::ok).collect())
}

/// Load conversation rows for a single `ForgeCode` workspace.
fn load_workspace_rows(
    conn: &Connection,
    columns: &ConversationColumns,
    workspace_id: &str,
) -> Option<Vec<ConversationRow>> {
    let query = format!(
        "SELECT {conversation_id}, {workspace_id}, {title}, {context}, {metrics}, {created_at}, {updated_at}
         FROM conversations
         WHERE CAST({workspace_id_raw} AS TEXT) = ?1 AND {context_raw} IS NOT NULL
         ORDER BY {updated_at_raw} DESC, {created_at_raw} DESC",
        conversation_id = cast_text_expr(&columns.id),
        workspace_id = cast_text_expr(&columns.workspace_id),
        title = optional_cast_text_expr(columns.title.as_deref()),
        context = cast_text_expr(&columns.context),
        metrics = optional_cast_text_expr(columns.metrics.as_deref()),
        created_at = optional_cast_text_expr(columns.created_at.as_deref()),
        updated_at = optional_cast_text_expr(columns.updated_at.as_deref()),
        workspace_id_raw = quote_ident(&columns.workspace_id),
        context_raw = quote_ident(&columns.context),
        updated_at_raw = optional_order_expr(columns.updated_at.as_deref()),
        created_at_raw = optional_order_expr(columns.created_at.as_deref()),
    );

    let mut stmt = conn.prepare(&query).ok()?;
    let rows = stmt
        .query_map([workspace_id], |row| {
            Ok(ConversationRow {
                conversation_id: row.get(0)?,
                workspace_id: row.get(1)?,
                title: empty_to_none(row.get::<_, String>(2)?),
                context_json: row.get(3)?,
                metrics_json: empty_to_none(row.get::<_, String>(4)?),
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .ok()?;

    Some(rows.filter_map(std::result::Result::ok).collect())
}

/// Load a single `ForgeCode` conversation row by workspace and conversation id.
fn load_conversation_row(
    conn: &Connection,
    columns: &ConversationColumns,
    workspace_id: &str,
    conversation_id: &str,
) -> Option<ConversationRow> {
    let query = format!(
        "SELECT {conversation_id}, {workspace_id}, {title}, {context}, {metrics}, {created_at}, {updated_at}
         FROM conversations
         WHERE CAST({workspace_id_raw} AS TEXT) = ?1
           AND CAST({conversation_id_raw} AS TEXT) = ?2
         LIMIT 1",
        conversation_id = cast_text_expr(&columns.id),
        workspace_id = cast_text_expr(&columns.workspace_id),
        title = optional_cast_text_expr(columns.title.as_deref()),
        context = cast_text_expr(&columns.context),
        metrics = optional_cast_text_expr(columns.metrics.as_deref()),
        created_at = optional_cast_text_expr(columns.created_at.as_deref()),
        updated_at = optional_cast_text_expr(columns.updated_at.as_deref()),
        workspace_id_raw = quote_ident(&columns.workspace_id),
        conversation_id_raw = quote_ident(&columns.id),
    );

    let mut stmt = conn.prepare(&query).ok()?;
    stmt.query_row([workspace_id, conversation_id], |row| {
        Ok(ConversationRow {
            conversation_id: row.get(0)?,
            workspace_id: row.get(1)?,
            title: empty_to_none(row.get::<_, String>(2)?),
            context_json: row.get(3)?,
            metrics_json: empty_to_none(row.get::<_, String>(4)?),
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })
    .ok()
}

/// Parse `ForgeCode` context JSON into a list of entry values.
fn parse_context_entries(context_json: &str) -> Vec<Value> {
    let Ok(value) = serde_json::from_str::<Value>(context_json) else {
        return Vec::new();
    };

    match value {
        Value::Array(entries) => entries,
        Value::Object(mut object) => object
            .remove("messages")
            .and_then(|messages| messages.as_array().cloned())
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

/// Return whether any context entry contains tool usage data.
fn context_entries_have_tool_use(entries: &[Value]) -> bool {
    entries.iter().any(entry_contains_tool_use)
}

/// Return whether a context entry contains tool usage data.
fn entry_contains_tool_use(entry: &Value) -> bool {
    let (kind, payload) = extract_context_variant(entry);
    if kind == "tool" {
        return true;
    }

    extract_embedded_tool_use(payload).is_some()
}

/// Map `ForgeCode` context entries into normalized messages.
fn map_context_messages(
    workspace_id: &str,
    conversation_id: &str,
    entries: &[Value],
    created_at: &str,
    updated_at: &str,
    metrics_json: Option<&str>,
) -> Vec<ClaudeMessage> {
    let mut messages: Vec<ClaudeMessage> = entries
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            map_context_message(
                workspace_id,
                conversation_id,
                index,
                entry,
                created_at,
                updated_at,
            )
        })
        .collect();

    if let Some(metrics) = extract_metrics_metadata(metrics_json) {
        if let Some(last) = messages.last_mut() {
            attach_message_metadata(last, "forgecodeMetrics", metrics);
        }
    }

    messages
}

/// Map a single `ForgeCode` context entry into a normalized message.
fn map_context_message(
    workspace_id: &str,
    conversation_id: &str,
    index: usize,
    entry: &Value,
    created_at: &str,
    updated_at: &str,
) -> ClaudeMessage {
    let (kind, payload) = extract_context_variant(entry);
    let normalized_payload = merge_context_payload(entry, payload);
    let timestamp = extract_timestamp(&normalized_payload)
        .or_else(|| extract_timestamp(entry))
        .unwrap_or_else(|| fallback_message_timestamp(index, created_at, updated_at));
    let model = extract_model(&normalized_payload).or_else(|| extract_model(entry));

    match kind {
        "tool" => map_tool_message(
            workspace_id,
            conversation_id,
            index,
            &normalized_payload,
            timestamp,
            model,
        ),
        "image" => map_image_message(
            workspace_id,
            conversation_id,
            index,
            &normalized_payload,
            timestamp,
            model,
        ),
        _ => map_text_message(
            workspace_id,
            conversation_id,
            index,
            &normalized_payload,
            timestamp,
            model,
        ),
    }
}

/// Map a text-style `ForgeCode` context entry into a message.
fn map_text_message(
    workspace_id: &str,
    conversation_id: &str,
    index: usize,
    payload: &Value,
    timestamp: String,
    model: Option<String>,
) -> ClaudeMessage {
    let role = normalize_role(extract_role(payload).as_deref(), "user");
    let message_type = message_type_for_role(&role).to_string();
    let content = build_text_message_content(payload);

    let mut message = build_provider_message(
        PROVIDER_ID,
        message_uuid(workspace_id, conversation_id, index),
        conversation_id,
        timestamp,
        &message_type,
        Some(&role),
        content.clone(),
        model,
    );

    message.usage = extract_usage(payload);
    message.cost_usd = extract_cost_usd(payload);
    message.stop_reason = extract_string(payload, &["stop_reason", "stopReason"]);
    message.tool_use = content.as_ref().and_then(extract_embedded_tool_use);
    if let Some(metadata) = extract_safe_message_metadata(payload) {
        attach_message_metadata(&mut message, "forgecodeMessageMetadata", metadata);
    }

    message
}

/// Map an image-style `ForgeCode` context entry into a message.
fn map_image_message(
    workspace_id: &str,
    conversation_id: &str,
    index: usize,
    payload: &Value,
    timestamp: String,
    model: Option<String>,
) -> ClaudeMessage {
    let role = normalize_role(extract_role(payload).as_deref(), "user");
    let message_type = message_type_for_role(&role).to_string();
    let content = Value::Array(vec![json!({
        "type": "image",
        "source": payload.clone(),
    })]);

    let mut message = build_provider_message(
        PROVIDER_ID,
        message_uuid(workspace_id, conversation_id, index),
        conversation_id,
        timestamp,
        &message_type,
        Some(&role),
        Some(content),
        model,
    );

    message.usage = extract_usage(payload);
    message.cost_usd = extract_cost_usd(payload);
    if let Some(metadata) = extract_safe_message_metadata(payload) {
        attach_message_metadata(&mut message, "forgecodeMessageMetadata", metadata);
    }

    message
}

/// Map a tool-style `ForgeCode` context entry into a message.
fn map_tool_message(
    workspace_id: &str,
    conversation_id: &str,
    index: usize,
    payload: &Value,
    timestamp: String,
    model: Option<String>,
) -> ClaudeMessage {
    let role_hint = extract_role(payload);
    let tool_name = extract_string(payload, &["name", "tool_name", "toolName"])
        .unwrap_or_else(|| "tool".to_string());
    let tool_use_id = extract_string(payload, &["tool_use_id", "toolUseId", "id"])
        .unwrap_or_else(|| message_uuid(workspace_id, conversation_id, index));
    let tool_input = extract_json(payload, &["input", "arguments", "args", "params"])
        .or_else(|| extract_json(payload, &["payload"]))
        .unwrap_or(Value::Null);
    let tool_result_content =
        extract_json(payload, &["tool_result", "toolResult", "result", "output"])
            .or_else(|| extract_json(payload, &["content"]));
    let is_tool_result = matches!(role_hint.as_deref(), Some("tool"))
        || matches!(role_hint.as_deref(), Some("user"))
        || (tool_result_content.is_some() && tool_input.is_null());

    if is_tool_result {
        let mut message = build_provider_message(
            PROVIDER_ID,
            message_uuid(workspace_id, conversation_id, index),
            conversation_id,
            timestamp,
            "user",
            Some("user"),
            Some(Value::Array(vec![json!({
                "type": "tool_result",
                "tool_use_id": tool_use_id,
                "content": tool_result_content.clone().unwrap_or_else(|| payload.clone()),
                "name": tool_name,
                "is_error": extract_bool(payload, &["is_error", "isError", "error"]),
            })])),
            model,
        );

        message.tool_use_result = tool_result_content.or_else(|| Some(payload.clone()));
        message.usage = extract_usage(payload);
        message.cost_usd = extract_cost_usd(payload);
        if let Some(metadata) = extract_safe_message_metadata(payload) {
            attach_message_metadata(&mut message, "forgecodeMessageMetadata", metadata);
        }
        return message;
    }

    let mut blocks = Vec::new();
    if let Some(text) = extract_text(payload) {
        blocks.push(json!({
            "type": "text",
            "text": text,
        }));
    }

    let tool_use_block = json!({
        "type": "tool_use",
        "id": tool_use_id,
        "name": tool_name,
        "input": tool_input,
    });
    blocks.push(tool_use_block.clone());

    let mut message = build_provider_message(
        PROVIDER_ID,
        message_uuid(workspace_id, conversation_id, index),
        conversation_id,
        timestamp,
        "assistant",
        Some("assistant"),
        Some(Value::Array(blocks)),
        model,
    );

    message.tool_use = Some(tool_use_block);
    message.usage = extract_usage(payload);
    message.cost_usd = extract_cost_usd(payload);
    if let Some(metadata) = extract_safe_message_metadata(payload) {
        attach_message_metadata(&mut message, "forgecodeMessageMetadata", metadata);
    }

    message
}

/// Extract the `ForgeCode` context entry variant name.
fn extract_context_variant(entry: &Value) -> (&'static str, &Value) {
    if let Some(message) = entry.get("message") {
        if let Some(text) = message.get("text") {
            return ("text", text);
        }
        if let Some(tool) = message.get("tool") {
            return ("tool", tool);
        }
        if let Some(image) = message.get("image") {
            return ("image", image);
        }
    }

    if let Some(text) = entry.get("Text") {
        return ("text", text);
    }
    if let Some(tool) = entry.get("Tool") {
        return ("tool", tool);
    }
    if let Some(image) = entry.get("Image") {
        return ("image", image);
    }
    if let Some(kind) = entry.get("type").and_then(Value::as_str) {
        return match kind.to_ascii_lowercase().as_str() {
            "tool" => ("tool", entry),
            "image" => ("image", entry),
            _ => ("text", entry),
        };
    }

    ("text", entry)
}

/// Merge nested `ForgeCode` payload objects into a single value.
fn merge_context_payload(entry: &Value, payload: &Value) -> Value {
    let mut merged = payload.clone();
    let Some(merged_object) = merged.as_object_mut() else {
        return merged;
    };

    let Some(entry_object) = entry.as_object() else {
        return merged;
    };

    for key in [
        "usage",
        "timestamp",
        "created_at",
        "createdAt",
        "time",
        "cost",
        "cost_usd",
        "costUSD",
    ] {
        if !merged_object.contains_key(key) {
            if let Some(value) = entry_object.get(key) {
                merged_object.insert(key.to_string(), value.clone());
            }
        }
    }

    merged
}

/// Extract a message role from a `ForgeCode` payload.
fn extract_role(value: &Value) -> Option<String> {
    extract_string(value, &["role", "speaker", "author"])
}

/// Normalize `ForgeCode` role names to the shared role set.
fn normalize_role(role: Option<&str>, default_role: &str) -> String {
    let normalized = role.unwrap_or(default_role).trim().to_ascii_lowercase();

    match normalized.as_str() {
        "tool" => "user".to_string(),
        "" => default_role.to_string(),
        _ => normalized,
    }
}

/// Translate a normalized role into the shared message type.
fn message_type_for_role(role: &str) -> &'static str {
    match role {
        "assistant" => "assistant",
        "system" => "system",
        _ => "user",
    }
}

/// Extract the best content value from a `ForgeCode` payload.
fn extract_content_value(payload: &Value) -> Option<Value> {
    if let Some(content) = extract_json(payload, &["content", "message", "body", "value"]) {
        if !value_is_effectively_empty(&content) {
            return Some(content);
        }
    }

    extract_json(payload, &["raw_content", "rawContent"])
        .or_else(|| extract_text(payload).map(Value::String))
}

/// Return whether a JSON value is empty for message rendering.
fn value_is_effectively_empty(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::String(text) => text.trim().is_empty(),
        Value::Array(items) => items.is_empty(),
        Value::Object(object) => object.is_empty(),
        _ => false,
    }
}

/// Build normalized message content for a text payload.
fn build_text_message_content(payload: &Value) -> Option<Value> {
    let tool_calls = extract_tool_call_blocks(payload);
    if !tool_calls.is_empty() {
        let mut blocks = Vec::new();
        if let Some(text) = extract_text(payload).filter(|text| !text.trim().is_empty()) {
            blocks.push(json!({
                "type": "text",
                "text": text,
            }));
        }
        blocks.extend(tool_calls);
        return Some(Value::Array(blocks));
    }

    extract_content_value(payload).or_else(|| Some(payload.clone()))
}

/// Extract tool-call content blocks from a `ForgeCode` payload.
fn extract_tool_call_blocks(payload: &Value) -> Vec<Value> {
    payload
        .get("tool_calls")
        .or_else(|| payload.get("toolCalls"))
        .and_then(Value::as_array)
        .map(|tool_calls| {
            tool_calls
                .iter()
                .filter_map(normalize_tool_call_block)
                .collect()
        })
        .unwrap_or_default()
}

/// Normalize a `ForgeCode` tool-call block into shared message content.
fn normalize_tool_call_block(tool_call: &Value) -> Option<Value> {
    let name = extract_string(tool_call, &["name"])?;
    let id = extract_string(tool_call, &["call_id", "callId", "id"])
        .unwrap_or_else(|| format!("tool-{}", name.to_ascii_lowercase()));
    let input = extract_json(tool_call, &["arguments", "input", "args", "params"])
        .map(|value| normalize_tool_call_input(&value))
        .unwrap_or(Value::Object(Map::new()));

    Some(json!({
        "type": "tool_use",
        "id": id,
        "name": name,
        "input": input,
    }))
}

/// Normalize `ForgeCode` tool input into a JSON object.
fn normalize_tool_call_input(value: &Value) -> Value {
    match value {
        Value::String(text) => {
            serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.clone()))
        }
        _ => value.clone(),
    }
}

/// Extract embedded tool usage metadata from a `ForgeCode` payload.
fn extract_embedded_tool_use(content: &Value) -> Option<Value> {
    match content {
        Value::Array(items) => items.iter().find_map(|item| {
            if item.get("type").and_then(Value::as_str) == Some("tool_use") {
                Some(item.clone())
            } else {
                None
            }
        }),
        Value::Object(object) => {
            if object.get("type").and_then(Value::as_str) == Some("tool_use") {
                return Some(content.clone());
            }
            if let Some(tool_calls) = object
                .get("tool_calls")
                .or_else(|| object.get("toolCalls"))
                .and_then(Value::as_array)
            {
                return tool_calls.iter().find_map(normalize_tool_call_block);
            }
            object
                .get("tool_use")
                .or_else(|| object.get("toolUse"))
                .cloned()
        }
        _ => None,
    }
}

/// Extract token usage information from `ForgeCode` message payloads.
fn extract_usage(payload: &Value) -> Option<TokenUsage> {
    let usage = payload.get("usage").unwrap_or(payload);
    let direct_input_tokens = extract_u32(usage, &["input_tokens", "inputTokens"]);
    let prompt_tokens = extract_u32(usage, &["prompt_tokens", "promptTokens"]);
    let output_tokens = extract_u32(
        usage,
        &[
            "output_tokens",
            "outputTokens",
            "completion_tokens",
            "completionTokens",
        ],
    );
    let cache_creation_input_tokens = extract_u32(
        usage,
        &["cache_creation_input_tokens", "cacheCreationInputTokens"],
    );
    let cache_read_input_tokens = extract_u32(
        usage,
        &[
            "cache_read_input_tokens",
            "cacheReadInputTokens",
            "cached_tokens",
            "cachedTokens",
        ],
    );
    let input_tokens = direct_input_tokens.or_else(|| {
        prompt_tokens.map(|prompt| prompt.saturating_sub(cache_read_input_tokens.unwrap_or(0)))
    });
    let service_tier = extract_string(usage, &["service_tier", "serviceTier"]);

    if input_tokens.is_none()
        && output_tokens.is_none()
        && cache_creation_input_tokens.is_none()
        && cache_read_input_tokens.is_none()
        && service_tier.is_none()
    {
        None
    } else {
        Some(TokenUsage {
            input_tokens,
            output_tokens,
            cache_creation_input_tokens,
            cache_read_input_tokens,
            service_tier,
        })
    }
}

/// Extract a USD cost value from `ForgeCode` metrics.
fn extract_cost_usd(payload: &Value) -> Option<f64> {
    extract_f64(payload, &["cost_usd", "costUSD", "cost"]).or_else(|| {
        payload
            .get("usage")
            .and_then(|usage| extract_f64(usage, &["cost"]))
    })
}

/// Extract the best timestamp for a `ForgeCode` context entry.
fn extract_timestamp(value: &Value) -> Option<String> {
    extract_json(value, &["timestamp", "created_at", "createdAt", "time"]).and_then(|raw| {
        normalize_timestamp_value(&raw)
            .and_then(|normalized| normalized.as_str().map(ToString::to_string))
    })
}

/// Build a fallback timestamp for a message missing its own timestamp.
fn fallback_message_timestamp(index: usize, created_at: &str, updated_at: &str) -> String {
    if index == 0 && !created_at.is_empty() {
        created_at.to_string()
    } else if !updated_at.is_empty() {
        updated_at.to_string()
    } else {
        created_at.to_string()
    }
}

/// Extract the model identifier from a `ForgeCode` payload.
fn extract_model(value: &Value) -> Option<String> {
    extract_string(value, &["model", "model_id", "modelId"])
}

/// Extract `ForgeCode` metadata fields that are safe to expose on messages.
fn extract_safe_message_metadata(payload: &Value) -> Option<Value> {
    let mut metadata = Map::new();

    if let Some(file_operations) = extract_json(payload, &["file_operations", "fileOperations"]) {
        metadata.insert("fileOperations".to_string(), file_operations);
    }
    if let Some(files_accessed) = extract_json(payload, &["files_accessed", "filesAccessed"]) {
        metadata.insert("filesAccessed".to_string(), files_accessed);
    }
    if let Some(reasoning_details) =
        extract_json(payload, &["reasoning_details", "reasoningDetails"])
    {
        metadata.insert("reasoningDetails".to_string(), reasoning_details);
    }
    if let Some(raw_content) = extract_json(payload, &["raw_content", "rawContent"]) {
        metadata.insert("rawContent".to_string(), raw_content);
    }

    let related_ids = extract_related_conversation_ids(payload);
    if !related_ids.is_empty() {
        metadata.insert(
            "relatedConversationIds".to_string(),
            Value::Array(related_ids.into_iter().map(Value::String).collect()),
        );
    }

    if metadata.is_empty() {
        None
    } else {
        Some(Value::Object(metadata))
    }
}

/// Extract metrics metadata that should be attached to normalized messages.
fn extract_metrics_metadata(metrics_json: Option<&str>) -> Option<Value> {
    let metrics_json = metrics_json?;
    let Ok(metrics) = serde_json::from_str::<Value>(metrics_json) else {
        return None;
    };

    let mut metadata = Map::new();

    if let Some(session_start_time) = extract_json(
        &metrics,
        &[
            "session_start_time",
            "sessionStartTime",
            "start_time",
            "startTime",
            "started_at",
            "startedAt",
        ],
    ) {
        metadata.insert(
            "sessionStartTime".to_string(),
            normalize_timestamp_value(&session_start_time).unwrap_or(session_start_time),
        );
    }

    if let Some(file_operations) = extract_json(&metrics, &["file_operations", "fileOperations"]) {
        metadata.insert("fileOperations".to_string(), file_operations);
    }
    if let Some(files_accessed) = extract_json(&metrics, &["files_accessed", "filesAccessed"]) {
        metadata.insert("filesAccessed".to_string(), files_accessed);
    }
    if let Some(files_changed) = extract_json(&metrics, &["files_changed", "filesChanged"]) {
        if !metadata.contains_key("fileOperations") {
            if let Some(count) = files_changed.as_object().map(|object| object.len() as u64) {
                metadata.insert("fileOperations".to_string(), Value::from(count));
            }
        }
        if !metadata.contains_key("filesAccessed") {
            if let Some(paths) = files_changed.as_object().map(|object| {
                object
                    .keys()
                    .cloned()
                    .map(Value::String)
                    .collect::<Vec<_>>()
            }) {
                metadata.insert("filesAccessed".to_string(), Value::Array(paths));
            }
        }
    }

    let related_ids = extract_related_conversation_ids(&metrics);
    if !related_ids.is_empty() {
        metadata.insert(
            "relatedConversationIds".to_string(),
            Value::Array(related_ids.into_iter().map(Value::String).collect()),
        );
    }

    if metadata.is_empty() {
        None
    } else {
        Some(Value::Object(metadata))
    }
}

/// Attach provider-specific metadata to a normalized message.
fn attach_message_metadata(message: &mut ClaudeMessage, key: &str, value: Value) {
    if let Some(Value::Object(object)) = &mut message.data {
        object.insert(key.to_string(), value);
    } else {
        let mut object = Map::new();
        object.insert(key.to_string(), value);
        message.data = Some(Value::Object(object));
    }
}

/// Extract related `ForgeCode` conversation ids from metadata.
fn extract_related_conversation_ids(value: &Value) -> Vec<String> {
    let mut ids = BTreeSet::new();

    for key in [
        "related_conversation_ids",
        "relatedConversationIds",
        "related_conversations",
        "relatedConversations",
        "related_conversation_id",
        "relatedConversationId",
    ] {
        if let Some(raw) = value.get(key) {
            collect_related_conversation_ids(raw, &mut ids);
        }
    }

    ids.into_iter().collect()
}

/// Collect related `ForgeCode` conversation ids from nested values.
fn collect_related_conversation_ids(value: &Value, ids: &mut BTreeSet<String>) {
    match value {
        Value::String(id) if !id.trim().is_empty() => {
            ids.insert(id.clone());
        }
        Value::Number(number) => {
            ids.insert(number.to_string());
        }
        Value::Array(items) => {
            for item in items {
                collect_related_conversation_ids(item, ids);
            }
        }
        Value::Object(object) => {
            for key in ["id", "conversation_id", "conversationId"] {
                if let Some(inner) = object.get(key) {
                    collect_related_conversation_ids(inner, ids);
                }
            }
        }
        _ => {}
    }
}

/// Extract a string-like text value from JSON content.
fn extract_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Object(object) => {
            if let Some(text) = object.get("text").and_then(Value::as_str) {
                return Some(text.to_string());
            }
            if let Some(content) = object.get("content") {
                match content {
                    Value::String(text) => Some(text.clone()),
                    Value::Array(items) => items.iter().find_map(|item| {
                        item.get("text")
                            .and_then(Value::as_str)
                            .map(ToString::to_string)
                    }),
                    _ => None,
                }
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Extract a string value from a JSON object key.
fn extract_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value.get(key).and_then(|inner| match inner {
            Value::String(text) => Some(text.clone()),
            Value::Number(number) => Some(number.to_string()),
            _ => None,
        })
    })
}

/// Clone a JSON value from a JSON object key.
fn extract_json(value: &Value, keys: &[&str]) -> Option<Value> {
    keys.iter().find_map(|key| value.get(key).cloned())
}

/// Extract a u32 value from a JSON object key.
fn extract_u32(value: &Value, keys: &[&str]) -> Option<u32> {
    keys.iter()
        .filter_map(|key| value.get(key))
        .find_map(value_to_u32)
}

/// Convert a JSON value into a u32 when possible.
fn value_to_u32(value: &Value) -> Option<u32> {
    match value {
        Value::Number(number) => number.as_u64().and_then(|v| u32::try_from(v).ok()),
        Value::String(text) => text.parse::<u32>().ok(),
        Value::Object(object) => object
            .get("actual")
            .or_else(|| object.get("value"))
            .or_else(|| object.get("count"))
            .and_then(value_to_u32),
        _ => None,
    }
}

/// Extract an f64 value from a JSON object key.
fn extract_f64(value: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter()
        .filter_map(|key| value.get(key))
        .find_map(value_to_f64)
}

/// Convert a JSON value into an f64 when possible.
fn value_to_f64(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.parse::<f64>().ok(),
        Value::Object(object) => object
            .get("actual")
            .or_else(|| object.get("value"))
            .or_else(|| object.get("amount"))
            .and_then(value_to_f64),
        _ => None,
    }
}

/// Extract a bool value from a JSON object key.
fn extract_bool(value: &Value, keys: &[&str]) -> bool {
    keys.iter().any(|key| {
        value.get(key).is_some_and(|inner| match inner {
            Value::Bool(boolean) => *boolean,
            Value::String(text) => matches!(text.as_str(), "true" | "error" | "failed"),
            _ => false,
        })
    })
}

/// Resolve the preferred `ForgeCode` workspace display name from aggregated rows.
fn resolve_workspace_display_name_from_rows(
    workspace_id: &str,
    rows: &[ConversationRow],
) -> String {
    let mut display_name_votes: BTreeMap<String, usize> = BTreeMap::new();

    for row in rows {
        if let Some(display_name) =
            extract_workspace_display_name_from_context_json(&row.context_json)
        {
            *display_name_votes.entry(display_name).or_default() += 1;
        }
    }

    choose_workspace_display_name(workspace_id, &display_name_votes)
}

/// Choose the best workspace display name from vote counts.
fn choose_workspace_display_name(
    workspace_id: &str,
    display_name_votes: &BTreeMap<String, usize>,
) -> String {
    display_name_votes
        .iter()
        .max_by(|(left_name, left_votes), (right_name, right_votes)| {
            left_votes
                .cmp(right_votes)
                .then_with(|| right_name.len().cmp(&left_name.len()))
                .then_with(|| left_name.cmp(right_name))
        })
        .map(|(display_name, _)| display_name.clone())
        .unwrap_or_else(|| project_display_name(workspace_id))
}

/// Extract a workspace display name from `ForgeCode` context JSON.
fn extract_workspace_display_name_from_context_json(context_json: &str) -> Option<String> {
    let parsed = serde_json::from_str::<Value>(context_json).ok()?;
    extract_workspace_display_name_from_value(&parsed)
}

/// Extract a workspace display name from a JSON value.
fn extract_workspace_display_name_from_value(value: &Value) -> Option<String> {
    let home_dir = dirs::home_dir();
    let home_dir = home_dir.as_deref();
    let mut cwd_votes: BTreeMap<String, usize> = BTreeMap::new();
    collect_workspace_display_name_votes(value, home_dir, &mut cwd_votes);

    cwd_votes
        .into_iter()
        .max_by(|(left_name, left_votes), (right_name, right_votes)| {
            left_votes
                .cmp(right_votes)
                .then_with(|| right_name.len().cmp(&left_name.len()))
                .then_with(|| left_name.cmp(right_name))
        })
        .map(|(display_name, _)| display_name)
}

/// Collect workspace display-name votes from conversation rows.
fn collect_workspace_display_name_votes(
    value: &Value,
    home_dir: Option<&Path>,
    cwd_votes: &mut BTreeMap<String, usize>,
) {
    match value {
        Value::Object(map) => {
            if let Some(display_name) = map
                .get("cwd")
                .and_then(Value::as_str)
                .and_then(|cwd| display_name_from_cwd(cwd, home_dir))
            {
                *cwd_votes.entry(display_name).or_default() += 1;
            }

            for nested in map.values() {
                collect_workspace_display_name_votes(nested, home_dir, cwd_votes);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_workspace_display_name_votes(item, home_dir, cwd_votes);
            }
        }
        _ => {}
    }
}

/// Derive a workspace display name from a cwd path.
fn display_name_from_cwd(cwd: &str, home_dir: Option<&Path>) -> Option<String> {
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return None;
    }

    let cwd_path = Path::new(trimmed);
    if home_dir.is_some_and(|home| cwd_path == home) {
        return None;
    }

    cwd_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(ToString::to_string)
}

/// Extract cwd values from `ForgeCode` context JSON.
fn extract_cwds_from_context_json(context_json: &str) -> BTreeMap<String, usize> {
    let mut cwd_votes = BTreeMap::new();
    if let Ok(parsed) = serde_json::from_str::<Value>(context_json) {
        collect_cwd_votes(&parsed, &mut cwd_votes);
    }
    cwd_votes
}

/// Collect cwd vote counts from `ForgeCode` conversation rows.
fn collect_cwd_votes(value: &Value, cwd_votes: &mut BTreeMap<String, usize>) {
    match value {
        Value::Object(map) => {
            if let Some(cwd) = map.get("cwd").and_then(Value::as_str) {
                let trimmed = cwd.trim();
                if !trimmed.is_empty() {
                    *cwd_votes.entry(trimmed.to_string()).or_default() += 1;
                }
            }
            for nested in map.values() {
                collect_cwd_votes(nested, cwd_votes);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_cwd_votes(item, cwd_votes);
            }
        }
        _ => {}
    }
}

/// Picks the most-voted cwd, filtering out home directories.
fn choose_best_cwd(cwd_votes: &BTreeMap<String, usize>) -> Option<String> {
    let home_dir = dirs::home_dir();
    cwd_votes
        .iter()
        .filter(|(path, _)| {
            // Exclude bare home directories — they don't represent a real project
            let p = Path::new(path.as_str());
            !home_dir.as_deref().is_some_and(|home| p == home)
        })
        .max_by(|(left_path, left_votes), (right_path, right_votes)| {
            left_votes
                .cmp(right_votes)
                .then_with(|| right_path.len().cmp(&left_path.len()))
                .then_with(|| left_path.cmp(right_path))
        })
        .map(|(path, _)| path.clone())
}

/// Build the `ForgeCode` project display name for a workspace.
fn project_display_name(workspace_id: &str) -> String {
    format!("Workspace {workspace_id}")
}

/// Build the virtual project path for a `ForgeCode` workspace.
fn project_virtual_path(workspace_id: &str) -> String {
    format!("forgecode://workspace/{workspace_id}")
}

/// Build the virtual session path for a `ForgeCode` conversation.
fn session_virtual_path(workspace_id: &str, conversation_id: &str) -> String {
    format!("forgecode://workspace/{workspace_id}/conversation/{conversation_id}")
}

/// Build the virtual file path alias for a `ForgeCode` conversation.
fn session_file_virtual_path(workspace_id: &str, conversation_id: &str) -> String {
    format!("forgecode-db://workspace/{workspace_id}/conversation/{conversation_id}")
}

/// Build a stable message UUID for a `ForgeCode` conversation entry.
fn message_uuid(workspace_id: &str, conversation_id: &str, index: usize) -> String {
    format!("forgecode://workspace/{workspace_id}/conversation/{conversation_id}/message/{index}")
}

/// Parse a `ForgeCode` virtual project path into a workspace id.
fn parse_workspace_project_path(project_path: &str) -> Option<String> {
    let workspace_id = project_path
        .strip_prefix("forgecode://workspace/")
        .unwrap_or(project_path);

    if is_valid_virtual_component(workspace_id) {
        Some(workspace_id.to_string())
    } else {
        None
    }
}

/// Parse a `ForgeCode` virtual conversation path.
fn parse_conversation_path(session_path: &str) -> Option<(String, String)> {
    let raw_path = session_path
        .strip_prefix("forgecode-db://workspace/")
        .or_else(|| session_path.strip_prefix("forgecode://workspace/"))
        .unwrap_or(session_path);
    let (workspace_id, conversation_id) = raw_path.split_once("/conversation/")?;

    if !is_valid_virtual_component(workspace_id) || !is_valid_virtual_component(conversation_id) {
        return None;
    }

    Some((workspace_id.to_string(), conversation_id.to_string()))
}

/// Validate a single `ForgeCode` virtual path component.
fn is_valid_virtual_component(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && !value.contains('/')
        && !value.contains('\\')
}

/// Quote an `SQLite` identifier for generated `ForgeCode` queries.
fn quote_ident(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

/// Build a text-cast SQL expression for a required column.
fn cast_text_expr(identifier: &str) -> String {
    format!("COALESCE(CAST({} AS TEXT), '')", quote_ident(identifier))
}

/// Build a text-cast SQL expression for an optional column.
fn optional_cast_text_expr(identifier: Option<&str>) -> String {
    identifier.map_or_else(|| "''".to_string(), cast_text_expr)
}

/// Build an ORDER BY expression for an optional timestamp column.
fn optional_order_expr(identifier: Option<&str>) -> String {
    identifier
        .map(quote_ident)
        .unwrap_or_else(|| "rowid".to_string())
}

/// Convert blank strings into None.
fn empty_to_none(value: String) -> Option<String> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

/// Return the newer of two timestamp strings.
fn latest_timestamp(created_at: &str, updated_at: &str) -> String {
    let updated = normalize_timestamp_text(updated_at);
    if updated.is_empty() {
        normalize_timestamp_text(created_at)
    } else {
        updated
    }
}

/// Return the latest timestamp from a set of candidates.
fn max_timestamp(current: &str, candidate: &str) -> String {
    if current.is_empty() {
        return candidate.to_string();
    }
    if candidate.is_empty() {
        return current.to_string();
    }

    if compare_timestamps(candidate, current).is_gt() {
        candidate.to_string()
    } else {
        current.to_string()
    }
}

/// Compare two timestamps after normalizing their formats.
fn compare_timestamps(left: &str, right: &str) -> std::cmp::Ordering {
    match (timestamp_sort_key(left), timestamp_sort_key(right)) {
        (Some(left_ts), Some(right_ts)) => left_ts.cmp(&right_ts),
        (Some(_), None) => std::cmp::Ordering::Greater,
        (None, Some(_)) => std::cmp::Ordering::Less,
        (None, None) => left.cmp(right),
    }
}

/// Build a sortable key for timestamp comparisons.
fn timestamp_sort_key(value: &str) -> Option<i64> {
    let normalized = normalize_timestamp_text(value);
    if normalized.is_empty() {
        return None;
    }

    DateTime::parse_from_rfc3339(&normalized)
        .ok()
        .map(|timestamp| timestamp.timestamp_millis())
}

/// Normalize a timestamp string into RFC3339 form when possible.
fn normalize_timestamp_text(value: &str) -> String {
    normalize_timestamp_value(&Value::String(value.to_string()))
        .and_then(|normalized| normalized.as_str().map(ToString::to_string))
        .unwrap_or_default()
}

/// Normalize a timestamp JSON value into text.
fn normalize_timestamp_value(value: &Value) -> Option<Value> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return None;
            }

            if let Ok(raw_number) = trimmed.parse::<i64>() {
                return normalize_timestamp_number(raw_number).map(Value::String);
            }

            if let Ok(timestamp) = DateTime::parse_from_rfc3339(trimmed) {
                return Some(Value::String(timestamp.with_timezone(&Utc).to_rfc3339()));
            }

            if let Ok(timestamp) = NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%d %H:%M:%S%.f") {
                return Some(Value::String(
                    timestamp
                        .and_utc()
                        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
                ));
            }

            if let Ok(timestamp) = NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M:%S%.f") {
                return Some(Value::String(
                    timestamp
                        .and_utc()
                        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
                ));
            }

            Some(Value::String(trimmed.to_string()))
        }
        Value::Number(number) => number
            .as_i64()
            .and_then(normalize_timestamp_number)
            .map(Value::String),
        _ => None,
    }
}

/// Normalize a numeric timestamp into RFC3339 text.
fn normalize_timestamp_number(value: i64) -> Option<String> {
    let millis = if value.abs() >= 10_000_000_000 {
        value
    } else {
        value.saturating_mul(1000)
    };

    DateTime::from_timestamp_millis(millis).map(|timestamp| timestamp.to_rfc3339())
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;
    use rusqlite::params;
    use tempfile::TempDir;

    /// Create a temporary `ForgeCode` test database.
    fn create_test_db(tmp: &TempDir) -> Connection {
        let db_path = tmp.path().join(".forge.db");
        let conn = Connection::open(db_path).expect("create forgecode test db");
        conn.execute_batch(
            "CREATE TABLE conversations (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                title TEXT,
                context TEXT,
                metrics TEXT,
                created_at TEXT,
                updated_at TEXT
            );",
        )
        .expect("create conversations table");
        conn
    }

    /// Seed the temporary `ForgeCode` test database with fixture rows.
    fn seed_test_data(conn: &Connection) {
        conn.execute(
            "INSERT INTO conversations (id, workspace_id, title, context, metrics, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                "conv-001",
                "workspace-alpha",
                "Text and tool session",
                serde_json::to_string(&json!({
                    "conversation_id": "conv-001",
                    "cwd": "/Users/christian/projects/banana-prompting-service",
                    "messages": [
                        {
                            "Text": {
                                "role": "user",
                                "content": "Inspect src/main.rs",
                                "timestamp": "2026-01-10T08:00:00Z"
                            }
                        },
                        {
                            "message": {
                                "text": {
                                    "role": "User",
                                    "content": "Check the current parser output"
                                }
                            },
                            "timestamp": "2026-01-10T08:00:03Z"
                        },
                        {
                            "message": {
                                "text": {
                                    "role": "Assistant",
                                    "content": "",
                                    "tool_calls": [
                                        {
                                            "name": "Read",
                                            "call_id": "tool-123",
                                            "arguments": { "file_path": "/tmp/src/main.rs" }
                                        }
                                    ],
                                    "model": "forge-model-v1"
                                }
                            },
                            "usage": {
                                "prompt_tokens": { "actual": 120 },
                                "completion_tokens": { "actual": 45 },
                                "cached_tokens": { "actual": 30 },
                                "cost": 0.125
                            }
                        },
                        {
                            "message": {
                                "tool": {
                                    "name": "Read",
                                    "call_id": "tool-123",
                                    "output": { "content": "fn main() {}", "is_error": false }
                                }
                            },
                            "timestamp": "2026-01-10T08:00:06Z"
                        },
                        {
                            "Text": {
                                "role": "assistant",
                                "content": [
                                    { "type": "text", "text": "Done" },
                                    { "type": "tool_use", "id": "tool-456", "name": "Write", "input": { "file_path": "/tmp/out.rs" } }
                                ],
                                "model": "forge-model-v1",
                                "usage": {
                                    "prompt_tokens": 120,
                                    "completion_tokens": 45,
                                    "cached_tokens": 30,
                                    "cost": 0.125
                                },
                                "related_conversation_ids": ["conv-009"],
                                "timestamp": "2026-01-10T08:00:10Z"
                            }
                        }
                    ]
                }))
                .unwrap(),
                serde_json::to_string(&json!({
                    "session_start_time": "2026-01-10T08:00:00Z",
                    "file_operations": 2,
                    "files_accessed": ["/tmp/src/main.rs", "/tmp/out.rs"],
                    "relatedConversationIds": ["conv-002", "conv-003"]
                }))
                .unwrap(),
                "2026-01-10T08:00:00Z",
                "2026-01-10T08:00:10Z"
            ],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO conversations (id, workspace_id, title, context, metrics, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                "conv-002",
                "workspace-beta",
                "Image session",
                serde_json::to_string(&json!([
                    {
                        "cwd": "/Users/christian/projects/forge-image-lab",
                        "Image": {
                            "role": "user",
                            "source": { "mime_type": "image/png", "path": "/tmp/screenshot.png" },
                            "timestamp": "2026-01-11T09:15:00Z"
                        }
                    }
                ]))
                .unwrap(),
                Value::Null.to_string(),
                "2026-01-11T09:15:00Z",
                "2026-01-11T09:15:00Z"
            ],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO conversations (id, workspace_id, title, context, metrics, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                "conv-null",
                "workspace-alpha",
                "Ignored null context",
                Option::<String>::None,
                Option::<String>::None,
                "2026-01-09T08:00:00Z",
                "2026-01-09T08:00:00Z"
            ],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO conversations (id, workspace_id, title, context, metrics, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                "conv-bad",
                "workspace-alpha",
                "Malformed context",
                "{not-json}",
                Option::<String>::None,
                "2026-01-12T10:00:00Z",
                "2026-01-12T10:05:00Z"
            ],
        )
        .unwrap();
    }

    #[test]
    /// Extract usage derives consumed input from prompt and cached tokens.
    fn extract_usage_derives_consumed_input_from_prompt_and_cached_tokens() {
        let usage = extract_usage(&json!({
            "usage": {
                "prompt_tokens": { "actual": 120 },
                "completion_tokens": { "actual": 45 },
                "cached_tokens": { "actual": 30 },
                "cost": 0.125
            }
        }))
        .expect("usage should be extracted");

        assert_eq!(usage.input_tokens, Some(90));
        assert_eq!(usage.output_tokens, Some(45));
        assert_eq!(usage.cache_read_input_tokens, Some(30));
        assert_eq!(usage.cache_creation_input_tokens, None);
    }

    #[test]
    /// Extract usage preserves explicit input tokens.
    fn extract_usage_preserves_explicit_input_tokens() {
        let usage = extract_usage(&json!({
            "usage": {
                "input_tokens": 120,
                "output_tokens": 45,
                "cache_read_input_tokens": 30,
                "cache_creation_input_tokens": 10
            }
        }))
        .expect("usage should be extracted");

        assert_eq!(usage.input_tokens, Some(120));
        assert_eq!(usage.output_tokens, Some(45));
        assert_eq!(usage.cache_read_input_tokens, Some(30));
        assert_eq!(usage.cache_creation_input_tokens, Some(10));
    }

    #[test]
    /// Verify `SQLite` scan projects groups rows by workspace.
    fn sqlite_scan_projects_groups_rows_by_workspace() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = create_test_db(&tmp);
        seed_test_data(&conn);
        drop(conn);

        let projects = scan_projects_from_db(&tmp.path().to_string_lossy()).unwrap();
        assert_eq!(projects.len(), 2);
        assert_eq!(projects[0].name, "banana-prompting-service");
        assert_eq!(projects[0].path, "forgecode://workspace/workspace-alpha");
        assert_eq!(
            projects[0].actual_path,
            "/Users/christian/projects/banana-prompting-service"
        );
        assert_eq!(projects[0].session_count, 2);
        assert_eq!(projects[0].message_count, 5);
        assert_eq!(projects[0].storage_type, Some("sqlite".to_string()));
        assert_eq!(projects[1].name, "forge-image-lab");
        assert_eq!(projects[1].path, "forgecode://workspace/workspace-beta");
        assert_eq!(
            projects[1].actual_path,
            "/Users/christian/projects/forge-image-lab"
        );
        assert_eq!(projects[1].session_count, 1);
        assert_eq!(projects[1].message_count, 1);
    }

    #[test]
    /// Verify `SQLite` load sessions filters null context and preserves virtual ids.
    fn sqlite_load_sessions_filters_null_context_and_preserves_virtual_ids() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = create_test_db(&tmp);
        seed_test_data(&conn);
        drop(conn);

        let sessions =
            load_sessions_from_db(&tmp.path().to_string_lossy(), "workspace-alpha").unwrap();
        assert_eq!(sessions.len(), 2);
        assert_eq!(
            sessions[0].session_id,
            "forgecode://workspace/workspace-alpha/conversation/conv-bad"
        );
        assert_eq!(
            sessions[0].file_path,
            "forgecode-db://workspace/workspace-alpha/conversation/conv-bad"
        );
        assert_eq!(sessions[0].message_count, 0);
        assert_eq!(sessions[0].project_name, "banana-prompting-service");
        assert!(!sessions[0].has_tool_use);

        assert_eq!(sessions[1].actual_session_id, "conv-001");
        assert_eq!(sessions[1].project_name, "banana-prompting-service");
        assert_eq!(sessions[1].message_count, 5);
        assert!(sessions[1].has_tool_use);
        assert_eq!(
            sessions[1].summary,
            Some("Text and tool session".to_string())
        );
        assert_eq!(sessions[1].storage_type, Some("sqlite".to_string()));
    }

    #[test]
    /// Verify `SQLite` load messages maps text tool usage cost and metrics.
    fn sqlite_load_messages_maps_text_tool_usage_cost_and_metrics() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = create_test_db(&tmp);
        seed_test_data(&conn);
        drop(conn);

        let messages =
            load_messages_from_db(&tmp.path().to_string_lossy(), "workspace-alpha", "conv-001")
                .unwrap();

        assert_eq!(messages.len(), 5);
        assert_eq!(messages[0].message_type, "user");
        assert_eq!(
            messages[0].content,
            Some(Value::String("Inspect src/main.rs".to_string()))
        );

        assert_eq!(messages[1].message_type, "user");
        assert_eq!(
            messages[1].content,
            Some(Value::String("Check the current parser output".to_string()))
        );

        assert_eq!(messages[2].message_type, "assistant");
        assert!(messages[2].tool_use.is_some());
        assert_eq!(
            messages[2]
                .tool_use
                .as_ref()
                .and_then(|tool| tool.get("name"))
                .and_then(Value::as_str),
            Some("Read")
        );

        assert_eq!(messages[3].message_type, "user");
        assert!(messages[3].tool_use_result.is_some());

        assert_eq!(messages[4].message_type, "assistant");
        assert_eq!(messages[4].model, Some("forge-model-v1".to_string()));
        assert_eq!(messages[4].cost_usd, Some(0.125));
        assert_eq!(
            messages[2].usage.as_ref().and_then(|u| u.input_tokens),
            Some(90)
        );
        assert_eq!(
            messages[2].usage.as_ref().and_then(|u| u.output_tokens),
            Some(45)
        );
        assert_eq!(
            messages[2]
                .usage
                .as_ref()
                .and_then(|u| u.cache_read_input_tokens),
            Some(30)
        );
        assert_eq!(
            messages[4].usage.as_ref().and_then(|u| u.input_tokens),
            Some(90)
        );
        assert_eq!(
            messages[4].usage.as_ref().and_then(|u| u.output_tokens),
            Some(45)
        );
        assert_eq!(
            messages[4]
                .usage
                .as_ref()
                .and_then(|u| u.cache_read_input_tokens),
            Some(30)
        );
        assert!(messages[4].tool_use.is_some());
        assert_eq!(
            messages[4]
                .data
                .as_ref()
                .and_then(|data| data.get("forgecodeMetrics"))
                .and_then(|metrics| metrics.get("fileOperations"))
                .and_then(Value::as_i64),
            Some(2)
        );
        assert_eq!(
            messages[4]
                .data
                .as_ref()
                .and_then(|data| data.get("forgecodeMessageMetadata"))
                .and_then(|metadata| metadata.get("relatedConversationIds"))
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(1)
        );
    }

    #[test]
    /// Verify `SQLite` load messages returns empty for malformed context without panicking.
    fn sqlite_load_messages_returns_empty_for_malformed_context_without_panicking() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = create_test_db(&tmp);
        seed_test_data(&conn);
        drop(conn);

        let messages =
            load_messages_from_db(&tmp.path().to_string_lossy(), "workspace-alpha", "conv-bad")
                .unwrap();

        assert!(messages.is_empty());
    }

    #[test]
    /// Verify detection prefers forge config and checks artifacts.
    fn detection_prefers_forge_config_and_checks_artifacts() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join(".forge_history"), "history").unwrap();
        let original = std::env::var("FORGE_CONFIG").ok();
        std::env::set_var("FORGE_CONFIG", tmp.path());

        let detected = detect().unwrap();

        if let Some(original) = original {
            std::env::set_var("FORGE_CONFIG", original);
        } else {
            std::env::remove_var("FORGE_CONFIG");
        }

        assert_eq!(detected.id, "forgecode");
        assert_eq!(detected.display_name, "ForgeCode");
        assert_eq!(detected.base_path, tmp.path().to_string_lossy());
        assert!(detected.is_available);
    }

    #[test]
    /// Extract workspace display name prefers cwd basename and ignores home dir.
    fn extract_workspace_display_name_prefers_cwd_basename_and_ignores_home_dir() {
        let context = json!({
            "messages": [
                {
                    "message": {
                        "tool": {
                            "arguments": {
                                "cwd": dirs::home_dir().unwrap().to_string_lossy().to_string()
                            }
                        }
                    }
                },
                {
                    "message": {
                        "tool": {
                            "arguments": {
                                "cwd": "/Users/christian/projects/banana-prompting-service"
                            }
                        }
                    }
                }
            ]
        });

        assert_eq!(
            extract_workspace_display_name_from_value(&context),
            Some("banana-prompting-service".to_string())
        );
    }

    #[test]
    /// Verify `SQLite` search matches message content.
    fn sqlite_search_matches_message_content() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = create_test_db(&tmp);
        seed_test_data(&conn);
        drop(conn);

        let results = search_from_path(&tmp.path().to_string_lossy(), "parser", 10);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].provider.as_deref(), Some("forgecode"));
        assert_eq!(results[0].session_id, "conv-001");
        assert_eq!(
            results[0].uuid,
            "forgecode://workspace/workspace-alpha/conversation/conv-001/message/1"
        );
        assert_eq!(
            results[0].content,
            Some(Value::String("Check the current parser output".to_string()))
        );
        assert!(results.iter().all(|message| {
            message
                .content
                .as_ref()
                .is_some_and(|content| search_json_value_case_insensitive(content, "parser"))
        }));
    }

    #[test]
    /// Verify `SQLite` rename session title updates conversation title.
    fn sqlite_rename_session_title_updates_conversation_title() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = create_test_db(&tmp);
        seed_test_data(&conn);
        drop(conn);

        let result = rename_session_title_from_path(
            &tmp.path().to_string_lossy(),
            "forgecode://workspace/workspace-alpha/conversation/conv-001",
            "Updated Forge Title",
        )
        .unwrap();

        assert_eq!(result.previous_title, "Text and tool session");
        assert_eq!(result.new_title, "Updated Forge Title");

        let conn = open_db_read_write(&tmp.path().to_string_lossy()).unwrap();
        let title: String = conn
            .query_row(
                "SELECT title FROM conversations WHERE id = 'conv-001'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(title, "Updated Forge Title");
    }

    #[test]
    /// Verify `SQLite` delete conversation removes row.
    fn sqlite_delete_conversation_removes_row() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = create_test_db(&tmp);
        seed_test_data(&conn);
        drop(conn);

        delete_conversation_from_path(
            &tmp.path().to_string_lossy(),
            "forgecode-db://workspace/workspace-alpha/conversation/conv-001",
        )
        .unwrap();

        let conn = open_db_read_write(&tmp.path().to_string_lossy()).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM conversations WHERE id = 'conv-001'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    /// Parse conversation path accepts virtual session and file paths.
    fn parse_conversation_path_accepts_virtual_session_and_file_paths() {
        assert_eq!(
            parse_conversation_path("forgecode://workspace/ws-1/conversation/conv-1"),
            Some(("ws-1".to_string(), "conv-1".to_string()))
        );
        assert_eq!(
            parse_conversation_path("forgecode-db://workspace/ws-1/conversation/conv-1"),
            Some(("ws-1".to_string(), "conv-1".to_string()))
        );
    }
}
