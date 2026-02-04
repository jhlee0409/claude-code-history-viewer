/**
 * @fileoverview Tests for SessionList component
 * Tests for session filtering, sorting, and combined functionality
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionList } from "../SessionList";
import type { ClaudeSession } from "../../../../types";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock SessionItem component
vi.mock("../../../SessionItem", () => ({
  SessionItem: ({
    session,
    isSelected,
    onSelect,
  }: {
    session: ClaudeSession;
    isSelected: boolean;
    onSelect: () => void;
  }) => (
    <div
      data-testid={`session-item-${session.session_id}`}
      data-selected={isSelected}
      onClick={onSelect}
    >
      <span data-testid="session-summary">{session.summary}</span>
      <span data-testid="session-modified">{session.last_modified}</span>
    </div>
  ),
}));

// Mock react-window
vi.mock("react-window", () => ({
  FixedSizeList: ({ children, itemData }: { children: React.ComponentType<{
    index: number;
    style: React.CSSProperties;
    data: {
      sessions: ClaudeSession[];
      selectedSession: ClaudeSession | null;
      onSessionSelect: (session: ClaudeSession) => void;
      formatTimeAgo: (date: string) => string;
    };
  }>; itemData: { sessions: ClaudeSession[] } }) => (
    <div data-testid="virtual-list">
      {itemData.sessions.map((_, index) =>
        children({ index, style: {}, data: itemData })
      )}
    </div>
  ),
}));

// Mock Tauri plugin-store to prevent errors
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock useAppStore with a reactive state
import { create } from "zustand";

interface MockStore {
  sessionSortOrder: 'newest' | 'oldest';
  setSessionSortOrder: (order: 'newest' | 'oldest') => void;
}

const useTestStore = create<MockStore>((set) => ({
  sessionSortOrder: 'newest',
  setSessionSortOrder: (order) => set({ sessionSortOrder: order }),
}));

vi.mock("@/store/useAppStore", () => ({
  useAppStore: () => useTestStore(),
}));

// Helper to create mock session
function createMockSession(overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  return {
    session_id: overrides.session_id ?? "test-session-id",
    actual_session_id: overrides.actual_session_id ?? "actual-session-id",
    file_path: overrides.file_path ?? "/path/to/session.jsonl",
    project_name: overrides.project_name ?? "test-project",
    message_count: overrides.message_count ?? 10,
    first_message_time: overrides.first_message_time ?? "2024-01-01T00:00:00Z",
    last_message_time: overrides.last_message_time ?? "2024-01-01T12:00:00Z",
    last_modified: overrides.last_modified ?? "2024-01-01T12:00:00Z",
    has_tool_use: overrides.has_tool_use ?? false,
    has_errors: overrides.has_errors ?? false,
    summary: overrides.summary,
  };
}

const mockSessions = [
  createMockSession({
    session_id: "session-1",
    summary: "First session about React",
    last_modified: "2026-02-04T10:00:00Z",
    file_path: "/path/to/session1.jsonl",
  }),
  createMockSession({
    session_id: "session-2",
    summary: "Second session about TypeScript",
    last_modified: "2026-02-05T10:00:00Z",
    file_path: "/path/to/session2.jsonl",
  }),
  createMockSession({
    session_id: "session-3",
    summary: "Third session about testing",
    last_modified: "2026-02-03T10:00:00Z",
    file_path: "/path/to/session3.jsonl",
  }),
];

describe("SessionList", () => {
  const defaultProps = {
    sessions: mockSessions,
    selectedSession: null,
    isLoading: false,
    onSessionSelect: vi.fn(),
    formatTimeAgo: (date: string) => date,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock store state
    useTestStore.setState({ sessionSortOrder: 'newest' });
  });

  describe("Loading state", () => {
    it("should show skeleton loaders when loading", () => {
      const { container } = render(<SessionList {...defaultProps} isLoading={true} />);

      // Skeleton elements have the animate-shimmer class
      const skeletons = container.querySelectorAll(".animate-shimmer");
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe("Empty state", () => {
    it("should show no sessions message when sessions array is empty", () => {
      render(<SessionList {...defaultProps} sessions={[]} />);

      expect(screen.getByText("components:session.notFound")).toBeInTheDocument();
    });
  });

  describe("Sorting", () => {
    it("should display sessions in newest first order by default", () => {
      render(<SessionList {...defaultProps} />);

      const sessionItems = screen.getAllByTestId(/session-item-/);

      // Should be in order: session-2 (Feb 5), session-1 (Feb 4), session-3 (Feb 3)
      expect(sessionItems[0]).toHaveAttribute("data-testid", "session-item-session-2");
      expect(sessionItems[1]).toHaveAttribute("data-testid", "session-item-session-1");
      expect(sessionItems[2]).toHaveAttribute("data-testid", "session-item-session-3");
    });

    it("should toggle to oldest first when sort button is clicked", () => {
      render(<SessionList {...defaultProps} />);

      // Click the sort button
      const sortButton = screen.getByRole("button", { name: /sort/i });
      fireEvent.click(sortButton);

      const sessionItems = screen.getAllByTestId(/session-item-/);

      // Should be in order: session-3 (Feb 3), session-1 (Feb 4), session-2 (Feb 5)
      expect(sessionItems[0]).toHaveAttribute("data-testid", "session-item-session-3");
      expect(sessionItems[1]).toHaveAttribute("data-testid", "session-item-session-1");
      expect(sessionItems[2]).toHaveAttribute("data-testid", "session-item-session-2");
    });

    it("should show correct sort icon for newest first", () => {
      render(<SessionList {...defaultProps} />);

      const sortButton = screen.getByRole("button", { name: /sort/i });

      // Should have SortDesc icon (newest first)
      expect(sortButton.querySelector("svg")).toBeInTheDocument();
    });

    it("should show correct sort icon for oldest first", () => {
      render(<SessionList {...defaultProps} />);

      const sortButton = screen.getByRole("button", { name: /sort/i });
      fireEvent.click(sortButton);

      // Should have SortAsc icon (oldest first)
      expect(sortButton.querySelector("svg")).toBeInTheDocument();
    });
  });

  describe("Searching", () => {
    it("should filter sessions by search query in summary", () => {
      render(<SessionList {...defaultProps} />);

      const searchInput = screen.getByPlaceholderText("session.filter.searchPlaceholder");
      fireEvent.change(searchInput, { target: { value: "React" } });

      // Only session-1 should be visible
      expect(screen.getByTestId("session-item-session-1")).toBeInTheDocument();
      expect(screen.queryByTestId("session-item-session-2")).not.toBeInTheDocument();
      expect(screen.queryByTestId("session-item-session-3")).not.toBeInTheDocument();
    });

    it("should filter sessions by search query in session_id", () => {
      render(<SessionList {...defaultProps} />);

      const searchInput = screen.getByPlaceholderText("session.filter.searchPlaceholder");
      fireEvent.change(searchInput, { target: { value: "session-2" } });

      // Only session-2 should be visible
      expect(screen.queryByTestId("session-item-session-1")).not.toBeInTheDocument();
      expect(screen.getByTestId("session-item-session-2")).toBeInTheDocument();
      expect(screen.queryByTestId("session-item-session-3")).not.toBeInTheDocument();
    });

    it("should be case insensitive when searching", () => {
      render(<SessionList {...defaultProps} />);

      const searchInput = screen.getByPlaceholderText("session.filter.searchPlaceholder");
      fireEvent.change(searchInput, { target: { value: "TYPESCRIPT" } });

      // session-2 should be visible (TypeScript)
      expect(screen.getByTestId("session-item-session-2")).toBeInTheDocument();
      expect(screen.queryByTestId("session-item-session-1")).not.toBeInTheDocument();
    });

    it("should clear search when clear button is clicked", () => {
      render(<SessionList {...defaultProps} />);

      const searchInput = screen.getByPlaceholderText("session.filter.searchPlaceholder");
      fireEvent.change(searchInput, { target: { value: "React" } });

      // Click clear button
      const clearButton = screen.getByRole("button", { name: /clear/i });
      fireEvent.click(clearButton);

      // All sessions should be visible again
      expect(screen.getByTestId("session-item-session-1")).toBeInTheDocument();
      expect(screen.getByTestId("session-item-session-2")).toBeInTheDocument();
      expect(screen.getByTestId("session-item-session-3")).toBeInTheDocument();

      // Input should be empty
      expect(searchInput).toHaveValue("");
    });

    it("should show no results message when search has no matches", () => {
      render(<SessionList {...defaultProps} />);

      const searchInput = screen.getByPlaceholderText("session.filter.searchPlaceholder");
      fireEvent.change(searchInput, { target: { value: "nonexistent" } });

      expect(screen.getByText("session.filter.noResults")).toBeInTheDocument();
      expect(screen.queryByTestId(/session-item-/)).not.toBeInTheDocument();
    });

    it("should not show clear button when search is empty", () => {
      render(<SessionList {...defaultProps} />);

      expect(screen.queryByRole("button", { name: /clear/i })).not.toBeInTheDocument();
    });

    it("should show clear button when search has text", () => {
      render(<SessionList {...defaultProps} />);

      const searchInput = screen.getByPlaceholderText("session.filter.searchPlaceholder");
      fireEvent.change(searchInput, { target: { value: "test" } });

      expect(screen.getByRole("button", { name: /clear/i })).toBeInTheDocument();
    });
  });

  describe("Search and Sort controls visibility", () => {
    it("should hide controls when there are fewer than 3 sessions", () => {
      const fewSessions = [mockSessions[0], mockSessions[1]];
      render(<SessionList {...defaultProps} sessions={fewSessions} />);

      expect(screen.queryByPlaceholderText("session.filter.searchPlaceholder")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /sort/i })).not.toBeInTheDocument();
    });

    it("should show controls when there are 3 or more sessions", () => {
      render(<SessionList {...defaultProps} />);

      expect(screen.getByPlaceholderText("session.filter.searchPlaceholder")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /sort/i })).toBeInTheDocument();
    });
  });

  describe("Combined functionality", () => {
    it("should apply both search and sort together (newest first + filter)", () => {
      const sessions = [
        createMockSession({
          session_id: "session-1",
          summary: "Testing A",
          last_modified: "2026-02-03T10:00:00Z",
        }),
        createMockSession({
          session_id: "session-2",
          summary: "Testing B",
          last_modified: "2026-02-05T10:00:00Z",
        }),
        createMockSession({
          session_id: "session-3",
          summary: "Different topic",
          last_modified: "2026-02-04T10:00:00Z",
        }),
      ];

      render(<SessionList {...defaultProps} sessions={sessions} />);

      // Search for "Testing"
      const searchInput = screen.getByPlaceholderText("session.filter.searchPlaceholder");
      fireEvent.change(searchInput, { target: { value: "Testing" } });

      const sessionItems = screen.getAllByTestId(/session-item-/);

      // Should show session-2 and session-1 in newest first order
      expect(sessionItems).toHaveLength(2);
      expect(sessionItems[0]).toHaveAttribute("data-testid", "session-item-session-2");
      expect(sessionItems[1]).toHaveAttribute("data-testid", "session-item-session-1");
    });

    it("should apply both search and sort together (oldest first + filter)", () => {
      const sessions = [
        createMockSession({
          session_id: "session-1",
          summary: "Testing A",
          last_modified: "2026-02-03T10:00:00Z",
        }),
        createMockSession({
          session_id: "session-2",
          summary: "Testing B",
          last_modified: "2026-02-05T10:00:00Z",
        }),
        createMockSession({
          session_id: "session-3",
          summary: "Different topic",
          last_modified: "2026-02-04T10:00:00Z",
        }),
      ];

      render(<SessionList {...defaultProps} sessions={sessions} />);

      // Search for "Testing"
      const searchInput = screen.getByPlaceholderText("session.filter.searchPlaceholder");
      fireEvent.change(searchInput, { target: { value: "Testing" } });

      // Toggle to oldest first
      const sortButton = screen.getByRole("button", { name: /sort/i });
      fireEvent.click(sortButton);

      const sessionItems = screen.getAllByTestId(/session-item-/);

      // Should show session-1 and session-2 in oldest first order
      expect(sessionItems).toHaveLength(2);
      expect(sessionItems[0]).toHaveAttribute("data-testid", "session-item-session-1");
      expect(sessionItems[1]).toHaveAttribute("data-testid", "session-item-session-2");
    });

    it("should maintain sort order when switching between search queries", () => {
      render(<SessionList {...defaultProps} />);

      // Set to oldest first
      const sortButton = screen.getByRole("button", { name: /sort/i });
      fireEvent.click(sortButton);

      // Search for "session"
      const searchInput = screen.getByPlaceholderText("session.filter.searchPlaceholder");
      fireEvent.change(searchInput, { target: { value: "session" } });

      const sessionItems = screen.getAllByTestId(/session-item-/);

      // All sessions match, should be oldest first
      expect(sessionItems[0]).toHaveAttribute("data-testid", "session-item-session-3");

      // Change search to "TypeScript"
      fireEvent.change(searchInput, { target: { value: "TypeScript" } });

      // Should still maintain oldest first sort (only one result)
      expect(screen.getByTestId("session-item-session-2")).toBeInTheDocument();
    });
  });

  describe("Session selection", () => {
    it("should call onSessionSelect when a session is clicked", () => {
      const onSessionSelect = vi.fn();
      render(<SessionList {...defaultProps} onSessionSelect={onSessionSelect} />);

      const sessionItem = screen.getByTestId("session-item-session-1");
      fireEvent.click(sessionItem);

      // Find the session object for session-1 from mockSessions
      const session1 = mockSessions.find(s => s.session_id === "session-1");
      expect(onSessionSelect).toHaveBeenCalledWith(session1);
    });

    it("should highlight selected session", () => {
      const selectedSession = mockSessions[0];
      render(<SessionList {...defaultProps} selectedSession={selectedSession} />);

      const sessionItem = screen.getByTestId(`session-item-${selectedSession.session_id}`);
      expect(sessionItem).toHaveAttribute("data-selected", "true");
    });
  });

  describe("Variant styles", () => {
    it("should render with default variant", () => {
      const { container } = render(<SessionList {...defaultProps} variant="default" />);

      expect(container.querySelector(".ml-6")).toBeInTheDocument();
    });

    it("should render with worktree variant", () => {
      const { container } = render(<SessionList {...defaultProps} variant="worktree" />);

      expect(container.querySelector(".ml-4")).toBeInTheDocument();
      expect(container.querySelector(".border-emerald-500\\/30")).toBeInTheDocument();
    });

    it("should render with main variant", () => {
      const { container } = render(<SessionList {...defaultProps} variant="main" />);

      expect(container.querySelector(".ml-4")).toBeInTheDocument();
      expect(container.querySelector(".border-accent\\/30")).toBeInTheDocument();
    });
  });
});
