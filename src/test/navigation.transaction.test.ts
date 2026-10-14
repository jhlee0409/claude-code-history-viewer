/**
 * The navigation transaction (plan §4.2) on the fully wired store: one epoch
 * per navigation, late results dropped, reloads that never move the user, and
 * back/forward through visited places.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ClaudeProject, ClaudeSession, MessagePage } from "@/types";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { useAppStore } from "@/store/useAppStore";
import { selectPlace } from "@/store/slices/navigationSlice";
import { useAnalyticsNavigation } from "@/hooks/analytics/useAnalyticsNavigation";

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
const A2 = sessionOf(A, "a2");
const B1 = sessionOf(B, "b1");
const LIST: Record<string, ClaudeSession[]> = { [A.path]: [A1, A2], [B.path]: [B1] };
const PAGE: MessagePage = { messages: [], total_count: 0, has_more: false, next_offset: 0 };

const pristine = useAppStore.getState();

type Gate = { release: () => void };
/** Session-page requests for these project paths wait for `release()`. */
let gates: Record<string, Gate> = {};

beforeEach(() => {
  gates = {};
  apiMock.mockReset();
  apiMock.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    if (command === "load_provider_sessions_page") {
      const sessions = LIST[String(args.projectPath)] ?? [];
      const page = { sessions, total: sessions.length, nextOffset: sessions.length, hasMore: false };
      const gate = gates[String(args.projectPath)];
      if (gate) {
        return new Promise((resolve) => {
          gate.release = () => resolve(page);
        });
      }
      return page;
    }
    if (command === "load_provider_messages_paginated") return PAGE;
    if (command === "get_session_subagents") return [];
    if (command === "get_project_stats_summary") return { total_sessions: 0 };
    return null;
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  useAppStore.setState(pristine, true);
  useAppStore.setState({ claudePath: "/home/.claude", projects: [A, B] });
  window.history.replaceState({}, "", "/");
});

const state = () => useAppStore.getState();
const where = () => {
  const place = selectPlace(state());
  return [place.view, place.project?.path ?? null, place.session?.filePath ?? null];
};

describe("navigate", () => {
  it("advances the epoch once per navigation and commits the screen before it loads", () => {
    const epoch = state().navigationEpoch;
    gates[A.path] = { release: () => {} };

    void state().navigate({ view: "analytics", project: A });

    expect(state().navigationEpoch).toBe(epoch + 1);
    expect(state().view).toBe("analytics");
  });

  it("drops a slower navigation that a newer one overtook", async () => {
    gates[A.path] = { release: () => {} };
    const first = state().navigate({ view: "conversation", project: A, session: A1 });
    const second = state().navigate({ view: "conversation", project: B, session: B1 });

    await expect(second).resolves.toBe(true);
    gates[A.path]!.release();
    await expect(first).resolves.toBe(false);

    expect(where()).toEqual(["conversation", B.path, B1.file_path]);
    // The overtaken one never asked for its session.
    expect(
      apiMock.mock.calls.some(
        ([command, args]) =>
          command === "load_provider_messages_paginated" &&
          (args as { sessionPath: string }).sessionPath === A1.file_path
      )
    ).toBe(false);
  });

  it("a claimed epoch loses to any navigation that starts after it (CLI/deep link)", async () => {
    const claimed = state().beginNavigation();
    await state().navigate({ view: "settingsManager" });

    await expect(
      state().navigate({ view: "conversation", project: B, session: B1 }, { epoch: claimed })
    ).resolves.toBe(false);
    expect(where()).toEqual(["settingsManager", null, null]);
  });

  it("a claimed epoch still owns navigation when nothing else moved", async () => {
    const claimed = state().beginNavigation();
    await expect(
      state().navigate({ view: "conversation", project: B, session: B1 }, { epoch: claimed })
    ).resolves.toBe(true);
    expect(state().navigationEpoch).toBe(claimed);
    expect(where()).toEqual(["conversation", B.path, B1.file_path]);
  });

  it("dropping the project keeps global stats and closes project screens", async () => {
    await state().navigate({ view: "conversation", project: A, session: A1 });
    await state().navigate({ view: "globalStats" });
    await state().navigate({ project: null });
    expect(where()).toEqual(["globalStats", null, null]);

    await state().navigate({ view: "board", project: A });
    await state().navigate({ project: null });
    expect(where()).toEqual(["conversation", null, null]);
  });

  it("an explicit message target lands with the session", async () => {
    await state().navigate({ view: "conversation", project: A, session: A1, messageId: "m-7" });
    expect(state().targetMessageUuid).toBe("m-7");
    const url = new URL(window.location.href);
    expect(url.searchParams.get("session")).toBe(A1.session_id);
    expect(url.searchParams.get("msg")).toBe("m-7");
  });

  it("history 'none' writes no URL (browser back/forward, CLI)", async () => {
    const before = window.history.length;
    await state().navigate(
      { view: "conversation", project: A, session: A1, messageId: "m-1" },
      { history: "none" }
    );
    expect(window.location.search).toBe("");
    expect(window.history.length).toBe(before);
  });
});

