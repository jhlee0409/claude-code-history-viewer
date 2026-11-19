//! Qoder provider (Alibaba's agentic coding IDE and CLI, <https://qoder.com>).
//!
//! Qoder writes every agent session as a Claude Code-format JSONL transcript:
//! `type: "user" | "assistant" | "system"` lines carrying Anthropic `message`
//! objects with Claude's tool names. Its lines therefore go through the
//! shared Claude line parser (`parse_viewer_line`) and render with the
//! existing tool renderers.
//!
//! Stores, each a `projects/` folder; every one present is read:
//! - Qoder CLI and the Qoder desktop app: `$QODER_CONFIG_DIR/projects`, else
//!   `~/.qoder/projects` (<https://docs.qoder.com/cli/sessions>).
//! - Qoder CN: `$QODERCN_CONFIG_DIR/projects`, else `~/.qoder-cn/projects`.
//! - The Qoder IDE's agent: `<app data>/Qoder/SharedClientCache/cli/projects`
//!   (`QoderCN/…` for the CN build), `<app data>` being
//!   `~/Library/Application Support` on macOS, `%APPDATA%` on Windows and
//!   `$XDG_CONFIG_HOME` or `~/.config` elsewhere (kenn-io/agentsview#1233).
//!
//! The VS Code `workspaceStorage/<hash>/chatSessions` folder is not where the
//! Qoder IDE keeps its chats: a Qoder install has only `state.vscdb` and
//! `chatEditingSessions/` there (same report).
//!
//! Layout: `<store>/<project-slug>/<session>.jsonl`; the IDE store also keeps
//! transcripts directly in `<store>/`, with a `<session>-session.json`
//! sidecar (`title`, `working_dir`). Subagent runs live in
//! `<session>/subagents/agent-*.jsonl`, as with Claude Code. Checkpoint
//! journals (`*.checkpoints.jsonl`) and `<session>/state.json` are not
//! transcripts.
//!
//! Only `user`, `assistant` and `system` lines are messages. Qoder's own
//! records (`workspace-directories`, `runtime-config`, `attachment`,
//! `last-prompt`, `file-history-snapshot`, …) and any record type this
//! reader does not know are skipped. Two Qoder-specific readings, both seen
//! in real transcripts (sanitized samples in junhoyeo/tokscale#1609):
//! - From 1.1.82 an assistant `message.model` is always `"auto"`; the model
//!   slot in use is the latest `runtime-config.model` or user
//!   `businessModelKey`, which replaces it.
//! - On Qoder-managed models the token counters in `message.usage` are
//!   written as 0 unless `QODER_EXPOSE_TOKEN_USAGE=1`. A usage whose counters
//!   are all zero records no usage, so it is dropped rather than counted as
//!   zero tokens.
//!
//! Projects group sessions by working directory (`qoder://<cwd>`), taken from
//! the transcript's `cwd`, else the sidecar's `working_dir`, else the
//! `workspace-directories` record; a session with none of them is grouped by
//! the folder it is stored in.

use crate::commands::session::{
    fill_missing_timestamps, is_viewer_visible_line, parse_viewer_line,
};
use crate::commands::stats::session_files;
use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession, TokenUsage};
use crate::providers::scan_report::ScanReport;
use crate::providers::ProviderInfo;
use crate::utils::{find_line_starts, search_json_value_case_insensitive};
use chrono::{DateTime, Utc};
use memchr::memmem;
use memmap2::Mmap;
use rayon::prelude::*;
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

const PROVIDER: &str = "qoder";
const SCHEME: &str = "qoder://";
/// The IDE's sidecar next to a transcript: `<session>-session.json`.
const SIDECAR_SUFFIX: &str = "-session.json";

/// `$<env>` (a relative value resolves against the working directory, as
/// `QODER_CONFIG_DIR` does for the CLI), else `~/<dot_dir>`.
fn config_dir(env: &str, dot_dir: &str) -> Option<PathBuf> {
    if let Some(value) = std::env::var_os(env).filter(|v| !v.is_empty()) {
        let path = PathBuf::from(value);
        return Some(if path.is_absolute() {
            path
        } else {
            std::env::current_dir().ok()?.join(path)
        });
    }
    Some(crate::utils::home_dir()?.join(dot_dir))
}

/// The per-user folder an Electron app (the Qoder IDE) keeps its data in.
fn app_data_dir() -> Option<PathBuf> {
    let home = crate::utils::home_dir()?;
    let dir = if cfg!(target_os = "macos") {
        home.join("Library").join("Application Support")
    } else if cfg!(windows) {
        home.join("AppData").join("Roaming")
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .unwrap_or_else(|| home.join(".config"))
    };
    Some(dir)
}

