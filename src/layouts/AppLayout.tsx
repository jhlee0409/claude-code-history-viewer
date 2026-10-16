import React from "react";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";
import { Icon } from "@/components/icon/Icon";
import { useAppStore } from "@/store/useAppStore";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ProjectTree } from "@/components/ProjectTree";
import { MessageNavigator } from "@/components/MessageNavigator";
import { SimpleUpdateManager } from "@/components/SimpleUpdateManager";
import { BottomTabBar } from "@/components/mobile/BottomTabBar";
import { MobileNavigatorSheet } from "@/components/mobile/MobileNavigatorSheet";
import { Header } from "@/layouts/Header/Header";
import { ModalContainer } from "@/layouts/Header/SettingDropdown/ModalContainer";
import { DesktopOnly } from "@/contexts/platform";
import { useIsXlUp } from "@/hooks/useMediaQuery";
import { CommandRunnerContext } from "@/commands/CommandRunner";
import { useCommandContext } from "@/commands/useCommandContext";
import { runCommand } from "@/commands/registry";
import { useFavoriteRefBackfill } from "@/hooks/useFavoriteRefBackfill";
import {
  AppErrorType,
  type ClaudeMessage,
  type ClaudeProject,
  type ClaudeSession,
  type GroupingMode,
  type SessionTokenStats,
  type AppError,
} from "@/types";
import type { UseAnalyticsReturn } from "@/types/analytics";
import type { UseUpdaterReturn } from "@/hooks/useUpdater";
import type { WorktreeGroup, DirectoryGroup, TimeGroup } from "@/utils/worktreeUtils";
import { usePendingLoadCount } from "@/hooks/usePendingLoad";
import { selectPlace } from "@/store/slices/navigationSlice";
import {
  activeLibraryItem,
  activeMobileTab,
  activeToolbarView,
  type MobileTab,
  type View,
} from "@/navigation/place";
import { viewTabId } from "@/layouts/Header/viewTabIds";
import { ShellLayout } from "@/layouts/shell/ShellLayout";
import { SkipLinks } from "@/layouts/shell/SkipLinks";
import { ContentHeader } from "@/layouts/shell/ContentHeader";
import { MobileAnalyticsSubNav } from "@/layouts/shell/MobileAnalyticsSubNav";
import { RecentEditsDock } from "@/layouts/shell/RecentEditsDock";
import { StatusBar } from "@/layouts/shell/StatusBar";
import {
  VIEW_REGISTRY,
  isMobileAnalyticsView,
  screenOf,
} from "@/layouts/shell/viewRegistry";

/** Bottom tab bar id → the screen it opens. */
const MOBILE_TAB_VIEW: Record<MobileTab | "archive", View> = {
  messages: "conversation",
  board: "board",
  analytics: "analytics",
  settings: "settingsManager",
  archive: "archive",
};

export interface AppLayoutProps {
  // Store state
  projects: ClaudeProject[];
  sessions: ClaudeSession[];
  sessionsTotal: number;
  hasMoreSessions: boolean;
  selectedProject: ClaudeProject | null;
  selectedSession: ClaudeSession | null;
  messages: ClaudeMessage[];
  isLoading: boolean;
  isLoadingProjects: boolean;
  isLoadingSessions: boolean;
  isLoadingMoreSessions: boolean;
  isLoadingMessages: boolean;
  isLoadingTokenStats: boolean;
  error: AppError | null;

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
  isSidebarCollapsed: boolean;
  isMobileSidebarOpen: boolean;
  setIsMobileSidebarOpen: (open: boolean) => void;

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
  recentEditsDockWidth: number;
  isRecentEditsDockResizing: boolean;
  handleRecentEditsDockResizeStart: (
    e: React.MouseEvent<HTMLElement>
  ) => void;

  // Grouping
  groupingMode: GroupingMode;
  worktreeGroups: WorktreeGroup[];
  directoryGroups: DirectoryGroup[];
  timeGroups: TimeGroup[];
  ungroupedProjects: ClaudeProject[];

