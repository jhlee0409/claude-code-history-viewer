import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beginPendingLoad } from "@/hooks/usePendingLoad";
import App from "@/App";

const { useAppStoreMock, appStoreState, resetStoreLoadFlags } = vi.hoisted(() => {
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

  const state = {
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
    // Store-level loads AppLayout folds into its `data-ready` marker.
    isLoadingGlobalStats: false,
    isLoadingBoard: false,
    isMetadataLoading: false,
    isLoadingRecentEditsDock: false,
    isLoadingMoreRecentEditsDock: false,
    analytics: { recentEditsPagination: { isLoadingMore: false } },
    archive: {
      isLoadingArchives: false,
      isLoadingSessions: false,
      isLoadingExpiring: false,
      isLoadingDiskUsage: false,
    },
    error: null,
    sessionTokenStats: null,
    sessionConversationTokenStats: null,
    projectTokenStats: [],
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
    navigationEpoch: 0,
    navigate: vi.fn(async () => true),
    beginNavigation: vi.fn(() => 1),
    reloadCurrent: vi.fn(async () => {}),
    setBoardHoverSession: vi.fn(),
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
    (selector?: (state: typeof state) => unknown): unknown;
    getState: () => typeof state;
  };

  const storeMock = ((selector?: (state: typeof state) => unknown) =>
    typeof selector === "function" ? selector(state) : state) as StoreMock;
  storeMock.getState = () => state;

  const resetStoreLoadFlags = () => {
    state.isLoadingGlobalStats = false;
    state.isLoadingBoard = false;
    state.isMetadataLoading = false;
    state.isLoadingRecentEditsDock = false;
    state.isLoadingMoreRecentEditsDock = false;
    state.analytics.recentEditsPagination.isLoadingMore = false;
    state.pagination.isLoadingMore = false;
    Object.assign(state.archive, {
      isLoadingArchives: false,
      isLoadingSessions: false,
      isLoadingExpiring: false,
      isLoadingDiskUsage: false,
    });
  };

  return {
    appStoreState: state,
    useAppStoreMock: storeMock,
    resetStoreLoadFlags,
  };
});

vi.mock("@/components/ProjectTree", () => ({
  ProjectTree: ({
    asideId,
    isGlobalStatsActive,
    isSelectionRetained,
  }: {
    asideId?: string;
    isGlobalStatsActive?: boolean;
    isSelectionRetained?: boolean;
  }) => (
    <aside
      id={asideId ?? "project-explorer"}
      tabIndex={-1}
      data-global-stats-active={String(isGlobalStatsActive)}
      data-selection={isSelectionRetained ? "retained" : "active"}
    >
      project-tree
    </aside>
  ),
}));

vi.mock("@/components/MessageViewer", () => ({
  MessageViewer: () => <div>message-viewer</div>,
}));

vi.mock("@/components/MessageNavigator", () => ({
  MessageNavigator: ({ asideId }: { asideId?: string }) => (
    <aside id={asideId ?? "message-navigator"} tabIndex={-1}>
      message-navigator
    </aside>
  ),
}));

vi.mock("@/components/TokenStatsViewer", () => ({
  TokenStatsViewer: () => <div>token-stats</div>,
}));

vi.mock("@/components/AnalyticsDashboard", () => ({
  AnalyticsDashboard: () => <div>analytics</div>,
}));

vi.mock("@/components/RecentEditsViewer", () => ({
  RecentEditsViewer: () => <div>recent-edits</div>,
}));

vi.mock("@/components/SimpleUpdateManager", () => ({
  SimpleUpdateManager: () => null,
}));

vi.mock("@/components/SettingsManager", () => ({
  SettingsManager: () => <div>settings-manager</div>,
}));

vi.mock("@/components/SessionBoard/SessionBoard", () => ({
  SessionBoard: () => <div>session-board</div>,
}));

vi.mock("@/components/mobile/BottomTabBar", () => ({
  BottomTabBar: () => null,
}));

vi.mock("@/components/mobile/MobileNavigatorSheet", () => ({
  MobileNavigatorSheet: () => null,
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: () => null,
  SheetContent: () => null,
  SheetTitle: () => null,
}));

vi.mock("@/layouts/Header/Header", () => ({
  Header: () => (
    <header id="app-header">
      <button id="app-settings-button" type="button">
        settings
      </button>
    </header>
  ),
}));

