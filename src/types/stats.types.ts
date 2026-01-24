/**
 * Stats Types
 *
 * Token statistics, analytics, and aggregated data structures.
 */

// ============================================================================
// Session Token Stats
// ============================================================================

export interface SessionTokenStats {
  session_id: string;
  project_name: string;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  total_tokens: number;
  message_count: number;
  first_message_time: string;
  last_message_time: string;
  summary?: string;
}

/**
 * Paginated response for project token stats
 */
export interface PaginatedTokenStats {
  items: SessionTokenStats[];
  total_count: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

// ============================================================================
// Daily & Activity Stats
// ============================================================================

export interface DailyStats {
  date: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  message_count: number;
  session_count: number;
  active_hours: number;
}

export interface ActivityHeatmap {
  hour: number; // 0-23
  day: number; // 0-6 (Sunday-Saturday)
  activity_count: number;
  tokens_used: number;
}

// ============================================================================
// Tool Usage Stats
// ============================================================================

export interface ToolUsageStats {
  tool_name: string;
  usage_count: number;
  success_rate: number;
  avg_execution_time?: number;
}

// ============================================================================
// Model Stats
// ============================================================================

export interface ModelStats {
  model_name: string;
  message_count: number;
  token_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

// ============================================================================
// Date Range
// ============================================================================

export interface DateRange {
  first_message?: string;
  last_message?: string;
  days_span: number;
}

// ============================================================================
// Project Stats
// ============================================================================

export interface ProjectStatsSummary {
  project_name: string;
  total_sessions: number;
  total_messages: number;
  total_tokens: number;
  avg_tokens_per_session: number;
  avg_session_duration: number; // in minutes
  total_session_duration: number; // in minutes
  most_active_hour: number;
  most_used_tools: ToolUsageStats[];
  daily_stats: DailyStats[];
  activity_heatmap: ActivityHeatmap[];
  token_distribution: {
    input: number;
    output: number;
    cache_creation: number;
    cache_read: number;
  };
}

export interface ProjectRanking {
  project_name: string;
  sessions: number;
  messages: number;
  tokens: number;
}

// ============================================================================
// Session Comparison
// ============================================================================

export interface SessionComparison {
  session_id: string;
  percentage_of_project_tokens: number;
  percentage_of_project_messages: number;
  rank_by_tokens: number;
  rank_by_duration: number;
  is_above_average: boolean;
}

// ============================================================================
// Global Stats Summary
// ============================================================================

export interface GlobalStatsSummary {
  total_projects: number;
  total_sessions: number;
  total_messages: number;
  total_tokens: number;
  total_session_duration_minutes: number;
  date_range: DateRange;
  token_distribution: {
    input: number;
    output: number;
    cache_creation: number;
    cache_read: number;
  };
  daily_stats: DailyStats[];
  activity_heatmap: ActivityHeatmap[];
  most_used_tools: ToolUsageStats[];
  model_distribution: ModelStats[];
  top_projects: ProjectRanking[];
}
