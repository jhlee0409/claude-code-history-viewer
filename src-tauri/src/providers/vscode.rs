//! VS Code Copilot Chat history provider.
//!
//! VS Code stores Copilot Chat conversations per workspace, under
//! `<UserData>/workspaceStorage/<hash>/chatSessions/<sessionUuid>.jsonl`.
//! Each `.jsonl` file is *not* a stream of messages — it's an append-only
//! patch log on top of an initial snapshot:
//!
//! * line 1, `kind: 0`: full session snapshot
//!   (`requests[]`, `sessionId`, `creationDate`, `inputState`, …)
//! * subsequent `kind: 1`: set value at `k: ["a", "b", 2, …]` to `v`
//! * subsequent `kind: 2`: append every item of `v` (an array) to the
//!   array at path `k`
//!
//! We replay the log into an in-memory `serde_json::Value` to recover the
//! final session state, then iterate `requests[]` to emit user/assistant
//! `ClaudeMessage`s. The workspace ↔ folder mapping comes from
//! `workspace.json`'s `folder` URI (same convention Cursor uses), so
//! sessions are grouped per real project directory.

use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession, TokenUsage};
use crate::providers::ProviderInfo;
use crate::utils::{
    build_provider_message, is_symlink, ms_to_iso, search_json_value_case_insensitive,
};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

/// Public provider id stamped on every project/session/message — unified
/// with the Copilot CLI/Desktop providers under "copilot". Per-session
/// disambiguation lives in `entrypoint = "copilot-vscode"`.
const PROVIDER_ID: &str = "copilot";
const ENTRYPOINT: &str = "copilot-vscode";

#[derive(Debug, Clone)]
struct UserDataRoot {
    path: PathBuf,
    label: &'static str,
}

/// Detect a VS Code (stable) installation that has Copilot Chat data.
pub fn detect() -> Option<ProviderInfo> {
    let roots = get_user_data_roots();
    let base = roots.first()?.path.clone();
    let is_available = roots
        .iter()
        .any(|root| root.path.join("workspaceStorage").is_dir());
    Some(ProviderInfo {
        id: PROVIDER_ID.to_string(),
        display_name: "VS Code".to_string(),
        base_path: base.to_string_lossy().to_string(),
        is_available,
    })
}

/// First available `<UserData>` for VS Code-family builds, per OS.
pub fn get_base_path() -> Option<PathBuf> {
    get_user_data_roots()
        .into_iter()
        .next()
        .map(|root| root.path)
}

pub fn get_base_paths() -> Vec<PathBuf> {
    get_user_data_roots()
        .into_iter()
        .map(|root| root.path)
        .collect()
}

fn get_user_data_roots() -> Vec<UserDataRoot> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };

    #[cfg(target_os = "macos")]
    let candidates = [
        ("Code", "VS Code"),
        ("Code - Insiders", "VS Code Insiders"),
        ("VSCodium", "VSCodium"),
    ]
    .into_iter()
    .map(|(dir, label)| UserDataRoot {
        path: home
            .join("Library/Application Support")
            .join(dir)
            .join("User"),
        label,
    })
    .collect::<Vec<_>>();

    #[cfg(target_os = "linux")]
    let candidates = [
        ("Code", "VS Code"),
        ("Code - Insiders", "VS Code Insiders"),
        ("VSCodium", "VSCodium"),
    ]
    .into_iter()
    .map(|(dir, label)| UserDataRoot {
        path: home.join(".config").join(dir).join("User"),
        label,
    })
    .collect::<Vec<_>>();

    #[cfg(target_os = "windows")]
    let candidates = [
        ("Code", "VS Code"),
        ("Code - Insiders", "VS Code Insiders"),
        ("VSCodium", "VSCodium"),
    ]
    .into_iter()
    .map(|(dir, label)| UserDataRoot {
        path: home.join("AppData/Roaming").join(dir).join("User"),
        label,
    })
    .collect::<Vec<_>>();

    candidates
        .into_iter()
        .filter(|candidate| candidate.path.is_dir())
        .collect()
}

fn get_workspace_storage_roots() -> Result<Vec<PathBuf>, String> {
    let roots = get_base_paths()
        .into_iter()
        .map(|base| base.join("workspaceStorage"))
        .collect::<Vec<_>>();
    if roots.is_empty() {
        Err("VS Code user data directory not found".to_string())
    } else {
        Ok(roots)
    }
}

