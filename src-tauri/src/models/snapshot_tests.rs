//! Snapshot tests for data model serialization.
//!
//! These tests use insta to create and maintain snapshots of serialized data.
//! Run `cargo insta review` to review and accept snapshot changes.

#![cfg(test)]

use super::*;
use insta::{assert_json_snapshot, assert_snapshot};
use serde_json::json;

/// Snapshot tests for `ClaudeMessage` serialization
mod claude_message_snapshots {
    use super::*;

    #[test]
    fn snapshot_user_message() {
        let message = ClaudeMessage {
            uuid: "test-uuid-1234".to_string(),
            parent_uuid: None,
            session_id: "session-abc".to_string(),
            timestamp: "2025-01-01T12:00:00Z".to_string(),
            message_type: "user".to_string(),
            content: Some(json!("Hello, Claude!")),
            project_name: None,
            tool_use: None,
            tool_use_result: None,
            is_sidechain: Some(false),
            usage: None,
            role: Some("user".to_string()),
            model: None,
            stop_reason: None,
            cost_usd: None,
            duration_ms: None,
            message_id: None,
            snapshot: None,
            is_snapshot_update: None,
            data: None,
            tool_use_id: None,
            parent_tool_use_id: None,
            operation: None,
            subtype: None,
            level: None,
            hook_count: None,
            hook_infos: None,
            stop_reason_system: None,
            prevented_continuation: None,
            compact_metadata: None,
            microcompact_metadata: None,
            provider: None,
        };

        assert_json_snapshot!("user_message", message);
    }

    #[test]
    fn snapshot_assistant_message() {
        let message = ClaudeMessage {
            uuid: "test-uuid-5678".to_string(),
            parent_uuid: Some("test-uuid-1234".to_string()),
            session_id: "session-abc".to_string(),
            timestamp: "2025-01-01T12:00:01Z".to_string(),
            message_type: "assistant".to_string(),
            content: Some(json!([
                {"type": "text", "text": "Hello! How can I help you today?"}
            ])),
            project_name: None,
            tool_use: None,
            tool_use_result: None,
            is_sidechain: Some(false),
            usage: Some(TokenUsage {
                input_tokens: Some(100),
                output_tokens: Some(50),
                cache_creation_input_tokens: Some(20),
                cache_read_input_tokens: Some(10),
                service_tier: Some("standard".to_string()),
            }),
            role: Some("assistant".to_string()),
            model: Some("claude-opus-4-20250514".to_string()),
            stop_reason: Some("end_turn".to_string()),
            cost_usd: Some(0.005),
            duration_ms: Some(1500),
            message_id: Some("msg_test123".to_string()),
            snapshot: None,
            is_snapshot_update: None,
            data: None,
            tool_use_id: None,
            parent_tool_use_id: None,
            operation: None,
            subtype: None,
            level: None,
            hook_count: None,
            hook_infos: None,
            stop_reason_system: None,
            prevented_continuation: None,
            compact_metadata: None,
            microcompact_metadata: None,
            provider: None,
        };

        assert_json_snapshot!("assistant_message", message);
    }

    #[test]
    fn snapshot_message_with_tool_use() {
        let message = ClaudeMessage {
            uuid: "test-uuid-tool".to_string(),
            parent_uuid: None,
            session_id: "session-abc".to_string(),
            timestamp: "2025-01-01T12:00:02Z".to_string(),
            message_type: "assistant".to_string(),
            content: Some(json!([
                {
                    "type": "tool_use",
                    "id": "toolu_123",
                    "name": "Read",
                    "input": {
                        "file_path": "/path/to/file.rs"
                    }
                }
            ])),
            project_name: None,
            tool_use: Some(json!({
                "name": "Read",
                "input": {"file_path": "/path/to/file.rs"}
            })),
            tool_use_result: None,
            is_sidechain: None,
            usage: Some(TokenUsage {
                input_tokens: Some(200),
                output_tokens: Some(100),
                cache_creation_input_tokens: None,
                cache_read_input_tokens: None,
                service_tier: None,
            }),
            role: Some("assistant".to_string()),
            model: Some("claude-opus-4-20250514".to_string()),
            stop_reason: Some("tool_use".to_string()),
            cost_usd: None,
            duration_ms: None,
            message_id: None,
            snapshot: None,
            is_snapshot_update: None,
            data: None,
            tool_use_id: None,
            parent_tool_use_id: None,
            operation: None,
            subtype: None,
            level: None,
            hook_count: None,
            hook_infos: None,
            stop_reason_system: None,
            prevented_continuation: None,
            compact_metadata: None,
            microcompact_metadata: None,
            provider: None,
        };

        assert_json_snapshot!("message_with_tool_use", message);
    }
}

/// Snapshot tests for `TokenUsage`
mod token_usage_snapshots {
    use super::*;

    #[test]
    fn snapshot_full_token_usage() {
        let usage = TokenUsage {
            input_tokens: Some(1000),
            output_tokens: Some(500),
            cache_creation_input_tokens: Some(200),
            cache_read_input_tokens: Some(100),
            service_tier: Some("premium".to_string()),
        };

        assert_json_snapshot!("full_token_usage", usage);
    }

