//! claude.ai account export provider (#674).
//!
//! claude.ai keeps conversations on Anthropic's servers; the only local copy
//! is the account export (Settings → Privacy → Export data), a zip with
//! `conversations.json`, `projects.json` and `users.json`. The user registers
//! an export — the downloaded zip or the folder it was extracted to — in
//! Settings, which records it in `settings.claudeAiExports` of
//! `user-data.json`. That persisted list is the only source of export paths:
//! a project or session id names an export by an id derived from its path, so
//! no caller can point a read at a file the user did not register.
//!
//! The export is read in place and never written, moved or deleted. A zip is
//! read without extracting anything to disk: entries are looked up by name
//! (only `conversations.json` / `projects.json` at the top level or inside one
//! top-level folder, judged by the entry's enclosed name), and every entry is
//! read through a byte cap, whatever size it declares, so a crafted archive
//! can neither reach outside the export nor exhaust memory. Files of an
//! extracted folder are opened with the history open helpers (no symlinks, no
//! FIFOs, nothing outside the folder).
//!
//! Format (documented public export, see
//! `src-tauri/tests/fixtures/claude-ai-export/README.md`):
//! - `conversations.json`: an array of conversations `{uuid, name, summary,
//!   model, created_at, updated_at, project_uuid | project.uuid,
//!   current_leaf_message_uuid, chat_messages}`. A message is `{uuid, sender
//!   (human | assistant), text, content[], attachments[], files[],
//!   files_v2[], created_at, stop_reason, parent_message_uuid}`; `content`
//!   holds `text`, `thinking`, `tool_use` and `tool_result` blocks (older
//!   exports have only `text`).
//! - `projects.json`: an array of `{uuid, name, …}`, used for project names.
//! - `users.json` holds account details and is never read.
//!
//! Conversations in a claude.ai Project are grouped under that project; the
//! rest go to one "Claude.ai" project per export. When a conversation records
//! its active branch (`current_leaf_message_uuid` + parent links), only that
//! branch is shown, as claude.ai shows it. Attachments and files appear as
//! metadata (name, type, size); their contents are not shown. Exports record
//! no token usage, so the provider reports none.
//!
//! A parsed export is cached per path and reparsed only when the file
//! changes; removing an export from Settings drops its cache entry.

use crate::commands::stats::session_files::{open_history_file, open_session_file};
use crate::models::{ClaudeAiExport, ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::providers::ProviderInfo;
use crate::utils::{build_provider_message, parse_rfc3339_utc, search_json_value_case_insensitive};
use serde::de::{Deserializer as _, SeqAccess, Visitor};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt::{self, Write as _};
use std::fs;
use std::io::{self, BufRead, BufReader, Read};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::SystemTime;

pub const PROVIDER: &str = "claude-ai";
const DISPLAY_NAME: &str = "Claude.ai";
const SCHEME: &str = "claude-ai://";
const CONVERSATIONS_FILE: &str = "conversations.json";
const PROJECTS_FILE: &str = "projects.json";
/// Group of the conversations that belong to no claude.ai Project.
const CHATS_GROUP: &str = "chats";
const PROJECT_GROUP_PREFIX: &str = "project-";
/// Separates the project path from the conversation id in a session path.
const SESSION_SEP: char = '#';
const SUMMARY_MAX_CHARS: usize = 80;

/// Largest `conversations.json` read (uncompressed). Exports hold text only,
/// so this is far above a real account's history.
const MAX_CONVERSATIONS_BYTES: u64 = 1 << 30;
/// Largest `projects.json` read; it embeds project knowledge documents.
const MAX_PROJECTS_BYTES: u64 = 256 << 20;
/// Most entries a zip export may list; real exports have a handful.
const MAX_ZIP_ENTRIES: usize = 10_000;

/// A user-facing reason the export could not be read, for the Settings
/// action that registers one.
const NOT_AN_EXPORT: &str = "Not a claude.ai export: no conversations.json found";
const CHATGPT_EXPORT: &str =
    "This looks like a ChatGPT export, not a claude.ai export (conversations have no chat_messages)";

// ============================================================================
// Registered exports
// ============================================================================

/// One export registered in Settings.
#[derive(Debug, Clone)]
struct ExportRef {
    /// Stable id derived from the path; embedded in project/session ids.
    id: String,
    path: PathBuf,
    /// The user's label, else the export's file name.
    label: String,
}

/// The id an export path is known by: a digest of the path as stored, so
/// re-adding the same export keeps every session id (and the names and
/// bookmarks keyed by it).
fn export_id(path: &str) -> String {
    let digest = Sha256::digest(trim_separators(path).as_bytes());
    digest.iter().take(8).fold(String::new(), |mut id, b| {
        let _ = write!(id, "{b:02x}");
        id
    })
}

fn trim_separators(path: &str) -> &str {
    let trimmed = path.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        path
    } else {
        trimmed
    }
}

fn export_ref(export: &ClaudeAiExport) -> ExportRef {
    let path = PathBuf::from(trim_separators(&export.path));
    let label = export
        .label
        .as_deref()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .or_else(|| path.file_name().map(|n| n.to_string_lossy().to_string()))
        .unwrap_or_else(|| DISPLAY_NAME.to_string());
    ExportRef {
        id: export_id(&export.path),
        path,
        label,
    }
}

