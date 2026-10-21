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
  UserMetadata,
  SessionMetadata,
  ProjectMetadata,
  UserSettings,
  ProviderId,
  ProviderInfo,
  StatsMode,
  MetricMode,
  SubagentSession,
} from "../../types";
import type { ProjectTokenStatsPagination } from "./messageSlice";
import type { AnalyticsState } from "../../types/analytics";
import type { OwnedSetter } from "./analyticsSlice";
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
  homeDir: string | null;
  projects: ClaudeProject[];
  selectedProject: ClaudeProject | null;
  sessions: ClaudeSession[];
  sessionsTotal: number;
  sessionsOffset: number;
  hasMoreSessions: boolean;
  selectedSession: ClaudeSession | null;
  isLoading: boolean;
  isLoadingProjects: boolean;
  projectsScanned: boolean;
  isLoadingSessions: boolean;
  isLoadingMoreSessions: boolean;
  isRefreshingAllConversations: boolean;
  error: AppError | null;

  // Message state
  messages: ClaudeMessage[];
  pagination: PaginationState;
  isLoadingMessages: boolean;
  isLoadingTokenStats: boolean;
  sessionTokenStats: SessionTokenStats | null;
  sessionConversationTokenStats: SessionTokenStats | null;
  projectTokenStats: SessionTokenStats[];
  projectConversationTokenStats: SessionTokenStats[];
  projectTokenStatsSummary: ProjectStatsSummary | null;
  projectConversationTokenStatsSummary: ProjectStatsSummary | null;
  projectTokenStatsPagination: ProjectTokenStatsPagination;
  /** Whose the token stats are (`navigation/screenOwner.ts`): project / session file path. */
  projectTokenStatsOwner: string | null;
  sessionTokenStatsOwner: string | null;
  /** The session token stats load's failure, and the session file it was for. */
  sessionTokenStatsError: string | null;
  sessionTokenStatsErrorOwner: string | null;
  /** The project token stats load's failure, and the project it was for. */
  projectTokenStatsError: string | null;
  projectTokenStatsErrorOwner: string | null;
  subagentSessions: SubagentSession[];
  parentSessionStack: ClaudeSession[];
  toolUseToSubagentMap: Map<string, string>;

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
  fontScale: number;
  /** The gear-menu choice; null = never chosen, so the OS prefers-contrast decides (useEffectiveHighContrast). */
  highContrast: boolean | null;
  updateSettings: UpdateSettings;
  sessionSortOrder: import("../../types/metadata.types").SessionSortOrder;
  sessionEntrypointFilter: import("../../types/metadata.types").SessionEntrypointFilter;

  // Global stats state
  globalSummary: GlobalStatsSummary | null;
  globalConversationSummary: GlobalStatsSummary | null;
  isLoadingGlobalStats: boolean;

  // Metadata state
  userMetadata: UserMetadata;
  isMetadataLoaded: boolean;
  isMetadataLoading: boolean;
  metadataError: string | null;

  // Capture mode state
  isCaptureMode: boolean;
  hiddenMessageIds: string[];
  selectedMessageIds: string[];
  selectionAnchor: string | null;
  isCapturing: boolean;

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
  /** Whose the board and its error are: the project path they were loaded for. */
  boardOwner: string | null;
  boardLoadErrorOwner: string | null;
  dateFilter: import("../../types/board.types").DateFilter;
  isTimelineExpanded: boolean;
  boardHoverSession: ClaudeSession | null;

  // Filter state
  userOnlyFilter: boolean;
  showParallelTasksInNavigator: boolean;
  messageFilter: import('./filterSlice').MessageFilter;

  // Navigation state
  view: import("@/navigation/place").View;
  analyticsTab: import("@/navigation/place").AnalyticsTab;
  navigationEpoch: number;
  placeHistory: {
    back: import("./navigationSlice").PlaceHistoryEntry[];
    forward: import("./navigationSlice").PlaceHistoryEntry[];
  };
  targetMessageUuid: string | null;
  shouldHighlightTarget: boolean;
  targetRequest: number;
  recentSessions: import("@/navigation/library").RecentEntry[];

  // Conversation tabs (documentSlice)
  documents: import("@/navigation/documents").TabDocument[];
  activeDocumentId: string;
  hydratedDocumentId: string | null;
  pendingAnchor: import("./documentSlice").PendingAnchor | null;
  tabsRestorePending: boolean;
  tabsRestoreReport: { corrupt: boolean; dropped: number };

  // Watcher state
  watcherEnabled: boolean;
  lastUpdateTime: Record<string, number>;
  activeSessionNearBottom: boolean;

  // Navigator state
  navigatorViewMode: import('./navigatorSlice').NavigatorViewMode;
  visibleMessageUuid: string | null;

  // Inspector state (plan T9a; window-wide preferences)
  isInspectorOpen: boolean;
  inspectorTab: import('./inspectorSlice').InspectorTabId;
  inspectorWidth: number;

  // Minimap state
  isMinimapOpen: boolean;

  // Recent Edits screen state (recentEditsSlice)
  recentEditsDensity: import('./recentEditsSlice').RecentEditsDensity;
  recentEditsScope: import('./recentEditsSlice').RecentEditsScope;
  recentEditsGroupingProject: import('./recentEditsSlice').RecentEditsGrouping;
  recentEditsGroupingSession: import('./recentEditsSlice').RecentEditsGrouping;
  recentEditsMissingOnly: boolean;
  recentEditsList: import('./recentEditsSlice').RecentEditsListResult | null;
  recentEditsRequestedKey: string | null;
  isLoadingRecentEdits: boolean;
  isLoadingMoreRecentEdits: boolean;
  recentEditsError: string | null;

  // Provider state
  providers: ProviderInfo[];
  activeProviders: ProviderId[];
  isDetectingProviders: boolean;
  hasDetectedProviders: boolean;

  // Archive state
  archive: import('../slices/archiveSlice').ArchiveSliceState['archive'];

  // Session picker state (used by CLI `--session-title` hint with multi-match)
  sessionPickerCandidates: import('./sessionPickerSlice').SessionPickerCandidate[] | null;
  sessionPickerHintValue: string | null;

  // WebUI server state
  isServerReadOnly: boolean;
  isServerConfigLoaded: boolean;

  // Session selection (multi-select mode) state
  isSessionSelectionMode: boolean;
  sessionSelectionIds: string[];
  sessionSelectionAnchor: string | null;
}

