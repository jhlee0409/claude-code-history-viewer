/**
 * Restore must never send non-file content to `restore_file`.
 *
 * Feeds the row shapes the backend builds for non-Claude providers (see
 * `build_tool_use_edits` in `src-tauri/src/commands/session/edits.rs`) into
 * the real card and compact row, then drives Restore -> Confirm. Only a row
 * whose `content_kind` is `"full"` may reach `restore_file`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import type React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === "string" ? fallback : key),
  }),
}));

const apiMock = vi.fn();
vi.mock("@/services/api", () => ({ api: (...a: unknown[]) => apiMock(...a) }));
vi.mock("@/utils/platform", () => ({
  isTauri: () => true,
  isMacOS: () => true,
  isWindows: () => false,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

import { FileEditItem } from "./FileEditItem";
import { FileEditRowCompact } from "./FileEditRowCompact";
import type { RecentFileEdit } from "../../types";

const PROJECT = "/Users/alex/repo";
const FILE = `${PROJECT}/src/lib.rs`;
const DISK = "fn alpha() {\n    1\n}\n\nfn beta() {\n    20\n}\n";

// Codex `apply_patch`: the whole multi-file patch, copied onto every file it names.
const CODEX_PATCH =
  "*** Begin Patch\n*** Update File: src/lib.rs\n@@ fn beta() {\n-    2\n+    20\n*** Update File: src/other.rs\n@@\n-old\n+new\n*** End Patch\n";
// OpenCode / Kilo `edit`: only `new_string`.
const FRAGMENT = "    20\n";
// OpenCode / Kilo `multiedit`: the tool input JSON as a fallback.
const JSON_BLOB = `{"edits":[{"newString":"    20\\n","oldString":"    2\\n"}],"filePath":"${FILE}"}`;

const RESTORE_TITLES = ["recentEdits.restoreFile", "recentEdits.restoreUnavailable"];

const row = (content: string, kind?: RecentFileEdit["content_kind"]): RecentFileEdit => ({
  content_kind: kind,
  file_path: FILE,
  timestamp: "2026-10-19T01:00:03Z",
  session_id: "sess-restore",
  operation_type: "edit",
  content_after_change: content,
  lines_added: 1,
  lines_removed: 1,
  cwd: PROJECT,
  exists_on_disk: true,
});

type RowComponent = React.FC<{
  edit: RecentFileEdit;
  isDarkMode: boolean;
  projectCwd?: string;
  restoreScope?: { projectPath: string; sessionFilePath?: string };
}>;

const flush = () => act(() => new Promise((r) => setTimeout(r, 20)));

/** Click Restore, and Confirm if the dialog opens. */
async function restoreAndConfirm() {
  const restoreButton = screen
    .getAllByRole("button")
    .find((b) => RESTORE_TITLES.includes(b.getAttribute("title") ?? ""));
  expect(restoreButton, "the row renders a Restore control").toBeDefined();
  fireEvent.click(restoreButton!);
  await flush();
  const confirm = screen.queryByText("recentEdits.confirmRestore");
  if (confirm) {
    fireEvent.click(confirm);
    await flush();
  }
}

describe.each<[string, RowComponent]>([
  ["FileEditItem", FileEditItem as RowComponent],
  ["FileEditRowCompact", FileEditRowCompact as RowComponent],
])("%s restore safety", (_name, Row) => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation((cmd: string) =>
      Promise.resolve(cmd === "read_restore_target" ? DISK : undefined)
    );
  });

  // The kind the backend now sends with each shape, or none (older payload).
  it.each([
    ["codex apply_patch text", CODEX_PATCH, "codex:///Users/alex/repo", "patch"],
    ["opencode edit fragment", FRAGMENT, "opencode://proj1", "fragment"],
    ["opencode multiedit json", JSON_BLOB, "opencode://proj1", "unavailable"],
    ["untagged content", CODEX_PATCH, "codex:///Users/alex/repo", undefined],
  ] as const)("never sends %s to restore_file", async (_label, content, projectPath, kind) => {
    render(
      <Row
        edit={row(content, kind)}
        isDarkMode={false}
        projectCwd={PROJECT}
        restoreScope={{ projectPath }}
      />
    );
    await restoreAndConfirm();
    const writes = apiMock.mock.calls.filter((c) => c[0] === "restore_file");
    expect(writes).toEqual([]);
  });

  const renderUnavailable = () =>
    render(
      <Row
        edit={row(CODEX_PATCH, "patch")}
        isDarkMode={false}
        projectCwd={PROJECT}
        restoreScope={{ projectPath: "codex:///Users/alex/repo" }}
      />
    );

  // `aria-disabled`, not native `disabled`: a natively disabled button leaves
  // the tab order, so keyboard and screen-reader users never reach the reason,
  // and some webviews do not show `title` on disabled elements.
  it("keeps Restore visible but aria-disabled, with the reason as its label", () => {
    renderUnavailable();
    const button = screen.getByRole("button", { name: "recentEdits.restoreUnavailable" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("title", "recentEdits.restoreUnavailable");
    expect(screen.queryByRole("button", { name: "recentEdits.restoreFile" })).toBeNull();
  });

  it("keeps the unavailable Restore button keyboard-focusable", () => {
    renderUnavailable();
    const button = screen.getByRole("button", { name: "recentEdits.restoreUnavailable" });
    expect(button.tabIndex).toBe(0);
    act(() => button.focus());
    expect(document.activeElement).toBe(button);
  });

  it("does nothing when the unavailable Restore button is activated", async () => {
    renderUnavailable();
    const button = screen.getByRole("button", { name: "recentEdits.restoreUnavailable" });
    act(() => button.focus());
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Enter", code: "Enter" });
    fireEvent.keyDown(button, { key: " ", code: "Space" });
    fireEvent.keyUp(button, { key: " ", code: "Space" });
    await flush();
    expect(screen.queryByText("recentEdits.confirmRestore")).toBeNull();
    expect(apiMock.mock.calls.filter((c) => c[0] === "restore_file")).toEqual([]);
  });

  it.each([
    ["a whole-file row", DISK],
    ["an empty whole-file row", ""],
  ])("restores %s", async (_label, content) => {
    render(
      <Row
        edit={row(content, "full")}
        isDarkMode={false}
        projectCwd={PROJECT}
        restoreScope={{ projectPath: PROJECT }}
      />
    );
    const button = screen.getByRole("button", { name: "recentEdits.restoreFile" });
    expect(button).toHaveProperty("disabled", false);
    expect(button).not.toHaveAttribute("aria-disabled");
    await restoreAndConfirm();
    expect(apiMock).toHaveBeenCalledWith("restore_file", {
      filePath: FILE,
      content,
      projectPath: PROJECT,
      sessionFilePath: undefined,
    });
  });
});
