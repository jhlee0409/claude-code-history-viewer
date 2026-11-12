use super::scan_report::ScanReport;
use super::ProviderInfo;
use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession, TokenUsage};
use crate::utils::is_safe_storage_id;
use base64::Engine;
use chrono::{DateTime, Utc};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

const OPENCODE_GLOBAL_PROJECT_ID: &str = "global";
const OPENCODE_GLOBAL_DIRECTORY_PREFIX: &str = "global-dir-";

/// Convert epoch milliseconds to RFC 3339 string
fn epoch_ms_to_rfc3339(ms: u64) -> String {
    #[allow(clippy::cast_possible_wrap)]
    let secs = (ms / 1000) as i64;
    let nsecs = ((ms % 1000) * 1_000_000) as u32;
    match DateTime::from_timestamp(secs, nsecs) {
        Some(dt) => dt.to_rfc3339(),
        None => String::new(),
    }
}

#[derive(Debug, Clone)]
struct OpenCodeProjectRef {
    storage_id: String,
    global_directory_hash: Option<String>,
}

impl OpenCodeProjectRef {
    fn parse(project_path: &str) -> Result<Self, String> {
        let project_id = project_path
            .strip_prefix("opencode://")
            .unwrap_or(project_path);

        if let Some(hash) = project_id.strip_prefix(OPENCODE_GLOBAL_DIRECTORY_PREFIX) {
            if is_safe_global_directory_hash(hash) {
                return Ok(Self {
                    storage_id: OPENCODE_GLOBAL_PROJECT_ID.to_string(),
                    global_directory_hash: Some(hash.to_string()),
                });
            }
        }

        if !is_safe_storage_id(project_id) {
            return Err(format!("Invalid OpenCode project path: {project_path}"));
        }

        Ok(Self {
            storage_id: project_id.to_string(),
            global_directory_hash: None,
        })
    }

    fn storage_id(&self) -> &str {
        &self.storage_id
    }

    fn is_virtual_global_directory(&self) -> bool {
        self.global_directory_hash.is_some()
    }

    fn matches_directory(&self, directory: &str) -> bool {
        match self.global_directory_hash.as_deref() {
            Some(hash) => hash == stable_directory_hash(directory),
            None => true,
        }
    }
}

struct DbProjectRecord {
    id: String,
    worktree: String,
    name: Option<String>,
    time_created: u64,
    time_updated: u64,
    session_count: usize,
    /// `OpenCode` 2.x stops bumping `project.time_updated` on activity, so the
    /// newest session is what tells a recently used project apart.
    last_session_update: Option<u64>,
}

fn is_safe_global_directory_hash(hash: &str) -> bool {
    hash.len() == 16 && hash.chars().all(|c| c.is_ascii_hexdigit())
}

fn normalize_directory_for_hash(directory: &str) -> String {
    let mut normalized = directory.trim().replace('\\', "/");
    while normalized.len() > 1 && normalized.ends_with('/') {
        if normalized.len() == 3 && normalized.as_bytes().get(1) == Some(&b':') {
            break;
        }
        normalized.pop();
    }
    normalized
}

fn stable_directory_hash(directory: &str) -> String {
    // FNV-1a keeps the virtual project id deterministic without adding a dependency.
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in normalize_directory_for_hash(directory).as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn global_directory_project_id(directory: &str) -> String {
    format!(
        "{}{}",
        OPENCODE_GLOBAL_DIRECTORY_PREFIX,
        stable_directory_hash(directory)
    )
}

fn opencode_project_display_name(name: Option<&str>, worktree: &str) -> String {
    if let Some(name) = name.map(str::trim).filter(|n| !n.is_empty()) {
        return name.to_string();
    }

    let trimmed = worktree.trim().trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        return OPENCODE_GLOBAL_PROJECT_ID.to_string();
    }

    Path::new(trimmed)
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty())
        .map_or_else(|| trimmed.to_string(), str::to_string)
}

fn should_split_global_project(project: &DbProjectRecord) -> bool {
    project.id == OPENCODE_GLOBAL_PROJECT_ID
        && match project.name.as_deref().map(str::trim) {
            Some(name) => name.is_empty(),
            None => true,
        }
}

/// Detect `OpenCode` installation
pub fn detect() -> Option<ProviderInfo> {
    let base_path = get_base_path()?;
    let storage_path = Path::new(&base_path).join("storage");
    let db_path = Path::new(&base_path).join("opencode.db");

    Some(ProviderInfo {
        id: "opencode".to_string(),
        display_name: "OpenCode".to_string(),
        base_path: base_path.clone(),
        is_available: (storage_path.exists() && storage_path.is_dir()) || db_path.is_file(),
    })
}

