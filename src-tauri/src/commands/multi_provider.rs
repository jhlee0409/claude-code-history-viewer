use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession, ProjectSource};
use crate::providers;
use crate::utils::parse_rfc3339_utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cmp::Ordering;

/// Parameter for passing custom Claude paths from frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomClaudePathParam {
    pub path: String,
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<ProjectSource>,
}

fn custom_path_matches_provider(custom: &CustomClaudePathParam, provider_dirs: &[&str]) -> bool {
    let path = std::path::Path::new(&custom.path);
    let file_name = path.file_name().and_then(|s| s.to_str());
    let parent_name = path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|s| s.to_str());

    let mut string_segments = custom
        .path
        .trim_end_matches(['/', '\\'])
        .split(['/', '\\'])
        .filter(|segment| !segment.is_empty())
        .rev();
    let string_file_name = string_segments.next();
    let string_parent_name = string_segments.next();

    provider_dirs.iter().any(|provider_dir| {
        file_name == Some(*provider_dir)
            || parent_name == Some(*provider_dir)
            || string_file_name == Some(*provider_dir)
            || string_parent_name == Some(*provider_dir)
    })
}

fn project_dedupe_key(project: &ClaudeProject) -> Option<(String, String)> {
    let provider = project.provider.clone()?;
    if provider == "opencode" && project.path.starts_with("opencode+path://") {
        return Some((provider, project.path.to_lowercase()));
    }

    let actual = project.actual_path.trim();
    if actual.is_empty() {
        return None;
    }
    Some((provider, actual.replace('\\', "/").to_lowercase()))
}

