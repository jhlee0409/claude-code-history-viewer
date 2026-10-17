import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAppStore } from "./store/useAppStore";
import { useAnalytics } from "./hooks/useAnalytics";
import { useUpdater } from "./hooks/useUpdater";
import { useResizablePanel } from "./hooks/useResizablePanel";
import { INSPECTOR_WIDTH } from "./store/slices/inspectorSlice";
import { useAppKeyboard } from "./hooks/useAppKeyboard";
import { useAppInitialization } from "./hooks/useAppInitialization";
import { useLiveStatusMessage } from "./hooks/useLiveStatusMessage";
import { useExternalLinks } from "./hooks/useExternalLinks";
import { usePlatform } from "@/contexts/platform";
import { AppLayout } from "@/layouts/AppLayout";
import {
  type ClaudeSession,
  type ClaudeProject,
  type SessionTokenStats,
  type GroupingMode,
} from "./types";
import { getProviderLabel, normalizeProviderIds } from "./utils/providers";
import {
  fetchStartupSessionHint,
  openSessionHint,
  type SessionHint,
} from "./lib/preloadSession";
import {
  listenForWebUIDeepLinks,
  readWebUIDeepLink,
  stampWebUITab,
} from "./utils/webuiDeepLink";
import {
  viewForProjectSwitch,
} from "./navigation/place";
import { projectListing } from "./navigation/library";
import {
  openHintInTab,
  openInNewTab,
  openMatchInTab,
  openTabAtUrl,
  planUrlMove,
  reportStoredTabsProblems,
  retryUnavailableTab,
  restoreActiveTab,
  startTabsPersistence,
  type TabScreens,
} from "./navigation/tabs";
import { OpenSessionInNewTabContext } from "./contexts/openInNewTab";

import "./App.css";

/** A CLI hint or WebUI deep link accepted before the first project scan. */
interface PendingHintIntent {
  hint: SessionHint;
  messageId: string | null;
  options: HintRunOptions & { epoch: number };
}

interface HintRunOptions {
  epoch?: number;
  record?: boolean;
  /**
   * Where the session opens: its own tab (a CLI launch, startup, a URL of a
   * closed tab - plan §4.3), the tab a URL names, or the active tab (an old
   * URL naming no tab).
   */
  target?: "tab" | "active" | { tabId: string };
}

/** How a hint's match opens for `target` (`HintRunOptions.target`). */
function openMatchFor(target: HintRunOptions["target"]) {
  if (target === "active") return undefined;
  if (typeof target === "object") {
    const { tabId } = target;
    return (...args: Parameters<typeof openHintInTab>) => openMatchInTab(tabId, ...args);
  }
  return openHintInTab;
}

