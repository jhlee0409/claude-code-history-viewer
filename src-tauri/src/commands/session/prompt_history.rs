//! Prompts that outlived their transcript (#764).
//!
//! Claude Code appends every prompt the user submits to `<root>/history.jsonl`,
//! one JSON object per line: `display` (the prompt as typed, pastes shown as
//! `[Pasted text #N +M lines]`), `pastedContents` (those pastes, inline or as
//! a `contentHash` into `<root>/paste-cache/<hash>.txt`), `timestamp`
//! (milliseconds), `project` (the working directory) and, on current
//! versions, `sessionId`. Transcripts under `projects/` are pruned
//! (`cleanupPeriodDays`, 30 days by default) or deleted by hand; the prompt
//! log is not.
//!
//! The prompts whose transcript is gone are listed here as read-only "prompt
//! history" sessions of their project, so they can be read and searched. A
//! prompt's transcript is gone when no project folder holds
//! `<sessionId>.jsonl`; an entry written before Claude Code recorded the
//! session id counts as orphaned only when no transcript left in its project
//! folder spans its time. Only the user's prompts survive: no replies, tool
//! calls or token usage, so these sessions add nothing to any statistics.
//!
//! A prompt-history session has no file of its own. It is named by a path in
//! its project folder that no transcript can have,
//! `<root>/projects/<project>/<key>.prompt-history`, where `<key>` is the
//! session id or, for entries without one, `legacy-<first prompt ms>` (a run
//! of entries no more than [`LEGACY_GAP_MS`] apart). Nothing opens that path:
//! every reader resolves it here ([`VirtualPath::parse`]) and reads
//! `history.jsonl` of the root it names.

use crate::commands::stats::session_files;
use crate::models::{ClaudeMessage, ClaudeSession, MessagePage, SessionTokenStats};
use chrono::{DateTime, SecondsFormat};
use regex::Regex;
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// `storage_type` of a prompt-history session; the frontend keys its
/// read-only treatment and its label on it.
pub(crate) const STORAGE_TYPE: &str = "prompt_history";

/// Extension of a prompt-history session's path. No transcript has it.
const EXTENSION: &str = "prompt-history";

const HISTORY_FILE: &str = "history.jsonl";
const PASTE_CACHE_DIR: &str = "paste-cache";
const PROJECTS_DIR: &str = "projects";

/// Key prefix of a group of entries that carry no session id.
const LEGACY_PREFIX: &str = "legacy-";

/// Entries without a session id more than this far apart start a new group.
const LEGACY_GAP_MS: i64 = 30 * 60 * 1000;

/// Clock slack when deciding whether a transcript spans a prompt's time.
const SPAN_SLACK_MS: i64 = 60 * 1000;

/// Lines read from the head of a transcript for its first timestamp.
const SPAN_HEAD_LINES: usize = 50;

/// Claude Code truncates a sanitized project folder name longer than this
/// and appends a hash of the full path.
const MAX_SANITIZED_LEN: usize = 200;

/// Longest session title, in characters (as the transcript titles).
const SUMMARY_CHARS: usize = 100;

/// A paste reference in a prompt, as Claude Code writes and parses it
/// (`parseReferences` in its `history.ts`).
static PASTE_REFERENCE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[(?:Pasted text|Image|\.\.\.Truncated text) #(\d+)(?: \+\d+ lines)?\.*\]")
        .expect("valid paste reference pattern")
});

// ─── The prompt log ──────────────────────────────────────────────────────────

/// One line of `history.jsonl`. Every field is optional so a line of another
/// shape is skipped rather than failing the read.
#[derive(Deserialize)]
struct RawEntry {
    display: Option<String>,
    #[serde(rename = "pastedContents")]
    pasted_contents: Option<HashMap<String, serde_json::Value>>,
    timestamp: Option<f64>,
    project: Option<String>,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
}

/// Where a pasted text lives.
#[derive(Debug, Clone, PartialEq, Eq)]
enum PastedText {
    Inline(String),
    /// A `paste-cache/<hash>.txt` file, which Claude Code prunes too.
    Cached(String),
}

#[derive(Debug, Clone)]
struct Prompt {
    display: String,
    pastes: HashMap<u32, PastedText>,
    timestamp_ms: i64,
    project: String,
    session_id: Option<String>,
}

fn parse_prompt(line: &[u8]) -> Option<Prompt> {
    let entry: RawEntry = serde_json::from_slice(line).ok()?;
    let display = entry.display?;
    let project = entry.project.filter(|project| !project.trim().is_empty())?;
    let timestamp = entry.timestamp.filter(|ts| ts.is_finite() && *ts >= 0.0)?;
    #[allow(clippy::cast_possible_truncation)] // milliseconds since 1970 fit an i64
    let timestamp_ms = timestamp as i64;
    let pastes = entry
        .pasted_contents
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(id, paste)| Some((id.parse().ok()?, pasted_text(&paste)?)))
        .collect();
    Some(Prompt {
        display,
        pastes,
        timestamp_ms,
        project,
        // An id that could not name a transcript file is no id: the entry is
        // judged like one written before ids were recorded.
        session_id: entry.session_id.filter(|id| is_session_key(id)),
    })
}

/// A text paste's content or where to find it; `None` for an image.
fn pasted_text(paste: &serde_json::Value) -> Option<PastedText> {
    if paste.get("type").and_then(serde_json::Value::as_str) != Some("text") {
        return None;
    }
    if let Some(content) = paste.get("content").and_then(serde_json::Value::as_str) {
        return Some(PastedText::Inline(content.to_string()));
    }
    paste
        .get("contentHash")
        .and_then(serde_json::Value::as_str)
        .filter(|hash| is_paste_hash(hash))
        .map(|hash| PastedText::Cached(hash.to_string()))
}