fn dedupe_injected_projects(projects: Vec<ClaudeProject>) -> Vec<ClaudeProject> {
    let mut preferred: std::collections::HashMap<(String, String), usize> =
        std::collections::HashMap::new();
    let mut deduped: Vec<ClaudeProject> = Vec::new();

    for project in projects {
        let Some(key) = project_dedupe_key(&project) else {
            deduped.push(project);
            continue;
        };

        if let Some(existing_idx) = preferred.get(&key).copied() {
            let existing_is_injected = deduped[existing_idx].source.is_some()
                || deduped[existing_idx].custom_directory_label.is_some();
            let candidate_is_local =
                project.source.is_none() && project.custom_directory_label.is_none();

            if existing_is_injected && candidate_is_local {
                deduped[existing_idx] = project;
            } else {
                let existing = &mut deduped[existing_idx];
                existing.session_count = existing.session_count.max(project.session_count);
                existing.message_count = existing.message_count.max(project.message_count);
                if project.last_modified > existing.last_modified {
                    existing.last_modified = project.last_modified;
                }
            }
        } else {
            preferred.insert(key, deduped.len());
            deduped.push(project);
        }
    }

    deduped
}

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
    custom_claude_paths: Option<Vec<CustomClaudePathParam>>,
    wsl_enabled: Option<bool>,
    wsl_excluded_distros: Option<Vec<String>>,
) -> Result<Vec<ClaudeProject>, String> {
    let providers_to_scan = active_providers.unwrap_or_else(|| {
        vec![
            "claude".to_string(),
            "codex".to_string(),
            "gemini".to_string(),
            "forgecode".to_string(),
            "opencode".to_string(),
            "cline".to_string(),
            "cursor".to_string(),
            "aider".to_string(),
            "antigravity".to_string(),
        ]
    });

    let mut all_projects = Vec::new();

    // Claude (default path)
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
                    log::warn!("Claude scan failed: {e}");
                }
            }
        }

        // Claude (custom paths)
        if let Some(ref custom_paths) = custom_claude_paths {
            for custom in custom_paths {
                let custom_base = std::path::PathBuf::from(&custom.path);
                if let Err(e) = crate::utils::validate_custom_claude_path(&custom_base) {
                    log::warn!("Skipping invalid custom Claude path: {e}");
                    continue;
                }
                match crate::commands::project::scan_projects(custom.path.clone()).await {
                    Ok(mut projects) => {
                        for p in &mut projects {
                            if p.provider.is_none() {
                                p.provider = Some("claude".to_string());
                            }
                            p.custom_directory_label.clone_from(&custom.label);
                            p.source.clone_from(&custom.source);
                        }
                        all_projects.extend(projects);
                    }
                    Err(e) => {
                        log::warn!("Custom Claude path scan failed ({}): {e}", custom.path);
                    }
                }
            }
        }
    }

    // Codex
    if providers_to_scan.iter().any(|p| p == "codex") {
        match providers::codex::scan_projects() {
            Ok(projects) => all_projects.extend(projects),
            Err(e) => {
                log::warn!("Codex scan failed: {e}");
            }
        }
        if let Some(ref custom_paths) = custom_claude_paths {
            for custom in custom_paths
                .iter()
                .filter(|custom| custom_path_matches_provider(custom, &[".codex"]))
            {
                match providers::codex::scan_projects_from_path(&custom.path) {
                    Ok(mut projects) => {
                        for p in &mut projects {
                            p.custom_directory_label.clone_from(&custom.label);
                            p.source.clone_from(&custom.source);
                        }
                        all_projects.extend(projects);
                    }
                    Err(e) => {
                        log::warn!("Custom Codex path scan failed ({}): {e}", custom.path);
                    }
                }
            }
        }
    }

    // Gemini
    if providers_to_scan.iter().any(|p| p == "gemini") {
        match providers::gemini::scan_projects() {
            Ok(projects) => all_projects.extend(projects),
            Err(e) => {
                log::warn!("Gemini scan failed: {e}");
            }
        }
    }

    // ForgeCode
    if providers_to_scan.iter().any(|p| p == "forgecode") {
        match providers::forgecode::scan_projects() {
            Ok(projects) => all_projects.extend(projects),
            Err(e) => {
                log::warn!("ForgeCode scan failed: {e}");
            }
        }
    }

    // OpenCode
    if providers_to_scan.iter().any(|p| p == "opencode") {
        match providers::opencode::scan_projects() {
            Ok(projects) => all_projects.extend(projects),
            Err(e) => {
                log::warn!("OpenCode scan failed: {e}");
            }
        }
        if let Some(ref custom_paths) = custom_claude_paths {
            for custom in custom_paths
                .iter()
                .filter(|custom| custom_path_matches_provider(custom, &["opencode", ".opencode"]))
            {
                match providers::opencode::scan_projects_from_path(&custom.path) {
                    Ok(projects) => {
                        let mut projects =
                            providers::opencode::scope_projects_to_base(projects, &custom.path);
                        for p in &mut projects {
                            p.custom_directory_label.clone_from(&custom.label);
                            p.source.clone_from(&custom.source);
                        }
                        all_projects.extend(projects);
                    }
                    Err(e) => {
                        log::warn!("Custom OpenCode path scan failed ({}): {e}", custom.path);
                    }
                }
            }
        }
    }

    // Cline
    if providers_to_scan.iter().any(|p| p == "cline") {
        match providers::cline::scan_projects() {
            Ok(projects) => all_projects.extend(projects),
            Err(e) => {
                log::warn!("Cline scan failed: {e}");
            }
        }
    }

    // Cursor
    if providers_to_scan.iter().any(|p| p == "cursor") {
        match providers::cursor::scan_projects() {
            Ok(projects) => all_projects.extend(projects),
            Err(e) => {
                log::warn!("Cursor scan failed: {e}");
            }
        }
    }

    // Aider
    if providers_to_scan.iter().any(|p| p == "aider") {
        match providers::aider::scan_projects() {
            Ok(projects) => all_projects.extend(projects),
            Err(e) => {
                log::warn!("Aider scan failed: {e}");
            }
        }
    }

    // Antigravity
    if providers_to_scan.iter().any(|p| p == "antigravity") {
        match providers::antigravity::scan_projects() {
            Ok(projects) => all_projects.extend(projects),
            Err(e) => {
                log::warn!("Antigravity scan failed: {e}");
            }
        }
    }

    // WSL scanning (Claude only — other providers' load_sessions/load_messages
    // use native base paths internally, so WSL projects would be visible but
    // not loadable. Extending other providers requires base-path-aware loaders.)
    if wsl_enabled.unwrap_or(false) && providers_to_scan.iter().any(|p| p == "claude") {
        let excluded = wsl_excluded_distros.unwrap_or_default();

        for (distro, home_path) in resolve_active_wsl_distros(&excluded) {
            let wsl_label = format!("WSL: {}", distro.name);
            let wsl_source = ProjectSource {
                id: format!("wsl:{}", distro.name),
                kind: "wsl".to_string(),
                display_label: wsl_label.clone(),
                debug_label: Some(format!("WSL distro {}", distro.name)),
            };
            let claude_linux_path = home_path.join(".claude");

            let unc_path =
                match crate::wsl::resolve_wsl_provider_path(&distro.name, &claude_linux_path) {
                    Some(p) => p,
                    None => continue,
                };

            let unc_str = unc_path.to_string_lossy().to_string();
            match crate::commands::project::scan_projects(unc_str).await {
                Ok(mut projects) => {
                    for p in &mut projects {
                        if p.provider.is_none() {
                            p.provider = Some("claude".to_string());
                        }
                        p.custom_directory_label = Some(wsl_label.clone());
                        p.source = Some(wsl_source.clone());
                    }
                    all_projects.extend(projects);
                }
                Err(e) => {
                    log::warn!("WSL: Claude scan failed for '{}': {e}", distro.name);
                }
            }
        }
    }

    // Hide empty containers that have no session files regardless of provider.
    all_projects.retain(|project| project.session_count > 0);
    all_projects = dedupe_injected_projects(all_projects);

    all_projects.sort_by(|a, b| {
        match (
            parse_rfc3339_utc(&a.last_modified),
            parse_rfc3339_utc(&b.last_modified),
        ) {
            (Some(a_ts), Some(b_ts)) => b_ts.cmp(&a_ts),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => b.last_modified.cmp(&a.last_modified),
        }
    });
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
        "gemini" => providers::gemini::load_sessions(&project_path, exclude),
        "forgecode" => providers::forgecode::load_sessions(&project_path, exclude),
        "opencode" => providers::opencode::load_sessions(&project_path, exclude),
        "cline" => providers::cline::load_sessions(&project_path, exclude),
        "cursor" => providers::cursor::load_sessions(&project_path, exclude),
        "aider" => providers::aider::load_sessions(&project_path, exclude),
        "antigravity" => providers::antigravity::load_sessions(&project_path, exclude),
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
        "gemini" => providers::gemini::load_messages(&session_path)?,
        "forgecode" => providers::forgecode::load_messages(&session_path)?,
        "opencode" => providers::opencode::load_messages(&session_path)?,
        "cline" => providers::cline::load_messages(&session_path)?,
        "cursor" => providers::cursor::load_messages(&session_path)?,
        "aider" => providers::aider::load_messages(&session_path)?,
        "antigravity" => providers::antigravity::load_messages(&session_path)?,
        _ => return Err(format!("Unknown provider: {provider}")),
    };

    Ok(merge_tool_execution_messages(messages))
}

