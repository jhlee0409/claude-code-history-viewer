import { describe, it, expect, beforeEach, vi } from "vitest";
import { create } from "zustand";
import type { StateCreator } from "zustand";

const fetchRecentEdits = vi.fn();
vi.mock("../../services/analyticsApi", () => ({
  fetchRecentEdits: (...args: unknown[]) => fetchRecentEdits(...args),
}));

import {
  createRecentEditsPanelSlice,
  recentEditsDockRequestKey,
  selectRecentEditsDensity,
  selectRecentEditsGrouping,
  type RecentEditsPanelSlice,
} from "./recentEditsPanelSlice";
import type { FullAppStore } from "./types";

/**
 * A fresh store per test, following `filterSlice.test.ts`. The slice reads
 * localStorage in its initializer, so the store has to be built after whatever
 * the test seeded.
 */
const makeStore = () =>
  create<RecentEditsPanelSlice>()((set, get, api) =>
    createRecentEditsPanelSlice(
      set as unknown as Parameters<
        StateCreator<FullAppStore, [], [], RecentEditsPanelSlice>
      >[0],
      get as unknown as Parameters<
        StateCreator<FullAppStore, [], [], RecentEditsPanelSlice>
      >[1],
      api as unknown as Parameters<
        StateCreator<FullAppStore, [], [], RecentEditsPanelSlice>
      >[2]
    )
  );

