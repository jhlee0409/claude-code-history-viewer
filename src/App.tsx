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

import { useTranslation } from "react-i18next";
import { AppErrorType, type ClaudeSession, type ClaudeProject } from "./types";
import { AlertTriangle, Loader2, MessageSquare, Database, BarChart3, FileEdit, Coins } from "lucide-react";
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
    error,
    sessionTokenStats,
    projectTokenStats,
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
    setAnalyticsLoadingProjectSummary,
    loadProjectStatsSummary,
    setAnalyticsProjectSummary,
    setAnalyticsProjectSummaryError,
    loadProjectTokenStats,
  } = useAppStore();

  const {
    state: analyticsState,
    actions: _analyticsActions,
    computed,
  } = useAnalytics();
  void _analyticsActions;

  const { t, i18n: i18nInstance } = useTranslation("common");
  const { t: tComponents } = useTranslation("components");
  const { t: tMessages } = useTranslation("messages");
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

  useEffect(() => {
    const handleLanguageChange = (lng: string) => {
      const currentLang = lng.startsWith("zh")
        ? lng.includes("TW") || lng.includes("HK")
          ? "zh-TW"
          : "zh-CN"
        : lng.split("-")[0];

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
      const wasTokenStatsOpen = computed.isTokenStatsView;
      setIsViewingGlobalStats(false);
      await selectProject(project);

      if (wasTokenStatsOpen) {
        try {
          setAnalyticsCurrentView("tokenStats");
          await loadProjectTokenStats(project.path);
        } catch (error) {
          console.error("Failed to auto-load token stats:", error);
        }
      } else {
        try {
          setAnalyticsCurrentView("analytics");
          setAnalyticsLoadingProjectSummary(true);
          const summary = await loadProjectStatsSummary(project.path);
          setAnalyticsProjectSummary(summary);
        } catch (error) {
          console.error("Failed to auto-load analytics:", error);
          setAnalyticsProjectSummary(null);
          setAnalyticsProjectSummaryError(
            error instanceof Error ? error.message : "Failed to load project stats"
          );
        } finally {
          setAnalyticsLoadingProjectSummary(false);
        }
      }
    },
    [
      computed.isTokenStatsView,
      selectProject,
      setAnalyticsCurrentView,
      loadProjectTokenStats,
      setAnalyticsLoadingProjectSummary,
      loadProjectStatsSummary,
      setAnalyticsProjectSummary,
      setAnalyticsProjectSummaryError,
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
            {t("errorOccurred")}
          </h1>
          <p className="text-sm text-muted-foreground mb-6">{error.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="action-btn primary"
          >
            {t("retry")}
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
                        ? tComponents("analytics.globalOverview")
                        : computed.isAnalyticsView
                        ? tComponents("analytics.dashboard")
                        : computed.isRecentEditsView
                        ? tComponents("recentEdits.title")
                        : tMessages("tokenStats.title")}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {isViewingGlobalStats
                        ? tComponents("analytics.globalOverviewDescription")
                        : computed.isRecentEditsView
                        ? tComponents("recentEdits.description")
                        : selectedSession?.summary ||
                          tComponents("session.summaryNotFound")}
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
                      title={tMessages("tokenStats.title")}
                      sessionStats={sessionTokenStats}
                      projectStats={projectTokenStats}
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
                      {tComponents("session.select")}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {tComponents("session.selectDescription")}
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
            <span>{tComponents("project.count", { count: projects.length })}</span>
            <span className="text-border">•</span>
            <span>{tComponents("session.count", { count: sessions.length })}</span>
            {selectedSession && computed.isMessagesView && (
              <>
                <span className="text-border">•</span>
                <span>{tComponents("message.count", { count: messages.length })}</span>
              </>
            )}
          </div>

          {(isLoading ||
            isLoadingProjects ||
            isLoadingSessions ||
            isLoadingMessages ||
            computed.isAnyLoading) && (
            <div className="flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>
                {computed.isAnyLoading && tComponents("status.loadingStats")}
                {isLoadingProjects && tComponents("status.scanning")}
                {isLoadingSessions && tComponents("status.loadingSessions")}
                {isLoadingMessages && tComponents("status.loadingMessages")}
                {isLoading && tComponents("status.initializing")}
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
