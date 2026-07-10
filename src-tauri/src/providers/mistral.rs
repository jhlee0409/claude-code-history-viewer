//! Mistral Le Chat (Vibe) provider.
//!
//! Reads conversation history written by the Mistral Le Chat desktop agent.
//! Default data root: `~/.mistral`
//! Layout inside that root:
//!
//! ```text
//! ~/.mistral/
//!   projects/
//!     <project-id>/
//!       meta.json          -- { "name": "...", "path": "..." }
//!       sessions/
//!         <session-id>/
//!           messages.jsonl -- one JSON object per line, each a chat turn
//! ```
//!
//! Each line of `messages.jsonl` follows the OpenAI chat-completion shape:
//! ```json
//! { "role": "user"|"assistant"|"tool",
//!   "content": "<text>" | [{"type":"text","text":"..."}],
//!   "id": "<optional-uuid>",
//!   "timestamp": "<optional-rfc3339>" }
//! ```

use super::ProviderInfo;
use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::utils::{
    build_provider_message, detect_git_worktree_info, is_symlink,
    search_json_value_case_insensitive,
};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

const PROVIDER_ID: &str = "mistral";
const PROJECTS_DIR: &str = "projects";
const SESSIONS_DIR: &str = "sessions";
const MESSAGES_FILE: &str = "messages.jsonl";
const META_FILE: &str = "meta.json";

// ─────────────────────────────────────────────────────────────────────────────
// Detection
// ─────────────────────────────────────────────────────────────────────────────

pub fn detect() -> Option<ProviderInfo> {
    let base = get_base_path()?;
    let projects_path = Path::new(&base).join(PROJECTS_DIR);
    Some(ProviderInfo {
        id: PROVIDER_ID.to_string(),
        display_name: "Mistral Le Chat".to_string(),
        base_path: base,
        is_available: projects_path.exists() && projects_path.is_dir(),
    })
}

pub fn get_base_path() -> Option<String> {
    // Allow override via MISTRAL_HOME env var (useful for testing / non-default installs)
    if let Ok(env_val) = std::env::var("MISTRAL_HOME") {
        let path = PathBuf::from(&env_val);
        let abs = if path.is_absolute() {
            path
        } else {
            std::env::current_dir().ok()?.join(path)
        };
        if abs.exists() {
            return Some(abs.canonicalize().unwrap_or(abs).to_string_lossy().to_string());
        }
    }
    let default = dirs::home_dir()?.join(".mistral");
    if default.exists() {
        Some(default.canonicalize().unwrap_or(default).to_string_lossy().to_string())
    } else {
        None
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Project scanning
// ─────────────────────────────────────────────────────────────────────────────

pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let base = get_base_path().ok_or("Mistral base path not found")?;
    scan_projects_from_path(&base)
}

pub fn scan_projects_from_path(base_path: &str) -> Result<Vec<ClaudeProject>, String> {
    crate::utils::require_absolute_path(base_path, "Mistral base path")?;
    let base = Path::new(base_path);
    let projects_root = base.join(PROJECTS_DIR);

    if is_symlink(&projects_root) || !projects_root.is_dir() {
        return Ok(Vec::new());
    }

    let canonical_base = canonical_existing(base, "Mistral base path")?;
    let mut projects = Vec::new();

    for entry in fs::read_dir(&projects_root)
        .map_err(|e| format!("Failed to read Mistral projects dir: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read Mistral project entry: {e}"))?;
        if entry
            .file_type()
            .map_or(true, |ft| ft.is_symlink() || !ft.is_dir())
        {
            continue;
        }

        let project_dir = entry.path();
        if !path_is_inside(&project_dir, &canonical_base)? {
            continue;
        }

        let sessions_root = project_dir.join(SESSIONS_DIR);
        if is_symlink(&sessions_root) || !sessions_root.is_dir() {
            continue;
        }

        // Read optional meta.json for project name / working directory
        let meta = read_json_file(&project_dir.join(META_FILE)).unwrap_or(Value::Null);
        let actual_path = meta
            .get("path")
            .and_then(Value::as_str)
            .filter(|p| !p.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| project_dir.to_string_lossy().to_string());
        let fallback_name = project_dir
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "mistral".to_string());
        let name = meta
            .get("name")
            .and_then(Value::as_str)
            .filter(|n| !n.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| project_name_from_path(&actual_path, &fallback_name));

        // Collect sessions
        let mut session_count = 0usize;
        let mut message_count = 0usize;
        let mut last_modified = String::new();

        for s_entry in fs::read_dir(&sessions_root)
            .map_err(|e| format!("Failed to read Mistral sessions dir: {e}"))?
        {
            let s_entry =
                s_entry.map_err(|e| format!("Failed to read Mistral session entry: {e}"))?;
            if s_entry
                .file_type()
                .map_or(true, |ft| ft.is_symlink() || !ft.is_dir())
            {
                continue;
            }
            let session_dir = s_entry.path();
            let messages_path = session_dir.join(MESSAGES_FILE);
            if is_symlink(&messages_path) || !messages_path.is_file() {
                continue;
            }
            let (count, last_ts) = count_messages_and_last_ts(&messages_path);
            if count == 0 {
                continue;
            }
            session_count += 1;
            message_count += count;
            if last_ts > last_modified {
                last_modified = last_ts;
            }
        }

        if session_count == 0 {
            continue;
        }
        if last_modified.is_empty() {
            last_modified = file_modified_iso(&project_dir).unwrap_or_default();
        }

        projects.push(ClaudeProject {
            name,
            path: format!("mistral://{}", project_dir.to_string_lossy()),
            actual_path: actual_path.clone(),
            session_count,
            message_count,
            last_modified,
            git_info: if Path::new(&actual_path).is_absolute() {
                detect_git_worktree_info(&actual_path)
            } else {
                None
            },
            provider: Some(PROVIDER_ID.to_string()),
            storage_type: Some("jsonl".to_string()),
            custom_directory_label: None,
        });
    }

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

