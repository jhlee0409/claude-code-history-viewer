/**
 * Restoring tabs against the project scan, through App's real startup
 * effect (T8 review finding 7): the restore waits for the first scan to
 * complete - not for a non-empty project list - and a tab whose project was
 * not scanned opens once a later scan lists it.
 *
 * - initial state (no scan yet, no projects): nothing is restored or marked;
 * - a completed scan with no projects: the restored tab shows its in-tab
 *   "project unavailable" notice instead of waiting forever;
 * - the project arrives with a later scan: the tab opens.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import type { ClaudeProject, ClaudeSession } from "@/types";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock("@/hooks/useAppInitialization", () => ({ useAppInitialization: () => {} }));
vi.mock("@/hooks/useAppKeyboard", () => ({ useAppKeyboard: () => {} }));
vi.mock("@/hooks/useExternalLinks", () => ({ useExternalLinks: () => {} }));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ state: {}, actions: { openView: async () => undefined }, computed: {} }),
}));
vi.mock("@/hooks/useUpdater", () => ({ useUpdater: () => ({ state: {} }) }));
vi.mock("@/hooks/useLiveStatusMessage", () => ({ useLiveStatusMessage: () => "" }));
vi.mock("@/hooks/useResizablePanel", () => ({
  useResizablePanel: () => ({ width: 256, isResizing: false, handleMouseDown: () => {} }),
}));
vi.mock("@/layouts/AppLayout", () => ({ AppLayout: () => null }));
vi.mock("@/contexts/platform", () => ({
  usePlatform: () => ({ isDesktop: false, isMobile: false }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

import App from "@/App";
import { useAppStore } from "@/store/useAppStore";
import { initialDocumentState } from "@/store/slices/documentSlice";
import { blankDocument, serializeTabs, TABS_STORAGE_KEY, type TabDocument } from "@/navigation/documents";

const A: ClaudeProject = {
  name: "a",
  path: "/p/a",
  actual_path: "/home/a",
  session_count: 1,
  message_count: 1,
  last_modified: "",
  provider: "claude",
};
const S1: ClaudeSession = {
  session_id: "s1",
  actual_session_id: "s1",
  file_path: "/p/a/s1.jsonl",
  project_name: "a",
  message_count: 1,
  first_message_time: "",
  last_message_time: "",
  last_modified: "",
  has_tool_use: false,
  has_errors: false,
  provider: "claude",
};

const pristine = useAppStore.getState();
const state = () => useAppStore.getState();
const activeDoc = () => state().documents.find((d) => d.id === state().activeDocumentId);

const storedTab: TabDocument = {
  ...blankDocument("t-a", 10),
  project: { provider: "claude", path: A.path },
  session: { provider: "claude", filePath: S1.file_path, sessionId: "s1", projectPath: A.path },
  title: "Session s1",
  projectName: "a",
};

/** Let App's startup effects and every promise they start run out. */
async function settleAll() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  apiMock.mockReset();
  apiMock.mockImplementation(async (command: string) => {
    if (command === "load_project_sessions" || command === "load_provider_sessions") return [S1];
    if (command === "load_provider_sessions_page") return { sessions: [S1], total: 1, nextOffset: 1, hasMore: false };
    if (command === "load_provider_messages_paginated") {
      return { messages: [], total_count: 0, has_more: false, next_offset: 0 };
    }
    if (command === "get_session_subagents") return [];
    return null;
  });
  localStorage.clear();
  localStorage.setItem(TABS_STORAGE_KEY, serializeTabs({ documents: [storedTab], activeId: "t-a" }));
  useAppStore.setState(pristine, true);
  useAppStore.setState({ claudePath: "/home/.claude", projects: [], isLoadingProjects: false });
  useAppStore.setState(initialDocumentState());
  window.history.replaceState({}, "", "/");
});

afterEach(() => vi.restoreAllMocks());

describe("restoring tabs waits for the project scan (review #7)", () => {
  it("before the first scan completes nothing is restored or marked unavailable", async () => {
    render(<App />);
    await settleAll();
    expect(state().tabsRestorePending).toBe(true);
    expect(activeDoc()?.unavailable).toBeNull();
    expect(state().selectedProject).toBeNull();
  });

  it("a completed scan with no projects shows the tab's in-tab notice instead of waiting forever", async () => {
    render(<App />);
    await act(async () => {
      useAppStore.setState({ projectsScanned: true });
    });
    await waitFor(() => expect(activeDoc()?.unavailable).toBe("project"));
    expect(state().tabsRestorePending).toBe(false);
    expect(state().error).toBeNull();
    // The tab keeps naming what it had.
    expect(activeDoc()?.session?.filePath).toBe(S1.file_path);
  });

  it("the scan completing with the project restores the tab", async () => {
    render(<App />);
    await act(async () => {
      useAppStore.setState({ isLoadingProjects: true });
    });
    await act(async () => {
      useAppStore.setState({ projects: [A], isLoadingProjects: false, projectsScanned: true });
    });
    await waitFor(() => expect(state().selectedSession?.file_path).toBe(S1.file_path));
    expect(activeDoc()?.unavailable).toBeNull();
  });

  it("a tab the user has moved on in is not reopened when the project arrives", async () => {
    render(<App />);
    await act(async () => {
      useAppStore.setState({ projectsScanned: true });
    });
    await waitFor(() => expect(activeDoc()?.unavailable).toBe("project"));
    await act(async () => {
      await state().navigate({ view: "globalStats" });
    });
    expect(activeDoc()?.unavailable).toBeNull();

    await act(async () => {
      useAppStore.setState({ projects: [A] });
    });
    await settleAll();
    expect(state().view).toBe("globalStats");
    expect(state().selectedSession).toBeNull();
  });

  it("a project that arrives with a later scan opens the tab that could not find it", async () => {
    render(<App />);
    await act(async () => {
      useAppStore.setState({ projectsScanned: true });
    });
    await waitFor(() => expect(activeDoc()?.unavailable).toBe("project"));

    // A later scan (a provider turned on, a refresh) lists the project.
    await act(async () => {
      useAppStore.setState({ projects: [A] });
    });
    await waitFor(() => expect(state().selectedSession?.file_path).toBe(S1.file_path));
    expect(state().selectedProject?.path).toBe(A.path);
    expect(activeDoc()?.unavailable).toBeNull();
  });
});
