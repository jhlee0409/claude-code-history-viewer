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

import { toast } from "sonner";
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

/**
 * Round 4. The load-more commit proved *whose* project a page belonged to but
 * not *which version* of the list it was fetched against, so a refresh landing
 * mid-flight let a later page append onto a list it did not continue.
 */
describe("loadMoreRecentEdits generation", () => {
  const rows = (names: string[]) =>
    names.map((file_path) => ({
      file_path,
      timestamp: "2026-08-21T00:00:00.000Z",
      session_id: "s1",
      operation_type: "edit" as const,
      content_after_change: "after",
      lines_added: 1,
      lines_removed: 0,
    }));

  const pageOf = (names: string[], offset: number, hasMore: boolean) => ({
    files: rows(names),
    total_edits_count: 100,
    unique_files_count: 100,
    project_cwd: "E:\\Projects\\alpha",
    offset,
    limit: 20,
    has_more: hasMore,
  });

  /** Load page 1 for `p` and leave the cursor open. */
  const seedFirstPage = async (p: ReturnType<typeof project>) => {
    fetchRecentEdits.mockResolvedValueOnce(pageOf(["a.ts", "b.ts"], 0, true));
    useAppStore.setState({ selectedProject: p });
    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(async () => {
      await result.current.switchToRecentEdits();
    });
  };

  beforeEach(() => {
    fetchRecentEdits.mockReset();
    useAppStore.setState({ selectedProject: null, selectedSession: null });
    useAppStore.getState().resetAnalytics();
  });

  it("discards a page whose list was replaced while it was in flight (R2)", async () => {
    // The replacement has the same length and the same owner, so neither the
    // ownership guard nor a length comparison can catch it. Only a generation
    // can.
    const p = project("alpha");
    await seedFirstPage(p);

    let resolveMore: ((value: unknown) => void) | undefined;
    fetchRecentEdits.mockImplementationOnce(
      () => new Promise((resolve) => (resolveMore = resolve))
    );
    const pending = useAppStore.getState().loadMoreRecentEdits(p.path);

    await act(async () => {
      useAppStore.getState().setAnalyticsRecentEdits({
        files: rows(["fresh-a.ts", "fresh-b.ts"]),
        total_edits_count: 100,
        unique_files_count: 100,
        project_cwd: "E:\\Projects\\alpha",
        requestedProjectPath: p.path,
      });
    });

    await act(async () => {
      resolveMore?.(pageOf(["late.ts"], 2, true));
      await pending;
    });

    expect(
      (useAppStore.getState().analytics.recentEdits?.files ?? []).map(
        (f) => f.file_path
      )
    ).toEqual(["fresh-a.ts", "fresh-b.ts"]);
    expect(
      useAppStore.getState().analytics.recentEditsPagination.isLoadingMore
    ).toBe(false);
  });

  it("does not rebuild a cleared cache out of a later page (R3)", async () => {
    // A page landing on a cleared cache used to append onto nothing and claim
    // the result as the whole list. If the refresh that cleared the cache then
    // failed, that later-page-only list passed the cache-hit test forever.
    const p = project("alpha");
    await seedFirstPage(p);

    let resolveMore: ((value: unknown) => void) | undefined;
    fetchRecentEdits.mockImplementationOnce(
      () => new Promise((resolve) => (resolveMore = resolve))
    );
    const pending = useAppStore.getState().loadMoreRecentEdits(p.path);

    await act(async () => {
      useAppStore.getState().setAnalyticsRecentEdits(null);
    });

    await act(async () => {
      resolveMore?.(pageOf(["late.ts"], 2, true));
      await pending;
    });

    expect(useAppStore.getState().analytics.recentEdits).toBeNull();
    expect(
      useAppStore.getState().analytics.recentEditsPagination.isLoadingMore
    ).toBe(false);
  });

  it("asks for the page after the rows it holds, not after the stored cursor (R4)", async () => {
    // A refresh that replaces the list without resetting the cursor leaves the
    // two disagreeing. Deriving the offset from the rows actually held cannot
    // desync, which is the same rule the dock panel already follows.
    const p = project("alpha");
    await seedFirstPage(p);

    useAppStore.setState((state) => ({
      analytics: {
        ...state.analytics,
        recentEditsPagination: {
          ...state.analytics.recentEditsPagination,
          offset: 60,
        },
      },
    }));

    fetchRecentEdits.mockResolvedValueOnce(pageOf(["c.ts"], 2, false));
    await act(async () => {
      await useAppStore.getState().loadMoreRecentEdits(p.path);
    });

    expect(fetchRecentEdits).toHaveBeenLastCalledWith(
      p.path,
      expect.objectContaining({ offset: 2 })
    );
  });

  it("does not reuse a generation across a reset (R7)", async () => {
    // `resetAnalytics` restored the whole initial state, generation included,
    // so the counter went back to 0 and its values became reusable. Clearing
    // the selection and choosing the same project again then rebuilt the list
    // under a generation a request already in flight had captured.
    const p = project("alpha");
    await seedFirstPage(p);

    let resolveMore: ((value: unknown) => void) | undefined;
    fetchRecentEdits.mockImplementationOnce(
      () => new Promise((resolve) => (resolveMore = resolve))
    );
    const pending = useAppStore.getState().loadMoreRecentEdits(p.path);

    await act(async () => {
      useAppStore.setState({ selectedProject: null });
      useAppStore.getState().resetAnalytics();
    });

    fetchRecentEdits.mockResolvedValueOnce(
      pageOf(["fresh-a.ts", "fresh-b.ts"], 0, true)
    );
    useAppStore.setState({ selectedProject: p });
    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(async () => {
      await result.current.switchToRecentEdits();
    });

    await act(async () => {
      resolveMore?.(pageOf(["late.ts"], 2, true));
      await pending;
    });

    expect(
      (useAppStore.getState().analytics.recentEdits?.files ?? []).map(
        (f) => f.file_path
      )
    ).toEqual(["fresh-a.ts", "fresh-b.ts"]);
  });

  it("does not let a superseded page clear a newer one's loading flag (R8)", async () => {
    // The flag is global. A late request clearing it re-enables Show More while
    // a newer request is still running, and the extra click costs a full walk
    // of the project's logs even though the generation check throws its rows
    // away.
    const a = project("alpha");
    const b = project("beta");
    await seedFirstPage(a);

    let resolveA: ((value: unknown) => void) | undefined;
    fetchRecentEdits.mockImplementationOnce(
      () => new Promise((resolve) => (resolveA = resolve))
    );
    const pendingA = useAppStore.getState().loadMoreRecentEdits(a.path);

    // The user moves to another project and its first page lands, which
    // rewrites pagination and leaves Show More available again.
    fetchRecentEdits.mockResolvedValueOnce(pageOf(["b1.ts", "b2.ts"], 0, true));
    useAppStore.setState({ selectedProject: b });
    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(async () => {
      await result.current.switchToRecentEdits();
    });

    let resolveB: ((value: unknown) => void) | undefined;
    fetchRecentEdits.mockImplementationOnce(
      () => new Promise((resolve) => (resolveB = resolve))
    );
    const pendingB = useAppStore.getState().loadMoreRecentEdits(b.path);
    expect(
      useAppStore.getState().analytics.recentEditsPagination.isLoadingMore
    ).toBe(true);

    await act(async () => {
      resolveA?.(pageOf(["late.ts"], 2, true));
      await pendingA;
    });

    // Still loading: the request that owns the flag has not finished.
    expect(
      useAppStore.getState().analytics.recentEditsPagination.isLoadingMore
    ).toBe(true);

    await act(async () => {
      resolveB?.(pageOf(["b3.ts"], 2, false));
      await pendingB;
    });

    expect(
      useAppStore.getState().analytics.recentEditsPagination.isLoadingMore
    ).toBe(false);
    expect(
      (useAppStore.getState().analytics.recentEdits?.files ?? []).map(
        (f) => f.file_path
      )
    ).toEqual(["b1.ts", "b2.ts", "b3.ts"]);
  });

  it("keeps a newer same-project request's loading state intact (R9)", async () => {
    // The cross-project version of this is R8. The same-project one reaches
    // the identical exit through a different door: a refresh rewrites
    // pagination, which frees Show More for a second request against the very
    // same project while the first is still in flight.
    const p = project("alpha");
    await seedFirstPage(p);

    let resolveFirst: ((value: unknown) => void) | undefined;
    fetchRecentEdits.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve))
    );
    const first = useAppStore.getState().loadMoreRecentEdits(p.path);

    // A refresh of the same project: clear, then reload page 1.
    fetchRecentEdits.mockResolvedValueOnce(
      pageOf(["fresh-a.ts", "fresh-b.ts"], 0, true)
    );
    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(async () => {
      useAppStore.getState().setAnalyticsRecentEdits(null);
      await result.current.switchToRecentEdits();
    });

    let resolveSecond: ((value: unknown) => void) | undefined;
    fetchRecentEdits.mockImplementationOnce(
      () => new Promise((resolve) => (resolveSecond = resolve))
    );
    const second = useAppStore.getState().loadMoreRecentEdits(p.path);
    expect(
      useAppStore.getState().analytics.recentEditsPagination.isLoadingMore
    ).toBe(true);

    await act(async () => {
      resolveFirst?.(pageOf(["stale.ts"], 2, true));
      await first;
    });

    // The older request settled, but it does not own the flag any more.
    expect(
      useAppStore.getState().analytics.recentEditsPagination.isLoadingMore
    ).toBe(true);

    await act(async () => {
      resolveSecond?.(pageOf(["fresh-c.ts"], 2, false));
      await second;
    });

    expect(
      useAppStore.getState().analytics.recentEditsPagination.isLoadingMore
    ).toBe(false);
    expect(
      (useAppStore.getState().analytics.recentEdits?.files ?? []).map(
        (f) => f.file_path
      )
    ).toEqual(["fresh-a.ts", "fresh-b.ts", "fresh-c.ts"]);
  });
});

