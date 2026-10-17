import { describe, it, expect, beforeEach, vi } from "vitest";
import { create } from "zustand";
import type { StateCreator } from "zustand";

const fetchRecentEdits = vi.fn();
vi.mock("../../services/analyticsApi", () => ({
  fetchRecentEdits: (...args: unknown[]) => fetchRecentEdits(...args),
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

import {
  createRecentEditsSlice,
  recentEditsRequestKey,
  type RecentEditsRequest,
  type RecentEditsSlice,
} from "./recentEditsSlice";
import type { FullAppStore } from "./types";

/** The place the test store has open: what `ownWork` checks a write against. */
interface Place {
  selectedProject: { path: string } | null;
  selectedSession: { file_path: string } | null;
  navigationEpoch: number;
}
type TestStore = RecentEditsSlice & Place;
type Creator = StateCreator<FullAppStore, [], [], RecentEditsSlice>;

/**
 * A fresh store per test, following `filterSlice.test.ts`. The slice reads
 * localStorage in its initializer, so the store has to be built after whatever
 * the test seeded.
 *
 * The screen only ever asks for the place it shows (`selectRecentEditsRequest`),
 * so each load opens its request's project (and session) first; a test moves
 * the place itself with `openPlace` to model a switch while a load runs.
 */
const makeStore = () => {
  const store = create<TestStore>()((set, get, api) => ({
    selectedProject: null,
    selectedSession: null,
    navigationEpoch: 0,
    ...createRecentEditsSlice(
      set as unknown as Parameters<Creator>[0],
      get as unknown as Parameters<Creator>[1],
      api as unknown as Parameters<Creator>[2]
    ),
  }));
  const { loadRecentEditsList, loadMoreRecentEditsList } = store.getState();
  const openRequest = (request: RecentEditsRequest) =>
    store.setState({
      selectedProject: { path: request.projectPath },
      selectedSession: request.sessionFilePath ? { file_path: request.sessionFilePath } : null,
    });
  store.setState({
    loadRecentEditsList: (request, options) => {
      openRequest(request);
      return loadRecentEditsList(request, options);
    },
    loadMoreRecentEditsList: (request) => {
      openRequest(request);
      return loadMoreRecentEditsList(request);
    },
  });
  return store;
};

/** A navigation to another place (a project or tab switch): the epoch moves too. */
const openPlace = (
  store: ReturnType<typeof makeStore>,
  projectPath: string,
  sessionPath: string | null = null
) =>
  store.setState((s) => ({
    selectedProject: { path: projectPath },
    selectedSession: sessionPath ? { file_path: sessionPath } : null,
    navigationEpoch: s.navigationEpoch + 1,
  }));

describe("recentEditsSlice preferences", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("applies the documented defaults when localStorage is empty", () => {
    const s = makeStore().getState();

    // The Edits screen opens on full cards, project-wide, as the page did.
    expect(s.recentEditsDensity).toBe("standard");
    expect(s.recentEditsScope).toBe("project");
    expect(s.recentEditsGroupingProject).toBe("file");
    expect(s.recentEditsGroupingSession).toBe("edit");
    expect(s.recentEditsMissingOnly).toBe(false);
    // No dock state is left (T9b).
    expect(s).not.toHaveProperty("recentEditsMode");
    expect(s).not.toHaveProperty("isRecentEditsDockOpen");
  });

  it("falls back to the defaults when localStorage holds garbage", () => {
    localStorage.setItem("recent-edits-density", "{}");
    localStorage.setItem("recent-edits-scope", "");
    localStorage.setItem("recent-edits-grouping-session", "null");
    localStorage.setItem("recent-edits-missing-only", "yes please");

    const s = makeStore().getState();

    expect(s.recentEditsDensity).toBe("standard");
    expect(s.recentEditsScope).toBe("project");
    expect(s.recentEditsGroupingSession).toBe("edit");
    // Anything that is not the string "true" reads as false, matching
    // navigatorSlice.
    expect(s.recentEditsMissingOnly).toBe(false);
  });

  it("round-trips every persisted value", () => {
    const store = makeStore();
    store.getState().setRecentEditsDensity("compact");
    store.getState().setRecentEditsScope("session");
    store.getState().setRecentEditsGrouping("project", "edit");
    store.getState().setRecentEditsGrouping("session", "file");
    store.getState().setRecentEditsMissingOnly(true);

    const reloaded = makeStore().getState();

    expect(reloaded.recentEditsDensity).toBe("compact");
    expect(reloaded.recentEditsScope).toBe("session");
    expect(reloaded.recentEditsGroupingProject).toBe("edit");
    expect(reloaded.recentEditsGroupingSession).toBe("file");
    expect(reloaded.recentEditsMissingOnly).toBe(true);
  });

  it("keeps project and session grouping independent", () => {
    const store = makeStore();
    store.getState().setRecentEditsGrouping("project", "edit");

    expect(store.getState().recentEditsGroupingProject).toBe("edit");
    expect(store.getState().recentEditsGroupingSession).toBe("edit");

    store.getState().setRecentEditsGrouping("session", "file");

    expect(store.getState().recentEditsGroupingSession).toBe("file");
    expect(store.getState().recentEditsGroupingProject).toBe("edit");
  });
});

describe("recentEditsSlice fetch", () => {
  const page = (paths: string[], hasMore = false) => ({
    files: paths.map((file_path) => ({
      file_path,
      timestamp: "2026-08-21T10:00:00Z",
      session_id: "s1",
      operation_type: "edit" as const,
      content_after_change: "after",
      lines_added: 1,
      lines_removed: 0,
    })),
    total_edits_count: paths.length,
    unique_files_count: paths.length,
    project_cwd: "/project",
    offset: 0,
    limit: 20,
    has_more: hasMore,
  });

  const request = {
    projectPath: "/storage/project",
    scope: "project" as const,
    grouping: "file" as const,
    sessionFilePath: "/storage/project/session-a.jsonl",
  };

  beforeEach(() => {
    localStorage.clear();
    fetchRecentEdits.mockReset();
    fetchRecentEdits.mockResolvedValue(page(["/project/a.ts"]));
  });

  it("does not refetch when the request is unchanged", async () => {
    const store = makeStore();
    await store.getState().loadRecentEditsList(request);
    await store.getState().loadRecentEditsList(request);

    expect(fetchRecentEdits).toHaveBeenCalledTimes(1);
    expect(store.getState().recentEditsList?.requestKey).toBe(
      recentEditsRequestKey(request)
    );
  });

  it("refetches when the scope changes", async () => {
    const store = makeStore();
    await store.getState().loadRecentEditsList(request);
    await store
      .getState()
      .loadRecentEditsList({ ...request, scope: "session" });

    expect(fetchRecentEdits).toHaveBeenCalledTimes(2);
    // Session scope passes the file path through; project scope must not.
    expect(fetchRecentEdits.mock.calls[0]?.[1]?.sessionFilePath).toBeUndefined();
    expect(fetchRecentEdits.mock.calls[1]?.[1]?.sessionFilePath).toBe(
      request.sessionFilePath
    );
  });

  it("refetches when the grouping changes", async () => {
    const store = makeStore();
    await store.getState().loadRecentEditsList(request);
    await store.getState().loadRecentEditsList({ ...request, grouping: "edit" });

    expect(fetchRecentEdits).toHaveBeenCalledTimes(2);
    expect(fetchRecentEdits.mock.calls[1]?.[1]?.grouping).toBe("edit");
  });

  it("discards a response whose request is no longer the one being asked", async () => {
    // A slow project-scope request must not land on top of a session-scope one
    // the user has already switched to.
    let resolveSlow: ((value: unknown) => void) | undefined;
    fetchRecentEdits.mockImplementationOnce(
      () => new Promise((resolve) => (resolveSlow = resolve))
    );
    fetchRecentEdits.mockResolvedValueOnce(page(["/project/session-only.ts"]));

    const store = makeStore();
    const slow = store.getState().loadRecentEditsList(request);
    const fast = store
      .getState()
      .loadRecentEditsList({ ...request, scope: "session" });
    await fast;

    resolveSlow?.(page(["/project/stale.ts"]));
    await slow;

    const files = store.getState().recentEditsList?.files ?? [];
    expect(files.map((f) => f.file_path)).toEqual([
      "/project/session-only.ts",
    ]);
  });

  it("appends a further page onto the same request", async () => {
    fetchRecentEdits.mockResolvedValueOnce(page(["/project/a.ts"], true));
    const store = makeStore();
    await store.getState().loadRecentEditsList(request);

    fetchRecentEdits.mockResolvedValueOnce(page(["/project/b.ts"], false));
    await store.getState().loadMoreRecentEditsList(request);

    expect(store.getState().recentEditsList?.files.map((f) => f.file_path)).toEqual([
      "/project/a.ts",
      "/project/b.ts",
    ]);
  });

  it("serves an empty answer from the slot: a project without edits is not re-walked", async () => {
    fetchRecentEdits.mockResolvedValueOnce(page([]));
    const store = makeStore();
    await store.getState().loadRecentEditsList(request);
    await store.getState().loadRecentEditsList(request);

    expect(fetchRecentEdits).toHaveBeenCalledTimes(1);
    expect(store.getState().recentEditsList?.files).toEqual([]);
  });

  it("shares a first page already in flight for the same request (navigation and screen both ask)", async () => {
    let release: ((value: unknown) => void) | undefined;
    fetchRecentEdits.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const store = makeStore();
    const first = store.getState().loadRecentEditsList(request);
    const second = store.getState().loadRecentEditsList(request);
    release?.(page(["/project/a.ts"]));
    await Promise.all([first, second]);

    expect(fetchRecentEdits).toHaveBeenCalledTimes(1);
    expect(store.getState().recentEditsList?.files.map((f) => f.file_path)).toEqual(["/project/a.ts"]);
    expect(store.getState().isLoadingRecentEdits).toBe(false);
  });

  it("a forced load (refresh) reads again even when the rows answer the request", async () => {
    const store = makeStore();
    await store.getState().loadRecentEditsList(request);
    fetchRecentEdits.mockResolvedValueOnce(page(["/project/new.ts"]));
    await store.getState().loadRecentEditsList(request, { force: true });

    expect(fetchRecentEdits).toHaveBeenCalledTimes(2);
    expect(store.getState().recentEditsList?.files.map((f) => f.file_path)).toEqual(["/project/new.ts"]);
  });

  it("a watcher invalidation keeps the rows on screen and makes the next load read again", async () => {
    const store = makeStore();
    await store.getState().loadRecentEditsList(request);

    // Another project's change leaves these rows alone.
    store.getState().invalidateRecentEdits("/storage/other");
    expect(store.getState().recentEditsList?.stale).toBeUndefined();

    store.getState().invalidateRecentEdits(request.projectPath);
    expect(store.getState().recentEditsList?.files.map((f) => f.file_path)).toEqual(["/project/a.ts"]);
    expect(store.getState().recentEditsList?.stale).toBe(true);

    fetchRecentEdits.mockResolvedValueOnce(page(["/project/after-write.ts"]));
    await store.getState().loadRecentEditsList(request);
    expect(fetchRecentEdits).toHaveBeenCalledTimes(2);
    expect(store.getState().recentEditsList?.files.map((f) => f.file_path)).toEqual(["/project/after-write.ts"]);
    expect(store.getState().recentEditsList?.stale).toBeUndefined();
  });

  it("records an error without wiping the previous rows", async () => {
    const store = makeStore();
    await store.getState().loadRecentEditsList(request);

    fetchRecentEdits.mockRejectedValueOnce(new Error("backend exploded"));
    await store.getState().loadRecentEditsList({ ...request, grouping: "edit" });

    expect(store.getState().recentEditsError).toBe("backend exploded");
    expect(store.getState().isLoadingRecentEdits).toBe(false);
  });
});

describe("recentEditsSlice fetch: regressions from adversarial review", () => {
  const page = (paths, hasMore, offset) => ({
    files: paths.map((file_path) => ({
      file_path,
      timestamp: "2026-08-21T10:00:00Z",
      session_id: "s1",
      operation_type: "edit",
      content_after_change: "after",
      lines_added: 1,
      lines_removed: 0,
    })),
    total_edits_count: 100,
    unique_files_count: 100,
    project_cwd: "/project",
    offset,
    limit: 20,
    has_more: hasMore,
  });

  const twenty = (prefix) =>
    Array.from({ length: 20 }, (_, i) => `/project/${prefix}${i}.ts`);

  const request = {
    projectPath: "/storage/project",
    scope: "project",
    grouping: "file",
    sessionFilePath: "/storage/project/session-a.jsonl",
  };

  beforeEach(() => {
    localStorage.clear();
    fetchRecentEdits.mockReset();
  });

  it("walks pages without skipping one (B2)", async () => {
    // The original arithmetic added the last page's own offset to the
    // cumulative row count, so page three asked for 60 instead of 40 and rows
    // 40-59 were never fetched. One load-more passed; two did not.
    fetchRecentEdits
      .mockResolvedValueOnce(page(twenty("a"), true, 0))
      .mockResolvedValueOnce(page(twenty("b"), true, 20))
      .mockResolvedValueOnce(page(twenty("c"), false, 40));

    const store = makeStore();
    await store.getState().loadRecentEditsList(request);
    await store.getState().loadMoreRecentEditsList(request);
    await store.getState().loadMoreRecentEditsList(request);

    const offsets = fetchRecentEdits.mock.calls.map((c) => c[1]?.offset);
    expect(offsets).toEqual([0, 20, 40]);
    expect(store.getState().recentEditsList?.files.length).toBe(60);
  });

  it("reclaims the request slot on a cache hit (B1)", async () => {
    // K1 cached, switch to K2, switch back to K1 before K2 lands. K2 must not
    // land on top of the rows the user is actually looking at.
    let resolveK2;
    fetchRecentEdits.mockResolvedValueOnce(page(["/project/k1.ts"], false, 0));
    const store = makeStore();
    await store.getState().loadRecentEditsList(request);

    fetchRecentEdits.mockImplementationOnce(
      () => new Promise((resolve) => (resolveK2 = resolve))
    );
    const k2 = store
      .getState()
      .loadRecentEditsList({ ...request, grouping: "edit" });

    await store.getState().loadRecentEditsList(request);
    resolveK2?.(page(["/project/k2.ts"], false, 0));
    await k2;

    expect(
      store.getState().recentEditsList?.files.map((f) => f.file_path)
    ).toEqual(["/project/k1.ts"]);
  });

  it("a stale list starts its request over on show more instead of appending at moved offsets", async () => {
    fetchRecentEdits.mockResolvedValueOnce(page(["/project/a.ts"], true, 0));
    const store = makeStore();
    await store.getState().loadRecentEditsList(request);
    store.getState().invalidateRecentEdits(request.projectPath);

    fetchRecentEdits.mockResolvedValueOnce(page(["/project/fresh.ts"], true, 0));
    await store.getState().loadMoreRecentEditsList(request);

    expect(fetchRecentEdits).toHaveBeenLastCalledWith(
      request.projectPath,
      expect.objectContaining({ offset: 0 })
    );
    expect(store.getState().recentEditsList?.files.map((f) => f.file_path)).toEqual(["/project/fresh.ts"]);
    expect(store.getState().recentEditsList?.stale).toBeUndefined();
  });

  it("a load-more failure keeps the rows and says so once, as the page did", async () => {
    toastError.mockClear();
    fetchRecentEdits.mockResolvedValueOnce(page(["/project/a.ts"], true, 0));
    const store = makeStore();
    await store.getState().loadRecentEditsList(request);

    fetchRecentEdits.mockRejectedValueOnce(new Error("page two failed"));
    await store.getState().loadMoreRecentEditsList(request);

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0]?.[0])).toContain("page two failed");
    expect(store.getState().recentEditsError).toBeNull();
    expect(store.getState().recentEditsList?.files.map((f) => f.file_path)).toEqual(["/project/a.ts"]);
    expect(store.getState().isLoadingMoreRecentEdits).toBe(false);
  });

  it("ignores a late load-more failure from an abandoned request (B3)", async () => {
    toastError.mockClear();
    let rejectSlow;
    fetchRecentEdits.mockResolvedValueOnce(page(["/project/a.ts"], true, 0));
    const store = makeStore();
    await store.getState().loadRecentEditsList(request);

    fetchRecentEdits.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectSlow = reject))
    );
    const slow = store.getState().loadMoreRecentEditsList(request);

    fetchRecentEdits.mockResolvedValueOnce(page(["/project/fresh.ts"], false, 0));
    await store.getState().loadRecentEditsList({ ...request, grouping: "edit" });

    rejectSlow?.(new Error("abandoned request failed"));
    await slow;

    expect(toastError).not.toHaveBeenCalled();
    expect(store.getState().recentEditsError).toBeNull();
    expect(
      store.getState().recentEditsList?.files.map((f) => f.file_path)
    ).toEqual(["/project/fresh.ts"]);
  });

  it("a new request's rows can page again while an abandoned page is still loading (T8 stateScope)", async () => {
    let resolveSlow;
    fetchRecentEdits.mockResolvedValueOnce(page(twenty("a"), true, 0));
    const store = makeStore();
    await store.getState().loadRecentEditsList(request);

    fetchRecentEdits.mockImplementationOnce(() => new Promise((resolve) => (resolveSlow = resolve)));
    const slow = store.getState().loadMoreRecentEditsList(request);
    expect(store.getState().isLoadingMoreRecentEdits).toBe(true);

    // Another project's rows (a tab switch, a project change) replace them.
    const other = { ...request, projectPath: "/storage/other" };
    fetchRecentEdits.mockResolvedValueOnce(page(twenty("b"), true, 0));
    await store.getState().loadRecentEditsList(other);
    expect(store.getState().isLoadingMoreRecentEdits).toBe(false);

    fetchRecentEdits.mockResolvedValueOnce(page(["/project/b20.ts"], false, 20));
    await store.getState().loadMoreRecentEditsList(other);
    expect(store.getState().recentEditsList?.files).toHaveLength(21);

    resolveSlow?.(page(["/project/a20.ts"], false, 20));
    await slow;
    expect(store.getState().recentEditsList?.files.map((f) => f.file_path)).not.toContain("/project/a20.ts");
  });

  it("clears the missing flag on a restored row (P2-7)", async () => {
    // `exists_on_disk` is resolved when the page is fetched, so without this a
    // just-restored file stays red, stays inside the Missing Only filter, and
    // offers Restore again once the success state times out.
    const missing = {
      ...page(["/project/gone.ts"], false, 0),
      files: [
        {
          ...page(["/project/gone.ts"], false, 0).files[0],
          exists_on_disk: false,
        },
      ],
    };
    fetchRecentEdits.mockResolvedValueOnce(missing);

    const store = makeStore();
    await store.getState().loadRecentEditsList(request);
    expect(store.getState().recentEditsList?.files[0]?.exists_on_disk).toBe(false);

    store.getState().markRecentEditRestored("/project/gone.ts");

    expect(store.getState().recentEditsList?.files[0]?.exists_on_disk).toBe(true);
  });

  it("clears a stale error when returning to cached rows (B5)", async () => {
    // Second-pass finding: the cached-hit early return added for B1 claims the
    // request slot but never cleared the error. The screen renders the error in
    // preference to the rows, and the error is only cleared when a fetch
    // starts, which a cache hit never does. The stale failure would sit over
    // perfectly good cached rows indefinitely.
    fetchRecentEdits.mockResolvedValueOnce(page(["/project/k1.ts"], false, 0));
    const store = makeStore();
    await store.getState().loadRecentEditsList(request);

    fetchRecentEdits.mockRejectedValueOnce(new Error("backend exploded"));
    await store.getState().loadRecentEditsList({ ...request, grouping: "edit" });
    expect(store.getState().recentEditsError).toBe("backend exploded");

    await store.getState().loadRecentEditsList(request);

    expect(store.getState().recentEditsError).toBeNull();
    expect(
      store.getState().recentEditsList?.files.map((f) => f.file_path)
    ).toEqual(["/project/k1.ts"]);
  });

  it("keeps requests distinct when a path contains the key separator (B4)", async () => {
    // `|` is legal in a POSIX path, so a joined key could collide.
    const a = {
      projectPath: "/p",
      scope: "session",
      grouping: "file",
      sessionFilePath: "/p/a|project|file|",
    };
    const b = {
      projectPath: "/p|session|file|/p/a",
      scope: "project",
      grouping: "file",
      sessionFilePath: undefined,
    };

    expect(recentEditsRequestKey(a)).not.toBe(recentEditsRequestKey(b));

    fetchRecentEdits.mockResolvedValue(page(["/project/x.ts"], false, 0));
    const store = makeStore();
    await store.getState().loadRecentEditsList(a);
    await store.getState().loadRecentEditsList(b);

    expect(fetchRecentEdits).toHaveBeenCalledTimes(2);
  });
});

