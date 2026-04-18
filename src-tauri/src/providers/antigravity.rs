use super::ProviderInfo;
use crate::commands::antigravity::{
    antigravity_root_from_path, get_antigravity_rpc_cache_root, load_antigravity_state_impl,
    resolve_antigravity_root,
};
use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

pub fn detect() -> Option<ProviderInfo> {
    let root = resolve_antigravity_root()?;
    let state = load_antigravity_state_impl(&root).ok();
    let rpc_cache_root = get_antigravity_rpc_cache_root(&root);
    let is_available = state
        .as_ref()
        .map(|state| !state.sessions.is_empty())
        .unwrap_or(false)
        || rpc_cache_root.exists()
        || root.join("brain").exists()
        || root.join("conversations").exists()
        || root.join("monitor-state.json").exists();

    Some(ProviderInfo {
        id: "antigravity".to_string(),
        display_name: "Antigravity".to_string(),
        base_path: root.to_string_lossy().to_string(),
        is_available,
    })
}

struct ManifestInfo {
    step_count: usize,
}

fn read_manifest(dir: &std::path::Path) -> Option<ManifestInfo> {
    let path = dir.join("manifest.json");
    if !path.exists() {
        return None;
    }
    let content = std::fs::read_to_string(&path).ok()?;
    let v: Value = serde_json::from_str(&content).ok()?;
    Some(ManifestInfo {
        step_count: v["stepCount"].as_u64().unwrap_or(0) as usize,
    })
}

pub struct UsageSummary {
    pub call_count: usize,
    pub first_ts_ms: u64,
    pub last_ts_ms: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

pub fn summarize_usage_file(path: &std::path::Path) -> UsageSummary {
    let mut call_count = 0usize;
    let mut first_ts_ms = u64::MAX;
    let mut last_ts_ms: u64 = 0;
    let mut input_tokens: u64 = 0;
    let mut output_tokens: u64 = 0;

    if let Ok(content) = std::fs::read_to_string(path) {
        for line in content.lines() {
            let Ok(rec) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            if rec["recordType"].as_str() != Some("usage") {
                continue;
            }
            call_count += 1;
            input_tokens += rec["inputTokens"].as_u64().unwrap_or(0);
            output_tokens += rec["outputTokens"].as_u64().unwrap_or(0);

            // Extract timestamp from raw.chatModel.chatStartMetadata.createdAt
            if let Some(created_at) =
                rec["raw"]["chatModel"]["chatStartMetadata"]["createdAt"].as_str()
            {
                if let Ok(t) = chrono::DateTime::parse_from_rfc3339(created_at) {
                    let ts_i64 = t.timestamp_millis();
                    if ts_i64 >= 0 {
                        if let Ok(ms) = ts_i64.try_into() {
                            if ms < first_ts_ms {
                                first_ts_ms = ms;
                            }
                            if ms > last_ts_ms {
                                last_ts_ms = ms;
                            }
                        }
                    }
                }
            }
        }
    }

    UsageSummary {
        call_count,
        first_ts_ms: if first_ts_ms == u64::MAX {
            0
        } else {
            first_ts_ms
        },
        last_ts_ms,
        input_tokens,
        output_tokens,
    }
}

fn ms_to_rfc3339(ms: u64) -> String {
    if ms == 0 {
        return "1970-01-01T00:00:00Z".to_string();
    }
    i64::try_from(ms / 1000)
        .ok()
        .and_then(|seconds| chrono::DateTime::from_timestamp(seconds, 0))
        .map(|dt| dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string())
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider interface
// ─────────────────────────────────────────────────────────────────────────────

/// Return a single "Antigravity" project representing all rpc-cache sessions.
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let Some(root) = resolve_antigravity_root() else {
        return Ok(vec![]);
    };
    let state = load_antigravity_state_impl(&root)?;
    if state.sessions.is_empty() {
        return Ok(vec![]);
    }

    let path_str = root.to_string_lossy().to_string();
    let session_count = state.sessions.len();
    let message_count = state
        .sessions
        .values()
        .map(|session| session.latest.message_count.unwrap_or(0) as usize)
        .sum();
    let max_time_ms = state
        .sessions
        .values()
        .map(|session| session.latest.last_modified_ms)
        .max()
        .unwrap_or(0);

    Ok(vec![ClaudeProject {
        name: "Antigravity".to_string(),
        path: path_str.clone(),
        actual_path: path_str,
        session_count,
        message_count,
        last_modified: ms_to_rfc3339(max_time_ms),
        git_info: None,
        provider: Some("antigravity".to_string()),
        storage_type: None,
        custom_directory_label: None,
    }])
}

fn to_u32_saturating(value: u64) -> u32 {
    value.min(u64::from(u32::MAX)) as u32
}

fn antigravity_logs_root() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join("Antigravity").join("logs"))
}