/**
 * Round 4. Both fetch paths validated ownership before writing a *result* and
 * neither validated it before writing a *failure*, so a late rejection could
 * paint an error over a view the user had already moved to.
 */
describe("recent-edits failures respect ownership", () => {
  beforeEach(() => {
    fetchRecentEdits.mockReset();
    vi.mocked(toast.error).mockClear();
    useAppStore.setState({ selectedProject: null, selectedSession: null });
    useAppStore.getState().resetAnalytics();
  });

  it("does not paint a stale load-more failure over the current view (R5)", async () => {
    const a = project("alpha");
    const b = project("beta");
    fetchRecentEdits.mockResolvedValueOnce({
      ...payload(a.actual_path),
      has_more: true,
      total_edits_count: 100,
      unique_files_count: 100,
    });
    useAppStore.setState({ selectedProject: a });

    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(async () => {
      await result.current.switchToRecentEdits();
    });

    let rejectMore: ((reason: unknown) => void) | undefined;
    fetchRecentEdits.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectMore = reject))
    );
    const pending = useAppStore.getState().loadMoreRecentEdits(a.path);

    await act(async () => {
      useAppStore.setState({ selectedProject: b });
    });
    await act(async () => {
      rejectMore?.(new Error("backend went away"));
      await pending;
    });

    expect(useAppStore.getState().analytics.recentEditsError).toBeNull();
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
    // The flag still has to clear, or the next project's Show More is dead.
    expect(
      useAppStore.getState().analytics.recentEditsPagination.isLoadingMore
    ).toBe(false);
  });

  it("does not paint a stale first-load failure over the current view (R6)", async () => {
    const a = project("alpha");
    const b = project("beta");
    useAppStore.setState({ selectedProject: a });

    let rejectFirst: ((reason: unknown) => void) | undefined;
    fetchRecentEdits.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectFirst = reject))
    );

    const { result } = renderHook(() => useAnalyticsNavigation());
    let settled: string | undefined;
    let pending: Promise<unknown> | undefined;
    await act(async () => {
      pending = result.current
        .switchToRecentEdits()
        .catch(() => (settled = "rejected"));
    });

    await act(async () => {
      useAppStore.setState({ selectedProject: b });
    });
    await act(async () => {
      rejectFirst?.(new Error("backend went away"));
      await pending;
    });

    expect(settled).toBe("rejected");
    expect(useAppStore.getState().analytics.recentEditsError).toBeNull();
  });
});

