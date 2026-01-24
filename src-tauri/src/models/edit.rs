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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_recent_file_edit_serialization() {
        let edit = RecentFileEdit {
            file_path: "/path/to/file.rs".to_string(),
            timestamp: "2025-06-26T10:00:00Z".to_string(),
            session_id: "session-123".to_string(),
            operation_type: "edit".to_string(),
            content_after_change: "new content".to_string(),
            original_content: Some("old content".to_string()),
            lines_added: 5,
            lines_removed: 3,
            cwd: Some("/path/to".to_string()),
        };

        let serialized = serde_json::to_string(&edit).unwrap();
        let deserialized: RecentFileEdit = serde_json::from_str(&serialized).unwrap();

        assert_eq!(deserialized.file_path, "/path/to/file.rs");
        assert_eq!(deserialized.operation_type, "edit");
        assert_eq!(deserialized.lines_added, 5);
        assert_eq!(deserialized.lines_removed, 3);
        assert_eq!(
            deserialized.original_content,
            Some("old content".to_string())
        );
    }

    #[test]
    fn test_recent_file_edit_write_operation() {
        let edit = RecentFileEdit {
            file_path: "/path/to/new_file.rs".to_string(),
            timestamp: "2025-06-26T10:00:00Z".to_string(),
            session_id: "session-456".to_string(),
            operation_type: "write".to_string(),
            content_after_change: "fn main() {}".to_string(),
            original_content: None, // No original content for new files
            lines_added: 1,
            lines_removed: 0,
            cwd: None,
        };

        let serialized = serde_json::to_string(&edit).unwrap();
        let deserialized: RecentFileEdit = serde_json::from_str(&serialized).unwrap();

        assert_eq!(deserialized.operation_type, "write");
        assert!(deserialized.original_content.is_none());
        assert_eq!(deserialized.lines_removed, 0);
    }

    #[test]
    fn test_recent_edits_result_serialization() {
        let result = RecentEditsResult {
            files: vec![
                RecentFileEdit {
                    file_path: "/file1.rs".to_string(),
                    timestamp: "2025-06-26T10:00:00Z".to_string(),
                    session_id: "session-1".to_string(),
                    operation_type: "edit".to_string(),
                    content_after_change: "content1".to_string(),
                    original_content: None,
                    lines_added: 1,
                    lines_removed: 0,
                    cwd: Some("/project".to_string()),
                },
                RecentFileEdit {
                    file_path: "/file2.rs".to_string(),
                    timestamp: "2025-06-26T10:01:00Z".to_string(),
                    session_id: "session-1".to_string(),
                    operation_type: "write".to_string(),
                    content_after_change: "content2".to_string(),
                    original_content: None,
                    lines_added: 2,
                    lines_removed: 0,
                    cwd: Some("/project".to_string()),
                },
            ],
            total_edits_count: 5,
            unique_files_count: 2,
            project_cwd: Some("/project".to_string()),
        };

        let serialized = serde_json::to_string(&result).unwrap();
        let deserialized: RecentEditsResult = serde_json::from_str(&serialized).unwrap();

        assert_eq!(deserialized.files.len(), 2);
        assert_eq!(deserialized.total_edits_count, 5);
        assert_eq!(deserialized.unique_files_count, 2);
        assert_eq!(deserialized.project_cwd, Some("/project".to_string()));
    }

    #[test]
    fn test_recent_edits_result_empty() {
        let result = RecentEditsResult {
            files: vec![],
            total_edits_count: 0,
            unique_files_count: 0,
            project_cwd: None,
        };

        let serialized = serde_json::to_string(&result).unwrap();
        let deserialized: RecentEditsResult = serde_json::from_str(&serialized).unwrap();

        assert!(deserialized.files.is_empty());
        assert!(deserialized.project_cwd.is_none());
    }
}