describe("recentEditsPanelSlice", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("applies the documented defaults when localStorage is empty", () => {
    const s = makeStore().getState();

    expect(s.recentEditsMode).toBe("page");
    expect(s.recentEditsDensityPage).toBe("standard");
    expect(s.recentEditsDensityDock).toBe("compact");
    expect(s.recentEditsScope).toBe("session");
    expect(s.recentEditsGroupingProject).toBe("file");
    expect(s.recentEditsGroupingSession).toBe("edit");
    expect(s.recentEditsMissingOnly).toBe(false);
    expect(s.isRecentEditsDockOpen).toBe(false);
  });

  it("falls back to the defaults when localStorage holds garbage", () => {
    localStorage.setItem("recent-edits-mode", "sideways");
    localStorage.setItem("recent-edits-density-dock", "{}");
    localStorage.setItem("recent-edits-scope", "");
    localStorage.setItem("recent-edits-grouping-session", "null");
    localStorage.setItem("recent-edits-missing-only", "yes please");

    const s = makeStore().getState();

    expect(s.recentEditsMode).toBe("page");
    expect(s.recentEditsDensityDock).toBe("compact");
    expect(s.recentEditsScope).toBe("session");
    expect(s.recentEditsGroupingSession).toBe("edit");
    // Anything that is not the string "true" reads as false, matching
    // navigatorSlice.
    expect(s.recentEditsMissingOnly).toBe(false);
  });

  it("round-trips every persisted value", () => {
    const store = makeStore();
    store.getState().setRecentEditsMode("docked");
    store.getState().setRecentEditsDensity("page", "compact");
    store.getState().setRecentEditsDensity("docked", "standard");
    store.getState().setRecentEditsScope("project");
    store.getState().setRecentEditsGrouping("project", "edit");
    store.getState().setRecentEditsGrouping("session", "file");
    store.getState().setRecentEditsMissingOnly(true);
    store.getState().setRecentEditsDockOpen(true);

    const reloaded = makeStore().getState();

    expect(reloaded.recentEditsMode).toBe("docked");
    expect(reloaded.recentEditsDensityPage).toBe("compact");
    expect(reloaded.recentEditsDensityDock).toBe("standard");
    expect(reloaded.recentEditsScope).toBe("project");
    expect(reloaded.recentEditsGroupingProject).toBe("edit");
    expect(reloaded.recentEditsGroupingSession).toBe("file");
    expect(reloaded.recentEditsMissingOnly).toBe(true);
    expect(reloaded.isRecentEditsDockOpen).toBe(true);
  });

  it("keeps page and dock density independent", () => {
    // Docking must not re-densify the full page view.
    const store = makeStore();
    store.getState().setRecentEditsDensity("docked", "standard");

    expect(store.getState().recentEditsDensityDock).toBe("standard");
    expect(store.getState().recentEditsDensityPage).toBe("standard");

    store.getState().setRecentEditsDensity("page", "compact");

    expect(store.getState().recentEditsDensityPage).toBe("compact");
    expect(store.getState().recentEditsDensityDock).toBe("standard");
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

  it("toggles the dock and persists the new value", () => {
    const store = makeStore();
    store.getState().toggleRecentEditsDock();

    expect(store.getState().isRecentEditsDockOpen).toBe(true);
    expect(makeStore().getState().isRecentEditsDockOpen).toBe(true);

    store.getState().toggleRecentEditsDock();

    expect(store.getState().isRecentEditsDockOpen).toBe(false);
  });

  it("selects the density and grouping that currently apply", () => {
    const store = makeStore();

    expect(selectRecentEditsDensity(store.getState())).toBe("standard");
    expect(selectRecentEditsGrouping(store.getState())).toBe("edit");

    store.getState().setRecentEditsMode("docked");
    store.getState().setRecentEditsScope("project");

    expect(selectRecentEditsDensity(store.getState())).toBe("compact");
    expect(selectRecentEditsGrouping(store.getState())).toBe("file");
  });
});

describe("recentEditsPanelSlice dock fetch", () => {
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
    await store.getState().loadRecentEditsDock(request);
    await store.getState().loadRecentEditsDock(request);

    expect(fetchRecentEdits).toHaveBeenCalledTimes(1);
    expect(store.getState().recentEditsDock?.requestKey).toBe(
      recentEditsDockRequestKey(request)
    );
  });

  it("refetches when the scope changes", async () => {
    const store = makeStore();
    await store.getState().loadRecentEditsDock(request);
    await store
      .getState()
      .loadRecentEditsDock({ ...request, scope: "session" });

    expect(fetchRecentEdits).toHaveBeenCalledTimes(2);
    // Session scope passes the file path through; project scope must not.
    expect(fetchRecentEdits.mock.calls[0]?.[1]?.sessionFilePath).toBeUndefined();
    expect(fetchRecentEdits.mock.calls[1]?.[1]?.sessionFilePath).toBe(
      request.sessionFilePath
    );
  });

  it("refetches when the grouping changes", async () => {
    const store = makeStore();
    await store.getState().loadRecentEditsDock(request);
    await store.getState().loadRecentEditsDock({ ...request, grouping: "edit" });

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
    const slow = store.getState().loadRecentEditsDock(request);
    const fast = store
      .getState()
      .loadRecentEditsDock({ ...request, scope: "session" });
    await fast;

    resolveSlow?.(page(["/project/stale.ts"]));
    await slow;

    const files = store.getState().recentEditsDock?.files ?? [];
    expect(files.map((f) => f.file_path)).toEqual([
      "/project/session-only.ts",
    ]);
  });

  it("appends a further page onto the same request", async () => {
    fetchRecentEdits.mockResolvedValueOnce(page(["/project/a.ts"], true));
    const store = makeStore();
    await store.getState().loadRecentEditsDock(request);

    fetchRecentEdits.mockResolvedValueOnce(page(["/project/b.ts"], false));
    await store.getState().loadMoreRecentEditsDock(request);

    expect(store.getState().recentEditsDock?.files.map((f) => f.file_path)).toEqual([
      "/project/a.ts",
      "/project/b.ts",
    ]);
  });

  it("records an error without wiping the previous rows", async () => {
    const store = makeStore();
    await store.getState().loadRecentEditsDock(request);

    fetchRecentEdits.mockRejectedValueOnce(new Error("backend exploded"));
    await store.getState().loadRecentEditsDock({ ...request, grouping: "edit" });

    expect(store.getState().recentEditsDockError).toBe("backend exploded");
    expect(store.getState().isLoadingRecentEditsDock).toBe(false);
  });
});

