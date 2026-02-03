/**
 * Core Message Types
 *
 * Fundamental message structures for Claude conversation data.
 * Handles raw JSONL parsing and processed UI messages.
 */

import type { ContentItem } from "./tool";

// ============================================================================
// File History Snapshot Types
// ============================================================================

/** Tracks file changes during conversations */
export interface FileHistorySnapshotData {
  messageId: string;
  trackedFileBackups: Record<string, FileBackupEntry>;
  timestamp: string;
}

export interface FileBackupEntry {
  originalPath: string;
  backupPath?: string;
  content?: string;
  timestamp: string;
}

export interface FileHistorySnapshotMessage {
  type: "file-history-snapshot";
  messageId: string;
  snapshot: FileHistorySnapshotData;
  isSnapshotUpdate: boolean;
}

// ============================================================================
// Progress Message Types
// ============================================================================

export type ProgressDataType =
  | "agent_progress"
  | "mcp_progress"
  | "bash_progress"
  | "hook_progress"
  | "search_results_received"
  | "query_update"
  | "waiting_for_task";

export interface ProgressData {
  type: ProgressDataType;
  status?: "started" | "completed" | "running" | "error";
  serverName?: string;
  toolName?: string;
  elapsedTimeMs?: number;
  message?: string | Record<string, unknown>;
  agentId?: string;
  taskId?: string;
  // Extended fields for agent_progress
  prompt?: string;
  normalizedMessages?: Array<{
    type: string;
    message: Record<string, unknown>;
    timestamp?: string;
    uuid?: string;
  }>;
}

export interface ProgressMessage {
  type: "progress";
  data: ProgressData;
  toolUseID?: string;
  parentToolUseID?: string;
  timestamp?: string;
}

// ============================================================================
// Queue Operation Types
// ============================================================================

export type QueueOperationType = "enqueue" | "dequeue" | "remove" | "popAll";

export interface QueueOperationMessage {
  type: "queue-operation";
  operation: QueueOperationType;
  content?: string;
  timestamp?: string;
  sessionId?: string;
}

// ============================================================================
// Message Payload (nested within RawClaudeMessage)
// ============================================================================

export interface MessagePayload {
  role: "user" | "assistant";
  content: string | ContentItem[];
  // Optional fields for assistant messages
  id?: string;
  model?: string;
  stop_reason?: "tool_use" | "end_turn" | "max_tokens" | "stop_sequence" | "pause_turn" | "refusal";
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    service_tier?: string;
  };
}

// ============================================================================
// Raw Message (from JSONL files)
// ============================================================================

export interface RawClaudeMessage {
  uuid: string;
  parentUuid?: string;
  sessionId: string;
  timestamp: string;
  type:
  | "user"
  | "assistant"
  | "system"
  | "summary"
  | "file-history-snapshot"
  | "progress"
  | "queue-operation";
  /** Message payload - optional for progress, queue-operation, file-history-snapshot types */
  message?: MessagePayload;
  toolUse?: Record<string, unknown>;
  toolUseResult?: Record<string, unknown> | string;
  isSidechain?: boolean;
  userType?: string;
  cwd?: string;
  version?: string;
  requestId?: string;
  // Cost and performance metrics (2025 additions)
  costUSD?: number;
  durationMs?: number;
  // File history snapshot fields
  messageId?: string;
  snapshot?: FileHistorySnapshotData;
  isSnapshotUpdate?: boolean;
  // Progress message fields
  data?: ProgressData;
  toolUseID?: string;
  parentToolUseID?: string;
  // Queue operation fields
  operation?: QueueOperationType;
}

// ============================================================================
// Processed Message (for UI)
// ============================================================================

export interface BaseClaudeMessage {
  uuid: string;
  parentUuid?: string;
  sessionId: string;
  timestamp: string;
  /** Project name (extracted from file path during search) */
  projectName?: string;
  isSidechain?: boolean;
  content?: string | ContentItem[] | Record<string, unknown>;
}

/** Represents input from the human user */
export interface ClaudeUserMessage extends BaseClaudeMessage {
  type: "user";
  role: "user";
  toolUseResult?: Record<string, unknown> | string;
}

/** Represents response from Claude */
export interface ClaudeAssistantMessage extends BaseClaudeMessage {
  type: "assistant";
  role: "assistant";
  model?: string;
  stop_reason?: "tool_use" | "end_turn" | "max_tokens" | "stop_sequence" | "pause_turn" | "refusal";
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    service_tier?: string;
  };
  // Metrics (2025)
  costUSD?: number;
  durationMs?: number;
  toolUse?: Record<string, unknown>;
  toolUseResult?: Record<string, unknown> | string;
}

/** System information, warnings, errors, or internal events */
export interface ClaudeSystemMessage extends BaseClaudeMessage {
  type: "system";
  subtype?: string;
  level?: "info" | "warning" | "error" | "suggestion";

  // stop_hook_summary fields
  hookCount?: number;
  hookInfos?: Array<{ command: string; output?: string; error?: string }>;
  stopReasonSystem?: string;
  preventedContinuation?: boolean;

  // boundary fields
  compactMetadata?: { trigger?: string; preTokens?: number };
  microcompactMetadata?: { trigger?: string; preTokens?: number };
}

/** High level session summary */
export interface ClaudeSummaryMessage extends BaseClaudeMessage {
  type: "summary";
  summary?: string;
  leafUuid?: string;
}

/** UI wrapper for File History Snapshot */
export interface ClaudeFileHistoryMessage extends BaseClaudeMessage {
  type: "file-history-snapshot";
  messageId?: string;
  snapshot?: FileHistorySnapshotData;
  isSnapshotUpdate?: boolean;
}

/** UI wrapper for Progress updates */
export interface ClaudeProgressMessage extends BaseClaudeMessage {
  type: "progress";
  data?: ProgressData;
  toolUseID?: string;
  parentToolUseID?: string;
}

/** UI wrapper for Queue Operations */
export interface ClaudeQueueMessage extends BaseClaudeMessage {
  type: "queue-operation";
  operation?: QueueOperationType;
}

/**
 * Union type for all processed messages in the UI.
 * Use 'type' discriminator to parse specific fields.
 */
export type ClaudeMessage =
  | ClaudeUserMessage
  | ClaudeAssistantMessage
  | ClaudeSystemMessage
  | ClaudeSummaryMessage
  | ClaudeFileHistoryMessage
  | ClaudeProgressMessage
  | ClaudeQueueMessage;

// ============================================================================
// Message Tree Structure (for UI rendering)
// ============================================================================

export interface MessageNode {
  message: ClaudeMessage;
  children: MessageNode[];
  depth: number;
  isExpanded: boolean;
  isBranchRoot: boolean;
  branchDepth: number;
}

// ============================================================================
// Pagination
// ============================================================================

export interface MessagePage {
  messages: ClaudeMessage[];
  total_count: number;
  has_more: boolean;
  next_offset: number;
}

/**
 * @deprecated Pagination is no longer used as we load all messages at once.
 * Kept for backward compatibility.
 */
export interface PaginationState {
  currentOffset: number;
  pageSize: number;
  totalCount: number;
  hasMore: boolean;
  isLoadingMore: boolean;
}
