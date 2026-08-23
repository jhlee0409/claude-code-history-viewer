//! File edit and restore functions

use crate::models::{ClaudeMessage, RawLogEntry, RecentFileEdit};
use crate::providers;
use crate::utils::find_line_ranges;
use memmap2::Mmap;
use rayon::prelude::*;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EditsProvider {
    Claude,
    Codex,
    ForgeCode,
    OpenCode,
}

fn detect_project_provider(project_path: &str) -> EditsProvider {
    if project_path.starts_with("codex://") {
        EditsProvider::Codex
    } else if project_path.starts_with("forgecode://") {
        EditsProvider::ForgeCode
    } else if project_path.starts_with("opencode://") {
        EditsProvider::OpenCode
    } else {
        EditsProvider::Claude
    }
}

/// Page size when the caller does not ask for one.
const DEFAULT_PAGE_LIMIT: usize = 20;

/// Upper bound on a caller-supplied page size. Each returned row costs one
/// `fs::metadata` call, so the page size bounds the syscall cost of a request.
const MAX_PAGE_LIMIT: usize = 200;

/// How the raw edit stream is reduced before pagination.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum EditsGrouping {
    /// One row per file, carrying that file's latest state.
    #[default]
    File,
    /// One row per edit event, chronological.
    Edit,
}

impl EditsGrouping {
    /// Anything other than an explicit "edit" keeps today's behaviour, so an
    /// older client or a stale stored value cannot change what it sees.
    fn from_param(value: Option<&str>) -> Self {
        match value {
            Some("edit") => Self::Edit,
            _ => Self::File,
        }
    }
}

/// Intermediate result from processing a single session file (for parallel processing)
struct SessionEditsResult {
    edits: Vec<RecentFileEdit>,
    cwd_counts: HashMap<String, usize>,
}

/// Process a single session file and extract edit information
#[allow(unsafe_code)] // Required for mmap performance optimization
fn process_session_file_for_edits(file_path: &PathBuf) -> Option<SessionEditsResult> {
    let file = fs::File::open(file_path).ok()?;

    // SAFETY: We're only reading the file, and the file handle is kept open
    // for the duration of the mmap's lifetime. Session files are append-only.
    let mmap = unsafe { Mmap::map(&file) }.ok()?;

    let mut edits: Vec<RecentFileEdit> = Vec::with_capacity(16);
    let mut cwd_counts: HashMap<String, usize> = HashMap::new();

    // Use SIMD-accelerated line detection
    let line_ranges = find_line_ranges(&mmap);

    for (start, end) in line_ranges {
        // simd-json requires mutable slice
        let mut line_bytes = mmap[start..end].to_vec();

        let log_entry: RawLogEntry = match simd_json::serde::from_slice(&mut line_bytes) {
            Ok(entry) => entry,
            Err(_) => continue,
        };

        // Extract common fields
        let timestamp = log_entry.timestamp.clone().unwrap_or_default();
        let session_id = log_entry
            .session_id
            .clone()
            .unwrap_or_else(|| "unknown".to_string());
        let cwd = log_entry.cwd.clone();

        // Track cwd frequency to determine project directory
        if let Some(cwd_path) = cwd.as_ref() {
            *cwd_counts.entry(cwd_path.clone()).or_insert(0) += 1;
        }

        // Process tool use results for Edit and Write operations
        if let Some(tool_use_result) = &log_entry.tool_use_result {
            // Handle Write/Create tool results (type: "create")
            if tool_use_result.get("type").and_then(|v| v.as_str()) == Some("create") {
                if let (Some(file_path_str), Some(content)) = (
                    tool_use_result.get("filePath").and_then(|v| v.as_str()),
                    tool_use_result.get("content").and_then(|v| v.as_str()),
                ) {
                    edits.push(RecentFileEdit {
                        file_path: file_path_str.to_string(),
                        timestamp: timestamp.clone(),
                        session_id: session_id.clone(),
                        operation_type: "write".to_string(),
                        content_after_change: content.to_string(),
                        original_content: None,
                        lines_added: content.lines().count(),
                        lines_removed: 0,
                        cwd: cwd.clone(),
                        message_uuid: log_entry.uuid.clone(),
                        exists_on_disk: None,
                    });
                }
            }

            // Handle Edit tool results
            if let Some(file_path_val) = tool_use_result.get("filePath") {
                if let Some(file_path_str) = file_path_val.as_str() {
                    if let Some(edits_arr_val) = tool_use_result.get("edits") {
                        // Multi-edit format
                        if let Some(original) =
                            tool_use_result.get("originalFile").and_then(|v| v.as_str())
                        {
                            let mut content = original.to_string();
                            let mut lines_added = 0usize;
                            let mut lines_removed = 0usize;

                            if let Some(edits_arr) = edits_arr_val.as_array() {
                                for edit in edits_arr {
                                    if let (Some(old_str), Some(new_str)) = (
                                        edit.get("old_string").and_then(|v| v.as_str()),
                                        edit.get("new_string").and_then(|v| v.as_str()),
                                    ) {
                                        content = content.replacen(old_str, new_str, 1);
                                        lines_removed += old_str.lines().count();
                                        lines_added += new_str.lines().count();
                                    }
                                }
                            }

                            edits.push(RecentFileEdit {
                                file_path: file_path_str.to_string(),
                                timestamp: timestamp.clone(),
                                session_id: session_id.clone(),
                                operation_type: "edit".to_string(),
                                content_after_change: content,
                                original_content: Some(original.to_string()),
                                lines_added,
                                lines_removed,
                                cwd: cwd.clone(),
                                message_uuid: log_entry.uuid.clone(),
                                exists_on_disk: None,
                            });
                        }
                    } else if let (Some(old_str), Some(new_str)) = (
                        tool_use_result.get("oldString").and_then(|v| v.as_str()),
                        tool_use_result.get("newString").and_then(|v| v.as_str()),
                    ) {
                        // Single edit format
                        if let Some(original) =
                            tool_use_result.get("originalFile").and_then(|v| v.as_str())
                        {
                            let content = original.replacen(old_str, new_str, 1);

                            edits.push(RecentFileEdit {
                                file_path: file_path_str.to_string(),
                                timestamp: timestamp.clone(),
                                session_id: session_id.clone(),
                                operation_type: "edit".to_string(),
                                content_after_change: content,
                                original_content: Some(original.to_string()),
                                lines_added: new_str.lines().count(),
                                lines_removed: old_str.lines().count(),
                                cwd: cwd.clone(),
                                message_uuid: log_entry.uuid.clone(),
                                exists_on_disk: None,
                            });
                        }
                    }
                }
            }
        }

        // Also check tool_use for Write operations
        if let Some(tool_use) = &log_entry.tool_use {
            if let Some(name) = tool_use.get("name").and_then(|v| v.as_str()) {
                if name == "Write" {
                    if let Some(input) = tool_use.get("input") {
                        if let (Some(path), Some(content)) = (
                            input.get("file_path").and_then(|v| v.as_str()),
                            input.get("content").and_then(|v| v.as_str()),
                        ) {
                            edits.push(RecentFileEdit {
                                file_path: path.to_string(),
                                timestamp: timestamp.clone(),
                                session_id: session_id.clone(),
                                operation_type: "write".to_string(),
                                content_after_change: content.to_string(),
                                original_content: None,
                                lines_added: content.lines().count(),
                                lines_removed: 0,
                                cwd: cwd.clone(),
                                message_uuid: log_entry.uuid.clone(),
                                exists_on_disk: None,
                            });
                        }
                    }
                }
            }
        }
    }

    Some(SessionEditsResult { edits, cwd_counts })
}