/// The exports registered in `user-data.json`, in Settings order. The file
/// on disk is authoritative: every metadata write lands there first.
fn registered_exports() -> Vec<ExportRef> {
    #[derive(Deserialize, Default)]
    struct Persisted {
        #[serde(default)]
        settings: PersistedSettings,
    }
    #[derive(Deserialize, Default)]
    #[serde(rename_all = "camelCase")]
    struct PersistedSettings {
        #[serde(default)]
        claude_ai_exports: Vec<ClaudeAiExport>,
    }

    let Ok(path) = crate::commands::metadata::get_user_data_path() else {
        return Vec::new();
    };
    // Not a history file: the app's own settings, for the registered exports.
    let Ok(content) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    let persisted: Persisted = serde_json::from_str(&content).unwrap_or_default();
    let mut seen = HashSet::new();
    persisted
        .settings
        .claude_ai_exports
        .iter()
        .map(export_ref)
        .filter(|export| seen.insert(export.id.clone()))
        .collect()
}

fn registered_export(id: &str) -> Result<ExportRef, String> {
    registered_exports()
        .into_iter()
        .find(|export| export.id == id)
        .ok_or_else(|| format!("claude.ai export {id} is not registered"))
}

/// Detect the provider: at least one registered export still exists.
pub fn detect() -> Option<ProviderInfo> {
    let export = registered_exports()
        .into_iter()
        .find(|export| fs::symlink_metadata(&export.path).is_ok())?;
    Some(ProviderInfo {
        id: PROVIDER.to_string(),
        display_name: DISPLAY_NAME.to_string(),
        base_path: export.path.to_string_lossy().to_string(),
        is_available: true,
    })
}

// ============================================================================
// Locating and reading an export
// ============================================================================

/// How an export is stored.
#[derive(Debug)]
enum Layout {
    Zip(PathBuf),
    Folder {
        /// Canonical folder the user registered; nothing outside it is read.
        root: PathBuf,
        conversations: PathBuf,
        projects: Option<PathBuf>,
    },
}

/// Size and modification time of what an export's data is read from.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Fingerprint {
    data: (u64, Option<SystemTime>),
    projects: Option<(u64, Option<SystemTime>)>,
}

fn stamp(meta: &fs::Metadata) -> (u64, Option<SystemTime>) {
    (meta.len(), meta.modified().ok())
}

/// A regular file at `path`, judged without following a symlink.
fn regular_file(path: &Path) -> Option<fs::Metadata> {
    fs::symlink_metadata(path)
        .ok()
        .filter(|meta| meta.file_type().is_file())
}

/// The folder of an extracted export that holds `conversations.json`: the
/// registered folder itself, or its one subfolder that does (a zip extracted
/// into a folder of its own). Symlinked subfolders are never entered.
fn export_folder(root: &Path) -> Result<PathBuf, String> {
    if regular_file(&root.join(CONVERSATIONS_FILE)).is_some() {
        return Ok(root.to_path_buf());
    }
    let entries = fs::read_dir(root).map_err(|e| format!("Cannot read {}: {e}", root.display()))?;
    let mut found: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.path())
        .filter(|dir| regular_file(&dir.join(CONVERSATIONS_FILE)).is_some())
        .collect();
    found.sort();
    match found.len() {
        1 => Ok(found.remove(0)),
        0 => Err(format!("{NOT_AN_EXPORT} in {}", root.display())),
        _ => Err(format!(
            "{} holds more than one export; choose one of its folders",
            root.display()
        )),
    }
}

/// Where an export's data is, and its current fingerprint.
fn locate(path: &Path) -> Result<(Layout, Fingerprint), String> {
    if !path.is_absolute() {
        return Err(format!(
            "claude.ai export path must be absolute: {}",
            path.display()
        ));
    }
    let meta =
        fs::symlink_metadata(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    if meta.file_type().is_symlink() {
        return Err(format!(
            "claude.ai export must not be a symbolic link: {}",
            path.display()
        ));
    }
    if meta.is_file() {
        return Ok((
            Layout::Zip(path.to_path_buf()),
            Fingerprint {
                data: stamp(&meta),
                projects: None,
            },
        ));
    }
    if !meta.is_dir() {
        return Err(format!(
            "claude.ai export must be a zip file or a folder: {}",
            path.display()
        ));
    }
    // The safe opener compares against a canonical path, including the
    // verbatim prefix returned by canonicalize on Windows.
    let root =
        fs::canonicalize(path).map_err(|e| format!("Cannot resolve {}: {e}", path.display()))?;
    let folder = export_folder(&root)?;
    let conversations = folder.join(CONVERSATIONS_FILE);
    let data = regular_file(&conversations)
        .map(|m| stamp(&m))
        .ok_or_else(|| format!("{NOT_AN_EXPORT} in {}", root.display()))?;
    let projects_path = folder.join(PROJECTS_FILE);
    let projects = regular_file(&projects_path).map(|m| stamp(&m));
    Ok((
        Layout::Folder {
            root,
            conversations,
            projects: projects.is_some().then_some(projects_path),
        },
        Fingerprint { data, projects },
    ))
}

/// A reader that fails once more than `limit` bytes come out of `inner`,
/// whatever size the source declared.
struct Capped<R> {
    inner: R,
    left: u64,
    limit: u64,
    name: &'static str,
}

impl<R: Read> Capped<R> {
    fn new(inner: R, limit: u64, name: &'static str) -> Self {
        Self {
            inner,
            left: limit,
            limit,
            name,
        }
    }
}

impl<R: Read> Read for Capped<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        if self.left == 0 {
            let mut probe = [0_u8; 1];
            return match self.inner.read(&mut probe)? {
                0 => Ok(0),
                _ => Err(too_large(self.name, self.limit)),
            };
        }
        let max = usize::try_from(self.left).map_or(buf.len(), |left| left.min(buf.len()));
        let read = self.inner.read(&mut buf[..max])?;
        self.left = self
            .left
            .saturating_sub(u64::try_from(read).unwrap_or(u64::MAX));
        Ok(read)
    }
}

