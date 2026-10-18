/**
 * Restore must never send non-file content to `restore_file`.
 *
 * Feeds the row shapes the backend builds for non-Claude providers (see
 * `build_tool_use_edits` in `src-tauri/src/commands/session/edits.rs`) into
 * the real card and compact row, then drives Restore -> Confirm.
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

const row = (content: string): RecentFileEdit => ({
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

  it.each([
    ["codex apply_patch text", CODEX_PATCH, "codex:///Users/alex/repo"],
    ["opencode edit fragment", FRAGMENT, "opencode://proj1"],
    ["opencode multiedit json", JSON_BLOB, "opencode://proj1"],
  ])("never sends %s to restore_file", async (_label, content, projectPath) => {
    render(
      <Row edit={row(content)} isDarkMode={false} projectCwd={PROJECT} restoreScope={{ projectPath }} />
    );
    await restoreAndConfirm();
    const writes = apiMock.mock.calls.filter((c) => c[0] === "restore_file");
    expect(writes).toEqual([]);
  });
});
