/**
 * A screen shows only its own place's data (T8 third review, P1).
 *
 * The `screen` scope (`navigation/stateScope.ts`) used to be "left, unseen,
 * until the incoming screen's loader replaces it". It was not unseen: a tab
 * switch commits the incoming place first and loads its screen data later
 * (after the session list), so the incoming screen rendered the outgoing
 * tab's numbers under the incoming project - and, when its own load failed,
 * kept rendering them for good.
 *
 * The contract now: every screen value carries the place it was loaded for
 * (its owner) and a screen renders a value only when that owner is its
 * current place. Otherwise it shows its loading state, and once its own load
 * has failed, its own error state. Each case below: tab A on project X with
 * the screen loaded, tab B on project Y; switch to B with Y's requests held
 * (B shows loading, never X's), then fail them (B shows its error, never
 * X's).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type {
  ClaudeProject,
  ClaudeSession,
  PaginatedRecentEdits,
  ProjectStatsSummary,
  SessionTokenStats,
} from "@/types";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  Toaster: () => null,
}));
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en", changeLanguage: async () => {} } }),
  };
});
// jsdom has no layout: render every board lane, each naming its session.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({ index, key: index, start: index * 320, size: 320 })),
    getTotalSize: () => options.count * 320,
    measure: () => {},
    scrollToIndex: () => {},
  }),
}));
vi.mock("@/components/SessionBoard/SessionLane", () => ({
  SessionLane: ({ data }: { data: { session: ClaudeSession } }) => <div data-lane={data.session.file_path} />,
}));
vi.mock("@/components/SessionBoard/SessionActivityTimeline", () => ({
  SessionActivityTimeline: () => null,
}));

import { useAppStore } from "@/store/useAppStore";
import { useAnalyticsNavigation } from "@/hooks/analytics/useAnalyticsNavigation";
import { activateTab, openInNewTab, type TabScreens } from "@/navigation/tabs";
import { AnalyticsDashboard } from "@/components/AnalyticsDashboard";
import { formatCount } from "@/lib/format/number";

// Message totals are counts: grouped in the app language (`777,001`).
const countText = (value: number) => formatCount(value, "en");
import { SessionBoard } from "@/components/SessionBoard/SessionBoard";
import { AnalyticsScreen, RecentEditsScreen } from "@/layouts/shell/screens";
import { ThemeProvider } from "@/contexts/theme";
import type { AnalyticsTab, View } from "@/navigation/place";

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
  first_message_time: "2026-01-01T00:00:00.000Z",
  last_message_time: "2026-01-02T00:00:00.000Z",
  last_modified: "2026-01-02T00:00:00.000Z",
  has_tool_use: false,
  has_errors: false,
  summary: `summary of ${id}`,
  provider: "claude",
});

const X = project("x");
const Y = project("y");
const X1 = sessionOf(X, "x1");
const Y1 = sessionOf(Y, "y1");
const LISTS: Record<string, ClaudeSession[]> = { [X.path]: [X1], [Y.path]: [Y1] };

/** X's totals: numbers nothing of Y's could show. */
const X_MESSAGES = 777_001;
const Y_MESSAGES = 333_002;
const summaryOf = (p: ClaudeProject, messages: number): ProjectStatsSummary => ({
  project_name: p.name,
  total_sessions: 1,
  total_messages: messages,
  total_tokens: messages * 10,
  avg_tokens_per_session: 0,
  avg_session_duration: 0,
  total_session_duration: 0,
  most_active_hour: 0,
  most_used_tools: [],
  most_used_skills: [],
  most_used_subagents: [],
  daily_stats: [],
  activity_heatmap: [],
  model_distribution: [],
  token_distribution: { input: 0, output: 0, cache_creation: 0, cache_read: 0, reasoning: 0 },
});
const tokenRow = (p: ClaudeProject): SessionTokenStats => ({
  session_id: `${p.name}-token-session`,
  project_name: p.name,
  total_input_tokens: 1,
  total_output_tokens: 1,
  total_cache_creation_tokens: 0,
  total_cache_read_tokens: 0,
  total_reasoning_tokens: 0,
  total_tokens: 2,
  message_count: 1,
  first_message_time: "2026-01-01T00:00:00.000Z",
  last_message_time: "2026-01-01T00:00:00.000Z",
  summary: `token row only in ${p.name}`,
  most_used_tools: [],
});
const editsOf = (p: ClaudeProject): PaginatedRecentEdits => ({
  files: [
    {
      file_path: `/home/${p.name}/only-in-${p.name}.ts`,
      timestamp: "2026-01-01T00:00:00.000Z",
      session_id: `${p.name}1`,
      operation_type: "edit",
      content_after_change: "x",
      lines_added: 1,
      lines_removed: 0,
    },
  ],
  total_edits_count: 1,
  unique_files_count: 1,
  project_cwd: `/home/${p.name}`,
  offset: 0,
  limit: 20,
  has_more: false,
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
type Gate = ReturnType<typeof gate<unknown>>;

/** Requests held by the test, `command@projectPath` → its gate. */
let holds: Map<string, Gate>;
/** Requests that arrived for a held key. */
let arrived: Set<string>;
const hold = (command: string, p: ClaudeProject) => {
  const g = gate<unknown>();
  holds.set(`${command}@${p.path}`, g);
  return g;
};
const pathOf = (args: Record<string, unknown>): string => {
  if (typeof args.projectPath === "string") return args.projectPath;
  if (typeof args.sessionPath === "string") return String(args.sessionPath).replace(/\/[^/]+$/, "");
  if (typeof args.actualPath === "string") return String(args.actualPath).replace("/home/", "/p/");
  return "";
};

const pristine = useAppStore.getState();
const state = () => useAppStore.getState();

beforeEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  holds = new Map();
  arrived = new Set();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  apiMock.mockReset();
  apiMock.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    const owner = pathOf(args);
    const key = `${command}@${owner}`;
    const held = holds.get(key);
    if (held) {
      arrived.add(key);
      return held.promise;
    }
    const p = owner === Y.path ? Y : X;
    switch (command) {
      case "load_provider_sessions_page": {
        const sessions = LISTS[owner] ?? [];
        return { sessions, total: sessions.length, nextOffset: sessions.length, hasMore: false };
      }
      case "load_project_sessions":
      case "load_provider_sessions":
        return LISTS[owner] ?? [];
      case "load_provider_messages_paginated":
        return { messages: [], total_count: 0, has_more: false, next_offset: 0 };
      case "load_provider_messages":
      case "get_session_subagents":
      case "get_git_log":
        return [];
      case "get_project_stats_summary":
        return summaryOf(p, p === Y ? Y_MESSAGES : X_MESSAGES);
      case "get_project_token_stats":
        return { items: [tokenRow(p)], total_count: 1, offset: 0, limit: 20, has_more: false };
      case "get_recent_edits":
        return editsOf(p);
      default:
        return null;
    }
  });
  useAppStore.setState(pristine, true);
  useAppStore.setState({ claudePath: "/home/.claude", projects: [X, Y] });
});
afterEach(() => vi.restoreAllMocks());