describe("reloadCurrent", () => {
  it("reloads the open session without moving the user or advancing the epoch", async () => {
    await state().navigate({ view: "conversation", project: A, session: A1 });
    await state().navigate({ view: "globalStats" });
    const epoch = state().navigationEpoch;
    const loads = () =>
      apiMock.mock.calls.filter(([command]) => command === "load_provider_messages_paginated")
        .length;
    const before = loads();

    await state().reloadCurrent("watcher");

    expect(loads()).toBe(before + 1);
    expect(state().navigationEpoch).toBe(epoch);
    expect(where()).toEqual(["globalStats", A.path, A1.file_path]);
  });

  it("ignores a record of another session file, so a reload cannot navigate", async () => {
    await state().navigate({ view: "conversation", project: A, session: A1 });

    await state().reloadCurrent("refresh", A2);

    expect(where()).toEqual(["conversation", A.path, A1.file_path]);
  });

  it("does not cancel a CLI hint that is still resolving", async () => {
    await state().navigate({ view: "conversation", project: A, session: A1 });
    const claimed = state().beginNavigation();

    await state().reloadCurrent("watcher");

    await expect(
      state().navigate({ view: "conversation", project: B, session: B1 }, { epoch: claimed })
    ).resolves.toBe(true);
  });

  it("restore only fills a conversation that came back empty", async () => {
    await state().navigate({ view: "conversation", project: A, session: A1 });
    useAppStore.setState({ messages: [{ uuid: "x" } as never] });
    const calls = apiMock.mock.calls.length;

    await state().reloadCurrent("restore");

    expect(apiMock.mock.calls.length).toBe(calls);
  });
});

describe("back / forward", () => {
  it("records visited places and walks them both ways, target included", async () => {
    const { result } = renderHook(() => useAnalyticsNavigation());
    await state().navigate({ view: "conversation", project: A, session: A1, messageId: "m-3" });
    await result.current.switchToAnalytics();
    await state().navigate({ view: "conversation", project: B, session: B1 });

    expect(await result.current.goBack()).toBe(true);
    expect(where()).toEqual(["analytics", A.path, A1.file_path]);

    expect(await result.current.goBack()).toBe(true);
    expect(where()).toEqual(["conversation", A.path, A1.file_path]);
    expect(state().targetMessageUuid).toBe("m-3");

    expect(await result.current.goForward()).toBe(true);
    expect(where()).toEqual(["analytics", A.path, A1.file_path]);
    expect(await result.current.goForward()).toBe(true);
    expect(where()).toEqual(["conversation", B.path, B1.file_path]);
    expect(await result.current.goForward()).toBe(false);
  });

  it("A → analytics → conversation is A again (single document)", async () => {
    const { result } = renderHook(() => useAnalyticsNavigation());
    await state().navigate({ view: "conversation", project: A, session: A1 });
    await result.current.switchToAnalytics();
    result.current.switchToMessages();
    expect(where()).toEqual(["conversation", A.path, A1.file_path]);
  });

  it("a new navigation after going back drops the forward branch", async () => {
    const { result } = renderHook(() => useAnalyticsNavigation());
    await state().navigate({ view: "conversation", project: A, session: A1 });
    await state().navigate({ view: "settingsManager" });
    await result.current.goBack();
    await state().navigate({ view: "archive" });
    expect(state().placeHistory.forward).toEqual([]);
    expect(await result.current.goForward()).toBe(false);
  });

  it("record:false moves without an entry (browser back/forward)", async () => {
    await state().navigate({ view: "conversation", project: A, session: A1 });
    const depth = state().placeHistory.back.length;
    await state().navigate({ view: "settingsManager" }, { record: false });
    expect(state().placeHistory.back.length).toBe(depth);
  });
});
