export interface ClaudeMCPResult {
  server: string;
  method: string;
  params: Record<string, unknown>;
  result: Record<string, unknown>;
  error: string;
}

export interface ClaudeToolUseResult {
  command: string;
  stream: string;
  output: string;
  timestamp: string;
  exitCode: number;
}

// Raw message structure from JSONL files
export interface RawClaudeMessage {
  uuid: string;
  parentUuid?: string;
  sessionId: string;
  timestamp: string;
  type: "user" | "assistant" | "system" | "summary";
  message: MessagePayload;
  toolUse?: Record<string, unknown>;
  toolUseResult?: Record<string, unknown> | string;
  isSidechain?: boolean;
  userType?: string;
  cwd?: string;
  version?: string;
  requestId?: string;
}

// Nested message object within RawClaudeMessage
export interface MessagePayload {
  role: "user" | "assistant";
  content: string | ContentItem[];
  // Optional fields for assistant messages
  id?: string;
  model?: string;
  stop_reason?: "tool_use" | "end_turn" | "max_tokens";
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    service_tier?: string;
  };
}

// Content types based on CLAUDE.md
export type ContentItem =
  | TextContent
  | ToolUseContent
  | ToolResultContent
  | ThinkingContent;

export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolUseContent {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
  signature?: string;
}

// Processed message for UI
export interface ClaudeMessage {
  uuid: string;
  parentUuid?: string;
  sessionId: string;
  timestamp: string;
  type: string;
  content?: string | ContentItem[] | Record<string, unknown>;
  toolUse?: Record<string, unknown>;
  toolUseResult?: Record<string, unknown>;
  isSidechain?: boolean;
  // Assistant metadata
  model?: string;
  stop_reason?: "tool_use" | "end_turn" | "max_tokens";
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    service_tier?: string;
  };
}

export interface ClaudeProject {
  name: string;
  path: string;
  session_count: number;
  message_count: number;
  lastModified: string;
}

export interface ClaudeSession {
  session_id: string; // Unique ID based on file path
  actual_session_id: string; // Actual session ID from the messages
  file_path: string; // 추가: JSONL 파일의 전체 경로
  project_name: string;
  message_count: number;
  first_message_time: string;
  last_message_time: string;
  last_modified: string; // 추가: 파일의 마지막 수정 시간
  has_tool_use: boolean;
  has_errors: boolean;
  summary?: string;
}

export interface SearchFilters {
  dateRange?: [Date, Date];
  projects?: string[];
  messageType?: "user" | "assistant" | "all";
  hasToolCalls?: boolean;
  hasErrors?: boolean;
  hasFileChanges?: boolean;
}

export interface MessageNode {
  message: ClaudeMessage;
  children: MessageNode[];
  depth: number;
  isExpanded: boolean;
  isBranchRoot: boolean;
  branchDepth: number;
}

export interface MessagePage {
  messages: ClaudeMessage[];
  total_count: number;
  has_more: boolean;
  next_offset: number;
}

// Note: Pagination is no longer used as we load all messages at once.
// This interface is kept for backward compatibility but will be removed in future versions.
export interface PaginationState {
  currentOffset: number;
  pageSize: number; // Always 0 - pagination disabled
  totalCount: number;
  hasMore: boolean;
  isLoadingMore: boolean;
}

// Error types
export enum AppErrorType {
  CLAUDE_FOLDER_NOT_FOUND = "CLAUDE_FOLDER_NOT_FOUND",
  TAURI_NOT_AVAILABLE = "TAURI_NOT_AVAILABLE",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  INVALID_PATH = "INVALID_PATH",
  UNKNOWN = "UNKNOWN",
}

export interface AppError {
  type: AppErrorType;
  message: string;
}

export interface AppState {
  claudePath: string;
  projects: ClaudeProject[];
  selectedProject: ClaudeProject | null;
  sessions: ClaudeSession[];
  selectedSession: ClaudeSession | null;
  messages: ClaudeMessage[];
  pagination: PaginationState;
  searchQuery: string;
  searchResults: ClaudeMessage[];
  searchFilters: SearchFilters;
  isLoading: boolean; // 전체 앱 초기화용
  isLoadingProjects: boolean;
  isLoadingSessions: boolean;
  isLoadingMessages: boolean;
  isLoadingTokenStats: boolean;
  error: AppError | null;
  sessionTokenStats: SessionTokenStats | null;
  projectTokenStats: SessionTokenStats[];
}

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
}

// Enhanced statistics types
export interface DailyStats {
  date: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  message_count: number;
  session_count: number;
  active_hours: number;
}

export interface ToolUsageStats {
  tool_name: string;
  usage_count: number;
  success_rate: number;
  avg_execution_time?: number;
}

export interface ActivityHeatmap {
  hour: number; // 0-23
  day: number; // 0-6 (Sunday-Saturday)
  activity_count: number;
  tokens_used: number;
}

export interface ProjectStatsSummary {
  project_name: string;
  total_sessions: number;
  total_messages: number;
  total_tokens: number;
  avg_tokens_per_session: number;
  avg_session_duration: number; // in minutes
  total_session_duration: number; // in minutes - total time across all sessions
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

export interface SessionComparison {
  session_id: string;
  percentage_of_project_tokens: number;
  percentage_of_project_messages: number;
  rank_by_tokens: number;
  rank_by_duration: number;
  is_above_average: boolean;
}

export interface DateRange {
  first_message?: string;
  last_message?: string;
  days_span: number;
}

export interface ModelStats {
  model_name: string;
  message_count: number;
  token_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

export interface ProjectRanking {
  project_name: string;
  sessions: number;
  messages: number;
  tokens: number;
}

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

// 업데이트 관련 타입 정의
export type UpdatePriority = "critical" | "recommended" | "optional";
export type UpdateType = "hotfix" | "feature" | "patch" | "major";

export interface UpdateMessage {
  title: string;
  description: string;
  features: string[];
}

export interface UpdateMetadata {
  priority: UpdatePriority;
  type: UpdateType;
  force_update: boolean;
  minimum_version?: string;
  deadline?: string;
  message: UpdateMessage;
}

export interface UpdateInfo {
  has_update: boolean;
  latest_version?: string;
  current_version: string;
  download_url?: string;
  release_url?: string;
  metadata?: UpdateMetadata;
  is_forced: boolean;
  days_until_deadline?: number;
}
