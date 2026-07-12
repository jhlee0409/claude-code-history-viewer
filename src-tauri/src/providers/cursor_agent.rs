//! Cursor Agent CLI provider.
//!
//! Reads conversation transcripts written by the Cursor Agent CLI under
//! `~/.cursor/projects/<encoded-project>/agent-transcripts/<uuid>/<uuid>.jsonl`.
//! This is a different data source from the `cursor` provider (which reads the
//! Cursor IDE's `SQLite` storage) — see issue #304.
//!
//! Transcript format (one JSON object per line):
//! ```json
//! {"role":"user"|"assistant","message":{"content":[{"type":"text","text":"..."}]}}
//! ```
//! There is no per-line `id`/`timestamp`/`sessionId`; the session id is the
//! transcript file's UUID stem and times come from the file mtime.

use super::ProviderInfo;
use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::utils::{
    build_provider_message, decode_with_filesystem_check, search_json_value_case_insensitive,
};
use chrono::{DateTime, Utc};
use serde_json::Value;
use std::fs;
use std::path::Path;
use walkdir::{DirEntry, WalkDir};

const PROVIDER_ID: &str = "cursor-agent";

/// Max characters of the first user prompt used as a session title.
const SUMMARY_MAX_CHARS: usize = 80;

/// Detect a Cursor Agent CLI installation.
pub fn detect() -> Option<ProviderInfo> {
    let base = get_base_path()?;
    Some(ProviderInfo {
        id: PROVIDER_ID.to_string(),
        display_name: "Cursor Agent".to_string(),
        is_available: has_any_transcript(Path::new(&base)),
        base_path: base,
    })
}

/// Base path for Cursor Agent transcripts: `~/.cursor/projects`.
pub fn get_base_path() -> Option<String> {
    let home = dirs::home_dir()?;
    let projects = home.join(".cursor").join("projects");
    if projects.is_dir() {
        Some(projects.to_string_lossy().to_string())
    } else {
        None
    }
}

/// True if at least one `*/agent-transcripts/**/*.jsonl` exists under `base`.
/// Keeps the provider hidden when `~/.cursor/projects` holds only non-chat data
/// (terminals/mcps/plans).
fn has_any_transcript(base: &Path) -> bool {
    project_dirs(base).iter().any(|p| {
        let transcripts = p.join("agent-transcripts");
        transcripts.is_dir() && !transcript_files(&transcripts).is_empty()
    })
}

/// Scan Cursor Agent projects under the default `~/.cursor/projects` root.
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let base = get_base_path().ok_or("Cursor projects path not found")?;
    scan_projects_in(Path::new(&base))
}