/// Get the `OpenCode` base path
pub fn get_base_path() -> Option<String> {
    // Check $OPENCODE_HOME first
    if let Ok(home) = std::env::var("OPENCODE_HOME") {
        let path = PathBuf::from(&home);
        if path.exists() {
            return Some(home);
        }
    }

    // XDG data directory
    if let Ok(xdg_data) = std::env::var("XDG_DATA_HOME") {
        let path = PathBuf::from(&xdg_data).join("opencode");
        if path.exists() {
            return Some(path.to_string_lossy().to_string());
        }
    }

    // Default: ~/.local/share/opencode
    let home = crate::utils::home_dir()?;
    let opencode_path = home.join(".local").join("share").join("opencode");
    if opencode_path.exists() {
        Some(opencode_path.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Scan `OpenCode` projects from a specific base path.
pub fn scan_projects_from_path(base_path: &str) -> Result<Vec<ClaudeProject>, String> {
    scan_projects_from_store(base_path, OPENCODE_DB_FILE)
}

/// Scan projects from an explicit store root and database file. Shared with
/// the Kilo Code provider, whose store is an OpenCode-core database under a
/// different root (`kilo.db` in `~/.local/share/kilo`).
pub fn scan_projects_from_store(
    base_path: &str,
    db_file: &str,
) -> Result<Vec<ClaudeProject>, String> {
    scan_projects_from_store_reporting(base_path, db_file, &ScanReport::default())
}

/// [`scan_projects_from_store`], recording in `report` a database that is
/// there but cannot be read and the JSON project files it could not read.
pub(crate) fn scan_projects_from_store_reporting(
    base_path: &str,
    db_file: &str,
    report: &ScanReport,
) -> Result<Vec<ClaudeProject>, String> {
    crate::utils::require_absolute_path(base_path, "OpenCode base path")?;

    let storage_path = Path::new(base_path).join("storage");

    // Reject symlinked storage root
    if std::fs::symlink_metadata(&storage_path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Ok(Vec::new());
    }

    let mut projects = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    // Pre-build DB session ID set per project (single connection, reused for all projects)
    let db_sessions_by_project: std::collections::HashMap<String, HashSet<String>> =
        build_db_session_map(base_path, db_file).unwrap_or_default();

    // 1. Read from SQLite (preferred, newer source)
    if let Some(db_projects) = scan_projects_from_db(base_path, db_file, report) {
        for mut p in db_projects {
            let project_ref = match OpenCodeProjectRef::parse(&p.path) {
                Ok(project_ref) => project_ref,
                Err(_) => continue,
            };
            if !is_safe_storage_id(project_ref.storage_id()) {
                continue;
            }
            let storage_id = project_ref.storage_id().to_string();
            // Supplement session count with JSON-only sessions
            let sessions_dir = storage_path.join("session").join(&storage_id);
            if !project_ref.is_virtual_global_directory()
                && is_non_symlink_dir_reporting(&sessions_dir, report)
            {
                let db_ids = db_sessions_by_project.get(&storage_id);
                let json_only = count_json_sessions_excluding(
                    &sessions_dir,
                    db_ids.map(|s| s as &HashSet<String>),
                );
                p.session_count += json_only;
            }
            seen_ids.insert(storage_id);
            projects.push(p);
        }
    }

    // 2. Read from JSON files (fallback / merge)
    let projects_dir = storage_path.join("project");
    if is_non_symlink_dir_reporting(&projects_dir, report) {
        let entries = fs::read_dir(&projects_dir).map_err(|e| e.to_string())?;

        for entry in entries.filter_map(|entry| report.read(&projects_dir, entry)) {
            if entry.file_type().map_or(true, |ft| ft.is_symlink()) {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }

            let Some(content) = report.read_to_string(&path) else {
                continue;
            };

            let val: Value = match serde_json::from_str(&content) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let project_id = val
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            if project_id.is_empty() || !is_safe_storage_id(&project_id) {
                continue;
            }

            // Skip if already loaded from SQLite
            if seen_ids.contains(&project_id) {
                continue;
            }

            let project_path = val
                .get("worktree")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let project_name = Path::new(&project_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();

            let sessions_dir = storage_path.join("session").join(&project_id);
            let session_count = if is_non_symlink_dir(&sessions_dir) {
                fs::read_dir(&sessions_dir)
                    .map(|entries| {
                        entries
                            .flatten()
                            .filter(|e| {
                                if e.file_type().map_or(true, |ft| ft.is_symlink()) {
                                    return false;
                                }
                                e.path().extension().and_then(|ext| ext.to_str()) == Some("json")
                            })
                            .count()
                    })
                    .unwrap_or(0)
            } else {
                0
            };

            let last_modified =
                get_latest_session_time(&sessions_dir).unwrap_or_else(|| Utc::now().to_rfc3339());

            projects.push(ClaudeProject {
                name: project_name,
                path: format!("opencode://{project_id}"),
                actual_path: project_path,
                session_count,
                message_count: 0,
                last_modified,
                git_info: None,
                provider: Some("opencode".to_string()),
                storage_type: Some("json".to_string()),
                custom_directory_label: None,
            });
        }
    }

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

/// Scan `OpenCode` projects from the default location.
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    scan_projects_reporting(&ScanReport::default())
}

/// [`scan_projects`], recording in `report` what it could not read.
pub(crate) fn scan_projects_reporting(report: &ScanReport) -> Result<Vec<ClaudeProject>, String> {
    let base = get_base_path().ok_or("OpenCode base path not found")?;
    scan_projects_from_store_reporting(&base, OPENCODE_DB_FILE, report)
}

/// Load sessions for an `OpenCode` project
pub fn load_sessions(
    project_path: &str,
    exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let base_path = get_base_path().ok_or_else(|| "OpenCode not found".to_string())?;
    load_sessions_at(
        &base_path,
        OPENCODE_DB_FILE,
        project_path,
        exclude_sidechain,
    )
}

/// [`load_sessions`], recording in `report` what it could not read.
pub(crate) fn load_sessions_reporting(
    project_path: &str,
    report: &ScanReport,
) -> Result<Vec<ClaudeSession>, String> {
    let base_path = get_base_path().ok_or_else(|| "OpenCode not found".to_string())?;
    load_sessions_at_reporting(&base_path, OPENCODE_DB_FILE, project_path, report)
}

/// [`load_sessions`] against an explicit store root and database file.
pub fn load_sessions_at(
    base_path: &str,
    db_file: &str,
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    load_sessions_at_reporting(base_path, db_file, project_path, &ScanReport::default())
}

/// [`load_sessions_at`], recording in `report` a database that is there but
/// cannot be read and the JSON session files it could not read.
pub(crate) fn load_sessions_at_reporting(
    base_path: &str,
    db_file: &str,
    project_path: &str,
    report: &ScanReport,
) -> Result<Vec<ClaudeSession>, String> {
    let storage_path = Path::new(&base_path).join("storage");

    let project_ref = OpenCodeProjectRef::parse(project_path)?;
    let project_id = project_ref.storage_id().to_string();

    let mut sessions = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    // 1. Read from SQLite
    if let Some(db_sessions) = load_sessions_from_db(base_path, db_file, &project_ref, report) {
        for s in db_sessions {
            seen_ids.insert(s.actual_session_id.clone());
            sessions.push(s);
        }
    }

    // 2. Read from JSON files
    let sessions_dir = storage_path.join("session").join(&project_id);
    if !project_ref.is_virtual_global_directory()
        && is_non_symlink_dir_reporting(&sessions_dir, report)
    {
        for entry in fs::read_dir(&sessions_dir)
            .map_err(|e| e.to_string())?
            .filter_map(|entry| report.read(&sessions_dir, entry))
        {
            if entry.file_type().map_or(true, |ft| ft.is_symlink()) {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }

            let Some(content) = report.read_to_string(&path) else {
                continue;
            };

            let val: Value = match serde_json::from_str(&content) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let session_id = val
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            if session_id.is_empty() || !is_safe_storage_id(&session_id) {
                continue;
            }

            if seen_ids.contains(&session_id) {
                continue;
            }

            let title = val.get("title").and_then(|v| v.as_str()).map(String::from);

            let time_obj = val.get("time");
            let created_at = time_obj
                .and_then(|t| t.get("created"))
                .and_then(Value::as_u64)
                .map(epoch_ms_to_rfc3339)
                .unwrap_or_default();
            let updated_at = time_obj
                .and_then(|t| t.get("updated"))
                .and_then(Value::as_u64)
                .map(epoch_ms_to_rfc3339)
                .unwrap_or_else(|| created_at.clone());

            let messages_dir = storage_path.join("message").join(&session_id);
            let message_count = if is_non_symlink_dir(&messages_dir) {
                fs::read_dir(&messages_dir)
                    .map(|entries| {
                        entries
                            .flatten()
                            .filter(|e| {
                                if e.file_type().map_or(true, |ft| ft.is_symlink()) {
                                    return false;
                                }
                                e.path().extension().and_then(|ext| ext.to_str()) == Some("json")
                            })
                            .count()
                    })
                    .unwrap_or(0)
            } else {
                0
            };

            sessions.push(ClaudeSession {
                session_id: format!("opencode://{session_id}"),
                actual_session_id: session_id,
                file_path: format!(
                    "opencode://{project_id}/{}",
                    path.file_stem().unwrap_or_default().to_string_lossy()
                ),
                project_name: String::new(),
                message_count,
                first_message_time: created_at.clone(),
                last_message_time: updated_at.clone(),
                last_modified: updated_at,
                has_tool_use: false,
                has_errors: false,
                summary: title,
                is_renamed: false,
                provider: Some("opencode".to_string()),
                storage_type: Some("json".to_string()),
                entrypoint: None,
            });
        }
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

/// Child sessions of `session_id`, i.e. the subagent runs it spawned.
///
/// `OpenCode` has no sidechain files. A Task run is a row in `session` whose
/// `parent_id` points at its parent, so the parent→child link the `SubAgent`
/// panel draws has to come from the database (#560).
///
/// Newest first. Empty when the store is file-backed or the session has no
/// children.
pub struct ChildSession {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: usize,
}

pub fn load_child_sessions(project_id: &str, session_id: &str) -> Vec<ChildSession> {
    let Some(base_path) = get_base_path() else {
        return Vec::new();
    };
    load_child_sessions_from_db(&base_path, OPENCODE_DB_FILE, project_id, session_id)
}

/// [`load_child_sessions`] against an explicit store root, matching
/// `scan_projects_from_db` and friends so it can be exercised on a fixture.
pub fn load_child_sessions_from_db(
    base_path: &str,
    db_file: &str,
    project_id: &str,
    session_id: &str,
) -> Vec<ChildSession> {
    let Some(conn) = open_db(base_path, db_file) else {
        return Vec::new();
    };
    let Some(schema) = StoreSchema::read(&conn).ok() else {
        return Vec::new();
    };
    let Some(sessions) = schema.sessions_sql() else {
        return Vec::new();
    };
    let message_count = schema.message_count_sql();
    let Ok(mut stmt) = conn.prepare(&format!(
        "SELECT s.id, s.title, s.time_created, s.time_updated,
                {message_count} AS message_count
         FROM ({sessions}) s
         WHERE s.parent_id = ?1 AND s.project_id = ?2
         ORDER BY s.time_created DESC"
    )) else {
        return Vec::new();
    };

    let Ok(rows) = stmt.query_map(rusqlite::params![session_id, project_id], |row| {
        Ok(ChildSession {
            id: row.get(0)?,
            title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            created_at: epoch_ms_to_rfc3339(row.get::<_, u64>(2)?),
            updated_at: epoch_ms_to_rfc3339(row.get::<_, u64>(3)?),
            message_count: row.get(4)?,
        })
    }) else {
        return Vec::new();
    };

    rows.filter_map(std::result::Result::ok).collect()
}

/// Load messages for an `OpenCode` session
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let base_path = get_base_path().ok_or_else(|| "OpenCode not found".to_string())?;
    load_messages_at(&base_path, OPENCODE_DB_FILE, session_path)
}

/// [`load_messages`] against an explicit store root and database file.
pub fn load_messages_at(
    base_path: &str,
    db_file: &str,
    session_path: &str,
) -> Result<Vec<ClaudeMessage>, String> {
    let storage_path = Path::new(&base_path).join("storage");

    // Extract session info from virtual path "opencode://{project_id}/{session_id}"
    let path_part = session_path
        .strip_prefix("opencode://")
        .unwrap_or(session_path);
    let parts: Vec<&str> = path_part.splitn(2, '/').collect();
    if parts.len() < 2 {
        return Err(format!("Invalid OpenCode session path: {session_path}"));
    }
    let project_id = parts[0];
    if !is_safe_storage_id(project_id) {
        return Err(format!("Invalid project_id in path: {session_path}"));
    }
    let session_id = parts[1];
    if !is_safe_storage_id(session_id) {
        return Err(format!("Invalid session_id in path: {session_path}"));
    }

    // Try SQLite first
    if let Some(db_messages) = load_messages_from_db(base_path, db_file, session_id) {
        if !db_messages.is_empty() {
            return Ok(db_messages);
        }
    }

    // Fall back to JSON files
    let messages_dir = storage_path.join("message").join(session_id);
    if !messages_dir.exists() {
        return Ok(vec![]);
    }

    let mut messages = Vec::new();

    // Collect and sort message files
    let mut msg_files: Vec<PathBuf> = fs::read_dir(&messages_dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|e| {
            if e.file_type().map_or(true, |ft| ft.is_symlink()) {
                return None;
            }
            Some(e.path())
        })
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("json"))
        .collect();
    msg_files.sort();

    for msg_path in &msg_files {
        let content = match fs::read_to_string(msg_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let val: Value = match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let msg_id = val
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let role = val.get("role").and_then(|v| v.as_str()).unwrap_or("user");

        // Timestamp is epoch ms under val["time"]["created"]
        let created_at = val
            .get("time")
            .and_then(|t| t.get("created"))
            .and_then(Value::as_u64)
            .map(epoch_ms_to_rfc3339)
            .unwrap_or_default();

        // Real field is "modelID", not "model"
        let model = val
            .get("modelID")
            .and_then(|v| v.as_str())
            .map(String::from);

        // parentID maps to parent_uuid
        let parent_uuid = val
            .get("parentID")
            .and_then(|v| v.as_str())
            .map(String::from);

        // Extract usage from val["tokens"]. Parts can contain additional
        // cache/reasoning fields, so the message-level value is merged below
        // instead of unconditionally winning.
        let usage = val.get("tokens").map(parse_opencode_token_usage);

        // Extract cost from val["cost"]
        let cost_usd = val.get("cost").and_then(Value::as_f64);

        if msg_id.is_empty() {
            continue;
        }
        if !is_safe_storage_id(&msg_id) {
            continue;
        }

        // Read parts for this message
        let parts_dir = storage_path.join("part").join(&msg_id);
        let part_values = if parts_dir.exists() {
            read_message_parts(&parts_dir)?
        } else {
            Vec::new()
        };

        let (content_value, parts_usage, parts_cost) =
            process_parts(&part_values, &msg_id, session_id);

        // Message-level input/output are aggregate values. Fill only missing
        // fields from parts so cache/reasoning usage is retained without
        // double-counting input/output.
        let final_usage = merge_token_usage(usage, parts_usage);
        let final_cost = cost_usd.or(parts_cost);

        let message_type = match role {
            "assistant" => "assistant",
            "system" => "system",
            _ => "user",
        };

        messages.push(ClaudeMessage {
            uuid: msg_id,
            parent_uuid,
            session_id: session_id.to_string(),
            timestamp: created_at,
            message_type: message_type.to_string(),
            content: content_value,
            usage: final_usage,
            role: Some(role.to_string()),
            model,
            cost_usd: final_cost,
            provider: Some("opencode".to_string()),
            ..Default::default()
        });
    }

    Ok(messages)
}

/// Search `OpenCode` sessions for a query string
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let base_path = get_base_path().ok_or_else(|| "OpenCode not found".to_string())?;
    search_at(&base_path, OPENCODE_DB_FILE, query, limit)
}

/// [`search`] against an explicit store root and database file.
pub fn search_at(
    base_path: &str,
    db_file: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<ClaudeMessage>, String> {
    let storage_path = Path::new(&base_path).join("storage");
    let session_root = storage_path.join("session");

    let query_lower = query.to_lowercase();
    let mut results = Vec::new();
    let mut searched_sessions: HashSet<String> = HashSet::new();

    // 1. Search SQLite
    if let Some((db_results, db_session_ids)) =
        search_from_db(base_path, db_file, &query_lower, limit)
    {
        searched_sessions.extend(db_session_ids);
        results.extend(db_results);
        if results.len() >= limit {
            results.truncate(limit);
            return Ok(results);
        }
    }

    // 2. Search JSON files (skip sessions already covered by SQLite)
    if !is_non_symlink_dir(&session_root) {
        return Ok(results);
    }

    for project_entry in fs::read_dir(&session_root)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        if project_entry.file_type().map_or(true, |ft| ft.is_symlink()) {
            continue;
        }
        let project_id = project_entry.file_name().to_string_lossy().to_string();
        if !is_safe_storage_id(&project_id) {
            continue;
        }

        for session_entry in fs::read_dir(project_entry.path())
            .into_iter()
            .flatten()
            .flatten()
        {
            if session_entry.file_type().map_or(true, |ft| ft.is_symlink()) {
                continue;
            }
            let session_path = session_entry.path();
            if session_path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }

            let session_id = session_path
                .file_stem()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            // Skip sessions already searched from SQLite
            if searched_sessions.contains(&session_id) {
                continue;
            }

            let virtual_path = format!("opencode://{project_id}/{session_id}");

            if let Ok(messages) = load_messages_at(base_path, db_file, &virtual_path) {
                for msg in messages {
                    if results.len() >= limit {
                        return Ok(results);
                    }

                    if let Some(content) = &msg.content {
                        if super::result_evidence::content_matches(content, &query_lower) {
                            results.push(msg);
                        }
                    }
                }
            }
        }
    }

    Ok(results)
}

/// Check that a path is a real directory (not a symlink).
fn is_non_symlink_dir(path: &Path) -> bool {
    is_non_symlink_dir_reporting(path, &ScanReport::default())
}

/// [`is_non_symlink_dir`], recording in `report` a path that may not be
/// looked at.
fn is_non_symlink_dir_reporting(path: &Path, report: &ScanReport) -> bool {
    report
        .symlink_metadata(path)
        .is_some_and(|m| m.file_type().is_dir() && !m.file_type().is_symlink())
}

// ============================================================================
// SQLite helpers
// ============================================================================

/// Escape `%`, `_`, and `\` for use in a `SQLite` LIKE pattern with `ESCAPE '\'`.
fn escape_like_pattern(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// Build a map of `project_id -> HashSet<session_id>` from the `SQLite` DB.
/// Opens a single connection and queries all sessions at once.
fn build_db_session_map(
    base_path: &str,
    db_file: &str,
) -> Option<std::collections::HashMap<String, HashSet<String>>> {
    let conn = open_db(base_path, db_file)?;
    let sessions = StoreSchema::read(&conn).ok()?.sessions_sql()?;
    let mut stmt = conn
        .prepare(&format!("SELECT project_id, id FROM ({sessions})"))
        .ok()?;
    let rows = stmt
        .query_map([], |row| {
            let project_id: String = row.get(0)?;
            let session_id: String = row.get(1)?;
            Ok((project_id, session_id))
        })
        .ok()?;

    let mut map: std::collections::HashMap<String, HashSet<String>> =
        std::collections::HashMap::new();
    for row in rows.flatten() {
        map.entry(row.0).or_default().insert(row.1);
    }
    Some(map)
}

/// Count JSON session files, excluding those present in `exclude_ids`.
/// If `exclude_ids` is `None`, counts all JSON sessions.
fn count_json_sessions_excluding(
    sessions_dir: &Path,
    exclude_ids: Option<&HashSet<String>>,
) -> usize {
    if !is_non_symlink_dir(sessions_dir) {
        return 0;
    }
    fs::read_dir(sessions_dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| {
                    if e.file_type().map_or(true, |ft| ft.is_symlink()) {
                        return false;
                    }
                    let path = e.path();
                    if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                        return false;
                    }
                    if let Some(ids) = exclude_ids {
                        let session_id = path
                            .file_stem()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default();
                        !ids.contains(&session_id)
                    } else {
                        true
                    }
                })
                .count()
        })
        .unwrap_or(0)
}

/// `SQLite` database file name for the `OpenCode` store. Kilo Code reuses the
/// OpenCode-core reader against its own store root and `kilo.db`.
pub const OPENCODE_DB_FILE: &str = "opencode.db";

/// Open the `OpenCode` `SQLite` database in read-only mode.
fn open_db(base_path: &str, db_file: &str) -> Option<Connection> {
    open_db_reporting(base_path, db_file, &ScanReport::default())
}

/// [`open_db`], recording in `report` a database that is there but cannot
/// be opened. No database file (a JSON-only store) is nothing to read.
fn open_db_reporting(base_path: &str, db_file: &str, report: &ScanReport) -> Option<Connection> {
    let db_path = Path::new(base_path).join(db_file);
    let meta = report.symlink_metadata(&db_path)?;
    if !meta.file_type().is_file() {
        return None;
    }
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = report.db(&db_path, Connection::open_with_flags(&db_path, flags))?;
    report.db(
        &db_path,
        conn.busy_timeout(std::time::Duration::from_secs(1)),
    )?;
    Some(conn)
}

/// Which session stores an `OpenCode`-core database carries.
///
/// `OpenCode` 1.x wrote `session` / `message` / `part`. 2.x writes
/// `session_v2` / `session_message` (assistant content inline, or split into
/// `session_part` rows), migrating 1.x sessions on first start but leaving the
/// old tables in place. A database can hold either set or both, and a session
/// id can be in both, in which case the 2.x copy is the one that keeps growing.
#[derive(Debug, Clone, Copy, Default)]
#[allow(clippy::struct_excessive_bools)] // one flag per table, not a state machine
struct StoreSchema {
    v1_sessions: bool,
    v1_messages: bool,
    v1_parts: bool,
    v2_sessions: bool,
    v2_parts: bool,
    /// `session_part` is there but not in a shape this reader knows, so 2.x
    /// assistant content may be missing.
    v2_parts_unreadable: bool,
    blobs: bool,
}

const SESSION_COLUMNS: &str =
    "id, project_id, parent_id, title, directory, time_created, time_updated";

/// `session_message` types that become transcript messages. The rest
/// (`system` instruction notices, `idle`, `model-switched`,
/// `location-switched`) are harness bookkeeping.
const V2_TRANSCRIPT_TYPES: &str = "'user', 'assistant', 'shell', 'synthetic', 'compaction'";

impl StoreSchema {
    fn read(conn: &Connection) -> rusqlite::Result<Self> {
        let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")?;
        let names: HashSet<String> = stmt
            .query_map([], |row| row.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        let has = |name: &str| names.contains(name);
        // The 2.x tables are still changing upstream. Probe the columns read
        // here so a reshaped table falls back to the 1.x store instead of
        // failing every query that unions the two.
        let probes = |sql: &str| conn.prepare(sql).is_ok();
        let v2_sessions = has("session_v2")
            && has("session_message")
            && probes(&format!("SELECT {SESSION_COLUMNS} FROM session_v2 LIMIT 0"))
            && probes(
                "SELECT id, session_id, type, seq, time_created, data FROM session_message LIMIT 0",
            );
        let parts_table = v2_sessions && has("session_part");
        let v2_parts = parts_table
            && probes(
                "SELECT message_id, session_id, ordinal, type, call_id, data FROM session_part LIMIT 0",
            );
        Ok(Self {
            v1_sessions: has("session"),
            v1_messages: has("message"),
            v1_parts: has("part"),
            v2_sessions,
            v2_parts,
            v2_parts_unreadable: parts_table && !v2_parts,
            blobs: has("blob"),
        })
    }

    /// One row per session, with a `store` column (1 or 2) saying which
    /// tables it came from. A session in both stores is listed once, from 2.x.
    fn sessions_sql(self) -> Option<String> {
        let v2 = format!("SELECT {SESSION_COLUMNS}, 2 AS store FROM session_v2");
        let v1 = format!("SELECT {SESSION_COLUMNS}, 1 AS store FROM session");
        match (self.v2_sessions, self.v1_sessions) {
            (true, true) => Some(format!(
                "{v2} UNION ALL {v1} WHERE NOT EXISTS \
                 (SELECT 1 FROM session_v2 v WHERE v.id = session.id)"
            )),
            (true, false) => Some(v2),
            (false, true) => Some(v1),
            (false, false) => None,
        }
    }

    /// Message count for a row `s` of [`Self::sessions_sql`].
    fn message_count_sql(self) -> String {
        let v2 = format!(
            "(SELECT COUNT(*) FROM session_message m
              WHERE m.session_id = s.id AND m.type IN ({V2_TRANSCRIPT_TYPES}))"
        );
        let v1 = "(SELECT COUNT(*) FROM message m WHERE m.session_id = s.id)".to_string();
        match (self.v2_sessions, self.v1_messages) {
            (true, true) => format!("CASE s.store WHEN 2 THEN {v2} ELSE {v1} END"),
            (true, false) => v2,
            (false, true) => v1,
            (false, false) => "0".to_string(),
        }
    }
}

fn scan_projects_from_db(
    base_path: &str,
    db_file: &str,
    report: &ScanReport,
) -> Option<Vec<ClaudeProject>> {
    let conn = open_db_reporting(base_path, db_file, report)?;
    let db_path = Path::new(base_path).join(db_file);
    let schema = report.db(&db_path, StoreSchema::read(&conn))?;
    let sessions = schema.sessions_sql()?;
    let mut stmt = report.db(
        &db_path,
        conn.prepare(&format!(
            "SELECT p.id, p.worktree, p.name, p.time_created, p.time_updated,
                    COALESCE(c.session_count, 0), c.last_updated
             FROM project p
             LEFT JOIN (
                 SELECT project_id, COUNT(*) AS session_count, MAX(time_updated) AS last_updated
                 FROM ({sessions})
                 GROUP BY project_id
             ) c ON c.project_id = p.id"
        )),
    )?;

    let rows: Vec<DbProjectRecord> = report
        .db(
            &db_path,
            stmt.query_map([], |row| {
                Ok(DbProjectRecord {
                    id: row.get(0)?,
                    worktree: row.get(1)?,
                    name: row.get(2)?,
                    time_created: row.get(3)?,
                    time_updated: row.get(4)?,
                    session_count: row.get(5)?,
                    last_session_update: row.get(6)?,
                })
            }),
        )?
        .filter_map(|row| report.db(&db_path, row))
        .collect();
    drop(stmt);

    let mut projects = Vec::new();
    for project in rows {
        if should_split_global_project(&project) {
            let directory_projects = scan_global_directory_projects(&conn, &sessions, &project);
            if !directory_projects.is_empty() {
                projects.extend(directory_projects);
                continue;
            }
        }

        let project_name =
            opencode_project_display_name(project.name.as_deref(), &project.worktree);
        let last_modified = epoch_ms_to_rfc3339(
            project
                .time_updated
                .max(project.time_created)
                .max(project.last_session_update.unwrap_or(0)),
        );

        projects.push(ClaudeProject {
            name: project_name,
            path: format!("opencode://{}", project.id),
            actual_path: project.worktree,
            session_count: project.session_count,
            message_count: 0,
            last_modified,
            git_info: None,
            provider: Some("opencode".to_string()),
            storage_type: Some("sqlite".to_string()),
            custom_directory_label: None,
        });
    }

    if projects.is_empty() {
        None
    } else {
        Some(projects)
    }
}

fn scan_global_directory_projects(
    conn: &Connection,
    sessions: &str,
    project: &DbProjectRecord,
) -> Vec<ClaudeProject> {
    let mut stmt = match conn.prepare(&format!(
        "SELECT s.directory AS directory,
                COUNT(*) AS session_count,
                MIN(s.time_created) AS first_created,
                MAX(s.time_updated) AS last_updated
         FROM ({sessions}) s
         WHERE s.project_id = ?1
         GROUP BY s.directory"
    )) {
        Ok(stmt) => stmt,
        Err(_) => return Vec::new(),
    };

    let rows = match stmt.query_map(rusqlite::params![&project.id], |row| {
        let directory: String = row.get(0)?;
        let session_count: usize = row.get(1)?;
        let first_created: Option<u64> = row.get(2)?;
        let last_updated: Option<u64> = row.get(3)?;
        Ok((directory, session_count, first_created, last_updated))
    }) {
        Ok(rows) => rows,
        Err(_) => return Vec::new(),
    };

    rows.filter_map(std::result::Result::ok)
        .filter(|(_, session_count, _, _)| *session_count > 0)
        .map(|(directory, session_count, first_created, last_updated)| {
            let actual_path = if directory.trim().is_empty() {
                project.worktree.clone()
            } else {
                directory.trim().to_string()
            };
            let project_id = global_directory_project_id(directory.trim());
            let last_modified = epoch_ms_to_rfc3339(
                last_updated
                    .unwrap_or(project.time_updated)
                    .max(first_created.unwrap_or(project.time_created)),
            );

            ClaudeProject {
                name: opencode_project_display_name(None, &actual_path),
                path: format!("opencode://{project_id}"),
                actual_path,
                session_count,
                message_count: 0,
                last_modified,
                git_info: None,
                provider: Some("opencode".to_string()),
                storage_type: Some("sqlite".to_string()),
                custom_directory_label: None,
            }
        })
        .collect()
}

fn load_sessions_from_db(
    base_path: &str,
    db_file: &str,
    project_ref: &OpenCodeProjectRef,
    report: &ScanReport,
) -> Option<Vec<ClaudeSession>> {
    let conn = open_db_reporting(base_path, db_file, report)?;
    let db_path = Path::new(base_path).join(db_file);
    let schema = report.db(&db_path, StoreSchema::read(&conn))?;
    let sessions = schema.sessions_sql()?;
    let message_count = schema.message_count_sql();
    let mut stmt = report.db(
        &db_path,
        conn.prepare(&format!(
            "SELECT s.id, s.title, s.time_created, s.time_updated, s.directory,
                    {message_count} AS message_count
             FROM ({sessions}) s
             WHERE s.project_id = ?1"
        )),
    )?;

    let rows = stmt.query_map([project_ref.storage_id()], |row| {
        let session_id: String = row.get(0)?;
        let title: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
        let time_created: u64 = row.get(2)?;
        let time_updated: u64 = row.get(3)?;
        let directory: String = row.get(4)?;
        let message_count: usize = row.get(5)?;

        let created_at = epoch_ms_to_rfc3339(time_created);
        let updated_at = epoch_ms_to_rfc3339(time_updated);
        let project_name = if project_ref.is_virtual_global_directory() {
            opencode_project_display_name(None, &directory)
        } else {
            String::new()
        };

        Ok((
            directory,
            ClaudeSession {
                session_id: format!("opencode://{session_id}"),
                actual_session_id: session_id.clone(),
                file_path: format!("opencode://{}/{session_id}", project_ref.storage_id()),
                project_name,
                message_count,
                first_message_time: created_at.clone(),
                last_message_time: updated_at.clone(),
                last_modified: updated_at,
                has_tool_use: false,
                has_errors: false,
                summary: if title.is_empty() { None } else { Some(title) },
                is_renamed: false,
                provider: Some("opencode".to_string()),
                storage_type: Some("sqlite".to_string()),
                entrypoint: None,
            },
        ))
    });
    let rows = report.db(&db_path, rows)?;

    let sessions: Vec<ClaudeSession> = rows
        .filter_map(|row| report.db(&db_path, row))
        .filter(|(directory, _)| project_ref.matches_directory(directory))
        .map(|(_, session)| session)
        .collect();
    if sessions.is_empty() {
        None
    } else {
        Some(sessions)
    }
}

fn load_messages_from_db(
    base_path: &str,
    db_file: &str,
    session_id: &str,
) -> Option<Vec<ClaudeMessage>> {
    let conn = open_db(base_path, db_file)?;
    load_messages_with_conn(&conn, session_id)
}

fn load_messages_with_conn(conn: &Connection, session_id: &str) -> Option<Vec<ClaudeMessage>> {
    let schema = StoreSchema::read(conn).ok()?;
    if schema.v2_sessions && is_v2_session(conn, session_id)? {
        // A migrated session still has its 1.x copy; better that than an
        // empty transcript if the 2.x rows can't be read. With an unreadable
        // `session_part` the 2.x copy may be missing its replies, so the 1.x
        // copy goes first.
        if schema.v2_parts_unreadable {
            return load_v1_messages_with_conn(conn, session_id)
                .or_else(|| load_v2_messages(conn, schema, session_id));
        }
        return load_v2_messages(conn, schema, session_id)
            .or_else(|| load_v1_messages_with_conn(conn, session_id));
    }
    load_v1_messages_with_conn(conn, session_id)
}

/// `None` when the lookup itself failed (busy, I/O), so a 2.x session is
/// never quietly read from a stale 1.x copy.
fn is_v2_session(conn: &Connection, session_id: &str) -> Option<bool> {
    use rusqlite::OptionalExtension;
    conn.query_row(
        "SELECT 1 FROM session_v2 WHERE id = ?1",
        [session_id],
        |_| Ok(()),
    )
    .optional()
    .ok()
    .map(|row| row.is_some())
}

/// Messages of an `OpenCode` 2.x session, in `seq` order.
fn load_v2_messages(
    conn: &Connection,
    schema: StoreSchema,
    session_id: &str,
) -> Option<Vec<ClaudeMessage>> {
    // `OpenCode` moves inline content into `session_part` as it goes. One
    // read transaction keeps both queries on the same snapshot, so a move
    // between them can't drop a reply. Dropping it ends the read.
    let _snapshot = conn.unchecked_transaction().ok();
    let mut parts_by_message: HashMap<String, Vec<Value>> = HashMap::new();
    if schema.v2_parts {
        let mut stmt = conn
            .prepare(
                "SELECT message_id, type, call_id, data FROM session_part
                 WHERE session_id = ?1
                 ORDER BY message_id, ordinal",
            )
            .ok()?;
        let rows = stmt
            .query_map([session_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .ok()?;
        for (message_id, part_type, call_id, data) in rows.flatten() {
            let Ok(Value::Object(mut fields)) = serde_json::from_str::<Value>(&data) else {
                continue;
            };
            // `OpenCode` keeps the part's type (and a tool's call id) in
            // columns and may leave them out of `data`.
            fields.insert("type".to_string(), Value::String(part_type));
            if let Some(call_id) = call_id {
                fields.entry("id").or_insert_with(|| Value::String(call_id));
            }
            parts_by_message
                .entry(message_id)
                .or_default()
                .push(Value::Object(fields));
        }
    }

    let mut stmt = conn
        .prepare(&format!(
            "SELECT id, type, time_created, data FROM session_message
             WHERE session_id = ?1 AND type IN ({V2_TRANSCRIPT_TYPES})
             ORDER BY seq"
        ))
        .ok()?;
    let rows = stmt
        .query_map([session_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, u64>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .ok()?;

    let media = Media {
        conn: schema.blobs.then_some(conn),
    };
    let mut messages = Vec::new();
    for (message_id, message_type, time_created, data) in rows.flatten() {
        let Ok(Value::Object(mut fields)) = serde_json::from_str::<Value>(&data) else {
            continue;
        };
        if let Some(parts) = parts_by_message.remove(&message_id) {
            // Same order `OpenCode` reads them back in: split parts, then any
            // content still inline on the row.
            let inline = fields
                .get("content")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            fields.insert(
                "content".to_string(),
                Value::Array(parts.into_iter().chain(inline).collect()),
            );
        }
        let data = Value::Object(fields);
        if let Some(message) = convert_v2_message(
            &message_id,
            &message_type,
            time_created,
            &data,
            session_id,
            &media,
        ) {
            messages.push(message);
        }
    }

    if messages.is_empty() {
        None
    } else {
        Some(messages)
    }
}

/// Resolves the media a 2.x row points at: inline `data:` URIs, and `media:`
/// refs into the `blob` table (`OpenCode` moves large attachments there).
struct Media<'a> {
    conn: Option<&'a Connection>,
}

impl Media<'_> {
    /// Base64 bytes behind `uri`, or `None` when it is neither form or the
    /// blob is gone.
    fn base64(&self, uri: &str) -> Option<String> {
        if let Some(rest) = uri.strip_prefix("data:") {
            return rest
                .split_once(";base64,")
                .map(|(_, data)| data.to_string());
        }
        let hash = uri.strip_prefix("media:")?;
        if hash.is_empty() || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let bytes: Vec<u8> = self
            .conn?
            .query_row("SELECT data FROM blob WHERE hash = ?1", [hash], |row| {
                row.get(0)
            })
            .ok()?;
        Some(base64::engine::general_purpose::STANDARD.encode(bytes))
    }
}

fn str_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// An attached file as a content block: the image itself when the bytes are
/// there, otherwise a `[File] ...` line. Tool output files carry only `uri`
/// and `mime`, so those stand in for a missing name.
fn v2_file_block(file: &Value, media: &Media) -> Option<Value> {
    let mime = str_field(file, "mime").unwrap_or("");
    let uri = str_field(file, "uri").unwrap_or("");
    let name = str_field(file, "name")
        .or_else(|| str_field(file, "filename"))
        .unwrap_or("");
    if mime.starts_with("image/") {
        let data = str_field(file, "data")
            .map(|d| {
                d.split_once(";base64,")
                    .map_or(d, |(_, rest)| rest)
                    .to_string()
            })
            .or_else(|| media.base64(uri));
        if let Some(data) = data {
            return Some(serde_json::json!({
                "type": "image",
                "source": { "type": "base64", "media_type": mime, "data": data }
            }));
        }
        if uri.starts_with("http://") || uri.starts_with("https://") {
            return Some(serde_json::json!({
                "type": "image",
                "source": { "type": "url", "url": uri }
            }));
        }
    }
    let label = if !name.is_empty() {
        name.to_string()
    } else if !uri.is_empty() && !uri.starts_with("data:") && !uri.starts_with("media:") {
        uri.to_string()
    } else if !mime.is_empty() {
        format!("({mime})")
    } else {
        return None;
    };
    Some(serde_json::json!({ "type": "text", "text": format!("[File] {label}") }))
}

fn v2_error_text(error: &Value) -> Option<String> {
    let text = match error {
        Value::String(s) => s.clone(),
        Value::Null => return None,
        other => str_field(other, "message")
            .map(str::to_string)
            .unwrap_or_else(|| other.to_string()),
    };
    (!text.is_empty()).then_some(text)
}

/// What a finished 2.x tool call returned. Text-only output collapses to one
/// string, matching the 1.x `state.output` the renderers already handle.
fn v2_tool_output(state: &Value, media: &Media) -> Value {
    let Some(items) = state.get("content").and_then(Value::as_array) else {
        return state
            .get("output")
            .cloned()
            .unwrap_or_else(|| Value::String(String::new()));
    };
    let mut blocks = Vec::new();
    let mut texts = Vec::new();
    let mut text_only = true;
    for item in items {
        match str_field(item, "type") {
            Some("text") => {
                let text = str_field(item, "text").unwrap_or("");
                texts.push(text.to_string());
                blocks.push(serde_json::json!({ "type": "text", "text": text }));
            }
            Some("file") => {
                if let Some(block) = v2_file_block(item, media) {
                    text_only &= block["type"] == "text";
                    if let Some(text) = block["text"].as_str() {
                        texts.push(text.to_string());
                    }
                    blocks.push(block);
                }
            }
            _ => {}
        }
    }
    if text_only {
        Value::String(texts.join("\n"))
    } else {
        Value::Array(blocks)
    }
}

/// 2.x assistant content (`reasoning`, `text`, `tool`) as content blocks.
fn v2_assistant_blocks(
    content: &[Value],
    message_id: &str,
    session_id: &str,
    media: &Media,
) -> Vec<Value> {
    let mut blocks = Vec::new();
    for (part_index, part) in content.iter().enumerate() {
        match str_field(part, "type").unwrap_or("") {
            "text" => {
                let text = str_field(part, "text").unwrap_or("");
                if !text.is_empty() {
                    blocks.push(serde_json::json!({ "type": "text", "text": text }));
                }
            }
            "reasoning" => {
                let text = str_field(part, "text").unwrap_or("");
                if !text.is_empty() {
                    blocks.push(serde_json::json!({ "type": "thinking", "thinking": text }));
                }
            }
            "tool" => {
                let raw_name = str_field(part, "name").unwrap_or("unknown");
                let tool_name = normalize_opencode_tool_name(raw_name);
                let tool_id = str_field(part, "id").unwrap_or("").to_string();
                let state = part.get("state").cloned().unwrap_or(Value::Null);
                let mut input = state
                    .get("input")
                    .cloned()
                    .unwrap_or_else(|| Value::Object(serde_json::Map::default()));
                if raw_name == "subagent" {
                    if let Value::Object(fields) = &mut input {
                        move_input_key(fields, "agent", "subagent_type");
                    }
                }
                blocks.push(serde_json::json!({
                    "type": "tool_use",
                    "id": tool_id,
                    "name": tool_name,
                    "rawToolName": part.get("name"),
                    "input": normalize_opencode_tool_input(tool_name, input)
                }));

                let (result, is_error) = match str_field(&state, "status").unwrap_or("") {
                    "completed" => (v2_tool_output(&state, media), false),
                    status @ ("error" | "cancelled") => {
                        let text = state
                            .get("error")
                            .and_then(v2_error_text)
                            .unwrap_or_else(|| format!("Tool execution failed: {status}"));
                        (Value::String(text), true)
                    }
                    _ => continue,
                };
                let mut tool_result = serde_json::json!({
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": result
                });
                if is_error {
                    tool_result["is_error"] = Value::Bool(true);
                }
                super::result_evidence::attach(
                    &mut tool_result,
                    &state,
                    message_id,
                    session_id,
                    blocks.len(),
                );
                tool_result["toolUseResultSource"]["partIndex"] = Value::from(part_index);
                blocks.push(tool_result);
            }
            _ => {}
        }
    }
    blocks
}

/// The per-step summary card 1.x drew from `step-finish` parts. A 2.x
/// assistant row is one step, so it carries the same numbers itself.
fn v2_step_block(data: &Value) -> Option<Value> {
    let reason = str_field(data, "finish")?;
    let usage = data
        .get("tokens")
        .map(parse_opencode_token_usage)
        .unwrap_or_default();
    let snapshot: String = data
        .get("snapshot")
        .and_then(|s| str_field(s, "end"))
        .unwrap_or("")
        .chars()
        .take(8)
        .collect();
    Some(serde_json::json!({
        "type": "opencode_step",
        "reason": reason,
        "snapshot": snapshot,
        "cost": data.get("cost").and_then(Value::as_f64).unwrap_or(0.0),
        "tokens": {
            "input": usage.input_tokens.unwrap_or(0),
            "output": usage.output_tokens.unwrap_or(0),
            "reasoning": usage.reasoning_tokens.unwrap_or(0),
            "cache_read": usage.cache_read_input_tokens.unwrap_or(0),
            "cache_write": usage.cache_creation_input_tokens.unwrap_or(0)
        }
    }))
}

fn convert_v2_message(
    message_id: &str,
    message_type: &str,
    time_created: u64,
    data: &Value,
    session_id: &str,
    media: &Media,
) -> Option<ClaudeMessage> {
    let created = data
        .get("time")
        .and_then(|t| t.get("created"))
        .and_then(Value::as_u64)
        .unwrap_or(time_created);
    let mut message = ClaudeMessage {
        uuid: message_id.to_string(),
        session_id: session_id.to_string(),
        timestamp: epoch_ms_to_rfc3339(created),
        provider: Some("opencode".to_string()),
        ..Default::default()
    };

    let mut blocks: Vec<Value> = Vec::new();
    match message_type {
        "user" => {
            message.message_type = "user".to_string();
            message.role = Some("user".to_string());
            if let Some(text) = str_field(data, "text").filter(|t| !t.is_empty()) {
                blocks.push(serde_json::json!({ "type": "text", "text": text }));
            }
            for file in data
                .get("files")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                blocks.extend(v2_file_block(file, media));
            }
        }
        "assistant" => {
            message.message_type = "assistant".to_string();
            message.role = Some("assistant".to_string());
            message.model = data
                .get("model")
                .and_then(|m| str_field(m, "id"))
                .map(str::to_string);
            message.usage = data.get("tokens").map(parse_opencode_token_usage);
            message.cost_usd = data.get("cost").and_then(Value::as_f64);
            if let Some(content) = data.get("content").and_then(Value::as_array) {
                blocks = v2_assistant_blocks(content, message_id, session_id, media);
            }
            if let Some(error) = data.get("error").and_then(v2_error_text) {
                blocks.push(
                    serde_json::json!({ "type": "text", "text": format!("[Error] {error}") }),
                );
            }
            blocks.extend(v2_step_block(data));
        }
        // Harness-inserted text (background shell output, subagent results,
        // goal notices): shown, but not as something the user typed.
        "synthetic" => {
            message.message_type = "system".to_string();
            message.role = Some("system".to_string());
            let text = str_field(data, "text").unwrap_or("");
            if text.is_empty() {
                return None;
            }
            message.content = Some(Value::String(text.to_string()));
            return Some(message);
        }
        // A command the user ran themselves (`!cmd`). Its completion notice
        // only reaches `session_message` once another prompt is sent, so this
        // row can be the only record of the command and its output.
        "shell" => {
            message.message_type = "user".to_string();
            message.role = Some("user".to_string());
            let call_id = str_field(data, "shellID").unwrap_or(message_id).to_string();
            blocks.push(serde_json::json!({
                "type": "tool_use",
                "id": call_id,
                "name": "Bash",
                "rawToolName": "shell",
                "input": { "command": str_field(data, "command").unwrap_or("") }
            }));
            let status = str_field(data, "status").unwrap_or("");
            if status != "running" {
                let output = data
                    .get("output")
                    .and_then(|o| str_field(o, "output"))
                    .unwrap_or("");
                let mut result = serde_json::json!({
                    "type": "tool_result",
                    "tool_use_id": call_id,
                    "content": output,
                    "toolUseResult": { "status": status }
                });
                if let Some(exit) = data.get("exit").filter(|e| e.is_number()) {
                    result["toolUseResult"]["exit"] = exit.clone();
                }
                // The stored output is a page of the command's capture; keep
                // the flag so a cut-off output isn't read as the whole thing.
                if let Some(truncated) = data
                    .get("output")
                    .and_then(|o| o.get("truncated"))
                    .filter(|t| t.is_boolean())
                {
                    result["toolUseResult"]["truncated"] = truncated.clone();
                }
                blocks.push(result);
            }
        }
        // The usage is the compaction request's own, so it counts toward the
        // session's totals like any other model call.
        "compaction" => {
            message.message_type = "system".to_string();
            message.role = Some("system".to_string());
            message.model = data
                .get("model")
                .and_then(|m| str_field(m, "id"))
                .map(str::to_string);
            message.usage = data.get("tokens").map(parse_opencode_token_usage);
            message.cost_usd = data.get("cost").and_then(Value::as_f64);
            let trigger = str_field(data, "reason").unwrap_or("auto");
            match str_field(data, "status").unwrap_or("completed") {
                "failed" => {
                    message.level = Some("error".to_string());
                    let error = data
                        .get("error")
                        .and_then(v2_error_text)
                        .unwrap_or_else(|| "unknown error".to_string());
                    message.content = Some(Value::String(format!(
                        "Context compaction ({trigger}) failed: {error}"
                    )));
                }
                "running" => {
                    message.level = Some("info".to_string());
                    message.content = Some(Value::String(format!(
                        "Context compaction ({trigger}) in progress"
                    )));
                }
                _ => {
                    message.subtype = Some("compact_boundary".to_string());
                    message.level = Some("info".to_string());
                    message.compact_metadata = Some(serde_json::json!({ "trigger": trigger }));
                    message.content = Some(Value::String(
                        str_field(data, "summary").unwrap_or("").to_string(),
                    ));
                }
            }
            return Some(message);
        }
        _ => return None,
    }

    message.content = (!blocks.is_empty()).then_some(Value::Array(blocks));
    Some(message)
}

fn load_v1_messages_with_conn(conn: &Connection, session_id: &str) -> Option<Vec<ClaudeMessage>> {
    let mut msg_stmt = conn
        .prepare(
            "SELECT id, data FROM message
             WHERE session_id = ?1
             ORDER BY time_created, id",
        )
        .ok()?;

    let mut part_stmt = conn
        .prepare(
            "SELECT data FROM part
             WHERE message_id = ?1
             ORDER BY id",
        )
        .ok()?;

    let msg_rows = msg_stmt
        .query_map([session_id], |row| {
            let msg_id: String = row.get(0)?;
            let data_json: String = row.get(1)?;
            Ok((msg_id, data_json))
        })
        .ok()?;

    let mut messages = Vec::new();

    for msg_row in msg_rows.flatten() {
        let (msg_id, data_json) = msg_row;

        let val: Value = match serde_json::from_str(&data_json) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let role = val.get("role").and_then(|v| v.as_str()).unwrap_or("user");

        let created_at = val
            .get("time")
            .and_then(|t| t.get("created"))
            .and_then(Value::as_u64)
            .map(epoch_ms_to_rfc3339)
            .unwrap_or_default();

        let model = val
            .get("modelID")
            .and_then(|v| v.as_str())
            .map(String::from);

        let parent_uuid = val
            .get("parentID")
            .and_then(|v| v.as_str())
            .map(String::from);

        let usage = val.get("tokens").map(parse_opencode_token_usage);

        let cost_usd = val.get("cost").and_then(Value::as_f64);

        let part_rows = part_stmt.query_map([&msg_id], |row| {
            let part_data: String = row.get(0)?;
            Ok(part_data)
        });

        let part_values: Vec<Value> = match part_rows {
            Ok(rows) => rows
                .flatten()
                .filter_map(|data| serde_json::from_str(&data).ok())
                .collect(),
            Err(_) => Vec::new(),
        };

        let (content_value, parts_usage, parts_cost) =
            process_parts(&part_values, &msg_id, session_id);

        let final_usage = merge_token_usage(usage, parts_usage);
        let final_cost = cost_usd.or(parts_cost);

        let message_type = match role {
            "assistant" => "assistant",
            "system" => "system",
            _ => "user",
        };

        messages.push(ClaudeMessage {
            uuid: msg_id,
            parent_uuid,
            session_id: session_id.to_string(),
            timestamp: created_at,
            message_type: message_type.to_string(),
            content: content_value,
            usage: final_usage,
            role: Some(role.to_string()),
            model,
            cost_usd: final_cost,
            provider: Some("opencode".to_string()),
            ..Default::default()
        });
    }

    if messages.is_empty() {
        None
    } else {
        Some(messages)
    }
}

/// Returns `(matching_messages, searched_session_ids)` for dedup with JSON search.
fn search_from_db(
    base_path: &str,
    db_file: &str,
    query_lower: &str,
    limit: usize,
) -> Option<(Vec<ClaudeMessage>, HashSet<String>)> {
    let conn = open_db(base_path, db_file)?;
    let schema = StoreSchema::read(&conn).ok()?;

    let escaped = escape_like_pattern(query_lower);
    let search_pattern = format!("%{escaped}%");
    let mut queries: Vec<String> = Vec::new();
    if schema.v2_sessions {
        queries.push(format!(
            "SELECT session_id FROM session_message
             WHERE type IN ({V2_TRANSCRIPT_TYPES}) AND LOWER(data) LIKE ?1 ESCAPE '\\'"
        ));
        if schema.v2_parts {
            queries.push(
                "SELECT session_id FROM session_part WHERE LOWER(data) LIKE ?1 ESCAPE '\\'"
                    .to_string(),
            );
        }
    }
    if schema.v1_parts {
        // Migrated sessions stay candidates too: the loader below decides
        // which copy is shown, and only what it shows is matched.
        queries
            .push("SELECT session_id FROM part WHERE LOWER(data) LIKE ?1 ESCAPE '\\'".to_string());
    }
    if queries.is_empty() {
        return None;
    }
    let mut stmt = conn
        .prepare(&format!(
            "SELECT DISTINCT session_id FROM ({})",
            queries.join(" UNION ALL ")
        ))
        .ok()?;

    let session_ids: Vec<String> = stmt
        .query_map(rusqlite::params![&search_pattern], |row| row.get(0))
        .ok()?
        .filter_map(std::result::Result::ok)
        .collect();
    drop(stmt);

    if session_ids.is_empty() {
        return None;
    }

    let searched_set: HashSet<String> = session_ids.iter().cloned().collect();

    // Reuse the same connection for loading messages
    let mut results = Vec::new();
    for sid in &session_ids {
        if let Some(messages) = load_messages_with_conn(&conn, sid) {
            for msg in messages {
                if results.len() >= limit {
                    return Some((results, searched_set));
                }
                if let Some(content) = &msg.content {
                    if super::result_evidence::content_matches(content, query_lower) {
                        results.push(msg);
                    }
                }
            }
        }
    }

    Some((results, searched_set))
}

// ============================================================================
// Internal helpers
// ============================================================================

fn get_latest_session_time(sessions_dir: &Path) -> Option<String> {
    if !sessions_dir.exists() {
        return None;
    }

    let mut latest: Option<String> = None;

    for entry in fs::read_dir(sessions_dir).ok()?.flatten() {
        if entry.file_type().map_or(true, |ft| ft.is_symlink()) {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(val) = serde_json::from_str::<Value>(&content) {
                // Timestamps are epoch ms under val["time"]["updated"] or val["time"]["created"]
                let time_obj = val.get("time");
                let updated = time_obj
                    .and_then(|t| t.get("updated").or_else(|| t.get("created")))
                    .and_then(Value::as_u64)
                    .map(epoch_ms_to_rfc3339);

                if let Some(t) = updated {
                    if latest.is_none() || t > *latest.as_ref().unwrap() {
                        latest = Some(t);
                    }
                }
            }
        }
    }

    latest
}

fn read_message_parts(parts_dir: &Path) -> Result<Vec<Value>, String> {
    let mut parts: Vec<(String, Value)> = Vec::new();

    for entry in fs::read_dir(parts_dir)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        if entry.file_type().map_or(true, |ft| ft.is_symlink()) {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let val: Value = match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let filename = path
            .file_stem()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        parts.push((filename, val));
    }

    // Sort by filename to maintain order
    parts.sort_by(|a, b| a.0.cmp(&b.0));

    Ok(parts.into_iter().map(|(_, v)| v).collect())
}

/// Sum two `Option<u32>` values, treating None as absent (not zero)
fn sum_opt(a: Option<u32>, b: Option<u32>) -> Option<u32> {
    match (a, b) {
        (Some(x), Some(y)) => Some(x.saturating_add(y)),
        (Some(x), None) | (None, Some(x)) => Some(x),
        (None, None) => None,
    }
}

fn parse_opencode_token_usage(tokens: &Value) -> TokenUsage {
    let cache = tokens.get("cache");
    let token = |key: &str| tokens.get(key).and_then(Value::as_u64).map(|v| v as u32);
    let cache_token = |key: &str| {
        cache
            .and_then(|value| value.get(key))
            .and_then(Value::as_u64)
            .map(|v| v as u32)
    };

    TokenUsage {
        input_tokens: token("input"),
        output_tokens: token("output"),
        cache_creation_input_tokens: cache_token("write"),
        cache_read_input_tokens: cache_token("read"),
        reasoning_tokens: token("reasoning"),
        service_tier: None,
        ..Default::default()
    }
}

/// Preserve message-level aggregate input/output while filling fields that
/// are only present on step-finish parts.
fn merge_token_usage(
    primary: Option<TokenUsage>,
    fallback: Option<TokenUsage>,
) -> Option<TokenUsage> {
    match (primary, fallback) {
        (Some(primary), Some(fallback)) => Some(TokenUsage {
            input_tokens: primary.input_tokens.or(fallback.input_tokens),
            output_tokens: primary.output_tokens.or(fallback.output_tokens),
            cache_creation_input_tokens: primary
                .cache_creation_input_tokens
                .or(fallback.cache_creation_input_tokens),
            cache_creation_input_tokens_5m: primary
                .cache_creation_input_tokens_5m
                .or(fallback.cache_creation_input_tokens_5m),
            cache_creation_input_tokens_1h: primary
                .cache_creation_input_tokens_1h
                .or(fallback.cache_creation_input_tokens_1h),
            cache_read_input_tokens: primary
                .cache_read_input_tokens
                .or(fallback.cache_read_input_tokens),
            reasoning_tokens: primary.reasoning_tokens.or(fallback.reasoning_tokens),
            service_tier: primary.service_tier.or(fallback.service_tier),
            cache_creation: primary.cache_creation.or(fallback.cache_creation),
        }),
        (Some(usage), None) | (None, Some(usage)) => Some(usage),
        (None, None) => None,
    }
}

// is_safe_storage_id is imported from crate::utils

fn process_parts(
    parts: &[Value],
    message_id: &str,
    session_id: &str,
) -> (Option<Value>, Option<TokenUsage>, Option<f64>) {
    let mut content_items: Vec<Value> = Vec::new();
    let mut usage: Option<TokenUsage> = None;
    let mut cost_usd: Option<f64> = None;

    for (part_index, part) in parts.iter().enumerate() {
        let part_type = part.get("type").and_then(|t| t.as_str()).unwrap_or("");

        match part_type {
            "text" => {
                let text = part
                    .get("text")
                    .or_else(|| part.get("content"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if !text.is_empty() {
                    content_items.push(serde_json::json!({
                        "type": "text",
                        "text": text
                    }));
                }
            }
            "tool" => {
                // Real field names: "tool" (not "toolName"), "callID" (not "toolCallId")
                let raw_tool_name = part
                    .get("tool")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");
                let tool_name = normalize_opencode_tool_name(raw_tool_name);
                let tool_id = part
                    .get("callID")
                    .or_else(|| part.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                // Input is nested: state.input
                let input = part
                    .get("state")
                    .and_then(|s| s.get("input"))
                    .cloned()
                    .unwrap_or(Value::Object(serde_json::Map::default()));
                let input = normalize_opencode_tool_input(tool_name, input);

                content_items.push(serde_json::json!({
                    "type": "tool_use",
                    "id": tool_id,
                    "name": tool_name,
                    // Exact producer tool ID (not built-in provenance) survives the shared Kilo route.
                    // OpenCode b9a39b8 tool/grep.ts:8; Kilo 0a9faeff tool/grep.ts:22-23.
                    "rawToolName": part.get("tool"),
                    "input": input
                }));

                // Check status at state.status (not top-level state string)
                let status = part
                    .get("state")
                    .and_then(|s| s.get("status"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if let Some((result, is_error)) = extract_tool_result_from_state(part, status) {
                    let mut tool_result = serde_json::json!({
                        "type": "tool_result",
                        "tool_use_id": tool_id,
                        "content": result
                    });
                    if is_error {
                        tool_result["is_error"] = Value::Bool(true);
                    }
                    // State belongs to this exact part, not another call with the same ID.
                    super::result_evidence::attach(
                        &mut tool_result,
                        &part["state"],
                        message_id,
                        session_id,
                        content_items.len(),
                    );
                    tool_result["toolUseResultSource"]["partIndex"] = Value::from(part_index);
                    content_items.push(tool_result);
                }
            }
            "reasoning" => {
                let text = part
                    .get("text")
                    .or_else(|| part.get("reasoning"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if !text.is_empty() {
                    content_items.push(serde_json::json!({
                        "type": "thinking",
                        "thinking": text
                    }));
                }
            }
            "step-finish" => {
                let reason = part
                    .get("reason")
                    .and_then(Value::as_str)
                    .unwrap_or("completed");
                let snapshot = part.get("snapshot").and_then(Value::as_str).unwrap_or("");
                let snapshot_preview: String = snapshot.chars().take(8).collect();
                let step_cost = part.get("cost").and_then(Value::as_f64).unwrap_or(0.0);

                // Extract token usage if available
                let (input, output, reasoning, cache_read, cache_write) =
                    if let Some(t) = part.get("tokens") {
                        let new_usage = parse_opencode_token_usage(t);
                        let i = new_usage.input_tokens;
                        let o = new_usage.output_tokens;
                        let r = new_usage.reasoning_tokens;
                        let cw = new_usage.cache_creation_input_tokens;
                        let cr = new_usage.cache_read_input_tokens;
                        usage = match usage {
                            Some(prev) => Some(TokenUsage {
                                input_tokens: sum_opt(prev.input_tokens, new_usage.input_tokens),
                                output_tokens: sum_opt(prev.output_tokens, new_usage.output_tokens),
                                cache_creation_input_tokens: sum_opt(
                                    prev.cache_creation_input_tokens,
                                    new_usage.cache_creation_input_tokens,
                                ),
                                cache_read_input_tokens: sum_opt(
                                    prev.cache_read_input_tokens,
                                    new_usage.cache_read_input_tokens,
                                ),
                                reasoning_tokens: sum_opt(
                                    prev.reasoning_tokens,
                                    new_usage.reasoning_tokens,
                                ),
                                service_tier: None,
                                ..Default::default()
                            }),
                            None => Some(new_usage),
                        };
                        (i, o, r, cr, cw)
                    } else {
                        (None, None, None, None, None)
                    };

                content_items.push(serde_json::json!({
                    "type": "opencode_step",
                    "reason": reason,
                    "snapshot": snapshot_preview,
                    "cost": step_cost,
                    "tokens": {
                        "input": input.unwrap_or(0),
                        "output": output.unwrap_or(0),
                        "reasoning": reasoning.unwrap_or(0),
                        "cache_read": cache_read.unwrap_or(0),
                        "cache_write": cache_write.unwrap_or(0)
                    }
                }));

                // Accumulate cost
                if step_cost > 0.0 {
                    cost_usd = Some(cost_usd.unwrap_or(0.0) + step_cost);
                }
            }
            "compaction" => {
                let text = part
                    .get("text")
                    .and_then(|v| v.as_str())
                    .unwrap_or("[Context compacted]");
                content_items.push(serde_json::json!({
                    "type": "text",
                    "text": format!("[Summary] {text}")
                }));
            }
            "patch" => {
                // Show modified file list from patch parts
                if let Some(files) = part.get("files").and_then(|v| v.as_array()) {
                    let file_list: Vec<&str> = files.iter().filter_map(|f| f.as_str()).collect();
                    if !file_list.is_empty() {
                        let display = file_list
                            .iter()
                            .map(|f| {
                                Path::new(f)
                                    .file_name()
                                    .and_then(|n| n.to_str())
                                    .unwrap_or(f)
                            })
                            .collect::<Vec<_>>()
                            .join(", ");
                        content_items.push(serde_json::json!({
                            "type": "text",
                            "text": format!("[Patch] {display}")
                        }));
                    }
                }
            }
            "file" => {
                let filename = part.get("filename").and_then(|v| v.as_str()).unwrap_or("");
                let url = part.get("url").and_then(|v| v.as_str()).unwrap_or("");
                let mime = part.get("mime").and_then(|v| v.as_str()).unwrap_or("");

                if mime.starts_with("image/") {
                    // Image file — extract base64 data from data: URI or use URL
                    if let Some(data) = url
                        .strip_prefix("data:image/png;base64,")
                        .or_else(|| url.strip_prefix("data:image/jpeg;base64,"))
                        .or_else(|| url.strip_prefix("data:image/gif;base64,"))
                        .or_else(|| url.strip_prefix("data:image/webp;base64,"))
                    {
                        content_items.push(serde_json::json!({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": mime,
                                "data": data
                            }
                        }));
                    } else if !url.is_empty() {
                        content_items.push(serde_json::json!({
                            "type": "image",
                            "source": {
                                "type": "url",
                                "url": url
                            }
                        }));
                    }
                } else if !filename.is_empty() {
                    // Non-image file reference
                    content_items.push(serde_json::json!({
                        "type": "text",
                        "text": format!("[File] {filename} ({url})")
                    }));
                }
            }
            // step-start is redundant — step-finish contains all useful data
            // Skip: step-start, snapshot, agent, subtask, retry
            _ => {}
        }
    }

    let content = if content_items.is_empty() {
        None
    } else {
        Some(Value::Array(content_items))
    };

    (content, usage, cost_usd)
}

fn normalize_opencode_tool_name(name: &str) -> &str {
    match name {
        "read" => "Read",
        "bash" | "shell" => "Bash",
        "glob" => "Glob",
        "grep" => "Grep",
        "write" => "Write",
        "edit" => "Edit",
        "todowrite" => "TodoWrite",
        "webfetch" => "WebFetch",
        "task" | "subagent" | "call_omo_agent" => "Task",
        "websearch_web_search_exa"
        | "websearch_exa_web_search_exa"
        | "web_search"
        | "brave-search_brave_web_search" => "WebSearch",
        _ if name.starts_with("grep_") => "Grep",
        _ => name,
    }
}

fn move_input_key(input_obj: &mut serde_json::Map<String, Value>, from: &str, to: &str) {
    if input_obj.contains_key(to) {
        return;
    }
    if let Some(value) = input_obj.remove(from) {
        input_obj.insert(to.to_string(), value);
    }
}

fn normalize_opencode_tool_input(tool_name: &str, input: Value) -> Value {
    let Value::Object(mut input_obj) = input else {
        return input;
    };

    move_input_key(&mut input_obj, "filePath", "file_path");
    // 2.x file tools may name the file `path`; for Grep/Glob `path` is the
    // directory searched, so only the single-file tools get it renamed.
    if matches!(tool_name, "Read" | "Write" | "Edit") {
        move_input_key(&mut input_obj, "path", "file_path");
    }
    move_input_key(&mut input_obj, "oldString", "old_string");
    move_input_key(&mut input_obj, "newString", "new_string");
    move_input_key(&mut input_obj, "replaceAll", "replace_all");
    move_input_key(&mut input_obj, "runInBackground", "run_in_background");
    move_input_key(&mut input_obj, "allowedDomains", "allowed_domains");
    move_input_key(&mut input_obj, "blockedDomains", "blocked_domains");

    if tool_name == "Bash" {
        if let Some(Value::Array(command_arr)) = input_obj.get("command").cloned() {
            let joined = command_arr
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" ");
            input_obj.insert("command".to_string(), Value::String(joined));
        }
    }

    Value::Object(input_obj)
}

fn extract_tool_result_from_state(part: &Value, status: &str) -> Option<(Value, bool)> {
    let state = part.get("state")?;
    match status {
        "completed" => {
            let output = state
                .get("output")
                .cloned()
                .unwrap_or(Value::String(String::new()));
            Some((output, false))
        }
        "error" | "cancelled" => {
            let error = state
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_string)
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    state.get("output").map(|v| {
                        if let Some(s) = v.as_str() {
                            s.to_string()
                        } else {
                            v.to_string()
                        }
                    })
                })
                .unwrap_or_else(|| format!("Tool execution failed: {status}"));
            Some((Value::String(error), true))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalizes_lowercase_tool_names() {
        assert_eq!(normalize_opencode_tool_name("read"), "Read");
        assert_eq!(normalize_opencode_tool_name("bash"), "Bash");
        assert_eq!(normalize_opencode_tool_name("task"), "Task");
        assert_eq!(
            normalize_opencode_tool_name("websearch_web_search_exa"),
            "WebSearch"
        );
        assert_eq!(normalize_opencode_tool_name("web_search"), "WebSearch");
    }

    #[test]
    fn process_parts_preserves_parallel_task_calls() {
        let parts = json!([
            {
                "type": "tool",
                "tool": "task",
                "callID": "task-1",
                "state": {
                    "status": "completed",
                    "input": { "description": "Check API", "prompt": "Review API" },
                    "output": "API OK"
                }
            },
            {
                "type": "tool",
                "tool": "call_omo_agent",
                "callID": "task-2",
                "state": {
                    "status": "completed",
                    "input": { "description": "Check UI", "prompt": "Review UI" },
                    "output": "UI OK"
                }
            }
        ]);

        let (content, _, _) = process_parts(parts.as_array().unwrap(), "fixture", "session");
        let blocks = content.unwrap();
        let blocks = blocks.as_array().unwrap();

        assert_eq!(blocks.len(), 4);
        assert_eq!(blocks[0]["type"], "tool_use");
        assert_eq!(blocks[0]["name"], "Task");
        assert_eq!(blocks[0]["id"], "task-1");
        assert_eq!(blocks[1]["tool_use_id"], "task-1");
        assert_eq!(blocks[2]["type"], "tool_use");
        assert_eq!(blocks[2]["name"], "Task");
        assert_eq!(blocks[2]["id"], "task-2");
        assert_eq!(blocks[3]["tool_use_id"], "task-2");
    }

    #[test]
    fn merges_message_usage_with_part_usage_without_double_counting() {
        let message_usage = parse_opencode_token_usage(&json!({
            "input": 100,
            "output": 50
        }));
        let part_usage = parse_opencode_token_usage(&json!({
            "input": 10,
            "output": 5,
            "reasoning": 7,
            "cache": { "read": 30, "write": 20 }
        }));

        let merged = merge_token_usage(Some(message_usage), Some(part_usage))
            .expect("partial usage should merge");

        assert_eq!(merged.input_tokens, Some(100));
        assert_eq!(merged.output_tokens, Some(50));
        assert_eq!(merged.reasoning_tokens, Some(7));
        assert_eq!(merged.cache_read_input_tokens, Some(30));
        assert_eq!(merged.cache_creation_input_tokens, Some(20));
    }

    #[test]
    fn keeps_github_search_tools_as_is() {
        assert_eq!(
            normalize_opencode_tool_name("github_search_repositories"),
            "github_search_repositories"
        );
    }

    #[test]
    fn normalizes_camel_case_input_keys() {
        let normalized = normalize_opencode_tool_input(
            "Edit",
            json!({
                "filePath": "/tmp/a.ts",
                "oldString": "before",
                "newString": "after",
                "replaceAll": true
            }),
        );
        let obj = normalized
            .as_object()
            .expect("normalized input should be object");
        assert_eq!(
            obj.get("file_path").and_then(Value::as_str),
            Some("/tmp/a.ts")
        );
        assert_eq!(
            obj.get("old_string").and_then(Value::as_str),
            Some("before")
        );
        assert_eq!(obj.get("new_string").and_then(Value::as_str), Some("after"));
        assert_eq!(obj.get("replace_all").and_then(Value::as_bool), Some(true));
    }

    #[test]
    fn extracts_error_tool_result_from_state() {
        let part = json!({
            "state": {
                "status": "error",
                "error": "failure"
            }
        });
        let (result, is_error) =
            extract_tool_result_from_state(&part, "error").expect("error result should exist");
        assert_eq!(result.as_str(), Some("failure"));
        assert!(is_error);
    }

    // ========================================================================
    // SQLite integration tests
    // ========================================================================

    fn create_test_db(dir: &std::path::Path) -> Connection {
        let db_path = dir.join("opencode.db");
        let conn = Connection::open(&db_path).expect("create test db");
        conn.execute_batch(
            "CREATE TABLE project (
                id TEXT PRIMARY KEY, worktree TEXT NOT NULL, name TEXT,
                time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
                sandboxes TEXT NOT NULL DEFAULT '[]', vcs TEXT, icon_url TEXT,
                icon_color TEXT, time_initialized INTEGER, commands TEXT
            );
            CREATE TABLE session (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
                slug TEXT NOT NULL DEFAULT '', directory TEXT NOT NULL DEFAULT '',
                version TEXT NOT NULL DEFAULT '1.0', time_created INTEGER NOT NULL,
                time_updated INTEGER NOT NULL, parent_id TEXT, share_url TEXT,
                summary_additions INTEGER, summary_deletions INTEGER, summary_files INTEGER,
                summary_diffs TEXT, revert TEXT, permission TEXT, time_compacting INTEGER,
                time_archived INTEGER, workspace_id TEXT
            );
            CREATE TABLE message (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL,
                time_updated INTEGER NOT NULL, data TEXT NOT NULL
            );
            CREATE TABLE part (
                id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
                time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
            );",
        )
        .expect("create tables");
        conn
    }

    fn seed_test_data(conn: &Connection) {
        conn.execute(
            "INSERT INTO project (id, worktree, name, time_created, time_updated)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                "proj1",
                "/tmp/my-project",
                "my-project",
                1700000000000_i64,
                1700000100000_i64
            ],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO session (id, project_id, title, time_created, time_updated)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                "ses_001",
                "proj1",
                "Test session",
                1700000000000_i64,
                1700000050000_i64
            ],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO message (id, session_id, time_created, time_updated, data)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                "msg_001",
                "ses_001",
                1700000010000_i64,
                1700000010000_i64,
                r#"{"role":"user","time":{"created":1700000010000}}"#
            ],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO message (id, session_id, time_created, time_updated, data)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                "msg_002", "ses_001", 1700000020000_i64, 1700000020000_i64,
                r#"{"role":"assistant","time":{"created":1700000020000},"parentID":"msg_001","modelID":"test-model","tokens":{"input":100,"output":50},"cost":0.01}"#
            ],
        ).unwrap();

        conn.execute(
            "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                "prt_001",
                "msg_001",
                "ses_001",
                1700000010000_i64,
                1700000010000_i64,
                r#"{"type":"text","text":"Hello from user"}"#
            ],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                "prt_002",
                "msg_002",
                "ses_001",
                1700000020000_i64,
                1700000020000_i64,
                r#"{"type":"text","text":"Hello from assistant"}"#
            ],
        )
        .unwrap();
    }

    fn project_ref(project_id: &str) -> OpenCodeProjectRef {
        OpenCodeProjectRef::parse(&format!("opencode://{project_id}")).unwrap()
    }

    /// #560. A subagent run is a `session` row whose `parent_id` points at its
    /// parent, not a sidechain file, so the panel's parent→child link can only
    /// come from here.
    #[test]
    fn sqlite_load_child_sessions_reads_subagent_rows() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = create_test_db(tmp.path());
        seed_test_data(&conn);
        for (id, title, created) in [
            ("ses_child_a", "Search the codebase", 1_700_000_200_000_i64),
            ("ses_child_b", "Write the migration", 1_700_000_300_000_i64),
        ] {
            conn.execute(
                "INSERT INTO session (id, project_id, title, time_created, time_updated, parent_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![id, "proj1", title, created, created, "ses_001"],
            )
            .unwrap();
        }
        drop(conn);

        let base = tmp.path().to_string_lossy().to_string();
        let children = load_child_sessions_from_db(&base, OPENCODE_DB_FILE, "proj1", "ses_001");

        // Newest first.
        assert_eq!(
            children.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
            vec!["ses_child_b", "ses_child_a"]
        );
        assert_eq!(children[0].title, "Write the migration");

        // A session with no children yields nothing rather than erroring, and
        // children are not claimed by a sibling parent.
        assert!(
            load_child_sessions_from_db(&base, OPENCODE_DB_FILE, "proj1", "ses_child_a").is_empty()
        );
    }

    #[test]
    fn sqlite_scan_projects_reads_from_db() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = create_test_db(tmp.path());
        seed_test_data(&conn);
        drop(conn);

        let projects = scan_projects_from_db(
            &tmp.path().to_string_lossy(),
            OPENCODE_DB_FILE,
            &ScanReport::default(),
        )
        .unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "my-project");
        assert_eq!(projects[0].path, "opencode://proj1");
        assert_eq!(projects[0].session_count, 1);
        assert_eq!(projects[0].storage_type, Some("sqlite".to_string()));
    }

    #[test]
    fn sqlite_load_sessions_reads_from_db() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = create_test_db(tmp.path());
        seed_test_data(&conn);
        drop(conn);

        let sessions = load_sessions_from_db(
            &tmp.path().to_string_lossy(),
            OPENCODE_DB_FILE,
            &project_ref("proj1"),
            &ScanReport::default(),
        )
        .unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].actual_session_id, "ses_001");
        assert_eq!(sessions[0].summary, Some("Test session".to_string()));
        assert_eq!(sessions[0].message_count, 2);
        assert_eq!(sessions[0].storage_type, Some("sqlite".to_string()));
    }

    #[test]
    fn sqlite_load_messages_reads_from_db() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = create_test_db(tmp.path());
        seed_test_data(&conn);
        drop(conn);

        let messages =
            load_messages_from_db(&tmp.path().to_string_lossy(), OPENCODE_DB_FILE, "ses_001")
                .unwrap();
        assert_eq!(messages.len(), 2);

        // First message: user
        assert_eq!(messages[0].uuid, "msg_001");
        assert_eq!(messages[0].role, Some("user".to_string()));
        let content = messages[0].content.as_ref().unwrap();
        let text = content[0].get("text").unwrap().as_str().unwrap();
        assert_eq!(text, "Hello from user");

        // Second message: assistant
        assert_eq!(messages[1].uuid, "msg_002");
        assert_eq!(messages[1].role, Some("assistant".to_string()));
        assert_eq!(messages[1].model, Some("test-model".to_string()));
        assert_eq!(messages[1].parent_uuid, Some("msg_001".to_string()));
        assert!(messages[1].usage.is_some());
        assert!(messages[1].cost_usd.is_some());
    }

    #[test]
    fn sqlite_returns_none_when_no_db() {
        let tmp = tempfile::tempdir().unwrap();
        // No opencode.db created
        assert!(open_db(&tmp.path().to_string_lossy(), OPENCODE_DB_FILE).is_none());
        assert!(scan_projects_from_db(
            &tmp.path().to_string_lossy(),
            OPENCODE_DB_FILE,
            &ScanReport::default()
        )
        .is_none());
        assert!(load_sessions_from_db(
            &tmp.path().to_string_lossy(),
            OPENCODE_DB_FILE,
            &project_ref("proj1"),
            &ScanReport::default()
        )
        .is_none());
        assert!(
            load_messages_from_db(&tmp.path().to_string_lossy(), OPENCODE_DB_FILE, "ses_001")
                .is_none()
        );
    }

    #[test]
    fn sqlite_search_finds_matching_parts() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = create_test_db(tmp.path());
        seed_test_data(&conn);
        drop(conn);

        let (results, session_ids) = search_from_db(
            &tmp.path().to_string_lossy(),
            OPENCODE_DB_FILE,
            "hello from user",
            10,
        )
        .unwrap();
        assert!(!results.is_empty());
        assert!(session_ids.contains("ses_001"));

        // Search for non-existent text
        let none_result = search_from_db(
            &tmp.path().to_string_lossy(),
            OPENCODE_DB_FILE,
            "nonexistent_xyz",
            10,
        );
        assert!(none_result.is_none());
    }

    #[test]
    fn count_json_sessions_excluding_counts_correctly() {
        let tmp = tempfile::tempdir().unwrap();
        let sessions_dir = tmp.path().join("sessions");
        fs::create_dir(&sessions_dir).unwrap();

        // Create 3 JSON session files
        fs::write(sessions_dir.join("ses_a.json"), "{}").unwrap();
        fs::write(sessions_dir.join("ses_b.json"), "{}").unwrap();
        fs::write(sessions_dir.join("ses_c.json"), "{}").unwrap();

        // No exclusions → count all
        assert_eq!(count_json_sessions_excluding(&sessions_dir, None), 3);

        // Exclude ses_a → count 2
        let exclude: HashSet<String> = ["ses_a".to_string()].into_iter().collect();
        assert_eq!(
            count_json_sessions_excluding(&sessions_dir, Some(&exclude)),
            2
        );

        // Exclude all → count 0
        let exclude_all: HashSet<String> = ["ses_a", "ses_b", "ses_c"]
            .into_iter()
            .map(String::from)
            .collect();
        assert_eq!(
            count_json_sessions_excluding(&sessions_dir, Some(&exclude_all)),
            0
        );

        // Empty exclude set → count all
        let empty: HashSet<String> = HashSet::new();
        assert_eq!(
            count_json_sessions_excluding(&sessions_dir, Some(&empty)),
            3
        );
    }

    #[test]
    fn build_db_session_map_groups_by_project() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = create_test_db(tmp.path());
        seed_test_data(&conn);
        // Add another session to a different project
        conn.execute(
            "INSERT INTO project (id, worktree, time_created, time_updated)
             VALUES ('proj2', '/tmp/other', 1700000000000, 1700000000000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO session (id, project_id, title, time_created, time_updated)
             VALUES ('ses_x', 'proj2', 'Other', 1700000000000, 1700000000000)",
            [],
        )
        .unwrap();
        drop(conn);

        let map = build_db_session_map(&tmp.path().to_string_lossy(), OPENCODE_DB_FILE).unwrap();
        assert_eq!(map.len(), 2);
        assert!(map["proj1"].contains("ses_001"));
        assert!(map["proj2"].contains("ses_x"));
    }

    #[test]
    fn sqlite_scan_projects_splits_global_by_session_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = create_test_db(tmp.path());
        seed_test_data(&conn);

        conn.execute(
            "INSERT INTO project (id, worktree, time_created, time_updated)
             VALUES ('global', '/', 1700000000000, 1700000500000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO session (id, project_id, title, directory, time_created, time_updated)
             VALUES ('ses_global_a', 'global', 'Global A', '/tmp/a', 1700000100000, 1700000200000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO session (id, project_id, title, directory, time_created, time_updated)
             VALUES ('ses_global_b', 'global', 'Global B', '/tmp/a', 1700000200000, 1700000300000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO session (id, project_id, title, directory, time_created, time_updated)
             VALUES ('ses_global_c', 'global', 'Global C', '/tmp/b', 1700000300000, 1700000400000)",
            [],
        )
        .unwrap();
        drop(conn);

        let projects = scan_projects_from_db(
            &tmp.path().to_string_lossy(),
            OPENCODE_DB_FILE,
            &ScanReport::default(),
        )
        .unwrap();
        assert!(projects.iter().all(|project| project.name != "unknown"));

        let project_a = projects
            .iter()
            .find(|project| project.actual_path == "/tmp/a")
            .expect("global /tmp/a directory project should exist");
        assert_eq!(project_a.name, "a");
        assert_eq!(project_a.session_count, 2);
        assert!(project_a.path.starts_with("opencode://global-dir-"));

        let project_b = projects
            .iter()
            .find(|project| project.actual_path == "/tmp/b")
            .expect("global /tmp/b directory project should exist");
        assert_eq!(project_b.name, "b");
        assert_eq!(project_b.session_count, 1);
        assert!(project_b.path.starts_with("opencode://global-dir-"));
    }

    #[test]
    fn sqlite_load_sessions_filters_global_directory_project() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = create_test_db(tmp.path());
        conn.execute(
            "INSERT INTO project (id, worktree, time_created, time_updated)
             VALUES ('global', '/', 1700000000000, 1700000500000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO session (id, project_id, title, directory, time_created, time_updated)
             VALUES ('ses_global_a', 'global', 'Global A', '/tmp/a', 1700000100000, 1700000200000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO session (id, project_id, title, directory, time_created, time_updated)
             VALUES ('ses_global_b', 'global', 'Global B', '/tmp/b', 1700000200000, 1700000300000)",
            [],
        )
        .unwrap();
        drop(conn);

        let projects = scan_projects_from_db(
            &tmp.path().to_string_lossy(),
            OPENCODE_DB_FILE,
            &ScanReport::default(),
        )
        .unwrap();
        let project_a = projects
            .iter()
            .find(|project| project.actual_path == "/tmp/a")
            .expect("global /tmp/a directory project should exist");
        let project_ref = OpenCodeProjectRef::parse(&project_a.path).unwrap();

        let sessions = load_sessions_from_db(
            &tmp.path().to_string_lossy(),
            OPENCODE_DB_FILE,
            &project_ref,
            &ScanReport::default(),
        )
        .unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].actual_session_id, "ses_global_a");
        assert_eq!(sessions[0].file_path, "opencode://global/ses_global_a");
        assert_eq!(sessions[0].project_name, "a");
    }

    #[test]
    fn sqlite_load_sessions_includes_global_empty_directory_session() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = create_test_db(tmp.path());
        conn.execute(
            "INSERT INTO project (id, worktree, time_created, time_updated)
             VALUES ('global', '/', 1700000000000, 1700000500000)",
            [],
        )
        .unwrap();
        // OpenCode schema defaults `directory` to '', so this case is reachable in real data.
        conn.execute(
            "INSERT INTO session (id, project_id, title, directory, time_created, time_updated)
             VALUES ('ses_global_empty', 'global', 'Global Empty', '', 1700000100000, 1700000200000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO session (id, project_id, title, directory, time_created, time_updated)
             VALUES ('ses_global_a', 'global', 'Global A', '/tmp/a', 1700000200000, 1700000300000)",
            [],
        )
        .unwrap();
        drop(conn);

        let projects = scan_projects_from_db(
            &tmp.path().to_string_lossy(),
            OPENCODE_DB_FILE,
            &ScanReport::default(),
        )
        .unwrap();
        let empty_dir_project = projects
            .iter()
            .find(|project| {
                project.path.starts_with("opencode://global-dir-") && project.actual_path == "/"
            })
            .expect("virtual project for empty-directory sessions should exist");
        assert_eq!(empty_dir_project.session_count, 1);
        assert!(empty_dir_project.path.starts_with("opencode://global-dir-"));

        let project_ref = OpenCodeProjectRef::parse(&empty_dir_project.path).unwrap();
        let sessions = load_sessions_from_db(
            &tmp.path().to_string_lossy(),
            OPENCODE_DB_FILE,
            &project_ref,
            &ScanReport::default(),
        )
        .expect("empty-directory sessions must load, not be silently dropped");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].actual_session_id, "ses_global_empty");
        assert_eq!(sessions[0].file_path, "opencode://global/ses_global_empty");
    }
}

