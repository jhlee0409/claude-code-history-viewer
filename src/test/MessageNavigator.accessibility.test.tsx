import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MessageNavigator } from "@/components/MessageNavigator";

const { navigateToMessageMock, useAppStoreMock } = vi.hoisted(() => {
  const navigateToMessage = vi.fn();

  const state = {
    navigateToMessage,
    targetMessageUuid: "message-2",
  };

  return {
    navigateToMessageMock: navigateToMessage,
    useAppStoreMock: (selector?: (store: typeof state) => unknown) =>
      typeof selector === "function" ? selector(state) : state,
  };
});

vi.mock("@/store/useAppStore", () => ({
  useAppStore: useAppStoreMock,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 40,
      })),
    getTotalSize: () => count * 40,
    scrollToIndex: vi.fn(),
  }),
}));

describe("MessageNavigator accessibility", () => {
  it("supports roving focus and keyboard activation", () => {
    render(
      <MessageNavigator
        messages={[
          { uuid: "message-1", type: "user", content: "First", timestamp: "2026-02-27T10:00:00Z" } as never,
          { uuid: "message-2", type: "assistant", content: "Second", timestamp: "2026-02-27T10:01:00Z" } as never,
          { uuid: "message-3", type: "assistant", content: "Third", timestamp: "2026-02-27T10:02:00Z" } as never,
        ]}
        width={260}
        isResizing={false}
        onResizeStart={vi.fn()}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />
    );

    const currentEntry = screen.getByRole("option", { name: "assistant message 2" });
    expect(currentEntry).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("listbox")).toHaveAttribute(
      "aria-describedby",
      "message-navigator-keyboard-help"
    );

    act(() => {
      currentEntry.focus();
    });
    act(() => {
      fireEvent.keyDown(currentEntry, { key: "ArrowDown" });
    });

    const movedEntry = screen.getByRole("option", { name: "assistant message 3" });
    expect(movedEntry).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(movedEntry, { key: "Enter" });
    expect(navigateToMessageMock).toHaveBeenCalledWith("message-3");
  });
});
