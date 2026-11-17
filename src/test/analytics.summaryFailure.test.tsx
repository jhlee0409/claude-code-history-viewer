/**
 * A failed project-summary load is shown and reported - once.
 *
 * `a7357dd0` moved the failure off the app-wide error screen onto the
 * analytics screen's own `projectSummaryError`, but nothing rendered it: the
 * dashboard kept showing its loading text forever, and opening Analytics
 * raised no notification at all (scratch/t2-review/review-4.md R1). Repros 1
 * and 2 are ported from that review; each failed at a7357dd0.
 *
 * The contract, for every path that loads the summary (opening the screen,
 * a project switch, a stats-mode switch, a refresh): an owned failure renders
 * the analytics error state and raises exactly one error toast; a superseded
 * failure raises none.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ClaudeProject, ClaudeSession, MessagePage, ProjectStatsSummary } from "@/types";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  };
});

import { toast } from "sonner";
import { useAppStore } from "@/store/useAppStore";
import { useAnalyticsNavigation } from "@/hooks/analytics/useAnalyticsNavigation";
import { useAnalyticsAutoLoad } from "@/hooks/analytics/useAnalyticsAutoLoad";
import { AnalyticsDashboard } from "@/components/AnalyticsDashboard";

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
const LISTS: Record<string, ClaudeSession[]> = { [A.path]: [A1], [B.path]: [B1] };

const page = (): MessagePage => ({
  messages: [],
  total_count: 0,
  has_more: false,
  next_offset: 0,
});

function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const pristine = useAppStore.getState();
const state = () => useAppStore.getState();
let overrides: Record<string, (args: Record<string, unknown>) => unknown>;
const failSummary = (message: string) => {
  overrides.get_project_stats_summary = () => Promise.reject(new Error(message));
};

beforeEach(() => {
  overrides = {};
  vi.mocked(toast.error).mockClear();
  apiMock.mockReset();
  apiMock.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
    if (overrides[cmd]) return overrides[cmd](args);
    if (cmd === "scan_projects" || cmd === "scan_all_projects") return [A, B];
    if (cmd === "load_provider_sessions_page") {
      const sessions = LISTS[String(args.projectPath)] ?? [];
      return { sessions, total: sessions.length, nextOffset: sessions.length, hasMore: false };
    }
    if (cmd === "load_provider_session_by_path") return null;
    if (cmd === "load_provider_messages_paginated") return page();
    if (cmd === "get_session_subagents" || cmd === "get_git_log") return [];
    if (cmd === "get_project_token_stats") {
      return { items: [], total_count: 0, offset: 0, limit: 20, has_more: false };
    }
    return null;
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  useAppStore.setState(pristine, true);
  useAppStore.setState({ claudePath: "/home/.claude", projects: [A, B] });
  window.history.replaceState({}, "", "/");
});
afterEach(() => vi.restoreAllMocks());

/** The analytics error state, not the loading text, is on screen. */
function expectErrorState(detail: string) {
  expect(screen.queryByText("analytics.loading")).not.toBeInTheDocument();
  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent("common.hooks.projectSummaryLoadFailed");
  expect(alert).toHaveTextContent(detail);
}

