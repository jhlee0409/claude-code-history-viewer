//! Antigravity desktop trajectory summaries, read from the editor's own
//! `state.vscdb`.
//!
//! The desktop app's conversation transcripts (`~/.gemini/antigravity/
//! conversations/<uuid>.pb`) are encrypted — measured byte entropy on a real
//! store is 8.00/8.00 with no container magic — so the rpc-cache layout can
//! only ever yield token counters, which is why sessions rendered as a list of
//! UUIDs with an empty conversation (#564).
//!
//! Antigravity also keeps a plaintext, if lossy, mirror of the same sessions in
//! its VS Code-style global storage under the
//! `antigravityUnifiedStateSync.trajectorySummaries` key: base64-wrapped
//! protobuf carrying the human title, the total step count, created/updated
//! timestamps, the workspace folders and git remote, and a snapshot of the most
//! recent steps (including the last `notify_user` message the agent sent). That
//! is what this module recovers.
//!
//! The schema is reverse-engineered — Antigravity publishes no `.proto` — so
//! every field is read defensively by tag number and anything unrecognised is
//! skipped rather than treated as an error. Only the *latest* steps are present
//! in this store, so the full transcript still cannot be reconstructed.

use base64::Engine;
use rusqlite::{Connection, OpenFlags};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// `ItemTable` key holding the base64 protobuf trajectory summary list.
const SUMMARIES_KEY: &str = "antigravityUnifiedStateSync.trajectorySummaries";

// Reverse-engineered field tags. Named so the parse below reads as a schema.
const F_ENTRY: u32 = 1;
const F_ENTRY_ID: u32 = 1;
const F_ENTRY_PAYLOAD: u32 = 2;
const F_PAYLOAD_B64: u32 = 1;
const F_TITLE: u32 = 1;
const F_STEP_COUNT: u32 = 2;
const F_CREATED_AT: u32 = 3;
const F_UPDATED_AT: u32 = 7;
const F_UPDATED_AT_ALT: u32 = 10;
const F_WORKSPACE: u32 = 9;
const F_WORKSPACE_FOLDER: u32 = 1;
const F_WORKSPACE_GIT: u32 = 3;
const F_GIT_SLUG: u32 = 1;
const F_STEP_WRAPPER_INNER: u32 = 1;
const F_STEP_INDEX: u32 = 1;
const F_STEP_COMMON: u32 = 5;
const F_STEP_ACTION: u32 = 4;
const F_ACTION_TOOL: u32 = 2;
const F_ACTION_ARGS: u32 = 3;
const F_TS_SECONDS: u32 = 1;
const F_TS_NANOS: u32 = 2;

/// One session as Antigravity's state sync describes it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TrajectorySummary {
    /// Human title the editor shows, e.g. `Fixing Step Sync Interval`.
    pub title: String,
    /// Total steps in the trajectory — the store keeps the count even though
    /// it only snapshots the last few steps themselves.
    pub step_count: u64,
    pub created_ms: u64,
    pub updated_ms: u64,
    /// First workspace folder URI (`file:///...`).
    pub workspace: Option<String>,
    /// Git remote slug, e.g. `owner/repo`.
    pub repo: Option<String>,
    /// Text of the most recent `notify_user` message the agent sent.
    pub last_message: Option<String>,
    /// `<TaskName> — <TaskStatus>` from the most recent task boundary.
    pub last_task: Option<String>,
}

// ============================================================================
// Minimal protobuf reader
// ============================================================================

/// A length-delimited or varint field, the only two wire types this schema
/// uses for anything we read.
enum Value<'a> {
    Varint(u64),
    Bytes(&'a [u8]),
}

