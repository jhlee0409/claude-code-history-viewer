/**
 * Shell characterization (plan T3): what the app shell renders for every
 * screen, pinned before the shell is split into slots and a view registry.
 *
 * For each screen, on the desktop and the mobile layout, the whole rendered
 * tree is snapshotted: skip links, sidebar and sessions column, the content
 * header (icon, title, subtitle), the mobile analytics sub-nav, the view
 * panel with the component the screen renders and the props it receives, the
 * right-hand navigator and recent-edits dock, the status bar and the mobile
 * chrome. View bodies are stubs that print their props, so the snapshot pins
 * the shell's choices, not the views' own markup.
 *
 * A structural refactor must leave these snapshots unchanged; any diff is a
 * behaviour change to review.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import i18n from "@/i18n";
import App from "@/App";

const {
  useAppStoreMock,
  appStoreState,
  analyticsState,
  computedMock,
  resetComputedMock,
  platformMock,
} = vi.hoisted(() => {
  const mockSession = {
    session_id: "session-1",
    actual_session_id: "session-1",
    summary: "session summary",
    project_name: "project-1",
    file_path: "/tmp/session.jsonl",
    has_tool_use: false,
    has_errors: false,
  };

  const mockProject = {
    name: "project-1",
    path: "/tmp/project",
    actual_path: "/tmp/project-actual",
    provider: "claude",
  };

  const state: Record<string, unknown> & {
    selectedProject: unknown;
    selectedSession: unknown;
  } = {
    projects: [mockProject],
    sessions: [mockSession],
    sessionsTotal: 1,
    hasMoreSessions: false,
    selectedProject: mockProject,
    selectedSession: mockSession,
    messages: [],
    isLoading: false,
    isLoadingProjects: false,
    isLoadingSessions: false,
    isLoadingMoreSessions: false,
    isLoadingMessages: false,
    isLoadingTokenStats: false,
    isLoadingGlobalStats: false,
    isLoadingBoard: false,
    isMetadataLoading: false,
    isLoadingRecentEditsDock: false,
    isLoadingMoreRecentEditsDock: false,
    isRecentEditsDockOpen: true,
    recentEditsDock: { uniqueFilesCount: 3, totalEditsCount: 7 },
    analytics: {
      recentEditsPagination: { isLoadingMore: false },
      projectSummary: null,
      projectConversationSummary: null,
      sessionComparison: null,
      metricMode: "billing",
    },
    archive: {
      isLoadingArchives: false,
      isLoadingSessions: false,
      isLoadingExpiring: false,
      isLoadingDiskUsage: false,
    },
    userMetadata: { sessions: {} },
    error: null,
    globalSummary: null,
    globalConversationSummary: null,
    sessionTokenStats: { session_id: "session-stats" },
    sessionConversationTokenStats: { session_id: "session-conversation-stats" },
    projectTokenStats: [{ session_id: "project-stats" }],
    projectConversationTokenStats: [{ session_id: "project-conversation-stats" }],
    projectTokenStatsSummary: { total: "summary" },
    projectConversationTokenStatsSummary: { total: "conversation-summary" },
    projectTokenStatsPagination: { hasMore: false },
    sessionSearch: { query: "", matches: [], currentMatchIndex: -1, filterType: "content" },
    initializeApp: vi.fn(async () => {}),
    selectProject: vi.fn(async () => {}),
    selectSession: vi.fn(async () => {}),
    clearProjectSelection: vi.fn(),
    navigateToMessage: vi.fn(),
    clearTargetMessage: vi.fn(),
    setSessionSearchQuery: vi.fn(),
    setSearchFilterType: vi.fn(),
    goToNextMatch: vi.fn(),
    goToPrevMatch: vi.fn(),
    clearSessionSearch: vi.fn(),
    loadGlobalStats: vi.fn(async () => {}),
    loadMoreSessions: vi.fn(async () => {}),
    view: "conversation",
    navigationEpoch: 0,
    navigate: vi.fn(async () => true),
    beginNavigation: vi.fn(() => 1),
    reloadCurrent: vi.fn(async () => {}),
    setBoardHoverSession: vi.fn(),
    setAnalyticsMetricMode: vi.fn(),
    setRecentEditsMode: vi.fn(),
    setRecentEditsDockOpen: vi.fn(),
    loadMoreProjectTokenStats: vi.fn(async () => {}),
    loadMoreRecentEdits: vi.fn(async () => {}),
    updateUserSettings: vi.fn(),
    getGroupedProjects: vi.fn(() => ({ groups: [], ungrouped: [] })),
    getDirectoryGroupedProjects: vi.fn(() => ({ groups: [] })),
    getTimeGroupedProjects: vi.fn(() => ({ groups: [] })),
    getEffectiveGroupingMode: vi.fn(() => "none"),
    hideProject: vi.fn(),
    unhideProject: vi.fn(),
    isProjectHidden: vi.fn(() => false),
    dateFilter: { start: null, end: null },
    setDateFilter: vi.fn(),
    isNavigatorOpen: true,
    toggleNavigator: vi.fn(),
    activeProviders: [],
    setSelectedSession: vi.fn(),
    fontScale: 100,
    highContrast: false,
    pagination: {
      currentOffset: 0,
      pageSize: 0,
      totalCount: 0,
      hasMore: false,
      isLoadingMore: false,
    },
  };

  type StoreMock = {
    (selector?: (s: typeof state) => unknown): unknown;
    getState: () => typeof state;
  };
  const storeMock = ((selector?: (s: typeof state) => unknown) =>
    typeof selector === "function" ? selector(state) : state) as StoreMock;
  storeMock.getState = () => state;

  const analytics = {
    recentEdits: { files: [], total_edits_count: 0, unique_files_count: 0 },
    recentEditsPagination: { hasMore: false },
    isLoadingRecentEdits: false,
    recentEditsError: null,
    recentEditsSearchQuery: "query",
  };

  const defaults = {
    isMessagesView: false,
    isTokenStatsView: false,
    isAnalyticsView: false,
    isGlobalStatsView: false,
    isRecentEditsView: false,
    isSettingsView: false,
    isBoardView: false,
    isArchiveView: false,
    isEmptyView: false,
    hasAnyError: false,
    isAnyLoading: false,
    isLoadingAnalytics: false,
    isLoadingTokenStats: false,
    isLoadingRecentEdits: false,
  };
  const computed = { ...defaults };

  return {
    appStoreState: state,
    useAppStoreMock: storeMock,
    analyticsState: analytics,
    computedMock: computed,
    resetComputedMock: () => Object.assign(computed, defaults),
    platformMock: { isMobile: false },
  };
});

/** A stub that prints the props it receives, minus functions. */
const { stub } = vi.hoisted(() => ({
  stub: (name: string) => (props: Record<string, unknown>) => {
    const shown = Object.fromEntries(
      Object.entries(props).filter(([, value]) => typeof value !== "function")
    );
    const handlers = Object.keys(props)
      .filter((key) => typeof props[key] === "function")
      .sort();
    return (
      <div
        data-stub={name}
        data-props={JSON.stringify(shown, (_key, value: unknown) =>
          value && typeof value === "object" && "$$typeof" in value ? "<element>" : value
        )}
        data-handlers={handlers.join(",")}
      />
    );
  },
}));

