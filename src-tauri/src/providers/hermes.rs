//! Hermes Agent provider (Nous Research, <https://github.com/NousResearch/hermes-agent>).
//!
//! Hermes keeps every CLI, desktop and gateway conversation in one SQLite
//! store, `state.db` (WAL), inside the Hermes root: `$HERMES_HOME` when set,
//! otherwise `%LOCALAPPDATA%\hermes` on Windows and `~/.hermes` elsewhere.
//! Each named profile is a separate root with its own store at
//! `<root>/profiles/<name>/state.db`; all of them are read.
//!
//! Relevant tables (see `website/docs/developer-guide/session-storage.md`
//! upstream):
//! - `sessions(id, source, model, started_at, ended_at, title, cwd,
//!   git_repo_root, input_tokens, output_tokens, cache_read_tokens,
//!   cache_write_tokens, reasoning_tokens, estimated_cost_usd,
//!   actual_cost_usd, ...)` — timestamps are Unix epoch seconds (REAL).
//! - `messages(id, session_id, role, content, tool_call_id, tool_calls,
//!   timestamp, token_count, finish_reason, reasoning, reasoning_content,
//!   reasoning_details, active, display_kind, ...)` — `OpenAI` chat format:
//!   `tool_calls` is a JSON list on assistant rows and results are
//!   `role = 'tool'` rows keyed by `tool_call_id`.
//!
//! Columns were added over many schema versions, so the reader probes
//! `PRAGMA table_info` and degrades when optional ones are missing. In-place
//! compaction archives the previous generation as `active = 0` and re-inserts
//! the retained context as `active = 1`; only live rows are read, and rows
//! Hermes itself never paints (`display_kind = 'hidden'`) are skipped.
//!
//! Projects group sessions by `cwd`, falling back to `git_repo_root`; gateway,
//! cron and other sessions without a workspace go to one bucket per `source`.
//! Session token totals and cost come from the `sessions` row and are
//! attached to the last assistant message (per-message `token_count` is used
//! only when a session has no totals), so a session is never counted twice.
//!
//! The store is opened read-only — Hermes may be running — and never written.
//! It is not registered with the file watcher or the `WebUI` session-path
//! allowlist: the Hermes root also holds credentials (`.env`, `auth.json`)
//! and browser profiles, so it must not become a readable or watched tree.

use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession, TokenUsage};
use crate::providers::ProviderInfo;
use crate::utils::{build_provider_message, ms_to_iso, search_json_value_case_insensitive};
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags, Row};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

const PROVIDER: &str = "hermes";
const DISPLAY_NAME: &str = "Hermes Agent";
const SCHEME: &str = "hermes://";
const HERMES_HOME_ENV: &str = "HERMES_HOME";
const DB_FILE: &str = "state.db";
const PROFILES_DIR: &str = "profiles";
/// Store key of the root (non-profile) database.
const DEFAULT_STORE: &str = "default";
/// Store key prefix of a named profile's database: `profile.<name>`.
const PROFILE_STORE_PREFIX: &str = "profile.";
/// Separates the store key from the project group in a project path.
const STORE_SEP: &str = "::";
/// Separates the project path from the session id in a session path.
const SESSION_SEP: char = '#';
const GROUP_DIR_PREFIX: &str = "dir:";
const GROUP_SOURCE_PREFIX: &str = "source:";
const SUMMARY_MAX_CHARS: usize = 80;

// ============================================================================
// Root and store discovery
// ============================================================================

/// The Hermes root: `$HERMES_HOME` (relative values resolve against the cwd,
/// matching `ZCODE_HOME`/`CODEX_HOME`) or the platform default.
fn hermes_root() -> Option<PathBuf> {
    if let Some(value) = std::env::var_os(HERMES_HOME_ENV).filter(|v| !v.is_empty()) {
        let path = PathBuf::from(value);
        return Some(if path.is_absolute() {
            path
        } else {
            std::env::current_dir().ok()?.join(path)
        });
    }
    default_root()
}

#[cfg(windows)]
fn default_root() -> Option<PathBuf> {
    Some(local_app_data()?.join("hermes"))
}

#[cfg(not(windows))]
fn default_root() -> Option<PathBuf> {
    Some(crate::utils::home_dir()?.join(".hermes"))
}

/// `%LOCALAPPDATA%` (the known folder, not the env var, which can be unset).
#[cfg(all(windows, not(test)))]
fn local_app_data() -> Option<PathBuf> {
    dirs::data_local_dir()
}

/// Under test the known-folder API would reach the developer's real profile,
/// so derive the default from the sandboxed home instead (#551).
#[cfg(all(windows, test))]
fn local_app_data() -> Option<PathBuf> {
    Some(crate::utils::home_dir()?.join("AppData").join("Local"))
}

/// One Hermes database: the root store or a named profile's.
#[derive(Debug, Clone)]
struct Store {
    /// `default` or `profile.<name>`; embedded in project/session paths.
    key: String,
    db: PathBuf,
}

/// A regular (non-symlink) file — symlinks could point outside the root.
fn is_regular_file(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_file())
}

fn is_regular_dir(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_dir())
}

/// Profile names become one path segment and part of a URI, so accept only
/// plain names (Hermes itself limits them to `[a-z0-9_-]`).
fn is_valid_profile_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Every store under the root that has a `state.db`: the root store first,
/// then profiles by name.
fn discover_stores() -> Vec<Store> {
    let Some(root) = hermes_root() else {
        return Vec::new();
    };
    let mut stores = Vec::new();
    if let Some(store) = resolve_store(&root, DEFAULT_STORE) {
        stores.push(store);
    }
    let profiles_dir = root.join(PROFILES_DIR);
    if is_regular_dir(&profiles_dir) {
        if let Ok(entries) = std::fs::read_dir(&profiles_dir) {
            let mut names: Vec<String> = entries
                .flatten()
                .filter_map(|e| e.file_name().to_str().map(str::to_string))
                .filter(|name| is_valid_profile_name(name))
                .collect();
            names.sort();
            for name in names {
                if let Some(store) = resolve_store(&root, &format!("{PROFILE_STORE_PREFIX}{name}"))
                {
                    stores.push(store);
                }
            }
        }
    }
    stores
}

/// Map a store key back to its database, rejecting anything that is not the
/// root store or a plain profile name (no traversal through the key).
fn resolve_store(root: &Path, key: &str) -> Option<Store> {
    let dir = if key == DEFAULT_STORE {
        root.to_path_buf()
    } else {
        let name = key.strip_prefix(PROFILE_STORE_PREFIX)?;
        if !is_valid_profile_name(name) {
            return None;
        }
        let profiles = root.join(PROFILES_DIR);
        if !is_regular_dir(&profiles) {
            return None;
        }
        profiles.join(name)
    };
    let db = dir.join(DB_FILE);
    (is_regular_dir(&dir) && is_regular_file(&db)).then(|| Store {
        key: key.to_string(),
        db,
    })
}

fn store_by_key(key: &str) -> Option<Store> {
    resolve_store(&hermes_root()?, key)
}

/// Open a store read-only; WAL readers coexist with a running Hermes writer.
fn open_db(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Failed to open Hermes state.db: {e}"))?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| format!("Failed to set Hermes db busy timeout: {e}"))?;
    Ok(conn)
}

/// Detect a Hermes Agent installation (any store with a `state.db`).
pub fn detect() -> Option<ProviderInfo> {
    let root = hermes_root()?;
    if discover_stores().is_empty() {
        return None;
    }
    Some(ProviderInfo {
        id: PROVIDER.to_string(),
        display_name: DISPLAY_NAME.to_string(),
        base_path: root.to_string_lossy().to_string(),
        is_available: true,
    })
}

/// The Hermes root directory, when it exists.
pub fn get_base_path() -> Option<String> {
    let root = hermes_root()?;
    is_regular_dir(&root).then(|| root.to_string_lossy().to_string())
}

// ============================================================================
// Project / session paths
// ============================================================================