/// A session id usable as a file name: what Claude Code mints (UUIDs).
fn is_session_key(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && !id.starts_with(LEGACY_PREFIX)
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// A paste-cache hash (16 hex digits today): a bare file name, nothing else.
fn is_paste_hash(hash: &str) -> bool {
    !hash.is_empty() && hash.len() <= 64 && hash.chars().all(|c| c.is_ascii_hexdigit())
}

/// The prompts `<base>/history.jsonl` records, oldest first. A missing or
/// unreadable log is no prompts; a malformed line is skipped.
fn read_prompts(base: &Path) -> Vec<Prompt> {
    let Ok(root) = base.canonicalize() else {
        return Vec::new();
    };
    let Ok((file, _)) = session_files::open_session_file(&base.join(HISTORY_FILE), &root) else {
        return Vec::new();
    };
    let mut prompts: Vec<Prompt> = BufReader::new(file)
        .split(b'\n')
        .map_while(Result::ok)
        .filter_map(|line| parse_prompt(&line))
        .collect();
    // The log is appended in order; a stable sort keeps it so when two
    // prompts share a millisecond.
    prompts.sort_by_key(|prompt| prompt.timestamp_ms);
    prompts
}

/// A paste-cache file's text, read inside `<base>/paste-cache`.
fn read_cached_paste(base: &Path, hash: &str) -> Option<String> {
    let dir = base.join(PASTE_CACHE_DIR);
    let root = dir.canonicalize().ok()?;
    let (file, _) =
        session_files::open_session_file(&dir.join(format!("{hash}.txt")), &root).ok()?;
    let mut text = String::new();
    BufReader::new(file).read_to_string(&mut text).ok()?;
    Some(text)
}

/// The prompt as the user sent it: each `[Pasted text #N …]` reference whose
/// text is still on disk replaced by that text, as Claude Code expands it.
/// A reference whose text is gone, and every image, stays as written.
fn expand_pastes(base: &Path, prompt: &Prompt) -> String {
    if prompt.pastes.is_empty() {
        return prompt.display.clone();
    }
    let mut out = String::with_capacity(prompt.display.len());
    let mut last = 0;
    for reference in PASTE_REFERENCE.captures_iter(&prompt.display) {
        let (Some(whole), Some(id)) = (reference.get(0), reference.get(1)) else {
            continue;
        };
        let text = id
            .as_str()
            .parse::<u32>()
            .ok()
            .and_then(|id| prompt.pastes.get(&id))
            .and_then(|paste| match paste {
                PastedText::Inline(text) => Some(text.clone()),
                PastedText::Cached(hash) => read_cached_paste(base, hash),
            });
        if let Some(text) = text {
            out.push_str(&prompt.display[last..whole.start()]);
            out.push_str(&text);
            last = whole.end();
        }
    }
    out.push_str(&prompt.display[last..]);
    out
}

// ─── Projects and transcripts ───────────────────────────────────────────────

/// The project folder name Claude Code stores `cwd`'s transcripts under:
/// every UTF-16 unit that is not an ASCII letter or digit becomes `-`
/// (`sanitizePath`), and a name longer than [`MAX_SANITIZED_LEN`] is cut
/// there and suffixed with `-<hash>`, which is matched by its prefix among
/// `dir_names` when exactly one folder has it.
fn project_dir_name(cwd: &str, dir_names: &[String]) -> String {
    let mut sanitized = String::with_capacity(cwd.len());
    for c in cwd.chars() {
        if c.is_ascii_alphanumeric() {
            sanitized.push(c);
        } else {
            sanitized.extend(std::iter::repeat_n('-', c.len_utf16()));
        }
    }
    if sanitized.len() <= MAX_SANITIZED_LEN || dir_names.contains(&sanitized) {
        return sanitized;
    }
    // ASCII only, so any byte offset is a character boundary.
    let prefix = format!("{}-", &sanitized[..MAX_SANITIZED_LEN]);
    let mut candidates = dir_names.iter().filter(|name| name.starts_with(&prefix));
    match (candidates.next(), candidates.next()) {
        (Some(only), None) => only.clone(),
        _ => sanitized,
    }
}

/// The ids of every transcript left in any project folder. A session moved
/// to another project folder keeps its file name, so the whole `projects/`
/// folder is one namespace.
fn transcript_ids(project_dirs: &[PathBuf]) -> HashSet<String> {
    let mut ids = HashSet::new();
    for dir in project_dirs {
        let Ok(entries) = fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if let Some(id) = entry
                .file_name()
                .to_str()
                .and_then(|name| name.strip_suffix(".jsonl"))
            {
                ids.insert(id.to_string());
            }
        }
    }
    ids
}

/// The time a transcript spans: its first recorded timestamp (unknown when
/// its head has none) to its last write.
struct Span {
    start_ms: Option<i64>,
    end_ms: i64,
}

impl Span {
    fn covers(&self, ms: i64) -> bool {
        self.start_ms
            .is_none_or(|start| ms >= start - SPAN_SLACK_MS)
            && ms <= self.end_ms + SPAN_SLACK_MS
    }
}

/// The spans of the transcripts directly in `project_dir`.
fn transcript_spans(project_dir: &Path) -> Vec<Span> {
    let Ok(root) = project_dir.canonicalize() else {
        return Vec::new();
    };
    session_files::regular_session_files(project_dir)
        .into_iter()
        .filter(|path| path.parent() == Some(project_dir))
        .filter_map(|path| {
            let (file, metadata) = session_files::open_session_file(&path, &root).ok()?;
            let end_ms = metadata
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()
                .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())?;
            Some(Span {
                start_ms: first_timestamp_ms(BufReader::new(file)),
                end_ms,
            })
        })
        .collect()
}

