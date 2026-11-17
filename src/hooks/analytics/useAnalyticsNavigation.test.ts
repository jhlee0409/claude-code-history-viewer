/**
 * The Edits screen's loads through the navigation hook (T9b): the screen's
 * rows are `recentEditsSlice`'s, keyed by the request they answer (project,
 * scope, grouping, session). The slice's own tests pin request identity,
 * generations, paging and resets; these pin the navigation paths that load
 * it - opening the screen, refreshing it, the watcher's invalidation, a
 * project switch and provider gating.
 *
 * History: the page's cache guard once compared the cached `project_cwd`
 * (the most frequent `cwd` in the session logs) against `project.path` (the
 * encoded storage directory); the two are never equal, so every visit
 * re-walked every JSONL file. The request key carries `project.path` itself.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

const fetchRecentEdits = vi.fn();
vi.mock("../../services/analyticsApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/analyticsApi")>();
  return { ...actual, fetchRecentEdits: (...args: unknown[]) => fetchRecentEdits(...args) };
});

import { useAppStore } from "../../store/useAppStore";
import { useAnalyticsNavigation } from "./useAnalyticsNavigation";
import type { ClaudeProject } from "../../types";

const project = (name: string): ClaudeProject => ({
  name,
  // The encoded Claude storage path.
  path: "C:\\Users\\jpris\\.claude\\projects\\E--Projects-" + name,
  // The decoded filesystem path. Deliberately different from `path`.
  actual_path: "E:\\Projects\\" + name,
  session_count: 1,
  message_count: 1,
  last_modified: "2026-08-21T00:00:00.000Z",
});

const payload = (cwd: string, names: string[] = ["main.ts"], hasMore = false) => ({
  files: names.map((name) => ({
    file_path: cwd + "\\src\\" + name,
    timestamp: "2026-08-21T00:00:00.000Z",
    session_id: "s1",
    operation_type: "edit" as const,
    content_after_change: "after",
    lines_added: 1,
    lines_removed: 0,
  })),
  total_edits_count: names.length,
  unique_files_count: names.length,
  // The backend reports the real working directory, never the storage path.
  project_cwd: cwd,
  offset: 0,
  limit: 20,
  has_more: hasMore,
});

const state = () => useAppStore.getState();
const rowNames = () => state().recentEditsList?.files.map((f) => f.file_path.split("\\").pop());

function reset() {
  fetchRecentEdits.mockReset();
  useAppStore.setState({ selectedProject: null, selectedSession: null, view: "conversation", recentEditsScope: "project" });
  state().resetAnalytics();
  state().clearRecentEditsList();
}

describe("switchToRecentEdits loads the screen's rows", () => {
  beforeEach(reset);

  it("does not refetch when the same project is opened twice", async () => {
    const p = project("alpha");
    fetchRecentEdits.mockResolvedValue(payload(p.actual_path));
    useAppStore.setState({ selectedProject: p });
    const { result } = renderHook(() => useAnalyticsNavigation());

    await act(async () => {
      await result.current.switchToRecentEdits();
    });
    await act(async () => {
      await result.current.switchToRecentEdits();
    });

    expect(fetchRecentEdits).toHaveBeenCalledTimes(1);
    expect(state().view).toBe("edits");
    expect(state().recentEditsList?.request.projectPath).toBe(p.path);
  });

  it("refetches when a different project is opened", async () => {
    const a = project("alpha");
    const b = project("beta");
    fetchRecentEdits.mockImplementation((path: string) =>
      Promise.resolve(payload(path.includes("alpha") ? a.actual_path : b.actual_path))
    );
    useAppStore.setState({ selectedProject: a });
    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(async () => {
      await result.current.switchToRecentEdits();
    });
    await act(async () => {
      useAppStore.setState({ selectedProject: b });
    });
    await act(async () => {
      await result.current.switchToRecentEdits();
    });

    expect(fetchRecentEdits).toHaveBeenCalledTimes(2);
    expect(state().recentEditsList?.request.projectPath).toBe(b.path);
  });

  it("still caches when project_cwd diverges from actual_path", async () => {
    // project_cwd can point at a subdirectory, a previous location or differ
    // by drive-letter case; the request key never reads it.
    const p = project("gamma");
    fetchRecentEdits.mockResolvedValue(payload(p.actual_path + "\\_local\\initial-plan"));
    useAppStore.setState({ selectedProject: p });
    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(async () => {
      await result.current.switchToRecentEdits();
    });
    await act(async () => {
      await result.current.switchToRecentEdits();
    });
    expect(fetchRecentEdits).toHaveBeenCalledTimes(1);
  });

  it("caches a legitimately empty result (A1)", async () => {
    const p = project("empty");
    fetchRecentEdits.mockResolvedValue(payload(p.actual_path, []));
    useAppStore.setState({ selectedProject: p });
    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(async () => {
      await result.current.switchToRecentEdits();
    });
    await act(async () => {
      await result.current.switchToRecentEdits();
    });
    expect(fetchRecentEdits).toHaveBeenCalledTimes(1);
    expect(state().recentEditsList?.files).toEqual([]);
  });

  it("refresh reads the open screen again (C1)", async () => {
    const p = project("alpha");
    fetchRecentEdits.mockResolvedValueOnce(payload(p.actual_path, ["old.ts"]));
    useAppStore.setState({ selectedProject: p });
    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(async () => {
      await result.current.switchToRecentEdits();
    });

    fetchRecentEdits.mockResolvedValueOnce(payload(p.actual_path, ["new.ts"]));
    await act(async () => {
      await result.current.refreshAnalytics();
    });

    expect(fetchRecentEdits).toHaveBeenCalledTimes(2);
    expect(rowNames()).toEqual(["new.ts"]);
    expect(state().view).toBe("edits");
  });

  it("does not let a slow load overwrite a newer one for the same project (R1)", async () => {
    const p = project("alpha");
    let releaseSlow: ((value: unknown) => void) | undefined;
    fetchRecentEdits
      .mockImplementationOnce(() => new Promise((resolve) => (releaseSlow = resolve)))
      .mockResolvedValueOnce(payload(p.actual_path, ["fresh.ts"]));
    useAppStore.setState({ selectedProject: p });
    const { result } = renderHook(() => useAnalyticsNavigation());

    let slow!: Promise<void>;
    act(() => {
      slow = result.current.switchToRecentEdits();
    });
    await act(async () => {
      await result.current.refreshAnalytics();
    });
    await act(async () => {
      releaseSlow?.(payload(p.actual_path, ["stale.ts"]));
      await slow;
    });

    expect(rowNames()).toEqual(["fresh.ts"]);
    expect(state().isLoadingRecentEdits).toBe(false);
  });

  it("an answer for a project no longer selected lands under its own key only, never shown for the new one (C3)", async () => {
    const a = project("alpha");
    const b = project("beta");
    let resolveA: ((value: unknown) => void) | undefined;
    fetchRecentEdits
      .mockImplementationOnce(() => new Promise((resolve) => (resolveA = resolve)))
      .mockResolvedValueOnce(payload(b.actual_path, ["b.ts"]));
    useAppStore.setState({ selectedProject: a });
    const { result } = renderHook(() => useAnalyticsNavigation());
    let pendingA!: Promise<void>;
    act(() => {
      pendingA = result.current.switchToRecentEdits();
    });

    await act(async () => {
      useAppStore.setState({ selectedProject: b });
      await result.current.switchToRecentEdits();
    });
    await act(async () => {
      resolveA?.(payload(a.actual_path, ["a.ts"]));
      await pendingA;
    });

    // B asked last: A's late answer is disowned.
    expect(state().recentEditsList?.request.projectPath).toBe(b.path);
    expect(rowNames()).toEqual(["b.ts"]);
    expect(state().isLoadingRecentEdits).toBe(false);
  });

  it("deselecting the project drops its rows and never strands the spinner (C4)", async () => {
    const a = project("alpha");
    let resolveA: ((value: unknown) => void) | undefined;
    fetchRecentEdits.mockImplementationOnce(() => new Promise((resolve) => (resolveA = resolve)));
    useAppStore.setState({ selectedProject: a });
    const { result } = renderHook(() => useAnalyticsNavigation());
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.switchToRecentEdits();
    });
    expect(state().isLoadingRecentEdits).toBe(true);

    act(() => {
      state().clearProjectSelection();
    });
    expect(state().isLoadingRecentEdits).toBe(false);
    await act(async () => {
      resolveA?.(payload(a.actual_path));
      await pending;
    });
    expect(state().recentEditsList).toBeNull();
    expect(state().isLoadingRecentEdits).toBe(false);
  });
});

describe("recent-edits invalidation on file change", () => {
  beforeEach(reset);

  it("keeps the rows on screen, and the next visit reads them again", async () => {
    const p = project("alpha");
    fetchRecentEdits.mockResolvedValueOnce(payload(p.actual_path, ["before.ts"]));
    useAppStore.setState({ selectedProject: p });
    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(async () => {
      await result.current.switchToRecentEdits();
    });

    act(() => state().invalidateRecentEdits(p.path));
    expect(rowNames()).toEqual(["before.ts"]);

    fetchRecentEdits.mockResolvedValueOnce(payload(p.actual_path, ["after.ts"]));
    await act(async () => {
      await result.current.switchToRecentEdits();
    });
    expect(fetchRecentEdits).toHaveBeenCalledTimes(2);
    expect(rowNames()).toEqual(["after.ts"]);
  });

  it("leaves another project's rows alone", async () => {
    const p = project("alpha");
    fetchRecentEdits.mockResolvedValue(payload(p.actual_path));
    useAppStore.setState({ selectedProject: p });
    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(async () => {
      await result.current.switchToRecentEdits();
    });
    act(() => state().invalidateRecentEdits(project("beta").path));
    await act(async () => {
      await result.current.switchToRecentEdits();
    });
    expect(fetchRecentEdits).toHaveBeenCalledTimes(1);
  });

  it("stops an in-flight load-more from appending to a list that went stale", async () => {
    const p = project("alpha");
    fetchRecentEdits.mockResolvedValueOnce(payload(p.actual_path, ["a.ts"], true));
    useAppStore.setState({ selectedProject: p });
    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(async () => {
      await result.current.switchToRecentEdits();
    });

    let releasePage: ((value: unknown) => void) | undefined;
    fetchRecentEdits.mockImplementationOnce(() => new Promise((resolve) => (releasePage = resolve)));
    const request = state().recentEditsList!.request;
    let more!: Promise<void>;
    act(() => {
      more = state().loadMoreRecentEditsList(request);
    });
    // A file the page was read from changed: its offsets may have moved.
    act(() => state().invalidateRecentEdits(p.path));
    await act(async () => {
      releasePage?.({ ...payload(p.actual_path, ["b.ts"]), offset: 1 });
      await more;
    });

    expect(rowNames()).toEqual(["a.ts"]);
    expect(state().isLoadingMoreRecentEdits).toBe(false);
  });
});

describe("switchToRecentEdits provider gating (#643)", () => {
  beforeEach(reset);

  it("opens the view without requesting edits for an oh-my-pi project", async () => {
    useAppStore.setState({
      selectedProject: {
        ...project("omp"),
        path: "/Users/x/.omp/agent/sessions/-Users-x-omp",
        provider: "ompi",
      },
    });

    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(async () => {
      await result.current.switchToRecentEdits();
    });

    expect(fetchRecentEdits).not.toHaveBeenCalled();
    expect(state().view).toBe("edits");
    expect(state().isLoadingRecentEdits).toBe(false);
    expect(state().recentEditsError).toBeNull();
  });
});
