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
    if !is_chat_session_file(&path) {
        return Err("VS Code session path must be a .json or .jsonl file".to_string());
    }
    if is_symlink(&path) {
        return Err("VS Code session path must not be a symlink".to_string());
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

/// Chat sessions come in two formats: VS Code < 1.109 wrote one full-JSON
/// document per session (`<uuid>.json`); v1.109+ writes an append-only patch
/// log (`<uuid>.jsonl`). Old files are never migrated, so both must be read
/// (issue #444).
fn session_file_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
}

fn is_chat_session_file(path: &Path) -> bool {
    matches!(
        session_file_extension(path).as_deref(),
        Some("json" | "jsonl")
    )
}

/// When both `<uuid>.json` and `<uuid>.jsonl` exist for one session, VS Code
/// itself reads the `.jsonl` — mirror that priority so the session doesn't
/// appear twice.
fn dedup_prefer_jsonl(mut paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let jsonl_stems: std::collections::HashSet<std::ffi::OsString> = paths
        .iter()
        .filter(|p| session_file_extension(p).as_deref() == Some("jsonl"))
        .filter_map(|p| p.file_stem().map(std::ffi::OsStr::to_os_string))
        .collect();
    paths.retain(|p| {
        session_file_extension(p).as_deref() != Some("json")
            || !p
                .file_stem()
                .map(|stem| jsonl_stems.contains(stem))
                .unwrap_or(false)
    });
    paths
}

/// Collect the chat-session files of one `chatSessions` dir (both formats,
/// deduped), skipping symlinks and non-files. A symlinked `chatSessions`
/// directory itself is refused — following it would let a crafted workspace
/// read files outside workspaceStorage as sessions.
fn chat_session_files(chat_dir: &Path) -> Result<Vec<PathBuf>, String> {
    if is_symlink(chat_dir) {
        return Ok(Vec::new());
    }
    let mut paths: Vec<PathBuf> = fs::read_dir(chat_dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|entry| entry.path())
        .filter(|p| !is_symlink(p) && p.is_file() && is_chat_session_file(p))
        .collect();
    paths.sort();
    Ok(dedup_prefer_jsonl(paths))
}

/// Resolved final state of a chat session file, whichever format it uses.
fn read_session_state(path: &Path) -> Result<Value, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    if session_file_extension(path).as_deref() == Some("json") {
        // Legacy format: the document IS the final state (same shape as the
        // patch log's kind:0 snapshot `v`).
        return serde_json::from_str(&raw).map_err(|e| format!("Invalid VS Code session: {e}"));
    }
    replay_session(&raw)
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

    let ws_paths: Vec<PathBuf> = fs::read_dir(ws_root)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|entry| entry.path())
        .collect();

    // Probing every chatSessions/*.jsonl per workspace is I/O-heavy, so the
    // per-workspace work runs on a bounded pool. Order-preserving, and the
    // sequential loop's error semantics are kept: an unreadable chatSessions
    // dir still fails the scan (first error in input order), while workspaces
    // without usable sessions are skipped.
    let results = crate::utils::par_map_bounded(ws_paths, |ws_path| {
        scan_workspace(&ws_path, custom_directory_label)
    });

    let mut projects = Vec::new();
    for result in results {
        if let Some(project) = result? {
            projects.push(project);
        }
    }

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