fn first_timestamp_ms(reader: impl BufRead) -> Option<i64> {
    #[derive(Deserialize)]
    struct Head {
        timestamp: Option<String>,
    }
    reader
        .split(b'\n')
        .map_while(Result::ok)
        .take(SPAN_HEAD_LINES)
        .filter_map(|line| serde_json::from_slice::<Head>(&line).ok()?.timestamp)
        .find_map(|timestamp| {
            DateTime::parse_from_rfc3339(&timestamp)
                .ok()
                .map(|time| time.timestamp_millis())
        })
}

// ─── Grouping ───────────────────────────────────────────────────────────────

/// One prompt-history session: prompts of one session id, or a run of
/// prompts without one.
#[derive(Debug, Clone)]
struct PromptGroup {
    key: String,
    prompts: Vec<Prompt>,
}

impl PromptGroup {
    fn first_ms(&self) -> i64 {
        self.prompts.first().map_or(0, |prompt| prompt.timestamp_ms)
    }

    fn last_ms(&self) -> i64 {
        self.prompts.last().map_or(0, |prompt| prompt.timestamp_ms)
    }
}

/// The orphaned prompts of one project folder.
#[derive(Debug, Clone)]
pub(crate) struct ProjectPrompts {
    /// The project folder's name under `projects/` (it may no longer exist).
    pub(crate) dir_name: String,
    /// The working directory the newest of these prompts was sent from.
    pub(crate) cwd: String,
    groups: Vec<PromptGroup>,
}

impl ProjectPrompts {
    /// Prompt-history sessions of this project.
    pub(crate) fn session_count(&self) -> usize {
        self.groups.len()
    }

    pub(crate) fn prompt_count(&self) -> usize {
        self.groups.iter().map(|group| group.prompts.len()).sum()
    }

    /// When the newest of these prompts was sent.
    pub(crate) fn last_prompt_at(&self) -> SystemTime {
        let ms = self
            .groups
            .iter()
            .map(PromptGroup::last_ms)
            .max()
            .unwrap_or(0);
        UNIX_EPOCH + Duration::from_millis(u64::try_from(ms).unwrap_or(0))
    }

    fn group(&self, key: &str) -> Option<&PromptGroup> {
        self.groups.iter().find(|group| group.key == key)
    }
}

fn group_prompts(prompts: Vec<Prompt>) -> Vec<PromptGroup> {
    let mut by_session: BTreeMap<String, Vec<Prompt>> = BTreeMap::new();
    let mut legacy: Vec<PromptGroup> = Vec::new();
    for prompt in prompts {
        match prompt.session_id.clone() {
            Some(id) => by_session.entry(id).or_default().push(prompt),
            None => match legacy.last_mut() {
                Some(group) if prompt.timestamp_ms - group.last_ms() <= LEGACY_GAP_MS => {
                    group.prompts.push(prompt);
                }
                _ => legacy.push(PromptGroup {
                    key: format!("{LEGACY_PREFIX}{}", prompt.timestamp_ms),
                    prompts: vec![prompt],
                }),
            },
        }
    }
    let mut groups: Vec<PromptGroup> = by_session
        .into_iter()
        .map(|(key, prompts)| PromptGroup { key, prompts })
        .chain(legacy)
        .collect();
    groups.sort_by_key(|group| std::cmp::Reverse(group.last_ms()));
    groups
}

/// Every orphaned prompt of one Claude root, by project folder.
pub(crate) struct PromptHistory {
    base: PathBuf,
    projects: BTreeMap<String, ProjectPrompts>,
}

/// Read the orphaned prompts of the Claude root `base` (`~/.claude`-shaped).
pub(crate) fn load(base: &Path) -> PromptHistory {
    let mut history = PromptHistory {
        base: base.to_path_buf(),
        projects: BTreeMap::new(),
    };
    let prompts = read_prompts(base);
    if prompts.is_empty() {
        return history;
    }

    let projects_dir = base.join(PROJECTS_DIR);
    let listing = session_files::claude_project_dirs(&projects_dir).unwrap_or_default();
    let project_dirs: Vec<PathBuf> = listing.dirs.into_iter().chain(listing.links).collect();
    let dir_names: Vec<String> = project_dirs
        .iter()
        .filter_map(|dir| dir.file_name()?.to_str().map(str::to_string))
        .collect();
    let transcripts = transcript_ids(&project_dirs);

    let mut by_dir: BTreeMap<String, (String, Vec<Prompt>)> = BTreeMap::new();
    for prompt in prompts {
        if prompt
            .session_id
            .as_ref()
            .is_some_and(|id| transcripts.contains(id))
        {
            continue;
        }
        let dir_name = project_dir_name(&prompt.project, &dir_names);
        let (cwd, project_prompts) = by_dir.entry(dir_name).or_default();
        // Oldest first, so the newest prompt's directory wins.
        cwd.clone_from(&prompt.project);
        project_prompts.push(prompt);
    }

    for (dir_name, (cwd, mut prompts)) in by_dir {
        if prompts.iter().any(|prompt| prompt.session_id.is_none()) {
            let spans = transcript_spans(&projects_dir.join(&dir_name));
            prompts.retain(|prompt| {
                prompt.session_id.is_some()
                    || !spans.iter().any(|span| span.covers(prompt.timestamp_ms))
            });
        }
        if prompts.is_empty() {
            continue;
        }
        history.projects.insert(
            dir_name.clone(),
            ProjectPrompts {
                dir_name,
                cwd,
                groups: group_prompts(prompts),
            },
        );
    }
    history
}

impl PromptHistory {
    /// The orphaned prompts of the project folder named `dir_name`, removed
    /// from what [`Self::into_projects`] returns.
    pub(crate) fn take_project(&mut self, dir_name: &str) -> Option<ProjectPrompts> {
        self.projects.remove(dir_name)
    }

    /// The projects not taken: their folder holds no transcript, or is gone.
    pub(crate) fn into_projects(self) -> impl Iterator<Item = ProjectPrompts> {
        self.projects.into_values()
    }

