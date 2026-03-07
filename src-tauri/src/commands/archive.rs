//! Tauri commands for managing session archives
//!
//! This module provides commands for creating, listing, and managing
//! archived sessions stored in ~/.claude-history-viewer/archives/

use crate::models::ClaudeSession;
use chrono::Utc;
use lazy_static::lazy_static;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use uuid::Uuid;

lazy_static! {
    /// Regex used only to detect legacy UUID-based archive IDs during migration.
    static ref ARCHIVE_ID_REGEX: Regex =
        Regex::new(r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$").unwrap();
    /// Allowed characters for archive IDs used as directory names.
    /// Supports Unicode letters/numbers plus `_` and `-`.
    static ref ARCHIVE_ID_SAFE_CHARS_REGEX: Regex =
        Regex::new(r"^[\p{L}\p{N}_-]+$").unwrap();
}

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

/// Global archive list stored in archive-manifest.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveManifest {
    pub version: u32,
    pub archives: Vec<ArchiveEntry>,
}

impl Default for ArchiveManifest {
    fn default() -> Self {
        Self {
            version: 1,
            archives: Vec::new(),
        }
    }
}

/// A single archive entry in the global manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: String,
    pub source_provider: String,
    pub source_project_path: String,
    pub source_project_name: String,
    pub session_count: u32,
    pub total_size_bytes: u64,
    pub include_subagents: bool,
}

/// Metadata for a single session file within an archive
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveSessionInfo {
    pub session_id: String,
    pub file_name: String,
    pub original_file_path: String,
    pub message_count: usize,
    pub first_message_time: String,
    pub last_message_time: String,
    pub summary: Option<String>,
    pub size_bytes: u64,
    pub subagent_count: u32,
    pub subagent_size_bytes: u64,
    pub subagents: Vec<SubagentFileInfo>,
}

/// Metadata for a single subagent JSONL file
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentFileInfo {
    pub file_name: String,
    pub size_bytes: u64,
    pub message_count: usize,
}

/// Disk usage summary for all archives
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveDiskUsage {
    pub total_bytes: u64,
    pub archive_count: usize,
    pub session_count: usize,
    pub per_archive: Vec<ArchiveDiskEntry>,
}

/// Per-archive disk usage entry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveDiskEntry {
    pub archive_id: String,
    pub archive_name: String,
    pub size_bytes: u64,
    pub session_count: u32,
}

/// A session that is about to expire (within `threshold_days`)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpiringSession {
    pub session: ClaudeSession,
    pub days_remaining: i64,
    pub file_size_bytes: u64,
    pub subagent_count: u32,
}

/// Result of exporting a session
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub content: String,
    pub format: String,
    pub session_id: String,
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Returns the archives base directory path: `~/.claude-history-viewer/archives/`
fn get_archives_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    Ok(home.join(".claude-history-viewer").join("archives"))
}

/// Ensures the archives base directory exists.
fn ensure_archives_dir() -> Result<PathBuf, String> {
    let dir = get_archives_dir()?;
    if dir.exists() {
        if !dir.is_dir() {
            return Err(format!(
                "Archives path exists but is not a directory: {}",
                dir.display()
            ));
        }
    } else {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create archives directory: {e}"))?;
    }
    Ok(dir)
}

/// Path to the global archive manifest file.
fn get_manifest_path() -> Result<PathBuf, String> {
    Ok(get_archives_dir()?.join("archive-manifest.json"))
}

/// Validates an archive ID for filesystem safety.
///
/// Accepts both legacy UUID format (`3f8a1b2c-...`) and new name-based format
/// (`my-project_3f8a1b2c`). Rejects path traversal, separators, and null bytes.
fn validate_archive_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("Archive ID must not be empty".to_string());
    }
    if id.len() > 120 {
        return Err(format!(
            "Invalid archive ID '{id}': exceeds maximum length of 120 characters"
        ));
    }
    if id.trim() != id {
        return Err(format!(
            "Invalid archive ID '{id}': must not have leading or trailing whitespace"
        ));
    }
    // Reject path traversal and separators
    if id.contains('/') || id.contains('\\') || id.contains("..") || id.contains('\0') {
        return Err(format!(
            "Invalid archive ID '{id}': contains forbidden characters"
        ));
    }
    // Must not start or end with dots (Windows-sensitive)
    if id.starts_with('.') || id.ends_with('.') {
        return Err(format!(
            "Invalid archive ID '{id}': must not start or end with a dot"
        ));
    }
    if !ARCHIVE_ID_SAFE_CHARS_REGEX.is_match(id) {
        return Err(format!(
            "Invalid archive ID '{id}': only letters, numbers, underscores, and hyphens are allowed"
        ));
    }
    Ok(())
}

/// Sanitizes a human-readable name into a filesystem-safe directory name.
///
/// - Trims whitespace
/// - Replaces whitespace with hyphens
/// - Removes characters unsafe for file systems: `/`, `\`, `..`, `<`, `>`, `:`, `"`, `|`, `?`, `*`, null
/// - Collapses consecutive hyphens
/// - Truncates to 50 characters
fn sanitize_for_dirname(name: &str) -> String {
    let sanitized: String = name
        .trim()
        .chars()
        .map(|c| match c {
            '/' | '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*' | '\0' => '-',
            c if c.is_whitespace() => '-',
            c => c,
        })
        .collect();

    // Collapse consecutive hyphens
    let mut result = String::new();
    let mut prev_hyphen = false;
    for c in sanitized.chars() {
        if c == '-' {
            if !prev_hyphen {
                result.push('-');
            }
            prev_hyphen = true;
        } else {
            result.push(c);
            prev_hyphen = false;
        }
    }

    // Trim leading/trailing hyphens and dots, truncate
    let result = result
        .trim_matches(|c: char| c == '-' || c == '.')
        .to_string();
    let truncated: String = result.chars().take(50).collect();
    truncated.trim_end_matches('-').to_string()
}

/// Returns the directory path for an individual archive.
fn get_archive_dir(archive_id: &str) -> Result<PathBuf, String> {
    validate_archive_id(archive_id)?;
    Ok(get_archives_dir()?.join(archive_id))
}

/// Loads the global archive manifest from disk (returns default if missing).
fn load_manifest() -> Result<ArchiveManifest, String> {
    let path = get_manifest_path()?;
    if !path.exists() {
        return Ok(ArchiveManifest::default());
    }
    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read archive manifest: {e}"))?;
    let manifest: ArchiveManifest = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse archive manifest: {e}"))?;
    Ok(manifest)
}

