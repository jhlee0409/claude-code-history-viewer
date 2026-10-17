/**
 * The palette's message search (plan T10): one request per settled query,
 * owned by the query, scope and filter it was asked for. A newer query, a
 * scope change or closing the palette abandons the request in flight - its
 * answer, success or failure, never lands - and results of an older query
 * are never shown under a newer one.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeMessage, ClaudeProject } from "@/types";
import {
  buildMessageSearchRequest,
  MESSAGE_SEARCH_DEBOUNCE_MS,
  usePaletteMessageSearch,
  type MessageSearchInput,
} from "./usePaletteMessageSearch";

const { mockApi, storeState } = vi.hoisted(() => ({
  mockApi: vi.fn(),
  storeState: {
    claudePath: "/home/.claude",
    activeProviders: ["claude"] as string[],
    userMetadata: { settings: { wsl: { enabled: false, excludedDistros: [] as string[] } } } as Record<string, unknown>,
  },
}));
vi.mock("@/services/api", () => ({ api: mockApi }));
vi.mock("@/store/useAppStore", () => ({
  useAppStore: Object.assign(() => storeState, { getState: () => storeState }),
}));

const project = (extra: Partial<ClaudeProject> = {}): ClaudeProject => ({
  name: "-Users-me-alpha",
  path: "/home/.claude/projects/-Users-me-alpha",
  actual_path: "/Users/me/alpha",
  session_count: 1,
  message_count: 1,
  last_modified: "",
  provider: "claude",
  ...extra,
});

const message = (uuid: string): ClaudeMessage =>
  ({ uuid, sessionId: "s", timestamp: "", type: "user", content: uuid }) as unknown as ClaudeMessage;

const input = (extra: Partial<MessageSearchInput> = {}): MessageSearchInput => ({
  query: "hello",
  scope: "all",
  messageType: "all",
  project: null,
  enabled: true,
  ...extra,
});

/** A request the test answers itself. */
function held() {
  let resolve!: (value: ClaudeMessage[]) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<ClaudeMessage[]>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flushDebounce = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(MESSAGE_SEARCH_DEBOUNCE_MS);
  });

beforeEach(() => {
  vi.useFakeTimers();
  mockApi.mockReset();
  storeState.claudePath = "/home/.claude";
  storeState.activeProviders = ["claude"];
  storeState.userMetadata = { settings: { wsl: { enabled: false, excludedDistros: [] } } };
});

describe("buildMessageSearchRequest", () => {
  const config = {
    claudePath: "/home/.claude",
    activeProviders: ["claude", "codex"],
    customClaudePaths: undefined,
    wslEnabled: false,
    wslExcludedDistros: [],
  };

  it("searches nothing below two characters", () => {
    expect(buildMessageSearchRequest(input({ query: " h " }), config)).toBeNull();
  });

  it("scope 'all' searches every active provider", () => {
    expect(buildMessageSearchRequest(input(), config)).toEqual({
      command: "search_all_providers",
      args: expect.objectContaining({ query: "hello", activeProviders: ["claude", "codex"], filters: {} }),
    });
  });

  it("scope 'project' searches the open project's folder and provider only", () => {
    const codex = project({ provider: "codex", path: "codex:///work/repo", name: "repo" });
    expect(buildMessageSearchRequest(input({ scope: "project", project: codex, messageType: "user" }), config)).toEqual({
      command: "search_all_providers",
      args: expect.objectContaining({
        activeProviders: ["codex"],
        filters: { projects: ["repo"], messageType: "user" },
      }),
    });
    // Claude Code alone: the one-provider command.
    expect(
      buildMessageSearchRequest(input({ scope: "project", project: project() }), { ...config, activeProviders: ["claude"] }),
    ).toEqual({
      command: "search_messages",
      args: expect.objectContaining({ filters: { projects: ["-Users-me-alpha"] } }),
    });
  });
});