fn too_large(name: &str, limit: u64) -> io::Error {
    io::Error::other(format!("{name} is larger than {} MiB", limit >> 20))
}

/// Skip a UTF-8 byte order mark, which JSON parsers refuse.
fn skip_bom<R: BufRead>(reader: &mut R) -> io::Result<()> {
    if reader.fill_buf()?.starts_with(&[0xEF, 0xBB, 0xBF]) {
        reader.consume(3);
    }
    Ok(())
}

/// One parsed export.
#[derive(Debug, Default)]
struct ExportData {
    conversations: Vec<Conversation>,
    by_uuid: HashMap<String, usize>,
    /// Project uuid → name, from `projects.json`.
    project_names: HashMap<String, String>,
}

/// What a registered export holds, for the Settings action that adds it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExportSummary {
    pub conversations: usize,
    pub projects: usize,
}

fn read_export(layout: &Layout) -> Result<ExportData, String> {
    let (conversations, project_names) = match layout {
        Layout::Zip(path) => read_zip_export(path)?,
        Layout::Folder {
            root,
            conversations,
            projects,
        } => {
            let (file, _) = open_session_file(conversations, root)?;
            let list = parse_conversations(file, MAX_CONVERSATIONS_BYTES)?;
            let names = match projects {
                Some(projects) => open_session_file(projects, root)
                    .and_then(|(file, _)| parse_project_names(file, MAX_PROJECTS_BYTES))
                    .unwrap_or_else(|e| {
                        log::warn!("claude.ai export projects.json skipped: {e}");
                        HashMap::new()
                    }),
                None => HashMap::new(),
            };
            (list, names)
        }
    };
    let mut data = ExportData {
        conversations: Vec::with_capacity(conversations.len()),
        by_uuid: HashMap::with_capacity(conversations.len()),
        project_names,
    };
    for conversation in conversations {
        if data.by_uuid.contains_key(&conversation.uuid) {
            continue;
        }
        data.by_uuid
            .insert(conversation.uuid.clone(), data.conversations.len());
        data.conversations.push(conversation);
    }
    Ok(data)
}

/// The archive entry named `name` at the top level or inside one top-level
/// folder, preferring the top level. Names that would leave the archive
/// (`..`, absolute paths) are never matched.
fn zip_entry<R: Read + io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    name: &str,
) -> Option<(usize, String)> {
    let mut best: Option<(usize, usize, String)> = None;
    for index in 0..archive.len() {
        let Ok(entry) = archive.by_index_raw(index) else {
            continue;
        };
        if !entry.is_file() {
            continue;
        }
        let Some(enclosed) = entry.enclosed_name() else {
            continue;
        };
        let parts: Vec<_> = enclosed.components().collect();
        let depth = match parts.as_slice() {
            [Component::Normal(file)] if *file == name => 0,
            [Component::Normal(_), Component::Normal(file)] if *file == name => 1,
            _ => continue,
        };
        if best.as_ref().map_or(true, |(d, _, _)| depth < *d) {
            best = Some((depth, index, entry.name().to_string()));
        }
    }
    best.map(|(_, index, entry_name)| (index, entry_name))
}

type ParsedExport = (Vec<Conversation>, HashMap<String, String>);

fn read_zip_export(path: &Path) -> Result<ParsedExport, String> {
    let file = open_history_file(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|_| {
        format!(
            "Not a claude.ai export: {} is neither a zip archive nor a folder",
            path.display()
        )
    })?;
    if archive.len() > MAX_ZIP_ENTRIES {
        return Err(format!(
            "{} lists more than {MAX_ZIP_ENTRIES} entries",
            path.display()
        ));
    }
    let (index, entry_name) = zip_entry(&mut archive, CONVERSATIONS_FILE)
        .ok_or_else(|| format!("{NOT_AN_EXPORT} in {}", path.display()))?;
    let conversations = {
        let entry = archive.by_index(index).map_err(|e| e.to_string())?;
        if entry.size() > MAX_CONVERSATIONS_BYTES {
            return Err(too_large(CONVERSATIONS_FILE, MAX_CONVERSATIONS_BYTES).to_string());
        }
        parse_conversations(entry, MAX_CONVERSATIONS_BYTES)?
    };
    // projects.json belongs beside the conversations it names.
    let folder = entry_name
        .rsplit_once('/')
        .map_or(String::new(), |(folder, _)| format!("{folder}/"));
    let projects = match archive.index_for_name(&format!("{folder}{PROJECTS_FILE}")) {
        Some(index) => archive
            .by_index(index)
            .map_err(|e| e.to_string())
            .and_then(|entry| {
                if entry.size() > MAX_PROJECTS_BYTES {
                    return Err(too_large(PROJECTS_FILE, MAX_PROJECTS_BYTES).to_string());
                }
                parse_project_names(entry, MAX_PROJECTS_BYTES)
            })
            .unwrap_or_else(|e| {
                log::warn!("claude.ai export projects.json skipped: {e}");
                HashMap::new()
            }),
        None => HashMap::new(),
    };
    Ok((conversations, projects))
}

