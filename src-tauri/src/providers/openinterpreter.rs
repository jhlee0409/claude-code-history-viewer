//! Open Interpreter provider (Rust v1.0).
//!
//! Open Interpreter v1.0 is a re-rooted fork of `OpenAI` Codex and writes the
//! IDENTICAL rollout JSONL format, under `~/.openinterpreter/sessions/**` (+
//! `archived_sessions/`). The home dir is overridable via `INTERPRETER_HOME`
//! (`CODEX_HOME` is deliberately ignored by Open Interpreter).
//!
//! Because the on-disk format is byte-compatible with Codex, this module reuses
//! the Codex rollout parser ([`super::codex::parse_rollout_file`]) and metadata
//! extractors, validating paths against the Open Interpreter root and re-tagging
//! the provider on the result. Projects group rollouts by `cwd`, like Codex.

use super::codex;
use super::ProviderInfo;
use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const PROVIDER: &str = "openinterpreter";
const SCHEME: &str = "openinterpreter://";

/// Open Interpreter home: `$INTERPRETER_HOME` (if set + exists) else
/// `~/.openinterpreter`. Returns `None` unless the directory exists.
fn home_dir() -> Option<PathBuf> {
    if let Ok(home) = std::env::var("INTERPRETER_HOME") {
        let home = home.trim();
        if !home.is_empty() {
            let p = PathBuf::from(home);
            return if p.exists() { Some(p) } else { None };
        }
    }
    let p = dirs::home_dir()?.join(".openinterpreter");
    if p.exists() {
        Some(p)
    } else {
        None
    }
}

/// Detect an Open Interpreter installation.
pub fn detect() -> Option<ProviderInfo> {
    let base = home_dir()?;
    Some(ProviderInfo {
        id: PROVIDER.to_string(),
        display_name: "Open Interpreter".to_string(),
        is_available: !session_dirs().is_empty(),
        base_path: base.to_string_lossy().to_string(),
    })
}

/// Base path (the Open Interpreter home), for the file watcher.
pub fn get_base_path() -> Option<String> {
    home_dir().map(|p| p.to_string_lossy().to_string())
}

/// The existing `sessions/` and `archived_sessions/` roots under the OI home.
fn session_dirs() -> Vec<PathBuf> {
    let Some(base) = home_dir() else {
        return Vec::new();
    };
    [base.join("sessions"), base.join("archived_sessions")]
        .into_iter()
        .filter(|p| p.is_dir())
        .collect()
}

/// All `rollout-*.jsonl` files under the OI session roots.
fn rollout_files() -> Vec<PathBuf> {
    let mut files = Vec::new();
    for dir in session_dirs() {
        for entry in WalkDir::new(dir)
            .min_depth(1)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file())
            .filter(|e| codex::is_rollout_jsonl(e.path()))
        {
            files.push(entry.path().to_path_buf());
        }
    }
    files
}

/// Scan Open Interpreter projects (rollouts grouped by `cwd`).
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    struct Agg {
        session_count: usize,
        message_count: usize,
        last_modified: String,
    }
    let mut by_cwd: HashMap<String, Agg> = HashMap::new();

    for path in rollout_files() {
        if let Ok(info) = codex::extract_project_scan_info(&path) {
            let cwd = info.cwd.clone().unwrap_or_else(|| "unknown".to_string());
            let e = by_cwd.entry(cwd).or_insert_with(|| Agg {
                session_count: 0,
                message_count: 0,
                last_modified: String::new(),
            });
            e.session_count += 1;
            e.message_count += info.message_count;
            if info.last_modified > e.last_modified {
                e.last_modified = info.last_modified;
            }
        }
    }

    let mut projects: Vec<ClaudeProject> = by_cwd
        .into_iter()
        .map(|(cwd, agg)| {
            let name = Path::new(&cwd)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| cwd.clone());
            ClaudeProject {
                name,
                path: format!("{SCHEME}{cwd}"),
                actual_path: cwd,
                session_count: agg.session_count,
                message_count: agg.message_count,
                last_modified: agg.last_modified,
                git_info: None,
                provider: Some(PROVIDER.to_string()),
                storage_type: None,
                custom_directory_label: None,
            }
        })
        .collect();

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

/// Load the sessions for one Open Interpreter project (filtered by `cwd`).
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let target_cwd = project_path.strip_prefix(SCHEME).unwrap_or(project_path);
    let mut sessions = Vec::new();

    for path in rollout_files() {
        if let Ok(Some(cwd)) = codex::extract_session_cwd(&path) {
            if cwd != target_cwd {
                continue;
            }
        }
        if let Ok(info) = codex::extract_session_info(&path) {
            if info.cwd.as_deref().unwrap_or("unknown") != target_cwd {
                continue;
            }
            sessions.push(ClaudeSession {
                session_id: info.file_path.clone(),
                actual_session_id: info.session_id,
                file_path: info.file_path,
                project_name: Path::new(target_cwd)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
                message_count: info.message_count,
                first_message_time: info.first_message_time,
                last_message_time: info.last_message_time,
                last_modified: info.last_modified,
                has_tool_use: info.has_tool_use,
                has_errors: false,
                summary: info.summary,
                is_renamed: false,
                provider: Some(PROVIDER.to_string()),
                storage_type: None,
                entrypoint: None,
            });
        }
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

/// Load all messages from one Open Interpreter rollout file.
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let path = Path::new(session_path);
    if !path.exists() {
        return Err(format!("Session file not found: {session_path}"));
    }
    let canonical = validate_under_base(path)?;
    let mut messages = codex::parse_rollout_file(&canonical)?;
    // The Codex parser tags messages "codex"; re-tag for this provider.
    for msg in &mut messages {
        msg.provider = Some(PROVIDER.to_string());
    }
    Ok(messages)
}

