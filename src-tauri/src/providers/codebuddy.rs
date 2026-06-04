use super::ProviderInfo;
use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::utils::{
    build_provider_message, decode_with_filesystem_check, find_line_ranges,
    search_json_value_case_insensitive,
};
use chrono::{DateTime, Utc};
use memmap2::Mmap;
use serde_json::Value;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use walkdir::WalkDir;

const PROVIDER_ID: &str = "codebuddy";

/// Detect `CodeBuddy Code` installation
pub fn detect() -> Option<ProviderInfo> {
    let base_path = get_base_path()?;
    let projects_path = Path::new(&base_path);

    Some(ProviderInfo {
        id: PROVIDER_ID.to_string(),
        display_name: "CodeBuddy Code".to_string(),
        base_path: base_path.clone(),
        is_available: projects_path.exists() && projects_path.is_dir(),
    })
}

/// Get the `CodeBuddy` projects base path (`~/.codebuddy/projects`)
pub fn get_base_path() -> Option<String> {
    let home = dirs::home_dir()?;
    let projects_path = home.join(".codebuddy").join("projects");
    if projects_path.exists() && projects_path.is_dir() {
        Some(projects_path.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Scan `CodeBuddy` projects under the user's `~/.codebuddy/projects` root.
///
/// Thin wrapper over [`scan_projects_in`] that resolves the production root
/// from `dirs::home_dir()`. Tests should call `scan_projects_in` directly with
/// a tempdir so the assertion runs against the real production code path
/// instead of a copy of the loop logic.
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let base_path = get_base_path().ok_or("CodeBuddy projects path not found")?;
    scan_projects_in(Path::new(&base_path))
}

/// Implementation of [`scan_projects`] parameterized by the projects root.
/// Extracted so tests can pass an isolated tempdir.
pub fn scan_projects_in(base: &Path) -> Result<Vec<ClaudeProject>, String> {
    let mut projects = Vec::new();

    for entry in WalkDir::new(base)
        .min_depth(1)
        .max_depth(1)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_dir())
    {
        let project_dir = entry.path();

        // Count JSONL files. While scanning, also opportunistically capture
        // the first session file path so we can recover the project's real
        // working directory from its `cwd` field (CodeBuddy's directory
        // encoding is lossy when project names contain hyphens).
        let mut session_count = 0usize;
        let mut message_count = 0usize;
        let mut last_modified_ts = 0u64;
        let mut sample_session_paths: Vec<std::path::PathBuf> = Vec::new();

        for jsonl_entry in WalkDir::new(project_dir)
            .min_depth(1)
            .max_depth(1)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
        {
            // Skip symlinked .jsonl entries: they could leak file counts and
            // mtimes from outside the project root into the sidebar summary.
            // Mirrors the symlink check in `load_sessions`.
            if std::fs::symlink_metadata(jsonl_entry.path())
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(false)
            {
                continue;
            }
            session_count += 1;
            if sample_session_paths.len() < 3 {
                sample_session_paths.push(jsonl_entry.path().to_path_buf());
            }
            if let Ok(metadata) = jsonl_entry.metadata() {
                message_count += (metadata.len() / 500) as usize;
                if let Ok(modified) = metadata.modified() {
                    if let Ok(dur) = modified.duration_since(std::time::SystemTime::UNIX_EPOCH) {
                        last_modified_ts = last_modified_ts.max(dur.as_secs());
                    }
                }
            }
        }

        if session_count == 0 {
            continue;
        }

        let dir_name = project_dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown");

        // Resolve the project's real path so we can show a faithful display
        // name. CodeBuddy stores projects under names like
        // `Users-rassyan-WebstormProjects-claude-code-history-viewer` — the
        // path separator `/` is replaced by `-` without escaping, so a
        // naive `rsplit('-').next()` would truncate hyphenated project
        // names (`claude-code-history-viewer` -> `viewer`).
        //
        // Resolution order:
        //   1. Read `cwd` from a session jsonl (CodeBuddy writes the real
        //      absolute path on every message line) — 100% accurate.
        //   2. Fall back to filesystem-existence-based decoding (same
        //      strategy Claude Code uses in `utils::decode_project_path`).
        //   3. Last resort: keep the existing rsplit('-') behavior so this
        //      change cannot regress projects that previously displayed
        //      correctly.
        let resolved_path = read_cwd_from_jsonls(&sample_session_paths)
            .or_else(|| decode_with_filesystem_check(dir_name));

        let (display_name, actual_path) = match resolved_path {
            Some(real_path) => {
                let leaf = Path::new(&real_path)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| dir_name.to_string());
                (leaf, real_path)
            }
            None => (
                dir_name.rsplit('-').next().unwrap_or(dir_name).to_string(),
                project_dir.to_string_lossy().to_string(),
            ),
        };

        #[allow(clippy::cast_possible_wrap)]
        let last_modified = if last_modified_ts > 0 {
            DateTime::from_timestamp(last_modified_ts as i64, 0)
                .unwrap_or_else(Utc::now)
                .to_rfc3339()
        } else {
            Utc::now().to_rfc3339()
        };

        projects.push(ClaudeProject {
            name: display_name,
            // `path` remains the on-disk storage path used to look up
            // sessions later; `actual_path` is the user-facing real working
            // directory (when we could recover it) so downstream features
            // like git-info detection see the correct repo location.
            path: project_dir.to_string_lossy().to_string(),
            actual_path,
            session_count,
            message_count,
            last_modified,
            git_info: None,
            provider: Some(PROVIDER_ID.to_string()),
            storage_type: None,
            custom_directory_label: None,
        });
    }

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

/// Try to extract the real working directory of a `CodeBuddy` project by
/// reading the `cwd` field from the head of one of its session jsonl files.
///
/// `CodeBuddy` writes the real absolute path on every `type:"message"` line,
/// so the first non-empty `cwd` we can parse is authoritative. We scan only
/// the first few lines of at most 3 candidate files to keep this cheap
/// during project listing.
fn read_cwd_from_jsonls(candidates: &[std::path::PathBuf]) -> Option<String> {
    const MAX_LINES_PER_FILE: usize = 10;

    for path in candidates {
        let Ok(file) = File::open(path) else { continue };
        let reader = BufReader::new(file);
        for line in reader
            .lines()
            .take(MAX_LINES_PER_FILE)
            .map_while(Result::ok)
        {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
                continue;
            };
            if let Some(cwd) = value.get("cwd").and_then(|v| v.as_str()) {
                let cwd_trimmed = cwd.trim();
                if !cwd_trimmed.is_empty() && Path::new(cwd_trimmed).is_absolute() {
                    return Some(cwd_trimmed.to_string());
                }
            }
        }
    }

    None
}