/// How sessions are grouped into projects within one store.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Group {
    /// Workspace directory (`cwd`, else `git_repo_root`).
    Dir(String),
    /// No workspace recorded: one bucket per `sessions.source`.
    Source(String),
}

impl Group {
    fn from_row(dir: Option<String>, source: Option<String>) -> Self {
        match dir.map(|d| d.trim().to_string()).filter(|d| !d.is_empty()) {
            Some(dir) => Self::Dir(dir),
            None => Self::Source(
                source
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "unknown".to_string()),
            ),
        }
    }

    fn encode(&self) -> String {
        match self {
            Self::Dir(dir) => format!("{GROUP_DIR_PREFIX}{dir}"),
            Self::Source(source) => format!("{GROUP_SOURCE_PREFIX}{source}"),
        }
    }

    fn decode(raw: &str) -> Option<Self> {
        if let Some(dir) = raw.strip_prefix(GROUP_DIR_PREFIX) {
            return (!dir.is_empty()).then(|| Self::Dir(dir.to_string()));
        }
        raw.strip_prefix(GROUP_SOURCE_PREFIX)
            .filter(|s| !s.is_empty())
            .map(|s| Self::Source(s.to_string()))
    }
}

/// `hermes://<store>::dir:<path>` or `hermes://<store>::source:<source>`.
fn project_path(store: &str, group: &Group) -> String {
    format!("{SCHEME}{store}{STORE_SEP}{}", group.encode())
}

fn session_path(store: &str, group: &Group, session_id: &str) -> String {
    format!("{}{SESSION_SEP}{session_id}", project_path(store, group))
}

fn is_valid_store_key(key: &str) -> bool {
    key == DEFAULT_STORE
        || key
            .strip_prefix(PROFILE_STORE_PREFIX)
            .is_some_and(is_valid_profile_name)
}

/// Split a project path into its store key and group.
fn parse_project_path(path: &str) -> Result<(String, Group), String> {
    let rest = path
        .strip_prefix(SCHEME)
        .ok_or_else(|| format!("Invalid Hermes project path: {path}"))?;
    let (store, group) = rest
        .split_once(STORE_SEP)
        .ok_or_else(|| format!("Invalid Hermes project path: {path}"))?;
    if !is_valid_store_key(store) {
        return Err(format!("Invalid Hermes store in path: {path}"));
    }
    let group =
        Group::decode(group).ok_or_else(|| format!("Invalid Hermes project path: {path}"))?;
    Ok((store.to_string(), group))
}

#[derive(Debug)]
struct SessionRef {
    store: String,
    group: Group,
    session_id: String,
}

/// Split a session path (`<project path>#<session id>`).
fn parse_session_path(path: &str) -> Result<SessionRef, String> {
    let (project, session_id) = path
        .rsplit_once(SESSION_SEP)
        .filter(|(_, id)| !id.is_empty())
        .ok_or_else(|| format!("Invalid Hermes session path: {path}"))?;
    let (store, group) = parse_project_path(project)?;
    Ok(SessionRef {
        store,
        group,
        session_id: session_id.to_string(),
    })
}

/// Display name for a project: the folder name (or `Hermes (<source>)` for a
/// bucket), suffixed with the profile name for profile stores.
fn project_display_name(store: &str, group: &Group) -> String {
    let base = match group {
        Group::Dir(dir) => dir
            .trim_end_matches(['/', '\\'])
            .rsplit(['/', '\\'])
            .next()
            .filter(|n| !n.is_empty())
            .unwrap_or(dir)
            .to_string(),
        Group::Source(source) => format!("Hermes ({source})"),
    };
    match store.strip_prefix(PROFILE_STORE_PREFIX) {
        Some(profile) => format!("{base} ({profile})"),
        None => base,
    }
}

/// Display name for a Hermes project path (stats view); the provider name
/// for unparseable input.
pub fn project_name(project_path: &str) -> String {
    parse_project_path(project_path).map_or_else(
        |_| PROVIDER.to_string(),
        |(store, group)| project_display_name(&store, &group),
    )
}

/// Display name of the project a Hermes session path belongs to.
pub fn project_name_for_session(session_path: &str) -> String {
    parse_session_path(session_path).map_or_else(
        |_| PROVIDER.to_string(),
        |r| project_display_name(&r.store, &r.group),
    )
}

// ============================================================================
// Schema probing
// ============================================================================

/// Column sets of the two tables we read, for version-tolerant SQL.
struct Schema {
    sessions: HashSet<String>,
    messages: HashSet<String>,
}

impl Schema {
    fn probe(conn: &Connection) -> Result<Self, String> {
        let schema = Self {
            sessions: table_columns(conn, "sessions")?,
            messages: table_columns(conn, "messages")?,
        };
        for (table, cols, required) in [
            ("sessions", &schema.sessions, &["id", "started_at"][..]),
            (
                "messages",
                &schema.messages,
                &["session_id", "role", "timestamp"][..],
            ),
        ] {
            if let Some(missing) = required.iter().find(|c| !cols.contains(**c)) {
                return Err(format!(
                    "Hermes state.db has no usable `{table}` table (missing `{missing}`)"
                ));
            }
        }
        Ok(schema)
    }

    /// `s.<col>` when present, `NULL` otherwise.
    fn s(&self, col: &str) -> String {
        if self.sessions.contains(col) {
            format!("s.{col}")
        } else {
            "NULL".to_string()
        }
    }

    /// `m.<col>` when present, `NULL` otherwise.
    fn m(&self, col: &str) -> String {
        if self.messages.contains(col) {
            format!("m.{col}")
        } else {
            "NULL".to_string()
        }
    }

    /// The project directory of a session: `cwd`, else `git_repo_root`.
    fn group_dir_expr(&self) -> String {
        format!(
            "COALESCE(NULLIF(TRIM({}), ''), NULLIF(TRIM({}), ''))",
            self.s("cwd"),
            self.s("git_repo_root")
        )
    }

    /// Row filter for messages the viewer shows (alias `m`): live rows only
    /// (`active` NULL predates the backfill and counts as live) and no
    /// model-only scaffolding.
    fn visible(&self) -> String {
        let mut clause = String::new();
        if self.messages.contains("active") {
            clause.push_str(" AND COALESCE(m.active, 1) = 1");
        }
        if self.messages.contains("display_kind") {
            clause.push_str(" AND COALESCE(m.display_kind, '') <> 'hidden'");
        }
        clause
    }
}