describe("a failed summary renders the analytics error state (review-4 R1)", () => {
  it("repro 1: a stats-mode switch failure shows its error, not the loading text", async () => {
    await state().navigate({ project: A, session: A1, view: "analytics" });
    vi.mocked(toast.error).mockClear();
    failSummary("summary failed");
    const { result } = renderHook(() => useAnalyticsNavigation());

    await act(() => result.current.setStatsMode("conversation_only"));
    render(<AnalyticsDashboard />);

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(state().analytics.isLoadingProjectSummary).toBe(false);
    expect(state().error).toBeNull();
    expectErrorState("summary failed");
  });

  it("repro 2: opening Analytics with a failing summary toasts once and shows the error", async () => {
    await state().navigate({ project: A, session: A1 });
    vi.mocked(toast.error).mockClear();
    failSummary("open analytics failed");
    const { result } = renderHook(() => useAnalyticsNavigation());

    // The desktop Header catches and only logs the rejection.
    await act(() => result.current.switchToAnalytics().catch(() => {}));
    render(<AnalyticsDashboard />);

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(state().error).toBeNull();
    expectErrorState("open analytics failed");
  });

  it("shows the loading text, not a stale error, while a reload is in flight", () => {
    useAppStore.setState({ selectedProject: A, view: "analytics" });
    state().setAnalyticsProjectSummaryError("earlier failure");
    state().setAnalyticsLoadingProjectSummary(true);

    render(<AnalyticsDashboard />);

    expect(screen.getByText("analytics.loading")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("the error state's retry reloads the summary", async () => {
    await state().navigate({ project: A, view: "analytics" });
    failSummary("first failure");
    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(() => result.current.switchToAnalytics().catch(() => {}));
    const retry = vi.fn();

    render(<AnalyticsDashboard onRetry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));

    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("every summary load path reports an owned failure exactly once", () => {
  it("opening the screen", async () => {
    await state().navigate({ project: A, session: A1 });
    vi.mocked(toast.error).mockClear();
    failSummary("boom");
    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(() => result.current.switchToAnalytics().catch(() => {}));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(state().analytics.projectSummaryError).toBe("boom");
  });

  it("switching projects into Analytics", async () => {
    await state().navigate({ project: A, session: A1, view: "analytics" });
    vi.mocked(toast.error).mockClear();
    failSummary("boom");
    const { result } = renderHook(() => useAnalyticsNavigation());
    // App.handleProjectSelect: navigate with the screen, then open it.
    await act(async () => {
      await state().navigate({ project: B, view: "analytics" });
      await result.current.openView("analytics").catch(() => {});
    });
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(state().analytics.projectSummaryError).toBe("boom");
    expect(state().error).toBeNull();
  });

  it("a stats-mode switch", async () => {
    await state().navigate({ project: A, session: A1, view: "analytics" });
    vi.mocked(toast.error).mockClear();
    failSummary("boom");
    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(() => result.current.setStatsMode("conversation_only"));
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("the analytics refresh (the error state's retry)", async () => {
    await state().navigate({ project: A, session: A1, view: "analytics" });
    vi.mocked(toast.error).mockClear();
    failSummary("boom");
    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(() => result.current.refreshAnalytics().catch(() => {}));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(state().analytics.projectSummaryError).toBe("boom");
  });

  it("the header refresh keeps the shell: one toast, no app-wide error screen", async () => {
    await state().navigate({ project: A, session: A1, view: "analytics" });
    vi.mocked(toast.error).mockClear();
    failSummary("boom");
    await act(() => state().refreshAllConversations());
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(state().analytics.projectSummaryError).toBe("boom");
    expect(state().error).toBeNull();
  });

  it("a date-filter change", async () => {
    await state().navigate({ project: A, view: "analytics" });
    renderHook(() =>
      useAnalyticsAutoLoad({ isAnalyticsTokens: false, isAnalyticsOverview: true })
    );
    vi.mocked(toast.error).mockClear();
    failSummary("boom");
    await act(async () => {
      state().setDateFilter({ start: new Date(2026, 0, 1), end: new Date(2026, 0, 31) });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(state().analytics.projectSummaryError).toBe("boom");
    expect(state().analytics.isLoadingProjectSummary).toBe(false);
  });

  it("a superseded failure raises no toast and records nothing", async () => {
    await state().navigate({ project: A, session: A1 });
    vi.mocked(toast.error).mockClear();
    const held = gate<ProjectStatsSummary>();
    overrides.get_project_stats_summary = () => held.promise;
    const { result } = renderHook(() => useAnalyticsNavigation());

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.switchToAnalytics();
    });
    await act(async () => {
      await state().navigate({ view: "settingsManager" });
    });
    held.reject(new Error("abandoned"));
    await act(async () => {
      await pending.catch(() => {});
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(state().analytics.projectSummaryError).toBeNull();
    expect(state().error).toBeNull();
  });
});
