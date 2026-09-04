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
//!
//! ## Session titles (`/rename`)
//!
//! Transcripts carry no title. The CLI stores the title it shows in its own
//! resume picker (updated by the `/rename` slash command) under
//! `~/.cursor/chats/<md5(cwd)>/<session-uuid>/meta.json` (`title` field,
//! mirrored as `name` in that directory's `store.db`). The session UUID is
//! shared with the transcript path, so [`load_sessions`] merges that stored
//! title over the first-prompt fallback chain.
//!
//! ## Content-block normalisation (issue #472)
//!
//! Cursor agent injects several non-prose block types that must be handled
//! before content reaches the viewer:
//!
//! | Block type | Behaviour |
//! |---|---|
//! | `{"type":"text","text":"<user_query>…</user_query>"}` | Strip XML wrapper; drop trailing `<context>` blob |
//! | `{"type":"redacted","data":"[REDACTED]"}` | Skip message when *all* blocks are redacted |
//! | `{"type":"tool_result","content":[…]}` | Recurse into nested content array |
//! | `{"type":"command_output","output":"…"}` | Surface shell stdout/stderr |

use super::ProviderInfo;
use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::utils::{
    build_provider_message, decode_with_filesystem_check, search_json_value_case_insensitive,
};
use chrono::{DateTime, Utc};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::{DirEntry, WalkDir};

const PROVIDER_ID: &str = "cursor-agent";

/// Max characters of the first user prompt used as a session title.
const SUMMARY_MAX_CHARS: usize = 80;