vi.mock("@/components/ProjectTree", () => ({
  ProjectTree: (props: { asideId?: string } & Record<string, unknown>) => (
    <aside id={props.asideId}>{stub("ProjectTree")(props)}</aside>
  ),
}));
vi.mock("@/components/SessionsPane/SessionsPane", () => ({
  SessionsPane: (props: Record<string, unknown>) => (
    <aside id="sessions-pane">{stub("SessionsPane")(props)}</aside>
  ),
}));
vi.mock("@/components/MessageViewer", () => ({ MessageViewer: stub("MessageViewer") }));
vi.mock("@/components/MessageNavigator", () => ({
  MessageNavigator: (props: { asideId?: string } & Record<string, unknown>) => (
    <aside id={props.asideId}>{stub("MessageNavigator")(props)}</aside>
  ),
}));
/** How often the recent-edits dock's panel mounted and unmounted. */
const { dockLifecycle } = vi.hoisted(() => ({ dockLifecycle: { mounts: 0, unmounts: 0 } }));
vi.mock("@/components/PanelDock", async () => {
  const { useEffect } = await import("react");
  return {
    PanelDock: (props: { asideId?: string } & Record<string, unknown>) => {
      useEffect(() => {
        dockLifecycle.mounts += 1;
        return () => {
          dockLifecycle.unmounts += 1;
        };
      }, []);
      return <aside id={props.asideId}>{stub("PanelDock")(props)}</aside>;
    },
  };
});
vi.mock("@/components/TokenStatsViewer", () => ({ TokenStatsViewer: stub("TokenStatsViewer") }));
vi.mock("@/components/AnalyticsDashboard", () => ({
  AnalyticsDashboard: stub("AnalyticsDashboard"),
}));
vi.mock("@/components/RecentEditsViewer", () => ({
  RecentEditsViewer: stub("RecentEditsViewer"),
}));
vi.mock("@/components/SimpleUpdateManager", () => ({ SimpleUpdateManager: () => null }));
vi.mock("@/components/SettingsManager", () => ({ SettingsManager: stub("SettingsManager") }));
vi.mock("@/components/SessionBoard/SessionBoard", () => ({ SessionBoard: stub("SessionBoard") }));
vi.mock("@/components/ArchiveManager", () => ({ ArchiveManager: stub("ArchiveManager") }));
vi.mock("@/components/mobile/BottomTabBar", () => ({ BottomTabBar: stub("BottomTabBar") }));
vi.mock("@/components/mobile/MobileNavigatorSheet", () => ({
  MobileNavigatorSheet: stub("MobileNavigatorSheet"),
}));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children, open }: { children?: React.ReactNode; open?: boolean }) => (
    <div data-stub="Sheet" data-open={String(open)}>
      {children}
    </div>
  ),
  SheetContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/layouts/Header/Header", () => ({ Header: () => <header id="app-header" /> }));
