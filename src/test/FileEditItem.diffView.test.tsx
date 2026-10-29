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

  it("the diff view is the unified DiffView: +/− on the changed lines, context blank (TR2a, D5)", () => {
    // Before TR2a this opened react-diff-viewer's table, which stays white in
    // the dark theme and marks changes by colour only.
    const { container } = render(<FileEditItem edit={edit} isDarkMode={true} />);

    fireEvent.click(screen.getByLabelText("recentEdits.showDiff"));

    const view = container.querySelector("[data-diff-view]");
    expect(view, "the DiffView").not.toBeNull();
    const rows = [...(view?.querySelectorAll("[data-diff-line]") ?? [])].map(
      (line) =>
        `${line.querySelector("[data-diff-marker] [aria-hidden='true']")?.textContent ?? ""}|${line.querySelector("[data-diff-code]")?.textContent}`
    );
    expect(rows).toEqual(["|const a = 1;", "−|const b = 2;", "+|const b = 3;"]);
    expect(view?.getAttribute("data-diff-added")).toBe("1");
    expect(view?.getAttribute("data-diff-removed")).toBe("1");
    expect(screen.queryByText("diffViewer.visualView")).not.toBeInTheDocument();
  });

  it("switches to advanced analysis from the diff's … menu without crashing", () => {
    // Regression: AdvancedTextDiff uses useCaptureExpandState, which throws
    // unless the diff view is wrapped in an ExpandKeyProvider. The old
    // "Advanced analysis" button moved into the menu (TR2a).
    render(<FileEditItem edit={edit} isDarkMode={false} />);

    fireEvent.click(screen.getByLabelText("recentEdits.showDiff"));
    const trigger = screen.queryByRole("button", { name: "diffView.moreActions" }) as HTMLElement;
    expect(trigger, "the diff's … menu button").not.toBeNull();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "diffView.modeAdvanced" }));

    expect(
      screen.getByRole("radiogroup", { name: "advancedTextDiff.comparisonMethod" })
    ).toBeInTheDocument();
  });
});
