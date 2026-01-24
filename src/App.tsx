import { useCallback, useEffect, useState } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { ProjectTree } from "./components/ProjectTree";
import { MessageViewer } from "./components/MessageViewer";
import { TokenStatsViewer } from "./components/TokenStatsViewer";
import { AnalyticsDashboard } from "./components/AnalyticsDashboard";
import { RecentEditsViewer } from "./components/RecentEditsViewer";
import { SimpleUpdateManager } from "./components/SimpleUpdateManager";
import { useAppStore } from "./store/useAppStore";
import { useAnalytics } from "./hooks/useAnalytics";
import { useResizablePanel } from "./hooks/useResizablePanel";
import { track, TrackingEvents } from "./hooks/useEventTracking";

import { useTranslation } from "react-i18next";
import { AppErrorType, type ClaudeSession, type ClaudeProject } from "./types";
import { AlertTriangle, MessageSquare, Database, BarChart3, FileEdit, Coins } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading";
import { useLanguageStore } from "./store/useLanguageStore";
import { type SupportedLanguage } from "./i18n";

import "./App.css";
import { Header } from "@/layouts/Header/Header";
import { ModalContainer } from "./layouts/Header/SettingDropdown/ModalContainer";

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
  } = useAppStore();

  const {
    state: analyticsState,
    actions: analyticsActions,
    computed,
  } = useAnalytics();

  const { t, i18n: i18nInstance } = useTranslation();
      const { language, loadLanguage } = useLanguageStore();

  const [isViewingGlobalStats, setIsViewingGlobalStats] = useState(false);

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

  const handleGlobalStatsClick = useCallback(() => {
    setIsViewingGlobalStats(true);
    useAppStore.setState({ selectedProject: null, selectedSession: null });
    setAnalyticsCurrentView("analytics");
    loadGlobalStats();
  }, [loadGlobalStats, setAnalyticsCurrentView]);

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
        // Track app launch (anonymous)
        track(TrackingEvents.APP_LAUNCHED);
      }
    };
    initialize();
  }, [initializeApp, loadLanguage]);

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

  const handleProjectSelect = useCallback(
    async (project: ClaudeProject) => {
      const currentProject = useAppStore.getState().selectedProject;

      // 같은 프로젝트를 다시 클릭하면 닫기 (토글)
      if (currentProject?.path === project.path) {
        useAppStore.setState({ selectedProject: null, selectedSession: null, sessions: [] });
        analyticsActions.clearAll();
        return;
      }

      const wasTokenStatsOpen = computed.isTokenStatsView;
      setIsViewingGlobalStats(false);

      // 이전 프로젝트의 캐시 초기화
      analyticsActions.clearAll();

      await selectProject(project);

      // 이전 뷰 유지하면서 새 프로젝트 데이터 로드
      if (wasTokenStatsOpen) {
        try {
          await analyticsActions.switchToTokenStats();
        } catch (error) {
          console.error("Failed to auto-load token stats:", error);
        }
      } else {
        try {
          await analyticsActions.switchToAnalytics();
        } catch (error) {
          console.error("Failed to auto-load analytics:", error);
        }
      }
    },
    [
      computed.isTokenStatsView,
      selectProject,
      analyticsActions,
    ]
  );

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
    <>
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
            onGlobalStatsClick={handleGlobalStatsClick}
            isLoading={isLoadingProjects || isLoadingSessions}
            isViewingGlobalStats={isViewingGlobalStats}
            width={sidebarWidth}
            isResizing={isSidebarResizing}
            onResizeStart={handleSidebarResizeStart}
          />

          {/* Main Content Area */}
          <main className="flex-1 flex flex-col min-w-0 bg-background">
            {/* Content Header for non-message views */}
            {(computed.isTokenStatsView ||
              computed.isAnalyticsView ||
              computed.isRecentEditsView ||
              isViewingGlobalStats) && (
              <div className="px-6 py-4 border-b border-border/50 bg-card/50">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
                    {isViewingGlobalStats ? (
                      <Database className="w-5 h-5 text-accent" />
                    ) : computed.isAnalyticsView ? (
                      <BarChart3 className="w-5 h-5 text-accent" />
                    ) : computed.isRecentEditsView ? (
                      <FileEdit className="w-5 h-5 text-accent" />
                    ) : (
                      <Coins className="w-5 h-5 text-accent" />
                    )}
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      {isViewingGlobalStats
                        ? t("analytics.globalOverview")
                        : computed.isAnalyticsView
                        ? t("analytics.dashboard")
                        : computed.isRecentEditsView
                        ? t("recentEdits.title")
                        : t('messages.tokenStats.title')}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {isViewingGlobalStats
                        ? t("analytics.globalOverviewDescription")
                        : computed.isRecentEditsView
                        ? t("recentEdits.description")
                        : selectedSession?.summary ||
                          t("session.summaryNotFound")}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-hidden">
              {computed.isRecentEditsView ? (
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
                    />
                  </div>
                </OverlayScrollbarsComponent>
              ) : selectedSession ? (
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
                />
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
    </>
  );
}

export default App;
