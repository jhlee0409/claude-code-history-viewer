use super::ProviderInfo;
use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession, TokenUsage};
use crate::utils::{is_safe_storage_id, search_json_value_case_insensitive};
use chrono::{DateTime, Utc};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

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

/// Detect `OpenCode` installation
pub fn detect() -> Option<ProviderInfo> {
    let base_path = get_base_path()?;
    let storage_path = Path::new(&base_path).join("storage");

    Some(ProviderInfo {
        id: "opencode".to_string(),
        display_name: "OpenCode".to_string(),
        base_path: base_path.clone(),
        is_available: storage_path.exists() && storage_path.is_dir(),
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
    let home = dirs::home_dir()?;
    let opencode_path = home.join(".local").join("share").join("opencode");
    if opencode_path.exists() {
        Some(opencode_path.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Scan `OpenCode` projects
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let base_path = get_base_path().ok_or_else(|| "OpenCode not found".to_string())?;
    let storage_path = Path::new(&base_path).join("storage");
    let projects_dir = storage_path.join("project");

    if !projects_dir.exists() {
        return Ok(vec![]);
    }

    let mut projects = Vec::new();

    let entries = fs::read_dir(&projects_dir).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
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

        let project_id = val
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        // Real field is "worktree", not "path"
        let project_path = val
            .get("worktree")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        // No "name" field — derive from last segment of "worktree"
        let project_name = Path::new(&project_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        if project_id.is_empty() || !is_safe_storage_id(&project_id) {
            continue;
        }

        // Count sessions
        let sessions_dir = storage_path.join("session").join(&project_id);
        let session_count = if sessions_dir.exists() {
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
        });
    }

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

/// Load sessions for an `OpenCode` project
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let base_path = get_base_path().ok_or_else(|| "OpenCode not found".to_string())?;
    let storage_path = Path::new(&base_path).join("storage");

    let project_id = project_path
        .strip_prefix("opencode://")
        .unwrap_or(project_path);
    if !is_safe_storage_id(project_id) {
        return Err(format!("Invalid OpenCode project path: {project_path}"));
    }

    let sessions_dir = storage_path.join("session").join(project_id);
    if !sessions_dir.exists() {
        return Ok(vec![]);
    }

    let mut sessions = Vec::new();

    for entry in fs::read_dir(&sessions_dir)
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

        let session_id = val
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let title = val.get("title").and_then(|v| v.as_str()).map(String::from);

        // Timestamps are epoch milliseconds under val["time"]["created"] / val["time"]["updated"]
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

        if session_id.is_empty() || !is_safe_storage_id(&session_id) {
            continue;
        }

        // Count messages
        let messages_dir = storage_path.join("message").join(&session_id);
        let message_count = if messages_dir.exists() {
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
            provider: Some("opencode".to_string()),
        });
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

/// Load messages for an `OpenCode` session
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let base_path = get_base_path().ok_or_else(|| "OpenCode not found".to_string())?;
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

    // Read message files
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

        // Extract usage from val["tokens"] with fields "input" and "output"
        let usage = val.get("tokens").map(|t| TokenUsage {
            input_tokens: t.get("input").and_then(Value::as_u64).map(|v| v as u32),
            output_tokens: t.get("output").and_then(Value::as_u64).map(|v| v as u32),
            cache_creation_input_tokens: None,
            cache_read_input_tokens: None,
            service_tier: None,
        });

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

        let (content_value, parts_usage, parts_cost) = process_parts(&part_values);

        // Use message-level usage/cost if present, otherwise fall back to parts-derived
        let final_usage = usage.or(parts_usage);
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
            project_name: None,
            tool_use: None,
            tool_use_result: None,
            is_sidechain: None,
            usage: final_usage,
            role: Some(role.to_string()),
            model,
            stop_reason: None,
            cost_usd: final_cost,
            duration_ms: None,
            message_id: None,
            snapshot: None,
            is_snapshot_update: None,
            data: None,
            tool_use_id: None,
            parent_tool_use_id: None,
            operation: None,
            subtype: None,
            level: None,
            hook_count: None,
            hook_infos: None,
            stop_reason_system: None,
            prevented_continuation: None,
            compact_metadata: None,
            microcompact_metadata: None,
            provider: Some("opencode".to_string()),
        });
    }

    Ok(messages)
}

/// Search `OpenCode` sessions for a query string
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let base_path = get_base_path().ok_or_else(|| "OpenCode not found".to_string())?;
    let storage_path = Path::new(&base_path).join("storage");
    let session_root = storage_path.join("session");

    if !session_root.exists() {
        return Ok(vec![]);
    }

    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

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

            let virtual_path = format!("opencode://{project_id}/{session_id}");

            if let Ok(messages) = load_messages(&virtual_path) {
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
    }

    Ok(results)
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

/// Sum two Option<u32> values, treating None as absent (not zero)
fn sum_opt(a: Option<u32>, b: Option<u32>) -> Option<u32> {
    match (a, b) {
        (Some(x), Some(y)) => Some(x.saturating_add(y)),
        (Some(x), None) | (None, Some(x)) => Some(x),
        (None, None) => None,
    }
}

// is_safe_storage_id is imported from crate::utils

fn process_parts(parts: &[Value]) -> (Option<Value>, Option<TokenUsage>, Option<f64>) {
    let mut content_items: Vec<Value> = Vec::new();
    let mut usage: Option<TokenUsage> = None;
    let mut cost_usd: Option<f64> = None;

    for part in parts {
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
                // Real field is "tokens" with "input", "output", "reasoning",
                // and "cache" object containing "read" and "write"
                if let Some(t) = part.get("tokens") {
                    let cache_obj = t.get("cache");
                    let new_usage = TokenUsage {
                        input_tokens: t.get("input").and_then(Value::as_u64).map(|v| v as u32),
                        output_tokens: t.get("output").and_then(Value::as_u64).map(|v| v as u32),
                        cache_creation_input_tokens: cache_obj
                            .and_then(|c| c.get("write"))
                            .and_then(Value::as_u64)
                            .map(|v| v as u32),
                        cache_read_input_tokens: cache_obj
                            .and_then(|c| c.get("read"))
                            .and_then(Value::as_u64)
                            .map(|v| v as u32),
                        service_tier: None,
                    };
                    // Accumulate tokens across multiple step-finish parts
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
                            service_tier: None,
                        }),
                        None => Some(new_usage),
                    };
                }
                // "cost" is at the top level of step-finish parts
                let part_cost = part.get("cost").and_then(Value::as_f64);
                if let Some(c) = part_cost {
                    cost_usd = Some(cost_usd.unwrap_or(0.0) + c);
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
                // Show file reference
                let filename = part.get("filename").and_then(|v| v.as_str()).unwrap_or("");
                let url = part.get("url").and_then(|v| v.as_str()).unwrap_or("");
                if !filename.is_empty() {
                    content_items.push(serde_json::json!({
                        "type": "text",
                        "text": format!("[File] {filename} ({url})")
                    }));
                }
            }
            // Skip: snapshot, agent, subtask, retry, step-start
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
        "bash" => "Bash",
        "glob" => "Glob",
        "grep" => "Grep",
        "write" => "Write",
        "edit" => "Edit",
        "todowrite" => "TodoWrite",
        "webfetch" => "WebFetch",
        "task" | "call_omo_agent" => "Task",
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
}
