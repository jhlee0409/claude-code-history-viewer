use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession, TokenUsage};
use crate::providers::ProviderInfo;
use crate::utils::{build_provider_message, ms_to_iso, search_json_value_case_insensitive};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

/// Detect Cursor installation
pub fn detect() -> Option<ProviderInfo> {
    let base = get_base_path()?;
    let global_db = base.join("globalStorage/state.vscdb");
    let is_available = global_db.is_file();

    Some(ProviderInfo {
        id: "cursor".to_string(),
        display_name: "Cursor".to_string(),
        base_path: base.to_string_lossy().to_string(),
        is_available,
    })
}

/// Get Cursor user data path
pub fn get_base_path() -> Option<PathBuf> {
    if let Ok(env_val) = std::env::var("CURSOR_USER_DIR") {
        let path = PathBuf::from(env_val);
        if path.is_dir() {
            return Some(path.canonicalize().unwrap_or(path));
        }
    }

    let home = dirs::home_dir()?;

    #[cfg(target_os = "macos")]
    let base = home.join("Library/Application Support/Cursor/User");

    #[cfg(target_os = "linux")]
    let base = home.join(".config/Cursor/User");

    #[cfg(target_os = "windows")]
    let base = home.join("AppData/Roaming/Cursor/User");

    if base.is_dir() {
        Some(base)
    } else {
        None
    }
}

/// Scan Cursor projects from migrated global Composer data.
/// Falls back to legacy workspace `allComposers` only when global storage is empty.
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let base = get_base_path().ok_or("Cursor not found")?;
    let mut projects = scan_projects_from_global(&base)?;
    if projects.is_empty() {
        projects = scan_projects_in(&base.join("workspaceStorage"))?;
    }
    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

/// Resolve a human-readable project name from a `cursor://` workspace path
/// via `workspace.json` (folder basename), without requiring a full scan.
pub fn display_name_for_project_path(project_path: &str) -> Option<String> {
    let ws_path = project_path
        .strip_prefix("cursor://")
        .unwrap_or(project_path);
    if let Some(rest) = ws_path.strip_prefix("workspace/") {
        let id = rest.split('/').next().unwrap_or(rest);
        if is_orphan_workspace_id(id) {
            return Some("Cursor".to_string());
        }
        if !id.is_empty() {
            return Some(id.to_string());
        }
        return Some("Cursor".to_string());
    }
    let workspace_json = PathBuf::from(ws_path).join("workspace.json");
    read_workspace_folder(&workspace_json).and_then(|folder| {
        PathBuf::from(&folder)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .filter(|n| !n.is_empty())
    })
}

