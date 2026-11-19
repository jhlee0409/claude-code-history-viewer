//! Cursor ACP provider (#576).
//!
//! `JetBrains` IDEs (`GoLand`, `IntelliJ IDEA`, ...) run Cursor through the Agent
//! Client Protocol bridge (`cursor-agent acp`). That bridge keeps its sessions
//! apart from both the Cursor IDE (`cursor`) and the transcripts the Cursor
//! Agent CLI mirrors under `~/.cursor/projects` (`cursor-agent`):
//!
//! ```text
//! ~/.cursor/acp-sessions/<session-id>/     (%USERPROFILE%\.cursor\... on Windows)
//! ├── meta.json   {"schemaVersion":1,"cwd":"<workspace>","title":"<title>"}
//! └── store.db    SQLite (WAL): meta(key, value), blobs(id, data)
//! ```
//!
//! `store.db` is the Cursor Agent CLI chat store (the same format as
//! `~/.cursor/chats/<md5>/<id>/store.db`). No schema is published; the layout
//! below follows the community reverse-engineering notes and was checked
//! against the store attached to #576:
//! - Harness Notes, "Transcript format" (Cursor Agent 2026.10.12, ACP noted
//!   for 2026.11.13): <https://harnessnotes.com/session-transcripts/format?harness=cursor-agent>
//! - txcript, `docs/formats/cursor.md`:
//!   <https://github.com/skillsynchq/txcript/blob/main/docs/formats/cursor.md>
//! - deja-vu, "The second CLI store":
//!   <https://vshulcz.github.io/deja-vu/registry/cursor>
//!
//! - `meta` row `'0'` holds hex-encoded JSON with `latestRootBlobId`,
//!   `name` and `createdAt` (ms). An empty root id means no conversation yet.
//! - `blobs` is content-addressed: `id` is the lowercase hex SHA-256 of
//!   `data`. A blob carries no type tag; its type follows from the field that
//!   references it.
//! - The root blob is a protobuf `ConversationStateStructure`: field 1 lists
//!   the prompt-message blob ids in conversation order (the model context:
//!   system, user, assistant, tool), field 8 the UI turn blobs, field 13
//!   (legacy 11) the compaction archives whose field 1 lists the messages a
//!   compaction replaced, field 26 the conversation start (ms).
//! - Prompt messages are JSON in the Vercel AI SDK shape: `role` plus
//!   `content` parts `text`, `reasoning`, `redacted-reasoning`, `tool-call`,
//!   `tool-result`, `image`, `file`. User prompts are wrapped in
//!   `<user_query>`; other user-role messages are injected context.
//! - Turns and steps (protobuf) carry the times the JSON lacks: a turn's
//!   `request_id` matches the user message's `providerOptions.cursor.requestId`
//!   and its user message records `started_at_ms`; a tool-call step records
//!   `tool_call_id` with start and completion times.
//!
//! The conversation is rebuilt from the root's message list, never from blob
//! row order (older roots and superseded steps stay in the table). An entry of
//! that list this reader cannot decode — a binary record, a missing blob,
//! malformed JSON — is skipped and counted, as is a content part of an unknown
//! type; a session with any shows a note saying how many. Turns and steps are
//! read for timing only, and subagent states are not shown.
//!
//! Projects group sessions by `meta.json`'s `cwd`. Paths are provider URIs:
//! `cursor-acp://<cwd>` for a project and `cursor-acp://<cwd>#<session-id>`
//! for a session; the id alone locates the store under the root. Stores are
//! opened read-only (the IDE may be running) and never written.

use crate::commands::stats::session_files::open_session_file;
use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use crate::providers::ProviderInfo;
use crate::utils::{build_provider_message, ms_to_iso, search_json_value_case_insensitive};
use base64::Engine as _;
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

const PROVIDER: &str = "cursor-acp";
const DISPLAY_NAME: &str = "Cursor ACP";
const SCHEME: &str = "cursor-acp://";
const SESSION_SEP: char = '#';
const SESSIONS_DIR: &str = "acp-sessions";
const META_FILE: &str = "meta.json";
const DB_FILE: &str = "store.db";
const SUMMARY_MAX_CHARS: usize = 80;
/// The name Cursor gives a chat until it is titled.
const DEFAULT_CHAT_NAME: &str = "New Agent";
/// `meta.json` is a few hundred bytes; anything far larger is not one.
const META_MAX_BYTES: u64 = 1024 * 1024;

/// Subtype of the note added to a session with content this reader could
/// not decode. Its text starts with the count (the renderer reads it).
pub(crate) const UNDECODED_SUBTYPE: &str = "undecoded_records";

// ============================================================================
// Root and session discovery
// ============================================================================

/// `~/.cursor/acp-sessions` (`%USERPROFILE%\.cursor\acp-sessions`).
fn sessions_root() -> Option<PathBuf> {
    Some(crate::utils::home_dir()?.join(".cursor").join(SESSIONS_DIR))
}

/// A real (non-symlink) directory.
fn is_real_dir(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_dir())
}

/// A real (non-symlink) regular file.
fn is_real_file(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_file())
}

/// Session ids are folder names and part of a URI: a plain name only.
fn is_valid_session_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && !id.starts_with('.')
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// One session folder with a conversation store.
#[derive(Debug, Clone)]
struct SessionDir {
    id: String,
    db: PathBuf,
    /// `meta.json` `cwd`, trimmed; `None` when missing.
    cwd: Option<String>,
    /// `meta.json` `title`.
    title: Option<String>,
}

/// `meta.json` fields this reader uses.
#[derive(Default)]
struct SessionMetaFile {
    cwd: Option<String>,
    title: Option<String>,
}

/// Read `meta.json` without following a link out of the root. A missing or
/// malformed file is no metadata.
fn read_meta_file(path: &Path, canonical_root: &Path) -> SessionMetaFile {
    if !is_real_file(path) {
        return SessionMetaFile::default();
    }
    let text = open_session_file(path, canonical_root).and_then(|(file, meta)| {
        if meta.len() > META_MAX_BYTES {
            return Err(format!("{}: too large for a meta.json", path.display()));
        }
        let mut text = String::new();
        file.take(META_MAX_BYTES)
            .read_to_string(&mut text)
            .map_err(|e| format!("{}: {e}", path.display()))?;
        Ok(text)
    });
    let value = match text {
        Ok(text) => serde_json::from_str::<Value>(&text).unwrap_or(Value::Null),
        Err(e) => {
            log::warn!("Cursor ACP meta.json skipped: {e}");
            Value::Null
        }
    };
    let text_field = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    SessionMetaFile {
        cwd: text_field("cwd"),
        title: text_field("title"),
    }
}

/// The session folder `id` under `root`, if it holds a store.
fn session_dir(root: &Path, canonical_root: &Path, id: &str) -> Option<SessionDir> {
    if !is_valid_session_id(id) {
        return None;
    }
    let dir = root.join(id);
    let db = dir.join(DB_FILE);
    if !is_real_dir(&dir) || !is_real_file(&db) {
        return None;
    }
    let meta = read_meta_file(&dir.join(META_FILE), canonical_root);
    Some(SessionDir {
        id: id.to_string(),
        db,
        cwd: meta.cwd,
        title: meta.title,
    })
}

/// Every session folder with a store, sorted by id. Folders holding only
/// `meta.json` (a chat that never got a conversation) are skipped.
fn discover_sessions() -> Vec<SessionDir> {
    let Some(root) = sessions_root().filter(|root| is_real_dir(root)) else {
        return Vec::new();
    };
    let Ok(canonical_root) = fs::canonicalize(&root) else {
        return Vec::new();
    };
    let entries = match fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(e) => {
            log::warn!("Cursor ACP sessions not listed: {}: {e}", root.display());
            return Vec::new();
        }
    };
    let mut sessions: Vec<SessionDir> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name();
            session_dir(&root, &canonical_root, name.to_str()?)
        })
        .collect();
    sessions.sort_by(|a, b| a.id.cmp(&b.id));
    sessions
}

fn find_session(id: &str) -> Option<SessionDir> {
    let root = sessions_root().filter(|root| is_real_dir(root))?;
    let canonical_root = fs::canonicalize(&root).ok()?;
    session_dir(&root, &canonical_root, id)
}

/// Detect the Cursor ACP store: the root with at least one session store.
pub fn detect() -> Option<ProviderInfo> {
    let base = get_base_path()?;
    Some(ProviderInfo {
        id: PROVIDER.to_string(),
        display_name: DISPLAY_NAME.to_string(),
        is_available: !discover_sessions().is_empty(),
        base_path: base,
    })
}

/// `~/.cursor/acp-sessions`, when it is a real directory.
pub fn get_base_path() -> Option<String> {
    sessions_root()
        .filter(|root| is_real_dir(root))
        .map(|root| root.to_string_lossy().to_string())
}

// ============================================================================
// Project / session paths
// ============================================================================

/// `cursor-acp://<cwd>`; a session without a recorded `cwd` gets the bare
/// scheme.
fn project_path(cwd: Option<&str>) -> String {
    format!("{SCHEME}{}", cwd.unwrap_or_default())
}