fn tool_name_from_overlay_display(display: &str) -> Option<&'static str> {
    match display {
        "Opening URL..." => Some("BrowserOpenUrl"),
        "Getting DOM..." => Some("BrowserGetDom"),
        "Getting console logs..." => Some("BrowserGetConsoleLogs"),
        "Clicking..." => Some("BrowserClick"),
        "Taking screenshot..." => Some("BrowserScreenshot"),
        "Scrolling mouse wheel..." => Some("BrowserScrollMouseWheel"),
        _ => None,
    }
}

fn extract_pb_tool_names(pb_path: &Path) -> Vec<String> {
    let Ok(bytes) = std::fs::read(pb_path) else {
        return vec![];
    };

    let clean_bytes: Vec<u8> = bytes
        .into_iter()
        .map(|byte| {
            if (32..=126).contains(&byte) || byte == b'\n' || byte == b'\r' || byte == b'\t' {
                byte
            } else {
                b' '
            }
        })
        .collect();
    let text = String::from_utf8_lossy(&clean_bytes).to_lowercase();
    let mut tool_names = Vec::new();

    // Heuristic only: current public Antigravity logs do not expose a schema for
    // conversation .pb files, so we only accept clear, low-false-positive phrases.
    const TOOL_PATTERNS: [(&str, &str); 6] = [
        ("opening url", "BrowserOpenUrl"),
        ("getting dom", "BrowserGetDom"),
        ("getting console logs", "BrowserGetConsoleLogs"),
        ("clicking", "BrowserClick"),
        ("taking screenshot", "BrowserScreenshot"),
        ("scrolling mouse wheel", "BrowserScrollMouseWheel"),
    ];

    for (pattern, tool_name) in TOOL_PATTERNS {
        let count = text.match_indices(pattern).count();
        for _ in 0..count {
            tool_names.push(tool_name.to_string());
        }
    }

    tool_names
}

fn extract_log_tool_names(log_path: &Path, session_id: &str) -> Vec<String> {
    let Ok(content) = std::fs::read_to_string(log_path) else {
        return vec![];
    };

    let session_needle = format!("\"cascadeId\":\"{session_id}\"");
    let mut tool_names = Vec::new();

    for line in content.lines() {
        if !line.contains(&session_needle) || !line.contains("window.updateActuationOverlay(") {
            continue;
        }

        let Some(json_start) = line.find('{') else {
            continue;
        };
        let Some(json_end) = line.rfind("})") else {
            continue;
        };
        if json_end <= json_start {
            continue;
        }

        let payload = &line[json_start..=json_end];
        let Ok(value) = serde_json::from_str::<Value>(payload) else {
            continue;
        };

        let Some(display) = value.get("displayString").and_then(Value::as_str) else {
            continue;
        };
        if let Some(tool_name) = tool_name_from_overlay_display(display) {
            tool_names.push(tool_name.to_string());
        }
    }

    tool_names
}

fn load_antigravity_tool_names(session_path: &str, session_id: &str) -> Vec<String> {
    let mut tool_names = Vec::new();

    if let Some(root) = antigravity_root_from_path(session_path) {
        let pb_path = root.join("conversations").join(format!("{session_id}.pb"));
        tool_names.extend(extract_pb_tool_names(&pb_path));
    }

    if let Some(logs_root) = antigravity_logs_root() {
        let Ok(entries) = std::fs::read_dir(&logs_root) else {
            return tool_names;
        };

        for entry in entries.flatten() {
            let log_path = entry.path().join("ls-main.log");
            if !log_path.exists() {
                continue;
            }
            tool_names.extend(extract_log_tool_names(&log_path, session_id));
        }
    }

    tool_names
}

