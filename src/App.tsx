import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
  preloadSessionFromCli,
  type SessionHint,
} from "./lib/preloadSession";

import "./App.css";

function App() {
  const {
    projects,
    sessions,
    selectedProject,
    selectedSession,
    messages,
    isLoading,
    isLoadingProjects,
    isLoadingSessions,
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
    selectProject,
    selectSession,
    clearProjectSelection,
    setSessionSearchQuery,
    setSearchFilterType,
    goToNextMatch,
    goToPrevMatch,
    clearSessionSearch,
    loadGlobalStats,
    setAnalyticsCurrentView,
    loadMoreProjectTokenStats,
    loadMoreRecentEdits,
    updateUserSettings,
    getGroupedProjects,
    getDirectoryGroupedProjects,
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
  const openSessionPicker = useAppStore((s) => s.openSessionPicker);

  // Keep the latest projects list in a ref so the second-invocation event
  // listener (which is set up once and lives for the process lifetime) can
  // always see the current list without re-subscribing on every render.
  const projectsRef = useRef(projects);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  // Phase 3: second-invocation routing. If a `cli-session-hint` event arrives
  // before projects finish loading, stash the latest hint here so the first
  // load path can pick it up. Only the *latest* hint is kept — if the user
  // re-invokes the CLI twice in quick succession, the newer intent wins.
  const pendingHintRef = useRef<SessionHint | null>(null);

  const runPreloadWithHint = useCallback(
    (hint: SessionHint) => {
      void preloadSessionFromCli({
        getStartupSessionHint: () => Promise.resolve(hint),
        projects: projectsRef.current,
        selectProject,
        selectSession,
        openSessionPicker,
        t: (key, fallback) => t(key, fallback ?? key),
      });
    },
    [selectProject, selectSession, openSessionPicker, t],
  );

  useEffect(() => {
    if (cliPreloadAttempted.current) return;
    if (isLoadingProjects || projects.length === 0) return;
    cliPreloadAttempted.current = true;
    // Drain a hint that arrived before projects loaded, if any. Otherwise use
    // the Tauri-managed first-launch hint.
    const queued = pendingHintRef.current;
    if (queued) {
      pendingHintRef.current = null;
      runPreloadWithHint(queued);
      return;
    }
    void preloadSessionFromCli({
      getStartupSessionHint: fetchStartupSessionHint,
      projects,
      selectProject,
      selectSession,
      openSessionPicker,
      t: (key, fallback) => t(key, fallback ?? key),
    });
  }, [isLoadingProjects, projects, selectProject, selectSession, openSessionPicker, t, runPreloadWithHint]);

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
          // Projects not yet loaded: stash and let the first-load effect
          // consume the latest hint. This handles the race where the user
          // re-invokes the CLI before the initial project scan finishes.
          if (!cliPreloadAttempted.current || projectsRef.current.length === 0) {
            pendingHintRef.current = hint;
            return;
          }
          runPreloadWithHint(hint);
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

  // Local state
  const [isViewingGlobalStats, setIsViewingGlobalStats] = useState(false);
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
    maxWidth: 480,
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

  const handleGlobalStatsClick = useCallback(() => {
    setIsViewingGlobalStats(true);
    clearProjectSelection();
    setAnalyticsCurrentView("analytics");
    void loadGlobalStats();
  }, [clearProjectSelection, loadGlobalStats, setAnalyticsCurrentView]);

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((prev) => !prev);
  }, []);

  // Project grouping
  const groupingMode = getEffectiveGroupingMode();
  const { groups: worktreeGroups, ungrouped: ungroupedProjects } =
    getGroupedProjects();
  const { groups: directoryGroups } = getDirectoryGroupedProjects();

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
        setIsViewingGlobalStats(false);
        setAnalyticsCurrentView("messages");

        const currentProject = useAppStore.getState().selectedProject;
        if (!currentProject || currentProject.name !== session.project_name) {
          const project = projects.find((p) => p.name === session.project_name);
          if (project) {
            await selectProject(project);
          }
        }

        await selectSession(session);
      } catch (error) {
        console.error("Failed to select session:", error);
      }
    },
    [projects, selectProject, selectSession, setAnalyticsCurrentView]
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
      const currentProject = useAppStore.getState().selectedProject;

      if (currentProject?.path === project.path) {
        clearProjectSelection();
        return;
      }

      const activeView = useAppStore.getState().analytics.currentView;
      setIsViewingGlobalStats(false);

      analyticsActions.clearAll();
      setDateFilter({ start: null, end: null });

      await selectProject(project);

      try {
        if (activeView === "tokenStats") {
          await analyticsActions.switchToTokenStats();
        } else if (activeView === "board") {
          await analyticsActions.switchToBoard();
        } else if (activeView === "recentEdits") {
          await analyticsActions.switchToRecentEdits();
        } else if (activeView === "analytics") {
          await analyticsActions.switchToAnalytics();
        } else if (activeView === "settings") {
          analyticsActions.switchToSettings();
        } else {
          analyticsActions.switchToMessages();
        }
      } catch (error) {
        console.error(`Failed to auto-load ${activeView} view:`, error);
      }
    },
    [clearProjectSelection, selectProject, analyticsActions, setDateFilter]
  );

  const handleSessionHover = useCallback(
    (session: ClaudeSession) => {
      if (computed.isBoardView) {
        useAppStore.getState().setSelectedSession(session);
      }
    },
    [computed.isBoardView]
  );

  return (
    <AppLayout
      projects={projects}
      sessions={sessions}
      selectedProject={selectedProject}
      selectedSession={selectedSession}
      messages={messages}
      isLoading={isLoading}
      isLoadingProjects={isLoadingProjects}
      isLoadingSessions={isLoadingSessions}
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
      isViewingGlobalStats={isViewingGlobalStats}
      isSidebarCollapsed={isSidebarCollapsed}
      isMobileSidebarOpen={isMobileSidebarOpen}
      setIsMobileSidebarOpen={setIsMobileSidebarOpen}
      setIsViewingGlobalStats={setIsViewingGlobalStats}
      sidebarWidth={sidebarWidth}
      isSidebarResizing={isSidebarResizing}
      handleSidebarResizeStart={handleSidebarResizeStart}
      navigatorWidth={navigatorWidth}
      isNavigatorResizing={isNavigatorResizing}
      handleNavigatorResizeStart={handleNavigatorResizeStart}
      isNavigatorOpen={isNavigatorOpen}
      toggleNavigator={toggleNavigator}
      groupingMode={groupingMode}
      worktreeGroups={worktreeGroups}
      directoryGroups={directoryGroups}
      ungroupedProjects={ungroupedProjects}
      handleProjectSelect={handleProjectSelect}
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