export interface AppStoreActions {
  // Navigation actions
  navigate: (
    target: import("./navigationSlice").NavigateTarget,
    options?: import("./navigationSlice").NavigateOptions,
  ) => Promise<boolean>;
  beginNavigation: () => number;
  stepPlaceHistory: (
    direction: "back" | "forward",
  ) => import("./navigationSlice").PlaceHistoryEntry | null;
  navigateToMessage: (
    uuid: string,
    options?: import("@/utils/webuiDeepLink").WebUINavigationOptions,
  ) => void;
  clearTargetMessage: () => void;
  lookUpTargetMessage: () => Promise<boolean>;
  clearPendingAnchor: (anchor: import("./documentSlice").PendingAnchor) => void;
  markSessionUnavailable: (sessionPath: string) => void;
  markProjectUnavailable: (projectPath: string) => void;

  // Project actions
  initializeApp: () => Promise<void>;
  discoverProviders: () => Promise<void>;
  scanProjects: () => Promise<void>;
  refreshAllConversations: () => Promise<void>;
  selectProject: (project: ClaudeProject) => Promise<void>;
  reloadProjectSessions: (project: ClaudeProject) => Promise<void>;
  loadMoreSessions: () => Promise<void>;
  clearProjectSelection: (
    options?: import("@/utils/webuiDeepLink").WebUINavigationOptions,
  ) => void;
  setClaudePath: (path: string) => Promise<void>;
  setError: (error: AppError | null) => void;
  setSelectedSession: (session: ClaudeSession | null) => void;
  setSessions: (sessions: ClaudeSession[]) => void;

