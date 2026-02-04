/**
 * Store Slice Types
 *
 * Shared types for Zustand store slices.
 */

import type {
  ClaudeMessage,
  ClaudeProject,
  ClaudeSession,
  AppError,
  PaginationState,
  SessionTokenStats,
  ProjectStatsSummary,
  SessionComparison,
  GlobalStatsSummary,
  SearchFilters,
  RecentEditsResult,
  UserMetadata,
  SessionMetadata,
  ProjectMetadata,
  UserSettings,
} from "../../types";
import type { ProjectTokenStatsPagination } from "./messageSlice";
import type { AnalyticsState, AnalyticsViewType } from "../../types/analytics";
import type { UpdateSettings } from "../../types/updateSettings";

// ============================================================================
// Search Types
// ============================================================================

/** Search match information */
export interface SearchMatch {
  messageUuid: string;
  messageIndex: number; // Index in messages array
  matchIndex: number; // Which match within the message (0-based)
  matchCount: number; // Total matches in this message
}

/** Search filter type */
export type SearchFilterType = "content" | "toolId";

/** Session search state (KakaoTalk-style navigation) */
export interface SearchState {
  query: string;
  matches: SearchMatch[];
  currentMatchIndex: number;
  isSearching: boolean;
  filterType: SearchFilterType;
  /** @deprecated Use matches field. Kept for backward compatibility. */
  results: ClaudeMessage[];
}

// ============================================================================
// Slice State Interfaces
// ============================================================================

/** Zustand store setter type */
export type StoreSet<T> = (
  partial: T | Partial<T> | ((state: T) => T | Partial<T>),
  replace?: boolean
) => void;

/** Zustand store getter type */
export type StoreGet<T> = () => T;

// ============================================================================
// Helpers
// ============================================================================

/** Create empty search state while preserving filterType */
export const createEmptySearchState = (
  filterType: SearchFilterType
): SearchState => ({
  query: "",
  matches: [],
  currentMatchIndex: -1,
  isSearching: false,
  filterType,
  results: [],
});

// ============================================================================
// Full App Store Interface (for slice dependencies)
// ============================================================================

/**
 * Full AppStore interface that all slices can depend on.
 * This prevents circular imports and ensures type compatibility.
 */
export interface AppStoreState {
  // Project state
  claudePath: string;
  projects: ClaudeProject[];
  selectedProject: ClaudeProject | null;
  sessions: ClaudeSession[];
  selectedSession: ClaudeSession | null;
  isLoading: boolean;
  isLoadingProjects: boolean;
  isLoadingSessions: boolean;
  error: AppError | null;

  // Message state
  messages: ClaudeMessage[];
  pagination: PaginationState;
  isLoadingMessages: boolean;
  isLoadingTokenStats: boolean;
  sessionTokenStats: SessionTokenStats | null;
  projectTokenStats: SessionTokenStats[];
  projectTokenStatsPagination: ProjectTokenStatsPagination;

  // Search state
  searchQuery: string;
  searchResults: ClaudeMessage[];
  searchFilters: SearchFilters;
  sessionSearch: SearchState;

  // Analytics state
  analytics: AnalyticsState;

  // Settings state
  excludeSidechain: boolean;
  showSystemMessages: boolean;
  updateSettings: UpdateSettings;
  sessionSortOrder: import("../../types/metadata.types").SessionSortOrder;

  // Global stats state
  globalSummary: GlobalStatsSummary | null;
  isLoadingGlobalStats: boolean;

  // Metadata state
  userMetadata: UserMetadata;
  isMetadataLoaded: boolean;
  isMetadataLoading: boolean;
  metadataError: string | null;

  // Capture mode state
  isCaptureMode: boolean;
  hiddenMessageIds: string[];

  // Board state
  boardSessions: Record<string, import("../../types/board.types").BoardSessionData>;
  visibleSessionIds: string[];
  allSortedSessionIds: string[];
  isLoadingBoard: boolean;
  zoomLevel: import("../../types/board.types").ZoomLevel;
  activeBrush: import("../../types/board.types").ActiveBrush | null;
  stickyBrush: boolean;
  selectedMessageId: string | null;
  isMarkdownPretty: boolean;
  boardLoadError: string | null;
  dateFilter: import("../../types/board.types").DateFilter;

  // Navigation state
  targetMessageUuid: string | null;
  shouldHighlightTarget: boolean;

  // Watcher state
  watcherEnabled: boolean;
  lastUpdateTime: Record<string, number>;
}

export interface AppStoreActions {
  // Navigation actions
  navigateToMessage: (uuid: string) => void;
  clearTargetMessage: () => void;

  // Project actions
  initializeApp: () => Promise<void>;
  scanProjects: () => Promise<void>;
  selectProject: (project: ClaudeProject) => Promise<void>;
  setClaudePath: (path: string) => Promise<void>;
  setError: (error: AppError | null) => void;
  setSelectedSession: (session: ClaudeSession | null) => void;
  setSessions: (sessions: ClaudeSession[]) => void;

