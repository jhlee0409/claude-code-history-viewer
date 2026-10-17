/**
 * One screen title per view.
 *
 * Every non-message view sits under the shell's content header in
 * `AppLayout`, which already names the view (icon + heading + subtitle). A
 * view that prints its own copy of that title shows it twice, one above the
 * other. The rule pinned here: inside the main content area, the view's title
 * text appears exactly once, and that one occurrence is the heading.
 *
 * The views whose bodies have carried a duplicate (token stats, recent edits,
 * the analytics empty state) render for real; the heavier ones (settings,
 * board, archive) are stubbed, so for them this pins the shell's half of the
 * rule. Titles are compared as rendered English text, not as i18n keys, so a
 * second key that happens to read the same is caught too.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import i18n from "@/i18n";
import App from "@/App";

const { useAppStoreMock, appStoreState, analyticsState, computedMock, resetComputedMock } =
  vi.hoisted(() => {
    const mockSession = {
      session_id: "session-1",
      actual_session_id: "session-1",
      summary: "summary",
      project_name: "project-1",
      file_path: "/tmp/session.jsonl",
      has_tool_use: false,
      has_errors: false,
    };

    const mockProject = {
      name: "project-1",
      path: "/tmp/project",
      actual_path: "/tmp/project",
      provider: "claude",
    };

    const state: Record<string, unknown> & { selectedProject: unknown } = {
      projects: [mockProject],
      sessions: [mockSession],
      selectedProject: mockProject,
      selectedSession: mockSession,
      messages: [],
      isLoading: false,
      isLoadingProjects: false,
      isLoadingSessions: false,
      isLoadingMessages: false,
      isLoadingTokenStats: false,
      isLoadingGlobalStats: false,
      isLoadingBoard: false,
      isMetadataLoading: false,
      isLoadingRecentEdits: false,
      isLoadingMoreRecentEdits: false,
      // A populated Edits screen answering its own request (project scope,
      // file grouping), so the viewer renders its list header rather than
      // its loading or empty state.
      recentEditsScope: "project",
      recentEditsGroupingProject: "file",
      recentEditsGroupingSession: "edit",
      recentEditsDensity: "standard",
      recentEditsMissingOnly: false,
      recentEditsError: null,
      recentEditsRequestedKey: null,
      recentEditsList: (() => {
        const request = {
          projectPath: "/tmp/project",
          scope: "project",
          grouping: "file",
          sessionFilePath: "/tmp/session.jsonl",
        };
        return {
          files: [
            {
              file_path: "/tmp/project/src/a.ts",
              timestamp: "2026-08-21T00:00:00.000Z",
              session_id: "session-1",
              operation_type: "edit",
              content_after_change: "after",
              lines_added: 1,
              lines_removed: 0,
            },
          ],
          totalEditsCount: 1,
          uniqueFilesCount: 1,
          projectCwd: "/tmp/project",
          offset: 0,
          limit: 20,
          hasMore: false,
          // `recentEditsRequestKey(request)`: the same serialization, inlined
          // because a hoisted block cannot import.
          requestKey: JSON.stringify([request.projectPath, request.scope, request.grouping, ""]),
          request,
        };
      })(),
      analytics: {
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
      sessionTokenStats: null,
      sessionConversationTokenStats: null,
      // One row, so the token stats viewer renders its header rather than
      // its empty state.
      projectTokenStats: [
        {
          session_id: "session-1",
          project_name: "project-1",
          total_input_tokens: 10,
          total_output_tokens: 5,
          total_cache_creation_tokens: 0,
          total_cache_read_tokens: 0,
          total_reasoning_tokens: 0,
          total_tokens: 15,
          message_count: 2,
          first_message_time: "2026-08-21T00:00:00.000Z",
          last_message_time: "2026-08-21T00:05:00.000Z",
          most_used_tools: [],
        },
      ],
      projectConversationTokenStats: [],
      projectTokenStatsSummary: null,
      projectConversationTokenStatsSummary: null,
      projectTokenStatsPagination: null,
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
      view: "conversation",
      analyticsTab: "overview",
      navigationEpoch: 0,
      // Conversation tabs (T8): one tab, the live state.
      documents: [],
      parentSessionStack: [],
      activeDocumentId: "t1",
      hydratedDocumentId: "t1",
      tabsRestoreReport: { corrupt: false, dropped: 0 },
      navigate: vi.fn(async () => true),
      beginNavigation: vi.fn(() => 1),
      reloadCurrent: vi.fn(async () => {}),
      setBoardHoverSession: vi.fn(),
      setAnalyticsMetricMode: vi.fn(),
      loadMoreProjectTokenStats: vi.fn(async () => {}),
      loadRecentEditsList: vi.fn(async () => {}),
      loadMoreRecentEditsList: vi.fn(async () => {}),
      markRecentEditRestored: vi.fn(),
      setRecentEditsScope: vi.fn(),
      setRecentEditsDensity: vi.fn(),
      setRecentEditsGrouping: vi.fn(),
      setRecentEditsMissingOnly: vi.fn(),
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
      isInspectorOpen: true,
      inspectorTab: "outline",
      inspectorWidth: 280,
      setInspectorTab: vi.fn(),
      setInspectorWidth: vi.fn(),
      setInspectorOpen: vi.fn(),
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
    (storeMock as unknown as { subscribe: () => () => void }).subscribe = () => () => {};

    const analytics = {
      recentEditsSearchQuery: "",
    };

    const defaults = {
      isMessagesView: false,
      isAnalyticsOverview: false,
      isAnalyticsTokens: false,
      isAnalyticsView: false,
      isGlobalStatsView: false,
      isRecentEditsView: false,
      isSettingsView: false,
      isBoardView: false,
      isArchiveView: false,
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
    };
  });

vi.mock("@/components/ProjectTree", () => ({
  ProjectTree: ({ asideId }: { asideId?: string }) => <aside id={asideId}>project-tree</aside>,
}));
vi.mock("@/components/MessageViewer", () => ({ MessageViewer: () => <div>message-viewer</div> }));
vi.mock("@/components/MessageNavigator", () => ({ MessageNavigator: () => null }));
vi.mock("@/components/SimpleUpdateManager", () => ({ SimpleUpdateManager: () => null }));
vi.mock("@/components/SettingsManager", () => ({
  SettingsManager: () => <div>settings-manager</div>,
}));
vi.mock("@/components/SessionBoard/SessionBoard", () => ({
  SessionBoard: () => <div>session-board</div>,
}));
vi.mock("@/components/ArchiveManager", () => ({
  ArchiveManager: () => <div>archive-manager</div>,
}));
vi.mock("@/components/mobile/BottomTabBar", () => ({ BottomTabBar: () => null }));
vi.mock("@/components/mobile/MobileNavigatorSheet", () => ({ MobileNavigatorSheet: () => null }));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: () => null,
  SheetContent: () => null,
  SheetTitle: () => null,
}));
vi.mock("@/layouts/Header/Header", () => ({ Header: () => <header id="app-header" /> }));
vi.mock("@/layouts/Header/SettingDropdown/ModalContainer", () => ({ ModalContainer: () => null }));
vi.mock("@/contexts/theme", () => ({ useTheme: () => ({ isDarkMode: false }) }));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    state: analyticsState,
    actions: {
      clearAll: vi.fn(),
      switchToMessages: vi.fn(),
      switchToBoard: vi.fn(),
      switchToRecentEdits: vi.fn(),
      switchToAnalytics: vi.fn(),
      switchToSettings: vi.fn(),
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
  usePlatform: () => ({ platform: "web", isDesktop: false, isWeb: true, isMobile: false }),
  DesktopOnly: () => null,
  MobileOnly: () => null,
}));

vi.mock("@/store/useAppStore", () => ({ useAppStore: useAppStoreMock }));

type ViewCase = {
  label: string;
  titleKey: string;
  arrange: () => void;
};

const VIEWS: ViewCase[] = [
  {
    // Token stats are analytics' "tokens" sub-tab (T9b): the analytics title,
    // once, above the sub-tabs and the token statistics.
    label: "analytics (tokens sub-tab)",
    titleKey: "analytics.dashboard",
    arrange: () => {
      Object.assign(computedMock, { isAnalyticsView: true, isAnalyticsTokens: true });
      appStoreState.analyticsTab = "tokens";
    },
  },
  {
    label: "analytics (project)",
    titleKey: "analytics.dashboard",
    arrange: () => Object.assign(computedMock, { isAnalyticsView: true }),
  },
  {
    label: "analytics (no project selected)",
    titleKey: "analytics.dashboard",
    arrange: () => {
      Object.assign(computedMock, { isAnalyticsView: true });
      appStoreState.selectedProject = null;
    },
  },
  {
    label: "global stats",
    titleKey: "analytics.globalOverview",
    arrange: () => Object.assign(computedMock, { isGlobalStatsView: true }),
  },
  {
    label: "recent edits",
    titleKey: "recentEdits.title",
    arrange: () => Object.assign(computedMock, { isRecentEditsView: true }),
  },
  {
    label: "settings",
    titleKey: "settingsManager.title",
    arrange: () => Object.assign(computedMock, { isSettingsView: true }),
  },
  {
    label: "board",
    titleKey: "session.board.title",
    arrange: () => Object.assign(computedMock, { isBoardView: true }),
  },
  {
    label: "archive",
    titleKey: "archive.title",
    arrange: () => Object.assign(computedMock, { isArchiveView: true }),
  },
];

/**
 * Elements inside `root` that display `text` as their own content: the
 * innermost element whose whole text is `text`. Controls (buttons, tabs) are
 * navigation that names a destination, not a title, so they do not count.
 */
function titleOccurrences(root: HTMLElement, text: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("*")).filter((el) => {
    if (el.textContent?.trim() !== text) return false;
    if (el.closest("button, [role='tab']")) return false;
    return !Array.from(el.children).some((child) => child.textContent?.trim() === text);
  });
}

describe("view title invariant", () => {
  const initialProject = appStoreState.selectedProject;

  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  beforeEach(() => {
    resetComputedMock();
    appStoreState.selectedProject = initialProject;
    appStoreState.analyticsTab = "overview";
  });

  it.each(VIEWS)("$label: the title is shown exactly once, as the heading", ({ titleKey, arrange }) => {
    arrange();
    const title = i18n.t(titleKey);

    render(<App />);
    const main = document.getElementById("main-content");
    expect(main).not.toBeNull();

    const occurrences = titleOccurrences(main as HTMLElement, title);
    expect(
      occurrences.map((el) => el.outerHTML.slice(0, 120)),
      `"${title}" should appear once in the main content area`
    ).toHaveLength(1);

    const headings = Array.from(
      (main as HTMLElement).querySelectorAll("h1, h2, h3, h4, h5, h6, [role='heading']")
    ).filter((el) => el.textContent?.trim() === title);
    expect(headings).toHaveLength(1);
  });
});
