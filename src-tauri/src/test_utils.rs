//! Test utilities and helpers for the claude-code-history-viewer crate.
//!
//! This module provides common test fixtures, builders, and utilities
//! to make testing easier and more consistent across the codebase.

#![cfg(test)]

use crate::models::*;
use serde_json::json;
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use tempfile::TempDir;

// Re-export commonly used test utilities
// Note: Use `use pretty_assertions::{assert_eq, assert_ne};` in specific test modules for better diffs
pub use proptest::prelude::*;
pub use rstest::*;

/// Test fixture for creating a mock Claude project structure
pub struct MockClaudeProject {
    pub temp_dir: TempDir,
    pub claude_dir: PathBuf,
    pub projects_dir: PathBuf,
}

impl MockClaudeProject {
    /// Create a new mock Claude project structure
    pub fn new() -> Self {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let claude_dir = temp_dir.path().join(".claude");
        let projects_dir = claude_dir.join("projects");
        fs::create_dir_all(&projects_dir).expect("Failed to create projects dir");

        Self {
            temp_dir,
            claude_dir,
            projects_dir,
        }
    }

    /// Add a project with the given name
    pub fn add_project(&self, name: &str) -> PathBuf {
        let project_dir = self.projects_dir.join(name);
        fs::create_dir_all(&project_dir).expect("Failed to create project dir");
        project_dir
    }

    /// Add a session file to a project
    pub fn add_session(&self, project_name: &str, session_name: &str, content: &str) -> PathBuf {
        let project_dir = self.add_project(project_name);
        let session_path = project_dir.join(format!("{session_name}.jsonl"));
        let mut file = File::create(&session_path).expect("Failed to create session file");
        file.write_all(content.as_bytes())
            .expect("Failed to write session content");
        session_path
    }

    /// Get the path to the .claude directory
    pub fn claude_path(&self) -> String {
        self.claude_dir.to_string_lossy().to_string()
    }
}

impl Default for MockClaudeProject {
    fn default() -> Self {
        Self::new()
    }
}

/// Builder for creating test `ClaudeMessage` instances
#[derive(Default)]
pub struct MessageBuilder {
    uuid: Option<String>,
    parent_uuid: Option<String>,
    session_id: Option<String>,
    timestamp: Option<String>,
    message_type: Option<String>,
    content: Option<serde_json::Value>,
    role: Option<String>,
    model: Option<String>,
    usage: Option<TokenUsage>,
}

