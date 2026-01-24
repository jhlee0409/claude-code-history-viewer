//! User metadata models for storing custom data
//!
//! This module contains data structures for user-specific metadata
//! that is stored separately from Claude Code's original data.
//! Location: ~/.claude-history-viewer/user-data.json

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Current schema version for migration support
pub const METADATA_SCHEMA_VERSION: u32 = 1;

/// Root structure for all user metadata
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UserMetadata {
    /// Schema version for migration support
    #[serde(default = "default_version")]
    pub version: u32,

    /// Session-specific metadata, keyed by session ID
    #[serde(default)]
    pub sessions: HashMap<String, SessionMetadata>,

    /// Project-specific metadata, keyed by project path
    #[serde(default)]
    pub projects: HashMap<String, ProjectMetadata>,

    /// Global user settings
    #[serde(default)]
    pub settings: UserSettings,
}

fn default_version() -> u32 {
    METADATA_SCHEMA_VERSION
}

impl UserMetadata {
    /// Create a new `UserMetadata` with default values
    pub fn new() -> Self {
        Self {
            version: METADATA_SCHEMA_VERSION,
            sessions: HashMap::new(),
            projects: HashMap::new(),
            settings: UserSettings::default(),
        }
    }

    /// Get session metadata, returning None if not found
    pub fn get_session(&self, session_id: &str) -> Option<&SessionMetadata> {
        self.sessions.get(session_id)
    }

    /// Get mutable session metadata, creating if not exists
    pub fn get_session_mut(&mut self, session_id: &str) -> &mut SessionMetadata {
        self.sessions.entry(session_id.to_string()).or_default()
    }

    /// Get project metadata, returning None if not found
    pub fn get_project(&self, project_path: &str) -> Option<&ProjectMetadata> {
        self.projects.get(project_path)
    }

    /// Get mutable project metadata, creating if not exists
    pub fn get_project_mut(&mut self, project_path: &str) -> &mut ProjectMetadata {
        self.projects.entry(project_path.to_string()).or_default()
    }

    /// Check if a project should be hidden based on settings
    pub fn is_project_hidden(&self, project_path: &str) -> bool {
        // Check explicit hidden flag
        if let Some(project) = self.projects.get(project_path) {
            if project.hidden.unwrap_or(false) {
                return true;
            }
        }

        // Check hidden patterns
        for pattern in &self.settings.hidden_patterns {
            if Self::matches_glob_pattern(project_path, pattern) {
                return true;
            }
        }

        false
    }

    /// Maximum pattern length to prevent `ReDoS` attacks
    const MAX_PATTERN_LENGTH: usize = 256;
    /// Maximum number of wildcards to prevent catastrophic backtracking
    const MAX_WILDCARDS: usize = 10;

    /// Simple glob pattern matching (supports * and ?)
    /// Returns false for patterns that exceed safety limits
    fn matches_glob_pattern(text: &str, pattern: &str) -> bool {
        // ReDoS protection: reject overly long patterns
        if pattern.len() > Self::MAX_PATTERN_LENGTH {
            return false;
        }

        // ReDoS protection: reject patterns with too many wildcards
        let wildcard_count = pattern.chars().filter(|&c| c == '*' || c == '?').count();
        if wildcard_count > Self::MAX_WILDCARDS {
            return false;
        }

        let pattern_chars: Vec<char> = pattern.chars().collect();
        let text_chars: Vec<char> = text.chars().collect();

        Self::glob_match_helper(&pattern_chars, &text_chars)
    }

    fn glob_match_helper(pattern: &[char], text: &[char]) -> bool {
        if pattern.is_empty() {
            return text.is_empty();
        }

        match pattern[0] {
            '*' => {
                // Try matching zero or more characters
                for i in 0..=text.len() {
                    if Self::glob_match_helper(&pattern[1..], &text[i..]) {
                        return true;
                    }
                }
                false
            }
            '?' => {
                // Match exactly one character
                !text.is_empty() && Self::glob_match_helper(&pattern[1..], &text[1..])
            }
            c => {
                // Match literal character
                !text.is_empty()
                    && text[0] == c
                    && Self::glob_match_helper(&pattern[1..], &text[1..])
            }
        }
    }
}

