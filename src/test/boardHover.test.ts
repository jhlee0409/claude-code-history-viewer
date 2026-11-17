/**
 * Plan §9b F2: hovering a session in the sidebar while the board is open used
 * to call `setSelectedSession`, so the pointer moved the selection - the
 * sidebar highlight, the watcher's target, the session global-stats exits on.
 * Hover is now board-only state.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeProject, ClaudeSession } from "@/types";

vi.mock("@/services/api", () => ({ api: vi.fn(async () => null) }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { useAppStore } from "@/store/useAppStore";

const PROJECT: ClaudeProject = {
  name: "alpha",
  path: "/p/alpha",
  actual_path: "/home/alpha",
  session_count: 2,
  message_count: 2,
  last_modified: "",
};
const session = (id: string): ClaudeSession => ({
  session_id: id,
  actual_session_id: id,
  file_path: `/p/alpha/${id}.jsonl`,
  project_name: "alpha",
  message_count: 1,
  first_message_time: "",
  last_message_time: "",
  last_modified: "",
  has_tool_use: false,
  has_errors: false,
});
const OPEN = session("open");
const HOVERED = session("hovered");

const pristine = useAppStore.getState();

describe("board hover is not a selection (F2)", () => {
  beforeEach(() => {
    useAppStore.setState(pristine, true);
    useAppStore.setState({ selectedProject: PROJECT, selectedSession: OPEN });
    window.history.replaceState({}, "", `/?session=${OPEN.session_id}`);
  });

  it("leaves the selected session, the URL and the place alone", () => {
    const before = useAppStore.getState();

    useAppStore.getState().setBoardHoverSession(HOVERED);

    const after = useAppStore.getState();
    expect(after.boardHoverSession).toBe(HOVERED);
    expect(after.selectedSession).toBe(OPEN);
    expect(after.selectedProject).toBe(before.selectedProject);
    expect(new URL(window.location.href).searchParams.get("session")).toBe(OPEN.session_id);
  });

  it("is forgotten with the rest of the board", () => {
    useAppStore.getState().setBoardHoverSession(HOVERED);
    useAppStore.getState().clearBoard();
    expect(useAppStore.getState().boardHoverSession).toBeNull();
  });
});