/// Implementation of [`scan_projects`] parameterized by the projects root so
/// tests can pass an isolated tempdir.
pub fn scan_projects_in(base: &Path) -> Result<Vec<ClaudeProject>, String> {
    let mut projects = Vec::new();

    for project_dir in project_dirs(base) {
        let transcripts_dir = project_dir.join("agent-transcripts");
        if !transcripts_dir.is_dir() {
            continue;
        }

        let mut session_count = 0usize;
        let mut message_count = 0usize;
        let mut last_modified_ts = 0u64;

        for entry in transcript_files(&transcripts_dir) {
            session_count += 1;
            if let Ok(meta) = entry.metadata() {
                // Rough line estimate for the sidebar summary (avoids parsing).
                message_count += (meta.len() / 400) as usize;
                if let Ok(modified) = meta.modified() {
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

        // The directory encodes the real working dir with `/` replaced by `-`
        // without escaping, so a naive split would truncate hyphenated project
        // names. Resolve via filesystem-existence-based decoding; fall back to
        // the raw slug.
        let (display_name, actual_path) = match decode_with_filesystem_check(dir_name) {
            Some(real_path) => {
                let leaf = Path::new(&real_path)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| dir_name.to_string());
                (leaf, real_path)
            }
            None => (
                dir_name.to_string(),
                project_dir.to_string_lossy().to_string(),
            ),
        };

        projects.push(ClaudeProject {
            name: display_name,
            path: project_dir.to_string_lossy().to_string(),
            actual_path,
            session_count,
            message_count,
            last_modified: ts_to_rfc3339(last_modified_ts),
            git_info: None,
            provider: Some(PROVIDER_ID.to_string()),
            storage_type: Some("json".to_string()),
            custom_directory_label: None,
        });
    }

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

/// Load the sessions (transcripts) for a Cursor Agent project.
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    if project_path.trim().is_empty() {
        return Err("project_path is required".to_string());
    }
    let project_dir = Path::new(project_path);
    if !project_dir.is_dir() {
        return Ok(vec![]);
    }
    validate_under_base(project_dir)?;
    if is_symlink(project_dir) {
        return Err(format!(
            "Project path must not be a symlink: {}",
            project_dir.display()
        ));
    }

    let transcripts_dir = project_dir.join("agent-transcripts");
    if !transcripts_dir.is_dir() {
        return Ok(vec![]);
    }

    let project_name = project_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let mut sessions = Vec::new();
    for entry in transcript_files(&transcripts_dir) {
        if let Some(session) = extract_session_info(entry.path(), &project_name) {
            sessions.push(session);
        }
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

/// Load all messages from a Cursor Agent transcript file.
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let path = Path::new(session_path);
    if !path.exists() {
        return Err(format!("Session file not found: {session_path}"));
    }
    validate_under_base(path)?;
    if is_symlink(path) {
        return Err("Session file must not be a symlink".to_string());
    }

    let data = fs::read_to_string(path).map_err(|e| format!("Failed to read session file: {e}"))?;
    let session_id = file_uuid(path);
    let timestamp = file_mtime_rfc3339(path);

    Ok(parse_transcript(&data, &session_id, &timestamp))
}

/// Convert a transcript file's contents into messages. Pure (no filesystem /
/// validation) so it can be unit-tested directly.
fn parse_transcript(data: &str, session_id: &str, timestamp: &str) -> Vec<ClaudeMessage> {
    let mut messages = Vec::new();
    let mut msg_index = 0u64;
    for line in data.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if !is_conversation_turn(&value) {
            continue;
        }
        if let Some(msg) = convert_message(&value, session_id, timestamp, msg_index) {
            messages.push(msg);
            msg_index += 1;
        }
    }
    messages
}

/// Search across all Cursor Agent transcripts.
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let Some(base) = get_base_path() else {
        return Ok(vec![]);
    };
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for project_dir in project_dirs(Path::new(&base)) {
        if is_symlink(&project_dir) {
            continue;
        }
        let transcripts_dir = project_dir.join("agent-transcripts");
        if !transcripts_dir.is_dir() {
            continue;
        }
        let project_name = project_dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        for entry in transcript_files(&transcripts_dir) {
            let path = entry.path();
            let Ok(data) = fs::read_to_string(path) else {
                continue;
            };
            let session_id = file_uuid(path);
            let timestamp = file_mtime_rfc3339(path);

            let mut msg_index = 0u64;
            for line in data.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let Ok(value) = serde_json::from_str::<Value>(line) else {
                    continue;
                };
                if !is_conversation_turn(&value) {
                    continue;
                }
                if search_json_value_case_insensitive(&value, &query_lower) {
                    if let Some(mut msg) =
                        convert_message(&value, &session_id, &timestamp, msg_index)
                    {
                        msg.project_name = Some(project_name.clone());
                        results.push(msg);
                        if results.len() >= limit {
                            return Ok(results);
                        }
                    }
                }
                // Advance the index for every conversation turn so search-result
                // UUIDs line up with `load_messages` (needed for navigation).
                msg_index += 1;
            }
        }
    }

    Ok(results)
}

// ============================================================================
// Helpers
// ============================================================================

/// Immediate child directories of `base`.
fn project_dirs(base: &Path) -> Vec<std::path::PathBuf> {
    WalkDir::new(base)
        .min_depth(1)
        .max_depth(1)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_dir())
        .map(|e| e.path().to_path_buf())
        .collect()
}

