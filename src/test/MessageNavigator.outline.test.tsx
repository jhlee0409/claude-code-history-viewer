import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MessageNavigator } from "@/components/MessageNavigator";
import type { ClaudeMessage } from "@/types";

const {
  navigateToMessageMock,
  toggleUserOnlyFilterMock,
  toggleNavigatorViewModeMock,
  useAppStoreMock,
  storeState,
} = vi.hoisted(() => {
  const navigateToMessage = vi.fn();
  const toggleUserOnlyFilter = vi.fn();
  const toggleNavigatorViewMode = vi.fn();

  const state = {
    navigateToMessage,
    targetMessageUuid: null as string | null,
    userOnlyFilter: false,
    toggleUserOnlyFilter,
    showParallelTasksInNavigator: true,
    toggleShowParallelTasksInNavigator: vi.fn(),
    navigatorViewMode: "outline" as "list" | "outline",
    toggleNavigatorViewMode,
    visibleMessageUuid: null as string | null,
    selectedSession: { session_id: "session-1" } as { session_id: string },
    pagination: { hasMore: false, isLoadingMore: false },
  };

  return {
    navigateToMessageMock: navigateToMessage,
    toggleUserOnlyFilterMock: toggleUserOnlyFilter,
    toggleNavigatorViewModeMock: toggleNavigatorViewMode,
    useAppStoreMock: (selector?: (store: typeof state) => unknown) =>
      typeof selector === "function" ? selector(state) : state,
    storeState: state,
  };
});

vi.mock("@/store/useAppStore", () => ({
  useAppStore: useAppStoreMock,
}));

// Interpolated keys resolve to "key:value" (count) or "key:{...}" (object)
// so assertions can distinguish e.g. "4 replies" from "0 agents started".
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: unknown) => {
      if (typeof opts === "string") return key;
      if (opts && typeof opts === "object" && "count" in (opts as Record<string, unknown>)) {
        return `${key}:${(opts as { count: unknown }).count}`;
      }
      if (opts && typeof opts === "object") return `${key}:${JSON.stringify(opts)}`;
      return key;
    },
  }),
}));

const useVirtualizerMock = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: useVirtualizerMock,
}));

interface VirtualizerOptions {
  count: number;
  estimateSize?: (index: number) => number;
  getItemKey?: (index: number) => string | number;
}

function installDefaultVirtualizerMock() {
  useVirtualizerMock.mockImplementation((options: VirtualizerOptions) => {
    let offset = 0;
    const items = Array.from({ length: options.count }, (_, index) => {
      const size = options.estimateSize ? options.estimateSize(index) : 40;
      const start = offset;
      offset += size;
      const key = options.getItemKey ? options.getItemKey(index) : index;
      return { index, start, size, key };
    });
    return {
      getVirtualItems: () => items,
      getTotalSize: () => offset,
      scrollToIndex: vi.fn(),
      measureElement: vi.fn(),
    };
  });
}

const makeMessage = (overrides: Record<string, unknown>): ClaudeMessage => ({
  uuid: "message",
  type: "user",
  role: "user",
  timestamp: "2026-10-05T06:00:00.000Z",
  content: "",
  ...overrides,
} as unknown as ClaudeMessage);

function renderNavigator(messages: ClaudeMessage[]) {
  return render(
    <MessageNavigator
      messages={messages}
      width={280}
      isResizing={false}
      onResizeStart={vi.fn()}
      isCollapsed={false}
      onToggleCollapse={vi.fn()}
    />,
  );
}

// `getByRole(..., { level })` only applies to the "heading" role (RTL
// throws for any other role), so outline tree levels are matched by reading
// `aria-level` directly instead.
function getHeaderItem(): HTMLElement {
  const header = screen
    .getAllByRole("treeitem")
    .find((el) => el.getAttribute("aria-level") === "1");
  if (!header) throw new Error("Expected a level-1 treeitem (turn header)");
  return header;
}

function getChildItems(): HTMLElement[] {
  return screen.getAllByRole("treeitem").filter((el) => el.getAttribute("aria-level") === "2");
}

function getChildItem(index = 0): HTMLElement {
  const item = getChildItems()[index];
  if (!item) throw new Error(`Expected a level-2 treeitem at index ${index}`);
  return item;
}

