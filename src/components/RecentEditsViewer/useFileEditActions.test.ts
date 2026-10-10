/**
 * `confirmRestore` decides which project authorises the write. These pin that
 * it always uses the scope from the latest render, not the one it was first
 * created with.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
  }),
}));

const apiMock = vi.fn();
vi.mock("@/services/api", () => ({ api: (...a: unknown[]) => apiMock(...a) }));

vi.mock("@/utils/platform", () => ({
  isTauri: () => true,
  isMacOS: () => false,
  isWindows: () => true,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

import { useFileEditActions } from "./useFileEditActions";
import type { RecentFileEdit } from "../../types";

const edit: RecentFileEdit = {
  file_path: "/Users/alex/Projects/my-app/src/main.ts",
  timestamp: new Date("2026-08-19T06:37:00Z").toISOString(),
  session_id: "s1",
  operation_type: "edit",
  content_after_change: "after content",
  original_content: "before content",
  lines_added: 3,
  lines_removed: 1,
};

type Scope = { projectPath: string; sessionFilePath?: string } | undefined;

describe("useFileEditActions restore scope", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockResolvedValue(undefined);
  });

  it("restores against the scope from the latest render", async () => {
    const { result, rerender } = renderHook(
      ({ restoreScope }: { restoreScope: Scope }) =>
        useFileEditActions(edit, { restoreScope }),
      {
        initialProps: {
          restoreScope: { projectPath: "/projects/a", sessionFilePath: "/sessions/a.jsonl" },
        },
      }
    );

    // Same edit, different originating project and session.
    rerender({
      restoreScope: { projectPath: "/projects/b", sessionFilePath: "/sessions/b.jsonl" },
    });

    await act(async () => {
      await result.current.confirmRestore();
    });

    expect(apiMock).toHaveBeenCalledWith("restore_file", {
      filePath: edit.file_path,
      content: edit.content_after_change,
      projectPath: "/projects/b",
      sessionFilePath: "/sessions/b.jsonl",
    });
  });

  it("refuses to restore once the scope is removed", async () => {
    const { result, rerender } = renderHook(
      ({ restoreScope }: { restoreScope: Scope }) =>
        useFileEditActions(edit, { restoreScope }),
      { initialProps: { restoreScope: { projectPath: "/projects/a" } as Scope } }
    );

    rerender({ restoreScope: undefined });

    await act(async () => {
      await result.current.confirmRestore();
    });

    expect(apiMock).not.toHaveBeenCalled();
    expect(result.current.restoreStatus).toBe("error");
  });
});
