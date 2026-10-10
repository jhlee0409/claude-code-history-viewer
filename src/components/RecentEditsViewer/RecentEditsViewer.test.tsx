import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === "string" ? fallback : key,
    }),
  };
});

vi.mock("@/contexts/theme", () => ({
  useTheme: () => ({ isDarkMode: false }),
}));

type MockState = Record<string, unknown>;
let state: MockState;

vi.mock("@/store/useAppStore", () => ({
  useAppStore: <T,>(selector?: (s: MockState) => T) =>
    selector ? selector(state) : (state as unknown as T),
}));

import { RecentEditsViewer } from "./RecentEditsViewer";

describe("RecentEditsViewer for a provider without recent edits (#643)", () => {
  it("says edits are unavailable instead of showing another project's rows", () => {
    state = {
      selectedProject: {
        path: "/Users/x/.omp/agent/sessions/-Users-x-proj",
        actual_path: "/Users/x/proj",
        provider: "ompi",
      },
      setRecentEditsMode: vi.fn(),
      setRecentEditsDockOpen: vi.fn(),
      setAnalyticsCurrentView: vi.fn(),
    };

    render(
      <RecentEditsViewer
        recentEdits={{
          // Cached for the previously selected Claude project.
          requestedProjectPath: "/storage/claude-project",
          files: [
            {
              file_path: "/claude-project/src/stale.ts",
              timestamp: "2026-08-21T00:00:00.000Z",
              session_id: "s1",
              operation_type: "edit",
              content_after_change: "after",
              lines_added: 1,
              lines_removed: 0,
            },
          ],
          total_edits_count: 1,
          unique_files_count: 1,
          project_cwd: "/claude-project",
        }}
      />
    );

    expect(screen.getByText("recentEdits.unavailableForProvider")).toBeTruthy();
    expect(screen.queryByText(/stale\.ts/)).toBeNull();
  });
});