/// Non-symlinked `*.jsonl` files under an `agent-transcripts` directory
/// (`<uuid>/<uuid>.jsonl`, depth 2).
fn transcript_files(transcripts_dir: &Path) -> Vec<DirEntry> {
    WalkDir::new(transcripts_dir)
        .min_depth(2)
        .max_depth(2)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
        .filter(|e| !is_symlink(e.path()))
        .collect()
}

/// A renderable conversation turn has a `user`/`assistant` role.
fn is_conversation_turn(value: &Value) -> bool {
    matches!(
        value.get("role").and_then(Value::as_str),
        Some("user" | "assistant")
    )
}

/// Convert one transcript line into a `ClaudeMessage`. `msg_index` makes the
/// generated UUID stable/deterministic so global-search navigation can resolve
/// it back inside `load_messages`.
fn convert_message(
    value: &Value,
    session_id: &str,
    timestamp: &str,
    msg_index: u64,
) -> Option<ClaudeMessage> {
    let role = value.get("role").and_then(Value::as_str)?;
    let content = value.get("message").and_then(|m| m.get("content")).cloned();
    Some(build_provider_message(
        PROVIDER_ID,
        format!("{session_id}-{msg_index}"),
        session_id,
        timestamp.to_string(),
        role,
        Some(role),
        content,
        None,
    ))
}

fn extract_session_info(file_path: &Path, project_name: &str) -> Option<ClaudeSession> {
    let data = fs::read_to_string(file_path).ok()?;

    let mut message_count = 0usize;
    let mut summary: Option<String> = None;
    for line in data.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if !is_conversation_turn(&value) {
            continue;
        }
        message_count += 1;
        if summary.is_none() && value.get("role").and_then(Value::as_str) == Some("user") {
            summary = extract_text(&value).map(|t| summarize(&t));
        }
    }

    if message_count == 0 {
        return None;
    }

    let uuid = file_uuid(file_path);
    let mtime = file_mtime_rfc3339(file_path);

    Some(ClaudeSession {
        session_id: file_path.to_string_lossy().to_string(),
        actual_session_id: uuid.clone(),
        file_path: file_path.to_string_lossy().to_string(),
        project_name: project_name.to_string(),
        message_count,
        first_message_time: mtime.clone(),
        last_message_time: mtime.clone(),
        last_modified: mtime,
        has_tool_use: false,
        has_errors: false,
        summary: summary.or(Some(uuid)),
        is_renamed: false,
        provider: Some(PROVIDER_ID.to_string()),
        storage_type: Some("json".to_string()),
        entrypoint: None,
    })
}

