import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MessageNavigator } from "@/components/MessageNavigator";

const {
  navigateToMessageMock,
  toggleShowParallelTasksMock,
  useAppStoreMock,
  storeState,
} = vi.hoisted(() => {
  const navigateToMessage = vi.fn();
  const toggleShowParallelTasks = vi.fn();

  const state = {
    navigateToMessage,
    targetMessageUuid: "message-2",
    userOnlyFilter: false,
    toggleUserOnlyFilter: vi.fn(),
    showParallelTasksInNavigator: true,
    toggleShowParallelTasksInNavigator: toggleShowParallelTasks,
  };

  return {
    navigateToMessageMock: navigateToMessage,
    toggleShowParallelTasksMock: toggleShowParallelTasks,
    useAppStoreMock: (selector?: (store: typeof state) => unknown) =>
      typeof selector === "function" ? selector(state) : state,
    storeState: state,
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
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.showParallelTasksInNavigator = true;
  });

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

    const currentEntry = screen.getAllByRole("option")[1];
    expect(currentEntry).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("listbox")).toHaveAttribute(
      "aria-describedby",
      "message-navigator-keyboard-help"
    );
    expect(screen.queryByRole("button", {
      name: "navigator.showParallelTasks",
    })).not.toBeInTheDocument();

    act(() => {
      currentEntry.focus();
    });
    act(() => {
      fireEvent.keyDown(currentEntry, { key: "ArrowDown" });
    });

    const movedEntry = screen.getAllByRole("option")[2];
    expect(movedEntry).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(movedEntry, { key: "Enter" });
    expect(navigateToMessageMock).toHaveBeenCalledWith("message-3");
  });

  it("hides Parallel Tasks entries and exposes a header toggle", () => {
    storeState.showParallelTasksInNavigator = false;

    render(
      <MessageNavigator
        messages={[
          {
            uuid: "parallel-task",
            type: "user",
            content: "<task-notification><task-id>agent-1</task-id></task-notification>",
            timestamp: "2026-02-27T10:00:00Z",
          } as never,
          {
            uuid: "human-message",
            type: "user",
            content: "Human prompt",
            timestamp: "2026-02-27T10:01:00Z",
          } as never,
        ]}
        width={260}
        isResizing={false}
        onResizeStart={vi.fn()}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />
    );

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByText("Human prompt")).toBeInTheDocument();

    const toggle = screen.getByRole("button", {
      name: "navigator.showParallelTasks",
    });
    const userOnlyToggle = screen.getByRole("button", {
      name: "navigator.userOnly",
    });
    expect(
      userOnlyToggle.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(toggleShowParallelTasksMock).toHaveBeenCalledOnce();
  });
});