/// `OpenCode` 2.x stores (`session_v2` / `session_message` / `session_part`),
/// alone and side by side with the 1.x tables a migrated database keeps.
/// Row shapes follow what `OpenCode` 2.2 writes.
#[cfg(test)]
mod v2_tests {
    use super::*;
    use serde_json::json;

    const V2_TABLES: &str = "
        CREATE TABLE project (
            id TEXT PRIMARY KEY, worktree TEXT NOT NULL, name TEXT,
            time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
            sandboxes TEXT NOT NULL DEFAULT '[]'
        );
        CREATE TABLE session_v2 (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL, workspace_id TEXT, parent_id TEXT,
            fork_session_id TEXT, slug TEXT NOT NULL DEFAULT '', directory TEXT NOT NULL DEFAULT '',
            title TEXT, version TEXT NOT NULL DEFAULT '2.2.7',
            time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
        );
        CREATE TABLE session_message (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL,
            time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
        );
        CREATE TABLE session_part (
            message_id TEXT NOT NULL, session_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
            type TEXT NOT NULL, call_id TEXT, time_created INTEGER NOT NULL,
            time_updated INTEGER NOT NULL, data TEXT NOT NULL,
            PRIMARY KEY (message_id, ordinal)
        );
        CREATE TABLE blob (
            hash TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
            data BLOB NOT NULL, time_created INTEGER NOT NULL
        );";

