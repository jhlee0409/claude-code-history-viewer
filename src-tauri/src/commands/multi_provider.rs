use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::providers;
use serde_json::Value;

/// Detect all available providers
#[tauri::command]
pub async fn detect_providers() -> Result<Vec<providers::ProviderInfo>, String> {
    Ok(providers::detect_providers())
}

/// Scan projects from all (or selected) providers
#[tauri::command]
pub async fn scan_all_projects(
    claude_path: Option<String>,
    active_providers: Option<Vec<String>>,
) -> Result<Vec<ClaudeProject>, String> {
    let providers_to_scan = active_providers.unwrap_or_else(|| {
        vec![
            "claude".to_string(),
            "codex".to_string(),
            "opencode".to_string(),
        ]
    });

    let mut all_projects = Vec::new();

    // Claude
    if providers_to_scan.iter().any(|p| p == "claude") {
        let claude_base = claude_path.or_else(providers::claude::get_base_path);
        if let Some(base) = claude_base {
            match crate::commands::project::scan_projects(base).await {
                Ok(mut projects) => {
                    for p in &mut projects {
                        if p.provider.is_none() {
                            p.provider = Some("claude".to_string());
                        }
                    }
                    all_projects.extend(projects);
                }
                Err(e) => {
                    #[cfg(debug_assertions)]
                    eprintln!("Claude scan failed: {e}");
                }
            }
        }
    }

    // Codex
    if providers_to_scan.iter().any(|p| p == "codex") {
        match providers::codex::scan_projects() {
            Ok(projects) => all_projects.extend(projects),
            Err(e) => {
                #[cfg(debug_assertions)]
                eprintln!("Codex scan failed: {e}");
            }
        }
    }

    // OpenCode
    if providers_to_scan.iter().any(|p| p == "opencode") {
        match providers::opencode::scan_projects() {
            Ok(projects) => all_projects.extend(projects),
            Err(e) => {
                #[cfg(debug_assertions)]
                eprintln!("OpenCode scan failed: {e}");
            }
        }
    }

    all_projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(all_projects)
}

/// Load sessions for a specific provider's project
#[tauri::command]
pub async fn load_provider_sessions(
    provider: String,
    project_path: String,
    exclude_sidechain: Option<bool>,
) -> Result<Vec<ClaudeSession>, String> {
    let exclude = exclude_sidechain.unwrap_or(false);

    match provider.as_str() {
        "claude" => {
            let mut sessions =
                crate::commands::session::load_project_sessions(project_path, Some(exclude))
                    .await?;
            for s in &mut sessions {
                if s.provider.is_none() {
                    s.provider = Some("claude".to_string());
                }
            }
            Ok(sessions)
        }
        "codex" => providers::codex::load_sessions(&project_path, exclude),
        "opencode" => providers::opencode::load_sessions(&project_path, exclude),
        _ => Err(format!("Unknown provider: {provider}")),
    }
}

/// Load messages from a specific provider's session
#[tauri::command]
pub async fn load_provider_messages(
    provider: String,
    session_path: String,
) -> Result<Vec<ClaudeMessage>, String> {
    let messages = match provider.as_str() {
        "claude" => {
            let mut messages =
                crate::commands::session::load_session_messages(session_path).await?;
            for m in &mut messages {
                if m.provider.is_none() {
                    m.provider = Some("claude".to_string());
                }
            }
            messages
        }
        "codex" => providers::codex::load_messages(&session_path)?,
        "opencode" => providers::opencode::load_messages(&session_path)?,
        _ => return Err(format!("Unknown provider: {provider}")),
    };

    Ok(merge_tool_execution_messages(messages))
}

/// Search across all (or selected) providers
#[tauri::command]
pub async fn search_all_providers(
    claude_path: Option<String>,
    query: String,
    active_providers: Option<Vec<String>>,
    filters: Option<Value>,
    limit: Option<usize>,
) -> Result<Vec<ClaudeMessage>, String> {
    let max_results = limit.unwrap_or(100);
    let search_filters =
        filters.unwrap_or_else(|| serde_json::Value::Object(serde_json::Map::default()));
    let providers_to_search = active_providers.unwrap_or_else(|| {
        vec![
            "claude".to_string(),
            "codex".to_string(),
            "opencode".to_string(),
        ]
    });

    let mut all_results = Vec::new();

    // Claude
    if providers_to_search.iter().any(|p| p == "claude") {
        let claude_base = claude_path.or_else(providers::claude::get_base_path);
        if let Some(base) = claude_base {
            match crate::commands::session::search_messages(
                base,
                query.clone(),
                search_filters.clone(),
                Some(max_results),
            )
            .await
            {
                Ok(mut results) => {
                    for m in &mut results {
                        if m.provider.is_none() {
                            m.provider = Some("claude".to_string());
                        }
                    }
                    all_results.extend(results);
                }
                Err(e) => {
                    #[cfg(debug_assertions)]
                    eprintln!("Claude search failed: {e}");
                }
            }
        }
    }

    // Codex
    if providers_to_search.iter().any(|p| p == "codex") {
        match providers::codex::search(&query, max_results) {
            Ok(results) => all_results.extend(results),
            Err(e) => {
                #[cfg(debug_assertions)]
                eprintln!("Codex search failed: {e}");
            }
        }
    }

    // OpenCode
    if providers_to_search.iter().any(|p| p == "opencode") {
        match providers::opencode::search(&query, max_results) {
            Ok(results) => all_results.extend(results),
            Err(e) => {
                #[cfg(debug_assertions)]
                eprintln!("OpenCode search failed: {e}");
            }
        }
    }

    all_results = crate::commands::session::apply_search_filters(all_results, &search_filters);

    // Sort by timestamp descending
    all_results.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    all_results.truncate(max_results);

    Ok(all_results)
}

