/**
 * The board reloads when the open project changes to another project of the
 * same name (T7 re-review F2 sweep). Project names are the last directory
 * segment for Claude Code too (`project_display_name_from_path`), so
 * `/work/a/repo` and `/work/b/repo` are both "repo": the board's cache must
 * be matched to the open project's sessions by file, not by project name, or
 * B's board shows A's sessions.
 */
import { beforeEach, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ClaudeProject, ClaudeSession } from "@/types";

const apiMock = vi.hoisted(() => vi.fn(async () => null));
vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { useAppStore } from "@/store/useAppStore";
import type { FullAppStore } from "@/store/slices/types";
import { useAnalyticsNavigation } from "@/hooks/analytics/useAnalyticsNavigation";

const projectAt = (dir: string): ClaudeProject => ({
  name: "repo",
  path: `/home/u/.claude/projects/-work-${dir}-repo`,
  actual_path: `/work/${dir}/repo`,
  session_count: 1,
  message_count: 1,
  last_modified: "2026-10-17T00:00:00.000Z",
  provider: "claude",
});
const sessionIn = (p: ClaudeProject, id: string): ClaudeSession => ({
  session_id: id,
  actual_session_id: id,
  file_path: `${p.path}/${id}.jsonl`,
  project_name: "repo",
  provider: "claude",
  message_count: 1,
  first_message_time: "2026-10-17T00:00:00.000Z",
  last_message_time: "2026-10-17T00:00:00.000Z",
  last_modified: "2026-10-17T00:00:00.000Z",
  has_errors: false,
  has_tool_use: false,
});

const A = projectAt("a");
const B = projectAt("b");
const A1 = sessionIn(A, "a1");
const B1 = sessionIn(B, "b1");

const pristine = useAppStore.getState();

beforeEach(() => {
  useAppStore.setState(pristine, true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

it("B's board reloads B's sessions when the cached board is A's", async () => {
  const loadBoardSessions = vi.fn(async () => {});
  useAppStore.setState({
    projects: [A, B],
    selectedProject: B,
    sessions: [B1],
    boardSessions: { [A1.session_id]: { session: A1 } },
    loadBoardSessions,
  } as unknown as Partial<FullAppStore>);
  const { result } = renderHook(() => useAnalyticsNavigation());

  await result.current.switchToBoard();

  expect(loadBoardSessions).toHaveBeenCalledWith([B1]);
});

it("the board of the same project is reused", async () => {
  const loadBoardSessions = vi.fn(async () => {});
  useAppStore.setState({
    projects: [A, B],
    selectedProject: B,
    sessions: [B1],
    boardSessions: { [B1.session_id]: { session: B1 } },
    dateFilter: { start: new Date(0), end: new Date() },
    loadBoardSessions,
  } as unknown as Partial<FullAppStore>);
  const { result } = renderHook(() => useAnalyticsNavigation());

  await result.current.switchToBoard();

  expect(loadBoardSessions).not.toHaveBeenCalled();
});
