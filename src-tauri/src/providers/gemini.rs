use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession, TokenUsage};
use crate::providers::ProviderInfo;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

/// Detect Gemini CLI installation
pub fn detect() -> Option<ProviderInfo> {
    let base = get_base_path()?;
    let tmp_dir = PathBuf::from(&base).join("tmp");
    let is_available = tmp_dir.is_dir();
    Some(ProviderInfo {
        id: "gemini".to_string(),
        display_name: "Gemini CLI".to_string(),
        base_path: base,
        is_available,
    })
}

/// Get the base path for Gemini CLI data (~/.gemini)
pub fn get_base_path() -> Option<String> {
    if let Ok(val) = std::env::var("GEMINI_HOME") {
        let p = PathBuf::from(&val);
        if p.is_dir() {
            return Some(val);
        }
    }
    dirs::home_dir().map(|h| h.join(".gemini").to_string_lossy().to_string())
}

/// Scan for all Gemini CLI projects
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let base = get_base_path().ok_or("Could not determine Gemini base path")?;
    let tmp_dir = PathBuf::from(&base).join("tmp");

    if !tmp_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut projects = Vec::new();

    for entry in fs::read_dir(&tmp_dir).map_err(|e| format!("Failed to read tmp dir: {e}"))? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;

        // W-2: skip symlinks
        if entry.file_type().map(|ft| ft.is_symlink()).unwrap_or(false) {
            continue;
        }

        let project_dir = entry.path();
        if !project_dir.is_dir() {
            continue;
        }

        let chats_dir = project_dir.join("chats");
        if !chats_dir.is_dir() {
            continue;
        }

        // I-2: require .project_root or chats/ to confirm this is a real project
        let project_name = project_dir
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let actual_path = read_project_root(&project_dir).unwrap_or_else(|| project_name.clone());

        // C-1: lightweight metadata extraction — only read file metadata + small header
        let mut session_count = 0usize;
        let mut message_count = 0usize;
        let mut last_modified = String::new();

        if let Ok(entries) = fs::read_dir(&chats_dir) {
            for chat_entry in entries.flatten() {
                let path = chat_entry.path();
                if !is_session_file(&chat_entry) {
                    continue;
                }
                if let Some(meta) = extract_session_metadata(&path) {
                    if meta.kind == "subagent" {
                        continue;
                    }
                    session_count += 1;
                    message_count += meta.message_count;
                    if meta.last_updated > last_modified {
                        last_modified = meta.last_updated;
                    }
                }
            }
        }

        if session_count == 0 {
            continue;
        }

        projects.push(ClaudeProject {
            name: project_name.clone(),
            path: format!("gemini://{}", project_dir.to_string_lossy()),
            actual_path,
            session_count,
            message_count,
            last_modified,
            git_info: None,
            provider: Some("gemini".to_string()),
            storage_type: Some("json".to_string()),
            custom_directory_label: None,
        });
    }

    Ok(projects)
}

/// Load sessions for a Gemini project
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let dir = project_path
        .strip_prefix("gemini://")
        .unwrap_or(project_path);
    let chats_dir = PathBuf::from(dir).join("chats");

    if !chats_dir.is_dir() {
        return Ok(Vec::new());
    }

    let project_name = PathBuf::from(dir)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let mut sessions = Vec::new();

    let mut entries: Vec<_> = fs::read_dir(&chats_dir)
        .map_err(|e| format!("Failed to read chats dir: {e}"))?
        .filter_map(Result::ok)
        .filter(is_session_file)
        .collect();

    entries.sort_by_key(|e| std::cmp::Reverse(e.file_name()));

    for entry in entries {
        let path = entry.path();

        // W-3: lightweight metadata extraction instead of full file parse
        let meta = match extract_session_metadata(&path) {
            Some(m) => m,
            None => continue,
        };

        if meta.kind == "subagent" {
            continue;
        }

        // Use file modification time as last_modified
        let last_modified = fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .map(|t| {
                chrono::DateTime::<chrono::Utc>::from(t)
                    .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                    .to_string()
            })
            .unwrap_or_else(|| meta.last_updated.clone());

        let file_session_id = path.to_string_lossy().to_string();

        sessions.push(ClaudeSession {
            session_id: file_session_id,
            actual_session_id: meta.session_id,
            file_path: path.to_string_lossy().to_string(),
            project_name: project_name.clone(),
            message_count: meta.message_count,
            first_message_time: meta.start_time,
            last_message_time: meta.last_updated.clone(),
            last_modified,
            has_tool_use: meta.has_tool_use,
            has_errors: false,
            summary: meta.summary,
            is_renamed: false,
            provider: Some("gemini".to_string()),
            storage_type: Some("json".to_string()),
        });
    }

    Ok(sessions)
}