    const V1_TABLES: &str = "
        CREATE TABLE session (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
            slug TEXT NOT NULL DEFAULT '', directory TEXT NOT NULL DEFAULT '',
            version TEXT NOT NULL DEFAULT '1.0', time_created INTEGER NOT NULL,
            time_updated INTEGER NOT NULL, parent_id TEXT
        );
        CREATE TABLE message (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL,
            time_updated INTEGER NOT NULL, data TEXT NOT NULL
        );
        CREATE TABLE part (
            id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
            time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
        );";

    struct Store {
        _dir: tempfile::TempDir,
        base: String,
        conn: Connection,
    }

    fn store(with_v1: bool) -> Store {
        let dir = tempfile::tempdir().unwrap();
        let conn = Connection::open(dir.path().join(OPENCODE_DB_FILE)).unwrap();
        conn.execute_batch(V2_TABLES).unwrap();
        if with_v1 {
            conn.execute_batch(V1_TABLES).unwrap();
        }
        conn.execute(
            "INSERT INTO project (id, worktree, name, time_created, time_updated)
             VALUES ('proj1', '/work/app', NULL, 1000, 2000)",
            [],
        )
        .unwrap();
        Store {
            base: dir.path().to_string_lossy().to_string(),
            _dir: dir,
            conn,
        }
    }