/// Atomically writes the global archive manifest to disk.
fn save_manifest(manifest: &ArchiveManifest) -> Result<(), String> {
    ensure_archives_dir()?;
    let path = get_manifest_path()?;
    let content = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("Failed to serialize archive manifest: {e}"))?;

    let tmp_path = path.with_extension(format!("json.{}.tmp", Uuid::new_v4()));
    let mut file = fs::File::create(&tmp_path)
        .map_err(|e| format!("Failed to create temp manifest file: {e}"))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write temp manifest file: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("Failed to sync temp manifest file: {e}"))?;
    drop(file);

    super::fs_utils::atomic_rename(&tmp_path, &path)?;
    Ok(())
}

/// Counts the number of non-sidechain messages in a JSONL file.
fn count_messages(path: &Path) -> usize {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return 0,
    };
    let reader = BufReader::new(file);
    let mut count = 0usize;
    for line in reader.lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
            let is_sidechain = val
                .get("isSidechain")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            if !is_sidechain {
                count += 1;
            }
        }
    }
    count
}

/// Extracts the first and last timestamp from a JSONL file.
/// Returns `(first, last)` as ISO 8601 strings, or empty strings if unavailable.
#[cfg(test)]
fn extract_timestamps(path: &Path) -> (String, String) {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return (String::new(), String::new()),
    };
    let reader = BufReader::new(file);
    let mut first: Option<String> = None;
    let mut last: Option<String> = None;

    for line in reader.lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
            if let Some(ts) = val.get("timestamp").and_then(serde_json::Value::as_str) {
                if first.is_none() {
                    first = Some(ts.to_string());
                }
                last = Some(ts.to_string());
            }
        }
    }

    (first.unwrap_or_default(), last.unwrap_or_default())
}

/// Extracts the summary from a JSONL file (last `type: "summary"` entry).
#[cfg(test)]
fn extract_summary(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);
    let mut summary: Option<String> = None;
    for line in reader.lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
            let msg_type = val
                .get("type")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            if msg_type == "summary" {
                if let Some(s) = val.get("summary").and_then(serde_json::Value::as_str) {
                    summary = Some(s.to_string());
                }
            }
        }
    }
    summary
}

/// Extracts message count, timestamps, and summary in a single pass through the JSONL file.
/// Returns `(message_count, first_timestamp, last_timestamp, summary)`.
fn extract_session_metadata(path: &Path) -> (usize, String, String, Option<String>) {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return (0, String::new(), String::new(), None),
    };
    let reader = BufReader::new(file);
    let mut count = 0usize;
    let mut first_ts: Option<String> = None;
    let mut last_ts: Option<String> = None;
    let mut summary: Option<String> = None;

    for line in reader.lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }
        let val: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // Count non-sidechain messages
        let is_sidechain = val
            .get("isSidechain")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        if !is_sidechain {
            count += 1;
        }

        // Track timestamps
        if let Some(ts) = val.get("timestamp").and_then(serde_json::Value::as_str) {
            if first_ts.is_none() {
                first_ts = Some(ts.to_string());
            }
            last_ts = Some(ts.to_string());
        }

        // Track summary (last one wins)
        let msg_type = val
            .get("type")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        if msg_type == "summary" {
            if let Some(s) = val.get("summary").and_then(serde_json::Value::as_str) {
                summary = Some(s.to_string());
            }
        }
    }

    (
        count,
        first_ts.unwrap_or_default(),
        last_ts.unwrap_or_default(),
        summary,
    )
}

/// Computes the total byte-size of a directory tree (best effort; ignores errors).
fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(rd) = fs::read_dir(path) {
        for entry in rd.flatten() {
            let entry_path = entry.path();
            match fs::symlink_metadata(&entry_path) {
                Ok(meta) if meta.file_type().is_symlink() => {}
                Ok(meta) if meta.is_dir() => total += dir_size(&entry_path),
                Ok(meta) => total += meta.len(),
                Err(_) => {}
            }
        }
    }
    total
}

/// Looks for subagent JSONL files adjacent to a session file.
///
/// The convention is: subagents live in a directory named `subagents/` relative to
/// the session file's parent directory, inside a subdirectory named after the
/// session stem (without extension).
///
/// e.g. for `/path/to/sessions/abc123.jsonl`:
///   subagents would be under `/path/to/subagents/abc123/`
fn find_subagent_files(session_file_path: &Path) -> Vec<PathBuf> {
    let parent = match session_file_path.parent() {
        Some(p) => p,
        None => return Vec::new(),
    };
    let stem = match session_file_path.file_stem().and_then(|s| s.to_str()) {
        Some(s) => s,
        None => return Vec::new(),
    };

    // Subagent files could be relative to the session directory's parent
    // (i.e., sibling `subagents/` directory) or relative to the session directory itself.
    let mut candidate_dirs = vec![parent.join("subagents").join(stem)];
    if let Some(gp) = parent.parent() {
        candidate_dirs.push(gp.join("subagents").join(stem));
    }

    let mut files = Vec::new();
    for dir in &candidate_dirs {
        if dir.exists() && dir.is_dir() {
            if let Ok(rd) = fs::read_dir(dir) {
                for entry in rd.flatten() {
                    let p = entry.path();
                    // Skip symlinks for security
                    if let Ok(meta) = fs::symlink_metadata(&p) {
                        if meta.file_type().is_symlink() {
                            continue;
                        }
                    }
                    if p.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                        files.push(p);
                    }
                }
            }
        }
    }
    files
}

/// Converts a JSONL file to a pretty-printed JSON array string.
fn jsonl_to_json_array(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| format!("Failed to read session file: {e}"))?;
    let reader = BufReader::new(file);
    let mut entries: Vec<serde_json::Value> = Vec::new();
    for line_result in reader.lines() {
        let line = line_result.map_err(|e| format!("Failed to read line: {e}"))?;
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
            entries.push(val);
        }
    }
    serde_json::to_string_pretty(&entries)
        .map_err(|e| format!("Failed to serialize JSON array: {e}"))
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Returns the base path for archive storage: `~/.claude-history-viewer/archives/`
#[tauri::command]
#[allow(clippy::unused_async)]
pub async fn get_archive_base_path() -> Result<String, String> {
    let path = get_archives_dir()?;
    Ok(path.to_string_lossy().to_string())
}