  // Callbacks
  handleProjectSelect: (project: ClaudeProject) => void;
  loadMoreSessions: () => void;
  handleSessionSelect: (session: ClaudeSession) => void;
  handleSessionHover: (session: ClaudeSession) => void;
  handleGlobalStatsClick: () => void;
  handleToggleSidebar: () => void;
  handleGroupingModeChange: (mode: GroupingMode) => void;
  handleTokenStatClick: (stats: SessionTokenStats) => void;
  hideProject: (projectPath: string) => Promise<void>;
  unhideProject: (projectPath: string) => Promise<void>;
  isProjectHidden: (projectPath: string) => boolean;

  // Computed
  globalOverviewDescription: string;
  liveStatusMessage: string;
}

/**
 * The app shell, composed: fills the `ShellLayout` slots for the current
 * screen. What each screen renders, and how it is titled, comes from
 * `VIEW_REGISTRY`; this component only decides which slots are present.
 */
export const AppLayout: React.FC<AppLayoutProps> = (props) => {
  const { t } = useTranslation();
  // The dock is panel state, not layout state, so it is read from the store
  // rather than threaded through props like the navigator's older toggle.
  const isRecentEditsDockOpen = useAppStore((s) => s.isRecentEditsDockOpen);
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
    analyticsState,
    analyticsActions,
    computed,
    updater,
    appVersion,
    isDesktop,
    isMobile,
    isSidebarCollapsed,
    isMobileSidebarOpen,
    setIsMobileSidebarOpen,
    sidebarWidth,
    isSidebarResizing,
    handleSidebarResizeStart,
    navigatorWidth,
    isNavigatorResizing,
    handleNavigatorResizeStart,
    isNavigatorOpen,
    toggleNavigator,
    recentEditsDockWidth,
    isRecentEditsDockResizing,
    handleRecentEditsDockResizeStart,
    groupingMode,
    worktreeGroups,
    directoryGroups,
    timeGroups,
    ungroupedProjects,
    handleProjectSelect,
    loadMoreSessions,
    handleSessionSelect,
    handleSessionHover,
    handleGlobalStatsClick,
    handleToggleSidebar,
    handleGroupingModeChange,
    handleTokenStatClick,
    hideProject,
    unhideProject,
    isProjectHidden,
    globalOverviewDescription,
    liveStatusMessage,
  } = props;

  // Called before the early returns below, as hook order must not vary.
  const isXlUp = useIsXlUp();
  // Toolbar and sidebar controls run registry commands (`CommandRunner`).
  const getCommandContext = useCommandContext();
  const run = (id: Parameters<typeof runCommand>[0]) => runCommand(id, getCommandContext());
  // Legacy favourites learn where they live once their project is open.
  useFavoriteRefBackfill();
  // Highlights are projections of the place (plan C3); primitives only, so
  // the selectors stay stable between renders.
  const libraryItem = useAppStore((s) => activeLibraryItem(selectPlace(s)));
  const mobileTab = useAppStore((s) => activeMobileTab(selectPlace(s)));
  // The main view is the panel of the header's selected view tab. Only while
  // a tab is selected and the header's tablist is shown (md and up).
  const toolbarView = useAppStore((s) => activeToolbarView(selectPlace(s)));
  const viewPanelLabel =
    toolbarView && !isMobile ? viewTabId(toolbarView) : undefined;
  /*
    The non-visual `data-ready` marker on the root reads "true" only when no
    load is pending anywhere a screen can show a loader: the prop flags below,
    store-level loads the props do not carry (including incremental "load
    more" pages and the recent-edits dock), and view-level loads components
    keep in local state (`usePendingLoad`, e.g. the Settings Manager). The UI
    capture harness (`scripts/ui-capture`) waits on it, on top of network and
    DOM quiescence, before it photographs a screen. Attribute only; it never
    affects layout or styling.
  */
  const hasPendingStoreLoad = useAppStore(
    (s) =>
      s.isLoadingGlobalStats ||
      s.isLoadingBoard ||
      s.isMetadataLoading ||
      s.pagination.isLoadingMore ||
      s.isLoadingRecentEditsDock ||
      s.isLoadingMoreRecentEditsDock ||
      s.analytics.recentEditsPagination.isLoadingMore ||
      s.archive.isLoadingArchives ||
      s.archive.isLoadingSessions ||
      s.archive.isLoadingExpiring ||
      s.archive.isLoadingDiskUsage
  );
  const pendingViewLoads = usePendingLoadCount();
  const isSettled = !(
    hasPendingStoreLoad ||
    pendingViewLoads > 0 ||
    isLoading ||
    isLoadingProjects ||
    isLoadingSessions ||
    isLoadingMoreSessions ||
    isLoadingMessages ||
    isLoadingTokenStats ||
    computed.isAnyLoading
  );

  // Error State
  if (error && error.type !== AppErrorType.CLAUDE_FOLDER_NOT_FOUND) {
    return (
      <div
        className="h-screen flex items-center justify-center bg-background"
        // Terminal error screen: nothing further loads, so it is settled.
        data-ready="true"
      >
        <div className="text-center max-w-md mx-auto p-8">
          <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-6">
            <Icon icon={TriangleAlert} size={24} className="text-destructive" />
          </div>
          <h1 className="text-title font-semibold text-foreground mb-2">
            {t("common.errorOccurred")}
          </h1>
          <p className="text-body text-muted-foreground mb-6">{error.message}</p>
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

  // The one screen the main area shows; everything per-screen below reads
  // its registry entry.
  const screen = screenOf(computed);
  const entry = VIEW_REGISTRY[screen];
  const Screen = entry.component;
  const Frame = entry.frame;

  /*
    The transcript screen. The dock and the skip links that point into the
    inspector track exactly this condition, so an anchor and its target cannot
    drift apart. Global stats is a screen of its own, so the conversation
    screen is exactly the transcript.
  */
  const isTranscriptView = computed.isMessagesView;
  // The inspector (today the message navigator) is closed by default and
  // opens from the toolbar's inspector button or ⌘⇧M (plan T7, decision 5);
  // closed, it takes no width at all.
  const showMessageNavigator = entry.inspector && selectedSession != null && isNavigatorOpen;
  /*
    Gated on `xl` in JavaScript, not merely in CSS. The wrapper is
    `hidden xl:block`, but a hidden wrapper still mounts its children, so
    between 768 and 1279 the panel used to mount, run its effect and fetch a
    page for a dock nobody could see. `useIsMobile` only reaches to 767, so it
    was never the right gate for an `xl` surface.

    Deliberately NOT gated on a selected session or project. It stays beside
    the "select a session" placeholder: the panel scopes itself to the project
    on its own (`effectiveScope` falls back to "project"), so a refresh that
    clears the session does not blank the one surface still able to say what
    the project had been touching. And clicking the selected project in the
    tree collapses and deselects it; the panel is a workspace fixture, so it
    stays put and shows its own empty state. `clearProjectSelection` drops the
    dock's fetched page, so there is nothing of the old project to render.
  */
  const showRecentEditsDock =
    isXlUp && isRecentEditsDockOpen && isTranscriptView;

  const projectTreeProps = {
    projects,
    sessions,
    sessionsTotal,
    hasMoreSessions,
    selectedProject,
    selectedSession,
    onProjectSelect: handleProjectSelect,
    onSessionSelect: handleSessionSelect,
    onSessionHover: handleSessionHover,
    onLoadMoreSessions: loadMoreSessions,
    onGlobalStatsClick: handleGlobalStatsClick,
    isLoading: isLoadingProjects || isLoadingSessions,
    isLoadingMoreSessions,
    libraryItem,
    isSelectionRetained: libraryItem !== null,
    // The library's app-level rows and the help button run the same
    // commands as the palette (plan §6).
    onOpenArchive: () => run("go.archive"),
    isArchiveDisabled: (selectedProject?.provider ?? "claude") !== "claude",
    onOpenSettingsManager: () => run("go.settingsManager"),
    onOpenHelp: () => run("help.feedback"),
  };
  const groupingProps = {
    groupingMode,
    worktreeGroups,
    directoryGroups,
    timeGroups,
    ungroupedProjects,
    onGroupingModeChange: handleGroupingModeChange,
    onHideProject: hideProject,
    onUnhideProject: unhideProject,
    isProjectHidden,
  };

  return (
    <CommandRunnerContext.Provider value={getCommandContext}>
    <ShellLayout
      ready={isSettled}
      skipLinks={
        <SkipLinks
          hasProjectExplorer={!isMobile}
          hasRecentEditsDock={showRecentEditsDock}
          hasMessageNavigator={!isMobile && showMessageNavigator}
        />
      }
      header={
        <Header
          analyticsActions={analyticsActions}
          analyticsComputed={computed}
          updater={updater}
        />
      }
      drawer={
        isMobile && (
          <Sheet open={isMobileSidebarOpen} onOpenChange={setIsMobileSidebarOpen}>
            <SheetContent
              side="left"
              className="w-[var(--mobile-drawer-width)] p-0"
              showCloseButton={false}
            >
              <SheetTitle className="sr-only">
                {t("common.mobile.openSidebar")}
              </SheetTitle>
              <ProjectTree
                {...projectTreeProps}
                {...groupingProps}
                onClose={() => setIsMobileSidebarOpen(false)}
                asideId="project-explorer"
              />
            </SheetContent>
          </Sheet>
        )
      }
      sidebar={
        !isMobile && (
          <div className="hidden md:block">
            <ProjectTree
              {...projectTreeProps}
              width={isSidebarCollapsed ? undefined : sidebarWidth}
              isResizing={isSidebarResizing}
              onResizeStart={handleSidebarResizeStart}
              {...groupingProps}
              isCollapsed={isSidebarCollapsed}
              onToggleCollapse={handleToggleSidebar}
              asideId="project-explorer"
            />
          </div>
        )
      }
      mainHeader={
        <>
          <ContentHeader
            view={screen}
            selectedSession={selectedSession}
            globalOverviewDescription={globalOverviewDescription}
            onOpenView={(view) => void analyticsActions.openView(view)}
          />
          {isMobile && selectedProject && isMobileAnalyticsView(screen) && (
            <MobileAnalyticsSubNav view={screen} analyticsActions={analyticsActions} />
          )}
        </>
      }
      main={
        <Frame>
          <Screen
            view={screen}
            analyticsState={analyticsState}
            analyticsActions={analyticsActions}
            onTokenStatClick={handleTokenStatClick}
          />
        </Frame>
      }
      mainLabelledBy={viewPanelLabel}
      inspector={
        <>
          {showMessageNavigator && (
            <div className="hidden md:block">
              <MessageNavigator
                messages={messages}
                width={navigatorWidth}
                isResizing={isNavigatorResizing}
                onResizeStart={handleNavigatorResizeStart}
                isCollapsed={false}
                onToggleCollapse={toggleNavigator}
                asideId="message-navigator"
              />
            </div>
          )}
          {/*
            Outermost on the right, after the navigator rather than before it.
            The navigator is an outline OF the transcript, so it belongs
            against the transcript it indexes; the dock is a separate surface
            about the project and sits outside it.

            Keyed by whether a session is open, so clearing or opening one
            remounts the dock (fresh scroll, focus and panel state) while a
            switch between sessions keeps it - the lifetime it had when it sat
            inside the transcript or the "select a session" placeholder (T2).
          */}
          {showRecentEditsDock && (
            <RecentEditsDock
              key={selectedSession == null ? "beside-placeholder" : "beside-transcript"}
              width={recentEditsDockWidth}
              isResizing={isRecentEditsDockResizing}
              onResizeStart={handleRecentEditsDockResizeStart}
            />
          )}
        </>
      }
      statusBar={
        <StatusBar
          isDesktop={isDesktop}
          appVersion={appVersion}
          projectCount={projects.length}
          sessionCount={sessions.length}
          messageCount={
            selectedSession && computed.isMessagesView ? messages.length : null
          }
          isLoading={isLoading}
          isLoadingProjects={isLoadingProjects}
          isLoadingSessions={isLoadingSessions}
          isLoadingMessages={isLoadingMessages}
          isLoadingStats={computed.isAnyLoading}
        />
      }
      chrome={
        <>
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

          {isMobile && (
            <BottomTabBar
              activeTab={mobileTab}
              onOpenSidebar={() => setIsMobileSidebarOpen(true)}
              onSwitchView={(tab) => {
                const view = MOBILE_TAB_VIEW[tab as keyof typeof MOBILE_TAB_VIEW];
                if (view) void analyticsActions.openView(view);
              }}
              hasProject={!!selectedProject}
            />
          )}

          {isMobile && selectedSession && computed.isMessagesView && (
            <MobileNavigatorSheet messages={messages} />
          )}
        </>
      }
      modals={<ModalContainer />}
    />
    </CommandRunnerContext.Provider>
  );
};