/// Every Qoder transcript store this machine may have, present or not: the
/// CLI / desktop store, Qoder CN's, then the IDE's (international, CN).
pub(crate) fn store_dirs() -> Vec<PathBuf> {
    let ide_store = |app: &str| {
        app_data_dir().map(|dir| {
            dir.join(app)
                .join("SharedClientCache")
                .join("cli")
                .join("projects")
        })
    };
    let candidates = [
        config_dir("QODER_CONFIG_DIR", ".qoder").map(|dir| dir.join("projects")),
        config_dir("QODERCN_CONFIG_DIR", ".qoder-cn").map(|dir| dir.join("projects")),
        ide_store("Qoder"),
        ide_store("QoderCN"),
    ];
    let mut dirs: Vec<PathBuf> = Vec::new();
    for dir in candidates.into_iter().flatten() {
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    dirs
}

/// The stores that are there; one that may not be looked at is recorded.
fn present_stores(report: &ScanReport) -> Vec<PathBuf> {
    store_dirs()
        .into_iter()
        .filter(|dir| report.is_dir(dir))
        .collect()
}

/// Whether `path` lies in a Qoder store (a session, sidecar or subagent
/// transcript), judged by its path alone.
pub fn is_session_path(path: &str) -> bool {
    let path = Path::new(path);
    store_dirs().iter().any(|store| path.starts_with(store))
}

/// Detect a Qoder installation: any store present.
pub fn detect() -> Option<ProviderInfo> {
    let report = ScanReport::default();
    let stores = present_stores(&report);
    let base = stores.first()?;
    Some(ProviderInfo {
        id: PROVIDER.to_string(),
        display_name: "Qoder".to_string(),
        base_path: base.to_string_lossy().to_string(),
        is_available: stores
            .iter()
            .any(|store| !transcript_files(store, &report).is_empty()),
    })
}

fn is_transcript_name(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    path.extension().and_then(|e| e.to_str()) == Some("jsonl")
        && !name.ends_with(".checkpoints.jsonl")
        && !name.starts_with("agent-")
}

/// The transcripts of one store: `<store>/<project>/*.jsonl` and, for the
/// IDE's flat layout, `<store>/*.jsonl`. Symlinks are never followed (an
/// entry's own file type is used); a listing that fails is recorded.
fn transcript_files(store: &Path, report: &ScanReport) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for entry in report.read_dir(store) {
        let path = entry.path();
        let Some(file_type) = report.read(&path, entry.file_type()) else {
            continue;
        };
        if file_type.is_dir() {
            for inner in report.read_dir(&path) {
                let inner_path = inner.path();
                if report
                    .read(&inner_path, inner.file_type())
                    .is_some_and(|t| t.is_file())
                    && is_transcript_name(&inner_path)
                {
                    files.push(inner_path);
                }
            }
        } else if file_type.is_file() && is_transcript_name(&path) {
            files.push(path);
        }
    }
    files.sort();
    files
}

// ============================================================================
// Session metadata
// ============================================================================

#[derive(Deserialize)]
struct MetaLine {
    #[serde(rename = "type", default)]
    kind: String,
    subtype: Option<String>,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    timestamp: Option<Value>,
    #[serde(rename = "isSidechain")]
    is_sidechain: Option<bool>,
    #[serde(rename = "isMeta")]
    is_meta: Option<bool>,
    cwd: Option<String>,
    directories: Option<Vec<Value>>,
    #[serde(rename = "customTitle")]
    custom_title: Option<String>,
    #[serde(rename = "aiTitle")]
    ai_title: Option<String>,
    #[serde(rename = "humanInput")]
    human_input: Option<HumanInput>,
    message: Option<MetaMessage>,
}

#[derive(Deserialize)]
struct HumanInput {
    text: Option<String>,
}

#[derive(Deserialize)]
struct MetaMessage {
    content: Option<Value>,
}

/// What one pass over a transcript finds for its session row.
#[derive(Debug, Default)]
struct SessionMeta {
    session_id: Option<String>,
    cwd: Option<String>,
    /// First folder of a `workspace-directories` record.
    workspace: Option<String>,
    /// Viewer-visible messages, counted by the loader's own rule.
    message_count: usize,
    first_ts: Option<String>,
    last_ts: Option<String>,
    has_tool_use: bool,
    has_errors: bool,
    /// A `/rename` (`custom-title`), the last one wins.
    custom_title: Option<String>,
    /// Qoder's generated title (`ai-title`), the last one wins.
    ai_title: Option<String>,
    first_prompt: Option<String>,
}

/// The IDE's `<session>-session.json`.
#[derive(Debug, Default, Deserialize)]
struct Sidecar {
    title: Option<String>,
    working_dir: Option<String>,
}

fn non_empty(text: Option<&str>) -> Option<String> {
    text.map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_string)
}

/// The first text a person typed, skipping injected `<…>` blocks.
fn prompt_text(content: &Value) -> Option<String> {
    let genuine = |text: &str| non_empty(Some(text)).filter(|t| !t.starts_with('<'));
    match content {
        Value::String(text) => genuine(text),
        Value::Array(blocks) => blocks.iter().find_map(|block| {
            (block.get("type").and_then(Value::as_str) == Some("text"))
                .then(|| block.get("text").and_then(Value::as_str))
                .flatten()
                .and_then(genuine)
        }),
        _ => None,
    }
}

fn blocks_of(content: Option<&Value>) -> &[Value] {
    content.and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

fn read_meta(text: &str) -> SessionMeta {
    let mut meta = SessionMeta::default();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(rec) = serde_json::from_str::<MetaLine>(line) else {
            continue;
        };
        if meta.session_id.is_none() {
            meta.session_id = non_empty(rec.session_id.as_deref());
        }
        if meta.cwd.is_none() {
            meta.cwd = non_empty(rec.cwd.as_deref());
        }
        match rec.kind.as_str() {
            "workspace-directories" if meta.workspace.is_none() => {
                meta.workspace = rec
                    .directories
                    .iter()
                    .flatten()
                    .find_map(|dir| non_empty(dir.as_str()));
            }
            "custom-title" => {
                if let Some(title) = non_empty(rec.custom_title.as_deref()) {
                    meta.custom_title = Some(title);
                }
            }
            "ai-title" => {
                if let Some(title) = non_empty(rec.ai_title.as_deref()) {
                    meta.ai_title = Some(title);
                }
            }
            _ => {}
        }
        if !matches!(rec.kind.as_str(), "user" | "assistant" | "system")
            || !is_viewer_visible_line(
                &rec.kind,
                rec.subtype.as_deref(),
                rec.is_sidechain,
                rec.is_meta,
                rec.session_id.is_some() || rec.timestamp.is_some(),
                false,
            )
        {
            continue;
        }
        meta.message_count += 1;
        if let Some(ts) = non_empty(rec.timestamp.as_ref().and_then(Value::as_str)) {
            meta.first_ts.get_or_insert_with(|| ts.clone());
            meta.last_ts = Some(ts);
        }
        let content = rec.message.as_ref().and_then(|m| m.content.as_ref());
        for block in blocks_of(content) {
            match block.get("type").and_then(Value::as_str) {
                Some("tool_use") => meta.has_tool_use = true,
                Some("tool_result") => {
                    meta.has_tool_use = true;
                    if block.get("is_error").and_then(Value::as_bool) == Some(true) {
                        meta.has_errors = true;
                    }
                }
                _ => {}
            }
        }
        if rec.kind == "user" && meta.first_prompt.is_none() {
            meta.first_prompt = rec
                .human_input
                .as_ref()
                .and_then(|input| non_empty(input.text.as_deref()))
                .or_else(|| content.and_then(prompt_text));
        }
    }
    meta
}