/// Concatenate the `text` of every content block in a message line.
fn extract_text(value: &Value) -> Option<String> {
    let content = value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)?;
    let mut out = String::new();
    for item in content {
        if let Some(text) = item.get("text").and_then(Value::as_str) {
            if !out.is_empty() {
                out.push(' ');
            }
            out.push_str(text);
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Build a short session title from the first user prompt (Cursor stores no
/// title), stripping the `<user_query>` wrapper Cursor injects.
fn summarize(text: &str) -> String {
    let cleaned = text
        .replace("<user_query>", "")
        .replace("</user_query>", "");
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.chars().count() > SUMMARY_MAX_CHARS {
        let truncated: String = cleaned.chars().take(SUMMARY_MAX_CHARS).collect();
        format!("{truncated}…")
    } else {
        cleaned
    }
}

fn file_uuid(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string()
}

fn is_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

/// Confine `path` to the `~/.cursor/projects` root (defense-in-depth against
/// traversal / symlink escapes). Canonicalizes both sides.
fn validate_under_base(path: &Path) -> Result<(), String> {
    let base = get_base_path().ok_or("Cursor projects path not found")?;
    let canon_base = Path::new(&base)
        .canonicalize()
        .map_err(|e| format!("Failed to resolve Cursor base: {e}"))?;
    let canon_path = path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve session path: {e}"))?;
    if canon_path.starts_with(&canon_base) {
        Ok(())
    } else {
        Err(format!(
            "Path is outside the Cursor projects root: {}",
            path.display()
        ))
    }
}

fn file_mtime_rfc3339(path: &Path) -> String {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
        .map(|d| ts_to_rfc3339(d.as_secs()))
        .unwrap_or_default()
}

#[allow(clippy::cast_possible_wrap)]
fn ts_to_rfc3339(secs: u64) -> String {
    if secs == 0 {
        return Utc::now().to_rfc3339();
    }
    DateTime::from_timestamp(secs as i64, 0)
        .unwrap_or_else(Utc::now)
        .to_rfc3339()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    const SAMPLE: &str = concat!(
        r#"{"role":"user","message":{"content":[{"type":"text","text":"<user_query>fix the LOGIN bug</user_query>"}]}}"#,
        "\n",
        r#"{"role":"assistant","message":{"content":[{"type":"text","text":"Looking into ZmagicToken now"}]}}"#,
        "\n",
    );

    fn write_transcript(base: &Path, project: &str, uuid: &str, body: &str) {
        let dir = base.join(project).join("agent-transcripts").join(uuid);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{uuid}.jsonl")), body).unwrap();
    }

    #[test]
    fn scan_lists_only_projects_with_transcripts() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        write_transcript(base, "Users-jack-client-foo", "uuid-1", SAMPLE);
        // A project dir with only non-chat data must be skipped.
        fs::create_dir_all(base.join("Users-jack-client-bar").join("terminals")).unwrap();

        let projects = scan_projects_in(base).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].session_count, 1);
        assert_eq!(projects[0].provider.as_deref(), Some("cursor-agent"));
    }

    #[test]
    fn extract_session_info_derives_id_count_and_title() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        write_transcript(base, "Users-jack-client-foo", "uuid-1", SAMPLE);
        let file = base
            .join("Users-jack-client-foo")
            .join("agent-transcripts")
            .join("uuid-1")
            .join("uuid-1.jsonl");

        let session = extract_session_info(&file, "Users-jack-client-foo").unwrap();
        assert_eq!(session.actual_session_id, "uuid-1");
        assert_eq!(session.message_count, 2);
        assert_eq!(session.provider.as_deref(), Some("cursor-agent"));
        // Title is derived from the first user prompt with the wrapper stripped.
        assert_eq!(session.summary.as_deref(), Some("fix the LOGIN bug"));
    }

    #[test]
    fn parse_transcript_maps_roles_with_deterministic_uuids() {
        let messages = parse_transcript(SAMPLE, "uuid-1", "2026-06-20T00:00:00Z");
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role.as_deref(), Some("user"));
        assert_eq!(messages[0].message_type, "user");
        assert_eq!(messages[0].provider.as_deref(), Some("cursor-agent"));
        assert_eq!(messages[1].role.as_deref(), Some("assistant"));
        // Deterministic UUIDs (msg index) so global-search navigation resolves
        // back to the same message inside load_messages.
        assert_eq!(messages[0].uuid, "uuid-1-0");
        assert_eq!(messages[1].uuid, "uuid-1-1");
        // The assistant turn carries its content array through unchanged.
        let content = messages[1].content.as_ref().unwrap();
        assert!(content.to_string().contains("ZmagicToken"));
    }

    #[test]
    fn parse_transcript_skips_blank_and_non_turn_lines() {
        let data = format!(
            "\n  \n{SAMPLE}{}",
            r#"{"role":"system","message":{"content":[]}}"#
        );
        let messages = parse_transcript(&data, "s", "");
        // Only the user + assistant turns; blank lines and the system line drop.
        assert_eq!(messages.len(), 2);
    }

    #[test]
    fn summarize_strips_wrapper_and_truncates() {
        assert_eq!(
            summarize("<user_query>hello world</user_query>"),
            "hello world"
        );
        let long = "x".repeat(200);
        let s = summarize(&long);
        assert!(s.chars().count() <= SUMMARY_MAX_CHARS + 1); // +1 for the ellipsis
        assert!(s.ends_with('…'));
    }
}