/// Parse `conversations.json` one conversation at a time, so a malformed
/// entry is skipped instead of failing the export and memory holds the
/// normalized conversations, not the raw tree.
fn parse_conversations(reader: impl Read, limit: u64) -> Result<Vec<Conversation>, String> {
    let mut reader = BufReader::new(Capped::new(reader, limit, CONVERSATIONS_FILE));
    skip_bom(&mut reader).map_err(|e| format!("{CONVERSATIONS_FILE}: {e}"))?;
    let mut de = serde_json::Deserializer::from_reader(reader);
    let parsed = de
        .deserialize_seq(ConversationsVisitor)
        .map_err(|e| format!("{NOT_AN_EXPORT_FORMAT}: {e}"))?;
    de.end()
        .map_err(|e| format!("{NOT_AN_EXPORT_FORMAT}: {e}"))?;
    if parsed.conversations.is_empty() && parsed.rejected > 0 {
        return Err(if parsed.foreign > 0 {
            CHATGPT_EXPORT.to_string()
        } else {
            format!("{NOT_AN_EXPORT_FORMAT}: no conversation could be read")
        });
    }
    if parsed.rejected > 0 {
        log::warn!(
            "claude.ai export: skipped {} unreadable conversation(s)",
            parsed.rejected
        );
    }
    Ok(parsed.conversations)
}

const NOT_AN_EXPORT_FORMAT: &str = "Not a claude.ai export: conversations.json is not readable";

#[derive(Default)]
struct ParsedConversations {
    conversations: Vec<Conversation>,
    rejected: usize,
    /// Rejected entries shaped like a `ChatGPT` export (`mapping`).
    foreign: usize,
}

struct ConversationsVisitor;

impl<'de> Visitor<'de> for ConversationsVisitor {
    type Value = ParsedConversations;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a list of conversations")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
        let mut parsed = ParsedConversations::default();
        while let Some(value) = seq.next_element::<Value>()? {
            match Conversation::from_value(value) {
                Ok(conversation) => parsed.conversations.push(conversation),
                Err(Rejected::Foreign) => {
                    parsed.rejected += 1;
                    parsed.foreign += 1;
                }
                Err(Rejected::Unreadable) => parsed.rejected += 1,
            }
        }
        Ok(parsed)
    }
}

/// Project uuid → name from `projects.json`, read one project at a time
/// (each embeds its knowledge documents).
fn parse_project_names(reader: impl Read, limit: u64) -> Result<HashMap<String, String>, String> {
    struct ProjectsVisitor;
    impl<'de> Visitor<'de> for ProjectsVisitor {
        type Value = HashMap<String, String>;

        fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
            f.write_str("a list of projects")
        }

        fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
            let mut names = HashMap::new();
            while let Some(value) = seq.next_element::<Value>()? {
                let uuid = value
                    .get("uuid")
                    .and_then(Value::as_str)
                    .filter(|id| is_safe_id(id));
                let name = non_blank(value.get("name"));
                if let (Some(uuid), Some(name)) = (uuid, name) {
                    names.insert(uuid.to_string(), name);
                }
            }
            Ok(names)
        }
    }

    let mut reader = BufReader::new(Capped::new(reader, limit, PROJECTS_FILE));
    skip_bom(&mut reader).map_err(|e| format!("{PROJECTS_FILE}: {e}"))?;
    let mut de = serde_json::Deserializer::from_reader(reader);
    let names = de
        .deserialize_seq(ProjectsVisitor)
        .map_err(|e| format!("{PROJECTS_FILE}: {e}"))?;
    de.end().map_err(|e| format!("{PROJECTS_FILE}: {e}"))?;
    Ok(names)
}

// ============================================================================
// Cache
// ============================================================================

struct Cached {
    fingerprint: Fingerprint,
    data: Arc<ExportData>,
}

/// Parsed exports by registered path. The lock is held while an export is
/// parsed, so concurrent scans parse it once.
static CACHE: Mutex<BTreeMap<PathBuf, Cached>> = Mutex::new(BTreeMap::new());

fn load_export(path: &Path) -> Result<Arc<ExportData>, String> {
    let (layout, fingerprint) = locate(path)?;
    let mut cache = CACHE.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(cached) = cache.get(path) {
        if cached.fingerprint == fingerprint {
            return Ok(Arc::clone(&cached.data));
        }
    }
    let data = Arc::new(read_export(&layout)?);
    cache.insert(
        path.to_path_buf(),
        Cached {
            fingerprint,
            data: Arc::clone(&data),
        },
    );
    Ok(data)
}

/// Keep only the cache entries of exports still registered.
fn retain_cached(exports: &[ExportRef]) {
    let keep: HashSet<&Path> = exports.iter().map(|e| e.path.as_path()).collect();
    CACHE
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .retain(|path, _| keep.contains(path.as_path()));
}

/// Drop the parsed copy of an export the user removed from Settings.
pub fn forget(path: &str) {
    CACHE
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(Path::new(trim_separators(path)));
}

/// Read an export the user is about to register and say what it holds; the
/// parsed export stays cached for the scan that follows.
pub fn inspect(path: &Path) -> Result<ExportSummary, String> {
    let data = load_export(path)?;
    let projects: HashSet<&str> = data
        .conversations
        .iter()
        .filter_map(|c| c.project_uuid.as_deref())
        .collect();
    Ok(ExportSummary {
        conversations: data
            .conversations
            .iter()
            .filter(|c| !c.messages.is_empty())
            .count(),
        projects: projects.len(),
    })
}

// ============================================================================
// Conversations
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Role {
    User,
    Assistant,
}

#[derive(Debug)]
struct ChatMessage {
    uuid: String,
    role: Role,
    timestamp: String,
    blocks: Vec<Value>,
    stop_reason: Option<String>,
}

#[derive(Debug)]
struct Conversation {
    uuid: String,
    title: Option<String>,
    model: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
    project_uuid: Option<String>,
    messages: Vec<ChatMessage>,
    has_tool_use: bool,
    has_errors: bool,
}

