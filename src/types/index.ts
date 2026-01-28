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
// Message Types
// ============================================================================
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
  MessageNode,
  MessagePage,
  PaginationState,
} from "./message.types";

// ============================================================================
// Content Types
// ============================================================================
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
} from "./content.types";

// ============================================================================
// Tool Types
// ============================================================================
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
} from "./tool.types";

// ============================================================================
// MCP Types
// ============================================================================
export type {
  MCPToolUseContent,
  MCPToolResultContent,
  MCPToolResultData,
  MCPTextResult,
  MCPImageResult,
  MCPResourceResult,
  MCPUnknownResult,
  ClaudeMCPResult,
} from "./mcp.types";

// ============================================================================
// Session Types
// ============================================================================
export type {
  GitWorktreeType,
  GitInfo,
  ClaudeProject,
  ClaudeSession,
  SearchFilters,
  AppState,
} from "./session.types";

// ============================================================================
// Stats Types
// ============================================================================
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

// ============================================================================
// Edit Types
// ============================================================================
export type { RecentFileEdit, RecentEditsResult, PaginatedRecentEdits } from "./edit.types";

// ============================================================================
// Update Types
// ============================================================================
export type {
  UpdatePriority,
  UpdateType,
  UpdateMessage,
  UpdateMetadata,
  UpdateInfo,
} from "./update.types";

// ============================================================================
// Error Types
// ============================================================================
export { AppErrorType } from "./error.types";
export type { AppError } from "./error.types";

// ============================================================================
// Metadata Types
// ============================================================================
export type {
  SessionMetadata,
  ProjectMetadata,
  UserSettings,
  UserMetadata,
} from "./metadata.types";
export {
  METADATA_SCHEMA_VERSION,
  DEFAULT_USER_METADATA,
  isSessionMetadataEmpty,
  isProjectMetadataEmpty,
  getSessionDisplayName,
  isProjectHidden,
} from "./metadata.types";

// ============================================================================
// Claude Code Settings Types
// ============================================================================
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
  ScopedSettings,
  SettingsPreset,
} from "./claudeSettings";
export { SCOPE_PRIORITY } from "./claudeSettings";

// ============================================================================
// Preset Types
// ============================================================================
export type { PresetData, PresetInput } from "./preset.types";
export {
  settingsToJson,
  jsonToSettings,
  createPresetInput,
  extractSettings,
  formatPresetDate,
} from "./preset.types";

// ============================================================================
// MCP Preset Types
// ============================================================================
export type { MCPPresetData, MCPPresetInput } from "./mcpPreset.types";
export { parseMCPServers, formatMCPPresetDate } from "./mcpPreset.types";

// ============================================================================
// Unified Preset Types
// ============================================================================
export type {
  UnifiedPresetData,
  UnifiedPresetSummary,
  UnifiedPresetInput,
  UnifiedPresetApplyOptions,
} from "./unifiedPreset";
export {
  computePresetSummary,
  parsePresetContent,
  formatPresetDate as formatUnifiedPresetDate,
} from "./unifiedPreset";
