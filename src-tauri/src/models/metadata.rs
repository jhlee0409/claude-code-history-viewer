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

    /// Where the session lives, recorded when it is starred, so a favourite
    /// opens without scanning every project. Optional: stars saved before it
    /// existed have none until their project is opened (plan T7).
    #[serde(rename = "ref", default, skip_serializing_if = "Option::is_none")]
    pub session_ref: Option<SessionRefMetadata>,
}

/// A session's location: it loads by `file_path` + `provider`; `session_id`
/// is the metadata key (the frontend's `SessionRef`). `project_path` is the
/// path of the project that lists it - for most providers a virtual path
/// (`codex://{cwd}`) that does not contain the file - so the frontend opens
/// that project directly. Refs saved before it have none.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionRefMetadata {
    pub provider: String,
    pub file_path: String,
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actual_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
}

impl SessionMetadata {
    /// Check if metadata has any values set
    pub fn is_empty(&self) -> bool {
        self.custom_name.is_none()
            && self.starred.is_none()
            && self.tags.is_empty()
            && self.notes.is_none()
            && self.session_ref.is_none()
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

/// A user-registered custom Claude configuration directory
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CustomClaudePath {
    /// Absolute path to the Claude config directory (e.g., "~/.claude-personal")
    pub path: String,
    /// User-defined display label (e.g., "Personal")
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// WSL (Windows Subsystem for Linux) integration settings
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WslSettings {
    /// Whether WSL scanning is enabled
    #[serde(default)]
    pub enabled: bool,
    /// List of WSL distro names to exclude from scanning
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub excluded_distros: Vec<String>,
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

    /// Whether user has explicitly set worktree grouping (prevents auto-override)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_grouping_user_set: Option<bool>,

    /// Project tree grouping mode: "none", "worktree", or "directory"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grouping_mode: Option<String>,

    /// Additional Claude configuration directories to scan
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub custom_claude_paths: Vec<CustomClaudePath>,

    /// WSL integration settings (Windows only)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wsl: Option<WslSettings>,

    /// Providers explicitly discovered by the user and allowed to scan on startup
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub discovered_provider_ids: Vec<String>,

    /// An explicit provider discovery completed, even one that found nothing
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub providers_discovered: Option<bool>,

    /// Custom CLI arguments per provider for session resumption
    #[serde(default, skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub resume_cli_args: std::collections::HashMap<String, String>,
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

    /// A favourite records where its session lives (`ref`, plan T7), so the
    /// sidebar can open it without scanning every project.
    #[test]
    fn test_session_ref_roundtrip_in_the_frontend_wire_format() {
        let json = serde_json::json!({
            "starred": true,
            "ref": {
                "provider": "codex",
                "filePath": "/home/u/.codex/sessions/rollout-1.jsonl",
                "sessionId": "s-1",
                "actualSessionId": "a-1"
            }
        });
        let session: SessionMetadata = serde_json::from_value(json.clone()).unwrap();
        let session_ref = session.session_ref.clone().expect("ref is kept");
        assert_eq!(session_ref.provider, "codex");
        assert_eq!(
            session_ref.file_path,
            "/home/u/.codex/sessions/rollout-1.jsonl"
        );
        assert_eq!(session_ref.session_id, "s-1");
        assert_eq!(session_ref.actual_session_id.as_deref(), Some("a-1"));
        assert!(!session.is_empty());
        assert_eq!(serde_json::to_value(&session).unwrap(), json);
    }

    /// A library ref names the project that lists the session (`projectPath`):
    /// for most providers the project path is virtual (`codex://{cwd}`) and
    /// does not contain the session file, so the file path alone cannot find
    /// it. A ref without it (saved earlier) loads and gains no key.
    #[test]
    fn test_session_ref_keeps_the_project_path() {
        let json = serde_json::json!({
            "starred": true,
            "ref": {
                "provider": "codex",
                "filePath": "/home/u/.codex/sessions/2026/10/15/rollout-1.jsonl",
                "sessionId": "s-1",
                "projectPath": "codex:///work/alpha"
            }
        });
        let session: SessionMetadata = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(
            session
                .session_ref
                .as_ref()
                .and_then(|r| r.project_path.as_deref()),
            Some("codex:///work/alpha")
        );
        assert_eq!(serde_json::to_value(&session).unwrap(), json);

        let earlier: SessionMetadata = serde_json::from_value(serde_json::json!({
            "ref": { "provider": "claude", "filePath": "/p/s.jsonl", "sessionId": "s" }
        }))
        .unwrap();
        assert!(earlier.session_ref.as_ref().unwrap().project_path.is_none());
        assert!(serde_json::to_value(&earlier).unwrap()["ref"]
            .get("projectPath")
            .is_none());
    }

    /// Stars recorded before `ref` existed still load, and gain no `ref` key.
    #[test]
    fn test_legacy_star_without_ref_loads_and_serializes_without_ref() {
        let session: SessionMetadata =
            serde_json::from_value(serde_json::json!({ "starred": true })).unwrap();
        assert!(session.session_ref.is_none());
        let out = serde_json::to_value(&session).unwrap();
        assert_eq!(out, serde_json::json!({ "starred": true }));

        let ref_only: SessionMetadata = serde_json::from_value(serde_json::json!({
            "ref": { "provider": "claude", "filePath": "/p/s.jsonl", "sessionId": "s" }
        }))
        .unwrap();
        assert!(
            !ref_only.is_empty(),
            "a ref alone is metadata worth keeping"
        );
        assert!(serde_json::to_value(&ref_only).unwrap()["ref"]
            .get("actualSessionId")
            .is_none());
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

    #[test]
    fn test_wsl_settings_roundtrip() {
        let mut metadata = UserMetadata::new();
        metadata.settings.wsl = Some(WslSettings {
            enabled: true,
            excluded_distros: vec!["Debian".to_string()],
        });

        let json = serde_json::to_string(&metadata).unwrap();
        let deserialized: UserMetadata = serde_json::from_str(&json).unwrap();

        assert_eq!(metadata, deserialized);
        let wsl = deserialized.settings.wsl.unwrap();
        assert!(wsl.enabled);
        assert_eq!(wsl.excluded_distros, vec!["Debian"]);
    }

    #[test]
    fn test_wsl_settings_defaults_when_absent() {
        let json = r#"{"sessions":{},"projects":{},"settings":{}}"#;
        let metadata: UserMetadata = serde_json::from_str(json).unwrap();
        assert!(metadata.settings.wsl.is_none());
    }

    #[test]
    fn test_discovered_provider_ids_roundtrip() {
        let mut metadata = UserMetadata::new();
        metadata.settings.discovered_provider_ids = vec!["codex".to_string(), "gemini".to_string()];

        let json = serde_json::to_string(&metadata).unwrap();
        assert!(json.contains("discoveredProviderIds"));

        let deserialized: UserMetadata = serde_json::from_str(&json).unwrap();
        assert_eq!(
            deserialized.settings.discovered_provider_ids,
            vec!["codex", "gemini"]
        );
    }

    #[test]
    fn test_providers_discovered_survives_a_zero_result_discovery() {
        // A discovery that found nothing saves no provider IDs (the empty Vec
        // is skipped), so completion is its own field.
        let mut metadata = UserMetadata::new();
        metadata.settings.providers_discovered = Some(true);

        let json = serde_json::to_string(&metadata).unwrap();
        assert!(json.contains("\"providersDiscovered\":true"));
        assert!(!json.contains("discoveredProviderIds"));

        let deserialized: UserMetadata = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.settings.providers_discovered, Some(true));
    }

    #[test]
    fn test_providers_discovered_absent_by_default() {
        let json = r#"{"sessions":{},"projects":{},"settings":{}}"#;
        let metadata: UserMetadata = serde_json::from_str(json).unwrap();
        assert!(metadata.settings.providers_discovered.is_none());
        assert!(!serde_json::to_string(&metadata)
            .unwrap()
            .contains("providersDiscovered"));
    }
}
