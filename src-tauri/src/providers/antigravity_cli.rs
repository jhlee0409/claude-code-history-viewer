//! Antigravity CLI (`antigravity-cli`, Google's June-2026 successor to
//! `gemini-cli`) conversation store, surfaced through the existing
//! `antigravity` provider — the CLI writes to `~/.gemini/antigravity-cli`,
//! a sibling of the desktop app's `~/.gemini/antigravity` root, and both
//! layouts may coexist on one machine.
//!
//! Layout (best-effort — there is NO official schema; reverse-engineered from
//! two independent public sources: agentgrep.org/backends/antigravity-cli and
//! the Google Cloud Community Medium tutorial series):
//!
//! ```text
//! ~/.gemini/antigravity-cli/
//! ├── history.jsonl                # conversation index, one line per prompt:
//! │                                #   {"display", "timestamp" (unix ms),
//! │                                #    "workspace", "type"?, "conversationId"?}
//! └── brain/<conversation-uuid>/
//!     └── .system_generated/logs/transcript_full.jsonl
//!                                  # step records: {"step_index", "source"
//!                                  #  ("USER_EXPLICIT"|"SYSTEM"|"MODEL"|…),
//!                                  #  "type" ("USER_INPUT"|"CONVERSATION_HISTORY"|
//!                                  #  "PLANNER_RESPONSE"|"SEARCH_WEB"|…),
//!                                  #  "status", "content"?, "created_at"? (ISO)}
//! ```
//!
//! `content` is absent for thinking-only / tool-call-only / payload-less
//! steps. Because the format is reverse-engineered, parsing is tolerant:
//! malformed lines and unknown enum values are skipped, never propagated as
//! scan errors. Other artifacts in the store (`transcript.jsonl`,
//! `conversations/<uuid>.db` protobuf SQLite, `implicit/*.pb`,
//! per-conversation markdown, `scratch/`) are intentionally NOT parsed.

use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::utils::{build_provider_message, is_symlink, search_json_value_case_insensitive};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// The CLI layout is exposed through the existing `antigravity` provider id
/// (see module docs) — a new id would require the full frontend registry +
/// i18n sweep for what is the same product.
const PROVIDER_ID: &str = "antigravity";
/// Scheme prefix distinguishing CLI project paths from the desktop layout's
/// bare root path inside the shared `antigravity` provider.
pub(crate) const SCHEME: &str = "antigravity-cli://";
const HISTORY_FILE: &str = "history.jsonl";
const BRAIN_DIR: &str = "brain";
/// Sentinel workspace for sessions the `history.jsonl` index cannot place
/// (missing/unreadable index, or a conversation absent from it). Workspaces
/// are absolute paths, so the literal cannot collide with a real one.
const UNKNOWN_WORKSPACE: &str = "unknown";
const FALLBACK_PROJECT_NAME: &str = "Antigravity CLI";
const SUMMARY_MAX_CHARS: usize = 200;

/// Default CLI store root. The existing antigravity provider has no env
/// override pattern, so none is honored here either.
pub(crate) fn default_root() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".gemini").join("antigravity-cli"))
}

/// True when the default CLI root looks like an antigravity-cli store.
pub(crate) fn is_available() -> bool {
    default_root().is_some_and(|root| is_available_at(&root))
}

fn is_available_at(root: &Path) -> bool {
    if is_symlink(root) || !root.is_dir() {
        return false;
    }
    root.join(HISTORY_FILE).is_file() || !list_session_dirs(root).is_empty()
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider interface (default-root wrappers)
// ─────────────────────────────────────────────────────────────────────────────

/// CLI projects grouped by `workspace` from `history.jsonl`. Tolerant: a
/// missing or unreadable store yields an empty list, never an error.
pub fn scan_projects() -> Vec<ClaudeProject> {
    default_root()
        .filter(|root| !is_symlink(root) && root.is_dir())
        .map(|root| scan_projects_from_root(&root))
        .unwrap_or_default()
}

/// Sessions for one workspace (the `antigravity-cli://`-stripped project path).
pub fn load_sessions(workspace: &str) -> Result<Vec<ClaudeSession>, String> {
    Ok(default_root()
        .filter(|root| !is_symlink(root) && root.is_dir())
        .map(|root| load_sessions_from_root(&root, workspace))
        .unwrap_or_default())
}

/// True when `session_path` is a valid CLI session directory under the
/// default root — used by the shared provider to route `load_messages`.
pub(crate) fn owns_session_path(session_path: &str) -> bool {
    default_root().is_some_and(|root| validate_session_dir(&root, session_path).is_ok())
}

pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let root = default_root().ok_or("Antigravity CLI root not found")?;
    load_messages_from_root(&root, session_path)
}