fn resolve_provider_project_cwd(provider: EditsProvider, project_path: &str) -> Option<String> {
    match provider {
        EditsProvider::Claude => Some(project_path.to_string()),
        EditsProvider::Codex => {
            let cwd = project_path
                .strip_prefix("codex://")
                .unwrap_or(project_path)
                .to_string();
            if cwd.is_empty() || cwd == "unknown" {
                None
            } else {
                Some(cwd)
            }
        }
        EditsProvider::ForgeCode => {
            // ForgeCode projects use virtual paths (forgecode://workspace/{id}).
            // Resolve the actual filesystem CWD from project metadata when available.
            let projects = providers::forgecode::scan_projects().ok()?;
            let project = projects.into_iter().find(|p| p.path == project_path)?;
            // actual_path for ForgeCode is always a virtual path, so we cannot use it
            // as a filesystem CWD for filtering. Return None to include all edits.
            if project.actual_path.is_empty() || project.actual_path.starts_with("forgecode://") {
                None
            } else {
                Some(project.actual_path)
            }
        }
        EditsProvider::OpenCode => {
            let projects = providers::opencode::scan_projects().ok()?;
            projects
                .into_iter()
                .find(|project| project.path == project_path)
                .and_then(|project| {
                    if project.actual_path.is_empty() {
                        None
                    } else {
                        Some(project.actual_path)
                    }
                })
        }
    }
}

fn infer_operation_type(tool_name: &str) -> Option<&'static str> {
    let normalized = tool_name.to_ascii_lowercase();

    if normalized == "write" || normalized == "create_file" || normalized == "write_to_file" {
        return Some("write");
    }

    if normalized == "edit"
        || normalized == "multiedit"
        || normalized == "replace_file_content"
        || normalized == "replace"
        || normalized == "apply_patch"
    {
        return Some("edit");
    }

    None
}

fn get_first_string(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(raw) = value.get(*key).and_then(serde_json::Value::as_str) {
            if !raw.is_empty() {
                return Some(raw.to_string());
            }
        }
    }
    None
}

fn resolve_file_path_from_input(input: &serde_json::Value) -> Option<String> {
    get_first_string(
        input,
        &["file_path", "path", "filePath", "TargetFile", "target_file"],
    )
}

fn normalize_relative_path(path: &str, project_cwd: Option<&str>) -> String {
    let input_path = Path::new(path);
    if input_path.is_absolute() {
        return path.to_string();
    }

    if let Some(cwd) = project_cwd {
        return Path::new(cwd)
            .join(input_path)
            .to_string_lossy()
            .to_string();
    }

    path.to_string()
}

fn parse_patch_file_paths(patch: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut files = Vec::new();

    for line in patch.lines() {
        let candidate = line
            .strip_prefix("*** Update File: ")
            .or_else(|| line.strip_prefix("*** Add File: "))
            .or_else(|| line.strip_prefix("*** Delete File: "))
            .or_else(|| line.strip_prefix("+++ "))
            .or_else(|| line.strip_prefix("--- "));

        let Some(raw_path) = candidate else {
            continue;
        };

        let trimmed = raw_path.trim();
        if trimmed.is_empty() || trimmed == "/dev/null" {
            continue;
        }

        let normalized = trimmed
            .strip_prefix("a/")
            .or_else(|| trimmed.strip_prefix("b/"))
            .unwrap_or(trimmed)
            .to_string();

        if seen.insert(normalized.clone()) {
            files.push(normalized);
        }
    }

    files
}

fn get_tool_input_content(input: &serde_json::Value) -> String {
    if let Some(content) = get_first_string(input, &["content", "new_string", "newString", "patch"])
    {
        return content;
    }
    input.to_string()
}

fn build_tool_use_edits(
    tool_name: &str,
    input: &serde_json::Value,
    timestamp: &str,
    session_id: &str,
    message_uuid: Option<&str>,
    project_cwd: Option<&str>,
) -> Vec<RecentFileEdit> {
    let Some(operation_type) = infer_operation_type(tool_name) else {
        return Vec::new();
    };

    let normalized_name = tool_name.to_ascii_lowercase();
    if normalized_name == "apply_patch" {
        let patch = get_first_string(input, &["patch"]).unwrap_or_default();
        if patch.is_empty() {
            return Vec::new();
        }

        let lines_added = patch
            .lines()
            .filter(|line| line.starts_with('+') && !line.starts_with("+++"))
            .count();
        let lines_removed = patch
            .lines()
            .filter(|line| line.starts_with('-') && !line.starts_with("---"))
            .count();

        let files = parse_patch_file_paths(&patch);
        return files
            .into_iter()
            .map(|path| RecentFileEdit {
                file_path: normalize_relative_path(&path, project_cwd),
                timestamp: timestamp.to_string(),
                session_id: session_id.to_string(),
                operation_type: operation_type.to_string(),
                content_after_change: patch.clone(),
                original_content: None,
                lines_added,
                lines_removed,
                cwd: project_cwd.map(str::to_string),
                message_uuid: message_uuid.map(str::to_string),
                exists_on_disk: None,
            })
            .collect();
    }

    let Some(path) = resolve_file_path_from_input(input) else {
        return Vec::new();
    };

    let content_after_change = get_tool_input_content(input);
    let lines_added = content_after_change.lines().count();
    let lines_removed = get_first_string(input, &["old_string", "oldString"])
        .map(|s| s.lines().count())
        .unwrap_or(0);

    vec![RecentFileEdit {
        file_path: normalize_relative_path(&path, project_cwd),
        timestamp: timestamp.to_string(),
        session_id: session_id.to_string(),
        operation_type: operation_type.to_string(),
        content_after_change,
        original_content: None,
        lines_added,
        lines_removed,
        cwd: project_cwd.map(str::to_string),
        message_uuid: message_uuid.map(str::to_string),
        exists_on_disk: None,
    }]
}