fn session_path(cwd: Option<&str>, id: &str) -> String {
    format!("{}{SESSION_SEP}{id}", project_path(cwd))
}

/// The `cwd` a project path names (`None` for the no-workspace bucket).
fn parse_project_path(path: &str) -> Result<Option<String>, String> {
    let rest = path
        .strip_prefix(SCHEME)
        .ok_or_else(|| format!("Invalid Cursor ACP project path: {path}"))?;
    Ok((!rest.is_empty()).then(|| rest.to_string()))
}

/// The `cwd` and session id a session path names.
fn parse_session_path(path: &str) -> Result<(Option<String>, String), String> {
    let invalid = || format!("Invalid Cursor ACP session path: {path}");
    let (project, id) = path.rsplit_once(SESSION_SEP).ok_or_else(invalid)?;
    if !is_valid_session_id(id) {
        return Err(invalid());
    }
    Ok((parse_project_path(project)?, id.to_string()))
}

/// The workspace folder name (`/` and `\` separators), or the provider name
/// for sessions without one.
fn project_display_name(cwd: Option<&str>) -> String {
    cwd.and_then(|dir| {
        dir.trim_end_matches(['/', '\\'])
            .rsplit(['/', '\\'])
            .next()
            .filter(|name| !name.is_empty())
    })
    .or(cwd)
    .unwrap_or(DISPLAY_NAME)
    .to_string()
}

/// Display name of a project path (stats view).
pub fn project_name(project_path: &str) -> String {
    parse_project_path(project_path).map_or_else(
        |_| PROVIDER.to_string(),
        |cwd| project_display_name(cwd.as_deref()),
    )
}

/// Display name of the project a session path belongs to.
pub fn project_name_for_session(session_path: &str) -> String {
    parse_session_path(session_path).map_or_else(
        |_| PROVIDER.to_string(),
        |(cwd, _)| project_display_name(cwd.as_deref()),
    )
}

// ============================================================================
// Protobuf wire format (schema-free)
// ============================================================================

/// The fields this reader takes from a protobuf message.
mod wire {
    pub(super) enum Field<'a> {
        Varint(u64),
        Bytes(&'a [u8]),
        /// A fixed-width value; never one this reader uses.
        Fixed,
    }

    fn varint(buf: &[u8], pos: &mut usize) -> Option<u64> {
        let mut value = 0u64;
        for shift in (0..64).step_by(7) {
            let byte = *buf.get(*pos)?;
            *pos += 1;
            value |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Some(value);
            }
        }
        None
    }

    /// Every top-level field of `buf` in order; `None` when `buf` is not a
    /// well-formed protobuf message (groups included: none are used).
    pub(super) fn fields(buf: &[u8]) -> Option<Vec<(u64, Field<'_>)>> {
        let mut out = Vec::new();
        let mut pos = 0;
        while pos < buf.len() {
            let key = varint(buf, &mut pos)?;
            let number = key >> 3;
            if number == 0 {
                return None;
            }
            let field = match key & 7 {
                0 => Field::Varint(varint(buf, &mut pos)?),
                1 => {
                    pos = pos.checked_add(8).filter(|end| *end <= buf.len())?;
                    Field::Fixed
                }
                2 => {
                    let len = usize::try_from(varint(buf, &mut pos)?).ok()?;
                    let end = pos.checked_add(len).filter(|end| *end <= buf.len())?;
                    let bytes = &buf[pos..end];
                    pos = end;
                    Field::Bytes(bytes)
                }
                5 => {
                    pos = pos.checked_add(4).filter(|end| *end <= buf.len())?;
                    Field::Fixed
                }
                _ => return None,
            };
            out.push((number, field));
        }
        Some(out)
    }
}

/// A 32-byte blob reference as the `blobs.id` it names.
fn blob_ref(bytes: &[u8]) -> Option<String> {
    use std::fmt::Write as _;
    (bytes.len() == 32).then(|| {
        bytes.iter().fold(String::with_capacity(64), |mut hex, b| {
            let _ = write!(hex, "{b:02x}");
            hex
        })
    })
}

/// What the reader takes from the root `ConversationStateStructure`.
#[derive(Default)]
struct Root {
    /// Field 1: prompt-message blob ids, or `None` for a reference that is
    /// not a blob id.
    messages: Vec<Option<String>>,
    /// Field 8: turn blob ids.
    turns: Vec<String>,
    /// Fields 11 (legacy) and 13: compaction archive blob ids.
    archives: Vec<String>,
    /// Field 26: conversation start (ms).
    started_ms: Option<u64>,
}

fn decode_root(data: &[u8]) -> Option<Root> {
    let mut root = Root::default();
    for (number, field) in wire::fields(data)? {
        match (number, field) {
            (1, wire::Field::Bytes(id)) => root.messages.push(blob_ref(id)),
            (8, wire::Field::Bytes(id)) => root.turns.extend(blob_ref(id)),
            (11 | 13, wire::Field::Bytes(id)) => {
                if let Some(id) = blob_ref(id) {
                    if !root.archives.contains(&id) {
                        root.archives.push(id);
                    }
                }
            }
            (26, wire::Field::Varint(ms)) => root.started_ms = Some(ms),
            _ => {}
        }
    }
    Some(root)
}

/// `ConversationSummaryArchive` field 1: the message blob ids it replaced.
fn decode_archive(data: &[u8]) -> Option<Vec<Option<String>>> {
    Some(
        wire::fields(data)?
            .into_iter()
            .filter_map(|(number, field)| match (number, field) {
                (1, wire::Field::Bytes(id)) => Some(blob_ref(id)),
                _ => None,
            })
            .collect(),
    )
}

/// The first `Bytes` field `number` of a message.
fn bytes_field(fields: &[(u64, wire::Field<'_>)], number: u64) -> Option<Vec<u8>> {
    fields.iter().find_map(|(n, field)| match field {
        wire::Field::Bytes(bytes) if *n == number => Some(bytes.to_vec()),
        _ => None,
    })
}

/// The first non-zero `Varint` field `number` of a message.
fn varint_field(fields: &[(u64, wire::Field<'_>)], number: u64) -> Option<u64> {
    fields.iter().find_map(|(n, field)| match field {
        wire::Field::Varint(value) if *n == number && *value > 0 => Some(*value),
        _ => None,
    })
}

// ============================================================================
// Store access
// ============================================================================

/// Read-only, without `SQLite`'s own mutex (one connection per call).
fn open_db(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Failed to open Cursor ACP store {}: {e}", path.display()))?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| format!("Failed to set Cursor ACP store busy timeout: {e}"))?;
    Ok(conn)
}

fn blob(conn: &Connection, id: &str) -> Result<Option<Vec<u8>>, String> {
    conn.prepare_cached("SELECT data FROM blobs WHERE id = ?1")
        .and_then(|mut stmt| {
            stmt.query_row([id], |row| {
                Ok(match row.get_ref(0)? {
                    ValueRef::Blob(bytes) | ValueRef::Text(bytes) => Some(bytes.to_vec()),
                    _ => None,
                })
            })
            .optional()
        })
        .map(Option::flatten)
        .map_err(|e| format!("Cursor ACP store read failed: {e}"))
}

/// The `meta` row `'0'` agent record.
#[derive(Default)]
struct AgentMeta {
    root_blob_id: Option<String>,
    name: Option<String>,
    created_ms: Option<u64>,
}

fn decode_hex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) || !text.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).ok())
        .collect()
}

/// A millisecond epoch from a value recorded in s, ms, us or ns.
fn normalize_epoch_ms(value: f64) -> Option<u64> {
    if !value.is_finite() || value <= 0.0 {
        return None;
    }
    let ms = if value < 1e11 {
        value * 1e3
    } else if value < 1e14 {
        value
    } else if value < 1e17 {
        value / 1e3
    } else {
        value / 1e6
    };
    Some(ms as u64)
}

fn read_agent_meta(conn: &Connection) -> Result<AgentMeta, String> {
    let raw: Option<Vec<u8>> = conn
        .query_row("SELECT value FROM meta WHERE key = '0'", [], |row| {
            Ok(match row.get_ref(0)? {
                ValueRef::Text(bytes) | ValueRef::Blob(bytes) => Some(bytes.to_vec()),
                _ => None,
            })
        })
        .optional()
        .map(Option::flatten)
        .map_err(|e| format!("Cursor ACP store read failed: {e}"))?;
    let Some(raw) = raw else {
        return Ok(AgentMeta::default());
    };
    // Hex-encoded JSON in every observed store; plain JSON is accepted too.
    let text = String::from_utf8_lossy(&raw);
    let text = text.trim();
    let json_bytes = decode_hex(text).unwrap_or_else(|| text.as_bytes().to_vec());
    let value: Value = serde_json::from_slice(&json_bytes).unwrap_or(Value::Null);
    let text_field = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    Ok(AgentMeta {
        root_blob_id: text_field("latestRootBlobId").map(|id| id.to_ascii_lowercase()),
        name: text_field("name").filter(|name| name != DEFAULT_CHAT_NAME),
        created_ms: value
            .get("createdAt")
            .and_then(Value::as_f64)
            .and_then(normalize_epoch_ms),
    })
}