/// Content search across CLI transcripts. Tolerant: errors degrade to an
/// empty result set.
pub fn search(query: &str, limit: usize) -> Vec<ClaudeMessage> {
    default_root()
        .filter(|root| !is_symlink(root) && root.is_dir())
        .map(|root| search_from_root(&root, query, limit))
        .unwrap_or_default()
}

// ─────────────────────────────────────────────────────────────────────────────
// Root-parameterized implementation (fixture-testable)
// ─────────────────────────────────────────────────────────────────────────────

pub(crate) fn scan_projects_from_root(root: &Path) -> Vec<ClaudeProject> {
    #[derive(Default)]
    struct Acc {
        session_count: usize,
        message_count: usize,
        last_modified: String,
    }

    let mut by_workspace: HashMap<String, Acc> = HashMap::new();
    for session in collect_sessions(root) {
        let last = session
            .messages
            .last()
            .map(|m| m.timestamp.clone())
            .unwrap_or_default();
        let acc = by_workspace.entry(session.workspace).or_default();
        acc.session_count += 1;
        acc.message_count += session.messages.len();
        if last > acc.last_modified {
            acc.last_modified = last;
        }
    }

    let mut projects: Vec<ClaudeProject> = by_workspace
        .into_iter()
        .map(|(workspace, acc)| ClaudeProject {
            name: project_name_for_workspace(&workspace),
            path: format!("{SCHEME}{workspace}"),
            actual_path: workspace,
            session_count: acc.session_count,
            message_count: acc.message_count,
            last_modified: acc.last_modified,
            git_info: None,
            provider: Some(PROVIDER_ID.to_string()),
            storage_type: Some("jsonl".to_string()),
            custom_directory_label: None,
        })
        .collect();

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    projects
}

pub(crate) fn load_sessions_from_root(root: &Path, workspace: &str) -> Vec<ClaudeSession> {
    let mut sessions: Vec<ClaudeSession> = collect_sessions(root)
        .into_iter()
        .filter(|session| session.workspace == workspace)
        .map(CliSession::into_claude_session)
        .collect();

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    sessions
}

pub(crate) fn load_messages_from_root(
    root: &Path,
    session_path: &str,
) -> Result<Vec<ClaudeMessage>, String> {
    let session_dir = validate_session_dir(root, session_path)?;
    let conversation_id = session_dir
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .ok_or("Antigravity CLI session path has no directory name")?;

    let transcript = transcript_path(&session_dir);
    let fallback_ts = read_index(root)
        .get(&conversation_id)
        .and_then(|entry| entry.timestamp_ms)
        .map(super::antigravity::ms_to_rfc3339)
        .or_else(|| file_modified_iso(&transcript))
        .unwrap_or_default();

    Ok(parse_transcript(
        &transcript,
        &conversation_id,
        &fallback_ts,
    ))
}

