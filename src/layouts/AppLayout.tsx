import React from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  MessageSquare,
  Database,
  BarChart3,
  FileEdit,
  Coins,
  Settings,
  Archive,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/loading";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ProjectTree } from "@/components/ProjectTree";
import { MessageViewer } from "@/components/MessageViewer";
import { MessageNavigator } from "@/components/MessageNavigator";
import { TokenStatsViewer } from "@/components/TokenStatsViewer";
import { AnalyticsDashboard } from "@/components/AnalyticsDashboard";
import { RecentEditsViewer } from "@/components/RecentEditsViewer";
import { SimpleUpdateManager } from "@/components/SimpleUpdateManager";
import { SettingsManager } from "@/components/SettingsManager";
import { SessionBoard } from "@/components/SessionBoard/SessionBoard";
import { ArchiveManager } from "@/components/ArchiveManager";
import { BottomTabBar } from "@/components/mobile/BottomTabBar";
import { MobileNavigatorSheet } from "@/components/mobile/MobileNavigatorSheet";
import { Header } from "@/layouts/Header/Header";
import { ModalContainer } from "@/layouts/Header/SettingDropdown/ModalContainer";
import { DesktopOnly } from "@/contexts/platform";
import {
  AppErrorType,
  type ClaudeMessage,
  type ClaudeProject,
  type ClaudeSession,
  type GroupingMode,
  type SessionTokenStats,
  type DateFilter,
  type ProjectStatsSummary,
  type AppError,
} from "@/types";
import type { UseAnalyticsReturn } from "@/types/analytics";
import type { UseUpdaterReturn } from "@/hooks/useUpdater";
import type { SearchState, SearchFilterType } from "@/store/slices/types";
import type { WorktreeGroup, DirectoryGroup } from "@/utils/worktreeUtils";
import type { ProjectTokenStatsPagination } from "@/store/slices/messageSlice";

export interface AppLayoutProps {
  // Store state
  projects: ClaudeProject[];
  sessions: ClaudeSession[];
  selectedProject: ClaudeProject | null;
  selectedSession: ClaudeSession | null;
  messages: ClaudeMessage[];
  isLoading: boolean;
  isLoadingProjects: boolean;
  isLoadingSessions: boolean;
  isLoadingMessages: boolean;
  isLoadingTokenStats: boolean;
  error: AppError | null;
  sessionTokenStats: SessionTokenStats | null;
  sessionConversationTokenStats: SessionTokenStats | null;
  projectTokenStats: SessionTokenStats[];
  projectConversationTokenStats: SessionTokenStats[];
  projectTokenStatsSummary: ProjectStatsSummary | null;
  projectConversationTokenStatsSummary: ProjectStatsSummary | null;
  projectTokenStatsPagination: ProjectTokenStatsPagination;
  sessionSearch: SearchState;
  dateFilter: DateFilter;

  // Analytics
  analyticsState: UseAnalyticsReturn["state"];
  analyticsActions: UseAnalyticsReturn["actions"];
  computed: UseAnalyticsReturn["computed"];

  // Updater
  updater: UseUpdaterReturn;
  appVersion: string;

  // Platform
  isDesktop: boolean;
  isMobile: boolean;

  // Local state
  isViewingGlobalStats: boolean;
  isSidebarCollapsed: boolean;
  isMobileSidebarOpen: boolean;
  setIsMobileSidebarOpen: (open: boolean) => void;
  setIsViewingGlobalStats: (value: boolean) => void;

  // Sidebar resize
  sidebarWidth: number;
  isSidebarResizing: boolean;
  handleSidebarResizeStart: (e: React.MouseEvent<HTMLElement>) => void;

  // Navigator resize
  navigatorWidth: number;
  isNavigatorResizing: boolean;
  handleNavigatorResizeStart: (e: React.MouseEvent<HTMLElement>) => void;
  isNavigatorOpen: boolean;
  toggleNavigator: () => void;

  // Grouping
  groupingMode: GroupingMode;
  worktreeGroups: WorktreeGroup[];
  directoryGroups: DirectoryGroup[];
  ungroupedProjects: ClaudeProject[];