fn is_wsl_unc_path(path: &Path) -> bool {
    let path = path.to_string_lossy();
    path.starts_with(r"\\wsl.localhost\")
        || path.starts_with(r"\\wsl$\")
        || path.starts_with(r"\\?\UNC\wsl.localhost\")
        || path.starts_with(r"\\?\UNC\wsl$\")
}

fn is_within_any_root(canonical: &Path, roots: &[PathBuf]) -> bool {
    for root in roots {
        let root = match root.canonicalize() {
            Ok(root) => root,
            Err(_) => continue,
        };
        if canonical.starts_with(&root) {
            return true;
        }
    }
    false
}

fn is_wsl_workspace_storage_path(path: &Path) -> bool {
    if !is_wsl_unc_path(path) {
        return false;
    }
    let path = path.to_string_lossy().replace('/', "\\");
    [
        r"\.vscode-server\data\User\workspaceStorage\",
        r"\.vscode-server-insiders\data\User\workspaceStorage\",
        r"\.vscodium-server\data\User\workspaceStorage\",
    ]
    .iter()
    .any(|segment| path.contains(segment))
}

fn validate_workspace_path_in(
    raw: &str,
    workspace_storage_roots: &[PathBuf],
) -> Result<PathBuf, String> {
    let ws_path = raw.strip_prefix("vscode://").unwrap_or(raw);
    let path = PathBuf::from(ws_path);
    if !path.is_absolute() {
        return Err("VS Code workspace path must be absolute".to_string());
    }

    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve VS Code workspace path: {e}"))?;

    if !is_within_any_root(&canonical, workspace_storage_roots)
        && !is_wsl_workspace_storage_path(&canonical)
    {
        return Err("VS Code workspace path is outside workspaceStorage".to_string());
    }

    Ok(canonical)
}

fn validate_session_path_in(
    raw: &str,
    workspace_storage_roots: &[PathBuf],
) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err("VS Code session path must be absolute".to_string());
    }
    if path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
        != Some("jsonl")
    {
        return Err("VS Code session path must be a JSONL file".to_string());
    }
    if path
        .parent()
        .and_then(Path::file_name)
        .and_then(|n| n.to_str())
        != Some("chatSessions")
    {
        return Err("VS Code session path must be inside a chatSessions directory".to_string());
    }

    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve VS Code session path: {e}"))?;

    if !is_within_any_root(&canonical, workspace_storage_roots)
        && !is_wsl_workspace_storage_path(&canonical)
    {
        return Err("VS Code session path is outside workspaceStorage".to_string());
    }

    Ok(canonical)
}

fn validate_session_path(session_path: &str) -> Result<PathBuf, String> {
    let roots = get_workspace_storage_roots().unwrap_or_default();
    validate_session_path_in(session_path, &roots)
}

/// One workspace folder → one project.
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let mut projects = Vec::new();
    for root in get_user_data_roots() {
        let label = (root.label != "VS Code").then_some(root.label);
        projects.extend(scan_projects_from_user_data_path(&root.path, label)?);
    }
    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

pub fn scan_projects_from_user_data_path(
    user_data_path: &Path,
    custom_directory_label: Option<&str>,
) -> Result<Vec<ClaudeProject>, String> {
    scan_projects_in(
        &user_data_path.join("workspaceStorage"),
        custom_directory_label,
    )
}

fn scan_projects_in(
    ws_root: &Path,
    custom_directory_label: Option<&str>,
) -> Result<Vec<ClaudeProject>, String> {
    if !ws_root.is_dir() {
        return Ok(Vec::new());
    }

    let mut projects = Vec::new();

    for entry in fs::read_dir(ws_root).map_err(|e| e.to_string())?.flatten() {
        let ws_path = entry.path();
        if is_symlink(&ws_path) || !ws_path.is_dir() {
            continue;
        }

        let folder = match read_workspace_folder(&ws_path.join("workspace.json")) {
            Some(f) => f,
            None => continue,
        };

        let chat_dir = ws_path.join("chatSessions");
        if !chat_dir.is_dir() {
            continue;
        }

        let mut session_count = 0usize;
        let mut last_modified_ms: u64 = 0;
        let mut message_count = 0usize;

        for chat_entry in fs::read_dir(&chat_dir)
            .map_err(|e| e.to_string())?
            .flatten()
        {
            let session_path = chat_entry.path();
            if is_symlink(&session_path) || !session_path.is_file() {
                continue;
            }
            if session_path
                .extension()
                .and_then(|e| e.to_str())
                .map(str::to_ascii_lowercase)
                .as_deref()
                != Some("jsonl")
            {
                continue;
            }

            let info = match probe_session_metadata(&session_path) {
                Some(i) => i,
                None => continue,
            };
            // Empty chat panels (kind:0 with requests:[]) should not be
            // counted as sessions or contribute to the project's tally.
            if info.message_count == 0 {
                continue;
            }
            session_count += 1;
            message_count += info.message_count;
            if info.last_modified_ms > last_modified_ms {
                last_modified_ms = info.last_modified_ms;
            }
        }

        if session_count == 0 {
            continue;
        }

        let name = PathBuf::from(&folder)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| folder.clone());

        projects.push(ClaudeProject {
            name,
            path: format!("vscode://{}", ws_path.to_string_lossy()),
            actual_path: folder,
            session_count,
            message_count,
            last_modified: ms_to_iso(last_modified_ms),
            git_info: None,
            provider: Some(PROVIDER_ID.to_string()),
            storage_type: None,
            custom_directory_label: custom_directory_label.map(ToString::to_string),
        });
    }

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

/// Sessions for a single workspace.
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let roots = get_workspace_storage_roots().unwrap_or_default();
    load_sessions_in(project_path, &roots)
}

fn load_sessions_in(
    project_path: &str,
    workspace_storage_roots: &[PathBuf],
) -> Result<Vec<ClaudeSession>, String> {
    let ws_path_buf = validate_workspace_path_in(project_path, workspace_storage_roots)?;

    let chat_dir = ws_path_buf.join("chatSessions");
    if !chat_dir.is_dir() {
        return Ok(Vec::new());
    }

    let folder = read_workspace_folder(&ws_path_buf.join("workspace.json"));
    let project_name = folder
        .as_deref()
        .and_then(|f| {
            PathBuf::from(f)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| "VS Code".to_string());

    let mut sessions = Vec::new();
    for entry in fs::read_dir(&chat_dir)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        let session_path = entry.path();
        if is_symlink(&session_path) || !session_path.is_file() {
            continue;
        }
        if session_path
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref()
            != Some("jsonl")
        {
            continue;
        }

        let info = match probe_session_metadata(&session_path) {
            Some(i) => i,
            None => continue,
        };

        // Skip empty sessions (e.g., chat panels opened but never used).
        if info.message_count == 0 {
            continue;
        }

        sessions.push(ClaudeSession {
            session_id: session_path.to_string_lossy().to_string(),
            actual_session_id: info.session_id,
            file_path: session_path.to_string_lossy().to_string(),
            project_name: project_name.clone(),
            message_count: info.message_count,
            first_message_time: ms_to_iso(info.first_message_ms),
            last_message_time: ms_to_iso(info.last_modified_ms),
            last_modified: ms_to_iso(info.last_modified_ms),
            has_tool_use: info.has_tool_use,
            has_errors: false,
            summary: info.summary,
            is_renamed: false,
            provider: Some(PROVIDER_ID.to_string()),
            storage_type: None,
            entrypoint: Some(ENTRYPOINT.to_string()),
        });
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

/// Replay the patch log, then convert each request into messages.
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let path = validate_session_path(session_path)?;
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let state = replay_session(&raw)?;
    Ok(messages_from_state(&state))
}

/// Naive case-insensitive search across every chat session.
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let mut results = Vec::new();
    let query_lower = query.to_lowercase();
    for root in get_user_data_roots() {
        search_workspace_storage(
            &root.path.join("workspaceStorage"),
            &query_lower,
            limit,
            &mut results,
        )?;
        if results.len() >= limit {
            break;
        }
    }
    Ok(results)
}

pub fn search_from_user_data_path(
    user_data_path: &Path,
    query: &str,
    limit: usize,
) -> Result<Vec<ClaudeMessage>, String> {
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();
    search_workspace_storage(
        &user_data_path.join("workspaceStorage"),
        &query_lower,
        limit,
        &mut results,
    )?;
    Ok(results)
}

fn search_workspace_storage(
    ws_root: &Path,
    query_lower: &str,
    limit: usize,
    results: &mut Vec<ClaudeMessage>,
) -> Result<(), String> {
    if !ws_root.is_dir() {
        return Ok(());
    }

    for ws_entry in fs::read_dir(ws_root).map_err(|e| e.to_string())?.flatten() {
        let ws_path = ws_entry.path();
        if is_symlink(&ws_path) || !ws_path.is_dir() {
            continue;
        }
        let chat_dir = ws_path.join("chatSessions");
        if !chat_dir.is_dir() {
            continue;
        }

        for entry in fs::read_dir(&chat_dir)
            .map_err(|e| e.to_string())?
            .flatten()
        {
            let session_path = entry.path();
            if is_symlink(&session_path) || !session_path.is_file() {
                continue;
            }
            if session_path
                .extension()
                .and_then(|e| e.to_str())
                .map(str::to_ascii_lowercase)
                .as_deref()
                != Some("jsonl")
            {
                continue;
            }

            if let Ok(messages) = load_messages(&session_path.to_string_lossy()) {
                for msg in messages {
                    if results.len() >= limit {
                        return Ok(());
                    }
                    if let Some(content) = &msg.content {
                        if search_json_value_case_insensitive(content, query_lower) {
                            results.push(msg);
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

// ============================================================================
// Patch log replay
// ============================================================================

/// Resolved final state of a chat session.
fn replay_session(raw: &str) -> Result<Value, String> {
    let mut lines = raw.split('\n').filter(|l| !l.trim().is_empty());

    let first = lines
        .next()
        .ok_or_else(|| "Empty VS Code session file".to_string())?;
    let header: Value =
        serde_json::from_str(first).map_err(|e| format!("Invalid VS Code session header: {e}"))?;
    if header.get("kind").and_then(Value::as_u64) != Some(0) {
        return Err("VS Code session file missing initial snapshot (kind=0)".to_string());
    }
    let mut state = header
        .get("v")
        .cloned()
        .ok_or_else(|| "VS Code session snapshot has no `v` field".to_string())?;

    for line in lines {
        let entry: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            // Tolerate truncated/corrupt trailing lines, like Codex does.
            Err(_) => continue,
        };

        let kind = entry.get("kind").and_then(Value::as_u64).unwrap_or(0);
        let path = entry.get("k").and_then(Value::as_array).cloned();
        let value = entry.get("v").cloned();
        let (path, value) = match (path, value) {
            (Some(p), Some(v)) => (p, v),
            _ => continue,
        };

        match kind {
            1 => {
                let _ = set_at_path(&mut state, &path, value);
            }
            2 => {
                if let Some(items) = value.as_array() {
                    let _ = append_at_path(&mut state, &path, items);
                }
            }
            _ => {}
        }
    }

    Ok(state)
}

/// Upper bound on array indices materialised during patch-log replay. VS Code
/// writes small sequential indices; a wildly out-of-range index indicates a
/// corrupt/truncated session file and must not drive an unbounded `push` loop.
const MAX_REPLAY_ARRAY_INDEX: usize = 1_000_000;

/// Walk to the parent of `path`, then assign `path.last()` to `value`.
fn set_at_path(state: &mut Value, path: &[Value], value: Value) -> Result<(), ()> {
    if path.is_empty() {
        *state = value;
        return Ok(());
    }
    let (last, parents) = path.split_last().expect("path non-empty here");
    let parent = traverse_mut(state, parents)?;
    match (parent, last) {
        (Value::Object(map), Value::String(key)) => {
            map.insert(key.clone(), value);
            Ok(())
        }
        (Value::Array(arr), Value::Number(n)) => {
            let idx = n.as_u64().ok_or(())? as usize;
            if idx > MAX_REPLAY_ARRAY_INDEX {
                return Err(());
            }
            while arr.len() <= idx {
                arr.push(Value::Null);
            }
            arr[idx] = value;
            Ok(())
        }
        _ => Err(()),
    }
}

/// Append every item to the array at `path` (creating arrays/maps as needed).
fn append_at_path(state: &mut Value, path: &[Value], items: &[Value]) -> Result<(), ()> {
    let target = traverse_mut(state, path)?;
    if let Value::Null = target {
        *target = Value::Array(Vec::new());
    }
    let arr = target.as_array_mut().ok_or(())?;
    arr.extend(items.iter().cloned());
    Ok(())
}

/// Walk `path` mutably, materialising missing intermediates.
fn traverse_mut<'a>(mut state: &'a mut Value, path: &[Value]) -> Result<&'a mut Value, ()> {
    for seg in path {
        state = match (state, seg) {
            (Value::Object(map), Value::String(key)) => map
                .entry(key.clone())
                .or_insert(Value::Object(serde_json::Map::default())),
            (Value::Array(arr), Value::Number(n)) => {
                let idx = n.as_u64().ok_or(())? as usize;
                if idx > MAX_REPLAY_ARRAY_INDEX {
                    return Err(());
                }
                while arr.len() <= idx {
                    arr.push(Value::Null);
                }
                &mut arr[idx]
            }
            _ => return Err(()),
        };
    }
    Ok(state)
}

// ============================================================================
// State → ClaudeMessage[]
// ============================================================================

fn messages_from_state(state: &Value) -> Vec<ClaudeMessage> {
    let session_id = state
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let creation_ms = state
        .get("creationDate")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let base_timestamp = ms_to_iso(creation_ms);

    let requests = match state.get("requests").and_then(Value::as_array) {
        Some(r) => r,
        None => return Vec::new(),
    };

    let mut messages = Vec::with_capacity(requests.len() * 2);
    let mut counter: u64 = 0;

    for (idx, req) in requests.iter().enumerate() {
        let req_ts = req
            .get("timestamp")
            .and_then(Value::as_u64)
            .map(ms_to_iso)
            .unwrap_or_else(|| base_timestamp.clone());

        if let Some(text) = extract_user_text(req) {
            counter += 1;
            let uuid = req
                .get("requestId")
                .and_then(Value::as_str)
                .map(String::from)
                .unwrap_or_else(|| format!("vscode-req-{idx}-{counter}"));
            let content = serde_json::json!([{ "type": "text", "text": text }]);
            messages.push(build_provider_message(
                PROVIDER_ID,
                uuid,
                &session_id,
                req_ts.clone(),
                "user",
                Some("user"),
                Some(content),
                None,
            ));
        }

        if let Some(assistant) =
            build_assistant_message(req, idx, &session_id, &req_ts, &mut counter)
        {
            messages.push(assistant);
        }
    }

    messages
}

fn extract_user_text(req: &Value) -> Option<String> {
    let msg = req.get("message")?;
    if let Some(text) = msg.get("text").and_then(Value::as_str) {
        if !text.is_empty() {
            return Some(text.to_string());
        }
    }
    // Fallback: stitch together text parts.
    let parts = msg.get("parts").and_then(Value::as_array)?;
    let joined = parts
        .iter()
        .filter_map(|p| {
            let kind = p.get("kind").and_then(Value::as_str).unwrap_or("");
            if kind == "text" {
                p.get("text").and_then(Value::as_str).map(str::to_string)
            } else {
                None
            }
        })
        .collect::<String>();
    if joined.is_empty() {
        None
    } else {
        Some(joined)
    }
}

fn build_assistant_message(
    req: &Value,
    idx: usize,
    session_id: &str,
    timestamp: &str,
    counter: &mut u64,
) -> Option<ClaudeMessage> {
    let response = req.get("response").and_then(Value::as_array)?;
    let mut blocks: Vec<Value> = Vec::new();
    let mut tool_use_block: Option<Value> = None;

    for part in response {
        let kind = part.get("kind").and_then(Value::as_str);
        match kind {
            None => {
                // Plain markdown content: just a {value, …} object.
                if let Some(text) = part.get("value").and_then(Value::as_str) {
                    if !text.is_empty() {
                        blocks.push(serde_json::json!({ "type": "text", "text": text }));
                    }
                }
            }
            Some("thinking") => {
                let text = part.get("value").and_then(Value::as_str).unwrap_or("");
                // Skip empty/encrypted-only thinking blobs; render visible text only.
                if !text.is_empty() {
                    blocks.push(serde_json::json!({
                        "type": "thinking",
                        "thinking": text,
                    }));
                }
            }
            Some("toolInvocationSerialized") => {
                let tool_id = part
                    .get("toolId")
                    .and_then(Value::as_str)
                    .unwrap_or("tool")
                    .to_string();
                let call_id = part
                    .get("toolCallId")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .map(String::from)
                    .unwrap_or_else(|| {
                        *counter += 1;
                        format!("vscode-tool-{idx}-{counter}")
                    });
                let invocation_text = part
                    .get("invocationMessage")
                    .and_then(|m| m.get("value"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let past_text = part
                    .get("pastTenseMessage")
                    .and_then(|m| m.get("value"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let is_complete = part
                    .get("isComplete")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);

                let mut input = serde_json::Map::new();
                if !invocation_text.is_empty() {
                    input.insert(
                        "message".to_string(),
                        Value::String(invocation_text.to_string()),
                    );
                }
                let tool_use = serde_json::json!({
                    "type": "tool_use",
                    "id": call_id,
                    "name": tool_id,
                    "input": Value::Object(input),
                });
                if tool_use_block.is_none() {
                    tool_use_block = Some(tool_use.clone());
                }
                blocks.push(tool_use);

                if is_complete && !past_text.is_empty() {
                    blocks.push(serde_json::json!({
                        "type": "tool_result",
                        "tool_use_id": call_id,
                        "content": past_text,
                    }));
                }
            }
            Some("progressTaskSerialized") => {
                if let Some(text) = part
                    .get("content")
                    .and_then(|c| c.get("value"))
                    .and_then(Value::as_str)
                {
                    if !text.is_empty() {
                        blocks.push(serde_json::json!({ "type": "text", "text": text }));
                    }
                }
            }
            // Unknown / non-renderable kinds (including "inlineReference" and
            // "mcpServersStarting") are intentionally skipped.
            Some(_) => {}
        }
    }

    if blocks.is_empty() {
        return None;
    }

    *counter += 1;
    let uuid = req
        .get("responseId")
        .and_then(Value::as_str)
        .map(String::from)
        .unwrap_or_else(|| format!("vscode-resp-{idx}-{counter}"));

    let model = req.get("modelId").and_then(Value::as_str).map(String::from);
    let usage = req
        .get("completionTokens")
        .and_then(Value::as_u64)
        .map(|out| TokenUsage {
            input_tokens: None,
            output_tokens: Some(out as u32),
            cache_creation_input_tokens: None,
            cache_read_input_tokens: None,
            service_tier: None,
        });
    let duration_ms = req.get("elapsedMs").and_then(Value::as_u64);

    let mut msg = build_provider_message(
        PROVIDER_ID,
        uuid,
        session_id,
        timestamp.to_string(),
        "assistant",
        Some("assistant"),
        Some(Value::Array(blocks)),
        model,
    );
    msg.tool_use = tool_use_block;
    msg.usage = usage;
    msg.duration_ms = duration_ms;
    Some(msg)
}

// ============================================================================
// Helpers shared with cursor.rs (kept private to avoid a cross-cutting refactor)
// ============================================================================

fn read_workspace_folder(workspace_json_path: &Path) -> Option<String> {
    let data = fs::read_to_string(workspace_json_path).ok()?;
    let json: Value = serde_json::from_str(&data).ok()?;
    let folder = json.get("folder").and_then(Value::as_str)?;
    folder.strip_prefix("file://").map(|s| {
        let path = if s.len() > 2 && s.as_bytes()[2] == b':' {
            // Windows drive letter (file:///C:/…)
            &s[1..]
        } else {
            s
        };
        percent_decode(path)
    })
}

fn percent_decode(input: &str) -> String {
    let mut buf = Vec::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&input[i + 1..i + 3], 16) {
                buf.push(byte);
                i += 3;
                continue;
            }
        }
        buf.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(buf).unwrap_or_else(|_| input.to_string())
}

struct SessionMetadata {
    session_id: String,
    message_count: usize,
    first_message_ms: u64,
    last_modified_ms: u64,
    has_tool_use: bool,
    summary: Option<String>,
}

/// Cheap metadata probe — replays the patch log and walks the final state once.
fn probe_session_metadata(session_path: &Path) -> Option<SessionMetadata> {
    let raw = fs::read_to_string(session_path).ok()?;
    let state = replay_session(&raw).ok()?;

    let session_id = state
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let creation_ms = state
        .get("creationDate")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let last_message_ms = state
        .get("lastMessageDate")
        .and_then(Value::as_u64)
        .unwrap_or(creation_ms);

    let mut message_count = 0usize;
    let mut has_tool_use = false;
    let mut summary: Option<String> = None;

    if let Some(requests) = state.get("requests").and_then(Value::as_array) {
        for req in requests {
            if let Some(text) = extract_user_text(req) {
                message_count += 1;
                if summary.is_none() && !text.is_empty() {
                    summary = Some(truncate_preview(&text, 200));
                }
            }
            if let Some(response) = req.get("response").and_then(Value::as_array) {
                let any_visible = response.iter().any(|part| {
                    let kind = part.get("kind").and_then(Value::as_str);
                    match kind {
                        None => part
                            .get("value")
                            .and_then(Value::as_str)
                            .map(|s| !s.is_empty())
                            .unwrap_or(false),
                        Some("thinking") => part
                            .get("value")
                            .and_then(Value::as_str)
                            .map(|s| !s.is_empty())
                            .unwrap_or(false),
                        Some("toolInvocationSerialized") => {
                            has_tool_use = true;
                            true
                        }
                        Some("progressTaskSerialized") => part
                            .get("content")
                            .and_then(|c| c.get("value"))
                            .and_then(Value::as_str)
                            .map(|s| !s.is_empty())
                            .unwrap_or(false),
                        _ => false,
                    }
                });
                if any_visible {
                    message_count += 1;
                }
            }
        }
    }

    Some(SessionMetadata {
        session_id,
        message_count,
        first_message_ms: creation_ms,
        last_modified_ms: last_message_ms.max(creation_ms),
        has_tool_use,
        summary,
    })
}

fn truncate_preview(text: &str, max_chars: usize) -> String {
    match text.char_indices().nth(max_chars) {
        Some((idx, _)) => format!("{}...", &text[..idx]),
        None => text.to_string(),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn build_log(initial: Value, patches: &[Value]) -> String {
        let mut lines = vec![json!({"kind": 0, "v": initial}).to_string()];
        for p in patches {
            lines.push(p.to_string());
        }
        lines.join("\n")
    }

    #[test]
    fn replay_applies_set_patches() {
        let log = build_log(
            json!({"sessionId": "abc", "requests": [], "creationDate": 1000}),
            &[
                json!({"kind": 1, "k": ["customTitle"], "v": "Hello"}),
                json!({"kind": 1, "k": ["creationDate"], "v": 2000}),
            ],
        );
        let state = replay_session(&log).unwrap();
        assert_eq!(state["customTitle"], "Hello");
        assert_eq!(state["creationDate"], 2000);
    }

    #[test]
    fn replay_applies_array_appends() {
        let log = build_log(
            json!({"sessionId": "abc", "requests": []}),
            &[
                json!({
                    "kind": 2,
                    "k": ["requests"],
                    "v": [{
                        "message": {"text": "hi"},
                        "response": [{"value": "hello"}],
                        "requestId": "r1",
                        "modelId": "copilot/gpt-5",
                        "timestamp": 5000
                    }]
                }),
                json!({
                    "kind": 2,
                    "k": ["requests", 0, "response"],
                    "v": [{"kind": "thinking", "value": "thoughts"}]
                }),
                json!({
                    "kind": 1,
                    "k": ["requests", 0, "completionTokens"],
                    "v": 17
                }),
            ],
        );
        let state = replay_session(&log).unwrap();
        let req = &state["requests"][0];
        assert_eq!(req["message"]["text"], "hi");
        assert_eq!(req["response"].as_array().unwrap().len(), 2);
        assert_eq!(req["completionTokens"], 17);
    }

    #[test]
    fn replay_skips_corrupt_trailing_line() {
        let log = format!(
            "{}\n{}\n{}",
            json!({"kind": 0, "v": {"sessionId": "abc", "requests": [], "creationDate": 1}}),
            json!({"kind": 1, "k": ["customTitle"], "v": "Hello"}),
            "garbage line"
        );
        let state = replay_session(&log).unwrap();
        assert_eq!(state["customTitle"], "Hello");
    }

    #[test]
    fn messages_render_user_assistant_pair() {
        let state = json!({
            "sessionId": "sess-1",
            "creationDate": 1700000000000u64,
            "requests": [{
                "requestId": "req-1",
                "responseId": "resp-1",
                "modelId": "copilot/auto",
                "completionTokens": 42,
                "elapsedMs": 1200,
                "timestamp": 1700000005000u64,
                "message": {"text": "What is foo?"},
                "response": [
                    {"value": "Foo is bar."},
                    {"kind": "thinking", "value": "reasoning…"},
                    {"kind": "toolInvocationSerialized",
                        "toolId": "copilot_readFile",
                        "toolCallId": "tc-1",
                        "isComplete": true,
                        "invocationMessage": {"value": "Reading foo.txt"},
                        "pastTenseMessage": {"value": "Read foo.txt"}
                    }
                ]
            }]
        });
        let msgs = messages_from_state(&state);
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].message_type, "user");
        assert_eq!(msgs[0].provider.as_deref(), Some("copilot"));
        let user_blocks = msgs[0].content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(user_blocks[0]["text"], "What is foo?");

        assert_eq!(msgs[1].message_type, "assistant");
        assert_eq!(msgs[1].model.as_deref(), Some("copilot/auto"));
        assert_eq!(
            msgs[1].usage.as_ref().and_then(|u| u.output_tokens),
            Some(42)
        );
        assert_eq!(msgs[1].duration_ms, Some(1200));
        let kinds: Vec<&str> = msgs[1]
            .content
            .as_ref()
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b["type"].as_str().unwrap_or(""))
            .collect();
        assert_eq!(kinds, vec!["text", "thinking", "tool_use", "tool_result"]);
        let blocks = msgs[1].content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(blocks[2]["id"], "tc-1");
        assert_eq!(blocks[3]["tool_use_id"], "tc-1");
        assert!(msgs[1].tool_use.is_some());
    }

    #[test]
    fn messages_pair_generated_tool_call_ids() {
        let state = json!({
            "sessionId": "sess-1",
            "creationDate": 1700000000000u64,
            "requests": [{
                "requestId": "req-1",
                "responseId": "resp-1",
                "message": {"text": "Read the file"},
                "response": [{
                    "kind": "toolInvocationSerialized",
                    "toolId": "copilot_readFile",
                    "isComplete": true,
                    "invocationMessage": {"value": "Reading foo.txt"},
                    "pastTenseMessage": {"value": "Read foo.txt"}
                }]
            }]
        });

        let msgs = messages_from_state(&state);
        let blocks = msgs[1].content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(blocks[0]["type"], "tool_use");
        assert_eq!(blocks[1]["type"], "tool_result");
        assert_eq!(blocks[0]["id"], blocks[1]["tool_use_id"]);
        assert_eq!(blocks[0]["id"], "vscode-tool-0-2");
    }

    #[test]
    fn probe_counts_progress_task_responses_as_visible() {
        let tmp = tempfile::TempDir::new().unwrap();
        let session_path = tmp.path().join("progress.jsonl");
        fs::write(
            &session_path,
            json!({"kind": 0, "v": {
                "sessionId": "progress-1111-1111-1111-111111111111",
                "creationDate": 1779490058917u64,
                "requests": [{
                    "response": [{
                        "kind": "progressTaskSerialized",
                        "content": {"value": "Working..."}
                    }]
                }]
            }})
            .to_string(),
        )
        .unwrap();

        let metadata = probe_session_metadata(&session_path).unwrap();
        assert_eq!(metadata.message_count, 1);
    }

    #[test]
    fn read_workspace_folder_decodes_uri() {
        let tmp = tempfile::TempDir::new().unwrap();
        let ws_json = tmp.path().join("workspace.json");
        fs::write(&ws_json, r#"{"folder":"file:///Users/me/my%20project"}"#).unwrap();
        assert_eq!(
            read_workspace_folder(&ws_json).as_deref(),
            Some("/Users/me/my project")
        );
    }

    #[test]
    fn header_without_kind_zero_errors() {
        let log = json!({"kind": 1, "k": ["x"], "v": 1}).to_string();
        assert!(replay_session(&log).is_err());
    }

    #[test]
    fn load_sessions_skips_empty_chat_panels() {
        let tmp = tempfile::TempDir::new().unwrap();
        let chat_dir = tmp.path().join("chatSessions");
        fs::create_dir_all(&chat_dir).unwrap();
        fs::write(
            tmp.path().join("workspace.json"),
            r#"{"folder":"file:///Users/me/repo"}"#,
        )
        .unwrap();

        // Empty panel: only kind:0 header with requests:[]
        fs::write(
            chat_dir.join("empty-1111-1111-1111-111111111111.jsonl"),
            json!({"kind": 0, "v": {
                "sessionId": "empty-1111-1111-1111-111111111111",
                "creationDate": 1779490058917u64,
                "requests": []
            }})
            .to_string(),
        )
        .unwrap();

        // Used session with at least one user request.
        let header = json!({"kind": 0, "v": {
            "sessionId": "used-2222-2222-2222-222222222222",
            "creationDate": 1779490058917u64,
            "requests": [{
                "message": {"text": "hello"},
                "response": []
            }]
        }})
        .to_string();
        fs::write(
            chat_dir.join("used-2222-2222-2222-222222222222.jsonl"),
            header,
        )
        .unwrap();

        let roots = vec![tmp.path().to_path_buf()];
        let sessions = load_sessions_in(&tmp.path().to_string_lossy(), &roots).unwrap();
        let ids: Vec<&str> = sessions
            .iter()
            .map(|s| s.actual_session_id.as_str())
            .collect();
        assert!(
            ids.iter().any(|id| id.starts_with("used-")),
            "non-empty session must surface: {ids:?}",
        );
        assert!(
            !ids.iter().any(|id| id.starts_with("empty-")),
            "empty chat panel must be skipped: {ids:?}",
        );
    }

    #[test]
    fn scan_projects_excludes_workspaces_with_only_empty_panels() {
        let ws_root = tempfile::TempDir::new().unwrap();

        // Workspace 1: only empty chat panels.
        let ws1 = ws_root.path().join("hash-empty");
        let chat1 = ws1.join("chatSessions");
        fs::create_dir_all(&chat1).unwrap();
        fs::write(
            ws1.join("workspace.json"),
            r#"{"folder":"file:///Users/me/empty-repo"}"#,
        )
        .unwrap();
        fs::write(
            chat1.join("empty-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl"),
            json!({"kind": 0, "v": {
                "sessionId": "empty-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                "creationDate": 1779490058917u64,
                "requests": []
            }})
            .to_string(),
        )
        .unwrap();

        // Workspace 2: one empty panel + one used session.
        let ws2 = ws_root.path().join("hash-used");
        let chat2 = ws2.join("chatSessions");
        fs::create_dir_all(&chat2).unwrap();
        fs::write(
            ws2.join("workspace.json"),
            r#"{"folder":"file:///Users/me/used-repo"}"#,
        )
        .unwrap();
        fs::write(
            chat2.join("empty-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jsonl"),
            json!({"kind": 0, "v": {
                "sessionId": "empty-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                "creationDate": 1779490058917u64,
                "requests": []
            }})
            .to_string(),
        )
        .unwrap();
        fs::write(
            chat2.join("used-cccc-cccc-cccc-cccccccccccc.jsonl"),
            json!({"kind": 0, "v": {
                "sessionId": "used-cccc-cccc-cccc-cccccccccccc",
                "creationDate": 1779490058917u64,
                "requests": [{
                    "message": {"text": "hello"},
                    "response": []
                }]
            }})
            .to_string(),
        )
        .unwrap();

        let projects = scan_projects_in(ws_root.path(), None).unwrap();
        let names: Vec<&str> = projects.iter().map(|p| p.name.as_str()).collect();
        assert!(
            !names.contains(&"empty-repo"),
            "workspace with only empty panels must be skipped: {names:?}",
        );
        let used = projects
            .iter()
            .find(|p| p.name == "used-repo")
            .expect("used-repo project must be present");
        assert_eq!(
            used.session_count, 1,
            "session count must exclude the empty panel",
        );
    }

    #[test]
    fn path_validation_rejects_paths_outside_workspace_storage() {
        let ws_root = tempfile::TempDir::new().unwrap();
        let workspace = ws_root.path().join("hash-used");
        let chat_dir = workspace.join("chatSessions");
        fs::create_dir_all(&chat_dir).unwrap();
        let session_path = chat_dir.join("session-1111-1111-1111-111111111111.jsonl");
        fs::write(
            &session_path,
            json!({"kind": 0, "v": {"sessionId": "session-1111-1111-1111-111111111111", "requests": []}})
                .to_string(),
        )
        .unwrap();

        let outside = tempfile::TempDir::new().unwrap();
        let outside_workspace = outside.path().join("workspace");
        let outside_chat_dir = outside_workspace.join("chatSessions");
        fs::create_dir_all(&outside_chat_dir).unwrap();
        let outside_session = outside_chat_dir.join("outside-1111-1111-1111-111111111111.jsonl");
        fs::write(&outside_session, "{}").unwrap();

        let roots = vec![ws_root.path().to_path_buf()];
        assert!(validate_workspace_path_in(&workspace.to_string_lossy(), &roots).is_ok());
        assert!(validate_session_path_in(&session_path.to_string_lossy(), &roots).is_ok());
        assert!(validate_workspace_path_in(&outside_workspace.to_string_lossy(), &roots).is_err());
        assert!(validate_session_path_in(&outside_session.to_string_lossy(), &roots).is_err());
    }
}