// ============================================================================
// Public API
// ============================================================================

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
    let home = crate::utils::home_dir()?;
    let projects = home.join(".cursor").join("projects");
    if projects.is_dir() {
        Some(projects.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Root of the Cursor Agent CLI chat metadata store: `~/.cursor/chats`.
fn chats_root() -> Option<PathBuf> {
    chats_root_in(&crate::utils::home_dir()?)
}

/// `.cursor/chats` under `home`, or `None` when missing or a symlink.
///
/// `WalkDir` follows a symlinked traversal root by default, so reject it here
/// rather than reading titles from an unintended location.
fn chats_root_in(home: &Path) -> Option<PathBuf> {
    let chats = home.join(".cursor").join("chats");
    if chats.is_dir() && !is_symlink(&chats) {
        Some(chats)
    } else {
        None
    }
}

/// True if at least one `*/agent-transcripts/**/*.jsonl` exists under `base`.
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

/// Implementation of [`scan_projects`] parameterised by the projects root so
/// tests can pass an isolated temp dir.
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

    // Titles the CLI stores (and `/rename` updates), keyed by session UUID.
    let title_index = chats_root()
        .map(|root| load_native_title_index(&root))
        .unwrap_or_default();

    let mut sessions = Vec::new();
    for entry in transcript_files(&transcripts_dir) {
        if let Some(session) = extract_session_info(entry.path(), &project_name, &title_index) {
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
        // Skip messages that carry nothing but redacted placeholders.
        if is_only_redacted(&value) {
            msg_index += 1;
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
                if is_only_redacted(&value) {
                    msg_index += 1;
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
                msg_index += 1;
            }
        }
    }

    Ok(results)
}

// ============================================================================
// Content-block normalisation (issue #472)
// ============================================================================

/// Returns `true` when every content block in the message is a redaction
/// placeholder, meaning there is nothing useful to show the user.
///
/// Cursor emits two forms of redacted blocks:
/// - `{"type":"redacted","data":"[REDACTED]"}` — explicit redaction type
/// - `{"type":"text","text":"[REDACTED]"}` — literal string sentinel
fn is_only_redacted(value: &Value) -> bool {
    let Some(blocks) = value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
    else {
        return false;
    };
    if blocks.is_empty() {
        return false;
    }
    blocks.iter().all(|b| {
        let ty = b.get("type").and_then(Value::as_str).unwrap_or("");
        if ty == "redacted" {
            return true;
        }
        if ty == "text" {
            let text = b.get("text").and_then(Value::as_str).unwrap_or("").trim();
            return text == "[REDACTED]";
        }
        false
    })
}

/// Strip Cursor's `<user_query>…</user_query>` XML envelope from a user text
/// block and remove any trailing `<context>` or similar XML blobs.
///
/// If the text does not contain a `<user_query>` tag it is returned unchanged
/// so non-wrapped assistant / tool messages are unaffected.
///
/// Any residual XML-style tags (`<tag>` / `</tag>`) are stripped after
/// extraction so stray inline tags don't leak into the rendered output.
fn clean_user_text(text: &str) -> String {
    // Extract what is inside <user_query>…</user_query>.
    let inner = if let Some(start) = text.find("<user_query>") {
        let after_open = &text[start + "<user_query>".len()..];
        // Truncate at the closing tag — this drops any <context> blob that
        // Cursor appends after </user_query>.
        if let Some(end) = after_open.find("</user_query>") {
            &after_open[..end]
        } else {
            after_open
        }
    } else {
        // No wrapper — pass through (covers assistant messages and plain turns).
        text
    };

    // Strip any remaining XML-style tags to clean up inline markup.
    let cleaned = strip_xml_tags(inner);
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Remove all `<…>` and `</…>` substrings from `s`.
fn strip_xml_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

/// Collect displayable text from *all* content block types in a message,
/// including tool results and command output (issue #472 — missing shell output).
///
/// Block types handled:
/// - `{"type":"text","text":"…"}` — normal prose; user text is cleaned of XML
/// - `{"type":"tool_result","content":[…]}` — recurse into nested content array
/// - `{"type":"command_output","output":"…"}` — shell stdout/stderr
/// - `{"type":"redacted",…}` — skipped (not useful)
fn extract_text_all_blocks(value: &Value) -> Option<String> {
    let role = value.get("role").and_then(Value::as_str).unwrap_or("");
    let blocks = value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)?;

    let mut parts: Vec<String> = Vec::new();

    for block in blocks {
        collect_block_text(block, role, &mut parts);
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
}

/// Recursively collect text from a single content block into `out`.
fn collect_block_text(block: &Value, role: &str, out: &mut Vec<String>) {
    let ty = block.get("type").and_then(Value::as_str).unwrap_or("");

    match ty {
        "text" => {
            let raw = block.get("text").and_then(Value::as_str).unwrap_or("");
            // Skip bare [REDACTED] sentinels.
            if raw.trim() == "[REDACTED]" {
                return;
            }
            let cleaned = if role == "user" {
                clean_user_text(raw)
            } else {
                raw.to_string()
            };
            if !cleaned.trim().is_empty() {
                out.push(cleaned);
            }
        }
        "tool_result" => {
            // Cursor nests a content array inside tool_result blocks.
            if let Some(inner) = block.get("content").and_then(Value::as_array) {
                for inner_block in inner {
                    collect_block_text(inner_block, role, out);
                }
            }
            // Some tool_result blocks also carry a top-level "output" field.
            if let Some(output) = block.get("output").and_then(Value::as_str) {
                let trimmed = output.trim();
                if !trimmed.is_empty() {
                    out.push(format!("[tool output]\n{trimmed}"));
                }
            }
        }
        "command_output" => {
            if let Some(output) = block.get("output").and_then(Value::as_str) {
                let trimmed = output.trim();
                if !trimmed.is_empty() {
                    out.push(format!("[shell]\n{trimmed}"));
                }
            }
        }
        // Skip redacted / unknown block types.
        _ => {}
    }
}

// ============================================================================
// Message conversion
// ============================================================================

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
///
/// The `content` field is rebuilt from the full block set (including tool /
/// command-output blocks) so the rendered conversation is complete.
fn convert_message(
    value: &Value,
    session_id: &str,
    timestamp: &str,
    msg_index: u64,
) -> Option<ClaudeMessage> {
    let role = value.get("role").and_then(Value::as_str)?;

    // Build a normalised content array for the viewer.
    // We reconstruct it as a JSON array of {"type":"text","text":"…"} objects
    // so the frontend's existing text-block renderer handles it without changes.
    let normalised_text = extract_text_all_blocks(value)?;
    let content = serde_json::json!([
        {"type": "text", "text": normalised_text}
    ]);

    Some(build_provider_message(
        PROVIDER_ID,
        format!("{session_id}-{msg_index}"),
        session_id,
        timestamp.to_string(),
        role,
        Some(role),
        Some(content),
        None,
    ))
}

// ============================================================================
// Session helpers
// ============================================================================

/// Build a `session UUID → stored title` map from
/// `~/.cursor/chats/<workspace-hash>/<session-uuid>/meta.json`.
///
/// The CLI writes the title shown in its own resume picker to `meta.json`'s
/// `title` field, and `/rename` updates it. The session UUID (directory name)
/// is the same identifier used for the transcript file stem under
/// `~/.cursor/projects`, so no workspace-hash mapping is needed to join.
fn load_native_title_index(chats_root: &Path) -> HashMap<String, String> {
    WalkDir::new(chats_root)
        .min_depth(3)
        .max_depth(3)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_name() == "meta.json")
        .filter(|e| !is_symlink(e.path()))
        .filter_map(|entry| {
            let uuid = entry.path().parent()?.file_name()?.to_str()?;
            let data = fs::read_to_string(entry.path()).ok()?;
            let value = serde_json::from_str::<Value>(&data).ok()?;
            let title = value.get("title")?.as_str()?.trim();
            if title.is_empty() {
                return None;
            }
            Some((uuid.to_string(), title.to_string()))
        })
        .collect()
}

fn extract_session_info(
    file_path: &Path,
    project_name: &str,
    native_titles: &HashMap<String, String>,
) -> Option<ClaudeSession> {
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
        if is_only_redacted(&value) {
            continue;
        }
        message_count += 1;
        if summary.is_none() && value.get("role").and_then(Value::as_str) == Some("user") {
            // Use the narrow text-only helper for the title so tool noise
            // doesn't bleed into the session summary.
            summary = extract_title_text(&value).map(|t| summarize(&t));
        }
    }

    if message_count == 0 {
        return None;
    }

    let uuid = file_uuid(file_path);
    let mtime = file_mtime_rfc3339(file_path);
    let native_title = native_titles.get(&uuid);

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
        // Stored title (the CLI's resume-picker name, updated by `/rename`)
        // wins over the first-prompt fallback, which wins over the raw UUID.
        summary: native_title.cloned().or(summary).or(Some(uuid)),
        is_renamed: native_title.is_some(),
        provider: Some(PROVIDER_ID.to_string()),
        storage_type: Some("json".to_string()),
        entrypoint: None,
    })
}

