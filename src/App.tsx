import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAppStore } from "./store/useAppStore";
import { useAnalytics } from "./hooks/useAnalytics";
import { useUpdater } from "./hooks/useUpdater";
import { useResizablePanel } from "./hooks/useResizablePanel";
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
} from "./utils/webuiDeepLink";
import {
  viewAfterLeavingProject,
  viewForProjectSwitch,
} from "./navigation/place";

import "./App.css";

/** A CLI hint or WebUI deep link accepted before the first project scan. */
interface PendingHintIntent {
  hint: SessionHint;
  messageId: string | null;
  options: { epoch: number; record?: boolean };
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
    isLoadingSessions,
    isLoadingMoreSessions,
    isLoadingMessages,
    isLoadingTokenStats,
    error,
    sessionTokenStats,
    sessionConversationTokenStats,
    projectTokenStats,
    projectConversationTokenStats,
    projectTokenStatsSummary,
    projectConversationTokenStatsSummary,
    projectTokenStatsPagination,
    sessionSearch,
    navigate,
    loadMoreSessions,
    setSessionSearchQuery,
    setSearchFilterType,
    goToNextMatch,
    goToPrevMatch,
    clearSessionSearch,
    loadMoreProjectTokenStats,
    loadMoreRecentEdits,
    updateUserSettings,
    getGroupedProjects,
    getDirectoryGroupedProjects,
    getTimeGroupedProjects,
    getEffectiveGroupingMode,
    hideProject,
    unhideProject,
    isProjectHidden,
    dateFilter,
    setDateFilter,
    isNavigatorOpen,
    toggleNavigator,
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

  // Keep the latest projects list in a ref so the second-invocation event
  // listener (which is set up once and lives for the process lifetime) can
  // always see the current list without re-subscribing on every render.
  const projectsRef = useRef(projects);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  // Phase 3: second-invocation routing. If a `cli-session-hint` event or a
  // WebUI popstate arrives before projects finish loading, stash the latest
  // intent here so the first load path can pick it up. Only the *latest* is
  // kept — if the user re-invokes the CLI twice in quick succession, the
  // newer intent wins. The whole intent is kept, not just the hint: the
  // epoch it claimed (anything that navigates meanwhile supersedes it) and
  // whether it records history (a popstate never does).
  const pendingIntentRef = useRef<PendingHintIntent | null>(null);

  /** Open a CLI / deep-link hint; see `openSessionHint` for the epoch rule. */
  const runPreloadWithHint = useCallback(
    (
      hint: SessionHint,
      messageId: string | null = null,
      options: { epoch?: number; record?: boolean } = {},
    ) => {
      const epoch = options.epoch ?? useAppStore.getState().beginNavigation();
      openSessionHint(hint, {
        messageId,
        epoch,
        record: options.record,
        t: (key, fallback) => t(key, fallback ?? key),
      }).catch((error) => {
        if (useAppStore.getState().navigationEpoch !== epoch) return;
        console.error("Failed to preload session:", error);
        toast.error(t("common.error.unexpected", "Failed to open session"));
      });
    },
    [t],
  );