fn table_columns(conn: &Connection, table: &str) -> Result<HashSet<String>, String> {
    let mut stmt = conn
        .prepare("SELECT name FROM pragma_table_info(?1)")
        .map_err(|e| e.to_string())?;
    let columns = stmt
        .query_map([table], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<HashSet<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(columns)
}

// ============================================================================
// Loose column readers (SQLite is dynamically typed)
// ============================================================================

fn col_text(row: &Row<'_>, idx: usize) -> Option<String> {
    match row.get_ref(idx).ok()? {
        ValueRef::Text(bytes) | ValueRef::Blob(bytes) => {
            Some(String::from_utf8_lossy(bytes).into_owned())
        }
        ValueRef::Integer(i) => Some(i.to_string()),
        ValueRef::Real(f) => Some(f.to_string()),
        ValueRef::Null => None,
    }
}

fn col_f64(row: &Row<'_>, idx: usize) -> Option<f64> {
    match row.get_ref(idx).ok()? {
        ValueRef::Real(f) => Some(f),
        #[allow(clippy::cast_precision_loss)]
        ValueRef::Integer(i) => Some(i as f64),
        ValueRef::Text(bytes) => std::str::from_utf8(bytes).ok()?.trim().parse().ok(),
        _ => None,
    }
    .filter(|f| f.is_finite())
}

fn col_i64(row: &Row<'_>, idx: usize) -> Option<i64> {
    match row.get_ref(idx).ok()? {
        ValueRef::Integer(i) => Some(i),
        #[allow(clippy::cast_possible_truncation)]
        ValueRef::Real(f) if f.is_finite() => Some(f as i64),
        ValueRef::Text(bytes) => std::str::from_utf8(bytes).ok()?.trim().parse().ok(),
        _ => None,
    }
}

/// Unix epoch seconds (REAL) to the viewer's ISO-8601 form.
fn secs_to_iso(secs: f64) -> String {
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let ms = (secs.max(0.0) * 1000.0).round() as u64;
    ms_to_iso(ms)
}

fn non_empty(text: Option<String>) -> Option<String> {
    text.filter(|t| !t.trim().is_empty())
}

fn clamp_u32(value: i64) -> u32 {
    u32::try_from(value.max(0)).unwrap_or(u32::MAX)
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

// ============================================================================
// Projects
// ============================================================================

/// One listed session's aggregates (only sessions with visible messages).
struct SessionSummaryRow {
    id: String,
    group: Group,
    title: Option<String>,
    first_user: Option<String>,
    started_at: f64,
    last_at: f64,
    message_count: usize,
    has_tool_use: bool,
}

/// Per-session rows for one store, optionally narrowed to one group.
fn session_rows(
    conn: &Connection,
    schema: &Schema,
    group: Option<&Group>,
) -> Result<Vec<SessionSummaryRow>, String> {
    let vis = schema.visible();
    let dir = schema.group_dir_expr();
    let tool_calls = schema.m("tool_calls");
    let (filter, param) = match group {
        None => (String::new(), None),
        Some(Group::Dir(d)) => (format!("WHERE {dir} = ?1"), Some(d.clone())),
        Some(Group::Source(s)) => (
            format!(
                "WHERE {dir} IS NULL AND COALESCE(NULLIF(TRIM({}), ''), 'unknown') = ?1",
                schema.s("source")
            ),
            Some(s.clone()),
        ),
    };
    let sql = format!(
        "SELECT * FROM ( \
            SELECT s.id, {dir} AS dir, {source} AS source, {title} AS title, \
                   s.started_at, {ended} AS ended_at, \
                   (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id{vis}) AS cnt, \
                   (SELECT MAX(m.timestamp) FROM messages m WHERE m.session_id = s.id{vis}) AS last_ts, \
                   EXISTS(SELECT 1 FROM messages m WHERE m.session_id = s.id{vis} \
                          AND (m.role = 'tool' OR COALESCE({tool_calls}, '') NOT IN ('', '[]'))) AS has_tool, \
                   (SELECT {content} FROM messages m WHERE m.session_id = s.id{vis} \
                          AND m.role = 'user' AND COALESCE(TRIM({content}), '') <> '' \
                          ORDER BY m.timestamp, m.rowid LIMIT 1) AS first_user \
            FROM sessions s {filter} \
         ) WHERE cnt > 0",
        content = schema.m("content"),
        source = schema.s("source"),
        title = schema.s("title"),
        ended = schema.s("ended_at"),
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let map_row = |row: &Row<'_>| {
        let started_at = col_f64(row, 4).unwrap_or(0.0);
        let last_at = col_f64(row, 7)
            .or_else(|| col_f64(row, 5))
            .unwrap_or(started_at);
        Ok(SessionSummaryRow {
            id: col_text(row, 0).unwrap_or_default(),
            group: Group::from_row(col_text(row, 1), col_text(row, 2)),
            title: non_empty(col_text(row, 3)),
            started_at,
            last_at: last_at.max(started_at),
            message_count: usize::try_from(col_i64(row, 6).unwrap_or(0)).unwrap_or(0),
            has_tool_use: col_i64(row, 8).unwrap_or(0) != 0,
            first_user: non_empty(col_text(row, 9)),
        })
    };
    let rows = match param {
        Some(p) => stmt.query_map([p], map_row),
        None => stmt.query_map([], map_row),
    }
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().filter(|r| !r.id.is_empty()).collect())
}

/// Scan every store's projects. One unreadable store (e.g. a profile on an
/// older, incompatible schema) is logged and skipped rather than hiding the
/// others.
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let mut projects = Vec::new();
    for store in discover_stores() {
        match scan_store(&store) {
            Ok(found) => projects.extend(found),
            Err(e) => log::warn!("Hermes store '{}' skipped: {e}", store.key),
        }
    }
    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

fn scan_store(store: &Store) -> Result<Vec<ClaudeProject>, String> {
    let conn = open_db(&store.db)?;
    let schema = Schema::probe(&conn)?;

    #[derive(Default)]
    struct Acc {
        sessions: usize,
        messages: usize,
        last: f64,
    }
    let mut groups: BTreeMap<Group, Acc> = BTreeMap::new();
    for row in session_rows(&conn, &schema, None)? {
        let acc = groups.entry(row.group).or_default();
        acc.sessions += 1;
        acc.messages += row.message_count;
        acc.last = acc.last.max(row.last_at);
    }

    Ok(groups
        .into_iter()
        .map(|(group, acc)| {
            let path = project_path(&store.key, &group);
            let actual_path = match &group {
                Group::Dir(dir) => dir.clone(),
                // No folder: the bucket's own URI keeps it distinct when the
                // tree merges projects by folder.
                Group::Source(_) => path.clone(),
            };
            ClaudeProject {
                name: project_display_name(&store.key, &group),
                path,
                actual_path,
                session_count: acc.sessions,
                message_count: acc.messages,
                last_modified: secs_to_iso(acc.last),
                git_info: None,
                provider: Some(PROVIDER.to_string()),
                storage_type: Some("sqlite".to_string()),
                custom_directory_label: None,
            }
        })
        .collect())
}

// ============================================================================
// Sessions
// ============================================================================

/// Load the sessions of one Hermes project, newest first.
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let (store_key, group) = parse_project_path(project_path)?;
    let Some(store) = store_by_key(&store_key) else {
        return Ok(Vec::new());
    };
    let conn = open_db(&store.db)?;
    let schema = Schema::probe(&conn)?;
    let project_name = project_display_name(&store.key, &group);

    let mut rows = session_rows(&conn, &schema, Some(&group))?;
    rows.sort_by(|a, b| b.last_at.total_cmp(&a.last_at));
    Ok(rows
        .into_iter()
        .map(|row| {
            let path = session_path(&store.key, &group, &row.id);
            let last = secs_to_iso(row.last_at);
            ClaudeSession {
                session_id: path.clone(),
                actual_session_id: row.id,
                file_path: path,
                project_name: project_name.clone(),
                message_count: row.message_count,
                first_message_time: secs_to_iso(row.started_at),
                last_message_time: last.clone(),
                last_modified: last,
                has_tool_use: row.has_tool_use,
                has_errors: false,
                summary: row.title.or(row.first_user).map(|t| summarize(&t)),
                is_renamed: false,
                provider: Some(PROVIDER.to_string()),
                storage_type: Some("sqlite".to_string()),
                entrypoint: None,
            }
        })
        .collect())
}

// ============================================================================
// Messages
// ============================================================================

/// Session-level metadata applied to its messages.
#[derive(Default)]
struct SessionMeta {
    model: Option<String>,
    totals: Option<TokenUsage>,
    cost_usd: Option<f64>,
}