/// Reads and returns the global archive manifest.
///
/// Returns an empty manifest (version 1, no archives) if the manifest file does not exist yet.
///
/// On first load, automatically migrates any legacy UUID-based archive directories
/// to the new name-based format (e.g., `3f8a1b2c-...` → `My-Archive_3f8a1b2c`).
#[tauri::command]
pub async fn list_archives() -> Result<ArchiveManifest, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut manifest = load_manifest()?;
        let mut changed = false;

        for entry in &mut manifest.archives {
            // Detect legacy UUID-based IDs
            if !ARCHIVE_ID_REGEX.is_match(&entry.id) {
                continue;
            }

            let short_uuid = &entry.id[..8];
            let sanitized = sanitize_for_dirname(&entry.name);
            let new_id = if sanitized.is_empty() {
                continue; // Can't generate name-based ID without a name
            } else {
                format!("{sanitized}_{short_uuid}")
            };

            // Rename the directory
            let archives_dir = match get_archives_dir() {
                Ok(d) => d,
                Err(_) => continue,
            };
            let old_dir = archives_dir.join(&entry.id);
            let new_dir = archives_dir.join(&new_id);

            if old_dir.exists() && !new_dir.exists() && fs::rename(&old_dir, &new_dir).is_ok() {
                // Update per-archive manifest.json if it exists
                let per_manifest = new_dir.join("manifest.json");
                if per_manifest.exists() {
                    if let Ok(content) = fs::read_to_string(&per_manifest) {
                        if let Ok(mut val) = serde_json::from_str::<serde_json::Value>(&content) {
                            val["archiveId"] = serde_json::Value::String(new_id.clone());
                            if let Ok(updated) = serde_json::to_string_pretty(&val) {
                                let tmp = per_manifest
                                    .with_extension(format!("json.{}.tmp", Uuid::new_v4()));
                                if let Ok(mut f) = fs::File::create(&tmp) {
                                    if f.write_all(updated.as_bytes()).is_ok()
                                        && f.sync_all().is_ok()
                                    {
                                        let _ = super::fs_utils::atomic_rename(&tmp, &per_manifest);
                                    } else {
                                        let _ = fs::remove_file(&tmp);
                                    }
                                }
                            }
                        }
                    }
                }

                entry.id.clone_from(&new_id);
                changed = true;
            }
        }

        if changed {
            save_manifest(&manifest)?;
        }

        Ok(manifest)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Creates a new archive by copying the given JSONL session files.
