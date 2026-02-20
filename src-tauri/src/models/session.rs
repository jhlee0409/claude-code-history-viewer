use serde::{Deserialize, Serialize};

/// Git worktree 유형
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum GitWorktreeType {
    /// 메인 레포지토리 (.git이 디렉토리)
    Main,
    /// 링크드 워크트리 (.git이 파일)
    Linked,
    /// Git 레포가 아님
    NotGit,
}

/// Git worktree 정보
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GitInfo {
    /// 워크트리 유형
    pub worktree_type: GitWorktreeType,
    /// 메인 레포의 프로젝트 경로 (링크드 워크트리인 경우)
    /// 예: "/Users/jack/my-project"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub main_project_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeProject {
    pub name: String,
    /// Claude session storage path (e.g., "~/.claude/projects/-Users-jack-client-my-project")
    pub path: String,
    /// Decoded actual filesystem path (e.g., "/Users/jack/client/my-project")
    pub actual_path: String,
    pub session_count: usize,
    pub message_count: usize,
    pub last_modified: String,
    /// Git worktree 정보
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_info: Option<GitInfo>,
    /// Provider identifier (claude, codex, opencode)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeSession {
    pub session_id: String,        // Unique ID based on file path
    pub actual_session_id: String, // Actual session ID from the messages
    pub file_path: String,
    pub project_name: String,
    pub message_count: usize,
    pub first_message_time: String,
    pub last_message_time: String,
    pub last_modified: String,
    pub has_tool_use: bool,
    pub has_errors: bool,
    pub summary: Option<String>,
    /// Provider identifier (claude, codex, opencode)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCommit {
    pub hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
    pub timestamp: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_claude_session_serialization() {
        let session = ClaudeSession {
            session_id: "/path/to/file.jsonl".to_string(),
            actual_session_id: "actual-session-id".to_string(),
            file_path: "/path/to/file.jsonl".to_string(),
            project_name: "my-project".to_string(),
            message_count: 42,
            first_message_time: "2025-06-01T10:00:00Z".to_string(),
            last_message_time: "2025-06-01T12:00:00Z".to_string(),
            last_modified: "2025-06-01T12:00:00Z".to_string(),
            has_tool_use: true,
            has_errors: false,
            summary: Some("Test conversation".to_string()),
            provider: None,
        };

        let serialized = serde_json::to_string(&session).unwrap();
        let deserialized: ClaudeSession = serde_json::from_str(&serialized).unwrap();

        assert_eq!(deserialized.project_name, "my-project");
        assert_eq!(deserialized.message_count, 42);
        assert!(deserialized.has_tool_use);
        assert!(!deserialized.has_errors);
    }
}
