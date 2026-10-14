/**
 * Characterization of where the user is, before and after navigation and
 * reloads (plan T2, checkpoint 1).
 *
 * These pin today's behaviour on the real, fully wired store so the move to a
 * single place model can be checked against it. Two things vary across that
 * move and are kept at the top of the file on purpose:
 *
 * - `readPlace` turns store state into the place the user sees
 *   (`view` + retained project/session).
 * - The `act` drivers do what the UI entry points do (sidebar click, header
 *   tab, app menu, global stats row).
 *
 * The expectations below them must not change.
 *
 * The rule the reload cases pin (#508): a watcher tick, a filter toggle or the
 * header refresh reloads what is on screen and never moves the user.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ClaudeProject, ClaudeSession, MessagePage } from "@/types";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ api: apiMock }));

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { useAppStore } from "@/store/useAppStore";
import type { FullAppStore } from "@/store/slices/types";
import { selectPlace } from "@/store/slices/navigationSlice";
import type { View } from "@/navigation/place";
import { useAnalyticsNavigation } from "@/hooks/analytics/useAnalyticsNavigation";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const project = (name: string, provider = "claude"): ClaudeProject => ({
  name,
  path: `/home/.claude/projects/${name}`,
  actual_path: `/home/${name}`,
  session_count: 1,
  message_count: 2,
  last_modified: "2026-08-19T00:00:00.000Z",
  provider,
});

const sessionOf = (p: ClaudeProject, id: string): ClaudeSession => ({
  session_id: id,
  actual_session_id: id,
  file_path: `${p.path}/${id}.jsonl`,
  project_name: p.name,
  message_count: 2,
  first_message_time: "2026-08-19T00:00:00.000Z",
  last_message_time: "2026-08-19T00:00:01.000Z",
  last_modified: "2026-08-19T00:00:01.000Z",
  has_tool_use: false,
  has_errors: false,
  provider: p.provider,
});

const ALPHA = project("alpha");
const BETA = project("beta");
const CODEX = project("gamma", "codex");
const ALPHA_S1 = sessionOf(ALPHA, "a1");
const BETA_S1 = sessionOf(BETA, "b1");
const CODEX_S1 = sessionOf(CODEX, "g1");
const SESSIONS: Record<string, ClaudeSession[]> = {
  [ALPHA.path]: [ALPHA_S1],
  [BETA.path]: [BETA_S1],
  [CODEX.path]: [CODEX_S1],
};

const EMPTY_PAGE: MessagePage = {
  messages: [],
  total_count: 0,
  has_more: false,
  next_offset: 0,
};

/** Per-command overrides; anything else gets a harmless default. */
let overrides: Record<string, (args: Record<string, unknown>) => unknown> = {};

const defaultApi = (command: string, args: Record<string, unknown> = {}) => {
  const override = overrides[command];
  if (override) return override(args);
  switch (command) {
    case "scan_projects":
    case "scan_all_projects":
      return [ALPHA, BETA, CODEX];
    case "load_provider_sessions_page": {
      const sessions = SESSIONS[String(args.projectPath)] ?? [];
      return { sessions, total: sessions.length, nextOffset: sessions.length, hasMore: false };
    }
    case "load_provider_session_by_path":
      return null;
    case "load_provider_messages_paginated":
      return EMPTY_PAGE;
    case "get_session_subagents":
      return [];
    case "get_project_stats_summary":
      return { total_sessions: 0, total_messages: 0 };
    default:
      return null;
  }
};

// ---------------------------------------------------------------------------
// The two adapters (see header)
// ---------------------------------------------------------------------------

interface ObservedPlace {
  view: View;
  project: string | null;
  session: string | null;
}

/** What the user sees: the screen and the context the sidebar keeps. */
function readPlace(state: FullAppStore = useAppStore.getState()): ObservedPlace {
  const place = selectPlace(state);
  return {
    view: place.view,
    project: place.project?.path ?? null,
    session: place.session?.filePath ?? null,
  };
}