/// Load messages from a Gemini session file
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    // W-1: validate path is within Gemini data directory
    let path = validate_session_path(session_path)?;

    let data =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read session file: {e}"))?;

    let record: Value =
        serde_json::from_str(&data).map_err(|e| format!("Failed to parse session: {e}"))?;

    let session_id = record
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();

    let messages = record
        .get("messages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut result = Vec::with_capacity(messages.len());

    for msg in &messages {
        if let Some(claude_msg) = convert_gemini_message(msg, &session_id) {
            result.push(claude_msg);
        }
    }

    Ok(result)
}

/// Search across all Gemini sessions
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let base = get_base_path().ok_or("Could not determine Gemini base path")?;
    let tmp_dir = PathBuf::from(&base).join("tmp");

    if !tmp_dir.is_dir() {
        return Ok(Vec::new());
    }

    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for project_entry in fs::read_dir(&tmp_dir).map_err(|e| e.to_string())?.flatten() {
        // W-2: skip symlinks
        if project_entry
            .file_type()
            .map(|ft| ft.is_symlink())
            .unwrap_or(false)
        {
            continue;
        }

        let chats_dir = project_entry.path().join("chats");
        if !chats_dir.is_dir() {
            continue;
        }

        let project_name = project_entry.file_name().to_string_lossy().to_string();

        for chat_entry in fs::read_dir(&chats_dir).into_iter().flatten().flatten() {
            let path = chat_entry.path();
            if !is_session_file(&chat_entry) {
                continue;
            }

            let data = match fs::read_to_string(&path) {
                Ok(d) => d,
                Err(_) => continue,
            };
            let record: Value = match serde_json::from_str(&data) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let kind = record.get("kind").and_then(Value::as_str).unwrap_or("main");
            if kind == "subagent" {
                continue;
            }

            let session_id = record
                .get("sessionId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();

            if let Some(msgs) = record.get("messages").and_then(Value::as_array) {
                for msg in msgs {
                    // I-1: removed search_message_matches wrapper
                    if search_value_recursive(msg, &query_lower) {
                        if let Some(mut claude_msg) = convert_gemini_message(msg, &session_id) {
                            claude_msg.project_name = Some(project_name.clone());
                            results.push(claude_msg);
                            if results.len() >= limit {
                                return Ok(results);
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(results)
}

// ============================================================================
// Path validation & file helpers
// ============================================================================

/// Validate that `session_path` is a real file inside `~/.gemini/tmp/`
fn validate_session_path(session_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(session_path)
        .canonicalize()
        .map_err(|e| format!("Invalid session path: {e}"))?;

    let base = get_base_path().ok_or("No Gemini base path")?;
    let tmp_dir = PathBuf::from(&base).join("tmp");

    // tmp_dir might not exist yet or might be a relative path — canonicalize it too
    if let Ok(canonical_tmp) = tmp_dir.canonicalize() {
        if !path.starts_with(&canonical_tmp) {
            return Err("Session path is outside Gemini data directory".to_string());
        }
    }

    if !path.is_file() {
        return Err(format!("Session file not found: {session_path}"));
    }

    Ok(path)
}

/// Check if a `DirEntry` points to a valid (non-symlink) session JSON file
fn is_session_file(entry: &fs::DirEntry) -> bool {
    // W-2: reject symlinks
    if entry.file_type().map(|ft| ft.is_symlink()).unwrap_or(true) {
        return false;
    }

    let path = entry.path();
    path.is_file()
        && path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|name| name.starts_with("session-"))
        && path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
}

fn read_project_root(project_dir: &Path) -> Option<String> {
    let root_file = project_dir.join(".project_root");
    fs::read_to_string(root_file)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

// ============================================================================
// Lightweight metadata extraction (C-1/W-3)
// ============================================================================

struct SessionMetadata {
    session_id: String,
    kind: String,
    start_time: String,
    last_updated: String,
    message_count: usize,
    has_tool_use: bool,
    summary: Option<String>,
}

/// Extract only metadata fields from a session file without fully deserializing
/// the messages array contents. Parses the full JSON but avoids deep inspection
/// of each message body — only checks top-level fields.
fn extract_session_metadata(path: &Path) -> Option<SessionMetadata> {
    let data = fs::read_to_string(path).ok()?;
    let record: Value = serde_json::from_str(&data).ok()?;

    let session_id = record
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let kind = record
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("main")
        .to_string();

    let start_time = record
        .get("startTime")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let last_updated = record
        .get("lastUpdated")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let messages = record.get("messages").and_then(Value::as_array);
    let message_count = messages.map_or(0, Vec::len);

    // Lightweight check: just see if any message has a non-empty toolCalls array
    let has_tool_use = messages
        .map(|msgs| {
            msgs.iter().any(|m| {
                m.get("toolCalls")
                    .and_then(Value::as_array)
                    .is_some_and(|arr| !arr.is_empty())
            })
        })
        .unwrap_or(false);

    let summary = record
        .get("summary")
        .and_then(Value::as_str)
        .map(String::from);

    Some(SessionMetadata {
        session_id,
        kind,
        start_time,
        last_updated,
        message_count,
        has_tool_use,
        summary,
    })
}

// ============================================================================
// Message conversion
// ============================================================================

/// Convert a Gemini message record to `ClaudeMessage`
fn convert_gemini_message(msg: &Value, session_id: &str) -> Option<ClaudeMessage> {
    let msg_type = msg.get("type").and_then(Value::as_str)?;
    let id = msg
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let timestamp = msg
        .get("timestamp")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    match msg_type {
        "user" => Some(convert_user_message(msg, &id, session_id, &timestamp)),
        "gemini" => Some(convert_gemini_response(msg, &id, session_id, &timestamp)),
        "info" | "warning" => Some(convert_system_message(
            msg, &id, session_id, &timestamp, msg_type,
        )),
        "error" => Some(convert_error_message(msg, &id, session_id, &timestamp)),
        _ => None,
    }
}

fn convert_user_message(msg: &Value, id: &str, session_id: &str, timestamp: &str) -> ClaudeMessage {
    let content = convert_gemini_content_to_claude(msg.get("content"));

    build_gemini_message(
        id.to_string(),
        session_id,
        timestamp.to_string(),
        "user",
        Some("user"),
        content,
        None,
    )
}

fn convert_gemini_response(
    msg: &Value,
    id: &str,
    session_id: &str,
    timestamp: &str,
) -> ClaudeMessage {
    let model = msg.get("model").and_then(Value::as_str).map(String::from);

    let mut content_blocks: Vec<Value> = Vec::new();

    // Add thinking content from thoughts array
    if let Some(thoughts) = msg.get("thoughts").and_then(Value::as_array) {
        for thought in thoughts {
            let subject = thought.get("subject").and_then(Value::as_str).unwrap_or("");
            let description = thought
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("");
            let thinking_text = if subject.is_empty() {
                description.to_string()
            } else {
                format!("**{subject}**\n{description}")
            };
            if !thinking_text.is_empty() {
                content_blocks.push(serde_json::json!({
                    "type": "thinking",
                    "thinking": thinking_text
                }));
            }
        }
    }

    // Add content from Part/PartListUnion
    match msg.get("content") {
        Some(Value::String(s)) if !s.is_empty() => {
            content_blocks.push(serde_json::json!({
                "type": "text",
                "text": s
            }));
        }
        Some(Value::Array(parts)) => {
            for part in parts {
                if let Some(block) = convert_gemini_part(part) {
                    content_blocks.push(block);
                }
            }
        }
        _ => {}
    }

    // Add tool use blocks from toolCalls
    if let Some(tool_calls) = msg.get("toolCalls").and_then(Value::as_array) {
        for tc in tool_calls {
            let tool_name = tc.get("name").and_then(Value::as_str).unwrap_or("unknown");
            let tool_id = tc
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string();
            let args = tc
                .get("args")
                .cloned()
                .unwrap_or_else(|| Value::Object(serde_json::Map::new()));

            let mapped_name = map_gemini_tool_name(tool_name);

            content_blocks.push(serde_json::json!({
                "type": "tool_use",
                "id": tool_id,
                "name": mapped_name,
                "input": args
            }));

            // If tool has result, add tool_result block
            if let Some(result) = tc.get("result") {
                let result_content = extract_tool_result_content(result);
                let status = tc
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("success");

                content_blocks.push(serde_json::json!({
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": result_content,
                    "is_error": status == "error"
                }));
            }

            // If tool has resultDisplay, add it as additional context
            if let Some(display) = tc.get("resultDisplay") {
                if let Some(display_content) = extract_result_display(display) {
                    content_blocks.push(display_content);
                }
            }
        }
    }

    // Build usage from tokens
    let usage = msg.get("tokens").map(|t| TokenUsage {
        input_tokens: t.get("input").and_then(Value::as_u64).map(|v| v as u32),
        output_tokens: t.get("output").and_then(Value::as_u64).map(|v| v as u32),
        cache_creation_input_tokens: None,
        cache_read_input_tokens: t.get("cached").and_then(Value::as_u64).map(|v| v as u32),
        service_tier: None,
    });

    let content = if content_blocks.is_empty() {
        None
    } else {
        Some(Value::Array(content_blocks))
    };

    let mut claude_msg = build_gemini_message(
        id.to_string(),
        session_id,
        timestamp.to_string(),
        "assistant",
        Some("assistant"),
        content,
        model,
    );
    claude_msg.usage = usage;
    claude_msg
}

fn convert_system_message(
    msg: &Value,
    id: &str,
    session_id: &str,
    timestamp: &str,
    subtype: &str,
) -> ClaudeMessage {
    let content = convert_gemini_content_to_claude(msg.get("content"));

    let mut claude_msg = build_gemini_message(
        id.to_string(),
        session_id,
        timestamp.to_string(),
        "system",
        None,
        content,
        None,
    );
    claude_msg.subtype = Some(subtype.to_string());
    claude_msg
}

fn convert_error_message(
    msg: &Value,
    id: &str,
    session_id: &str,
    timestamp: &str,
) -> ClaudeMessage {
    let content = convert_gemini_content_to_claude(msg.get("content"));

    let mut claude_msg = build_gemini_message(
        id.to_string(),
        session_id,
        timestamp.to_string(),
        "system",
        None,
        content,
        None,
    );
    claude_msg.subtype = Some("error".to_string());
    claude_msg.level = Some("error".to_string());
    claude_msg
}

// ============================================================================
// Content conversion helpers
// ============================================================================

/// Convert Gemini content (`PartListUnion`) to Claude-compatible content Value
fn convert_gemini_content_to_claude(content: Option<&Value>) -> Option<Value> {
    match content {
        Some(Value::String(s)) => Some(serde_json::json!([{
            "type": "text",
            "text": s
        }])),
        Some(Value::Array(parts)) => {
            let blocks: Vec<Value> = parts.iter().filter_map(convert_gemini_part).collect();
            if blocks.is_empty() {
                None
            } else {
                Some(Value::Array(blocks))
            }
        }
        _ => None,
    }
}

/// Convert a single Gemini `Part` to a Claude-compatible content block
fn convert_gemini_part(part: &Value) -> Option<Value> {
    // text (with optional thought flag)
    if let Some(text) = part.get("text").and_then(Value::as_str) {
        if part
            .get("thought")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return Some(serde_json::json!({
                "type": "thinking",
                "thinking": text
            }));
        }
        return Some(serde_json::json!({
            "type": "text",
            "text": text
        }));
    }

    // inlineData (base64 image/file)
    if let Some(inline) = part.get("inlineData") {
        return Some(serde_json::json!({
            "type": "image",
            "source": inline
        }));
    }

    // fileData (URI-based file reference)
    if let Some(file_data) = part.get("fileData") {
        return Some(serde_json::json!({
            "type": "document",
            "source": {
                "type": "url",
                "url": file_data.get("fileUri").and_then(Value::as_str).unwrap_or(""),
                "media_type": file_data.get("mimeType").and_then(Value::as_str).unwrap_or("")
            }
        }));
    }

    // functionCall (Part-level tool invocation)
    if let Some(fc) = part.get("functionCall") {
        let name = fc.get("name").and_then(Value::as_str).unwrap_or("unknown");
        let args = fc
            .get("args")
            .cloned()
            .unwrap_or(Value::Object(serde_json::Map::new()));
        return Some(serde_json::json!({
            "type": "tool_use",
            "id": format!("fc_{}", name),
            "name": map_gemini_tool_name(name),
            "input": args
        }));
    }

    // functionResponse (Part-level tool result)
    if let Some(fr) = part.get("functionResponse") {
        let name = fr.get("name").and_then(Value::as_str).unwrap_or("unknown");
        let response_text = fr
            .get("response")
            .and_then(|r| r.get("output"))
            .and_then(Value::as_str)
            .unwrap_or("");
        return Some(serde_json::json!({
            "type": "tool_result",
            "tool_use_id": format!("fc_{}", name),
            "content": response_text
        }));
    }

    // executableCode (model-generated code)
    if let Some(ec) = part.get("executableCode") {
        let code = ec.get("code").and_then(Value::as_str).unwrap_or("");
        let language = ec
            .get("language")
            .and_then(Value::as_str)
            .unwrap_or("python");
        return Some(serde_json::json!({
            "type": "text",
            "text": format!("```{language}\n{code}\n```")
        }));
    }

    // codeExecutionResult
    if let Some(cer) = part.get("codeExecutionResult") {
        let outcome = cer
            .get("outcome")
            .and_then(Value::as_str)
            .unwrap_or("UNKNOWN");
        let output = cer.get("output").and_then(Value::as_str).unwrap_or("");
        return Some(serde_json::json!({
            "type": "text",
            "text": format!("[Code Execution: {outcome}]\n{output}")
        }));
    }

    // Plain string part (PartUnion = Part | string)
    if let Value::String(s) = part {
        return Some(serde_json::json!({
            "type": "text",
            "text": s
        }));
    }

    None
}

/// Extract tool result content from Gemini's result structure
fn extract_tool_result_content(result: &Value) -> Value {
    if let Some(arr) = result.as_array() {
        let texts: Vec<String> = arr
            .iter()
            .filter_map(|item| {
                item.get("functionResponse")
                    .and_then(|fr| fr.get("response"))
                    .and_then(|r| r.get("output"))
                    .and_then(Value::as_str)
                    .map(String::from)
            })
            .collect();
        if !texts.is_empty() {
            return Value::String(texts.join("\n"));
        }
    }
    match result {
        Value::String(s) => Value::String(s.clone()),
        _ => Value::String(serde_json::to_string(result).unwrap_or_default()),
    }
}

/// Extract display content from `resultDisplay`
fn extract_result_display(display: &Value) -> Option<Value> {
    match display {
        Value::String(s) if !s.is_empty() => Some(serde_json::json!({
            "type": "text",
            "text": s
        })),
        Value::Object(obj) => {
            if obj.contains_key("fileDiff") {
                Some(serde_json::json!({
                    "type": "text",
                    "text": format!("[File Change] {}",
                        obj.get("fileName")
                            .and_then(Value::as_str)
                            .unwrap_or("unknown file"))
                }))
            } else if obj.contains_key("todos") {
                Some(serde_json::json!({
                    "type": "text",
                    "text": "[Task List Updated]"
                }))
            } else if obj.contains_key("isSubagentProgress") {
                let agent_name = obj
                    .get("agentName")
                    .and_then(Value::as_str)
                    .unwrap_or("agent");
                Some(serde_json::json!({
                    "type": "text",
                    "text": format!("[Subagent: {}]", agent_name)
                }))
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Map Gemini tool names to common names
fn map_gemini_tool_name(name: &str) -> &str {
    match name {
        "read_file" | "ReadFile" => "Read",
        "write_file" | "WriteFile" | "create_file" => "Write",
        "edit_file" | "EditFile" => "Edit",
        "shell" | "run_command" | "execute_command" => "Bash",
        "list_directory" | "list_dir" => "Glob",
        "search_files" | "grep" => "Grep",
        "web_search" => "WebSearch",
        "web_fetch" => "WebFetch",
        "cli_help" => "cli_help",
        _ => name,
    }
}

fn search_value_recursive(val: &Value, query_lower: &str) -> bool {
    match val {
        Value::String(s) => s.to_lowercase().contains(query_lower),
        Value::Array(arr) => arr.iter().any(|v| search_value_recursive(v, query_lower)),
        Value::Object(map) => map.values().any(|v| search_value_recursive(v, query_lower)),
        _ => false,
    }
}

fn build_gemini_message(
    uuid: String,
    session_id: &str,
    timestamp: String,
    message_type: &str,
    role: Option<&str>,
    content: Option<Value>,
    model: Option<String>,
) -> ClaudeMessage {
    ClaudeMessage {
        uuid,
        parent_uuid: None,
        session_id: session_id.to_string(),
        timestamp,
        message_type: message_type.to_string(),
        content,
        project_name: None,
        tool_use: None,
        tool_use_result: None,
        is_sidechain: None,
        usage: None,
        role: role.map(String::from),
        model,
        stop_reason: None,
        cost_usd: None,
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
        provider: Some("gemini".to_string()),
    }
}

// ============================================================================
// Tests (I-3)
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_map_gemini_tool_name() {
        assert_eq!(map_gemini_tool_name("read_file"), "Read");
        assert_eq!(map_gemini_tool_name("ReadFile"), "Read");
        assert_eq!(map_gemini_tool_name("write_file"), "Write");
        assert_eq!(map_gemini_tool_name("shell"), "Bash");
        assert_eq!(map_gemini_tool_name("execute_command"), "Bash");
        assert_eq!(map_gemini_tool_name("search_files"), "Grep");
        assert_eq!(map_gemini_tool_name("unknown_tool"), "unknown_tool");
        assert_eq!(map_gemini_tool_name("cli_help"), "cli_help");
    }

    #[test]
    fn test_convert_user_message_string_content() {
        let msg = json!({
            "id": "user-1",
            "timestamp": "2026-03-24T12:00:00Z",
            "type": "user",
            "content": [{"text": "Hello world"}]
        });

        let result = convert_gemini_message(&msg, "session-1").unwrap();
        assert_eq!(result.message_type, "user");
        assert_eq!(result.role, Some("user".to_string()));
        assert_eq!(result.provider, Some("gemini".to_string()));

        let content = result.content.unwrap();
        let arr = content.as_array().unwrap();
        assert_eq!(arr[0]["type"], "text");
        assert_eq!(arr[0]["text"], "Hello world");
    }

    #[test]
    fn test_convert_gemini_response_with_text() {
        let msg = json!({
            "id": "gemini-1",
            "timestamp": "2026-03-24T12:00:01Z",
            "type": "gemini",
            "content": "This is a response",
            "model": "gemini-3-flash-preview",
            "thoughts": [],
            "tokens": {
                "input": 100,
                "output": 50,
                "cached": 0,
                "thoughts": 10,
                "tool": 0,
                "total": 160
            }
        });

        let result = convert_gemini_message(&msg, "session-1").unwrap();
        assert_eq!(result.message_type, "assistant");
        assert_eq!(result.model, Some("gemini-3-flash-preview".to_string()));

        let usage = result.usage.unwrap();
        assert_eq!(usage.input_tokens, Some(100));
        assert_eq!(usage.output_tokens, Some(50));
        assert_eq!(usage.cache_read_input_tokens, Some(0));

        let content = result.content.unwrap();
        let arr = content.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["type"], "text");
        assert_eq!(arr[0]["text"], "This is a response");
    }

    #[test]
    fn test_convert_gemini_response_with_tool_calls() {
        let msg = json!({
            "id": "gemini-2",
            "timestamp": "2026-03-24T12:00:02Z",
            "type": "gemini",
            "content": "Let me check that.",
            "model": "gemini-3-flash-preview",
            "thoughts": [],
            "tokens": { "input": 100, "output": 50, "cached": 0, "total": 150 },
            "toolCalls": [{
                "id": "tool-1",
                "name": "read_file",
                "args": { "file_path": "/test.txt" },
                "result": [{
                    "functionResponse": {
                        "id": "tool-1",
                        "name": "read_file",
                        "response": { "output": "file content here" }
                    }
                }],
                "status": "success",
                "timestamp": "2026-03-24T12:00:03Z"
            }]
        });

        let result = convert_gemini_message(&msg, "session-1").unwrap();
        let content = result.content.unwrap();
        let arr = content.as_array().unwrap();

        // text + tool_use + tool_result = 3 blocks
        assert_eq!(arr.len(), 3);
        assert_eq!(arr[0]["type"], "text");
        assert_eq!(arr[1]["type"], "tool_use");
        assert_eq!(arr[1]["name"], "Read"); // mapped from read_file
        assert_eq!(arr[2]["type"], "tool_result");
        assert_eq!(arr[2]["content"], "file content here");
        assert_eq!(arr[2]["is_error"], false);
    }

    #[test]
    fn test_convert_gemini_response_with_thoughts() {
        let msg = json!({
            "id": "gemini-3",
            "timestamp": "2026-03-24T12:00:00Z",
            "type": "gemini",
            "content": "Done.",
            "thoughts": [
                { "subject": "Planning", "description": "I need to read the file first" }
            ],
            "tokens": { "input": 100, "output": 50, "cached": 0, "total": 150 }
        });

        let result = convert_gemini_message(&msg, "session-1").unwrap();
        let content = result.content.unwrap();
        let arr = content.as_array().unwrap();

        assert_eq!(arr[0]["type"], "thinking");
        assert!(arr[0]["thinking"].as_str().unwrap().contains("Planning"));
        assert_eq!(arr[1]["type"], "text");
    }

    #[test]
    fn test_convert_error_message() {
        let msg = json!({
            "id": "err-1",
            "timestamp": "2026-03-24T12:00:00Z",
            "type": "error",
            "content": "Something went wrong"
        });

        let result = convert_gemini_message(&msg, "session-1").unwrap();
        assert_eq!(result.message_type, "system");
        assert_eq!(result.subtype, Some("error".to_string()));
        assert_eq!(result.level, Some("error".to_string()));
    }

    #[test]
    fn test_convert_gemini_content_string() {
        let content = Value::String("Hello".to_string());
        let result = convert_gemini_content_to_claude(Some(&content)).unwrap();
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["text"], "Hello");
    }

    #[test]
    fn test_convert_gemini_content_array() {
        let content = json!([{"text": "Hello"}, {"text": "World"}]);
        let result = convert_gemini_content_to_claude(Some(&content)).unwrap();
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["text"], "Hello");
        assert_eq!(arr[1]["text"], "World");
    }

    #[test]
    fn test_convert_gemini_content_none() {
        assert!(convert_gemini_content_to_claude(None).is_none());
    }

    #[test]
    fn test_extract_tool_result_content_function_response() {
        let result = json!([{
            "functionResponse": {
                "id": "tool-1",
                "name": "read_file",
                "response": { "output": "line 1\nline 2" }
            }
        }]);
        let extracted = extract_tool_result_content(&result);
        assert_eq!(extracted, Value::String("line 1\nline 2".to_string()));
    }

    #[test]
    fn test_extract_tool_result_content_fallback() {
        let result = json!({"some": "data"});
        let extracted = extract_tool_result_content(&result);
        assert!(extracted.as_str().unwrap().contains("some"));
    }

    #[test]
    fn test_extract_result_display_string() {
        let display = Value::String("Output text".to_string());
        let result = extract_result_display(&display).unwrap();
        assert_eq!(result["type"], "text");
        assert_eq!(result["text"], "Output text");
    }

    #[test]
    fn test_extract_result_display_file_diff() {
        let display = json!({"fileDiff": "...", "fileName": "test.rs"});
        let result = extract_result_display(&display).unwrap();
        assert!(result["text"].as_str().unwrap().contains("test.rs"));
    }

    #[test]
    fn test_extract_result_display_subagent() {
        let display = json!({"isSubagentProgress": true, "agentName": "helper"});
        let result = extract_result_display(&display).unwrap();
        assert!(result["text"].as_str().unwrap().contains("helper"));
    }

    #[test]
    fn test_search_value_recursive() {
        let val = json!({
            "type": "user",
            "content": [{"text": "Find this keyword"}]
        });
        assert!(search_value_recursive(&val, "keyword"));
        assert!(!search_value_recursive(&val, "missing"));
    }

    #[test]
    fn test_unknown_message_type_returns_none() {
        let msg = json!({
            "id": "unknown-1",
            "timestamp": "2026-03-24T12:00:00Z",
            "type": "custom_unknown"
        });
        assert!(convert_gemini_message(&msg, "session-1").is_none());
    }

    #[test]
    fn test_gemini_response_empty_content() {
        let msg = json!({
            "id": "gemini-empty",
            "timestamp": "2026-03-24T12:00:00Z",
            "type": "gemini",
            "content": "",
            "thoughts": [],
            "tokens": { "input": 100, "output": 0, "cached": 0, "total": 100 }
        });

        let result = convert_gemini_message(&msg, "session-1").unwrap();
        // Empty string content should produce no content blocks
        assert!(result.content.is_none());
    }

    #[test]
    fn test_tool_call_with_error_status() {
        let msg = json!({
            "id": "gemini-err",
            "timestamp": "2026-03-24T12:00:00Z",
            "type": "gemini",
            "content": "",
            "thoughts": [],
            "tokens": { "input": 100, "output": 50, "cached": 0, "total": 150 },
            "toolCalls": [{
                "id": "tool-err",
                "name": "shell",
                "args": { "command": "exit 1" },
                "result": [{ "functionResponse": { "response": { "output": "command failed" } } }],
                "status": "error",
                "timestamp": "2026-03-24T12:00:01Z"
            }]
        });

        let result = convert_gemini_message(&msg, "session-1").unwrap();
        let content = result.content.unwrap();
        let arr = content.as_array().unwrap();

        let tool_result = arr.iter().find(|b| b["type"] == "tool_result").unwrap();
        assert_eq!(tool_result["is_error"], true);
    }

    // ====================================================================
    // Part-level conversion tests (convert_gemini_part)
    // ====================================================================

    #[test]
    fn test_part_thought_flag() {
        let part = json!({"text": "Thinking about this...", "thought": true});
        let result = convert_gemini_part(&part).unwrap();
        assert_eq!(result["type"], "thinking");
        assert_eq!(result["thinking"], "Thinking about this...");
    }

    #[test]
    fn test_part_file_data() {
        let part = json!({
            "fileData": {
                "fileUri": "gs://bucket/file.pdf",
                "mimeType": "application/pdf"
            }
        });
        let result = convert_gemini_part(&part).unwrap();
        assert_eq!(result["type"], "document");
        assert_eq!(result["source"]["type"], "url");
        assert_eq!(result["source"]["url"], "gs://bucket/file.pdf");
    }

    #[test]
    fn test_part_function_call() {
        let part = json!({
            "functionCall": {
                "name": "read_file",
                "args": {"file_path": "/test.txt"}
            }
        });
        let result = convert_gemini_part(&part).unwrap();
        assert_eq!(result["type"], "tool_use");
        assert_eq!(result["name"], "Read"); // mapped
        assert_eq!(result["input"]["file_path"], "/test.txt");
    }

    #[test]
    fn test_part_function_response() {
        let part = json!({
            "functionResponse": {
                "name": "read_file",
                "response": {"output": "file contents"}
            }
        });
        let result = convert_gemini_part(&part).unwrap();
        assert_eq!(result["type"], "tool_result");
        assert_eq!(result["content"], "file contents");
    }

    #[test]
    fn test_part_executable_code() {
        let part = json!({
            "executableCode": {
                "code": "print('hello')",
                "language": "python"
            }
        });
        let result = convert_gemini_part(&part).unwrap();
        assert_eq!(result["type"], "text");
        let text = result["text"].as_str().unwrap();
        assert!(text.contains("```python"));
        assert!(text.contains("print('hello')"));
    }

    #[test]
    fn test_part_code_execution_result() {
        let part = json!({
            "codeExecutionResult": {
                "outcome": "OUTCOME_OK",
                "output": "hello\n"
            }
        });
        let result = convert_gemini_part(&part).unwrap();
        assert_eq!(result["type"], "text");
        let text = result["text"].as_str().unwrap();
        assert!(text.contains("OUTCOME_OK"));
        assert!(text.contains("hello"));
    }

    #[test]
    fn test_part_inline_data() {
        let part = json!({
            "inlineData": {
                "mimeType": "image/png",
                "data": "base64data..."
            }
        });
        let result = convert_gemini_part(&part).unwrap();
        assert_eq!(result["type"], "image");
        assert_eq!(result["source"]["mimeType"], "image/png");
    }

    #[test]
    fn test_part_plain_string() {
        let part = Value::String("plain text".to_string());
        let result = convert_gemini_part(&part).unwrap();
        assert_eq!(result["type"], "text");
        assert_eq!(result["text"], "plain text");
    }

    #[test]
    fn test_part_unknown_returns_none() {
        let part = json!({"unknownField": true});
        assert!(convert_gemini_part(&part).is_none());
    }

    #[test]
    fn test_gemini_response_with_part_level_thought() {
        let msg = json!({
            "id": "gemini-part-thought",
            "timestamp": "2026-03-24T12:00:00Z",
            "type": "gemini",
            "content": [
                {"text": "Let me think...", "thought": true},
                {"text": "Here is my answer."}
            ],
            "thoughts": [],
            "tokens": { "input": 100, "output": 50, "cached": 0, "total": 150 }
        });

        let result = convert_gemini_message(&msg, "session-1").unwrap();
        let content = result.content.unwrap();
        let arr = content.as_array().unwrap();

        assert_eq!(arr[0]["type"], "thinking");
        assert_eq!(arr[1]["type"], "text");
        assert_eq!(arr[1]["text"], "Here is my answer.");
    }
}