/// Narrow helper: extract only `text`-type block text for use in session
/// titles.  Tool results and command output are intentionally excluded so the
/// title reflects the user's actual query, not the tool noise that follows.
fn extract_title_text(value: &Value) -> Option<String> {
    let content = value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)?;
    let mut out = String::new();
    for item in content {
        if item.get("type").and_then(Value::as_str) == Some("text") {
            if let Some(text) = item.get("text").and_then(Value::as_str) {
                if text.trim() != "[REDACTED]" {
                    if !out.is_empty() {
                        out.push(' ');
                    }
                    out.push_str(text);
                }
            }
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Build a short session title from the first user prompt, stripping the
/// `<user_query>` wrapper Cursor injects.
fn summarize(text: &str) -> String {
    let cleaned = clean_user_text(text);
    if cleaned.chars().count() > SUMMARY_MAX_CHARS {
        let truncated: String = cleaned.chars().take(SUMMARY_MAX_CHARS).collect();
        format!("{truncated}\u{2026}")
    } else {
        cleaned
    }
}

// ============================================================================
// Filesystem helpers
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

/// Confine `path` to the `~/.cursor/projects` root.
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

    // ---------------------------------------------------------------------------
    // Fixtures
    // ---------------------------------------------------------------------------

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

    // ---------------------------------------------------------------------------
    // Existing tests (all must still pass)
    // ---------------------------------------------------------------------------

    #[test]
    fn scan_lists_only_projects_with_transcripts() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        write_transcript(base, "Users-jack-client-foo", "uuid-1", SAMPLE);
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

        let session =
            extract_session_info(&file, "Users-jack-client-foo", &HashMap::new()).unwrap();
        assert_eq!(session.actual_session_id, "uuid-1");
        assert_eq!(session.message_count, 2);
        assert_eq!(session.provider.as_deref(), Some("cursor-agent"));
        // Title must be the clean user query, not the raw XML wrapper.
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
        assert_eq!(messages[0].uuid, "uuid-1-0");
        assert_eq!(messages[1].uuid, "uuid-1-1");
        // User text is cleaned: XML wrapper stripped.
        let user_content = messages[0].content.as_ref().unwrap().to_string();
        assert!(
            !user_content.contains("<user_query>"),
            "raw XML tag leaked into user message"
        );
        assert!(
            user_content.contains("fix the LOGIN bug"),
            "user query text missing"
        );
    }

    #[test]
    fn parse_transcript_skips_blank_and_non_turn_lines() {
        let data = format!(
            "\n  \n{SAMPLE}{}",
            r#"{"role":"system","message":{"content":[]}}"#
        );
        let messages = parse_transcript(&data, "s", "");
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
        assert!(s.chars().count() <= SUMMARY_MAX_CHARS + 1);
        assert!(s.ends_with('\u{2026}'));
    }

    // ---------------------------------------------------------------------------
    // New tests for issue #472
    // ---------------------------------------------------------------------------

    /// `clean_user_text` strips the `<user_query>` wrapper and drops the trailing `<context>` blob.
    #[test]
    fn clean_user_text_strips_wrapper_and_context() {
        let input = "<user_query>do something useful</user_query><context>lots of verbose context here</context>";
        let result = clean_user_text(input);
        assert_eq!(result, "do something useful");
        assert!(!result.contains("context"), "context blob leaked");
        assert!(!result.contains('<'), "XML tags leaked");
    }

    /// `clean_user_text` passes non-wrapped assistant text through unchanged.
    #[test]
    fn clean_user_text_no_wrapper_passthrough() {
        let input = "Here is the fix for your bug.";
        assert_eq!(clean_user_text(input), input);
    }

    /// A message consisting entirely of redacted blocks must be skipped.
    #[test]
    fn redacted_only_message_is_skipped() {
        // Explicit redaction type.
        let explicit =
            r#"{"role":"user","message":{"content":[{"type":"redacted","data":"[REDACTED]"}]}}"#;
        // Literal [REDACTED] text sentinel.
        let sentinel =
            r#"{"role":"user","message":{"content":[{"type":"text","text":"[REDACTED]"}]}}"#;
        // Mixed: both forms in one message.
        let mixed_redacted = r#"{"role":"assistant","message":{"content":[{"type":"redacted","data":"[REDACTED]"},{"type":"text","text":"[REDACTED]"}]}}"#;

        let data = format!("{explicit}\n{sentinel}\n{mixed_redacted}\n");
        let messages = parse_transcript(&data, "s", "");
        assert_eq!(messages.len(), 0, "all-redacted messages must be dropped");
    }

    /// A message where only *some* blocks are redacted must still be shown.
    #[test]
    fn mixed_redacted_message_is_kept() {
        let line = r#"{"role":"assistant","message":{"content":[{"type":"redacted","data":"[REDACTED]"},{"type":"text","text":"Here is what I found."}]}}"#;
        let messages = parse_transcript(line, "s", "");
        assert_eq!(messages.len(), 1, "partially-redacted message must be kept");
        let content = messages[0].content.as_ref().unwrap().to_string();
        assert!(content.contains("Here is what I found."));
        assert!(
            !content.contains("[REDACTED]"),
            "redacted placeholder leaked into output"
        );
    }

    /// `tool_result` and `command_output` blocks must appear in the rendered message.
    #[test]
    fn tool_result_and_command_output_extracted() {
        // JSONL: one compact JSON object per line (parse_transcript splits on
        // newlines, so the transcript line must not be pretty-printed).
        let line = r#"{"role":"assistant","message":{"content":[{"type":"tool_result","content":[{"type":"text","text":"file contents here"}]},{"type":"command_output","output":"$ cargo build\nCompiling foo v0.1.0"}]}}"#;
        let messages = parse_transcript(line, "s", "");
        assert_eq!(messages.len(), 1);
        let content = messages[0].content.as_ref().unwrap().to_string();
        assert!(
            content.contains("file contents here"),
            "tool_result text missing"
        );
        assert!(content.contains("cargo build"), "command_output missing");
    }

    // ---------------------------------------------------------------------------
    // Native title index (`~/.cursor/chats/<hash>/<uuid>/meta.json`)
    // ---------------------------------------------------------------------------

    fn write_meta(chats_root: &Path, workspace_hash: &str, uuid: &str, body: &str) {
        let dir = chats_root.join(workspace_hash).join(uuid);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("meta.json"), body).unwrap();
    }

    /// The title the CLI shows in its resume picker (and that `/rename` writes)
    /// lives in `meta.json`'s `title` field, keyed by the session UUID that is
    /// also the transcript file stem.
    #[test]
    fn native_title_index_reads_titles_from_meta_json() {
        let tmp = TempDir::new().unwrap();
        let chats = tmp.path();
        write_meta(
            chats,
            "hash-a",
            "uuid-1",
            r#"{"schemaVersion":1,"createdAtMs":1,"hasConversation":true,"title":"my rename","updatedAtMs":2}"#,
        );
        write_meta(
            chats,
            "hash-b",
            "uuid-2",
            r#"{"schemaVersion":1,"hasConversation":true,"title":"  padded  "}"#,
        );

        let index = load_native_title_index(chats);
        assert_eq!(index.get("uuid-1").map(String::as_str), Some("my rename"));
        // Surrounding whitespace is stripped.
        assert_eq!(index.get("uuid-2").map(String::as_str), Some("padded"));
    }

    /// Missing/empty/malformed titles must not poison the index; non-meta files
    /// (store.db, `prompt_history.json`) and stray layouts must be ignored.
    #[test]
    fn native_title_index_skips_unusable_entries() {
        let tmp = TempDir::new().unwrap();
        let chats = tmp.path();
        // No `title` field (e.g. subagent sessions).
        write_meta(
            chats,
            "h1",
            "uuid-1",
            r#"{"schemaVersion":1,"isSubagent":true}"#,
        );
        // Empty / whitespace-only title.
        write_meta(chats, "h1", "uuid-2", r#"{"schemaVersion":1,"title":"  "}"#);
        // Malformed JSON.
        write_meta(chats, "h1", "uuid-3", "{not json");
        // Non-string title.
        write_meta(chats, "h1", "uuid-4", r#"{"title":42}"#);
        // A meta.json at the wrong depth must not be picked up.
        fs::write(chats.join("meta.json"), r#"{"title":"top-level"}"#).unwrap();
        // store.db / prompt_history.json next to a valid title must be ignored.
        let dir = chats.join("h1").join("uuid-5");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("store.db"), b"sqlite").unwrap();
        fs::write(dir.join("prompt_history.json"), "[]").unwrap();
        fs::write(dir.join("meta.json"), r#"{"title":"real title"}"#).unwrap();

        let index = load_native_title_index(chats);
        assert_eq!(index.len(), 1, "only the valid title may be indexed");
        assert_eq!(index.get("uuid-5").map(String::as_str), Some("real title"));
    }

    /// A stored native title wins over the trimmed first prompt and marks the
    /// session as renamed — this is the `/rename` fix.
    #[test]
    fn extract_session_info_prefers_native_title_over_first_prompt() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        write_transcript(base, "Users-jack-client-foo", "uuid-1", SAMPLE);
        let file = base
            .join("Users-jack-client-foo")
            .join("agent-transcripts")
            .join("uuid-1")
            .join("uuid-1.jsonl");

        let mut index = HashMap::new();
        index.insert("uuid-1".to_string(), "my-renamed-session".to_string());

        let session = extract_session_info(&file, "Users-jack-client-foo", &index).unwrap();
        assert_eq!(session.summary.as_deref(), Some("my-renamed-session"));
        assert!(session.is_renamed, "native title must set is_renamed");
    }

    /// Without a stored title the current behaviour is unchanged: trimmed first
    /// prompt, `is_renamed` false.
    #[test]
    fn extract_session_info_falls_back_to_first_prompt_without_native_title() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        write_transcript(base, "Users-jack-client-foo", "uuid-1", SAMPLE);
        let file = base
            .join("Users-jack-client-foo")
            .join("agent-transcripts")
            .join("uuid-1")
            .join("uuid-1.jsonl");

        // Index present but holding only an unrelated session.
        let mut index = HashMap::new();
        index.insert("other-uuid".to_string(), "other title".to_string());

        let session = extract_session_info(&file, "Users-jack-client-foo", &index).unwrap();
        assert_eq!(session.summary.as_deref(), Some("fix the LOGIN bug"));
        assert!(!session.is_renamed);
    }

    /// `WalkDir` follows a symlinked traversal root by default, so a symlinked
    /// `~/.cursor/chats` must be rejected outright. A real directory is accepted.
    #[test]
    fn chats_root_rejects_symlinked_chats_dir() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();

        // A real chats directory is accepted.
        let good = base.join("good");
        fs::create_dir_all(good.join(".cursor").join("chats")).unwrap();
        assert!(chats_root_in(&good).is_some());

        // A symlinked chats directory is rejected.
        let target = base.join("elsewhere");
        fs::create_dir_all(&target).unwrap();
        let bad = base.join("bad");
        fs::create_dir_all(bad.join(".cursor")).unwrap();
        let link = bad.join(".cursor").join("chats");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&target, &link).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&target, &link).unwrap();
        assert!(
            chats_root_in(&bad).is_none(),
            "symlinked chats root must be rejected"
        );
    }
}