// ─────────────────────────────────────────────────────────────────────────────
// Session loading
// ─────────────────────────────────────────────────────────────────────────────

pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let base = get_base_path().ok_or("Mistral base path not found")?;
    load_sessions_from_base_path(&base, project_path)
}

pub fn load_sessions_from_base_path(
    base_path: &str,
    project_path: &str,
) -> Result<Vec<ClaudeSession>, String> {
    crate::utils::require_absolute_path(base_path, "Mistral base path")?;
    let base = Path::new(base_path);
    let canonical_base = canonical_existing(base, "Mistral base path")?;

    let raw = project_path
        .strip_prefix("mistral://")
        .unwrap_or(project_path);
    let project_dir = PathBuf::from(raw);
    if !project_dir.is_absolute() {
        return Err("Mistral project path must be absolute".to_string());
    }
    if is_symlink(&project_dir) || !project_dir.is_dir() {
        return Err("Mistral project path is not a directory".to_string());
    }
    if !path_is_inside(&project_dir, &canonical_base)? {
        return Err("Mistral project path is outside Mistral base path".to_string());
    }

    let sessions_root = project_dir.join(SESSIONS_DIR);
    if is_symlink(&sessions_root) || !sessions_root.is_dir() {
        return Ok(Vec::new());
    }

    let meta = read_json_file(&project_dir.join(META_FILE)).unwrap_or(Value::Null);
    let actual_path = meta
        .get("path")
        .and_then(Value::as_str)
        .filter(|p| !p.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| project_dir.to_string_lossy().to_string());
    let fallback_project_name = project_dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "mistral".to_string());
    let project_name = meta
        .get("name")
        .and_then(Value::as_str)
        .filter(|n| !n.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| project_name_from_path(&actual_path, &fallback_project_name));

    let mut sessions = Vec::new();
    for entry in fs::read_dir(&sessions_root)
        .map_err(|e| format!("Failed to read Mistral sessions dir: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read Mistral session entry: {e}"))?;
        if entry
            .file_type()
            .map_or(true, |ft| ft.is_symlink() || !ft.is_dir())
        {
            continue;
        }
        let session_dir = entry.path();
        let messages_path = session_dir.join(MESSAGES_FILE);
        if is_symlink(&messages_path) || !messages_path.is_file() {
            continue;
        }

        let session_id = session_dir
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown".to_string());

        let (message_count, last_ts) = count_messages_and_last_ts(&messages_path);
        if message_count == 0 {
            continue;
        }
        let first_ts = first_message_timestamp(&messages_path);
        let last_modified = if last_ts.is_empty() {
            file_modified_iso(&messages_path).unwrap_or_default()
        } else {
            last_ts.clone()
        };
        let summary = first_user_summary(&messages_path);

        sessions.push(ClaudeSession {
            session_id: session_dir.to_string_lossy().to_string(),
            actual_session_id: session_id,
            file_path: session_dir.to_string_lossy().to_string(),
            project_name: project_name.clone(),
            message_count,
            first_message_time: first_ts,
            last_message_time: last_ts,
            last_modified,
            has_tool_use: false,
            has_errors: false,
            summary,
            is_renamed: false,
            provider: Some(PROVIDER_ID.to_string()),
            storage_type: Some("jsonl".to_string()),
            entrypoint: None,
        });
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

