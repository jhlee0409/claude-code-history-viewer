use serde::{Deserialize, Serialize};
use std::path::Path;

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

/// Availability of a project's last-known filesystem location.
///
/// This is intentionally only serialized for unavailable absolute paths. A
/// missing worktree does not mean the conversation is gone; it only means
/// path-dependent actions such as opening the folder or resuming in that cwd
/// need to be disabled.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProjectPathStatus {
    Unavailable,
}

#[derive(Debug, Clone, Deserialize)]
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
    /// Storage type (json, sqlite)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage_type: Option<String>,
    /// Label for custom Claude directory source (e.g., "Personal")
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_directory_label: Option<String>,
}

#[derive(Serialize)]
struct ClaudeProjectPayload<'a> {
    name: &'a str,
    path: &'a str,
    actual_path: &'a str,
    session_count: usize,
    message_count: usize,
    last_modified: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    path_status: Option<ProjectPathStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    git_info: &'a Option<GitInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: &'a Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    storage_type: &'a Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    custom_directory_label: &'a Option<String>,
}

impl Serialize for ClaudeProject {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        ClaudeProjectPayload {
            name: &self.name,
            path: &self.path,
            actual_path: &self.actual_path,
            session_count: self.session_count,
            message_count: self.message_count,
            last_modified: &self.last_modified,
            path_status: project_path_status(&self.actual_path),
            git_info: &self.git_info,
            provider: &self.provider,
            storage_type: &self.storage_type,
            custom_directory_label: &self.custom_directory_label,
        }
        .serialize(serializer)
    }
}

fn project_path_status(actual_path: &str) -> Option<ProjectPathStatus> {
    let path = actual_path.trim();
    if path.is_empty() || path.contains("://") || !Path::new(path).is_absolute() {
        return None;
    }

    (!Path::new(path).is_dir()).then_some(ProjectPathStatus::Unavailable)
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
    /// Whether this session was explicitly renamed via the /rename command
    #[serde(default)]
    pub is_renamed: bool,
    /// Provider identifier (claude, codex, opencode)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// Storage type (json, sqlite)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage_type: Option<String>,
    /// Originating client for Claude Code sessions: "cli" / "claude-vscode" / "claude-desktop".
    /// `None` for non-Claude providers or sessions predating the entrypoint field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entrypoint: Option<String>,
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

    fn project_with_path(actual_path: &str) -> ClaudeProject {
        ClaudeProject {
            name: "test-project".to_string(),
            path: "/tmp/.claude/projects/-tmp-test-project".to_string(),
            actual_path: actual_path.to_string(),
            session_count: 1,
            message_count: 1,
            last_modified: "2026-01-01T00:00:00Z".to_string(),
            git_info: None,
            provider: None,
            storage_type: None,
            custom_directory_label: None,
        }
    }

    #[test]
    fn unavailable_project_path_is_exposed_without_hiding_the_project() {
        let project =
            project_with_path(&crate::test_utils::abs("definitely-missing-claude-project"));
        let serialized = serde_json::to_value(project).unwrap();

        assert_eq!(
            serialized.get("path_status"),
            Some(&serde_json::json!("unavailable"))
        );
        assert_eq!(
            serialized.get("name"),
            Some(&serde_json::json!("test-project"))
        );
        assert_eq!(serialized.get("session_count"), Some(&serde_json::json!(1)));
    }

    #[test]
    fn existing_and_virtual_project_paths_are_not_marked_unavailable() {
        let temp_dir = tempfile::tempdir().unwrap();
        let existing = serde_json::to_value(project_with_path(
            temp_dir.path().to_string_lossy().as_ref(),
        ))
        .unwrap();
        let virtual_path =
            serde_json::to_value(project_with_path("forgecode://workspace/ws-123")).unwrap();

        assert!(existing.get("path_status").is_none());
        assert!(virtual_path.get("path_status").is_none());
    }

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
            is_renamed: false,
            provider: None,
            storage_type: None,
            entrypoint: None,
        };

        let serialized = serde_json::to_string(&session).unwrap();
        let deserialized: ClaudeSession = serde_json::from_str(&serialized).unwrap();

        assert_eq!(deserialized.project_name, "my-project");
        assert_eq!(deserialized.message_count, 42);
        assert!(deserialized.has_tool_use);
        assert!(!deserialized.has_errors);
    }
}
