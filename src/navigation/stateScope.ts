/**
 * Who owns each field of the store once there are conversation tabs (plan
 * §4.3, T8). There is one store (plan §3) and the active tab IS its live
 * state, so every field is one of:
 *
 * - `document` - the tab's own: saved into its snapshot (`TabDocument`)
 *   when the tab is left and put back when it opens again, so another tab
 *   never sees it (the place, its history and targets - the transcript's
 *   and the board's open message - and the capture-mode rows).
 * - `reset` - belongs to the tab on screen but is not kept: every tab
 *   switch puts it back to its initial value (the transcript's find, whose
 *   matches point into one transcript; board hover; what the transcript
 *   reports about its scroll, reported again once the incoming one shows;
 *   the sidebar's multi-selection).
 * - `reloaded` - the open place's transcript and session list: the switch
 *   itself loads the incoming tab's place, so the outgoing tab's never
 *   shows in it.
 * - `screen` - a project screen's data, written with
 *   its owner: the place it was loaded for (`./screenOwner`). A switch
 *   leaves it in the store, but a screen renders a value only when its
 *   owner is the screen's current place - otherwise its loading state, or
 *   its own error state once its own load failed - until that screen's
 *   loader replaces it for the incoming tab's place.
 * - `app` - one for the whole window, whatever tab is open: preferences,
 *   the project list, panels, the tabs themselves, app-wide searches. Some
 *   are cleared when no project is open (board tools, the date range), never
 *   by a switch between tabs.
 *
 * `src/test/stateScope.invariant.test.ts` fails when a store field is
 * missing here, so a new field has to be classified. Each scope's behaviour
 * across a real switch is checked field by field in
 * `navigation.tabs.test.ts` ("… (stateScope)"): `document` comes back with
 * its tab and not in another, `reset` starts at its initial value,
 * `reloaded` never keeps the outgoing tab's value, `screen` is replaced by
 * its screen's loader and never shown under the incoming place before that
 * (`screenOwnership.tabs.test.tsx` renders each screen across held and
 * failed loads), `app` is left as it was.
 */
export type StateScope = "document" | "reset" | "reloaded" | "screen" | "app";

export const STATE_SCOPE: Readonly<Record<string, StateScope>> = {
  // --- the tab's place (navigationSlice, projectSlice, messageSlice) -------
  view: "document",
  // The analytics sub-tab (T9b): part of the tab's place.
  analyticsTab: "document",
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
  // The board's open (expanded) message: a message target of the tab's.
  selectedMessageId: "document",

  // --- started over on every switch ------------------------------------------
  // The transcript's find.
  sessionSearch: "reset",
  // Board hover: a property of the board screen, dropped by every move.
  boardHoverSession: "reset",
  // Reported by the transcript on screen; the incoming one reports again.
  visibleMessageUuid: "reset",
  activeSessionNearBottom: "reset",
  // The sidebar's multi-selection (also abandoned when the project changes).
  isSessionSelectionMode: "reset",
  sessionSelectionIds: "reset",
  sessionSelectionAnchor: "reset",

  // --- the open place's transcript and session list --------------------------
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
  // Set by the activation that opens a tab (its saved anchor).
  pendingAnchor: "reloaded",
  // Advances with every setting of the target (its lookups' ownership).
  targetRequest: "reloaded",

  // --- a screen's data, loaded when the screen opens ---------------------------
  isLoadingTokenStats: "screen",
  sessionTokenStats: "screen",
  sessionConversationTokenStats: "screen",
  projectTokenStats: "screen",
  projectConversationTokenStats: "screen",
  projectTokenStatsSummary: "screen",
  projectConversationTokenStatsSummary: "screen",
  projectTokenStatsPagination: "screen",
  // Whose the token stats are, and the project load's failure.
  projectTokenStatsOwner: "screen",
  sessionTokenStatsOwner: "screen",
  // The session load's failure, and whose (the inspector's Tokens tab).
  sessionTokenStatsError: "screen",
  sessionTokenStatsErrorOwner: "screen",
  projectTokenStatsError: "screen",
  projectTokenStatsErrorOwner: "screen",
  analytics: "screen",
  boardSessions: "screen",
  visibleSessionIds: "screen",
  allSortedSessionIds: "screen",
  isLoadingBoard: "screen",
  boardLoadError: "screen",
  boardOwner: "screen",
  boardLoadErrorOwner: "screen",
  // The Edits screen's rows, owned by their request key (project, scope,
  // grouping, session).
  recentEditsList: "screen",
  recentEditsError: "screen",
  recentEditsRequestedKey: "screen",
  isLoadingRecentEdits: "screen",
  isLoadingMoreRecentEdits: "screen",

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
  // The inspector (T9a): open state, tab and width are window-wide
  // preferences, not a tab's - switching tabs keeps the panel as it was.
  isInspectorOpen: "app",
  inspectorTab: "app",
  inspectorWidth: "app",
  navigatorViewMode: "app",
  isMinimapOpen: "app",
  // The Edits screen's preferences.
  recentEditsScope: "app",
  recentEditsGroupingProject: "app",
  recentEditsGroupingSession: "app",
  recentEditsDensity: "app",
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
};

/** The fields of `scope`. */
export const fieldsOf = (scope: StateScope): string[] =>
  Object.entries(STATE_SCOPE)
    .filter(([, s]) => s === scope)
    .map(([field]) => field);