vi.mock("@/layouts/Header/SettingDropdown/ModalContainer", () => ({ ModalContainer: () => null }));
vi.mock("@/contexts/theme", () => ({ useTheme: () => ({ isDarkMode: false }) }));
// Wide viewport: the sessions column and the recent-edits dock can render.
vi.mock("@/hooks/useMediaQuery", () => ({
  useMediaQuery: () => true,
  useIsXlUp: () => true,
  useIsLgUp: () => true,
  XL_BREAKPOINT: 1280,
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    state: analyticsState,
    actions: {
      clearAll: vi.fn(),
      switchToMessages: vi.fn(),
      switchToTokenStats: vi.fn(),
      switchToBoard: vi.fn(),
      switchToRecentEdits: vi.fn(),
      switchToAnalytics: vi.fn(),
      switchToSettings: vi.fn(),
      openView: vi.fn(),
      refreshAnalytics: vi.fn(),
    },
    computed: computedMock,
  }),
}));

vi.mock("@/hooks/useUpdater", () => ({
  useUpdater: () => ({
    state: {
      currentVersion: "1.0.0",
      isChecking: false,
      hasUpdate: false,
      isDownloading: false,
      isInstalling: false,
      isRestarting: false,
      requiresManualRestart: false,
      downloadProgress: 0,
      error: null,
      updateInfo: null,
      newVersion: null,
    },
  }),
}));

vi.mock("@/hooks/useResizablePanel", () => ({
  useResizablePanel: () => ({ width: 280, isResizing: false, handleMouseDown: vi.fn() }),
}));

vi.mock("@/store/useLanguageStore", () => ({
  useLanguageStore: () => ({ language: "en", loadLanguage: vi.fn(async () => {}) }),
  default: {},
}));

vi.mock("@/contexts/modal", () => ({ useModal: () => ({ openModal: vi.fn() }) }));

vi.mock("@/contexts/platform", () => ({
  usePlatform: () => ({
    platform: "web",
    isDesktop: false,
    isWeb: true,
    isMobile: platformMock.isMobile,
  }),
  DesktopOnly: () => null,
  MobileOnly: () => null,
}));