enum Rejected {
    /// A ChatGPT-shaped conversation (`mapping`, no `chat_messages`).
    Foreign,
    Unreadable,
}

/// Ids become one segment of a project or session id.
fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
}

fn non_blank(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
}

/// An export timestamp as the viewer's UTC RFC 3339 form.
fn normalize_timestamp(value: Option<&Value>) -> Option<String> {
    let raw = value.and_then(Value::as_str)?;
    parse_rfc3339_utc(raw).map(|ts| ts.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
}

/// A message as read, before the active branch is chosen.
struct RawMessage {
    uuid: Option<String>,
    parent: Option<String>,
    body: Map<String, Value>,
}

impl Conversation {
    fn from_value(value: Value) -> Result<Self, Rejected> {
        let Value::Object(mut object) = value else {
            return Err(Rejected::Unreadable);
        };
        let Some(Value::Array(raw_messages)) = object.remove("chat_messages") else {
            return Err(if object.contains_key("mapping") {
                Rejected::Foreign
            } else {
                Rejected::Unreadable
            });
        };
        let uuid = object
            .get("uuid")
            .and_then(Value::as_str)
            .filter(|id| is_safe_id(id))
            .ok_or(Rejected::Unreadable)?
            .to_string();
        let project_uuid = object
            .get("project_uuid")
            .and_then(Value::as_str)
            .or_else(|| {
                object
                    .get("project")
                    .and_then(|p| p.get("uuid"))
                    .and_then(Value::as_str)
            })
            .filter(|id| is_safe_id(id))
            .map(str::to_string);
        let created_at = normalize_timestamp(object.get("created_at"));
        let updated_at = normalize_timestamp(object.get("updated_at"));
        let leaf = object
            .get("current_leaf_message_uuid")
            .and_then(Value::as_str)
            .map(str::to_string);

        let raw: Vec<RawMessage> = raw_messages
            .into_iter()
            .filter_map(|message| match message {
                Value::Object(body) => Some(RawMessage {
                    uuid: body.get("uuid").and_then(Value::as_str).map(str::to_string),
                    parent: body
                        .get("parent_message_uuid")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    body,
                }),
                _ => None,
            })
            .collect();

        let mut messages = Vec::with_capacity(raw.len());
        let mut last_timestamp = created_at.clone().or_else(|| updated_at.clone());
        for (index, mut message) in active_branch(raw, leaf.as_deref()).into_iter().enumerate() {
            let role = match message.body.get("sender").and_then(Value::as_str) {
                Some("human") => Role::User,
                Some("assistant") => Role::Assistant,
                _ => continue,
            };
            let message_uuid = message
                .uuid
                .take()
                .filter(|id| !id.trim().is_empty())
                .unwrap_or_else(|| format!("{uuid}-{index}"));
            let blocks = message_blocks(&message_uuid, &mut message.body);
            if blocks.is_empty() {
                continue;
            }
            let timestamp = normalize_timestamp(message.body.get("created_at"))
                .or_else(|| last_timestamp.clone())
                .unwrap_or_default();
            last_timestamp = Some(timestamp.clone());
            messages.push(ChatMessage {
                uuid: message_uuid,
                role,
                timestamp,
                blocks,
                stop_reason: non_blank(message.body.get("stop_reason")),
            });
        }

        let block_types = || {
            messages
                .iter()
                .flat_map(|m| m.blocks.iter())
                .map(|b| b.get("type").and_then(Value::as_str).unwrap_or_default())
        };
        let has_tool_use = block_types().any(|kind| kind == "tool_use");
        let has_errors = messages.iter().flat_map(|m| m.blocks.iter()).any(|b| {
            b.get("type").and_then(Value::as_str) == Some("tool_result")
                && b.get("is_error").and_then(Value::as_bool) == Some(true)
        });

        Ok(Self {
            uuid,
            title: non_blank(object.get("name")).or_else(|| non_blank(object.get("summary"))),
            model: non_blank(object.get("model")),
            created_at,
            updated_at,
            project_uuid,
            messages,
            has_tool_use,
            has_errors,
        })
    }

    fn group(&self) -> Group {
        self.project_uuid
            .clone()
            .map_or(Group::Chats, Group::Project)
    }

    fn first_time(&self) -> String {
        self.messages
            .first()
            .map(|m| m.timestamp.clone())
            .or_else(|| self.created_at.clone())
            .unwrap_or_default()
    }

    fn last_time(&self) -> String {
        self.messages
            .last()
            .map(|m| m.timestamp.clone())
            .filter(|t| !t.is_empty())
            .or_else(|| self.updated_at.clone())
            .unwrap_or_default()
    }

    fn summary(&self) -> Option<String> {
        self.title.clone().map(|t| summarize(&t)).or_else(|| {
            self.messages
                .iter()
                .filter(|m| m.role == Role::User)
                .flat_map(|m| m.blocks.iter())
                .find_map(|b| {
                    (b.get("type").and_then(Value::as_str) == Some("text"))
                        .then(|| b.get("text").and_then(Value::as_str))
                        .flatten()
                        .filter(|t| !t.trim().is_empty())
                })
                .map(summarize)
        })
    }
}

/// The messages claude.ai shows: the branch ending at the conversation's
/// current leaf, root first. Conversations without branch data — or whose
/// parent links do not lead back to a root — keep the export's order.
fn active_branch(raw: Vec<RawMessage>, leaf: Option<&str>) -> Vec<RawMessage> {
    let Some(leaf) = leaf else {
        return raw;
    };
    let index: HashMap<&str, usize> = raw
        .iter()
        .enumerate()
        .filter_map(|(i, m)| m.uuid.as_deref().map(|id| (id, i)))
        .collect();
    let Some(&start) = index.get(leaf) else {
        return raw;
    };
    let mut chain = vec![start];
    let mut visited = HashSet::from([start]);
    let mut current = start;
    loop {
        let parent = raw[current]
            .parent
            .as_deref()
            .filter(|p| !p.trim().is_empty());
        let Some(parent) = parent else {
            break;
        };
        match index.get(parent) {
            Some(&next) if visited.insert(next) => {
                chain.push(next);
                current = next;
            }
            // The root's parent is the all-zero sentinel uuid.
            None if is_root_sentinel(parent) => break,
            // A cycle, or an unknown parent: the links do not form a tree
            // back to a root.
            _ => return raw,
        }
    }
    chain.reverse();
    let keep: HashSet<usize> = chain.iter().copied().collect();
    let mut slots: Vec<Option<RawMessage>> = raw.into_iter().map(Some).collect();
    let mut branch = Vec::with_capacity(keep.len());
    for i in chain {
        if let Some(message) = slots[i].take() {
            branch.push(message);
        }
    }
    branch
}

fn is_root_sentinel(uuid: &str) -> bool {
    // `00000000-0000-4000-8000-000000000000`: zero apart from the version
    // and variant digits.
    uuid.chars()
        .filter(char::is_ascii_hexdigit)
        .filter(|c| !matches!(c, '0' | '4' | '8'))
        .count()
        == 0
}

/// Collapse whitespace and clip to the summary length with an ellipsis.
fn summarize(text: &str) -> String {
    let cleaned = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.chars().count() > SUMMARY_MAX_CHARS {
        format!(
            "{}…",
            cleaned.chars().take(SUMMARY_MAX_CHARS).collect::<String>()
        )
    } else {
        cleaned
    }
}

// ============================================================================
// Content blocks
// ============================================================================

/// A message's viewer blocks: its attachments, then its content (or, in
/// exports without `content`, its `text`).
fn message_blocks(message_uuid: &str, body: &mut Map<String, Value>) -> Vec<Value> {
    let mut blocks = attachment_blocks(body);
    match body.remove("content") {
        Some(Value::Array(items)) if !items.is_empty() => {
            blocks.extend(content_blocks(message_uuid, items));
        }
        _ => {
            if let Some(text) = non_blank(body.get("text")) {
                blocks.push(json!({ "type": "text", "text": text }));
            }
        }
    }
    blocks
}

/// Attachments and uploaded files as document cards: name, type and size.
/// `files` and `files_v2` list the same uploads, deduplicated by file id.
fn attachment_blocks(body: &Map<String, Value>) -> Vec<Value> {
    let mut seen = HashSet::new();
    let mut blocks = Vec::new();
    for key in ["attachments", "files", "files_v2"] {
        let Some(items) = body.get(key).and_then(Value::as_array) else {
            continue;
        };
        for item in items {
            let Some(name) = non_blank(item.get("file_name")) else {
                continue;
            };
            let identity =
                non_blank(item.get("file_uuid")).unwrap_or_else(|| format!("{key}:{name}"));
            if !seen.insert(identity) {
                continue;
            }
            let kind =
                non_blank(item.get("file_type")).or_else(|| non_blank(item.get("file_kind")));
            let size = item.get("file_size").and_then(Value::as_u64);
            let context: Vec<String> = kind
                .clone()
                .into_iter()
                .chain(size.map(human_size))
                .collect();
            let mut source = json!({ "type": "file", "file_name": name });
            if let Some(kind) = kind {
                source["file_type"] = Value::String(kind);
            }
            if let Some(size) = size {
                source["file_size"] = Value::from(size);
            }
            let mut block = json!({ "type": "document", "source": source, "title": name });
            if !context.is_empty() {
                block["context"] = Value::String(context.join(" · "));
            }
            blocks.push(block);
        }
    }
    blocks
}

fn human_size(bytes: u64) -> String {
    const KIB: u64 = 1024;
    const MIB: u64 = 1024 * 1024;
    if bytes < KIB {
        format!("{bytes} B")
    } else if bytes < MIB {
        format!("{} KB", (bytes + KIB / 2) / KIB)
    } else {
        let tenths = bytes.saturating_mul(10) / MIB;
        format!("{}.{} MB", tenths / 10, tenths % 10)
    }
}

/// claude.ai content blocks to viewer blocks. Text and thinking keep their
/// text; tool calls and results keep their pairing, by `tool_use_id` or —
/// in exports that omit ids — by the latest open call of the same tool.
/// Other block types pass through unchanged for the fallback renderer.
fn content_blocks(message_uuid: &str, items: Vec<Value>) -> Vec<Value> {
    let mut blocks = Vec::with_capacity(items.len());
    let mut open_calls: Vec<(String, String)> = Vec::new();
    let mut synthesized = 0_usize;
    let mut next_id = |kind: &str| {
        synthesized += 1;
        format!("{message_uuid}-{kind}-{synthesized}")
    };
    for item in items {
        let Value::Object(mut block) = item else {
            continue;
        };
        let kind = block
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        match kind.as_str() {
            "text" => {
                if let Some(text) = non_blank(block.get("text")) {
                    blocks.push(json!({ "type": "text", "text": text }));
                }
            }
            "thinking" => {
                if let Some(thinking) = non_blank(block.get("thinking")) {
                    blocks
                        .push(json!({ "type": "thinking", "thinking": thinking, "signature": "" }));
                }
            }
            "tool_use" => {
                let name = non_blank(block.get("name")).unwrap_or_else(|| "tool".to_string());
                let id = non_blank(block.get("id")).unwrap_or_else(|| next_id("tool"));
                let input = match block.remove("input") {
                    Some(Value::Object(input)) => Value::Object(input),
                    None | Some(Value::Null) => json!({}),
                    Some(other) => json!({ "input": other }),
                };
                open_calls.push((id.clone(), name.clone()));
                blocks.push(json!({ "type": "tool_use", "id": id, "name": name, "input": input }));
            }
            "tool_result" => {
                let name = non_blank(block.get("name"));
                let id = match non_blank(block.get("tool_use_id")) {
                    Some(id) => {
                        open_calls.retain(|(open, _)| *open != id);
                        id
                    }
                    None => take_open_call(&mut open_calls, name.as_deref())
                        .unwrap_or_else(|| next_id("result")),
                };
                let is_error = block
                    .get("is_error")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                blocks.push(json!({
                    "type": "tool_result",
                    "tool_use_id": id,
                    "content": tool_result_content(block.remove("content")),
                    "is_error": is_error,
                }));
            }
            _ => blocks.push(Value::Object(block)),
        }
    }
    blocks
}

/// The latest call still waiting for its result: of the named tool when the
/// result names one, else any.
fn take_open_call(open_calls: &mut Vec<(String, String)>, name: Option<&str>) -> Option<String> {
    let position = open_calls
        .iter()
        .rposition(|(_, open)| name.map_or(true, |name| open == name))?;
    Some(open_calls.remove(position).0)
}

/// A tool result's content as its text: claude.ai results hold `text` items
/// and search `knowledge` items (title, url, text), joined in order.
fn tool_result_content(content: Option<Value>) -> Value {
    match content {
        Some(Value::Array(items)) => Value::String(
            items
                .iter()
                .map(|item| {
                    if item.get("type").and_then(Value::as_str) == Some("text") {
                        return item
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                    }
                    let parts: Vec<String> = ["title", "url", "text"]
                        .iter()
                        .filter_map(|key| non_blank(item.get(*key)))
                        .collect();
                    if parts.is_empty() {
                        item.to_string()
                    } else {
                        parts.join("\n")
                    }
                })
                .collect::<Vec<_>>()
                .join("\n\n"),
        ),
        Some(Value::String(text)) => Value::String(text),
        None | Some(Value::Null) => Value::String(String::new()),
        Some(other) => Value::String(other.to_string()),
    }
}

// ============================================================================
// Project / session ids
// ============================================================================

/// How conversations are grouped into projects within one export.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Group {
    /// Conversations in no claude.ai Project.
    Chats,
    /// A claude.ai Project, by uuid.
    Project(String),
}