pub(crate) fn search_from_root(root: &Path, query: &str, limit: usize) -> Vec<ClaudeMessage> {
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for session in collect_sessions(root) {
        let project_name = project_name_for_workspace(&session.workspace);
        for mut message in session.messages {
            let matches = message
                .content
                .as_ref()
                .is_some_and(|content| search_json_value_case_insensitive(content, &query_lower));
            if matches {
                message.project_name = Some(project_name.clone());
                results.push(message);
                if results.len() >= limit {
                    return results;
                }
            }
        }
    }

    results
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/// One conversation with a readable full transcript.
struct CliSession {
    conversation_id: String,
    dir: PathBuf,
    workspace: String,
    summary: Option<String>,
    messages: Vec<ClaudeMessage>,
}

impl CliSession {
    fn into_claude_session(self) -> ClaudeSession {
        let first = self
            .messages
            .first()
            .map(|m| m.timestamp.clone())
            .unwrap_or_default();
        let last = self
            .messages
            .last()
            .map(|m| m.timestamp.clone())
            .unwrap_or_default();
        let has_tool_use = self.messages.iter().any(|message| {
            message
                .content
                .as_ref()
                .and_then(Value::as_array)
                .is_some_and(|blocks| {
                    blocks
                        .iter()
                        .any(|block| block.get("type").and_then(Value::as_str) == Some("tool_use"))
                })
        });

        ClaudeSession {
            session_id: self.conversation_id.clone(),
            actual_session_id: self.conversation_id,
            file_path: self.dir.to_string_lossy().to_string(),
            project_name: project_name_for_workspace(&self.workspace),
            message_count: self.messages.len(),
            first_message_time: first,
            last_message_time: last.clone(),
            last_modified: last,
            has_tool_use,
            has_errors: false,
            summary: self.summary,
            is_renamed: false,
            provider: Some(PROVIDER_ID.to_string()),
            storage_type: Some("jsonl".to_string()),
            entrypoint: None,
        }
    }
}

/// First entry per conversation from `history.jsonl` — the conversation's
/// opening prompt, which doubles as its title.
#[derive(Debug, Clone)]
struct IndexEntry {
    display: Option<String>,
    timestamp_ms: Option<u64>,
    workspace: Option<String>,
}

/// Parse the conversation index. Missing/unreadable index or malformed lines
/// degrade to an empty/partial map (fallback grouping takes over).
fn read_index(root: &Path) -> HashMap<String, IndexEntry> {
    let path = root.join(HISTORY_FILE);
    if is_symlink(&path) || !path.is_file() {
        return HashMap::new();
    }
    let Ok(content) = fs::read_to_string(&path) else {
        return HashMap::new();
    };

    let mut index = HashMap::new();
    for line in content.lines().filter(|line| !line.trim().is_empty()) {
        let Ok(rec) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(conversation_id) = rec.get("conversationId").and_then(Value::as_str) else {
            continue;
        };
        index
            .entry(conversation_id.to_string())
            .or_insert_with(|| IndexEntry {
                display: non_empty_str(rec.get("display")),
                timestamp_ms: rec.get("timestamp").and_then(Value::as_u64),
                workspace: non_empty_str(rec.get("workspace")),
            });
    }
    index
}

fn non_empty_str(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
}

fn transcript_path(session_dir: &Path) -> PathBuf {
    session_dir
        .join(".system_generated")
        .join("logs")
        .join("transcript_full.jsonl")
}

/// `brain/<uuid>` directories that carry a readable full transcript.
/// Symlinked directories/files are skipped per repo convention.
fn list_session_dirs(root: &Path) -> Vec<(String, PathBuf)> {
    let brain = root.join(BRAIN_DIR);
    if is_symlink(&brain) || !brain.is_dir() {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir(&brain) else {
        return Vec::new();
    };

    let mut sessions = Vec::new();
    for entry in entries.flatten() {
        if entry
            .file_type()
            .map_or(true, |ft| ft.is_symlink() || !ft.is_dir())
        {
            continue;
        }
        let dir = entry.path();
        let transcript = transcript_path(&dir);
        if is_symlink(&transcript) || !transcript.is_file() {
            continue;
        }
        sessions.push((entry.file_name().to_string_lossy().to_string(), dir));
    }
    sessions.sort_by(|a, b| a.0.cmp(&b.0));
    sessions
}

/// Join the on-disk sessions with the index; sessions the index cannot place
/// fall into the `UNKNOWN_WORKSPACE` ("Antigravity CLI") bucket. Transcripts
/// mapping to zero viewer messages are dropped.
fn collect_sessions(root: &Path) -> Vec<CliSession> {
    let index = read_index(root);

    list_session_dirs(root)
        .into_iter()
        .filter_map(|(conversation_id, dir)| {
            let entry = index.get(&conversation_id);
            let transcript = transcript_path(&dir);
            let fallback_ts = entry
                .and_then(|e| e.timestamp_ms)
                .map(super::antigravity::ms_to_rfc3339)
                .or_else(|| file_modified_iso(&transcript))
                .unwrap_or_default();

            let messages = parse_transcript(&transcript, &conversation_id, &fallback_ts);
            if messages.is_empty() {
                return None;
            }

            let summary = entry
                .and_then(|e| e.display.clone())
                .or_else(|| first_user_text(&messages))
                .map(|text| truncate_chars(&text, SUMMARY_MAX_CHARS));
            let workspace = entry
                .and_then(|e| e.workspace.clone())
                .unwrap_or_else(|| UNKNOWN_WORKSPACE.to_string());

            Some(CliSession {
                conversation_id,
                dir,
                workspace,
                summary,
                messages,
            })
        })
        .collect()
}

fn project_name_for_workspace(workspace: &str) -> String {
    if workspace == UNKNOWN_WORKSPACE {
        return FALLBACK_PROJECT_NAME.to_string();
    }
    Path::new(workspace)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| workspace.to_string())
}

/// Parse `transcript_full.jsonl` into viewer messages. Best-effort:
/// unparseable lines and steps outside the documented mapping are skipped —
/// a partial transcript must never fail the whole session.
fn parse_transcript(path: &Path, conversation_id: &str, fallback_ts: &str) -> Vec<ClaudeMessage> {
    if is_symlink(path) || !path.is_file() {
        return Vec::new();
    }
    let Ok(content) = fs::read_to_string(path) else {
        return Vec::new();
    };

    let mut messages = Vec::new();
    let mut last_ts = fallback_ts.to_string();

    for (line_idx, line) in content.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(rec) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if let Some(ts) = rec
            .get("created_at")
            .and_then(Value::as_str)
            .and_then(parse_iso)
        {
            last_ts = ts;
        }
        if let Some(message) = convert_step(&rec, conversation_id, line_idx as u64, &last_ts) {
            messages.push(message);
        }
    }

    messages
}

