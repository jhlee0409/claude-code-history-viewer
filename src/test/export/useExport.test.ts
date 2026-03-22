import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useExport } from "@/hooks/useExport";
import type { ClaudeMessage } from "@/types";

// Mock Tauri environment
beforeAll(() => {
  (window as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});

afterAll(() => {
  delete (window as Record<string, unknown>).__TAURI_INTERNALS__;
});

// Mock modules
vi.mock("@/utils/fileDialog", () => ({
  saveFileDialog: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/services/export/markdownExporter", () => ({
  exportToMarkdown: vi.fn().mockReturnValue("# Markdown"),
}));

vi.mock("@/services/export/jsonExporter", () => ({
  exportToJson: vi.fn().mockReturnValue('{"test": true}'),
}));

vi.mock("@/services/export/htmlExporter", () => ({
  exportToHtml: vi.fn().mockReturnValue("<html></html>"),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("@/store/useAppStore", () => ({
  useAppStore: () => ({
    messageFilter: {
      roles: { user: true, assistant: true },
      contentTypes: { text: true, thinking: true, toolCalls: true, commands: true },
    },
    isMessageFilterActive: () => false,
  }),
}));

function makeMessage(type: "user" | "assistant", content: string): ClaudeMessage {
  return {
    uuid: "test",
    sessionId: "s1",
    timestamp: "2026-03-13T10:00:00Z",
    type,
    role: type,
    content,
  } as ClaudeMessage;
}

describe("useExport", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should call saveFileDialog with correct mimeType for markdown", async () => {
    const { saveFileDialog } = await import("@/utils/fileDialog");
    const messages = [makeMessage("user", "hello")];

    const { result } = renderHook(() => useExport(messages, "test-session"));

    await act(async () => {
      await result.current.exportConversation("markdown");
    });

    expect(saveFileDialog).toHaveBeenCalledWith(
      "# Markdown",
      expect.objectContaining({
        defaultPath: "test-session.md",
        mimeType: "text/markdown",
      }),
    );
  });

  it("should call saveFileDialog with correct mimeType for json", async () => {
    const { saveFileDialog } = await import("@/utils/fileDialog");
    const messages = [makeMessage("user", "hello")];

    const { result } = renderHook(() => useExport(messages, "test-session"));

    await act(async () => {
      await result.current.exportConversation("json");
    });

    expect(saveFileDialog).toHaveBeenCalledWith(
      '{"test": true}',
      expect.objectContaining({
        defaultPath: "test-session.json",
        mimeType: "application/json",
      }),
    );
  });

  it("should show success toast on completion", async () => {
    const { toast } = await import("sonner");
    const messages = [makeMessage("user", "hello")];

    const { result } = renderHook(() => useExport(messages, "test-session"));

    await act(async () => {
      await result.current.exportConversation("markdown");
    });

    expect(toast.success).toHaveBeenCalledWith("session.export.success");
  });

  it("should show error toast on failure", async () => {
    const { saveFileDialog } = await import("@/utils/fileDialog");
    const { toast } = await import("sonner");
    vi.mocked(saveFileDialog).mockRejectedValueOnce(new Error("fail"));

    const messages = [makeMessage("user", "hello")];

    const { result } = renderHook(() => useExport(messages, "test-session"));

    await act(async () => {
      await result.current.exportConversation("markdown");
    });

    expect(toast.error).toHaveBeenCalledWith("session.export.error");
  });

  it("should not export when messages are empty", async () => {
    const { saveFileDialog } = await import("@/utils/fileDialog");

    const { result } = renderHook(() => useExport([], "test-session"));

    await act(async () => {
      await result.current.exportConversation("markdown");
    });

    expect(saveFileDialog).not.toHaveBeenCalled();
  });
});
