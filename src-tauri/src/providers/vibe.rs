use super::ProviderInfo;
use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::utils::{build_provider_message, is_symlink, search_json_value_case_insensitive};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const PROVIDER_ID: &str = "vibe";
const SESSIONS_DIR: &str = "logs/session";
const METADATA_FILE: &str = "meta.json";
const MESSAGES_FILE: &str = "messages.jsonl";
const SCHEME: &str = "vibe://";

pub fn detect() -> Option<ProviderInfo> {
    let base = get_base_path()?;
    let sessions_path = Path::new(&base).join(SESSIONS_DIR);

    Some(ProviderInfo {
        id: PROVIDER_ID.to_string(),
        display_name: "Mistral Vibe".to_string(),
        base_path: base,
        is_available: sessions_path.exists() && sessions_path.is_dir(),
    })
}

pub fn get_base_path() -> Option<String> {
    if let Ok(env_val) = std::env::var("VIBE_HOME") {
        let path = PathBuf::from(&env_val);
        let absolute_path = if path.is_absolute() {
            path
        } else {
            std::env::current_dir().ok()?.join(path)
        };
        if absolute_path.exists() {
            let normalized = absolute_path.canonicalize().unwrap_or(absolute_path);
            return Some(normalized.to_string_lossy().to_string());
        }
    }

    let default = dirs::home_dir()?.join(".vibe");
    if default.exists() {
        let normalized = default.canonicalize().unwrap_or(default);
        Some(normalized.to_string_lossy().to_string())
    } else {
        None
    }
}

pub fn scan_projects_from_path(base_path: &str) -> Result<Vec<ClaudeProject>, String> {
    crate::utils::require_absolute_path(base_path, "Vibe base path")?;
    let base = Path::new(base_path);
    let sessions_root = base.join(SESSIONS_DIR);

    if is_symlink(&sessions_root) || !sessions_root.is_dir() {
        return Ok(Vec::new());
    }

    let mut by_cwd: HashMap<String, ProjectAccumulator> = HashMap::new();

    for entry in
        fs::read_dir(&sessions_root).map_err(|e| format!("Failed to read Vibe sessions: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read Vibe session entry: {e}"))?;
        if entry
            .file_type()
            .map_or(true, |ft| ft.is_symlink() || !ft.is_dir())
        {
            continue;
        }

        if let Some(info) = extract_session_info(&entry.path()) {
            let cwd = info.cwd.unwrap_or_else(|| "unknown".to_string());
            let agg = by_cwd.entry(cwd).or_default();
            agg.session_count += 1;
            agg.message_count += info.message_count;
            if info.last_modified > agg.last_modified {
                agg.last_modified = info.last_modified;
            }
        }
    }

    let mut projects: Vec<ClaudeProject> = by_cwd
        .into_iter()
        .map(|(cwd, agg)| {
            let name = Path::new(&cwd)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| cwd.clone());

            ClaudeProject {
                name,
                path: format!("{SCHEME}{cwd}"),
                actual_path: cwd,
                session_count: agg.session_count,
                message_count: agg.message_count,
                last_modified: agg.last_modified,
                git_info: None,
                provider: Some(PROVIDER_ID.to_string()),
                storage_type: Some("jsonl".to_string()),
                custom_directory_label: None,
            }
        })
        .collect();

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let base = get_base_path().ok_or("Vibe base path not found")?;
    scan_projects_from_path(&base)
}

pub fn load_sessions(
    project_path: &str,
    exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let base = get_base_path().ok_or("Vibe base path not found")?;
    load_sessions_from_base_path(&base, project_path, exclude_sidechain)
}

