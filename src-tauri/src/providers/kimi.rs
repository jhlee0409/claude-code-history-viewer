use super::ProviderInfo;
use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::utils::{
    build_provider_message, detect_git_worktree_info, is_symlink,
    search_json_value_case_insensitive,
};
use chrono::{DateTime, TimeZone, Utc};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

const PROVIDER_ID: &str = "kimi";
const SESSIONS_DIR: &str = "sessions";
const CONTEXT_FILE: &str = "context.jsonl";
const STATE_FILE: &str = "state.json";
const WIRE_FILE: &str = "wire.jsonl";

pub fn detect() -> Option<ProviderInfo> {
    let base = get_base_path()?;
    let sessions_path = Path::new(&base).join(SESSIONS_DIR);

    Some(ProviderInfo {
        id: PROVIDER_ID.to_string(),
        display_name: "Kimi CLI".to_string(),
        base_path: base,
        is_available: sessions_path.exists() && sessions_path.is_dir(),
    })
}

pub fn get_base_path() -> Option<String> {
    if let Ok(env_val) = std::env::var("KIMI_SHARE_DIR").or_else(|_| std::env::var("KIMI_HOME")) {
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

    let default = dirs::home_dir()?.join(".kimi");
    if default.exists() {
        let normalized = default.canonicalize().unwrap_or(default);
        Some(normalized.to_string_lossy().to_string())
    } else {
        None
    }
}

pub fn scan_projects_from_path(base_path: &str) -> Result<Vec<ClaudeProject>, String> {
    crate::utils::require_absolute_path(base_path, "Kimi base path")?;
    let base = Path::new(base_path);
    let sessions_root = base.join(SESSIONS_DIR);

    if is_symlink(&sessions_root) || !sessions_root.is_dir() {
        return Ok(Vec::new());
    }

    let canonical_base = canonical_existing(base, "Kimi base path")?;
    let mut projects = Vec::new();

    for entry in
        fs::read_dir(&sessions_root).map_err(|e| format!("Failed to read Kimi sessions: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read Kimi project entry: {e}"))?;
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

        let mut infos = Vec::new();
        for session_entry in fs::read_dir(&project_dir)
            .map_err(|e| format!("Failed to read Kimi project dir: {e}"))?
        {
            let session_entry =
                session_entry.map_err(|e| format!("Failed to read Kimi session entry: {e}"))?;
            if session_entry
                .file_type()
                .map_or(true, |ft| ft.is_symlink() || !ft.is_dir())
            {
                continue;
            }
            if let Some(info) = extract_session_info(&session_entry.path()) {
                infos.push(info);
            }
        }

        if infos.is_empty() {
            continue;
        }

        let fallback_name = project_dir
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "kimi".to_string());
        let actual_path = infos
            .iter()
            .find_map(|info| info.cwd.clone())
            .unwrap_or_else(|| fallback_name.clone());
        let name = project_name_from_actual_path(&actual_path, &fallback_name);
        let message_count = infos.iter().map(|info| info.message_count).sum();
        let last_modified = infos
            .iter()
            .map(|info| info.last_modified.as_str())
            .max()
            .unwrap_or_default()
            .to_string();

        projects.push(ClaudeProject {
            name,
            path: format!("kimi://{}", project_dir.to_string_lossy()),
            actual_path: actual_path.clone(),
            session_count: infos.len(),
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

pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let base = get_base_path().ok_or("Kimi base path not found")?;
    scan_projects_from_path(&base)
}

pub fn load_sessions(
    project_path: &str,
    exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let base = get_base_path().ok_or("Kimi base path not found")?;
    load_sessions_from_base_path(&base, project_path, exclude_sidechain)
}

pub fn load_sessions_from_base_path(
    base_path: &str,
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    crate::utils::require_absolute_path(base_path, "Kimi base path")?;
    let base = Path::new(base_path);
    let project_dir = resolve_project_dir(base, project_path)?;
    let canonical_base = canonical_existing(base, "Kimi base path")?;
    if !path_is_inside(&project_dir, &canonical_base)? {
        return Err("Kimi project path is outside Kimi base path".to_string());
    }

    let fallback_project_name = project_dir
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "kimi".to_string());

    let mut sessions = Vec::new();
    for entry in
        fs::read_dir(&project_dir).map_err(|e| format!("Failed to read Kimi project dir: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read Kimi session entry: {e}"))?;
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
        let project_name = info
            .cwd
            .as_deref()
            .map(|cwd| project_name_from_actual_path(cwd, &fallback_project_name))
            .unwrap_or_else(|| fallback_project_name.clone());

        sessions.push(ClaudeSession {
            session_id: session_dir.to_string_lossy().to_string(),
            actual_session_id: info.session_id.clone(),
            file_path: session_dir.to_string_lossy().to_string(),
            project_name,
            message_count: info.message_count,
            first_message_time: info.first_message_time,
            last_message_time: info.last_message_time,
            last_modified: info.last_modified,
            has_tool_use: info.has_tool_use,
            has_errors: false,
            summary: info.summary,
            is_renamed: false,
            provider: Some(PROVIDER_ID.to_string()),
            storage_type: Some("jsonl".to_string()),
            entrypoint: None,
        });
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let base = get_base_path().ok_or("Kimi base path not found")?;
    load_messages_from_base_path(&base, session_path)
}

pub fn load_messages_from_base_path(
    base_path: &str,
    session_path: &str,
) -> Result<Vec<ClaudeMessage>, String> {
    crate::utils::require_absolute_path(base_path, "Kimi base path")?;
    let base = Path::new(base_path);
    let session_dir = PathBuf::from(session_path);
    let canonical_base = canonical_existing(base, "Kimi base path")?;
    if !session_dir.is_absolute() || !path_is_inside(&session_dir, &canonical_base)? {
        return Err("Kimi session path is outside Kimi base path".to_string());
    }
    if is_symlink(&session_dir) || !session_dir.is_dir() {
        return Err("Kimi session path is not a directory".to_string());
    }

    let session_id = session_dir
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let timestamps = read_wire_timestamps(&session_dir);
    let session_timestamp = timestamps
        .first()
        .cloned()
        .unwrap_or_else(|| file_modified_iso(&session_dir.join(CONTEXT_FILE)).unwrap_or_default());
    let mut messages = Vec::new();
    let mut counter = 0u64;

    for value in read_jsonl_values(&session_dir.join(CONTEXT_FILE))? {
        let role = value.get("role").and_then(Value::as_str).unwrap_or("");
        if role.starts_with('_') {
            continue;
        }
        if let Some(message) =
            convert_context_message(&value, role, &session_id, &session_timestamp, &mut counter)
        {
            messages.push(message);
        }
    }

    Ok(messages)
}

pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let base = get_base_path().ok_or("Kimi base path not found")?;
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
}

