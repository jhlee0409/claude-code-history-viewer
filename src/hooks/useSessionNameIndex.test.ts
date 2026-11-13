import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { api } from "@/services/api";
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

  it("counts a failed project as done, reports it once and does not retry it", async () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useSessionNameIndex([good, broken], enabled),
      { initialProps: { enabled: true } }
    );

    await waitFor(() => expect(result.current.isIndexing).toBe(false));
    expect(result.current.sessionsByProject.get(good.path)).toEqual(goodSessions);
    expect(result.current.sessionsByProject.has(broken.path)).toBe(false);
    expect(result.current.loadedCount).toBe(2);
    expect(result.current.totalCount).toBe(2);
    expect(toast.error).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.isIndexing).toBe(false));
    expect(api).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