describe("MessageNavigator outline mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installDefaultVirtualizerMock();
    storeState.navigatorViewMode = "outline";
    storeState.targetMessageUuid = null;
    storeState.userOnlyFilter = false;
    storeState.visibleMessageUuid = null;
    storeState.pagination = { hasMore: false, isLoadingMore: false };
    storeState.showParallelTasksInNavigator = true;
  });

  it("toggles navigatorViewMode when the header switch is clicked", () => {
    storeState.navigatorViewMode = "list";
    renderNavigator([
      makeMessage({ uuid: "p1", content: "Scrub for pii" }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "navigator.viewMode.outline" }));
    expect(toggleNavigatorViewModeMock).toHaveBeenCalledOnce();
  });

  it("shows a closed turn's label, preview, and only non-zero counts, counting a reply row's own tool_use blocks", () => {
    renderNavigator([
      makeMessage({ uuid: "p1", content: "Scrub for pii" }),
      makeMessage({
        uuid: "r1",
        type: "assistant",
        role: "assistant",
        content: [
          { type: "text", text: "Scrubbing now." },
          { type: "tool_use", id: "toolu_1", name: "Bash", input: {} },
          { type: "tool_use", id: "toolu_2", name: "Read", input: {} },
        ],
      }),
    ]);

    // Closed: only the header renders, no level-2 treeitem children.
    expect(screen.getAllByRole("treeitem")).toHaveLength(1);
    expect(screen.getByText("Scrub for pii")).toBeInTheDocument();

    // replies=1, toolCalls=2 (from the reply's own tool_use blocks) shown;
    // agentsStarted=0, agentUpdates=0 omitted entirely.
    expect(screen.getByText("navigator.outline.replies:1")).toBeInTheDocument();
    expect(screen.getByText("navigator.outline.toolCalls:2")).toBeInTheDocument();
    expect(screen.queryByText(/navigator\.outline\.agentsStarted/)).not.toBeInTheDocument();
    expect(screen.queryByText(/navigator\.outline\.agentUpdates/)).not.toBeInTheDocument();
  });

  it("opens and navigates when a closed header is clicked", () => {
    renderNavigator([
      makeMessage({ uuid: "p1", content: "Scrub for pii" }),
      makeMessage({
        uuid: "r1",
        type: "assistant",
        role: "assistant",
        content: [{ type: "text", text: "Scrubbing now." }],
      }),
    ]);

    const header = getHeaderItem();
    expect(header).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(header);

    expect(navigateToMessageMock).toHaveBeenCalledWith("p1");
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("treeitem")).toHaveLength(2);
  });

  it("shows one task row per task id, with the update count read from a batched notification", () => {
    storeState.targetMessageUuid = "p1"; // auto-opens the turn containing it

    renderNavigator([
      makeMessage({ uuid: "p1", content: "Launch two agents" }),
      makeMessage({
        uuid: "a1",
        content: [
          "<task-notification><task-id>task-a</task-id><status>running</status><summary>Task A starting</summary></task-notification>",
          "<task-notification><task-id>task-a</task-id><status>completed</status><summary>Task A done</summary></task-notification>",
        ].join("\n"),
      }),
      makeMessage({
        uuid: "a2",
        content: "<task-notification><task-id>task-b</task-id><status>running</status><summary>Task B running</summary></task-notification>",
      }),
    ]);

    const taskRows = getChildItems();
    expect(taskRows).toHaveLength(2);
    // task-a's row merges its batch's two blocks into one row, updateCount 2.
    expect(screen.getByText("Task A done")).toBeInTheDocument();
    expect(screen.getByText("navigator.outline.taskUpdates:2")).toBeInTheDocument();
    expect(screen.getByText("Task B running")).toBeInTheDocument();
    expect(screen.getByText("navigator.outline.taskUpdates:1")).toBeInTheDocument();
  });

  it("shows a task failed (destructive) even when a later update for it is non-failed", () => {
    storeState.targetMessageUuid = "p1";

    renderNavigator([
      makeMessage({ uuid: "p1", content: "Launch an agent" }),
      makeMessage({
        uuid: "a1",
        content: "<task-notification><task-id>task-a</task-id><status>failed</status><summary>Task A failed</summary></task-notification>",
      }),
      makeMessage({
        uuid: "a2",
        content: "<task-notification><task-id>task-a</task-id><status>completed</status><summary>Task A completed</summary></task-notification>",
      }),
    ]);

    const taskRow = getChildItem();
    const icon = taskRow.querySelector("svg");
    expect(icon).toHaveClass("text-destructive");
  });

  it("gives the tree, headers, and children the right roles, levels, and expanded state", () => {
    storeState.targetMessageUuid = "p1";

    renderNavigator([
      makeMessage({ uuid: "p1", content: "Scrub for pii" }),
      makeMessage({
        uuid: "r1",
        type: "assistant",
        role: "assistant",
        content: [{ type: "text", text: "Scrubbing now." }],
      }),
    ]);

    expect(screen.getByRole("tree")).toBeInTheDocument();

    const header = getHeaderItem();
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(header).toHaveAttribute("aria-posinset", "1");
    expect(header).toHaveAttribute("aria-setsize", "1");

    const child = getChildItem();
    expect(child).toHaveAttribute("aria-posinset", "1");
    expect(child).toHaveAttribute("aria-setsize", "1");
  });

  it("supports ArrowRight/ArrowLeft open-close navigation and Enter's dual navigate-and-toggle action", () => {
    renderNavigator([
      makeMessage({ uuid: "p1", content: "Scrub for pii" }),
      makeMessage({
        uuid: "r1",
        type: "assistant",
        role: "assistant",
        content: [{ type: "text", text: "Scrubbing now." }],
      }),
    ]);

    let header = getHeaderItem();
    act(() => header.focus());

    // ArrowRight on a closed header opens it (no navigation).
    fireEvent.keyDown(header, { key: "ArrowRight" });
    header = getHeaderItem();
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(navigateToMessageMock).not.toHaveBeenCalled();

    // ArrowRight on an open header moves focus to its first child.
    fireEvent.keyDown(header, { key: "ArrowRight" });
    let child = getChildItem();
    expect(child).toHaveAttribute("tabindex", "0");
    expect(header).toHaveAttribute("tabindex", "-1");

    // ArrowLeft on a child moves focus back to its parent header.
    fireEvent.keyDown(child, { key: "ArrowLeft" });
    header = getHeaderItem();
    expect(header).toHaveAttribute("tabindex", "0");

    // ArrowLeft on an open header closes it.
    fireEvent.keyDown(header, { key: "ArrowLeft" });
    header = getHeaderItem();
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(getChildItems()).toHaveLength(0);

    // Enter on a closed header navigates AND opens it.
    fireEvent.keyDown(header, { key: "Enter" });
    expect(navigateToMessageMock).toHaveBeenCalledWith("p1");
    header = getHeaderItem();
    expect(header).toHaveAttribute("aria-expanded", "true");

    // Space on a child navigates only (no toggle - there's nothing on a
    // child to toggle).
    child = getChildItem();
    act(() => child.focus());
    fireEvent.keyDown(child, { key: " " });
    expect(navigateToMessageMock).toHaveBeenCalledWith("r1");
  });

  it("leaves Alt+ArrowDown to the prompt-jump shortcut and moves no focus", () => {
    storeState.targetMessageUuid = "p1";

    renderNavigator([
      makeMessage({ uuid: "p1", content: "Scrub for pii" }),
      makeMessage({
        uuid: "r1",
        type: "assistant",
        role: "assistant",
        content: [{ type: "text", text: "Scrubbing now." }],
      }),
    ]);

    const header = getHeaderItem();
    act(() => header.focus());

    const notPrevented = fireEvent.keyDown(header, { key: "ArrowDown", altKey: true });

    expect(notPrevented).toBe(true);
    expect(getHeaderItem()).toHaveAttribute("tabindex", "0");
  });

  it("labels the person button 'Close all turns' in outline mode and closes every open turn", () => {
    storeState.targetMessageUuid = "p1";

    renderNavigator([
      makeMessage({ uuid: "p1", content: "Scrub for pii" }),
      makeMessage({
        uuid: "r1",
        type: "assistant",
        role: "assistant",
        content: [{ type: "text", text: "Scrubbing now." }],
      }),
    ]);

    const personButton = screen.getByRole("button", { name: "navigator.outline.closeAllTurns" });
    expect(personButton.getAttribute("title")).toContain("navigator.outline.closeAllTurns");
    expect(screen.getAllByRole("treeitem")).toHaveLength(2);

    fireEvent.click(personButton);

    expect(toggleUserOnlyFilterMock).toHaveBeenCalledOnce();
    expect(screen.getAllByRole("treeitem")).toHaveLength(1);
    expect(getHeaderItem()).toHaveAttribute("aria-expanded", "false");
  });

  it("falls back to the flat listbox when the free-text filter is non-empty, and restores the outline once cleared", () => {
    renderNavigator([
      makeMessage({ uuid: "p1", content: "Scrub for pii" }),
    ]);

    expect(screen.getByRole("tree")).toBeInTheDocument();

    const filterInput = screen.getByRole("textbox");
    fireEvent.change(filterInput, { target: { value: "scrub" } });

    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option")).toBeInTheDocument();

    fireEvent.change(filterInput, { target: { value: "" } });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("tree")).toBeInTheDocument();
  });

  it("removes parallel-task rows from the outline's counts and task rows via the lightning toggle, with no outline-specific filtering code", () => {
    storeState.targetMessageUuid = "p1";
    storeState.showParallelTasksInNavigator = false;

    renderNavigator([
      makeMessage({ uuid: "p1", content: "Launch an agent" }),
      makeMessage({
        uuid: "a1",
        content: "<task-notification><task-id>task-a</task-id><status>running</status><summary>Task A running</summary></task-notification>",
      }),
    ]);

    // The lightning toggle filters `messages` before grouping ever runs
    // (Verified constraints), so the agent-update row disappears before the
    // outline's counts or children are built: no agentUpdates chip, and no
    // task-id child once the turn opens.
    expect(screen.queryByText(/navigator\.outline\.agentUpdates/)).not.toBeInTheDocument();
    expect(getChildItems()).toHaveLength(0);
  });

  it("switches the leading group's label with pagination.hasMore", () => {
    const { rerender } = renderNavigator([
      makeMessage({
        uuid: "lead1",
        type: "assistant",
        role: "assistant",
        content: [{ type: "text", text: "Welcome back." }],
      }),
      makeMessage({ uuid: "p1", content: "Scrub for pii" }),
    ]);

    expect(screen.getByText("navigator.outline.beforeFirstPrompt")).toBeInTheDocument();
    // The real turn "p1" also reads plain turnLabel while hasMore is false.
    expect(screen.getByText('navigator.outline.turnLabel:{"n":1,"total":1}')).toBeInTheDocument();

    storeState.pagination = { hasMore: true, isLoadingMore: false };
    rerender(
      <MessageNavigator
        messages={[
          makeMessage({
            uuid: "lead1",
            type: "assistant",
            role: "assistant",
            content: [{ type: "text", text: "Welcome back." }],
          }),
          makeMessage({ uuid: "p1", content: "Scrub for pii" }),
        ]}
        width={280}
        isResizing={false}
        onResizeStart={vi.fn()}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />,
    );

    expect(screen.getByText("navigator.outline.earlierNotLoaded")).toBeInTheDocument();
    // And "p1" switches from plain turnLabel to turnLabelLoaded, per the
    // spec's "every real turn's own header also switches" rule.
    expect(screen.getByText('navigator.outline.turnLabelLoaded:{"n":1,"total":1}')).toBeInTheDocument();
  });

  it("highlights the turn containing visibleMessageUuid, even when that uuid belongs to a row the outline never renders", () => {
    storeState.visibleMessageUuid = "noise1";

    renderNavigator([
      makeMessage({ uuid: "p1", content: "Scrub for pii" }),
      makeMessage({ uuid: "noise1", type: "progress", content: "" }),
      makeMessage({
        uuid: "r1",
        type: "assistant",
        role: "assistant",
        content: [{ type: "text", text: "Scrubbing now." }],
      }),
    ]);

    // "noise1" is filtered out of the outline entirely (NOISE_TYPES), but
    // still resolves to turn "p1" via the raw-message turnOfMessage map.
    const header = getHeaderItem();
    expect(header).toHaveAttribute("aria-selected", "true");
  });

  it("renders the pinned header once scrolled into an open turn's children, and its click navigates without toggling", () => {
    storeState.targetMessageUuid = "p1"; // auto-opens the turn

    const messages = [
      makeMessage({ uuid: "p1", content: "Scrub for pii" }),
      makeMessage({
        uuid: "r1",
        type: "assistant",
        role: "assistant",
        content: [{ type: "text", text: "Scrubbing now." }],
      }),
      makeMessage({
        uuid: "r2",
        type: "assistant",
        role: "assistant",
        content: [{ type: "text", text: "Pushed to gh." }],
      }),
    ];

    const { rerender } = renderNavigator(messages);

    // No pinned header while the header itself is the first visible row.
    expect(screen.queryByRole("button", { name: "navigator.outline.jumpToTurn" })).not.toBeInTheDocument();

    // Header size: 34 base + 36 (has a preview) + 22 (replies=2 is a
    // non-zero count) = 92, occupying [0, 92). Each "message" child is 60
    // tall: r1 occupies [92, 152). scrollTop=100 lands inside r1's range and
    // past the header's end, so r1 becomes the first visible row.
    const tree = screen.getByRole("tree");
    tree.scrollTop = 100;

    // The mocked virtualizer does not subscribe to scroll like the real one
    // does, so the test drives a re-render itself (same DOM node, its
    // scrollTop survives) to make NavigatorOutline recompute the pinned
    // turn against the new value (Design, "Pinned turn header").
    rerender(
      <MessageNavigator
        messages={messages}
        width={280}
        isResizing={false}
        onResizeStart={vi.fn()}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />,
    );

    const pinned = screen.getByRole("button", { name: "navigator.outline.jumpToTurn" });
    expect(pinned).toBeInTheDocument();

    fireEvent.click(pinned);

    expect(navigateToMessageMock).toHaveBeenCalledWith("p1");
    // Clicking the overlay never toggles the turn: it is still open.
    expect(screen.getAllByRole("treeitem")).toHaveLength(3);
  });

  describe("focus and open turns across navigation", () => {
    const twoTurns = () => [
      makeMessage({ uuid: "p1", content: "First prompt" }),
      makeMessage({ uuid: "r1", type: "assistant", role: "assistant", content: [{ type: "text", text: "Reply one" }] }),
      makeMessage({ uuid: "p2", content: "Second prompt" }),
      makeMessage({ uuid: "r2", type: "assistant", role: "assistant", content: [{ type: "text", text: "Reply two" }] }),
    ];

    const rerenderWith = (rerender: (ui: React.ReactElement) => void, messages: ClaudeMessage[]) =>
      rerender(
        <MessageNavigator
          messages={messages}
          width={280}
          isResizing={false}
          onResizeStart={vi.fn()}
          isCollapsed={false}
          onToggleCollapse={vi.fn()}
        />,
      );

    const headers = () =>
      screen.getAllByRole("treeitem").filter((el) => el.getAttribute("aria-level") === "1");

    it("applies a key to the row that received it, even after the target moved", () => {
      const messages = twoTurns();
      const { rerender } = renderNavigator(messages);
      const first = headers()[0]!;
      fireEvent.keyDown(first, { key: "ArrowRight" });
      expect(headers()[0]).toHaveAttribute("aria-expanded", "true");

      // The prompt jump (or a click in the main list) moves the target to the
      // second prompt while DOM focus stays on the first header.
      storeState.targetMessageUuid = "p2";
      rerenderWith(rerender, messages);

      fireEvent.keyDown(headers()[0]!, { key: "ArrowLeft" });
      expect(headers()[0]).toHaveAttribute("aria-expanded", "false");
    });

    it("moves the roving focus to the parent header when 'Close all turns' removes the focused row", () => {
      renderNavigator(twoTurns());
      fireEvent.keyDown(headers()[0]!, { key: "ArrowRight" });
      fireEvent.focus(getChildItem(0));
      expect(getChildItem(0)).toHaveAttribute("tabindex", "0");

      fireEvent.click(screen.getByRole("button", { name: "navigator.outline.closeAllTurns" }));

      expect(getChildItems()).toHaveLength(0);
      expect(headers()[0]).toHaveAttribute("tabindex", "0");
      expect(headers()[1]).toHaveAttribute("tabindex", "-1");
    });

    it("opens the target's turn once the session's messages arrive", () => {
      storeState.targetMessageUuid = "r2";
      const { rerender } = renderNavigator([]);
      rerenderWith(rerender, twoTurns());

      expect(headers()[1]).toHaveAttribute("aria-expanded", "true");
      expect(headers()[0]).toHaveAttribute("aria-expanded", "false");
    });

    it("opens a closed turn when the target moves into it, but not when the target is a header", () => {
      const messages = twoTurns();
      const { rerender } = renderNavigator(messages);
      expect(headers()[0]).toHaveAttribute("aria-expanded", "false");

      storeState.targetMessageUuid = "r1";
      rerenderWith(rerender, messages);
      expect(headers()[0]).toHaveAttribute("aria-expanded", "true");

      // A prompt jump targets the header itself, which is already visible.
      storeState.targetMessageUuid = "p2";
      rerenderWith(rerender, messages);
      expect(headers()[1]).toHaveAttribute("aria-expanded", "false");
      // Turns the user opened stay open.
      expect(headers()[0]).toHaveAttribute("aria-expanded", "true");
    });
  });
});