/// Load sessions for a `CodeBuddy` project
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    if project_path.trim().is_empty() {
        return Err("project_path is required".to_string());
    }

    let project_dir = Path::new(project_path);
    if !project_dir.exists() || !project_dir.is_dir() {
        return Ok(vec![]);
    }

    // Defense-in-depth: confine traversal to ~/.codebuddy/projects/<project>.
    // Reject paths outside this root (path traversal) and reject the project
    // dir itself if it is a symlink (potential symlink attack).
    validate_session_path(project_dir)?;
    if std::fs::symlink_metadata(project_dir)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(format!(
            "Project path must not be a symlink: {}",
            project_dir.display()
        ));
    }

    let mut sessions = Vec::new();

    for entry in WalkDir::new(project_dir)
        .min_depth(1)
        .max_depth(1)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
    {
        let file_path = entry.path();
        // Skip symlinked .jsonl files — they could point outside the
        // project root we just validated.
        if std::fs::symlink_metadata(file_path)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false)
        {
            continue;
        }
        if let Some(session) = extract_session_info(file_path) {
            sessions.push(session);
        }
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

/// Load messages from a `CodeBuddy` session file
#[allow(unsafe_code)]
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let path = Path::new(session_path);
    if !path.exists() {
        return Err(format!("Session file not found: {session_path}"));
    }

    validate_session_path(path)?;

    let file = File::open(path).map_err(|e| e.to_string())?;
    // SAFETY: File is read-only and we only read from the mapping
    let mmap = unsafe { Mmap::map(&file) }.map_err(|e| e.to_string())?;
    let ranges = find_line_ranges(&mmap);

    let mut messages = Vec::new();
    let mut session_id = String::new();
    let mut msg_counter = 0u64;

    for &(start, end) in &ranges {
        let line = &mmap[start..end];
        let mut buf = line.to_vec();
        let val: Value = match simd_json::from_slice(&mut buf) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let line_type = val.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let timestamp = convert_timestamp(&val);

        if session_id.is_empty() {
            if let Some(sid) = val.get("sessionId").and_then(|v| v.as_str()) {
                session_id = sid.to_string();
            }
        }

        match line_type {
            "message" => {
                if let Some(msg) = convert_message(&val, &session_id, &timestamp, &mut msg_counter)
                {
                    messages.push(msg);
                }
            }
            "function_call" => {
                messages.push(convert_function_call(
                    &val,
                    &session_id,
                    &timestamp,
                    &mut msg_counter,
                ));
            }
            "function_call_result" => {
                messages.push(convert_function_call_result(
                    &val,
                    &session_id,
                    &timestamp,
                    &mut msg_counter,
                ));
            }
            _ => {}
        }
    }

    Ok(messages)
}