///
/// # Arguments
/// * `name` - Human-readable name for the archive
/// * `description` - Optional description
/// * `session_file_paths` - Absolute paths to the JSONL session files to archive
/// * `source_provider` - Provider identifier (e.g. "claude", "codex", "opencode")
/// * `source_project_path` - Filesystem path of the originating project
/// * `source_project_name` - Display name of the originating project
/// * `include_subagents` - Whether to also copy subagent JSONL files
#[tauri::command]
pub async fn create_archive(
    name: String,
    description: Option<String>,
    session_file_paths: Vec<String>,
    source_provider: String,
    source_project_path: String,
    source_project_name: String,
    include_subagents: bool,
) -> Result<ArchiveEntry, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if name.trim().is_empty() {
            return Err("Archive name is required".to_string());
        }

        ensure_archives_dir()?;

        let uuid = Uuid::new_v4().to_string();
        let short_uuid = &uuid[..8];
        let sanitized_name = sanitize_for_dirname(&name);
        let archive_id = if sanitized_name.is_empty() {
            uuid.clone()
        } else {
            format!("{sanitized_name}_{short_uuid}")
        };
        let archive_dir = get_archives_dir()?.join(&archive_id);
        let sessions_dir = archive_dir.join("sessions");
        let subagents_dir = archive_dir.join("subagents");

        fs::create_dir_all(&sessions_dir)
            .map_err(|e| format!("Failed to create sessions directory: {e}"))?;

        // Wrap inner logic so we can clean up on failure
        let result: Result<ArchiveEntry, String> = (|| {
            let mut total_size: u64 = 0;
            let mut session_count: u32 = 0;
            let mut per_session_info: Vec<serde_json::Value> = Vec::new();

            for session_path_str in &session_file_paths {
                let session_path = Path::new(session_path_str);

                // Security: reject path traversal
                if session_path
                    .components()
                    .any(|c| matches!(c, std::path::Component::ParentDir))
                {
                    return Err(format!(
                        "Session path contains '..' components: {session_path_str}"
                    ));
                }

                // Security: reject symlinks and verify file exists
                match fs::symlink_metadata(session_path) {
                    Ok(meta) if meta.file_type().is_symlink() => {
                        return Err(format!(
                            "Session path is a symlink (rejected for security): {session_path_str}"
                        ));
                    }
                    Ok(_) => {}
                    Err(_) => {
                        return Err(format!("Session file not found: {session_path_str}"));
                    }
                }

                let file_name = session_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .ok_or_else(|| format!("Invalid session file name: {session_path_str}"))?;

                let mut dest = sessions_dir.join(file_name);
                // Handle filename collision: append numeric suffix
                if dest.exists() {
                    let stem = session_path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("session");
                    let mut suffix = 1u32;
                    loop {
                        dest = sessions_dir.join(format!("{stem}_{suffix}.jsonl"));
                        if !dest.exists() {
                            break;
                        }
                        suffix += 1;
                    }
                }
                fs::copy(session_path, &dest).map_err(|e| {
                    format!("Failed to copy session file '{session_path_str}': {e}")
                })?;

                let file_size = dest.metadata().map(|m| m.len()).unwrap_or(0);
                total_size += file_size;
                session_count += 1;

                // Copy subagent files if requested
                let mut subagent_count: u32 = 0;
                let mut subagent_size: u64 = 0;

                if include_subagents {
                    let subagent_files = find_subagent_files(session_path);
                    if !subagent_files.is_empty() {
                        let stem = session_path
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("unknown");
                        let dest_subagent_dir = subagents_dir.join(stem);
                        fs::create_dir_all(&dest_subagent_dir)
                            .map_err(|e| format!("Failed to create subagents directory: {e}"))?;

                        for subagent_file in &subagent_files {
                            let sa_name = subagent_file
                                .file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("agent.jsonl");
                            let sa_dest = dest_subagent_dir.join(sa_name);
                            if fs::copy(subagent_file, &sa_dest).is_ok() {
                                subagent_size += sa_dest.metadata().map(|m| m.len()).unwrap_or(0);
                                subagent_count += 1;
                            }
                        }
                        total_size += subagent_size;
                    }
                }

                // Extract per-session metadata for the archive manifest
                let stem = session_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("");
                let (msg_count, first_ts, last_ts, summary) = extract_session_metadata(&dest);

                let dest_file_name = dest
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(file_name);
                per_session_info.push(serde_json::json!({
                    "sessionId": stem,
                    "fileName": dest_file_name,
                    "originalFilePath": session_path_str,
                    "messageCount": msg_count,
                    "firstMessageTime": first_ts,
                    "lastMessageTime": last_ts,
                    "summary": summary,
                    "sizeBytes": file_size,
                    "subagentCount": subagent_count,
                    "subagentSizeBytes": subagent_size,
                }));
            }

            // Write per-archive manifest
            let created_at = Utc::now().to_rfc3339();
            let archive_manifest_path = archive_dir.join("manifest.json");
            let archive_manifest = serde_json::json!({
                "version": 1,
                "archiveId": archive_id,
                "name": name,
                "description": description,
                "createdAt": &created_at,
                "sourceProvider": source_provider,
                "sourceProjectPath": source_project_path,
                "sourceProjectName": source_project_name,
                "includeSubagents": include_subagents,
                "sessions": per_session_info,
            });
            let manifest_content = serde_json::to_string_pretty(&archive_manifest)
                .map_err(|e| format!("Failed to serialize per-archive manifest: {e}"))?;

            let tmp_path =
                archive_manifest_path.with_extension(format!("json.{}.tmp", Uuid::new_v4()));
            let mut f = fs::File::create(&tmp_path)
                .map_err(|e| format!("Failed to create manifest temp file: {e}"))?;
            f.write_all(manifest_content.as_bytes())
                .map_err(|e| format!("Failed to write manifest temp file: {e}"))?;
            f.sync_all()
                .map_err(|e| format!("Failed to sync manifest temp file: {e}"))?;
            drop(f);
            super::fs_utils::atomic_rename(&tmp_path, &archive_manifest_path)?;

            // Update global manifest
            let entry = ArchiveEntry {
                id: archive_id.clone(),
                name: name.clone(),
                description: description.clone(),
                created_at: created_at.clone(),
                source_provider,
                source_project_path,
                source_project_name,
                session_count,
                total_size_bytes: total_size,
                include_subagents,
            };

            let mut global = load_manifest()?;
            global.archives.push(entry.clone());
            save_manifest(&global)?;

            Ok(entry)
        })(); // end inner closure

        if result.is_err() {
            let _ = fs::remove_dir_all(&archive_dir);
        }

        result
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Deletes an archive directory and removes it from the global manifest.
///
/// # Arguments
/// * `archive_id` - UUID of the archive to delete
#[tauri::command]
pub async fn delete_archive(archive_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_archive_id(&archive_id)?;

        // Update manifest first, then delete directory.
        // An orphan directory is recoverable; a dangling manifest entry is not.
        let mut manifest = load_manifest()?;
        let initial_len = manifest.archives.len();
        manifest.archives.retain(|a| a.id != archive_id);

        if manifest.archives.len() == initial_len {
            return Err(format!("Archive not found in manifest: {archive_id}"));
        }

        save_manifest(&manifest)?;

        let archive_dir = get_archive_dir(&archive_id)?;
        if archive_dir.exists() {
            fs::remove_dir_all(&archive_dir)
                .map_err(|e| format!("Failed to delete archive directory: {e}"))?;
        }

        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Renames an archive (updates name in manifest and renames the directory).
///
/// # Arguments
/// * `archive_id` - Current archive ID (directory name)
/// * `new_name` - New human-readable name
///
/// Returns the new archive ID (new directory name) so the frontend can update references.
#[tauri::command]
pub async fn rename_archive(archive_id: String, new_name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_archive_id(&archive_id)?;

        if new_name.trim().is_empty() {
            return Err("Archive name must not be empty".to_string());
        }

        let mut manifest = load_manifest()?;
        let entry = manifest
            .archives
            .iter_mut()
            .find(|a| a.id == archive_id)
            .ok_or_else(|| format!("Archive not found: {archive_id}"))?;

        // Generate new directory name from the new name
        // Extract short UUID from old ID (last 8 chars after final underscore, or first 8 of UUID)
        let short_uuid = archive_id
            .rsplit('_')
            .next()
            .filter(|s| s.len() == 8 && s.chars().all(|c| c.is_ascii_hexdigit()))
            .unwrap_or(&archive_id[..8.min(archive_id.len())]);

        let sanitized = sanitize_for_dirname(&new_name);
        let new_id = if sanitized.is_empty() {
            archive_id.clone()
        } else {
            format!("{sanitized}_{short_uuid}")
        };

        entry.name.clone_from(&new_name);
        entry.id.clone_from(&new_id);

        // Rename the directory if the ID changed
        let archives_dir = get_archives_dir()?;
        let old_dir = archives_dir.join(&archive_id);
        let new_dir = archives_dir.join(&new_id);

        if archive_id != new_id && old_dir.exists() {
            if new_dir.exists() {
                return Err(format!(
                    "Target directory already exists: {}",
                    new_dir.display()
                ));
            }
            fs::rename(&old_dir, &new_dir)
                .map_err(|e| format!("Failed to rename archive directory: {e}"))?;
        }

        // Update the per-archive manifest.json if it exists
        let per_manifest_path = new_dir.join("manifest.json");
        if per_manifest_path.exists() {
            let content = fs::read_to_string(&per_manifest_path)
                .map_err(|e| format!("Failed to read per-archive manifest: {e}"))?;
            let mut val: serde_json::Value = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse per-archive manifest: {e}"))?;
            val["name"] = serde_json::Value::String(new_name);
            val["archiveId"] = serde_json::Value::String(new_id.clone());
            let updated = serde_json::to_string_pretty(&val)
                .map_err(|e| format!("Failed to serialize per-archive manifest: {e}"))?;
            let tmp = per_manifest_path.with_extension(format!("json.{}.tmp", Uuid::new_v4()));
            let mut f = fs::File::create(&tmp)
                .map_err(|e| format!("Failed to create temp manifest file: {e}"))?;
            f.write_all(updated.as_bytes())
                .map_err(|e| format!("Failed to write temp manifest file: {e}"))?;
            f.sync_all()
                .map_err(|e| format!("Failed to sync temp manifest file: {e}"))?;
            drop(f);
            super::fs_utils::atomic_rename(&tmp, &per_manifest_path)?;
        }

        save_manifest(&manifest)?;
        Ok(new_id)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Lists all sessions stored within a specific archive.
///
/// # Arguments
/// * `archive_id` - UUID of the archive
#[tauri::command]
pub async fn get_archive_sessions(archive_id: String) -> Result<Vec<ArchiveSessionInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_archive_id(&archive_id)?;

        let archive_dir = get_archives_dir()?.join(&archive_id);
        if !archive_dir.exists() {
            return Err(format!("Archive not found: {archive_id}"));
        }

        let sessions_dir = archive_dir.join("sessions");
        let subagents_dir = archive_dir.join("subagents");

        if !sessions_dir.exists() {
            return Ok(Vec::new());
        }

        // Try to load metadata from the per-archive manifest for richer information
        let per_manifest: Option<serde_json::Value> = {
            let path = archive_dir.join("manifest.json");
            fs::read_to_string(&path)
                .ok()
                .and_then(|c| serde_json::from_str(&c).ok())
        };

        let session_meta_map: std::collections::HashMap<String, serde_json::Value> =
            if let Some(ref pm) = per_manifest {
                pm.get("sessions")
                    .and_then(serde_json::Value::as_array)
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|s| {
                                s.get("fileName")
                                    .and_then(serde_json::Value::as_str)
                                    .map(|k| (k.to_string(), s.clone()))
                            })
                            .collect()
                    })
                    .unwrap_or_default()
            } else {
                std::collections::HashMap::new()
            };

        let mut sessions = Vec::new();

        let rd = fs::read_dir(&sessions_dir)
            .map_err(|e| format!("Failed to read sessions directory: {e}"))?;

        for entry in rd.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }

            let file_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let size_bytes = path.metadata().map(|m| m.len()).unwrap_or(0);

            // Prefer cached metadata from manifest, fall back to live parsing
            let (message_count, first_message_time, last_message_time, summary) =
                if let Some(meta) = session_meta_map.get(&file_name) {
                    (
                        meta.get("messageCount")
                            .and_then(serde_json::Value::as_u64)
                            .map(|n| n as usize)
                            .unwrap_or_else(|| count_messages(&path)),
                        meta.get("firstMessageTime")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                        meta.get("lastMessageTime")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                        meta.get("summary")
                            .and_then(serde_json::Value::as_str)
                            .map(str::to_string),
                    )
                } else {
                    let (mc, first, last, sum) = extract_session_metadata(&path);
                    (mc, first, last, sum)
                };

            // Collect subagent file info for this session
            let (subagent_count, subagent_size_bytes, subagents) = {
                let sa_dir = subagents_dir.join(&stem);
                let mut sa_list: Vec<SubagentFileInfo> = Vec::new();
                let mut total_sa_size: u64 = 0;

                if sa_dir.exists() {
                    if let Ok(rd) = fs::read_dir(&sa_dir) {
                        for sa_entry in rd.flatten() {
                            let sa_path = sa_entry.path();
                            if sa_path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                                continue;
                            }
                            let sa_file_name = sa_path
                                .file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("")
                                .to_string();
                            let sa_size = sa_path.metadata().map(|m| m.len()).unwrap_or(0);
                            let sa_msg_count = count_messages(&sa_path);
                            total_sa_size += sa_size;
                            sa_list.push(SubagentFileInfo {
                                file_name: sa_file_name,
                                size_bytes: sa_size,
                                message_count: sa_msg_count,
                            });
                        }
                    }
                }
                sa_list.sort_by(|a, b| a.file_name.cmp(&b.file_name));

                (sa_list.len() as u32, total_sa_size, sa_list)
            };

            // Try to get the original file path from metadata
            let original_file_path = if let Some(meta) = session_meta_map.get(&file_name) {
                meta.get("originalFilePath")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("")
                    .to_string()
            } else {
                String::new()
            };

            sessions.push(ArchiveSessionInfo {
                session_id: stem,
                file_name,
                original_file_path,
                message_count,
                first_message_time,
                last_message_time,
                summary,
                size_bytes,
                subagent_count,
                subagent_size_bytes,
                subagents,
            });
        }

        // Sort by first message time descending (newest first), falling back to file name
        sessions.sort_by(|a, b| {
            b.first_message_time
                .cmp(&a.first_message_time)
                .then_with(|| b.file_name.cmp(&a.file_name))
        });

        Ok(sessions)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Loads all messages from a specific session file within an archive.