const act = {
  /** Sidebar session click into its own project (App.handleSessionSelect). */
  async openSession(p: ClaudeProject, s: ClaudeSession) {
    await useAppStore.getState().navigate({ view: "conversation", project: p, session: s });
  },
  /** Global stats row in the sidebar (App.handleGlobalStatsClick). */
  async openGlobalStats() {
    const { result } = renderHook(() => useAnalyticsNavigation());
    await result.current.switchToGlobalStats();
  },
  /** App menu → Settings Manager / Archive (Header). */
  openAppScreen(view: "settingsManager" | "archive") {
    void useAppStore.getState().navigate({ view });
  },
  /** Mobile bottom tab bar (AppLayout `onSwitchView`). */
  async mobileTab(
    nav: ReturnType<typeof useAnalyticsNavigation>,
    tab: "messages" | "board" | "analytics" | "settings"
  ) {
    const VIEW = {
      messages: "conversation",
      board: "board",
      analytics: "analytics",
      settings: "settingsManager",
    } as const;
    await nav.openView(VIEW[tab]);
  },
  /** Sidebar re-click on the open project / provider filter dropping it. */
  leaveProject() {
    void useAppStore.getState().navigate({ project: null });
  },
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const pristine = useAppStore.getState();

beforeEach(() => {
  overrides = {};
  apiMock.mockReset();
  apiMock.mockImplementation(async (command: string, args?: Record<string, unknown>) =>
    defaultApi(command, args)
  );
  Object.values(toastMock).forEach((fn) => fn.mockReset());
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  useAppStore.setState(pristine, true);
  useAppStore.setState({
    claudePath: "/home/.claude",
    projects: [ALPHA, BETA, CODEX],
    activeProviders: ["claude", "codex"],
  });
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.restoreAllMocks();
});

const sessionLoadsFor = (s: ClaudeSession) =>
  apiMock.mock.calls.filter(
    ([command, args]) =>
      command === "load_provider_messages_paginated" &&
      (args as { sessionPath?: string }).sessionPath === s.file_path
  ).length;

// ---------------------------------------------------------------------------
// Reloads never move the user
// ---------------------------------------------------------------------------

describe("reload keeps the place", () => {
  it("a watcher tick on the open session while global stats is open", async () => {
    await act.openSession(ALPHA, ALPHA_S1);
    await act.openGlobalStats();
    const before = readPlace();
    expect(before).toEqual({ view: "globalStats", project: ALPHA.path, session: ALPHA_S1.file_path });

    vi.useFakeTimers();
    try {
      void useAppStore.getState().triggerSessionRefresh(ALPHA.path, ALPHA_S1.file_path);
      await vi.advanceTimersByTimeAsync(5000);
    } finally {
      vi.useRealTimers();
    }

    expect(readPlace()).toEqual(before);
  });

  it("the header refresh while global stats is open reloads the overview in place", async () => {
    await act.openSession(ALPHA, ALPHA_S1);
    await act.openGlobalStats();
    const before = readPlace();
    const statsCallsBefore = apiMock.mock.calls.filter(
      ([command]) => command === "get_global_stats_summary"
    ).length;

    await useAppStore.getState().refreshAllConversations();

    expect(readPlace()).toEqual(before);
    expect(
      apiMock.mock.calls.filter(([command]) => command === "get_global_stats_summary").length
    ).toBeGreaterThan(statsCallsBefore);
  });

  it("the header refresh on global stats opened from an empty start", async () => {
    await act.openGlobalStats();
    expect(readPlace()).toEqual({ view: "globalStats", project: null, session: null });

    await useAppStore.getState().refreshAllConversations();

    expect(readPlace()).toEqual({ view: "globalStats", project: null, session: null });
  });

  it("the header refresh on the Settings Manager keeps it and the project", async () => {
    await act.openSession(ALPHA, ALPHA_S1);
    act.openAppScreen("settingsManager");
    const before = readPlace();

    await useAppStore.getState().refreshAllConversations();

    expect(readPlace()).toEqual(before);
    expect(before.view).toBe("settingsManager");
  });

  it("a sidechain filter toggle on the archive keeps the archive", async () => {
    await act.openSession(ALPHA, ALPHA_S1);
    act.openAppScreen("archive");
    const before = readPlace();

    useAppStore.getState().setExcludeSidechain(!useAppStore.getState().excludeSidechain);
    await vi.waitFor(() => expect(sessionLoadsFor(ALPHA_S1)).toBeGreaterThanOrEqual(2));

    expect(readPlace()).toEqual(before);
  });

  it("a system-message filter toggle reloads the open conversation in place", async () => {
    await act.openSession(ALPHA, ALPHA_S1);
    const loadsBefore = sessionLoadsFor(ALPHA_S1);

    useAppStore.getState().setShowSystemMessages(!useAppStore.getState().showSystemMessages);
    await vi.waitFor(() => expect(sessionLoadsFor(ALPHA_S1)).toBe(loadsBefore + 1));

    expect(readPlace()).toEqual({
      view: "conversation",
      project: ALPHA.path,
      session: ALPHA_S1.file_path,
    });
  });

  it("the header refresh drops a project that no longer exists", async () => {
    await act.openSession(ALPHA, ALPHA_S1);
    overrides.scan_projects = () => [BETA, CODEX];
    overrides.scan_all_projects = () => [BETA, CODEX];

    await useAppStore.getState().refreshAllConversations();

    expect(readPlace()).toEqual({ view: "conversation", project: null, session: null });
  });
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe("navigation", () => {
  it("opening a session from global stats returns to the conversation", async () => {
    await act.openGlobalStats();
    await act.openSession(BETA, BETA_S1);

    expect(readPlace()).toEqual({
      view: "conversation",
      project: BETA.path,
      session: BETA_S1.file_path,
    });
  });

  it("A → analytics → back to the conversation is still A", async () => {
    await act.openSession(ALPHA, ALPHA_S1);
    const { result } = renderHook(() => useAnalyticsNavigation());

    await result.current.switchToAnalytics();
    expect(readPlace().view).toBe("analytics");

    result.current.switchToMessages();
    expect(readPlace()).toEqual({
      view: "conversation",
      project: ALPHA.path,
      session: ALPHA_S1.file_path,
    });
  });

  it("the Settings Manager keeps the project as its context", async () => {
    await act.openSession(ALPHA, ALPHA_S1);
    act.openAppScreen("settingsManager");

    expect(readPlace()).toEqual({
      view: "settingsManager",
      project: ALPHA.path,
      session: ALPHA_S1.file_path,
    });
  });

  it("a quick second project click wins over a slower first one", async () => {
    let releaseAlpha: () => void = () => {};
    overrides.load_provider_sessions_page = (args) => {
      if (args.projectPath === ALPHA.path) {
        return new Promise((resolve) => {
          releaseAlpha = () =>
            resolve({ sessions: [ALPHA_S1], total: 1, nextOffset: 1, hasMore: false });
        });
      }
      const sessions = SESSIONS[String(args.projectPath)] ?? [];
      return { sessions, total: sessions.length, nextOffset: sessions.length, hasMore: false };
    };

    const first = useAppStore.getState().selectProject(ALPHA);
    const second = useAppStore.getState().selectProject(BETA);
    await second;
    releaseAlpha();
    await first;

    const state = useAppStore.getState();
    expect(state.selectedProject?.path).toBe(BETA.path);
    expect(state.sessions.map((s) => s.file_path)).toEqual([BETA_S1.file_path]);
  });

  it("a failed session load keeps the target selected and reports it", async () => {
    overrides.load_provider_messages_paginated = () => {
      throw new Error("disk gone");
    };

    await act.openSession(ALPHA, ALPHA_S1);

    const state = useAppStore.getState();
    expect(readPlace(state)).toEqual({
      view: "conversation",
      project: ALPHA.path,
      session: ALPHA_S1.file_path,
    });
    expect(state.isLoadingMessages).toBe(false);
  });

  it("the board on a provider without board support falls back to the conversation", async () => {
    await act.openSession(CODEX, CODEX_S1);
    const { result } = renderHook(() => useAnalyticsNavigation());

    await result.current.switchToBoard();

    expect(readPlace().view).toBe("conversation");
    expect(toastMock.warning).toHaveBeenCalledTimes(1);
  });

  it("leaving the project on global stats keeps global stats", async () => {
    await act.openSession(ALPHA, ALPHA_S1);
    await act.openGlobalStats();

    act.leaveProject();

    expect(readPlace()).toEqual({ view: "globalStats", project: null, session: null });
  });

  it("leaving the project on a project screen falls back to the conversation", async () => {
    await act.openSession(ALPHA, ALPHA_S1);
    const { result } = renderHook(() => useAnalyticsNavigation());
    await result.current.switchToAnalytics();

    act.leaveProject();

    expect(readPlace()).toEqual({ view: "conversation", project: null, session: null });
  });

  it("mobile tabs leave global stats for the tapped screen", async () => {
    await act.openSession(ALPHA, ALPHA_S1);
    await act.openGlobalStats();
    const { result } = renderHook(() => useAnalyticsNavigation());

    await act.mobileTab(result.current, "messages");
    expect(readPlace()).toEqual({
      view: "conversation",
      project: ALPHA.path,
      session: ALPHA_S1.file_path,
    });

    await act.openGlobalStats();
    await act.mobileTab(result.current, "settings");
    expect(readPlace().view).toBe("settingsManager");
  });

  // jsdom has no Tauri internals, so this runs as the WebUI.
  it("opening a session writes the WebUI deep link, leaving the project clears it", async () => {
    await act.openSession(ALPHA, ALPHA_S1);
    expect(new URL(window.location.href).searchParams.get("session")).toBe(ALPHA_S1.session_id);

    act.leaveProject();
    expect(new URL(window.location.href).searchParams.get("session")).toBeNull();
  });
});