/// Times the protobuf turn view records for the JSON messages.
#[derive(Default)]
struct Timing {
    /// Turn `request_id` → its user message's `started_at_ms`.
    requests: HashMap<String, u64>,
    /// Tool call id → (`started_at_ms`, `completed_at_ms`).
    tools: HashMap<String, (Option<u64>, Option<u64>)>,
}

/// Best-effort: a turn or step that is missing or cannot be decoded only
/// costs its times.
fn read_timing(conn: &Connection, turns: &[String]) -> Result<Timing, String> {
    let mut timing = Timing::default();
    for turn_id in turns {
        let Some(turn) = blob(conn, turn_id)? else {
            continue;
        };
        // ConversationTurnStructure.agent_conversation_turn (field 1).
        let Some(agent_turn) = wire::fields(&turn).and_then(|f| bytes_field(&f, 1)) else {
            continue;
        };
        let Some(fields) = wire::fields(&agent_turn) else {
            continue;
        };
        let request_id = bytes_field(&fields, 3).and_then(|b| String::from_utf8(b).ok());
        let user_message = bytes_field(&fields, 1).and_then(|b| blob_ref(&b));
        if let (Some(request_id), Some(user_message)) = (request_id, user_message) {
            if let Some(data) = blob(conn, &user_message)? {
                // UserMessage.started_at_ms (25), else completed_at_ms (26).
                let started = wire::fields(&data)
                    .and_then(|f| varint_field(&f, 25).or_else(|| varint_field(&f, 26)));
                if let Some(ms) = started {
                    timing.requests.insert(request_id, ms);
                }
            }
        }
        for (number, field) in &fields {
            let (2, wire::Field::Bytes(step_id)) = (number, field) else {
                continue;
            };
            let Some(step_id) = blob_ref(step_id) else {
                continue;
            };
            let Some(step) = blob(conn, &step_id)? else {
                continue;
            };
            // ConversationStep.tool_call (field 2): tool_call_id (57),
            // started_at_ms (59), completed_at_ms (60).
            let Some(call) = wire::fields(&step)
                .and_then(|f| bytes_field(&f, 2))
                .and_then(|call| {
                    let fields = wire::fields(&call)?;
                    let id = String::from_utf8(bytes_field(&fields, 57)?).ok()?;
                    Some((id, varint_field(&fields, 59), varint_field(&fields, 60)))
                })
            else {
                continue;
            };
            timing.tools.insert(call.0, (call.1, call.2));
        }
    }
    Ok(timing)
}

// ============================================================================
// Conversation
// ============================================================================

/// A session's messages, led by a note when some content could not be
/// decoded.
struct Conversation {
    messages: Vec<ClaudeMessage>,
    /// `meta` row title (when not the default name).
    name: Option<String>,
}

/// The prompt-message ids in conversation order: every compaction archive's
/// messages, then the current root's. `undecoded` counts what is unreadable.
fn message_ids(
    conn: &Connection,
    root: &Root,
    undecoded: &mut usize,
) -> Result<Vec<Option<String>>, String> {
    let mut ids = Vec::new();
    for archive_id in &root.archives {
        match blob(conn, archive_id)?.as_deref().and_then(decode_archive) {
            Some(archived) => ids.extend(archived),
            None => *undecoded += 1,
        }
    }
    ids.extend(root.messages.iter().cloned());
    Ok(ids)
}

/// Last-modified time of a store: the newest of `store.db` and its WAL.
fn store_mtime_ms(db: &Path) -> Option<u64> {
    let wal = db.with_file_name(format!("{DB_FILE}-wal"));
    [db.to_path_buf(), wal]
        .iter()
        .filter_map(|path| fs::metadata(path).ok()?.modified().ok())
        .filter_map(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .max()
}

fn read_conversation(
    conn: &Connection,
    session_id: &str,
    db: &Path,
) -> Result<Conversation, String> {
    let meta = read_agent_meta(conn)?;
    let Some(root_id) = meta.root_blob_id.as_deref() else {
        // No checkpoint yet: nothing was said.
        return Ok(Conversation {
            messages: Vec::new(),
            name: meta.name,
        });
    };
    let Some(root) = blob(conn, root_id)?.as_deref().and_then(decode_root) else {
        let at = meta.created_ms.or_else(|| store_mtime_ms(db)).unwrap_or(0);
        return Ok(Conversation {
            messages: vec![undecoded_note(session_id, 1, at)],
            name: meta.name,
        });
    };
    let mut undecoded = 0;
    let ids = message_ids(conn, &root, &mut undecoded)?;
    let timing = read_timing(conn, &root.turns)?;
    let start_ms = root
        .started_ms
        .or(meta.created_ms)
        .or_else(|| store_mtime_ms(db))
        .unwrap_or(0);

    let mut builder = MessageBuilder {
        session_id,
        timing: &timing,
        start_ms,
        clock_ms: start_ms,
        undecoded,
        system_prompt: None,
        messages: Vec::new(),
    };
    for (index, id) in ids.iter().enumerate() {
        let data = match id {
            Some(id) => blob(conn, id)?,
            None => None,
        };
        let parsed = data
            .as_deref()
            .filter(|bytes| bytes.iter().find(|b| !b.is_ascii_whitespace()) == Some(&b'{'))
            .and_then(|bytes| serde_json::from_slice::<Value>(bytes).ok())
            .filter(|value| value.get("role").and_then(Value::as_str).is_some());
        match parsed {
            Some(value) => builder.push(index, &value),
            None => builder.undecoded += 1,
        }
    }
    let MessageBuilder {
        mut messages,
        undecoded,
        system_prompt,
        ..
    } = builder;
    // Both are dated `start_ms`, where the clock starts, so they sort first.
    if let Some(system_prompt) = system_prompt {
        messages.insert(0, system_prompt);
    }
    if undecoded > 0 {
        messages.insert(0, undecoded_note(session_id, undecoded, start_ms));
    }
    Ok(Conversation {
        messages,
        name: meta.name,
    })
}

/// The note shown above a session with content this reader cannot decode.
/// The text starts with the count, which the renderer localizes.
fn undecoded_note(session_id: &str, count: usize, at_ms: u64) -> ClaudeMessage {
    let noun = if count == 1 { "item" } else { "items" };
    let verb = if count == 1 { "is" } else { "are" };
    let mut note = build_provider_message(
        PROVIDER,
        format!("{session_id}-undecoded"),
        session_id,
        ms_to_iso(at_ms),
        "system",
        Some("system"),
        Some(Value::String(format!(
            "{count} {noun} in this session's store could not be decoded and {verb} not shown."
        ))),
        None,
    );
    note.subtype = Some(UNDECODED_SUBTYPE.to_string());
    note.level = Some("warning".to_string());
    note
}

/// Builds viewer messages from prompt messages in order, keeping a clock
/// that only moves forward.
struct MessageBuilder<'a> {
    session_id: &'a str,
    timing: &'a Timing,
    start_ms: u64,
    clock_ms: u64,
    undecoded: usize,
    /// The system prompt, shown first wherever it sits (after a
    /// compaction, the archived messages precede it).
    system_prompt: Option<ClaudeMessage>,
    messages: Vec<ClaudeMessage>,
}

fn cursor_options(value: &Value) -> Option<&Value> {
    value.get("providerOptions")?.get("cursor")
}

fn text_of(part: &Value) -> Option<&str> {
    part.get("text").and_then(Value::as_str)
}

/// The parts of a message: a string content is one text part.
fn parts(value: &Value) -> Vec<Value> {
    match value.get("content") {
        Some(Value::String(text)) => vec![json!({ "type": "text", "text": text })],
        Some(Value::Array(parts)) => parts.clone(),
        _ => Vec::new(),
    }
}

/// Every text part of a message, joined by blank lines.
fn joined_text(value: &Value) -> String {
    parts(value)
        .iter()
        .filter_map(text_of)
        .collect::<Vec<_>>()
        .join("\n\n")
}

