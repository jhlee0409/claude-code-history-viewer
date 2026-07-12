//! Trae IDE provider (`ByteDance` VS Code fork) — BEST-EFFORT / reverse-engineered.
//!
//! Trae stores chat/agent history in the per-workspace VS Code key-value DB
//! `<UserData>/Trae/User/workspaceStorage/<hash>/state.vscdb` (`SQLite`,
//! `ItemTable(key, value)`). The conversation lives under `ByteDance` "icube"
//! keys; we query (in precedence order):
//!   `memento/icube-ai-agent-storage` (primary; value = `{ "list": [Session] }`),
//!   `ChatStore`, `chat.ChatSessionStore.index`, and the install-suffixed
//!   `memento/icube-ai-chat-storage-<n>` / `memento/icube-ai-ng-chat-storage-<n>`
//!   (matched by prefix since `<n>` is account-specific).
//!
//! ⚠️ Unlike the other providers, this schema is NOT from official source — it is
//! reverse-engineered from the `trae-chats-exporter` community tool, the keys are
//! install-specific, and the Agent/SOLO-mode content is deeply nested. It has not
//! been verified against a real Trae install. Parsing is therefore defensive
//! (multiple field-name fallbacks) and renders text content; structured tool
//! calls in Agent mode are flattened to text. Treat as provisional.

use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::providers::ProviderInfo;
use crate::utils::{build_provider_message, search_json_value_case_insensitive};
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const PROVIDER: &str = "trae";
const SCHEME: &str = "trae://";
const SESSION_SEP: char = '#';
const SUMMARY_MAX_CHARS: usize = 80;

/// Exact icube keys to try, in precedence order.
const EXACT_KEYS: &[&str] = &[
    "memento/icube-ai-agent-storage",
    "ChatStore",
    "chat.ChatSessionStore.index",
];
/// Prefixes for the install-suffixed icube chat-storage keys.
const KEY_PREFIXES: &[&str] = &[
    "memento/icube-ai-ng-chat-storage-",
    "memento/icube-ai-chat-storage-",
];

/// `<UserData>/Trae/User/workspaceStorage` (`dirs::config_dir()` resolves to
/// `~/Library/Application Support` on macOS, `~/.config` on Linux, `%APPDATA%`
/// on Windows — matching VS Code-family layout).
fn workspace_storage() -> Option<PathBuf> {
    let dir = dirs::config_dir()?
        .join("Trae")
        .join("User")
        .join("workspaceStorage");
    if dir.is_dir() {
        Some(dir)
    } else {
        None
    }
}

/// Detect a Trae installation (any workspace with a `state.vscdb`).
pub fn detect() -> Option<ProviderInfo> {
    let storage = workspace_storage()?;
    Some(ProviderInfo {
        id: PROVIDER.to_string(),
        display_name: "Trae".to_string(),
        is_available: !workspace_dbs(&storage).is_empty(),
        base_path: storage.to_string_lossy().to_string(),
    })
}

/// Base path (`…/Trae/User/workspaceStorage`), for the file watcher.
pub fn get_base_path() -> Option<String> {
    workspace_storage().map(|p| p.to_string_lossy().to_string())
}

/// `(hash, state.vscdb path)` for each workspace that has a DB.
fn workspace_dbs(storage: &Path) -> Vec<(String, PathBuf)> {
    WalkDir::new(storage)
        .min_depth(1)
        .max_depth(1)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| !e.path_is_symlink())
        .filter(|e| e.file_type().is_dir())
        .filter_map(|e| {
            let db = e.path().join("state.vscdb");
            if db.is_file() {
                Some((e.file_name().to_string_lossy().to_string(), db))
            } else {
                None
            }
        })
        .collect()
}

/// A workspaceStorage `<hash>` must be a single safe path component (the hash
/// can arrive from untrusted `WebUI` input), guarding `storage.join(hash)` against
/// traversal.
fn valid_hash(hash: &str) -> bool {
    !hash.is_empty() && !hash.contains('/') && !hash.contains('\\') && !hash.contains("..")
}

fn open_db(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open Trae DB: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to set busy timeout: {e}"))?;
    Ok(conn)
}