impl Group {
    fn encode(&self) -> String {
        match self {
            Self::Chats => CHATS_GROUP.to_string(),
            Self::Project(uuid) => format!("{PROJECT_GROUP_PREFIX}{uuid}"),
        }
    }

    fn decode(raw: &str) -> Option<Self> {
        if raw == CHATS_GROUP {
            return Some(Self::Chats);
        }
        raw.strip_prefix(PROJECT_GROUP_PREFIX)
            .filter(|uuid| is_safe_id(uuid))
            .map(|uuid| Self::Project(uuid.to_string()))
    }
}

/// `claude-ai://<export id>/<group>`.
fn project_path(export_id: &str, group: &Group) -> String {
    format!("{SCHEME}{export_id}/{}", group.encode())
}

fn session_path(export_id: &str, group: &Group, conversation: &str) -> String {
    format!(
        "{}{SESSION_SEP}{conversation}",
        project_path(export_id, group)
    )
}

fn parse_project_path(path: &str) -> Result<(String, Group), String> {
    let invalid = || format!("Invalid claude.ai project path: {path}");
    let rest = path.strip_prefix(SCHEME).ok_or_else(invalid)?;
    let (export_id, group) = rest.split_once('/').ok_or_else(invalid)?;
    if export_id.is_empty() || !export_id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(invalid());
    }
    let group = Group::decode(group).ok_or_else(invalid)?;
    Ok((export_id.to_string(), group))
}