/// Search `CodeBuddy` sessions for a query string
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let base_path = get_base_path().ok_or("CodeBuddy not found")?;
    let base = Path::new(&base_path);
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for entry in WalkDir::new(base)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
    {
        if results.len() >= limit {
            break;
        }

        if let Ok(messages) = load_messages(&entry.path().to_string_lossy()) {
            for msg in messages {
                if results.len() >= limit {
                    return Ok(results);
                }
                if let Some(content) = &msg.content {
                    if search_json_value_case_insensitive(content, &query_lower) {
                        results.push(msg);
                    }
                }
            }
        }
    }

    Ok(results)
}

// ============================================================================
// Internal helpers
// ============================================================================

/// Validate that a session path is within `~/.codebuddy/projects`
fn validate_session_path(path: &Path) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let allowed = home.join(".codebuddy").join("projects");

    let canonical = if path.exists() {
        path.canonicalize()
            .map_err(|e| format!("Path canonicalization error: {e}"))?
    } else {
        path.to_path_buf()
    };

    let canonical_allowed = if allowed.exists() {
        allowed
            .canonicalize()
            .map_err(|e| format!("Path canonicalization error: {e}"))?
    } else {
        allowed
    };

    if canonical.starts_with(&canonical_allowed) {
        Ok(())
    } else {
        Err(format!(
            "Session path is outside CodeBuddy projects directory: {}",
            path.display()
        ))
    }
}

/// Convert a numeric or string timestamp to ISO 8601 string.
///
/// `CodeBuddy` uses Unix milliseconds (numeric), while Claude uses ISO 8601 strings.
fn convert_timestamp(val: &Value) -> String {
    match val.get("timestamp") {
        Some(Value::Number(n)) => {
            if let Some(ms) = n.as_i64() {
                DateTime::from_timestamp_millis(ms)
                    .unwrap_or_else(Utc::now)
                    .to_rfc3339()
            } else {
                Utc::now().to_rfc3339()
            }
        }
        Some(Value::String(s)) => s.clone(),
        _ => Utc::now().to_rfc3339(),
    }
}

/// Convert content array: `input_text`/`output_text` -> `text`
fn convert_content_array(content: Option<&Value>) -> Option<Value> {
    let arr = content?.as_array()?;

    let items: Vec<Value> = arr
        .iter()
        .filter_map(|item| {
            let ctype = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
            match ctype {
                "input_text" | "output_text" | "text" => {
                    let text = item.get("text").and_then(|t| t.as_str()).unwrap_or("");
                    Some(serde_json::json!({
                        "type": "text",
                        "text": text
                    }))
                }
                "image_blob_ref" => Some(item.clone()),
                _ => None,
            }
        })
        .collect();

    if items.is_empty() {
        None
    } else {
        Some(Value::Array(items))
    }
}

/// Convert a `"message"` type entry to `ClaudeMessage`
fn convert_message(
    val: &Value,
    session_id: &str,
    timestamp: &str,
    counter: &mut u64,
) -> Option<ClaudeMessage> {
    let role = val.get("role").and_then(|r| r.as_str())?;

    // Skip system-injected messages (providerData.skipRun with XML content)
    if val
        .get("providerData")
        .and_then(|pd| pd.get("skipRun"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        if let Some(content) = val.get("content") {
            if let Some(arr) = content.as_array() {
                if let Some(first) = arr.first() {
                    if let Some(text) = first.get("text").and_then(|t| t.as_str()) {
                        if text.starts_with("<system-reminder")
                            || text.starts_with("<command-name>")
                            || text.starts_with("<local-command-stdout>")
                        {
                            return None;
                        }
                    }
                }
            }
        }
    }

    *counter += 1;
    let uuid = val
        .get("id")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| format!("codebuddy-{counter}"));

    let message_type = match role {
        "assistant" => "assistant",
        "system" => "system",
        _ => "user",
    };

    let content = convert_content_array(val.get("content"));

    Some(build_provider_message(
        PROVIDER_ID,
        uuid,
        session_id,
        timestamp.to_string(),
        message_type,
        Some(role),
        content,
        None,
    ))
}

/// Convert a `"function_call"` entry to a Claude-native `tool_use` message.
///
/// Output mirrors Claude Code's assistant-with-`tool_use` format:
///   - top-level type: "assistant"
///   - content: `[{type:"tool_use", id:<callId>, name, input:<parsed object>}]`
///
/// Note `arguments` in `CodeBuddy` JSONL is a JSON-encoded **string** (e.g.
/// `"{\"command\":\"ls\"}"`), not an object. We parse it so the frontend
/// renderers (`BashCard`, `GrepCard`, etc.) can read individual params.
fn convert_function_call(
    val: &Value,
    session_id: &str,
    timestamp: &str,
    counter: &mut u64,
) -> ClaudeMessage {
    *counter += 1;
    let uuid = val
        .get("id")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| format!("codebuddy-fc-{counter}"));

    let name = val
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown_tool");
    // Use callId as the tool_use id — that's what frontend pairs results by.
    let call_id = val.get("callId").and_then(|v| v.as_str()).unwrap_or("");

    // arguments is a JSON-encoded string in CodeBuddy. Parse to object so
    // BashCard etc. can read input.command, input.pattern, input.file_path.
    let input = match val.get("arguments") {
        Some(Value::String(s)) => serde_json::from_str::<Value>(s).unwrap_or(Value::Null),
        Some(other) => other.clone(),
        None => Value::Null,
    };

    let tool_use = serde_json::json!({
        "type": "tool_use",
        "id": call_id,
        "name": name,
        "input": input,
    });

    let content = Some(Value::Array(vec![tool_use]));

    build_provider_message(
        PROVIDER_ID,
        uuid,
        session_id,
        timestamp.to_string(),
        "assistant",
        Some("assistant"),
        content,
        None,
    )
}

