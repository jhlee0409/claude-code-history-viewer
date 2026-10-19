/**
 * The screen-ownership contract (T8 third review P1) through the real shell:
 * App, AppLayout, the tab strip, the real screens and the real store, with
 * only the backend stubbed. Tab A shows project X's analytics, tab B project
 * Y's; clicking B's tab with Y's summary held shows B's loading state, never
 * X's totals, and Y's failure shows B's error state - still never X's
 * totals. The board gets the same journey.
 *
 * `screenOwnership.tabs.test.tsx` covers every screen at the component
 * level; this one proves the shell renders what the selectors decide.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ClaudeProject, ClaudeSession, ProjectStatsSummary } from "@/types";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  Toaster: () => null,
}));
vi.mock("@/hooks/useAppInitialization", () => ({ useAppInitialization: () => {} }));
vi.mock("@/hooks/useUpdater", () => ({
  useUpdater: () => ({ state: { isChecking: false, currentVersion: "1.0.0", hasUpdate: false } }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@/contexts/platform", () => ({
  usePlatform: () => ({ platform: "desktop", isDesktop: true, isMobile: false }),
  DesktopOnly: ({ children }: { children: ReactNode }) => <>{children}</>,
  MobileOnly: () => null,
}));
vi.mock("@/hooks/useMediaQuery", () => ({
  useMediaQuery: () => true,
}));
vi.mock("@/components/SimpleUpdateManager", () => ({ SimpleUpdateManager: () => null }));
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

import i18n from "@/i18n";
import App from "@/App";
import { ModalProvider } from "@/contexts/modal/ModalProvider";
import { ThemeProvider } from "@/contexts/theme";
import { useAppStore } from "@/store/useAppStore";
import { formatNumber } from "@/components/AnalyticsDashboard/utils";
import { openInNewTab } from "@/navigation/tabs";
import type { View } from "@/navigation/place";

const project = (name: string): ClaudeProject => ({
  name,
  path: `/p/${name}`,
  actual_path: `/home/${name}`,
  session_count: 1,
  message_count: 1,
  last_modified: "2026-01-02T00:00:00.000Z",
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
const X = project("xproj");
const Y = project("yproj");
const X1 = sessionOf(X, "x1");
const Y1 = sessionOf(Y, "y1");
const LISTS: Record<string, ClaudeSession[]> = { [X.path]: [X1], [Y.path]: [Y1] };
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

let holds: Map<string, { promise: Promise<unknown>; resolve: (v: unknown) => void; reject: (e: Error) => void }>;
let arrived: Set<string>;
function hold(command: string, p: ClaudeProject) {
  let resolve!: (v: unknown) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const g = { promise, resolve, reject };
  holds.set(`${command}@${p.path}`, g);
  return g;
}
const pathOf = (args: Record<string, unknown>): string => {
  if (typeof args.projectPath === "string") return args.projectPath;
  if (typeof args.sessionPath === "string") return String(args.sessionPath).replace(/\/[^/]+$/, "");
  if (typeof args.actualPath === "string") return String(args.actualPath).replace("/home/", "/p/");
  return "";
};

const pristine = useAppStore.getState();
const state = () => useAppStore.getState();

beforeEach(async () => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  await i18n.changeLanguage("en");
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
      case "search_messages":
        return [];
      case "get_project_stats_summary":
        return owner === Y.path ? summaryOf(Y, Y_MESSAGES) : summaryOf(X, X_MESSAGES);
      default:
        return null;
    }
  });
  useAppStore.setState(pristine, true);
  useAppStore.setState({ claudePath: "/home/.claude", projects: [X, Y], isMetadataLoaded: true } as never);
});
afterEach(() => vi.restoreAllMocks());

async function renderShell() {
  render(
    <ThemeProvider>
      <ModalProvider>
        <App />
      </ModalProvider>
    </ThemeProvider>,
  );
  await act(async () => {});
}

/** Open `view` on `p` in the active tab, through the shell's own view tabs' loader. */
async function openOn(p: ClaudeProject, view: View) {
  await act(async () => {
    await state().navigate({ project: p, view });
  });
}

const tabButton = (id: string) => document.querySelector<HTMLElement>(`[data-document-id="${id}"]`)!;

async function clickTab(id: string) {
  await act(async () => {
    fireEvent.click(tabButton(id));
  });
}

/** Tab A on X's `view` with its data on screen, tab B on Y's; A in front. */
async function twoTabs(view: View, xVisible: () => boolean): Promise<string> {
  await openOn(X, view);
  const tabA = state().activeDocumentId!;
  await act(async () => {
    await openInNewTab(() => state().navigate({ project: Y, view }));
  });
  const tabB = state().activeDocumentId!;
  await clickTab(tabA);
  await waitFor(() => expect(xVisible()).toBe(true));
  return tabB;
}

describe("the real shell shows only the active tab's screen data", () => {
  const xTotal = () => screen.queryAllByText(formatNumber(X_MESSAGES)).length > 0;

  it("analytics: clicking tab B with Y's summary held shows B loading, then Y's failure shows B's error - never X's totals", async () => {
    await renderShell();
    const tabB = await twoTabs("analytics", xTotal);

    const summary = hold("get_project_stats_summary", Y);
    await clickTab(tabB);
    await waitFor(() => expect(arrived.has(`get_project_stats_summary@${Y.path}`)).toBe(true));
    expect(state().activeDocumentId).toBe(tabB);
    expect(xTotal()).toBe(false);
    expect(screen.getAllByText(i18n.t("analytics.loading")).length).toBeGreaterThan(0);

    await act(async () => summary.reject(new Error("y summary failed")));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("y summary failed"));
    expect(xTotal()).toBe(false);
    // The tabs and the shell stay: this is B's error, not the app's.
    expect(state().error).toBeNull();
    expect(tabButton(tabB)).toHaveAttribute("aria-selected", "true");
  });

  it("board: clicking tab B with Y's board held shows B loading, then Y's failure shows B's error - never X's lanes", async () => {
    const lanes = () => [...document.querySelectorAll("[data-lane]")].map((el) => el.getAttribute("data-lane"));
    await renderShell();
    const tabB = await twoTabs("board", () => lanes().includes(X1.file_path));

    const gitLog = hold("get_git_log", Y);
    await clickTab(tabB);
    await waitFor(() => expect(arrived.has(`get_git_log@${Y.path}`)).toBe(true));
    expect(lanes()).toEqual([]);

    await act(async () => gitLog.reject(new Error("no git")));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(i18n.t("error.loadBoard")));
    expect(lanes()).toEqual([]);
    expect(state().error).toBeNull();
  });
});
