import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { api } from "@/services/api";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeProject, ClaudeSession } from "@/types";
import { clearSessionNameIndexCache, useSessionNameIndex } from "./useSessionNameIndex";

vi.mock("@/services/api", () => ({ api: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const project = (name: string): ClaudeProject => ({
  name, path: `/history/${name}`, actual_path: `/work/${name}`,
  session_count: 1, message_count: 1, last_modified: "2026-10-01T00:00:00Z", provider: "claude",
});

const good = project("good");
const broken = project("broken");
const goodSessions = [{ session_id: "s1", summary: "Fix login bug" }] as ClaudeSession[];

describe("useSessionNameIndex", () => {
  beforeEach(() => {
    clearSessionNameIndexCache();
    useAppStore.setState({ lastUpdateTime: {} });
    vi.mocked(api).mockReset();
    vi.mocked(toast.error).mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(api).mockImplementation(async (_command, args) => {
      const { projectPath } = args as { projectPath: string };
      if (projectPath === broken.path) throw new Error("unreadable");
      return goodSessions;
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("loads nothing while disabled", () => {
    const { result } = renderHook(() => useSessionNameIndex([good], false));
    expect(api).not.toHaveBeenCalled();
    expect(result.current.isIndexing).toBe(false);
  });

  it("counts a failed project as done and reports it once, retrying it in a new search", async () => {
    const { result, rerender, unmount } = renderHook(
      ({ enabled }) => useSessionNameIndex([good, broken], enabled),
      { initialProps: { enabled: true } }
    );

    await waitFor(() => expect(result.current.isIndexing).toBe(false));
    expect(result.current.sessionsByProject.get(good.path)).toEqual(goodSessions);
    expect(result.current.sessionsByProject.has(broken.path)).toBe(false);
    expect(result.current.loadedCount).toBe(2);
    expect(result.current.totalCount).toBe(2);
    expect(toast.error).toHaveBeenCalledTimes(1);

    // Same search session: the failure is not retried.
    rerender({ enabled: true });
    expect(api).toHaveBeenCalledTimes(2);

    // New search session: only the failed project is read again, and the
    // same failure is not reported twice.
    rerender({ enabled: false });
    rerender({ enabled: true });
    await waitFor(() => expect(api).toHaveBeenCalledTimes(3));
    // The retry has settled once its failure is logged.
    await waitFor(() => expect(console.error).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.isIndexing).toBe(false));
    expect(toast.error).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("re-reads a project after a watcher update, keeping its old list meanwhile", async () => {
    const renamed = [{ session_id: "s1", summary: "Renamed later" }] as ClaudeSession[];
    const { result } = renderHook(() => useSessionNameIndex([good], true));
    await waitFor(() => expect(result.current.sessionsByProject.get(good.path)).toEqual(goodSessions));

    vi.mocked(api).mockResolvedValue(renamed);
    act(() => useAppStore.getState().markProjectUpdated(good.path));

    expect(result.current.sessionsByProject.get(good.path)).toEqual(goodSessions);
    await waitFor(() => expect(result.current.sessionsByProject.get(good.path)).toEqual(renamed));
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("keeps one concurrency limit across runs superseded by watcher updates", async () => {
    const many = Array.from({ length: 6 }, (_, i) => project(`p${i}`));
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    vi.mocked(api).mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return goodSessions;
    });

    const { result } = renderHook(() => useSessionNameIndex(many, true));
    await waitFor(() => expect(releases).toHaveLength(4));
    act(() => useAppStore.getState().markProjectUpdated(many[0]!.path));
    act(() => useAppStore.getState().markProjectUpdated(many[5]!.path));

    while (result.current.isIndexing || releases.length > 0) {
      await act(async () => {
        releases.splice(0).forEach((release) => release());
        await Promise.resolve();
      });
    }
    expect(peak).toBeLessThanOrEqual(4);
    expect(result.current.loadedCount).toBe(6);
  });

  it("still reports a failure when the run that saw it was superseded", async () => {
    const slow = project("slow");
    const releases: Array<() => void> = [];
    vi.mocked(api).mockImplementation(async (_command, args) => {
      const { projectPath } = args as { projectPath: string };
      if (projectPath === broken.path) throw new Error("unreadable");
      await new Promise<void>((resolve) => releases.push(resolve));
      return goodSessions;
    });

    const { result } = renderHook(() => useSessionNameIndex([broken, slow], true));
    await waitFor(() => expect(releases).toHaveLength(1));
    // The first run saw `broken` fail but is cancelled before its toast.
    act(() => useAppStore.getState().markProjectUpdated(slow.path));
    await waitFor(() => expect(releases).toHaveLength(2));
    await act(async () => {
      releases.forEach((release) => release());
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.isIndexing).toBe(false));
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