/** The real screen loaders, as the shell hands them to the tab strip. */
function realScreens(): TabScreens {
  const { result } = renderHook(() => useAnalyticsNavigation());
  return { openView: (view: View) => result.current.openView(view) };
}

/**
 * Tab A on X's `view` (loaded), tab B on Y's (loaded once), back on A.
 * Returns B's id; the caller holds Y's requests and switches.
 */
async function twoTabs(
  view: View,
  screens: TabScreens,
  analyticsTab?: AnalyticsTab,
): Promise<{ tabA: string; tabB: string }> {
  await act(async () => {
    await state().navigate({ project: X, view, analyticsTab });
    await screens.openView(view);
  });
  const tabA = state().activeDocumentId!;
  await act(async () => {
    await openInNewTab(async () => {
      await state().navigate({ project: Y, view, analyticsTab });
      await screens.openView(view);
    });
  });
  const tabB = state().activeDocumentId!;
  await act(async () => {
    await activateTab(tabA, screens);
  });
  return { tabA, tabB };
}

/** Start switching to `tab` without waiting for it (its requests are held). */
function startSwitch(tab: string, screens: TabScreens): Promise<boolean> {
  let switching!: Promise<boolean>;
  act(() => {
    switching = activateTab(tab, screens);
  });
  return switching;
}

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const xTotal = () => screen.queryByText(countText(X_MESSAGES));

