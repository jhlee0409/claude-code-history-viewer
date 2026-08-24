/**
 * Regression tests for the Recent Edits fetch cache.
 *
 * The cache guard in `switchToRecentEdits` used to compare the cached
 * `project_cwd` (the most frequent `cwd` seen in the session logs) against
 * `project.path` (the encoded Claude storage directory). Those two values are
 * never equal, so every visit to Recent Edits re-walked and re-parsed every
 * JSONL file in the project. Measured across 28 real projects, the guard held
 * 0 times.
 *
 * The guard now compares `requestedProjectPath`, which is the `project.path`
 * the cached result was actually fetched for.
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

const payload = (cwd: string) => ({
  files: [
    {
      file_path: cwd + "\\src\\main.ts",
      timestamp: "2026-08-21T00:00:00.000Z",
      session_id: "s1",
      operation_type: "edit" as const,
      content_after_change: "after",
      lines_added: 1,
      lines_removed: 0,
    },
  ],
  total_edits_count: 1,
  unique_files_count: 1,
  // The backend reports the real working directory, never the storage path.
  project_cwd: cwd,
  offset: 0,
  limit: 20,
  has_more: false,
});

describe("switchToRecentEdits cache", () => {
  beforeEach(() => {
    fetchRecentEdits.mockReset();
    useAppStore.setState({ selectedProject: null, selectedSession: null });
    useAppStore.getState().resetAnalytics();
  });

  it("does not refetch when the same project is opened twice", async () => {
    const p = project("alpha");
    fetchRecentEdits.mockResolvedValue(payload(p.actual_path));
    useAppStore.setState({ selectedProject: p });

    const { result } = renderHook(() => useAnalyticsNavigation());

    await act(async () => {
      await result.current.switchToRecentEdits();
    });
    expect(fetchRecentEdits).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.switchToRecentEdits();
    });
    expect(fetchRecentEdits).toHaveBeenCalledTimes(1);
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
    expect(fetchRecentEdits).toHaveBeenCalledTimes(1);

    await act(async () => {
      useAppStore.setState({ selectedProject: b });
    });
    await act(async () => {
      await result.current.switchToRecentEdits();
    });
    expect(fetchRecentEdits).toHaveBeenCalledTimes(2);
  });

  it("still caches when project_cwd diverges from actual_path", async () => {
    // Measured on real data: project_cwd is the most frequent `cwd` in the
    // session logs, so it can point at a subdirectory of the project (sessions
    // run from inside it), at a previous location (a moved project), or differ
    // only by drive-letter case. In a 28-project sample it disagreed with
    // actual_path 3 times. Matching on either derived path would silently
    // reintroduce the always-miss for those projects.
    const p = project("gamma");
    fetchRecentEdits.mockResolvedValue(
      payload(p.actual_path + "\\_local\\initial-plan")
    );
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

  it("refetches after a refresh clears the cache (C1)", async () => {
    // `refreshAnalytics` clears the cache and calls switchToRecentEdits in the
    // same tick. Reading the cache from the render closure sees the pre-clear
    // value, reports a hit, and leaves the view empty. This only became
    // reachable once the guard started actually holding.
    const p = project("alpha");
    fetchRecentEdits.mockResolvedValue(payload(p.actual_path));
    useAppStore.setState({ selectedProject: p });

    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(async () => {
      await result.current.switchToRecentEdits();
    });
    expect(fetchRecentEdits).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refreshAnalytics();
    });

    expect(fetchRecentEdits).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().analytics.recentEdits?.files.length).toBe(1);
  });

  it("does not write a result for a project that is no longer selected (C3)", async () => {
    const a = project("alpha");
    const b = project("beta");
    let resolveA;
    fetchRecentEdits.mockImplementationOnce(
      () => new Promise((resolve) => (resolveA = resolve))
    );

    useAppStore.setState({ selectedProject: a });
    const { result } = renderHook(() => useAnalyticsNavigation());
    const pending = result.current.switchToRecentEdits();

    await act(async () => {
      useAppStore.setState({ selectedProject: b });
    });

    await act(async () => {
      resolveA?.(payload(a.actual_path));
      await pending;
    });

    // A landed last but B is selected, so A must not install itself as the
    // cache under its own key.
    expect(
      useAppStore.getState().analytics.recentEdits?.requestedProjectPath
    ).not.toBe(a.path);
  });

  it("does not strand the loading flag when its project is deselected (C4)", async () => {
    // Second-pass finding. The C3 ownership guard made the finally clear the
    // flag only when the requesting project is still selected. If the user
    // switches away and never opens Recent Edits for the new project, nothing
    // else clears it: `resetAnalytics` runs in `clearProjectSelection`, not on a
    // project switch, so the page view keeps a spinner up forever.
    const a = project("alpha");
    const b = project("beta");
    let resolveA;
    fetchRecentEdits.mockImplementationOnce(
      () => new Promise((resolve) => (resolveA = resolve))
    );

    useAppStore.setState({ selectedProject: a });
    const { result } = renderHook(() => useAnalyticsNavigation());
    const pending = result.current.switchToRecentEdits();
    expect(useAppStore.getState().analytics.isLoadingRecentEdits).toBe(true);

    await act(async () => {
      useAppStore.setState({ selectedProject: b });
    });
    await act(async () => {
      resolveA?.(payload(a.actual_path));
      await pending;
    });

    expect(useAppStore.getState().analytics.isLoadingRecentEdits).toBe(false);
  });

  it("refuses to extend a cache entry from another project (C2)", async () => {
    const a = project("alpha");
    const b = project("beta");
    fetchRecentEdits.mockResolvedValue(payload(a.actual_path));
    useAppStore.setState({ selectedProject: a });

    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(async () => {
      await result.current.switchToRecentEdits();
    });

    useAppStore.setState({
      analytics: {
        ...useAppStore.getState().analytics,
        recentEditsPagination: {
          totalEditsCount: 100,
          uniqueFilesCount: 100,
          offset: 0,
          limit: 20,
          hasMore: true,
          isLoadingMore: false,
        },
      },
    });
    const callsBefore = fetchRecentEdits.mock.calls.length;

    await act(async () => {
      await useAppStore.getState().loadMoreRecentEdits(b.path);
    });

    // Appending B's page onto A's rows would tag the mixture with B's identity
    // and the guard would then accept it forever.
    expect(fetchRecentEdits).toHaveBeenCalledTimes(callsBefore);
  });

  it("caches a legitimately empty result (A1)", async () => {
    // `files.length > 0` made a project with no edits miss the cache on every
    // visit and re-walk its whole JSONL set. With request identity on the entry,
    // an empty list is a valid answer rather than an absent one.
    const p = project("empty");
    fetchRecentEdits.mockResolvedValue({
      ...payload(p.actual_path),
      files: [],
      total_edits_count: 0,
      unique_files_count: 0,
    });
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

  it("refuses a blank project path on load-more (A2)", async () => {
    // Pagination has to be loadable, or `canLoadMore` returns early and the
    // test passes without ever reaching the guard under test.
    useAppStore.setState((state) => ({
      analytics: {
        ...state.analytics,
        recentEditsPagination: {
          totalEditsCount: 100,
          uniqueFilesCount: 100,
          offset: 0,
          limit: 20,
          hasMore: true,
          isLoadingMore: false,
        },
      },
    }));

    await act(async () => {
      await useAppStore.getState().loadMoreRecentEdits("");
    });

    expect(fetchRecentEdits).not.toHaveBeenCalled();
  });

  it("does not land a load-more page for a deselected project (A3)", async () => {
    // The pre-await guard only proves ownership when the request starts. Without
    // a post-await check, project A's page lands under B's pagination state.
    const a = project("alpha");
    const b = project("beta");
    fetchRecentEdits.mockResolvedValueOnce(payload(a.actual_path));
    useAppStore.setState({ selectedProject: a });

    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(async () => {
      await result.current.switchToRecentEdits();
    });

    useAppStore.setState((state) => ({
      analytics: {
        ...state.analytics,
        recentEditsPagination: {
          totalEditsCount: 100,
          uniqueFilesCount: 100,
          offset: 0,
          limit: 20,
          hasMore: true,
          isLoadingMore: false,
        },
      },
    }));

    let resolveMore;
    fetchRecentEdits.mockImplementationOnce(
      () => new Promise((resolve) => (resolveMore = resolve))
    );
    const pending = useAppStore.getState().loadMoreRecentEdits(a.path);

    await act(async () => {
      useAppStore.setState({ selectedProject: b });
    });
    await act(async () => {
      resolveMore?.({
        ...payload(a.actual_path),
        files: [{ ...payload(a.actual_path).files[0], file_path: "late.ts" }],
      });
      await pending;
    });

    const files = useAppStore.getState().analytics.recentEdits?.files ?? [];
    expect(files.some((f) => f.file_path === "late.ts")).toBe(false);
    // And the flag must not be stranded, or every future page is blocked.
    expect(
      useAppStore.getState().analytics.recentEditsPagination.isLoadingMore
    ).toBe(false);
  });

  it("records the requested project path on the cached result", async () => {
    const p = project("alpha");
    fetchRecentEdits.mockResolvedValue(payload(p.actual_path));
    useAppStore.setState({ selectedProject: p });

    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(async () => {
      await result.current.switchToRecentEdits();
    });

    const cached = useAppStore.getState().analytics.recentEdits;
    expect(cached?.requestedProjectPath).toBe(p.path);
    // The guard must not fall back to either derived path. Both are wrong:
    // project_cwd never equals path, and it is not reliably equal to
    // actual_path either.
    expect(cached?.project_cwd).not.toBe(p.path);
  });
});

/**
 * Round 4. `switchToRecentEdits` guarded its commit on the selected project,
 * which cannot tell two requests for the *same* project apart. The request
 * sequence it already keeps was consulted only in the `finally`.
 */
