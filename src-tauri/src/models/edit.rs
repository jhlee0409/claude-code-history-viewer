use serde::{Deserialize, Serialize};

/// Recent file edit information for recovery purposes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentFileEdit {
    pub file_path: String,
    pub timestamp: String,
    pub session_id: String,
    pub operation_type: String, // "edit" or "write"
    pub content_after_change: String,
    pub original_content: Option<String>,
    pub lines_added: usize,
    pub lines_removed: usize,
    pub cwd: Option<String>, // Working directory when edit was made
}

/// Result container for recent edits query
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentEditsResult {
    pub files: Vec<RecentFileEdit>,
    pub total_edits_count: usize,
    pub unique_files_count: usize,
    pub project_cwd: Option<String>, // Most common working directory for this project
}