// ─────────────────────────────────────────────────────────────────────────────
// Message loading
// ─────────────────────────────────────────────────────────────────────────────

pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let base = get_base_path().ok_or("Mistral base path not found")?;
    load_messages_from_base_path(&base, session_path)
}

pub fn load_messages_from_base_path(
    base_path: &str,
    session_path: &str,
) -> Result<Vec<ClaudeMessage>, String> {
    crate::utils::require_absolute_path(base_path, "Mistral base path")?;
    let base = Path::new(base_path);
    let session_dir = PathBuf::from(session_path);
    let canonical_base = canonical_existing(base, "Mistral base path")?;

    if !session_dir.is_absolute() || !path_is_inside(&session_dir, &canonical_base)? {
        return Err("Mistral session path is outside Mistral base path".to_string());
    }
    if is_symlink(&session_dir) || !session_dir.is_dir() {
        return Err("Mistral session path is not a directory".to_string());
    }

    let messages_path = session_dir.join(MESSAGES_FILE);
    if is_symlink(&messages_path) || !messages_path.is_file() {
        return Ok(Vec::new());
    }

    let session_id = session_dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let content = fs::read_to_string(&messages_path)
        .map_err(|e| format!("Failed to read Mistral messages.jsonl: {e}"))?;

    let mut messages = Vec::new();
    let mut counter = 0u64;
    let fallback_ts = file_modified_iso(&messages_path).unwrap_or_default();

    for line in content.lines().filter(|l| !l.trim().is_empty()) {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let role = value.get("role").and_then(Value::as_str).unwrap_or("");
        if role.is_empty() {
            continue;
        }
        counter += 1;
        let uuid = value
            .get("id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| format!("{session_id}-{counter}"));
        let timestamp = value
            .get("timestamp")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| fallback_ts.clone());

        let message = match role {
            "user" => build_provider_message(
                PROVIDER_ID,
                uuid,
                &session_id,
                timestamp,
                "user",
                Some("user"),
                Some(content_to_blocks(value.get("content"))),
                None,
            ),
            "assistant" => {
                let mut blocks = content_to_blocks(value.get("content"));
                // Surface any tool_calls as tool_use blocks (OpenAI format)
                if let Some(calls) = value.get("tool_calls").and_then(Value::as_array) {
                    if let Some(arr) = blocks.as_array_mut() {
                        for call in calls {
                            arr.push(convert_tool_call(call));
                        }
                    }
                }
                build_provider_message(
                    PROVIDER_ID,
                    uuid,
                    &session_id,
                    timestamp,
                    "assistant",
                    Some("assistant"),
                    Some(blocks),
                    None,
                )
            }
            "tool" => build_provider_message(
                PROVIDER_ID,
                uuid,
                &session_id,
                timestamp,
                "tool",
                Some("tool"),
                Some(json!([{
                    "type": "tool_result",
                    "tool_use_id": value.get("tool_call_id").and_then(Value::as_str).unwrap_or(""),
                    "content": value.get("content").cloned().unwrap_or(Value::Null)
                }])),
                None,
            ),
            _ => continue,
        };
        messages.push(message);
    }

    Ok(messages)
}

// ─────────────────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────────────────

pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let base = get_base_path().ok_or("Mistral base path not found")?;
    search_from_base_path(&base, query, limit)
}

