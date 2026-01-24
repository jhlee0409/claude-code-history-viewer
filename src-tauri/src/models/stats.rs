use serde::{Deserialize, Serialize};

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
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
            summary: Some("Test session summary".to_string()),
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
}
