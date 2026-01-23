/**
 * Session Types
 *
 * Project and session structures, app state, and search filters.
 */

import type { ClaudeMessage, PaginationState } from "./message.types";
import type { SessionTokenStats } from "./stats.types";
import type { AppError } from "./error.types";

// ============================================================================
// Project & Session
// ============================================================================

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
  file_path: string; // JSONL file full path
  project_name: string;
  message_count: number;
  first_message_time: string;
  last_message_time: string;
  last_modified: string; // File last modified time
  has_tool_use: boolean;
  has_errors: boolean;
  summary?: string;
}

// ============================================================================
// Search Filters
// ============================================================================

export interface SearchFilters {
  dateRange?: [Date, Date];
  projects?: string[];
  messageType?: "user" | "assistant" | "all";
  hasToolCalls?: boolean;
  hasErrors?: boolean;
  hasFileChanges?: boolean;
}

// ============================================================================
// Application State
// ============================================================================

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
  isLoading: boolean; // App initialization
  isLoadingProjects: boolean;
  isLoadingSessions: boolean;
  isLoadingMessages: boolean;
  isLoadingTokenStats: boolean;
  error: AppError | null;
  sessionTokenStats: SessionTokenStats | null;
  projectTokenStats: SessionTokenStats[];
}