describe("project analytics shows only its own project's summary", () => {
  it("held: B shows loading, never X's totals - while B's session list loads, then while its summary loads", async () => {
    const screens = realScreens();
    render(<AnalyticsDashboard />);
    const { tabB } = await twoTabs("analytics", screens);
    expect(xTotal()).toBeInTheDocument();

    const list = hold("load_provider_sessions_page", Y);
    const summary = hold("get_project_stats_summary", Y);
    const switching = startSwitch(tabB, screens);
    await waitFor(() => expect(state().selectedProject?.path).toBe(Y.path));
    // The place is Y's; the session list is still loading.
    expect(xTotal()).not.toBeInTheDocument();
    expect(screen.getByText("analytics.loading")).toBeInTheDocument();

    await act(async () => list.resolve({ sessions: [Y1], total: 1, nextOffset: 1, hasMore: false }));
    await waitFor(() => expect(arrived.has(`get_project_stats_summary@${Y.path}`)).toBe(true));
    expect(xTotal()).not.toBeInTheDocument();
    expect(screen.getByText("analytics.loading")).toBeInTheDocument();

    await act(async () => summary.resolve(summaryOf(Y, Y_MESSAGES)));
    await act(async () => void (await switching));
    expect(screen.getByText(countText(Y_MESSAGES))).toBeInTheDocument();
    expect(xTotal()).not.toBeInTheDocument();
  });

  it("failed: B shows its own error, never X's totals", async () => {
    const screens = realScreens();
    render(<AnalyticsDashboard />);
    const { tabB } = await twoTabs("analytics", screens);

    const summary = hold("get_project_stats_summary", Y);
    const switching = startSwitch(tabB, screens);
    await waitFor(() => expect(arrived.has(`get_project_stats_summary@${Y.path}`)).toBe(true));
    await act(async () => summary.reject(new Error("y summary failed")));
    await act(async () => void (await switching));
    await settle();

    expect(xTotal()).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("y summary failed");
  });

  it("an error of X's is not B's: a failed X load leaves B loading, not erroring, until B answers", async () => {
    const screens = realScreens();
    render(<AnalyticsDashboard />);
    await act(async () => {
      await state().navigate({ project: Y, view: "analytics" });
      await screens.openView("analytics");
    });
    const tabB = state().activeDocumentId!;
    await act(async () => {
      await openInNewTab(async () => {
        await state().navigate({ project: X, view: "analytics" });
      });
    });
    const xSummary = hold("get_project_stats_summary", X);
    let opening!: Promise<void>;
    act(() => {
      opening = screens.openView("analytics");
    });
    await waitFor(() => expect(arrived.has(`get_project_stats_summary@${X.path}`)).toBe(true));
    await act(async () => xSummary.reject(new Error("x summary failed")));
    await act(async () => opening);
    holds.delete(`get_project_stats_summary@${X.path}`);
    expect(screen.getByRole("alert")).toHaveTextContent("x summary failed");

    const summary = hold("get_project_stats_summary", Y);
    const switching = startSwitch(tabB, screens);
    await waitFor(() => expect(state().selectedProject?.path).toBe(Y.path));
    // B's place shows B's own earlier summary (or its loading), never X's failure.
    expect(screen.queryByText("x summary failed")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(countText(Y_MESSAGES))).toBeInTheDocument();
    await act(async () => summary.resolve(summaryOf(Y, Y_MESSAGES)));
    await act(async () => void (await switching));
  });
});

