/**
 * Tests: WSL branch routing in scanProjects and searchMessages
 *
 * Verifies that scan_all_projects / search_all_providers are called
 * (instead of the WSL-unaware fallbacks) whenever wslEnabled is true,
 * even when no other providers or custom paths are configured.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { create } from "zustand";

const { mockApi } = vi.hoisted(() => ({
  mockApi: vi.fn(),
}));

vi.mock("@/services/api", () => ({
  api: mockApi,
}));

import { createProjectSlice } from "../store/slices/projectSlice";
import { createSearchSlice } from "../store/slices/searchSlice";
import { createMetadataSlice } from "../store/slices/metadataSlice";
import { createSettingsSlice } from "../store/slices/settingsSlice";
import { createProviderSlice } from "../store/slices/providerSlice";
import type { AppStore } from "../store/useAppStore";

// Minimal store: only the slices to read via get().
// Remaining fields required by AppStore are stubbed with vi.fn() / defaults.
function createTestStore() {
  return create<AppStore>()((...args) => ({
    ...createProjectSlice(...args),
    ...createSearchSlice(...args),
    ...createMetadataSlice(...args),
    ...createSettingsSlice(...args),
    ...createProviderSlice(...args),

    messages: [],
    isLoadingMessages: false,
    hasMoreMessages: false,
    currentPage: 0,
    messageError: null,
    loadMessages: vi.fn(),
    loadMoreMessages: vi.fn(),
    clearMessages: vi.fn(),
    setTargetMessage: vi.fn(),
    targetMessage: null,
    clearTargetMessage: vi.fn(),
    navigateToMessage: vi.fn(),
    analyticsData: null,
    isLoadingAnalytics: false,
    analyticsError: null,
    loadAnalytics: vi.fn(),
    globalStats: null,
    isLoadingGlobalStats: false,
    globalStatsError: null,
    loadGlobalStats: vi.fn(),
    captureMode: false,
    setCaptureMode: vi.fn(),
    boards: [],
    isLoadingBoards: false,
    boardError: null,
    loadBoards: vi.fn(),
    createBoard: vi.fn(),
    updateBoard: vi.fn(),
    deleteBoard: vi.fn(),
    filters: {},
    setFilters: vi.fn(),
    resetFilters: vi.fn(),
    currentRoute: null,
    navigate: vi.fn(),
    goBack: vi.fn(),
    watchedPaths: [],
    startWatcher: vi.fn(),
    stopWatcher: vi.fn(),
    navigator: null,
    initNavigator: vi.fn(),
    archiveSession: vi.fn(),
    archivedSessions: [],
    isLoadingArchive: false,
    archiveError: null,
    loadArchivedSessions: vi.fn(),
    sessionPicker: null,
    openSessionPicker: vi.fn(),
    closeSessionPicker: vi.fn(),
  } as unknown as AppStore));
}

function seedStore(
  store: ReturnType<typeof createTestStore>,
  wslEnabled: boolean,
  excludedDistros: string[] = []
) {
  store.setState({
    claudePath: "/home/user/.claude",
    userMetadata: {
      version: 1,
      sessions: {},
      projects: {},
      settings: { wsl: { enabled: wslEnabled, excludedDistros } },
    },
    activeProviders: ["claude"],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.mockResolvedValue([]);
});

describe("scanProjects — WSL branch routing", () => {
  it("calls scan_all_projects when wslEnabled is true (even with no other providers)", async () => {
    const store = createTestStore();
    seedStore(store, true);

    await store.getState().scanProjects();

    expect(mockApi).toHaveBeenCalledWith(
      "scan_all_projects",
      expect.objectContaining({ wslEnabled: true })
    );
  });

  it("passes wslExcludedDistros through to scan_all_projects", async () => {
    const store = createTestStore();
    seedStore(store, true, ["Debian"]);

    await store.getState().scanProjects();

    expect(mockApi).toHaveBeenCalledWith(
      "scan_all_projects",
      expect.objectContaining({ wslExcludedDistros: ["Debian"] })
    );
  });

  it("falls back to scan_projects when wslEnabled is false and no other providers", async () => {
    const store = createTestStore();
    seedStore(store, false);

    await store.getState().scanProjects();

    expect(mockApi).toHaveBeenCalledWith("scan_projects", expect.anything());
    expect(mockApi).not.toHaveBeenCalledWith("scan_all_projects", expect.anything());
  });
});

describe("searchMessages — WSL branch routing", () => {
  it("calls search_all_providers when wslEnabled is true", async () => {
    const store = createTestStore();
    seedStore(store, true);

    await store.getState().searchMessages("hello");

    expect(mockApi).toHaveBeenCalledWith(
      "search_all_providers",
      expect.objectContaining({ wslEnabled: true, query: "hello" })
    );
  });

  it("falls back to search_messages when wslEnabled is false and no other providers", async () => {
    const store = createTestStore();
    seedStore(store, false);

    await store.getState().searchMessages("hello");

    expect(mockApi).toHaveBeenCalledWith(
      "search_messages",
      expect.objectContaining({ query: "hello" })
    );
    expect(mockApi).not.toHaveBeenCalledWith("search_all_providers", expect.anything());
  });
});