/// One transcript as the session list sees it.
struct Transcript {
    path: PathBuf,
    meta: SessionMeta,
    sidecar: Sidecar,
    modified: Option<SystemTime>,
}

impl Transcript {
    /// The working directory the session ran in, when it says.
    fn workspace(&self) -> Option<&str> {
        self.meta
            .cwd
            .as_deref()
            .or(self.sidecar.working_dir.as_deref())
            .or(self.meta.workspace.as_deref())
    }

    /// The project the session belongs to: its working directory, else the
    /// folder it is stored in.
    fn group_key(&self) -> String {
        self.workspace().map_or_else(
            || {
                self.path
                    .parent()
                    .map(|dir| dir.to_string_lossy().to_string())
                    .unwrap_or_default()
            },
            |dir| dir.trim_end_matches(['/', '\\']).to_string(),
        )
    }

    fn modified_rfc3339(&self) -> String {
        self.modified
            .map_or_else(Utc::now, DateTime::<Utc>::from)
            .to_rfc3339()
    }

    /// When the session last did something: its last message, else the
    /// file's modification time.
    fn last_activity(&self) -> DateTime<Utc> {
        self.meta
            .last_ts
            .as_deref()
            .and_then(|ts| DateTime::parse_from_rfc3339(ts).ok())
            .map(|ts| ts.with_timezone(&Utc))
            .or_else(|| self.modified.map(DateTime::<Utc>::from))
            .unwrap_or_else(Utc::now)
    }

    fn to_session(&self) -> ClaudeSession {
        let path = self.path.to_string_lossy().to_string();
        let modified = self.modified_rfc3339();
        let summary = self
            .meta
            .custom_title
            .clone()
            .or_else(|| self.meta.ai_title.clone())
            .or_else(|| non_empty(self.sidecar.title.as_deref()))
            .or_else(|| self.meta.first_prompt.clone());
        ClaudeSession {
            session_id: path.clone(),
            actual_session_id: self.meta.session_id.clone().unwrap_or_else(|| {
                self.path
                    .file_stem()
                    .map(|stem| stem.to_string_lossy().to_string())
                    .unwrap_or_default()
            }),
            file_path: path,
            project_name: leaf_name(&self.group_key()),
            message_count: self.meta.message_count,
            first_message_time: self
                .meta
                .first_ts
                .clone()
                .unwrap_or_else(|| modified.clone()),
            last_message_time: self
                .meta
                .last_ts
                .clone()
                .unwrap_or_else(|| modified.clone()),
            last_modified: modified,
            has_tool_use: self.meta.has_tool_use,
            has_errors: self.meta.has_errors,
            summary,
            is_renamed: self.meta.custom_title.is_some(),
            provider: Some(PROVIDER.to_string()),
            storage_type: None,
            entrypoint: None,
        }
    }
}

/// The last segment of a path in either separator style (a Windows `cwd`
/// read on macOS still names its folder).
fn leaf_name(path: &str) -> String {
    path.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .find(|segment| !segment.is_empty())
        .unwrap_or(path)
        .to_string()
}

/// A history file of `root` (a canonical store), opened without following a
/// symlink, and read whole; bytes that are not UTF-8 are replaced.
fn read_text(path: &Path, root: &Path) -> Result<(String, Option<SystemTime>), String> {
    let (mut file, metadata) = session_files::open_session_file(path, root)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    Ok((
        String::from_utf8_lossy(&bytes).into_owned(),
        metadata.modified().ok(),
    ))
}

/// The IDE sidecar beside `transcript`, when there is one that parses. It
/// only names the session, so one that cannot be read is no sidecar.
fn read_sidecar(transcript: &Path, root: &Path) -> Sidecar {
    let Some(stem) = transcript.file_stem().and_then(|s| s.to_str()) else {
        return Sidecar::default();
    };
    let path = transcript.with_file_name(format!("{stem}{SIDECAR_SUFFIX}"));
    if fs::symlink_metadata(&path).is_err() {
        return Sidecar::default();
    }
    read_text(&path, root)
        .ok()
        .and_then(|(text, _)| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// The session row of one transcript; `None` when it cannot be read
/// (recorded) or holds no message.
fn read_transcript(path: &Path, root: &Path, report: &ScanReport) -> Option<Transcript> {
    let (text, modified) = report.read(path, read_text(path, root))?;
    let meta = read_meta(&text);
    if meta.message_count == 0 {
        return None;
    }
    Some(Transcript {
        sidecar: read_sidecar(path, root),
        path: path.to_path_buf(),
        meta,
        modified,
    })
}

/// Every session of every present store; what cannot be read is recorded.
fn all_transcripts(report: &ScanReport) -> Vec<Transcript> {
    let mut transcripts = Vec::new();
    for store in present_stores(report) {
        let Some(root) = report.read(&store, fs::canonicalize(&store)) else {
            continue;
        };
        let files = transcript_files(&store, report);
        transcripts.extend(
            files
                .par_iter()
                .filter_map(|path| read_transcript(path, &root, report))
                .collect::<Vec<_>>(),
        );
    }
    transcripts
}

// ============================================================================
// Provider interface
// ============================================================================

/// Scan Qoder projects (sessions grouped by working directory).
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    scan_projects_reporting(&ScanReport::default())
}

/// [`scan_projects`], recording in `report` the stores, folders and
/// transcripts it could not read.
#[allow(clippy::unnecessary_wraps)] // Result kept to match the provider interface.
pub(crate) fn scan_projects_reporting(report: &ScanReport) -> Result<Vec<ClaudeProject>, String> {
    struct Group {
        sessions: usize,
        messages: usize,
        last: DateTime<Utc>,
    }
    let mut groups: BTreeMap<String, Group> = BTreeMap::new();
    for transcript in all_transcripts(report) {
        let last = transcript.last_activity();
        let group = groups.entry(transcript.group_key()).or_insert(Group {
            sessions: 0,
            messages: 0,
            last,
        });
        group.sessions += 1;
        group.messages += transcript.meta.message_count;
        group.last = group.last.max(last);
    }
    let mut projects: Vec<(DateTime<Utc>, ClaudeProject)> = groups
        .into_iter()
        .map(|(key, group)| {
            let project = ClaudeProject {
                name: leaf_name(&key),
                path: format!("{SCHEME}{key}"),
                actual_path: key,
                session_count: group.sessions,
                message_count: group.messages,
                last_modified: group.last.to_rfc3339(),
                git_info: None,
                provider: Some(PROVIDER.to_string()),
                storage_type: None,
                custom_directory_label: None,
            };
            (group.last, project)
        })
        .collect();
    projects.sort_by_key(|(last, _)| std::cmp::Reverse(*last));
    Ok(projects.into_iter().map(|(_, project)| project).collect())
}

fn project_key(project_path: &str) -> Result<&str, String> {
    project_path
        .strip_prefix(SCHEME)
        .ok_or_else(|| format!("Invalid Qoder project path: {project_path}"))
}

/// Load the sessions of one Qoder project (`qoder://<cwd>`).
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    load_sessions_reporting(project_path, &ScanReport::default())
}