fn scan_projects_in(ws_dir: &Path) -> Result<Vec<ClaudeProject>, String> {
    if !ws_dir.is_dir() {
        return Ok(Vec::new());
    }

    let ws_paths: Vec<PathBuf> = fs::read_dir(ws_dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|entry| entry.path())
        .collect();

    // Each workspace visit opens its own state.vscdb (5s busy_timeout when
    // locked), so with many workspaces the sequential loop dominated startup.
    // Bounded parallel map; a broken workspace still just yields None.
    let mut projects: Vec<ClaudeProject> =
        crate::utils::par_map_bounded(ws_paths, |ws_path| scan_workspace(&ws_path))
            .into_iter()
            .flatten()
            .collect();

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

fn scan_projects_from_global(base: &Path) -> Result<Vec<ClaudeProject>, String> {
    let global_db = base.join("globalStorage/state.vscdb");
    if !global_db.is_file() {
        return Ok(Vec::new());
    }

    let conn = Connection::open_with_flags(&global_db, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open Cursor global DB: {e}"))?;
    let _ = conn.busy_timeout(std::time::Duration::from_secs(5));

    let mut stmt = conn
        .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
        .map_err(|e| format!("Query failed: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            let key: String = row.get(0)?;
            let value: String = row.get(1)?;
            Ok((key, value))
        })
        .map_err(|e| format!("Query failed: {e}"))?;

    let ws_root = base.join("workspaceStorage");
    let mut by_workspace: std::collections::HashMap<String, GlobalWorkspaceAcc> =
        std::collections::HashMap::new();

    for row in rows.flatten() {
        let (key, value) = row;
        let Some(composer_id) = key.strip_prefix("composerData:") else {
            continue;
        };
        let Ok(composer) = parse_cursor_json(&value) else {
            continue;
        };
        if composer_is_archived(&composer) {
            continue;
        }
        if !composer_has_conversation(&composer) {
            continue;
        }

        let (raw_workspace_id, folder_path) = workspace_identity_from_composer(&composer);
        let workspace_id = normalize_workspace_bucket_id(&raw_workspace_id);
        let entry =
            by_workspace
                .entry(workspace_id.clone())
                .or_insert_with(|| GlobalWorkspaceAcc {
                    folder_path: folder_path.clone(),
                    session_count: 0,
                    last_modified_ms: 0,
                });
        if entry.folder_path.is_empty() && !folder_path.is_empty() {
            entry.folder_path = folder_path;
        }
        entry.session_count += 1;
        entry.last_modified_ms = entry.last_modified_ms.max(composer_timestamp_ms(&composer));
        let _ = composer_id;
    }

    let mut projects = Vec::with_capacity(by_workspace.len());
    for (workspace_id, acc) in by_workspace {
        let ws_path = ws_root.join(&workspace_id);
        let (path, actual_path, name) = if is_orphan_workspace_id(&workspace_id) {
            (
                "cursor://workspace/unassigned".to_string(),
                String::new(),
                "Cursor".to_string(),
            )
        } else if ws_path.is_dir() {
            let folder = read_workspace_folder(&ws_path.join("workspace.json"))
                .unwrap_or_else(|| acc.folder_path.clone());
            let name = PathBuf::from(&folder)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .filter(|n| !n.is_empty())
                .or_else(|| {
                    PathBuf::from(&acc.folder_path)
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                })
                .unwrap_or_else(|| workspace_id.clone());
            (
                format!("cursor://{}", ws_path.to_string_lossy()),
                folder,
                name,
            )
        } else {
            let name = PathBuf::from(&acc.folder_path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| workspace_id.clone());
            (
                format!("cursor://workspace/{workspace_id}"),
                acc.folder_path.clone(),
                name,
            )
        };

        projects.push(ClaudeProject {
            name,
            path,
            actual_path,
            session_count: acc.session_count,
            message_count: 0,
            last_modified: ms_to_iso(acc.last_modified_ms),
            git_info: None,
            provider: Some("cursor".to_string()),
            storage_type: Some("sqlite".to_string()),
            custom_directory_label: None,
        });
    }

    Ok(projects)
}

struct GlobalWorkspaceAcc {
    folder_path: String,
    session_count: usize,
    last_modified_ms: u64,
}

/// One workspace dir → one project, or `None` when the workspace has no
/// (readable) composer data. All failure modes skip the workspace, never the
/// whole scan.
fn scan_workspace(ws_path: &Path) -> Option<ClaudeProject> {
    if crate::utils::is_symlink(ws_path) || !ws_path.is_dir() {
        return None;
    }

    // Read workspace.json to get project folder
    let workspace_json = ws_path.join("workspace.json");
    let project_folder = read_workspace_folder(&workspace_json)?;

    // Read composer list from workspace state DB
    let ws_db_path = ws_path.join("state.vscdb");
    let composers = read_workspace_composers(&ws_db_path).ok()?;

    if composers.is_empty() {
        return None;
    }

    let project_name = PathBuf::from(&project_folder)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let active_composers: Vec<&Value> = composers
        .iter()
        .filter(|c| {
            !c.get("isArchived")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .collect();
    let session_count = active_composers.len();
    let last_modified = active_composers
        .iter()
        .filter_map(|c| c.get("lastUpdatedAt").and_then(Value::as_f64))
        .fold(0.0f64, f64::max);

    Some(ClaudeProject {
        name: project_name,
        path: format!("cursor://{}", ws_path.to_string_lossy()),
        actual_path: project_folder,
        session_count,
        message_count: 0, // Loaded on demand
        last_modified: ms_to_iso(last_modified as u64),
        git_info: None,
        provider: Some("cursor".to_string()),
        storage_type: Some("sqlite".to_string()),
        custom_directory_label: None,
    })
}

/// Load sessions (composers) for a Cursor project
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let ws_path = project_path
        .strip_prefix("cursor://")
        .unwrap_or(project_path);

    let (workspace_id, project_name, legacy_composers) =
        if let Some(id) = ws_path.strip_prefix("workspace/") {
            let workspace_id = normalize_workspace_bucket_id(id.split('/').next().unwrap_or(id));
            let project_name = if is_orphan_workspace_id(&workspace_id) {
                "Cursor".to_string()
            } else {
                display_name_for_project_path(project_path).unwrap_or_else(|| workspace_id.clone())
            };
            (workspace_id, project_name, Vec::new())
        } else {
            let ws_path_buf = PathBuf::from(ws_path);
            if !ws_path_buf.is_absolute() {
                return Err("Cursor workspace path must be absolute".to_string());
            }
            let workspace_id = normalize_workspace_bucket_id(
                &ws_path_buf
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
            );
            let workspace_json = ws_path_buf.join("workspace.json");
            let project_name = read_workspace_folder(&workspace_json)
                .and_then(|folder| {
                    PathBuf::from(&folder)
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                })
                .unwrap_or_else(|| "Cursor".to_string());
            let legacy = read_workspace_composers(&ws_path_buf.join("state.vscdb"))?;
            (workspace_id, project_name, legacy)
        };

    let composers = if legacy_composers.is_empty() {
        read_global_composers_for_workspace(&workspace_id)?
    } else {
        legacy_composers
    };

    let mut sessions: Vec<ClaudeSession> = composers
        .iter()
        .filter_map(|c| composer_to_session(c, &project_name))
        .collect();

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

fn composer_to_session(composer: &Value, project_name: &str) -> Option<ClaudeSession> {
    let id = composer
        .get("composerId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())?;
    if composer_is_archived(composer) {
        return None;
    }
    let name = composer
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("Untitled");
    let created = composer_timestamp_ms(composer);
    let updated = composer
        .get("lastUpdatedAt")
        .and_then(Value::as_f64)
        .map(|v| v as u64)
        .filter(|v| *v > 0)
        .unwrap_or(created);
    let mode = composer
        .get("unifiedMode")
        .and_then(Value::as_str)
        .unwrap_or("chat");

    Some(ClaudeSession {
        session_id: format!("cursor://{id}"),
        actual_session_id: id.to_string(),
        file_path: format!("cursor://{id}"),
        project_name: project_name.to_string(),
        message_count: 0,
        first_message_time: ms_to_iso(created),
        last_message_time: ms_to_iso(updated),
        last_modified: ms_to_iso(updated),
        has_tool_use: mode == "agent",
        has_errors: false,
        summary: Some(name.to_string()),
        is_renamed: false,
        provider: Some("cursor".to_string()),
        storage_type: Some("sqlite".to_string()),
        entrypoint: None,
    })
}

/// Lightweight stats messages: composer headers + token signal (no bubble bodies).
pub fn load_stats_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let (composer_id, composer) = load_composer_value(session_path)?;
    Ok(stats_messages_from_composer(&composer_id, &composer))
}

/// One-pass global stats source: open the Cursor DB once and emit
/// `(project_display_name, stats_messages)` for every active composer.
pub fn collect_global_stats_sessions() -> Result<Vec<(String, Vec<ClaudeMessage>)>, String> {
    let base = get_base_path().ok_or("Cursor not found")?;
    let global_db = base.join("globalStorage/state.vscdb");
    if !global_db.is_file() {
        return Ok(Vec::new());
    }

    let conn = Connection::open_with_flags(&global_db, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open Cursor global DB: {e}"))?;
    let _ = conn.busy_timeout(std::time::Duration::from_secs(5));

    let mut stmt = conn
        .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
        .map_err(|e| format!("Query failed: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            let key: String = row.get(0)?;
            let value: String = row.get(1)?;
            Ok((key, value))
        })
        .map_err(|e| format!("Query failed: {e}"))?;

    let ws_root = base.join("workspaceStorage");
    let mut sessions = Vec::new();
    for row in rows.flatten() {
        let (key, value) = row;
        let Some(composer_id) = key.strip_prefix("composerData:") else {
            continue;
        };
        let Ok(composer) = parse_cursor_json(&value) else {
            continue;
        };
        if composer_is_archived(&composer) || !composer_has_conversation(&composer) {
            continue;
        }

        let (raw_workspace_id, folder_path) = workspace_identity_from_composer(&composer);
        let workspace_id = normalize_workspace_bucket_id(&raw_workspace_id);
        let project_name = resolve_project_display_name(&ws_root, &workspace_id, &folder_path);
        let project_display_name = format!("{project_name} [cursor]");
        let messages = stats_messages_from_composer(composer_id, &composer);
        if !messages.is_empty() {
            sessions.push((project_display_name, messages));
        }
    }

    Ok(sessions)
}

fn resolve_project_display_name(ws_root: &Path, workspace_id: &str, folder_path: &str) -> String {
    if is_orphan_workspace_id(workspace_id) {
        return "Cursor".to_string();
    }
    let ws_path = ws_root.join(workspace_id);
    if ws_path.is_dir() {
        if let Some(folder) = read_workspace_folder(&ws_path.join("workspace.json")) {
            if let Some(name) = PathBuf::from(&folder)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .filter(|n| !n.is_empty())
            {
                return name;
            }
        }
    }
    PathBuf::from(folder_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| workspace_id.to_string())
}

fn stats_messages_from_composer(composer_id: &str, composer: &Value) -> Vec<ClaudeMessage> {
    let stamp = ms_to_iso(composer_timestamp_ms(composer));
    let headers = composer
        .get("fullConversationHeadersOnly")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut messages = Vec::with_capacity(headers.len().max(1));
    for (index, header) in headers.iter().enumerate() {
        let bubble_type = header.get("type").and_then(Value::as_u64).unwrap_or(0);
        let (message_type, role) = match bubble_type {
            1 => ("user", Some("user")),
            2 => ("assistant", Some("assistant")),
            _ => continue,
        };
        let bubble_id = header
            .get("bubbleId")
            .and_then(Value::as_str)
            .unwrap_or("stats");
        messages.push(build_provider_message(
            "cursor",
            format!("{composer_id}-{bubble_id}-{index}"),
            composer_id,
            stamp.clone(),
            message_type,
            role,
            Some(serde_json::json!([{"type": "text", "text": ""}])),
            if message_type == "assistant" {
                Some("cursor".to_string())
            } else {
                None
            },
        ));
    }

    if messages
        .iter()
        .all(|message| message.message_type != "assistant")
        && composer_has_conversation(composer)
    {
        messages.push(build_provider_message(
            "cursor",
            format!("{composer_id}-usage"),
            composer_id,
            stamp,
            "assistant",
            Some("assistant"),
            Some(serde_json::json!([{"type": "text", "text": ""}])),
            Some("cursor".to_string()),
        ));
    }

    attach_composer_token_usage(composer, &mut messages);
    messages
}

/// Load messages from a Cursor composer
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let (composer_id, composer) = load_composer_value(session_path)?;

    let base = get_base_path().ok_or("Cursor not found")?;
    let global_db_path = base.join("globalStorage/state.vscdb");

    let conn = Connection::open_with_flags(&global_db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open Cursor DB: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to set busy timeout: {e}"))?;

    let headers = composer
        .get("fullConversationHeadersOnly")
        .and_then(Value::as_array)
        .ok_or("No conversation headers found")?;

    // Batch load all bubbles for this composer in a single query
    let prefix = format!("bubbleId:{composer_id}:");
    let mut stmt = conn
        .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE ?1")
        .map_err(|e| format!("Query failed: {e}"))?;
    let pattern = format!("{prefix}%");
    let mut bubble_map: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let rows = stmt
        .query_map([&pattern], |row| {
            let key: String = row.get(0)?;
            let value: String = row.get(1)?;
            Ok((key, value))
        })
        .map_err(|e| format!("Query failed: {e}"))?;
    for row in rows.flatten() {
        let (key, value) = row;
        if let Some(bid) = key.strip_prefix(&prefix) {
            bubble_map.insert(bid.to_string(), value);
        }
    }

    let mut messages = Vec::with_capacity(headers.len());

    for header in headers {
        let bubble_id = match header.get("bubbleId").and_then(Value::as_str) {
            Some(id) => id,
            None => continue,
        };
        let bubble_type = header.get("type").and_then(Value::as_u64).unwrap_or(0);

        let bubble_data = match bubble_map.get(bubble_id) {
            Some(d) => d,
            None => continue,
        };

        let bubble: Value = match parse_cursor_json(bubble_data) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if let Some(msg) = convert_cursor_bubble(&bubble, bubble_type, &composer_id) {
            messages.push(msg);
        }
    }

    if messages
        .iter()
        .all(|message| message.message_type != "assistant")
        && composer_has_conversation(&composer)
    {
        let stamp = ms_to_iso(composer_timestamp_ms(&composer));
        messages.push(build_provider_message(
            "cursor",
            format!("{composer_id}-usage"),
            &composer_id,
            stamp,
            "assistant",
            Some("assistant"),
            Some(serde_json::json!([{"type": "text", "text": ""}])),
            Some("cursor".to_string()),
        ));
    }

    attach_composer_token_usage(&composer, &mut messages);

    Ok(messages)
}

fn attach_composer_token_usage(composer: &Value, messages: &mut [ClaudeMessage]) {
    if messages.is_empty() {
        return;
    }

    let tokens = composer
        .get("promptTokenBreakdown")
        .and_then(|v| v.get("totalUsedTokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    if tokens == 0 {
        return;
    }

    let capped = u32::try_from(tokens.min(u64::from(u32::MAX))).unwrap_or(u32::MAX);
    let stamp = ms_to_iso(composer_timestamp_ms(composer));
    if let Some(message) = messages
        .iter_mut()
        .rev()
        .find(|message| message.message_type == "assistant")
    {
        message.model = Some("cursor".to_string());
        message.usage = Some(TokenUsage {
            input_tokens: Some(capped),
            output_tokens: None,
            cache_creation_input_tokens: None,
            cache_read_input_tokens: None,
            service_tier: None,
        });
        if !stamp.is_empty() {
            message.timestamp = stamp;
        }
    }
}

/// Search across all Cursor conversations
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let base = get_base_path().ok_or("Cursor not found")?;
    let global_db_path = base.join("globalStorage/state.vscdb");

    if !global_db_path.is_file() || query.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }

    let conn = Connection::open_with_flags(&global_db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open Cursor DB: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to set busy timeout: {e}"))?;

    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    // Search through bubble content using SQL LIKE for efficiency
    let mut stmt = conn
        .prepare(
            "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' AND value LIKE ?1",
        )
        .map_err(|e| format!("Query failed: {e}"))?;

    let pattern = format!("%{query}%");
    let rows = stmt
        .query_map([&pattern], |row| {
            let key: String = row.get(0)?;
            let value: String = row.get(1)?;
            Ok((key, value))
        })
        .map_err(|e| format!("Query failed: {e}"))?;

    for row in rows.flatten() {
        let (key, data) = row;
        let bubble: Value = match parse_cursor_json(&data) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // Extract composer ID from key: bubbleId:<composerId>:<bubbleId>
        let parts: Vec<&str> = key.splitn(3, ':').collect();
        let composer_id = if parts.len() >= 3 { parts[1] } else { "" };

        let bubble_type = bubble.get("type").and_then(Value::as_u64).unwrap_or(0);

        if let Some(mut msg) = convert_cursor_bubble(&bubble, bubble_type, composer_id) {
            if let Some(ref c) = msg.content {
                if search_json_value_case_insensitive(c, &query_lower) {
                    msg.project_name = Some("Cursor".to_string());
                    results.push(msg);
                    if results.len() >= limit {
                        return Ok(results);
                    }
                }
            }
        }
    }

    Ok(results)
}

// ============================================================================
// Private helpers
// ============================================================================

fn read_workspace_folder(workspace_json_path: &Path) -> Option<String> {
    let data = fs::read_to_string(workspace_json_path).ok()?;
    let json: Value = serde_json::from_str(&data).ok()?;
    let folder = json.get("folder").and_then(Value::as_str)?;
    // "file:///Users/jack/project" → "/Users/jack/project"
    folder.strip_prefix("file://").map(|s| {
        // Handle Windows drive letters: file:///C:/Users/...
        let path = if s.len() > 2 && s.as_bytes()[2] == b':' {
            &s[1..]
        } else {
            s
        };
        // Percent-decode URI-encoded characters (e.g., %20 → space)
        percent_decode(path)
    })
}

fn load_composer_value(session_path: &str) -> Result<(String, Value), String> {
    let composer_id = session_path
        .strip_prefix("cursor://")
        .unwrap_or(session_path)
        .to_string();

    let base = get_base_path().ok_or("Cursor not found")?;
    let global_db_path = base.join("globalStorage/state.vscdb");
    let conn = Connection::open_with_flags(&global_db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open Cursor DB: {e}"))?;
    let _ = conn.busy_timeout(std::time::Duration::from_secs(5));

    let composer_key = format!("composerData:{composer_id}");
    let composer_data: String = conn
        .query_row(
            "SELECT value FROM cursorDiskKV WHERE key = ?1",
            [&composer_key],
            |row| row.get(0),
        )
        .map_err(|e| format!("Composer not found: {e}"))?;

    let composer = parse_cursor_json(&composer_data)?;
    Ok((composer_id, composer))
}

fn read_workspace_composers(ws_db_path: &Path) -> Result<Vec<Value>, String> {
    if !ws_db_path.is_file() {
        return Ok(Vec::new());
    }

    let conn = Connection::open_with_flags(ws_db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open workspace DB: {e}"))?;
    let _ = conn.busy_timeout(std::time::Duration::from_secs(5));

    let data: Result<String, _> = conn.query_row(
        "SELECT value FROM ItemTable WHERE key = 'composer.composerData'",
        [],
        |row| row.get(0),
    );

    let data = match data {
        Ok(d) => d,
        Err(_) => return Ok(Vec::new()),
    };

    let json: Value = parse_cursor_json(&data)?;

    let composers = json
        .get("allComposers")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    Ok(composers)
}

fn read_global_composers_for_workspace(workspace_id: &str) -> Result<Vec<Value>, String> {
    let base = get_base_path().ok_or("Cursor not found")?;
    let global_db = base.join("globalStorage/state.vscdb");
    if !global_db.is_file() {
        return Ok(Vec::new());
    }

    let conn = Connection::open_with_flags(&global_db, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open Cursor global DB: {e}"))?;
    let _ = conn.busy_timeout(std::time::Duration::from_secs(5));

    let mut stmt = conn
        .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
        .map_err(|e| format!("Query failed: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            let key: String = row.get(0)?;
            let value: String = row.get(1)?;
            Ok((key, value))
        })
        .map_err(|e| format!("Query failed: {e}"))?;

    let mut composers = Vec::new();
    for row in rows.flatten() {
        let (key, value) = row;
        let Some(composer_id) = key.strip_prefix("composerData:") else {
            continue;
        };
        let Ok(mut composer) = parse_cursor_json(&value) else {
            continue;
        };
        if composer_is_archived(&composer) || !composer_has_conversation(&composer) {
            continue;
        }
        let (raw_id, _) = workspace_identity_from_composer(&composer);
        let id = normalize_workspace_bucket_id(&raw_id);
        if id != normalize_workspace_bucket_id(workspace_id) {
            continue;
        }
        if composer.get("composerId").and_then(Value::as_str).is_none() {
            if let Some(obj) = composer.as_object_mut() {
                obj.insert(
                    "composerId".to_string(),
                    Value::String(composer_id.to_string()),
                );
            }
        }
        composers.push(composer);
    }

    Ok(composers)
}

fn composer_is_archived(composer: &Value) -> bool {
    composer
        .get("isArchived")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn composer_has_conversation(composer: &Value) -> bool {
    let has_headers = composer
        .get("fullConversationHeadersOnly")
        .and_then(Value::as_array)
        .is_some_and(|headers| !headers.is_empty());
    let has_tokens = composer
        .get("promptTokenBreakdown")
        .and_then(|v| v.get("totalUsedTokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0)
        > 0;
    has_headers || has_tokens
}

fn workspace_identity_from_composer(composer: &Value) -> (String, String) {
    let wi = composer.get("workspaceIdentifier");
    let workspace_id = wi
        .and_then(|v| v.get("id"))
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .unwrap_or("unassigned")
        .to_string();
    let folder_path = wi
        .and_then(|v| v.get("uri"))
        .and_then(|uri| {
            uri.get("fsPath")
                .or_else(|| uri.get("path"))
                .and_then(Value::as_str)
        })
        .unwrap_or("")
        .to_string();
    (workspace_id, folder_path)
}

fn is_orphan_workspace_id(workspace_id: &str) -> bool {
    workspace_id.is_empty() || workspace_id == "unassigned" || workspace_id == "empty-window"
}

fn normalize_workspace_bucket_id(workspace_id: &str) -> String {
    if is_orphan_workspace_id(workspace_id) {
        "unassigned".to_string()
    } else {
        workspace_id.to_string()
    }
}

fn composer_timestamp_ms(composer: &Value) -> u64 {
    composer
        .get("lastUpdatedAt")
        .and_then(Value::as_f64)
        .map(|v| v as u64)
        .filter(|v| *v > 0)
        .or_else(|| {
            composer
                .get("createdAt")
                .and_then(Value::as_f64)
                .map(|v| v as u64)
                .filter(|v| *v > 0)
        })
        .unwrap_or(0)
}

/// Parse Cursor's JSON which may contain control characters
fn parse_cursor_json(data: &str) -> Result<Value, String> {
    // Cursor data can contain embedded control characters — sanitize first
    let sanitized: String = data
        .chars()
        .map(|c| {
            if c.is_control() && c != '\n' && c != '\r' && c != '\t' {
                ' '
            } else {
                c
            }
        })
        .collect();

    serde_json::from_str(&sanitized).map_err(|e| format!("JSON parse error: {e}"))
}

/// Decode percent-encoded URI characters (e.g., `%20` → space), preserving
/// UTF-8 multibyte sequences.
///
/// Operates on raw bytes — never slices the `&str` — because a literal `%`
/// followed by a multibyte UTF-8 character (e.g. a workspace folder named
/// `100%€done`) would make `&input[i+1..i+3]` land mid-codepoint and panic.
fn percent_decode(input: &str) -> String {
    let mut buf = Vec::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            // Only decode when both following bytes are ASCII hex digits.
            // `u8 as char` is the byte's Latin-1 char; `to_digit(16)` is `None`
            // for any non-ASCII byte (multibyte lead/continuation), so a `%`
            // before a multibyte character falls through as a literal `%`.
            if let (Some(hi), Some(lo)) = (
                (bytes[i + 1] as char).to_digit(16),
                (bytes[i + 2] as char).to_digit(16),
            ) {
                buf.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        buf.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(buf).unwrap_or_else(|_| input.to_string())
}

/// Convert a Cursor bubble to `ClaudeMessage`
fn convert_cursor_bubble(
    bubble: &Value,
    bubble_type: u64,
    session_id: &str,
) -> Option<ClaudeMessage> {
    let timestamp = extract_bubble_timestamp(bubble);
    let text = bubble.get("text").and_then(Value::as_str).unwrap_or("");
    let bubble_id = bubble
        .get("bubbleId")
        .and_then(Value::as_str)
        .unwrap_or("unknown");

    match bubble_type {
        1 => convert_user_bubble(bubble, text, bubble_id, session_id, &timestamp),
        2 => convert_assistant_bubble(bubble, text, bubble_id, session_id, &timestamp),
        _ => None,
    }
}

fn convert_user_bubble(
    bubble: &Value,
    text: &str,
    bubble_id: &str,
    session_id: &str,
    timestamp: &str,
) -> Option<ClaudeMessage> {
    let mut content_blocks: Vec<Value> = Vec::new();

    // Add text block only if non-empty
    if !text.is_empty() {
        content_blocks.push(serde_json::json!({"type": "text", "text": text}));
    }

    // Add image attachments if present
    if let Some(images) = bubble.get("images").and_then(Value::as_array) {
        for img in images {
            if let Some(url) = img.as_str() {
                if url.starts_with("data:image/") {
                    // Parse mime type from data URI: "data:image/png;base64,..."
                    if let Some((header, data)) = url.split_once(',') {
                        let media_type = header
                            .strip_prefix("data:")
                            .and_then(|h| h.split_once(';'))
                            .map(|(mime, _)| mime)
                            .unwrap_or("image/png");
                        content_blocks.push(serde_json::json!({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": data
                            }
                        }));
                    }
                }
            }
        }
    }

    if content_blocks.is_empty() {
        return None;
    }

    Some(build_provider_message(
        "cursor",
        bubble_id.to_string(),
        session_id,
        timestamp.to_string(),
        "user",
        Some("user"),
        Some(Value::Array(content_blocks)),
        None,
    ))
}

fn convert_assistant_bubble(
    bubble: &Value,
    text: &str,
    bubble_id: &str,
    session_id: &str,
    timestamp: &str,
) -> Option<ClaudeMessage> {
    let mut content_blocks: Vec<Value> = Vec::new();

    // Check for tool call
    if let Some(tool_data) = bubble.get("toolFormerData") {
        let tool_name = tool_data
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let tool_call_id = tool_data
            .get("toolCallId")
            .and_then(Value::as_str)
            .unwrap_or(bubble_id);
        let status = tool_data
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("completed");
        let raw_args = tool_data
            .get("rawArgs")
            .and_then(Value::as_str)
            .unwrap_or("{}");
        let args: Value =
            serde_json::from_str(raw_args).unwrap_or(Value::Object(serde_json::Map::default()));

        let mapped_name = map_cursor_tool_name(tool_name);

        content_blocks.push(serde_json::json!({
            "type": "tool_use",
            "id": tool_call_id,
            "name": mapped_name,
            "input": args
        }));

        // Add text as result if present
        if !text.is_empty() {
            content_blocks.push(serde_json::json!({
                "type": "tool_result",
                "tool_use_id": tool_call_id,
                "content": text,
                "is_error": status == "error" || status == "rejected"
            }));
        }
    } else if !text.is_empty() {
        // Check if this is a thinking bubble
        if bubble
            .get("isThought")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            content_blocks.push(serde_json::json!({
                "type": "thinking",
                "thinking": text
            }));
        } else {
            content_blocks.push(serde_json::json!({"type": "text", "text": text}));
        }
    }

    if content_blocks.is_empty() {
        return None;
    }

    Some(build_provider_message(
        "cursor",
        bubble_id.to_string(),
        session_id,
        timestamp.to_string(),
        "assistant",
        Some("assistant"),
        Some(Value::Array(content_blocks)),
        Some("cursor".to_string()),
    ))
}

fn extract_bubble_timestamp(bubble: &Value) -> String {
    bubble
        .get("createdAt")
        .and_then(Value::as_str)
        .filter(|timestamp| !timestamp.is_empty())
        .map(std::string::ToString::to_string)
        .or_else(|| {
            bubble
                .get("timestamp")
                .and_then(Value::as_str)
                .filter(|timestamp| !timestamp.is_empty())
                .map(std::string::ToString::to_string)
        })
        .or_else(|| {
            bubble
                .get("createdAt")
                .and_then(Value::as_f64)
                .map(|timestamp| ms_to_iso(timestamp as u64))
                .filter(|timestamp| !timestamp.is_empty())
        })
        .or_else(|| {
            bubble
                .get("timestamp")
                .and_then(Value::as_f64)
                .map(|timestamp| ms_to_iso(timestamp as u64))
                .filter(|timestamp| !timestamp.is_empty())
        })
        .unwrap_or_default()
}

fn map_cursor_tool_name(name: &str) -> &str {
    match name {
        "read_file" | "view_file" => "Read",
        "write_to_file" | "create_file" | "edit_file" => "Write",
        "execute_command" | "run_terminal_cmd" => "Bash",
        "list_directory" | "list_dir" => "Glob",
        "search_files" | "codebase_search" | "grep_search" => "Grep",
        "web_search" => "WebSearch",
        "web_fetch" | "fetch_url" => "WebFetch",
        _ => name,
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use serial_test::serial;

    struct EnvVarGuard {
        key: &'static str,
        original: Option<std::ffi::OsString>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: impl AsRef<std::ffi::OsStr>) -> Self {
            let original = std::env::var_os(key);
            std::env::set_var(key, value.as_ref());
            Self { key, original }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.original {
                Some(value) => std::env::set_var(self.key, value),
                None => std::env::remove_var(self.key),
            }
        }
    }

    #[test]
    fn test_percent_decode_basic() {
        assert_eq!(percent_decode("a%20b"), "a b");
        assert_eq!(percent_decode("%2F%2Fx"), "//x");
        // Incomplete / non-hex escapes pass through literally.
        assert_eq!(percent_decode("100%done"), "100%done");
        assert_eq!(percent_decode("a%2"), "a%2");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    #[test]
    fn test_percent_decode_no_panic_on_multibyte_after_percent() {
        // A literal `%` immediately before a multibyte UTF-8 char must not panic
        // (the byte slice would otherwise land mid-codepoint). E.g. a workspace
        // folder named "100%€done".
        assert_eq!(percent_decode("/p/100%€done/x"), "/p/100%€done/x");
        assert_eq!(percent_decode("%한글"), "%한글");
        assert_eq!(percent_decode("a%🎉b"), "a%🎉b");
        // Mixed: a valid escape followed later by a bare % before multibyte.
        assert_eq!(percent_decode("%20x%€"), " x%€");
    }

    #[test]
    fn test_convert_user_bubble() {
        let bubble = json!({
            "type": 1,
            "bubbleId": "user-1",
            "createdAt": "2026-01-24T09:45:46.113Z",
            "text": "Hello from Cursor",
            "images": []
        });
        let result = convert_cursor_bubble(&bubble, 1, "session-1").unwrap();
        assert_eq!(result.message_type, "user");
        assert_eq!(result.provider, Some("cursor".to_string()));
        assert_eq!(result.timestamp, "2026-01-24T09:45:46.113Z");
    }

    #[test]
    fn test_convert_assistant_text_bubble() {
        let bubble = json!({
            "type": 2,
            "bubbleId": "asst-1",
            "createdAt": "2026-01-24T09:46:01.000Z",
            "text": "Here is the answer"
        });
        let result = convert_cursor_bubble(&bubble, 2, "session-1").unwrap();
        assert_eq!(result.message_type, "assistant");
        assert_eq!(result.timestamp, "2026-01-24T09:46:01.000Z");
        let content = result.content.unwrap();
        let arr = content.as_array().unwrap();
        assert_eq!(arr[0]["type"], "text");
    }

    #[test]
    fn test_convert_user_bubble_with_numeric_timestamp() {
        let bubble = json!({
            "type": 1,
            "bubbleId": "user-2",
            "createdAt": 1700000000000_u64,
            "text": "Hello from Cursor",
            "images": []
        });
        let result = convert_cursor_bubble(&bubble, 1, "session-1").unwrap();
        assert_eq!(result.message_type, "user");
        assert_eq!(result.timestamp, ms_to_iso(1700000000000));
    }

    #[test]
    fn test_convert_assistant_tool_bubble() {
        let bubble = json!({
            "type": 2,
            "bubbleId": "asst-2",
            "text": "file contents here",
            "toolFormerData": {
                "tool": 7,
                "toolCallId": "toolu_123",
                "status": "completed",
                "name": "read_file",
                "rawArgs": "{\"target_file\": \"src/main.rs\"}"
            }
        });
        let result = convert_cursor_bubble(&bubble, 2, "session-1").unwrap();
        let content = result.content.unwrap();
        let arr = content.as_array().unwrap();
        assert_eq!(arr[0]["type"], "tool_use");
        assert_eq!(arr[0]["name"], "Read");
        assert_eq!(arr[1]["type"], "tool_result");
    }

    #[test]
    fn test_convert_thinking_bubble() {
        let bubble = json!({
            "type": 2,
            "bubbleId": "asst-3",
            "text": "Let me think about this...",
            "isThought": true
        });
        let result = convert_cursor_bubble(&bubble, 2, "session-1").unwrap();
        let content = result.content.unwrap();
        let arr = content.as_array().unwrap();
        assert_eq!(arr[0]["type"], "thinking");
    }

    #[test]
    fn test_map_cursor_tool_names() {
        assert_eq!(map_cursor_tool_name("read_file"), "Read");
        assert_eq!(map_cursor_tool_name("execute_command"), "Bash");
        assert_eq!(map_cursor_tool_name("codebase_search"), "Grep");
        assert_eq!(map_cursor_tool_name("write_to_file"), "Write");
        assert_eq!(map_cursor_tool_name("unknown_tool"), "unknown_tool");
    }

    #[test]
    fn test_parse_cursor_json_with_control_chars() {
        let data = "{\"text\": \"hello\x01world\"}";
        let result = parse_cursor_json(data).unwrap();
        assert!(result["text"].as_str().unwrap().contains("hello"));
    }

    #[test]
    fn test_read_workspace_folder_format() {
        // Test the folder URL parsing logic
        let folder = "file:///Users/jack/project";
        let result = folder.strip_prefix("file://").unwrap();
        assert_eq!(result, "/Users/jack/project");
    }

    #[test]
    fn test_ms_to_iso() {
        let result = ms_to_iso(1700000000000);
        assert!(result.starts_with("2023-11-14T"));
    }

    #[test]
    fn test_empty_bubble() {
        let bubble = json!({"type": 2, "bubbleId": "empty", "text": ""});
        assert!(convert_cursor_bubble(&bubble, 2, "session-1").is_none());
    }

    #[test]
    fn test_assistant_bubble_uses_composer_model() {
        let bubble = json!({
            "type": 2,
            "bubbleId": "a1",
            "text": "hello",
            "createdAt": "2026-07-27T20:00:00Z"
        });
        let msg = convert_cursor_bubble(&bubble, 2, "session-1").unwrap();
        assert_eq!(msg.model.as_deref(), Some("cursor"));
        assert_eq!(msg.provider.as_deref(), Some("cursor"));
    }

    #[test]
    fn test_attach_composer_token_usage_to_last_assistant() {
        let mut messages = vec![
            convert_cursor_bubble(
                &json!({
                    "type": 1,
                    "bubbleId": "u1",
                    "text": "hi",
                    "createdAt": "2026-07-27T20:00:00Z"
                }),
                1,
                "session-1",
            )
            .unwrap(),
            convert_cursor_bubble(
                &json!({
                    "type": 2,
                    "bubbleId": "a1",
                    "text": "hello",
                    "createdAt": "2026-07-27T20:01:00Z"
                }),
                2,
                "session-1",
            )
            .unwrap(),
        ];
        attach_composer_token_usage(
            &json!({ "promptTokenBreakdown": { "totalUsedTokens": 12345 } }),
            &mut messages,
        );
        assert!(messages[0].usage.is_none());
        assert_eq!(
            messages[1].usage.as_ref().and_then(|u| u.input_tokens),
            Some(12345)
        );
        assert_eq!(messages[1].model.as_deref(), Some("cursor"));
    }

    #[test]
    #[serial]
    fn test_scan_projects_from_migrated_global_composers() {
        let temp = tempfile::TempDir::new().unwrap();
        let user_dir = temp.path().join("User");
        let ws_hash = "hash-migrated";
        let ws_path = user_dir.join("workspaceStorage").join(ws_hash);
        fs::create_dir_all(&ws_path).unwrap();
        fs::create_dir_all(user_dir.join("globalStorage")).unwrap();
        fs::write(
            ws_path.join("workspace.json"),
            r#"{"folder":"file:///Users/test/demo-cursor"}"#,
        )
        .unwrap();

        let ws_conn = Connection::open(ws_path.join("state.vscdb")).unwrap();
        ws_conn
            .execute(
                "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value TEXT)",
                [],
            )
            .unwrap();
        ws_conn
            .execute(
                "INSERT INTO ItemTable (key, value) VALUES ('composer.composerData', ?1)",
                [r#"{"allComposers":[],"selectedComposerIds":["comp-1"],"hasMigratedComposerData":true}"#],
            )
            .unwrap();

        let global_conn =
            Connection::open(user_dir.join("globalStorage").join("state.vscdb")).unwrap();
        global_conn
            .execute(
                "CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value TEXT)",
                [],
            )
            .unwrap();
        let composer = json!({
            "composerId": "comp-1",
            "name": "Migrated chat",
            "createdAt": 1_700_000_000_000u64,
            "lastUpdatedAt": 1_700_000_100_000u64,
            "isArchived": false,
            "unifiedMode": "agent",
            "workspaceIdentifier": {
                "id": ws_hash,
                "uri": { "fsPath": "/Users/test/demo-cursor", "path": "/Users/test/demo-cursor" }
            },
            "fullConversationHeadersOnly": [
                { "bubbleId": "b1", "type": 1 },
                { "bubbleId": "b2", "type": 2 }
            ],
            "promptTokenBreakdown": { "totalUsedTokens": 9001 }
        })
        .to_string();
        global_conn
            .execute(
                "INSERT INTO cursorDiskKV (key, value) VALUES (?1, ?2)",
                rusqlite::params!["composerData:comp-1", composer],
            )
            .unwrap();
        global_conn
            .execute(
                "INSERT INTO cursorDiskKV (key, value) VALUES (?1, ?2)",
                rusqlite::params![
                    "bubbleId:comp-1:b1",
                    json!({
                        "bubbleId": "b1",
                        "type": 1,
                        "text": "hello",
                        "createdAt": "2026-07-27T20:00:00Z"
                    })
                    .to_string()
                ],
            )
            .unwrap();
        global_conn
            .execute(
                "INSERT INTO cursorDiskKV (key, value) VALUES (?1, ?2)",
                rusqlite::params![
                    "bubbleId:comp-1:b2",
                    json!({
                        "bubbleId": "b2",
                        "type": 2,
                        "text": "hi",
                        "createdAt": "2026-07-27T20:01:00Z"
                    })
                    .to_string()
                ],
            )
            .unwrap();

        let _env = EnvVarGuard::set("CURSOR_USER_DIR", &user_dir);
        let projects = scan_projects().unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "demo-cursor");
        assert!(projects[0].session_count >= 1);

        let sessions = load_sessions(&projects[0].path, false).unwrap();
        assert_eq!(sessions.len(), 1);
        let messages = load_messages(&sessions[0].file_path).unwrap();
        assert!(messages.iter().any(|m| {
            m.model.as_deref() == Some("cursor")
                && m.usage
                    .as_ref()
                    .and_then(|u| u.input_tokens)
                    .is_some_and(|tokens| tokens == 9001)
        }));
        let stats_messages = load_stats_messages(&sessions[0].file_path).unwrap();
        assert!(stats_messages.iter().any(|m| {
            m.model.as_deref() == Some("cursor")
                && m.usage
                    .as_ref()
                    .and_then(|u| u.input_tokens)
                    .is_some_and(|tokens| tokens == 9001)
        }));
    }

    /// Write a minimal valid Cursor workspace: `workspace.json` + a `state.vscdb`
    /// with one active composer.
    fn write_valid_workspace(ws_path: &Path, folder: &str, last_updated: u64) {
        fs::create_dir_all(ws_path).unwrap();
        fs::write(
            ws_path.join("workspace.json"),
            format!(r#"{{"folder":"file://{folder}"}}"#),
        )
        .unwrap();
        let conn = Connection::open(ws_path.join("state.vscdb")).unwrap();
        conn.execute(
            "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value TEXT)",
            [],
        )
        .unwrap();
        let value = json!({
            "allComposers": [{
                "composerId": "comp-1",
                "name": "chat",
                "createdAt": last_updated,
                "lastUpdatedAt": last_updated,
                "isArchived": false
            }]
        })
        .to_string();
        conn.execute(
            "INSERT INTO ItemTable (key, value) VALUES ('composer.composerData', ?1)",
            [&value],
        )
        .unwrap();
    }

    /// One corrupt workspace DB must not fail (or block) the whole scan — the
    /// valid workspaces still come back, sorted by `last_modified` desc.
    #[test]
    fn test_scan_projects_in_tolerates_corrupt_workspace_db() {
        let tmp = tempfile::TempDir::new().unwrap();
        let ws_dir = tmp.path().join("workspaceStorage");

        write_valid_workspace(
            &ws_dir.join("hash-old"),
            "/Users/me/old-proj",
            1_700_000_000_000,
        );
        write_valid_workspace(
            &ws_dir.join("hash-new"),
            "/Users/me/new-proj",
            1_800_000_000_000,
        );

        // Corrupt workspace: workspace.json is fine but state.vscdb is garbage.
        let broken = ws_dir.join("hash-broken");
        fs::create_dir_all(&broken).unwrap();
        fs::write(
            broken.join("workspace.json"),
            r#"{"folder":"file:///Users/me/broken-proj"}"#,
        )
        .unwrap();
        fs::write(broken.join("state.vscdb"), b"this is not a sqlite database").unwrap();

        let projects = scan_projects_in(&ws_dir).unwrap();
        let names: Vec<&str> = projects.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["new-proj", "old-proj"],
            "valid workspaces survive a corrupt sibling, newest first: {names:?}"
        );
    }
}
