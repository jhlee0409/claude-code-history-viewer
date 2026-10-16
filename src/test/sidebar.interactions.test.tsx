/**
 * Plan T7 VERIFY: sidebar interactions, keyboard and pointer/touch, against
 * the real `ProjectTree` and the real store.
 *
 * - The open project's sessions are listed inside the sidebar.
 * - Click, touch tap, Enter and ⌘/Ctrl+click open a session (⌘+click opens
 *   in the current tab until T8 adds tabs).
 * - Shift+click and the "Select" button enter the existing multi-select
 *   mode; further clicks toggle rows; the batch bar offers its actions.
 * - The row menu (right-click or the ContextMenu key) stars a session.
 * - The filter narrows the project list.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ClaudeProject, ClaudeSession } from "@/types";

vi.mock("@/services/api", () => ({ api: vi.fn(async () => null) }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock("@/contexts/platform", () => ({
  usePlatform: () => ({ platform: "desktop", isDesktop: true, isMobile: false }),
  DesktopOnly: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  MobileOnly: () => null,
}));
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  const t = (key: string, options?: unknown) =>
    typeof options === "object" && options && "count" in options ? `${key}:${String((options as { count: unknown }).count)}` : key;
  return { ...actual, useTranslation: () => ({ t, i18n: { language: "en", on: vi.fn(), off: vi.fn() } }) };
});

import { useAppStore } from "@/store/useAppStore";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProjectTree } from "@/components/ProjectTree";

const project = (name: string, last: string): ClaudeProject => ({
  name,
  path: `/p/${name}`,
  actual_path: `/home/${name}`,
  session_count: 3,
  message_count: 3,
  last_modified: last,
  provider: "claude",
});
const ALPHA = project("alpha", "2026-01-03T00:00:00.000Z");
const BETA = project("beta", "2026-01-02T00:00:00.000Z");
const GAMMA = project("gamma", "2026-01-01T00:00:00.000Z");

const session = (n: number): ClaudeSession => ({
  session_id: `/p/alpha/s${n}.jsonl`,
  actual_session_id: `s${n}`,
  file_path: `/p/alpha/s${n}.jsonl`,
  project_name: "alpha",
  message_count: 2,
  first_message_time: "2026-01-01T00:00:00.000Z",
  last_message_time: "2026-01-01T00:00:00.000Z",
  last_modified: `2026-01-0${4 - n}T00:00:00.000Z`,
  has_tool_use: false,
  has_errors: false,
  summary: `Session number ${n}`,
  provider: "claude",
});
const SESSIONS = [session(1), session(2), session(3)];

const pristine = useAppStore.getState();
const toggleSessionFavorite = vi.fn(async () => {});

function renderSidebar() {
  const onSessionSelect = vi.fn();
  const onProjectSelect = vi.fn();
  render(
    <TooltipProvider>
      <ProjectTree
        projects={[ALPHA, BETA, GAMMA]}
        sessions={SESSIONS}
        sessionsTotal={SESSIONS.length}
        selectedProject={ALPHA}
        selectedSession={null}
        onProjectSelect={onProjectSelect}
        onSessionSelect={onSessionSelect}
        onGlobalStatsClick={vi.fn()}
        isLoading={false}
      />
    </TooltipProvider>
  );
  return { onSessionSelect, onProjectSelect };
}

const sessionRow = (n: number) =>
  screen.getByText(`Session number ${n}`).closest<HTMLElement>('[role="treeitem"]')!;
const projectRow = (p: ClaudeProject) =>
  document.querySelector<HTMLElement>(`[data-row="project"][data-project-path="${p.path}"]`);

beforeEach(() => {
  cleanup();
  toggleSessionFavorite.mockClear();
  useAppStore.setState(pristine, true);
  useAppStore.setState({
    projects: [ALPHA, BETA, GAMMA],
    sessions: SESSIONS,
    selectedProject: ALPHA,
    toggleSessionFavorite,
  } as never);
});

describe("sidebar sessions (plan T7)", () => {
  it("lists the open project's sessions inside the sidebar, and only its", () => {
    renderSidebar();
    expect(projectRow(ALPHA)?.getAttribute("aria-expanded")).toBe("true");
    expect(projectRow(BETA)?.getAttribute("aria-expanded")).toBe("false");
    for (const n of [1, 2, 3]) expect(sessionRow(n)).toBeTruthy();
  });

  it("click, touch tap, Enter and ⌘/Ctrl+click open a session (in this tab before T8)", () => {
    const { onSessionSelect } = renderSidebar();

    fireEvent.click(sessionRow(1));
    expect(onSessionSelect).toHaveBeenLastCalledWith(SESSIONS[0]);

    fireEvent.pointerDown(sessionRow(2), { pointerType: "touch" });
    fireEvent.pointerUp(sessionRow(2), { pointerType: "touch" });
    fireEvent.click(sessionRow(2));
    expect(onSessionSelect).toHaveBeenLastCalledWith(SESSIONS[1]);

    fireEvent.keyDown(sessionRow(3), { key: "Enter" });
    expect(onSessionSelect).toHaveBeenLastCalledWith(SESSIONS[2]);

    fireEvent.click(sessionRow(1), { metaKey: true });
    expect(onSessionSelect).toHaveBeenLastCalledWith(SESSIONS[0]);
    fireEvent.click(sessionRow(2), { ctrlKey: true });
    expect(onSessionSelect).toHaveBeenLastCalledWith(SESSIONS[1]);

    expect(onSessionSelect).toHaveBeenCalledTimes(5);
    expect(useAppStore.getState().isSessionSelectionMode).toBe(false);
  });

  it("Shift+click enters multi-select; clicks then toggle rows; the batch bar acts on them", () => {
    const { onSessionSelect } = renderSidebar();

    fireEvent.click(sessionRow(1), { shiftKey: true });
    expect(useAppStore.getState().isSessionSelectionMode).toBe(true);
    expect(useAppStore.getState().sessionSelectionIds).toEqual([SESSIONS[0]!.session_id]);

    // In selection mode a plain click (or Space) toggles, never opens.
    fireEvent.click(sessionRow(3));
    fireEvent.keyDown(sessionRow(2), { key: " " });
    expect(new Set(useAppStore.getState().sessionSelectionIds)).toEqual(
      new Set(SESSIONS.map((s) => s.session_id))
    );
    expect(onSessionSelect).not.toHaveBeenCalled();
    expect(sessionRow(2).getAttribute("aria-checked")).toBe("true");

    // Batch bar: count, clear-all toggle, copy IDs, delete.
    expect(screen.getByText("session.selection.count:3")).toBeTruthy();
    fireEvent.click(screen.getByText("session.selection.clear"));
    expect(useAppStore.getState().sessionSelectionIds).toEqual([]);
    expect(screen.getByText("session.selection.copyIds")).toBeTruthy();

    // The bar's ✕ (the list toolbar's pressed toggle has the same name).
    const exits = screen.getAllByRole("button", { name: "session.selection.exit" });
    fireEvent.click(exits.find((button) => !button.hasAttribute("aria-pressed"))!);
    expect(useAppStore.getState().isSessionSelectionMode).toBe(false);
  });

  it("the sidebar's Select button enters the same mode (keyboard and pointer)", () => {
    renderSidebar();
    const select = screen.getByRole("button", { name: "session.selection.enter" });
    expect(select.tabIndex).toBeGreaterThanOrEqual(0);
    fireEvent.click(select);
    expect(useAppStore.getState().isSessionSelectionMode).toBe(true);
  });

  it("stars a session from its row menu, by pointer and by the ContextMenu key", async () => {
    renderSidebar();

    fireEvent.contextMenu(sessionRow(2));
    fireEvent.click(await screen.findByRole("menuitem", { name: "session.favorite.add" }));
    // With the project that lists it, so the favourite's ref names it.
    expect(toggleSessionFavorite).toHaveBeenLastCalledWith(SESSIONS[1], ALPHA);

    fireEvent.keyDown(sessionRow(3), { key: "ContextMenu" });
    const item = await screen.findByRole("menuitem", { name: "session.favorite.add" });
    // The menu takes focus, so Enter on it runs the item.
    expect(document.activeElement?.getAttribute("role")).toBe("menuitem");
    fireEvent.click(item);
    expect(toggleSessionFavorite).toHaveBeenLastCalledWith(SESSIONS[2], ALPHA);
  });

  it("a starred session shows its star; the menu then offers to remove it", async () => {
    useAppStore.setState({
      userMetadata: {
        ...useAppStore.getState().userMetadata,
        sessions: { [SESSIONS[0]!.session_id]: { starred: true } },
      },
    } as never);
    renderSidebar();
    expect(within(sessionRow(1)).getByTitle("session.favorite.starred")).toBeTruthy();
    fireEvent.contextMenu(sessionRow(1));
    expect(await screen.findByRole("menuitem", { name: "session.favorite.remove" })).toBeTruthy();
  });
});

describe("project list (plan T7)", () => {
  it("sorts by recent activity and the filter narrows it", async () => {
    renderSidebar();
    const names = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-row="project"]')).map((row) =>
        row.getAttribute("data-project-path")
      );
    expect(names()).toEqual([ALPHA.path, BETA.path, GAMMA.path]);

    const filter = screen.getByLabelText("project.filterPlaceholder");
    await act(async () => {
      fireEvent.change(filter, { target: { value: "gam" } });
    });
    expect(names()).toEqual([GAMMA.path]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "common.clear" }));
    });
    expect(names()).toHaveLength(3);
  });

  it("re-clicking the open project only collapses it; it is never left", () => {
    const { onProjectSelect } = renderSidebar();
    fireEvent.click(projectRow(ALPHA)!);
    expect(projectRow(ALPHA)?.getAttribute("aria-expanded")).toBe("false");
    expect(onProjectSelect).not.toHaveBeenCalled();
    expect(screen.queryByText("Session number 1")).toBeNull();
  });
});
