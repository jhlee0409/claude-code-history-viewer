use super::scan_report::ScanReport;
use super::ProviderInfo;
use crate::commands::antigravity::{
    antigravity_root_from_path, get_antigravity_rpc_cache_root, load_antigravity_state_impl,
    load_antigravity_state_reporting, resolve_antigravity_root,
};
use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Resolve an antigravity root for a user-supplied path.
///
/// Prefers walking up from `path` looking for the `.token-monitor/rpc-cache/v1`
/// marker so that arbitrary attacker-controlled paths are rejected. Falls back
/// to `resolve_antigravity_root()` only when the supplied path points at the
/// detected root (e.g. external state directories that have no rpc-cache yet).
fn marker_rooted_path(path: &str) -> Option<PathBuf> {
    if let Some(root) = antigravity_root_from_path(path) {
        if get_antigravity_rpc_cache_root(&root).exists()
            || root.join("conversation_summaries.db").is_file()
        {
            return Some(root);
        }
    }
    let detected = resolve_antigravity_root()?;
    let candidate = PathBuf::from(path);
    if candidate == detected || candidate.starts_with(&detected) {
        Some(detected)
    } else {
        None
    }
}

pub fn detect() -> Option<ProviderInfo> {
    let root = resolve_antigravity_root()?;
    let state = load_antigravity_state_impl(&root).ok();
    let rpc_cache_root = get_antigravity_rpc_cache_root(&root);
    let desktop_available = state
        .as_ref()
        .map(|state| !state.sessions.is_empty())
        .unwrap_or(false)
        || rpc_cache_root.exists()
        || root.join("brain").exists()
        || root.join("conversations").exists()
        || root.join("conversation_summaries.db").exists()
        || root.join("monitor-state.json").exists();
    // The antigravity-cli store (`~/.gemini/antigravity-cli`) is surfaced
    // through this same provider; a CLI-only install still counts.
    let cli_available = super::antigravity_cli::is_available();
    let base_path = if !desktop_available && cli_available {
        super::antigravity_cli::default_root()
            .unwrap_or_else(|| root.clone())
            .to_string_lossy()
            .to_string()
    } else {
        root.to_string_lossy().to_string()
    };

    Some(ProviderInfo {
        id: "antigravity".to_string(),
        display_name: "Antigravity".to_string(),
        base_path,
        is_available: desktop_available || cli_available,
    })
}

/// Metadata extracted from a session's `manifest.json` file.
struct ManifestInfo {
    /// Number of steps recorded in the session.
    step_count: usize,
}

/// Reads the `manifest.json` file from a session directory and extracts step count.
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

/// Converts a Unix timestamp in milliseconds to an RFC3339 string.
/// `pub(crate)` so the antigravity-cli layout module can reuse it.
pub(crate) fn ms_to_rfc3339(ms: u64) -> String {
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

/// Desktop projects plus any antigravity-cli workspace projects — both
/// layouts may coexist on one machine. A desktop scan failure degrades to
/// the CLI projects (and vice versa, the CLI side is tolerant by design)
/// rather than hiding one layout behind the other's error.
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    scan_projects_reporting(&ScanReport::default())
}

/// [`scan_projects`], recording in `report` what the desktop scan could not
/// read.
pub(crate) fn scan_projects_reporting(report: &ScanReport) -> Result<Vec<ClaudeProject>, String> {
    let cli_projects = super::antigravity_cli::scan_projects();
    match scan_desktop_projects(report) {
        Ok(mut projects) => {
            projects.extend(cli_projects);
            Ok(projects)
        }
        Err(err) if cli_projects.is_empty() => Err(err),
        Err(err) => {
            log::warn!("Antigravity desktop scan failed; returning CLI projects only: {err}");
            report.unread(&err);
            Ok(cli_projects)
        }
    }
}

/// Scheme prefix for workspace-grouped Antigravity IDE desktop projects.
pub(crate) const DESKTOP_SCHEME: &str = "antigravity://";

fn desktop_project_name_for_workspace(workspace: &str) -> String {
    Path::new(workspace)
        .file_name()
        .and_then(|n| n.to_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(workspace)
        .to_string()
}

fn resolve_desktop_session_workspace(
    session_id: &str,
    summaries: &std::collections::HashMap<
        String,
        crate::commands::antigravity::ConversationSummaryMeta,
    >,
    trajectories: &std::collections::HashMap<
        String,
        super::antigravity_state_sync::TrajectorySummary,
    >,
) -> Option<String> {
    summaries
        .get(session_id)
        .and_then(|m| m.workspace.clone())
        .or_else(|| {
            trajectories
                .get(session_id)
                .and_then(|t| t.workspace.clone())
        })
}

/// Group Antigravity IDE desktop sessions by workspace folder (`antigravity://<workspace>`),
/// falling back to a single `"Antigravity"` project for sessions without a recorded workspace.
fn scan_desktop_projects(report: &ScanReport) -> Result<Vec<ClaudeProject>, String> {
    let Some(root) = resolve_antigravity_root() else {
        return Ok(vec![]);
    };
    let state = load_antigravity_state_reporting(&root, report)?;
    if state.sessions.is_empty() {
        return Ok(vec![]);
    }

    let summaries = crate::commands::antigravity::load_conversation_summaries_map(&root);
    let trajectories = super::antigravity_state_sync::load();

    #[derive(Default)]
    struct GroupAcc {
        session_count: usize,
        message_count: usize,
        max_time_ms: u64,
    }

    let mut by_workspace: std::collections::HashMap<Option<String>, GroupAcc> =
        std::collections::HashMap::new();

    for (session_id, session) in &state.sessions {
        let ws = resolve_desktop_session_workspace(session_id, &summaries, &trajectories);
        let acc = by_workspace.entry(ws).or_default();
        acc.session_count += 1;
        acc.message_count += session.latest.message_count.unwrap_or(0) as usize;
        acc.max_time_ms = acc.max_time_ms.max(session.latest.last_modified_ms);
    }

    let root_str = root.to_string_lossy().to_string();
    let mut projects: Vec<ClaudeProject> = by_workspace
        .into_iter()
        .map(|(ws_opt, acc)| match ws_opt {
            Some(workspace) => ClaudeProject {
                name: desktop_project_name_for_workspace(&workspace),
                path: format!("{DESKTOP_SCHEME}{workspace}"),
                actual_path: workspace,
                session_count: acc.session_count,
                message_count: acc.message_count,
                last_modified: ms_to_rfc3339(acc.max_time_ms),
                git_info: None,
                provider: Some("antigravity".to_string()),
                storage_type: None,
                custom_directory_label: None,
            },
            None => ClaudeProject {
                name: "Antigravity".to_string(),
                path: root_str.clone(),
                actual_path: root_str.clone(),
                session_count: acc.session_count,
                message_count: acc.message_count,
                last_modified: ms_to_rfc3339(acc.max_time_ms),
                git_info: None,
                provider: Some("antigravity".to_string()),
                storage_type: None,
                custom_directory_label: None,
            },
        })
        .collect();

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

/// Clamps a `u64` value to `u32::MAX` and returns it as `u32`.
fn to_u32_saturating(value: u64) -> u32 {
    value.min(u64::from(u32::MAX)) as u32
}

/// Returns the platform-specific Antigravity logs root directory.
fn antigravity_logs_root() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join("Antigravity").join("logs"))
}

/// Maps an Antigravity overlay display string to a canonical tool name.
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

/// Extracts tool names from an Antigravity log file by parsing
/// `window.updateActuationOverlay` calls for a given session ID.
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

/// Loads tool names for a session from the Antigravity log directory.
///
/// This used to also byte-scrape `conversations/<session_id>.pb` for overlay
/// phrases ("opening url", "taking screenshot", ...). Current Antigravity
/// desktop builds encrypt those files — measured byte entropy is 8.00/8.00
/// with no container magic — so the scan could only ever return an empty
/// vector while implying the transcript was readable (#564). The log parser
/// above is the only source that works against a documented plaintext format.
fn load_antigravity_tool_names(session_id: &str) -> Vec<String> {
    let mut tool_names = Vec::new();

    if let Some(logs_root) = antigravity_logs_root() {
        let Ok(entries) = std::fs::read_dir(&logs_root) else {
            return tool_names;
        };

        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() || !file_type.is_dir() {
                continue;
            }
            let log_path = entry.path().join("ls-main.log");
            if !log_path.exists() {
                continue;
            }
            tool_names.extend(extract_log_tool_names(&log_path, session_id));
        }
    }

    tool_names
}