impl MessageBuilder<'_> {
    fn advance(&mut self, ms: Option<u64>) -> String {
        if let Some(ms) = ms {
            self.clock_ms = self.clock_ms.max(ms);
        }
        ms_to_iso(self.clock_ms)
    }

    fn emit(
        &mut self,
        index: usize,
        message_type: &str,
        content: Value,
        model: Option<String>,
        at_ms: Option<u64>,
    ) -> &mut ClaudeMessage {
        let timestamp = self.advance(at_ms);
        self.messages.push(build_provider_message(
            PROVIDER,
            format!("{}-{index}", self.session_id),
            self.session_id,
            timestamp,
            message_type,
            Some(message_type),
            Some(content),
            model,
        ));
        self.messages.last_mut().expect("just pushed")
    }

    fn push(&mut self, index: usize, value: &Value) {
        match value
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "system" => self.push_system(index, value),
            "user" => self.push_user(index, value),
            "assistant" => self.push_assistant(index, value),
            "tool" => self.push_tool(index, value),
            _ => self.undecoded += 1,
        }
    }

    /// The first system prompt, collapsed; later copies (an archive's and
    /// the current root's) repeat it.
    fn push_system(&mut self, index: usize, value: &Value) {
        if self.system_prompt.is_some() {
            return;
        }
        let text = joined_text(value);
        if text.trim().is_empty() {
            return;
        }
        let mut message = build_provider_message(
            PROVIDER,
            format!("{}-{index}", self.session_id),
            self.session_id,
            ms_to_iso(self.start_ms),
            "system",
            Some("system"),
            Some(json!([{ "type": "text", "text": text }])),
            None,
        );
        message.subtype = Some("system_prompt".to_string());
        message.level = Some("info".to_string());
        self.system_prompt = Some(message);
    }

    fn push_user(&mut self, index: usize, value: &Value) {
        let options = cursor_options(value);
        let mut at_ms = options
            .and_then(|o| o.get("requestId"))
            .and_then(Value::as_str)
            .and_then(|id| self.timing.requests.get(id).copied());

        if options
            .and_then(|o| o.get("isSummary"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            let summary = joined_text(value);
            let message = self.emit(index, "system", Value::String(summary), None, at_ms);
            message.subtype = Some("compact_boundary".to_string());
            return;
        }

        let mut blocks = Vec::new();
        for part in parts(value) {
            match part.get("type").and_then(Value::as_str).unwrap_or_default() {
                "text" => {
                    let text = text_of(&part).unwrap_or_default();
                    if at_ms.is_none() {
                        at_ms = prompt_timestamp_ms(text);
                    }
                    if let Some(query) = user_text(text) {
                        blocks.push(json!({ "type": "text", "text": query }));
                    }
                }
                "image" => match image_block(&part) {
                    Some(block) => blocks.push(block),
                    None => self.undecoded += 1,
                },
                "file" => blocks.push(file_block(&part)),
                _ => self.undecoded += 1,
            }
        }
        if blocks.is_empty() {
            // Injected context (<user_info>, <system_reminder>, ...) only;
            // its time still moves the clock.
            self.advance(at_ms);
            return;
        }
        self.emit(index, "user", Value::Array(blocks), None, at_ms);
    }

    fn push_assistant(&mut self, index: usize, value: &Value) {
        let mut model = cursor_options(value)
            .and_then(|o| o.get("modelName"))
            .and_then(Value::as_str)
            .map(str::to_string);
        let mut blocks = Vec::new();
        let mut at_ms: Option<u64> = None;
        for part in parts(value) {
            match part.get("type").and_then(Value::as_str).unwrap_or_default() {
                "text" => {
                    let text = text_of(&part).unwrap_or_default();
                    if !text.trim().is_empty() {
                        blocks.push(json!({ "type": "text", "text": text }));
                    }
                }
                "reasoning" | "thinking" => {
                    if model.is_none() {
                        model = cursor_options(&part)
                            .and_then(|o| o.get("modelName"))
                            .and_then(Value::as_str)
                            .map(str::to_string);
                    }
                    let text = text_of(&part).unwrap_or_default();
                    if !text.trim().is_empty() {
                        blocks
                            .push(json!({ "type": "thinking", "thinking": text, "signature": "" }));
                    }
                }
                // Provider-encrypted reasoning: nothing readable was stored.
                "redacted-reasoning" => {}
                "tool-call" => {
                    let id = part
                        .get("toolCallId")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    if let Some((Some(start), _)) = self.timing.tools.get(id) {
                        at_ms = Some(at_ms.map_or(*start, |at| at.min(*start)));
                    }
                    blocks.push(json!({
                        "type": "tool_use",
                        "id": id,
                        "name": part.get("toolName").and_then(Value::as_str).unwrap_or("tool"),
                        "input": tool_input(part.get("args").or_else(|| part.get("input"))),
                    }));
                }
                "image" => match image_block(&part) {
                    Some(block) => blocks.push(block),
                    None => self.undecoded += 1,
                },
                "file" => blocks.push(file_block(&part)),
                _ => self.undecoded += 1,
            }
        }
        if blocks.is_empty() {
            return;
        }
        self.emit(index, "assistant", Value::Array(blocks), model, at_ms);
    }

    /// Tool results go to the user lane (Claude convention) so the renderer
    /// pairs them with the assistant's `tool_use`.
    fn push_tool(&mut self, index: usize, value: &Value) {
        let message_error = cursor_options(value)
            .and_then(|o| o.get("highLevelToolCallResult"))
            .and_then(|r| r.get("isError"))
            .and_then(Value::as_bool);
        let mut blocks = Vec::new();
        let mut at_ms: Option<u64> = None;
        for part in parts(value) {
            if part.get("type").and_then(Value::as_str) != Some("tool-result") {
                self.undecoded += 1;
                continue;
            }
            let id = part
                .get("toolCallId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if let Some((start, end)) = self.timing.tools.get(id) {
                if let Some(ms) = end.or(*start) {
                    at_ms = Some(at_ms.map_or(ms, |at| at.max(ms)));
                }
            }
            let is_error = part
                .get("isError")
                .and_then(Value::as_bool)
                .or(message_error)
                .unwrap_or(false);
            blocks.push(json!({
                "type": "tool_result",
                "tool_use_id": id,
                "content": tool_result_text(&part),
                "is_error": is_error,
            }));
        }
        if blocks.is_empty() {
            return;
        }
        self.emit(index, "user", Value::Array(blocks), None, at_ms);
    }
}

/// The user's own words in a user-message text part: the `<user_query>`
/// bodies when present; `None` for injected context (a part that opens
/// with a tag and has no query); plain text as is.
fn user_text(text: &str) -> Option<String> {
    const OPEN: &str = "<user_query>";
    const CLOSE: &str = "</user_query>";
    if text.contains(OPEN) {
        let mut queries = Vec::new();
        let mut rest = text;
        while let Some(start) = rest.find(OPEN) {
            let after = &rest[start + OPEN.len()..];
            let end = after.find(CLOSE).unwrap_or(after.len());
            let query = after[..end].trim();
            if !query.is_empty() {
                queries.push(query);
            }
            rest = after.get(end + CLOSE.len()..).unwrap_or_default();
        }
        return (!queries.is_empty()).then(|| queries.join("\n\n"));
    }
    let trimmed = text.trim();
    (!trimmed.is_empty() && !trimmed.starts_with('<')).then(|| trimmed.to_string())
}

/// The `<timestamp>` Cursor injects before a prompt, e.g.
/// `Monday, Sep 28, 2026, 5:23 PM (UTC+8)`, as ms since the epoch.
fn prompt_timestamp_ms(text: &str) -> Option<u64> {
    let start = text.find("<timestamp>")? + "<timestamp>".len();
    let end = start + text[start..].find("</timestamp>")?;
    let raw = text[start..end].trim();
    let (local, zone) = raw.rsplit_once(" (")?;
    let zone = zone.strip_suffix(')')?.strip_prefix("UTC")?;
    let offset_secs = if zone.is_empty() {
        0
    } else {
        let sign = if zone.starts_with('-') { -1 } else { 1 };
        let digits = zone.trim_start_matches(['+', '-']);
        let (hours, minutes) = digits.split_once(':').unwrap_or((digits, "0"));
        sign * (hours.parse::<i32>().ok()? * 3600 + minutes.parse::<i32>().ok()? * 60)
    };
    let offset = chrono::FixedOffset::east_opt(offset_secs)?;
    let naive =
        chrono::NaiveDateTime::parse_from_str(local.trim(), "%A, %b %d, %Y, %I:%M %p").ok()?;
    let at = naive.and_local_timezone(offset).single()?;
    u64::try_from(at.timestamp_millis()).ok()
}

/// Tool arguments: an object as is; a JSON string parsed, else kept.
fn tool_input(args: Option<&Value>) -> Value {
    match args {
        Some(Value::String(s)) if s.trim().is_empty() => json!({}),
        Some(Value::String(s)) => serde_json::from_str(s).unwrap_or_else(|_| json!({ "input": s })),
        Some(Value::Null) | None => json!({}),
        Some(other) => other.clone(),
    }
}

