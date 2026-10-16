/**
 * Escape in a session row's menu closes the menu only, and focus goes back
 * to the row it was opened on (T7 review R6). The menu used to close on a
 * document-level Escape without restoring focus (it fell to <body>), and in
 * the phone drawer the same Escape also reached the drawer's dismiss
 * handler, closing both. A second Escape - the menu gone - may close the
 * drawer. The WebKit run is in `scripts/ui-capture/test/sidebar.test.mjs`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
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
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
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

const tree = (
  <ProjectTree
    projects={[ALPHA]}
    sessions={SESSIONS}
    sessionsTotal={SESSIONS.length}
    selectedProject={ALPHA}
    selectedSession={null}
    onProjectSelect={vi.fn()}
    onSessionSelect={vi.fn()}
    onGlobalStatsClick={vi.fn()}
    isLoading={false}
  />
);

const row = (n: number) => screen.getByText(`Session number ${n}`).closest<HTMLElement>('[role="treeitem"]')!;
/** Escape as a user presses it: on the focused element. */
const pressEscape = () =>
  act(() => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  });

beforeEach(() => {
  cleanup();
  useAppStore.setState(pristine, true);
  useAppStore.setState({ projects: [ALPHA], sessions: SESSIONS, selectedProject: ALPHA });
});

describe("Escape in a session row's menu", () => {
  it("closes the menu and puts focus back on the row", async () => {
    render(<TooltipProvider>{tree}</TooltipProvider>);
    row(2).focus();
    fireEvent.keyDown(row(2), { key: "ContextMenu" });
    await screen.findByRole("menu");
    expect(document.activeElement?.getAttribute("role")).toBe("menuitem");

    pressEscape();

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(row(2));
  });

  it("in the phone drawer: the first Escape closes the menu only, the second the drawer", async () => {
    const changes: boolean[] = [];
    function Drawer() {
      const [open, setOpen] = useState(true);
      return (
        <Sheet
          open={open}
          onOpenChange={(next) => {
            changes.push(next);
            setOpen(next);
          }}
        >
          <SheetContent side="left" showCloseButton={false}>
            <SheetTitle>drawer</SheetTitle>
            {tree}
          </SheetContent>
        </Sheet>
      );
    }
    render(
      <TooltipProvider>
        <Drawer />
      </TooltipProvider>
    );
    row(1).focus();
    fireEvent.keyDown(row(1), { key: "ContextMenu" });
    await screen.findByRole("menu");

    pressEscape();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(changes).toEqual([]);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(document.activeElement).toBe(row(1));

    pressEscape();
    expect(changes).toEqual([false]);
  });
});