  // Message actions
  /**
   * Loads a session as the open one. Internal to the store: UI and other
   * callers move the user with `navigate` and reload with `reloadCurrent`.
   */
  selectSession: (
    session: ClaudeSession,
    options?: import("./messageSlice").SelectSessionOptions,
  ) => Promise<void>;
  reloadCurrent: (
    reason: import("./messageSlice").ReloadReason,
    fresh?: ClaudeSession,
  ) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  ensureMessageLoaded: (uuid: string) => Promise<boolean>;
  fetchFullSessionMessages: () => Promise<ClaudeMessage[]>;
  loadSessionTokenStats: (sessionPath: string) => Promise<void>;
  loadProjectTokenStats: (projectPath: string) => Promise<void>;
  loadMoreProjectTokenStats: (projectPath: string) => Promise<void>;
  /**
   * The project's billing summary (and, when supported, its conversation-only
   * breakdown). A failure is rethrown unreported: the screen loader
   * (`loadProjectAnalytics`) reports it once.
   */
  loadProjectStatsSummary: (
    projectPath: string,
    owns?: () => boolean
  ) => Promise<ProjectStatsSummary>;
  loadSessionComparison: (
    sessionId: string,
    projectPath: string
  ) => Promise<SessionComparison>;
  clearTokenStats: () => void;
  loadSubagents: (sessionPath: string, sourceMessages: ClaudeMessage[]) => Promise<void>;
  navigateToSubagent: (subagent: SubagentSession) => Promise<void>;
  navigateBackToParent: () => Promise<void>;

  // Search actions
  searchMessages: (query: string, filters?: SearchFilters) => Promise<void>;
  setSearchFilters: (filters: SearchFilters) => void;
  setSessionSearchQuery: (query: string) => Promise<void> | void;
  setSearchFilterType: (filterType: SearchFilterType) => void;
  goToNextMatch: () => void;
  goToPrevMatch: () => void;
  goToMatchIndex: (index: number) => void;
  clearSessionSearch: () => void;

  // Analytics actions
  setAnalyticsStatsMode: (mode: StatsMode) => void;
  setAnalyticsMetricMode: (mode: MetricMode) => void;
  // A value with the place it was loaded for, or a clear (`OwnedSetter`).
  setAnalyticsProjectSummary: OwnedSetter<ProjectStatsSummary>;
  setAnalyticsProjectConversationSummary: OwnedSetter<ProjectStatsSummary>;
  setAnalyticsSessionComparison: OwnedSetter<SessionComparison>;
  setAnalyticsLoadingProjectSummary: (loading: boolean) => void;
  setAnalyticsLoadingSessionComparison: (loading: boolean) => void;
  setAnalyticsProjectSummaryError: OwnedSetter<string>;
  setAnalyticsSessionComparisonError: OwnedSetter<string>;
  setAnalyticsRecentEditsSearchQuery: (query: string) => void;
  resetAnalytics: () => void;
  clearAnalyticsErrors: () => void;

  // Settings actions
  setExcludeSidechain: (exclude: boolean) => void;
  setShowSystemMessages: (show: boolean) => void;
  setFontScale: (scale: number) => Promise<void>;
  setHighContrast: (enabled: boolean) => Promise<void>;
  loadUpdateSettings: () => Promise<void>;
  setUpdateSetting: <K extends keyof UpdateSettings>(
    key: K,
    value: UpdateSettings[K]
  ) => Promise<void>;
  skipVersion: (version: string) => Promise<void>;
  postponeUpdate: () => Promise<void>;
  setSessionSortOrder: (order: import("../../types/metadata.types").SessionSortOrder) => Promise<void>;
  setSessionEntrypointFilter: (
    filter: import("../../types/metadata.types").SessionEntrypointFilter
  ) => Promise<void>;

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
  toggleSessionFavorite: (session: ClaudeSession, project?: ClaudeProject | null) => Promise<void>;
  backfillFavoriteRefs: (sessions: ClaudeSession[]) => Promise<void>;
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
  addCustomClaudePath: (path: string, label?: string) => Promise<void>;
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
  handleSelectionClick: (
    uuid: string,
    orderedUuids: string[],
    modifiers: { shift: boolean; cmdOrCtrl: boolean },
  ) => void;
  clearSelection: () => void;
  setIsCapturing: (v: boolean) => void;

  // Board actions
  loadBoardSessions: (sessions: ClaudeSession[]) => Promise<void>;
  setZoomLevel: (level: import("../../types/board.types").ZoomLevel) => void;
  setActiveBrush: (brush: { type: "model" | "status" | "tool" | "file"; value: string } | null) => void;
  setStickyBrush: (sticky: boolean) => void;
  clearBoard: () => void;
  setSelectedMessageId: (id: string | null) => void;
  setMarkdownPretty: (pretty: boolean) => void;
  setDateFilter: (filter: import("../../types/board.types").DateFilter) => void;
  toggleTimeline: () => void;
  setBoardHoverSession: (session: ClaudeSession | null) => void;