/// The model-visible tool output: `result` text, else the
/// `experimental_content` texts, else `result` as JSON.
fn tool_result_text(part: &Value) -> String {
    if let Some(text) = part.get("result").and_then(Value::as_str) {
        return text.to_string();
    }
    let texts: Vec<&str> = part
        .get("experimental_content")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(text_of).collect())
        .unwrap_or_default();
    if !texts.is_empty() {
        return texts.join("\n");
    }
    match part.get("result") {
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

/// An `image` part (`image` as `{__type:"Uint8Array", hex}` or a base64 /
/// data URL string) as a viewer image block.
fn image_block(part: &Value) -> Option<Value> {
    let media_type = part
        .get("mimeType")
        .or_else(|| part.get("mediaType"))
        .and_then(Value::as_str)
        .unwrap_or("image/png");
    let data = match part.get("image")? {
        Value::Object(bytes) => {
            let hex = bytes.get("hex").and_then(Value::as_str)?;
            base64::engine::general_purpose::STANDARD.encode(decode_hex(hex)?)
        }
        Value::String(s) if s.starts_with("data:") => {
            return Some(json!({ "type": "image", "source": { "type": "url", "url": s } }));
        }
        Value::String(s) if !s.is_empty() => s.clone(),
        _ => return None,
    };
    Some(json!({
        "type": "image",
        "source": { "type": "base64", "media_type": media_type, "data": data },
    }))
}

/// A `file` attachment, named (its bytes are not shown).
fn file_block(part: &Value) -> Value {
    let name = part
        .get("filename")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or("file");
    json!({ "type": "text", "text": format!("[Attached file: {name}]") })
}

// ============================================================================
// Projects and sessions
// ============================================================================

/// One listed session's aggregates.
struct SessionSummary {
    dir: SessionDir,
    conversation: Conversation,
    last_modified_ms: u64,
}

impl SessionSummary {
    fn visible_count(&self) -> usize {
        self.conversation.messages.len()
    }

    fn first_ms(&self) -> Option<String> {
        self.conversation
            .messages
            .first()
            .map(|m| m.timestamp.clone())
    }

    fn last_ms(&self) -> Option<String> {
        self.conversation
            .messages
            .last()
            .map(|m| m.timestamp.clone())
    }
}

/// Read one session's store; `None` (logged) when it cannot be read, and
/// for a store with no conversation.
fn summarize_session(dir: SessionDir) -> Option<SessionSummary> {
    let conversation =
        match open_db(&dir.db).and_then(|conn| read_conversation(&conn, &dir.id, &dir.db)) {
            Ok(conversation) => conversation,
            Err(e) => {
                log::warn!("Cursor ACP session '{}' skipped: {e}", dir.id);
                return None;
            }
        };
    if conversation.messages.is_empty() {
        return None;
    }
    let last_modified_ms = store_mtime_ms(&dir.db).unwrap_or(0);
    Some(SessionSummary {
        dir,
        conversation,
        last_modified_ms,
    })
}

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

fn first_user_text(messages: &[ClaudeMessage]) -> Option<String> {
    messages
        .iter()
        .filter(|m| m.message_type == "user")
        .filter_map(|m| m.content.as_ref()?.as_array())
        .flatten()
        .find(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .and_then(text_of)
        .map(str::to_string)
}

fn has_block(messages: &[ClaudeMessage], predicate: impl Fn(&Value) -> bool) -> bool {
    messages
        .iter()
        .filter_map(|m| m.content.as_ref()?.as_array())
        .flatten()
        .any(predicate)
}

fn to_session(summary: SessionSummary) -> ClaudeSession {
    let cwd = summary.dir.cwd.as_deref();
    let path = session_path(cwd, &summary.dir.id);
    let messages = &summary.conversation.messages;
    let last = summary
        .last_ms()
        .unwrap_or_else(|| ms_to_iso(summary.last_modified_ms));
    let title = summary
        .dir
        .title
        .clone()
        .or_else(|| summary.conversation.name.clone())
        .or_else(|| first_user_text(messages));
    ClaudeSession {
        session_id: path.clone(),
        actual_session_id: summary.dir.id.clone(),
        file_path: path,
        project_name: project_display_name(cwd),
        message_count: summary.visible_count(),
        first_message_time: summary.first_ms().unwrap_or_else(|| last.clone()),
        last_message_time: last,
        last_modified: ms_to_iso(summary.last_modified_ms),
        has_tool_use: has_block(messages, |b| {
            b.get("type").and_then(Value::as_str) == Some("tool_use")
        }),
        has_errors: has_block(messages, |b| {
            b.get("is_error").and_then(Value::as_bool) == Some(true)
        }),
        summary: title.map(|t| summarize(&t)),
        is_renamed: false,
        provider: Some(PROVIDER.to_string()),
        storage_type: Some("sqlite".to_string()),
        entrypoint: None,
    }
}

/// Scan every session store, grouped into projects by `cwd`. A store that
/// cannot be read is logged and skipped rather than hiding the others.
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    #[derive(Default)]
    struct Acc {
        sessions: usize,
        messages: usize,
        last_ms: u64,
    }
    let mut groups: BTreeMap<Option<String>, Acc> = BTreeMap::new();
    for summary in discover_sessions()
        .into_iter()
        .filter_map(summarize_session)
    {
        let acc = groups.entry(summary.dir.cwd.clone()).or_default();
        acc.sessions += 1;
        acc.messages += summary.visible_count();
        acc.last_ms = acc.last_ms.max(summary.last_modified_ms);
    }
    let mut projects: Vec<ClaudeProject> = groups
        .into_iter()
        .map(|(cwd, acc)| {
            let path = project_path(cwd.as_deref());
            ClaudeProject {
                name: project_display_name(cwd.as_deref()),
                // No folder: the bucket's own URI keeps it distinct when the
                // tree merges projects by folder.
                actual_path: cwd.clone().unwrap_or_else(|| path.clone()),
                path,
                session_count: acc.sessions,
                message_count: acc.messages,
                last_modified: ms_to_iso(acc.last_ms),
                git_info: None,
                provider: Some(PROVIDER.to_string()),
                storage_type: Some("sqlite".to_string()),
                custom_directory_label: None,
            }
        })
        .collect();
    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

/// The sessions of one project (one `cwd`), newest first.
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let cwd = parse_project_path(project_path)?;
    let mut sessions: Vec<ClaudeSession> = discover_sessions()
        .into_iter()
        .filter(|dir| dir.cwd == cwd)
        .filter_map(summarize_session)
        .map(to_session)
        .collect();
    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

/// All messages of one session, in conversation order. A store that cannot
/// be read is an error.
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let (_, id) = parse_session_path(session_path)?;
    let dir = find_session(&id).ok_or_else(|| format!("Cursor ACP session not found: {id}"))?;
    let conn = open_db(&dir.db)?;
    Ok(read_conversation(&conn, &dir.id, &dir.db)?.messages)
}

/// Case-insensitive search across every session, `limit`-capped.
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    if query.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();
    for summary in discover_sessions()
        .into_iter()
        .filter_map(summarize_session)
    {
        if results.len() >= limit {
            break;
        }
        let cwd = summary.dir.cwd.as_deref();
        let project = project_path(cwd);
        for mut message in summary.conversation.messages {
            if results.len() >= limit {
                break;
            }
            if message.subtype.as_deref() == Some(UNDECODED_SUBTYPE) {
                continue;
            }
            let matched = message
                .content
                .as_ref()
                .is_some_and(|c| search_json_value_case_insensitive(c, &query_lower));
            if matched {
                message.project_name = Some(project_display_name(cwd));
                message.project_path = Some(project.clone());
                results.push(message);
            }
        }
    }
    Ok(results)
}

#[cfg(test)]
pub(crate) mod tests {
    // Fixtures follow the documented store layout (Harness Notes "Transcript
    // format" for Cursor Agent 2026.10.12, the txcript and deja-vu notes in
    // the module docs) and the `meta.json` / `.tables` / `.schema` answers in
    // #576. Every value is a placeholder: no user's store is committed.

    use super::*;
    use serial_test::serial;
    use sha2::{Digest, Sha256};

    const START_MS: u64 = 1_790_587_439_336;
    const USER_MS: u64 = START_MS + 500;
    const TOOL_START_MS: u64 = USER_MS + 1_100;
    const TOOL_END_MS: u64 = USER_MS + 4_250;
    const SESSION_A: &str = "00000000-0000-4000-8000-00000000000a";
    const SESSION_B: &str = "00000000-0000-4000-8000-00000000000b";
    const SESSION_C: &str = "00000000-0000-4000-8000-00000000000c";
    const CWD_UNIX: &str = "/work/app";
    const CWD_WINDOWS: &str = "E:\\P4\\testgo";

    fn varint(mut value: u64, out: &mut Vec<u8>) {
        loop {
            let byte = (value & 0x7f) as u8;
            value >>= 7;
            if value == 0 {
                out.push(byte);
                return;
            }
            out.push(byte | 0x80);
        }
    }

    fn pb_bytes(number: u64, bytes: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        varint((number << 3) | 2, &mut out);
        varint(bytes.len() as u64, &mut out);
        out.extend_from_slice(bytes);
        out
    }

    fn pb_uint(number: u64, value: u64) -> Vec<u8> {
        let mut out = Vec::new();
        varint(number << 3, &mut out);
        varint(value, &mut out);
        out
    }

    fn raw_id(id: &str) -> Vec<u8> {
        decode_hex(id).expect("blob id is hex")
    }

    /// A writable handle on a fixture `store.db` (the provider only ever
    /// opens it read-only).
    struct Store {
        conn: Connection,
    }

    impl Store {
        /// Store `data` under its SHA-256, as Cursor does.
        fn put(&self, data: &[u8]) -> String {
            let id = blob_ref(&Sha256::digest(data)).unwrap();
            self.conn
                .execute(
                    "INSERT OR IGNORE INTO blobs (id, data) VALUES (?1, ?2)",
                    rusqlite::params![id, data],
                )
                .unwrap();
            id
        }