fn collect_provider_recent_edits_from_messages(
    messages: &[ClaudeMessage],
    project_cwd: Option<&str>,
) -> Vec<RecentFileEdit> {
    let mut edits = Vec::new();

    for message in messages {
        let timestamp = if message.timestamp.is_empty() {
            "unknown"
        } else {
            message.timestamp.as_str()
        };

        if let Some(content) = &message.content {
            if let Some(items) = content.as_array() {
                for item in items {
                    if item.get("type").and_then(serde_json::Value::as_str) != Some("tool_use") {
                        continue;
                    }
                    let Some(tool_name) = item.get("name").and_then(serde_json::Value::as_str)
                    else {
                        continue;
                    };
                    let input = item
                        .get("input")
                        .cloned()
                        .unwrap_or_else(|| serde_json::Value::Object(serde_json::Map::new()));
                    edits.extend(build_tool_use_edits(
                        tool_name,
                        &input,
                        timestamp,
                        &message.session_id,
                        Some(message.uuid.as_str()),
                        project_cwd,
                    ));
                }
            }
        }

        if let Some(tool_use) = &message.tool_use {
            if let Some(tool_name) = tool_use.get("name").and_then(serde_json::Value::as_str) {
                let input = tool_use
                    .get("input")
                    .cloned()
                    .unwrap_or_else(|| serde_json::Value::Object(serde_json::Map::new()));
                edits.extend(build_tool_use_edits(
                    tool_name,
                    &input,
                    timestamp,
                    &message.session_id,
                    Some(message.uuid.as_str()),
                    project_cwd,
                ));
            }
        }
    }

    edits
}

/// Split a path into comparison-ready components, resolving `.` and `..` textually
/// and folding case on Windows.
///
/// The edit paths come out of session logs, not from the filesystem walk, so they
/// can contain traversal segments. A raw `starts_with` on the string form accepts
/// `/repo/../secret` as being inside `/repo`, and also accepts `/repository/x`
/// because `/repo` is a character prefix of it.
fn comparable_path_parts(path: &str) -> Vec<String> {
    let mut parts: Vec<String> = Vec::new();
    for raw in path.split(['/', '\\']) {
        match raw {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            segment => {
                #[cfg(target_os = "windows")]
                parts.push(segment.to_lowercase());
                #[cfg(not(target_os = "windows"))]
                parts.push(segment.to_string());
            }
        }
    }
    parts
}

/// Identity of a file for grouping and counting, folding away separator and
/// (on Windows) case differences so one file cannot appear as two rows.
fn file_identity(path: &str) -> String {
    comparable_path_parts(path).join("/")
}

/// Whether `file_path` sits inside the directory described by `root_parts`.
fn path_is_within(file_path: &str, root_parts: &[String]) -> bool {
    let parts = comparable_path_parts(file_path);
    parts.len() > root_parts.len() && parts.starts_with(root_parts)
}

fn paginate_recent_edits(
    all_edits: Vec<RecentFileEdit>,
    project_cwd: Option<String>,
    offset: usize,
    limit: usize,
    grouping: EditsGrouping,
) -> PaginatedRecentEdits {
    // Filter edits to only include files within the project directory.
    let filtered_edits: Vec<RecentFileEdit> = if let Some(ref cwd) = project_cwd {
        let cwd_parts = comparable_path_parts(cwd);

        all_edits
            .into_iter()
            .filter(|edit| path_is_within(&edit.file_path, &cwd_parts))
            .collect()
    } else {
        all_edits
    };

    let total_edits_count = filtered_edits.len();

    // Sort by timestamp descending (newest first), breaking ties on the path so
    // the order is total. With only the timestamp as key, edits sharing an
    // instant (one tool call writing several files) tie in `HashMap` iteration
    // order, which differs between requests: page 2 could then repeat a row
    // from page 1 and silently drop another.
    let mut sorted_edits = filtered_edits;
    sorted_edits.sort_by(|a, b| {
        b.timestamp
            .cmp(&a.timestamp)
            .then_with(|| a.file_path.cmp(&b.file_path))
            .then_with(|| a.message_uuid.cmp(&b.message_uuid))
    });

    // Reported in both groupings, so a caller can always say how many distinct
    // files a session or project touched.
    //
    // Keyed on the same platform-aware identity that `path_is_within` uses, not
    // the raw string. On Windows `C:\Repo\a.rs` and `c:/repo/a.rs` are one file;
    // keying on the string counted them twice and produced two rows for it.
    let unique_files_count = sorted_edits
        .iter()
        .map(|edit| file_identity(&edit.file_path))
        .collect::<HashSet<_>>()
        .len();

    let files: Vec<RecentFileEdit> = match grouping {
        // Chronological: every edit event stands on its own, so a file edited
        // three times appears three times.
        EditsGrouping::Edit => sorted_edits,
        // Latest state: keep only the newest edit per file. `sorted_edits` is
        // already newest-first, so the first entry seen per path wins.
        EditsGrouping::File => {
            // Keyed on the normalized identity for the same reason as the count
            // above, while each row keeps its own `file_path` for display.
            let mut latest_by_file: HashMap<String, RecentFileEdit> = HashMap::new();
            for edit in sorted_edits {
                latest_by_file
                    .entry(file_identity(&edit.file_path))
                    .or_insert(edit);
            }
            let mut files: Vec<RecentFileEdit> = latest_by_file.into_values().collect();
            // Same total order as above; `into_values()` yields hash order.
            files.sort_by(|a, b| {
                b.timestamp
                    .cmp(&a.timestamp)
                    .then_with(|| a.file_path.cmp(&b.file_path))
            });
            files
        }
    };

    // `has_more` has to count against whatever the active grouping paginates.
    let population = match grouping {
        EditsGrouping::Edit => total_edits_count,
        EditsGrouping::File => unique_files_count,
    };

    // Apply pagination
    let mut paginated_files: Vec<RecentFileEdit> =
        files.into_iter().skip(offset).take(limit).collect();

    // Resolve existence only for the rows actually being returned. At a limit
    // of 20 that is 20 stat calls rather than one per raw edit, which matters
    // on a network or cloud-synced drive.
    for edit in &mut paginated_files {
        edit.exists_on_disk = Some(fs::metadata(&edit.file_path).is_ok());
    }

    let has_more = offset + paginated_files.len() < population;

    PaginatedRecentEdits {
        files: paginated_files,
        total_edits_count,
        unique_files_count,
        project_cwd,
        offset,
        limit,
        has_more,
    }
}