/// Map one step record to a viewer message, per the documented step shapes:
/// - `USER_EXPLICIT` / `USER_INPUT` with content → user
/// - `MODEL` with content → assistant; a non-`PLANNER_RESPONSE` step type
///   (e.g. `SEARCH_WEB`) is kept visible as a `tool_use` block
/// - `CONVERSATION_HISTORY` / `SYSTEM` → skip (replay/context, not turns)
/// - content-less steps (thinking-only / tool-call-only) → skip
/// - unknown `source` values → skip, never error (format is best-effort)
fn convert_step(
    rec: &Value,
    conversation_id: &str,
    line_idx: u64,
    timestamp: &str,
) -> Option<ClaudeMessage> {
    let source = rec.get("source").and_then(Value::as_str).unwrap_or("");
    let step_type = rec.get("type").and_then(Value::as_str).unwrap_or("");

    if step_type == "CONVERSATION_HISTORY" || source == "SYSTEM" {
        return None;
    }
    let content = rec
        .get("content")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|content| !content.is_empty())?;

    let step_index = rec
        .get("step_index")
        .and_then(Value::as_u64)
        .unwrap_or(line_idx);
    let uuid = format!("{conversation_id}-step-{step_index}");

    if source == "USER_EXPLICIT" || step_type == "USER_INPUT" {
        return Some(build_provider_message(
            PROVIDER_ID,
            uuid,
            conversation_id,
            timestamp.to_string(),
            "user",
            Some("user"),
            Some(json!([{ "type": "text", "text": content }])),
            None,
        ));
    }

    if source == "MODEL" {
        let blocks = if step_type.is_empty() || step_type == "PLANNER_RESPONSE" {
            json!([{ "type": "text", "text": content }])
        } else {
            // Keep the raw step type visible for non-planner model steps
            // (e.g. SEARCH_WEB) — rendered as a tool_use marker before the
            // step's text payload.
            json!([
                {
                    "type": "tool_use",
                    "id": format!("{uuid}-tool"),
                    "name": step_type,
                    "input": {}
                },
                { "type": "text", "text": content }
            ])
        };
        return Some(build_provider_message(
            PROVIDER_ID,
            uuid,
            conversation_id,
            timestamp.to_string(),
            "assistant",
            Some("assistant"),
            Some(blocks),
            None,
        ));
    }

    None
}

fn first_user_text(messages: &[ClaudeMessage]) -> Option<String> {
    messages
        .iter()
        .find(|message| message.message_type == "user")
        .and_then(|message| message.content.as_ref())
        .and_then(Value::as_array)
        .and_then(|blocks| {
            blocks
                .iter()
                .find_map(|block| block.get("text").and_then(Value::as_str))
        })
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    match text.char_indices().nth(max_chars) {
        Some((idx, _)) => format!("{}...", &text[..idx]),
        None => text.to_string(),
    }
}

fn parse_iso(raw: &str) -> Option<String> {
    DateTime::parse_from_rfc3339(raw)
        .map(|dt| dt.with_timezone(&Utc).to_rfc3339())
        .ok()
        .or_else(|| {
            chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%S%.f")
                .map(|dt| dt.and_utc().to_rfc3339())
                .ok()
        })
}

