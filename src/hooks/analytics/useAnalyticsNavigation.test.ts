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