/// Search across all Open Interpreter rollouts.
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    if query.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for path in rollout_files() {
        let Ok(messages) = load_messages(&path.to_string_lossy()) else {
            continue;
        };
        for msg in messages {
            if results.len() >= limit {
                return Ok(results);
            }
            if let Some(content) = &msg.content {
                if crate::utils::search_json_value_case_insensitive(content, &query_lower) {
                    results.push(msg);
                }
            }
        }
    }
    Ok(results)
}

/// Confine `session_path` to the Open Interpreter session roots and confirm it
/// is a rollout file. Canonicalizes both sides.
fn validate_under_base(path: &Path) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve session path: {e}"))?;
    if !codex::is_rollout_jsonl(&canonical) {
        return Err(format!(
            "Not an Open Interpreter rollout file: {}",
            path.display()
        ));
    }
    let allowed: Vec<PathBuf> = session_dirs()
        .into_iter()
        .filter_map(|d| d.canonicalize().ok())
        .collect();
    if allowed.is_empty() {
        return Err("Open Interpreter session directories not found".to_string());
    }
    if allowed.iter().any(|d| canonical.starts_with(d)) {
        Ok(canonical)
    } else {
        Err(format!(
            "Session path is outside Open Interpreter session directories: {}",
            path.display()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use serial_test::serial;
    use std::fs;
    use tempfile::TempDir;

    struct HomeGuard {
        original: Option<String>,
    }
    impl HomeGuard {
        fn set(path: &Path) -> Self {
            let original = std::env::var("INTERPRETER_HOME").ok();
            std::env::set_var("INTERPRETER_HOME", path);
            Self { original }
        }
    }
    impl Drop for HomeGuard {
        fn drop(&mut self) {
            match self.original.as_ref() {
                Some(v) => std::env::set_var("INTERPRETER_HOME", v),
                None => std::env::remove_var("INTERPRETER_HOME"),
            }
        }
    }

    fn write_rollout(
        sessions_dir: &Path,
        filename: &str,
        id: &str,
        cwd: &str,
        prompt: &str,
    ) -> PathBuf {
        let path = sessions_dir.join(filename);
        let lines = [
            json!({ "type": "session_meta", "payload": { "id": id, "cwd": cwd } }),
            json!({
                "timestamp": "2026-02-21T10:00:00Z",
                "type": "response_item",
                "payload": {
                    "type": "message", "role": "user", "created_at": "2026-02-21T10:00:00Z",
                    "content": [{ "type": "input_text", "text": prompt }]
                }
            }),
        ];
        let body = lines
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&path, format!("{body}\n")).unwrap();
        path
    }

    #[test]
    #[serial]
    fn scan_load_and_retag_via_interpreter_home() {
        let tmp = TempDir::new().unwrap();
        let sessions = tmp.path().join("sessions");
        fs::create_dir_all(&sessions).unwrap();
        write_rollout(
            &sessions,
            "rollout-2026-02-21T10-00-00-uuid1.jsonl",
            "uuid1",
            "/Users/jack/proj",
            "why does LOGIN fail?",
        );
        let _guard = HomeGuard::set(tmp.path());

        // detect + base path
        let info = detect().unwrap();
        assert_eq!(info.id, "openinterpreter");
        assert!(info.is_available);

        // scan groups by cwd
        let projects = scan_projects().unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].provider.as_deref(), Some("openinterpreter"));
        assert_eq!(projects[0].path, "openinterpreter:///Users/jack/proj");
        assert_eq!(projects[0].actual_path, "/Users/jack/proj");

        // load_sessions
        let sess = load_sessions("openinterpreter:///Users/jack/proj", false).unwrap();
        assert_eq!(sess.len(), 1);
        assert_eq!(sess[0].provider.as_deref(), Some("openinterpreter"));
        let file_path = sess[0].file_path.clone();

        // load_messages reuses the Codex parser but re-tags provider
        let msgs = load_messages(&file_path).unwrap();
        assert!(!msgs.is_empty());
        assert!(msgs
            .iter()
            .all(|m| m.provider.as_deref() == Some("openinterpreter")));
    }

    #[test]
    #[serial]
    fn load_messages_rejects_path_outside_base() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("sessions")).unwrap();
        let _guard = HomeGuard::set(tmp.path());

        // A rollout file outside the OI session roots must be rejected.
        let outside = TempDir::new().unwrap();
        let stray = write_rollout(outside.path(), "rollout-x.jsonl", "x", "/c", "hi");
        assert!(load_messages(&stray.to_string_lossy()).is_err());
    }
}