impl MessageBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn user() -> Self {
        Self::new()
            .with_type("user")
            .with_role("user")
            .with_uuid(&uuid::Uuid::new_v4().to_string())
            .with_session_id("test-session")
            .with_timestamp("2025-01-01T00:00:00Z")
    }

    pub fn assistant() -> Self {
        Self::new()
            .with_type("assistant")
            .with_role("assistant")
            .with_uuid(&uuid::Uuid::new_v4().to_string())
            .with_session_id("test-session")
            .with_timestamp("2025-01-01T00:00:01Z")
            .with_model("claude-opus-4-20250514")
    }

    pub fn with_uuid(mut self, uuid: &str) -> Self {
        self.uuid = Some(uuid.to_string());
        self
    }

    pub fn with_parent_uuid(mut self, parent_uuid: &str) -> Self {
        self.parent_uuid = Some(parent_uuid.to_string());
        self
    }

    pub fn with_session_id(mut self, session_id: &str) -> Self {
        self.session_id = Some(session_id.to_string());
        self
    }

    pub fn with_timestamp(mut self, timestamp: &str) -> Self {
        self.timestamp = Some(timestamp.to_string());
        self
    }

    pub fn with_type(mut self, message_type: &str) -> Self {
        self.message_type = Some(message_type.to_string());
        self
    }

    pub fn with_content(mut self, content: serde_json::Value) -> Self {
        self.content = Some(content);
        self
    }

    pub fn with_text_content(mut self, text: &str) -> Self {
        self.content = Some(json!(text));
        self
    }

    pub fn with_role(mut self, role: &str) -> Self {
        self.role = Some(role.to_string());
        self
    }

    pub fn with_model(mut self, model: &str) -> Self {
        self.model = Some(model.to_string());
        self
    }

    pub fn with_usage(mut self, input: u32, output: u32) -> Self {
        self.usage = Some(TokenUsage {
            input_tokens: Some(input),
            output_tokens: Some(output),
            cache_creation_input_tokens: None,
            cache_read_input_tokens: None,
            reasoning_tokens: None,
            service_tier: None,
            ..Default::default()
        });
        self
    }

    pub fn build(self) -> ClaudeMessage {
        ClaudeMessage {
            uuid: self
                .uuid
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            parent_uuid: self.parent_uuid,
            session_id: self
                .session_id
                .unwrap_or_else(|| "test-session".to_string()),
            timestamp: self
                .timestamp
                .unwrap_or_else(|| "2025-01-01T00:00:00Z".to_string()),
            message_type: self.message_type.unwrap_or_else(|| "user".to_string()),
            content: self.content,
            project_name: None,
            tool_use: None,
            tool_use_result: None,
            is_sidechain: None,
            usage: self.usage,
            role: self.role,
            model: self.model,
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
        }
    }

    /// Build and serialize to JSONL format
    pub fn to_jsonl(&self) -> String {
        let role = self.role.clone().unwrap_or_else(|| "user".to_string());
        let content = self
            .content
            .clone()
            .unwrap_or_else(|| json!("test content"));

        let mut msg = json!({
            "uuid": self.uuid.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            "sessionId": self.session_id.clone().unwrap_or_else(|| "test-session".to_string()),
            "timestamp": self.timestamp.clone().unwrap_or_else(|| "2025-01-01T00:00:00Z".to_string()),
            "type": self.message_type.clone().unwrap_or_else(|| "user".to_string()),
            "message": {
                "role": role,
                "content": content
            }
        });

        if let Some(parent) = &self.parent_uuid {
            msg["parentUuid"] = json!(parent);
        }

        if let Some(model) = &self.model {
            msg["message"]["model"] = json!(model);
        }

        if let Some(usage) = &self.usage {
            msg["message"]["usage"] = json!({
                "input_tokens": usage.input_tokens,
                "output_tokens": usage.output_tokens
            });
        }

        serde_json::to_string(&msg).expect("Failed to serialize message")
    }
}

/// Create a JSONL file with multiple messages
pub fn create_jsonl_content(messages: &[MessageBuilder]) -> String {
    messages
        .iter()
        .map(MessageBuilder::to_jsonl)
        .collect::<Vec<_>>()
        .join("\n")
}

/// Proptest strategies for generating test data
pub mod strategies {
    use super::*;

    /// Generate a valid UUID string
    pub fn uuid_strategy() -> impl Strategy<Value = String> {
        "[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}"
    }

    /// Generate a valid timestamp
    pub fn timestamp_strategy() -> impl Strategy<Value = String> {
        (
            2020u32..2030,
            1u32..13,
            1u32..29,
            0u32..24,
            0u32..60,
            0u32..60,
        )
            .prop_map(|(year, month, day, hour, min, sec)| {
                format!("{year:04}-{month:02}-{day:02}T{hour:02}:{min:02}:{sec:02}Z")
            })
    }

    /// Generate a valid message type
    pub fn message_type_strategy() -> impl Strategy<Value = String> {
        prop_oneof![Just("user".to_string()), Just("assistant".to_string()),]
    }

    /// Generate a valid project name
    pub fn project_name_strategy() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9-]{2,20}"
    }

    /// Generate token counts
    pub fn token_count_strategy() -> impl Strategy<Value = u32> {
        0u32..100000
    }
}

/// Assertion helpers with better error messages
#[macro_export]
macro_rules! assert_ok {
    ($result:expr) => {
        match &$result {
            Ok(_) => {}
            Err(e) => panic!("Expected Ok, got Err: {:?}", e),
        }
    };
}

#[macro_export]
macro_rules! assert_err {
    ($result:expr) => {
        match &$result {
            Err(_) => {}
            Ok(v) => panic!("Expected Err, got Ok: {:?}", v),
        }
    };
}

#[macro_export]
macro_rules! assert_contains {
    ($haystack:expr, $needle:expr) => {
        if !$haystack.contains($needle) {
            panic!("Expected {:?} to contain {:?}", $haystack, $needle);
        }
    };
}