fn get_provider_recent_edits(
    provider: EditsProvider,
    project_path: &str,
    offset: usize,
    limit: usize,
    grouping: EditsGrouping,
    session_file_path: Option<&str>,
) -> Result<PaginatedRecentEdits, String> {
    let project_cwd = resolve_provider_project_cwd(provider, project_path);

    let sessions = match provider {
        EditsProvider::Codex => providers::codex::load_sessions(project_path, false)?,
        EditsProvider::ForgeCode => providers::forgecode::load_sessions(project_path, false)?,
        EditsProvider::OpenCode => providers::opencode::load_sessions(project_path, false)?,
        EditsProvider::Claude => {
            return Err("Claude provider should use legacy edits path".to_string())
        }
    };

    // Session scope applies to providers too. Without this the panel would show
    // the whole project while its header said "Session", and would pay for the
    // full scan as well.
    let sessions: Vec<_> = match session_file_path {
        Some(wanted) => sessions
            .into_iter()
            .filter(|session| session.file_path == wanted)
            .collect(),
        None => sessions,
    };

    let mut all_edits = Vec::new();
    for session in sessions {
        let messages = match provider {
            EditsProvider::Codex => providers::codex::load_messages(&session.file_path)?,
            EditsProvider::ForgeCode => providers::forgecode::load_messages(&session.file_path)?,
            EditsProvider::OpenCode => providers::opencode::load_messages(&session.file_path)?,
            EditsProvider::Claude => Vec::new(),
        };
        all_edits.extend(collect_provider_recent_edits_from_messages(
            &messages,
            project_cwd.as_deref(),
        ));
    }

    Ok(paginate_recent_edits(
        all_edits,
        project_cwd,
        offset,
        limit,
        grouping,
    ))
}

/// Paginated response for recent edits
#[derive(Debug, Clone, serde::Serialize)]
pub struct PaginatedRecentEdits {
    pub files: Vec<RecentFileEdit>,
    pub total_edits_count: usize,
    pub unique_files_count: usize,
    pub project_cwd: Option<String>,
    pub offset: usize,
    pub limit: usize,
    pub has_more: bool,
}

/// Confirm a caller-supplied session file really sits inside the project it
/// claims to belong to.
///
/// Modelled on `restore_file`'s validation: reject null bytes and traversal
/// segments up front as a cheap gate, then canonicalize both sides and compare,
/// so a symlink cannot smuggle a path out of the project either.
fn validate_session_file_in_project(
    session_file_path: &str,
    project_path: &str,
) -> Result<PathBuf, String> {
    if session_file_path.contains('\0') {
        return Err("Invalid session file path: contains null bytes".to_string());
    }

    let candidate = Path::new(session_file_path);
    for component in candidate.components() {
        if let std::path::Component::ParentDir = component {
            return Err("Invalid session file path: path traversal not allowed".to_string());
        }
    }

    // Require the same extension the directory walk requires. Without this any
    // file inside the project can be mmapped and scanned line by line: the
    // parsed result is harmless, but a multi-GB file costs a full read, and
    // under `--serve` a remote caller chooses the target.
    if candidate.extension().and_then(|e| e.to_str()) != Some("jsonl") {
        return Err("Invalid session file path: expected a .jsonl file".to_string());
    }

    // Reject a symlink outright, matching the policy `decode_project_path_verified`
    // already applies to project directories. `canonicalize` would happily follow
    // one out of the project and then report the resolved name as fine.
    if fs::symlink_metadata(candidate)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("Invalid session file path: symlinks are not allowed".to_string());
    }

    let project_root = fs::canonicalize(project_path)
        .map_err(|e| format!("Failed to resolve project path: {e}"))?;
    let resolved = fs::canonicalize(candidate)
        .map_err(|e| format!("Failed to resolve session file path: {e}"))?;

    if !resolved.starts_with(&project_root) {
        return Err("Invalid session file path: outside the project directory".to_string());
    }

    // Residual risk, accepted and recorded rather than silently ignored: the
    // caller reopens this path by name, so an entry swapped between here and
    // `File::open` would not be caught. Closing that fully means handing an open
    // handle down to `process_session_file_for_edits`, which is a larger change
    // than this belongs to. The remaining window needs a local attacker with
    // write access to the user's own session directory.
    Ok(resolved)
}

/// Scan a project's JSONL files and extract recent file edits/writes.
///
/// By default this returns the LATEST content for each unique file path, sorted
/// by timestamp descending, limited to files inside the project's working
/// directory, and paginated.
///
/// `session_file_path` narrows the scan to a single session file. That is both
/// faster (one mmap instead of a walk over every session in the project) and
/// more correct than filtering by session id: `actual_session_id` is only the
/// first id found in a file, so a resumed session whose id changes mid-file
/// would silently lose edits under id matching.
///
/// `grouping` selects the reduction: "file" (default) for one row per file,
/// "edit" for one row per edit event.
#[tauri::command]
pub async fn get_recent_edits(
    project_path: String,
    offset: Option<usize>,
    limit: Option<usize>,
    session_file_path: Option<String>,
    grouping: Option<String>,
) -> Result<PaginatedRecentEdits, String> {
    let offset = offset.unwrap_or(0);
    // Clamped because each returned row costs an `fs::metadata` call for
    // `exists_on_disk`. An unbounded caller-supplied limit turns one request
    // into an unbounded synchronous stat loop, which stalls the app and is a
    // remote stall vector under `--serve`.
    let limit = limit.unwrap_or(DEFAULT_PAGE_LIMIT).min(MAX_PAGE_LIMIT);
    let grouping = EditsGrouping::from_param(grouping.as_deref());
    let provider = detect_project_provider(&project_path);

    if provider != EditsProvider::Claude {
        return get_provider_recent_edits(
            provider,
            &project_path,
            offset,
            limit,
            grouping,
            session_file_path.as_deref(),
        );
    }

    // Phase 1: Collect the session files to scan
    let session_files: Vec<PathBuf> = match session_file_path.as_deref() {
        Some(path) => vec![validate_session_file_in_project(path, &project_path)?],
        None => WalkDir::new(&project_path)
            .into_iter()
            .filter_map(std::result::Result::ok)
            // Same symlink policy as the single-file path above. Without it the
            // two entry points disagree about what is in the project.
            .filter(|e| !e.path_is_symlink())
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
            .map(|e| e.path().to_path_buf())
            .collect(),
    };

    // Phase 2: Process files in parallel
    let file_results: Vec<SessionEditsResult> = session_files
        .par_iter()
        .filter_map(process_session_file_for_edits)
        .collect();

    // Phase 3: Aggregate results with pre-allocated capacity
    let total_edits_estimate: usize = file_results.iter().map(|r| r.edits.len()).sum();
    let mut all_edits: Vec<RecentFileEdit> = Vec::with_capacity(total_edits_estimate);
    let mut cwd_counts: HashMap<String, usize> = HashMap::new();

    for result in file_results {
        all_edits.extend(result.edits);
        for (cwd, count) in result.cwd_counts {
            *cwd_counts.entry(cwd).or_insert(0) += count;
        }
    }

    // Find the most common cwd (project directory)
    let project_cwd = cwd_counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(cwd, _)| cwd);

    Ok(paginate_recent_edits(
        all_edits,
        project_cwd,
        offset,
        limit,
        grouping,
    ))
}