vi.mock("@/layouts/Header/SettingDropdown/ModalContainer", () => ({
  ModalContainer: () => null,
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    state: {
      recentEdits: null,
      recentEditsPagination: null,
      isLoadingRecentEdits: false,
      recentEditsError: null,
      recentEditsSearchQuery: "",
    },
    actions: {
      clearAll: vi.fn(),
      switchToMessages: vi.fn(),
      switchToTokenStats: vi.fn(),
      switchToBoard: vi.fn(),
      switchToRecentEdits: vi.fn(),
      switchToAnalytics: vi.fn(),
      switchToSettings: vi.fn(),
    },
    computed: computedMock,
  }),
}));

/**
 * The view flags a test wants to vary. Hoisted and mutated in place rather than
 * re-mocked per test, because `vi.mock` is hoisted above the test bodies.
 */
const { computedMock, resetComputedMock } = vi.hoisted(() => {
  const defaults = {
    isMessagesView: true,
    isTokenStatsView: false,
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
  const mock = { ...defaults };
  return {
    computedMock: mock,
    resetComputedMock: () => Object.assign(mock, defaults),
  };
});

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
  useResizablePanel: () => ({
    width: 280,
    isResizing: false,
    handleMouseDown: vi.fn(),
  }),
}));

vi.mock("@/store/useLanguageStore", () => ({
  useLanguageStore: () => ({
    language: "en",
    loadLanguage: vi.fn(async () => {}),
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: {} as any,
}));

vi.mock("@/contexts/modal", () => ({
  useModal: () => ({
    openModal: vi.fn(),
  }),
}));

vi.mock("@/contexts/platform", () => ({
  usePlatform: () => ({
    platform: "web",
    isDesktop: false,
    isWeb: true,
    isMobile: false,
  }),
  DesktopOnly: () => null,
  MobileOnly: () => null,
}));

vi.mock("@/store/useAppStore", () => ({
  useAppStore: useAppStoreMock,
}));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
      i18n: {
        on: vi.fn(),
        off: vi.fn(),
      },
    }),
  };
});