fn merge_tool_names_into_messages(
    mut messages: Vec<ClaudeMessage>,
    session_id: &str,
    tool_names: &[String],
) -> Vec<ClaudeMessage> {
    if tool_names.is_empty() {
        return messages;
    }

    let Some(target_index) = messages
        .iter()
        .rposition(|message| message.message_type == "assistant")
    else {
        return messages;
    };

    let message = &mut messages[target_index];
    let mut content = message
        .content
        .as_ref()
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    for (index, tool_name) in tool_names.iter().enumerate() {
        content.push(json!({
            "type": "tool_use",
            "id": format!("{session_id}-tool-{index}"),
            "name": tool_name,
            "input": {},
            "is_error": false
        }));
    }

    message.content = Some(Value::Array(content));
    messages
}

/// Map each rpc-cache session directory to a `ClaudeSession`.
pub fn load_sessions(path: &str, _exclude_sidechain: bool) -> Result<Vec<ClaudeSession>, String> {
    let root = match resolve_antigravity_root() {
        Some(root) => root,
        None => return Ok(vec![]),
    };
    let requested_path = std::path::PathBuf::from(path);
    let path_matches_root = requested_path == root || requested_path.starts_with(root.as_path());
    let resolved_root_matches = antigravity_root_from_path(path).as_deref() == Some(root.as_path());
    if !path_matches_root && !resolved_root_matches {
        return Err(format!(
            "Provided antigravity path does not resolve to detected root: {}",
            root.display()
        ));
    }
    let state = load_antigravity_state_impl(&root)?;
    let mut sessions = Vec::new();

    for (session_id, session_state) in state.sessions {
        let session_dir = std::path::PathBuf::from(&session_state.latest.file_path);
        let usage_path = session_dir.join("usage.jsonl");
        let summary = summarize_usage_file(&usage_path);
        let manifest = read_manifest(&session_dir);
        let step_count = manifest.as_ref().map(|m| m.step_count).unwrap_or(0);
        let first_ts = if summary.first_ts_ms > 0 {
            ms_to_rfc3339(summary.first_ts_ms)
        } else {
            ms_to_rfc3339(session_state.lifecycle.last_seen_at)
        };
        let last_ts = if summary.last_ts_ms > 0 {
            ms_to_rfc3339(summary.last_ts_ms)
        } else {
            ms_to_rfc3339(session_state.latest.last_modified_ms)
        };

        let display_label = format!(
            "{} ({} calls · {} steps · in={} out={} total={})",
            session_state.latest.label,
            session_state
                .latest
                .message_count
                .unwrap_or(summary.call_count as u32),
            step_count,
            fmt_tokens(session_state.latest.input_tokens),
            fmt_tokens(session_state.latest.output_tokens),
            fmt_tokens(session_state.latest.total_tokens),
        );

        sessions.push(ClaudeSession {
            session_id: session_id.clone(),
            actual_session_id: session_id,
            file_path: session_dir.to_string_lossy().to_string(),
            project_name: "Antigravity".to_string(),
            message_count: session_state
                .latest
                .message_count
                .unwrap_or(summary.call_count as u32) as usize,
            first_message_time: first_ts.clone(),
            last_message_time: last_ts.clone(),
            last_modified: last_ts,
            has_tool_use: false,
            has_errors: false,
            summary: Some(display_label),
            is_renamed: false,
            provider: Some("antigravity".to_string()),
            storage_type: None,
        });
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

/// Map each usage record in a session's usage.jsonl to a pair of `ClaudeMessages`.
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let dir = std::path::PathBuf::from(session_path);
    let session_id = dir
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default();

    // Try session_path first, then fall back to rpc-cache location
    let usage_path = dir.join("usage.jsonl");
    let usage_path = if usage_path.exists() {
        usage_path
    } else {
        // session_path is typically ~/.gemini/antigravity/brain/{session_id}
        // The actual data may live in ~/.gemini/antigravity/.token-monitor/rpc-cache/v1/{session_id}
        if let Some(rpc_root) = antigravity_root_from_path(session_path) {
            let rpc_cache = rpc_root
                .join(".token-monitor")
                .join("rpc-cache")
                .join("v1")
                .join(&session_id)
                .join("usage.jsonl");
            if rpc_cache.exists() {
                rpc_cache
            } else {
                return Ok(vec![]);
            }
        } else {
            return Ok(vec![]);
        }
    };

    let content = std::fs::read_to_string(&usage_path)
        .map_err(|e| format!("Failed to read usage.jsonl: {e}"))?;

    let mut messages = Vec::new();

    for line in content.lines() {
        let Ok(rec) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if rec["recordType"].as_str() != Some("usage") {
            continue;
        }

        let sequence = rec["sequence"].as_u64().unwrap_or(0);
        let model = rec["model"].as_str().unwrap_or("unknown").to_string();
        let input_tokens = to_u32_saturating(rec["inputTokens"].as_u64().unwrap_or(0));
        let output_tokens = to_u32_saturating(rec["outputTokens"].as_u64().unwrap_or(0));
        let cache_read = to_u32_saturating(rec["cacheReadTokens"].as_u64().unwrap_or(0));
        let cache_write = to_u32_saturating(rec["cacheWriteTokens"].as_u64().unwrap_or(0));

        let timestamp = rec["raw"]["chatModel"]["chatStartMetadata"]["createdAt"]
            .as_str()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|t| t.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
            .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string());

        // Fake "user" turn so the viewer has a matching pair
        messages.push(ClaudeMessage {
            uuid: format!("{session_id}-{sequence}-u"),
            parent_uuid: None,
            session_id: session_id.clone(),
            timestamp: timestamp.clone(),
            message_type: "user".to_string(),
            content: Some(json!([{"type":"text","text":format!("#{} {}", sequence, model)}])),
            usage: None,
            provider: Some("antigravity".to_string()),
            message_id: None,
            project_name: None,
            tool_use: None,
            tool_use_result: None,
            is_sidechain: None,
            role: Some("user".to_string()),
            model: Some(model.clone()),
            stop_reason: None,
            cost_usd: None,
            duration_ms: None,
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
        });

        // Assistant turn with real token usage
        messages.push(ClaudeMessage {
            uuid: format!("{session_id}-{sequence}-a"),
            parent_uuid: Some(format!("{session_id}-{sequence}-u")),
            session_id: session_id.clone(),
            timestamp,
            message_type: "assistant".to_string(),
            content: Some(
                json!([{"type":"text","text":format!("in={} out={} cr={} cw={}",
                input_tokens, output_tokens, cache_read, cache_write)}]),
            ),
            usage: Some(crate::models::TokenUsage {
                input_tokens: Some(input_tokens),
                output_tokens: Some(output_tokens),
                cache_creation_input_tokens: Some(cache_write),
                cache_read_input_tokens: Some(cache_read),
                service_tier: None,
            }),
            provider: Some("antigravity".to_string()),
            message_id: None,
            project_name: None,
            tool_use: None,
            tool_use_result: None,
            is_sidechain: None,
            role: Some("assistant".to_string()),
            model: Some(model),
            stop_reason: None,
            cost_usd: None,
            duration_ms: None,
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
        });
    }

    let tool_names = load_antigravity_tool_names(session_path, &session_id);
    Ok(merge_tool_names_into_messages(
        messages,
        &session_id,
        &tool_names,
    ))
}