fn load_session_meta(
    conn: &Connection,
    schema: &Schema,
    session_id: &str,
) -> Result<Option<SessionMeta>, String> {
    let sql = format!(
        "SELECT {}, {}, {}, {}, {}, {}, {}, {} FROM sessions s WHERE s.id = ?1",
        schema.s("model"),
        schema.s("input_tokens"),
        schema.s("output_tokens"),
        schema.s("cache_read_tokens"),
        schema.s("cache_write_tokens"),
        schema.s("reasoning_tokens"),
        schema.s("actual_cost_usd"),
        schema.s("estimated_cost_usd"),
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut rows = stmt.query([session_id]).map_err(|e| e.to_string())?;
    let Some(row) = rows.next().map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let count = |idx| col_i64(row, idx).filter(|n| *n > 0).map(clamp_u32);
    let (input, output, cache_read, cache_write, reasoning) =
        (count(1), count(2), count(3), count(4), count(5));
    let has_totals = [input, output, cache_read, cache_write, reasoning]
        .iter()
        .any(Option::is_some);
    Ok(Some(SessionMeta {
        model: non_empty(col_text(row, 0)),
        // Hermes' `input_tokens` already excludes cache reads/writes
        // (prompt = input + cache_read + cache_write), matching the viewer.
        totals: has_totals.then(|| TokenUsage {
            input_tokens: Some(input.unwrap_or(0)),
            output_tokens: Some(output.unwrap_or(0)),
            cache_creation_input_tokens: cache_write,
            cache_read_input_tokens: cache_read,
            reasoning_tokens: reasoning,
            ..Default::default()
        }),
        cost_usd: col_f64(row, 6).or_else(|| col_f64(row, 7)),
    }))
}

/// One `messages` row, as read.
struct MessageRow {
    id: i64,
    role: String,
    content: Option<String>,
    tool_call_id: Option<String>,
    tool_calls: Option<String>,
    timestamp: f64,
    token_count: Option<i64>,
    finish_reason: Option<String>,
    reasoning: Option<String>,
    reasoning_content: Option<String>,
    reasoning_details: Option<String>,
}

fn message_rows(
    conn: &Connection,
    schema: &Schema,
    session_id: &str,
) -> Result<Vec<MessageRow>, String> {
    let sql = format!(
        "SELECT m.rowid, m.role, {content}, {tool_call_id}, {tool_calls}, m.timestamp, \
                {token_count}, {finish_reason}, {reasoning}, {reasoning_content}, \
                {reasoning_details} \
         FROM messages m WHERE m.session_id = ?1{vis} ORDER BY m.timestamp, m.rowid",
        content = schema.m("content"),
        tool_call_id = schema.m("tool_call_id"),
        tool_calls = schema.m("tool_calls"),
        token_count = schema.m("token_count"),
        finish_reason = schema.m("finish_reason"),
        reasoning = schema.m("reasoning"),
        reasoning_content = schema.m("reasoning_content"),
        reasoning_details = schema.m("reasoning_details"),
        vis = schema.visible(),
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([session_id], |row| {
            Ok(MessageRow {
                id: col_i64(row, 0).unwrap_or(0),
                role: col_text(row, 1).unwrap_or_default(),
                content: col_text(row, 2),
                tool_call_id: col_text(row, 3),
                tool_calls: col_text(row, 4),
                timestamp: col_f64(row, 5).unwrap_or(0.0),
                token_count: col_i64(row, 6),
                finish_reason: col_text(row, 7),
                reasoning: col_text(row, 8),
                reasoning_content: col_text(row, 9),
                reasoning_details: col_text(row, 10),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Load all visible messages of one Hermes session.
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let session = parse_session_path(session_path)?;
    let store = store_by_key(&session.store)
        .ok_or_else(|| format!("Hermes store not found for {session_path}"))?;
    let conn = open_db(&store.db)?;
    let schema = Schema::probe(&conn)?;
    load_messages_conn(&conn, &schema, &session.session_id)
}

fn load_messages_conn(
    conn: &Connection,
    schema: &Schema,
    session_id: &str,
) -> Result<Vec<ClaudeMessage>, String> {
    let meta = load_session_meta(conn, schema, session_id)?.unwrap_or_default();
    let per_message_usage = meta.totals.is_none();
    let mut messages: Vec<ClaudeMessage> = message_rows(conn, schema, session_id)?
        .into_iter()
        .filter_map(|row| convert_row(&row, session_id, &meta, per_message_usage))
        .collect();

    if let Some(totals) = meta.totals {
        if let Some(last) = messages
            .iter_mut()
            .rev()
            .find(|m| m.message_type == "assistant")
        {
            last.usage = Some(totals);
            last.cost_usd = meta.cost_usd;
        }
    }
    Ok(messages)
}

/// Map one row to a viewer message; `None` for rows with nothing to show.
fn convert_row(
    row: &MessageRow,
    session_id: &str,
    meta: &SessionMeta,
    per_message_usage: bool,
) -> Option<ClaudeMessage> {
    let uuid = format!("{session_id}-{}", row.id);
    let timestamp = secs_to_iso(row.timestamp);
    let text_block =
        || non_empty(row.content.clone()).map(|text| json!({ "type": "text", "text": text }));

    match row.role.as_str() {
        "user" | "system" => {
            let block = text_block()?;
            Some(build_provider_message(
                PROVIDER,
                uuid,
                session_id,
                timestamp,
                &row.role,
                Some(&row.role),
                Some(Value::Array(vec![block])),
                None,
            ))
        }
        "assistant" => {
            let mut blocks = Vec::new();
            if let Some(thinking) = reasoning_text(row) {
                blocks.push(json!({ "type": "thinking", "thinking": thinking, "signature": "" }));
            }
            blocks.extend(text_block());
            blocks.extend(tool_use_blocks(row.tool_calls.as_deref()));
            if blocks.is_empty() {
                return None;
            }
            let mut message = build_provider_message(
                PROVIDER,
                uuid,
                session_id,
                timestamp,
                "assistant",
                Some("assistant"),
                Some(Value::Array(blocks)),
                meta.model.clone(),
            );
            message.stop_reason = row.finish_reason.as_deref().map(map_finish_reason);
            if per_message_usage {
                message.usage = row.token_count.filter(|n| *n > 0).map(|n| TokenUsage {
                    output_tokens: Some(clamp_u32(n)),
                    ..Default::default()
                });
            }
            Some(message)
        }
        // Tool results go to the user lane (Claude convention) so the
        // tool_result renderer pairs them with the assistant's tool_use.
        "tool" => {
            let block = json!({
                "type": "tool_result",
                "tool_use_id": row.tool_call_id.clone().unwrap_or_default(),
                "content": row.content.clone().unwrap_or_default(),
                "is_error": false,
            });
            Some(build_provider_message(
                PROVIDER,
                uuid,
                session_id,
                timestamp,
                "user",
                Some("user"),
                Some(Value::Array(vec![block])),
                None,
            ))
        }
        _ => None,
    }
}

/// Hermes (`OpenAI`-style) finish reasons to the viewer's Claude-style stop reasons.
fn map_finish_reason(reason: &str) -> String {
    match reason {
        "tool_calls" => "tool_use".to_string(),
        "stop" => "end_turn".to_string(),
        "length" => "max_tokens".to_string(),
        other => other.to_string(),
    }
}

/// The row's reasoning text: `reasoning` / `reasoning_content` (usually
/// identical) or, failing both, the readable parts of `reasoning_details`.
fn reasoning_text(row: &MessageRow) -> Option<String> {
    non_empty(row.reasoning.clone())
        .or_else(|| non_empty(row.reasoning_content.clone()))
        .or_else(|| {
            row.reasoning_details
                .as_deref()
                .and_then(reasoning_details_text)
        })
}

/// Join the `text` / `thinking` / `summary` strings of a `reasoning_details`
/// JSON value; encrypted entries carry no readable text and are skipped.
fn reasoning_details_text(raw: &str) -> Option<String> {
    let value: Value = serde_json::from_str(raw).ok()?;
    let items = match &value {
        Value::Array(items) => items.clone(),
        Value::String(text) => return non_empty(Some(text.clone())),
        other => vec![other.clone()],
    };
    let parts: Vec<String> = items
        .iter()
        .filter_map(|item| {
            ["text", "thinking", "summary"]
                .iter()
                .find_map(|key| item.get(*key).and_then(Value::as_str))
                .map(str::trim)
                .filter(|t| !t.is_empty())
                .map(str::to_string)
        })
        .collect();
    (!parts.is_empty()).then(|| parts.join("\n\n"))
}

/// `OpenAI`-style `tool_calls` JSON to viewer `tool_use` blocks.
fn tool_use_blocks(raw: Option<&str>) -> Vec<Value> {
    let Some(Value::Array(calls)) = raw.and_then(|r| serde_json::from_str::<Value>(r).ok()) else {
        return Vec::new();
    };
    calls
        .iter()
        .map(|call| {
            let function = call.get("function").unwrap_or(&Value::Null);
            let name = function
                .get("name")
                .or_else(|| call.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("tool");
            let id = call
                .get("id")
                .or_else(|| call.get("call_id"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let arguments = function
                .get("arguments")
                .or_else(|| call.get("arguments"))
                .cloned()
                .unwrap_or(Value::Null);
            json!({
                "type": "tool_use",
                "id": id,
                "name": name,
                "input": normalize_tool_input(arguments),
            })
        })
        .collect()
}

/// Arguments arrive as a JSON string; parse it, keeping unparseable text.
fn normalize_tool_input(input: Value) -> Value {
    match input {
        Value::String(s) if s.trim().is_empty() => json!({}),
        Value::String(s) => serde_json::from_str(&s).unwrap_or_else(|_| json!({ "input": s })),
        Value::Null => json!({}),
        other => other,
    }
}

// ============================================================================
// Search
// ============================================================================

/// Case-insensitive search across every store, `limit`-capped.
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    if query.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }
    let mut results = Vec::new();
    for store in discover_stores() {
        if results.len() >= limit {
            break;
        }
        if let Err(e) = search_store(&store, query, limit, &mut results) {
            log::warn!("Hermes search skipped store '{}': {e}", store.key);
        }
    }
    Ok(results)
}

/// SQL `LIKE` prefilter pattern. `LIKE` is case-insensitive for ASCII only
/// and `tool_calls` is raw JSON (quotes/backslashes escaped), so only plain
/// ASCII queries are prefiltered; anything else scans every session and the
/// Rust matcher decides, which cannot lose results.
fn like_prefilter_pattern(query: &str) -> Option<String> {
    let safe =
        query.is_ascii() && !query.contains(['"', '\\']) && !query.chars().any(char::is_control);
    safe.then(|| {
        let escaped: String = query
            .chars()
            .map(|c| match c {
                '%' => "\\%".to_string(),
                '_' => "\\_".to_string(),
                other => other.to_string(),
            })
            .collect();
        format!("%{escaped}%")
    })
}

fn search_store(
    store: &Store,
    query: &str,
    limit: usize,
    results: &mut Vec<ClaudeMessage>,
) -> Result<(), String> {
    let conn = open_db(&store.db)?;
    let schema = Schema::probe(&conn)?;
    let query_lower = query.to_lowercase();
    let pattern = like_prefilter_pattern(query);

    let searchable: Vec<String> = [
        "content",
        "tool_calls",
        "reasoning",
        "reasoning_content",
        "reasoning_details",
    ]
    .iter()
    .filter(|c| schema.messages.contains(**c))
    .map(|c| format!("m.{c} LIKE ?1 ESCAPE '\\'"))
    .collect();
    let prefilter = if searchable.is_empty() {
        String::new()
    } else {
        format!(
            " AND (?1 IS NULL OR EXISTS (SELECT 1 FROM messages m \
               WHERE m.session_id = s.id{} AND ({})))",
            schema.visible(),
            searchable.join(" OR ")
        )
    };
    let sql = format!(
        "SELECT s.id, {dir}, {source} FROM sessions s WHERE 1 = 1{prefilter} \
         ORDER BY s.started_at DESC",
        dir = schema.group_dir_expr(),
        source = schema.s("source"),
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let bind = |row: &Row<'_>| {
        Ok((
            col_text(row, 0).unwrap_or_default(),
            Group::from_row(col_text(row, 1), col_text(row, 2)),
        ))
    };
    let sessions = if searchable.is_empty() {
        stmt.query_map([], bind)
    } else {
        stmt.query_map(rusqlite::params![pattern], bind)
    }
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

    for (session_id, group) in sessions {
        if results.len() >= limit {
            break;
        }
        let project_name = project_display_name(&store.key, &group);
        for mut message in load_messages_conn(&conn, &schema, &session_id)? {
            if results.len() >= limit {
                break;
            }
            let matched = message
                .content
                .as_ref()
                .is_some_and(|c| search_json_value_case_insensitive(c, &query_lower));
            if matched {
                message.project_name = Some(project_name.clone());
                results.push(message);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    // Tests for the Hermes Agent provider. Every test builds a synthetic
    // `state.db` in a temp dir and points `HERMES_HOME` at it; nothing reads a
    // real Hermes installation.

    use super::*;
    use rusqlite::Connection;
    use std::path::Path;

    /// Current `sessions` / `messages` column subset (schema v30+). FTS and
    /// gateway tables are irrelevant to the reader and left out.
    const MODERN_SCHEMA: &str = "
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT, model TEXT,
            model_config TEXT, parent_session_id TEXT,
            started_at REAL NOT NULL, ended_at REAL, end_reason TEXT,
            message_count INTEGER DEFAULT 0, tool_call_count INTEGER DEFAULT 0,
            input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
            cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0,
            reasoning_tokens INTEGER DEFAULT 0,
            cwd TEXT, git_branch TEXT, git_repo_root TEXT,
            estimated_cost_usd REAL, actual_cost_usd REAL, title TEXT,
            archived INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
            role TEXT NOT NULL, content TEXT, tool_call_id TEXT, tool_calls TEXT,
            tool_name TEXT, timestamp REAL NOT NULL, token_count INTEGER,
            finish_reason TEXT, reasoning TEXT, reasoning_content TEXT,
            reasoning_details TEXT, active INTEGER NOT NULL DEFAULT 1,
            compacted INTEGER NOT NULL DEFAULT 0, display_kind TEXT
        );";

    /// Schema v1 (initial release): no title, reasoning, active/compacted,
    /// display or workspace columns, and no cache/reasoning token totals.
    const LEGACY_SCHEMA: &str = "
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT, model TEXT,
            model_config TEXT, system_prompt TEXT, parent_session_id TEXT,
            started_at REAL NOT NULL, ended_at REAL, end_reason TEXT,
            message_count INTEGER DEFAULT 0, tool_call_count INTEGER DEFAULT 0,
            input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0
        );
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
            role TEXT NOT NULL, content TEXT, tool_call_id TEXT, tool_calls TEXT,
            tool_name TEXT, timestamp REAL NOT NULL, token_count INTEGER
        );";

    /// `HERMES_HOME` save/restore. The suite runs with `--test-threads=1`, so
    /// mutating the process environment is safe as long as every test restores
    /// the previous value — the guard does that on drop, even when an assertion
    /// fails.
    struct HermesHome {
        original: Option<std::ffi::OsString>,
        _temp: tempfile::TempDir,
        root: PathBuf,
    }

    impl HermesHome {
        fn new() -> Self {
            let temp = tempfile::TempDir::new().unwrap();
            let root = temp.path().to_path_buf();
            let original = std::env::var_os(HERMES_HOME_ENV);
            std::env::set_var(HERMES_HOME_ENV, &root);
            Self {
                original,
                _temp: temp,
                root,
            }
        }

        /// Create `<dir>/state.db` with `schema` and return a writable handle
        /// for seeding (the provider itself only ever opens read-only).
        fn create_db(dir: &Path, schema: &str) -> Connection {
            std::fs::create_dir_all(dir).unwrap();
            let conn = Connection::open(dir.join(DB_FILE)).unwrap();
            conn.execute_batch(schema).unwrap();
            conn
        }

        fn root_db(&self, schema: &str) -> Connection {
            Self::create_db(&self.root, schema)
        }

        fn profile_db(&self, name: &str, schema: &str) -> Connection {
            Self::create_db(&self.root.join(PROFILES_DIR).join(name), schema)
        }
    }

    impl Drop for HermesHome {
        fn drop(&mut self) {
            match self.original.take() {
                Some(value) => std::env::set_var(HERMES_HOME_ENV, value),
                None => std::env::remove_var(HERMES_HOME_ENV),
            }
        }
    }

    fn insert_session(conn: &Connection, id: &str, source: &str, cwd: Option<&str>) {
        conn.execute(
            "INSERT INTO sessions (id, source, model, started_at, cwd) \
             VALUES (?1, ?2, 'anthropic/claude-sonnet-4.6', 1788599956.25, ?3)",
            rusqlite::params![id, source, cwd],
        )
        .unwrap();
    }

    fn insert_legacy_session(conn: &Connection, id: &str, source: &str) {
        conn.execute(
            "INSERT INTO sessions (id, source, model, started_at) \
             VALUES (?1, ?2, 'hermes-3', 1788599956.0)",
            rusqlite::params![id, source],
        )
        .unwrap();
    }

    /// Insert a message row; `extra` is a list of (column, value) pairs for the
    /// optional columns a test cares about.
    fn insert_message(
        conn: &Connection,
        session: &str,
        role: &str,
        content: Option<&str>,
        timestamp: f64,
        extra: &[(&str, rusqlite::types::Value)],
    ) -> i64 {
        let mut columns = vec!["session_id", "role", "content", "timestamp"];
        let mut values: Vec<rusqlite::types::Value> = vec![
            session.to_string().into(),
            role.to_string().into(),
            content.map(str::to_string).into(),
            timestamp.into(),
        ];
        for (column, value) in extra {
            columns.push(column);
            values.push(value.clone());
        }
        let placeholders = (1..=columns.len())
            .map(|i| format!("?{i}"))
            .collect::<Vec<_>>()
            .join(", ");
        conn.execute(
            &format!(
                "INSERT INTO messages ({}) VALUES ({placeholders})",
                columns.join(", ")
            ),
            rusqlite::params_from_iter(values),
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn text(value: &str) -> rusqlite::types::Value {
        value.to_string().into()
    }

    fn blocks(message: &ClaudeMessage) -> &Vec<Value> {
        message
            .content
            .as_ref()
            .and_then(Value::as_array)
            .expect("content blocks")
    }

    /// A two-turn coding session in `/work/app`: user prompt, assistant tool
    /// call (with reasoning), tool result, final assistant answer.
    fn seed_tool_session(conn: &Connection) {
        insert_session(conn, "s-tools", "cli", Some("/work/app"));
        insert_message(
            conn,
            "s-tools",
            "user",
            Some("list the files please"),
            1788599957.0,
            &[],
        );
        insert_message(
            conn,
            "s-tools",
            "assistant",
            Some(""),
            1788599958.0,
            &[
                (
                    "tool_calls",
                    text(
                        r#"[{"id":"call_1","call_id":"call_1","type":"function","function":{"name":"terminal","arguments":"{\"command\":\"ls\"}"}}]"#,
                    ),
                ),
                ("finish_reason", text("tool_calls")),
                ("reasoning_content", text("I should run ls")),
            ],
        );
        insert_message(
            conn,
            "s-tools",
            "tool",
            Some(r#"{"output":"main.rs","exit_code":0}"#),
            1788599959.0,
            &[
                ("tool_call_id", text("call_1")),
                ("tool_name", text("terminal")),
            ],
        );
        insert_message(
            conn,
            "s-tools",
            "assistant",
            Some("There is one file: main.rs"),
            1788599960.0,
            &[("finish_reason", text("stop"))],
        );
    }

    // ---------------------------------------------------------------------------
    // Root resolution and store discovery
    // ---------------------------------------------------------------------------

    #[test]
    fn hermes_home_overrides_the_root_and_drives_detection() {
        let home = HermesHome::new();
        // No state.db yet: nothing to detect, nothing to scan.
        assert!(detect().is_none());
        assert!(scan_projects().unwrap().is_empty());

        home.root_db(MODERN_SCHEMA);
        let info = detect().expect("detect with HERMES_HOME set");
        assert_eq!(info.id, "hermes");
        assert_eq!(info.display_name, "Hermes Agent");
        assert!(info.is_available);
        assert_eq!(PathBuf::from(info.base_path), home.root);
        assert_eq!(get_base_path().map(PathBuf::from), Some(home.root.clone()));
    }

    #[test]
    fn default_root_follows_the_platform_convention() {
        let original_home = std::env::var_os(HERMES_HOME_ENV);
        let original_test_home = std::env::var_os("CCHV_TEST_HOME");
        let temp = tempfile::TempDir::new().unwrap();
        std::env::remove_var(HERMES_HOME_ENV);
        std::env::set_var("CCHV_TEST_HOME", temp.path());

        let root = hermes_root();

        match original_home {
            Some(value) => std::env::set_var(HERMES_HOME_ENV, value),
            None => std::env::remove_var(HERMES_HOME_ENV),
        }
        match original_test_home {
            Some(value) => std::env::set_var("CCHV_TEST_HOME", value),
            None => std::env::remove_var("CCHV_TEST_HOME"),
        }

        let expected = if cfg!(windows) {
            temp.path().join("AppData").join("Local").join("hermes")
        } else {
            temp.path().join(".hermes")
        };
        assert_eq!(root, Some(expected));
    }

    #[test]
    fn named_profiles_are_enumerated_as_separate_stores() {
        let home = HermesHome::new();
        let root = home.root_db(MODERN_SCHEMA);
        insert_session(&root, "s-root", "cli", Some("/work/app"));
        insert_message(&root, "s-root", "user", Some("root hello"), 1.0, &[]);

        let coder = home.profile_db("coder", MODERN_SCHEMA);
        insert_session(&coder, "s-coder", "cli", Some("/work/app"));
        insert_message(&coder, "s-coder", "user", Some("coder hello"), 2.0, &[]);

        // A profile directory without a state.db and a stray file are ignored.
        std::fs::create_dir_all(home.root.join(PROFILES_DIR).join("empty")).unwrap();
        std::fs::write(home.root.join(PROFILES_DIR).join("notes.txt"), "x").unwrap();

        let stores = discover_stores();
        let keys: Vec<_> = stores.iter().map(|s| s.key.as_str()).collect();
        assert_eq!(keys, vec!["default", "profile.coder"]);

        let projects = scan_projects().unwrap();
        assert_eq!(projects.len(), 2, "same cwd in two profiles stays separate");
        let root_project = projects
            .iter()
            .find(|p| p.path.starts_with("hermes://default::"))
            .expect("root store project");
        let coder_project = projects
            .iter()
            .find(|p| p.path.starts_with("hermes://profile.coder::"))
            .expect("profile store project");
        assert_eq!(root_project.name, "app");
        assert_eq!(coder_project.name, "app (coder)");
        assert_eq!(coder_project.actual_path, "/work/app");
        assert_eq!(coder_project.provider.as_deref(), Some("hermes"));
        assert_eq!(coder_project.storage_type.as_deref(), Some("sqlite"));

        let sessions = load_sessions(&coder_project.path, false).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].actual_session_id, "s-coder");
        let messages = load_messages(&sessions[0].file_path).unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(blocks(&messages[0])[0]["text"], "coder hello");
    }

    #[test]
    fn unsafe_store_keys_are_rejected() {
        let _home = HermesHome::new();
        assert!(parse_session_path("hermes://profile.../x::dir:/a#s").is_err());
        assert!(parse_session_path("hermes://profile.a/b::dir:/a#s").is_err());
        assert!(parse_session_path("hermes://elsewhere::dir:/a#s").is_err());
        assert!(parse_session_path("hermes://default::dir:/a").is_err());
        assert!(load_sessions("hermes://profile..::dir:/a", false).is_err());
    }

    #[test]
    fn session_path_round_trips_including_windows_paths() {
        let project = project_path("default", &Group::Dir(r"C:\work\my#app".to_string()));
        let session = format!("{project}{SESSION_SEP}20260101_120000_abcd");
        let parsed = parse_session_path(&session).unwrap();
        assert_eq!(parsed.store, "default");
        assert_eq!(parsed.group, Group::Dir(r"C:\work\my#app".to_string()));
        assert_eq!(parsed.session_id, "20260101_120000_abcd");

        let bucket = project_path("profile.coder", &Group::Source("telegram".to_string()));
        let (store, group) = parse_project_path(&bucket).unwrap();
        assert_eq!(store, "profile.coder");
        assert_eq!(group, Group::Source("telegram".to_string()));
        assert_eq!(project_name(&bucket), "Hermes (telegram) (coder)");
        // A `#` inside the folder name survives both directions.
        assert_eq!(project_name(&project), "my#app");
        assert_eq!(project_name_for_session(&session), "my#app");
    }

    // ---------------------------------------------------------------------------
    // Project grouping
    // ---------------------------------------------------------------------------

    #[test]
    fn projects_group_by_cwd_then_repo_root_then_source() {
        let home = HermesHome::new();
        let conn = home.root_db(MODERN_SCHEMA);
        insert_session(&conn, "s-cwd", "cli", Some("/work/app"));
        // Blank cwd falls back to the repo root, which merges with /work/app.
        insert_session(&conn, "s-repo", "cli", Some("  "));
        conn.execute(
            "UPDATE sessions SET git_repo_root = '/work/app' WHERE id = 's-repo'",
            [],
        )
        .unwrap();
        // Gateway / cron sessions without a workspace land in a source bucket.
        insert_session(&conn, "s-tg", "telegram", None);
        insert_session(&conn, "s-cron", "cron", None);
        // Sessions without any visible messages are not listed.
        insert_session(&conn, "s-empty", "cli", Some("/work/other"));
        for (i, id) in ["s-cwd", "s-repo", "s-tg", "s-cron"].iter().enumerate() {
            insert_message(&conn, id, "user", Some("hi"), 10.0 + i as f64, &[]);
        }

        let projects = scan_projects().unwrap();
        let mut names: Vec<_> = projects.iter().map(|p| p.name.as_str()).collect();
        names.sort_unstable();
        assert_eq!(names, vec!["Hermes (cron)", "Hermes (telegram)", "app"]);

        let app = projects.iter().find(|p| p.name == "app").unwrap();
        assert_eq!(app.session_count, 2);
        assert_eq!(app.message_count, 2);
        assert_eq!(app.actual_path, "/work/app");
        let sessions = load_sessions(&app.path, false).unwrap();
        let mut ids: Vec<_> = sessions
            .iter()
            .map(|s| s.actual_session_id.as_str())
            .collect();
        ids.sort_unstable();
        assert_eq!(ids, vec!["s-cwd", "s-repo"]);

        let telegram = projects
            .iter()
            .find(|p| p.name == "Hermes (telegram)")
            .unwrap();
        // Buckets have no folder; their own URI keeps them distinct in the tree.
        assert_eq!(telegram.actual_path, telegram.path);
        let sessions = load_sessions(&telegram.path, false).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].actual_session_id, "s-tg");
    }

    // ---------------------------------------------------------------------------
    // Message mapping
    // ---------------------------------------------------------------------------

    #[test]
    fn inactive_compaction_rows_are_skipped() {
        let home = HermesHome::new();
        let conn = home.root_db(MODERN_SCHEMA);
        insert_session(&conn, "s-compact", "cli", Some("/work/app"));
        // Pre-compaction generation, archived by in-place compaction.
        insert_message(
            &conn,
            "s-compact",
            "user",
            Some("archived zebra question"),
            1.0,
            &[("active", 0.into()), ("compacted", 1.into())],
        );
        insert_message(
            &conn,
            "s-compact",
            "assistant",
            Some("archived answer"),
            2.0,
            &[("active", 0.into()), ("compacted", 1.into())],
        );
        // Retained context re-inserted as the live generation.
        insert_message(
            &conn,
            "s-compact",
            "user",
            Some("[summary of earlier turns]"),
            1.0,
            &[],
        );
        insert_message(
            &conn,
            "s-compact",
            "assistant",
            Some("live answer"),
            3.0,
            &[],
        );

        let messages = load_messages("hermes://default::dir:/work/app#s-compact").unwrap();
        let texts: Vec<_> = messages
            .iter()
            .map(|m| blocks(m)[0]["text"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(texts, vec!["[summary of earlier turns]", "live answer"]);

        let sessions = load_sessions("hermes://default::dir:/work/app", false).unwrap();
        assert_eq!(sessions[0].message_count, 2);
        assert_eq!(scan_projects().unwrap()[0].message_count, 2);
        assert!(search("zebra", 10).unwrap().is_empty());
    }

    #[test]
    fn hidden_scaffolding_rows_are_skipped() {
        let home = HermesHome::new();
        let conn = home.root_db(MODERN_SCHEMA);
        insert_session(&conn, "s-1", "cli", Some("/work/app"));
        insert_message(&conn, "s-1", "user", Some("visible"), 1.0, &[]);
        insert_message(
            &conn,
            "s-1",
            "user",
            Some("model-only scaffolding"),
            2.0,
            &[("display_kind", text("hidden"))],
        );
        insert_message(
            &conn,
            "s-1",
            "user",
            Some("steer note"),
            3.0,
            &[("display_kind", text("steer"))],
        );

        let messages = load_messages("hermes://default::dir:/work/app#s-1").unwrap();
        let texts: Vec<_> = messages
            .iter()
            .map(|m| blocks(m)[0]["text"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(texts, vec!["visible", "steer note"]);
    }

    #[test]
    fn tool_calls_pair_with_tool_results() {
        let home = HermesHome::new();
        let conn = home.root_db(MODERN_SCHEMA);
        seed_tool_session(&conn);

        let sessions = load_sessions("hermes://default::dir:/work/app", false).unwrap();
        assert_eq!(sessions.len(), 1);
        let session = &sessions[0];
        assert!(session.has_tool_use);
        assert_eq!(session.summary.as_deref(), Some("list the files please"));
        assert_eq!(session.provider.as_deref(), Some("hermes"));

        let messages = load_messages(&session.file_path).unwrap();
        assert_eq!(messages.len(), 4);
        assert!(messages
            .iter()
            .all(|m| m.provider.as_deref() == Some("hermes") && m.session_id == "s-tools"));

        let call = &messages[1];
        assert_eq!(call.message_type, "assistant");
        assert_eq!(call.model.as_deref(), Some("anthropic/claude-sonnet-4.6"));
        assert_eq!(call.stop_reason.as_deref(), Some("tool_use"));
        let call_blocks = blocks(call);
        assert_eq!(call_blocks[0]["type"], "thinking");
        assert_eq!(call_blocks[0]["thinking"], "I should run ls");
        let tool_use = call_blocks
            .iter()
            .find(|b| b["type"] == "tool_use")
            .expect("tool_use block");
        assert_eq!(tool_use["id"], "call_1");
        assert_eq!(tool_use["name"], "terminal");
        // Stringified OpenAI arguments are parsed back into an object.
        assert_eq!(tool_use["input"]["command"], "ls");

        let result = &messages[2];
        assert_eq!(result.message_type, "user");
        assert_eq!(result.role.as_deref(), Some("user"));
        let result_block = &blocks(result)[0];
        assert_eq!(result_block["type"], "tool_result");
        assert_eq!(result_block["tool_use_id"], "call_1");
        assert_eq!(
            result_block["content"],
            r#"{"output":"main.rs","exit_code":0}"#
        );

        let answer = &messages[3];
        assert_eq!(answer.stop_reason.as_deref(), Some("end_turn"));
        assert_eq!(blocks(answer)[0]["text"], "There is one file: main.rs");
    }

    #[test]
    fn reasoning_columns_map_to_thinking_blocks() {
        let home = HermesHome::new();
        let conn = home.root_db(MODERN_SCHEMA);
        insert_session(&conn, "s-r", "cli", Some("/work/app"));
        // `reasoning` and `reasoning_content` usually carry the same text; it
        // must be rendered once.
        insert_message(
            &conn,
            "s-r",
            "assistant",
            Some("answer one"),
            1.0,
            &[
                ("reasoning", text("same thought")),
                ("reasoning_content", text("same thought")),
            ],
        );
        // Only structured details (OpenRouter / Anthropic style) are present.
        insert_message(
            &conn,
            "s-r",
            "assistant",
            Some("answer two"),
            2.0,
            &[(
                "reasoning_details",
                text(
                    r#"[{"type":"reasoning.text","text":"step A"},{"type":"thinking","thinking":"step B","signature":"sig"},{"type":"reasoning.encrypted","data":"opaque"}]"#,
                ),
            )],
        );
        // A reasoning-only clean stop keeps its text out of `content`.
        insert_message(
            &conn,
            "s-r",
            "assistant",
            None,
            3.0,
            &[("reasoning", text("only thinking"))],
        );

        let messages = load_messages("hermes://default::dir:/work/app#s-r").unwrap();
        assert_eq!(messages.len(), 3);

        let first = blocks(&messages[0]);
        assert_eq!(first.len(), 2);
        assert_eq!(first[0]["type"], "thinking");
        assert_eq!(first[0]["thinking"], "same thought");
        assert_eq!(first[1]["text"], "answer one");

        let second = blocks(&messages[1]);
        assert_eq!(second[0]["type"], "thinking");
        assert_eq!(second[0]["thinking"], "step A\n\nstep B");

        let third = blocks(&messages[2]);
        assert_eq!(third.len(), 1);
        assert_eq!(third[0]["thinking"], "only thinking");
    }

    #[test]
    fn legacy_schema_without_optional_columns_still_loads() {
        let home = HermesHome::new();
        let conn = home.root_db(LEGACY_SCHEMA);
        insert_legacy_session(&conn, "s-old", "cli");
        insert_message(&conn, "s-old", "user", Some("old question"), 1.0, &[]);
        insert_message(
            &conn,
            "s-old",
            "assistant",
            Some("old answer"),
            2.0,
            &[("token_count", 42.into())],
        );

        // No cwd column: everything lands in the source bucket.
        let projects = scan_projects().unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "Hermes (cli)");

        let sessions = load_sessions(&projects[0].path, false).unwrap();
        assert_eq!(sessions.len(), 1);
        // No title column: the first user message is the summary.
        assert_eq!(sessions[0].summary.as_deref(), Some("old question"));

        let messages = load_messages(&sessions[0].file_path).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1].model.as_deref(), Some("hermes-3"));
        // Session totals are zero, so the per-message count is the usage.
        let usage = messages[1].usage.as_ref().expect("per-message usage");
        assert_eq!(usage.output_tokens, Some(42));

        let hits = search("old ANSWER", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].project_name.as_deref(), Some("Hermes (cli)"));
    }

    #[test]
    fn session_totals_and_cost_attach_to_the_last_assistant_message() {
        let home = HermesHome::new();
        let conn = home.root_db(MODERN_SCHEMA);
        seed_tool_session(&conn);
        conn.execute(
            "UPDATE sessions SET input_tokens = 1200, output_tokens = 300, \
             cache_read_tokens = 5000, cache_write_tokens = 700, reasoning_tokens = 40, \
             estimated_cost_usd = 0.25, actual_cost_usd = 0.2, title = 'List files' \
             WHERE id = 's-tools'",
            [],
        )
        .unwrap();
        // Per-message counts are ignored when session totals exist, so the
        // session is never counted twice.
        conn.execute(
            "UPDATE messages SET token_count = 999 WHERE role = 'assistant'",
            [],
        )
        .unwrap();

        let sessions = load_sessions("hermes://default::dir:/work/app", false).unwrap();
        assert_eq!(sessions[0].summary.as_deref(), Some("List files"));

        let messages = load_messages("hermes://default::dir:/work/app#s-tools").unwrap();
        let with_usage: Vec<_> = messages.iter().filter(|m| m.usage.is_some()).collect();
        assert_eq!(with_usage.len(), 1);
        let last = with_usage[0];
        assert_eq!(last.uuid, messages[3].uuid);
        let usage = last.usage.as_ref().unwrap();
        assert_eq!(usage.input_tokens, Some(1200));
        assert_eq!(usage.output_tokens, Some(300));
        assert_eq!(usage.cache_read_input_tokens, Some(5000));
        assert_eq!(usage.cache_creation_input_tokens, Some(700));
        assert_eq!(usage.reasoning_tokens, Some(40));
        // The billed cost wins over the estimate.
        assert_eq!(last.cost_usd, Some(0.2));
    }

    #[tokio::test]
    async fn session_token_stats_use_the_session_totals() {
        let home = HermesHome::new();
        let conn = home.root_db(MODERN_SCHEMA);
        seed_tool_session(&conn);
        conn.execute(
            "UPDATE sessions SET input_tokens = 1200, output_tokens = 300 WHERE id = 's-tools'",
            [],
        )
        .unwrap();

        let stats = crate::commands::stats::get_session_token_stats(
            "hermes://default::dir:/work/app#s-tools".to_string(),
            None,
            None,
            Some("billing_total".to_string()),
        )
        .await
        .expect("session stats");
        assert_eq!(stats.total_input_tokens, 1200);
        assert_eq!(stats.total_output_tokens, 300);
        assert_eq!(stats.project_name, "app");
    }

    #[test]
    fn timestamps_are_epoch_seconds() {
        let home = HermesHome::new();
        let conn = home.root_db(MODERN_SCHEMA);
        insert_session(&conn, "s-t", "cli", Some("/work/app"));
        insert_message(&conn, "s-t", "user", Some("hi"), 1788599957.5, &[]);

        let messages = load_messages("hermes://default::dir:/work/app#s-t").unwrap();
        assert_eq!(messages[0].timestamp, "2026-09-05T09:19:17.500Z");
        let sessions = load_sessions("hermes://default::dir:/work/app", false).unwrap();
        assert_eq!(sessions[0].first_message_time, "2026-09-05T09:19:16.250Z");
        assert_eq!(sessions[0].last_message_time, "2026-09-05T09:19:17.500Z");
    }

    #[test]
    fn search_prefilters_and_scans_non_ascii() {
        let home = HermesHome::new();
        let conn = home.root_db(MODERN_SCHEMA);
        seed_tool_session(&conn);
        insert_session(&conn, "s-cjk", "telegram", None);
        insert_message(&conn, "s-cjk", "user", Some("查看登录问题"), 5.0, &[]);

        let hits = search("MAIN.RS", 10).unwrap();
        assert!(!hits.is_empty());
        assert!(hits
            .iter()
            .all(|m| m.project_name.as_deref() == Some("app") && m.session_id == "s-tools"));

        let hits = search("登录", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].project_name.as_deref(), Some("Hermes (telegram)"));

        // LIKE wildcards are literal, and the limit is honoured.
        assert!(search("%", 10).unwrap().is_empty());
        assert_eq!(search("s", 1).unwrap().len(), 1);
    }

    #[test]
    fn missing_store_is_tolerated() {
        let _home = HermesHome::new();
        assert!(scan_projects().unwrap().is_empty());
        assert!(load_sessions("hermes://default::dir:/a", false)
            .unwrap()
            .is_empty());
        assert!(search("anything", 10).unwrap().is_empty());
        assert!(load_messages("hermes://default::dir:/a#s").is_err());
    }

    #[test]
    fn provider_opens_the_store_read_only() {
        let home = HermesHome::new();
        let seeded = home.root_db(MODERN_SCHEMA);
        drop(seeded);
        let conn = open_db(&home.root.join(DB_FILE)).unwrap();
        let write = conn.execute(
            "INSERT INTO sessions (id, source, started_at) VALUES ('x', 'cli', 1)",
            [],
        );
        assert!(write.is_err(), "a Hermes store must never be written");
    }
}
