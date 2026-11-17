/**
 * A compact session row keeps an explicit, tappable actions button (T7
 * review R5). The default row's name editor carried one; the sidebar's
 * one-line rows opened their menu only by right-click or the keyboard, so a
 * touch screen had no tap route to rename, copy, favourite or delete.
 *
 * The button shows on coarse pointers (`pointer-coarse:`) with a 24px hit
 * area, is named, stays out of the tab order (the tree's ContextMenu /
 * Shift+F10 keys are the keyboard route), and opening it neither opens nor
 * selects the row. The WebKit run with touch emulation is in
 * `scripts/ui-capture/test/sidebar.test.mjs`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ClaudeProject, ClaudeSession } from "@/types";

vi.mock("@/services/api", () => ({ api: vi.fn(async () => null) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/platform", () => ({
  usePlatform: () => ({ platform: "desktop", isDesktop: true, isMobile: false }),
  DesktopOnly: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  MobileOnly: () => null,
}));
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  const t = (key: string, options?: unknown) =>
    typeof options === "object" && options && "count" in options
      ? `${key}:${String((options as { count: unknown }).count)}`
      : key;
  return { ...actual, useTranslation: () => ({ t, i18n: { language: "en", on: vi.fn(), off: vi.fn() } }) };
});

import { useAppStore } from "@/store/useAppStore";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProjectTree } from "@/components/ProjectTree";

const ALPHA: ClaudeProject = {
  name: "alpha",
  path: "/p/alpha",
  actual_path: "/home/alpha",
  session_count: 2,
  message_count: 2,
  last_modified: "2026-01-03T00:00:00.000Z",
  provider: "claude",
};
const session = (n: number): ClaudeSession => ({
  session_id: `s${n}`,
  actual_session_id: `s${n}`,
  file_path: `/p/alpha/s${n}.jsonl`,
  project_name: "alpha",
  message_count: 2,
  first_message_time: "",
  last_message_time: "",
  last_modified: `2026-01-0${4 - n}T00:00:00.000Z`,
  has_tool_use: false,
  has_errors: false,
  summary: `Session number ${n}`,
  provider: "claude",
});
const SESSIONS = [session(1), session(2)];

const pristine = useAppStore.getState();
const toggleSessionFavorite = vi.fn(async () => {});

function renderSidebar() {
  const onSessionSelect = vi.fn();
  render(
    <TooltipProvider>
      <ProjectTree
        projects={[ALPHA]}
        sessions={SESSIONS}
        sessionsTotal={SESSIONS.length}
        selectedProject={ALPHA}
        selectedSession={null}
        onProjectSelect={vi.fn()}
        onSessionSelect={onSessionSelect}
        onGlobalStatsClick={vi.fn()}
        isLoading={false}
      />
    </TooltipProvider>
  );
  return { onSessionSelect };
}

const row = (n: number) => screen.getByText(`Session number ${n}`).closest<HTMLElement>('[role="treeitem"]')!;
const actionsOf = (n: number) => within(row(n)).queryByRole("button", { name: "session.rowActions" });

beforeEach(() => {
  cleanup();
  toggleSessionFavorite.mockClear();
  useAppStore.setState(pristine, true);
  useAppStore.setState({ projects: [ALPHA], sessions: SESSIONS, selectedProject: ALPHA, toggleSessionFavorite } as never);
});

describe("compact session row: the actions button", () => {
  it("every row has one, named, shown on coarse pointers with a 24px target, out of the tab order", () => {
    renderSidebar();
    for (const n of [1, 2]) {
      const button = actionsOf(n)!;
      expect(button, `row ${n}`).not.toBeNull();
      expect(button.tabIndex).toBe(-1);
      expect(button.getAttribute("aria-haspopup")).toBe("menu");
      expect(button.className).toMatch(/(^| )hidden( |$)/);
      expect(button.className).toMatch(/(^| )pointer-coarse:inline-flex( |$)/);
      expect(button.className).toMatch(/(^| )size-6( |$)/);
    }
  });

  it("a tap opens the row menu without opening the session; its items work", async () => {
    const { onSessionSelect } = renderSidebar();
    const button = actionsOf(2)!;
    fireEvent.pointerDown(button, { pointerType: "touch" });
    fireEvent.pointerUp(button, { pointerType: "touch" });
    fireEvent.click(button);

    const menu = await screen.findByRole("menu");
    expect(onSessionSelect).not.toHaveBeenCalled();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "session.favorite.add" }));
    expect(toggleSessionFavorite).toHaveBeenLastCalledWith(SESSIONS[1], ALPHA);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("the selection mode has none (a row is a toggle there)", () => {
    useAppStore.setState({ isSessionSelectionMode: true });
    renderSidebar();
    expect(document.querySelectorAll('[data-row="session"] button[aria-label="session.rowActions"]')).toHaveLength(0);
  });
});