  // Message actions
  selectSession: (session: ClaudeSession) => Promise<void>;
  refreshCurrentSession: () => Promise<void>;
  loadSessionTokenStats: (sessionPath: string) => Promise<void>;
  loadProjectTokenStats: (projectPath: string) => Promise<void>;
  loadMoreProjectTokenStats: (projectPath: string) => Promise<void>;
  loadProjectStatsSummary: (projectPath: string) => Promise<ProjectStatsSummary>;
  loadSessionComparison: (
    sessionId: string,
    projectPath: string
  ) => Promise<SessionComparison>;
  clearTokenStats: () => void;

  // Search actions
  searchMessages: (query: string, filters?: SearchFilters) => Promise<void>;
  setSearchFilters: (filters: SearchFilters) => void;
  setSessionSearchQuery: (query: string) => void;
  setSearchFilterType: (filterType: SearchFilterType) => void;
  goToNextMatch: () => void;
  goToPrevMatch: () => void;
  goToMatchIndex: (index: number) => void;
  clearSessionSearch: () => void;

  // Analytics actions
  setAnalyticsCurrentView: (view: AnalyticsViewType) => void;
  setAnalyticsProjectSummary: (summary: ProjectStatsSummary | null) => void;
  setAnalyticsSessionComparison: (comparison: SessionComparison | null) => void;
  setAnalyticsLoadingProjectSummary: (loading: boolean) => void;
  setAnalyticsLoadingSessionComparison: (loading: boolean) => void;
  setAnalyticsProjectSummaryError: (error: string | null) => void;
  setAnalyticsSessionComparisonError: (error: string | null) => void;
  setAnalyticsRecentEdits: (edits: RecentEditsResult | null) => void;
  setAnalyticsRecentEditsSearchQuery: (query: string) => void;
  setAnalyticsLoadingRecentEdits: (loading: boolean) => void;
  setAnalyticsRecentEditsError: (error: string | null) => void;
  loadRecentEdits: (projectPath: string) => Promise<import("../../types").PaginatedRecentEdits>;
  loadMoreRecentEdits: (projectPath: string) => Promise<void>;
  resetAnalytics: () => void;
  clearAnalyticsErrors: () => void;

  // Settings actions
  setExcludeSidechain: (exclude: boolean) => void;
  setShowSystemMessages: (show: boolean) => void;
  loadUpdateSettings: () => Promise<void>;
  setUpdateSetting: <K extends keyof UpdateSettings>(
    key: K,
    value: UpdateSettings[K]
  ) => Promise<void>;
  skipVersion: (version: string) => Promise<void>;
  postponeUpdate: () => Promise<void>;
  setSessionSortOrder: (order: import("../../types/metadata.types").SessionSortOrder) => Promise<void>;

  // Global stats actions
  loadGlobalStats: () => Promise<void>;
  clearGlobalStats: () => void;

  // Metadata actions
  loadMetadata: () => Promise<void>;
  saveMetadata: () => Promise<void>;
  updateSessionMetadata: (
    sessionId: string,
    update: Partial<SessionMetadata>
  ) => Promise<void>;
  updateProjectMetadata: (
    projectPath: string,
    update: Partial<ProjectMetadata>
  ) => Promise<void>;
  updateUserSettings: (update: Partial<UserSettings>) => Promise<void>;
  getSessionDisplayName: (
    sessionId: string,
    fallbackSummary?: string
  ) => string | undefined;
  isProjectHidden: (projectPath: string) => boolean;
  hideProject: (projectPath: string) => Promise<void>;
  unhideProject: (projectPath: string) => Promise<void>;
  addHiddenPattern: (pattern: string) => Promise<void>;
  removeHiddenPattern: (pattern: string) => Promise<void>;
  clearMetadataError: () => void;

  // Capture mode actions
  enterCaptureMode: () => void;
  exitCaptureMode: () => void;
  hideMessage: (uuid: string) => void;
  showMessage: (uuid: string) => void;
  restoreMessages: (uuids: string[]) => void;
  restoreAllMessages: () => void;
  isMessageHidden: (uuid: string) => boolean;
  getHiddenCount: () => number;

  // Board actions
  loadBoardSessions: (sessions: ClaudeSession[]) => Promise<void>;
  setZoomLevel: (level: import("../../types/board.types").ZoomLevel) => void;
  setActiveBrush: (brush: { type: "model" | "status" | "tool" | "file"; value: string } | null) => void;
  setStickyBrush: (sticky: boolean) => void;
  clearBoard: () => void;
  setSelectedMessageId: (id: string | null) => void;
  setMarkdownPretty: (pretty: boolean) => void;
  setDateFilter: (filter: import("../../types/board.types").DateFilter) => void;

  // Watcher actions
  setWatcherEnabled: (enabled: boolean) => void;
  markProjectUpdated: (projectPath: string) => void;
  triggerProjectRefresh: (projectPath: string) => Promise<void>;
  triggerSessionRefresh: (projectPath: string, sessionPath: string) => Promise<void>;
}

export type FullAppStore = AppStoreState & AppStoreActions;