/// Injects `tool_use` entries into the last assistant message in the list
/// to surface browser automation tool names discovered from logs/protobuf files.
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
            "input": {}
        }));
    }

    message.content = Some(Value::Array(content));
    messages
}

/// Map each rpc-cache session directory to a `ClaudeSession`.
///
/// CLI project paths carry the `antigravity-cli://<workspace>` scheme and
/// route to the transcript-based loader; everything else is the desktop
/// rpc-cache layout.
pub fn load_sessions(path: &str, _exclude_sidechain: bool) -> Result<Vec<ClaudeSession>, String> {
    load_sessions_reporting(path, &ScanReport::default())
}

/// [`load_sessions`], recording in `report` the desktop state files,
/// directories and session artifacts that are there but cannot be read.
pub(crate) fn load_sessions_reporting(
    path: &str,
    report: &ScanReport,
) -> Result<Vec<ClaudeSession>, String> {
    if let Some(workspace) = path.strip_prefix(super::antigravity_cli::SCHEME) {
        return super::antigravity_cli::load_sessions(workspace);
    }
    let (root, workspace_filter) = if let Some(workspace) = path.strip_prefix(DESKTOP_SCHEME) {
        let Some(root) = resolve_antigravity_root() else {
            return Ok(vec![]);
        };
        (root, Some(workspace.to_string()))
    } else {
        let Some(root) = marker_rooted_path(path) else {
            return Ok(vec![]);
        };
        (root, None)
    };
    let state = load_antigravity_state_reporting(&root, report)?;
    let summaries = crate::commands::antigravity::load_conversation_summaries_map(&root);
    // Titles, step counts and the latest agent message come from Antigravity's
    // own editor storage; the rpc-cache knows only token counters, which is why
    // sessions used to render as bare UUIDs (#564).
    let trajectories = super::antigravity_state_sync::load();
    let has_any_ungrouped = state
        .sessions
        .keys()
        .any(|id| resolve_desktop_session_workspace(id, &summaries, &trajectories).is_none());
    let mut sessions = Vec::new();

    for (session_id, session_state) in state.sessions {
        let session_ws = resolve_desktop_session_workspace(&session_id, &summaries, &trajectories);
        match &workspace_filter {
            Some(target_ws) => {
                if session_ws.as_deref() != Some(target_ws.as_str()) {
                    continue;
                }
            }
            None => {
                if has_any_ungrouped && session_ws.is_some() {
                    continue;
                }
            }
        }
        let project_name = session_ws
            .as_deref()
            .map(desktop_project_name_for_workspace)
            .unwrap_or_else(|| "Antigravity".to_string());
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

        let trajectory = trajectories.get(&session_id);
        let label = trajectory
            .map(|t| t.title.clone())
            .filter(|title| !title.is_empty())
            .unwrap_or_else(|| session_state.latest.label.clone());
        let step_count = trajectory.map_or(step_count, |t| {
            usize::try_from(t.step_count).unwrap_or(step_count)
        });
        let step_count = if step_count > 0 {
            step_count
        } else {
            session_state.latest.evidence_count as usize
        };

        let display_label = format!(
            "{} ({} calls · {} steps · in={} out={} total={})",
            label,
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
            project_name,
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
            entrypoint: None,
        });
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

/// Admit a `usage.jsonl` candidate only if it is a regular, non-symlink
/// file. `Path::exists()` follows symlinks; we use `symlink_metadata` so a
/// symlinked file in either candidate location cannot redirect the read
/// outside the antigravity root.
fn admit_usage_jsonl(path: &Path, report: &ScanReport) -> Option<PathBuf> {
    let meta = report.symlink_metadata(path)?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return None;
    }
    Some(path.to_path_buf())
}

/// Resolve the `usage.jsonl` path for an Antigravity session, mirroring
/// the lookup used by [`load_messages`]: prefer `<session_path>/usage.jsonl`
/// and fall back to the rpc-cache location for filesystem-only / brain-only
/// sessions. Returns `None` when the session path does not resolve to a
/// recognised Antigravity root, or when neither candidate is a regular file.
///
/// Defends against two classes of symlink-based escape:
/// - **Directory-level**: canonicalises `session_path` and revalidates the
///   canonical form against [`marker_rooted_path`] *before* probing the
///   filesystem, so a symlinked session directory pointing outside the root
///   is rejected without leaking probe results.
/// - **File-level**: both candidates are admitted via
///   [`admit_usage_jsonl`], which rejects symlinks and non-regular files.
pub(crate) fn resolve_usage_jsonl_path(session_path: &str) -> Option<PathBuf> {
    resolve_usage_jsonl_path_reporting(session_path, &ScanReport::default())
}

/// [`resolve_usage_jsonl_path`], recording in `report` a candidate that is
/// there but cannot be looked at — it would otherwise pass for a session
/// without a usage file.
pub(crate) fn resolve_usage_jsonl_path_reporting(
    session_path: &str,
    report: &ScanReport,
) -> Option<PathBuf> {
    let dir = PathBuf::from(session_path);

    // Prefer an in-session `usage.jsonl`. Validate the canonical form
    // against a marker-rooted antigravity root before any IO on the
    // candidate file.
    if let Some(canonical_dir) = report.read(&dir, std::fs::canonicalize(&dir)) {
        if marker_rooted_path(&canonical_dir.to_string_lossy()).is_some() {
            if let Some(path) = admit_usage_jsonl(&canonical_dir.join("usage.jsonl"), report) {
                return Some(path);
            }
        }
    }

    // Fallback: rpc-cache. The file lives by construction under the
    // marker-rooted antigravity root, so a textual `session_id` is safe.
    // We still gate on `admit_usage_jsonl` so a symlinked `usage.jsonl`
    // dropped into the rpc-cache cannot redirect the read outside the root.
    let root = marker_rooted_path(session_path)?;
    let session_id = dir.file_name()?.to_string_lossy().to_string();
    admit_usage_jsonl(
        &get_antigravity_rpc_cache_root(&root)
            .join(&session_id)
            .join("usage.jsonl"),
        report,
    )
}

/// Extracts a clean session ID from a session path (stripping `.db` if the path points at a DB file).
fn extract_session_id_from_session_path(session_path: &str) -> String {
    let p = PathBuf::from(session_path);
    if p.extension().and_then(|e| e.to_str()) == Some("db") {
        p.file_stem()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default()
    } else {
        p.file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default()
    }
}

/// Parses a single JSONL transcript line from `.system_generated/logs/{transcript_full.jsonl,transcript.jsonl,overview.txt}`.
fn parse_desktop_transcript_line(line: &str, session_id: &str) -> Option<ClaudeMessage> {
    let trimmed = line.trim();
    if !trimmed.starts_with('{') {
        return None;
    }
    let record: Value = serde_json::from_str(trimmed).ok()?;

    let is_user = record.get("type").and_then(Value::as_str) == Some("USER_INPUT")
        || record.get("source").and_then(Value::as_str) == Some("USER_EXPLICIT");
    let is_model = record.get("type").and_then(Value::as_str) == Some("PLANNER_RESPONSE")
        || record.get("source").and_then(Value::as_str) == Some("MODEL");

    if !is_user && !is_model {
        return None;
    }

    let step_index = record
        .get("step_index")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let timestamp = record
        .get("created_at")
        .and_then(Value::as_str)
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string());

    let content_str = record
        .get("content")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());

    if is_user {
        let text = content_str?;
        return Some(crate::utils::build_provider_message(
            "antigravity",
            format!("{session_id}-step-{step_index}"),
            session_id,
            timestamp,
            "user",
            Some("user"),
            Some(Value::String(text.to_string())),
            None,
        ));
    }

    // Assistant (MODEL / PLANNER_RESPONSE)
    let thinking_str = record
        .get("thinking")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let tool_calls = record
        .get("tool_calls")
        .and_then(Value::as_array)
        .filter(|arr| !arr.is_empty());

    if content_str.is_none() && thinking_str.is_none() && tool_calls.is_none() {
        return None;
    }

    let content_val = if thinking_str.is_some() || tool_calls.is_some() {
        let mut blocks = Vec::new();
        if let Some(thinking) = thinking_str {
            blocks.push(json!({
                "type": "thinking",
                "thinking": thinking,
            }));
        }
        if let Some(text) = content_str {
            blocks.push(json!({
                "type": "text",
                "text": text,
            }));
        }
        if let Some(calls) = tool_calls {
            for (idx, call) in calls.iter().enumerate() {
                let name = call
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("tool")
                    .to_string();
                let id = call
                    .get("id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| format!("{session_id}-step-{step_index}-tool-{idx}"));
                let input = call.get("args").cloned().unwrap_or_else(|| json!({}));
                blocks.push(json!({
                    "type": "tool_use",
                    "id": id,
                    "name": name,
                    "input": input,
                }));
            }
        }
        Value::Array(blocks)
    } else {
        Value::String(content_str.unwrap_or_default().to_string())
    };

    Some(crate::utils::build_provider_message(
        "antigravity",
        format!("{session_id}-step-{step_index}"),
        session_id,
        timestamp,
        "assistant",
        Some("assistant"),
        Some(content_val),
        None,
    ))
}

