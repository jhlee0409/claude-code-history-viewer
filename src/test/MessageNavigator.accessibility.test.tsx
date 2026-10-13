import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Range } from "@tanstack/react-virtual";
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

// The rows the mock virtualizer treats as in view. Null renders every row;
// a window renders only the rows the component's range extractor returns
// for it, as the real virtualizer does.
const virtualWindow = vi.hoisted(() => ({
  current: null as { startIndex: number; endIndex: number } | null,
}));
// The options the component last passed to the virtualizer, and the
// measurement callback it hands back.
const { virtualizerOptions, measureElementMock } = vi.hoisted(() => ({
  virtualizerOptions: { current: null as { getItemKey?: (index: number) => string | number } | null },
  measureElementMock: vi.fn(),
}));

vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-virtual")>();
  return {
    defaultRangeExtractor: actual.defaultRangeExtractor,
    useVirtualizer: (options: {
      count: number;
      rangeExtractor?: (range: Range) => number[];
      getItemKey?: (index: number) => string | number;
    }) => {
      const { count, rangeExtractor = actual.defaultRangeExtractor } = options;
      virtualizerOptions.current = options;
      const indexes = virtualWindow.current
        ? rangeExtractor({ ...virtualWindow.current, overscan: 0, count })
        : Array.from({ length: count }, (_, index) => index);
      return {
        getVirtualItems: () => indexes.map((index) => ({ index, start: index * 40 })),
        getTotalSize: () => count * 40,
        scrollToIndex: vi.fn(),
        measureElement: measureElementMock,
      };
    },
  };
});

describe("MessageNavigator accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.showParallelTasksInNavigator = true;
    storeState.userOnlyFilter = false;
    storeState.targetMessageUuid = "message-2";
    virtualWindow.current = null;
    virtualizerOptions.current = null;
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

  it("keeps the focused row rendered outside the virtual window, so Tab can reach the list", () => {
    // Twenty rows with only the first two in view, and the focused row the
    // last one, as after scrolling the panel away from the current message.
    storeState.targetMessageUuid = "message-20";
    virtualWindow.current = { startIndex: 0, endIndex: 1 };

    render(
      <MessageNavigator
        messages={Array.from({ length: 20 }, (_, index) => ({
          uuid: `message-${index + 1}`,
          type: "assistant",
          content: `Reply ${index + 1}`,
          timestamp: "2026-02-27T10:00:00Z",
        }) as never)}
        width={260}
        isResizing={false}
        onResizeStart={vi.fn()}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />
    );

    const rows = screen.getAllByRole("option");
    expect(rows).toHaveLength(3);
    expect(rows[2]).toHaveTextContent("Reply 20");
    expect(rows[2]).toHaveAttribute("tabindex", "0");
    expect(rows.filter((row) => row.getAttribute("tabindex") === "0")).toHaveLength(1);
  });

  it("measures each rendered row, so rows sit at their real heights", () => {
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

    const rows = screen.getAllByRole("option");
    rows.forEach((row, index) => {
      // measureElement finds a row's index through this attribute.
      expect(row).toHaveAttribute("data-index", String(index));
      expect(measureElementMock).toHaveBeenCalledWith(row);
    });
  });

  it("keys measured sizes by message, so a prepended page cannot shift them", () => {
    const message = (n: number) =>
      ({ uuid: `message-${n}`, type: "assistant", content: `Reply ${n}`, timestamp: "2026-02-27T10:00:00Z" }) as never;
    const props = {
      width: 260,
      isResizing: false,
      onResizeStart: vi.fn(),
      isCollapsed: false,
      onToggleCollapse: vi.fn(),
    };
    const { rerender } = render(<MessageNavigator messages={[message(3), message(4)]} {...props} />);
    expect(virtualizerOptions.current?.getItemKey?.(0)).toBe("message-3");

    // Loading an earlier page puts two rows in front; message-3 moves to
    // index 2 and must keep its key there.
    rerender(<MessageNavigator messages={[message(1), message(2), message(3), message(4)]} {...props} />);
    expect(virtualizerOptions.current?.getItemKey?.(2)).toBe("message-3");
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

  it("leaves Alt+Arrow keys to the prompt-jump shortcut", () => {
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
    act(() => {
      currentEntry.focus();
    });
    // fireEvent returns false when a handler called preventDefault().
    const notPrevented = fireEvent.keyDown(currentEntry, { key: "ArrowDown", altKey: true });

    expect(notPrevented).toBe(true);
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("tabindex", "0");
  });

  it("names the prompt-jump shortcut in the person button's tooltip", () => {
    render(
      <MessageNavigator
        messages={[
          { uuid: "prompt", type: "user", content: "Scrub for pii", timestamp: "2026-02-27T10:00:00Z" } as never,
        ]}
        width={260}
        isResizing={false}
        onResizeStart={vi.fn()}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />
    );

    const personButton = screen.getByRole("button", { name: "navigator.userOnly" });
    expect(personButton.getAttribute("title")).toContain("navigator.promptJumpHint");
    expect(document.getElementById("message-navigator-keyboard-help")?.textContent)
      .toContain("navigator.promptJumpHint");
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
