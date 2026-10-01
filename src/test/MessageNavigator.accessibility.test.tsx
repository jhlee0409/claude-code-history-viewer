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
    storeState.userOnlyFilter = false;
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

  it("keeps only typed prompts and commands when the user-only filter is on", () => {
    storeState.userOnlyFilter = true;

    render(
      <MessageNavigator
        messages={[
          {
            uuid: "prompt",
            type: "user",
            content: "Scrub for pii",
            timestamp: "2026-02-27T10:00:00Z",
          } as never,
          {
            uuid: "command",
            type: "user",
            content: "<command-message>wrap</command-message>\n<command-name>/wrap</command-name>",
            timestamp: "2026-02-27T10:01:00Z",
          } as never,
          {
            uuid: "agent-update",
            type: "user",
            content: '<task-notification><task-id>agent-1</task-id><status>completed</status><summary>Agent "Batch A" finished</summary></task-notification>',
            timestamp: "2026-02-27T10:02:00Z",
          } as never,
          {
            uuid: "orphan-tool-result",
            type: "user",
            content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }],
            toolUseResult: { stdout: "ok" },
            timestamp: "2026-02-27T10:03:00Z",
          } as never,
        ]}
        width={260}
        isResizing={false}
        onResizeStart={vi.fn()}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />
    );

    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByText("Scrub for pii")).toBeInTheDocument();
    expect(screen.getByText("/wrap")).toBeInTheDocument();
    expect(screen.queryByText('Agent "Batch A" finished')).not.toBeInTheDocument();
  });

  it("previews an agent update by its summary instead of its IDs", () => {
    render(
      <MessageNavigator
        messages={[
          {
            uuid: "agent-update",
            type: "user",
            content: '<task-notification><task-id>ad2512cc64c5db295</task-id><tool-use-id>toolu_01ATyz</tool-use-id><status>completed</status><summary>Agent "W6 upgrade" finished</summary></task-notification>',
            timestamp: "2026-02-27T10:02:00Z",
          } as never,
        ]}
        width={260}
        isResizing={false}
        onResizeStart={vi.fn()}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />
    );

    expect(screen.getByText('Agent "W6 upgrade" finished')).toBeInTheDocument();
    expect(screen.queryByText(/ad2512cc64c5db295/)).not.toBeInTheDocument();
    expect(screen.getByRole("option")).toHaveAttribute("aria-label", "navigator.a11y.entryLabel");
  });

  it("marks a failed agent update in the destructive color", () => {
    render(
      <MessageNavigator
        messages={[
          {
            uuid: "failed-update",
            type: "user",
            content: '<task-notification><task-id>agent-2</task-id><status>failed</status><summary>Agent "Batch B" failed</summary></task-notification>',
            timestamp: "2026-02-27T10:04:00Z",
          } as never,
        ]}
        width={260}
        isResizing={false}
        onResizeStart={vi.fn()}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />
    );

    const icon = screen.getByRole("option").querySelector("svg");
    expect(icon).toHaveClass("text-destructive");
  });

  it("filters rows by the kind label they display, not the stored role", () => {
    render(
      <MessageNavigator
        messages={[
          {
            uuid: "prompt",
            type: "user",
            content: "Scrub for pii",
            timestamp: "2026-02-27T10:00:00Z",
          } as never,
          {
            uuid: "agent-update",
            type: "user",
            content: "<task-notification><task-id>bg-4</task-id><status>completed</status><summary>Batch A finished</summary></task-notification>",
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

    const filterInput = screen.getByRole("textbox");

    // The i18n mock returns keys, so the agent-update label is "navigator.kind.agentUpdate".
    fireEvent.change(filterInput, { target: { value: "agent" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByText("Batch A finished")).toBeInTheDocument();

    // Both rows are stored as role "user", but neither displays that word.
    fireEvent.change(filterInput, { target: { value: "user" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("marks a stopped agent update in the destructive color", () => {
    render(
      <MessageNavigator
        messages={[
          {
            uuid: "stopped-update",
            type: "user",
            content: "<task-notification><task-id>bg-3</task-id><status>stopped</status><summary>Background shell command didn't finish before the previous session ended</summary></task-notification>",
            timestamp: "2026-02-27T10:05:00Z",
          } as never,
        ]}
        width={260}
        isResizing={false}
        onResizeStart={vi.fn()}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />
    );

    const icon = screen.getByRole("option").querySelector("svg");
    expect(icon).toHaveClass("text-destructive");
  });

  it("marks an agent update failed when a later notification in it failed", () => {
    render(
      <MessageNavigator
        messages={[
          {
            uuid: "mixed-update",
            type: "user",
            content: [
              "<task-notification><task-id>bg-5</task-id><status>completed</status><summary>Batch A finished</summary></task-notification>",
              "<task-notification><task-id>bg-6</task-id><status>failed</status><summary>Batch B failed</summary></task-notification>",
            ].join("\n"),
            timestamp: "2026-02-27T10:06:00Z",
          } as never,
        ]}
        width={260}
        isResizing={false}
        onResizeStart={vi.fn()}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />
    );

    // The preview keeps the first notification's summary.
    expect(screen.getByText("Batch A finished")).toBeInTheDocument();
    const icon = screen.getByRole("option").querySelector("svg");
    expect(icon).toHaveClass("text-destructive");
  });

  it("hides a tool result's client-appended text when the user-only filter is on", () => {
    storeState.userOnlyFilter = true;

    render(
      <MessageNavigator
        messages={[
          {
            uuid: "prompt",
            type: "user",
            content: "Scrub for pii",
            timestamp: "2026-02-27T10:00:00Z",
          } as never,
          {
            uuid: "tool-loaded",
            type: "user",
            content: [{ type: "text", text: "Tool loaded." }],
            toolUseResult: { matches: ["WebFetch"], query: "select:WebFetch" },
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
    expect(screen.queryByText("Tool loaded.")).not.toBeInTheDocument();
  });
});