fn file_modified_iso(path: &Path) -> Option<String> {
    fs::metadata(path)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .map(|time| {
            let dt: DateTime<Utc> = time.into();
            dt.to_rfc3339()
        })
}

/// Reject anything that is not a real, non-symlink `brain/<uuid>` directory
/// under the CLI root — canonical-form comparison so a symlinked session dir
/// cannot redirect reads outside the store.
fn validate_session_dir(root: &Path, session_path: &str) -> Result<PathBuf, String> {
    let session_dir = Path::new(session_path);
    if !session_dir.is_absolute() {
        return Err("Antigravity CLI session path must be absolute".to_string());
    }
    if is_symlink(session_dir) || !session_dir.is_dir() {
        return Err("Antigravity CLI session path is not a directory".to_string());
    }

    let brain_root = root.join(BRAIN_DIR);
    let canonical_root = brain_root
        .canonicalize()
        .map_err(|e| format!("Failed to resolve Antigravity CLI brain root: {e}"))?;
    let canonical_session = session_dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve Antigravity CLI session path: {e}"))?;
    if !canonical_session.starts_with(&canonical_root) {
        return Err("Antigravity CLI session path is outside the brain directory".to_string());
    }

    Ok(canonical_session)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// Root of a fixture antigravity-cli store.
    fn cli_root(temp: &TempDir) -> PathBuf {
        let root = temp.path().join(".gemini").join("antigravity-cli");
        fs::create_dir_all(&root).expect("create cli root");
        root
    }

    fn write_history(root: &Path, lines: &[&str]) {
        fs::write(root.join(HISTORY_FILE), lines.join("\n")).expect("write history.jsonl");
    }

    fn write_transcript(root: &Path, conversation_id: &str, lines: &[&str]) -> PathBuf {
        let dir = root.join(BRAIN_DIR).join(conversation_id);
        let logs = dir.join(".system_generated").join("logs");
        fs::create_dir_all(&logs).expect("create transcript dir");
        fs::write(logs.join("transcript_full.jsonl"), lines.join("\n")).expect("write transcript");
        dir
    }

    /// The documented step shapes, all in one transcript:
    /// `USER_EXPLICIT` input, replayed history, a content-less planner step,
    /// a planner response, a `SEARCH_WEB` step, an unknown source, and a
    /// malformed line.
    fn documented_transcript() -> Vec<&'static str> {
        vec![
            r#"{"step_index": 0, "source": "USER_EXPLICIT", "type": "USER_INPUT", "status": "DONE", "content": "Fix the parser", "created_at": "2026-06-21T10:00:00Z"}"#,
            r#"{"step_index": 1, "source": "SYSTEM", "type": "CONVERSATION_HISTORY", "status": "DONE", "content": "replayed context"}"#,
            r#"{"step_index": 2, "source": "MODEL", "type": "PLANNER_RESPONSE", "status": "DONE"}"#,
            r#"{"step_index": 3, "source": "MODEL", "type": "PLANNER_RESPONSE", "status": "DONE", "content": "Here is my plan", "created_at": "2026-06-21T10:00:05Z"}"#,
            r#"{"step_index": 4, "source": "MODEL", "type": "SEARCH_WEB", "status": "DONE", "content": "searched the docs", "created_at": "2026-06-21T10:00:10Z"}"#,
            r#"{"step_index": 5, "source": "FUTURE_SOURCE", "type": "MYSTERY_STEP", "status": "WHO_KNOWS", "content": "??"}"#,
            "{ this line is not json",
        ]
    }

    fn write_fixture(root: &Path) {
        write_history(
            root,
            &[
                r#"{"display": "Fix the parser", "timestamp": 1750500000000, "workspace": "/tmp/proj-a", "conversationId": "conv-aaa"}"#,
                r#"{"display": "Add tests", "timestamp": 1750500100000, "workspace": "/tmp/proj-b", "type": "chat", "conversationId": "conv-bbb"}"#,
                "{ malformed index line",
                r#"{"display": "no conversation id", "timestamp": 1750500200000, "workspace": "/tmp/proj-a"}"#,
            ],
        );
        write_transcript(root, "conv-aaa", &documented_transcript());
        write_transcript(
            root,
            "conv-bbb",
            &[
                r#"{"step_index": 0, "source": "USER_EXPLICIT", "type": "USER_INPUT", "status": "DONE", "content": "Add tests", "created_at": "2026-06-22T09:00:00Z"}"#,
            ],
        );
        // In no index entry → falls into the "Antigravity CLI" bucket.
        write_transcript(
            root,
            "conv-orphan",
            &[
                r#"{"step_index": 0, "source": "USER_EXPLICIT", "type": "USER_INPUT", "status": "DONE", "content": "orphan prompt", "created_at": "2026-06-23T08:00:00Z"}"#,
            ],
        );
        // Brain dir without a transcript → not a session.
        fs::create_dir_all(root.join(BRAIN_DIR).join("conv-empty")).expect("create empty dir");
    }

    #[test]
    fn scan_projects_groups_sessions_by_workspace_from_history_index() {
        let temp = TempDir::new().expect("temp dir");
        let root = cli_root(&temp);
        write_fixture(&root);

        let mut projects = scan_projects_from_root(&root);
        projects.sort_by(|a, b| a.path.cmp(&b.path));

        assert_eq!(projects.len(), 3, "proj-a, proj-b, and the orphan bucket");
        assert_eq!(projects[0].path, format!("{SCHEME}/tmp/proj-a"));
        assert_eq!(projects[0].name, "proj-a");
        assert_eq!(projects[0].session_count, 1);
        assert_eq!(projects[0].message_count, 3, "user + plan + search step");
        assert_eq!(projects[0].provider.as_deref(), Some("antigravity"));
        assert_eq!(projects[1].path, format!("{SCHEME}/tmp/proj-b"));
        assert_eq!(projects[2].path, format!("{SCHEME}{UNKNOWN_WORKSPACE}"));
        assert_eq!(projects[2].name, FALLBACK_PROJECT_NAME);
        assert_eq!(projects[2].session_count, 1);
    }

    #[test]
    fn scan_projects_falls_back_to_single_project_when_index_missing() {
        let temp = TempDir::new().expect("temp dir");
        let root = cli_root(&temp);
        // No history.jsonl at all.
        write_transcript(&root, "conv-aaa", &documented_transcript());

        let projects = scan_projects_from_root(&root);

        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, FALLBACK_PROJECT_NAME);
        assert_eq!(projects[0].path, format!("{SCHEME}{UNKNOWN_WORKSPACE}"));
        assert_eq!(projects[0].session_count, 1);
    }

    #[test]
    fn load_sessions_uses_index_display_as_title_and_conversation_uuid_as_id() {
        let temp = TempDir::new().expect("temp dir");
        let root = cli_root(&temp);
        write_fixture(&root);

        let sessions = load_sessions_from_root(&root, "/tmp/proj-a");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "conv-aaa");
        assert_eq!(sessions[0].summary.as_deref(), Some("Fix the parser"));
        assert_eq!(sessions[0].message_count, 3);
        assert!(sessions[0].has_tool_use, "SEARCH_WEB surfaces as tool_use");
        assert_eq!(sessions[0].provider.as_deref(), Some("antigravity"));
        assert!(
            sessions[0]
                .first_message_time
                .starts_with("2026-06-21T10:00:00"),
            "first time from created_at, got {}",
            sessions[0].first_message_time
        );
        assert!(
            sessions[0]
                .last_message_time
                .starts_with("2026-06-21T10:00:10"),
            "last time from created_at, got {}",
            sessions[0].last_message_time
        );
    }

    #[test]
    fn load_sessions_falls_back_to_first_user_input_for_unindexed_sessions() {
        let temp = TempDir::new().expect("temp dir");
        let root = cli_root(&temp);
        write_fixture(&root);

        let sessions = load_sessions_from_root(&root, UNKNOWN_WORKSPACE);

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "conv-orphan");
        assert_eq!(sessions[0].summary.as_deref(), Some("orphan prompt"));
        assert_eq!(sessions[0].project_name, FALLBACK_PROJECT_NAME);
    }

    #[test]
    fn load_messages_maps_documented_step_shapes() {
        let temp = TempDir::new().expect("temp dir");
        let root = cli_root(&temp);
        write_fixture(&root);
        let session_dir = root.join(BRAIN_DIR).join("conv-aaa");

        let messages =
            load_messages_from_root(&root, &session_dir.to_string_lossy()).expect("load messages");

        // USER_EXPLICIT + 2 MODEL steps; SYSTEM/CONVERSATION_HISTORY, the
        // content-less planner step, the unknown source, and the malformed
        // line are all skipped.
        assert_eq!(messages.len(), 3);

        assert_eq!(messages[0].uuid, "conv-aaa-step-0");
        assert_eq!(messages[0].message_type, "user");
        assert_eq!(messages[0].session_id, "conv-aaa");
        assert_eq!(messages[0].provider.as_deref(), Some("antigravity"));
        assert_eq!(
            messages[0].content.as_ref().unwrap()[0]["text"],
            "Fix the parser"
        );
        assert!(messages[0].timestamp.starts_with("2026-06-21T10:00:00"));

        assert_eq!(messages[1].uuid, "conv-aaa-step-3");
        assert_eq!(messages[1].message_type, "assistant");
        assert_eq!(messages[1].content.as_ref().unwrap()[0]["type"], "text");
        assert_eq!(
            messages[1].content.as_ref().unwrap()[0]["text"],
            "Here is my plan"
        );

        // Non-planner MODEL step keeps the raw type visible as a tool_use.
        assert_eq!(messages[2].uuid, "conv-aaa-step-4");
        assert_eq!(messages[2].message_type, "assistant");
        let blocks = messages[2].content.as_ref().unwrap();
        assert_eq!(blocks[0]["type"], "tool_use");
        assert_eq!(blocks[0]["name"], "SEARCH_WEB");
        assert_eq!(blocks[1]["type"], "text");
        assert_eq!(blocks[1]["text"], "searched the docs");
        assert!(messages[2].timestamp.starts_with("2026-06-21T10:00:10"));
    }

    #[test]
    fn load_messages_tolerates_malformed_lines_and_unknown_enums() {
        let temp = TempDir::new().expect("temp dir");
        let root = cli_root(&temp);
        write_transcript(
            &root,
            "conv-tolerant",
            &[
                "not json at all",
                r#"{"step_index": 0, "source": "FUTURE_SOURCE", "type": "MYSTERY", "content": "??"}"#,
                r#"{"step_index": 1, "source": "MODEL", "type": "TOTALLY_NEW_TYPE", "status": "MAYBE", "content": "still shown", "created_at": "2026-06-24T11:00:00Z"}"#,
                r#"{"step_index": 2}"#,
                r#"{"step_index": 3, "source": "USER_EXPLICIT", "type": "USER_INPUT", "content": "after the noise"}"#,
            ],
        );
        let session_dir = root.join(BRAIN_DIR).join("conv-tolerant");

        let messages =
            load_messages_from_root(&root, &session_dir.to_string_lossy()).expect("load messages");

        assert_eq!(messages.len(), 2, "unknown MODEL type kept, noise skipped");
        assert_eq!(messages[0].uuid, "conv-tolerant-step-1");
        assert_eq!(
            messages[0].content.as_ref().unwrap()[0]["name"],
            "TOTALLY_NEW_TYPE"
        );
        assert_eq!(messages[1].uuid, "conv-tolerant-step-3");
        assert_eq!(messages[1].message_type, "user");
        assert!(
            messages[1].timestamp.starts_with("2026-06-24T11:00:00"),
            "created_at carries forward over steps without one, got {}",
            messages[1].timestamp
        );
    }

    #[cfg(unix)]
    #[test]
    /// A symlinked session directory pointing outside the CLI store must be
    /// rejected by the path guard, not read through.
    fn load_messages_rejects_symlinked_session_dir() {
        use std::os::unix::fs as unix_fs;

        let temp = TempDir::new().expect("temp dir");
        let root = cli_root(&temp);
        write_fixture(&root);

        let outside = TempDir::new().expect("outside dir");
        let outside_root = cli_root(&outside);
        let outside_session =
            write_transcript(&outside_root, "conv-evil", &documented_transcript());

        let link = root.join(BRAIN_DIR).join("conv-link");
        unix_fs::symlink(&outside_session, &link).expect("create symlink");

        load_messages_from_root(&root, &link.to_string_lossy())
            .expect_err("symlinked session dir must be rejected");
    }

    #[test]
    fn search_matches_transcript_content_and_respects_limit() {
        let temp = TempDir::new().expect("temp dir");
        let root = cli_root(&temp);
        write_fixture(&root);

        let results = search_from_root(&root, "parser", 10);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].session_id, "conv-aaa");
        assert_eq!(results[0].project_name.as_deref(), Some("proj-a"));

        let limited = search_from_root(&root, "e", 2);
        assert_eq!(limited.len(), 2, "limit respected");
    }
}