/// Convert a `"function_call_result"` entry to a Claude-native `tool_result`
/// message.
///
/// Output mirrors Claude Code's user-with-`tool_result` format:
///   - top-level type: "user"
///   - content: `[{type:"tool_result", tool_use_id:<callId>, content:<text>}]`
///   - top-level `toolUseResult` field (so the legacy `ToolExecutionResultRouter`
///     also renders it, matching Claude's UI behavior).
///
/// Source field shape: `CodeBuddy` puts result text under `output` (not
/// `content`) and looks like `{type:"text", text:"..."}` or
/// `{type:"text", text:"...", title:"..."}`.
fn convert_function_call_result(
    val: &Value,
    session_id: &str,
    timestamp: &str,
    counter: &mut u64,
) -> ClaudeMessage {
    *counter += 1;
    let uuid = val
        .get("id")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| format!("codebuddy-fcr-{counter}"));

    let call_id = val.get("callId").and_then(|v| v.as_str()).unwrap_or("");

    // Extract text from `output` (CodeBuddy's actual field). Fall back to
    // `content`/`message.content` for forward-compat with format changes.
    let text = val
        .get("output")
        .and_then(|o| {
            o.get("text")
                .and_then(|t| t.as_str())
                .map(String::from)
                .or_else(|| {
                    // output may itself be a string in some variants
                    o.as_str().map(String::from)
                })
        })
        .or_else(|| {
            val.get("content")
                .and_then(|c| c.as_str())
                .map(String::from)
        })
        .or_else(|| {
            val.get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
                .map(String::from)
        })
        .unwrap_or_default();

    let is_error = val.get("status").and_then(|s| s.as_str()) == Some("error");

    // Build inline tool_result item — frontend matches by tool_use_id.
    let mut tool_result_item = serde_json::json!({
        "type": "tool_result",
        "tool_use_id": call_id,
        "content": text,
    });
    if is_error {
        tool_result_item["is_error"] = Value::Bool(true);
    }

    let content = Some(Value::Array(vec![tool_result_item.clone()]));

    let mut msg = build_provider_message(
        PROVIDER_ID,
        uuid,
        session_id,
        timestamp.to_string(),
        "user",
        Some("user"),
        content,
        None,
    );
    // Also set the legacy top-level toolUseResult field so the
    // ToolExecutionResultRouter renders the result block (matches Claude).
    msg.tool_use_result = Some(tool_result_item);
    msg
}

