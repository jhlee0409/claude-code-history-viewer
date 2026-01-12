import { useCallback, useEffect, useState } from "react";
import { ProjectTree } from "./components/ProjectTree";
import { MessageViewer } from "./components/MessageViewer";
import { TokenStatsViewer } from "./components/TokenStatsViewer";
import { AnalyticsDashboard } from "./components/AnalyticsDashboard";
import { SimpleUpdateManager } from "./components/SimpleUpdateManager";
import { useAppStore } from "./store/useAppStore";
import { useAnalytics } from "./hooks/useAnalytics";

import { useTranslation } from "react-i18next";
import { AppErrorType, type ClaudeSession, type ClaudeProject } from "./types";
import { AlertTriangle, Loader2, MessageSquare } from "lucide-react";
import { useLanguageStore } from "./store/useLanguageStore";
import { type SupportedLanguage } from "./i18n";

import "./App.css";
import { cn } from "./utils/cn";
import { COLORS } from "./constants/colors";
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
  void _analyticsActions; // Reserved for future use

  const { t, i18n: i18nInstance } = useTranslation("common");
  const { t: tComponents } = useTranslation("components");
  const { t: tMessages } = useTranslation("messages");
  const { language, loadLanguage } = useLanguageStore();

  // Track if viewing global stats
  const [isViewingGlobalStats, setIsViewingGlobalStats] = useState(false);

  // Global Stats 버튼 클릭 핸들러
  const handleGlobalStatsClick = useCallback(() => {
    setIsViewingGlobalStats(true);
    // Clear selected project and session to show global view
    useAppStore.setState({ selectedProject: null, selectedSession: null });
    // Switch to analytics view to show global dashboard
    setAnalyticsCurrentView("analytics");
    loadGlobalStats();
  }, [loadGlobalStats, setAnalyticsCurrentView]);

  // 세션 선택 시 메시지 뷰로 전환 (기본값)
  const handleSessionSelect = async (session: ClaudeSession) => {
    // Switch to messages view when selecting a session
    setAnalyticsCurrentView("messages");
    await selectSession(session);
  };

  useEffect(() => {
    // 언어 설정 로드 후 앱 초기화
    const initialize = async () => {
      try {
        await loadLanguage();
      } catch (error) {
        console.error("Failed to load language:", error);
      } finally {
        // 기본 언어로 앱 초기화 진행
        await initializeApp();
      }
    };
    initialize();
  }, [initializeApp, loadLanguage]);

  // i18n 언어 변경 감지
  useEffect(() => {
    const handleLanguageChange = (lng: string) => {
      // 스토어의 언어와 다르면 업데이트
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

  // 프로젝트 선택 핸들러 (분석 상태 초기화 포함)
  const handleProjectSelect = useCallback(
    async (project: ClaudeProject) => {
      const wasTokenStatsOpen = computed.isTokenStatsView;

      // Clear global stats view flag when selecting a project
      setIsViewingGlobalStats(false);

      // 프로젝트 선택
      await selectProject(project);

      // 토큰 통계 탭이 열려있었다면 유지, 아니면 기본적으로 분석 대시보드 표시
      if (wasTokenStatsOpen) {
        try {
          setAnalyticsCurrentView("tokenStats");
          await loadProjectTokenStats(project.path);
        } catch (error) {
          console.error(
            "Failed to auto-load token stats for new project:",
            error
          );
        }
      } else {
        // Always show analytics dashboard when selecting a project
        try {
          // Load analytics data using the project parameter directly (not from state)
          setAnalyticsCurrentView("analytics");
          setAnalyticsLoadingProjectSummary(true);
          const summary = await loadProjectStatsSummary(project.path);
          setAnalyticsProjectSummary(summary);
        } catch (error) {
          console.error("Failed to auto-load analytics for new project:", error);
          setAnalyticsProjectSummary(null); // Clear stale data
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

  // Show folder selector if needed

  if (error && error.type !== AppErrorType.CLAUDE_FOLDER_NOT_FOUND) {
    return (
      <div
        className={cn(
          "h-screen flex items-center justify-center",
          COLORS.semantic.error.bg
        )}
      >
        <div className="text-center">
          <div className="mb-4">
            <AlertTriangle
              className={cn("w-12 h-12 mx-auto", COLORS.semantic.error.icon)}
            />
          </div>
          <h1
            className={cn(
              "text-xl font-semibold mb-2",
              COLORS.semantic.error.text
            )}
          >
            {t("errorOccurred")}
          </h1>
          <p className={cn("mb-4", COLORS.semantic.error.text)}>
            {error.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            className={cn(
              "px-4 py-2 rounded-lg transition-colors",
              COLORS.semantic.error.bg,
              COLORS.semantic.error.text
            )}
          >
            {t("retry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className={cn("h-screen flex flex-col", COLORS.ui.background.primary)}
      >
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
          />

          {/* Main Content Area */}
          <div className="w-full flex flex-col relative">
            {/* Content Header - Only for Analytics/Token Stats views (Messages view has its own toolbar) */}
            {(computed.isTokenStatsView ||
              computed.isAnalyticsView ||
              isViewingGlobalStats) && (
              <div
                className={cn(
                  "p-4 border-b",
                  COLORS.ui.background.secondary,
                  COLORS.ui.border.light
                )}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h2
                      className={cn(
                        "text-lg font-semibold",
                        COLORS.ui.text.primary
                      )}
                    >
                      {isViewingGlobalStats
                        ? tComponents("analytics.globalOverview")
                        : computed.isAnalyticsView
                        ? tComponents("analytics.dashboard")
                        : tMessages("tokenStats.title")}
                    </h2>
                    <span className={cn("text-sm", COLORS.ui.text.secondary)}>
                      {isViewingGlobalStats
                        ? tComponents("analytics.globalOverviewDescription")
                        : selectedSession?.summary ||
                          tComponents("session.summaryNotFound")}
                    </span>
                    {computed.isTokenStatsView && (
                      <p className={cn("text-sm mt-1", COLORS.ui.text.muted)}>
                        {tComponents("analytics.tokenUsageDetailed")}
                      </p>
                    )}
                    {computed.isAnalyticsView && !isViewingGlobalStats && (
                      <p className={cn("text-sm mt-1", COLORS.ui.text.muted)}>
                        {selectedSession
                          ? tComponents("analytics.projectSessionAnalysis")
                          : tComponents("analytics.projectOverallAnalysis")}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-hidden">
              {computed.isAnalyticsView || isViewingGlobalStats ? (
                <div className="h-full overflow-y-auto">
                  <AnalyticsDashboard isViewingGlobalStats={isViewingGlobalStats} />
                </div>
              ) : computed.isTokenStatsView ? (
                <div className="h-full overflow-y-auto p-6 space-y-8">
                  <TokenStatsViewer
                    title={tMessages("tokenStats.title")}
                    sessionStats={sessionTokenStats}
                    projectStats={projectTokenStats}
                  />
                </div>
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
                <div className="h-full flex items-center justify-center">
                  <div className={cn("text-center", COLORS.ui.text.muted)}>
                    <MessageSquare
                      className={cn(
                        "w-16 h-16 mx-auto mb-4",
                        COLORS.ui.text.disabledDark
                      )}
                    />
                    <p className="text-lg mb-2">
                      {tComponents("session.select")}
                    </p>
                    <p className="text-sm">
                      {tComponents("session.selectDescription")}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Status Bar */}
        <div
          className={cn(
            "px-6 py-2 border-t",
            COLORS.ui.background.secondary,
            COLORS.ui.border.light
          )}
        >
          <div
            className={cn(
              "flex items-center justify-between text-xs",
              COLORS.ui.text.muted
            )}
          >
            <div className="flex items-center space-x-4">
              <span>
                {tComponents("project.count", { count: projects.length })}
              </span>
              <span>
                {tComponents("session.count", { count: sessions.length })}
              </span>
              {selectedSession && computed.isMessagesView && (
                <span>
                  {tComponents("message.count", {
                    count: messages.length,
                  })}
                </span>
              )}
              {computed.isTokenStatsView && sessionTokenStats && (
                <span>
                  {tComponents("analytics.currentSessionTokens", {
                    count: sessionTokenStats.total_tokens,
                  })}
                </span>
              )}
              {computed.isAnalyticsView && analyticsState.projectSummary && (
                <span>
                  {tComponents("analytics.projectTokens", {
                    count: analyticsState.projectSummary.total_tokens,
                  })}
                </span>
              )}
            </div>

            <div className="flex items-center space-x-2">
              {(isLoading ||
                isLoadingProjects ||
                isLoadingSessions ||
                isLoadingMessages ||
                computed.isAnyLoading) && (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    {computed.isAnyLoading &&
                      tComponents("status.loadingStats")}
                    {isLoadingProjects && tComponents("status.scanning")}
                    {isLoadingSessions && tComponents("status.loadingSessions")}
                    {isLoadingMessages && tComponents("status.loadingMessages")}
                    {isLoading && tComponents("status.initializing")}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        {/* Simple Update Manager */}
        <SimpleUpdateManager />
      </div>

      {/* Modals */}
      <ModalContainer />
    </>
  );
}

export default App;