fn merge_tool_execution_messages(messages: Vec<ClaudeMessage>) -> Vec<ClaudeMessage> {
    let mut merged: Vec<ClaudeMessage> = Vec::with_capacity(messages.len());

    for msg in messages {
        let tool_results = extract_tool_results_from_message(&msg);
        if tool_results.is_empty() {
            merged.push(msg);
            continue;
        }

        let mut did_merge = false;
        for (tool_use_id, tool_result_block) in &tool_results {
            for prev in merged.iter_mut().rev() {
                if has_matching_tool_use(prev, tool_use_id) {
                    append_content_block(prev, tool_result_block.clone());
                    did_merge = true;
                    break;
                }
            }
        }

        if !did_merge {
            merged.push(msg);
        }
    }

    merged
}

fn extract_tool_results_from_message(msg: &ClaudeMessage) -> Vec<(String, Value)> {
    if msg.message_type != "user" {
        return Vec::new();
    }

    let Some(arr) = msg.content.as_ref().and_then(Value::as_array) else {
        return Vec::new();
    };

    arr.iter()
        .filter_map(|item| {
            if item.get("type").and_then(Value::as_str) != Some("tool_result") {
                return None;
            }
            let tool_use_id = item.get("tool_use_id").and_then(Value::as_str)?.to_string();
            Some((tool_use_id, item.clone()))
        })
        .collect()
}

fn has_matching_tool_use(msg: &ClaudeMessage, tool_use_id: &str) -> bool {
    if msg.message_type != "assistant" {
        return false;
    }

    let Some(arr) = msg.content.as_ref().and_then(Value::as_array) else {
        return false;
    };
    arr.iter().any(|item| {
        item.get("type").and_then(Value::as_str) == Some("tool_use")
            && item.get("id").and_then(Value::as_str) == Some(tool_use_id)
    })
}

fn append_content_block(msg: &mut ClaudeMessage, block: Value) {
    match &mut msg.content {
        Some(Value::Array(arr)) => arr.push(block),
        _ => msg.content = Some(Value::Array(vec![block])),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_message(message_type: &str, content: Value) -> ClaudeMessage {
        ClaudeMessage {
            uuid: format!("{message_type}-id"),
            parent_uuid: None,
            session_id: "session-1".to_string(),
            timestamp: "2026-02-19T12:00:00Z".to_string(),
            message_type: message_type.to_string(),
            content: Some(content),
            project_name: None,
            tool_use: None,
            tool_use_result: None,
            is_sidechain: None,
            usage: None,
            role: Some(message_type.to_string()),
            model: None,
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
            provider: Some("claude".to_string()),
        }
    }

    #[test]
    fn merge_tool_result_into_previous_tool_use_message() {
        let tool_use = make_message(
            "assistant",
            serde_json::json!([{
                "type": "tool_use",
                "id": "call_123",
                "name": "Bash",
                "input": { "command": "pwd" }
            }]),
        );
        let tool_result = make_message(
            "user",
            serde_json::json!([{
                "type": "tool_result",
                "tool_use_id": "call_123",
                "content": "ok"
            }]),
        );

        let merged = merge_tool_execution_messages(vec![tool_use, tool_result]);
        assert_eq!(merged.len(), 1);
        let arr = merged[0]
            .content
            .as_ref()
            .and_then(Value::as_array)
            .expect("merged content should be array");
        assert_eq!(arr.len(), 2);
        assert_eq!(
            arr[1].get("type").and_then(Value::as_str),
            Some("tool_result")
        );
    }

    #[test]
    fn merge_multiple_tool_results_from_single_message() {
        let tool_use = make_message(
            "assistant",
            serde_json::json!([
                {
                    "type": "tool_use",
                    "id": "call_1",
                    "name": "Bash",
                    "input": { "command": "pwd" }
                },
                {
                    "type": "tool_use",
                    "id": "call_2",
                    "name": "Bash",
                    "input": { "command": "ls" }
                }
            ]),
        );
        let tool_result = make_message(
            "user",
            serde_json::json!([
                {
                    "type": "tool_result",
                    "tool_use_id": "call_1",
                    "content": "ok-1"
                },
                {
                    "type": "tool_result",
                    "tool_use_id": "call_2",
                    "content": "ok-2"
                }
            ]),
        );

        let merged = merge_tool_execution_messages(vec![tool_use, tool_result]);
        assert_eq!(merged.len(), 1);
        let arr = merged[0]
            .content
            .as_ref()
            .and_then(Value::as_array)
            .expect("merged content should be array");
        assert_eq!(arr.len(), 4);
    }
}