    impl Store {
        fn v2_session(&self, id: &str, title: Option<&str>, parent: Option<&str>, updated: i64) {
            self.conn
                .execute(
                    "INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated)
                     VALUES (?1, 'proj1', ?2, '/work/app', ?3, 1000, ?4)",
                    rusqlite::params![id, parent, title, updated],
                )
                .unwrap();
        }

        fn v2_message(&self, session: &str, id: &str, seq: i64, kind: &str, data: Value) {
            self.conn
                .execute(
                    "INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)",
                    rusqlite::params![id, session, kind, seq, 1_000 + seq, data.to_string()],
                )
                .unwrap();
        }

        fn v1_session(&self, id: &str, title: &str) {
            self.conn
                .execute(
                    "INSERT INTO session (id, project_id, title, directory, time_created, time_updated)
                     VALUES (?1, 'proj1', ?2, '/work/app', 1000, 1500)",
                    rusqlite::params![id, title],
                )
                .unwrap();
        }

        fn v1_message(&self, session: &str, id: &str, role: &str, text: &str) {
            self.conn
                .execute(
                    "INSERT INTO message (id, session_id, time_created, time_updated, data)
                     VALUES (?1, ?2, 1100, 1100, ?3)",
                    rusqlite::params![
                        id,
                        session,
                        json!({ "role": role, "time": { "created": 1100 } }).to_string()
                    ],
                )
                .unwrap();
            self.conn
                .execute(
                    "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
                     VALUES (?1, ?2, ?3, 1100, 1100, ?4)",
                    rusqlite::params![
                        format!("prt_{id}"),
                        id,
                        session,
                        json!({ "type": "text", "text": text }).to_string()
                    ],
                )
                .unwrap();
        }