///
/// Constructs the full path from `archive_id` and `session_file_name`, then
/// delegates to the existing session loader.
///
/// # Arguments
/// * `archive_id` - UUID of the archive
/// * `session_file_name` - File name (e.g. `"abc123.jsonl"`) within the archive's sessions/ dir
#[tauri::command]
pub async fn load_archive_session_messages(
    archive_id: String,
    session_file_name: String,
) -> Result<Vec<crate::models::ClaudeMessage>, String> {
    // Validate archive ID
    validate_archive_id(&archive_id).map_err(|e| format!("Invalid archive ID: {e}"))?;

    // Validate session file name for path traversal
    if session_file_name.contains('/')
        || session_file_name.contains('\\')
        || session_file_name.contains("..")
    {
        return Err(format!(
            "Invalid session file name '{session_file_name}': must not contain path separators or '..'"
        ));
    }
    if !Path::new(&session_file_name)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("jsonl"))
    {
        return Err(format!(
            "Invalid session file name '{session_file_name}': must end with .jsonl"
        ));
    }

    let session_path = {
        let archives_dir = get_archives_dir()?;
        archives_dir
            .join(&archive_id)
            .join("sessions")
            .join(&session_file_name)
    };

    if !session_path.exists() {
        return Err(format!(
            "Session file not found in archive: {}",
            session_path.display()
        ));
    }

    let path_str = session_path.to_string_lossy().to_string();

    // Delegate to the existing session message loader
    crate::commands::session::load_session_messages(path_str).await
}

