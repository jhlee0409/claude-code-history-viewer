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

  // One-shot guard so `--session <uuid>` preload fires exactly once per
  // process, even if project loading renders multiple times.
  const cliPreloadAttempted = useRef(false);

  useEffect(() => {
    if (cliPreloadAttempted.current) return;
    if (isLoadingProjects || projects.length === 0) return;
    cliPreloadAttempted.current = true;
    void preloadSessionFromCli({
      getStartupSessionHint: fetchStartupSessionHint,
      projects,
      selectProject,
      selectSession,
      t: (key, fallback) => t(key, fallback ?? key),
    });
  }, [isLoadingProjects, projects, selectProject, selectSession, t]);

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