        fn json(&self, value: &Value) -> String {
            self.put(value.to_string().as_bytes())
        }

        /// A `ConversationStateStructure` root: messages (1), turns (8),
        /// archives (13), conversation start (26).
        fn root(&self, messages: &[&str], turns: &[&str], archives: &[&str]) -> String {
            let mut data = Vec::new();
            for id in messages {
                data.extend(pb_bytes(1, &raw_id(id)));
            }
            for id in turns {
                data.extend(pb_bytes(8, &raw_id(id)));
            }
            for id in archives {
                data.extend(pb_bytes(13, &raw_id(id)));
            }
            data.extend(pb_uint(26, START_MS));
            self.put(&data)
        }

        /// The `meta` row `'0'`: hex-encoded JSON, as observed.
        fn point_meta(&self, root: &str, name: &str) {
            let meta = json!({
                "agentId": SESSION_A,
                "latestRootBlobId": root,
                "name": name,
                "mode": "default",
                "isRunEverything": false,
                "createdAt": START_MS,
            });
            let hex = meta.to_string().bytes().fold(String::new(), |mut hex, b| {
                use std::fmt::Write as _;
                let _ = write!(hex, "{b:02x}");
                hex
            });
            self.conn
                .execute(
                    "INSERT OR REPLACE INTO meta (key, value) VALUES ('0', ?1)",
                    [hex],
                )
                .unwrap();
        }
    }

    fn session_folder(home: &Path, id: &str) -> PathBuf {
        home.join(".cursor").join(SESSIONS_DIR).join(id)
    }