/// Calculates the total disk usage of all archives.
#[tauri::command]
pub async fn get_archive_disk_usage() -> Result<ArchiveDiskUsage, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let archives_dir = get_archives_dir()?;

        if !archives_dir.exists() {
            return Ok(ArchiveDiskUsage {
                total_bytes: 0,
                archive_count: 0,
                session_count: 0,
                per_archive: Vec::new(),
            });
        }

        let manifest = load_manifest()?;
        let mut total_bytes: u64 = 0;
        let mut total_sessions: usize = 0;
        let mut per_archive: Vec<ArchiveDiskEntry> = Vec::new();

        for entry in &manifest.archives {
            let archive_dir = archives_dir.join(&entry.id);
            let size = dir_size(&archive_dir);
            let session_count = entry.session_count;

            total_bytes += size;
            total_sessions += session_count as usize;

            per_archive.push(ArchiveDiskEntry {
                archive_id: entry.id.clone(),
                archive_name: entry.name.clone(),
                size_bytes: size,
                session_count,
            });
        }

        Ok(ArchiveDiskUsage {
            total_bytes,
            archive_count: manifest.archives.len(),
            session_count: total_sessions,
            per_archive,
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Finds sessions within `project_path` that are close to expiring.
///
/// Reads `~/.claude/settings.json` to determine `cleanupPeriodDays` (default: 30).
/// A session is "expiring" when its file modification time is within
/// `threshold_days` days of the cleanup boundary.
///
/// # Arguments
/// * `project_path` - Absolute path to the Claude project directory (containing JSONL files)
/// * `threshold_days` - Number of days before expiry to consider "expiring"
#[tauri::command]
pub async fn get_expiring_sessions(
    project_path: String,
    threshold_days: i64,
) -> Result<Vec<ExpiringSession>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Security: reject path traversal
        let project_pb = PathBuf::from(&project_path);
        if !project_pb.is_absolute() {
            return Err("project_path must be absolute".to_string());
        }
        if project_pb
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err("project_path cannot contain '..' components".to_string());
        }
        if !project_pb.exists() {
            return Err(format!("project_path does not exist: {project_path}"));
        }

        // Read cleanupPeriodDays from ~/.claude/settings.json
        let cleanup_period_days: i64 = {
            let home = dirs::home_dir().ok_or("Could not find home directory")?;
            let settings_path = home.join(".claude").join("settings.json");
            if settings_path.exists() {
                fs::read_to_string(&settings_path)
                    .ok()
                    .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
                    .and_then(|v| {
                        v.get("cleanupPeriodDays")
                            .and_then(serde_json::Value::as_i64)
                    })
                    .unwrap_or(30)
            } else {
                30
            }
        };

        // Expiry boundary: files older than cleanup_period_days are expired.
        // "expiring" means they are within threshold_days of that boundary.
        // i.e. file mtime is older than (cleanup_period_days - threshold_days) days.
        let expiry_cutoff_days = (cleanup_period_days - threshold_days).max(0);

        let now = SystemTime::now();

        let rd = fs::read_dir(&project_pb)
            .map_err(|e| format!("Failed to read project directory: {e}"))?;

        let mut expiring = Vec::new();

        for entry in rd.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }

            let metadata = match path.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let file_size = metadata.len();
            let mtime = match metadata.modified() {
                Ok(t) => t,
                Err(_) => continue,
            };

            let age_secs = now.duration_since(mtime).map(|d| d.as_secs()).unwrap_or(0);
            #[allow(clippy::cast_possible_wrap)]
            let age_days = (age_secs / 86400) as i64;

            // If the file is already past the expiry_cutoff_days, it qualifies
            if age_days >= expiry_cutoff_days {
                let days_remaining = (cleanup_period_days - age_days).max(0);

                // Load the session info for this file
                let file_path_str = path.to_string_lossy().to_string();

                // Build a minimal ClaudeSession from file metadata + light parsing
                let (msg_count, first_ts, last_ts, summary) = extract_session_metadata(&path);
                let stem = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();

                // Extract project name from path
                let project_name = project_pb
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("unknown")
                    .to_string();

                let session = ClaudeSession {
                    session_id: file_path_str.clone(),
                    actual_session_id: stem,
                    file_path: file_path_str,
                    project_name,
                    message_count: msg_count,
                    first_message_time: first_ts,
                    last_message_time: last_ts,
                    last_modified: mtime
                        .duration_since(std::time::UNIX_EPOCH)
                        .ok()
                        .map(|d| {
                            chrono::DateTime::<Utc>::from(
                                SystemTime::UNIX_EPOCH
                                    + std::time::Duration::from_secs(d.as_secs()),
                            )
                            .to_rfc3339()
                        })
                        .unwrap_or_default(),
                    has_tool_use: false,
                    has_errors: false,
                    summary,
                    provider: None,
                };

                let subagent_count = find_subagent_files(&path).len() as u32;

                expiring.push(ExpiringSession {
                    session,
                    days_remaining,
                    file_size_bytes: file_size,
                    subagent_count,
                });
            }
        }

        // Sort by days_remaining ascending (most urgent first)
        expiring.sort_by_key(|e| e.days_remaining);

        Ok(expiring)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Exports a session file to either Markdown or JSON format.