describe("App accessibility smoke", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    vi.clearAllMocks();
    resetComputedMock();
    resetStoreLoadFlags();
  });

  it("renders skip links and landmark targets", () => {
    render(<App />);

    expect(
      screen.getByRole("link", { name: "Skip to project explorer" })
    ).toHaveAttribute("href", "#project-explorer");
    expect(
      screen.getByRole("link", { name: "Skip to main content" })
    ).toHaveAttribute("href", "#main-content");
    expect(
      screen.getByRole("link", { name: "Skip to message navigator" })
    ).toHaveAttribute("href", "#message-navigator");
    expect(
      screen.getByRole("link", { name: "Skip to settings" })
    ).toHaveAttribute("href", "#app-settings-button");

    expect(document.getElementById("project-explorer")).not.toBeNull();
    expect(document.getElementById("main-content")).not.toBeNull();
    expect(document.getElementById("message-navigator")).not.toBeNull();
    expect(document.getElementById("app-settings-button")).not.toBeNull();
  });

  /**
   * #518. A skip link whose target is not in the document is worse than an
   * absent one: it takes a tab stop and then silently does nothing, which reads
   * as the page being broken rather than the link being inapplicable.
   *
   * The rule these pin is that each link is gated on its target's real render
   * condition, not on a proxy for it.
   */
  it.each([
    ["settings", { isSettingsView: true }],
    ["analytics", { isAnalyticsView: true }],
    ["token stats", { isTokenStatsView: true }],
    ["board", { isBoardView: true }],
    // Archive is left out: its branch reads archive state this mock does not
    // carry, so including it would test the fixture rather than the gating.
    // It is covered by `isTranscriptView` all the same.
    ["recent edits", { isRecentEditsView: true }],
  ])(
    "drops the message-navigator skip link in the %s view, where the navigator does not render",
    (_label, flags) => {
      // The navigator only renders in the transcript branch, but its link was
      // keyed to `selectedSession` — which survives switching views.
      Object.assign(computedMock, { isMessagesView: false }, flags);

      render(<App />);

      expect(document.getElementById("message-navigator")).toBeNull();
      expect(
        screen.queryByRole("link", { name: "Skip to message navigator" })
      ).toBeNull();
    }
  );

  it("keeps every rendered skip link pointing at a target that exists", () => {
    // The general invariant, asserted across the view states rather than for
    // one link: whatever the nav offers must resolve.
    for (const flags of [
      { isMessagesView: true },
      { isMessagesView: false, isSettingsView: true },
      { isMessagesView: false, isBoardView: true },
    ]) {
      resetComputedMock();
      Object.assign(computedMock, flags);
      const view = render(<App />);

      const links = screen.getAllByRole("link");
      for (const link of links) {
        const href = link.getAttribute("href") ?? "";
        if (!href.startsWith("#")) continue;
        expect(
          document.getElementById(href.slice(1)),
          `${link.textContent} points at ${href}, which is not in the document`
        ).not.toBeNull();
      }

      view.unmount();
    }
  });

  /**
   * Plan §9b C3 (audit capture 12): the sidebar's global stats row is
   * selected only while global stats is the open screen, and on any app-level
   * screen the tree marks its selection as kept context.
   */
  it.each([
    ["globalStats", "true", "retained"],
    ["archive", "false", "retained"],
    ["settingsManager", "false", "retained"],
    ["conversation", "false", "active"],
    ["analytics", "false", "active"],
  ] as const)(
    "derives the sidebar highlight from the place: %s",
    (view, globalActive, selection) => {
      appStoreState.view = view;
      try {
        render(<App />);
        const tree = document.getElementById("project-explorer");
        expect(tree?.getAttribute("data-global-stats-active")).toBe(globalActive);
        expect(tree?.getAttribute("data-selection")).toBe(selection);
      } finally {
        appStoreState.view = "conversation";
      }
    }
  );

  it("replays a WebUI message link from browser history", async () => {
    render(<App />);

    window.history.replaceState(
      {},
      "",
      "/?session=session-1&msg=message-2",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));

    await waitFor(() => {
      // Browser history replays as a navigation that writes no history.
      expect(useAppStoreMock.getState().navigate).toHaveBeenCalledWith(
        { view: "conversation", messageId: "message-2" },
        expect.objectContaining({ history: "none", record: false }),
      );
    });
  });

  /**
   * The UI capture harness (scripts/ui-capture) photographs a screen only
   * once the root reports `data-ready="true"`, so the marker must follow
   * every load it folds in, and the main pane must carry its probe hook.
   */
  it.each([
    ["nothing is loading", () => {}, "true"],
    ["the global stats are loading", () => { appStoreState.isLoadingGlobalStats = true; }, "false"],
    ["the board is loading", () => { appStoreState.isLoadingBoard = true; }, "false"],
    ["an archive list is loading", () => { appStoreState.archive.isLoadingArchives = true; }, "false"],
    ["the archive disk usage is loading", () => { appStoreState.archive.isLoadingDiskUsage = true; }, "false"],
    ["an analytics view is loading", () => { computedMock.isAnyLoading = true; }, "false"],
    ["session metadata is loading", () => { appStoreState.isMetadataLoading = true; }, "false"],
    ["another message page is loading", () => { appStoreState.pagination.isLoadingMore = true; }, "false"],
    ["the recent-edits dock is loading", () => { appStoreState.isLoadingRecentEditsDock = true; }, "false"],
    ["another recent-edits dock page is loading", () => { appStoreState.isLoadingMoreRecentEditsDock = true; }, "false"],
    ["another recent-edits page is loading", () => { appStoreState.analytics.recentEditsPagination.isLoadingMore = true; }, "false"],
  ])("reports data-ready while %s", (_label, arrange, expected) => {
    arrange();

    const { container } = render(<App />);

    const marked = container.querySelectorAll("[data-ready]");
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveAttribute("data-ready", expected);
    expect(container.querySelector('[data-slot="main"]')).toBe(
      document.getElementById("main-content"),
    );
  });

  it("reports data-ready false while a view-level load is registered", () => {
    // e.g. the Settings Manager fetching its settings (usePendingLoad).
    const release = beginPendingLoad();
    let container: HTMLElement;
    try {
      ({ container } = render(<App />));
      expect(container.querySelector("[data-ready]")).toHaveAttribute("data-ready", "false");
    } finally {
      act(() => release());
    }
    expect(container.querySelector("[data-ready]")).toHaveAttribute("data-ready", "true");
  });
});