/// Extract session metadata from a JSONL file
#[allow(unsafe_code)]
fn extract_session_info(file_path: &Path) -> Option<ClaudeSession> {
    let file = File::open(file_path).ok()?;
    // SAFETY: File is read-only
    let mmap = unsafe { Mmap::map(&file) }.ok()?;
    let ranges = find_line_ranges(&mmap);

    let mut session_id = String::new();
    let mut message_count = 0usize;
    let mut first_time = String::new();
    let mut last_time = String::new();
    let mut has_tool_use = false;
    let mut summary: Option<String> = None;
    let mut first_user_text: Option<String> = None;

    for &(start, end) in &ranges {
        let line = &mmap[start..end];
        let mut buf = line.to_vec();
        let val: Value = match simd_json::from_slice(&mut buf) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let line_type = val.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let timestamp = convert_timestamp(&val);

        match line_type {
            "message" => {
                let role = val.get("role").and_then(|r| r.as_str()).unwrap_or("");

                if val
                    .get("providerData")
                    .and_then(|pd| pd.get("skipRun"))
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                {
                    continue;
                }

                if session_id.is_empty() {
                    if let Some(sid) = val.get("sessionId").and_then(|v| v.as_str()) {
                        session_id = sid.to_string();
                    }
                }

                message_count += 1;

                if first_time.is_empty() {
                    first_time.clone_from(&timestamp);
                }
                last_time = timestamp;

                if first_user_text.is_none() && role == "user" {
                    if let Some(content) = val.get("content").and_then(|c| c.as_array()) {
                        for item in content {
                            if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                                if !text.starts_with('<') {
                                    let truncated = if text.chars().count() > 100 {
                                        format!("{}...", text.chars().take(100).collect::<String>())
                                    } else {
                                        text.to_string()
                                    };
                                    first_user_text = Some(truncated);
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            "function_call" | "function_call_result" => {
                message_count += 1;
                has_tool_use = true;

                if first_time.is_empty() {
                    first_time.clone_from(&timestamp);
                }
                last_time = timestamp;
            }
            "summary" => {
                if let Some(s) = val.get("summary").and_then(|v| v.as_str()) {
                    summary = Some(s.to_string());
                }
            }
            "topic" => {
                // Last-wins: CodeBuddy may emit multiple `topic` entries as
                // the conversation evolves. The latest one is the current
                // session title, so always overwrite (ignoring empty strings).
                if let Some(topic) = val.get("topic").and_then(|v| v.as_str()) {
                    let trimmed = topic.trim();
                    if !trimmed.is_empty() {
                        summary = Some(trimmed.to_string());
                    }
                }
            }
            _ => {}
        }
    }

    if message_count == 0 {
        return None;
    }

    let file_path_str = file_path.to_string_lossy().to_string();
    let project_name = file_path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let last_modified = file_path
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .map(|t| {
            let dt: DateTime<Utc> = t.into();
            dt.to_rfc3339()
        })
        .unwrap_or_else(|| Utc::now().to_rfc3339());

    let final_summary = summary.or(first_user_text);

    Some(ClaudeSession {
        session_id: file_path_str.clone(),
        actual_session_id: if session_id.is_empty() {
            file_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string()
        } else {
            session_id
        },
        file_path: file_path_str,
        project_name,
        message_count,
        first_message_time: if first_time.is_empty() {
            Utc::now().to_rfc3339()
        } else {
            first_time
        },
        last_message_time: if last_time.is_empty() {
            Utc::now().to_rfc3339()
        } else {
            last_time
        },
        last_modified,
        has_tool_use,
        has_errors: false,
        summary: final_summary,
        is_renamed: false,
        provider: Some(PROVIDER_ID.to_string()),
        storage_type: None,
        entrypoint: Some("cli".to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fmt::Write as _;

    /// Serialize a slice of JSON values into a newline-delimited body for
    /// writing a synthetic .jsonl test fixture. Equivalent to
    /// `lines.iter().map(|v| format!("{v}\n")).collect::<String>()` but
    /// satisfies `clippy::format_collect`.
    fn join_jsonl(lines: &[serde_json::Value]) -> String {
        lines.iter().fold(String::new(), |mut acc, v| {
            let _ = writeln!(acc, "{v}");
            acc
        })
    }

    /// `function_call.arguments` is a JSON string in `CodeBuddy`. Verify we
    /// parse it into a real object so frontend renderers can read individual
    /// params (e.g. `BashCard` reads `input.command`).
    #[test]
    fn function_call_parses_arguments_string_to_object() {
        let raw = json!({
            "type": "function_call",
            "id": "fc-1",
            "callId": "toolu_abc",
            "name": "Bash",
            "arguments": "{\"command\":\"ls -la\",\"description\":\"list files\"}",
            "timestamp": 1779785490404_i64,
        });

        let mut counter = 0u64;
        let msg = convert_function_call(&raw, "session-1", "2026-05-29T00:00:00Z", &mut counter);

        let content = msg.content.expect("content present");
        let arr = content.as_array().expect("content is array");
        assert_eq!(arr.len(), 1);
        let tool_use = &arr[0];

        assert_eq!(tool_use["type"], "tool_use");
        assert_eq!(tool_use["id"], "toolu_abc");
        assert_eq!(tool_use["name"], "Bash");
        // Critical: input must be an OBJECT, not a string
        let input = &tool_use["input"];
        assert!(
            input.is_object(),
            "input must be parsed object, got: {input:?}"
        );
        assert_eq!(input["command"], "ls -la");
        assert_eq!(input["description"], "list files");
    }

    /// Even when arguments is malformed JSON, conversion shouldn't panic —
    /// it should fall back to `Value::Null` so the message still renders.
    #[test]
    fn function_call_handles_malformed_arguments_gracefully() {
        let raw = json!({
            "type": "function_call",
            "callId": "toolu_x",
            "name": "Bash",
            "arguments": "this is not json",
        });
        let mut counter = 0u64;
        let msg = convert_function_call(&raw, "s", "t", &mut counter);
        let content = msg.content.unwrap();
        let tool_use = &content[0];
        // Either Null or a string — but must NOT panic
        assert!(tool_use["input"].is_null() || tool_use["input"].is_string());
    }

    /// `function_call_result.output` is the result text source (NOT `content`).
    /// Verify we extract it and produce a Claude-native `tool_result` with
    /// `tool_use_id` matching the original `callId`.
    #[test]
    fn function_call_result_extracts_output_field() {
        let raw = json!({
            "type": "function_call_result",
            "id": "fcr-1",
            "callId": "toolu_abc",
            "name": "Bash",
            "status": "completed",
            "output": {
                "type": "text",
                "text": "file1.txt\nfile2.txt\n"
            },
        });

        let mut counter = 0u64;
        let msg =
            convert_function_call_result(&raw, "session-1", "2026-05-29T00:00:00Z", &mut counter);

        // Should be a "user" type message (Claude-native shape)
        assert_eq!(msg.message_type, "user");

        let content = msg.content.expect("content present");
        let arr = content.as_array().expect("array");
        assert_eq!(arr.len(), 1);

        let tool_result = &arr[0];
        assert_eq!(tool_result["type"], "tool_result");
        // Critical: tool_use_id must equal original callId so frontend can pair
        assert_eq!(tool_result["tool_use_id"], "toolu_abc");
        // Critical: text from output.text — not from content
        assert_eq!(tool_result["content"], "file1.txt\nfile2.txt\n");
        // Status "completed" should NOT set is_error
        assert!(tool_result.get("is_error").is_none());

        // Top-level toolUseResult also set (so legacy router renders it)
        assert!(msg.tool_use_result.is_some());
    }

    /// Error status should mark the result as `is_error: true` so the
    /// `StatusBadge` shows the red "error" state instead of green "completed".
    #[test]
    fn function_call_result_marks_errors() {
        let raw = json!({
            "type": "function_call_result",
            "callId": "toolu_y",
            "status": "error",
            "output": { "type": "text", "text": "command not found" },
        });
        let mut counter = 0u64;
        let msg = convert_function_call_result(&raw, "s", "t", &mut counter);
        let content = msg.content.unwrap();
        let tool_result = &content[0];
        assert_eq!(tool_result["is_error"], true);
    }

    /// `convert_message` must preserve the `system` role rather than coerce it
    /// into `user`. The previous `if/else` collapsed everything non-assistant
    /// into "user", which mislabeled system reminders / command output messages
    /// and broke filtering & visual distinction in the UI.
    #[test]
    fn convert_message_preserves_system_role() {
        let raw = json!({
            "type": "message",
            "id": "msg-sys-1",
            "role": "system",
            "sessionId": "session-1",
            "timestamp": 1779785490404_i64,
            "content": [{"type": "text", "text": "system reminder"}],
        });

        let mut counter = 0u64;
        let msg = convert_message(&raw, "session-1", "2026-05-29T00:00:00Z", &mut counter)
            .expect("system message should not be filtered out");

        assert_eq!(
            msg.message_type, "system",
            "system role must produce message_type == \"system\""
        );
        assert_eq!(msg.role.as_deref(), Some("system"));
    }

    /// Sanity check: assistant role still maps to "assistant".
    #[test]
    fn convert_message_preserves_assistant_role() {
        let raw = json!({
            "type": "message",
            "id": "msg-a-1",
            "role": "assistant",
            "sessionId": "session-1",
            "timestamp": 1779785490404_i64,
            "content": [{"type": "output_text", "text": "hi"}],
        });
        let mut counter = 0u64;
        let msg = convert_message(&raw, "session-1", "2026-05-29T00:00:00Z", &mut counter).unwrap();
        assert_eq!(msg.message_type, "assistant");
    }

    /// `load_sessions` must reject empty paths up-front. Defense in depth:
    /// caller code should not pass empty paths, but if it does we want a clear
    /// error rather than silently scanning whatever `Path::new("")` resolves to.
    #[test]
    fn load_sessions_rejects_empty_path() {
        let result = load_sessions("", false);
        assert!(result.is_err(), "empty path must error, got: {result:?}");
        assert!(
            result.unwrap_err().contains("required"),
            "error message should mention the missing parameter"
        );
    }

    /// `load_sessions` must reject paths outside `~/.codebuddy/projects` to
    /// prevent path-traversal-style reads of arbitrary directories on disk.
    #[test]
    fn load_sessions_rejects_path_outside_codebuddy_root() {
        // /tmp definitely exists on macOS/Linux and is outside the codebuddy
        // root. The function checks existence first, so we need a real path.
        let result = load_sessions("/tmp", false);
        // Either errors with the "outside" message, or — if /tmp doesn't
        // canonicalize on this platform — errors with a canonicalize message.
        // Both are acceptable; what we want to guard against is `Ok(...)`.
        assert!(
            result.is_err(),
            "path outside codebuddy root must error, got: {result:?}"
        );
    }

    /// Regression for the `function_call` -> `tool_use` conversion. Earlier
    /// revisions wrote the `tool_use` entry to BOTH `msg.content[]` and the
    /// top-level `msg.tool_use` field. That double-write doubled tool usage
    /// counts in `track_tool_usage` and pushed success rate to 50%. Native
    /// Claude JSONL only carries the entry inside `message.content[]`; the
    /// top-level `tool_use` field stays `None` and downstream code (`load.rs`)
    /// extracts from content as needed. This test pins that contract.
    #[test]
    fn function_call_does_not_double_write_tool_use() {
        let raw = json!({
            "type": "function_call",
            "id": "fc-1",
            "callId": "toolu_abc",
            "name": "Bash",
            "arguments": "{\"command\":\"ls\"}",
            "timestamp": 1779785490404_i64,
        });
        let mut counter = 0u64;
        let msg = convert_function_call(&raw, "session-1", "2026-05-29T00:00:00Z", &mut counter);

        // Content array MUST carry the tool_use entry (so the UI renders it
        // and `load.rs` extracts it on demand).
        let content = msg.content.expect("content present");
        let arr = content.as_array().expect("content is array");
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["type"], "tool_use");

        // Top-level tool_use MUST stay None — duplicating the entry there
        // re-introduces the stats double-counting bug.
        assert!(
            msg.tool_use.is_none(),
            "top-level msg.tool_use must remain None to avoid stats double-count, got: {:?}",
            msg.tool_use
        );
    }

    /// Regression for `scan_projects` symlink handling. A symlinked `.jsonl`
    /// inside a project directory used to be counted in the sidebar summary
    /// (file count + mtime), leaking metadata about external files. The fix
    /// skips entries whose `symlink_metadata().file_type().is_symlink()` is
    /// true — same guard used by `load_sessions`.
    ///
    /// Calls the real `scan_projects_in` so any future change to the filter
    /// chain is exercised by this test (no hand-rolled walkdir copy here).
    #[cfg(unix)]
    #[test]
    fn scan_projects_skips_symlinked_jsonl() {
        use std::os::unix::fs::symlink;

        // Isolated projects root: `<tmp>/projects/<project>/`.
        // `scan_projects_in` walks the dir we hand it as the projects root,
        // so we point it at `<tmp>/projects` directly.
        let tmp = tempfile::tempdir().expect("tempdir");
        let projects_root = tmp.path().join("projects");
        std::fs::create_dir(&projects_root).expect("create projects root");
        let project_dir = projects_root.join("test-project");
        std::fs::create_dir(&project_dir).expect("create project");

        // One regular .jsonl file
        let real = project_dir.join("real.jsonl");
        std::fs::write(&real, b"{}\n").expect("write real");

        // One .jsonl symlink pointing outside the project root entirely
        let target = tmp.path().join("outside.jsonl");
        std::fs::write(&target, b"{}\n").expect("write target");
        let linked = project_dir.join("linked.jsonl");
        symlink(&target, &linked).expect("create symlink");

        // Drive the real production function with the tempdir root.
        let projects = scan_projects_in(&projects_root).expect("scan ok");
        assert_eq!(projects.len(), 1, "exactly one project should be reported");
        assert_eq!(
            projects[0].session_count, 1,
            "symlinked .jsonl must not be counted; only the regular file should"
        );
    }

    /// `CodeBuddy` emits a `type:"topic"` entry every time the conversation's
    /// running title updates. Earlier revisions kept only the FIRST topic
    /// (because of an `if summary.is_none()` guard), which caused sessions
    /// that started on one topic and pivoted to another to keep showing the
    /// stale original title. Pin the last-wins contract.
    #[test]
    fn extract_session_info_uses_last_topic() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let projects_root = tmp.path().join("projects");
        std::fs::create_dir(&projects_root).expect("create projects root");
        let project_dir = projects_root.join("Users-foo-bar");
        std::fs::create_dir(&project_dir).expect("create project");
        let session_path = project_dir.join("session.jsonl");

        // Two topics + a real message so the session passes the
        // `message_count > 0` gate.
        let lines = [
            json!({"type": "topic", "topic": "Initial Topic", "timestamp": 1_700_000_000_000i64}),
            json!({"type": "message", "role": "user", "sessionId": "s1",
                    "timestamp": 1_700_000_001_000i64,
                    "content": [{"type": "input_text", "text": "hello"}]}),
            json!({"type": "topic", "topic": "Updated Topic", "timestamp": 1_700_000_002_000i64}),
        ];
        let body = join_jsonl(&lines);
        std::fs::write(&session_path, body).expect("write session");

        let session = extract_session_info(&session_path).expect("session parsed");
        assert_eq!(
            session.summary.as_deref(),
            Some("Updated Topic"),
            "later topic must override earlier one"
        );
    }

    /// Defensive: a later `topic` entry whose value is empty/whitespace must
    /// NOT clobber a previously-valid title. Otherwise a single accidental
    /// empty topic write would erase the session label entirely.
    #[test]
    fn extract_session_info_ignores_empty_topic() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let projects_root = tmp.path().join("projects");
        std::fs::create_dir(&projects_root).expect("create projects root");
        let project_dir = projects_root.join("Users-foo-bar");
        std::fs::create_dir(&project_dir).expect("create project");
        let session_path = project_dir.join("session.jsonl");

        let lines = [
            json!({"type": "topic", "topic": "Real Topic", "timestamp": 1_700_000_000_000i64}),
            json!({"type": "message", "role": "user", "sessionId": "s1",
                    "timestamp": 1_700_000_001_000i64,
                    "content": [{"type": "input_text", "text": "hello"}]}),
            json!({"type": "topic", "topic": "   ", "timestamp": 1_700_000_002_000i64}),
        ];
        let body = join_jsonl(&lines);
        std::fs::write(&session_path, body).expect("write session");

        let session = extract_session_info(&session_path).expect("session parsed");
        assert_eq!(
            session.summary.as_deref(),
            Some("Real Topic"),
            "whitespace-only topic must not overwrite the prior valid one"
        );
    }

    /// `scan_projects_in` must derive the display name from each session
    /// file's `cwd` field rather than splitting the lossy directory name on
    /// `-`. Without this, hyphenated project names like
    /// `claude-code-history-viewer` get truncated to just `viewer`.
    #[test]
    fn scan_projects_uses_cwd_for_display_name() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let projects_root = tmp.path().join("projects");
        std::fs::create_dir(&projects_root).expect("create projects root");

        // Mimic CodeBuddy's lossy encoding: '/' -> '-', no escaping.
        let project_dir =
            projects_root.join("Users-rassyan-WebstormProjects-claude-code-history-viewer");
        std::fs::create_dir(&project_dir).expect("create project");

        let session = project_dir.join("s.jsonl");
        let line = json!({
            "type": "message",
            "role": "user",
            "sessionId": "s1",
            "timestamp": 1_700_000_000_000i64,
            "cwd": "/Users/rassyan/WebstormProjects/claude-code-history-viewer",
            "content": [{"type": "input_text", "text": "hi"}],
        });
        std::fs::write(&session, format!("{line}\n")).expect("write");

        let projects = scan_projects_in(&projects_root).expect("scan ok");
        assert_eq!(projects.len(), 1);
        assert_eq!(
            projects[0].name, "claude-code-history-viewer",
            "display name must keep the full hyphenated project leaf"
        );
        assert_eq!(
            projects[0].actual_path, "/Users/rassyan/WebstormProjects/claude-code-history-viewer",
            "actual_path must be the real cwd, not the lossy storage path"
        );
    }

    /// If a project's sessions have no `cwd` (older format, corrupted, etc.)
    /// the resolver must fall back to filesystem-existence-based decoding so
    /// hyphenated leaves still survive. We build a real nested tempdir layout
    /// so the filesystem check has something to recognize.
    ///
    /// Note: we canonicalize the tempdir path because on macOS `/var` is a
    /// symlink to `/private/var`. `decode_with_filesystem_check` uses
    /// `symlink_metadata` and refuses to recurse through symlinks (a
    /// reasonable security stance), so without canonicalization the encoded
    /// path starting with `var-folders-...` would never match the real
    /// `/var -> /private/var` symlink.
    #[test]
    fn scan_projects_falls_back_to_fs_decoding_when_cwd_missing() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let canonical_tmp = std::fs::canonicalize(tmp.path()).expect("canonicalize tempdir");

        let projects_root = canonical_tmp.join("projects");
        std::fs::create_dir(&projects_root).expect("create projects root");

        // Build a real on-disk path `<tmp>/work/hyphenated-leaf` so
        // `decode_with_filesystem_check` can walk and recognize it.
        let real_parent = canonical_tmp.join("work");
        let real_leaf = real_parent.join("hyphenated-leaf");
        std::fs::create_dir_all(&real_leaf).expect("create real layout");

        // Build the matching CodeBuddy-style lossy encoding. We strip the
        // leading `/` and join with `-`, mirroring how CodeBuddy actually
        // names project directories on disk.
        let real_leaf_str = real_leaf.to_string_lossy().to_string();
        let encoded = real_leaf_str.trim_start_matches('/').replace('/', "-");
        let project_dir = projects_root.join(&encoded);
        std::fs::create_dir(&project_dir).expect("create project");

        // Session without any `cwd` field — forces fallback path.
        let session = project_dir.join("s.jsonl");
        let line = json!({
            "type": "message",
            "role": "user",
            "sessionId": "s1",
            "timestamp": 1_700_000_000_000i64,
            "content": [{"type": "input_text", "text": "hi"}],
        });
        std::fs::write(&session, format!("{line}\n")).expect("write");

        let projects = scan_projects_in(&projects_root).expect("scan ok");
        assert_eq!(projects.len(), 1);
        assert_eq!(
            projects[0].name, "hyphenated-leaf",
            "fs-decoding fallback must preserve the hyphenated leaf"
        );
    }
}