/// Splits a protobuf message into `(tag, value)` pairs.
///
/// Stops at the first malformed byte instead of erroring: this is
/// reverse-engineered data, and a partially readable summary is still worth
/// showing. Fixed-width fields are skipped, groups (deprecated wire types 3
/// and 4) end the scan.
fn read_fields(buf: &[u8]) -> Vec<(u32, Value<'_>)> {
    let mut out = Vec::new();
    let mut i = 0usize;

    while i < buf.len() {
        let Some((key, next)) = read_varint(buf, i) else {
            break;
        };
        i = next;
        let tag = u32::try_from(key >> 3).unwrap_or(0);

        match key & 7 {
            0 => {
                let Some((value, next)) = read_varint(buf, i) else {
                    break;
                };
                i = next;
                out.push((tag, Value::Varint(value)));
            }
            2 => {
                let Some((len, next)) = read_varint(buf, i) else {
                    break;
                };
                let Ok(len) = usize::try_from(len) else {
                    break;
                };
                if next + len > buf.len() {
                    break;
                }
                out.push((tag, Value::Bytes(&buf[next..next + len])));
                i = next + len;
            }
            5 => i += 4,
            1 => i += 8,
            _ => break,
        }
    }

    out
}

fn read_varint(buf: &[u8], mut i: usize) -> Option<(u64, usize)> {
    let mut result = 0u64;
    let mut shift = 0u32;

    loop {
        let byte = *buf.get(i)?;
        i += 1;
        result |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Some((result, i));
        }
        shift += 7;
        // A varint wider than 64 bits is corrupt data, not a value we lost.
        if shift > 63 {
            return None;
        }
    }
}