describe("recentEditsSlice reset", () => {
  const page = (paths: string[]) => ({
    files: paths.map((file_path) => ({
      file_path,
      timestamp: "2026-08-21T10:00:00Z",
      session_id: "s1",
      operation_type: "edit" as const,
      content_after_change: "after",
      lines_added: 1,
      lines_removed: 0,
    })),
    total_edits_count: paths.length,
    unique_files_count: paths.length,
    project_cwd: "/project",
    offset: 0,
    limit: 20,
    has_more: false,
  });

  const request = {
    projectPath: "/storage/project",
    scope: "project" as const,
    grouping: "file" as const,
    sessionFilePath: undefined,
  };

  beforeEach(() => {
    localStorage.clear();
    fetchRecentEdits.mockReset();
    fetchRecentEdits.mockResolvedValue(page(["/project/a.ts"]));
  });

  it("drops the fetched page but keeps the persisted preferences", async () => {
    const store = makeStore();
    store.getState().setRecentEditsScope("session");
    await store.getState().loadRecentEditsList(request);
    expect(store.getState().recentEditsList).not.toBeNull();

    store.getState().clearRecentEditsList();

    expect(store.getState().recentEditsList).toBeNull();
    expect(store.getState().recentEditsRequestedKey).toBeNull();
    expect(store.getState().recentEditsError).toBeNull();
    expect(store.getState().isLoadingRecentEdits).toBe(false);
    expect(store.getState().isLoadingMoreRecentEdits).toBe(false);
    // Preferences are not data: deselecting a project keeps them.
    expect(store.getState().recentEditsScope).toBe("session");
  });

  it("refetches the same request after a reset rather than serving the cache", async () => {
    const store = makeStore();
    await store.getState().loadRecentEditsList(request);
    expect(fetchRecentEdits).toHaveBeenCalledTimes(1);

    store.getState().clearRecentEditsList();
    await store.getState().loadRecentEditsList(request);

    expect(fetchRecentEdits).toHaveBeenCalledTimes(2);
    expect(
      store.getState().recentEditsList?.files.map((f) => f.file_path)
    ).toEqual(["/project/a.ts"]);
  });

  it("discards a load-more page that arrives after the reset", async () => {
    // Pins the observable contract rather than the mechanism: after a reset,
    // a load-more page that lands late must neither repopulate the screen nor
    // surface an error. Two things currently deliver that - the `!latest`
    // ownership guard, and the catch's `recentEditsRequestedKey` check
    // that swallows the null dereference if the guard is ever removed - so
    // this asserts the outcome and stays true whichever one holds.
    fetchRecentEdits.mockResolvedValueOnce({
      ...page(["/project/a.ts"]),
      has_more: true,
    });
    const store = makeStore();
    await store.getState().loadRecentEditsList(request);

    let resolveSlow: ((value: unknown) => void) | undefined;
    fetchRecentEdits.mockImplementationOnce(
      () => new Promise((resolve) => (resolveSlow = resolve))
    );
    const slow = store.getState().loadMoreRecentEditsList(request);
    store.getState().clearRecentEditsList();

    resolveSlow?.(page(["/project/b.ts"]));
    await expect(slow).resolves.toBeUndefined();

    expect(store.getState().recentEditsList).toBeNull();
    expect(store.getState().recentEditsError).toBeNull();
    expect(store.getState().isLoadingMoreRecentEdits).toBe(false);
  });

  it("discards a response that arrives after the reset", async () => {
    // Deselecting mid-flight must not repopulate the screen a moment later.
    let resolveSlow: ((value: unknown) => void) | undefined;
    fetchRecentEdits.mockImplementationOnce(
      () => new Promise((resolve) => (resolveSlow = resolve))
    );

    const store = makeStore();
    const slow = store.getState().loadRecentEditsList(request);
    store.getState().clearRecentEditsList();

    resolveSlow?.(page(["/project/stale.ts"]));
    await slow;

    expect(store.getState().recentEditsList).toBeNull();
  });
});