/// Attempts to load messages from `<dir>/.system_generated/logs/{transcript_full.jsonl,transcript.jsonl,overview.txt}`.
fn try_load_brain_transcript_messages(session_dir: &Path, session_id: &str) -> Vec<ClaudeMessage> {
    let Ok(dir_meta) = std::fs::symlink_metadata(session_dir) else {
        return vec![];
    };
    if dir_meta.file_type().is_symlink() || !dir_meta.is_dir() {
        return vec![];
    }
    let sys_dir = session_dir.join(".system_generated");
    if std::fs::symlink_metadata(&sys_dir)
        .map(|m| m.file_type().is_symlink() || !m.is_dir())
        .unwrap_or(true)
    {
        return vec![];
    }
    let logs_dir = sys_dir.join("logs");
    if std::fs::symlink_metadata(&logs_dir)
        .map(|m| m.file_type().is_symlink() || !m.is_dir())
        .unwrap_or(true)
    {
        return vec![];
    }

    for candidate in ["transcript_full.jsonl", "transcript.jsonl", "overview.txt"] {
        let path = logs_dir.join(candidate);
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() || !meta.is_file() {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        let messages: Vec<ClaudeMessage> = content
            .lines()
            .filter_map(|line| parse_desktop_transcript_line(line, session_id))
            .collect();
        if !messages.is_empty() {
            return messages;
        }
    }

    vec![]
}

// Minimal Protobuf wire format reader for `<root>/conversations/<session_id>.db` `steps.step_payload`.
fn pb_read_varint(buf: &[u8], mut pos: usize) -> Option<(u64, usize)> {
    let mut result = 0u64;
    let mut shift = 0u32;
    while pos < buf.len() {
        let byte = buf[pos];
        pos += 1;
        result |= u64::from(byte & 0x7F) << shift;
        if byte & 0x80 == 0 {
            return Some((result, pos));
        }
        shift += 7;
        if shift >= 64 {
            return None;
        }
    }
    None
}

fn pb_skip_field(buf: &[u8], wire_type: u64, pos: usize) -> Option<usize> {
    match wire_type {
        0 => pb_read_varint(buf, pos).map(|(_, next)| next),
        1 => pos.checked_add(8).filter(|&end| end <= buf.len()),
        2 => {
            let (len, next) = pb_read_varint(buf, pos)?;
            let len_usize = usize::try_from(len).ok()?;
            next.checked_add(len_usize).filter(|&end| end <= buf.len())
        }
        5 => pos.checked_add(4).filter(|&end| end <= buf.len()),
        _ => None,
    }
}

fn pb_extract_timestamp_and_usage(
    meta_bytes: &[u8],
) -> (Option<String>, Option<crate::models::TokenUsage>) {
    let mut pos = 0usize;
    let mut timestamp = None;
    let mut usage = None;

    while pos < meta_bytes.len() {
        let Some((tag, next_pos)) = pb_read_varint(meta_bytes, pos) else {
            break;
        };
        pos = next_pos;
        let field_num = tag >> 3;
        let wire_type = tag & 0x07;

        if wire_type == 2 {
            let Some((len, data_start)) = pb_read_varint(meta_bytes, pos) else {
                break;
            };
            let Ok(len_usize) = usize::try_from(len) else {
                break;
            };
            let Some(data_end) = data_start.checked_add(len_usize) else {
                break;
            };
            if data_end > meta_bytes.len() {
                break;
            }
            let sub = &meta_bytes[data_start..data_end];
            pos = data_end;

            if field_num == 1 {
                // Timestamp { 1: seconds, 2: nanos }
                let mut sp = 0usize;
                let mut secs = 0i64;
                while sp < sub.len() {
                    let Some((stag, snext)) = pb_read_varint(sub, sp) else {
                        break;
                    };
                    sp = snext;
                    if (stag >> 3) == 1 && stag.trailing_zeros() >= 3 {
                        if let Some((val, vn)) = pb_read_varint(sub, sp) {
                            secs = i64::try_from(val).unwrap_or(i64::MAX);
                            sp = vn;
                        } else {
                            break;
                        }
                    } else if let Some(skip) = pb_skip_field(sub, stag & 0x07, sp) {
                        sp = skip;
                    } else {
                        break;
                    }
                }
                if secs > 0 {
                    if let Some(dt) = chrono::DateTime::from_timestamp(secs, 0) {
                        timestamp = Some(dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
                    }
                }
            } else if field_num == 9 {
                // Token usage { 2: input_tokens, 3: output_tokens, 5: cache_read_tokens, 9: reasoning_tokens }
                let mut sp = 0usize;
                let mut input_tokens = 0u32;
                let mut output_tokens = 0u32;
                let mut cache_read = 0u32;
                let mut reasoning = 0u32;
                while sp < sub.len() {
                    let Some((stag, snext)) = pb_read_varint(sub, sp) else {
                        break;
                    };
                    sp = snext;
                    if stag.trailing_zeros() >= 3 {
                        let Some((val, vn)) = pb_read_varint(sub, sp) else {
                            break;
                        };
                        sp = vn;
                        match stag >> 3 {
                            2 => input_tokens = to_u32_saturating(val),
                            3 => output_tokens = to_u32_saturating(val),
                            5 => cache_read = to_u32_saturating(val),
                            9 => reasoning = to_u32_saturating(val),
                            _ => {}
                        }
                    } else if let Some(skip) = pb_skip_field(sub, stag & 0x07, sp) {
                        sp = skip;
                    } else {
                        break;
                    }
                }
                if input_tokens > 0 || output_tokens > 0 || cache_read > 0 || reasoning > 0 {
                    usage = Some(crate::models::TokenUsage {
                        input_tokens: Some(input_tokens),
                        output_tokens: Some(output_tokens),
                        cache_read_input_tokens: (cache_read > 0).then_some(cache_read),
                        reasoning_tokens: (reasoning > 0).then_some(reasoning),
                        ..Default::default()
                    });
                }
            }
        } else if let Some(skip) = pb_skip_field(meta_bytes, wire_type, pos) {
            pos = skip;
        } else {
            break;
        }
    }

    (timestamp, usage)
}

fn parse_conversation_db_step(
    idx: i64,
    step_type: i64,
    payload: &[u8],
    session_id: &str,
) -> Option<ClaudeMessage> {
    let mut pos = 0usize;
    let mut timestamp = None;
    let mut usage = None;
    let mut user_texts: Vec<String> = Vec::new();
    let mut assistant_text: Option<String> = None;
    let mut thinking_text: Option<String> = None;
    let mut tool_calls: Vec<(String, String, Value)> = Vec::new();

    while pos < payload.len() {
        let Some((tag, next_pos)) = pb_read_varint(payload, pos) else {
            break;
        };
        pos = next_pos;
        let field_num = tag >> 3;
        let wire_type = tag & 0x07;

        if wire_type == 2 {
            let Some((len, data_start)) = pb_read_varint(payload, pos) else {
                break;
            };
            let Ok(len_usize) = usize::try_from(len) else {
                break;
            };
            let Some(data_end) = data_start.checked_add(len_usize) else {
                break;
            };
            if data_end > payload.len() {
                break;
            }
            let sub = &payload[data_start..data_end];
            pos = data_end;

            match field_num {
                5 => {
                    let (ts, u) = pb_extract_timestamp_and_usage(sub);
                    if ts.is_some() {
                        timestamp = ts;
                    }
                    if u.is_some() {
                        usage = u;
                    }
                }
                19 if step_type == 14 => {
                    // USER_INPUT submessage: field 2 holds user prompt text
                    let mut sp = 0usize;
                    while sp < sub.len() {
                        let Some((stag, snext)) = pb_read_varint(sub, sp) else {
                            break;
                        };
                        sp = snext;
                        if (stag >> 3) == 2 && (stag & 0x07) == 2 {
                            let Some((slen, sstart)) = pb_read_varint(sub, sp) else {
                                break;
                            };
                            let Ok(slen_usize) = usize::try_from(slen) else {
                                break;
                            };
                            let Some(send) = sstart.checked_add(slen_usize) else {
                                break;
                            };
                            if send > sub.len() {
                                break;
                            }
                            if let Ok(s) = std::str::from_utf8(&sub[sstart..send]) {
                                let trimmed = s.trim();
                                if !trimmed.is_empty() {
                                    user_texts.push(trimmed.to_string());
                                }
                            }
                            sp = send;
                        } else if let Some(skip) = pb_skip_field(sub, stag & 0x07, sp) {
                            sp = skip;
                        } else {
                            break;
                        }
                    }
                }
                20 if step_type == 15 => {
                    // PLANNER_RESPONSE submessage: 1 = response text, 3 = thinking, 7 = tool call
                    let mut sp = 0usize;
                    while sp < sub.len() {
                        let Some((stag, snext)) = pb_read_varint(sub, sp) else {
                            break;
                        };
                        sp = snext;
                        let sfield = stag >> 3;
                        let swire = stag & 0x07;
                        if swire == 2 {
                            let Some((slen, sstart)) = pb_read_varint(sub, sp) else {
                                break;
                            };
                            let Ok(slen_usize) = usize::try_from(slen) else {
                                break;
                            };
                            let Some(send) = sstart.checked_add(slen_usize) else {
                                break;
                            };
                            if send > sub.len() {
                                break;
                            }
                            let sbytes = &sub[sstart..send];
                            sp = send;

                            match sfield {
                                1 => {
                                    if let Ok(s) = std::str::from_utf8(sbytes) {
                                        let t = s.trim();
                                        if !t.is_empty() {
                                            assistant_text = Some(t.to_string());
                                        }
                                    }
                                }
                                3 => {
                                    if let Ok(s) = std::str::from_utf8(sbytes) {
                                        let t = s.trim();
                                        if !t.is_empty() {
                                            thinking_text = Some(t.to_string());
                                        }
                                    }
                                }
                                7 => {
                                    // Tool call submsg: 1 = id, 2 = name, 3 = args_json
                                    let mut tp = 0usize;
                                    let mut call_id = String::new();
                                    let mut call_name = String::new();
                                    let mut call_args = json!({});
                                    while tp < sbytes.len() {
                                        let Some((ttag, tnext)) = pb_read_varint(sbytes, tp) else {
                                            break;
                                        };
                                        tp = tnext;
                                        if (ttag & 0x07) == 2 {
                                            let Some((tlen, tstart)) = pb_read_varint(sbytes, tp)
                                            else {
                                                break;
                                            };
                                            let Ok(tlen_usize) = usize::try_from(tlen) else {
                                                break;
                                            };
                                            let Some(tend) = tstart.checked_add(tlen_usize) else {
                                                break;
                                            };
                                            if tend > sbytes.len() {
                                                break;
                                            }
                                            if let Ok(ts) =
                                                std::str::from_utf8(&sbytes[tstart..tend])
                                            {
                                                match ttag >> 3 {
                                                    1 => call_id = ts.to_string(),
                                                    2 => call_name = ts.to_string(),
                                                    3 => {
                                                        call_args = serde_json::from_str(ts)
                                                            .unwrap_or_else(|_| json!({"raw": ts}));
                                                    }
                                                    _ => {}
                                                }
                                            }
                                            tp = tend;
                                        } else if let Some(skip) =
                                            pb_skip_field(sbytes, ttag & 0x07, tp)
                                        {
                                            tp = skip;
                                        } else {
                                            break;
                                        }
                                    }
                                    if !call_name.is_empty() {
                                        if call_id.is_empty() {
                                            call_id = format!(
                                                "{session_id}-step-{idx}-tool-{}",
                                                tool_calls.len()
                                            );
                                        }
                                        tool_calls.push((call_id, call_name, call_args));
                                    }
                                }
                                _ => {}
                            }
                        } else if let Some(skip) = pb_skip_field(sub, swire, sp) {
                            sp = skip;
                        } else {
                            break;
                        }
                    }
                }
                _ => {}
            }
        } else if let Some(skip) = pb_skip_field(payload, wire_type, pos) {
            pos = skip;
        } else {
            break;
        }
    }

    let ts = timestamp.unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string());
    if step_type == 14 {
        let joined = user_texts.join("\n\n");
        if joined.trim().is_empty() {
            return None;
        }
        return Some(crate::utils::build_provider_message(
            "antigravity",
            format!("{session_id}-db-step-{idx}"),
            session_id,
            ts,
            "user",
            Some("user"),
            Some(Value::String(joined)),
            None,
        ));
    }

    if step_type == 15 {
        if assistant_text.is_none() && thinking_text.is_none() && tool_calls.is_empty() {
            return None;
        }
        let content_val = if thinking_text.is_some() || !tool_calls.is_empty() {
            let mut blocks = Vec::new();
            if let Some(thinking) = thinking_text {
                blocks.push(json!({ "type": "thinking", "thinking": thinking }));
            }
            if let Some(text) = assistant_text {
                blocks.push(json!({ "type": "text", "text": text }));
            }
            for (id, name, input) in tool_calls {
                blocks.push(json!({
                    "type": "tool_use",
                    "id": id,
                    "name": name,
                    "input": input,
                }));
            }
            Value::Array(blocks)
        } else {
            Value::String(assistant_text.unwrap_or_default())
        };

        let mut msg = crate::utils::build_provider_message(
            "antigravity",
            format!("{session_id}-db-step-{idx}"),
            session_id,
            ts,
            "assistant",
            Some("assistant"),
            Some(content_val),
            None,
        );
        msg.usage = usage;
        return Some(msg);
    }

    None
}

/// Attempts to load messages from `<root>/conversations/<session_id>.db` (`steps` table).
fn try_load_conversation_db_messages(root: &Path, session_id: &str) -> Vec<ClaudeMessage> {
    if !crate::commands::antigravity::is_valid_antigravity_session_id(session_id) {
        return vec![];
    }
    let db_path = root.join("conversations").join(format!("{session_id}.db"));
    let Ok(meta) = std::fs::symlink_metadata(&db_path) else {
        return vec![];
    };
    if meta.file_type().is_symlink() || !meta.is_file() {
        return vec![];
    }

    let flags = rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
        | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX
        | rusqlite::OpenFlags::SQLITE_OPEN_URI;
    let Ok(conn) = rusqlite::Connection::open_with_flags(&db_path, flags) else {
        return vec![];
    };
    let _ = conn.busy_timeout(std::time::Duration::from_millis(2000));

    let Ok(mut stmt) = conn.prepare(
        "SELECT idx, step_type, step_payload FROM steps WHERE step_type IN (14, 15) ORDER BY idx ASC",
    ) else {
        return vec![];
    };

    let mut messages = Vec::new();
    if let Ok(mut rows) = stmt.query([]) {
        while let Ok(Some(row)) = rows.next() {
            let Ok(idx) = row.get::<_, i64>(0) else {
                continue;
            };
            let Ok(step_type) = row.get::<_, i64>(1) else {
                continue;
            };
            let Ok(payload) = row.get::<_, Vec<u8>>(2) else {
                continue;
            };
            if let Some(msg) = parse_conversation_db_step(idx, step_type, &payload, session_id) {
                messages.push(msg);
            }
        }
    }

    messages
}

fn clamp_utf8_boundary(s: &str, idx: usize) -> usize {
    let mut pos = idx.min(s.len());
    while pos > 0 && !s.is_char_boundary(pos) {
        pos -= 1;
    }
    pos
}

fn parse_step_byte_offsets(raw: Option<rusqlite::types::ValueRef<'_>>) -> Vec<(u64, usize)> {
    let bytes = match raw {
        Some(rusqlite::types::ValueRef::Text(b) | rusqlite::types::ValueRef::Blob(b)) => b,
        _ => return vec![],
    };
    let Ok(Value::Array(items)) = serde_json::from_slice::<Value>(bytes) else {
        return vec![];
    };
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        if let Value::Array(pair) = item {
            if pair.len() >= 2 {
                if let (Some(step), Some(off)) = (pair[0].as_u64(), pair[1].as_u64()) {
                    if let Ok(off_usize) = usize::try_from(off) {
                        out.push((step, off_usize));
                    }
                }
            }
        }
    }
    out
}