  // Filter actions
  setUserOnlyFilter: (enabled: boolean) => void;
  toggleUserOnlyFilter: () => void;
  setShowParallelTasksInNavigator: (enabled: boolean) => void;
  toggleShowParallelTasksInNavigator: () => void;
  toggleRole: (role: keyof import('./filterSlice').MessageFilterRoles) => void;
  toggleContentType: (contentType: keyof import('./filterSlice').MessageFilterContentTypes) => void;
  resetMessageFilter: () => void;
  isMessageFilterActive: () => boolean;

  // Watcher actions
  setWatcherEnabled: (enabled: boolean) => void;
  markProjectUpdated: (projectPath: string) => void;
  triggerProjectRefresh: (projectPath: string) => Promise<void>;
  triggerSessionRefresh: (projectPath: string, sessionPath: string) => Promise<void>;
  setActiveSessionNearBottom: (nearBottom: boolean) => void;

  // Inspector actions
  toggleInspector: () => void;
  setInspectorOpen: (open: boolean) => void;
  setInspectorTab: (tab: import('./inspectorSlice').InspectorTabId) => void;
  setInspectorWidth: (width: number) => void;

  // Navigator actions
  setNavigatorViewMode: (mode: import('./navigatorSlice').NavigatorViewMode) => void;
  toggleNavigatorViewMode: () => void;
  setVisibleMessageUuid: (uuid: string | null) => void;

  // Minimap actions
  toggleMinimap: () => void;
  setMinimapOpen: (open: boolean) => void;

  // Recent Edits screen actions (recentEditsSlice)
  setRecentEditsDensity: (density: import('./recentEditsSlice').RecentEditsDensity) => void;
  setRecentEditsScope: (scope: import('./recentEditsSlice').RecentEditsScope) => void;
  setRecentEditsGrouping: (
    scope: import('./recentEditsSlice').RecentEditsScope,
    grouping: import('./recentEditsSlice').RecentEditsGrouping
  ) => void;
  setRecentEditsMissingOnly: (missingOnly: boolean) => void;
  loadRecentEditsList: (
    request: import('./recentEditsSlice').RecentEditsRequest,
    options?: import('./recentEditsSlice').LoadRecentEditsOptions
  ) => Promise<void>;
  loadMoreRecentEditsList: (request: import('./recentEditsSlice').RecentEditsRequest) => Promise<void>;
  clearRecentEditsList: () => void;
  invalidateRecentEdits: (projectPath: string) => void;
  markRecentEditRestored: (filePath: string) => void;

  // Provider actions
  detectProviders: () => Promise<boolean>;
  toggleProvider: (id: ProviderId) => void;
  setActiveProviders: (ids: ProviderId[]) => void;

  // Archive actions
  loadArchives: () => Promise<void>;
  createArchive: (params: {
    name: string;
    description?: string | null;
    sessionFilePaths: string[];
    sourceProvider: string;
    sourceProjectPath: string;
    sourceProjectName: string;
    includeSubagents?: boolean;
  }) => Promise<import('../../types').ArchiveEntry>;
  deleteArchive: (id: string) => Promise<void>;
  renameArchive: (id: string, name: string) => Promise<string>;
  loadArchiveSessions: (id: string) => Promise<void>;
  loadDiskUsage: () => Promise<void>;
  loadExpiringSessions: (projectPath: string, thresholdDays?: number) => Promise<void>;
  exportSession: (path: string, format: 'json') => Promise<string>;
  setArchiveActiveTab: (tab: import('../../types').ArchiveViewTab) => void;
  clearArchiveError: () => void;
  resetArchive: () => void;

  // Session picker actions
  openSessionPicker: (
    candidates: import('./sessionPickerSlice').SessionPickerCandidate[],
    hintValue: string,
  ) => void;
  closeSessionPicker: () => void;

  // WebUI server actions
  loadServerConfig: () => Promise<void>;

  // Session selection (multi-select mode) actions
  enterSessionSelectionMode: () => void;
  exitSessionSelectionMode: () => void;
  toggleSessionSelectionMode: () => void;
  handleSessionSelectionClick: (
    sessionId: string,
    orderedIds: string[],
    modifiers: { shift: boolean; cmdOrCtrl: boolean }
  ) => void;
  setSessionSelectionIds: (ids: string[]) => void;
  clearSessionSelection: () => void;
}

export type FullAppStore = AppStoreState & AppStoreActions;
