import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
  }),
}));

vi.mock("@/contexts/theme", () => ({
  useTheme: () => ({ isDarkMode: false }),
}));

type MockState = Record<string, unknown>;
let state: MockState;

vi.mock("@/store/useAppStore", () => ({
  useAppStore: <T,>(selector?: (s: MockState) => T) =>
    selector ? selector(state) : (state as unknown as T),
}));

import { RecentEditsPanel } from "./RecentEditsPanel";

const loadRecentEditsDock = vi.fn();

const baseState = (overrides: MockState = {}): MockState => ({
  selectedSession: null,
  selectedProject: { path: "/storage/project", actual_path: "/project" },
  navigateToMessage: vi.fn(),
  recentEditsDock: null,
  isLoadingRecentEditsDock: false,
  isLoadingMoreRecentEditsDock: false,
  recentEditsDockError: null,
  loadRecentEditsDock,
  loadMoreRecentEditsDock: vi.fn(),
  markRecentEditsDockFileRestored: vi.fn(),
  recentEditsMode: "docked",
  recentEditsScope: "project",
  recentEditsMissingOnly: false,
  setRecentEditsScope: vi.fn(),
  setRecentEditsDensity: vi.fn(),
  setRecentEditsGrouping: vi.fn(),
  setRecentEditsMissingOnly: vi.fn(),
  recentEditsDensityDock: "compact",
  recentEditsDensityPage: "standard",
  recentEditsGroupingProject: "file",
  recentEditsGroupingSession: "edit",
  ...overrides,
});

describe("RecentEditsPanel with no project selected", () => {
  beforeEach(() => {
    loadRecentEditsDock.mockReset();
  });

  it("tells the user to pick a project rather than claiming there are no edits", () => {
    // Collapsing the selected project in the tree deselects it, and the dock
    // now survives that. "No edits" would be a lie in that state: nothing has
    // been asked, so nothing is known.
    state = baseState({ selectedProject: null });

    render(<RecentEditsPanel />);

    expect(screen.getByText("Select a project to see its edits")).toBeTruthy();
    expect(screen.queryByText("recentEdits.noEdits")).toBeNull();
    expect(loadRecentEditsDock).not.toHaveBeenCalled();
  });

  it("disables both scope buttons, since neither scope can resolve", () => {
    state = baseState({ selectedProject: null });

    render(<RecentEditsPanel />);

    expect(
      screen.getByRole("button", { name: "Session" }).hasAttribute("disabled")
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Project" }).hasAttribute("disabled")
    ).toBe(true);
  });

  it("still reports a genuinely empty project as having no edits", () => {
    state = baseState({
      recentEditsDock: {
        files: [],
        requestKey: "k",
        hasMore: false,
        request: {
          projectPath: "/tmp/project",
          scope: "project" as const,
          grouping: "file" as const,
        },
      },
    });

    render(<RecentEditsPanel />);

    expect(screen.getByText("recentEdits.noEdits")).toBeTruthy();
  });
});