/// Search across all (or selected) providers
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn search_all_providers(
    claude_path: Option<String>,
    query: String,
    active_providers: Option<Vec<String>>,
    filters: Option<Value>,
    limit: Option<usize>,
    custom_claude_paths: Option<Vec<CustomClaudePathParam>>,
    wsl_enabled: Option<bool>,
    wsl_excluded_distros: Option<Vec<String>>,
) -> Result<Vec<ClaudeMessage>, String> {
    let max_results = limit.unwrap_or(100);
    let search_filters =
        filters.unwrap_or_else(|| serde_json::Value::Object(serde_json::Map::default()));
    crate::commands::session::validate_search_filters(&search_filters)?;

    let providers_to_search = active_providers.unwrap_or_else(|| {
        vec![
            "claude".to_string(),
            "codex".to_string(),
            "gemini".to_string(),
            "forgecode".to_string(),
            "opencode".to_string(),
            "cline".to_string(),
            "cursor".to_string(),
            "aider".to_string(),
            "antigravity".to_string(),
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
                    log::warn!("Claude search failed: {e}");
                }
            }
        }

        // Claude search (custom paths)
        if let Some(ref custom_paths) = custom_claude_paths {
            for custom in custom_paths {
                let custom_base = std::path::PathBuf::from(&custom.path);
                if crate::utils::validate_custom_claude_path(&custom_base).is_err() {
                    continue;
                }
                match crate::commands::session::search_messages(
                    custom.path.clone(),
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
                        log::warn!("Custom Claude path search failed ({}): {e}", custom.path);
                    }
                }
            }
        }
    }

    // Codex
    if providers_to_search.iter().any(|p| p == "codex") {
        match providers::codex::search(&query, max_results) {
            Ok(results) => all_results.extend(results),
            Err(e) => {
                log::warn!("Codex search failed: {e}");
            }
        }
    }

    // Gemini
    if providers_to_search.iter().any(|p| p == "gemini") {
        match providers::gemini::search(&query, max_results) {
            Ok(results) => all_results.extend(results),
            Err(e) => {
                log::warn!("Gemini search failed: {e}");
            }
        }
    }

    // ForgeCode
    if providers_to_search.iter().any(|p| p == "forgecode") {
        match providers::forgecode::search(&query, max_results) {
            Ok(results) => all_results.extend(results),
            Err(e) => {
                log::warn!("ForgeCode search failed: {e}");
            }
        }
    }

    // OpenCode
    if providers_to_search.iter().any(|p| p == "opencode") {
        match providers::opencode::search(&query, max_results) {
            Ok(results) => all_results.extend(results),
            Err(e) => {
                log::warn!("OpenCode search failed: {e}");
            }
        }
    }

    // Cline
    if providers_to_search.iter().any(|p| p == "cline") {
        match providers::cline::search(&query, max_results) {
            Ok(results) => all_results.extend(results),
            Err(e) => {
                log::warn!("Cline search failed: {e}");
            }
        }
    }

    // Cursor
    if providers_to_search.iter().any(|p| p == "cursor") {
        match providers::cursor::search(&query, max_results) {
            Ok(results) => all_results.extend(results),
            Err(e) => {
                log::warn!("Cursor search failed: {e}");
            }
        }
    }

    // Aider
    if providers_to_search.iter().any(|p| p == "aider") {
        match providers::aider::search(&query, max_results) {
            Ok(results) => all_results.extend(results),
            Err(e) => {
                log::warn!("Aider search failed: {e}");
            }
        }
    }

    // Antigravity
    if providers_to_search.iter().any(|p| p == "antigravity") {
        match providers::antigravity::search(&query, max_results) {
            Ok(results) => all_results.extend(results),
            Err(e) => {
                log::warn!("Antigravity search failed: {e}");
            }
        }
    }

    // WSL search (currently Claude only)
    if wsl_enabled.unwrap_or(false) && providers_to_search.iter().any(|p| p == "claude") {
        let excluded = wsl_excluded_distros.unwrap_or_default();

        for (distro, home_path) in resolve_active_wsl_distros(&excluded) {
            let claude_linux_path = home_path.join(".claude");
            if let Some(unc_path) =
                crate::wsl::resolve_wsl_provider_path(&distro.name, &claude_linux_path)
            {
                let unc_str = unc_path.to_string_lossy().to_string();
                match crate::commands::session::search_messages(
                    unc_str,
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
                        log::warn!("WSL Claude search failed for '{}': {e}", distro.name);
                    }
                }
            }
        }
    }

    all_results = crate::commands::session::apply_search_filters(all_results, &search_filters);

    // Sort by parsed timestamp descending (robust to `Z` vs `+00:00` formats)
    all_results.sort_by(|a, b| {
        match (
            parse_rfc3339_utc(&a.timestamp),
            parse_rfc3339_utc(&b.timestamp),
        ) {
            (Some(a_ts), Some(b_ts)) => b_ts.cmp(&a_ts),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => b.timestamp.cmp(&a.timestamp),
        }
    });
    all_results.truncate(max_results);

    Ok(all_results)
}