fn bytes_field<'a>(fields: &'a [(u32, Value<'a>)], tag: u32) -> Option<&'a [u8]> {
    fields.iter().find_map(|(t, v)| match v {
        Value::Bytes(b) if *t == tag => Some(*b),
        _ => None,
    })
}

fn varint_field(fields: &[(u32, Value<'_>)], tag: u32) -> Option<u64> {
    fields.iter().find_map(|(t, v)| match v {
        Value::Varint(n) if *t == tag => Some(*n),
        _ => None,
    })
}

fn string_field(fields: &[(u32, Value<'_>)], tag: u32) -> Option<String> {
    bytes_field(fields, tag).map(|b| String::from_utf8_lossy(b).into_owned())
}

/// `google.protobuf.Timestamp` → epoch milliseconds.
fn timestamp_ms(buf: &[u8]) -> u64 {
    let fields = read_fields(buf);
    let seconds = varint_field(&fields, F_TS_SECONDS).unwrap_or(0);
    let nanos = varint_field(&fields, F_TS_NANOS).unwrap_or(0);
    seconds.saturating_mul(1000) + nanos / 1_000_000
}

// ============================================================================
// Summary parsing
// ============================================================================

/// Parses one trajectory's inner (base64-decoded) protobuf message.
fn parse_trajectory(buf: &[u8]) -> TrajectorySummary {
    let fields = read_fields(buf);

    let mut summary = TrajectorySummary {
        title: string_field(&fields, F_TITLE).unwrap_or_default(),
        step_count: varint_field(&fields, F_STEP_COUNT).unwrap_or(0),
        created_ms: bytes_field(&fields, F_CREATED_AT).map_or(0, timestamp_ms),
        updated_ms: bytes_field(&fields, F_UPDATED_AT)
            .or_else(|| bytes_field(&fields, F_UPDATED_AT_ALT))
            .map_or(0, timestamp_ms),
        ..TrajectorySummary::default()
    };

    if let Some(workspace) = bytes_field(&fields, F_WORKSPACE) {
        let ws = read_fields(workspace);
        summary.workspace = string_field(&ws, F_WORKSPACE_FOLDER);
        summary.repo = bytes_field(&ws, F_WORKSPACE_GIT)
            .and_then(|git| string_field(&read_fields(git), F_GIT_SLUG));
    }

    // Step snapshots do not live under one repeated tag: each step type gets
    // its own field number (12, 14, 17, ... observed), and the set differs per
    // session. So instead of hardcoding tags, treat every submessage shaped
    // like a step wrapper as one and keep the highest step index per kind.
    let mut best_message = (0u64, None::<String>);
    let mut best_task = (0u64, None::<String>);

    for (tag, value) in &fields {
        if matches!(
            *tag,
            F_TITLE | F_STEP_COUNT | F_CREATED_AT | F_UPDATED_AT | F_UPDATED_AT_ALT | F_WORKSPACE
        ) {
            continue;
        }
        let Value::Bytes(wrapper) = value else {
            continue;
        };
        let wrapper_fields = read_fields(wrapper);
        let Some(step) = bytes_field(&wrapper_fields, F_STEP_WRAPPER_INNER) else {
            continue;
        };
        let step_fields = read_fields(step);
        let index = varint_field(&step_fields, F_STEP_INDEX).unwrap_or(0);
        let Some(common) = bytes_field(&step_fields, F_STEP_COMMON) else {
            continue;
        };
        let common_fields = read_fields(common);
        let Some(action) = bytes_field(&common_fields, F_STEP_ACTION) else {
            continue;
        };
        let action_fields = read_fields(action);
        let Some(tool) = string_field(&action_fields, F_ACTION_TOOL) else {
            continue;
        };
        let Some(args) = string_field(&action_fields, F_ACTION_ARGS)
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        else {
            continue;
        };

        match tool.as_str() {
            "notify_user" if index >= best_message.0 => {
                if let Some(text) = args["Message"].as_str() {
                    best_message = (index, Some(text.to_string()));
                }
            }
            "task_boundary" if index >= best_task.0 => {
                // `%SAME%` is the store's "unchanged from the previous step"
                // sentinel, not a task name.
                let name = args["TaskName"].as_str().filter(|n| *n != "%SAME%");
                let status = args["TaskStatus"].as_str().filter(|s| *s != "%SAME%");
                let label = match (name, status) {
                    (Some(name), Some(status)) => Some(format!("{name} — {status}")),
                    (Some(name), None) => Some(name.to_string()),
                    (None, Some(status)) => Some(status.to_string()),
                    (None, None) => None,
                };
                if label.is_some() {
                    best_task = (index, label);
                }
            }
            _ => {}
        }
    }

    summary.last_message = best_message.1;
    summary.last_task = best_task.1;
    summary
}

/// Parses the raw base64 `trajectorySummaries` value into `session_id →
/// summary`.
pub fn parse_summaries(raw: &str) -> HashMap<String, TrajectorySummary> {
    let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(raw.trim()) else {
        return HashMap::new();
    };

    let mut out = HashMap::new();

    for (tag, value) in read_fields(&decoded) {
        if tag != F_ENTRY {
            continue;
        }
        let Value::Bytes(entry) = value else {
            continue;
        };
        let entry_fields = read_fields(entry);
        let Some(session_id) = string_field(&entry_fields, F_ENTRY_ID) else {
            continue;
        };
        // The payload is base64 *again*, nested one message deep.
        let Some(inner_b64) = bytes_field(&entry_fields, F_ENTRY_PAYLOAD)
            .and_then(|payload| string_field(&read_fields(payload), F_PAYLOAD_B64))
        else {
            continue;
        };
        let Ok(inner) = base64::engine::general_purpose::STANDARD.decode(inner_b64.trim()) else {
            continue;
        };

        out.insert(session_id, parse_trajectory(&inner));
    }

    out
}

// ============================================================================
// Storage discovery
// ============================================================================

/// Antigravity's VS Code-style `User` directory.
fn user_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("ANTIGRAVITY_USER_DIR") {
        let path = PathBuf::from(dir);
        if path.is_dir() {
            return Some(path);
        }
    }

    // Sandboxed helper, not `dirs::*`: on Windows the platform APIs ignore
    // `HOME` and would read the developer's real profile under test (#551).
    let home = crate::utils::home_dir()?;

    #[cfg(target_os = "macos")]
    let base = home.join("Library/Application Support/Antigravity/User");

    #[cfg(target_os = "linux")]
    let base = home.join(".config/Antigravity/User");

    #[cfg(target_os = "windows")]
    let base = home.join("AppData/Roaming/Antigravity/User");

    base.is_dir().then_some(base)
}

/// Path of the global `state.vscdb`, when Antigravity's editor storage exists.
pub fn state_db_path() -> Option<PathBuf> {
    let db = user_dir()?.join("globalStorage").join("state.vscdb");
    db.is_file().then_some(db)
}

/// Reads and parses the trajectory summaries out of a given `state.vscdb`.
///
/// A missing key, a locked DB, or a value that is not the expected base64
/// protobuf all yield an empty map: this is a best-effort enrichment layer on
/// top of the rpc-cache scan, never a hard dependency.
pub fn load_from_db(db_path: &Path) -> HashMap<String, TrajectorySummary> {
    let Ok(conn) = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY) else {
        return HashMap::new();
    };
    if conn
        .busy_timeout(std::time::Duration::from_secs(5))
        .is_err()
    {
        return HashMap::new();
    }

    let raw: Result<String, _> = conn.query_row(
        "SELECT value FROM ItemTable WHERE key = ?1",
        [SUMMARIES_KEY],
        |row| row.get(0),
    );

    match raw {
        Ok(raw) => parse_summaries(&raw),
        Err(_) => HashMap::new(),
    }
}

/// Trajectory summaries for the Antigravity install on this machine.
pub fn load() -> HashMap<String, TrajectorySummary> {
    state_db_path()
        .map(|db| load_from_db(&db))
        .unwrap_or_default()
}

/// Protobuf/base64 encoders mirroring the store's real shape, so tests in this
/// module and in the `antigravity` provider can build fixtures without
/// hand-rolling wire bytes twice.
#[cfg(test)]
pub(crate) mod test_support {
    use super::{
        F_ACTION_ARGS, F_ACTION_TOOL, F_ENTRY, F_ENTRY_ID, F_ENTRY_PAYLOAD, F_PAYLOAD_B64,
        F_STEP_ACTION, F_STEP_COMMON, F_STEP_COUNT, F_STEP_INDEX, F_STEP_WRAPPER_INNER, F_TITLE,
        F_TS_NANOS, F_TS_SECONDS,
    };
    use base64::Engine;

    /// Encodes a protobuf length-delimited field.
    pub(crate) fn bytes_field_bytes(tag: u32, payload: &[u8]) -> Vec<u8> {
        let mut out = varint_bytes(u64::from(tag) << 3 | 2);
        out.extend(varint_bytes(payload.len() as u64));
        out.extend_from_slice(payload);
        out
    }

    pub(crate) fn varint_field_bytes(tag: u32, value: u64) -> Vec<u8> {
        let mut out = varint_bytes(u64::from(tag) << 3);
        out.extend(varint_bytes(value));
        out
    }

    fn varint_bytes(mut value: u64) -> Vec<u8> {
        let mut out = Vec::new();
        loop {
            let byte = u8::try_from(value & 0x7f).unwrap();
            value >>= 7;
            if value == 0 {
                out.push(byte);
                return out;
            }
            out.push(byte | 0x80);
        }
    }

    pub(crate) fn timestamp_bytes(seconds: u64, nanos: u64) -> Vec<u8> {
        let mut out = varint_field_bytes(F_TS_SECONDS, seconds);
        out.extend(varint_field_bytes(F_TS_NANOS, nanos));
        out
    }

    /// Builds a step snapshot: `wrapper { step { index, common { action {
    /// tool, args } } } }`.
    pub(crate) fn step_bytes(tag: u32, index: u64, tool: &str, args: &str) -> Vec<u8> {
        let mut action = bytes_field_bytes(F_ACTION_TOOL, tool.as_bytes());
        action.extend(bytes_field_bytes(F_ACTION_ARGS, args.as_bytes()));
        let common = bytes_field_bytes(F_STEP_ACTION, &action);
        let mut step = varint_field_bytes(F_STEP_INDEX, index);
        step.extend(bytes_field_bytes(F_STEP_COMMON, &common));
        let wrapper = bytes_field_bytes(F_STEP_WRAPPER_INNER, &step);
        bytes_field_bytes(tag, &wrapper)
    }

    /// Assembles the full `trajectorySummaries` value for one session, in the
    /// real store's shape: outer protobuf → base64 → protobuf → base64.
    pub(crate) fn build_value(session_id: &str, trajectory: &[u8]) -> String {
        let inner_b64 = base64::engine::general_purpose::STANDARD.encode(trajectory);
        let payload = bytes_field_bytes(F_PAYLOAD_B64, inner_b64.as_bytes());
        let mut entry = bytes_field_bytes(F_ENTRY_ID, session_id.as_bytes());
        entry.extend(bytes_field_bytes(F_ENTRY_PAYLOAD, &payload));
        let top = bytes_field_bytes(F_ENTRY, &entry);
        base64::engine::general_purpose::STANDARD.encode(top)
    }

    /// A trajectory carrying a title, a step count and one `notify_user`
    /// snapshot — the shape a desktop session normally has.
    pub(crate) fn trajectory_with_message(title: &str, steps: u64, message: &str) -> Vec<u8> {
        let mut inner = bytes_field_bytes(F_TITLE, title.as_bytes());
        inner.extend(varint_field_bytes(F_STEP_COUNT, steps));
        inner.extend(step_bytes(
            12,
            82,
            "notify_user",
            &serde_json::json!({ "BlockedOnUser": false, "Message": message }).to_string(),
        ));
        inner
    }

    /// Writes a `globalStorage/state.vscdb` holding `value` under the
    /// trajectory-summaries key, and returns the `User` directory to point
    /// `ANTIGRAVITY_USER_DIR` at.
    pub(crate) fn write_state_db(user_dir: &std::path::Path, value: &str) {
        let global = user_dir.join("globalStorage");
        std::fs::create_dir_all(&global).unwrap();
        let conn = rusqlite::Connection::open(global.join("state.vscdb")).unwrap();
        conn.execute(
            "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value TEXT)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO ItemTable (key, value) VALUES (?1, ?2)",
            rusqlite::params![super::SUMMARIES_KEY, value],
        )
        .unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{
        build_value, bytes_field_bytes, step_bytes, timestamp_bytes, varint_field_bytes,
    };
    use super::*;
    use tempfile::TempDir;

    /// Header fields only: everything before the step snapshots.
    fn sample_header() -> Vec<u8> {
        let mut inner = bytes_field_bytes(F_TITLE, b"Fixing Step Sync Interval");
        inner.extend(varint_field_bytes(F_STEP_COUNT, 18));
        inner.extend(bytes_field_bytes(
            F_CREATED_AT,
            &timestamp_bytes(1_700_000_000, 500_000_000),
        ));
        inner.extend(bytes_field_bytes(
            F_UPDATED_AT,
            &timestamp_bytes(1_700_000_600, 0),
        ));

        let mut workspace = bytes_field_bytes(F_WORKSPACE_FOLDER, b"file:///Users/dev/app");
        let git = bytes_field_bytes(F_GIT_SLUG, b"owner/app");
        workspace.extend(bytes_field_bytes(F_WORKSPACE_GIT, &git));
        inner.extend(bytes_field_bytes(F_WORKSPACE, &workspace));
        inner
    }

    fn sample_trajectory() -> Vec<u8> {
        let mut inner = sample_header();

        // Two notify_user steps: the newer index must win.
        inner.extend(step_bytes(
            12,
            80,
            "notify_user",
            r#"{"BlockedOnUser":false,"Message":"older"}"#,
        ));
        inner.extend(step_bytes(
            13,
            82,
            "notify_user",
            r#"{"BlockedOnUser":false,"Message":"Done — README rewritten."}"#,
        ));
        inner.extend(step_bytes(
            14,
            81,
            "task_boundary",
            r#"{"Mode":"VERIFICATION","TaskName":"Updating README","TaskStatus":"Verifying"}"#,
        ));
        inner
    }

    #[test]
    fn parses_title_counts_workspace_and_latest_step_texts() {
        let value = build_value("aaa57739-2229-4961-aeb0-1f17b8d8ba6e", &sample_trajectory());
        let summaries = parse_summaries(&value);

        let summary = summaries
            .get("aaa57739-2229-4961-aeb0-1f17b8d8ba6e")
            .expect("session missing");
        assert_eq!(summary.title, "Fixing Step Sync Interval");
        assert_eq!(summary.step_count, 18);
        assert_eq!(summary.created_ms, 1_700_000_000_500);
        assert_eq!(summary.updated_ms, 1_700_000_600_000);
        assert_eq!(summary.workspace.as_deref(), Some("file:///Users/dev/app"));
        assert_eq!(summary.repo.as_deref(), Some("owner/app"));
        // Highest step index wins, and the step tag it arrived under is
        // irrelevant — the real store uses different tags per session.
        assert_eq!(
            summary.last_message.as_deref(),
            Some("Done — README rewritten.")
        );
        assert_eq!(
            summary.last_task.as_deref(),
            Some("Updating README — Verifying")
        );
    }

    #[test]
    fn drops_the_same_sentinel_from_task_labels() {
        // `%SAME%` means "unchanged from the previous step"; rendering it as a
        // task name would put literal `%SAME%` in the session list.
        let mut inner = bytes_field_bytes(F_TITLE, b"Refine Analysis Documents");
        inner.extend(varint_field_bytes(F_STEP_COUNT, 135));
        inner.extend(step_bytes(
            14,
            81,
            "task_boundary",
            r#"{"TaskName":"%SAME%","TaskStatus":"Updating documents"}"#,
        ));

        let summaries = parse_summaries(&build_value("sess-same", &inner));
        let summary = summaries.get("sess-same").expect("session missing");
        assert_eq!(summary.last_task.as_deref(), Some("Updating documents"));
    }

    #[test]
    fn truncated_protobuf_yields_what_was_readable() {
        // Reverse-engineered data: a value cut short mid-step (or written by a
        // newer schema) must degrade to the fields already parsed, not to an
        // empty map.
        let header = sample_header();
        let step = step_bytes(
            13,
            82,
            "notify_user",
            r#"{"BlockedOnUser":false,"Message":"Done"}"#,
        );
        let mut truncated = header.clone();
        truncated.extend_from_slice(&step[..step.len() / 2]);

        let summaries = parse_summaries(&build_value("sess-truncated", &truncated));
        let summary = summaries.get("sess-truncated").expect("session missing");
        assert_eq!(summary.title, "Fixing Step Sync Interval");
        assert_eq!(summary.step_count, 18);
        assert_eq!(summary.workspace.as_deref(), Some("file:///Users/dev/app"));
        assert!(summary.last_message.is_none());
    }

    #[test]
    fn non_base64_value_is_ignored() {
        assert!(parse_summaries("not base64 at all !!").is_empty());
    }

    #[test]
    fn reads_summaries_out_of_a_state_vscdb() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("state.vscdb");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute(
            "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value TEXT)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO ItemTable (key, value) VALUES (?1, ?2)",
            rusqlite::params![SUMMARIES_KEY, build_value("sess-db", &sample_trajectory())],
        )
        .unwrap();
        drop(conn);

        let summaries = load_from_db(&db_path);
        assert_eq!(
            summaries.get("sess-db").map(|s| s.title.as_str()),
            Some("Fixing Step Sync Interval")
        );
    }

    #[test]
    fn missing_key_and_corrupt_db_are_not_errors() {
        let dir = TempDir::new().unwrap();

        let empty_db = dir.path().join("empty.vscdb");
        let conn = Connection::open(&empty_db).unwrap();
        conn.execute("CREATE TABLE ItemTable (key TEXT, value TEXT)", [])
            .unwrap();
        drop(conn);
        assert!(load_from_db(&empty_db).is_empty());

        let corrupt_db = dir.path().join("corrupt.vscdb");
        std::fs::write(&corrupt_db, b"this is not a sqlite database").unwrap();
        assert!(load_from_db(&corrupt_db).is_empty());

        assert!(load_from_db(&dir.path().join("missing.vscdb")).is_empty());
    }
}
