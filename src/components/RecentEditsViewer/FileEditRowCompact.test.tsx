import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Identity `t`, but it still interpolates `{{count}}` because the compact
    // time strings depend on i18next doing that for real.
    t: (key: string, fallback?: unknown, options?: { count?: number }) => {
      const base = typeof fallback === "string" ? fallback : key;
      return options?.count === undefined
        ? base
        : base.replace("{{count}}", String(options.count));
    },
  }),
}));

vi.mock("@/services/api", () => ({ api: vi.fn() }));

vi.mock("@/utils/platform", () => ({
  isTauri: () => true,
  isMacOS: () => false,
  isWindows: () => true,
}));

import { FileEditRowCompact } from "./FileEditRowCompact";
import type { RecentFileEdit } from "../../types";

const PROJECT = "/Users/alex/Projects/my-app";

const makeEdit = (overrides: Partial<RecentFileEdit> = {}): RecentFileEdit => ({
  file_path: `${PROJECT}/skills/deliver-prd/HISTORY.md`,
  timestamp: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
  session_id: "s1",
  operation_type: "edit",
  content_after_change: "after content",
  original_content: "before content",
  lines_added: 25,
  lines_removed: 6,
  ...overrides,
});

describe("FileEditRowCompact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the filename, line counts and a compact time on line 1", () => {
    render(
      <FileEditRowCompact
        edit={makeEdit()}
        isDarkMode={false}
        projectCwd={PROJECT}
      />
    );

    expect(screen.getByText("HISTORY.md")).toBeTruthy();
    expect(screen.getByText("+25")).toBeTruthy();
    expect(screen.getByText("-6")).toBeTruthy();
    // Compact relative time, not the long "3 hours ago" form.
    expect(screen.getByText("3h")).toBeTruthy();
  });

  it("elides the project root from the directory line", () => {
    render(
      <FileEditRowCompact
        edit={makeEdit()}
        isDarkMode={false}
        projectCwd={PROJECT}
      />
    );

    expect(screen.getByText("skills/deliver-prd")).toBeTruthy();
    // The full absolute path belongs to the expansion, not the row.
    expect(screen.queryByText(makeEdit().file_path)).toBeNull();
  });

  it("does not label a future timestamp as now (P2-11)", () => {
    // A negative elapsed time used to fall through every threshold into the
    // "now" branch, so clock skew or an imported log rendered tomorrow as now.
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    render(
      <FileEditRowCompact
        edit={makeEdit({ timestamp: tomorrow.toISOString() })}
        isDarkMode={false}
        projectCwd={PROJECT}
      />
    );

    expect(screen.queryByText("now")).toBeNull();
  });

  it("shows clock time instead of relative time in edit grouping", () => {
    const at = new Date();
    at.setHours(14, 22, 0, 0);
    render(
      <FileEditRowCompact
        edit={makeEdit({ timestamp: at.toISOString() })}
        isDarkMode={false}
        projectCwd={PROJECT}
        grouping="edit"
      />
    );

    const expected = at.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it("expands on row click and reveals the full absolute path", () => {
    const edit = makeEdit();
    render(
      <FileEditRowCompact edit={edit} isDarkMode={false} projectCwd={PROJECT} />
    );

    const row = screen.getByRole("button", { name: "HISTORY.md" });
    expect(row.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(row);

    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(edit.file_path)).toBeTruthy();
  });

  it("opens the restore confirmation as a real dialog (B1)", () => {
    // Restore writes a file to disk, so its confirmation is exactly the control
    // that must work without a pointer. The previous hand-rolled overlay had no
    // role, no accessible name, no focus trap and no Escape handling.
    render(
      <FileEditRowCompact
        edit={makeEdit({ exists_on_disk: false })}
        isDarkMode={false}
        projectCwd={PROJECT}
      />
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getAllByLabelText("recentEdits.restoreFile")[0]!);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    // An accessible name is what CLAUDE.md's a11y checklist requires.
    expect(
      screen.getByText("recentEdits.confirmRestoreTitle")
    ).toBeTruthy();
  });

  it("keeps the click target off the expansion", () => {
    // The full-bleed expand button is positioned against its own wrapper. If
    // that wrapper were the whole row, the invisible target would stretch over
    // the expanded diff, so a click anywhere in the code view would collapse
    // the row and the expansion's own content would fight it for pointer
    // events. Real-render verification caught exactly that.
    const edit = makeEdit();
    render(
      <FileEditRowCompact edit={edit} isDarkMode={false} projectCwd={PROJECT} />
    );

    const row = screen.getByRole("button", { name: "HISTORY.md" });
    fireEvent.click(row);

    const fullPath = screen.getByText(edit.file_path);
    expect(row.parentElement).toBeTruthy();
    expect(row.parentElement?.contains(fullPath)).toBe(false);
  });

  it("leads with Restore when the file is missing on disk", () => {
    render(
      <FileEditRowCompact
        edit={makeEdit({ exists_on_disk: false })}
        isDarkMode={false}
        projectCwd={PROJECT}
      />
    );

    // Reveal is useless for a file that is not there, so it is not offered.
    expect(screen.queryByLabelText("recentEdits.revealInExplorer")).toBeNull();
    expect(screen.getAllByLabelText("recentEdits.restoreFile").length).toBe(1);
    expect(screen.getByLabelText("Missing on disk")).toBeTruthy();
  });

  it("offers Reveal when the file still exists", () => {
    render(
      <FileEditRowCompact
        edit={makeEdit({ exists_on_disk: true })}
        isDarkMode={false}
        projectCwd={PROJECT}
      />
    );

    expect(screen.getByLabelText("recentEdits.revealInExplorer")).toBeTruthy();
  });

  it("gives every icon-only button an accessible name", () => {
    const { container } = render(
      <FileEditRowCompact
        edit={makeEdit({ exists_on_disk: true })}
        isDarkMode={false}
        projectCwd={PROJECT}
      />
    );

    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      const hasText = (button.textContent ?? "").trim().length > 0;
      const hasLabel = Boolean(button.getAttribute("aria-label"));
      expect(hasText || hasLabel).toBe(true);
    }
  });

  it("hides the jump arrow when the edit carries no message uuid", () => {
    const onJumpToMessage = vi.fn();
    render(
      <FileEditRowCompact
        edit={makeEdit()}
        isDarkMode={false}
        projectCwd={PROJECT}
        onJumpToMessage={onJumpToMessage}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "HISTORY.md" }));

    expect(screen.queryByLabelText("Jump to the most recent edit")).toBeNull();
  });

  it("jumps to the originating message when one is known", () => {
    const onJumpToMessage = vi.fn();
    render(
      <FileEditRowCompact
        edit={makeEdit({ message_uuid: "msg-1" })}
        isDarkMode={false}
        projectCwd={PROJECT}
        grouping="edit"
        onJumpToMessage={onJumpToMessage}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "HISTORY.md" }));
    fireEvent.click(screen.getByLabelText("Jump to message"));

    expect(onJumpToMessage).toHaveBeenCalledWith("msg-1");
  });
});