/// [`load_sessions`], recording in `report` what it could not read: a
/// transcript that cannot be read may belong to the project.
pub(crate) fn load_sessions_reporting(
    project_path: &str,
    report: &ScanReport,
) -> Result<Vec<ClaudeSession>, String> {
    let key = project_key(project_path)?;
    let mut transcripts: Vec<Transcript> = all_transcripts(report)
        .into_iter()
        .filter(|transcript| transcript.group_key() == key)
        .collect();
    transcripts.sort_by_key(|transcript| std::cmp::Reverse(transcript.last_activity()));
    Ok(transcripts.iter().map(Transcript::to_session).collect())
}

/// The canonical store `path` lies in.
fn store_root_of(path: &Path) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path)
        .map_err(|e| format!("Failed to open Qoder session {}: {e}", path.display()))?;
    store_dirs()
        .into_iter()
        .filter_map(|store| fs::canonicalize(store).ok())
        .find(|root| canonical.starts_with(root))
        .ok_or_else(|| {
            format!(
                "Session path is outside the Qoder stores: {}",
                path.display()
            )
        })
}

/// Load the messages of one Qoder transcript (a session or a subagent run).
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let path = Path::new(session_path);
    read_messages(path, &store_root_of(path)?)
}

/// [`load_messages`] with the session's subagent transcripts
/// (`<session>/subagents/agent-*.jsonl`) appended as sidechain messages, so
/// billing totals include them and `conversation_only` leaves them out.
pub fn load_messages_with_subagents(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let path = Path::new(session_path);
    let root = store_root_of(path)?;
    let mut messages = read_messages(path, &root)?;
    for subagent in session_files::regular_subagent_files(path) {
        let mut run = read_messages(&subagent, &root)?;
        for message in &mut run {
            message.is_sidechain = Some(true);
        }
        messages.extend(run);
    }
    Ok(messages)
}

#[allow(unsafe_code)] // Read-only mapping, as the Claude loader does.
fn read_messages(path: &Path, root: &Path) -> Result<Vec<ClaudeMessage>, String> {
    let (file, _) = session_files::open_session_file(path, root)?;
    // SAFETY: the file is only read and its handle outlives the mapping;
    // Qoder appends to a transcript, it never rewrites one in place.
    let mmap = unsafe { Mmap::map(&file) }
        .map_err(|e| format!("Failed to memory-map {}: {e}", path.display()))?;
    Ok(messages_from_bytes(&mmap))
}

/// The model slot a line selects: a `runtime-config` record's `model`, or a
/// user line's `businessModelKey`. `"auto"` selects none.
fn model_slot(line: &[u8]) -> Option<String> {
    #[derive(Deserialize)]
    struct SlotLine {
        #[serde(rename = "type")]
        kind: Option<String>,
        model: Option<Value>,
        #[serde(rename = "businessModelKey")]
        business_model_key: Option<Value>,
    }
    if memmem::find(line, b"\"runtime-config\"").is_none()
        && memmem::find(line, b"\"businessModelKey\"").is_none()
    {
        return None;
    }
    let rec: SlotLine = serde_json::from_slice(line).ok()?;
    let slot = if rec.kind.as_deref() == Some("runtime-config") {
        rec.model
    } else {
        rec.business_model_key
    };
    non_empty(slot.as_ref().and_then(Value::as_str)).filter(|m| !m.eq_ignore_ascii_case("auto"))
}

/// Whether a usage records any token at all (see the module docs: Qoder
/// writes zeros for usage it does not expose).
fn records_tokens(usage: &TokenUsage) -> bool {
    let nested = usage.cache_creation.as_ref().map_or(0, |c| {
        c.ephemeral_5m_input_tokens.unwrap_or(0) + c.ephemeral_1h_input_tokens.unwrap_or(0)
    });
    [
        usage.input_tokens,
        usage.output_tokens,
        usage.cache_creation_input_tokens,
        usage.cache_read_input_tokens,
        usage.cache_creation_input_tokens_5m,
        usage.cache_creation_input_tokens_1h,
        usage.reasoning_tokens,
    ]
    .into_iter()
    .flatten()
    .any(|count| count > 0)
        || nested > 0
}

