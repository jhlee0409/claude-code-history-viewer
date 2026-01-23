/**
 * MessageViewer Types
 *
 * Shared type definitions for MessageViewer components.
 */

import type { ClaudeMessage, ClaudeSession, ProgressData } from "../../types";
import type { SearchState, SearchFilterType } from "../../store/useAppStore";
import type { AgentTask } from "../toolResultRenderer";

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

// ============================================================================
// Search Configuration
// ============================================================================

export const SEARCH_MIN_CHARS = 2;
export const SCROLL_HIGHLIGHT_DELAY_MS = 100;