describe("switchToRecentEdits request identity", () => {
  beforeEach(() => {
    fetchRecentEdits.mockReset();
    useAppStore.setState({ selectedProject: null, selectedSession: null });
    useAppStore.getState().resetAnalytics();
  });

  it("does not let a slow load overwrite a newer one for the same project (R1)", async () => {
    // Refreshing while the first load is still in flight starts a second
    // request for the same project. The project-path guard passes for both, so
    // the slower one used to land last and win.
    const p = project("alpha");
    useAppStore.setState({ selectedProject: p });

    let resolveFirst: ((value: unknown) => void) | undefined;
    let resolveSecond: ((value: unknown) => void) | undefined;
    fetchRecentEdits
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve))
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveSecond = resolve))
      );

    const { result } = renderHook(() => useAnalyticsNavigation());

    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    await act(async () => {
      first = result.current.switchToRecentEdits();
      second = result.current.switchToRecentEdits();
    });

    // The newer request answers first.
    await act(async () => {
      resolveSecond?.(payload("FRESH"));
      await second;
    });
    // The older one answers late, for the project that is still selected.
    await act(async () => {
      resolveFirst?.(payload("STALE"));
      await first;
    });

    expect(useAppStore.getState().analytics.recentEdits?.project_cwd).toBe(
      "FRESH"
    );
  });
});
