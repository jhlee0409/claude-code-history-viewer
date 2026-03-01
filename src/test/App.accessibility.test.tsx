import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "@/App";

const { useAppStoreMock } = vi.hoisted(() => {
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
    setSessionSearchQuery: vi.fn(),
    setSearchFilterType: vi.fn(),
    goToNextMatch: vi.fn(),
    goToPrevMatch: vi.fn(),
    clearSessionSearch: vi.fn(),
    loadGlobalStats: vi.fn(async () => {}),
    setAnalyticsCurrentView: vi.fn(),
    loadMoreProjectTokenStats: vi.fn(async () => {}),
    loadMoreRecentEdits: vi.fn(async () => {}),
    updateUserSettings: vi.fn(),
    getGroupedProjects: vi.fn(() => ({ groups: [], ungrouped: [] })),
    getDirectoryGroupedProjects: vi.fn(() => ({ groups: [] })),
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
  };

  type StoreMock = {
    (selector?: (state: typeof state) => unknown): unknown;
    getState: () => typeof state;
  };

  const storeMock = ((selector?: (state: typeof state) => unknown) =>
    typeof selector === "function" ? selector(state) : state) as StoreMock;
  storeMock.getState = () => state;

  return {
    appStoreState: state,
    useAppStoreMock: storeMock,
  };
});

vi.mock("@/components/ProjectTree", () => ({
  ProjectTree: ({ asideId }: { asideId?: string }) => (
    <aside id={asideId ?? "project-explorer"} tabIndex={-1}>
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
    computed: {
      isMessagesView: true,
      isTokenStatsView: false,
      isAnalyticsView: false,
      isRecentEditsView: false,
      isSettingsView: false,
      isBoardView: false,
      isAnyLoading: false,
      isLoadingAnalytics: false,
      isLoadingTokenStats: false,
      isLoadingRecentEdits: false,
    },
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
});
