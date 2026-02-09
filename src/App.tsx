import { useCallback, useEffect, useState } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { ProjectTree } from "./components/ProjectTree";
import { MessageViewer } from "./components/MessageViewer";
import { MessageNavigator } from "./components/MessageNavigator";
import { TokenStatsViewer } from "./components/TokenStatsViewer";
import { AnalyticsDashboard } from "./components/AnalyticsDashboard";
import { RecentEditsViewer } from "./components/RecentEditsViewer";
import { SimpleUpdateManager } from "./components/SimpleUpdateManager";
import { SettingsManager } from "./components/SettingsManager";
import { SessionBoard } from "./components/SessionBoard/SessionBoard";
import { useAppStore } from "./store/useAppStore";
import { useAnalytics } from "./hooks/useAnalytics";
import { useResizablePanel } from "./hooks/useResizablePanel";

import { useTranslation } from "react-i18next";
import { AppErrorType, type ClaudeSession, type ClaudeProject, type SessionTokenStats } from "./types";
import type { GroupingMode } from "./types/metadata.types";
import { AlertTriangle, MessageSquare, Database, BarChart3, FileEdit, Coins, Settings } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useLanguageStore } from "./store/useLanguageStore";
import { type SupportedLanguage } from "./i18n";

import "./App.css";
import { Header } from "@/layouts/Header/Header";
import { ModalContainer } from "./layouts/Header/SettingDropdown/ModalContainer";
import { useModal } from "@/contexts/modal";

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
    projectTokenStats,
    projectTokenStatsPagination,
    sessionSearch,
    initializeApp,
    selectProject,
    selectSession,
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
  } = useAppStore();

  const {
    state: analyticsState,
    actions: analyticsActions,
    computed,
  } = useAnalytics();

  const { t, i18n: i18nInstance } = useTranslation();
  const { language, loadLanguage } = useLanguageStore();
  const { openModal } = useModal();

  const [isViewingGlobalStats, setIsViewingGlobalStats] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

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
    useAppStore.setState({ selectedProject: null, selectedSession: null });
    setAnalyticsCurrentView("analytics");
    loadGlobalStats();
  }, [loadGlobalStats, setAnalyticsCurrentView]);

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarCollapsed(prev => !prev);
  }, []);

  // Project grouping (worktree or directory-based)
  const groupingMode = getEffectiveGroupingMode();
  const { groups: worktreeGroups, ungrouped: ungroupedProjects } = getGroupedProjects();
  const { groups: directoryGroups } = getDirectoryGroupedProjects();


  // Set grouping mode directly
  const handleGroupingModeChange = useCallback((newMode: GroupingMode) => {
    updateUserSettings({
      groupingMode: newMode,
      // Legacy support: keep worktreeGrouping in sync
      worktreeGrouping: newMode === "worktree",
      worktreeGroupingUserSet: true,
    });
  }, [updateUserSettings]);

  const handleSessionSelect = async (session: ClaudeSession) => {
    setIsViewingGlobalStats(false);
    setAnalyticsCurrentView("messages");

    // 글로벌 통계에서 돌아올 때 세션의 프로젝트를 복원
    const currentProject = useAppStore.getState().selectedProject;
    if (!currentProject || currentProject.name !== session.project_name) {
      const project = projects.find((p) => p.name === session.project_name);
      if (project) {
        await selectProject(project);
      }
    }

    await selectSession(session);
  };

  useEffect(() => {
    const initialize = async () => {
      try {
        await loadLanguage();
      } catch (error) {
        console.error("Failed to load language:", error);
      } finally {
        await initializeApp();
      }
    };
    initialize();
  }, [initializeApp, loadLanguage]);

  // Restore messages when switching back to messages view with empty messages
  useEffect(() => {
    if (!computed.isMessagesView) return;
    const { selectedSession: session, messages: msgs } = useAppStore.getState();
    if (session != null && msgs.length === 0) {
      void (async () => {
        try {
          await selectSession(session);
        } catch (error) {
          console.error("Failed to restore session messages:", error);
        }
      })();
    }
  }, [computed.isMessagesView, selectSession]);

  const handleTokenStatClick = useCallback((stats: SessionTokenStats) => {
    const session = sessions.find(s => s.session_id === stats.session_id);

    if (session) {
      handleSessionSelect(session);
    } else {
      console.warn("Session not found in loaded list:", stats.session_id);
    }
  }, [sessions, handleSessionSelect]);

  useEffect(() => {
    const handleLanguageChange = (lng: string) => {
      const currentLang = lng.startsWith("zh")
        ? lng.includes("TW") || lng.includes("HK")
          ? "zh-TW"
          : "zh-CN"
        : lng.split('common.-')[0];

      if (
        currentLang &&
        currentLang !== language &&
        ["en", "ko", "ja", "zh-CN", "zh-TW"].includes(currentLang)
      ) {
        useLanguageStore.setState({
          language: currentLang as SupportedLanguage,
        });
      }
    };

    i18nInstance.on("languageChanged", handleLanguageChange);
    return () => {
      i18nInstance.off("languageChanged", handleLanguageChange);
    };
  }, [language, i18nInstance]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        openModal("globalSearch");
      }
      // Cmd+Shift+M to toggle navigator
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        toggleNavigator();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openModal, toggleNavigator]);

  const handleProjectSelect = useCallback(
    async (project: ClaudeProject) => {
      const currentProject = useAppStore.getState().selectedProject;

      // 같은 프로젝트를 다시 클릭하면 닫기 (토글)
      if (currentProject?.path === project.path) {
        useAppStore.setState({ selectedProject: null, selectedSession: null, sessions: [] });
        analyticsActions.clearAll();
        return;
      }

      const activeView = useAppStore.getState().analytics.currentView;
      setIsViewingGlobalStats(false);

      // Reset cache for previous project
      analyticsActions.clearAll();

      await selectProject(project);

      // Maintain previous view with new project data
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
    [
      selectProject,
      analyticsActions,
    ]
  );

  // Handle session hover for "skim to preview" in board view
  const handleSessionHover = useCallback((session: ClaudeSession) => {
    // Only if we are in Board View
    if (computed.isBoardView) {
      // Just update the selected session pointer without triggering view changes or full loadings
      // This assumes SessionBoard reacts to store's selectedSession
      useAppStore.getState().setSelectedSession(session);
    }
  }, [computed.isBoardView]);

  // Error State
  if (error && error.type !== AppErrorType.CLAUDE_FOLDER_NOT_FOUND) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-md mx-auto p-8">
          <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-xl font-semibold text-foreground mb-2">
            {t('common.errorOccurred')}
          </h1>
          <p className="text-sm text-muted-foreground mb-6">{error.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="action-btn primary"
          >
            {t('common.retry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="h-screen flex flex-col bg-background">
        {/* Header */}
        <Header />

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <ProjectTree
            projects={projects}
            sessions={sessions}
            selectedProject={selectedProject}
            selectedSession={selectedSession}
            onProjectSelect={handleProjectSelect}
            onSessionSelect={handleSessionSelect}
            onSessionHover={handleSessionHover}
            onGlobalStatsClick={handleGlobalStatsClick}
            isLoading={isLoadingProjects || isLoadingSessions}
            isViewingGlobalStats={isViewingGlobalStats}
            width={isSidebarCollapsed ? undefined : sidebarWidth}
            isResizing={isSidebarResizing}
            onResizeStart={handleSidebarResizeStart}
            groupingMode={groupingMode}
            worktreeGroups={worktreeGroups}
            directoryGroups={directoryGroups}
            ungroupedProjects={ungroupedProjects}
            onGroupingModeChange={handleGroupingModeChange}
            onHideProject={hideProject}
            onUnhideProject={unhideProject}
            isProjectHidden={isProjectHidden}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={handleToggleSidebar}
          />

          {/* Main Content Area */}
          <main className="flex-1 flex flex-col min-w-0 bg-background">
            {/* Content Header for non-message views */}
            {(computed.isTokenStatsView ||
              computed.isAnalyticsView ||
              computed.isRecentEditsView ||
              computed.isSettingsView ||
              computed.isBoardView ||
              isViewingGlobalStats) && (
              <div className="px-6 py-4 border-b border-border/50 bg-card/50">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
                    {isViewingGlobalStats ? (
                      <Database className="w-5 h-5 text-accent" />
                    ) : computed.isSettingsView ? (
                      <Settings className="w-5 h-5 text-accent" />
                    ) : computed.isAnalyticsView ? (
                      <BarChart3 className="w-5 h-5 text-accent" />
                    ) : computed.isRecentEditsView ? (
                      <FileEdit className="w-5 h-5 text-accent" />
                    ) : computed.isBoardView ? (
                      <MessageSquare className="w-5 h-5 text-accent" />
                    ) : (
                      <Coins className="w-5 h-5 text-accent" />
                    )}
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      {isViewingGlobalStats
                        ? t("analytics.globalOverview")
                        : computed.isSettingsView
                        ? t("settingsManager.title")
                        : computed.isAnalyticsView
                        ? t("analytics.dashboard")
                        : computed.isRecentEditsView
                        ? t("recentEdits.title")
                        : computed.isBoardView
                        ? "Session Board"
                        : t('messages.tokenStats.title')}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {isViewingGlobalStats
                        ? t("analytics.globalOverviewDescription")
                        : computed.isSettingsView
                        ? t("settingsManager.description")
                        : computed.isRecentEditsView
                        ? t("recentEdits.description")
                        : computed.isBoardView
                        ? "Comparative overview of different sessions"
                        : selectedSession?.summary ||
                          t("session.summaryNotFound")}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-hidden">
              {computed.isSettingsView ? (
                <div className="h-full flex flex-col p-6">
                  <SettingsManager
                    projectPath={selectedProject?.actual_path}
                    className="flex-1 min-h-0"
                  />
                </div>
              ) : computed.isBoardView ? (
                <SessionBoard />
              ) : computed.isRecentEditsView ? (
                <OverlayScrollbarsComponent
                  className="h-full"
                  options={{ scrollbars: { theme: "os-theme-custom", autoHide: "leave" } }}
                >
                  <RecentEditsViewer
                    recentEdits={analyticsState.recentEdits}
                    pagination={analyticsState.recentEditsPagination}
                    onLoadMore={() => selectedProject && loadMoreRecentEdits(selectedProject.path)}
                    isLoading={analyticsState.isLoadingRecentEdits}
                    error={analyticsState.recentEditsError}
                    initialSearchQuery={analyticsState.recentEditsSearchQuery}
                  />
                </OverlayScrollbarsComponent>
              ) : computed.isAnalyticsView || isViewingGlobalStats ? (
                <OverlayScrollbarsComponent
                  className="h-full"
                  options={{ scrollbars: { theme: "os-theme-custom", autoHide: "leave" } }}
                >
                  <AnalyticsDashboard isViewingGlobalStats={isViewingGlobalStats} />
                </OverlayScrollbarsComponent>
              ) : computed.isTokenStatsView ? (
                <OverlayScrollbarsComponent
                  className="h-full"
                  options={{ scrollbars: { theme: "os-theme-custom", autoHide: "leave" } }}
                >
                  <div className="p-6">
                    <TokenStatsViewer
                      title={t('messages.tokenStats.title')}
                      sessionStats={sessionTokenStats}
                      projectStats={projectTokenStats}
                      pagination={projectTokenStatsPagination}
                      onLoadMore={() => selectedProject && loadMoreProjectTokenStats(selectedProject.path)}
                      isLoading={isLoadingTokenStats}
                      dateFilter={dateFilter}
                      setDateFilter={setDateFilter}
                      onSessionClick={handleTokenStatClick}
                    />
                  </div>
                </OverlayScrollbarsComponent>
              ) : selectedSession ? (
                <div className="flex h-full overflow-hidden">
                  <div className="flex-1 min-w-0">
                    <MessageViewer
                      messages={messages}
                      isLoading={isLoading}
                      selectedSession={selectedSession}
                      sessionSearch={sessionSearch}
                      onSearchChange={setSessionSearchQuery}
                      onFilterTypeChange={setSearchFilterType}
                      onClearSearch={clearSessionSearch}
                      onNextMatch={goToNextMatch}
                      onPrevMatch={goToPrevMatch}
                      onBack={() => analyticsActions.switchToBoard()}
                    />
                  </div>
                  <MessageNavigator
                    messages={messages}
                    width={navigatorWidth}
                    isResizing={isNavigatorResizing}
                    onResizeStart={handleNavigatorResizeStart}
                    isCollapsed={!isNavigatorOpen}
                    onToggleCollapse={toggleNavigator}
                  />
                </div>
              ) : (
                /* Empty State */
                <div className="h-full flex items-center justify-center">
                  <div className="text-center max-w-sm mx-auto">
                    <div className="w-20 h-20 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-6">
                      <MessageSquare className="w-10 h-10 text-muted-foreground/50" />
                    </div>
                    <h3 className="text-lg font-medium text-foreground mb-2">
                      {t("session.select")}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {t("session.selectDescription")}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </main>
        </div>

        {/* Status Bar */}
        <footer className="h-7 px-4 flex items-center justify-between bg-sidebar border-t border-border/50 text-2xs text-muted-foreground">
          <div className="flex items-center gap-3 font-mono tabular-nums">
            <span>{t("project.count", { count: projects.length })}</span>
            <span className="text-border">•</span>
            <span>{t("session.count", { count: sessions.length })}</span>
            {selectedSession && computed.isMessagesView && (
              <>
                <span className="text-border">•</span>
                <span>{t("message.count", { count: messages.length })}</span>
              </>
            )}
          </div>

          {(isLoading ||
            isLoadingProjects ||
            isLoadingSessions ||
            isLoadingMessages ||
            computed.isAnyLoading) && (
              <div className="flex items-center gap-1.5">
                <LoadingSpinner size="xs" variant="muted" />
                <span>
                  {computed.isAnyLoading && t("status.loadingStats")}
                  {isLoadingProjects && t("status.scanning")}
                  {isLoadingSessions && t("status.loadingSessions")}
                  {isLoadingMessages && t("status.loadingMessages")}
                  {isLoading && t("status.initializing")}
                </span>
              </div>
            )}
        </footer>

        {/* Update Manager */}
        <SimpleUpdateManager />
      </div>

      {/* Modals */}
      <ModalContainer />
    </TooltipProvider>
  );
}

export default App;