/// An absolute path on the host platform, written Unix-style.
///
/// `abs("tmp/session.jsonl")` is `/tmp/session.jsonl` on Unix and
/// `C:\tmp\session.jsonl` on Windows.
///
/// Fixtures used to spell these inline as `"/tmp/session.jsonl"`. On Windows
/// that string is *not* absolute — there is no drive — so code under test
/// rejected it with "path must be absolute" long before reaching the behaviour
/// the test was about, and the assertion failed for the wrong reason (#541).
pub fn abs(unix_relative: &str) -> String {
    let trimmed = unix_relative.trim_start_matches('/');
    if cfg!(windows) {
        format!(r"C:\{}", trimmed.replace('/', r"\"))
    } else {
        format!("/{trimmed}")
    }
}

/// A directory that really exists on the host, for fixtures that need a path
/// resolvable on disk rather than merely well-formed.
///
/// Unix fixtures reached for `/usr/lib`; Windows has no such directory, so the
/// canonical temp dir stands in on both.
pub fn existing_dir() -> PathBuf {
    std::fs::canonicalize(std::env::temp_dir()).expect("canonicalize temp dir")
}

/// Creates a nested directory tree under the canonical temp dir, encodes it
/// exactly the way Claude Code encodes a cwd on this platform, and returns the
/// encoded slug plus the root for cleanup.
///
/// Shared so fixtures needing a folder name that decodes to a real directory
/// stop reaching for `/usr/lib`, which does not exist on Windows (#541).
///
/// Original note: creates a nested directory tree under the
/// canonical temp dir, encodes it Claude-style, and returns the encoded
/// slug plus the root for cleanup. Canonicalization is required because
/// the decoder rejects symlinked path components (macOS `/var` →
/// `/private/var`).
pub fn make_encoded_path(root_name: &str, segments: &[&str]) -> (String, std::path::PathBuf) {
    let root = std::fs::canonicalize(std::env::temp_dir())
        .expect("canonicalize temp dir")
        .join(root_name);
    let mut deep = root.clone();
    for s in segments {
        deep = deep.join(s);
    }
    std::fs::create_dir_all(&deep).expect("create deep tmp dir");

    (encode_path_claude_style(&deep), root)
}

/// Encodes an absolute path the way Claude Code names a project folder.
///
/// Every separator becomes `-`. On Windows the drive colon goes too, so
/// `C:\Temp\x` is `C--Temp-x` - drive-lettered and, unlike Unix, with no
/// leading dash.
///
/// The Windows extended-length prefix is stripped first: `canonicalize` hands
/// back `\\?\C:\...`, which Claude Code never sees, and encoding it would
/// produce `--?-C--Users-...`, a shape that exists nowhere (#548).
pub fn encode_path_claude_style(path: &std::path::Path) -> String {
    let raw = path.to_string_lossy();
    let plain = raw
        .strip_prefix(r"\\?\UNC\")
        .map(|rest| format!(r"\\{rest}"))
        .unwrap_or_else(|| raw.strip_prefix(r"\\?\").unwrap_or(&raw).to_string());
    plain.replace(['/', '\\', ':'], "-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_builder_user() {
        let msg = MessageBuilder::user().with_text_content("Hello!").build();

        assert_eq!(msg.message_type, "user");
        assert_eq!(msg.role, Some("user".to_string()));
    }

    #[test]
    fn test_message_builder_assistant() {
        let msg = MessageBuilder::assistant()
            .with_text_content("Hi there!")
            .with_usage(100, 50)
            .build();

        assert_eq!(msg.message_type, "assistant");
        assert_eq!(msg.model, Some("claude-opus-4-20250514".to_string()));
        assert!(msg.usage.is_some());
    }

    #[test]
    fn test_mock_claude_project() {
        let mock = MockClaudeProject::new();
        let session_path = mock.add_session("test-project", "session1", "{}");

        assert!(session_path.exists());
        assert!(mock.projects_dir.join("test-project").exists());
    }

    #[test]
    fn test_create_jsonl_content() {
        let messages = vec![
            MessageBuilder::user().with_text_content("Hello"),
            MessageBuilder::assistant().with_text_content("Hi!"),
        ];

        let content = create_jsonl_content(&messages);
        let lines: Vec<&str> = content.lines().collect();

        assert_eq!(lines.len(), 2);
    }
}