fn slice_fts_body(body: &str, offsets: &[(u64, usize)], fallback_step: u64) -> Vec<(u64, String)> {
    if body.trim().is_empty() {
        return vec![];
    }
    if offsets.is_empty() {
        return vec![(fallback_step, body.trim().to_string())];
    }
    let mut slices = Vec::with_capacity(offsets.len());
    for (i, &(step_idx, start_raw)) in offsets.iter().enumerate() {
        let end_raw = offsets
            .get(i + 1)
            .map(|&(_, next_off)| next_off)
            .unwrap_or(body.len());
        let start = clamp_utf8_boundary(body, start_raw);
        let end = clamp_utf8_boundary(body, end_raw.max(start));
        let text = body[start..end].trim();
        if !text.is_empty() {
            slices.push((step_idx, text.to_string()));
        }
    }
    if slices.is_empty() {
        vec![(fallback_step, body.trim().to_string())]
    } else {
        slices
    }
}

/// Attempts to reconstruct conversation messages from `<root>/conversation_summaries.db` (`conversations_fts`).
fn try_load_summaries_fts_messages(root: &Path, session_id: &str) -> Vec<ClaudeMessage> {
    if !crate::commands::antigravity::is_valid_antigravity_session_id(session_id) {
        return vec![];
    }
    let db_path = root.join("conversation_summaries.db");
    let Ok(meta) = std::fs::symlink_metadata(&db_path) else {
        return vec![];
    };
    if meta.file_type().is_symlink() || !meta.is_file() {
        return vec![];
    }

    let flags = rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
        | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX
        | rusqlite::OpenFlags::SQLITE_OPEN_URI;
    let Ok(conn) = rusqlite::Connection::open_with_flags(&db_path, flags) else {
        return vec![];
    };
    let _ = conn.busy_timeout(std::time::Duration::from_millis(2000));

    let base_timestamp = conn
        .query_row(
            "SELECT last_modified_time FROM conversation_summaries WHERE conversation_id = ?1",
            rusqlite::params![session_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
        .map(|dt| dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string());

    let Ok(mut stmt) = conn.prepare(
        "SELECT CAST(chunk_index AS INTEGER), user_body, agent_body, \
                user_step_byte_offsets, agent_step_byte_offsets \
         FROM conversations_fts \
         WHERE conversation_id = ?1 AND CAST(chunk_index AS INTEGER) >= 0 \
         ORDER BY CAST(chunk_index AS INTEGER) ASC",
    ) else {
        return vec![];
    };

    let mut turns: Vec<(i64, u64, u8, String)> = Vec::new();
    if let Ok(mut rows) = stmt.query(rusqlite::params![session_id]) {
        while let Ok(Some(row)) = rows.next() {
            let chunk_idx = row.get::<_, Option<i64>>(0).ok().flatten().unwrap_or(0);
            let user_body = row
                .get::<_, Option<String>>(1)
                .ok()
                .flatten()
                .unwrap_or_default();
            let agent_body = row
                .get::<_, Option<String>>(2)
                .ok()
                .flatten()
                .unwrap_or_default();
            let user_offsets = parse_step_byte_offsets(row.get_ref(3).ok());
            let agent_offsets = parse_step_byte_offsets(row.get_ref(4).ok());

            for (step_idx, text) in slice_fts_body(&user_body, &user_offsets, 0) {
                turns.push((chunk_idx, step_idx, 0, text));
            }
            for (step_idx, text) in slice_fts_body(&agent_body, &agent_offsets, 1) {
                turns.push((chunk_idx, step_idx, 1, text));
            }
        }
    }

    turns.sort_by_key(|(chunk_idx, step_idx, role_ord, _)| (*chunk_idx, *step_idx, *role_ord));

    turns
        .into_iter()
        .enumerate()
        .map(|(seq, (_, step_idx, role_ord, text))| {
            let role = if role_ord == 0 { "user" } else { "assistant" };
            crate::utils::build_provider_message(
                "antigravity",
                format!("{session_id}-fts-{seq}-step-{step_idx}"),
                session_id,
                base_timestamp.clone(),
                role,
                Some(role),
                Some(Value::String(text)),
                None,
            )
        })
        .collect()
}

/// Multi-source fallback for Antigravity IDE desktop sessions when `usage.jsonl` is absent:
/// 1. `<session_dir>/.system_generated/logs/{transcript_full.jsonl,transcript.jsonl,overview.txt}`
///    (and legacy sibling `~/.gemini/antigravity-ide/brain/<session_id>/.system_generated/logs/`)
/// 2. `<root>/conversations/<session_id>.db` (`steps` table Protobuf payload)
/// 3. `<root>/conversation_summaries.db` (`conversations_fts` table with byte offsets)
/// 4. Editor `state.vscdb` trajectory summaries (`state_sync_messages`)
fn fallback_desktop_messages(session_path: &str, session_id: &str) -> Vec<ClaudeMessage> {
    if let Some(root) = marker_rooted_path(session_path).or_else(resolve_antigravity_root) {
        let supplied_dir = PathBuf::from(session_path);
        if supplied_dir.starts_with(&root) {
            let msgs = try_load_brain_transcript_messages(&supplied_dir, session_id);
            if !msgs.is_empty() {
                return msgs;
            }
        }

        if crate::commands::antigravity::is_valid_antigravity_session_id(session_id) {
            let brain_dir = root.join("brain").join(session_id);
            if brain_dir != supplied_dir {
                let msgs = try_load_brain_transcript_messages(&brain_dir, session_id);
                if !msgs.is_empty() {
                    return msgs;
                }
            }

            if let Some(legacy_dir) =
                crate::commands::antigravity::legacy_ide_brain_session_dir(&root, session_id)
            {
                let msgs = try_load_brain_transcript_messages(&legacy_dir, session_id);
                if !msgs.is_empty() {
                    return msgs;
                }
            }

            let db_msgs = try_load_conversation_db_messages(&root, session_id);
            if !db_msgs.is_empty() {
                return db_msgs;
            }

            let fts_msgs = try_load_summaries_fts_messages(&root, session_id);
            if !fts_msgs.is_empty() {
                return fts_msgs;
            }
        }
    }

    state_sync_messages(session_id)
}

/// Recovers the conversation text Antigravity's editor storage still holds for
/// a session: the last task boundary it recorded and the last message the agent
/// sent the user, in that order (their step indices are adjacent, task first).
///
/// This is all that survives when no local transcript or SQLite database exists:
/// the `.pb` files under `conversations/` are encrypted, and the state sync store
/// snapshots only the most recent steps (#564).
fn state_sync_messages(session_id: &str) -> Vec<ClaudeMessage> {
    let summaries = super::antigravity_state_sync::load();
    let Some(summary) = summaries.get(session_id) else {
        return vec![];
    };

    let timestamp = ms_to_rfc3339(summary.updated_ms);
    let mut messages = Vec::new();

    for (kind, text) in [
        ("task", &summary.last_task),
        ("message", &summary.last_message),
    ] {
        let Some(text) = text else {
            continue;
        };
        messages.push(crate::utils::build_provider_message(
            "antigravity",
            format!("{session_id}-state-sync-{kind}"),
            session_id,
            timestamp.clone(),
            "assistant",
            Some("assistant"),
            Some(json!([{ "type": "text", "text": text }])),
            None,
        ));
    }

    messages
}

/// Map each usage record in a session's `usage.jsonl` to a pair of `ClaudeMessages`.
///
/// When the rpc-cache holds no usage records — the common case for an Antigravity
/// IDE desktop session — falls back to `.system_generated/logs/` transcripts,
/// `conversations/<id>.db`, `conversation_summaries.db`, and finally `state.vscdb`.
///
/// Session paths under the antigravity-cli store (`<cli-root>/brain/<uuid>`)
/// route to the transcript parser instead.
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    if super::antigravity_cli::owns_session_path(session_path) {
        return super::antigravity_cli::load_messages(session_path);
    }
    let session_id = extract_session_id_from_session_path(session_path);

    let Some(usage_path) = resolve_usage_jsonl_path(session_path) else {
        return Ok(fallback_desktop_messages(session_path, &session_id));
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
            session_id: session_id.clone(),
            timestamp: timestamp.clone(),
            message_type: "user".to_string(),
            content: Some(json!([{"type":"text","text":format!("#{} {}", sequence, model)}])),
            provider: Some("antigravity".to_string()),
            role: Some("user".to_string()),
            model: Some(model.clone()),
            ..Default::default()
        });

        // Assistant turn with real token usage
        messages.push(ClaudeMessage {
            uuid: format!("{session_id}-{sequence}-a"),
            source_execution: None,
            codex_evidence: None,
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
                reasoning_tokens: None,
                service_tier: None,
                ..Default::default()
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

    // A `usage.jsonl` that exists but holds no usage records leaves the same
    // blank view as a missing one, so it takes the same fallback.
    if messages.is_empty() {
        return Ok(fallback_desktop_messages(session_path, &session_id));
    }

    let tool_names = load_antigravity_tool_names(&session_id);
    Ok(merge_tool_names_into_messages(
        messages,
        &session_id,
        &tool_names,
    ))
}

/// Formats a token count as a human-readable string (e.g. `1.2k`, `3.5M`).
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
/// Matches against session ID, title/label, model name, and conversation content.
pub fn search(query: &str, max_results: usize) -> Result<Vec<ClaudeMessage>, String> {
    let root = match resolve_antigravity_root() {
        Some(root) => root,
        None => return Ok(vec![]),
    };
    let state = load_antigravity_state_impl(&root)?;

    let query_lower = query.to_lowercase();
    let mut results = Vec::new();
    let mut matched_sessions = std::collections::HashSet::new();

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

        matched_sessions.insert(session_id.clone());
        results.push(ClaudeMessage {
            uuid: format!("ag-search-{}-{}", session_id, 0),
            session_id: session_id.clone(),
            timestamp,
            message_type: "assistant".to_string(),
            content: Some(json!([{ "type": "text", "text": content_text }])),
            provider: Some("antigravity".to_string()),

            role: Some("assistant".to_string()),
            ..Default::default()
        });
    }

    // Search desktop session message contents (transcripts, conversations/*.db, conversation_summaries.db)
    if !query_lower.is_empty() && results.len() < max_results {
        for session in state.sessions.values() {
            if results.len() >= max_results {
                break;
            }
            let session_id = &session.latest.session_id;
            let msgs = fallback_desktop_messages(&session.latest.file_path, session_id);
            for mut msg in msgs {
                let text_matches = match &msg.content {
                    Some(Value::String(s)) => s.to_lowercase().contains(&query_lower),
                    Some(Value::Array(arr)) => arr.iter().any(|block| {
                        block
                            .get("text")
                            .and_then(Value::as_str)
                            .is_some_and(|t| t.to_lowercase().contains(&query_lower))
                            || block
                                .get("thinking")
                                .and_then(Value::as_str)
                                .is_some_and(|t| t.to_lowercase().contains(&query_lower))
                    }),
                    _ => false,
                };
                if text_matches {
                    msg.project_name = Some("Antigravity".to_string());
                    results.push(msg);
                    if results.len() >= max_results {
                        break;
                    }
                }
            }
        }
    }

    results.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    results.truncate(max_results);

    // CLI transcripts carry real conversation content — search them too.
    if results.len() < max_results {
        results.extend(super::antigravity_cli::search(
            query,
            max_results - results.len(),
        ));
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::io::Write;
    use tempfile::TempDir;

    /// Writes a minimal antigravity-cli fixture (index + one transcript)
    /// under `<home>/.gemini/antigravity-cli` and returns the session dir.
    fn write_cli_fixture(home: &std::path::Path) -> std::path::PathBuf {
        let cli_root = home.join(".gemini").join("antigravity-cli");
        std::fs::create_dir_all(&cli_root).expect("create cli root");
        std::fs::write(
            cli_root.join("history.jsonl"),
            format!(
                "{}\n",
                serde_json::json!({
                    "display": "Wire the CLI layout",
                    "timestamp": 1750500000000u64,
                    "workspace": crate::test_utils::abs("tmp/cli-proj"),
                    "conversationId": "conv-cli",
                })
            ),
        )
        .expect("write history.jsonl");

        let session_dir = cli_root.join("brain").join("conv-cli");
        let logs = session_dir.join(".system_generated").join("logs");
        std::fs::create_dir_all(&logs).expect("create transcript dir");
        std::fs::write(
            logs.join("transcript_full.jsonl"),
            concat!(
                "{\"step_index\": 0, \"source\": \"USER_EXPLICIT\", \"type\": \"USER_INPUT\", ",
                "\"status\": \"DONE\", \"content\": \"Wire the CLI layout\", ",
                "\"created_at\": \"2026-06-21T10:00:00Z\"}\n",
                "{\"step_index\": 1, \"source\": \"MODEL\", \"type\": \"PLANNER_RESPONSE\", ",
                "\"status\": \"DONE\", \"content\": \"Done.\", ",
                "\"created_at\": \"2026-06-21T10:00:05Z\"}\n",
            ),
        )
        .expect("write transcript");
        session_dir
    }

    #[test]
    #[serial]
    /// A user may have the desktop Antigravity app AND the antigravity-cli
    /// store: `scan_projects` must surface both layouts, without id
    /// collisions between their sessions.
    fn scan_projects_merges_desktop_and_cli_layouts() {
        // Fixtures go inside the sandbox root, not a second temp dir - the
        // code under test resolves them through the home the guard exports.
        let home = crate::test_utils::SandboxHome::new();

        // Desktop layout: one rpc-cache session with a usage record.
        let desktop_session = home
            .path()
            .join(".gemini")
            .join("antigravity")
            .join(".token-monitor")
            .join("rpc-cache")
            .join("v1")
            .join("session-desktop");
        std::fs::create_dir_all(&desktop_session).expect("create desktop session");
        make_usage_file(&desktop_session, "session-desktop", "claude-opus-4-5");

        // CLI layout next to it.
        write_cli_fixture(home.path());

        // Derived from the same value the fixture writes. Hardcoding
        // `/tmp/cli-proj` here left the expectation Unix-shaped while the
        // fixture had already moved to a host-appropriate absolute path, so
        // this looked like a missing project on Windows (#541).
        let cli_workspace = format!(
            "antigravity-cli://{}",
            crate::test_utils::abs("tmp/cli-proj")
        );

        let projects = scan_projects().expect("scan projects");
        assert!(
            projects.iter().any(|p| p.name == "Antigravity"),
            "desktop project missing from {projects:?}"
        );
        assert!(
            projects.iter().any(|p| p.path == cli_workspace),
            "cli project missing from {projects:?}"
        );

        let cli_sessions = load_sessions(&cli_workspace, false).expect("cli sessions");
        assert_eq!(cli_sessions.len(), 1);
        assert_eq!(cli_sessions[0].session_id, "conv-cli");
        assert_eq!(cli_sessions[0].provider.as_deref(), Some("antigravity"));
    }

    /// Points Antigravity's editor storage at a sandbox `User` dir holding one
    /// trajectory summary. The env var is process-global, so every caller is
    /// `#[serial]` and clears it at the end.
    fn with_state_sync(user_dir: &std::path::Path, session_id: &str, trajectory: &[u8]) {
        use crate::providers::antigravity_state_sync::test_support::{build_value, write_state_db};
        write_state_db(user_dir, &build_value(session_id, trajectory));
        std::env::set_var("ANTIGRAVITY_USER_DIR", user_dir);
    }

    #[test]
    #[serial]
    /// Desktop sessions used to render as bare UUIDs with `0 steps`, because
    /// the rpc-cache holds only token counters — the title and step count live
    /// in Antigravity's own editor storage (#564).
    fn desktop_sessions_are_labelled_from_the_editor_state_store() {
        use crate::providers::antigravity_state_sync::test_support::trajectory_with_message;
        let home = crate::test_utils::SandboxHome::new();
        let root = home.path().join(".gemini").join("antigravity");
        let rpc_session = get_antigravity_rpc_cache_root(&root).join("session-titled");
        std::fs::create_dir_all(&rpc_session).expect("create rpc session");
        make_usage_file(&rpc_session, "session-titled", "gemini-3-pro-high");

        with_state_sync(
            &home.path().join("AntigravityUser"),
            "session-titled",
            &trajectory_with_message("Fixing Step Sync Interval", 18, "Done."),
        );

        let sessions =
            load_sessions(&root.to_string_lossy(), false).expect("load desktop sessions");
        let session = sessions
            .iter()
            .find(|s| s.session_id == "session-titled")
            .expect("session missing");
        let summary = session.summary.as_deref().unwrap_or_default();
        assert!(
            summary.starts_with("Fixing Step Sync Interval ("),
            "expected the editor title, got {summary:?}"
        );
        assert!(
            summary.contains("18 steps"),
            "expected the editor step count, got {summary:?}"
        );

        std::env::remove_var("ANTIGRAVITY_USER_DIR");
    }

    #[test]
    #[serial]
    /// A brain-only desktop session has no `usage.jsonl` at all, so the
    /// conversation view was empty. The last agent message recovered from the
    /// editor state store is rendered instead of nothing (#564).
    fn brain_only_sessions_render_the_recovered_agent_message() {
        use crate::providers::antigravity_state_sync::test_support::trajectory_with_message;
        let home = crate::test_utils::SandboxHome::new();
        let root = home.path().join(".gemini").join("antigravity");
        std::fs::create_dir_all(get_antigravity_rpc_cache_root(&root)).expect("create marker");
        let session_dir = root.join("brain").join("session-brain");
        std::fs::create_dir_all(&session_dir).expect("create brain session");
        std::fs::write(session_dir.join("task.md"), "# Brain session\n").expect("write task");

        with_state_sync(
            &home.path().join("AntigravityUser"),
            "session-brain",
            &trajectory_with_message("Undo Last Git Push", 6, "Reverted the push."),
        );

        let messages = load_messages(&session_dir.to_string_lossy()).expect("load brain messages");
        let texts: Vec<String> = messages
            .iter()
            .filter_map(|m| m.content.as_ref())
            .filter_map(|c| c.as_array())
            .flatten()
            .filter_map(|block| block["text"].as_str().map(str::to_string))
            .collect();
        assert!(
            texts.iter().any(|t| t == "Reverted the push."),
            "recovered agent message missing from {texts:?}"
        );

        std::env::remove_var("ANTIGRAVITY_USER_DIR");
    }

    #[test]
    #[serial]
    /// `load_messages` must route CLI session paths (under
    /// `~/.gemini/antigravity-cli/brain/`) to the transcript parser instead
    /// of the desktop usage.jsonl reader.
    fn load_messages_routes_cli_session_paths() {
        let home = crate::test_utils::SandboxHome::new();
        let session_dir = write_cli_fixture(home.path());

        let messages = load_messages(&session_dir.to_string_lossy()).expect("load cli messages");

        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].uuid, "conv-cli-step-0");
        assert_eq!(messages[0].message_type, "user");
        assert_eq!(messages[1].uuid, "conv-cli-step-1");
        assert_eq!(messages[1].message_type, "assistant");
    }

    #[test]
    #[serial]
    /// Content search must cover CLI transcripts too — the desktop layout
    /// only matches session metadata.
    fn search_covers_cli_transcript_content() {
        let home = crate::test_utils::SandboxHome::new();
        write_cli_fixture(home.path());

        let results = search("wire the cli", 10).expect("search");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].session_id, "conv-cli");
    }

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
            session_id: "session-123".to_string(),
            timestamp: "2026-04-12T10:00:00Z".to_string(),
            message_type: "assistant".to_string(),
            content: Some(json!([{ "type": "text", "text": "base" }])),
            provider: Some("antigravity".to_string()),
            role: Some("assistant".to_string()),
            ..Default::default()
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

            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() || !file_type.is_dir() {
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
                session_id: session_id.clone(),
                timestamp: last_timestamp,
                message_type: "assistant".to_string(),
                content: Some(json!([{ "type": "text", "text": content_text }])),
                provider: Some("antigravity".to_string()),
                role: Some("assistant".to_string()),
                ..Default::default()
            });
        }

        results.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        results.truncate(max_results);
        results
    }

    #[test]
    /// Direct `<session_path>/usage.jsonl` is returned when it exists.
    #[serial]
    fn test_resolve_usage_jsonl_path_prefers_in_session_file() {
        let _home = crate::test_utils::SandboxHome::new();
        let temp_dir = TempDir::new().unwrap();
        let root = temp_dir.path();
        std::fs::create_dir_all(root.join(".token-monitor").join("rpc-cache").join("v1")).unwrap();

        let session_dir = root.join("brain").join("session-direct");
        std::fs::create_dir_all(&session_dir).unwrap();
        std::fs::write(session_dir.join("usage.jsonl"), "{}\n").unwrap();

        // resolve_usage_jsonl_path now canonicalises the input, so the
        // returned path may differ textually from session_dir on platforms
        // where the temp dir lives under a symlinked prefix (e.g. macOS
        // `/var` → `/private/var`). Canonicalise both sides for the
        // comparison.
        let resolved = resolve_usage_jsonl_path(&session_dir.to_string_lossy()).unwrap();
        let expected = std::fs::canonicalize(&session_dir)
            .unwrap()
            .join("usage.jsonl");
        assert_eq!(resolved, expected);
    }

    #[test]
    #[cfg(unix)]
    /// A symlinked session directory pointing outside any marker-rooted
    /// antigravity root must NOT resolve to a readable `usage.jsonl`. Pre-fix
    /// behaviour: `dir.join("usage.jsonl")` would follow the symlink and read
    /// the attacker-controlled target.
    #[serial]
    fn test_resolve_usage_jsonl_path_rejects_symlink_escaping_root() {
        let _home = crate::test_utils::SandboxHome::new();
        // "Inside" tree — a legitimate antigravity root.
        let inside = TempDir::new().unwrap();
        std::fs::create_dir_all(
            inside
                .path()
                .join(".token-monitor")
                .join("rpc-cache")
                .join("v1"),
        )
        .unwrap();
        let brain_link = inside.path().join("brain").join("session-evil");
        std::fs::create_dir_all(inside.path().join("brain")).unwrap();

        // "Outside" tree — no antigravity marker; contains a usage.jsonl that
        // an attacker would like us to read.
        let outside = TempDir::new().unwrap();
        let outside_session = outside.path().join("attacker-payload");
        std::fs::create_dir_all(&outside_session).unwrap();
        std::fs::write(
            outside_session.join("usage.jsonl"),
            "{\"recordType\":\"usage\"}\n",
        )
        .unwrap();

        // Make the brain entry a symlink to the outside payload.
        std::os::unix::fs::symlink(&outside_session, &brain_link).unwrap();

        // Resolution must reject the path because the canonical form escapes
        // every marker-rooted antigravity root we can detect.
        let resolved = resolve_usage_jsonl_path(&brain_link.to_string_lossy());
        assert!(
            resolved.is_none(),
            "symlinked session directory escaping the antigravity root must not resolve to a readable usage.jsonl"
        );
    }

    #[test]
    #[cfg(unix)]
    /// A symlinked `usage.jsonl` (file-level, not directory-level) inside a
    /// legitimate session directory must be rejected. `Path::exists()` would
    /// follow the symlink — `admit_usage_jsonl` does not.
    #[serial]
    fn test_resolve_usage_jsonl_path_rejects_symlinked_usage_jsonl() {
        let _home = crate::test_utils::SandboxHome::new();
        let temp_dir = TempDir::new().unwrap();
        let root = temp_dir.path();
        std::fs::create_dir_all(root.join(".token-monitor").join("rpc-cache").join("v1")).unwrap();

        let session_dir = root.join("brain").join("session-with-sym");
        std::fs::create_dir_all(&session_dir).unwrap();

        // Place the attacker-controlled target outside the session.
        let outside = TempDir::new().unwrap();
        let payload = outside.path().join("payload.jsonl");
        std::fs::write(&payload, "{\"recordType\":\"usage\"}\n").unwrap();

        // Make the session's usage.jsonl a symlink to the outside payload.
        std::os::unix::fs::symlink(&payload, session_dir.join("usage.jsonl")).unwrap();

        assert!(
            resolve_usage_jsonl_path(&session_dir.to_string_lossy()).is_none(),
            "symlinked usage.jsonl must not resolve regardless of whether the session dir itself is legitimate"
        );
    }

    #[test]
    #[cfg(unix)]
    /// The same symlink-file defense must apply to the rpc-cache fallback so
    /// a symlinked `usage.jsonl` dropped into `<root>/.token-monitor/...`
    /// cannot redirect the read.
    #[serial]
    fn test_resolve_usage_jsonl_path_rejects_symlinked_usage_jsonl_in_rpc_cache() {
        let _home = crate::test_utils::SandboxHome::new();
        let temp_dir = TempDir::new().unwrap();
        let root = temp_dir.path();
        let rpc_session = root
            .join(".token-monitor")
            .join("rpc-cache")
            .join("v1")
            .join("session-rpc-sym");
        std::fs::create_dir_all(&rpc_session).unwrap();

        // Brain/-only session (no in-place usage.jsonl) so the fallback is exercised.
        let brain_dir = root.join("brain").join("session-rpc-sym");
        std::fs::create_dir_all(&brain_dir).unwrap();

        let outside = TempDir::new().unwrap();
        let payload = outside.path().join("payload.jsonl");
        std::fs::write(&payload, "{\"recordType\":\"usage\"}\n").unwrap();
        std::os::unix::fs::symlink(&payload, rpc_session.join("usage.jsonl")).unwrap();

        assert!(
            resolve_usage_jsonl_path(&brain_dir.to_string_lossy()).is_none(),
            "symlinked usage.jsonl in the rpc-cache must be refused"
        );
    }

    #[test]
    /// When `<session_path>/usage.jsonl` is absent, fall back to the rpc-cache
    /// location — matching what `load_messages` already does for brain/-only
    /// sessions.
    #[serial]
    fn test_resolve_usage_jsonl_path_falls_back_to_rpc_cache() {
        let _home = crate::test_utils::SandboxHome::new();
        let temp_dir = TempDir::new().unwrap();
        let root = temp_dir.path();
        let rpc_v1 = root.join(".token-monitor").join("rpc-cache").join("v1");
        std::fs::create_dir_all(&rpc_v1).unwrap();

        // Brain/-only session with no in-place usage.jsonl.
        let session_id = "session-fallback";
        let brain_dir = root.join("brain").join(session_id);
        std::fs::create_dir_all(&brain_dir).unwrap();

        // The same session has token data in the rpc-cache.
        let cached_session = rpc_v1.join(session_id);
        std::fs::create_dir_all(&cached_session).unwrap();
        let cached_usage = cached_session.join("usage.jsonl");
        std::fs::write(&cached_usage, "{}\n").unwrap();

        let resolved = resolve_usage_jsonl_path(&brain_dir.to_string_lossy()).unwrap();
        assert_eq!(resolved, cached_usage);
    }

    #[test]
    /// Returns `None` when neither the in-session nor the rpc-cache file
    /// exists — callers should treat this as "no records".
    #[serial]
    fn test_resolve_usage_jsonl_path_returns_none_when_missing_everywhere() {
        let _home = crate::test_utils::SandboxHome::new();
        let temp_dir = TempDir::new().unwrap();
        let root = temp_dir.path();
        std::fs::create_dir_all(root.join(".token-monitor").join("rpc-cache").join("v1")).unwrap();

        let brain_dir = root.join("brain").join("session-empty");
        std::fs::create_dir_all(&brain_dir).unwrap();

        assert!(resolve_usage_jsonl_path(&brain_dir.to_string_lossy()).is_none());
    }

    #[test]
    #[serial]
    fn test_load_messages_extracts_desktop_brain_transcript_with_thinking_and_tools() {
        let sandbox = crate::test_utils::SandboxHome::new();
        let ag_root = sandbox.path().join(".gemini").join("antigravity");
        let session_dir = ag_root.join("brain").join("sess-ide-transcript");
        let logs_dir = session_dir.join(".system_generated").join("logs");
        std::fs::create_dir_all(&logs_dir).unwrap();

        let transcript = concat!(
            r#"{"step_index":0,"source":"USER_EXPLICIT","type":"USER_INPUT","status":"DONE","created_at":"2026-10-30T11:39:11Z","content":"请帮我检查代码"}"#,
            "\n",
            r#"{"step_index":1,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","created_at":"2026-10-30T11:39:15Z","thinking":"Let me inspect the provider.","content":"我已经检查了代码。","tool_calls":[{"id":"call-1","name":"read_file","args":{"Path":"/tmp/a.rs"}}]}"#,
            "\n"
        );
        std::fs::write(logs_dir.join("transcript_full.jsonl"), transcript).unwrap();

        let messages = load_messages(&session_dir.to_string_lossy()).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].message_type, "user");
        assert_eq!(
            messages[0].content,
            Some(Value::String("请帮我检查代码".to_string()))
        );
        assert_eq!(messages[1].message_type, "assistant");
        let blocks = messages[1].content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(blocks.len(), 3);
        assert_eq!(blocks[0]["type"], "thinking");
        assert_eq!(blocks[1]["type"], "text");
        assert_eq!(blocks[1]["text"], "我已经检查了代码。");
        assert_eq!(blocks[2]["type"], "tool_use");
        assert_eq!(blocks[2]["name"], "read_file");
    }

    #[test]
    #[serial]
    fn test_load_messages_and_sessions_from_conversation_summaries_db_and_annotations() {
        let sandbox = crate::test_utils::SandboxHome::new();
        let ag_root = sandbox.path().join(".gemini").join("antigravity");
        let brain_dir = ag_root.join("brain");
        let annotations_dir = ag_root.join("annotations");
        std::fs::create_dir_all(&brain_dir).unwrap();
        std::fs::create_dir_all(&annotations_dir).unwrap();

        // Create conversation_summaries.db with conversation_summaries + conversations_fts
        let db_path = ag_root.join("conversation_summaries.db");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE conversation_summaries (
                conversation_id TEXT PRIMARY KEY,
                title TEXT,
                preview TEXT,
                step_count INTEGER,
                last_modified_time TEXT,
                last_user_input_time TEXT,
                workspace_uris TEXT
            );
            CREATE TABLE conversations_fts (
                conversation_id TEXT,
                chunk_index TEXT,
                title TEXT,
                step_count TEXT,
                last_modified_time TEXT,
                user_body TEXT,
                agent_body TEXT,
                user_step_byte_offsets BLOB,
                agent_step_byte_offsets BLOB,
                workspace TEXT
            );",
        )
        .unwrap();

        conn.execute(
            "INSERT INTO conversation_summaries VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                "sess-fts-only",
                "",
                "Batch Submission API Design",
                12i64,
                "2026-11-04T15:08:50Z",
                "2026-11-04T15:08:00Z",
                "[\"file:///workspace/demo-proj\"]"
            ],
        )
        .unwrap();

        let user_body = "First prompt\nSecond prompt";
        let agent_body = "First answer\nSecond answer";
        conn.execute(
            "INSERT INTO conversations_fts VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![
                "sess-fts-only",
                "0",
                "",
                "12",
                "1793804930000000000",
                user_body,
                agent_body,
                b"[[0,0],[2,13]]".to_vec(),
                b"[[1,0],[3,13]]".to_vec(),
                "/workspace/demo-proj",
            ],
        )
        .unwrap();

        std::fs::write(
            annotations_dir.join("sess-fts-only.pbtxt"),
            "title:\"Annotated Session Title\" last_user_view_time:{seconds:1793804930 nanos:0}",
        )
        .unwrap();

        let projects = scan_projects().unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "demo-proj");
        assert_eq!(projects[0].path, "antigravity:///workspace/demo-proj");
        assert_eq!(projects[0].actual_path, "/workspace/demo-proj");

        let sessions = load_sessions("antigravity:///workspace/demo-proj", false).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "sess-fts-only");
        assert_eq!(sessions[0].project_name, "demo-proj");
        assert!(sessions[0]
            .summary
            .as_deref()
            .unwrap_or_default()
            .contains("Annotated Session Title"));
        assert!(sessions[0].message_count >= 4);

        let msgs = load_messages(&sessions[0].file_path).unwrap();
        assert_eq!(msgs.len(), 4);
        assert_eq!(msgs[0].message_type, "user");
        assert_eq!(
            msgs[0].content,
            Some(Value::String("First prompt".to_string()))
        );
        assert_eq!(msgs[1].message_type, "assistant");
        assert_eq!(
            msgs[1].content,
            Some(Value::String("First answer".to_string()))
        );
        assert_eq!(msgs[2].message_type, "user");
        assert_eq!(
            msgs[2].content,
            Some(Value::String("Second prompt".to_string()))
        );
        assert_eq!(msgs[3].message_type, "assistant");
        assert_eq!(
            msgs[3].content,
            Some(Value::String("Second answer".to_string()))
        );

        let search_hits = search("Second answer", 10).unwrap();
        assert!(!search_hits.is_empty());
        assert_eq!(search_hits[0].session_id, "sess-fts-only");
    }
}
