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
    /// UUID of the log entry this edit came from, used by the frontend to jump
    /// back to the originating message. `None` where the source record carries
    /// no identity of its own.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_uuid: Option<String>,
    /// Whether the file is still present on disk. `None` until resolved, which
    /// happens after pagination so the stat cost is bounded by `limit` rather
    /// than by the number of raw edits.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exists_on_disk: Option<bool>,
    /// What `content_after_change` holds. Only [`EditContentKind::Full`] is a
    /// whole file, so only it may be written back by restore. A payload
    /// without the field (older backend) reads as `Unavailable`.
    #[serde(default)]
    pub content_kind: EditContentKind,
}

/// What a recorded edit's `content_after_change` holds.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EditContentKind {
    /// The whole file after the edit: Claude Edit/MultiEdit replayed onto
    /// `originalFile`, or the content of a write.
    Full,
    /// Patch text (Codex `apply_patch`), possibly naming several files.
    Patch,
    /// Only the changed part, such as an edit tool's `new_string`.
    Fragment,
    /// Nothing usable: the tool input stored as a fallback, or an edit whose
    /// replay could not reproduce the result.
    #[default]
    Unavailable,
}

impl EditContentKind {
    /// Whether restore may write this content over the file.
    pub fn is_restorable(self) -> bool {
        matches!(self, Self::Full)
    }
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
            message_uuid: Some("uuid-abc".to_string()),
            exists_on_disk: Some(true),
            content_kind: EditContentKind::Full,
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
        assert_eq!(deserialized.message_uuid, Some("uuid-abc".to_string()));
        assert_eq!(deserialized.exists_on_disk, Some(true));
        assert_eq!(deserialized.content_kind, EditContentKind::Full);
    }

    #[test]
    fn content_kind_is_kebab_case_and_absent_reads_as_unavailable() {
        for (kind, wire) in [
            (EditContentKind::Full, "\"full\""),
            (EditContentKind::Patch, "\"patch\""),
            (EditContentKind::Fragment, "\"fragment\""),
            (EditContentKind::Unavailable, "\"unavailable\""),
        ] {
            assert_eq!(serde_json::to_string(&kind).unwrap(), wire);
        }

        // A payload from before the field existed must not become restorable.
        let legacy = r#"{"file_path":"/f","timestamp":"t","session_id":"s","operation_type":"edit",
            "content_after_change":"c","original_content":null,"lines_added":1,"lines_removed":0,"cwd":null}"#;
        let edit: RecentFileEdit = serde_json::from_str(legacy).unwrap();
        assert_eq!(edit.content_kind, EditContentKind::Unavailable);
        assert!(!edit.content_kind.is_restorable());
        assert!(EditContentKind::Full.is_restorable());
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
            message_uuid: None,
            exists_on_disk: None,
            content_kind: EditContentKind::Full,
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
                    message_uuid: None,
                    exists_on_disk: None,
                    content_kind: EditContentKind::Full,
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
                    message_uuid: None,
                    exists_on_disk: None,
                    content_kind: EditContentKind::Full,
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
