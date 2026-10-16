/**
 * Who owns each field of the store once there are conversation tabs (plan
 * §4.3, T8). There is one store (plan §3) and the active tab IS its live
 * state, so every field is one of:
 *
 * - `document` - the tab's own: saved into its snapshot (`TabDocument`)
 *   when the tab is left and put back when it opens again, so another tab
 *   never sees it (the place, its history and target, the capture-mode rows).
 * - `reset` - belongs to the tab on screen but is not kept: every tab
 *   switch starts it empty (the transcript's find; its matches are of one
 *   transcript and would point into another).
 * - `reloaded` - what the open place shows, loaded again for the place
 *   whenever a tab opens it (messages, session lists, screen data): never
 *   carried from one tab into another.
 * - `app` - one for the whole window, whatever tab is open: preferences,
 *   the project list, panels, the tabs themselves, app-wide searches.
 *
 * `src/test/stateScope.invariant.test.ts` fails when a store field is
 * missing here, so a new field has to be classified, and checks that the
 * `document` and `reset` fields really behave so across a tab switch.
 */
export type StateScope = "document" | "reset" | "reloaded" | "app";

export const STATE_SCOPE: Readonly<Record<string, StateScope>> = {
  // --- the tab's place (navigationSlice, projectSlice, messageSlice) -------
  view: "document",
  selectedProject: "document",
  selectedSession: "document",
  parentSessionStack: "document",
  placeHistory: "document",
  targetMessageUuid: "document",
  // Set with the target (a restored target highlights again).
  shouldHighlightTarget: "document",
  // --- the tab's capture mode (captureModeSlice) ---------------------------
  isCaptureMode: "document",
  hiddenMessageIds: "document",
  selectedMessageIds: "document",
  selectionAnchor: "document",

  // --- the transcript's find (searchSlice) ----------------------------------
  sessionSearch: "reset",

  // --- loaded for the open place ---------------------------------------------
  messages: "reloaded",
  pagination: "reloaded",
  isLoadingMessages: "reloaded",
  subagentSessions: "reloaded",
  toolUseToSubagentMap: "reloaded",
  sessions: "reloaded",
  sessionsTotal: "reloaded",
  sessionsOffset: "reloaded",
  hasMoreSessions: "reloaded",
  isLoadingSessions: "reloaded",
  isLoadingMoreSessions: "reloaded",
  isLoadingTokenStats: "reloaded",
  sessionTokenStats: "reloaded",
  sessionConversationTokenStats: "reloaded",
  projectTokenStats: "reloaded",
  projectConversationTokenStats: "reloaded",
  projectTokenStatsSummary: "reloaded",
  projectConversationTokenStatsSummary: "reloaded",
  projectTokenStatsPagination: "reloaded",
  analytics: "reloaded",
  boardSessions: "reloaded",
  visibleSessionIds: "reloaded",
  allSortedSessionIds: "reloaded",
  isLoadingBoard: "reloaded",
  boardLoadError: "reloaded",
  // Board hover and the board's selected message: dropped by every navigation.
  boardHoverSession: "reloaded",
  selectedMessageId: "reloaded",
  // The docked Recent Edits rows are the open project's.
  recentEditsDock: "reloaded",
  recentEditsDockError: "reloaded",
  recentEditsDockRequestedKey: "reloaded",
  isLoadingRecentEditsDock: "reloaded",
  isLoadingMoreRecentEditsDock: "reloaded",
  // Reported by the transcript on screen.
  visibleMessageUuid: "reloaded",
  activeSessionNearBottom: "reloaded",
  // Set by the activation that opens a tab (its saved anchor).
  pendingAnchor: "reloaded",
  // Advances with every setting of the target (its lookups' ownership).
  targetRequest: "reloaded",

  // --- the tabs themselves and navigation bookkeeping -----------------------
  documents: "app",
  activeDocumentId: "app",
  hydratedDocumentId: "app",
  tabsRestorePending: "app",
  tabsRestoreReport: "app",
  navigationEpoch: "app",
  recentSessions: "app",

  // --- projects, providers, app status ----------------------------------------
  claudePath: "app",
  projects: "app",
  projectsScanned: "app",
  isLoadingProjects: "app",
  isRefreshingAllConversations: "app",
  isLoading: "app",
  error: "app",
  providers: "app",
  activeProviders: "app",
  hasDetectedProviders: "app",
  isDetectingProviders: "app",
  userMetadata: "app",
  isMetadataLoaded: "app",
  isMetadataLoading: "app",
  metadataError: "app",
  isServerConfigLoaded: "app",
  isServerReadOnly: "app",
  watcherEnabled: "app",
  lastUpdateTime: "app",
  updateSettings: "app",
  archive: "app",
  globalSummary: "app",
  globalConversationSummary: "app",
  isLoadingGlobalStats: "app",
  // An image export in flight: cleared by the export that set it.
  isCapturing: "app",

  // --- preferences (persisted or remembered app-wide) ------------------------
  excludeSidechain: "app",
  showSystemMessages: "app",
  fontScale: "app",
  highContrast: "app",
  sessionSortOrder: "app",
  sessionEntrypointFilter: "app",
  messageFilter: "app",
  userOnlyFilter: "app",
  showParallelTasksInNavigator: "app",
  isNavigatorOpen: "app",
  navigatorViewMode: "app",
  isMinimapOpen: "app",
  isRecentEditsDockOpen: "app",
  recentEditsMode: "app",
  recentEditsScope: "app",
  recentEditsGroupingProject: "app",
  recentEditsGroupingSession: "app",
  recentEditsDensityDock: "app",
  recentEditsDensityPage: "app",
  recentEditsMissingOnly: "app",
  zoomLevel: "app",
  isMarkdownPretty: "app",
  isTimelineExpanded: "app",
  // Board brush and date range: board tools, cleared when the project goes.
  activeBrush: "app",
  stickyBrush: "app",
  dateFilter: "app",

  // --- app-wide searches and pickers -----------------------------------------
  searchQuery: "app",
  searchResults: "app",
  searchFilters: "app",
  sessionPickerCandidates: "app",
  sessionPickerHintValue: "app",
  // Sidebar multi-selection: cleared when the project changes.
  isSessionSelectionMode: "app",
  sessionSelectionIds: "app",
  sessionSelectionAnchor: "app",
};

/** The fields of `scope`. */
export const fieldsOf = (scope: StateScope): string[] =>
  Object.entries(STATE_SCOPE)
    .filter(([, s]) => s === scope)
    .map(([field]) => field);