/// Read the first present icube conversation value from a workspace DB.
fn read_icube_value(conn: &Connection) -> Option<Value> {
    for key in EXACT_KEYS {
        if let Ok(raw) = conn.query_row("SELECT value FROM ItemTable WHERE key = ?1", [key], |r| {
            r.get::<_, String>(0)
        }) {
            if let Ok(v) = serde_json::from_str::<Value>(&raw) {
                if !extract_sessions(&v).is_empty() {
                    return Some(v);
                }
            }
        }
    }
    for prefix in KEY_PREFIXES {
        let like = format!("{prefix}%");
        if let Ok(raw) = conn.query_row(
            "SELECT value FROM ItemTable WHERE key LIKE ?1 ORDER BY key DESC LIMIT 1",
            [&like],
            |r| r.get::<_, String>(0),
        ) {
            if let Ok(v) = serde_json::from_str::<Value>(&raw) {
                if !extract_sessions(&v).is_empty() {
                    return Some(v);
                }
            }
        }
    }
    None
}

/// The workspace folder path from `workspace.json` (folder URI), for display.
fn workspace_folder(db_path: &Path) -> Option<String> {
    let ws_json = db_path.parent()?.join("workspace.json");
    let data = std::fs::read_to_string(ws_json).ok()?;
    let v: Value = serde_json::from_str(&data).ok()?;
    let folder = v.get("folder").and_then(Value::as_str)?;
    // folder is a file:// URI.
    Some(folder.strip_prefix("file://").unwrap_or(folder).to_string())
}

/// Scan Trae projects — one per workspace that has parseable chat sessions.
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let Some(storage) = workspace_storage() else {
        return Ok(vec![]);
    };
    let mut projects = Vec::new();
    for (hash, db_path) in workspace_dbs(&storage) {
        let Ok(conn) = open_db(&db_path) else {
            continue;
        };
        let Some(value) = read_icube_value(&conn) else {
            continue;
        };
        let sessions = extract_sessions(&value);
        if sessions.is_empty() {
            continue;
        }
        let folder = workspace_folder(&db_path).unwrap_or_else(|| hash.clone());
        let name = Path::new(&folder)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| folder.clone());
        let message_count: usize = sessions.iter().map(|s| s.messages.len()).sum();
        projects.push(ClaudeProject {
            name,
            path: format!("{SCHEME}{hash}"),
            actual_path: folder,
            session_count: sessions.len(),
            message_count,
            last_modified: String::new(),
            git_info: None,
            provider: Some(PROVIDER.to_string()),
            storage_type: Some("sqlite".to_string()),
            custom_directory_label: None,
        });
    }
    Ok(projects)
}