        fn messages(&self, session: &str) -> Vec<ClaudeMessage> {
            load_messages_at(
                &self.base,
                OPENCODE_DB_FILE,
                &format!("opencode://proj1/{session}"),
            )
            .unwrap()
        }

        fn sessions(&self) -> Vec<ClaudeSession> {
            load_sessions_at(&self.base, OPENCODE_DB_FILE, "opencode://proj1", false).unwrap()
        }
    }

    fn blocks(message: &ClaudeMessage) -> &Vec<Value> {
        message.content.as_ref().unwrap().as_array().unwrap()
    }

    /// One turn the way 2.2 records it: user prompt with an image, an
    /// assistant step that thinks, talks and runs `shell`, a failed `edit`,
    /// plus the bookkeeping rows a viewer should not show.
    fn seed_turn(store: &Store, session: &str) {
        store.v2_message(session, "msg_sys", 0, "system", json!({
            "metadata": { "notice": "instructions" }, "time": { "created": 1000 }, "text": "tool catalog"
        }));
        store.v2_message(session, "msg_u1", 1, "user", json!({
            "time": { "created": 1001 }, "text": "fix the build",
            "files": [{ "data": "iVBORw0K", "mime": "image/png", "name": "shot.png", "source": { "type": "inline" } }],
            "agents": []
        }));
        store.v2_message(session, "msg_a1", 2, "assistant", json!({
            "time": { "created": 1002, "completed": 1003 },
            "agent": "build",
            "model": { "id": "claude-opus", "providerID": "anthropic" },
            "content": [
                { "type": "reasoning", "text": "look at the logs" },
                { "type": "text", "text": "Running the build." },
                { "type": "tool", "id": "call_1", "name": "shell", "state": {
                    "status": "completed",
                    "input": { "command": "make", "workdir": "/work/app" },
                    "content": [{ "type": "text", "text": "ok" }],
                    "metadata": { "exit": 0 }
                }},
                { "type": "tool", "id": "call_2", "name": "edit", "state": {
                    "status": "error",
                    "input": { "path": "/work/app/main.rs", "oldString": "a", "newString": "b" },
                    "error": { "type": "tool.execution", "message": "Could not find oldString" }
                }},
                { "type": "tool", "id": "call_3", "name": "grep", "state": {
                    "status": "running", "input": { "pattern": "x", "path": "/work/app/src" }
                }}
            ],
            "tokens": { "input": 10, "output": 20, "reasoning": 3, "cache": { "read": 40, "write": 5 } },
            "cost": 0.25,
            "finish": "tool-calls"
        }));
        store.v2_message(
            session,
            "msg_idle",
            3,
            "idle",
            json!({ "time": { "created": 1004 }, "outcome": "succeeded" }),
        );
        store.v2_message(session, "msg_syn", 4, "synthetic", json!({
            "metadata": { "source": "shell" }, "time": { "created": 1005 }, "text": "<shell>done</shell>"
        }));
        store.v2_message(session, "msg_cmp", 5, "compaction", json!({
            "time": { "created": 1006 }, "status": "completed", "reason": "auto", "summary": "## Objective\nfix the build"
        }));
    }

