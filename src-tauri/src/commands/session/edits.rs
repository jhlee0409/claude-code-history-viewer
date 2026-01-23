//! File edit and restore functions

use crate::models::*;
use std::collections::HashMap;
use walkdir::WalkDir;

/// Scan all JSONL files in a project and extract recent file edits/writes
/// Returns the LATEST content for each unique file path, sorted by timestamp descending
/// Only includes files that belong to the project's working directory
#[tauri::command]
pub async fn get_recent_edits(project_path: String) -> Result<RecentEditsResult, String> {
    let mut all_edits: Vec<RecentFileEdit> = Vec::new();
    let mut cwd_counts: HashMap<String, usize> = HashMap::new();

    // Scan all JSONL files in the project directory
    for entry in WalkDir::new(&project_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
    {
        let file_path = entry.path();

        if let Ok(file) = std::fs::File::open(file_path) {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(file);

            for line_result in reader.lines() {
                if let Ok(line) = line_result {
                    if line.trim().is_empty() { continue; }

                    if let Ok(log_entry) = serde_json::from_str::<RawLogEntry>(&line) {
                        // Extract common fields
                        let timestamp = log_entry.timestamp.clone().unwrap_or_default();
                        let session_id = log_entry.session_id.clone().unwrap_or_else(|| "unknown".to_string());
                        let cwd = log_entry.cwd.clone();

                        // Track cwd frequency to determine project directory
                        if let Some(cwd_path) = cwd.as_ref() {
                            *cwd_counts.entry(cwd_path.to_string()).or_insert(0) += 1;
                        }

                        // Process tool use results for Edit and Write operations
                        if let Some(tool_use_result) = &log_entry.tool_use_result {

                            // Handle Write/Create tool results (type: "create")
                            // Format: { "type": "create", "filePath": "...", "content": "full content", ... }
                            if tool_use_result.get("type").and_then(|v| v.as_str()) == Some("create") {
                                if let (Some(file_path_str), Some(content)) = (
                                    tool_use_result.get("filePath").and_then(|v| v.as_str()),
                                    tool_use_result.get("content").and_then(|v| v.as_str())
                                ) {
                                    all_edits.push(RecentFileEdit {
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
                            // Format: { "filePath": "...", "oldString": "...", "newString": "...", "originalFile": "full content", ... }
                            if let Some(file_path_val) = tool_use_result.get("filePath") {
                                if let Some(file_path_str) = file_path_val.as_str() {
                                    // Check if this is an Edit result (has edits array or oldString/newString)
                                    if let Some(edits) = tool_use_result.get("edits") {
                                        // Multi-edit format (uses "originalFile" not "originalFileContents")
                                        if let Some(original) = tool_use_result.get("originalFile").and_then(|v| v.as_str()) {
                                            let mut content = original.to_string();
                                            let mut lines_added = 0usize;
                                            let mut lines_removed = 0usize;

                                            if let Some(edits_arr) = edits.as_array() {
                                                for edit in edits_arr {
                                                    if let (Some(old_str), Some(new_str)) = (
                                                        edit.get("old_string").and_then(|v| v.as_str()),
                                                        edit.get("new_string").and_then(|v| v.as_str())
                                                    ) {
                                                        content = content.replacen(old_str, new_str, 1);
                                                        lines_removed += old_str.lines().count();
                                                        lines_added += new_str.lines().count();
                                                    }
                                                }
                                            }

                                            all_edits.push(RecentFileEdit {
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
                                        tool_use_result.get("newString").and_then(|v| v.as_str())
                                    ) {
                                        // Single edit format with oldString/newString
                                        // Only include if we have originalFile (needed for full file reconstruction)
                                        if let Some(original) = tool_use_result.get("originalFile").and_then(|v| v.as_str()) {
                                            let content = original.replacen(old_str, new_str, 1);

                                            all_edits.push(RecentFileEdit {
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
                                        // Skip edits without originalFile - we can't reconstruct full file
                                    }
                                }
                            }

                            // NOTE: toolUseResult.file is for READ operations (often truncated)
                            // We do NOT capture those - only Edit results with originalFile
                            // and Write results with type: "create"
                        }

                        // Also check tool_use for Write operations (input has file_path and content)
                        if let Some(tool_use) = &log_entry.tool_use {
                            if let Some(name) = tool_use.get("name").and_then(|v| v.as_str()) {
                                if name == "Write" {
                                    if let Some(input) = tool_use.get("input") {
                                        if let (Some(path), Some(content)) = (
                                            input.get("file_path").and_then(|v| v.as_str()),
                                            input.get("content").and_then(|v| v.as_str())
                                        ) {
                                            all_edits.push(RecentFileEdit {
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
                }
            }
        }
    }

    // Find the most common cwd (project directory)
    let project_cwd = cwd_counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(cwd, _)| cwd);

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

    Ok(RecentEditsResult {
        files,
        total_edits_count,
        unique_files_count,
        project_cwd,
    })
}

/// Restore a file by writing content to the specified path
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
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories: {}", e))?;
    }

    // Write the content to the file
    fs::write(path, content).map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(())
}