pub fn load_sessions_from_base_path(
    base_path: &str,
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let target_cwd = project_path.strip_prefix(SCHEME).unwrap_or(project_path);
    let sessions_root = Path::new(base_path).join(SESSIONS_DIR);
    let mut sessions = Vec::new();

    for entry in
        fs::read_dir(&sessions_root).map_err(|e| format!("Failed to read Vibe sessions: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read Vibe session entry: {e}"))?;
        if entry
            .file_type()
            .map_or(true, |ft| ft.is_symlink() || !ft.is_dir())
        {
            continue;
        }

        let session_dir = entry.path();
        let Some(info) = extract_session_info(&session_dir) else {
            continue;
        };
        if info.cwd.as_deref().unwrap_or("unknown") != target_cwd {
            continue;
        }

        let project_name = Path::new(target_cwd)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| target_cwd.to_string());

        sessions.push(ClaudeSession {
            session_id: info.session_id.clone(),
            actual_session_id: info.session_id,
            file_path: session_dir.to_string_lossy().to_string(),
            project_name,
            message_count: info.message_count,
            first_message_time: info.first_message_time,
            last_message_time: info.last_message_time,
            last_modified: info.last_modified,
            has_tool_use: info.has_tool_use,
            has_errors: false,
            summary: info.summary,
            is_renamed: info.is_renamed,
            provider: Some(PROVIDER_ID.to_string()),
            storage_type: Some("jsonl".to_string()),
            entrypoint: None,
        });
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let base = get_base_path().ok_or("Vibe base path not found")?;
    load_messages_from_base_path(&base, session_path)
}

pub fn load_messages_from_base_path(
    base_path: &str,
    session_path: &str,
) -> Result<Vec<ClaudeMessage>, String> {
    let session_dir = validate_session_dir(base_path, session_path)?;
    let metadata = read_json_file(&session_dir.join(METADATA_FILE))?;
    let session_id = metadata
        .get("session_id")
        .and_then(Value::as_str)
        .or_else(|| session_dir.file_name().and_then(|n| n.to_str()))
        .unwrap_or("vibe-session")
        .to_string();
    let timestamp = metadata
        .get("start_time")
        .and_then(Value::as_str)
        .map(normalize_timestamp)
        .unwrap_or_default();

    let values = read_jsonl_values(&session_dir.join(MESSAGES_FILE))?;
    let mut messages = Vec::new();
    let mut counter = 0u64;

    for value in values {
        let role = value.get("role").and_then(Value::as_str).unwrap_or("");
        if role == "system" {
            continue;
        }
        if let Some(message) = convert_message(
            &value,
            role,
            &session_id,
            &timestamp,
            &mut counter,
            &session_dir,
        ) {
            messages.push(message);
        }
    }

    Ok(messages)
}

pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let base = get_base_path().ok_or("Vibe base path not found")?;
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
        for session in load_sessions_from_base_path(base_path, &project.path, false)? {
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

#[derive(Debug, Default)]
struct ProjectAccumulator {
    session_count: usize,
    message_count: usize,
    last_modified: String,
}

#[derive(Debug, Clone)]
struct SessionInfo {
    session_id: String,
    cwd: Option<String>,
    message_count: usize,
    first_message_time: String,
    last_message_time: String,
    last_modified: String,
    has_tool_use: bool,
    summary: Option<String>,
    is_renamed: bool,
}

fn extract_session_info(session_dir: &Path) -> Option<SessionInfo> {
    if is_symlink(session_dir) || !session_dir.is_dir() {
        return None;
    }

    let metadata_path = session_dir.join(METADATA_FILE);
    let messages_path = session_dir.join(MESSAGES_FILE);
    if is_symlink(&metadata_path)
        || is_symlink(&messages_path)
        || !metadata_path.is_file()
        || !messages_path.is_file()
    {
        return None;
    }

    let metadata = read_json_file(&metadata_path).ok()?;
    let session_id = metadata
        .get("session_id")
        .and_then(Value::as_str)?
        .to_string();
    let cwd = metadata
        .get("environment")
        .and_then(|env| env.get("working_directory"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let title = metadata
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(ToOwned::to_owned);
    let is_renamed = metadata
        .get("title_source")
        .and_then(Value::as_str)
        .is_some_and(|source| source == "manual");
    let start_time = metadata
        .get("start_time")
        .and_then(Value::as_str)
        .map(normalize_timestamp)
        .unwrap_or_default();
    let end_time = metadata
        .get("end_time")
        .and_then(Value::as_str)
        .map(normalize_timestamp)
        .unwrap_or_else(|| start_time.clone());

    let values = read_jsonl_values(&messages_path).ok()?;
    let mut message_count = 0usize;
    let mut has_tool_use = false;
    let mut first_user = None;

    for value in &values {
        let role = value.get("role").and_then(Value::as_str).unwrap_or("");
        if role == "system" {
            continue;
        }
        if matches!(role, "user" | "assistant" | "tool") {
            message_count += 1;
        }
        if role == "tool"
            || value
                .get("tool_calls")
                .and_then(Value::as_array)
                .is_some_and(|calls| !calls.is_empty())
        {
            has_tool_use = true;
        }
        if role == "user" && first_user.is_none() {
            first_user = extract_content_summary(value);
        }
    }

    if message_count == 0 {
        return None;
    }

    let last_modified = if end_time.is_empty() {
        file_modified_iso(&messages_path).unwrap_or_default()
    } else {
        end_time.clone()
    };

    Some(SessionInfo {
        session_id,
        cwd,
        message_count,
        first_message_time: start_time.clone(),
        last_message_time: end_time,
        last_modified,
        has_tool_use,
        summary: title.or(first_user),
        is_renamed,
    })
}

fn convert_message(
    value: &Value,
    role: &str,
    session_id: &str,
    timestamp: &str,
    counter: &mut u64,
    session_dir: &Path,
) -> Option<ClaudeMessage> {
    *counter += 1;
    let uuid = value
        .get("message_id")
        .or_else(|| value.get("id"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("{session_id}-{counter}"));

    match role {
        "user" => {
            let mut blocks = content_to_blocks(value.get("content"));
            if let Some(arr) = blocks.as_array_mut() {
                arr.extend(image_blocks(value, session_dir));
            }
            Some(build_provider_message(
                PROVIDER_ID,
                uuid,
                session_id,
                timestamp.to_string(),
                "user",
                Some("user"),
                Some(blocks),
                None,
            ))
        }
        "assistant" => {
            let mut blocks = content_to_blocks(value.get("content"));
            if let Some(arr) = blocks.as_array_mut() {
                arr.extend(image_blocks(value, session_dir));
            }
            if let Some(reasoning) = value
                .get("reasoning_content")
                .and_then(Value::as_str)
                .filter(|text| !text.trim().is_empty())
            {
                if let Some(arr) = blocks.as_array_mut() {
                    arr.insert(
                        0,
                        json!({
                            "type": "thinking",
                            "thinking": reasoning
                        }),
                    );
                }
            }
            if let Some(calls) = value.get("tool_calls").and_then(Value::as_array) {
                if let Some(arr) = blocks.as_array_mut() {
                    for call in calls {
                        arr.push(convert_tool_call(call));
                    }
                }
            }
            Some(build_provider_message(
                PROVIDER_ID,
                uuid,
                session_id,
                timestamp.to_string(),
                "assistant",
                Some("assistant"),
                Some(blocks),
                None,
            ))
        }
        "tool" => Some(build_provider_message(
            PROVIDER_ID,
            uuid,
            session_id,
            timestamp.to_string(),
            "tool",
            Some("tool"),
            Some(json!([{
                "type": "tool_result",
                "tool_use_id": value.get("tool_call_id").and_then(Value::as_str).unwrap_or(""),
                "content": value.get("content").cloned().unwrap_or(Value::Null)
            }])),
            None,
        )),
        _ => None,
    }
}

/// Convert a Vibe message's `images` attachments into viewer image blocks.
///
/// Upstream persists pasted/attached images either inline
/// (`source: {kind: "inline", data: <base64>}`) or as a snapshot file inside
/// the session directory (`source: {kind: "file", path}`); older transcripts
/// use a flat `{data}` / `{path}` shape. File sources are read from disk only
/// when they resolve inside the session directory — everything else is
/// skipped rather than erroring the message.
fn image_blocks(value: &Value, session_dir: &Path) -> Vec<Value> {
    let Some(images) = value.get("images").and_then(Value::as_array) else {
        return Vec::new();
    };

    let mut blocks = Vec::new();
    for image in images {
        let mime_type = image
            .get("mime_type")
            .and_then(Value::as_str)
            .unwrap_or("image/png");
        let source = image.get("source");

        let inline_data = source
            .filter(|s| s.get("kind").and_then(Value::as_str) == Some("inline"))
            .and_then(|s| s.get("data"))
            .or_else(|| image.get("data"))
            .and_then(Value::as_str);
        let file_path = source
            .filter(|s| s.get("kind").and_then(Value::as_str) == Some("file"))
            .and_then(|s| s.get("path"))
            .or_else(|| image.get("path"))
            .and_then(Value::as_str);

        let data = if let Some(data) = inline_data {
            Some(data.to_string())
        } else {
            file_path.and_then(|path| read_session_image(session_dir, Path::new(path)))
        };

        if let Some(data) = data {
            blocks.push(json!({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": mime_type,
                    "data": data
                }
            }));
        }
    }
    blocks
}

/// Sanity cap for snapshot files read back into memory; upstream rejects
/// anything larger at capture time.
const MAX_IMAGE_SNAPSHOT_BYTES: u64 = 10 * 1024 * 1024;

/// Read an image snapshot, base64-encoded, only when the (possibly relative)
/// path resolves inside the session directory and is not a symlink.
fn read_session_image(session_dir: &Path, path: &Path) -> Option<String> {
    use base64::Engine as _;

    let canonical_dir = session_dir.canonicalize().ok()?;
    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        canonical_dir.join(path)
    };
    if fs::symlink_metadata(&candidate)
        .ok()?
        .file_type()
        .is_symlink()
    {
        return None;
    }
    let canonical = candidate.canonicalize().ok()?;
    if !canonical.starts_with(&canonical_dir) {
        return None;
    }
    if fs::metadata(&canonical).ok()?.len() > MAX_IMAGE_SNAPSHOT_BYTES {
        return None;
    }
    let bytes = fs::read(&canonical).ok()?;
    Some(base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn content_to_blocks(content: Option<&Value>) -> Value {
    match content {
        Some(Value::Array(items)) => {
            Value::Array(items.iter().map(normalize_content_block).collect())
        }
        Some(Value::String(text)) => json!([{ "type": "text", "text": text }]),
        Some(Value::Null) | None => Value::Array(Vec::new()),
        Some(other) => json!([{ "type": "text", "text": other.to_string() }]),
    }
}

fn normalize_content_block(item: &Value) -> Value {
    if item.get("type").and_then(Value::as_str) == Some("think") {
        return json!({
            "type": "thinking",
            "thinking": item.get("think").and_then(Value::as_str).unwrap_or("")
        });
    }

    item.clone()
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

    json!({
        "type": "tool_use",
        "id": call.get("id").and_then(Value::as_str).unwrap_or(""),
        "name": name,
        "input": normalize_tool_input(input)
    })
}

fn normalize_tool_input(input: Value) -> Value {
    if let Some(s) = input.as_str() {
        serde_json::from_str(s).unwrap_or_else(|_| json!({ "input": s }))
    } else {
        input
    }
}

fn extract_content_summary(value: &Value) -> Option<String> {
    let content = value.get("content")?;
    let text = if let Some(text) = content.as_str() {
        text.to_string()
    } else {
        content
            .as_array()?
            .iter()
            .find_map(|item| item.get("text").and_then(Value::as_str))
            .unwrap_or("")
            .to_string()
    };

    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(truncate_chars(trimmed, 200))
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    match text.char_indices().nth(max_chars) {
        Some((idx, _)) => format!("{}...", &text[..idx]),
        None => text.to_string(),
    }
}

fn normalize_timestamp(raw: &str) -> String {
    DateTime::parse_from_rfc3339(raw)
        .map(|dt| dt.with_timezone(&Utc).to_rfc3339())
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%S%.f")
                .map(|dt| dt.and_utc().to_rfc3339())
        })
        .unwrap_or_else(|_| raw.to_string())
}

fn read_json_file(path: &Path) -> Result<Value, String> {
    if is_symlink(path) {
        return Err("Refusing to read symlinked Vibe JSON file".to_string());
    }
    let content = fs::read_to_string(path).map_err(|e| format!("Failed to read JSON file: {e}"))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse JSON file: {e}"))
}

fn read_jsonl_values(path: &Path) -> Result<Vec<Value>, String> {
    if is_symlink(path) {
        return Err("Refusing to read symlinked Vibe JSONL file".to_string());
    }
    let content =
        fs::read_to_string(path).map_err(|e| format!("Failed to read JSONL file: {e}"))?;
    let mut values = Vec::new();
    for line in content.lines().filter(|line| !line.trim().is_empty()) {
        if let Ok(value) = serde_json::from_str::<Value>(line) {
            values.push(value);
        }
    }
    Ok(values)
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

fn validate_session_dir(base_path: &str, session_path: &str) -> Result<PathBuf, String> {
    let session_dir = Path::new(session_path);
    if !session_dir.is_absolute() {
        return Err("Vibe session path must be absolute".to_string());
    }
    if is_symlink(session_dir) || !session_dir.is_dir() {
        return Err("Vibe session path is not a directory".to_string());
    }

    let sessions_root = Path::new(base_path).join(SESSIONS_DIR);
    let canonical_root = sessions_root
        .canonicalize()
        .map_err(|e| format!("Failed to resolve Vibe sessions root: {e}"))?;
    let canonical_session = session_dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve Vibe session path: {e}"))?;
    if !canonical_session.starts_with(&canonical_root) {
        return Err("Vibe session path is outside Vibe sessions directory".to_string());
    }

    Ok(canonical_session)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn write_fixture(base: &Path) -> (String, String) {
        let session_dir = base.join("logs/session/session_20260202_120000_abc123");
        fs::create_dir_all(&session_dir).expect("create session dir");

        let cwd = "/tmp/vibe-demo";
        let metadata = json!({
            "session_id": "full-session-id-abc123",
            "start_time": "2026-02-02T12:00:00+00:00",
            "end_time": "2026-02-02T12:05:00+00:00",
            "environment": { "working_directory": cwd },
            "title": "Fix Vibe provider",
            "title_source": "manual",
            "stats": {
                "session_prompt_tokens": 120,
                "session_completion_tokens": 45
            }
        });
        fs::write(
            session_dir.join(METADATA_FILE),
            serde_json::to_string_pretty(&metadata).unwrap(),
        )
        .expect("write metadata");

        let messages = [
            json!({
                "role": "user",
                "content": "Add Mistral Vibe support",
                "message_id": "msg-1"
            }),
            json!({
                "role": "assistant",
                "content": "I'll inspect the provider registry.",
                "reasoning_content": "Need to mirror Kimi parsing.",
                "message_id": "msg-2",
                "tool_calls": [{
                    "id": "call-1",
                    "type": "function",
                    "function": {
                        "name": "read_file",
                        "arguments": "{\"path\":\"providers/mod.rs\"}"
                    }
                }]
            }),
            json!({
                "role": "tool",
                "tool_call_id": "call-1",
                "content": "mod kimi;",
                "message_id": "msg-3"
            }),
        ];
        let jsonl = messages
            .iter()
            .map(|line| serde_json::to_string(line).unwrap())
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(session_dir.join(MESSAGES_FILE), jsonl).expect("write messages");

        (cwd.to_string(), session_dir.to_string_lossy().to_string())
    }

    #[test]
    fn scan_projects_groups_sessions_by_working_directory() {
        let temp = TempDir::new().expect("temp dir");
        let (cwd, _) = write_fixture(temp.path());

        let projects = scan_projects_from_path(temp.path().to_str().unwrap()).expect("scan");
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].path, format!("{SCHEME}{cwd}"));
        assert_eq!(projects[0].session_count, 1);
        assert_eq!(projects[0].message_count, 3);
        assert_eq!(projects[0].provider.as_deref(), Some(PROVIDER_ID));
    }

    #[test]
    fn load_sessions_and_messages_parse_openai_format() {
        let temp = TempDir::new().expect("temp dir");
        let (cwd, session_dir) = write_fixture(temp.path());
        let base = temp.path().to_str().unwrap();
        let project_path = format!("{SCHEME}{cwd}");

        let sessions =
            load_sessions_from_base_path(base, &project_path, false).expect("load sessions");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].summary.as_deref(), Some("Fix Vibe provider"));
        assert!(sessions[0].is_renamed);
        assert!(sessions[0].has_tool_use);

        let messages = load_messages_from_base_path(base, &session_dir).expect("load messages");
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0].message_type, "user");
        assert_eq!(messages[1].message_type, "assistant");
        assert_eq!(messages[1].content.as_ref().unwrap()[0]["type"], "thinking");
        assert_eq!(messages[2].message_type, "tool");
    }

    #[test]
    fn get_base_path_honors_vibe_home() {
        let temp = TempDir::new().expect("temp dir");
        let vibe_home = temp.path().join(".vibe");
        fs::create_dir_all(&vibe_home).expect("create vibe home");

        let original = std::env::var("VIBE_HOME").ok();
        std::env::set_var("VIBE_HOME", &vibe_home);
        let detected = get_base_path().expect("detect vibe home");
        if let Some(value) = original {
            std::env::set_var("VIBE_HOME", value);
        } else {
            std::env::remove_var("VIBE_HOME");
        }

        assert_eq!(
            PathBuf::from(detected),
            vibe_home.canonicalize().unwrap_or(vibe_home)
        );
    }

    #[test]
    /// A corrupt line in messages.jsonl must be skipped, not fail the load —
    /// crashed Vibe sessions can leave a truncated final line.
    fn load_messages_skips_malformed_jsonl_lines() {
        let temp = TempDir::new().expect("temp dir");
        let (_cwd, session_dir) = write_fixture(temp.path());
        let base = temp.path().to_string_lossy().to_string();

        let messages_path = Path::new(&session_dir).join(MESSAGES_FILE);
        let mut content = fs::read_to_string(&messages_path).expect("read messages");
        content.push('\n'); // fixture jsonl has no trailing newline
        content.push_str("{ this is not json\n");
        content.push_str(
            "{\"role\":\"user\",\"content\":\"after corrupt line\",\"message_id\":\"msg-4\"}\n",
        );
        fs::write(&messages_path, content).expect("write messages");

        let messages = load_messages_from_base_path(&base, &session_dir).expect("load messages");
        assert_eq!(
            messages.len(),
            4,
            "corrupt line skipped, valid lines before and after kept"
        );
    }

    #[cfg(unix)]
    #[test]
    /// A symlinked session directory must be rejected by the path guard.
    fn load_messages_rejects_symlinked_session_dir() {
        use std::os::unix::fs as unix_fs;

        let temp = TempDir::new().expect("temp dir");
        let (_cwd, session_dir) = write_fixture(temp.path());
        let base = temp.path().to_string_lossy().to_string();

        // Symlink target is itself a VALID session dir in a foreign root, so a
        // rejection can only come from the path guard, not from missing files.
        let outside = TempDir::new().expect("outside dir");
        let (_ocwd, outside_session) = write_fixture(outside.path());
        let link = temp
            .path()
            .join("logs/session/session_20260202_130000_link");
        unix_fs::symlink(Path::new(&outside_session), &link).expect("create symlink");

        load_messages_from_base_path(&base, &link.to_string_lossy())
            .expect_err("symlinked session dir must be rejected");

        // The real session still loads fine alongside the rejected link.
        assert!(load_messages_from_base_path(&base, &session_dir).is_ok());
    }

    #[test]
    /// Pasted/attached images render: inline sources decode from the record,
    /// file sources are read from the session directory, and paths escaping
    /// the session dir are skipped (issue #438 follow-up).
    fn load_messages_renders_image_attachments() {
        use base64::Engine as _;

        let temp = TempDir::new().expect("temp dir");
        let (_cwd, session_dir) = write_fixture(temp.path());
        let base = temp.path().to_string_lossy().to_string();

        let png_bytes: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        fs::write(Path::new(&session_dir).join("img_1.png"), png_bytes).expect("write snapshot");

        let inline_b64 = base64::engine::general_purpose::STANDARD.encode(b"inline-bytes");
        let record = json!({
            "role": "user",
            "content": "look at these",
            "message_id": "msg-img",
            "images": [
                { "source": { "kind": "inline", "data": inline_b64 }, "alias": "a", "mime_type": "image/jpeg" },
                { "source": { "kind": "file", "path": "img_1.png" }, "alias": "b", "mime_type": "image/png" },
                { "source": { "kind": "file", "path": "../outside.png" }, "alias": "c", "mime_type": "image/png" },
                { "path": "img_1.png", "alias": "legacy-flat", "mime_type": "image/png" }
            ]
        });
        let messages_path = Path::new(&session_dir).join(MESSAGES_FILE);
        let mut content = fs::read_to_string(&messages_path).expect("read messages");
        content.push('\n');
        content.push_str(&record.to_string());
        content.push('\n');
        fs::write(&messages_path, content).expect("write messages");

        let messages = load_messages_from_base_path(&base, &session_dir).expect("load messages");
        let with_images = messages
            .iter()
            .find(|m| m.uuid == "msg-img")
            .expect("image message present");
        let blocks = with_images.content.as_ref().expect("content blocks");
        let image_blocks: Vec<_> = blocks
            .as_array()
            .expect("array")
            .iter()
            .filter(|b| b["type"] == "image")
            .collect();

        // inline + in-dir file + legacy flat = 3; the escaping path is skipped.
        assert_eq!(image_blocks.len(), 3);
        assert_eq!(image_blocks[0]["source"]["media_type"], "image/jpeg");
        assert_eq!(image_blocks[0]["source"]["data"], json!(inline_b64));
        let expected_png = base64::engine::general_purpose::STANDARD.encode(png_bytes);
        assert_eq!(image_blocks[1]["source"]["data"], json!(expected_png));
    }
}