///
/// # Arguments
/// * `session_file_path` - Absolute path to the JSONL session file
/// * `format` - Either `"markdown"` or `"json"`
#[tauri::command]
pub async fn export_session(
    session_file_path: String,
    format: String,
) -> Result<ExportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&session_file_path);

        // Security checks
        if !path.is_absolute() {
            return Err("session_file_path must be absolute".to_string());
        }
        if path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err("session_file_path cannot contain '..' components".to_string());
        }
        if !path.exists() {
            return Err(format!("Session file not found: {session_file_path}"));
        }

        let session_id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        let content = match format.as_str() {
            "json" => jsonl_to_json_array(&path)?,
            other => {
                return Err(format!(
                    "Unsupported export format '{other}': must be 'json'"
                ))
            }
        };

        Ok(ExportResult {
            content,
            format,
            session_id,
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use tempfile::TempDir;

    /// Sets up an isolated HOME directory for testing.
    /// NOTE: Must run with `--test-threads=1` because `env::set_var` is process-global.
    fn setup_test_env() -> TempDir {
        let dir = TempDir::new().unwrap();
        env::set_var("HOME", dir.path());
        dir
    }

    #[test]
    fn test_validate_archive_id_valid_uuid() {
        let id = Uuid::new_v4().to_string();
        assert!(validate_archive_id(&id).is_ok());
    }

    #[test]
    fn test_validate_archive_id_empty() {
        assert!(validate_archive_id("").is_err());
    }

    #[test]
    fn test_validate_archive_id_path_traversal() {
        assert!(validate_archive_id("../etc/passwd").is_err());
        assert!(validate_archive_id("abc/../def").is_err());
    }

    #[test]
    fn test_validate_archive_id_uppercase_accepted() {
        // Name-based IDs may contain mixed case
        assert!(validate_archive_id("UPPERCASE-UUID").is_ok());
    }

    #[test]
    fn test_validate_archive_id_invalid_chars() {
        assert!(validate_archive_id("abc!def").is_err());
        assert!(validate_archive_id("abc def").is_err());
        assert!(validate_archive_id("abc:def").is_err());
        assert!(validate_archive_id("abc*def").is_err());
        assert!(validate_archive_id("abc.def").is_err());
        assert!(validate_archive_id("abc/def").is_err());
        assert!(validate_archive_id("abc..def").is_err());
        assert!(validate_archive_id("abc\0def").is_err());
    }

    #[test]
    fn test_validate_archive_id_unicode_allowed() {
        assert!(validate_archive_id("프로젝트-백업_3f8a1b2c").is_ok());
    }

    #[test]
    fn test_sanitize_for_dirname() {
        assert_eq!(sanitize_for_dirname("Project Backup"), "Project-Backup");
        assert_eq!(sanitize_for_dirname("  spaces  "), "spaces");
        assert_eq!(sanitize_for_dirname("a/b\\c"), "a-b-c");
        assert_eq!(sanitize_for_dirname("a--b"), "a-b");
        assert_eq!(
            sanitize_for_dirname("프로젝트 백업 2026년 3월"),
            "프로젝트-백업-2026년-3월"
        );
        assert_eq!(sanitize_for_dirname("...dots..."), "dots");
        assert_eq!(sanitize_for_dirname(""), "");
    }

    #[test]
    fn test_create_archive_uses_name_based_id() {
        let _temp = setup_test_env();
        let session_dir = tempfile::tempdir().unwrap();
        let session_path = session_dir.path().join("name_id.jsonl");
        fs::write(&session_path, r#"{"type":"user","timestamp":"2026-01-01T00:00:00Z","message":{"role":"user","content":"hi"}}"#).unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let entry = rt
            .block_on(create_archive(
                "My Project Backup".to_string(),
                None,
                vec![session_path.to_string_lossy().to_string()],
                "claude".to_string(),
                "/p".to_string(),
                "p".to_string(),
                false,
            ))
            .unwrap();

        assert!(entry.id.starts_with("My-Project-Backup_"));
        // 8-char hex suffix
        let suffix = entry.id.rsplit('_').next().unwrap();
        assert_eq!(suffix.len(), 8);
        assert!(suffix.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_load_manifest_default_when_missing() {
        let _temp = setup_test_env();
        let manifest = load_manifest().unwrap();
        assert_eq!(manifest.version, 1);
        assert!(manifest.archives.is_empty());
    }

    #[test]
    fn test_save_and_load_manifest() {
        let _temp = setup_test_env();

        let manifest = ArchiveManifest {
            version: 1,
            archives: vec![ArchiveEntry {
                id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_string(),
                name: "Test Archive".to_string(),
                description: Some("A test".to_string()),
                created_at: "2026-01-01T00:00:00Z".to_string(),
                source_provider: "claude".to_string(),
                source_project_path: "/home/user/project".to_string(),
                source_project_name: "my-project".to_string(),
                session_count: 3,
                total_size_bytes: 12345,
                include_subagents: false,
            }],
        };

        save_manifest(&manifest).unwrap();
        let loaded = load_manifest().unwrap();

        assert_eq!(loaded.archives.len(), 1);
        assert_eq!(loaded.archives[0].name, "Test Archive");
        assert_eq!(loaded.archives[0].session_count, 3);
    }

    #[test]
    fn test_count_messages_empty_file() {
        let _temp = setup_test_env();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("empty.jsonl");
        fs::write(&path, "").unwrap();
        assert_eq!(count_messages(&path), 0);
    }

    #[test]
    fn test_count_messages_skips_sidechain() {
        let _temp = setup_test_env();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        let content = r#"{"type":"user","isSidechain":false,"timestamp":"2026-01-01T00:00:00Z"}
{"type":"assistant","isSidechain":true,"timestamp":"2026-01-01T00:01:00Z"}
{"type":"assistant","isSidechain":false,"timestamp":"2026-01-01T00:02:00Z"}
"#;
        fs::write(&path, content).unwrap();
        // 2 non-sidechain messages
        assert_eq!(count_messages(&path), 2);
    }

    #[test]
    fn test_extract_timestamps() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        let content = r#"{"type":"user","timestamp":"2026-01-01T10:00:00Z"}
{"type":"assistant","timestamp":"2026-01-01T10:05:00Z"}
{"type":"user","timestamp":"2026-01-01T10:10:00Z"}
"#;
        fs::write(&path, content).unwrap();
        let (first, last) = extract_timestamps(&path);
        assert_eq!(first, "2026-01-01T10:00:00Z");
        assert_eq!(last, "2026-01-01T10:10:00Z");
    }

    #[test]
    fn test_extract_summary() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        let content = r#"{"type":"user","timestamp":"2026-01-01T10:00:00Z"}
{"type":"summary","summary":"A great conversation"}
"#;
        fs::write(&path, content).unwrap();
        let summary = extract_summary(&path);
        assert_eq!(summary, Some("A great conversation".to_string()));
    }

    #[test]
    fn test_extract_summary_none() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("no_summary.jsonl");
        let content = r#"{"type":"user","timestamp":"2026-01-01T10:00:00Z"}
"#;
        fs::write(&path, content).unwrap();
        assert_eq!(extract_summary(&path), None);
    }

    #[test]
    fn test_jsonl_to_json_array() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        let content = r#"{"type":"user","message":{"role":"user","content":"hello"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"world"}]}}
"#;
        fs::write(&path, content).unwrap();
        let result = jsonl_to_json_array(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert!(parsed.is_array());
        assert_eq!(parsed.as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn test_get_archive_base_path() {
        let _temp = setup_test_env();
        let path = get_archive_base_path().await.unwrap();
        assert!(path.contains(".claude-history-viewer"));
        assert!(path.contains("archives"));
    }

    #[tokio::test]
    async fn test_list_archives_empty() {
        let _temp = setup_test_env();
        let manifest = list_archives().await.unwrap();
        assert!(manifest.archives.is_empty());
    }

    #[tokio::test]
    async fn test_create_and_list_archive() {
        let _temp = setup_test_env();

        // Create a temporary session file
        let session_dir = tempfile::tempdir().unwrap();
        let session_path = session_dir.path().join("session123.jsonl");
        let content = r#"{"type":"user","timestamp":"2026-01-01T10:00:00Z","message":{"role":"user","content":"hello"}}
{"type":"assistant","timestamp":"2026-01-01T10:01:00Z","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}
"#;
        fs::write(&session_path, content).unwrap();

        let result = create_archive(
            "Test Archive".to_string(),
            Some("A test archive".to_string()),
            vec![session_path.to_string_lossy().to_string()],
            "claude".to_string(),
            "/home/user/project".to_string(),
            "my-project".to_string(),
            false,
        )
        .await
        .unwrap();

        assert_eq!(result.name, "Test Archive");
        assert_eq!(result.session_count, 1);
        assert_eq!(result.source_provider, "claude");

        // Verify it appears in the list
        let manifest = list_archives().await.unwrap();
        assert_eq!(manifest.archives.len(), 1);
        assert_eq!(manifest.archives[0].name, "Test Archive");
    }

    #[tokio::test]
    async fn test_delete_archive() {
        let _temp = setup_test_env();

        // Create a session file
        let session_dir = tempfile::tempdir().unwrap();
        let session_path = session_dir.path().join("del_session.jsonl");
        fs::write(&session_path, r#"{"type":"user","timestamp":"2026-01-01T00:00:00Z","message":{"role":"user","content":"bye"}}"#).unwrap();

        let entry = create_archive(
            "To Delete".to_string(),
            None,
            vec![session_path.to_string_lossy().to_string()],
            "claude".to_string(),
            "/p".to_string(),
            "p".to_string(),
            false,
        )
        .await
        .unwrap();

        let id = entry.id.clone();
        delete_archive(id.clone()).await.unwrap();

        let manifest = list_archives().await.unwrap();
        assert!(!manifest.archives.iter().any(|a| a.id == id));
    }

    #[tokio::test]
    async fn test_rename_archive() {
        let _temp = setup_test_env();

        let session_dir = tempfile::tempdir().unwrap();
        let session_path = session_dir.path().join("rename_session.jsonl");
        fs::write(&session_path, r#"{"type":"user","timestamp":"2026-01-01T00:00:00Z","message":{"role":"user","content":"hello"}}"#).unwrap();

        let entry = create_archive(
            "Old Name".to_string(),
            None,
            vec![session_path.to_string_lossy().to_string()],
            "claude".to_string(),
            "/p".to_string(),
            "p".to_string(),
            false,
        )
        .await
        .unwrap();

        let new_id = rename_archive(entry.id.clone(), "New Name".to_string())
            .await
            .unwrap();

        // ID changes to name-based format
        assert!(new_id.starts_with("New-Name_"));
        assert_ne!(new_id, entry.id);

        let manifest = list_archives().await.unwrap();
        let updated = manifest.archives.iter().find(|a| a.id == new_id).unwrap();
        assert_eq!(updated.name, "New Name");

        // Old directory should not exist, new one should
        let archives_dir = get_archives_dir().unwrap();
        assert!(!archives_dir.join(&entry.id).exists());
        assert!(archives_dir.join(&new_id).exists());
    }

    #[tokio::test]
    async fn test_rename_archive_empty_name_rejected() {
        let _temp = setup_test_env();

        let session_dir = tempfile::tempdir().unwrap();
        let session_path = session_dir.path().join("ren2.jsonl");
        fs::write(&session_path, r#"{"type":"user","timestamp":"2026-01-01T00:00:00Z","message":{"role":"user","content":"x"}}"#).unwrap();

        let entry = create_archive(
            "Valid".to_string(),
            None,
            vec![session_path.to_string_lossy().to_string()],
            "claude".to_string(),
            "/p".to_string(),
            "p".to_string(),
            false,
        )
        .await
        .unwrap();

        let result = rename_archive(entry.id, "   ".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_archive_sessions() {
        let _temp = setup_test_env();

        let session_dir = tempfile::tempdir().unwrap();
        let session_path = session_dir.path().join("sess_abc.jsonl");
        let content = r#"{"type":"user","timestamp":"2026-02-01T08:00:00Z","message":{"role":"user","content":"question"}}
{"type":"summary","summary":"A good talk"}
"#;
        fs::write(&session_path, content).unwrap();

        let entry = create_archive(
            "Session List Test".to_string(),
            None,
            vec![session_path.to_string_lossy().to_string()],
            "claude".to_string(),
            "/project".to_string(),
            "test-project".to_string(),
            false,
        )
        .await
        .unwrap();

        let sessions = get_archive_sessions(entry.id).await.unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].file_name, "sess_abc.jsonl");
        assert_eq!(sessions[0].first_message_time, "2026-02-01T08:00:00Z");
        assert_eq!(sessions[0].summary, Some("A good talk".to_string()));
    }

    #[tokio::test]
    async fn test_export_session_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("export.jsonl");
        let content = r#"{"type":"user","timestamp":"2026-01-01T00:00:00Z","message":{"role":"user","content":"hi"}}
"#;
        fs::write(&path, content).unwrap();

        let result = export_session(path.to_string_lossy().to_string(), "json".to_string())
            .await
            .unwrap();

        assert_eq!(result.format, "json");
        assert_eq!(result.session_id, "export");
        let parsed: serde_json::Value = serde_json::from_str(&result.content).unwrap();
        assert!(parsed.is_array());
        assert_eq!(parsed.as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn test_export_session_invalid_format() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad_fmt.jsonl");
        fs::write(&path, "").unwrap();

        let result = export_session(path.to_string_lossy().to_string(), "pdf".to_string()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unsupported export format"));
    }

    #[tokio::test]
    async fn test_export_session_relative_path_rejected() {
        let result =
            export_session("relative/path/file.jsonl".to_string(), "json".to_string()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("absolute"));
    }

    #[tokio::test]
    async fn test_get_archive_disk_usage_empty() {
        let _temp = setup_test_env();
        let usage = get_archive_disk_usage().await.unwrap();
        assert_eq!(usage.archive_count, 0);
        assert_eq!(usage.total_bytes, 0);
        assert_eq!(usage.session_count, 0);
    }

    #[tokio::test]
    async fn test_get_archive_disk_usage_with_archive() {
        let _temp = setup_test_env();

        let session_dir = tempfile::tempdir().unwrap();
        let session_path = session_dir.path().join("disk_usage.jsonl");
        fs::write(&session_path, r#"{"type":"user","timestamp":"2026-01-01T00:00:00Z","message":{"role":"user","content":"content here for size"}}"#).unwrap();

        create_archive(
            "Disk Usage Test".to_string(),
            None,
            vec![session_path.to_string_lossy().to_string()],
            "claude".to_string(),
            "/p".to_string(),
            "p".to_string(),
            false,
        )
        .await
        .unwrap();

        let usage = get_archive_disk_usage().await.unwrap();
        assert_eq!(usage.archive_count, 1);
        assert!(usage.total_bytes > 0);
        assert_eq!(usage.session_count, 1);
        assert_eq!(usage.per_archive.len(), 1);
    }

    #[test]
    fn test_dir_size_nonexistent() {
        assert_eq!(dir_size(Path::new("/nonexistent/path/xyz")), 0);
    }

    #[test]
    fn test_archive_manifest_default() {
        let m = ArchiveManifest::default();
        assert_eq!(m.version, 1);
        assert!(m.archives.is_empty());
    }

    #[tokio::test]
    async fn test_migration_uuid_to_name_based() {
        let _temp = setup_test_env();

        // Create an archive with a UUID-based ID (simulating legacy)
        let session_dir = tempfile::tempdir().unwrap();
        let session_path = session_dir.path().join("migrate.jsonl");
        fs::write(&session_path, r#"{"type":"user","timestamp":"2026-01-01T00:00:00Z","message":{"role":"user","content":"hi"}}"#).unwrap();

        let entry = create_archive(
            "Legacy Archive".to_string(),
            None,
            vec![session_path.to_string_lossy().to_string()],
            "claude".to_string(),
            "/p".to_string(),
            "p".to_string(),
            false,
        )
        .await
        .unwrap();

        // Manually revert the ID to a UUID to simulate a legacy archive
        let archives_dir = get_archives_dir().unwrap();
        let current_dir = archives_dir.join(&entry.id);
        let legacy_uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        let legacy_dir = archives_dir.join(legacy_uuid);
        fs::rename(&current_dir, &legacy_dir).unwrap();

        // Update manifest to use legacy UUID
        let mut manifest = load_manifest().unwrap();
        manifest.archives[0].id = legacy_uuid.to_string();
        save_manifest(&manifest).unwrap();

        // Now list_archives should trigger migration
        let migrated = list_archives().await.unwrap();
        let migrated_entry = &migrated.archives[0];

        // Should have name-based ID now
        assert!(migrated_entry.id.starts_with("Legacy-Archive_"));
        assert!(migrated_entry.id.ends_with("_aaaaaaaa"));
        assert_eq!(migrated_entry.name, "Legacy Archive");

        // Old directory should not exist, new one should
        assert!(!legacy_dir.exists());
        assert!(archives_dir.join(&migrated_entry.id).exists());
    }
}