/// Resolve active (non-excluded) WSL distros with their home paths.
fn resolve_active_wsl_distros(
    excluded: &[String],
) -> Vec<(crate::wsl::WslDistro, std::path::PathBuf)> {
    let distros = crate::wsl::detect_distros();
    let mut result = Vec::new();
    for distro in distros {
        if excluded.contains(&distro.name) {
            continue;
        }
        match crate::wsl::resolve_home_path(&distro.name) {
            Ok(home) => result.push((distro, home)),
            Err(e) => {
                log::warn!("WSL: Could not resolve home for '{}': {e}", distro.name);
            }
        }
    }
    result
}

/// Merge adjacent tool execution messages into display-friendly message groups.
fn merge_tool_execution_messages(messages: Vec<ClaudeMessage>) -> Vec<ClaudeMessage> {
    let mut merged: Vec<ClaudeMessage> = Vec::with_capacity(messages.len());

    for msg in messages {
        if msg.message_type != "user" {
            merged.push(msg);
            continue;
        }

        let Some(content_arr) = msg.content.as_ref().and_then(Value::as_array) else {
            merged.push(msg);
            continue;
        };

        let mut saw_tool_result = false;
        let mut remaining_blocks: Vec<Value> = Vec::with_capacity(content_arr.len());

        for block in content_arr {
            if block.get("type").and_then(Value::as_str) != Some("tool_result") {
                remaining_blocks.push(block.clone());
                continue;
            }

            saw_tool_result = true;
            let Some(tool_use_id) = block.get("tool_use_id").and_then(Value::as_str) else {
                remaining_blocks.push(block.clone());
                continue;
            };

            let mut merged_this_result = false;
            for prev in merged.iter_mut().rev() {
                if has_matching_tool_use(prev, tool_use_id) {
                    append_content_block(prev, block.clone());
                    merged_this_result = true;
                    break;
                }
            }

            if !merged_this_result {
                remaining_blocks.push(block.clone());
            }
        }

        if !saw_tool_result {
            merged.push(msg);
            continue;
        }

        if !remaining_blocks.is_empty() {
            let mut remaining_msg = msg;
            remaining_msg.content = Some(Value::Array(remaining_blocks));
            merged.push(remaining_msg);
        }
    }

    merged
}

