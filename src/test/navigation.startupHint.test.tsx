/**
 * The startup session hint through the real App effect: it claims navigation
 * only once a hint actually arrives. Asking for the hint is not a navigation,
 * so a startup that has no hint never supersedes a navigation in flight, and
 * a hint that arrives after the user moved is dropped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import type { ClaudeProject, ClaudeSession } from "@/types";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
// Shell and initialization side effects are out of scope here: only App's own
// routing effects run, against the real store.
vi.mock("@/hooks/useAppInitialization", () => ({ useAppInitialization: () => {} }));
vi.mock("@/hooks/useAppKeyboard", () => ({ useAppKeyboard: () => {} }));
vi.mock("@/hooks/useExternalLinks", () => ({ useExternalLinks: () => {} }));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ state: {}, actions: {}, computed: {} }),
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

const project = (name: string): ClaudeProject => ({
  name,
  path: `/p/${name}`,
  actual_path: `/home/${name}`,
  session_count: 1,
  message_count: 1,
  last_modified: "",
  provider: "claude",
});
const sessionOf = (p: ClaudeProject, id: string): ClaudeSession => ({
  session_id: id,
  actual_session_id: id,
  file_path: `${p.path}/${id}.jsonl`,
  project_name: p.name,
  message_count: 1,
  first_message_time: "",
  last_message_time: "",
  last_modified: "",
  has_tool_use: false,
  has_errors: false,
  provider: "claude",
});

const A = project("a");
const B = project("b");
const A1 = sessionOf(A, "a1");
const B1 = sessionOf(B, "b1");

const pristine = useAppStore.getState();
const state = () => useAppStore.getState();

/** Session-page requests for B wait for `releaseB()` while set. */
let releaseB: (() => void) | null = null;
let gateB = false;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  gateB = false;
  releaseB = null;
  apiMock.mockReset();
  apiMock.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    const sessions = args.projectPath === A.path ? [A1] : [B1];
    if (command === "load_project_sessions") return sessions;
    if (command === "load_provider_sessions_page") {
      const page = { sessions, total: 1, nextOffset: 1, hasMore: false };
      if (gateB && args.projectPath === B.path) {
        return new Promise((resolve) => {
          releaseB = () => resolve(page);
        });
      }
      return page;
    }
    if (command === "load_provider_messages_paginated") {
      return { messages: [], total_count: 0, has_more: false, next_offset: 0 };
    }
    if (command === "get_session_subagents") return [];
    return null;
  });
  useAppStore.setState(pristine, true);
  window.history.replaceState({}, "", "/");
});

afterEach(() => vi.restoreAllMocks());

describe("the startup session hint", () => {
  it("without a hint, leaves a navigation already in flight alone", async () => {
    useAppStore.setState({ projects: [A, B], selectedProject: A, selectedSession: A1 });
    gateB = true;
    const moved = state().navigate({ view: "conversation", project: B, session: B1 });
    const epoch = state().navigationEpoch;

    render(<App />);
    await act(async () => {});

    expect(state().navigationEpoch).toBe(epoch);
    await waitFor(() => expect(releaseB).not.toBeNull());
    await act(async () => {
      releaseB?.();
      await expect(moved).resolves.toBe(true);
    });
    expect(state().selectedSession?.session_id).toBe("b1");
  });

  it("opens a hint that arrives while nothing else navigated", async () => {
    window.history.replaceState({}, "", "/?session=b1");
    useAppStore.setState({ projects: [A, B], selectedProject: A, selectedSession: A1 });

    render(<App />);

    await waitFor(() => expect(state().selectedSession?.session_id).toBe("b1"));
  });

  it("drops a hint that arrives after the user navigated", async () => {
    window.history.replaceState({}, "", "/?session=b1");
    useAppStore.setState({ projects: [A, B], selectedProject: A, selectedSession: A1 });

    render(<App />);
    await act(async () => {
      await state().navigate({ view: "analytics" });
    });
    await act(async () => {});

    expect(state().view).toBe("analytics");
    expect(state().selectedSession?.session_id).toBe("a1");
  });
});