    /// `acp-sessions/<id>/` with `meta.json` and an empty `store.db`.
    fn new_session(home: &Path, id: &str, cwd: Option<&str>, title: Option<&str>) -> Store {
        let dir = session_folder(home, id);
        fs::create_dir_all(&dir).unwrap();
        let mut meta = json!({ "schemaVersion": 1 });
        if let Some(cwd) = cwd {
            meta["cwd"] = json!(cwd);
        }
        if let Some(title) = title {
            meta["title"] = json!(title);
        }
        fs::write(dir.join(META_FILE), meta.to_string()).unwrap();
        let conn = Connection::open(dir.join(DB_FILE)).unwrap();
        conn.execute_batch(
            "CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB);
             CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);",
        )
        .unwrap();
        Store { conn }
    }

    /// One turn: injected context, a prompt, reasoning + text + a `Glob`
    /// call, its result and the answer, plus the turn and tool step that
    /// date them. Blobs are inserted last-first, so row order disagrees with
    /// the root's.
    fn seed_tool_session(store: &Store, query: &str) -> String {
        let system = json!({ "role": "system", "content": "You are an AI coding assistant." });
        let context = json!({
            "role": "user",
            "content": "<user_info>\nOS Version: example\n</user_info>",
            "providerOptions": { "cursor": { "requestContextCompleteness": { "env": true } } },
        });
        let prompt = json!({
            "role": "user",
            "content": [
                { "type": "text", "text": "<system_reminder>\nAsk mode is active.\n</system_reminder>" },
                { "type": "text", "text": format!(
                    "<timestamp>Monday, Sep 28, 2026, 5:23 PM (UTC+8)</timestamp>\n<user_query>\n{query}\n</user_query>"
                ) },
            ],
            "providerOptions": { "cursor": { "requestId": "req-1" } },
        });
        let call = json!({
            "role": "assistant",
            "id": "1",
            "content": [
                { "type": "reasoning", "text": "I should list the files.",
                  "providerOptions": { "cursor": { "modelName": "example-model" } } },
                { "type": "text", "text": "Listing the files." },
                { "type": "tool-call", "toolCallId": "tool_1", "toolName": "Glob",
                  "args": { "glob_pattern": "*" } },
            ],
        });
        let result = json!({
            "role": "tool",
            "id": "tool_1",
            "content": [{
                "type": "tool-result", "toolCallId": "tool_1", "toolName": "Glob",
                "result": "a.txt\nb.txt",
                "experimental_content": [{ "type": "text", "text": "a.txt\nb.txt" }],
            }],
            "providerOptions": { "cursor": { "highLevelToolCallResult": {
                "output": { "success": { "totalFiles": 2 } }, "isError": false,
            } } },
        });
        let answer = json!({
            "role": "assistant",
            "id": "2",
            "content": [{ "type": "text", "text": "There are two files." }],
        });
        let mut ids: Vec<String> = [&answer, &result, &call, &prompt, &context, &system]
            .iter()
            .map(|value| store.json(value))
            .collect();
        ids.reverse();

        let user_message = store.put(
            &[
                pb_bytes(1, query.as_bytes()),
                pb_bytes(2, b"msg-1"),
                pb_uint(25, USER_MS),
                pb_uint(26, USER_MS),
            ]
            .concat(),
        );
        let tool_call = [
            pb_bytes(57, b"tool_1"),
            pb_uint(59, TOOL_START_MS),
            pb_uint(60, TOOL_END_MS),
        ]
        .concat();
        let step = store.put(&pb_bytes(2, &tool_call));
        let turn = store.put(&pb_bytes(
            1,
            &[
                pb_bytes(1, &raw_id(&user_message)),
                pb_bytes(2, &raw_id(&step)),
                pb_bytes(3, b"req-1"),
            ]
            .concat(),
        ));
        let refs: Vec<&str> = ids.iter().map(String::as_str).collect();
        let root = store.root(&refs, &[&turn], &[]);
        store.point_meta(&root, "New Agent");
        root
    }

    fn session_uri(cwd: &str, id: &str) -> String {
        format!("cursor-acp://{cwd}#{id}")
    }

    /// A seeded session (see [`seed_tool_session`]) under `home`; returns its
    /// session path. For the `WebUI` handler tests.
    #[cfg(feature = "webui-server")]
    pub(crate) fn seed_session(home: &Path, id: &str, cwd: &str, query: &str) -> String {
        seed_tool_session(&new_session(home, id, Some(cwd), None), query);
        session_uri(cwd, id)
    }

    fn blocks(message: &ClaudeMessage) -> &Vec<Value> {
        message.content.as_ref().unwrap().as_array().unwrap()
    }

    #[test]
    #[serial]
    fn messages_follow_the_root_with_context_dropped_and_times_from_turns() {
        let home = crate::test_utils::SandboxHome::new();
        let store = new_session(home.path(), SESSION_A, Some(CWD_UNIX), None);
        seed_tool_session(&store, "List the files");

        let messages = load_messages(&session_uri(CWD_UNIX, SESSION_A)).unwrap();
        let kinds: Vec<(&str, Option<&str>)> = messages
            .iter()
            .map(|m| (m.message_type.as_str(), m.subtype.as_deref()))
            .collect();
        assert_eq!(
            kinds,
            [
                ("system", Some("system_prompt")),
                ("user", None),
                ("assistant", None),
                ("user", None),
                ("assistant", None),
            ]
        );
        // Ids are the root positions: the <user_info> context (1) is gone.
        let uuids: Vec<String> = messages.iter().map(|m| m.uuid.clone()).collect();
        assert_eq!(
            uuids,
            [0, 2, 3, 4, 5].map(|i| format!("{SESSION_A}-{i}")).to_vec()
        );
        assert!(messages
            .iter()
            .all(|m| m.provider.as_deref() == Some(PROVIDER)));

        assert_eq!(
            blocks(&messages[1]),
            &vec![json!({ "type": "text", "text": "List the files" })]
        );
        assert_eq!(
            blocks(&messages[2]),
            &vec![
                json!({ "type": "thinking", "thinking": "I should list the files.", "signature": "" }),
                json!({ "type": "text", "text": "Listing the files." }),
                json!({ "type": "tool_use", "id": "tool_1", "name": "Glob", "input": { "glob_pattern": "*" } }),
            ]
        );
        assert_eq!(messages[2].model.as_deref(), Some("example-model"));
        assert_eq!(
            blocks(&messages[3]),
            &vec![json!({
                "type": "tool_result", "tool_use_id": "tool_1",
                "content": "a.txt\nb.txt", "is_error": false,
            })]
        );

        let times: Vec<String> = messages.iter().map(|m| m.timestamp.clone()).collect();
        assert_eq!(
            times,
            [START_MS, USER_MS, TOOL_START_MS, TOOL_END_MS, TOOL_END_MS]
                .map(ms_to_iso)
                .to_vec()
        );
    }

    #[test]
    #[serial]
    fn sessions_group_by_cwd_with_titles_from_meta_json() {
        let home = crate::test_utils::SandboxHome::new();
        seed_tool_session(
            &new_session(home.path(), SESSION_A, Some(CWD_UNIX), Some("Analyze logs")),
            "first",
        );
        seed_tool_session(
            &new_session(home.path(), SESSION_B, Some(CWD_UNIX), None),
            "second prompt",
        );
        seed_tool_session(
            &new_session(
                home.path(),
                SESSION_C,
                Some(CWD_WINDOWS),
                Some("Project analysis"),
            ),
            "third",
        );
        // A chat that never got a conversation keeps only meta.json.
        let empty = session_folder(home.path(), "00000000-0000-4000-8000-0000000000ff");
        fs::create_dir_all(&empty).unwrap();
        fs::write(
            empty.join(META_FILE),
            r#"{"schemaVersion":1,"cwd":"/work/app"}"#,
        )
        .unwrap();

        let mut projects = scan_projects().unwrap();
        projects.sort_by(|a, b| a.name.cmp(&b.name));
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
                ("app", "cursor-acp:///work/app", CWD_UNIX, 2, 10),
                ("testgo", "cursor-acp://E:\\P4\\testgo", CWD_WINDOWS, 1, 5),
            ]
        );
        assert!(projects
            .iter()
            .all(|p| p.provider.as_deref() == Some(PROVIDER)));

        let mut sessions = load_sessions("cursor-acp:///work/app", false).unwrap();
        sessions.sort_by(|a, b| a.actual_session_id.cmp(&b.actual_session_id));
        let listed: Vec<(&str, &str, Option<&str>, bool)> = sessions
            .iter()
            .map(|s| {
                (
                    s.actual_session_id.as_str(),
                    s.file_path.as_str(),
                    s.summary.as_deref(),
                    s.has_tool_use,
                )
            })
            .collect();
        let path_a = session_uri(CWD_UNIX, SESSION_A);
        let path_b = session_uri(CWD_UNIX, SESSION_B);
        assert_eq!(
            listed,
            [
                (SESSION_A, path_a.as_str(), Some("Analyze logs"), true),
                // No title: the first prompt, unwrapped.
                (SESSION_B, path_b.as_str(), Some("second prompt"), true),
            ]
        );
        assert_eq!(sessions[0].message_count, 5);
        assert_eq!(sessions[0].first_message_time, ms_to_iso(START_MS));
        assert_eq!(sessions[0].last_message_time, ms_to_iso(TOOL_END_MS));
        assert_eq!(sessions[0].project_name, "app");

        assert_eq!(project_name("cursor-acp://E:\\P4\\testgo"), "testgo");
        assert_eq!(
            project_name_for_session(&session_uri(CWD_WINDOWS, SESSION_C)),
            "testgo"
        );
        assert_eq!(project_name("cursor-acp://"), DISPLAY_NAME);
    }

    #[test]
    #[serial]
    fn undecodable_entries_are_counted_in_a_note() {
        let home = crate::test_utils::SandboxHome::new();
        let store = new_session(home.path(), SESSION_A, Some(CWD_UNIX), None);
        let prompt = store.json(&json!({
            "role": "user",
            "content": [{ "type": "text", "text": "<user_query>\nhello\n</user_query>" }],
        }));
        // A binary record (a step-like protobuf), a blob that is not in the
        // table, an unknown role and an assistant part of an unknown type.
        let binary = store.put(&pb_bytes(1, &pb_bytes(1, b"Done.")));
        let missing = blob_ref(&Sha256::digest(b"not stored")).unwrap();
        let unknown_role = store.json(&json!({ "role": "developer", "content": "x" }));
        let answer = store.json(&json!({
            "role": "assistant",
            "content": [
                { "type": "text", "text": "hi" },
                { "type": "mystery", "data": "?" },
            ],
        }));
        let root = store.root(
            &[&prompt, &binary, &missing, &unknown_role, &answer],
            &[],
            &[],
        );
        store.point_meta(&root, "New Agent");

        let messages = load_messages(&session_uri(CWD_UNIX, SESSION_A)).unwrap();
        assert_eq!(messages.len(), 3);
        let note = &messages[0];
        assert_eq!(note.message_type, "system");
        assert_eq!(note.subtype.as_deref(), Some(UNDECODED_SUBTYPE));
        assert_eq!(note.level.as_deref(), Some("warning"));
        assert_eq!(
            note.content,
            Some(json!(
                "4 items in this session's store could not be decoded and are not shown."
            ))
        );
        assert_eq!(note.timestamp, ms_to_iso(START_MS));
        assert_eq!(
            blocks(&messages[1]),
            &vec![json!({ "type": "text", "text": "hello" })]
        );
        assert_eq!(
            blocks(&messages[2]),
            &vec![json!({ "type": "text", "text": "hi" })]
        );

        // An undecodable root is one item, and the note is all there is.
        let store = new_session(home.path(), SESSION_B, Some(CWD_UNIX), None);
        let bad_root = store.put(b"\x0a\xff");
        store.point_meta(&bad_root, "New Agent");
        let messages = load_messages(&session_uri(CWD_UNIX, SESSION_B)).unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(
            messages[0].content,
            Some(json!(
                "1 item in this session's store could not be decoded and is not shown."
            ))
        );
    }

    #[test]
    #[serial]
    fn a_fully_decoded_session_has_no_note() {
        let home = crate::test_utils::SandboxHome::new();
        seed_tool_session(
            &new_session(home.path(), SESSION_A, Some(CWD_UNIX), None),
            "q",
        );
        let messages = load_messages(&session_uri(CWD_UNIX, SESSION_A)).unwrap();
        assert!(messages
            .iter()
            .all(|m| m.subtype.as_deref() != Some(UNDECODED_SUBTYPE)));
    }

    #[test]
    #[serial]
    fn compaction_archives_come_first_and_the_summary_marks_the_boundary() {
        let home = crate::test_utils::SandboxHome::new();
        let store = new_session(home.path(), SESSION_A, Some(CWD_UNIX), None);
        let system = store.json(&json!({ "role": "system", "content": "prompt" }));
        let old_user = store.json(&json!({
            "role": "user", "content": [{ "type": "text", "text": "<user_query>old</user_query>" }],
        }));
        let old_answer = store.json(&json!({
            "role": "assistant", "content": [{ "type": "text", "text": "old answer" }],
        }));
        let summary = store.json(&json!({
            "role": "user",
            "content": [{ "type": "text", "text": "Summary of earlier work" }],
            "providerOptions": { "cursor": { "isSummary": true } },
        }));
        let new_user = store.json(&json!({
            "role": "user", "content": [{ "type": "text", "text": "<user_query>new</user_query>" }],
        }));
        // ConversationSummaryArchive: summarized_messages (1), summary (2).
        let archive = store.put(
            &[
                pb_bytes(1, &raw_id(&old_user)),
                pb_bytes(1, &raw_id(&old_answer)),
                pb_bytes(2, b"Summary of earlier work"),
            ]
            .concat(),
        );
        let root = store.root(&[&system, &summary, &new_user], &[], &[&archive]);
        store.point_meta(&root, "Compacted chat");

        let messages = load_messages(&session_uri(CWD_UNIX, SESSION_A)).unwrap();
        let shown: Vec<(&str, Option<&str>, String)> = messages
            .iter()
            .map(|m| {
                let text = match &m.content {
                    Some(Value::String(s)) => s.clone(),
                    Some(Value::Array(b)) => b[0]["text"].as_str().unwrap_or_default().to_string(),
                    _ => String::new(),
                };
                (m.message_type.as_str(), m.subtype.as_deref(), text)
            })
            .collect();
        assert_eq!(
            shown,
            [
                ("system", Some("system_prompt"), "prompt".to_string()),
                ("user", None, "old".to_string()),
                ("assistant", None, "old answer".to_string()),
                (
                    "system",
                    Some("compact_boundary"),
                    "Summary of earlier work".to_string()
                ),
                ("user", None, "new".to_string()),
            ]
        );

        // The meta-table name titles a session meta.json leaves untitled.
        let sessions = load_sessions("cursor-acp:///work/app", false).unwrap();
        assert_eq!(sessions[0].summary.as_deref(), Some("Compacted chat"));
    }

    #[test]
    #[serial]
    fn prompt_timestamp_dates_a_turn_without_turn_records() {
        assert_eq!(
            prompt_timestamp_ms(
                "<timestamp>Monday, Sep 28, 2026, 5:23 PM (UTC+8)</timestamp>\n<user_query>x</user_query>"
            ),
            Some(1_790_587_380_000)
        );
        assert_eq!(
            prompt_timestamp_ms("<timestamp>Sunday, Jul 26, 2026, 1:06 PM (UTC-05:30)</timestamp>"),
            Some(1_785_090_960_000)
        );
        assert_eq!(prompt_timestamp_ms("<timestamp>soon</timestamp>"), None);
        assert_eq!(prompt_timestamp_ms("no tag"), None);

        let home = crate::test_utils::SandboxHome::new();
        let store = new_session(home.path(), SESSION_A, Some(CWD_UNIX), None);
        let prompt = store.json(&json!({
            "role": "user",
            "content": [{ "type": "text", "text":
                "<timestamp>Monday, Sep 28, 2026, 5:23 PM (UTC+8)</timestamp>\n<user_query>\nhi\n</user_query>" }],
        }));
        let root = store.root(&[&prompt], &[], &[]);
        store.point_meta(&root, "New Agent");
        let messages = load_messages(&session_uri(CWD_UNIX, SESSION_A)).unwrap();
        // START_MS is later than 5:23 PM, and the clock never runs back.
        assert_eq!(
            messages[0].timestamp,
            ms_to_iso(START_MS.max(1_790_587_380_000))
        );
    }

    #[test]
    fn user_text_unwraps_queries_and_drops_context() {
        assert_eq!(
            user_text("<timestamp>t</timestamp>\n<user_query>\n a \n</user_query>\n<user_query>b</user_query>"),
            Some("a\n\nb".to_string())
        );
        assert_eq!(
            user_text("<system_reminder>\nAsk mode\n</system_reminder>"),
            None
        );
        assert_eq!(
            user_text("  plain prompt "),
            Some("plain prompt".to_string())
        );
        assert_eq!(user_text("<user_query>   </user_query>"), None);
    }

    #[test]
    #[serial]
    fn errors_images_and_files_are_kept() {
        let home = crate::test_utils::SandboxHome::new();
        let store = new_session(home.path(), SESSION_A, Some(CWD_UNIX), None);
        let prompt = store.json(&json!({
            "role": "user",
            "content": [
                { "type": "text", "text": "<user_query>see image</user_query>" },
                { "type": "image", "image": { "__type": "Uint8Array", "hex": "89504e47" }, "mimeType": "image/png" },
                { "type": "file", "filename": "example.pdf", "mimeType": "application/pdf",
                  "data": { "__type": "Uint8Array", "hex": "25504446" } },
            ],
        }));
        let call = store.json(&json!({
            "role": "assistant",
            "content": [
                { "type": "redacted-reasoning", "data": "ZXhhbXBsZQ==" },
                { "type": "tool-call", "toolCallId": "tool_2", "toolName": "Shell", "args": "{\"command\":\"false\"}" },
            ],
        }));
        let result = store.json(&json!({
            "role": "tool",
            "content": [{ "type": "tool-result", "toolCallId": "tool_2", "toolName": "Shell",
                          "result": { "exitCode": 1 } }],
            "providerOptions": { "cursor": { "highLevelToolCallResult": { "isError": true } } },
        }));
        let root = store.root(&[&prompt, &call, &result], &[], &[]);
        store.point_meta(&root, "New Agent");

        let messages = load_messages(&session_uri(CWD_UNIX, SESSION_A)).unwrap();
        assert_eq!(
            blocks(&messages[0]),
            &vec![
                json!({ "type": "text", "text": "see image" }),
                json!({ "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "iVBORw==" } }),
                json!({ "type": "text", "text": "[Attached file: example.pdf]" }),
            ]
        );
        // Redacted reasoning is not shown and not counted: nothing readable
        // was stored.
        assert_eq!(
            blocks(&messages[1]),
            &vec![
                json!({ "type": "tool_use", "id": "tool_2", "name": "Shell", "input": { "command": "false" } })
            ]
        );
        assert_eq!(
            blocks(&messages[2]),
            &vec![
                json!({ "type": "tool_result", "tool_use_id": "tool_2", "content": "{\"exitCode\":1}", "is_error": true })
            ]
        );
        let sessions = load_sessions("cursor-acp:///work/app", false).unwrap();
        assert!(sessions[0].has_errors);
    }

    #[test]
    #[serial]
    fn stores_without_a_conversation_are_not_listed() {
        let home = crate::test_utils::SandboxHome::new();
        // No checkpoint yet: `latestRootBlobId` is empty.
        new_session(home.path(), SESSION_A, Some(CWD_UNIX), None).point_meta("", "New Agent");
        // No meta row at all.
        new_session(home.path(), SESSION_B, Some(CWD_UNIX), None);
        assert!(scan_projects().unwrap().is_empty());
        assert!(load_messages(&session_uri(CWD_UNIX, SESSION_A))
            .unwrap()
            .is_empty());
        assert!(detect().is_some_and(|info| info.is_available));
    }

    #[test]
    #[serial]
    fn an_unreadable_store_is_skipped_by_the_scan_and_an_error_when_loaded() {
        let home = crate::test_utils::SandboxHome::new();
        seed_tool_session(
            &new_session(home.path(), SESSION_A, Some(CWD_UNIX), None),
            "ok",
        );
        let broken = session_folder(home.path(), SESSION_B);
        fs::create_dir_all(&broken).unwrap();
        fs::write(
            broken.join(META_FILE),
            r#"{"schemaVersion":1,"cwd":"/work/app"}"#,
        )
        .unwrap();
        fs::write(broken.join(DB_FILE), b"this is not a database, just bytes").unwrap();

        let projects = scan_projects().unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].session_count, 1);
        let error = load_messages(&session_uri(CWD_UNIX, SESSION_B)).unwrap_err();
        assert!(error.contains("Cursor ACP"), "{error}");
    }

    #[test]
    #[serial]
    fn session_paths_only_name_a_folder_under_the_root() {
        let home = crate::test_utils::SandboxHome::new();
        seed_tool_session(
            &new_session(home.path(), SESSION_A, Some(CWD_UNIX), None),
            "q",
        );
        for bad in [
            "cursor-acp:///work/app#../escape",
            "cursor-acp:///work/app#..",
            "cursor-acp:///work/app#a/b",
            "cursor-acp:///work/app#a\\b",
            "cursor-acp:///work/app",
            "/work/app#00000000",
        ] {
            assert!(load_messages(bad).is_err(), "{bad}");
        }
        assert!(load_messages(&session_uri(
            CWD_UNIX,
            "00000000-0000-4000-8000-000000000999"
        ))
        .is_err());
        assert!(load_sessions("/not/a/uri", false).is_err());
    }

    #[cfg(unix)]
    #[test]
    #[serial]
    fn symlinked_sessions_and_stores_are_not_read() {
        let home = crate::test_utils::SandboxHome::new();
        let outside = tempfile::TempDir::new().unwrap();
        let elsewhere = outside.path().join(SESSION_A);
        fs::create_dir_all(&elsewhere).unwrap();
        let conn = Connection::open(elsewhere.join(DB_FILE)).unwrap();
        conn.execute_batch(
            "CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB);
             CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);",
        )
        .unwrap();
        seed_tool_session(&Store { conn }, "outside");
        let root = home.path().join(".cursor").join(SESSIONS_DIR);
        fs::create_dir_all(&root).unwrap();
        std::os::unix::fs::symlink(&elsewhere, root.join(SESSION_A)).unwrap();
        let linked_db = root.join(SESSION_B);
        fs::create_dir_all(&linked_db).unwrap();
        std::os::unix::fs::symlink(elsewhere.join(DB_FILE), linked_db.join(DB_FILE)).unwrap();

        assert!(scan_projects().unwrap().is_empty());
        assert!(load_messages(&session_uri(CWD_UNIX, SESSION_A)).is_err());
        assert!(load_messages(&session_uri(CWD_UNIX, SESSION_B)).is_err());
    }

    #[test]
    #[serial]
    fn search_finds_text_and_names_the_project() {
        let home = crate::test_utils::SandboxHome::new();
        seed_tool_session(
            &new_session(home.path(), SESSION_A, Some(CWD_WINDOWS), None),
            "find NEEDLE here",
        );
        let results = search("needle", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].uuid, format!("{SESSION_A}-2"));
        assert_eq!(results[0].project_name.as_deref(), Some("testgo"));
        assert_eq!(
            results[0].project_path.as_deref(),
            Some("cursor-acp://E:\\P4\\testgo")
        );
        assert!(search("needle", 0).unwrap().is_empty());
        assert!(search("absent-term", 10).unwrap().is_empty());
    }

    #[test]
    #[serial]
    fn a_plain_json_meta_value_is_read_too() {
        let home = crate::test_utils::SandboxHome::new();
        let store = new_session(home.path(), SESSION_A, None, None);
        let prompt = store.json(&json!({ "role": "user", "content": "plain words" }));
        let root = store.root(&[&prompt], &[], &[]);
        store
            .conn
            .execute(
                "INSERT INTO meta (key, value) VALUES ('0', ?1)",
                [json!({ "latestRootBlobId": root, "name": "Plain" }).to_string()],
            )
            .unwrap();
        let projects = scan_projects().unwrap();
        assert_eq!(projects[0].path, "cursor-acp://");
        assert_eq!(projects[0].name, DISPLAY_NAME);
        let sessions = load_sessions("cursor-acp://", false).unwrap();
        assert_eq!(sessions[0].summary.as_deref(), Some("Plain"));
        let messages = load_messages(&sessions[0].file_path).unwrap();
        assert_eq!(
            blocks(&messages[0]),
            &vec![json!({ "type": "text", "text": "plain words" })]
        );
    }

    #[test]
    fn malformed_protobuf_is_rejected() {
        assert!(wire::fields(b"\x0a\x05abc").is_none(), "truncated bytes");
        assert!(wire::fields(b"\x0b").is_none(), "group start");
        assert!(wire::fields(b"\x08").is_none(), "truncated varint");
        assert!(wire::fields(b"").is_some_and(|f| f.is_empty()));
        assert!(decode_root(b"\x0a\x02ab").is_some_and(|r| r.messages == vec![None]));
    }
}