/// Return whether two messages belong to the same tool execution.
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

/// Append a content block to a message content array.
fn append_content_block(msg: &mut ClaudeMessage, block: Value) {
    match &mut msg.content {
        Some(Value::Array(arr)) => arr.push(block),
        _ => msg.content = Some(Value::Array(vec![block])),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Create a normalized message value for merged tool output.
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

    fn make_project(path: &str, source: Option<ProjectSource>) -> ClaudeProject {
        ClaudeProject {
            name: "project".to_string(),
            path: path.to_string(),
            actual_path: "C:/work/project".to_string(),
            session_count: 1,
            message_count: 1,
            last_modified: "2026-05-15T00:00:00Z".to_string(),
            git_info: None,
            provider: Some("claude".to_string()),
            storage_type: Some("json".to_string()),
            custom_directory_label: source.as_ref().map(|_| "Remote".to_string()),
            source,
        }
    }

    #[test]
    fn dedupe_injected_projects_prefers_local_project() {
        let remote = make_project(
            "/cache/.claude/worker/projects/-C-work-project",
            Some(ProjectSource {
                id: "remote-1".to_string(),
                kind: "podman-container".to_string(),
                display_label: "Podman".to_string(),
                debug_label: None,
            }),
        );
        let local = make_project("C:/Users/Proud/.claude/projects/-C-work-project", None);

        let deduped = dedupe_injected_projects(vec![remote, local]);

        assert_eq!(deduped.len(), 1);
        assert!(deduped[0].source.is_none());
        assert_eq!(
            deduped[0].path,
            "C:/Users/Proud/.claude/projects/-C-work-project"
        );
    }

    #[test]
    fn dedupe_keeps_scoped_opencode_global_projects() {
        let default = ClaudeProject {
            name: "unknown".to_string(),
            path: "opencode://global".to_string(),
            actual_path: "/".to_string(),
            session_count: 3,
            message_count: 0,
            last_modified: "2026-05-15T00:00:00Z".to_string(),
            git_info: None,
            provider: Some("opencode".to_string()),
            storage_type: Some("sqlite".to_string()),
            custom_directory_label: None,
            source: None,
        };
        let scoped = ClaudeProject {
            path: "opencode+path://abc/global".to_string(),
            custom_directory_label: Some("Podman".to_string()),
            source: Some(ProjectSource {
                id: "podman".to_string(),
                kind: "podman-container".to_string(),
                display_label: "Podman".to_string(),
                debug_label: None,
            }),
            ..default.clone()
        };

        let deduped = dedupe_injected_projects(vec![default, scoped]);

        assert_eq!(deduped.len(), 2);
        assert!(deduped
            .iter()
            .any(|p| p.path.starts_with("opencode+path://")));
    }

    #[test]
    fn custom_path_provider_match_accepts_opencode_hidden_dir() {
        let custom = CustomClaudePathParam {
            path: "/root/.cc-slack-data/worker/.opencode".to_string(),
            label: None,
            source: None,
        };

        assert!(custom_path_matches_provider(
            &custom,
            &["opencode", ".opencode"]
        ));
        assert!(!custom_path_matches_provider(&custom, &[".codex"]));
    }

    #[test]
    fn custom_path_provider_match_accepts_unc_opencode_hidden_dir() {
        let custom = CustomClaudePathParam {
            path: r"\\wsl.localhost\Ubuntu-24.04\root\.cc-slack-data\worker\.opencode".to_string(),
            label: None,
            source: None,
        };

        assert!(custom_path_matches_provider(
            &custom,
            &["opencode", ".opencode"]
        ));
    }

    #[test]
    /// Merge a tool result message into the previous tool-use message when possible.
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
    /// Split and merge multiple tool results from a single provider message.
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

    #[test]
    /// Verify partial merging preserves unmerged and non-tool content.
    fn partial_merge_preserves_unmerged_and_non_tool_content() {
        let tool_use = make_message(
            "assistant",
            serde_json::json!([{
                "type": "tool_use",
                "id": "call_1",
                "name": "Bash",
                "input": { "command": "pwd" }
            }]),
        );
        let mixed_user = make_message(
            "user",
            serde_json::json!([
                { "type": "text", "text": "prefix" },
                { "type": "tool_result", "tool_use_id": "call_1", "content": "ok-1" },
                { "type": "tool_result", "tool_use_id": "missing_call", "content": "keep-me" },
                { "type": "text", "text": "suffix" }
            ]),
        );

        let merged = merge_tool_execution_messages(vec![tool_use, mixed_user]);
        assert_eq!(merged.len(), 2);

        let assistant_blocks = merged[0]
            .content
            .as_ref()
            .and_then(Value::as_array)
            .expect("assistant blocks should be array");
        assert_eq!(assistant_blocks.len(), 2);
        assert_eq!(
            assistant_blocks[1]
                .get("tool_use_id")
                .and_then(Value::as_str),
            Some("call_1")
        );

        let remaining_user_blocks = merged[1]
            .content
            .as_ref()
            .and_then(Value::as_array)
            .expect("remaining user blocks should be array");
        assert_eq!(remaining_user_blocks.len(), 3);
        assert_eq!(
            remaining_user_blocks[0].get("type").and_then(Value::as_str),
            Some("text")
        );
        assert_eq!(
            remaining_user_blocks[1]
                .get("tool_use_id")
                .and_then(Value::as_str),
            Some("missing_call")
        );
        assert_eq!(
            remaining_user_blocks[2].get("type").and_then(Value::as_str),
            Some("text")
        );
    }
}
