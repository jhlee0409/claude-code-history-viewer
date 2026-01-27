/**
 * Message Types
 *
 * Core message structures for Claude conversation data.
 * Handles raw JSONL parsing and processed UI messages.
 */

import type { ContentItem } from "./tool.types";

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
  stop_reason?: "tool_use" | "end_turn" | "max_tokens";
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
  message: MessagePayload;
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

export interface ClaudeMessage {
  uuid: string;
  parentUuid?: string;
  sessionId: string;
  timestamp: string;
  type: string;
  content?: string | ContentItem[] | Record<string, unknown>;
  /** Project name (extracted from file path during search) */
  projectName?: string;
  toolUse?: Record<string, unknown>;
  toolUseResult?: Record<string, unknown> | string;
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
  // Cost and performance metrics (2025 additions)
  costUSD?: number;
  durationMs?: number;
  // File history snapshot fields (for type: "file-history-snapshot")
  messageId?: string;
  snapshot?: FileHistorySnapshotData;
  isSnapshotUpdate?: boolean;
  // Progress message fields (for type: "progress")
  data?: ProgressData;
  toolUseID?: string;
  parentToolUseID?: string;
  // Queue operation fields (for type: "queue-operation")
  operation?: QueueOperationType;
  // System message fields (for type: "system")
  subtype?: string;
  level?: "info" | "warning" | "error" | "suggestion";
  // stop_hook_summary fields
  hookCount?: number;
  hookInfos?: Array<{ command: string; output?: string; error?: string }>;
  stopReasonSystem?: string;
  preventedContinuation?: boolean;
  // compact_boundary fields
  compactMetadata?: { trigger?: string; preTokens?: number };
  // microcompact_boundary fields
  microcompactMetadata?: { trigger?: string; preTokens?: number };
}

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