/**
 * Making the cache actually hit removed the accidental freshness the
 * always-miss had been providing. Nothing in the watcher path invalidates it:
 * `triggerProjectRefresh` reloads the session list through `selectProject`,
 * which never touches analytics, and `resetAnalytics` runs only in
 * `clearProjectSelection`. So a project could sit selected all day serving
 * pre-edit rows, with the header refresh button the only way out.
 */
describe("recent-edits cache invalidation on file change", () => {
  beforeEach(() => {
    fetchRecentEdits.mockReset();
    useAppStore.setState({ selectedProject: null, selectedSession: null });
    useAppStore.getState().resetAnalytics();
  });

  it("refetches after the watcher reports the project changed", async () => {
    const p = project("alpha");
    fetchRecentEdits.mockResolvedValue(payload(p.actual_path));
    useAppStore.setState({ selectedProject: p });

    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(async () => {
      await result.current.switchToRecentEdits();
    });
    expect(fetchRecentEdits).toHaveBeenCalledTimes(1);

    // Second visit with no file change still hits the cache — invalidation
    // must not simply disable it.
    await act(async () => {
      await result.current.switchToRecentEdits();
    });
    expect(fetchRecentEdits).toHaveBeenCalledTimes(1);

    await act(async () => {
      useAppStore.getState().invalidateRecentEdits(p.path);
    });

    await act(async () => {
      await result.current.switchToRecentEdits();
    });
    expect(fetchRecentEdits).toHaveBeenCalledTimes(2);
  });

  it("keeps the rows on screen while dropping the cache identity", async () => {
    // Clearing the data instead would blank the panel under a user who is
    // reading it, triggered by nothing but a background file event.
    const p = project("alpha");
    fetchRecentEdits.mockResolvedValue(payload(p.actual_path));
    useAppStore.setState({ selectedProject: p });

    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(async () => {
      await result.current.switchToRecentEdits();
    });

    await act(async () => {
      useAppStore.getState().invalidateRecentEdits(p.path);
    });

    const cached = useAppStore.getState().analytics.recentEdits;
    expect(cached?.files.length).toBe(1);
    expect(cached?.requestedProjectPath).toBeUndefined();
  });

  it("leaves another project's cache entry alone", async () => {
    const a = project("alpha");
    const b = project("beta");
    fetchRecentEdits.mockResolvedValue(payload(a.actual_path));
    useAppStore.setState({ selectedProject: a });

    const { result } = renderHook(() => useAnalyticsNavigation());
    await act(async () => {
      await result.current.switchToRecentEdits();
    });

    // A background write under an unrelated project must not cost the
    // selected one its cache.
    await act(async () => {
      useAppStore.getState().invalidateRecentEdits(b.path);
    });

    await act(async () => {
      await result.current.switchToRecentEdits();
    });
    expect(fetchRecentEdits).toHaveBeenCalledTimes(1);
  });

  it("stops an in-flight load-more from appending to an invalidated list", async () => {
    const p = project("alpha");
    fetchRecentEdits.mockResolvedValueOnce(payload(p.actual_path));
    useAppStore.setState({ selectedProject: p });

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

    // Executor form, not `Promise.withResolvers`: the jsdom realm this suite
    // runs in on CI does not provide it. Matches every other deferred case in
    // this file.
    let resolveMore: ((value: unknown) => void) | undefined;
    fetchRecentEdits.mockImplementationOnce(
      () => new Promise((resolve) => (resolveMore = resolve))
    );
    const pending = useAppStore.getState().loadMoreRecentEdits(p.path);

    await act(async () => {
      useAppStore.getState().invalidateRecentEdits(p.path);
    });
    await act(async () => {
      resolveMore?.({
        ...payload(p.actual_path),
        files: [{ ...payload(p.actual_path).files[0], file_path: "late.ts" }],
      });
      await pending;
    });

    const files = useAppStore.getState().analytics.recentEdits?.files ?? [];
    expect(files.some((f) => f.file_path === "late.ts")).toBe(false);
    expect(
      useAppStore.getState().analytics.recentEditsPagination.isLoadingMore
    ).toBe(false);
  });
});