  // Callbacks
  handleProjectSelect: (project: ClaudeProject) => void;
  handleSessionSelect: (session: ClaudeSession) => void;
  handleSessionHover: (session: ClaudeSession) => void;
  handleGlobalStatsClick: () => void;
  handleToggleSidebar: () => void;
  handleGroupingModeChange: (mode: GroupingMode) => void;
  handleTokenStatClick: (stats: SessionTokenStats) => void;
  hideProject: (projectPath: string) => Promise<void>;
  unhideProject: (projectPath: string) => Promise<void>;
  isProjectHidden: (projectPath: string) => boolean;
  setDateFilter: (filter: { start: Date | null; end: Date | null }) => void;
  setSessionSearchQuery: (query: string) => void;
  setSearchFilterType: (type: SearchFilterType) => void;
  clearSessionSearch: () => void;
  goToNextMatch: () => void;
  goToPrevMatch: () => void;
  loadMoreProjectTokenStats: (path: string) => Promise<void>;
  loadMoreRecentEdits: (path: string) => Promise<void>;

  // Computed
  globalOverviewDescription: string;
  liveStatusMessage: string;
}

export const AppLayout: React.FC<AppLayoutProps> = (props) => {
  const { t } = useTranslation();
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
    dateFilter,
    analyticsState,
    analyticsActions,
    computed,
    updater,
    appVersion,
    isDesktop,
    isMobile,
    isViewingGlobalStats,
    isSidebarCollapsed,
    isMobileSidebarOpen,
    setIsMobileSidebarOpen,
    setIsViewingGlobalStats,
    sidebarWidth,
    isSidebarResizing,
    handleSidebarResizeStart,
    navigatorWidth,
    isNavigatorResizing,
    handleNavigatorResizeStart,
    isNavigatorOpen,
    toggleNavigator,
    groupingMode,
    worktreeGroups,
    directoryGroups,
    ungroupedProjects,
    handleProjectSelect,
    handleSessionSelect,
    handleSessionHover,
    handleGlobalStatsClick,
    handleToggleSidebar,
    handleGroupingModeChange,
    handleTokenStatClick,
    hideProject,
    unhideProject,
    isProjectHidden,
    setDateFilter,
    setSessionSearchQuery,
    setSearchFilterType,
    clearSessionSearch,
    goToNextMatch,
    goToPrevMatch,
    loadMoreProjectTokenStats,
    loadMoreRecentEdits,
    globalOverviewDescription,
    liveStatusMessage,
  } = props;

  // Error State
  if (error && error.type !== AppErrorType.CLAUDE_FOLDER_NOT_FOUND) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-md mx-auto p-8">
          <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-xl font-semibold text-foreground mb-2">
            {t("common.errorOccurred")}
          </h1>
          <p className="text-sm text-muted-foreground mb-6">{error.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="action-btn primary"
          >
            {t("common.retry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="h-screen flex flex-col bg-background">
        <nav
          aria-label={t("common.a11y.skipNavigation", {
            defaultValue: "Skip navigation",
          })}
        >
          <a
            href="#project-explorer"
            className="absolute left-2 top-[-40px] z-[700] rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-all focus:top-2"
          >
            {t("common.a11y.skipToProjects", {
              defaultValue: "Skip to project explorer",
            })}
          </a>
          <a
            href="#main-content"
            className="absolute left-52 top-[-40px] z-[700] rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-all focus:top-2"
          >
            {t("common.a11y.skipToMain", {
              defaultValue: "Skip to main content",
            })}
          </a>
          {!isMobile && isNavigatorOpen && selectedSession && (
            <a
              href="#message-navigator"
              className="absolute left-[23rem] top-[-40px] z-[700] rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-all focus:top-2"
            >
              {t("common.a11y.skipToNavigator", {
                defaultValue: "Skip to message navigator",
              })}
            </a>
          )}
          <a
            href="#app-settings-button"
            className="absolute right-2 top-[-40px] z-[700] rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-all focus:top-2"
          >
            {t("common.a11y.skipToSettings", {
              defaultValue: "Skip to settings",
            })}
          </a>
        </nav>

        {/* Header */}
        <Header
          analyticsActions={analyticsActions}
          analyticsComputed={computed}
          updater={updater}
        />

        {/* Mobile Sidebar Drawer */}
        {isMobile && (
          <Sheet
            open={isMobileSidebarOpen}
            onOpenChange={setIsMobileSidebarOpen}
          >
            <SheetContent
              side="left"
              className="w-[var(--mobile-drawer-width)] p-0"
              showCloseButton={false}
            >
              <SheetTitle className="sr-only">
                {t("common.mobile.openSidebar")}
              </SheetTitle>
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
                groupingMode={groupingMode}
                worktreeGroups={worktreeGroups}
                directoryGroups={directoryGroups}
                ungroupedProjects={ungroupedProjects}
                onGroupingModeChange={handleGroupingModeChange}
                onHideProject={hideProject}
                onUnhideProject={unhideProject}
                isProjectHidden={isProjectHidden}
                onClose={() => setIsMobileSidebarOpen(false)}
                asideId="project-explorer"
              />
            </SheetContent>
          </Sheet>
        )}

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Desktop Sidebar */}
          {!isMobile && (
            <div className="hidden md:block">
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
                asideId="project-explorer"
              />
            </div>
          )}

          {/* Main Content Area */}
          <main
            id="main-content"
            tabIndex={-1}
            className="flex-1 flex flex-col min-w-0 bg-background pb-14 md:pb-0"
          >
            {/* Content Header for non-message views */}
            {(computed.isTokenStatsView ||
              computed.isAnalyticsView ||
              computed.isRecentEditsView ||
              computed.isSettingsView ||
              computed.isBoardView ||
              computed.isArchiveView ||
              (isViewingGlobalStats && !computed.isSettingsView)) && (
              <div className="px-4 py-3 md:px-6 md:py-4 border-b border-border/50 bg-card/50">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
                    {isViewingGlobalStats ? (
                      <Database className="w-5 h-5 text-accent" />
                    ) : computed.isArchiveView ? (
                      <Archive className="w-5 h-5 text-accent" />
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
                        : computed.isArchiveView
                          ? t("archive.title")
                          : computed.isSettingsView
                            ? t("settingsManager.title")
                            : computed.isAnalyticsView
                            ? t("analytics.dashboard")
                            : computed.isRecentEditsView
                              ? t("recentEdits.title")
                              : computed.isBoardView
                                ? t("session.board.title")
                                : t("messages.tokenStats.title")}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {isViewingGlobalStats
                        ? globalOverviewDescription
                        : computed.isArchiveView
                          ? t("archive.description")
                          : computed.isSettingsView
                            ? t("settingsManager.description")
                            : computed.isRecentEditsView
                            ? t("recentEdits.description")
                            : computed.isBoardView
                              ? t(
                                  "session.board.description",
                                  "Comparative overview of different sessions"
                                )
                              : selectedSession?.summary ||
                                t("session.summaryNotFound")}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Mobile Analytics Sub-Nav */}
            {isMobile &&
              selectedProject &&
              !isViewingGlobalStats &&
              (computed.isAnalyticsView ||
                computed.isTokenStatsView ||
                computed.isRecentEditsView) && (
                <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/40 bg-card/30 md:hidden overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => analyticsActions.switchToAnalytics()}
                    className={cn(
                      "shrink-0 flex items-center gap-1.5 px-3 py-2.5 md:py-1.5 rounded-lg text-xs font-medium transition-colors",
                      computed.isAnalyticsView
                        ? "bg-accent/15 text-accent border border-accent/30"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                  >
                    <BarChart3 className="w-3.5 h-3.5" />
                    {t("analytics.dashboard")}
                  </button>
                  <button
                    type="button"
                    onClick={() => analyticsActions.switchToTokenStats()}
                    className={cn(
                      "shrink-0 flex items-center gap-1.5 px-3 py-2.5 md:py-1.5 rounded-lg text-xs font-medium transition-colors",
                      computed.isTokenStatsView
                        ? "bg-accent/15 text-accent border border-accent/30"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                  >
                    <Coins className="w-3.5 h-3.5" />
                    {t("messages.tokenStats.title")}
                  </button>
                  <button
                    type="button"
                    onClick={() => analyticsActions.switchToRecentEdits()}
                    className={cn(
                      "shrink-0 flex items-center gap-1.5 px-3 py-2.5 md:py-1.5 rounded-lg text-xs font-medium transition-colors",
                      computed.isRecentEditsView
                        ? "bg-accent/15 text-accent border border-accent/30"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                  >
                    <FileEdit className="w-3.5 h-3.5" />
                    {t("recentEdits.title")}
                  </button>
                </div>
              )}

            {/* Content */}
            <div className="flex-1 overflow-hidden">
              {computed.isArchiveView ? (
                <div className="h-full flex flex-col p-3 md:p-6">
                  <ArchiveManager
                    className="flex-1 min-h-0"
                  />
                </div>
              ) : computed.isSettingsView ? (
                <div className="h-full flex flex-col p-3 md:p-6">
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
                  options={{
                    scrollbars: {
                      theme: "os-theme-custom",
                      autoHide: "leave",
                    },
                  }}
                >
                  <RecentEditsViewer
                    recentEdits={analyticsState.recentEdits}
                    pagination={analyticsState.recentEditsPagination}
                    onLoadMore={() =>
                      selectedProject &&
                      loadMoreRecentEdits(selectedProject.path)
                    }
                    isLoading={analyticsState.isLoadingRecentEdits}
                    error={analyticsState.recentEditsError}
                    initialSearchQuery={analyticsState.recentEditsSearchQuery}
                  />
                </OverlayScrollbarsComponent>
              ) : computed.isAnalyticsView || isViewingGlobalStats ? (
                <OverlayScrollbarsComponent
                  className="h-full"
                  options={{
                    scrollbars: {
                      theme: "os-theme-custom",
                      autoHide: "leave",
                    },
                  }}
                >
                  <AnalyticsDashboard
                    isViewingGlobalStats={isViewingGlobalStats}
                  />
                </OverlayScrollbarsComponent>
              ) : computed.isTokenStatsView ? (
                <OverlayScrollbarsComponent
                  className="h-full"
                  options={{
                    scrollbars: {
                      theme: "os-theme-custom",
                      autoHide: "leave",
                    },
                  }}
                >
                  <div className="p-3 md:p-6">
                    <TokenStatsViewer
                      title={t("messages.tokenStats.title")}
                      sessionStats={sessionTokenStats}
                      sessionConversationStats={sessionConversationTokenStats}
                      projectStats={projectTokenStats}
                      projectConversationStats={projectConversationTokenStats}
                      projectStatsSummary={projectTokenStatsSummary}
                      projectConversationStatsSummary={
                        projectConversationTokenStatsSummary
                      }
                      providerId={selectedProject?.provider ?? "claude"}
                      pagination={projectTokenStatsPagination}
                      onLoadMore={() =>
                        selectedProject &&
                        loadMoreProjectTokenStats(selectedProject.path)
                      }
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
                  <div className="hidden md:block">
                    <MessageNavigator
                      messages={messages}
                      width={navigatorWidth}
                      isResizing={isNavigatorResizing}
                      onResizeStart={handleNavigatorResizeStart}
                      isCollapsed={!isNavigatorOpen}
                      onToggleCollapse={toggleNavigator}
                      asideId="message-navigator"
                    />
                  </div>
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

        {/* Status Bar (desktop only) */}
        <footer className="h-7 px-4 hidden md:flex items-center justify-between bg-sidebar border-t border-border/50 text-2xs text-muted-foreground">
          <div className="flex items-center gap-3 font-mono tabular-nums">
            <span>
              {isDesktop
                ? t("status.versionLabel", "v{{version}}", {
                    version: appVersion,
                  })
                : t("status.webMode", "Web")}
            </span>
            <span className="text-border">&bull;</span>
            <span>{t("project.count", { count: projects.length })}</span>
            <span className="text-border">&bull;</span>
            <span>{t("session.count", { count: sessions.length })}</span>
            {selectedSession && computed.isMessagesView && (
              <>
                <span className="text-border">&bull;</span>
                <span>
                  {t("message.count", { count: messages.length })}
                </span>
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
                {isLoading
                  ? t("status.initializing")
                  : isLoadingProjects
                    ? t("status.scanning")
                    : isLoadingSessions
                      ? t("status.loadingSessions")
                      : isLoadingMessages
                        ? t("status.loadingMessages")
                        : computed.isAnyLoading
                          ? t("status.loadingStats")
                          : null}
              </span>
            </div>
          )}
        </footer>

        <div
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {liveStatusMessage}
        </div>

        {/* Update Manager (desktop only) */}
        <DesktopOnly>
          <SimpleUpdateManager updater={updater} />
        </DesktopOnly>

        {/* Mobile Bottom Tab Bar */}
        {isMobile && (
          <BottomTabBar
            activeView={analyticsState.currentView}
            onOpenSidebar={() => setIsMobileSidebarOpen(true)}
            isViewingGlobalStats={isViewingGlobalStats}
            onSwitchView={(view) => {
              setIsViewingGlobalStats(false);
              switch (view) {
                case "messages":
                  analyticsActions.switchToMessages();
                  break;
                case "board":
                  void analyticsActions.switchToBoard();
                  break;
                case "analytics":
                  void analyticsActions.switchToAnalytics();
                  break;
                case "settings":
                  analyticsActions.switchToSettings();
                  break;
                case "archive":
                  analyticsActions.switchToArchive();
                  break;
              }
            }}
            hasProject={!!selectedProject}
          />
        )}

        {/* Mobile Navigator Sheet */}
        {isMobile && selectedSession && computed.isMessagesView && (
          <MobileNavigatorSheet messages={messages} />
        )}
      </div>

      {/* Modals */}
      <ModalContainer />
    </TooltipProvider>
  );
};