    /// Every orphaned prompt whose text (pastes expanded) `is_match` accepts,
    /// as a search result of the project folder under `projects_dir`.
    pub(crate) fn search(
        &self,
        projects_dir: &Path,
        is_match: impl Fn(&str) -> bool,
    ) -> Vec<ClaudeMessage> {
        let mut found = Vec::new();
        for project in self.projects.values() {
            let project_path = projects_dir.join(&project.dir_name);
            for group in &project.groups {
                for message in group_messages(&self.base, group) {
                    if message
                        .content
                        .as_ref()
                        .and_then(serde_json::Value::as_str)
                        .is_some_and(&is_match)
                    {
                        found.push(ClaudeMessage {
                            project_name: Some(project.dir_name.clone()),
                            project_path: Some(project_path.to_string_lossy().into_owned()),
                            ..message
                        });
                    }
                }
            }
        }
        found
    }
}

// ─── Sessions and messages ──────────────────────────────────────────────────

fn rfc3339(ms: i64) -> String {
    DateTime::from_timestamp_millis(ms)
        .unwrap_or_default()
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn truncate(text: &str, max_chars: usize) -> String {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.chars().count() > max_chars {
        let cut: String = line.chars().take(max_chars).collect();
        format!("{cut}...")
    } else {
        line
    }
}

/// The session title: its first prompt that is not a slash command, else
/// its first prompt.
fn group_summary(group: &PromptGroup) -> Option<String> {
    let prompts = || group.prompts.iter().map(|prompt| prompt.display.trim());
    prompts()
        .find(|display| !display.is_empty() && !display.starts_with('/'))
        .or_else(|| prompts().find(|display| !display.is_empty()))
        .map(|display| truncate(display, SUMMARY_CHARS))
}

/// A prompt-history session's path in the project folder `project_path`.
fn session_path(project_path: &Path, key: &str) -> PathBuf {
    project_path.join(format!("{key}.{EXTENSION}"))
}

/// The prompt-history session `group` of `project`, listed under the
/// project folder `project_path` (the caller's spelling of it).
fn group_session(
    project_path: &Path,
    project: &ProjectPrompts,
    group: &PromptGroup,
) -> ClaudeSession {
    let file_path = session_path(project_path, &group.key)
        .to_string_lossy()
        .into_owned();
    let last = rfc3339(group.last_ms());
    ClaudeSession {
        session_id: file_path.clone(),
        actual_session_id: group.key.clone(),
        file_path,
        project_name: Path::new(&project.cwd).file_name().map_or_else(
            || project.dir_name.clone(),
            |name| name.to_string_lossy().into_owned(),
        ),
        message_count: group.prompts.len(),
        first_message_time: rfc3339(group.first_ms()),
        last_message_time: last.clone(),
        last_modified: last,
        has_tool_use: false,
        has_errors: false,
        summary: group_summary(group),
        is_renamed: false,
        provider: Some("claude".to_string()),
        storage_type: Some(STORAGE_TYPE.to_string()),
        entrypoint: None,
    }
}

/// The prompts of `group` as the user messages of a transcript.
fn group_messages(base: &Path, group: &PromptGroup) -> Vec<ClaudeMessage> {
    let mut previous: Option<String> = None;
    group
        .prompts
        .iter()
        .enumerate()
        .map(|(index, prompt)| {
            let uuid = format!("{EXTENSION}:{}:{index}", group.key);
            ClaudeMessage {
                uuid: uuid.clone(),
                parent_uuid: previous.replace(uuid),
                session_id: group.key.clone(),
                timestamp: rfc3339(prompt.timestamp_ms),
                message_type: "user".to_string(),
                content: Some(serde_json::Value::String(expand_pastes(base, prompt))),
                is_sidechain: Some(false),
                role: Some("user".to_string()),
                provider: Some("claude".to_string()),
                ..Default::default()
            }
        })
        .collect()
}

/// A prompt-history session's path, taken apart.
struct VirtualPath {
    /// The Claude root.
    base: PathBuf,
    /// `<base>/projects/<dir_name>`, as the path spells it.
    project_path: PathBuf,
    dir_name: String,
    key: String,
}

impl VirtualPath {
    fn parse(path: &Path) -> Option<Self> {
        if !path.is_absolute() || path.extension()? != EXTENSION {
            return None;
        }
        let key = path.file_stem()?.to_str()?;
        let is_legacy = key
            .strip_prefix(LEGACY_PREFIX)
            .is_some_and(|ms| !ms.is_empty() && ms.chars().all(|c| c.is_ascii_digit()));
        if !is_legacy && !is_session_key(key) {
            return None;
        }
        let project_path = path.parent()?;
        let dir_name = project_path.file_name()?.to_str()?;
        let projects_dir = project_path.parent()?;
        if projects_dir.file_name()? != PROJECTS_DIR {
            return None;
        }
        Some(Self {
            base: projects_dir.parent()?.to_path_buf(),
            project_path: project_path.to_path_buf(),
            dir_name: dir_name.to_string(),
            key: key.to_string(),
        })
    }

    /// The session it names, if its prompts are still orphaned.
    fn resolve(&self) -> Option<(PromptHistory, ProjectPrompts)> {
        let mut history = load(&self.base);
        let project = history.take_project(&self.dir_name)?;
        project.group(&self.key)?;
        Some((history, project))
    }
}

/// Whether `path` names a prompt-history session rather than a file.
pub(crate) fn is_session_path(path: &str) -> bool {
    VirtualPath::parse(Path::new(path)).is_some()
}

/// The `projects/` folder a prompt-history session path is listed under,
/// for the `--serve` history-root guard: the path itself names no file and
/// its project folder may be gone.
#[cfg(feature = "webui-server")]
pub(crate) fn projects_dir_of(path: &Path) -> Option<PathBuf> {
    VirtualPath::parse(path).map(|parsed| parsed.base.join(PROJECTS_DIR))
}

/// The prompt-history sessions of the project folder `project_path`
/// (`<root>/projects/<name>`), newest first. None when the path is not a
/// project folder of a Claude root.
pub(crate) fn project_sessions(project_path: &Path) -> Vec<ClaudeSession> {
    let Some(dir_name) = project_path.file_name().and_then(|name| name.to_str()) else {
        return Vec::new();
    };
    let Some(projects_dir) = project_path.parent() else {
        return Vec::new();
    };
    if projects_dir.file_name() != Some(std::ffi::OsStr::new(PROJECTS_DIR)) {
        return Vec::new();
    }
    let Some(base) = projects_dir.parent() else {
        return Vec::new();
    };
    let Some(project) = load(base).take_project(dir_name) else {
        return Vec::new();
    };
    project
        .groups
        .iter()
        .map(|group| group_session(project_path, &project, group))
        .collect()
}

/// The prompt-history session `path` names, or `None` once it is gone (its
/// transcript reappeared, or the prompt log no longer holds it).
pub(crate) fn find_session(path: &str) -> Option<ClaudeSession> {
    let parsed = VirtualPath::parse(Path::new(path))?;
    let (_, project) = parsed.resolve()?;
    let group = project.group(&parsed.key)?;
    Some(group_session(&parsed.project_path, &project, group))
}

/// Every prompt of the session `path` names, oldest first.
pub(crate) fn load_messages(path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let parsed = VirtualPath::parse(Path::new(path)).ok_or_else(not_a_session)?;
    let (history, project) = parsed.resolve().ok_or_else(gone)?;
    let group = project.group(&parsed.key).ok_or_else(gone)?;
    Ok(group_messages(&history.base, group))
}

/// A chat-style page (offset 0 is the newest prompt) of the session `path`
/// names, in the index space of [`load_messages`].
pub(crate) fn message_page(path: &str, offset: usize, limit: usize) -> Result<MessagePage, String> {
    let mut messages = load_messages(path)?;
    let total_count = messages.len();
    let end = total_count.saturating_sub(offset);
    let start = end.saturating_sub(limit);
    let messages: Vec<ClaudeMessage> = messages.drain(start..end).collect();
    let next_offset = offset.min(total_count) + messages.len();
    Ok(MessagePage {
        messages,
        total_count,
        has_more: start > 0,
        next_offset,
    })
}

/// How far from the newest prompt the message `uuid` sits (0 = newest).
pub(crate) fn message_offset(path: &str, uuid: &str) -> Result<Option<usize>, String> {
    Ok(load_messages(path)?
        .iter()
        .rev()
        .position(|message| message.uuid == uuid))
}

/// Token totals of the session `path` names: none recorded. Its replies,
/// and the usage they carried, were deleted with the transcript.
pub(crate) fn session_token_stats(path: &str) -> Result<SessionTokenStats, String> {
    let session = find_session(path).ok_or_else(gone)?;
    Ok(SessionTokenStats {
        token_usage_recording: crate::models::TokenUsageRecording::Absent,
        session_id: session.actual_session_id,
        project_name: session.project_name,
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cache_creation_tokens: 0,
        total_cache_read_tokens: 0,
        total_reasoning_tokens: 0,
        total_tokens: 0,
        message_count: session.message_count,
        first_message_time: session.first_message_time,
        last_message_time: session.last_message_time,
        summary: session.summary,
        most_used_tools: Vec::new(),
        model_distribution: Vec::new(),
        subagent_stats: None,
    })
}

fn not_a_session() -> String {
    "Not a prompt-history session path".to_string()
}

fn gone() -> String {
    "Prompt history not found: its prompts are no longer in history.jsonl, or its transcript is back"
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use tempfile::TempDir;

    const SESSION_A: &str = "aaaaaaaa-0000-4000-8000-000000000001";
    const SESSION_B: &str = "bbbbbbbb-0000-4000-8000-000000000002";
    /// 2026-01-01T00:00:00Z.
    const T0: i64 = 1_767_225_600_000;
    const MINUTE: i64 = 60_000;

    struct Root {
        dir: TempDir,
    }

    impl Root {
        fn new() -> Self {
            let root = Self {
                dir: TempDir::new().unwrap(),
            };
            fs::create_dir_all(root.projects()).unwrap();
            root
        }

        fn base(&self) -> &Path {
            self.dir.path()
        }

        fn projects(&self) -> PathBuf {
            self.base().join(PROJECTS_DIR)
        }

        fn history(&self, entries: &[serde_json::Value]) {
            let lines: Vec<String> = entries.iter().map(ToString::to_string).collect();
            fs::write(self.base().join(HISTORY_FILE), lines.join("\n") + "\n").unwrap();
        }

        fn transcript(&self, dir: &str, id: &str, lines: &[serde_json::Value]) -> PathBuf {
            let dir = self.projects().join(dir);
            fs::create_dir_all(&dir).unwrap();
            let path = dir.join(format!("{id}.jsonl"));
            let lines: Vec<String> = lines.iter().map(ToString::to_string).collect();
            fs::write(&path, lines.join("\n")).unwrap();
            path
        }
    }

    fn entry(display: &str, ms: i64, project: &str, session: Option<&str>) -> serde_json::Value {
        let mut value = json!({
            "display": display,
            "pastedContents": {},
            "timestamp": ms,
            "project": project,
        });
        if let Some(session) = session {
            value["sessionId"] = json!(session);
        }
        value
    }

    fn texts(messages: &[ClaudeMessage]) -> Vec<String> {
        messages
            .iter()
            .map(|message| {
                message
                    .content
                    .as_ref()
                    .unwrap()
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect()
    }

    #[test]
    fn sanitizes_project_paths_like_claude_code() {
        assert_eq!(
            project_dir_name("/Users/me/my_app.v2", &[]),
            "-Users-me-my-app-v2"
        );
        assert_eq!(project_dir_name(r"C:\Users\me\app", &[]), "C--Users-me-app");
        // One `-` per UTF-16 unit: a BMP letter is one, an emoji two.
        assert_eq!(project_dir_name("/tmp/é", &[]), "-tmp--");
        assert_eq!(project_dir_name("/tmp/😀", &[]), "-tmp---");
    }

    #[test]
    fn a_long_project_path_matches_its_hashed_folder_only_when_unambiguous() {
        let cwd = format!("/{}", "a".repeat(250));
        let sanitized = format!("-{}", "a".repeat(250));
        let hashed = format!("{}-abc123", &sanitized[..MAX_SANITIZED_LEN]);
        assert_eq!(
            project_dir_name(&cwd, std::slice::from_ref(&hashed)),
            hashed
        );

        let other = format!("{}-def456", &sanitized[..MAX_SANITIZED_LEN]);
        assert_eq!(project_dir_name(&cwd, &[hashed, other]), sanitized);
    }

    #[test]
    fn only_prompts_whose_transcript_is_gone_are_listed() {
        let root = Root::new();
        root.transcript(
            "-work-app",
            SESSION_A,
            &[json!({"timestamp": "2026-01-01T00:00:00Z"})],
        );
        // A transcript moved to another project folder still exists.
        root.transcript("-work-other", SESSION_B, &[]);
        root.history(&[
            entry("kept", T0, "/work/app", Some(SESSION_A)),
            entry("moved", T0 + MINUTE, "/work/app", Some(SESSION_B)),
            entry(
                "orphan one",
                T0 + 2 * MINUTE,
                "/work/app",
                Some("cccccccc-0000-4000-8000-000000000003"),
            ),
            entry(
                "orphan two",
                T0 + 3 * MINUTE,
                "/work/app",
                Some("cccccccc-0000-4000-8000-000000000003"),
            ),
        ]);

        let sessions = project_sessions(&root.projects().join("-work-app"));
        assert_eq!(sessions.len(), 1);
        let session = &sessions[0];
        assert_eq!(
            session.actual_session_id,
            "cccccccc-0000-4000-8000-000000000003"
        );
        assert_eq!(session.message_count, 2);
        assert_eq!(session.storage_type.as_deref(), Some(STORAGE_TYPE));
        assert_eq!(session.summary.as_deref(), Some("orphan one"));
        assert_eq!(session.project_name, "app");
        assert_eq!(session.first_message_time, "2026-01-01T00:02:00.000Z");
        assert_eq!(session.last_message_time, "2026-01-01T00:03:00.000Z");
        assert!(session.file_path.ends_with(".prompt-history"));
        assert_eq!(session.session_id, session.file_path);

        let messages = load_messages(&session.file_path).unwrap();
        assert_eq!(texts(&messages), ["orphan one", "orphan two"]);
        assert!(messages
            .iter()
            .all(|m| m.message_type == "user" && m.usage.is_none()));
        assert_eq!(
            messages[1].parent_uuid.as_deref(),
            Some(messages[0].uuid.as_str())
        );
    }

    #[test]
    fn entries_without_a_session_id_are_grouped_by_time_gap_and_checked_against_transcript_spans() {
        let root = Root::new();
        let transcript = root.transcript(
            "-work-app",
            SESSION_A,
            &[json!({"type": "user", "timestamp": rfc3339(T0 + 100 * MINUTE)})],
        );
        let modified = std::time::UNIX_EPOCH
            + std::time::Duration::from_millis(u64::try_from(T0 + 110 * MINUTE).unwrap());
        fs::File::options()
            .write(true)
            .open(&transcript)
            .unwrap()
            .set_modified(modified)
            .unwrap();
        root.history(&[
            entry("old 1", T0, "/work/app", None),
            entry("old 2", T0 + 10 * MINUTE, "/work/app", None),
            entry("later", T0 + 50 * MINUTE, "/work/app", None),
            // Inside the remaining transcript's span: its transcript exists.
            entry("covered", T0 + 105 * MINUTE, "/work/app", None),
        ]);

        let sessions = project_sessions(&root.projects().join("-work-app"));
        let keys: Vec<&str> = sessions
            .iter()
            .map(|s| s.actual_session_id.as_str())
            .collect();
        assert_eq!(
            keys,
            [
                format!("legacy-{}", T0 + 50 * MINUTE),
                format!("legacy-{T0}")
            ]
        );
        assert_eq!(sessions[1].message_count, 2);
        assert_eq!(
            texts(&load_messages(&sessions[1].file_path).unwrap()),
            ["old 1", "old 2"]
        );
    }

    #[test]
    fn pastes_are_expanded_from_the_log_and_the_paste_cache() {
        let root = Root::new();
        fs::create_dir_all(root.base().join(PASTE_CACHE_DIR)).unwrap();
        fs::write(
            root.base()
                .join(PASTE_CACHE_DIR)
                .join("0123456789abcdef.txt"),
            "cached body",
        )
        .unwrap();
        let mut prompt = entry(
            "see [Pasted text #1 +2 lines] and [Pasted text #2 +9 lines] and [Pasted text #3] [Image #4]",
            T0,
            "/work/app",
            Some(SESSION_A),
        );
        prompt["pastedContents"] = json!({
            "1": {"id": 1, "type": "text", "content": "inline\nbody\n"},
            "2": {"id": 2, "type": "text", "contentHash": "0123456789abcdef"},
            "3": {"id": 3, "type": "text", "contentHash": "fedcba9876543210"},
            "4": {"id": 4, "type": "image", "content": "iVBOR"},
        });
        root.history(&[prompt]);

        let session = &project_sessions(&root.projects().join("-work-app"))[0];
        assert_eq!(
            texts(&load_messages(&session.file_path).unwrap()),
            ["see inline\nbody\n and cached body and [Pasted text #3] [Image #4]"]
        );
    }

    #[test]
    fn malformed_lines_and_unusable_ids_are_tolerated() {
        let root = Root::new();
        let lines = [
            "not json".to_string(),
            json!({"display": "no project", "timestamp": T0}).to_string(),
            entry("bad id", T0, "/work/app", Some("../../etc")).to_string(),
            entry("good", T0 + MINUTE, "/work/app", Some(SESSION_A)).to_string(),
        ];
        fs::write(root.base().join(HISTORY_FILE), lines.join("\n")).unwrap();

        let sessions = project_sessions(&root.projects().join("-work-app"));
        let keys: Vec<&str> = sessions
            .iter()
            .map(|s| s.actual_session_id.as_str())
            .collect();
        // The traversal id is treated as no id (a legacy group), never a path.
        assert_eq!(keys, [SESSION_A.to_string(), format!("legacy-{T0}")]);
    }

    #[test]
    fn a_session_path_resolves_only_while_it_is_orphaned() {
        let root = Root::new();
        root.history(&[entry("hello", T0, "/work/gone", Some(SESSION_A))]);
        // The project folder itself is gone: the session is still listed.
        let project = root.projects().join("-work-gone");
        let session = &project_sessions(&project)[0];
        assert!(is_session_path(&session.file_path));
        assert_eq!(
            find_session(&session.file_path).unwrap().file_path,
            session.file_path
        );

        let stats = session_token_stats(&session.file_path).unwrap();
        assert_eq!(
            stats.token_usage_recording,
            crate::models::TokenUsageRecording::Absent
        );
        assert_eq!((stats.total_tokens, stats.message_count), (0, 1));

        // Its transcript comes back (e.g. restored from a backup).
        root.transcript("-work-gone", SESSION_A, &[]);
        assert!(find_session(&session.file_path).is_none());
        assert!(load_messages(&session.file_path).is_err());
    }

    #[test]
    fn session_paths_outside_the_layout_are_refused() {
        let root = Root::new();
        let projects = root.projects();
        for path in [
            projects.join("-p").join(format!("{SESSION_A}.jsonl")),
            projects
                .join("-p")
                .join("..")
                .join(format!("{SESSION_A}.prompt-history")),
            projects.join("-p").join("legacy-x.prompt-history"),
            root.base()
                .join("elsewhere")
                .join("-p")
                .join(format!("{SESSION_A}.prompt-history")),
            PathBuf::from(format!("{SESSION_A}.prompt-history")),
        ] {
            assert!(
                !is_session_path(&path.to_string_lossy()),
                "{}",
                path.display()
            );
        }
        assert!(is_session_path(
            &projects
                .join("-p")
                .join(format!("legacy-{T0}.prompt-history"))
                .to_string_lossy()
        ));
    }

    #[test]
    fn pages_count_from_the_newest_prompt() {
        let root = Root::new();
        let entries: Vec<_> = (0..5)
            .map(|i| {
                entry(
                    &format!("p{i}"),
                    T0 + i * MINUTE,
                    "/work/app",
                    Some(SESSION_A),
                )
            })
            .collect();
        root.history(&entries);
        let path = project_sessions(&root.projects().join("-work-app"))[0]
            .file_path
            .clone();

        let first = message_page(&path, 0, 2).unwrap();
        assert_eq!(texts(&first.messages), ["p3", "p4"]);
        assert_eq!(
            (first.total_count, first.has_more, first.next_offset),
            (5, true, 2)
        );
        let last = message_page(&path, 4, 2).unwrap();
        assert_eq!(texts(&last.messages), ["p0"]);
        assert_eq!((last.has_more, last.next_offset), (false, 5));

        let uuid = &first.messages[0].uuid;
        assert_eq!(message_offset(&path, uuid).unwrap(), Some(1));
    }

    #[test]
    fn search_matches_expanded_prompts_with_their_project() {
        let root = Root::new();
        let mut prompt = entry(
            "look at [Pasted text #1 +1 lines]",
            T0,
            "/work/app",
            Some(SESSION_A),
        );
        prompt["pastedContents"] =
            json!({"1": {"id": 1, "type": "text", "content": "the Needle\n"}});
        root.history(&[
            prompt,
            entry("unrelated", T0 + MINUTE, "/work/app", Some(SESSION_B)),
        ]);

        let found = load(root.base()).search(&root.projects(), |text| text.contains("Needle"));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].session_id, SESSION_A);
        assert_eq!(found[0].project_name.as_deref(), Some("-work-app"));
        assert_eq!(
            found[0].project_path.as_deref(),
            Some(root.projects().join("-work-app").to_string_lossy().as_ref())
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_prompt_log_is_not_read() {
        let root = Root::new();
        let elsewhere = TempDir::new().unwrap();
        let target = elsewhere.path().join(HISTORY_FILE);
        fs::write(
            &target,
            entry("secret", T0, "/work/app", Some(SESSION_A)).to_string(),
        )
        .unwrap();
        std::os::unix::fs::symlink(&target, root.base().join(HISTORY_FILE)).unwrap();

        assert!(project_sessions(&root.projects().join("-work-app")).is_empty());
    }

    // ─── Through the commands ───────────────────────────────────────────────

    fn transcript_line(session: &str, text: &str) -> serde_json::Value {
        json!({
            "uuid": format!("{session}-1"),
            "sessionId": session,
            "timestamp": "2026-01-02T00:00:00.000Z",
            "type": "user",
            "cwd": "/work/app",
            "message": {"role": "user", "content": text},
        })
    }

    /// `/work/app` keeps one transcript and lost another; every transcript
    /// of `/work/gone` is gone, and so is its project folder.
    fn mixed_root() -> Root {
        let root = Root::new();
        root.transcript(
            "-work-app",
            SESSION_A,
            &[transcript_line(SESSION_A, "kept transcript")],
        );
        root.history(&[
            entry("kept prompt", T0, "/work/app", Some(SESSION_A)),
            entry(
                "lost needle prompt",
                T0 + MINUTE,
                "/work/app",
                Some(SESSION_B),
            ),
            entry(
                "gone needle prompt",
                T0 + 2 * MINUTE,
                "/work/gone",
                Some("dddddddd-0000-4000-8000-000000000004"),
            ),
        ]);
        root
    }

    #[tokio::test]
    async fn the_project_scan_counts_prompt_history_and_keeps_projects_without_transcripts() {
        let root = mixed_root();
        let projects =
            crate::commands::project::scan_projects(root.base().to_string_lossy().into_owned())
                .await
                .unwrap();
        let by_path = |dir: &str| {
            let path = root.projects().join(dir).to_string_lossy().into_owned();
            projects
                .iter()
                .find(|p| p.path == path)
                .unwrap_or_else(|| panic!("{dir} listed"))
        };
        assert_eq!(by_path("-work-app").session_count, 2);
        let gone = by_path("-work-gone");
        assert_eq!((gone.session_count, gone.message_count), (1, 1));
        assert_eq!(gone.actual_path, "/work/gone");
        assert_eq!(gone.name, "gone");
        assert_eq!(gone.last_modified, "2026-01-01T00:02:00+00:00");
    }

    #[tokio::test]
    async fn session_lists_hold_prompt_history_beside_transcripts_and_without_a_folder() {
        let root = mixed_root();
        let app = root
            .projects()
            .join("-work-app")
            .to_string_lossy()
            .into_owned();
        let page = crate::commands::session::load_project_sessions_page(
            app.clone(),
            None,
            Some(0),
            Some(10),
        )
        .await
        .unwrap();
        let kinds: Vec<(String, Option<String>)> = page
            .sessions
            .iter()
            .map(|s| (s.actual_session_id.clone(), s.storage_type.clone()))
            .collect();
        assert_eq!(
            kinds,
            [
                (SESSION_A.to_string(), None),
                (SESSION_B.to_string(), Some(STORAGE_TYPE.to_string()))
            ]
        );
        assert_eq!(page.total, 2);
        let all = crate::commands::session::load_project_sessions(app.clone(), None)
            .await
            .unwrap();
        assert_eq!(all.len(), 2);

        let gone = root
            .projects()
            .join("-work-gone")
            .to_string_lossy()
            .into_owned();
        let page = crate::commands::session::load_project_sessions_page(
            gone.clone(),
            Some(true),
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(page.sessions.len(), 1);
        let all = crate::commands::session::load_project_sessions(gone.clone(), None)
            .await
            .unwrap();
        assert_eq!(all.len(), 1);

        let path = &page.sessions[0].file_path;
        let found =
            crate::commands::session::find_project_session_by_path(&gone, path, None).unwrap();
        assert_eq!(found.map(|s| s.file_path).as_deref(), Some(path.as_str()));
        // Looked up in its own project only.
        assert!(crate::commands::session::find_project_session_by_path(&app, path, None).is_err());
    }

    #[tokio::test]
    #[serial_test::serial]
    async fn the_claude_message_commands_read_prompt_history() {
        // The provider dispatch resolves the home directory.
        let _home = crate::test_utils::SandboxHome::new();
        let root = mixed_root();
        let gone = root.projects().join("-work-gone");
        let path = project_sessions(&gone)[0].file_path.clone();

        let page = crate::commands::multi_provider::load_provider_messages_paginated(
            "claude".into(),
            path.clone(),
            None,
            None,
            Some(true),
        )
        .await
        .unwrap();
        assert_eq!(texts(&page.messages), ["gone needle prompt"]);
        assert_eq!(page.messages[0].provider.as_deref(), Some("claude"));
        let all =
            crate::commands::multi_provider::load_provider_messages("claude".into(), path.clone())
                .await
                .unwrap();
        assert_eq!(all.len(), 1);
        let offset = crate::commands::multi_provider::get_provider_message_offset(
            "claude".into(),
            path.clone(),
            page.messages[0].uuid.clone(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(offset, Some(0));
        assert_eq!(
            crate::commands::session::get_session_message_count(path.clone(), None)
                .await
                .unwrap(),
            1
        );
        assert!(
            crate::commands::session::get_session_subagents(path.clone())
                .await
                .unwrap()
                .is_empty()
        );

        let stats = crate::commands::stats::get_session_token_stats(path, None, None, None)
            .await
            .unwrap();
        assert_eq!(
            stats.token_usage_recording,
            crate::models::TokenUsageRecording::Absent
        );
        assert_eq!(stats.total_tokens, 0);
    }

    #[tokio::test]
    async fn message_search_finds_orphaned_prompts_and_honours_the_project_filter() {
        let root = mixed_root();
        let base = root.base().to_string_lossy().into_owned();
        let search = |filters: serde_json::Value| {
            crate::commands::session::search_messages(base.clone(), "needle".into(), filters, None)
        };

        let all = search(json!({})).await.unwrap();
        let mut found: Vec<&str> = all.iter().map(|m| m.session_id.as_str()).collect();
        found.sort_unstable();
        assert_eq!(found, [SESSION_B, "dddddddd-0000-4000-8000-000000000004"]);

        let app = root
            .projects()
            .join("-work-app")
            .to_string_lossy()
            .into_owned();
        let scoped = search(json!({"projectPaths": [app]})).await.unwrap();
        assert_eq!(texts(&scoped), ["lost needle prompt"]);
        // The transcript that is left is searched as before; its prompt in
        // the log is not repeated.
        let kept =
            crate::commands::session::search_messages(base.clone(), "kept".into(), json!({}), None)
                .await
                .unwrap();
        assert_eq!(texts(&kept), ["kept transcript"]);
    }
}
