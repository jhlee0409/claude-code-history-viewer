import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileEditItem } from "@/components/RecentEditsViewer/FileEditItem";
import type { RecentFileEdit } from "@/types";

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
    }),
  };
});

const edit: RecentFileEdit = {
  file_path: "/tmp/example.ts",
  timestamp: "2026-07-14T10:00:00Z",
  session_id: "session-1",
  operation_type: "edit",
  content_after_change: "const a = 1;\nconst b = 3;\n",
  original_content: "const a = 1;\nconst b = 2;\n",
  lines_added: 1,
  lines_removed: 1,
  cwd: "/tmp",
};

describe("FileEditItem diff views", () => {
  it("shows only the added lines when the +N stat is clicked", () => {
    render(<FileEditItem edit={edit} isDarkMode={false} />);

    fireEvent.click(screen.getByLabelText("recentEdits.showAddedLines"));

    expect(screen.getByText("const b = 3;")).toBeInTheDocument();
    expect(screen.queryByText("const b = 2;")).not.toBeInTheDocument();
  });

  it("shows only the removed lines when the -N stat is clicked", () => {
    render(<FileEditItem edit={edit} isDarkMode={false} />);

    fireEvent.click(screen.getByLabelText("recentEdits.showRemovedLines"));

    expect(screen.getByText("const b = 2;")).toBeInTheDocument();
    expect(screen.queryByText("const b = 3;")).not.toBeInTheDocument();
  });

  it("switches to advanced analysis inside the diff view without crashing", () => {
    // Regression: AdvancedTextDiff uses useCaptureExpandState, which throws
    // unless the diff view is wrapped in an ExpandKeyProvider.
    render(<FileEditItem edit={edit} isDarkMode={false} />);

    fireEvent.click(screen.getByLabelText("recentEdits.showDiff"));
    fireEvent.click(screen.getByText("diffViewer.advancedAnalysis"));

    expect(
      screen.getByText("advancedTextDiff.comparisonMethod")
    ).toBeInTheDocument();
  });
});
