/**
 * The open project's session search, source filter and sort stay reachable
 * in normal mode whatever its size (T7 review R4). They live in the full
 * list ("Show all"), which used to be offered only past the five-row
 * preview, so a project with 3-5 sessions had no route to them outside the
 * selection mode. The full list keeps the saved sort and source filter.
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
  session_count: 3,
  message_count: 3,
  last_modified: "2026-01-03T00:00:00.000Z",
  provider: "claude",
};

/** `n` sessions; session 1 is the newest. Even ones came from the IDE. */
const sessionsOf = (n: number): ClaudeSession[] =>
  Array.from({ length: n }, (_, i) => ({
    session_id: `s${i + 1}`,
    actual_session_id: `s${i + 1}`,
    file_path: `/p/alpha/s${i + 1}.jsonl`,
    project_name: "alpha",
    message_count: 2,
    first_message_time: "",
    last_message_time: "",
    last_modified: new Date(Date.UTC(2026, 0, 20 - i)).toISOString(),
    has_tool_use: false,
    has_errors: false,
    summary: `Session number ${i + 1}`,
    provider: "claude",
    entrypoint: i % 2 === 1 ? "vscode" : "cli",
  }));

const pristine = useAppStore.getState();

function renderWith(sessions: ClaudeSession[]) {
  useAppStore.setState({ projects: [ALPHA], sessions, selectedProject: ALPHA });
  render(
    <TooltipProvider>
      <ProjectTree
        projects={[ALPHA]}
        sessions={sessions}
        sessionsTotal={sessions.length}
        selectedProject={ALPHA}
        selectedSession={null}
        onProjectSelect={vi.fn()}
        onSessionSelect={vi.fn()}
        onGlobalStatsClick={vi.fn()}
        isLoading={false}
      />
    </TooltipProvider>
  );
}

const showAll = () => document.querySelector<HTMLElement>('[data-tree-node="show-all"]');
const search = () => screen.queryByPlaceholderText("session.filter.searchPlaceholder");
const rowNames = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-row="session"]')).map((r) => r.getAttribute("title"));

beforeEach(() => {
  cleanup();
  useAppStore.setState(pristine, true);
});

describe.each([3, 5, 6])("an open project with %i sessions", (count) => {
  it("offers the full list in normal mode, with search, source filter and sort", () => {
    renderWith(sessionsOf(count));
    expect(useAppStore.getState().isSessionSelectionMode).toBe(false);
    expect(search()).toBeNull();

    const row = showAll();
    expect(row, "a route to the list controls").not.toBeNull();
    expect(row!.textContent).toBe(`project.sessions.showAll:${count}`);
    fireEvent.click(row!);

    expect(search()).not.toBeNull();
    expect(screen.getByRole("group", { name: "session.filter.source.label" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "session.filter.sortOldestFirst" })).toBeTruthy();
    expect(rowNames()).toHaveLength(count);

    // ...and back.
    fireEvent.click(showAll()!);
    expect(search()).toBeNull();
  });

  it("the full list keeps the saved sort order and source filter", () => {
    useAppStore.setState({ sessionSortOrder: "oldest", sessionEntrypointFilter: "cli" });
    const sessions = sessionsOf(count);
    renderWith(sessions);
    fireEvent.click(showAll()!);

    const expected = sessions
      .filter((s) => s.entrypoint === "cli")
      .reverse()
      .map((s) => s.summary);
    expect(rowNames()).toEqual(expected);
    const source = screen.getByRole("group", { name: "session.filter.source.label" });
    expect(within(source).getByRole("button", { pressed: true })).toBeTruthy();
  });
});

describe("an open project with fewer sessions than the controls need", () => {
  it("lists them with no extra row", () => {
    renderWith(sessionsOf(2));
    expect(rowNames()).toHaveLength(2);
    expect(showAll()).toBeNull();
  });
});