describe("usePaletteMessageSearch", () => {
  it("asks once the query has settled, then shows the results", async () => {
    mockApi.mockResolvedValue([message("m1")]);
    const { result, rerender } = renderHook((props: MessageSearchInput) => usePaletteMessageSearch(props), {
      initialProps: input({ query: "he" }),
    });
    rerender(input({ query: "hel" }));
    rerender(input({ query: "hello" }));
    expect(result.current.view.status).toBe("loading");
    expect(mockApi).not.toHaveBeenCalled();
    await flushDebounce();
    expect(mockApi).toHaveBeenCalledTimes(1);
    expect(mockApi.mock.calls[0]?.[1]).toMatchObject({ query: "hello" });
    expect(result.current.view).toMatchObject({ status: "done", query: "hello", results: [message("m1")] });
  });

  it("ignores a stale answer: the older query's results never replace the newer ones", async () => {
    const first = held();
    const second = held();
    mockApi.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook((props: MessageSearchInput) => usePaletteMessageSearch(props), {
      initialProps: input({ query: "hello" }),
    });
    await flushDebounce();
    rerender(input({ query: "hello world" }));
    await flushDebounce();
    expect(mockApi).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve([message("new")]));
    await act(async () => first.resolve([message("old")]));
    expect(result.current.view).toMatchObject({ status: "done", query: "hello world", results: [message("new")] });
  });

  it("shows loading, not the previous query's results, while a newer query is pending", async () => {
    mockApi.mockResolvedValueOnce([message("old")]);
    const { result, rerender } = renderHook((props: MessageSearchInput) => usePaletteMessageSearch(props), {
      initialProps: input({ query: "hello" }),
    });
    await flushDebounce();
    expect(result.current.view.status).toBe("done");
    const pending = held();
    mockApi.mockReturnValueOnce(pending.promise);
    rerender(input({ query: "hello w" }));
    expect(result.current.view.status).toBe("loading");
    await flushDebounce();
    expect(result.current.view.status).toBe("loading");
  });

  it("a stale failure does not show an error over the newer query", async () => {
    const first = held();
    mockApi.mockReturnValueOnce(first.promise).mockResolvedValueOnce([message("new")]);
    const { result, rerender } = renderHook((props: MessageSearchInput) => usePaletteMessageSearch(props), {
      initialProps: input({ query: "hello" }),
    });
    await flushDebounce();
    rerender(input({ query: "hello world" }));
    await flushDebounce();
    await act(async () => first.reject(new Error("boom")));
    expect(result.current.view).toMatchObject({ status: "done", query: "hello world" });
  });

  it("a scope change is a new request; the old scope's answer is dropped", async () => {
    const all = held();
    mockApi.mockReturnValueOnce(all.promise).mockResolvedValueOnce([message("scoped")]);
    const { result, rerender } = renderHook((props: MessageSearchInput) => usePaletteMessageSearch(props), {
      initialProps: input(),
    });
    await flushDebounce();
    rerender(input({ scope: "project", project: project() }));
    await flushDebounce();
    await act(async () => all.resolve([message("everywhere")]));
    expect(mockApi.mock.calls[1]?.[1]).toMatchObject({ filters: { projects: ["-Users-me-alpha"] } });
    expect(result.current.view).toMatchObject({ status: "done", results: [message("scoped")] });
  });

  it("closing cancels: no request after it, and a request in flight lands nowhere", async () => {
    const pending = held();
    mockApi.mockReturnValueOnce(pending.promise);
    const { result, rerender, unmount } = renderHook((props: MessageSearchInput) => usePaletteMessageSearch(props), {
      initialProps: input(),
    });
    await flushDebounce();
    rerender(input({ enabled: false }));
    await act(async () => pending.resolve([message("late")]));
    expect(result.current.view.status).toBe("idle");
    rerender(input({ enabled: false, query: "hello again" }));
    await flushDebounce();
    expect(mockApi).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("a pending debounce is cancelled on unmount", async () => {
    const { unmount } = renderHook(() => usePaletteMessageSearch(input()));
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MESSAGE_SEARCH_DEBOUNCE_MS * 2);
    });
    expect(mockApi).not.toHaveBeenCalled();
  });

  it("a failure shows as an error of that query; retry asks again", async () => {
    mockApi.mockRejectedValueOnce(new Error("disk")).mockResolvedValueOnce([message("m1")]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => usePaletteMessageSearch(input()));
    await flushDebounce();
    expect(result.current.view).toMatchObject({ status: "error", query: "hello" });
    act(() => result.current.retry());
    expect(result.current.view.status).toBe("loading");
    await flushDebounce();
    expect(mockApi).toHaveBeenCalledTimes(2);
    expect(result.current.view).toMatchObject({ status: "done", results: [message("m1")] });
  });

  it("a project whose provider the search cannot reach is reported, not searched", async () => {
    storeState.activeProviders = ["claude", "codex"];
    const wslCodex = project({ provider: "codex", custom_directory_label: "WSL: Ubuntu" });
    const { result } = renderHook(() => usePaletteMessageSearch(input({ scope: "project", project: wslCodex })));
    await flushDebounce();
    expect(result.current.view.status).toBe("unsearchable");
    expect(mockApi).not.toHaveBeenCalled();
  });

  it("does not ask again when the store hands out equal settings in new objects", async () => {
    mockApi.mockResolvedValue([]);
    const { rerender } = renderHook((props: MessageSearchInput) => usePaletteMessageSearch(props), {
      initialProps: input(),
    });
    await flushDebounce();
    storeState.activeProviders = [...storeState.activeProviders];
    storeState.userMetadata = { settings: { wsl: { enabled: false, excludedDistros: [] } } };
    rerender(input());
    await flushDebounce();
    expect(mockApi).toHaveBeenCalledTimes(1);
  });
});