/**
 * #538. The in-flight guard compares request keys for equality, so a key that
 * is cleared and then set back to the *same* value looks unchanged — an ABA.
 *
 * `clearRecentEditsList` (added in #533) nulls the key on deselect, and the
 * gesture that PR is about — clicking the selected project to collapse it —
 * deselects and re-selects. So a quick double click restarts the request with
 * an identical key while the first fetch is still in flight, and the stale
 * response satisfies `key === key` and lands.
 *
 * Deferred promises use the executor form rather than `Promise.withResolvers`,
 * which the jsdom realm on CI does not provide — measured, not assumed.
 */
describe("recentEditsSlice request identity across a restart", () => {
  const request = {
    projectPath: "/storage/project",
    scope: "project" as const,
    grouping: "file" as const,
    sessionFilePath: "/storage/project/session-a.jsonl",
  };

  const pageOf = (paths: string[]) => ({
    files: paths.map((file_path) => ({
      file_path,
      timestamp: "2026-08-01T00:00:00.000Z",
      session_id: "s1",
      operation_type: "edit" as const,
      content_after_change: "after",
      lines_added: 1,
      lines_removed: 0,
    })),
    total_edits_count: paths.length,
    unique_files_count: paths.length,
    project_cwd: "/project",
    offset: 0,
    limit: 20,
    has_more: false,
  });

  beforeEach(() => {
    localStorage.clear();
    fetchRecentEdits.mockReset();
  });

  it("drops a stale response when the request restarts with the same key", async () => {
    const store = makeStore();

    let releaseStale: ((value: unknown) => void) | undefined;
    fetchRecentEdits
      .mockImplementationOnce(
        () => new Promise((resolve) => (releaseStale = resolve))
      )
      .mockResolvedValueOnce(pageOf(["/project/fresh.ts"]));

    const stale = store.getState().loadRecentEditsList(request);

    // Deselect, then re-select the same project: same key, second fetch.
    store.getState().clearRecentEditsList();
    await store.getState().loadRecentEditsList(request);

    expect(store.getState().recentEditsList?.files[0]?.file_path).toBe(
      "/project/fresh.ts"
    );

    releaseStale?.(pageOf(["/project/stale.ts"]));
    await stale;

    // The first fetch answers a question that was asked again and already
    // answered. Its page must not replace the newer one.
    expect(store.getState().recentEditsList?.files[0]?.file_path).toBe(
      "/project/fresh.ts"
    );
  });

  it("does not let a stale failure clear the spinner or paint an error", async () => {
    const store = makeStore();

    let rejectStale: ((reason: unknown) => void) | undefined;
    let releaseFresh: ((value: unknown) => void) | undefined;
    fetchRecentEdits
      .mockImplementationOnce(
        () => new Promise((_resolve, reject) => (rejectStale = reject))
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => (releaseFresh = resolve))
      );

    const stale = store.getState().loadRecentEditsList(request);
    store.getState().clearRecentEditsList();
    const fresh = store.getState().loadRecentEditsList(request);

    expect(store.getState().isLoadingRecentEdits).toBe(true);

    rejectStale?.(new Error("the abandoned request failed"));
    await stale;

    // The second fetch is still running, so the screen is still loading and
    // has nothing to apologise for.
    expect(store.getState().isLoadingRecentEdits).toBe(true);
    expect(store.getState().recentEditsError).toBeNull();

    releaseFresh?.(pageOf(["/project/fresh.ts"]));
    await fresh;
    expect(store.getState().isLoadingRecentEdits).toBe(false);
  });
});