/// Load the chat sessions for one Trae workspace (`trae://<hash>`).
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let hash = project_path.strip_prefix(SCHEME).unwrap_or(project_path);
    if !valid_hash(hash) {
        return Ok(vec![]);
    }
    let Some(storage) = workspace_storage() else {
        return Ok(vec![]);
    };
    let db_path = storage.join(hash).join("state.vscdb");
    if !db_path.is_file() {
        return Ok(vec![]);
    }
    let conn = open_db(&db_path)?;
    let Some(value) = read_icube_value(&conn) else {
        return Ok(vec![]);
    };
    let folder = workspace_folder(&db_path).unwrap_or_else(|| hash.to_string());
    let project_name = Path::new(&folder)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let sessions = extract_sessions(&value)
        .into_iter()
        .map(|s| {
            let summary = s
                .title
                .clone()
                .filter(|t| !t.trim().is_empty())
                .or_else(|| s.first_user_text().map(|t| summarize(&t)))
                .or_else(|| Some(s.id.clone()));
            ClaudeSession {
                session_id: format!("{SCHEME}{hash}{SESSION_SEP}{}", s.id),
                actual_session_id: s.id.clone(),
                file_path: format!("{SCHEME}{hash}{SESSION_SEP}{}", s.id),
                project_name: project_name.clone(),
                message_count: s.messages.len(),
                first_message_time: String::new(),
                last_message_time: String::new(),
                last_modified: String::new(),
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

/// Load messages for one Trae session (`trae://<hash>#<sessionId>`).
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let (hash, session_id) = parse_session_path(session_path)?;
    if !valid_hash(&hash) {
        return Ok(vec![]);
    }
    let Some(storage) = workspace_storage() else {
        return Ok(vec![]);
    };
    let db_path = storage.join(&hash).join("state.vscdb");
    if !db_path.is_file() {
        return Ok(vec![]);
    }
    let conn = open_db(&db_path)?;
    let Some(value) = read_icube_value(&conn) else {
        return Ok(vec![]);
    };
    let Some(session) = extract_sessions(&value)
        .into_iter()
        .find(|s| s.id == session_id)
    else {
        return Ok(vec![]);
    };
    Ok(session.to_messages())
}

/// Search across all Trae sessions.
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let Some(storage) = workspace_storage() else {
        return Ok(vec![]);
    };
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();
    for (_hash, db_path) in workspace_dbs(&storage) {
        let project_name = workspace_folder(&db_path)
            .map(|f| {
                Path::new(&f)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or(f)
            })
            .unwrap_or_default();
        let Ok(conn) = open_db(&db_path) else {
            continue;
        };
        let Some(value) = read_icube_value(&conn) else {
            continue;
        };
        for session in extract_sessions(&value) {
            for mut msg in session.to_messages() {
                if results.len() >= limit {
                    return Ok(results);
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
    }
    Ok(results)
}

// ============================================================================
// Pure extraction (unit-testable)
// ============================================================================

struct TraeSession {
    id: String,
    title: Option<String>,
    messages: Vec<Value>,
}

impl TraeSession {
    fn first_user_text(&self) -> Option<String> {
        self.messages.iter().find_map(|m| {
            if role_of(m) == Some("user") {
                message_text(m)
            } else {
                None
            }
        })
    }

    fn to_messages(&self) -> Vec<ClaudeMessage> {
        let mut out = Vec::new();
        for (idx, m) in self.messages.iter().enumerate() {
            let Some(role) = role_of(m) else {
                continue;
            };
            let Some(text) = message_text(m) else {
                continue;
            };
            if text.is_empty() {
                continue;
            }
            out.push(build_provider_message(
                PROVIDER,
                format!("{}-{idx}", self.id),
                &self.id,
                String::new(),
                role,
                Some(role),
                Some(json!([{ "type": "text", "text": text }])),
                None,
            ));
        }
        out
    }
}

/// Pull the session list out of an icube value (defensive across the known
/// container shapes: `{list:[]}` / `{sessions:{}}` / `{conversations}` /
/// `{entries}` / bare array).
fn extract_sessions(value: &Value) -> Vec<TraeSession> {
    let containers = ["list", "sessions", "conversations", "entries"];
    let raw: Vec<Value> = if let Some(arr) = value.as_array() {
        arr.clone()
    } else if let Some(obj) = value.as_object() {
        let mut found = None;
        for key in containers {
            match obj.get(key) {
                Some(Value::Array(a)) => {
                    found = Some(a.clone());
                    break;
                }
                Some(Value::Object(m)) => {
                    found = Some(m.values().cloned().collect());
                    break;
                }
                _ => {}
            }
        }
        found.unwrap_or_default()
    } else {
        Vec::new()
    };

    raw.iter()
        .filter_map(|s| {
            let id = s
                .get("id")
                .or_else(|| s.get("sessionId"))
                .or_else(|| s.get("key"))
                .and_then(Value::as_str)
                .map(str::to_string)?;
            let title = s
                .get("title")
                .or_else(|| s.get("name"))
                .and_then(Value::as_str)
                .map(str::to_string);
            let messages = ["messages", "conversation", "history", "list", "bubbles"]
                .iter()
                .find_map(|k| s.get(*k).and_then(Value::as_array).cloned())
                .unwrap_or_default();
            if messages.is_empty() {
                return None;
            }
            Some(TraeSession {
                id,
                title,
                messages,
            })
        })
        .collect()
}

/// Normalized message role ("user"/"assistant"), mapping Trae's "ai".
fn role_of(msg: &Value) -> Option<&'static str> {
    match msg.get("role").and_then(Value::as_str) {
        Some("user") => Some("user"),
        Some("assistant" | "ai" | "model") => Some("assistant"),
        _ => None,
    }
}

/// Best-effort displayable text for a Trae message: plain-chat fields, plus
/// Agent/SOLO `agentTaskContent.guideline.planItems[]` flattened to text.
fn message_text(msg: &Value) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();

    for field in ["content", "text", "message", "body", "prompt", "response"] {
        if let Some(v) = msg.get(field) {
            if let Some(s) = clean_content(v) {
                if !s.is_empty() {
                    parts.push(s);
                    break;
                }
            }
        }
    }

    // Agent/SOLO mode: flatten plan items (thought / toolName / result).
    if let Some(items) = msg
        .get("agentTaskContent")
        .and_then(|a| a.get("guideline"))
        .and_then(|g| g.get("planItems"))
        .and_then(Value::as_array)
    {
        for item in items {
            for f in ["thought", "toolName", "result", "content", "text"] {
                if let Some(s) = item.get(f).and_then(clean_content) {
                    if !s.is_empty() {
                        parts.push(s);
                    }
                }
            }
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
}

/// Reduce a content value to a string (mirrors the exporter's cleanContent).
fn clean_content(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Object(_) => {
            for path in [
                v.get("data").and_then(|d| d.get("summary")),
                v.get("summary"),
                v.get("content"),
                v.get("text"),
            ]
            .into_iter()
            .flatten()
            {
                if let Some(s) = path.as_str() {
                    return Some(s.to_string());
                }
            }
            Some(v.to_string())
        }
        Value::Null => None,
        other => Some(other.to_string()),
    }
}

fn parse_session_path(session_path: &str) -> Result<(String, String), String> {
    let rest = session_path.strip_prefix(SCHEME).unwrap_or(session_path);
    rest.split_once(SESSION_SEP)
        .map(|(h, id)| (h.to_string(), id.to_string()))
        .ok_or_else(|| format!("Invalid Trae session path: {session_path}"))
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_sessions_from_list_container() {
        let value = json!({
            "list": [
                {
                    "id": "sess-a", "title": "Fix LOGIN",
                    "messages": [
                        { "role": "user", "content": "why does LOGIN fail?" },
                        { "role": "assistant", "content": "Checking" }
                    ]
                },
                { "id": "empty", "messages": [] }
            ]
        });
        let sessions = extract_sessions(&value);
        assert_eq!(sessions.len(), 1); // empty skipped
        assert_eq!(sessions[0].id, "sess-a");
        assert_eq!(sessions[0].title.as_deref(), Some("Fix LOGIN"));
        let msgs = sessions[0].to_messages();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].role.as_deref(), Some("user"));
        assert_eq!(msgs[0].provider.as_deref(), Some("trae"));
        assert_eq!(
            msgs[0].content.as_ref().unwrap()[0]["text"],
            "why does LOGIN fail?"
        );
    }

    #[test]
    fn extract_sessions_from_object_map_and_ai_role() {
        let value = json!({
            "sessions": {
                "k1": { "sessionId": "s1", "name": "chat", "conversation": [
                    { "role": "ai", "text": "hello" }
                ] }
            }
        });
        let sessions = extract_sessions(&value);
        assert_eq!(sessions.len(), 1);
        let msgs = sessions[0].to_messages();
        assert_eq!(msgs[0].role.as_deref(), Some("assistant")); // ai -> assistant
        assert_eq!(msgs[0].content.as_ref().unwrap()[0]["text"], "hello");
    }

    #[test]
    fn message_text_agent_mode_flattens_plan_items() {
        let msg = json!({
            "role": "assistant",
            "agentTaskContent": { "guideline": { "planItems": [
                { "thought": "I'll search", "toolName": "grep", "result": "found in auth.rs" }
            ] } }
        });
        let text = message_text(&msg).unwrap();
        assert!(text.contains("I'll search"));
        assert!(text.contains("grep"));
        assert!(text.contains("auth.rs"));
    }

    #[test]
    fn clean_content_object_summary() {
        assert_eq!(clean_content(&json!("hi")).as_deref(), Some("hi"));
        assert_eq!(
            clean_content(&json!({ "data": { "summary": "S" } })).as_deref(),
            Some("S")
        );
        assert_eq!(clean_content(&json!({ "text": "T" })).as_deref(), Some("T"));
        assert!(clean_content(&Value::Null).is_none());
    }

    #[test]
    fn parse_session_path_splits() {
        let (h, id) = parse_session_path("trae://abc123#sess-1").unwrap();
        assert_eq!(h, "abc123");
        assert_eq!(id, "sess-1");
        assert!(parse_session_path("trae://no-sep").is_err());
    }

    #[test]
    fn valid_hash_rejects_traversal() {
        assert!(valid_hash("3b1c9f0a2e"));
        assert!(!valid_hash("../../etc"));
        assert!(!valid_hash("a/b"));
        assert!(!valid_hash("a\\b"));
        assert!(!valid_hash(""));
    }
}