/// Restore a file by writing content to the specified path
///
/// Uses atomic write pattern: writes to a temporary file first, then renames.
/// This prevents data loss if the write operation fails midway.
///
/// Security: Validates path to prevent path traversal attacks
#[tauri::command]
pub async fn restore_file(file_path: String, content: String) -> Result<(), String> {
    use std::fs;
    use std::path::Path;

    // Security validation: reject paths with null bytes
    if file_path.contains('\0') {
        return Err("Invalid file path: contains null bytes".to_string());
    }

    // Security validation: reject relative paths (must be absolute)
    let path = Path::new(&file_path);
    if !path.is_absolute() {
        return Err("Invalid file path: must be an absolute path".to_string());
    }

    // Security validation: reject paths with parent traversal segments
    for component in path.components() {
        if let std::path::Component::ParentDir = component {
            return Err("Invalid file path: path traversal not allowed".to_string());
        }
    }

    // Create parent directories if they don't exist
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories: {e}"))?;
    }

    // Atomic write pattern: write to temp file, then rename
    // This ensures the target file is never in a partial state
    let temp_path = path.with_extension("tmp.restore");

    // Write to temporary file
    fs::write(&temp_path, &content).map_err(|e| format!("Failed to write temporary file: {e}"))?;

    // Cross-platform atomic rename
    crate::commands::fs_utils::atomic_rename(&temp_path, path)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::TempDir;

    fn create_test_jsonl_file(dir: &TempDir, filename: &str, content: &str) -> PathBuf {
        let file_path = dir.path().join(filename);
        let mut file = File::create(&file_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();
        file_path
    }

    // ------------------------------------------------------------------
    // Recent Edits panel: session scoping, grouping, and the two new fields
    // ------------------------------------------------------------------

    /// One JSONL record describing a file write, built through `serde_json` so
    /// Windows path separators are escaped correctly.
    fn write_record(uuid: &str, session: &str, ts: &str, cwd: &Path, file: &Path) -> String {
        serde_json::json!({
            "uuid": uuid,
            "sessionId": session,
            "timestamp": ts,
            "type": "user",
            "cwd": cwd.to_string_lossy(),
            "toolUseResult": {
                "type": "create",
                "filePath": file.to_string_lossy(),
                "content": format!("contents written at {ts}"),
            }
        })
        .to_string()
    }

    /// Two sessions in one project. Session A touches `alpha.txt` twice and
    /// `beta.txt` once; session B touches `gamma.txt` once.
    fn project_with_two_sessions() -> (TempDir, PathBuf, PathBuf) {
        let dir = TempDir::new().unwrap();
        let root = dir.path().to_path_buf();

        let session_a = create_test_jsonl_file(
            &dir,
            "session-a.jsonl",
            &[
                write_record(
                    "u1",
                    "sa",
                    "2026-08-21T10:00:00Z",
                    &root,
                    &root.join("alpha.txt"),
                ),
                write_record(
                    "u2",
                    "sa",
                    "2026-08-21T11:00:00Z",
                    &root,
                    &root.join("beta.txt"),
                ),
                write_record(
                    "u3",
                    "sa",
                    "2026-08-21T12:00:00Z",
                    &root,
                    &root.join("alpha.txt"),
                ),
            ]
            .join("\n"),
        );
        let session_b = create_test_jsonl_file(
            &dir,
            "session-b.jsonl",
            &write_record(
                "u4",
                "sb",
                "2026-08-21T13:00:00Z",
                &root,
                &root.join("gamma.txt"),
            ),
        );

        (dir, session_a, session_b)
    }

    #[tokio::test]
    async fn test_absent_params_reproduce_the_previous_shape() {
        let (dir, _a, _b) = project_with_two_sessions();

        let result = get_recent_edits(
            dir.path().to_string_lossy().to_string(),
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();

        // 4 raw edits, deduped to 3 unique files, newest first.
        assert_eq!(result.total_edits_count, 4);
        assert_eq!(result.unique_files_count, 3);
        assert_eq!(result.files.len(), 3);
        assert!(!result.has_more);
        assert!(result.files[0].file_path.ends_with("gamma.txt"));
    }

    #[tokio::test]
    async fn test_session_file_path_scopes_to_one_session() {
        let (dir, session_a, _b) = project_with_two_sessions();

        let result = get_recent_edits(
            dir.path().to_string_lossy().to_string(),
            None,
            None,
            Some(session_a.to_string_lossy().to_string()),
            None,
        )
        .await
        .unwrap();

        // Session A never touched gamma.txt.
        assert_eq!(result.total_edits_count, 3);
        assert_eq!(result.unique_files_count, 2);
        assert!(
            result
                .files
                .iter()
                .all(|edit| !edit.file_path.ends_with("gamma.txt")),
            "session scope leaked an edit from another session"
        );
    }

    // ---- regressions from the Codex adversarial review ----

    #[test]
    fn test_containment_rejects_traversal_and_sibling_prefixes() {
        // A raw string prefix accepts both of these. The edit paths come from
        // session logs rather than a filesystem walk, so they can contain
        // traversal segments, and `/repository` starts with `/repo`.
        let root = comparable_path_parts("/repo");

        assert!(path_is_within("/repo/src/main.rs", &root));
        assert!(!path_is_within("/repo/../secret.json", &root));
        assert!(!path_is_within("/repository/secret.json", &root));
        assert!(
            !path_is_within("/repo", &root),
            "the root is not inside itself"
        );

        // Windows separators split on every platform, so these two hold
        // everywhere.
        let win_root = comparable_path_parts(r"C:\repo");
        assert!(path_is_within(r"C:\repo\src\main.rs", &win_root));
        assert!(!path_is_within(r"C:\repo\..\secret.json", &win_root));

        // Case folding is Windows-only: `comparable_path_parts` lowercases
        // under `cfg(target_os = "windows")` because POSIX paths are
        // case-sensitive. Asserting it unconditionally passes locally on
        // Windows and fails on CI's Linux, which is exactly what happened.
        #[cfg(target_os = "windows")]
        assert!(path_is_within(r"c:\repo\src\main.rs", &win_root));
    }

    #[tokio::test]
    async fn test_equal_timestamps_paginate_without_repeating_or_dropping() {
        // Ties used to fall back on `HashMap` iteration order, which differs
        // between requests, so page 2 could repeat a row from page 1 and lose
        // another. One tool call writing several files produces exactly this.
        let dir = TempDir::new().unwrap();
        let root = dir.path().to_path_buf();
        let lines: Vec<String> = (0..25)
            .map(|i| {
                write_record(
                    &format!("u{i}"),
                    "sa",
                    "2026-08-21T10:00:00Z",
                    &root,
                    &root.join(format!("file-{i:02}.txt")),
                )
            })
            .collect();
        create_test_jsonl_file(&dir, "tied.jsonl", &lines.join("\n"));
        let path = root.to_string_lossy().to_string();

        let mut seen: Vec<String> = Vec::new();
        for offset in [0usize, 20usize] {
            let page = get_recent_edits(path.clone(), Some(offset), Some(20), None, None)
                .await
                .unwrap();
            seen.extend(page.files.iter().map(|e| e.file_path.clone()));
        }

        let unique: HashSet<&String> = seen.iter().collect();
        assert_eq!(seen.len(), 25, "both pages together must cover every file");
        assert_eq!(
            unique.len(),
            25,
            "no file may appear on two pages: {seen:?}"
        );
    }

    #[tokio::test]
    async fn test_limit_is_clamped() {
        // Each returned row costs a stat call, so an unbounded caller-supplied
        // limit is an unbounded synchronous syscall loop.
        let (dir, _a, _b) = project_with_two_sessions();

        let result = get_recent_edits(
            dir.path().to_string_lossy().to_string(),
            None,
            Some(usize::MAX),
            None,
            None,
        )
        .await
        .unwrap();

        assert!(
            result.limit <= MAX_PAGE_LIMIT,
            "limit {} was not clamped",
            result.limit
        );
    }

    #[tokio::test]
    async fn test_session_file_path_survives_a_session_id_change_mid_file() {
        // A resumed session can write a different `sessionId` partway through
        // the same JSONL. `actual_session_id` only ever reports the first id in
        // the file, so filtering by id would silently drop everything after the
        // change. Scanning by file path is immune to that, and this pins it.
        let dir = TempDir::new().unwrap();
        let root = dir.path().to_path_buf();

        let resumed = create_test_jsonl_file(
            &dir,
            "resumed.jsonl",
            &[
                write_record(
                    "u1",
                    "session-before-resume",
                    "2026-08-21T10:00:00Z",
                    &root,
                    &root.join("before.txt"),
                ),
                write_record(
                    "u2",
                    "session-after-resume",
                    "2026-08-21T11:00:00Z",
                    &root,
                    &root.join("after.txt"),
                ),
            ]
            .join("\n"),
        );

        let result = get_recent_edits(
            root.to_string_lossy().to_string(),
            None,
            None,
            Some(resumed.to_string_lossy().to_string()),
            None,
        )
        .await
        .unwrap();

        let names: Vec<&str> = result
            .files
            .iter()
            .map(|edit| edit.file_path.as_str())
            .collect();
        assert_eq!(
            result.files.len(),
            2,
            "both halves of a resumed session must survive: {names:?}"
        );
        assert!(names.iter().any(|p| p.ends_with("before.txt")));
        assert!(names.iter().any(|p| p.ends_with("after.txt")));

        // The ids really did differ, so this is not a vacuous assertion.
        let ids: HashSet<&str> = result
            .files
            .iter()
            .map(|edit| edit.session_id.as_str())
            .collect();
        assert_eq!(
            ids.len(),
            2,
            "fixture must contain two distinct session ids"
        );
    }

    #[tokio::test]
    async fn test_session_file_path_requires_a_jsonl_extension() {
        // The directory walk filters on the extension; the single-file path did
        // not, so any file in the project could be mmapped and scanned line by
        // line. Harmless output, unbounded cost, and remotely chosen under
        // `--serve`.
        let (dir, _a, _b) = project_with_two_sessions();
        let other = dir.path().join("notes.txt");
        fs::write(&other, "not a session file").unwrap();

        let result = get_recent_edits(
            dir.path().to_string_lossy().to_string(),
            None,
            None,
            Some(other.to_string_lossy().to_string()),
            None,
        )
        .await;

        assert!(result.is_err(), "a non-jsonl file must be refused");
    }

    #[test]
    fn test_file_identity_folds_separator_and_windows_case() {
        // Grouping keyed on the raw string counted one file twice whenever two
        // records spelled the same path differently.
        assert_eq!(
            file_identity("/repo/src/a.rs"),
            file_identity(r"/repo/src/a.rs")
        );
        assert_eq!(file_identity("/repo/src/a.rs"), "repo/src/a.rs");

        #[cfg(target_os = "windows")]
        assert_eq!(
            file_identity(r"C:\Repo\src\a.rs"),
            file_identity("c:/repo/src/a.rs")
        );
    }

    #[tokio::test]
    async fn test_session_file_path_outside_the_project_is_rejected() {
        let (dir, _a, _b) = project_with_two_sessions();
        let outside = TempDir::new().unwrap();
        let stray = create_test_jsonl_file(&outside, "stray.jsonl", "{}");

        let result = get_recent_edits(
            dir.path().to_string_lossy().to_string(),
            None,
            None,
            Some(stray.to_string_lossy().to_string()),
            None,
        )
        .await;

        assert!(
            result.is_err(),
            "a path outside the project must be refused"
        );
    }

    #[tokio::test]
    async fn test_session_file_path_with_traversal_is_rejected() {
        let (dir, _a, _b) = project_with_two_sessions();
        let traversal = dir
            .path()
            .join("..")
            .join("escape.jsonl")
            .to_string_lossy()
            .to_string();

        let result = get_recent_edits(
            dir.path().to_string_lossy().to_string(),
            None,
            None,
            Some(traversal),
            None,
        )
        .await;

        assert!(result.is_err(), "a traversal segment must be refused");
    }

    #[tokio::test]
    async fn test_edit_grouping_keeps_every_edit_newest_first() {
        let (dir, _a, _b) = project_with_two_sessions();

        let result = get_recent_edits(
            dir.path().to_string_lossy().to_string(),
            None,
            None,
            None,
            Some("edit".to_string()),
        )
        .await
        .unwrap();

        // alpha.txt was edited twice, so it appears twice.
        assert_eq!(result.files.len(), 4);
        assert_eq!(
            result.unique_files_count, 3,
            "unique count is still reported"
        );
        let alpha = result
            .files
            .iter()
            .filter(|e| e.file_path.ends_with("alpha.txt"))
            .count();
        assert_eq!(alpha, 2);

        let timestamps: Vec<&str> = result.files.iter().map(|e| e.timestamp.as_str()).collect();
        let mut sorted = timestamps.clone();
        sorted.sort_unstable();
        sorted.reverse();
        assert_eq!(timestamps, sorted, "edits must be newest first");
    }

    #[tokio::test]
    async fn test_has_more_follows_the_active_grouping() {
        let (dir, _a, _b) = project_with_two_sessions();
        let path = dir.path().to_string_lossy().to_string();

        // 3 unique files: a page of 3 is the whole set.
        let by_file = get_recent_edits(path.clone(), Some(0), Some(3), None, None)
            .await
            .unwrap();
        assert!(!by_file.has_more);

        // 4 raw edits: the same page size leaves one behind.
        let by_edit = get_recent_edits(path, Some(0), Some(3), None, Some("edit".to_string()))
            .await
            .unwrap();
        assert!(by_edit.has_more);
    }

    #[tokio::test]
    async fn test_message_uuid_is_carried_through() {
        let (dir, _a, _b) = project_with_two_sessions();

        let result = get_recent_edits(
            dir.path().to_string_lossy().to_string(),
            None,
            None,
            None,
            Some("edit".to_string()),
        )
        .await
        .unwrap();

        let uuids: Vec<Option<&str>> = result
            .files
            .iter()
            .map(|e| e.message_uuid.as_deref())
            .collect();
        assert!(
            uuids.iter().all(Option::is_some),
            "every Claude edit should carry the uuid of its log entry: {uuids:?}"
        );
        assert_eq!(result.files[0].message_uuid.as_deref(), Some("u4"));
    }

    #[tokio::test]
    async fn test_exists_on_disk_reflects_the_filesystem() {
        let (dir, _a, _b) = project_with_two_sessions();
        // alpha.txt is on disk; beta.txt and gamma.txt were never created.
        fs::write(dir.path().join("alpha.txt"), "still here").unwrap();

        let result = get_recent_edits(
            dir.path().to_string_lossy().to_string(),
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();

        for edit in &result.files {
            let expected = edit.file_path.ends_with("alpha.txt");
            assert_eq!(
                edit.exists_on_disk,
                Some(expected),
                "wrong exists_on_disk for {}",
                edit.file_path
            );
        }
    }

    #[tokio::test]
    async fn test_exists_on_disk_is_only_computed_for_returned_rows() {
        let (dir, _a, _b) = project_with_two_sessions();

        let result = get_recent_edits(
            dir.path().to_string_lossy().to_string(),
            Some(0),
            Some(1),
            None,
            None,
        )
        .await
        .unwrap();

        // The stat cost is bounded by `limit`, not by the number of raw edits,
        // so exactly the returned row carries a resolved value.
        assert_eq!(result.files.len(), 1);
        assert!(result.files[0].exists_on_disk.is_some());
    }

    // Test restore_file security validations
    #[tokio::test]
    async fn test_restore_file_rejects_null_bytes() {
        let result = restore_file("/tmp/test\0file.txt".to_string(), "content".to_string()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("null bytes"));
    }

    #[tokio::test]
    async fn test_restore_file_rejects_relative_path() {
        let result =
            restore_file("relative/path/file.txt".to_string(), "content".to_string()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("absolute path"));
    }

    #[tokio::test]
    async fn test_restore_file_rejects_path_traversal() {
        let result = restore_file("/tmp/../etc/passwd".to_string(), "content".to_string()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("path traversal"));
    }

    #[tokio::test]
    async fn test_restore_file_success() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test_restore.txt");

        let result = restore_file(
            file_path.to_string_lossy().to_string(),
            "restored content".to_string(),
        )
        .await;

        assert!(result.is_ok());

        // Verify file content
        let content = fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "restored content");
    }

    #[tokio::test]
    async fn test_restore_file_atomic_write_no_temp_file_left() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("atomic_test.txt");
        let temp_path = temp_dir.path().join("atomic_test.tmp.restore");

        let result = restore_file(
            file_path.to_string_lossy().to_string(),
            "atomic content".to_string(),
        )
        .await;

        assert!(result.is_ok());
        // Verify temp file was cleaned up
        assert!(!temp_path.exists());
        // Verify target file exists with correct content
        let content = fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "atomic content");
    }

    #[tokio::test]
    async fn test_restore_file_overwrites_existing() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("existing.txt");

        // Create existing file
        fs::write(&file_path, "old content").unwrap();

        let result = restore_file(
            file_path.to_string_lossy().to_string(),
            "new content".to_string(),
        )
        .await;

        assert!(result.is_ok());
        let content = fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "new content");
    }

    #[tokio::test]
    async fn test_restore_file_creates_parent_dirs() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("nested/dir/file.txt");

        let result = restore_file(
            file_path.to_string_lossy().to_string(),
            "content".to_string(),
        )
        .await;

        assert!(result.is_ok());
        assert!(file_path.exists());
    }

    // Test get_recent_edits
    #[tokio::test]
    async fn test_get_recent_edits_empty_dir() {
        let temp_dir = TempDir::new().unwrap();

        let result = get_recent_edits(
            temp_dir.path().to_string_lossy().to_string(),
            None,
            None,
            None,
            None,
        )
        .await;

        assert!(result.is_ok());
        let edits_result = result.unwrap();
        assert!(edits_result.files.is_empty());
        assert_eq!(edits_result.total_edits_count, 0);
        assert_eq!(edits_result.unique_files_count, 0);
    }

    #[tokio::test]
    async fn test_get_recent_edits_with_write_operation() {
        let temp_dir = TempDir::new().unwrap();

        // Create a JSONL file with Write tool usage
        let content = r#"{"uuid":"uuid-1","sessionId":"session-1","timestamp":"2025-06-26T10:00:00Z","type":"assistant","cwd":"/test/project","toolUse":{"name":"Write","input":{"file_path":"/test/project/src/main.rs","content":"fn main() {}"}}}"#;
        create_test_jsonl_file(&temp_dir, "session.jsonl", content);

        let result = get_recent_edits(
            temp_dir.path().to_string_lossy().to_string(),
            None,
            None,
            None,
            None,
        )
        .await;

        assert!(result.is_ok());
        let edits_result = result.unwrap();
        assert_eq!(edits_result.files.len(), 1);
        assert_eq!(edits_result.files[0].file_path, "/test/project/src/main.rs");
        assert_eq!(edits_result.files[0].operation_type, "write");
    }

    #[tokio::test]
    async fn test_get_recent_edits_with_edit_operation() {
        let temp_dir = TempDir::new().unwrap();

        // Create a JSONL file with Edit tool result
        let content = r#"{"uuid":"uuid-1","sessionId":"session-1","timestamp":"2025-06-26T10:00:00Z","type":"user","cwd":"/test/project","toolUseResult":{"filePath":"/test/project/src/lib.rs","oldString":"old","newString":"new","originalFile":"old code here"}}"#;
        create_test_jsonl_file(&temp_dir, "session.jsonl", content);

        let result = get_recent_edits(
            temp_dir.path().to_string_lossy().to_string(),
            None,
            None,
            None,
            None,
        )
        .await;

        assert!(result.is_ok());
        let edits_result = result.unwrap();
        assert_eq!(edits_result.files.len(), 1);
        assert_eq!(edits_result.files[0].file_path, "/test/project/src/lib.rs");
        assert_eq!(edits_result.files[0].operation_type, "edit");
    }

    #[tokio::test]
    async fn test_get_recent_edits_with_multi_edit() {
        let temp_dir = TempDir::new().unwrap();

        // Create a JSONL file with multi-edit result
        let content = r#"{"uuid":"uuid-1","sessionId":"session-1","timestamp":"2025-06-26T10:00:00Z","type":"user","cwd":"/test/project","toolUseResult":{"filePath":"/test/project/src/mod.rs","edits":[{"old_string":"old1","new_string":"new1"},{"old_string":"old2","new_string":"new2"}],"originalFile":"old1 old2"}}"#;
        create_test_jsonl_file(&temp_dir, "session.jsonl", content);

        let result = get_recent_edits(
            temp_dir.path().to_string_lossy().to_string(),
            None,
            None,
            None,
            None,
        )
        .await;

        assert!(result.is_ok());
        let edits_result = result.unwrap();
        assert_eq!(edits_result.files.len(), 1);
        assert_eq!(edits_result.files[0].content_after_change, "new1 new2");
    }

    #[tokio::test]
    async fn test_get_recent_edits_keeps_latest_per_file() {
        let temp_dir = TempDir::new().unwrap();

        // Two edits to the same file
        let content = r#"{"uuid":"uuid-1","sessionId":"session-1","timestamp":"2025-06-26T10:00:00Z","type":"user","cwd":"/test/project","toolUseResult":{"filePath":"/test/project/file.txt","oldString":"v1","newString":"v2","originalFile":"v1"}}
{"uuid":"uuid-2","sessionId":"session-1","timestamp":"2025-06-26T10:01:00Z","type":"user","cwd":"/test/project","toolUseResult":{"filePath":"/test/project/file.txt","oldString":"v2","newString":"v3","originalFile":"v2"}}"#;
        create_test_jsonl_file(&temp_dir, "session.jsonl", content);

        let result = get_recent_edits(
            temp_dir.path().to_string_lossy().to_string(),
            None,
            None,
            None,
            None,
        )
        .await;

        assert!(result.is_ok());
        let edits_result = result.unwrap();

        // Should have only 1 file (latest version)
        assert_eq!(edits_result.unique_files_count, 1);
        // But total edits count should be 2
        assert_eq!(edits_result.total_edits_count, 2);
        // Latest edit should be v3
        assert_eq!(edits_result.files[0].content_after_change, "v3");
    }

    #[tokio::test]
    async fn test_get_recent_edits_with_create_type() {
        let temp_dir = TempDir::new().unwrap();

        // File with "type": "create" in toolUseResult
        let content = r#"{"uuid":"uuid-1","sessionId":"session-1","timestamp":"2025-06-26T10:00:00Z","type":"user","cwd":"/test/project","toolUseResult":{"type":"create","filePath":"/test/project/new_file.rs","content":"pub fn new() {}"}}"#;
        create_test_jsonl_file(&temp_dir, "session.jsonl", content);

        let result = get_recent_edits(
            temp_dir.path().to_string_lossy().to_string(),
            None,
            None,
            None,
            None,
        )
        .await;

        assert!(result.is_ok());
        let edits_result = result.unwrap();
        assert_eq!(edits_result.files.len(), 1);
        assert_eq!(edits_result.files[0].operation_type, "write");
        assert_eq!(
            edits_result.files[0].content_after_change,
            "pub fn new() {}"
        );
    }

    #[tokio::test]
    async fn test_get_recent_edits_filters_by_project_cwd() {
        let temp_dir = TempDir::new().unwrap();

        // One edit in project, one outside
        let content = r#"{"uuid":"uuid-1","sessionId":"session-1","timestamp":"2025-06-26T10:00:00Z","type":"user","cwd":"/test/project","toolUseResult":{"filePath":"/test/project/file1.txt","oldString":"old","newString":"new","originalFile":"old"}}
{"uuid":"uuid-2","sessionId":"session-1","timestamp":"2025-06-26T10:00:00Z","type":"user","cwd":"/test/project","toolUseResult":{"filePath":"/test/project/file2.txt","oldString":"old","newString":"new","originalFile":"old"}}
{"uuid":"uuid-3","sessionId":"session-1","timestamp":"2025-06-26T10:01:00Z","type":"user","cwd":"/test/project","toolUseResult":{"filePath":"/other/location/file3.txt","oldString":"old","newString":"new","originalFile":"old"}}"#;
        create_test_jsonl_file(&temp_dir, "session.jsonl", content);

        let result = get_recent_edits(
            temp_dir.path().to_string_lossy().to_string(),
            None,
            None,
            None,
            None,
        )
        .await;

        assert!(result.is_ok());
        let edits_result = result.unwrap();

        // Should only have files within /test/project (the most common cwd)
        assert_eq!(edits_result.unique_files_count, 2);
        assert_eq!(edits_result.project_cwd, Some("/test/project".to_string()));
    }
}