pub fn search_from_base_path(
    base_path: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<ClaudeMessage>, String> {
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for project in scan_projects_from_path(base_path)? {
        for session in load_sessions_from_base_path(base_path, &project.path)? {
            for mut message in load_messages_from_base_path(base_path, &session.file_path)? {
                if let Some(content) = &message.content {
                    if search_json_value_case_insensitive(content, &query_lower) {
                        message.project_name = Some(project.name.clone());
                        results.push(message);
                        if results.len() >= limit {
                            return Ok(results);
                        }
                    }
                }
            }
        }
    }

    Ok(results)
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

fn content_to_blocks(content: Option<&Value>) -> Value {
    match content {
        Some(Value::Array(items)) => Value::Array(items.to_vec()),
        Some(Value::String(text)) => json!([{ "type": "text", "text": text }]),
        Some(Value::Null) | None => Value::Array(Vec::new()),
        Some(other) => json!([{ "type": "text", "text": other.to_string() }]),
    }
}

fn convert_tool_call(call: &Value) -> Value {
    let function = call.get("function").unwrap_or(&Value::Null);
    let name = function
        .get("name")
        .or_else(|| call.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("tool");
    let input = function
        .get("arguments")
        .or_else(|| call.get("arguments"))
        .cloned()
        .unwrap_or(Value::Null);
    let input = if let Some(s) = input.as_str() {
        serde_json::from_str(s).unwrap_or_else(|_| json!({ "input": s }))
    } else {
        input
    };
    json!({
        "type": "tool_use",
        "id": call.get("id").and_then(Value::as_str).unwrap_or(""),
        "name": name,
        "input": input
    })
}

/// Returns `(message_count, last_timestamp_rfc3339)`.
fn count_messages_and_last_ts(path: &Path) -> (usize, String) {
    let Ok(content) = fs::read_to_string(path) else {
        return (0, String::new());
    };
    let mut count = 0usize;
    let mut last_ts = String::new();
    for line in content.lines().filter(|l| !l.trim().is_empty()) {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let role = value.get("role").and_then(Value::as_str).unwrap_or("");
        if role.is_empty() {
            continue;
        }
        count += 1;
        if let Some(ts) = value.get("timestamp").and_then(Value::as_str) {
            if ts > last_ts.as_str() {
                last_ts = ts.to_string();
            }
        }
    }
    (count, last_ts)
}

fn first_message_timestamp(path: &Path) -> String {
    let Ok(content) = fs::read_to_string(path) else {
        return String::new();
    };
    for line in content.lines().filter(|l| !l.trim().is_empty()) {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if value.get("role").and_then(Value::as_str).unwrap_or("").is_empty() {
            continue;
        }
        if let Some(ts) = value.get("timestamp").and_then(Value::as_str) {
            return ts.to_string();
        }
    }
    String::new()
}

fn first_user_summary(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    for line in content.lines().filter(|l| !l.trim().is_empty()) {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if value.get("role").and_then(Value::as_str) != Some("user") {
            continue;
        }
        let text = match value.get("content") {
            Some(Value::String(s)) => s.trim().to_string(),
            Some(Value::Array(arr)) => arr
                .iter()
                .find_map(|item| item.get("text").and_then(Value::as_str))
                .unwrap_or("")
                .trim()
                .to_string(),
            _ => continue,
        };
        if !text.is_empty() {
            return Some(truncate_chars(&text, 200));
        }
    }
    None
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    match text.char_indices().nth(max_chars) {
        Some((idx, _)) => format!("{}...", &text[..idx]),
        None => text.to_string(),
    }
}

fn read_json_file(path: &Path) -> Result<Value, String> {
    if is_symlink(path) {
        return Err("Refusing to read symlinked Mistral JSON file".to_string());
    }
    let content =
        fs::read_to_string(path).map_err(|e| format!("Failed to read JSON file: {e}"))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse JSON file: {e}"))
}

fn file_modified_iso(path: &Path) -> Option<String> {
    fs::metadata(path)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .map(|time| {
            let dt: DateTime<Utc> = time.into();
            dt.to_rfc3339()
        })
}

fn canonical_existing(path: &Path, label: &str) -> Result<PathBuf, String> {
    path.canonicalize()
        .map_err(|e| format!("Failed to resolve {label}: {e}"))
}

fn path_is_inside(path: &Path, canonical_base: &Path) -> Result<bool, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve path: {e}"))?;
    Ok(canonical.starts_with(canonical_base))
}

fn project_name_from_path(actual_path: &str, fallback: &str) -> String {
    Path::new(actual_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn write_messages(dir: &Path, lines: &[&str]) {
        let path = dir.join(MESSAGES_FILE);
        let mut f = std::fs::File::create(path).unwrap();
        for line in lines {
            writeln!(f, "{line}").unwrap();
        }
    }

    fn make_session(projects_root: &Path, project_id: &str, session_id: &str, lines: &[&str]) {
        let session_dir = projects_root
            .join(project_id)
            .join(SESSIONS_DIR)
            .join(session_id);
        std::fs::create_dir_all(&session_dir).unwrap();
        write_messages(&session_dir, lines);
    }

    #[test]
    fn scan_projects_returns_empty_when_no_projects_dir() {
        let temp = TempDir::new().unwrap();
        let result = scan_projects_from_path(&temp.path().to_string_lossy());
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn scan_projects_counts_sessions_and_messages() {
        let temp = TempDir::new().unwrap();
        let projects_root = temp.path().join(PROJECTS_DIR);
        let base = temp.path().to_string_lossy().to_string();

        make_session(
            &projects_root,
            "proj-1",
            "sess-a",
            &[
                r#"{"role":"user","content":"hello","timestamp":"2026-01-01T10:00:00Z"}"#,
                r#"{"role":"assistant","content":"hi","timestamp":"2026-01-01T10:00:01Z"}"#,
            ],
        );
        make_session(
            &projects_root,
            "proj-1",
            "sess-b",
            &[
                r#"{"role":"user","content":"world","timestamp":"2026-01-02T10:00:00Z"}"#,
            ],
        );

        let projects = scan_projects_from_path(&base).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].session_count, 2);
        assert_eq!(projects[0].message_count, 3);
    }

    #[test]
    fn load_messages_parses_user_and_assistant_turns() {
        let temp = TempDir::new().unwrap();
        let projects_root = temp.path().join(PROJECTS_DIR);
        let base = temp.path().to_string_lossy().to_string();

        make_session(
            &projects_root,
            "proj-1",
            "sess-a",
            &[
                r#"{"role":"user","content":"What is 2+2?","timestamp":"2026-03-01T09:00:00Z"}"#,
                r#"{"role":"assistant","content":"It's 4.","timestamp":"2026-03-01T09:00:01Z"}"#,
            ],
        );

        let session_path = projects_root
            .join("proj-1")
            .join(SESSIONS_DIR)
            .join("sess-a")
            .to_string_lossy()
            .to_string();

        let messages = load_messages_from_base_path(&base, &session_path).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].message_type, "user");
        assert_eq!(messages[1].message_type, "assistant");
        assert_eq!(messages[0].provider.as_deref(), Some(PROVIDER_ID));
    }

    #[test]
    fn load_messages_skips_unknown_roles() {
        let temp = TempDir::new().unwrap();
        let projects_root = temp.path().join(PROJECTS_DIR);
        let base = temp.path().to_string_lossy().to_string();

        make_session(
            &projects_root,
            "proj-x",
            "sess-x",
            &[
                r#"{"role":"system","content":"You are helpful."}"#,
                r#"{"role":"user","content":"hi"}"#,
            ],
        );

        let session_path = projects_root
            .join("proj-x")
            .join(SESSIONS_DIR)
            .join("sess-x")
            .to_string_lossy()
            .to_string();

        let messages = load_messages_from_base_path(&base, &session_path).unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].message_type, "user");
    }

    #[test]
    fn search_finds_matching_content() {
        let temp = TempDir::new().unwrap();
        let projects_root = temp.path().join(PROJECTS_DIR);
        let base = temp.path().to_string_lossy().to_string();

        make_session(
            &projects_root,
            "proj-s",
            "sess-s",
            &[
                r#"{"role":"user","content":"Tell me about Rust","timestamp":"2026-04-01T00:00:00Z"}"#,
                r#"{"role":"assistant","content":"Rust is a systems language.","timestamp":"2026-04-01T00:00:01Z"}"#,
            ],
        );

        let results = search_from_base_path(&base, "rust", 10).unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].provider.as_deref(), Some(PROVIDER_ID));
    }

    #[test]
    fn search_returns_empty_on_no_match() {
        let temp = TempDir::new().unwrap();
        let projects_root = temp.path().join(PROJECTS_DIR);
        let base = temp.path().to_string_lossy().to_string();

        make_session(
            &projects_root,
            "proj-n",
            "sess-n",
            &[r#"{"role":"user","content":"hello world"}"#],
        );

        let results = search_from_base_path(&base, "xyznonexistent", 10).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn first_user_summary_returns_truncated_text() {
        let temp = TempDir::new().unwrap();
        let session_dir = temp.path();
        write_messages(
            session_dir,
            &[
                r#"{"role":"assistant","content":"ignored"}"#,
                r#"{"role":"user","content":"This is the first user message"}"}"#,
            ],
        );
        let summary = first_user_summary(&session_dir.join(MESSAGES_FILE));
        assert!(summary.is_some());
        assert!(summary.unwrap().contains("first user message"));
    }
}