fn parse_session_path(path: &str) -> Result<(String, Group, String), String> {
    let (project, conversation) = path
        .rsplit_once(SESSION_SEP)
        .filter(|(_, id)| is_safe_id(id))
        .ok_or_else(|| format!("Invalid claude.ai session path: {path}"))?;
    let (export_id, group) = parse_project_path(project)?;
    Ok((export_id, group, conversation.to_string()))
}

fn project_display_name(data: &ExportData, group: &Group) -> String {
    match group {
        Group::Chats => DISPLAY_NAME.to_string(),
        Group::Project(uuid) => data.project_names.get(uuid).cloned().unwrap_or_else(|| {
            format!(
                "{DISPLAY_NAME} project {}",
                uuid.chars().take(8).collect::<String>()
            )
        }),
    }
}

/// Display name for a claude.ai project path (stats view).
pub fn project_name(project_path: &str) -> String {
    parse_project_path(project_path)
        .ok()
        .and_then(|(export_id, group)| {
            let export = registered_export(&export_id).ok()?;
            let data = load_export(&export.path).ok()?;
            Some(project_display_name(&data, &group))
        })
        .unwrap_or_else(|| DISPLAY_NAME.to_string())
}

/// Display name of the project a claude.ai session path belongs to.
pub fn project_name_for_session(session_path: &str) -> String {
    session_path.rsplit_once(SESSION_SEP).map_or_else(
        || DISPLAY_NAME.to_string(),
        |(project, _)| project_name(project),
    )
}