vi.mock("@/store/useAppStore", () => ({ useAppStore: useAppStoreMock }));

type ScreenCase = [label: string, arrange: () => void];

const SCREENS: ScreenCase[] = [
  ["conversation with a session", () => Object.assign(computedMock, { isMessagesView: true })],
  [
    "conversation without a session",
    () => {
      Object.assign(computedMock, { isMessagesView: true });
      appStoreState.selectedSession = null;
    },
  ],
  ["no screen flag set", () => {}],
  [
    "empty",
    () => {
      Object.assign(computedMock, { isEmptyView: true });
      appStoreState.selectedProject = null;
      appStoreState.selectedSession = null;
    },
  ],
  ["empty with a kept session", () => Object.assign(computedMock, { isEmptyView: true })],
  ["token stats", () => Object.assign(computedMock, { isTokenStatsView: true })],
  ["analytics", () => Object.assign(computedMock, { isAnalyticsView: true })],
  [
    "analytics without a session",
    () => {
      Object.assign(computedMock, { isAnalyticsView: true });
      appStoreState.selectedSession = null;
    },
  ],
  ["global stats", () => Object.assign(computedMock, { isGlobalStatsView: true })],
  ["recent edits", () => Object.assign(computedMock, { isRecentEditsView: true })],
  ["settings", () => Object.assign(computedMock, { isSettingsView: true })],
  ["board", () => Object.assign(computedMock, { isBoardView: true })],
  ["archive", () => Object.assign(computedMock, { isArchiveView: true })],
  [
    "loading stats",
    () => Object.assign(computedMock, { isAnalyticsView: true, isAnyLoading: true }),
  ],
];

describe("shell characterization", () => {
  const initialProject = appStoreState.selectedProject;
  const initialSession = appStoreState.selectedSession;

  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  beforeEach(() => {
    resetComputedMock();
    appStoreState.selectedProject = initialProject;
    appStoreState.selectedSession = initialSession;
  });

  describe.each([
    ["desktop", false],
    ["mobile", true],
  ])("%s", (_layout, isMobile) => {
    it.each(SCREENS)("%s", (_label, arrange) => {
      platformMock.isMobile = isMobile;
      arrange();
      const { container } = render(<App />);
      expect(container).toMatchSnapshot();
    });
  });
});

/*
  The dock's lifetime on the transcript screen, as T2 (develop e3b84091) had
  it: the dock sat beside the transcript or beside the "select a session"
  placeholder, two different trees, so clearing or restoring the session
  remounted it (its scroll, focus and local state start over), while
  switching between two sessions kept it. The shell split must not change it.
*/
describe("recent-edits dock lifetime on the transcript screen", () => {
  const initialSession = appStoreState.selectedSession as Record<string, unknown>;

  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  beforeEach(() => {
    resetComputedMock();
    platformMock.isMobile = false;
    appStoreState.selectedSession = initialSession;
    Object.assign(dockLifecycle, { mounts: 0, unmounts: 0 });
    Object.assign(computedMock, { isMessagesView: true });
  });

  it("keeps the dock across a switch to another session", () => {
    const { rerender } = render(<App />);
    expect(dockLifecycle).toEqual({ mounts: 1, unmounts: 0 });

    appStoreState.selectedSession = { ...initialSession, session_id: "session-2" };
    rerender(<App />);
    expect(dockLifecycle).toEqual({ mounts: 1, unmounts: 0 });
  });

  it("remounts the dock when the session is cleared, and again when one is opened", () => {
    const { rerender } = render(<App />);
    expect(dockLifecycle).toEqual({ mounts: 1, unmounts: 0 });

    appStoreState.selectedSession = null;
    rerender(<App />);
    expect(dockLifecycle).toEqual({ mounts: 2, unmounts: 1 });

    appStoreState.selectedSession = initialSession;
    rerender(<App />);
    expect(dockLifecycle).toEqual({ mounts: 3, unmounts: 2 });
  });
});