describe("recentEditsPanelSlice dock fetch: regressions from adversarial review", () => {
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
    await store.getState().loadRecentEditsDock(request);
    await store.getState().loadMoreRecentEditsDock(request);
    await store.getState().loadMoreRecentEditsDock(request);

    const offsets = fetchRecentEdits.mock.calls.map((c) => c[1]?.offset);
    expect(offsets).toEqual([0, 20, 40]);
    expect(store.getState().recentEditsDock?.files.length).toBe(60);
  });

  it("reclaims the request slot on a cache hit (B1)", async () => {
    // K1 cached, switch to K2, switch back to K1 before K2 lands. K2 must not
    // land on top of the rows the user is actually looking at.
    let resolveK2;
    fetchRecentEdits.mockResolvedValueOnce(page(["/project/k1.ts"], false, 0));
    const store = makeStore();
    await store.getState().loadRecentEditsDock(request);

    fetchRecentEdits.mockImplementationOnce(
      () => new Promise((resolve) => (resolveK2 = resolve))
    );
    const k2 = store
      .getState()
      .loadRecentEditsDock({ ...request, grouping: "edit" });

    await store.getState().loadRecentEditsDock(request);
    resolveK2?.(page(["/project/k2.ts"], false, 0));
    await k2;

    expect(
      store.getState().recentEditsDock?.files.map((f) => f.file_path)
    ).toEqual(["/project/k1.ts"]);
  });

  it("ignores a late load-more failure from an abandoned request (B3)", async () => {
    let rejectSlow;
    fetchRecentEdits.mockResolvedValueOnce(page(["/project/a.ts"], true, 0));
    const store = makeStore();
    await store.getState().loadRecentEditsDock(request);

    fetchRecentEdits.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectSlow = reject))
    );
    const slow = store.getState().loadMoreRecentEditsDock(request);

    fetchRecentEdits.mockResolvedValueOnce(page(["/project/fresh.ts"], false, 0));
    await store.getState().loadRecentEditsDock({ ...request, grouping: "edit" });

    rejectSlow?.(new Error("abandoned request failed"));
    await slow;

    expect(store.getState().recentEditsDockError).toBeNull();
    expect(
      store.getState().recentEditsDock?.files.map((f) => f.file_path)
    ).toEqual(["/project/fresh.ts"]);
  });

  it("clears a stale error when returning to cached rows (B5)", async () => {
    // Second-pass finding: the cached-hit early return added for B1 claims the
    // request slot but never cleared the error. The panel renders the error in
    // preference to the rows, and the error is only cleared when a fetch
    // starts, which a cache hit never does. The stale failure would sit over
    // perfectly good cached rows indefinitely.
    fetchRecentEdits.mockResolvedValueOnce(page(["/project/k1.ts"], false, 0));
    const store = makeStore();
    await store.getState().loadRecentEditsDock(request);

    fetchRecentEdits.mockRejectedValueOnce(new Error("backend exploded"));
    await store.getState().loadRecentEditsDock({ ...request, grouping: "edit" });
    expect(store.getState().recentEditsDockError).toBe("backend exploded");

    await store.getState().loadRecentEditsDock(request);

    expect(store.getState().recentEditsDockError).toBeNull();
    expect(
      store.getState().recentEditsDock?.files.map((f) => f.file_path)
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

    expect(recentEditsDockRequestKey(a)).not.toBe(recentEditsDockRequestKey(b));

    fetchRecentEdits.mockResolvedValue(page(["/project/x.ts"], false, 0));
    const store = makeStore();
    await store.getState().loadRecentEditsDock(a);
    await store.getState().loadRecentEditsDock(b);

    expect(fetchRecentEdits).toHaveBeenCalledTimes(2);
  });
});