    #[test]
    fn snapshot_minimal_token_usage() {
        let usage = TokenUsage {
            input_tokens: Some(50),
            output_tokens: Some(25),
            cache_creation_input_tokens: None,
            cache_read_input_tokens: None,
            service_tier: None,
        };

        assert_json_snapshot!("minimal_token_usage", usage);
    }
}

/// Snapshot tests for `ClaudeProject`
mod project_snapshots {
    use super::*;

    #[test]
    fn snapshot_claude_project() {
        let project = ClaudeProject {
            name: "my-awesome-project".to_string(),
            path: "/Users/test/.claude/projects/-Users-test-my-awesome-project".to_string(),
            actual_path: "/Users/test/my-awesome-project".to_string(),
            session_count: 42,
            message_count: 1337,
            last_modified: "2025-01-15T10:30:00Z".to_string(),
            git_info: None,
            provider: None,
        };

        assert_json_snapshot!("claude_project", project);
    }
}

/// Snapshot tests for `ClaudeSession`
mod session_snapshots {
    use super::*;

    #[test]
    fn snapshot_claude_session() {
        let session = ClaudeSession {
            session_id: "session-xyz".to_string(),
            actual_session_id: "actual-session-xyz".to_string(),
            file_path: "/path/to/session.jsonl".to_string(),
            project_name: "test-project".to_string(),
            message_count: 100,
            first_message_time: "2025-01-01T00:00:00Z".to_string(),
            last_message_time: "2025-01-01T12:00:00Z".to_string(),
            last_modified: "2025-01-01T12:00:00Z".to_string(),
            has_tool_use: true,
            has_errors: false,
            summary: Some("Test conversation summary".to_string()),
            provider: None,
        };

        assert_json_snapshot!("claude_session", session);
    }
}

/// Snapshot tests for statistics structures
mod stats_snapshots {
    use super::*;

    #[test]
    fn snapshot_session_token_stats() {
        let stats = SessionTokenStats {
            session_id: "session-stats".to_string(),
            project_name: "stats-project".to_string(),
            total_input_tokens: 5000,
            total_output_tokens: 2500,
            total_cache_creation_tokens: 1000,
            total_cache_read_tokens: 500,
            total_tokens: 9000,
            message_count: 50,
            first_message_time: "2025-01-01T08:00:00Z".to_string(),
            last_message_time: "2025-01-01T17:00:00Z".to_string(),
            summary: None,
            most_used_tools: Vec::new(),
        };

        assert_json_snapshot!("session_token_stats", stats);
    }

    #[test]
    fn snapshot_daily_stats() {
        let stats = DailyStats {
            date: "2025-01-15".to_string(),
            total_tokens: 10000,
            input_tokens: 6000,
            output_tokens: 4000,
            message_count: 100,
            session_count: 5,
            active_hours: 8,
        };

        assert_json_snapshot!("daily_stats", stats);
    }

    #[test]
    fn snapshot_tool_usage_stats() {
        let stats = ToolUsageStats {
            tool_name: "Read".to_string(),
            usage_count: 150,
            success_rate: 98.5,
            avg_execution_time: Some(250.0),
        };

        assert_json_snapshot!("tool_usage_stats", stats);
    }
}

/// Snapshot tests for edit structures
mod edit_snapshots {
    use super::*;
    use crate::models::edit::*;

    #[test]
    fn snapshot_recent_file_edit() {
        let edit = RecentFileEdit {
            file_path: "/path/to/edited/file.rs".to_string(),
            timestamp: "2025-01-15T14:30:00Z".to_string(),
            session_id: "session-edit".to_string(),
            operation_type: "edit".to_string(),
            content_after_change: "fn main() {\n    println!(\"Hello!\");\n}".to_string(),
            original_content: Some("fn main() {}".to_string()),
            lines_added: 3,
            lines_removed: 1,
            cwd: Some("/path/to".to_string()),
        };

        assert_json_snapshot!("recent_file_edit", edit);
    }

    #[test]
    fn snapshot_recent_edits_result() {
        let result = RecentEditsResult {
            files: vec![RecentFileEdit {
                file_path: "/file1.rs".to_string(),
                timestamp: "2025-01-15T14:30:00Z".to_string(),
                session_id: "session-1".to_string(),
                operation_type: "edit".to_string(),
                content_after_change: "content1".to_string(),
                original_content: None,
                lines_added: 5,
                lines_removed: 2,
                cwd: Some("/project".to_string()),
            }],
            total_edits_count: 10,
            unique_files_count: 3,
            project_cwd: Some("/project".to_string()),
        };

        assert_json_snapshot!("recent_edits_result", result);
    }
}

/// String snapshot tests for formatted output
mod string_snapshots {
    use super::*;

    #[test]
    fn snapshot_error_message_format() {
        let error_msg = "CLAUDE_FOLDER_NOT_FOUND:Claude folder not found at /home/user/.claude";
        assert_snapshot!("error_message_format", error_msg);
    }
}
