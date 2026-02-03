/**
 * MessageViewer Types
 *
 * Shared type definitions for MessageViewer components.
 */

import type { ClaudeMessage, ClaudeSession, ProgressData } from "../../types";
import type { SearchState, SearchFilterType } from "../../store/useAppStore";
import type { AgentTask } from "../toolResultRenderer";
import type { TaskOperation, TaskInfo } from "./helpers/taskOperationHelpers";

// ============================================================================
// Props Interfaces
// ============================================================================

export interface MessageViewerProps {
  messages: ClaudeMessage[];
  isLoading: boolean;
  selectedSession: ClaudeSession | null;
  sessionSearch: SearchState;
  onSearchChange: (query: string) => void;
  onFilterTypeChange: (filterType: SearchFilterType) => void;
  onClearSearch: () => void;
  onNextMatch?: () => void;
  onPrevMatch?: () => void;
  onBack?: () => void;
}

export interface MessageNodeProps {
  message: ClaudeMessage;
  depth: number;
  isCurrentMatch?: boolean;
  isMatch?: boolean;
  searchQuery?: string;
  filterType?: SearchFilterType;
  currentMatchIndex?: number;
  // Agent task grouping
  agentTaskGroup?: AgentTask[];
  isAgentTaskGroupMember?: boolean;
  // Agent progress grouping
  agentProgressGroup?: AgentProgressGroup;
  isAgentProgressGroupMember?: boolean;
  // Task operation grouping
  taskOperationGroup?: TaskOperation[];
  taskRegistry?: Map<string, TaskInfo>;
  isTaskOperationGroupMember?: boolean;
  // Capture mode
  isCaptureMode?: boolean;
  onHideMessage?: (uuid: string) => void;
}

export interface MessageHeaderProps {
  message: ClaudeMessage;
}

export interface SummaryMessageProps {
  content: string;
  timestamp: string;
}

// ============================================================================
// Agent Progress Types
// ============================================================================

export interface AgentProgressEntry {
  data: ProgressData;
  timestamp: string;
  uuid: string;
}

export interface AgentProgressGroup {
  entries: AgentProgressEntry[];
  agentId: string;
}

// ============================================================================
// Grouping Result Types
// ============================================================================

export interface AgentTaskGroupResult {
  tasks: AgentTask[];
  messageUuids: Set<string>;
}

export interface AgentProgressGroupResult {
  entries: AgentProgressEntry[];
  messageUuids: Set<string>;
}

export type { TaskOperation, TaskOperationGroupResult } from "./helpers/taskOperationHelpers";

// ============================================================================
// Search Configuration
// ============================================================================

export const SEARCH_MIN_CHARS = 2;
export const SCROLL_HIGHLIGHT_DELAY_MS = 100;

// ============================================================================
// Virtual Scrolling Types
// ============================================================================

/** Regular message item in flattened list */
export interface FlattenedMessageItem {
  type: "message";
  message: ClaudeMessage;
  depth: number;
  originalIndex: number;
  /** True if this message is the first (leader) of an agent task group */
  isGroupLeader: boolean;
  /** True if this message is a non-leader member of an agent task group */
  isGroupMember: boolean;
  /** True if this message is the first (leader) of an agent progress group */
  isProgressGroupLeader: boolean;
  /** True if this message is a non-leader member of an agent progress group */
  isProgressGroupMember: boolean;
  /** Agent tasks for group leader */
  agentTaskGroup?: AgentTask[];
  /** Agent progress data for group leader */
  agentProgressGroup?: AgentProgressGroup;
  /** True if this message is the first (leader) of a task operation group */
  isTaskOperationGroupLeader: boolean;
  /** True if this message is a non-leader member of a task operation group */
  isTaskOperationGroupMember: boolean;
  /** Task operations for group leader */
  taskOperationGroup?: TaskOperation[];
  /** Global task registry for resolving task info */
  taskRegistry?: Map<string, TaskInfo>;
}

/** Placeholder indicating hidden blocks in capture mode */
export interface HiddenBlocksPlaceholder {
  type: "hidden-placeholder";
  /** Number of consecutive hidden blocks */
  hiddenCount: number;
  /** UUIDs of hidden messages (for potential restore) */
  hiddenUuids: string[];
}

/** Union type for all items in the flattened list */
export type FlattenedMessage = FlattenedMessageItem | HiddenBlocksPlaceholder;