/**
 * T9b review P2: an Edits load is owned by the place it was asked for
 * (`navigation/ownership.ts`, the T2 rule). Request identity alone was not
 * enough: moving to another project without asking the Edits screen anything
 * (its conversation, another screen, another tab) left the key unchanged, and
 * the late answer committed into the shared slot under the new project.
 */
describe("recentEditsSlice ownership: the place the load was asked for", () => {
  const A = "/storage/project-a";
  const B = "/storage/project-b";
  const requestA = {
    projectPath: A,
    scope: "project" as const,
    grouping: "file" as const,
    sessionFilePath: `${A}/s1.jsonl`,
  };
  const sessionRequestA = { ...requestA, scope: "session" as const, grouping: "edit" as const };
  const pageOf = (paths: string[], hasMore = false, offset = 0) => ({
    files: paths.map((file_path) => ({
      file_path,
      timestamp: "2026-08-01T00:00:00.000Z",
      session_id: "s1",
      operation_type: "edit" as const,
      content_after_change: "after",
      lines_added: 1,
      lines_removed: 0,
    })),
    total_edits_count: 40,
    unique_files_count: 40,
    project_cwd: "/project",
    offset,
    limit: 20,
    has_more: hasMore,
  });
  const twenty = Array.from({ length: 20 }, (_, i) => `/a/${i}.ts`);
  const held = () => {
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    fetchRecentEdits.mockImplementationOnce(
      () =>
        new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        })
    );
    return { resolve: (v: unknown) => resolve(v), reject: (e: unknown) => reject(e) };
  };

  beforeEach(() => {
    localStorage.clear();
    fetchRecentEdits.mockReset();
    toastError.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("a first page for A that lands after B opens is dropped, and its spinner still clears", async () => {
    const store = makeStore();
    const gate = held();
    const loading = store.getState().loadRecentEditsList(requestA);
    openPlace(store, B);

    gate.resolve(pageOf(["/a/late.ts"]));
    await loading;

    expect(store.getState().recentEditsList).toBeNull();
    expect(store.getState().isLoadingRecentEdits).toBe(false);
  });

  it("a first-page failure for A that lands after B opens is not B's error", async () => {
    const store = makeStore();
    const gate = held();
    const loading = store.getState().loadRecentEditsList(requestA);
    openPlace(store, B);

    gate.reject(new Error("A failed"));
    await loading;

    expect(store.getState().recentEditsError).toBeNull();
    expect(store.getState().isLoadingRecentEdits).toBe(false);
  });

  it("a load-more page for A that lands after B opens is not appended, says nothing, and frees load-more", async () => {
    const store = makeStore();
    fetchRecentEdits.mockResolvedValueOnce(pageOf(twenty, true));
    await store.getState().loadRecentEditsList(requestA);

    const ok = held();
    const more = store.getState().loadMoreRecentEditsList(requestA);
    openPlace(store, B);
    ok.resolve(pageOf(["/a/20.ts"], false, 20));
    await more;
    expect(store.getState().recentEditsList?.files).toHaveLength(20);
    expect(store.getState().isLoadingMoreRecentEdits).toBe(false);

    // Back on A, a failing page after another switch raises no toast over B.
    openPlace(store, A, requestA.sessionFilePath);
    const failing = held();
    const again = store.getState().loadMoreRecentEditsList(requestA);
    openPlace(store, B);
    failing.reject(new Error("page failed"));
    await again;
    expect(toastError).not.toHaveBeenCalled();
    expect(store.getState().isLoadingMoreRecentEdits).toBe(false);
  });

  it("session-scoped rows for s1 are dropped once another session of the project opens", async () => {
    const store = makeStore();
    const gate = held();
    const loading = store.getState().loadRecentEditsList(sessionRequestA);
    openPlace(store, A, `${A}/s2.jsonl`);

    gate.resolve(pageOf(["/a/s1-only.ts"]));
    await loading;

    expect(store.getState().recentEditsList).toBeNull();
  });

  it("same place: project-wide rows still land after a screen-only move or another session of the project", async () => {
    // Bounded cache warming for the same context is allowed (ownership.ts).
    const store = makeStore();
    const gate = held();
    const loading = store.getState().loadRecentEditsList(requestA);
    openPlace(store, A, `${A}/s2.jsonl`);

    gate.resolve(pageOf(["/a/warm.ts"]));
    await loading;

    expect(store.getState().recentEditsList?.files.map((f) => f.file_path)).toEqual(["/a/warm.ts"]);
  });
});