    #[test]
    fn v2_only_store_lists_projects_and_sessions() {
        let store = store(false);
        store.v2_session("ses_new", Some("Fix the build"), None, 9000);
        store.v2_session("ses_untitled", None, None, 5000);
        seed_turn(&store, "ses_new");

        let projects = scan_projects_from_store(&store.base, OPENCODE_DB_FILE).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].path, "opencode://proj1");
        assert_eq!(projects[0].name, "app");
        assert_eq!(projects[0].session_count, 2);
        // The project row was last touched at 2000; the newest session at 9000.
        assert_eq!(projects[0].last_modified, epoch_ms_to_rfc3339(9000));

        let sessions = store.sessions();
        assert_eq!(sessions.len(), 2, "a NULL title must not drop the session");
        let new = sessions
            .iter()
            .find(|s| s.actual_session_id == "ses_new")
            .unwrap();
        assert_eq!(new.summary.as_deref(), Some("Fix the build"));
        assert_eq!(new.file_path, "opencode://proj1/ses_new");
        // user, assistant, synthetic, compaction; not system or idle.
        assert_eq!(new.message_count, 4);
        let untitled = sessions
            .iter()
            .find(|s| s.actual_session_id == "ses_untitled")
            .unwrap();
        assert_eq!(untitled.summary, None);
    }

    #[test]
    fn v2_messages_convert_to_transcript_blocks() {
        let store = store(false);
        store.v2_session("ses_new", Some("t"), None, 9000);
        seed_turn(&store, "ses_new");

        let messages = store.messages("ses_new");
        let ids: Vec<&str> = messages.iter().map(|m| m.uuid.as_str()).collect();
        assert_eq!(ids, ["msg_u1", "msg_a1", "msg_syn", "msg_cmp"]);

        let user = &messages[0];
        assert_eq!(user.message_type, "user");
        assert_eq!(
            blocks(user)[0],
            json!({ "type": "text", "text": "fix the build" })
        );
        assert_eq!(blocks(user)[1]["type"], "image");
        assert_eq!(blocks(user)[1]["source"]["data"], "iVBORw0K");

        let assistant = &messages[1];
        assert_eq!(assistant.message_type, "assistant");
        assert_eq!(assistant.model.as_deref(), Some("claude-opus"));
        assert_eq!(assistant.cost_usd, Some(0.25));
        let usage = assistant.usage.as_ref().unwrap();
        assert_eq!(usage.input_tokens, Some(10));
        assert_eq!(usage.output_tokens, Some(20));
        assert_eq!(usage.cache_read_input_tokens, Some(40));
        assert_eq!(usage.cache_creation_input_tokens, Some(5));

        let b = blocks(assistant);
        let kinds: Vec<&str> = b.iter().map(|x| x["type"].as_str().unwrap()).collect();
        assert_eq!(
            kinds,
            [
                "thinking",
                "text",
                "tool_use",
                "tool_result",
                "tool_use",
                "tool_result",
                "tool_use",
                "opencode_step"
            ]
        );
        assert_eq!(b[2]["name"], "Bash");
        assert_eq!(b[2]["rawToolName"], "shell");
        assert_eq!(b[2]["input"]["command"], "make");
        assert_eq!(b[3]["tool_use_id"], "call_1");
        assert_eq!(b[3]["content"], "ok");
        assert_eq!(b[3]["toolUseResult"]["metadata"]["exit"], 0);
        assert!(b[3].get("is_error").is_none());

        assert_eq!(b[4]["name"], "Edit");
        assert_eq!(b[4]["input"]["file_path"], "/work/app/main.rs");
        assert_eq!(b[4]["input"]["old_string"], "a");
        assert_eq!(b[5]["content"], "Could not find oldString");
        assert_eq!(b[5]["is_error"], true);

        // Still running: a call with no result yet, and Grep keeps its
        // directory `path`.
        assert_eq!(b[6]["name"], "Grep");
        assert_eq!(b[6]["input"]["path"], "/work/app/src");
        assert!(b[6]["input"].get("file_path").is_none());

        assert_eq!(b[7]["reason"], "tool-calls");
        assert_eq!(b[7]["tokens"]["output"], 20);

        let synthetic = &messages[2];
        assert_eq!(synthetic.message_type, "system");
        assert_eq!(synthetic.content, Some(json!("<shell>done</shell>")));

        let compaction = &messages[3];
        assert_eq!(compaction.message_type, "system");
        assert_eq!(compaction.subtype.as_deref(), Some("compact_boundary"));
        assert_eq!(
            compaction.content,
            Some(json!("## Objective\nfix the build"))
        );
    }

    #[test]
    fn mixed_store_reads_migrated_sessions_from_v2_and_the_rest_from_v1() {
        let store = store(true);
        // Migrated: in both stores, the 2.x copy has the later turn.
        store.v1_session("ses_both", "old title");
        store.v1_message("ses_both", "msg_1", "user", "first prompt");
        store.v2_session("ses_both", Some("new title"), None, 8000);
        store.v2_message(
            "ses_both",
            "msg_1",
            0,
            "user",
            json!({ "text": "first prompt", "time": { "created": 1100 } }),
        );
        store.v2_message(
            "ses_both",
            "msg_2",
            1,
            "user",
            json!({ "text": "second prompt", "time": { "created": 1200 } }),
        );
        // Never migrated: only in 1.x.
        store.v1_session("ses_old", "legacy");
        store.v1_message("ses_old", "msg_o1", "user", "legacy prompt");
        // Created by 2.x.
        store.v2_session("ses_new", Some("fresh"), None, 9000);
        store.v2_message(
            "ses_new",
            "msg_n1",
            0,
            "user",
            json!({ "text": "fresh prompt", "time": { "created": 1300 } }),
        );

        let projects = scan_projects_from_store(&store.base, OPENCODE_DB_FILE).unwrap();
        assert_eq!(
            projects[0].session_count, 3,
            "a migrated session counts once"
        );

        let sessions = store.sessions();
        let mut ids: Vec<&str> = sessions
            .iter()
            .map(|s| s.actual_session_id.as_str())
            .collect();
        ids.sort_unstable();
        assert_eq!(ids, ["ses_both", "ses_new", "ses_old"]);
        let both = sessions
            .iter()
            .find(|s| s.actual_session_id == "ses_both")
            .unwrap();
        assert_eq!(both.summary.as_deref(), Some("new title"));
        assert_eq!(both.message_count, 2);
        let old = sessions
            .iter()
            .find(|s| s.actual_session_id == "ses_old")
            .unwrap();
        assert_eq!(old.message_count, 1);

        let both = store.messages("ses_both");
        assert_eq!(both.len(), 2);
        assert_eq!(blocks(&both[1])[0]["text"], "second prompt");

        let old = store.messages("ses_old");
        assert_eq!(old.len(), 1);
        assert_eq!(blocks(&old[0])[0]["text"], "legacy prompt");

        let map = build_db_session_map(&store.base, OPENCODE_DB_FILE).unwrap();
        assert_eq!(map["proj1"].len(), 3);
    }

    #[test]
    fn mixed_store_search_covers_both_stores_without_double_reading() {
        let store = store(true);
        // Only the stale 1.x copy matches; the session reads from 2.x, which
        // doesn't, so it must not turn up.
        store.v1_session("ses_both", "t");
        store.v1_message("ses_both", "msg_1", "user", "needle in the old copy");
        store.v2_session("ses_both", Some("t"), None, 8000);
        store.v2_message(
            "ses_both",
            "msg_1",
            0,
            "user",
            json!({ "text": "edited prompt" }),
        );
        store.v1_session("ses_old", "t");
        store.v1_message("ses_old", "msg_o1", "user", "legacy needle");
        store.v2_session("ses_new", Some("t"), None, 9000);
        store.v2_message(
            "ses_new",
            "msg_n1",
            0,
            "user",
            json!({ "text": "fresh NEEDLE" }),
        );
        store.v2_message(
            "ses_new",
            "msg_n2",
            1,
            "system",
            json!({ "text": "needle in a notice" }),
        );

        let (results, sessions) =
            search_from_db(&store.base, OPENCODE_DB_FILE, "needle", 50).unwrap();
        let mut hit: Vec<&str> = results.iter().map(|m| m.uuid.as_str()).collect();
        hit.sort_unstable();
        assert_eq!(hit, ["msg_n1", "msg_o1"]);
        assert!(sessions.contains("ses_new") && sessions.contains("ses_old"));
    }

    /// When the 2.x rows can't be read the 1.x copy is what opens, so
    /// search has to find it too.
    #[test]
    fn search_finds_the_v1_copy_shown_when_v2_rows_are_unreadable() {
        let store = store(true);
        store.v1_session("ses_both", "t");
        store.v1_message("ses_both", "msg_1", "user", "legacy needle");
        store.v2_session("ses_both", Some("t"), None, 8000);
        store.v2_message("ses_both", "msg_1", 0, "user", json!([]));

        assert_eq!(
            blocks(&store.messages("ses_both")[0])[0]["text"],
            "legacy needle"
        );
        let (results, _) = search_from_db(&store.base, OPENCODE_DB_FILE, "needle", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].uuid, "msg_1");
    }

    #[test]
    fn unreadable_session_part_prefers_the_v1_copy() {
        let dir = tempfile::tempdir().unwrap();
        let conn = Connection::open(dir.path().join(OPENCODE_DB_FILE)).unwrap();
        // A `session_part` without the `call_id` column this reader probes for.
        let reshaped = V2_TABLES.replace("call_id TEXT, ", "");
        assert_ne!(reshaped, V2_TABLES);
        conn.execute_batch(&reshaped).unwrap();
        conn.execute_batch(V1_TABLES).unwrap();
        let store = Store {
            base: dir.path().to_string_lossy().to_string(),
            _dir: dir,
            conn,
        };
        assert!(StoreSchema::read(&store.conn).unwrap().v2_parts_unreadable);
        store.v1_session("ses_both", "t");
        store.v1_message("ses_both", "msg_1", "user", "prompt");
        store.v1_message("ses_both", "msg_2", "assistant", "the full reply");
        store.v2_session("ses_both", Some("t"), None, 8000);
        store.v2_message("ses_both", "msg_1", 0, "user", json!({ "text": "prompt" }));
        store.v2_message(
            "ses_both",
            "msg_2",
            1,
            "assistant",
            json!({ "content": [], "finish": "stop" }),
        );

        let messages = store.messages("ses_both");
        assert_eq!(messages.len(), 2);
        assert_eq!(blocks(&messages[1])[0]["text"], "the full reply");
    }

    #[test]
    fn user_shell_commands_show_as_bash_calls() {
        let store = store(false);
        store.v2_session("ses_new", Some("t"), None, 9000);
        store.v2_message(
            "ses_new",
            "msg_sh",
            0,
            "shell",
            json!({
                "shellID": "sh_1", "command": "ls -la", "status": "exited", "exit": 0,
                "output": { "output": "a\nb\n", "cursor": 4, "size": 9000, "truncated": true },
                "time": { "created": 1000, "completed": 1001 }
            }),
        );
        store.v2_message("ses_new", "msg_run", 1, "shell", json!({
            "shellID": "sh_2", "command": "sleep 60", "status": "running", "time": { "created": 1002 }
        }));

        assert_eq!(store.sessions()[0].message_count, 2);
        let messages = store.messages("ses_new");
        let done = blocks(&messages[0]);
        assert_eq!(done[0]["name"], "Bash");
        assert_eq!(done[0]["input"]["command"], "ls -la");
        assert_eq!(done[1]["tool_use_id"], "sh_1");
        assert_eq!(done[1]["content"], "a\nb\n");
        assert_eq!(done[1]["toolUseResult"]["exit"], 0);
        assert_eq!(done[1]["toolUseResult"]["status"], "exited");
        assert_eq!(done[1]["toolUseResult"]["truncated"], true);
        assert_eq!(
            blocks(&messages[1]).len(),
            1,
            "a running command has no result yet"
        );
    }

    #[test]
    fn compactions_keep_their_usage_and_failures_keep_the_error() {
        let store = store(false);
        store.v2_session("ses_new", Some("t"), None, 9000);
        store.v2_message(
            "ses_new",
            "msg_ok",
            0,
            "compaction",
            json!({
                "status": "completed", "reason": "auto", "summary": "kept",
                "model": { "id": "glm" }, "tokens": { "input": 500, "output": 80 }, "cost": 0.03
            }),
        );
        store.v2_message(
            "ses_new",
            "msg_fail",
            1,
            "compaction",
            json!({
                "status": "failed", "reason": "manual",
                "error": { "type": "provider", "message": "context too large" },
                "tokens": { "input": 400, "output": 0 }
            }),
        );

        let messages = store.messages("ses_new");
        let ok = &messages[0];
        assert_eq!(ok.subtype.as_deref(), Some("compact_boundary"));
        assert_eq!(ok.model.as_deref(), Some("glm"));
        assert_eq!(ok.usage.as_ref().unwrap().input_tokens, Some(500));
        assert_eq!(ok.cost_usd, Some(0.03));

        let failed = &messages[1];
        assert_eq!(failed.subtype, None);
        assert_eq!(failed.level.as_deref(), Some("error"));
        assert_eq!(
            failed.content,
            Some(json!(
                "Context compaction (manual) failed: context too large"
            ))
        );
        assert_eq!(failed.usage.as_ref().unwrap().input_tokens, Some(400));
    }

    #[test]
    fn search_finds_text_that_only_lives_in_session_part_rows() {
        let store = store(false);
        store.v2_session("ses_new", Some("t"), None, 9000);
        store.v2_message(
            "ses_new",
            "msg_a",
            0,
            "assistant",
            json!({ "finish": "stop" }),
        );
        store.conn.execute(
            "INSERT INTO session_part (message_id, session_id, ordinal, type, time_created, time_updated, data)
             VALUES ('msg_a', 'ses_new', 0, 'text', 1, 1, '{\"text\":\"split needle\"}')",
            [],
        ).unwrap();

        let (results, _) = search_from_db(&store.base, OPENCODE_DB_FILE, "needle", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].uuid, "msg_a");
    }

    /// The 2.x tables are still moving upstream. If one is reshaped, the
    /// 1.x sessions must keep showing rather than every query failing.
    #[test]
    fn reshaped_v2_table_falls_back_to_v1() {
        let dir = tempfile::tempdir().unwrap();
        let conn = Connection::open(dir.path().join(OPENCODE_DB_FILE)).unwrap();
        conn.execute_batch(V1_TABLES).unwrap();
        conn.execute_batch(
            "CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL, name TEXT,
                 time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL);
             CREATE TABLE session_v2 (id TEXT PRIMARY KEY, project TEXT);
             CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER,
                 time_created INTEGER, data TEXT);
             INSERT INTO project VALUES ('proj1', '/work/app', NULL, 1000, 2000);
             INSERT INTO session (id, project_id, title, time_created, time_updated)
                 VALUES ('ses_old', 'proj1', 'legacy', 1000, 1500);",
        )
        .unwrap();
        drop(conn);
        let base = dir.path().to_string_lossy().to_string();

        let projects = scan_projects_from_store(&base, OPENCODE_DB_FILE).unwrap();
        assert_eq!(projects[0].session_count, 1);
        let sessions =
            load_sessions_at(&base, OPENCODE_DB_FILE, "opencode://proj1", false).unwrap();
        assert_eq!(sessions[0].actual_session_id, "ses_old");
    }

    #[test]
    fn rows_that_are_not_objects_are_skipped_not_fatal() {
        let store = store(false);
        store.v2_session("ses_new", Some("t"), None, 9000);
        store.v2_message(
            "ses_new",
            "msg_bad",
            0,
            "assistant",
            json!(["not", "an", "object"]),
        );
        store.v2_message(
            "ses_new",
            "msg_ok",
            1,
            "user",
            json!({ "text": "still here" }),
        );
        store.conn.execute(
            "INSERT INTO session_part (message_id, session_id, ordinal, type, time_created, time_updated, data)
             VALUES ('msg_bad', 'ses_new', 0, 'text', 1, 1, '{\"text\":\"x\"}')",
            [],
        ).unwrap();

        let messages = store.messages("ses_new");
        let ids: Vec<&str> = messages.iter().map(|m| m.uuid.as_str()).collect();
        assert_eq!(ids, ["msg_ok"]);
    }

    #[test]
    fn tool_output_files_without_a_name_are_kept() {
        let store = store(false);
        store.v2_session("ses_new", Some("t"), None, 9000);
        store.v2_message("ses_new", "msg_a", 0, "assistant", json!({
            "content": [{ "type": "tool", "id": "call_r", "name": "read", "state": {
                "status": "completed",
                "input": { "filePath": "/work/app/shot.png" },
                "content": [
                    { "type": "text", "text": "Image read successfully" },
                    { "type": "file", "uri": "data:image/png;base64,AQID", "mime": "image/png" },
                    { "type": "file", "uri": "file:///work/app/report.pdf", "mime": "application/pdf" }
                ]
            }}]
        }));

        let messages = store.messages("ses_new");
        let output = blocks(&messages[0])[1]["content"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(
            output[0],
            json!({ "type": "text", "text": "Image read successfully" })
        );
        assert_eq!(output[1]["source"]["data"], "AQID");
        assert_eq!(
            output[2],
            json!({ "type": "text", "text": "[File] file:///work/app/report.pdf" })
        );
    }

    #[test]
    fn split_session_parts_come_before_inline_content() {
        let store = store(false);
        store.v2_session("ses_new", Some("t"), None, 9000);
        store.v2_message(
            "ses_new",
            "msg_a",
            0,
            "assistant",
            json!({
                "content": [{ "type": "text", "text": "inline tail" }], "finish": "stop"
            }),
        );
        for (ordinal, part_type, data) in [
            (1, "text", json!({ "text": "second" })),
            (
                0,
                "reasoning",
                json!({ "type": "reasoning", "text": "first" }),
            ),
        ] {
            store.conn.execute(
                "INSERT INTO session_part (message_id, session_id, ordinal, type, time_created, time_updated, data)
                 VALUES ('msg_a', 'ses_new', ?1, ?2, 1, 1, ?3)",
                rusqlite::params![ordinal, part_type, data.to_string()],
            ).unwrap();
        }

        let messages = store.messages("ses_new");
        let b = blocks(&messages[0]);
        assert_eq!(b[0], json!({ "type": "thinking", "thinking": "first" }));
        assert_eq!(b[1], json!({ "type": "text", "text": "second" }));
        assert_eq!(b[2], json!({ "type": "text", "text": "inline tail" }));
        assert_eq!(b[3]["type"], "opencode_step");
    }

    #[test]
    fn media_refs_resolve_through_the_blob_table() {
        let store = store(false);
        store.v2_session("ses_new", Some("t"), None, 9000);
        let hash = "ab".repeat(32);
        store.conn.execute(
            "INSERT INTO blob (hash, mime, bytes, data, time_created) VALUES (?1, 'image/png', 3, ?2, 1)",
            rusqlite::params![hash, vec![1_u8, 2, 3]],
        ).unwrap();
        store.v2_message("ses_new", "msg_u", 0, "user", json!({
            "text": "look",
            "files": [
                { "uri": format!("media:{hash}"), "mime": "image/png", "name": "kept.png" },
                { "uri": format!("media:{}", "cd".repeat(32)), "mime": "image/png", "name": "gone.png" }
            ]
        }));

        let messages = store.messages("ses_new");
        let b = blocks(&messages[0]);
        assert_eq!(b[1]["source"]["data"], "AQID");
        assert_eq!(b[2], json!({ "type": "text", "text": "[File] gone.png" }));
    }

    #[test]
    fn v2_child_sessions_come_from_session_v2() {
        let store = store(true);
        store.v2_session("ses_parent", Some("parent"), None, 9000);
        store.v2_session(
            "ses_child",
            Some("explore the repo"),
            Some("ses_parent"),
            9100,
        );
        store.v2_message("ses_child", "msg_c", 0, "user", json!({ "text": "go" }));
        store.v2_session("ses_child_untitled", None, Some("ses_parent"), 9200);

        let children =
            load_child_sessions_from_db(&store.base, OPENCODE_DB_FILE, "proj1", "ses_parent");
        let ids: Vec<&str> = children.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids.len(), 2);
        let child = children.iter().find(|c| c.id == "ses_child").unwrap();
        assert_eq!(child.title, "explore the repo");
        assert_eq!(child.message_count, 1);
    }

    #[test]
    fn subagent_tool_reads_as_task() {
        let store = store(false);
        store.v2_session("ses_new", Some("t"), None, 9000);
        store.v2_message(
            "ses_new",
            "msg_a",
            0,
            "assistant",
            json!({
                "content": [{ "type": "tool", "id": "call_s", "name": "subagent", "state": {
                    "status": "completed",
                    "input": { "agent": "explore", "description": "find it", "prompt": "look" },
                    "content": [{ "type": "text", "text": "found" }],
                    "metadata": { "sessionID": "ses_child" }
                }}]
            }),
        );

        let messages = store.messages("ses_new");
        let b = blocks(&messages[0]);
        assert_eq!(b[0]["name"], "Task");
        assert_eq!(b[0]["input"]["subagent_type"], "explore");
        assert_eq!(b[1]["content"], "found");
        assert_eq!(b[1]["toolUseResult"]["metadata"]["sessionID"], "ses_child");
    }
}

#[cfg(test)]
mod outcome_preservation_tests {
    use super::*;
    #[test]
    fn producer_outcome_evidence_is_not_fabricated_or_dropped() {
        for raw in ["grep", "grep_search", "Grep", "read_file"] {
            let part = serde_json::json!({"type":"tool","tool":raw,"callID":"c","state":{"status":"completed","input":{},"output":"synthetic"}});
            let (content, _, _) = process_parts(&[part], "m", "s");
            assert_eq!(content.unwrap()[0]["rawToolName"], raw);
        }
    }
}