fn extract_session_info(session_dir: &Path) -> Option<SessionInfo> {
    if is_symlink(session_dir) || !session_dir.is_dir() {
        return None;
    }
    let context_path = session_dir.join(CONTEXT_FILE);
    if is_symlink(&context_path) || !context_path.is_file() {
        return None;
    }

    let session_id = session_dir.file_name()?.to_string_lossy().to_string();
    let state = read_json_file(&session_dir.join(STATE_FILE)).unwrap_or(Value::Null);
    let title = state
        .get("custom_title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(ToOwned::to_owned);
    let timestamps = read_wire_timestamps(session_dir);
    let mut cwd = None;
    let mut first_user = None;
    let mut message_count = 0usize;
    let mut has_tool_use = false;

    let values = read_jsonl_values(&context_path).ok()?;
    for value in values {
        let role = value.get("role").and_then(Value::as_str).unwrap_or("");
        if role == "_system_prompt" && cwd.is_none() {
            cwd = value
                .get("content")
                .and_then(Value::as_str)
                .and_then(extract_working_directory);
            continue;
        }
        if role.starts_with('_') {
            continue;
        }
        if role == "user" || role == "assistant" || role == "tool" {
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
            first_user = extract_content_summary(&value);
        }
    }

    if message_count == 0 {
        return None;
    }

    let first_message_time = timestamps.first().cloned().unwrap_or_default();
    let last_message_time = timestamps
        .last()
        .cloned()
        .unwrap_or_else(|| first_message_time.clone());
    let last_modified = if last_message_time.is_empty() {
        file_modified_iso(&context_path).unwrap_or_default()
    } else {
        last_message_time.clone()
    };

    Some(SessionInfo {
        session_id,
        cwd,
        message_count,
        first_message_time,
        last_message_time,
        last_modified,
        has_tool_use,
        summary: title.or(first_user),
    })
}

fn convert_context_message(
    value: &Value,
    role: &str,
    session_id: &str,
    timestamp: &str,
    counter: &mut u64,
) -> Option<ClaudeMessage> {
    *counter += 1;
    let uuid = value
        .get("id")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("{session_id}-{counter}"));

    match role {
        "user" => Some(build_provider_message(
            PROVIDER_ID,
            uuid,
            session_id,
            timestamp.to_string(),
            "user",
            Some("user"),
            Some(content_to_blocks(value.get("content"))),
            None,
        )),
        "assistant" => {
            let mut blocks = content_to_blocks(value.get("content"));
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

fn extract_working_directory(system_prompt: &str) -> Option<String> {
    const MARKER: &str = "The current working directory is `";
    let start = system_prompt.find(MARKER)? + MARKER.len();
    let rest = &system_prompt[start..];
    let end = rest.find('`')?;
    let cwd = &rest[..end];
    if is_absolute_working_directory(cwd) {
        Some(cwd.to_string())
    } else {
        None
    }
}

fn is_absolute_working_directory(cwd: &str) -> bool {
    Path::new(cwd).is_absolute() || looks_like_windows_absolute_path(cwd)
}

fn looks_like_windows_absolute_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    // Drive-letter path: C:\ or C:/
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/')
    {
        return true;
    }
    // UNC path: \\server\share or //server/share
    if bytes.len() >= 2 && matches!(bytes[0], b'\\' | b'/') && bytes[0] == bytes[1] {
        return true;
    }
    false
}

fn read_json_file(path: &Path) -> Result<Value, String> {
    if is_symlink(path) {
        return Err("Refusing to read symlinked Kimi JSON file".to_string());
    }
    let content = fs::read_to_string(path).map_err(|e| format!("Failed to read JSON file: {e}"))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse JSON file: {e}"))
}

fn read_jsonl_values(path: &Path) -> Result<Vec<Value>, String> {
    if is_symlink(path) {
        return Err("Refusing to read symlinked Kimi JSONL file".to_string());
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

fn read_wire_timestamps(session_dir: &Path) -> Vec<String> {
    let path = session_dir.join(WIRE_FILE);
    let Ok(values) = read_jsonl_values(&path) else {
        return Vec::new();
    };

    values
        .into_iter()
        .filter_map(|value| {
            value
                .get("timestamp")
                .and_then(Value::as_f64)
                .and_then(epoch_to_iso)
        })
        .collect()
}

fn epoch_to_iso(seconds: f64) -> Option<String> {
    // Valid range: 1970-2100 (Unix seconds 0 ~ 4_102_444_800)
    if !(0.0..=4_102_444_800.0).contains(&seconds) {
        return None;
    }
    let whole = seconds.trunc() as i64;
    let nanos = ((seconds.fract() * 1_000_000_000.0).round() as u32).min(999_999_999);
    Utc.timestamp_opt(whole, nanos)
        .single()
        .map(|dt| dt.to_rfc3339())
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

fn resolve_project_dir(base: &Path, project_path: &str) -> Result<PathBuf, String> {
    let raw = project_path.strip_prefix("kimi://").unwrap_or(project_path);
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err("Kimi project path must be absolute".to_string());
    }
    if is_symlink(&path) || !path.is_dir() {
        return Err("Kimi project path is not a directory".to_string());
    }
    let sessions_root = base.join(SESSIONS_DIR);
    if !path.starts_with(&sessions_root) {
        return Err("Kimi project path is outside Kimi sessions directory".to_string());
    }
    Ok(path)
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

fn project_name_from_actual_path(actual_path: &str, fallback: &str) -> String {
    Path::new(actual_path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::fs;
    use tempfile::TempDir;

    struct EnvVarGuard {
        key: &'static str,
        original: Option<std::ffi::OsString>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: std::ffi::OsString) -> Self {
            let original = std::env::var_os(key);
            std::env::set_var(key, value);
            Self { key, original }
        }

        fn remove(key: &'static str) -> Self {
            let original = std::env::var_os(key);
            std::env::remove_var(key);
            Self { key, original }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            if let Some(value) = self.original.as_ref() {
                std::env::set_var(self.key, value);
            } else {
                std::env::remove_var(self.key);
            }
        }
    }

    #[test]
    fn extract_working_directory_accepts_windows_absolute_paths() {
        let prompt = "The current working directory is `C:\\Users\\max\\repo`.";

        assert_eq!(
            extract_working_directory(prompt).as_deref(),
            Some("C:\\Users\\max\\repo")
        );
    }

    #[test]
    fn extract_working_directory_accepts_unc_paths() {
        let prompt = r"The current working directory is `\\fileserver\share\project`.";
        assert_eq!(
            extract_working_directory(prompt).as_deref(),
            Some(r"\\fileserver\share\project")
        );
    }

    #[test]
    #[serial]
    fn get_base_path_prefers_kimi_share_dir_over_kimi_home() {
        let temp = TempDir::new().unwrap();
        let share_dir = temp.path().join("share");
        let home_dir = temp.path().join("home");
        fs::create_dir_all(&share_dir).unwrap();
        fs::create_dir_all(&home_dir).unwrap();
        let _share = EnvVarGuard::set("KIMI_SHARE_DIR", share_dir.as_os_str().to_owned());
        let _home = EnvVarGuard::set("KIMI_HOME", home_dir.as_os_str().to_owned());
        let path = get_base_path().unwrap();
        assert_eq!(
            std::path::PathBuf::from(path),
            share_dir.canonicalize().unwrap()
        );
    }

    #[test]
    #[serial]
    fn get_base_path_returns_none_when_default_dir_absent() {
        let _share = EnvVarGuard::remove("KIMI_SHARE_DIR");
        let _home_env = EnvVarGuard::remove("KIMI_HOME");
        if dirs::home_dir()
            .map(|h| h.join(".kimi").exists())
            .unwrap_or(false)
        {
            return;
        }
        assert!(get_base_path().is_none());
    }
}