// ============================================================================
// Provider interface
// ============================================================================

/// One project per claude.ai Project, plus one "Claude.ai" project for the
/// rest, in every registered export. An export that cannot be read is logged
/// and skipped rather than hiding the others.
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let exports = registered_exports();
    retain_cached(&exports);
    let mut projects = Vec::new();
    for export in &exports {
        match load_export(&export.path) {
            Ok(data) => projects.extend(export_projects(export, &data)),
            Err(e) => log::warn!("claude.ai export {} skipped: {e}", export.path.display()),
        }
    }
    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

fn export_projects(export: &ExportRef, data: &ExportData) -> Vec<ClaudeProject> {
    #[derive(Default)]
    struct Acc {
        sessions: usize,
        messages: usize,
        last: String,
    }
    let mut groups: BTreeMap<Group, Acc> = BTreeMap::new();
    for conversation in data.conversations.iter().filter(|c| !c.messages.is_empty()) {
        let acc = groups.entry(conversation.group()).or_default();
        acc.sessions += 1;
        acc.messages += conversation.messages.len();
        let last = conversation.last_time();
        if last > acc.last {
            acc.last = last;
        }
    }
    groups
        .into_iter()
        .map(|(group, acc)| {
            let path = project_path(&export.id, &group);
            ClaudeProject {
                name: project_display_name(data, &group),
                // No folder: the project's own id keeps it distinct when the
                // tree merges projects by folder.
                actual_path: path.clone(),
                path,
                session_count: acc.sessions,
                message_count: acc.messages,
                last_modified: acc.last,
                git_info: None,
                provider: Some(PROVIDER.to_string()),
                storage_type: Some("json".to_string()),
                custom_directory_label: Some(export.label.clone()),
            }
        })
        .collect()
}

/// The conversations of one project, newest first.
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let (export_id, group) = parse_project_path(project_path)?;
    let export = registered_export(&export_id)?;
    let data = load_export(&export.path)?;
    let project_name = project_display_name(&data, &group);
    let mut sessions: Vec<ClaudeSession> = data
        .conversations
        .iter()
        .filter(|c| !c.messages.is_empty() && c.group() == group)
        .map(|conversation| {
            let path = session_path(&export.id, &group, &conversation.uuid);
            let last = conversation.last_time();
            ClaudeSession {
                session_id: path.clone(),
                actual_session_id: conversation.uuid.clone(),
                file_path: path,
                project_name: project_name.clone(),
                message_count: conversation.messages.len(),
                first_message_time: conversation.first_time(),
                last_message_time: last.clone(),
                last_modified: conversation.updated_at.clone().unwrap_or(last),
                has_tool_use: conversation.has_tool_use,
                has_errors: conversation.has_errors,
                summary: conversation.summary(),
                is_renamed: false,
                provider: Some(PROVIDER.to_string()),
                storage_type: Some("json".to_string()),
                entrypoint: None,
            }
        })
        .collect();
    sessions.sort_by(|a, b| b.last_message_time.cmp(&a.last_message_time));
    Ok(sessions)
}

fn conversation_messages(conversation: &Conversation) -> Vec<ClaudeMessage> {
    let mut previous: Option<String> = None;
    conversation
        .messages
        .iter()
        .map(|message| {
            let (kind, model) = match message.role {
                Role::User => ("user", None),
                Role::Assistant => ("assistant", conversation.model.clone()),
            };
            let mut converted = build_provider_message(
                PROVIDER,
                message.uuid.clone(),
                &conversation.uuid,
                message.timestamp.clone(),
                kind,
                Some(kind),
                Some(Value::Array(message.blocks.clone())),
                model,
            );
            converted.stop_reason.clone_from(&message.stop_reason);
            converted.parent_uuid = previous.replace(message.uuid.clone());
            converted
        })
        .collect()
}

/// The messages of one conversation, in the order claude.ai shows them.
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let (export_id, group, conversation_id) = parse_session_path(session_path)?;
    let export = registered_export(&export_id)?;
    let data = load_export(&export.path)?;
    let conversation = data
        .by_uuid
        .get(&conversation_id)
        .map(|&i| &data.conversations[i])
        .filter(|c| c.group() == group)
        .ok_or_else(|| format!("claude.ai conversation not found: {session_path}"))?;
    Ok(conversation_messages(conversation))
}

/// Case-insensitive search across every registered export, `limit`-capped.
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    if query.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();
    for export in registered_exports() {
        let data = match load_export(&export.path) {
            Ok(data) => data,
            Err(e) => {
                log::warn!("claude.ai search skipped {}: {e}", export.path.display());
                continue;
            }
        };
        for conversation in &data.conversations {
            let matched: Vec<usize> = conversation
                .messages
                .iter()
                .enumerate()
                .filter(|(_, m)| {
                    m.blocks
                        .iter()
                        .any(|b| search_json_value_case_insensitive(b, &query_lower))
                })
                .map(|(i, _)| i)
                .collect();
            if matched.is_empty() {
                continue;
            }
            let group = conversation.group();
            let project_name = project_display_name(&data, &group);
            let project_path = project_path(&export.id, &group);
            let messages = conversation_messages(conversation);
            for index in matched {
                if results.len() >= limit {
                    return Ok(results);
                }
                let mut message = messages[index].clone();
                message.project_name = Some(project_name.clone());
                message.project_path = Some(project_path.clone());
                results.push(message);
            }
        }
    }
    Ok(results)
}

#[cfg(test)]
mod tests;

#[cfg(test)]
pub(crate) mod test_support;