function App() {
  const {
    projects,
    sessions,
    sessionsTotal,
    hasMoreSessions,
    selectedProject,
    selectedSession,
    messages,
    isLoading,
    isLoadingProjects,
    projectsScanned,
    isLoadingSessions,
    isLoadingMoreSessions,
    isLoadingMessages,
    isLoadingTokenStats,
    error,
    navigate,
    loadMoreSessions,
    updateUserSettings,
    getGroupedProjects,
    getDirectoryGroupedProjects,
    getTimeGroupedProjects,
    getEffectiveGroupingMode,
    hideProject,
    unhideProject,
    isProjectHidden,
    setDateFilter,
    isInspectorOpen,
    inspectorWidth: storedInspectorWidth,
    setInspectorWidth,
    activeProviders,
  } = useAppStore();

  const {
    state: analyticsState,
    actions: analyticsActions,
    computed,
  } = useAnalytics();

  const { t } = useTranslation();
  const { isDesktop, isMobile } = usePlatform();
  const updater = useUpdater();
  const appVersion = updater.state.currentVersion || "—";

  // Side-effect hooks (no return value)
  useAppKeyboard();
  useExternalLinks();
  useAppInitialization({ isMessagesView: computed.isMessagesView });

  const liveStatusMessage = useLiveStatusMessage({
    isChecking: updater.state.isChecking,
    isLoading,
    isAnyLoading: computed.isAnyLoading,
    isLoadingMessages,
    isLoadingProjects,
    isLoadingSessions,
  });

  const globalOverviewDescription = useMemo(() => {
    const normalized = normalizeProviderIds(activeProviders);

    if (normalized.length === 0) {
      return t("analytics.globalOverviewDescription");
    }

    const labels = normalized.map((providerId) =>
      getProviderLabel((key, fallback) => t(key, fallback), providerId)
    );

    if (labels.length === 1) {
      return t(
        "analytics.globalOverviewDescriptionSingleProvider",
        "Aggregated statistics for {{provider}} projects on your machine",
        { provider: labels[0] }
      );
    }

    return t(
      "analytics.globalOverviewDescriptionMultiProvider",
      "Aggregated statistics for selected providers ({{providers}}) on your machine",
      { providers: labels.join(", ") }
    );
  }, [activeProviders, t]);

  // One-shot guard so the first-launch `--session` preload fires exactly once
  // per process, even if project loading renders multiple times.
  const cliPreloadAttempted = useRef(false);

  // Phase 3: second-invocation routing. If a `cli-session-hint` event or a
  // WebUI popstate arrives before projects finish loading, stash the latest
  // intent here so the first load path can pick it up. Only the *latest* is
  // kept — if the user re-invokes the CLI twice in quick succession, the
  // newer intent wins. The whole intent is kept, not just the hint: the
  // epoch it claimed (anything that navigates meanwhile supersedes it) and
  // whether it records history (a popstate never does).
  const pendingIntentRef = useRef<PendingHintIntent | null>(null);

  // Opening a tab loads its screen's data the way the toolbar tabs do.
  const openView = analyticsActions.openView;
  const tabScreens = useMemo<TabScreens>(() => ({ openView }), [openView]);
  const tabScreensRef = useRef(tabScreens);
  useEffect(() => {
    tabScreensRef.current = tabScreens;
  }, [tabScreens]);

  // Tabs are saved as they change (`tabs.v1`); a store that could not be
  // read is reported once.
  useEffect(() => {
    reportStoredTabsProblems();
    stampWebUITab();
    return startTabsPersistence();
  }, []);

  /** Open a CLI / deep-link hint; see `openSessionHint` for the epoch rule. */
  const runPreloadWithHint = useCallback(
    (
      hint: SessionHint,
      messageId: string | null = null,
      options: HintRunOptions = {},
    ) => {
      const epoch = options.epoch ?? useAppStore.getState().beginNavigation();
      openSessionHint(hint, {
        messageId,
        epoch,
        record: options.record,
        openMatch: openMatchFor(options.target),
        t: (key, fallback) => t(key, fallback ?? key),
      }).catch((error) => {
        if (useAppStore.getState().navigationEpoch !== epoch) return;
        console.error("Failed to preload session:", error);
        toast.error(t("common.error.unexpected", "Failed to open session"));
      });
    },
    [t],
  );

  // Startup waits for the first project scan to complete - an empty one
  // included (§4.3 barrier): a restored tab whose project is gone then says
  // so inside the tab instead of waiting forever.
  const projectsReady = !isLoadingProjects && (projectsScanned || projects.length > 0);
  useEffect(() => {
    if (cliPreloadAttempted.current) return;
    if (!projectsReady) return;
    cliPreloadAttempted.current = true;
    // Drain a hint that arrived before projects loaded, if any. Otherwise use
    // the Tauri-managed first-launch hint.
    const queued = pendingIntentRef.current;
    if (queued) {
      pendingIntentRef.current = null;
      runPreloadWithHint(queued.hint, queued.messageId, queued.options);
      return;
    }
    // Asking for the hint is not a navigation: only observe the epoch here,
    // and claim one once a hint actually arrives, so a startup without a hint
    // never supersedes a navigation already in flight.
    const observedEpoch = useAppStore.getState().navigationEpoch;
    void fetchStartupSessionHint().then((hint) => {
      // A second invocation, a deep link or the user may have navigated while
      // the startup command was resolving. The newer request owns navigation.
      if (useAppStore.getState().navigationEpoch !== observedEpoch) return;
      // Startup priority (plan §4.3): the hint first; the restored tab opens
      // only when there is none (barrier: after the hint was asked for).
      if (!hint) {
        void restoreActiveTab(tabScreensRef.current);
        return;
      }
      runPreloadWithHint(hint, readWebUIDeepLink().messageId);
    });
  }, [projectsReady, runPreloadWithHint]);

  // A tab that could not find its project opens once a later scan lists it.
  useEffect(() => {
    if (!cliPreloadAttempted.current) return;
    void retryUnavailableTab(tabScreensRef.current);
  }, [projects]);

  // Second-invocation routing. `tauri-plugin-single-instance` (CLI re-exec)
  // and macOS `RunEvent::Opened` (Spotlight/Dock/Finder) both emit
  // `cli-session-hint`. We resolve each hint through `preloadSessionFromCli`
  // so uuid / path / folder / title behave identically regardless of entry
  // path. The listener uses a dynamic import so the WebUI / browser build
  // (no Tauri APIs) doesn't fail at module load — matching the pattern used
  // by `useFileWatcher`, `useUpdater`, etc.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const subscribe = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        if (cancelled) return;
        unlisten = await listen<SessionHint>("cli-session-hint", (event) => {
          const hint = event.payload;
          // Supersede whatever hint is still resolving.
          const epoch = useAppStore.getState().beginNavigation();
          // Projects not yet loaded: stash and let the first-load effect
          // consume the latest hint. This handles the race where the user
          // re-invokes the CLI before the initial project scan finishes.
          if (!cliPreloadAttempted.current) {
            pendingIntentRef.current = { hint, messageId: null, options: { epoch } };
            return;
          }
          runPreloadWithHint(hint, null, { epoch });
        });
      } catch (error) {
        // Non-Tauri environments (webui-server served in a browser) lack
        // `@tauri-apps/api/event`. Second-invocation routing doesn't apply.
        console.warn("cli-session-hint listener unavailable:", error);
      }
    };
    void subscribe();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [runPreloadWithHint]);

  // Browser back/forward (WebUI). Each popstate is one navigation that adds
  // no history of its own: no URL write, no back/forward entry. It claims its
  // epoch first and every step after - the tab coming forward, the move
  // inside it, a lookup of the URL's session - runs under that epoch, so a
  // later navigation supersedes all of it and it writes nothing more.
  // A URL names the tab its session was open in (§9b F1): that tab comes
  // forward at the URL's place; a tab closed since gets a new one.
  useEffect(
    () =>
      listenForWebUIDeepLinks((deepLink) => {
        const epoch = useAppStore.getState().beginNavigation();
        const popOptions = { history: "none", record: false, epoch } as const;
        const sessionId = deepLink.sessionId;
        if (!cliPreloadAttempted.current) {
          // Before startup has opened anything, the latest URL with a session
          // is kept for it; one without a session leaves the restore alone.
          pendingIntentRef.current = sessionId
            ? {
                hint: { kind: "uuid", value: sessionId },
                messageId: deepLink.messageId,
                options: { epoch, record: false, target: "tab" },
              }
            : null;
          return;
        }

        const move = planUrlMove(deepLink);
        switch (move.kind) {
          case "stay":
            return;
          case "here":
            // The URL names a conversation, so the screen is the
            // conversation, and its target is exactly the URL's (none
            // clears it).
            void navigate({ view: "conversation", messageId: deepLink.messageId }, popOptions);
            return;
          case "tab":
            void openTabAtUrl(move.tabId, deepLink, tabScreensRef.current, epoch);
            return;
          case "resolve":
            if (!sessionId) return;
            runPreloadWithHint({ kind: "uuid", value: sessionId }, deepLink.messageId, {
              epoch,
              record: false,
              target: move.into === "newTab" ? "tab" : move.into,
            });
        }
      }),
    [navigate, runPreloadWithHint],
  );

  // Local state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Sidebar resize
  const {
    width: sidebarWidth,
    isResizing: isSidebarResizing,
    handleMouseDown: handleSidebarResizeStart,
  } = useResizablePanel({
    defaultWidth: 256,
    minWidth: 200,
    maxWidth: 800,
    storageKey: "sidebar-width",
  });

  // Inspector resize (right side). The width is a stored preference of the
  // inspector's (`inspectorSlice.ts`): read once here, written when a drag
  // ends.
  const {
    width: inspectorWidth,
    isResizing: isInspectorResizing,
    handleMouseDown: handleInspectorResizeStart,
  } = useResizablePanel({
    defaultWidth: storedInspectorWidth,
    minWidth: INSPECTOR_WIDTH.min,
    maxWidth: INSPECTOR_WIDTH.max,
    direction: "left",
    onResizeEnd: setInspectorWidth,
  });

  // Recent Edits dock resize (right side, sibling of the navigator).
  // Wider than the navigator's 280 by default: the row carries a filename, line
  // counts and a time on one line.
  const {
    width: recentEditsDockWidth,
    isResizing: isRecentEditsDockResizing,
    handleMouseDown: handleRecentEditsDockResizeStart,
  } = useResizablePanel({
    defaultWidth: 340,
    minWidth: 260,
    maxWidth: 520,
    storageKey: "recent-edits-width",
    direction: "left",
  });

  // Global stats is a screen of the current place: the project/session stay
  // as its context, so the sidebar and sessions column keep them and one
  // click returns to the conversation.
  const handleGlobalStatsClick = useCallback(() => {
    void analyticsActions.switchToGlobalStats();
  }, [analyticsActions]);

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((prev) => !prev);
  }, []);

  // Project grouping
  const groupingMode = getEffectiveGroupingMode();
  const { groups: worktreeGroups, ungrouped: ungroupedProjects } =
    getGroupedProjects();
  const { groups: directoryGroups } = getDirectoryGroupedProjects();
  const { groups: timeGroups } = getTimeGroupedProjects();

  const handleGroupingModeChange = useCallback(
    (newMode: GroupingMode) => {
      updateUserSettings({
        groupingMode: newMode,
        worktreeGrouping: newMode === "worktree",
        worktreeGroupingUserSet: true,
      });
    },
    [updateUserSettings]
  );

  const handleSessionSelect = useCallback(
    async (session: ClaudeSession, owner?: ClaudeProject) => {
      try {
        // The project a session belongs to is the one that lists it: the
        // row's own project when the sidebar passes it, else the open
        // project when its list holds it, else the project whose storage
        // path holds the file (`projectListing`). Never a project found by
        // name: Codex calls `/work/a/repo` and `/work/b/repo` both "repo".
        const project = projectListing(useAppStore.getState(), session, owner);

        // One navigation: the conversation screen, the session's project (a
        // no-op when it is already open) and the session.
        await navigate({
          view: "conversation",
          project,
          session,
        });
      } catch (error) {
        // Per CLAUDE.md "에러 처리": async failures need user-visible
        // feedback (toast/alert). console.error alone leaves the user
        // staring at a sidebar that didn't react to their click.
        console.error("Failed to select session:", error);
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`${t("session.selectError")}: ${message}`);
      }
    },
    [navigate, t]
  );

  // ⌘+click on a session row: the same open, in a new tab (T8).
  const handleSessionOpenInNewTab = useCallback(
    (session: ClaudeSession, owner?: ClaudeProject) => {
      void openInNewTab(() => handleSessionSelect(session, owner));
    },
    [handleSessionSelect]
  );

  const handleTokenStatClick = useCallback(
    (stats: SessionTokenStats) => {
      const session = sessions.find(
        (s) =>
          s.actual_session_id === stats.session_id ||
          s.session_id === stats.session_id
      );

      if (session) {
        handleSessionSelect(session);
      } else {
        console.warn("Session not found in loaded list:", stats.session_id);
      }
    },
    [sessions, handleSessionSelect]
  );

  const handleProjectSelect = useCallback(
    async (project: ClaudeProject) => {
      const { selectedProject: currentProject, view: screenBefore } =
        useAppStore.getState();

      // Opening the open project again changes nothing: a re-click on its
      // sidebar row only expands or collapses it (plan §9b F3).
      if (currentProject?.path === project.path) return;

      // The screen follows the user into the new project (global stats
      // becomes its analytics); its data is reloaded for that project.
      const view = viewForProjectSwitch(screenBefore);

      analyticsActions.clearAll();
      setDateFilter({ start: null, end: null });

      const arrived = await navigate({ view, project });
      if (!arrived) return;

      try {
        await analyticsActions.openView(view);
      } catch (error) {
        console.error(`Failed to auto-load ${view} view:`, error);
      }
    },
    [navigate, analyticsActions, setDateFilter]
  );

  // Hovering a session in the sidebar while the board is open brings its lane
  // forward. Board-only state: it must not select the session, or the
  // sidebar, watcher, URL and global-stats exit would all follow the pointer.
  const handleSessionHover = useCallback(
    (session: ClaudeSession) => {
      if (computed.isBoardView) {
        useAppStore.getState().setBoardHoverSession(session);
      }
    },
    [computed.isBoardView]
  );

  return (
    <OpenSessionInNewTabContext.Provider value={handleSessionOpenInNewTab}>
    <AppLayout
      projects={projects}
      sessions={sessions}
      sessionsTotal={sessionsTotal}
      hasMoreSessions={hasMoreSessions}
      selectedProject={selectedProject}
      selectedSession={selectedSession}
      messages={messages}
      isLoading={isLoading}
      isLoadingProjects={isLoadingProjects}
      isLoadingSessions={isLoadingSessions}
      isLoadingMoreSessions={isLoadingMoreSessions}
      isLoadingMessages={isLoadingMessages}
      isLoadingTokenStats={isLoadingTokenStats}
      error={error}
      analyticsState={analyticsState}
      analyticsActions={analyticsActions}
      computed={computed}
      updater={updater}
      appVersion={appVersion}
      isDesktop={isDesktop}
      isMobile={isMobile}
      isSidebarCollapsed={isSidebarCollapsed}
      isMobileSidebarOpen={isMobileSidebarOpen}
      setIsMobileSidebarOpen={setIsMobileSidebarOpen}
      sidebarWidth={sidebarWidth}
      isSidebarResizing={isSidebarResizing}
      handleSidebarResizeStart={handleSidebarResizeStart}
      inspectorWidth={inspectorWidth}
      isInspectorResizing={isInspectorResizing}
      handleInspectorResizeStart={handleInspectorResizeStart}
      isInspectorOpen={isInspectorOpen}
      recentEditsDockWidth={recentEditsDockWidth}
      isRecentEditsDockResizing={isRecentEditsDockResizing}
      handleRecentEditsDockResizeStart={handleRecentEditsDockResizeStart}
      groupingMode={groupingMode}
      worktreeGroups={worktreeGroups}
      directoryGroups={directoryGroups}
      timeGroups={timeGroups}
      ungroupedProjects={ungroupedProjects}
      handleProjectSelect={handleProjectSelect}
      loadMoreSessions={loadMoreSessions}
      handleSessionSelect={handleSessionSelect}
      handleSessionHover={handleSessionHover}
      handleGlobalStatsClick={handleGlobalStatsClick}
      handleToggleSidebar={handleToggleSidebar}
      handleGroupingModeChange={handleGroupingModeChange}
      handleTokenStatClick={handleTokenStatClick}
      hideProject={hideProject}
      unhideProject={unhideProject}
      isProjectHidden={isProjectHidden}
      globalOverviewDescription={globalOverviewDescription}
      liveStatusMessage={liveStatusMessage}
    />
    </OpenSessionInNewTabContext.Provider>
  );
}

export default App;