fn messages_from_bytes(bytes: &[u8]) -> Vec<ClaudeMessage> {
    let line_starts = find_line_starts(bytes);
    let line_at = |i: usize| {
        let end = line_starts.get(i + 1).map_or(bytes.len(), |&e| e - 1);
        &bytes[line_starts[i]..end]
    };
    let mut slot: Option<String> = None;
    let mut messages: Vec<(usize, ClaudeMessage)> = Vec::new();
    for index in 0..line_starts.len() {
        let line = line_at(index);
        if line.is_empty() {
            continue;
        }
        if let Some(selected) = model_slot(line) {
            slot = Some(selected);
        }
        let mut buf = line.to_vec();
        let Some(mut message) = parse_viewer_line(index, &mut buf) else {
            continue;
        };
        if !matches!(
            message.message_type.as_str(),
            "user" | "assistant" | "system"
        ) {
            continue;
        }
        message.provider = Some(PROVIDER.to_string());
        if message
            .model
            .as_deref()
            .is_some_and(|model| model.eq_ignore_ascii_case("auto"))
        {
            if let Some(slot) = &slot {
                message.model = Some(slot.clone());
            }
        }
        if message.usage.as_ref().is_some_and(|u| !records_tokens(u)) {
            message.usage = None;
        }
        messages.push((index, message));
    }
    fill_missing_timestamps(line_starts.len(), line_at, &mut messages);
    messages.into_iter().map(|(_, message)| message).collect()
}

/// Search every Qoder session for `query` (case-insensitive).
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let query_lower = query.to_lowercase();
    let report = ScanReport::default();
    let mut results = Vec::new();
    for store in present_stores(&report) {
        let Ok(root) = fs::canonicalize(&store) else {
            continue;
        };
        for path in transcript_files(&store, &report) {
            let Ok(messages) = read_messages(&path, &root) else {
                continue;
            };
            let mut hits: Vec<ClaudeMessage> = messages
                .into_iter()
                .filter(|message| {
                    message
                        .content
                        .as_ref()
                        .is_some_and(|c| search_json_value_case_insensitive(c, &query_lower))
                })
                .collect();
            if hits.is_empty() {
                continue;
            }
            let key = read_transcript(&path, &root, &report).map_or_else(
                || {
                    path.parent()
                        .map(|dir| dir.to_string_lossy().to_string())
                        .unwrap_or_default()
                },
                |transcript| transcript.group_key(),
            );
            for hit in &mut hits {
                hit.project_name = Some(leaf_name(&key));
                hit.project_path = Some(format!("{SCHEME}{key}"));
            }
            hits.truncate(limit - results.len());
            results.extend(hits);
            if results.len() >= limit {
                return Ok(results);
            }
        }
    }
    Ok(results)
}

/// Display name of a `qoder://<cwd>` project.
pub fn project_name(project_path: &str) -> String {
    leaf_name(project_path.strip_prefix(SCHEME).unwrap_or(project_path))
}

/// Display name of the project a session file belongs to.
pub fn project_name_for_session(session_path: &str) -> String {
    let path = Path::new(session_path);
    store_root_of(path)
        .ok()
        .and_then(|root| read_transcript(path, &root, &ScanReport::default()))
        .map_or_else(
            || {
                path.parent()
                    .map(|dir| leaf_name(&dir.to_string_lossy()))
                    .unwrap_or_else(|| PROVIDER.to_string())
            },
            |transcript| leaf_name(&transcript.group_key()),
        )
}

#[cfg(test)]
mod tests {
    //! Fixtures mirror Qoder's documented on-disk format; no Qoder install
    //! was available to capture from.
    //!
    //! - `tests/fixtures/qoder/cli-session-1.1.84.jsonl` follows, record for
    //!   record, the sanitized 1.1.83–1.1.85 transcript in
    //!   <https://gist.github.com/mamaruo/a76861748bb9072d05c114e45a21b039>
    //!   (posted in junhoyeo/tokscale#1609): the same record types, keys and
    //!   nesting, with the redacted text replaced by an invented test run.
    //! - The zero-usage lines below copy the 1.1.28 sample of that gist
    //!   (`usage` counters written as 0 beside `credits`).
    //! - The IDE store's flat layout and `-session.json` sidecar keys
    //!   (`id`, `title`, `working_dir`) are as reported from a Qoder IDE
    //!   1.17.3 install in kenn-io/agentsview#1233.
    //! - The subagent layout (`<session>/subagents/agent-<id>.jsonl` with an
    //!   `agent-<id>.meta.json` `agentType`) is the one tokscale's Qoder
    //!   parser reads (junhoyeo/tokscale#1612).
    use super::*;
    use crate::test_utils::SandboxHome;
    use serde_json::json;
    use serial_test::serial;

    const FIXTURE: &str = include_str!("../../tests/fixtures/qoder/cli-session-1.1.84.jsonl");
    const SESSION_ID: &str = "5a4669b0-9c94-4e9a-a6fb-c1967797bb56";
    const CWD: &str = "/Users/dev/work/qoder-demo";