fn fmt_tokens(n: u64) -> String {
    if n >= 1_000_000 {
        format!("{:.1}M", n as f64 / 1_000_000.0)
    } else if n >= 1_000 {
        format!("{:.1}k", n as f64 / 1_000.0)
    } else {
        n.to_string()
    }
}

/// Search across antigravity sessions for matching query.
/// Matches against session ID prefix or model name.
/// Note: usage.jsonl does not contain natural conversation content,
///
/// so this searches session metadata rather than message content.
pub fn search(query: &str, max_results: usize) -> Result<Vec<ClaudeMessage>, String> {
    let root = match resolve_antigravity_root() {
        Some(root) => root,
        None => return Ok(vec![]),
    };
    let state = load_antigravity_state_impl(&root)?;

    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for session in state.sessions.values() {
        let session_matches = session
            .latest
            .session_id
            .to_lowercase()
            .contains(&query_lower)
            || session.latest.label.to_lowercase().contains(&query_lower);
        let model_match = session
            .latest
            .model_totals
            .as_ref()
            .map(|models| {
                models
                    .keys()
                    .any(|model| model.to_lowercase().contains(&query_lower))
            })
            .unwrap_or(false);

        if !session_matches && !model_match {
            continue;
        }

        let session_id = session.latest.session_id.clone();
        let timestamp = ms_to_rfc3339(session.latest.last_modified_ms);
        let short_id: String = session_id.chars().take(8).collect();
        let content_text = if session_matches {
            format!("Session: {session_id}")
        } else {
            format!("Session: {short_id} (matched model)")
        };

        results.push(ClaudeMessage {
            uuid: format!("ag-search-{}-{}", session_id, 0),
            parent_uuid: None,
            session_id: session_id.clone(),
            timestamp,
            message_type: "assistant".to_string(),
            content: Some(json!([{ "type": "text", "text": content_text }])),
            usage: None,
            provider: Some("antigravity".to_string()),
            message_id: None,
            project_name: None,
            tool_use: None,
            tool_use_result: None,
            is_sidechain: None,
            role: Some("assistant".to_string()),
            model: None,
            stop_reason: None,
            cost_usd: None,
            duration_ms: None,
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
        });
    }

    results.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    results.truncate(max_results);
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn make_usage_file(dir: &std::path::Path, _session_id: &str, model: &str) {
        let usage_path = dir.join("usage.jsonl");
        let record = serde_json::json!({
            "recordType": "usage",
            "sequence": 1,
            "model": model,
            "inputTokens": 100,
            "outputTokens": 200,
            "cacheReadTokens": 50,
            "cacheWriteTokens": 25,
            "raw": {
                "chatModel": {
                    "chatStartMetadata": {
                        "createdAt": "2026-04-12T10:00:00Z"
                    }
                }
            }
        });
        let mut file = std::fs::File::create(usage_path).unwrap();
        file.write_all(serde_json::to_string(&record).unwrap().as_bytes())
            .unwrap();
    }

    #[test]
    fn test_extract_log_tool_names_maps_overlay_actions() {
        let dir = TempDir::new().unwrap();
        let log_path = dir.path().join("ls-main.log");
        std::fs::write(
            &log_path,
            concat!(
                "I0414 operator.go:899] [overlay] Running JS: ",
                "window.updateActuationOverlay({\"cascadeId\":\"session-123\",",
                "\"displayString\":\"Getting DOM...\",\"passthroughEnabled\":true})\n",
                "I0414 operator.go:899] [overlay] Running JS: ",
                "window.updateActuationOverlay({\"cascadeId\":\"session-123\",",
                "\"displayString\":\"Clicking...\",\"passthroughEnabled\":false})\n",
                "I0414 operator.go:899] [overlay] Running JS: ",
                "window.updateActuationOverlay({\"cascadeId\":\"other-session\",",
                "\"displayString\":\"Taking screenshot...\",\"passthroughEnabled\":false})\n",
            ),
        )
        .unwrap();

        let tool_names = extract_log_tool_names(&log_path, "session-123");

        assert_eq!(
            tool_names,
            vec!["BrowserGetDom".to_string(), "BrowserClick".to_string(),]
        );
    }

    #[test]
    fn test_merge_tool_names_into_messages_appends_tool_use_blocks() {
        let messages = vec![ClaudeMessage {
            uuid: "assistant-1".to_string(),
            parent_uuid: None,
            session_id: "session-123".to_string(),
            timestamp: "2026-04-12T10:00:00Z".to_string(),
            message_type: "assistant".to_string(),
            content: Some(json!([{ "type": "text", "text": "base" }])),
            usage: None,
            provider: Some("antigravity".to_string()),
            message_id: None,
            project_name: None,
            tool_use: None,
            tool_use_result: None,
            is_sidechain: None,
            role: Some("assistant".to_string()),
            model: None,
            stop_reason: None,
            cost_usd: None,
            duration_ms: None,
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
        }];

        let merged = merge_tool_names_into_messages(
            messages,
            "session-123",
            &["BrowserGetDom".to_string(), "BrowserClick".to_string()],
        );

        let content = merged[0]
            .content
            .as_ref()
            .and_then(Value::as_array)
            .unwrap();
        assert_eq!(content.len(), 3);
        assert_eq!(content[1]["type"], "tool_use");
        assert_eq!(content[1]["name"], "BrowserGetDom");
        assert_eq!(content[2]["name"], "BrowserClick");
    }

    #[test]
    fn test_search_matches_session_id() {
        let dir = TempDir::new().unwrap();
        let cache_root = dir.path().join("rpc-cache").join("v1");
        std::fs::create_dir_all(&cache_root).unwrap();

        // Create a session dir that matches "abc123" query
        let session_dir = cache_root.join("abc123-def456");
        std::fs::create_dir(&session_dir).unwrap();
        make_usage_file(&session_dir, "abc123-def456", "claude-opus-4-5");

        // Override the RPC root for this test by patching get_rpc_cache_root
        let results = search_in_dir("abc123", 10, &cache_root);
        assert!(!results.is_empty());
        assert_eq!(results[0].session_id, "abc123-def456");
        assert_eq!(results[0].provider.as_deref(), Some("antigravity"));
    }

    #[test]
    fn test_search_matches_model_name() {
        let dir = TempDir::new().unwrap();
        let cache_root = dir.path().join("rpc-cache").join("v1");
        std::fs::create_dir_all(&cache_root).unwrap();

        // Session ID doesn't match, but model does
        let session_dir = cache_root.join("xyz789-no-match");
        std::fs::create_dir(&session_dir).unwrap();
        make_usage_file(&session_dir, "xyz789-no-match", "claude-sonnet-4-6");

        let results = search_in_dir("sonnet", 10, &cache_root);
        assert!(!results.is_empty());
        assert_eq!(results[0].session_id, "xyz789-no-match");
    }

    #[test]
    fn test_search_no_match() {
        let dir = TempDir::new().unwrap();
        let cache_root = dir.path().join("rpc-cache").join("v1");
        std::fs::create_dir_all(&cache_root).unwrap();

        let session_dir = cache_root.join("session-abc");
        std::fs::create_dir(&session_dir).unwrap();
        make_usage_file(&session_dir, "session-abc", "claude-opus-4-5");

        let results = search_in_dir("nonexistent-query", 10, &cache_root);
        assert!(results.is_empty());
    }

    #[test]
    fn test_search_respects_max_results() {
        let dir = TempDir::new().unwrap();
        let cache_root = dir.path().join("rpc-cache").join("v1");
        std::fs::create_dir_all(&cache_root).unwrap();

        for i in 0..5 {
            let session_dir = cache_root.join(format!("session-{i:03}"));
            std::fs::create_dir(&session_dir).unwrap();
            make_usage_file(&session_dir, &format!("session-{i:03}"), "claude");
        }

        let results = search_in_dir("session", 3, &cache_root);
        assert_eq!(results.len(), 3);
    }

    /// Search helper that bypasses `get_rpc_cache_root` (which uses real home dir).
    fn search_in_dir(
        query: &str,
        max_results: usize,
        cache_root: &std::path::Path,
    ) -> Vec<ClaudeMessage> {
        let query_lower = query.to_lowercase();
        let mut results = Vec::new();

        let entries = match std::fs::read_dir(cache_root) {
            Ok(e) => e,
            Err(_) => return vec![],
        };

        for entry in entries.filter_map(std::result::Result::ok) {
            if results.len() >= max_results {
                break;
            }

            if !entry.path().is_dir() {
                continue;
            }

            let session_id = entry.file_name().to_string_lossy().to_string();
            let session_matches = session_id.to_lowercase().contains(&query_lower);

            let usage_path = entry.path().join("usage.jsonl");
            let mut model_match = false;
            let mut last_timestamp = String::new();

            if usage_path.exists() {
                if let Ok(content) = std::fs::read_to_string(&usage_path) {
                    for line in content.lines().take(100) {
                        if let Ok(rec) = serde_json::from_str::<Value>(line) {
                            if rec["recordType"].as_str() != Some("usage") {
                                continue;
                            }
                            if let Some(model) = rec["model"].as_str() {
                                if model.to_lowercase().contains(&query_lower) {
                                    model_match = true;
                                }
                            }
                            if last_timestamp.is_empty() {
                                last_timestamp = rec["raw"]["chatModel"]["chatStartMetadata"]
                                    ["createdAt"]
                                    .as_str()
                                    .unwrap_or("1970-01-01T00:00:00Z")
                                    .to_string();
                            }
                        }
                    }
                }
            }

            if !session_matches && !model_match {
                continue;
            }

            let short_id: String = session_id.chars().take(8).collect();
            let content_text = if session_matches {
                format!("Session: {session_id}")
            } else {
                format!("Session: {short_id} (matched model)")
            };

            results.push(ClaudeMessage {
                uuid: format!("ag-search-{}-{}", session_id, 0),
                parent_uuid: None,
                session_id: session_id.clone(),
                timestamp: last_timestamp,
                message_type: "assistant".to_string(),
                content: Some(json!([{ "type": "text", "text": content_text }])),
                usage: None,
                provider: Some("antigravity".to_string()),
                message_id: None,
                project_name: None,
                tool_use: None,
                tool_use_result: None,
                is_sidechain: None,
                role: Some("assistant".to_string()),
                model: None,
                stop_reason: None,
                cost_usd: None,
                duration_ms: None,
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
            });
        }

        results.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        results.truncate(max_results);
        results
    }
}