/// Metadata for individual sessions
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionMetadata {
    /// Custom name for the session (overrides auto-generated summary)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_name: Option<String>,

    /// Whether the session is starred/favorited
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred: Option<bool>,

    /// User-defined tags for organization
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,

    /// User notes about the session
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

impl SessionMetadata {
    /// Check if metadata has any values set
    pub fn is_empty(&self) -> bool {
        self.custom_name.is_none()
            && self.starred.is_none()
            && self.tags.is_empty()
            && self.notes.is_none()
    }
}

/// Metadata for individual projects
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMetadata {
    /// Whether the project is hidden from the sidebar
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,

    /// Custom alias/display name for the project
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,

    /// Parent project path for worktree grouping
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_project: Option<String>,
}

impl ProjectMetadata {
    /// Check if metadata has any values set
    pub fn is_empty(&self) -> bool {
        self.hidden.is_none() && self.alias.is_none() && self.parent_project.is_none()
    }
}

/// Global user settings
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UserSettings {
    /// Glob patterns for projects to hide (e.g., "folders-dg-*")
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hidden_patterns: Vec<String>,

    /// Whether to automatically group worktrees under their parent repos
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_grouping: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_metadata() {
        let metadata = UserMetadata::new();
        assert_eq!(metadata.version, METADATA_SCHEMA_VERSION);
        assert!(metadata.sessions.is_empty());
        assert!(metadata.projects.is_empty());
    }

    #[test]
    fn test_get_session_mut_creates_entry() {
        let mut metadata = UserMetadata::new();
        let session = metadata.get_session_mut("test-session");
        session.custom_name = Some("Test Name".to_string());

        assert!(metadata.sessions.contains_key("test-session"));
        assert_eq!(
            metadata.sessions.get("test-session").unwrap().custom_name,
            Some("Test Name".to_string())
        );
    }

    #[test]
    fn test_is_project_hidden_explicit() {
        let mut metadata = UserMetadata::new();
        let project = metadata.get_project_mut("my-project");
        project.hidden = Some(true);

        assert!(metadata.is_project_hidden("my-project"));
        assert!(!metadata.is_project_hidden("other-project"));
    }

    #[test]
    fn test_is_project_hidden_pattern() {
        let mut metadata = UserMetadata::new();
        metadata
            .settings
            .hidden_patterns
            .push("folders-dg-*".to_string());

        assert!(metadata.is_project_hidden("folders-dg-abc123"));
        assert!(metadata.is_project_hidden("folders-dg-xyz"));
        assert!(!metadata.is_project_hidden("my-project"));
    }

    #[test]
    fn test_glob_pattern_matching() {
        assert!(UserMetadata::matches_glob_pattern("abc", "abc"));
        assert!(UserMetadata::matches_glob_pattern("abc", "a*"));
        assert!(UserMetadata::matches_glob_pattern("abc", "*c"));
        assert!(UserMetadata::matches_glob_pattern("abc", "a?c"));
        assert!(UserMetadata::matches_glob_pattern("abc", "*"));
        assert!(!UserMetadata::matches_glob_pattern("abc", "ab"));
        assert!(!UserMetadata::matches_glob_pattern("abc", "a?"));
    }

    #[test]
    fn test_session_metadata_is_empty() {
        let empty = SessionMetadata::default();
        assert!(empty.is_empty());

        let with_name = SessionMetadata {
            custom_name: Some("Test".to_string()),
            ..Default::default()
        };
        assert!(!with_name.is_empty());
    }

    #[test]
    fn test_serialization_roundtrip() {
        let mut metadata = UserMetadata::new();
        let session = metadata.get_session_mut("session-1");
        session.custom_name = Some("My Session".to_string());
        session.starred = Some(true);
        session.tags = vec!["work".to_string(), "important".to_string()];

        let project = metadata.get_project_mut("my-project");
        project.alias = Some("Main Project".to_string());

        let json = serde_json::to_string_pretty(&metadata).unwrap();
        let deserialized: UserMetadata = serde_json::from_str(&json).unwrap();

        assert_eq!(metadata, deserialized);
    }
}
