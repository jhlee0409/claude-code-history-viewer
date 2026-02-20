/**
 * Types Index
 *
 * Re-exports all types from domain-specific modules.
 * Import from '@/types' for convenience.
 *
 * @example
 * import type { ClaudeMessage, ContentItem, SessionTokenStats } from '@/types';
 */

// ============================================================================
// Core Types - Fundamental building blocks
// ============================================================================

// Message Types
export type {
  FileHistorySnapshotData,
  FileBackupEntry,
  FileHistorySnapshotMessage,
  ProgressDataType,
  ProgressData,
  ProgressMessage,
  QueueOperationType,
  QueueOperationMessage,
  MessagePayload,
  RawClaudeMessage,
  ClaudeMessage,
  ClaudeAssistantMessage,
  ClaudeUserMessage,
  ClaudeSystemMessage,
  ClaudeSummaryMessage,
  ClaudeFileHistoryMessage,
  ClaudeProgressMessage,
  ClaudeQueueMessage,
  MessageNode,
  MessagePage,
  PaginationState,
} from "./core/message";

// Content Types
export type {
  TextContent,
  ThinkingContent,
  RedactedThinkingContent,
  ImageContent,
  ImageMimeType,
  Base64ImageSource,
  URLImageSource,
  DocumentContent,
  Base64PDFSource,
  PlainTextSource,
  URLPDFSource,
  CitationsConfig,
  Citation,
  SearchResultContent,
} from "./core/content";

// Tool Types
export type {
  ContentItem,
  ToolUseContent,
  ToolResultContent,
  ClaudeToolUseResult,
  ServerToolUseContent,
  WebSearchToolResultContent,
  WebSearchResultItem,
  WebSearchToolError,
  WebFetchToolResultContent,
  WebFetchResult,
  WebFetchError,
  CodeExecutionToolResultContent,
  CodeExecutionResult,
  CodeExecutionError,
  BashCodeExecutionToolResultContent,
  BashCodeExecutionResult,
  BashCodeExecutionError,
  TextEditorCodeExecutionToolResultContent,
  TextEditorResult,
  TextEditorError,
  ToolSearchToolResultContent,
  ToolSearchResult,
  ToolSearchError,
} from "./core/tool";

// MCP Types
export type {
  MCPToolUseContent,
  MCPToolResultContent,
  MCPToolResultData,
  MCPTextResult,
  MCPImageResult,
  MCPResourceResult,
  MCPUnknownResult,
  ClaudeMCPResult,
} from "./core/mcp";

// Session Types
export type {
  GitWorktreeType,
  GitInfo,
  GitCommit,
  ProviderId,
  ProviderInfo,
  ClaudeProject,
  ClaudeSession,
  SearchFilters,
} from "./core/session";

// Project & Metadata Types
export type {
  SessionMetadata,
  ProjectMetadata,
  GroupingMode,
  UserSettings,
  UserMetadata,
} from "./core/project";
export {
  METADATA_SCHEMA_VERSION,
  DEFAULT_USER_METADATA,
  isSessionMetadataEmpty,
  isProjectMetadataEmpty,
  getSessionDisplayName,
  isProjectHidden,
} from "./core/project";

// Settings Types
export type {
  ClaudeModel,
  PermissionDefaultMode,
  PermissionsConfig,
  HookCommand,
  HooksConfig,
  StatusLineConfig,
  SandboxNetworkConfig,
  SandboxConfig,
  AttributionConfig,
  AutoUpdatesChannel,
  MarketplaceConfig,
  MCPServerType,
  MCPServerConfig,
  FeedbackSurveyState,
  ClaudeCodeSettings,
  SettingsScope,
  AllSettingsResponse,
  MCPSource,
  AllMCPServersResponse,
  ClaudeJsonConfigResponse,
  ClaudeJsonProjectSettings,
  ScopedSettings,
  SettingsPreset,
} from "./core/settings";
export { SCOPE_PRIORITY } from "./core/settings";

// ============================================================================
// Derived Types - Composed/aggregated types
// ============================================================================

// Preset Types (Unified)
export type {
  // Current types
  UnifiedPresetData,
  UnifiedPresetSummary,
  UnifiedPresetInput,
  UnifiedPresetApplyOptions,
  // Legacy types (deprecated)
  PresetData,
  PresetInput,
  MCPPresetData,
  MCPPresetInput,
} from "./derived/preset";
export {
  computePresetSummary,
  parsePresetContent,
  formatPresetDate,
  formatMCPPresetDate,
  formatUnifiedPresetDate,
  settingsToJson,
  jsonToSettings,
  createPresetInput,
  extractSettings,
  parseMCPServers,
} from "./derived/preset";

// ============================================================================
// Domain Types - Feature-specific types
// ============================================================================

// Session State
export type {
  AppState,
} from "./session.types";

// Stats Types
export type {
  SessionTokenStats,
  PaginatedTokenStats,
  DailyStats,
  ActivityHeatmap,
  ToolUsageStats,
  ModelStats,
  DateRange,
  ProjectStatsSummary,
  ProjectRanking,
  SessionComparison,
  GlobalStatsSummary,
} from "./stats.types";

// Edit Types
export type { RecentFileEdit, RecentEditsResult, PaginatedRecentEdits } from "./edit.types";

// Update Types
export type {
  UpdatePriority,
  UpdateType,
  UpdateMessage,
  UpdateMetadata,
  UpdateInfo,
} from "./update.types";

// Error Types
export { AppErrorType } from "./error.types";
export type { AppError } from "./error.types";

// Analytics Types
export type {
  AnalyticsView,
  AnalyticsViewType,
  AnalyticsState,
  RecentEditsPagination,
} from "./analytics";

// Board Types
export type {
  BoardSessionStats,
  SessionFileEdit,
  SessionDepth,
  BoardSessionData,
  ZoomLevel,
  DateFilter,
  ActiveBrush,
  BrushableCard,
  BoardState,
} from "./board.types";

// Update Settings Types
export type {
  UpdateSettings,
} from "./updateSettings";
export { DEFAULT_UPDATE_SETTINGS } from "./updateSettings";