  useEffect(() => {
    if (cliPreloadAttempted.current) return;
    if (isLoadingProjects || projects.length === 0) return;
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
      if (!hint || useAppStore.getState().navigationEpoch !== observedEpoch) return;
      runPreloadWithHint(hint, readWebUIDeepLink().messageId);
    });
  }, [isLoadingProjects, projects, runPreloadWithHint]);

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
          if (!cliPreloadAttempted.current || projectsRef.current.length === 0) {
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

  // Browser back/forward (WebUI). Each popstate is a navigation that adds no
  // history of its own: no URL write, no back/forward entry.
  useEffect(
    () =>
      listenForWebUIDeepLinks((deepLink) => {
        const epoch = useAppStore.getState().beginNavigation();
        const popOptions = { history: "none", record: false, epoch } as const;
        if (!deepLink.sessionId) {
          pendingIntentRef.current = null;
          void navigate(
            {
              project: null,
              view: viewAfterLeavingProject(useAppStore.getState().view),
            },
            popOptions,
          );
          return;
        }

        if (!cliPreloadAttempted.current || projectsRef.current.length === 0) {
          pendingIntentRef.current = {
            hint: { kind: "uuid", value: deepLink.sessionId },
            messageId: deepLink.messageId,
            options: { epoch, record: false },
          };
          return;
        }

        const state = useAppStore.getState();
        const currentSessionId =
          state.selectedSession?.actual_session_id ||
          state.selectedSession?.session_id;

        // The URL names a conversation, so the screen is the conversation,
        // and its target is exactly the URL's (none clears it).
        if (currentSessionId === deepLink.sessionId) {
          void navigate(
            { view: "conversation", messageId: deepLink.messageId },
            popOptions,
          );
          return;
        }

        void navigate(
          { project: null, view: viewAfterLeavingProject(state.view) },
          popOptions,
        );
        runPreloadWithHint(
          { kind: "uuid", value: deepLink.sessionId },
          deepLink.messageId,
          { epoch, record: false },
        );
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

  // Navigator resize (right sidebar)
  const {
    width: navigatorWidth,
    isResizing: isNavigatorResizing,
    handleMouseDown: handleNavigatorResizeStart,
  } = useResizablePanel({
    defaultWidth: 280,
    minWidth: 200,
    maxWidth: 400,
    storageKey: "navigator-width",
    direction: "left",
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
    async (session: ClaudeSession) => {
      try {
        // Find the project this session belongs to.
        //
        // Comparing `project.name === session.project_name` is unreliable
        // across providers: each provider picks its own way to turn a raw
        // on-disk directory (e.g. "Users-foo-Projects-bar") into a sidebar
        // display label, and `session.project_name` is set by the loader,
        // not by the sidebar. CodeBuddy in particular shortens
        // `dir_name.rsplit('-').next()` for its sidebar label while the
        // session loader keeps the encoded form — the two never match,
        // so the previous equality check failed to switch to the right
        // project when a session was selected.
        //
        // The path prefix is the one signal that's stable everywhere:
        // a session's `file_path` always lives under its project's `path`.
        // Match on that first, fall back to the name equality only when
        // `file_path` is unavailable.
        //
        // The prefix match must respect the path-segment boundary so
        // sibling projects sharing a parent dir don't collide — without
        // this, `/a/proj` would also match a session under `/a/proj2`.
        const findProjectForSession = (s: ClaudeSession) => {
          if (s.file_path) {
            const fp = s.file_path;
            const byPath = projects.find((p) => {
              if (!fp.startsWith(p.path)) return false;
              if (fp.length === p.path.length) return true;
              const next = fp.charAt(p.path.length);
              return next === "/" || next === "\\";
            });
            if (byPath) return byPath;
          }
          return projects.find((p) => p.name === s.project_name);
        };

        // One navigation: the conversation screen, the session's project (a
        // no-op when it is already open) and the session.
        await navigate({
          view: "conversation",
          project: findProjectForSession(session),
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
    [projects, navigate, t]
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

      // Re-clicking the open project leaves it (collapse-only is T7, F3).
      if (currentProject?.path === project.path) {
        await navigate({ project: null });
        return;
      }

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
      sessionTokenStats={sessionTokenStats}
      sessionConversationTokenStats={sessionConversationTokenStats}
      projectTokenStats={projectTokenStats}
      projectConversationTokenStats={projectConversationTokenStats}
      projectTokenStatsSummary={projectTokenStatsSummary}
      projectConversationTokenStatsSummary={projectConversationTokenStatsSummary}
      projectTokenStatsPagination={projectTokenStatsPagination}
      sessionSearch={sessionSearch}
      dateFilter={dateFilter}
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
      navigatorWidth={navigatorWidth}
      isNavigatorResizing={isNavigatorResizing}
      handleNavigatorResizeStart={handleNavigatorResizeStart}
      isNavigatorOpen={isNavigatorOpen}
      toggleNavigator={toggleNavigator}
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
      setDateFilter={setDateFilter}
      setSessionSearchQuery={setSessionSearchQuery}
      setSearchFilterType={setSearchFilterType}
      clearSessionSearch={clearSessionSearch}
      goToNextMatch={goToNextMatch}
      goToPrevMatch={goToPrevMatch}
      loadMoreProjectTokenStats={loadMoreProjectTokenStats}
      loadMoreRecentEdits={loadMoreRecentEdits}
      globalOverviewDescription={globalOverviewDescription}
      liveStatusMessage={liveStatusMessage}
    />
  );
}

export default App;
