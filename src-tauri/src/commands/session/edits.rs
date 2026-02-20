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
    OpenCode,
}

fn detect_project_provider(project_path: &str) -> EditsProvider {
    if project_path.starts_with("codex://") {
        EditsProvider::Codex
    } else if project_path.starts_with("opencode://") {
        EditsProvider::OpenCode
    } else {
        EditsProvider::Claude
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
                    project_cwd,
                ));
            }
        }
    }

    edits
}

fn paginate_recent_edits(
    all_edits: Vec<RecentFileEdit>,
    project_cwd: Option<String>,
    offset: usize,
    limit: usize,
) -> PaginatedRecentEdits {
    // Filter edits to only include files within the project directory
    // Use case-insensitive comparison on Windows for path matching
    let filtered_edits: Vec<RecentFileEdit> = if let Some(ref cwd) = project_cwd {
        #[cfg(target_os = "windows")]
        let cwd_normalized = cwd.to_lowercase();
        #[cfg(not(target_os = "windows"))]
        let cwd_normalized = cwd.clone();

        all_edits
            .into_iter()
            .filter(|edit| {
                #[cfg(target_os = "windows")]
                let file_path_normalized = edit.file_path.to_lowercase();
                #[cfg(not(target_os = "windows"))]
                let file_path_normalized = edit.file_path.clone();

                file_path_normalized.starts_with(&cwd_normalized)
            })
            .collect()
    } else {
        all_edits
    };

    let total_edits_count = filtered_edits.len();

    // Sort by timestamp descending (newest first)
    let mut sorted_edits = filtered_edits;
    sorted_edits.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    // Group by file_path and keep only the LATEST edit for each file
    let mut latest_by_file: HashMap<String, RecentFileEdit> = HashMap::new();
    for edit in sorted_edits {
        latest_by_file.entry(edit.file_path.clone()).or_insert(edit);
    }

    let unique_files_count = latest_by_file.len();

    // Convert to Vec and sort by timestamp descending
    let mut files: Vec<RecentFileEdit> = latest_by_file.into_values().collect();
    files.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    // Apply pagination
    let paginated_files: Vec<RecentFileEdit> = files.into_iter().skip(offset).take(limit).collect();

    let has_more = offset + paginated_files.len() < unique_files_count;

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
) -> Result<PaginatedRecentEdits, String> {
    let project_cwd = resolve_provider_project_cwd(provider, project_path);

    let sessions = match provider {
        EditsProvider::Codex => providers::codex::load_sessions(project_path, false)?,
        EditsProvider::OpenCode => providers::opencode::load_sessions(project_path, false)?,
        EditsProvider::Claude => {
            return Err("Claude provider should use legacy edits path".to_string())
        }
    };

    let mut all_edits = Vec::new();
    for session in sessions {
        let messages = match provider {
            EditsProvider::Codex => providers::codex::load_messages(&session.file_path)?,
            EditsProvider::OpenCode => providers::opencode::load_messages(&session.file_path)?,
            EditsProvider::Claude => Vec::new(),
        };
        all_edits.extend(collect_provider_recent_edits_from_messages(
            &messages,
            project_cwd.as_deref(),
        ));
    }

    Ok(paginate_recent_edits(all_edits, project_cwd, offset, limit))
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

/// Scan all JSONL files in a project and extract recent file edits/writes
/// Returns the LATEST content for each unique file path, sorted by timestamp descending
/// Only includes files that belong to the project's working directory
/// Supports pagination with offset and limit parameters
#[tauri::command]
pub async fn get_recent_edits(
    project_path: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<PaginatedRecentEdits, String> {
    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(20);
    let provider = detect_project_provider(&project_path);

    if provider != EditsProvider::Claude {
        return get_provider_recent_edits(provider, &project_path, offset, limit);
    }

    // Phase 1: Collect all session files
    let session_files: Vec<PathBuf> = WalkDir::new(&project_path)
        .into_iter()
        .filter_map(std::result::Result::ok)
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
        .map(|e| e.path().to_path_buf())
        .collect();

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

    Ok(paginate_recent_edits(all_edits, project_cwd, offset, limit))
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

        let result =
            get_recent_edits(temp_dir.path().to_string_lossy().to_string(), None, None).await;

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

        let result =
            get_recent_edits(temp_dir.path().to_string_lossy().to_string(), None, None).await;

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

        let result =
            get_recent_edits(temp_dir.path().to_string_lossy().to_string(), None, None).await;

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

        let result =
            get_recent_edits(temp_dir.path().to_string_lossy().to_string(), None, None).await;

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

        let result =
            get_recent_edits(temp_dir.path().to_string_lossy().to_string(), None, None).await;

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

        let result =
            get_recent_edits(temp_dir.path().to_string_lossy().to_string(), None, None).await;

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

        let result =
            get_recent_edits(temp_dir.path().to_string_lossy().to_string(), None, None).await;

        assert!(result.is_ok());
        let edits_result = result.unwrap();

        // Should only have files within /test/project (the most common cwd)
        assert_eq!(edits_result.unique_files_count, 2);
        assert_eq!(edits_result.project_cwd, Some("/test/project".to_string()));
    }
}
