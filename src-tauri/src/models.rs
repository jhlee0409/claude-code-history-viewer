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

    // Cost and performance metrics (2025 additions)
    #[serde(rename = "costUSD")]
    pub cost_usd: Option<f64>,
    #[serde(rename = "durationMs")]
    pub duration_ms: Option<u64>,
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
    pub message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
    // Cost and performance metrics (2025 additions)
    #[serde(rename = "costUSD", skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    #[serde(rename = "durationMs", skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeProject {
    pub name: String,
    pub path: String,
    pub session_count: usize,
    pub message_count: usize,
    pub last_modified: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeSession {
    pub session_id: String,  // Unique ID based on file path
    pub actual_session_id: String,  // Actual session ID from the messages
    pub file_path: String,
    pub project_name: String,
    pub message_count: usize,
    pub first_message_time: String,
    pub last_message_time: String,
    pub last_modified: String,
    pub has_tool_use: bool,
    pub has_errors: bool,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessagePage {
    pub messages: Vec<ClaudeMessage>,
    pub total_count: usize,
    pub has_more: bool,
    pub next_offset: usize,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionTokenStats {
    pub session_id: String,
    pub project_name: String,
    pub total_input_tokens: u32,
    pub total_output_tokens: u32,
    pub total_cache_creation_tokens: u32,
    pub total_cache_read_tokens: u32,
    pub total_tokens: u32,
    pub message_count: usize,
    pub first_message_time: String,
    pub last_message_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DailyStats {
    pub date: String,
    pub total_tokens: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub message_count: usize,
    pub session_count: usize,
    pub active_hours: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolUsageStats {
    pub tool_name: String,
    pub usage_count: u32,
    pub success_rate: f32,
    pub avg_execution_time: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityHeatmap {
    pub hour: u8,
    pub day: u8,
    pub activity_count: u32,
    pub tokens_used: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProjectStatsSummary {
    pub project_name: String,
    pub total_sessions: usize,
    pub total_messages: usize,
    pub total_tokens: u64,
    pub avg_tokens_per_session: u64,
    pub avg_session_duration: u32,
    pub total_session_duration: u32,
    pub most_active_hour: u8,
    pub most_used_tools: Vec<ToolUsageStats>,
    pub daily_stats: Vec<DailyStats>,
    pub activity_heatmap: Vec<ActivityHeatmap>,
    pub token_distribution: TokenDistribution,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TokenDistribution {
    pub input: u64,
    pub output: u64,
    pub cache_creation: u64,
    pub cache_read: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionComparison {
    pub session_id: String,
    pub percentage_of_project_tokens: f32,
    pub percentage_of_project_messages: f32,
    pub rank_by_tokens: usize,
    pub rank_by_duration: usize,
    pub is_above_average: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DateRange {
    pub first_message: Option<String>,
    pub last_message: Option<String>,
    pub days_span: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelStats {
    pub model_name: String,
    pub message_count: u32,
    pub token_count: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectRanking {
    pub project_name: String,
    pub sessions: u32,
    pub messages: u32,
    pub tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GlobalStatsSummary {
    pub total_projects: u32,
    pub total_sessions: u32,
    pub total_messages: u32,
    pub total_tokens: u64,
    pub total_session_duration_minutes: u64,
    pub date_range: DateRange,
    pub token_distribution: TokenDistribution,
    pub daily_stats: Vec<DailyStats>,
    pub activity_heatmap: Vec<ActivityHeatmap>,
    pub most_used_tools: Vec<ToolUsageStats>,
    pub model_distribution: Vec<ModelStats>,
    pub top_projects: Vec<ProjectRanking>,
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
        assert_eq!(entry.summary, Some("This is a summary of the conversation".to_string()));
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
            tool_use: None,
            tool_use_result: None,
            is_sidechain: Some(false),
            usage: None,
            role: Some("user".to_string()),
            message_id: None,
            model: None,
            stop_reason: None,
            cost_usd: None,
            duration_ms: None,
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
            tool_use: None,
            tool_use_result: None,
            is_sidechain: None,
            usage: None,
            role: None,
            message_id: None,
            model: None,
            stop_reason: None,
            cost_usd: None,
            duration_ms: None,
        };

        let serialized = serde_json::to_string(&message).unwrap();
        // Optional fields with skip_serializing_if should not appear
        assert!(!serialized.contains("usage"));
        assert!(!serialized.contains("role"));
        assert!(!serialized.contains("message_id"));
        assert!(!serialized.contains("model"));
        assert!(!serialized.contains("stop_reason"));
        assert!(!serialized.contains("costUSD"));
        assert!(!serialized.contains("durationMs"));
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
        };

        let serialized = serde_json::to_string(&session).unwrap();
        let deserialized: ClaudeSession = serde_json::from_str(&serialized).unwrap();

        assert_eq!(deserialized.project_name, "my-project");
        assert_eq!(deserialized.message_count, 42);
        assert!(deserialized.has_tool_use);
        assert!(!deserialized.has_errors);
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
    fn test_session_token_stats_serialization() {
        let stats = SessionTokenStats {
            session_id: "session-123".to_string(),
            project_name: "my-project".to_string(),
            total_input_tokens: 1000,
            total_output_tokens: 500,
            total_cache_creation_tokens: 200,
            total_cache_read_tokens: 100,
            total_tokens: 1800,
            message_count: 50,
            first_message_time: "2025-06-01T10:00:00Z".to_string(),
            last_message_time: "2025-06-01T12:00:00Z".to_string(),
        };

        let serialized = serde_json::to_string(&stats).unwrap();
        let deserialized: SessionTokenStats = serde_json::from_str(&serialized).unwrap();

        assert_eq!(deserialized.total_tokens, 1800);
        assert_eq!(deserialized.message_count, 50);
    }

    #[test]
    fn test_daily_stats_default() {
        let stats = DailyStats::default();
        assert_eq!(stats.date, "");
        assert_eq!(stats.total_tokens, 0);
        assert_eq!(stats.message_count, 0);
    }

    #[test]
    fn test_project_stats_summary_default() {
        let summary = ProjectStatsSummary::default();
        assert_eq!(summary.project_name, "");
        assert_eq!(summary.total_sessions, 0);
        assert_eq!(summary.total_tokens, 0);
    }

    #[test]
    fn test_token_distribution_default() {
        let dist = TokenDistribution::default();
        assert_eq!(dist.input, 0);
        assert_eq!(dist.output, 0);
        assert_eq!(dist.cache_creation, 0);
        assert_eq!(dist.cache_read, 0);
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
}
