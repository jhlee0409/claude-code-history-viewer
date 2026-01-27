use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenUsage {
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub cache_creation_input_tokens: Option<u32>,
    pub cache_read_input_tokens: Option<u32>,
    pub service_tier: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageContent {
    pub role: String,
    pub content: serde_json::Value,
    // Optional fields for assistant messages
    pub id: Option<String>,
    pub model: Option<String>,
    pub stop_reason: Option<String>,
    pub usage: Option<TokenUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawLogEntry {
    pub uuid: Option<String>,
    #[serde(rename = "parentUuid")]
    pub parent_uuid: Option<String>,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
    pub timestamp: Option<String>,
    #[serde(rename = "type")]
    pub message_type: String,

    // Fields for summary
    pub summary: Option<String>,
    #[serde(rename = "leafUuid")]
    pub leaf_uuid: Option<String>,

    // Fields for regular messages
    pub message: Option<MessageContent>,
    #[serde(rename = "toolUse")]
    pub tool_use: Option<serde_json::Value>,
    #[serde(rename = "toolUseResult")]
    pub tool_use_result: Option<serde_json::Value>,
    #[serde(rename = "isSidechain")]
    pub is_sidechain: Option<bool>,
    pub cwd: Option<String>,

    // Cost and performance metrics (2025 additions)
    #[serde(rename = "costUSD")]
    pub cost_usd: Option<f64>,
    #[serde(rename = "durationMs")]
    pub duration_ms: Option<u64>,

    // File history snapshot fields (for type: "file-history-snapshot")
    #[serde(rename = "messageId")]
    pub message_id: Option<String>,
    pub snapshot: Option<serde_json::Value>,
    #[serde(rename = "isSnapshotUpdate")]
    pub is_snapshot_update: Option<bool>,

    // Progress message fields (for type: "progress")
    pub data: Option<serde_json::Value>,
    #[serde(rename = "toolUseID")]
    pub tool_use_id: Option<String>,
    #[serde(rename = "parentToolUseID")]
    pub parent_tool_use_id: Option<String>,

    // Queue operation fields (for type: "queue-operation")
    pub operation: Option<String>,

    // System message fields
    pub subtype: Option<String>,
    pub level: Option<String>,
    #[serde(rename = "hookCount")]
    pub hook_count: Option<u32>,
    #[serde(rename = "hookInfos")]
    pub hook_infos: Option<serde_json::Value>,
    #[serde(rename = "stopReason")]
    pub stop_reason_system: Option<String>,
    #[serde(rename = "preventedContinuation")]
    pub prevented_continuation: Option<bool>,
    #[serde(rename = "compactMetadata")]
    pub compact_metadata: Option<serde_json::Value>,
    #[serde(rename = "microcompactMetadata")]
    pub microcompact_metadata: Option<serde_json::Value>,
    pub content: Option<serde_json::Value>,

    // Meta message flag (internal/command-related messages)
    #[serde(rename = "isMeta")]
    pub is_meta: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeMessage {
    pub uuid: String,
    #[serde(rename = "parentUuid")]
    pub parent_uuid: Option<String>,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub timestamp: String,
    #[serde(rename = "type")]
    pub message_type: String,
    pub content: Option<serde_json::Value>,
    /// Project name (extracted from file path during search)
    #[serde(rename = "projectName", skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    #[serde(rename = "toolUse")]
    pub tool_use: Option<serde_json::Value>,
    #[serde(rename = "toolUseResult")]
    pub tool_use_result: Option<serde_json::Value>,
    #[serde(rename = "isSidechain")]
    pub is_sidechain: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<TokenUsage>,
    // Additional fields from MessageContent that might be useful
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
    // Cost and performance metrics (2025 additions)
    #[serde(rename = "costUSD", skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    #[serde(rename = "durationMs", skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,

    // File history snapshot fields (for type: "file-history-snapshot")
    #[serde(rename = "messageId", skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<serde_json::Value>,
    #[serde(rename = "isSnapshotUpdate", skip_serializing_if = "Option::is_none")]
    pub is_snapshot_update: Option<bool>,

    // Progress message fields (for type: "progress")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(rename = "toolUseID", skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
    #[serde(rename = "parentToolUseID", skip_serializing_if = "Option::is_none")]
    pub parent_tool_use_id: Option<String>,

    // Queue operation fields (for type: "queue-operation")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation: Option<String>,

    // System message fields
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtype: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<String>,
    #[serde(rename = "hookCount", skip_serializing_if = "Option::is_none")]
    pub hook_count: Option<u32>,
    #[serde(rename = "hookInfos", skip_serializing_if = "Option::is_none")]
    pub hook_infos: Option<serde_json::Value>,
    #[serde(rename = "stopReasonSystem", skip_serializing_if = "Option::is_none")]
    pub stop_reason_system: Option<String>,
    #[serde(
        rename = "preventedContinuation",
        skip_serializing_if = "Option::is_none"
    )]
    pub prevented_continuation: Option<bool>,
    #[serde(rename = "compactMetadata", skip_serializing_if = "Option::is_none")]
    pub compact_metadata: Option<serde_json::Value>,
    #[serde(
        rename = "microcompactMetadata",
        skip_serializing_if = "Option::is_none"
    )]
    pub microcompact_metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessagePage {
    pub messages: Vec<ClaudeMessage>,
    pub total_count: usize,
    pub has_more: bool,
    pub next_offset: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_token_usage_serialization() {
        let usage = TokenUsage {
            input_tokens: Some(100),
            output_tokens: Some(200),
            cache_creation_input_tokens: Some(50),
            cache_read_input_tokens: Some(25),
            service_tier: Some("standard".to_string()),
        };

        let serialized = serde_json::to_string(&usage).unwrap();
        let deserialized: TokenUsage = serde_json::from_str(&serialized).unwrap();

        assert_eq!(deserialized.input_tokens, Some(100));
        assert_eq!(deserialized.output_tokens, Some(200));
        assert_eq!(deserialized.cache_creation_input_tokens, Some(50));
        assert_eq!(deserialized.cache_read_input_tokens, Some(25));
        assert_eq!(deserialized.service_tier, Some("standard".to_string()));
    }

    #[test]
    fn test_token_usage_with_none_values() {
        let json_str = r#"{"input_tokens": 100}"#;
        let usage: TokenUsage = serde_json::from_str(json_str).unwrap();

        assert_eq!(usage.input_tokens, Some(100));
        assert_eq!(usage.output_tokens, None);
        assert_eq!(usage.cache_creation_input_tokens, None);
    }

    #[test]
    fn test_message_content_user() {
        let json_str = r#"{
            "role": "user",
            "content": "Hello, Claude!"
        }"#;

        let content: MessageContent = serde_json::from_str(json_str).unwrap();
        assert_eq!(content.role, "user");
        assert_eq!(content.content.as_str().unwrap(), "Hello, Claude!");
        assert!(content.id.is_none());
        assert!(content.model.is_none());
    }

    #[test]
    fn test_message_content_assistant_with_metadata() {
        let json_str = r#"{
            "role": "assistant",
            "content": [{"type": "text", "text": "Hello!"}],
            "id": "msg_123",
            "model": "claude-opus-4-20250514",
            "stop_reason": "end_turn",
            "usage": {
                "input_tokens": 100,
                "output_tokens": 50
            }
        }"#;

        let content: MessageContent = serde_json::from_str(json_str).unwrap();
        assert_eq!(content.role, "assistant");
        assert_eq!(content.id, Some("msg_123".to_string()));
        assert_eq!(content.model, Some("claude-opus-4-20250514".to_string()));
        assert_eq!(content.stop_reason, Some("end_turn".to_string()));
        assert!(content.usage.is_some());
    }

    #[test]
    fn test_raw_log_entry_user_message() {
        let json_str = r#"{
            "uuid": "test-uuid-123",
            "parentUuid": "parent-uuid-456",
            "sessionId": "session-789",
            "timestamp": "2025-06-26T11:45:51.979Z",
            "type": "user",
            "message": {
                "role": "user",
                "content": "What is Rust?"
            }
        }"#;

        let entry: RawLogEntry = serde_json::from_str(json_str).unwrap();
        assert_eq!(entry.uuid, Some("test-uuid-123".to_string()));
        assert_eq!(entry.parent_uuid, Some("parent-uuid-456".to_string()));
        assert_eq!(entry.session_id, Some("session-789".to_string()));
        assert_eq!(entry.message_type, "user");
        assert!(entry.message.is_some());
        assert!(entry.is_sidechain.is_none());
    }

    #[test]
    fn test_raw_log_entry_summary() {
        let json_str = r#"{
            "type": "summary",
            "summary": "This is a summary of the conversation",
            "leafUuid": "leaf-uuid-123"
        }"#;

        let entry: RawLogEntry = serde_json::from_str(json_str).unwrap();
        assert_eq!(entry.message_type, "summary");
        assert_eq!(
            entry.summary,
            Some("This is a summary of the conversation".to_string())
        );
        assert_eq!(entry.leaf_uuid, Some("leaf-uuid-123".to_string()));
    }

    #[test]
    fn test_raw_log_entry_with_tool_use() {
        let json_str = r#"{
            "uuid": "test-uuid",
            "sessionId": "session-123",
            "timestamp": "2025-06-26T12:00:00Z",
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [{"type": "tool_use", "name": "Read", "id": "tool_123"}]
            },
            "toolUse": {"name": "Read", "input": {"file_path": "/test.txt"}},
            "isSidechain": false
        }"#;

        let entry: RawLogEntry = serde_json::from_str(json_str).unwrap();
        assert_eq!(entry.message_type, "assistant");
        assert!(entry.tool_use.is_some());
        assert_eq!(entry.is_sidechain, Some(false));
    }

    #[test]
    fn test_claude_message_serialization() {
        let message = ClaudeMessage {
            uuid: "msg-uuid-123".to_string(),
            parent_uuid: Some("parent-uuid".to_string()),
            session_id: "session-123".to_string(),
            timestamp: "2025-06-26T12:00:00Z".to_string(),
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
        };

        let serialized = serde_json::to_string(&message).unwrap();
        let deserialized: ClaudeMessage = serde_json::from_str(&serialized).unwrap();

        assert_eq!(deserialized.uuid, "msg-uuid-123");
        assert_eq!(deserialized.session_id, "session-123");
        assert_eq!(deserialized.message_type, "user");
    }

    #[test]
    fn test_claude_message_with_optional_fields_skipped() {
        let message = ClaudeMessage {
            uuid: "uuid".to_string(),
            parent_uuid: None,
            session_id: "session".to_string(),
            timestamp: "2025-01-01T00:00:00Z".to_string(),
            message_type: "user".to_string(),
            content: None,
            project_name: None,
            tool_use: None,
            tool_use_result: None,
            is_sidechain: None,
            usage: None,
            role: None,
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
        };

        let serialized = serde_json::to_string(&message).unwrap();
        // Optional fields with skip_serializing_if should not appear
        assert!(!serialized.contains("usage"));
        assert!(!serialized.contains("role"));
        assert!(!serialized.contains("messageId"));
        assert!(!serialized.contains("model"));
        assert!(!serialized.contains("stop_reason"));
        assert!(!serialized.contains("costUSD"));
        assert!(!serialized.contains("durationMs"));
    }

    #[test]
    fn test_message_page_serialization() {
        let page = MessagePage {
            messages: vec![],
            total_count: 100,
            has_more: true,
            next_offset: 20,
        };

        let serialized = serde_json::to_string(&page).unwrap();
        let deserialized: MessagePage = serde_json::from_str(&serialized).unwrap();

        assert_eq!(deserialized.total_count, 100);
        assert!(deserialized.has_more);
        assert_eq!(deserialized.next_offset, 20);
    }

    #[test]
    fn test_content_array_parsing() {
        let json_str = r#"{
            "role": "assistant",
            "content": [
                {"type": "text", "text": "Here is the result"},
                {"type": "tool_use", "id": "tool_1", "name": "Read", "input": {}}
            ]
        }"#;

        let content: MessageContent = serde_json::from_str(json_str).unwrap();
        let content_array = content.content.as_array().unwrap();
        assert_eq!(content_array.len(), 2);
        assert_eq!(content_array[0]["type"], "text");
        assert_eq!(content_array[1]["type"], "tool_use");
    }

    #[test]
    fn test_tool_use_result_file_read() {
        let json_str = r#"{
            "uuid": "uuid-123",
            "sessionId": "session",
            "timestamp": "2025-01-01T00:00:00Z",
            "type": "user",
            "toolUseResult": {
                "type": "text",
                "file": {
                    "filePath": "/test.txt",
                    "content": "file content",
                    "numLines": 10,
                    "startLine": 1,
                    "totalLines": 10
                }
            }
        }"#;

        let entry: RawLogEntry = serde_json::from_str(json_str).unwrap();
        assert!(entry.tool_use_result.is_some());
        let result = entry.tool_use_result.unwrap();
        assert_eq!(result["type"], "text");
        assert!(result["file"].is_object());
    }

    #[test]
    fn test_system_message_stop_hook_summary() {
        let json_str = r#"{
            "uuid": "sys-uuid-123",
            "sessionId": "session-1",
            "timestamp": "2025-01-20T10:00:00Z",
            "type": "system",
            "subtype": "stop_hook_summary",
            "hookCount": 2,
            "hookInfos": [{"command": "bash test.sh", "output": "ok"}],
            "stopReason": "Stop hook prevented continuation",
            "preventedContinuation": true,
            "level": "suggestion"
        }"#;

        let entry: RawLogEntry = serde_json::from_str(json_str).unwrap();
        assert_eq!(entry.message_type, "system");
        assert_eq!(entry.subtype, Some("stop_hook_summary".to_string()));
        assert_eq!(entry.hook_count, Some(2));
        assert!(entry.hook_infos.is_some());
        assert_eq!(
            entry.stop_reason_system,
            Some("Stop hook prevented continuation".to_string())
        );
        assert_eq!(entry.prevented_continuation, Some(true));
        assert_eq!(entry.level, Some("suggestion".to_string()));
    }

    #[test]
    fn test_system_message_turn_duration() {
        let json_str = r#"{
            "uuid": "sys-uuid-456",
            "sessionId": "session-1",
            "timestamp": "2025-01-20T10:01:00Z",
            "type": "system",
            "subtype": "turn_duration",
            "durationMs": 321482
        }"#;

        let entry: RawLogEntry = serde_json::from_str(json_str).unwrap();
        assert_eq!(entry.message_type, "system");
        assert_eq!(entry.subtype, Some("turn_duration".to_string()));
        assert_eq!(entry.duration_ms, Some(321482));
    }

    #[test]
    fn test_system_message_microcompact_boundary() {
        let json_str = r#"{
            "uuid": "sys-uuid-789",
            "sessionId": "session-1",
            "timestamp": "2025-01-20T10:02:00Z",
            "type": "system",
            "subtype": "microcompact_boundary",
            "content": "Context microcompacted",
            "level": "info",
            "microcompactMetadata": {
                "trigger": "token_limit",
                "preTokens": 50000
            }
        }"#;

        let entry: RawLogEntry = serde_json::from_str(json_str).unwrap();
        assert_eq!(entry.message_type, "system");
        assert_eq!(entry.subtype, Some("microcompact_boundary".to_string()));
        assert_eq!(entry.level, Some("info".to_string()));
        assert!(entry.microcompact_metadata.is_some());

        let metadata = entry.microcompact_metadata.unwrap();
        assert_eq!(metadata["trigger"], "token_limit");
        assert_eq!(metadata["preTokens"], 50000);
    }
}