describe("the analytics tokens sub-tab shows only its own project's stats", () => {
  const renderTokenStats = () =>
    render(
      <AnalyticsScreen
        view="analytics"
        analyticsState={{} as never}
        analyticsActions={{} as never}
        onTokenStatClick={() => {}}
        isMobile={false}
      />,
    );

  it("held: B shows loading, never X's rows", async () => {
    const screens = realScreens();
    renderTokenStats();
    const { tabB } = await twoTabs("analytics", screens, "tokens");
    expect(screen.getByText("token row only in x")).toBeInTheDocument();

    const list = hold("load_provider_sessions_page", Y);
    const stats = hold("get_project_token_stats", Y);
    const switching = startSwitch(tabB, screens);
    await waitFor(() => expect(state().selectedProject?.path).toBe(Y.path));
    expect(screen.queryByText("token row only in x")).not.toBeInTheDocument();
    expect(screen.getByText("analytics.loading")).toBeInTheDocument();

    await act(async () => list.resolve({ sessions: [Y1], total: 1, nextOffset: 1, hasMore: false }));
    await waitFor(() => expect(arrived.has(`get_project_token_stats@${Y.path}`)).toBe(true));
    expect(screen.queryByText("token row only in x")).not.toBeInTheDocument();
    expect(screen.getByText("analytics.loading")).toBeInTheDocument();

    await act(async () => stats.resolve({ items: [tokenRow(Y)], total_count: 1, offset: 0, limit: 20, has_more: false }));
    await act(async () => void (await switching));
    expect(screen.getByText("token row only in y")).toBeInTheDocument();
  });

  it("failed: B shows its own error, never X's rows", async () => {
    const screens = realScreens();
    renderTokenStats();
    const { tabB } = await twoTabs("analytics", screens, "tokens");

    const stats = hold("get_project_token_stats", Y);
    const switching = startSwitch(tabB, screens);
    await waitFor(() => expect(arrived.has(`get_project_token_stats@${Y.path}`)).toBe(true));
    await act(async () => stats.reject(new Error("y token stats failed")));
    await act(async () => void (await switching));
    await settle();

    expect(screen.queryByText("token row only in x")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("y token stats failed");
  });
});

describe("the board shows only its own project's sessions", () => {
  const lanes = () => [...document.querySelectorAll("[data-lane]")].map((el) => el.getAttribute("data-lane"));

  it("held: B shows loading, never X's lanes", async () => {
    const screens = realScreens();
    render(<SessionBoard />);
    const { tabB } = await twoTabs("board", screens);
    expect(lanes()).toEqual([X1.file_path]);

    const list = hold("load_provider_sessions_page", Y);
    const gitLog = hold("get_git_log", Y);
    const switching = startSwitch(tabB, screens);
    await waitFor(() => expect(state().selectedProject?.path).toBe(Y.path));
    expect(lanes()).toEqual([]);
    expect(screen.getByText("common.loading")).toBeInTheDocument();

    await act(async () => list.resolve({ sessions: [Y1], total: 1, nextOffset: 1, hasMore: false }));
    await waitFor(() => expect(arrived.has(`get_git_log@${Y.path}`)).toBe(true));
    expect(lanes()).toEqual([]);
    expect(screen.getByText("common.loading")).toBeInTheDocument();

    await act(async () => gitLog.resolve([]));
    await act(async () => void (await switching));
    await settle();
    expect(lanes()).toEqual([Y1.file_path]);
  });

  it("failed: B shows its own error, never X's lanes", async () => {
    const screens = realScreens();
    render(<SessionBoard />);
    const { tabB } = await twoTabs("board", screens);

    const gitLog = hold("get_git_log", Y);
    const switching = startSwitch(tabB, screens);
    await waitFor(() => expect(arrived.has(`get_git_log@${Y.path}`)).toBe(true));
    await act(async () => gitLog.reject(new Error("no git")));
    await act(async () => void (await switching));
    await settle();

    expect(lanes()).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent("error.loadBoard");
  });
});

describe("the Edits screen shows only its own project's edits", () => {
  const xRow = () => screen.queryAllByText(/only-in-x\.ts/)[0] ?? null;
  const wrap = (node: ReactNode) => <ThemeProvider>{node}</ThemeProvider>;
  /** The Edits screen as the shell mounts it (T9b: the only recent-edits surface). */
  function renderEditsScreen() {
    const { result } = renderHook(() => useAnalyticsNavigation());
    function Page() {
      return (
        <RecentEditsScreen
          view="edits"
          analyticsState={useAppStore((s) => s.analytics)}
          analyticsActions={result.current}
          onTokenStatClick={() => {}}
          isMobile={false}
        />
      );
    }
    render(wrap(<Page />));
  }

  it("held: B shows loading (no X rows, no X counts); failed, B's own error", async () => {
    const screens = realScreens();
    renderEditsScreen();
    const { tabB } = await twoTabs("edits", screens);
    await waitFor(() => expect(xRow()).toBeInTheDocument());
    expect(screen.getByText("recentEdits.stats")).toBeInTheDocument();

    const list = hold("load_provider_sessions_page", Y);
    const edits = hold("get_recent_edits", Y);
    const switching = startSwitch(tabB, screens);
    await waitFor(() => expect(state().selectedProject?.path).toBe(Y.path));
    expect(xRow()).not.toBeInTheDocument();
    expect(screen.queryByText("recentEdits.stats")).not.toBeInTheDocument();
    await act(async () => list.resolve({ sessions: [Y1], total: 1, nextOffset: 1, hasMore: false }));
    await waitFor(() => expect(arrived.has(`get_recent_edits@${Y.path}`)).toBe(true));
    expect(xRow()).not.toBeInTheDocument();

    await act(async () => edits.reject(new Error("y edits failed")));
    await act(async () => void (await switching));
    await settle();
    expect(xRow()).not.toBeInTheDocument();
    expect(screen.getByText(/y edits failed/)).toBeInTheDocument();
  });

  it("answered: B shows its own rows; switching back shows X's again without a refetch", async () => {
    const screens = realScreens();
    renderEditsScreen();
    const { tabA, tabB } = await twoTabs("edits", screens);
    await waitFor(() => expect(xRow()).toBeInTheDocument());

    await act(async () => void (await activateTab(tabB, screens)));
    await settle();
    expect(screen.getAllByText(/only-in-y\.ts/).length).toBeGreaterThan(0);
    expect(xRow()).not.toBeInTheDocument();

    await act(async () => void (await activateTab(tabA, screens)));
    await settle();
    expect(xRow()).toBeInTheDocument();
    expect(screen.queryAllByText(/only-in-y\.ts/)).toHaveLength(0);
  });

  /**
   * T9b review P2: X's Edits load is owned by X (the T2 `ownWork` rule). The
   * move to Y opens a screen that asks the Edits slot nothing, so neither its
   * request key nor its generation changes - only the place does - and the
   * late answer must still not land in the shared slot. Its spinner clears.
   */
  async function startEditsLoadOnX(screens: TabScreens): Promise<{ loading: Promise<void> }> {
    hold("get_recent_edits", X);
    let loading!: Promise<void>;
    act(() => {
      loading = (async () => {
        await state().navigate({ project: X, view: "edits" });
        await screens.openView("edits");
      })();
    });
    await waitFor(() => expect(arrived.has(`get_recent_edits@${X.path}`)).toBe(true));
    // Wrapped: an async function returning the promise itself would adopt it.
    return { loading };
  }
  const releaseX = async (loading: Promise<void>, outcome: "answer" | "fail") => {
    const held = holds.get(`get_recent_edits@${X.path}`)!;
    holds.delete(`get_recent_edits@${X.path}`);
    await act(async () => {
      if (outcome === "answer") held.resolve(editsOf(X));
      else held.reject(new Error("x edits failed"));
      await loading;
    });
    await settle();
  };

  it.each(["answer", "fail"] as const)(
    "switching project mid-load: X's late %s never commits while Y is open",
    async (outcome) => {
      const screens = realScreens();
      const { loading } = await startEditsLoadOnX(screens);
      await act(async () => {
        await state().navigate({ project: Y, session: Y1, view: "conversation" });
      });
      expect(state().selectedProject?.path).toBe(Y.path);

      await releaseX(loading, outcome);
      expect(state().selectedProject?.path).toBe(Y.path);
      expect(state().recentEditsList).toBeNull();
      expect(state().recentEditsError).toBeNull();
      expect(state().isLoadingRecentEdits).toBe(false);
    },
  );

  it("switching tabs mid-load: X's late answer never commits under tab B's project; back on A, X loads again", async () => {
    const screens = realScreens();
    const { loading } = await startEditsLoadOnX(screens);
    const tabA = state().activeDocumentId!;
    await act(async () => {
      await openInNewTab(async () => {
        await state().navigate({ project: Y, view: "analytics" });
        await screens.openView("analytics");
      });
    });
    expect(state().selectedProject?.path).toBe(Y.path);

    await releaseX(loading, "answer");
    expect(state().recentEditsList).toBeNull();
    expect(state().isLoadingRecentEdits).toBe(false);

    // Nothing is stranded: tab A's Edits screen reads X again and shows it.
    renderEditsScreen();
    await act(async () => void (await activateTab(tabA, screens)));
    await settle();
    await waitFor(() => expect(xRow()).toBeInTheDocument());
    expect(state().recentEditsList?.request.projectPath).toBe(X.path);
  });

  it("session scope asks the backend for the open session's edits only", async () => {
    const screens = realScreens();
    useAppStore.setState({ recentEditsScope: "session" });
    renderEditsScreen();
    await act(async () => {
      await state().navigate({ project: X, session: X1, view: "edits" });
      await screens.openView("edits");
    });
    await waitFor(() => expect(xRow()).toBeInTheDocument());
    const sessionCalls = apiMock.mock.calls.filter(
      ([command, args]) => command === "get_recent_edits" && (args as Record<string, unknown>).sessionFilePath === X1.file_path
    );
    expect(sessionCalls.length).toBeGreaterThan(0);
  });
});
