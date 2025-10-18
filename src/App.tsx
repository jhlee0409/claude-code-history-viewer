import { useEffect } from "react";
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
    pagination,
    isLoading,
    isLoadingProjects,
    isLoadingSessions,
    isLoadingMessages,
    error,
    sessionTokenStats,
    projectTokenStats,
    initializeApp,
    selectProject,
    selectSession,
    loadMoreMessages,
  } = useAppStore();

  const {
    state: analyticsState,
    actions: analyticsActions,
    computed,
  } = useAnalytics();

  const { t, i18n: i18nInstance } = useTranslation("common");
  const { t: tComponents } = useTranslation("components");
  const { t: tMessages } = useTranslation("messages");
  const { language, loadLanguage } = useLanguageStore();

  // 세션 선택 시 현재 뷰 유지 (useAnalytics hook에서 자동 데이터 업데이트 처리)
  const handleSessionSelect = async (session: ClaudeSession) => {
    await selectSession(session);
    // useAnalytics hook의 useEffect에서 자동으로 데이터 업데이트 처리
  };

  useEffect(() => {
    // 언어 설정 로드 후 앱 초기화
    loadLanguage()
      .then(() => {
        initializeApp();
      })
      .catch((error) => {
        console.error("Failed to load language:", error);
        // 기본 언어로 앱 초기화 진행
        initializeApp();
      });
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
  const handleProjectSelect = async (project: ClaudeProject) => {
    const wasAnalyticsOpen = computed.isAnalyticsView;
    const wasTokenStatsOpen = computed.isTokenStatsView;

    // 기존 분석 데이터 초기화
    if (!computed.isMessagesView) {
      analyticsActions.switchToMessages();
    }

    // 프로젝트 선택
    await selectProject(project);

    // 분석 탭이 열려있었다면 새 프로젝트의 분석 데이터 자동 로드
    if (wasAnalyticsOpen) {
      try {
        await analyticsActions.switchToAnalytics();
      } catch (error) {
        console.error("Failed to auto-load analytics for new project:", error);
      }
    }

    // 토큰 통계 탭이 열려있었다면 새 프로젝트의 토큰 통계 자동 로드
    if (wasTokenStatsOpen) {
      try {
        await analyticsActions.switchToTokenStats();
      } catch (error) {
        console.error(
          "Failed to auto-load token stats for new project:",
          error
        );
      }
    }
  };

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
            isLoading={isLoadingProjects || isLoadingSessions}
          />

          {/* Main Content Area */}
          <div className="w-full flex flex-col relative">
            {/* Content Header */}
            {(selectedSession ||
              computed.isTokenStatsView ||
              computed.isAnalyticsView) && (
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
                      {computed.isAnalyticsView
                        ? tComponents("analytics.dashboard")
                        : computed.isTokenStatsView
                        ? tMessages("tokenStats.title")
                        : tComponents("message.conversation")}
                    </h2>
                    <span className={cn("text-sm", COLORS.ui.text.secondary)}>
                      {selectedSession?.summary ||
                        tComponents("session.summaryNotFound")}
                    </span>
                    {computed.isMessagesView && selectedSession && (
                      <div>
                        <p className={cn("text-sm mt-1", COLORS.ui.text.muted)}>
                          {pagination.totalCount >= messages.length &&
                            ` ${pagination.totalCount || "-"} ${tComponents("message.count", { count: pagination.totalCount })} • `}
                          {selectedSession.has_tool_use
                            ? tComponents("tools.toolUsed")
                            : tComponents("tools.generalConversation")}
                          {selectedSession.has_errors &&
                            ` • ${tComponents("tools.errorOccurred")}`}
                        </p>
                      </div>
                    )}
                    {computed.isTokenStatsView && (
                      <p className={cn("text-sm mt-1", COLORS.ui.text.muted)}>
                        {tComponents("analytics.tokenUsageDetailed")}
                      </p>
                    )}
                    {computed.isAnalyticsView && (
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
              {computed.isAnalyticsView ? (
                <div className="h-full overflow-y-auto">
                  <AnalyticsDashboard />
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
                  pagination={pagination}
                  isLoading={isLoading}
                  selectedSession={selectedSession}
                  onLoadMore={loadMoreMessages}
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
                  {tComponents("message.countWithTotal", {
                    current: messages.length,
                    total: pagination.totalCount || messages.length,
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