/// One workspace dir → one project (`Ok(None)` = no usable chat sessions,
/// `Err` = the chatSessions dir exists but cannot be read).
fn scan_workspace(
    ws_path: &Path,
    custom_directory_label: Option<&str>,
) -> Result<Option<ClaudeProject>, String> {
    if is_symlink(ws_path) || !ws_path.is_dir() {
        return Ok(None);
    }

    let Some(folder) = read_workspace_folder(&ws_path.join("workspace.json")) else {
        return Ok(None);
    };

    let chat_dir = ws_path.join("chatSessions");
    if !chat_dir.is_dir() {
        return Ok(None);
    }

    let mut session_count = 0usize;
    let mut last_modified_ms: u64 = 0;
    let mut message_count = 0usize;

    for session_path in chat_session_files(&chat_dir)? {
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
        return Ok(None);
    }

    let name = PathBuf::from(&folder)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| folder.clone());

    Ok(Some(ClaudeProject {
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
    }))
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
    for session_path in chat_session_files(&chat_dir)? {
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

/// Resolve the session state (patch-log replay or legacy full-JSON), then
/// convert each request into messages.
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let path = validate_session_path(session_path)?;
    let state = read_session_state(&path)?;
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

        for session_path in chat_session_files(&chat_dir)? {
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
        let Some(path) = entry.get("k").and_then(Value::as_array).cloned() else {
            continue;
        };

        match kind {
            1 => {
                if let Some(value) = entry.get("v").cloned() {
                    let _ = set_at_path(&mut state, &path, value);
                }
            }
            2 => {
                if let Some(items) = entry.get("v").and_then(Value::as_array) {
                    let _ = append_at_path(&mut state, &path, items);
                }
            }
            // kind 3: delete the value at `k` (carries no `v`).
            3 => {
                let _ = delete_at_path(&mut state, &path);
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

/// Remove the value at `path` (object key removal / array element removal).
fn delete_at_path(state: &mut Value, path: &[Value]) -> Result<(), ()> {
    let (last, parents) = path.split_last().ok_or(())?;
    let parent = traverse_mut(state, parents)?;
    match (parent, last) {
        (Value::Object(map), Value::String(key)) => {
            map.remove(key);
            Ok(())
        }
        (Value::Array(arr), Value::Number(n)) => {
            let idx = n.as_u64().ok_or(())? as usize;
            if idx < arr.len() {
                arr.remove(idx);
            }
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
    // Single-folder windows store `folder`; multi-root windows store
    // `workspace` (the `.code-workspace` file URI) instead — without the
    // fallback those workspaces were skipped entirely (issue #444).
    let folder = json
        .get("folder")
        .and_then(Value::as_str)
        .or_else(|| json.get("workspace").and_then(Value::as_str))?;
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
    let state = read_session_state(session_path).ok()?;

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

    /// Legacy (< VS Code 1.109) sessions are single full-JSON documents, never
    /// migrated to the newer patch-log format — they must still surface (#444).
    #[test]
    fn legacy_json_sessions_are_discovered_and_loaded() {
        let ws_root = tempfile::TempDir::new().unwrap();
        let ws = ws_root.path().join("hash-legacy");
        let chat = ws.join("chatSessions");
        fs::create_dir_all(&chat).unwrap();
        fs::write(
            ws.join("workspace.json"),
            r#"{"folder":"file:///Users/me/legacy-repo"}"#,
        )
        .unwrap();
        let session_path = chat.join("legacy-1111-1111-1111-111111111111.json");
        fs::write(
            &session_path,
            json!({
                "version": 3,
                "sessionId": "legacy-1111-1111-1111-111111111111",
                "creationDate": 1751700000000u64,
                "lastMessageDate": 1751700005000u64,
                "requests": [{
                    "requestId": "req-1",
                    "timestamp": 1751700005000u64,
                    "message": {"text": "hello from 2025"},
                    "response": [{"value": "hi!"}]
                }]
            })
            .to_string(),
        )
        .unwrap();

        let projects = scan_projects_in(ws_root.path(), None).unwrap();
        assert_eq!(projects.len(), 1, "legacy .json workspace must surface");
        assert_eq!(projects[0].name, "legacy-repo");
        assert_eq!(projects[0].session_count, 1);

        let roots = vec![ws_root.path().to_path_buf()];
        let sessions = load_sessions_in(&ws.to_string_lossy(), &roots).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(
            sessions[0].actual_session_id,
            "legacy-1111-1111-1111-111111111111"
        );

        assert!(validate_session_path_in(&session_path.to_string_lossy(), &roots).is_ok());
        let state = read_session_state(&session_path).unwrap();
        let msgs = messages_from_state(&state);
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].message_type, "user");
        assert_eq!(msgs[1].message_type, "assistant");
    }

    /// When the same session id exists in both formats, VS Code reads the
    /// `.jsonl` — mirror that priority so the session doesn't list twice.
    #[test]
    fn same_stem_json_and_jsonl_dedups_to_jsonl() {
        let ws_root = tempfile::TempDir::new().unwrap();
        let ws = ws_root.path().join("hash-dual");
        let chat = ws.join("chatSessions");
        fs::create_dir_all(&chat).unwrap();
        fs::write(
            ws.join("workspace.json"),
            r#"{"folder":"file:///Users/me/dual-repo"}"#,
        )
        .unwrap();
        let stem = "dual-1111-1111-1111-111111111111";
        fs::write(
            chat.join(format!("{stem}.json")),
            json!({
                "sessionId": stem,
                "creationDate": 1u64,
                "requests": [{"message": {"text": "OLD json copy"}, "response": []}]
            })
            .to_string(),
        )
        .unwrap();
        fs::write(
            chat.join(format!("{stem}.jsonl")),
            json!({"kind": 0, "v": {
                "sessionId": stem,
                "creationDate": 2u64,
                "requests": [
                    {"message": {"text": "new jsonl copy"}, "response": []},
                    {"message": {"text": "second"}, "response": []}
                ]
            }})
            .to_string(),
        )
        .unwrap();

        let roots = vec![ws_root.path().to_path_buf()];
        let sessions = load_sessions_in(&ws.to_string_lossy(), &roots).unwrap();
        assert_eq!(sessions.len(), 1, "dual-format session must list once");
        assert_eq!(
            sessions[0].message_count, 2,
            "the .jsonl copy must win over the legacy .json copy"
        );
    }

    /// Multi-root windows record a `workspace` (.code-workspace URI) instead
    /// of `folder` — those workspaces were previously skipped entirely.
    #[test]
    fn multi_root_workspace_key_is_mapped() {
        let ws_root = tempfile::TempDir::new().unwrap();
        let ws = ws_root.path().join("hash-multiroot");
        let chat = ws.join("chatSessions");
        fs::create_dir_all(&chat).unwrap();
        fs::write(
            ws.join("workspace.json"),
            r#"{"workspace":"file:///Users/me/monorepo/all.code-workspace"}"#,
        )
        .unwrap();
        fs::write(
            chat.join("mr-1111-1111-1111-111111111111.jsonl"),
            json!({"kind": 0, "v": {
                "sessionId": "mr-1111-1111-1111-111111111111",
                "creationDate": 1u64,
                "requests": [{"message": {"text": "hello"}, "response": []}]
            }})
            .to_string(),
        )
        .unwrap();

        let projects = scan_projects_in(ws_root.path(), None).unwrap();
        assert_eq!(projects.len(), 1, "multi-root workspace must surface");
        assert_eq!(
            projects[0].actual_path,
            "/Users/me/monorepo/all.code-workspace"
        );
    }

    #[test]
    fn replay_applies_delete_patches() {
        let log = build_log(
            json!({"sessionId": "abc", "customTitle": "temp", "requests": [
                {"message": {"text": "a"}, "response": []},
                {"message": {"text": "b"}, "response": []}
            ]}),
            &[
                json!({"kind": 3, "k": ["customTitle"]}),
                json!({"kind": 3, "k": ["requests", 0]}),
            ],
        );
        let state = replay_session(&log).unwrap();
        assert!(state.get("customTitle").is_none());
        let requests = state["requests"].as_array().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0]["message"]["text"], "b");
    }
}
