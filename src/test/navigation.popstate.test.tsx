/**
 * WebUI browser back/forward through the real App effect (plan §4.1 / F1):
 * every popstate is a navigation with `history: "none", record: false`, with
 * the target exactly as the URL states it. Ported from the independent T2
 * review's App probes (scratch/t2-review).
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

/** The browser moved to `url` and fired popstate. */
async function popTo(url: string) {
  window.history.replaceState({}, "", url);
  await act(async () => {
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  apiMock.mockReset();
  apiMock.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    const sessions = args.projectPath === A.path ? [A1] : [B1];
    if (command === "load_project_sessions") return sessions;
    if (command === "load_provider_sessions_page") {
      return { sessions, total: 1, nextOffset: 1, hasMore: false };
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

describe("browser back/forward in the WebUI", () => {
  it("a same-session URL without msg returns to the conversation and clears the target", async () => {
    useAppStore.setState({ projects: [A, B], selectedProject: A, selectedSession: A1 });
    render(<App />);
    await act(async () => {});
    await act(async () => {
      await state().navigate({ view: "analytics", messageId: "later" });
    });

    await popTo("/?session=a1");

    expect(state().view).toBe("conversation");
    expect(state().targetMessageUuid).toBeNull();
    expect(state().placeHistory.back.at(-1)?.view).not.toBe("analytics");
  });

  it("a same-session URL with msg returns to the conversation at that message", async () => {
    useAppStore.setState({ projects: [A, B], selectedProject: A, selectedSession: A1 });
    render(<App />);
    await act(async () => {});
    await act(async () => {
      await state().navigate({ view: "analytics" });
    });
    const back = state().placeHistory.back.length;

    await popTo("/?session=a1&msg=m1");

    expect(state().view).toBe("conversation");
    expect(state().targetMessageUuid).toBe("m1");
    expect(state().placeHistory.back).toHaveLength(back);
  });

  it("a popstate queued before the first project scan keeps its no-record option", async () => {
    useAppStore.setState({ projects: [], isLoadingProjects: true });
    render(<App />);

    await popTo("/?session=b1&msg=m1");
    await act(async () => {
      useAppStore.setState({ projects: [A, B], isLoadingProjects: false });
    });

    await waitFor(() => expect(state().selectedSession?.session_id).toBe("b1"));
    expect(state().targetMessageUuid).toBe("m1");
    expect(state().placeHistory.back).toEqual([]);
  });

  it("a different-session popstate opens it without recording or writing the URL", async () => {
    useAppStore.setState({ projects: [A, B], selectedProject: A, selectedSession: A1 });
    render(<App />);
    await act(async () => {});
    const push = vi.spyOn(window.history, "pushState");

    await popTo("/?session=b1&msg=m1");

    await waitFor(() => expect(state().selectedSession?.session_id).toBe("b1"));
    expect(state().targetMessageUuid).toBe("m1");
    expect(state().placeHistory.back).toEqual([]);
    expect(push).not.toHaveBeenCalled();
  });
});