    /// Clears the variables that move a Qoder store for the test's lifetime.
    struct CleanEnv(Vec<(&'static str, Option<std::ffi::OsString>)>);

    impl CleanEnv {
        fn new() -> Self {
            let keys = ["QODER_CONFIG_DIR", "QODERCN_CONFIG_DIR", "XDG_CONFIG_HOME"];
            let saved = keys
                .iter()
                .map(|key| (*key, std::env::var_os(key)))
                .collect();
            for key in keys {
                std::env::remove_var(key);
            }
            Self(saved)
        }
    }

    impl Drop for CleanEnv {
        fn drop(&mut self) {
            for (key, value) in self.0.drain(..) {
                match value {
                    Some(value) => std::env::set_var(key, value),
                    None => std::env::remove_var(key),
                }
            }
        }
    }

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn lines(records: &[Value]) -> String {
        records
            .iter()
            .map(|record| record.to_string() + "\n")
            .collect()
    }

    fn cli_store(home: &Path) -> PathBuf {
        home.join(".qoder").join("projects")
    }

    /// The fixture as `~/.qoder/projects/-Users-dev-work-qoder-demo/<id>.jsonl`.
    fn seed_cli_session(home: &Path) -> PathBuf {
        let path = cli_store(home)
            .join("-Users-dev-work-qoder-demo")
            .join(format!("{SESSION_ID}.jsonl"));
        write(&path, FIXTURE);
        path
    }

    fn user(session: &str, uuid: &str, ts: &str, cwd: Option<&str>, text: &str) -> Value {
        let mut record = json!({
            "type": "user", "uuid": uuid, "timestamp": ts, "sessionId": session,
            "message": {"role": "user", "content": text},
            "isSidechain": false, "userType": "external", "entrypoint": "cli",
            "version": "1.1.84",
        });
        if let Some(cwd) = cwd {
            record["cwd"] = json!(cwd);
        }
        record
    }

    fn assistant(session: &str, uuid: &str, ts: &str, model: &str, usage: Option<Value>) -> Value {
        let mut message = json!({
            "id": format!("msg-{uuid}"), "type": "message", "role": "assistant",
            "model": model, "stop_reason": "end_turn",
            "content": [{"type": "text", "text": format!("reply {uuid}")}],
        });
        if let Some(usage) = usage {
            message["usage"] = usage;
        }
        json!({
            "type": "assistant", "uuid": uuid, "timestamp": ts, "sessionId": session,
            "message": message, "isSidechain": false, "version": "1.1.84",
        })
    }

    #[test]
    #[serial]
    fn stores_follow_the_config_variables_and_the_platform_app_data_folder() {
        let home = SandboxHome::new();
        let _env = CleanEnv::new();
        let app_data = if cfg!(target_os = "macos") {
            home.path().join("Library").join("Application Support")
        } else if cfg!(windows) {
            home.path().join("AppData").join("Roaming")
        } else {
            home.path().join(".config")
        };
        let ide = |app: &str| {
            app_data
                .join(app)
                .join("SharedClientCache")
                .join("cli")
                .join("projects")
        };
        assert_eq!(
            store_dirs(),
            vec![
                home.path().join(".qoder").join("projects"),
                home.path().join(".qoder-cn").join("projects"),
                ide("Qoder"),
                ide("QoderCN"),
            ]
        );

        let cli = home.path().join("custom-qoder");
        let cn = home.path().join("custom-qoder-cn");
        std::env::set_var("QODER_CONFIG_DIR", &cli);
        std::env::set_var("QODERCN_CONFIG_DIR", &cn);
        let dirs = store_dirs();
        assert_eq!(dirs[0], cli.join("projects"));
        assert_eq!(dirs[1], cn.join("projects"));

        // Nothing there yet: no provider.
        assert!(detect().is_none());
        write(&cli.join("projects").join("-w").join("s.jsonl"), FIXTURE);
        let info = detect().expect("a store");
        assert_eq!(info.id, "qoder");
        assert!(info.is_available);
        assert_eq!(PathBuf::from(info.base_path), cli.join("projects"));
    }

    #[test]
    #[serial]
    fn a_cli_transcript_reads_as_claude_messages_without_qoder_bookkeeping() {
        let home = SandboxHome::new();
        let _env = CleanEnv::new();
        let path = seed_cli_session(home.path());

        let messages = load_messages(&path.to_string_lossy()).expect("messages");
        let types: Vec<&str> = messages.iter().map(|m| m.message_type.as_str()).collect();
        // workspace-directories, runtime-config, attachment,
        // file-history-snapshot, last-prompt and ai-title are not messages.
        assert_eq!(
            types,
            [
                "user",
                "assistant",
                "assistant",
                "assistant",
                "user",
                "assistant",
                "system"
            ]
        );
        assert!(messages
            .iter()
            .all(|m| m.provider.as_deref() == Some("qoder") && m.session_id == SESSION_ID));

        // `model: "auto"` names the slot selected by runtime-config /
        // businessModelKey.
        let models: Vec<Option<&str>> = messages
            .iter()
            .filter(|m| m.message_type == "assistant")
            .map(|m| m.model.as_deref())
            .collect();
        assert_eq!(models, [Some("gfmodel"); 4]);

        // Usage stays on the fragment that carries it; the other fragments
        // of the same response have none.
        let usage: Vec<Option<(u32, u32, u32)>> = messages
            .iter()
            .filter(|m| m.message_type == "assistant")
            .map(|m| {
                m.usage.as_ref().map(|u| {
                    (
                        u.input_tokens.unwrap(),
                        u.output_tokens.unwrap(),
                        u.cache_read_input_tokens.unwrap(),
                    )
                })
            })
            .collect();
        assert_eq!(
            usage,
            [None, None, Some((28067, 272, 0)), Some((32057, 95, 9856))]
        );

        let tool_use = &messages[3].content.as_ref().unwrap()[0];
        assert_eq!(tool_use["name"], "Bash");
        assert_eq!(tool_use["input"]["command"], "pnpm test");
        let result = &messages[4].content.as_ref().unwrap()[0];
        assert_eq!(result["type"], "tool_result");
        assert_eq!(result["tool_use_id"], tool_use["id"]);
        assert_eq!(result["is_error"], true);
        assert_eq!(messages[6].subtype.as_deref(), Some("informational"));
    }

    #[test]
    #[serial]
    fn scrubbed_zero_usage_is_no_usage_and_named_models_are_kept() {
        let home = SandboxHome::new();
        let _env = CleanEnv::new();
        // 1.1.28: managed model, counters written as 0 beside credits.
        let scrubbed = json!({
            "input_tokens": 0, "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0, "output_tokens": 0,
            "credits": 8.229_043_68, "original_credits": 8.229_043_68,
            "billable": true, "context_usage_ratio": 0.12,
        });
        let path = cli_store(home.path()).join("-w").join("s-028.jsonl");
        write(
            &path,
            &lines(&[
                json!({"type": "runtime-config", "sessionId": "s-028", "model": "qmodel_38max",
                       "reasoningEffort": null, "contextWindow": null, "timestamp": 1_787_400_000_000_u64}),
                user("s-028", "u1", "2026-08-22T10:00:00.000Z", Some("/w"), "hi"),
                assistant(
                    "s-028",
                    "a1",
                    "2026-08-22T10:00:02.000Z",
                    "qmodel_38max",
                    Some(scrubbed),
                ),
                assistant(
                    "s-028",
                    "a2",
                    "2026-08-22T10:00:04.000Z",
                    "qmodel_38max",
                    Some(
                        json!({"input_tokens": 4304, "output_tokens": 16, "cache_read_input_tokens": 0}),
                    ),
                ),
            ]),
        );
        let messages = load_messages(&path.to_string_lossy()).unwrap();
        assert_eq!(messages.len(), 3);
        assert!(messages[1].usage.is_none(), "all-zero usage is not usage");
        assert_eq!(messages[2].usage.as_ref().unwrap().input_tokens, Some(4304));
        assert_eq!(messages[1].model.as_deref(), Some("qmodel_38max"));
    }

    #[test]
    #[serial]
    fn unknown_records_and_broken_lines_are_skipped() {
        let home = SandboxHome::new();
        let _env = CleanEnv::new();
        let path = cli_store(home.path()).join("-w").join("s-x.jsonl");
        let mut text = lines(&[
            json!({"type": "worktree-state", "sessionId": "s-x", "worktree": {"path": "/w"}}),
            json!({"type": "active-leaf", "sessionId": "s-x", "leafUuid": "u1"}),
            json!({"type": "a-record-from-a-future-qoder", "sessionId": "s-x",
                   "timestamp": "2026-11-07T08:00:00.000Z", "payload": {"x": 1}}),
            user("s-x", "u1", "2026-11-07T08:00:01.000Z", Some("/w"), "hello"),
        ]);
        text.push_str("{not json\n\n");
        text.push_str(&lines(&[assistant(
            "s-x",
            "a1",
            "2026-11-07T08:00:02.000Z",
            "custom/deepseek/deepseek-v4",
            None,
        )]));
        write(&path, &text);

        let messages = load_messages(&path.to_string_lossy()).unwrap();
        let uuids: Vec<&str> = messages.iter().map(|m| m.uuid.as_str()).collect();
        assert_eq!(uuids, ["u1", "a1"]);
        assert_eq!(
            messages[1].model.as_deref(),
            Some("custom/deepseek/deepseek-v4")
        );

        let projects = scan_projects().unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(
            projects[0].message_count, 2,
            "the session row counts what loads"
        );
    }

    #[test]
    #[serial]
    fn projects_group_by_working_directory_across_stores() {
        let home = SandboxHome::new();
        let _env = CleanEnv::new();
        let first = seed_cli_session(home.path());
        // A second session of the same folder, renamed with /rename.
        let second = cli_store(home.path())
            .join("-Users-dev-work-qoder-demo")
            .join("s-2.jsonl");
        write(
            &second,
            &lines(&[
                user("s-2", "u1", "2026-11-08T09:00:00.000Z", Some(CWD), "second"),
                json!({"type": "custom-title", "sessionId": "s-2", "customTitle": "Renamed"}),
                json!({"type": "ai-title", "sessionId": "s-2", "aiTitle": "Generated"}),
            ]),
        );
        // Qoder CN, another folder; its first prompt names it.
        let cn = home
            .path()
            .join(".qoder-cn")
            .join("projects")
            .join("-srv-api")
            .join("s-cn.jsonl");
        write(
            &cn,
            &lines(&[user(
                "s-cn",
                "u1",
                "2026-11-01T09:00:00.000Z",
                Some("/srv/api"),
                "cn prompt",
            )]),
        );
        // A checkpoint journal and a top-level subagent file are not sessions.
        write(
            &cli_store(home.path())
                .join("-Users-dev-work-qoder-demo")
                .join("s-2.checkpoints.jsonl"),
            &lines(&[user(
                "s-2",
                "c1",
                "2026-11-08T09:00:00.000Z",
                Some(CWD),
                "checkpoint",
            )]),
        );

        let projects = scan_projects().unwrap();
        let summary: Vec<(&str, &str, &str, usize, usize)> = projects
            .iter()
            .map(|p| {
                (
                    p.name.as_str(),
                    p.path.as_str(),
                    p.actual_path.as_str(),
                    p.session_count,
                    p.message_count,
                )
            })
            .collect();
        assert_eq!(
            summary,
            [
                (
                    "qoder-demo",
                    "qoder:///Users/dev/work/qoder-demo",
                    CWD,
                    2,
                    8
                ),
                ("api", "qoder:///srv/api", "/srv/api", 1, 1),
            ]
        );
        assert!(projects
            .iter()
            .all(|p| p.provider.as_deref() == Some("qoder")));

        let sessions = load_sessions(&projects[0].path, false).unwrap();
        let rows: Vec<(&str, Option<&str>, bool)> = sessions
            .iter()
            .map(|s| (s.file_path.as_str(), s.summary.as_deref(), s.is_renamed))
            .collect();
        let first_path = first.to_string_lossy();
        let second_path = second.to_string_lossy();
        assert_eq!(
            rows,
            [
                (second_path.as_ref(), Some("Renamed"), true),
                (first_path.as_ref(), Some("Find the failing test"), false),
            ]
        );
        let session = &sessions[1];
        assert_eq!(session.actual_session_id, SESSION_ID);
        assert_eq!(session.project_name, "qoder-demo");
        assert_eq!(session.message_count, 7);
        assert_eq!(session.first_message_time, "2026-11-07T08:56:16.431Z");
        assert_eq!(session.last_message_time, "2026-11-07T08:56:45.016Z");
        assert!(session.has_tool_use && session.has_errors);
        assert_eq!(session.provider.as_deref(), Some("qoder"));

        let cn_sessions = load_sessions("qoder:///srv/api", false).unwrap();
        assert_eq!(cn_sessions.len(), 1);
        assert_eq!(cn_sessions[0].summary.as_deref(), Some("cn prompt"));
        assert!(load_sessions("/srv/api", false).is_err());
    }

    #[test]
    #[serial]
    fn the_ide_store_keeps_flat_transcripts_named_by_their_sidecar() {
        let _home = SandboxHome::new();
        let _env = CleanEnv::new();
        let ide = store_dirs()[2].clone();
        let id = "task-10f849241e06451d9c9c.session.execution";
        let transcript = ide.join(format!("{id}.jsonl"));
        // The IDE's lines here carry no `cwd`: the sidecar names the folder.
        write(
            &transcript,
            &lines(&[
                user(
                    id,
                    "u1",
                    "2026-10-20T10:00:00.000Z",
                    None,
                    "refactor the parser",
                ),
                assistant(id, "a1", "2026-10-20T10:00:05.000Z", "ultimate", None),
            ]),
        );
        write(
            &ide.join(format!("{id}-session.json")),
            &json!({"id": id, "title": "Parser refactor", "working_dir": "d:/repos/parser"})
                .to_string(),
        );

        let projects = scan_projects().unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].path, "qoder://d:/repos/parser");
        assert_eq!(projects[0].name, "parser");
        let sessions = load_sessions(&projects[0].path, false).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].summary.as_deref(), Some("Parser refactor"));
        assert_eq!(load_messages(&sessions[0].file_path).unwrap().len(), 2);
        assert!(is_session_path(&sessions[0].file_path));
    }

    /// A subagent run of the fixture session, as `<id>/subagents/agent-*.jsonl`.
    fn seed_subagent(session: &Path) -> PathBuf {
        let dir = session.with_extension("").join("subagents");
        let run = dir.join("agent-a1b2c3.jsonl");
        let mut line = assistant(
            SESSION_ID,
            "sub-a1",
            "2026-11-07T08:56:30.000Z",
            "gfmodel",
            Some(json!({"input_tokens": 500, "output_tokens": 120, "cache_read_input_tokens": 0})),
        );
        line["isSidechain"] = json!(true);
        line["agentId"] = json!("a1b2c3");
        write(&run, &lines(&[line]));
        write(
            &dir.join("agent-a1b2c3.meta.json"),
            r#"{"agentType":"Explore"}"#,
        );
        run
    }

    #[tokio::test]
    #[serial]
    async fn subagent_runs_are_listed_and_billed_as_sidechain() {
        let home = SandboxHome::new();
        let _env = CleanEnv::new();
        let session = seed_cli_session(home.path());
        let run = seed_subagent(&session);
        let session_path = session.to_string_lossy().to_string();

        // Not a session of its own; listed as the session's subagent.
        let project = format!("{SCHEME}{CWD}");
        assert_eq!(load_sessions(&project, false).unwrap().len(), 1);
        let subagents = crate::commands::session::get_session_subagents(session_path.clone())
            .await
            .unwrap();
        assert_eq!(subagents.len(), 1);
        assert_eq!(PathBuf::from(&subagents[0].file_path), run);
        assert_eq!(load_messages(&subagents[0].file_path).unwrap().len(), 1);

        assert_eq!(load_messages(&session_path).unwrap().len(), 7);
        let billed = load_messages_with_subagents(&session_path).unwrap();
        assert_eq!(billed.len(), 8);
        assert_eq!(billed[7].is_sidechain, Some(true));

        let stats = |mode: &str| {
            crate::commands::stats::get_session_token_stats(
                session_path.clone(),
                None,
                None,
                Some(mode.to_string()),
            )
        };
        let main_tokens = 28_067 + 272 + 32_057 + 95 + 9_856;
        let billing = stats("billing_total").await.unwrap();
        assert_eq!(billing.total_tokens, main_tokens + 500 + 120);
        assert_eq!(billing.project_name, "qoder-demo");
        let conversation = stats("conversation_only").await.unwrap();
        assert_eq!(conversation.total_tokens, main_tokens);
    }

    #[test]
    #[serial]
    fn search_names_the_project_of_each_hit() {
        let home = SandboxHome::new();
        let _env = CleanEnv::new();
        seed_cli_session(home.path());
        let hits = search("41 PASS", 10).unwrap();
        assert_eq!(hits.len(), 2, "the tool result and the answer");
        assert!(hits.iter().all(|hit| {
            hit.project_name.as_deref() == Some("qoder-demo")
                && hit.project_path.as_deref() == Some("qoder:///Users/dev/work/qoder-demo")
                && hit.provider.as_deref() == Some("qoder")
        }));
        assert_eq!(search("41 PASS", 1).unwrap().len(), 1);
        assert!(search("41 PASS", 0).unwrap().is_empty());
        assert!(search("nothing like this", 10).unwrap().is_empty());
    }

    #[test]
    #[serial]
    fn a_file_outside_the_stores_is_refused() {
        let home = SandboxHome::new();
        let _env = CleanEnv::new();
        seed_cli_session(home.path());
        let outside = home.path().join("elsewhere").join("s.jsonl");
        write(&outside, FIXTURE);
        let error = load_messages(&outside.to_string_lossy()).unwrap_err();
        assert!(error.contains("outside the Qoder stores"), "{error}");
        assert!(!is_session_path(&outside.to_string_lossy()));
    }

    #[cfg(unix)]
    #[test]
    #[serial]
    fn a_symlinked_transcript_is_never_read() {
        let home = SandboxHome::new();
        let _env = CleanEnv::new();
        let target = home.path().join("secret.jsonl");
        write(&target, FIXTURE);
        let link = cli_store(home.path()).join("-w").join("link.jsonl");
        fs::create_dir_all(link.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(&target, &link).unwrap();

        assert!(scan_projects().unwrap().is_empty());
        assert!(load_messages(&link.to_string_lossy()).is_err());
    }

    #[test]
    fn names_come_from_the_last_folder_in_either_separator_style() {
        assert_eq!(leaf_name("/Users/dev/work/app/"), "app");
        assert_eq!(leaf_name(r"C:\Users\dev\app"), "app");
        assert_eq!(project_name("qoder://d:/repos/parser"), "parser");
    }
}
