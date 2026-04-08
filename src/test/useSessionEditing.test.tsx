import React from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { useSessionEditing } from "@/components/SessionItem/hooks/useSessionEditing";
import type { ClaudeSession } from "@/types";

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string) => fallback ?? "",
    }),
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/hooks/useSessionMetadata", () => ({
  useSessionDisplayName: () => "Session title",
  useSessionMetadata: () => ({
    customName: undefined,
    setCustomName: vi.fn().mockResolvedValue(undefined),
    hasClaudeCodeName: false,
    setHasClaudeCodeName: vi.fn().mockResolvedValue(undefined),
  }),
}));

const session: ClaudeSession & { provider: string; is_renamed: boolean } = {
  session_id: "session-id",
  actual_session_id: "actual-session-id",
  file_path: "/tmp/session.jsonl",
  project_name: "project",
  message_count: 10,
  first_message_time: "2026-04-08T00:00:00Z",
  last_message_time: "2026-04-08T01:00:00Z",
  last_modified: "2026-04-08T01:00:00Z",
  has_tool_use: true,
  has_errors: false,
  summary: "Summary",
  provider: "claude",
  is_renamed: false,
};

describe("useSessionEditing clipboard actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("falls back when browser clipboard write fails for copy session id", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("permission denied"));
    const setData = vi.fn();
    const addEventListener = vi.spyOn(document, "addEventListener");
    const removeEventListener = vi.spyOn(document, "removeEventListener");
    const execCommand = vi.fn().mockImplementation((command: string) => {
      expect(command).toBe("copy");
      const copyHandler = addEventListener.mock.calls.find(
        ([eventName]) => eventName === "copy"
      )?.[1] as EventListener | undefined;
      expect(copyHandler).toBeDefined();
      copyHandler?.({
        preventDefault: vi.fn(),
        clipboardData: { setData },
      } as unknown as ClipboardEvent);
      return true;
    });

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    const stopPropagation = vi.fn();
    const { result } = renderHook(() => useSessionEditing(session));

    await act(async () => {
      await result.current.handleCopySessionId({
        stopPropagation,
      } as unknown as React.MouseEvent);
    });

    expect(stopPropagation).toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith("actual-session-id");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(setData).toHaveBeenCalledWith("text/plain", "actual-session-id");
    expect(removeEventListener).toHaveBeenCalledWith(
      "copy",
      expect.any(Function)
    );
    expect(toast.success).toHaveBeenCalledWith("Session ID copied");
  });

  it("reports copy failure when fallback cannot write clipboard payload", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("permission denied"));
    const addEventListener = vi.spyOn(document, "addEventListener");
    const execCommand = vi.fn().mockImplementation((command: string) => {
      expect(command).toBe("copy");
      const copyHandler = addEventListener.mock.calls.find(
        ([eventName]) => eventName === "copy"
      )?.[1] as EventListener | undefined;
      expect(copyHandler).toBeDefined();
      copyHandler?.({
        preventDefault: vi.fn(),
        clipboardData: null,
      } as unknown as ClipboardEvent);
      return true;
    });

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    const { result } = renderHook(() => useSessionEditing(session));

    await act(async () => {
      await result.current.handleCopySessionId({
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent);
    });

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Copy failed");
  });
});
