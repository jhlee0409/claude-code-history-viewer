/**
 * @fileoverview Tests for SessionItem component
 * Tests for session display, rename functionality, and user interactions
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SessionItem } from "../components/SessionItem";
import type { ClaudeSession } from "../types";

// Mock react-i18next
vi.mock("react-i18next", async () => {
  const actual = await vi.importActual<typeof import("react-i18next")>(
    "react-i18next"
  );

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string) => fallback || key,
    }),
  };
});

// Mock useSessionMetadata hook
const mockSetCustomName = vi.fn();
vi.mock("@/hooks/useSessionMetadata", () => ({
  useSessionDisplayName: (sessionId: string, fallbackSummary?: string) => {
    // Return custom name if set, otherwise fallback
    return fallbackSummary || "No summary";
  },
  useSessionMetadata: () => ({
    hasClaudeCodeName: false,
    setHasClaudeCodeName: vi.fn(),
    setCustomName: mockSetCustomName,
    customName: undefined,
    starred: false,
    tags: [],
    notes: undefined,
    isMetadataLoaded: true,
    toggleStarred: vi.fn(),
    setStarred: vi.fn(),
    addTag: vi.fn(),
    removeTag: vi.fn(),
    setTags: vi.fn(),
    setNotes: vi.fn(),
  }),
}));

// Mock dropdown menu
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-menu">{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-trigger">{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-content">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button data-testid="dropdown-item" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr data-testid="dropdown-separator" />,
}));

// Mock NativeRenameDialog
vi.mock("@/components/NativeRenameDialog", () => ({
  NativeRenameDialog: () => <div data-testid="native-rename-dialog" />,
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
    provider: overrides.provider,
  };
}

describe("SessionItem", () => {
  const mockFormatTimeAgo = vi.fn(() => "1 hour ago");
  const mockOnSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockSetCustomName.mockResolvedValue(undefined);
  });

  describe("Rendering", () => {
    it("should render session with summary", () => {
      const session = createMockSession({ summary: "Test Session Summary" });

      render(
        <SessionItem
          session={session}
          isSelected={false}
          onSelect={mockOnSelect}
          formatTimeAgo={mockFormatTimeAgo}
        />
      );

      expect(screen.getByText("Test Session Summary")).toBeInTheDocument();
    });

    it("should render 'No summary' when summary is undefined", () => {
      const session = createMockSession({ summary: undefined });

      render(
        <SessionItem
          session={session}
          isSelected={false}
          onSelect={mockOnSelect}
          formatTimeAgo={mockFormatTimeAgo}
        />
      );

      expect(screen.getByText("No summary")).toBeInTheDocument();
    });

    it("should display message count", () => {
      const session = createMockSession({ message_count: 42 });

      render(
        <SessionItem
          session={session}
          isSelected={false}
          onSelect={mockOnSelect}
          formatTimeAgo={mockFormatTimeAgo}
        />
      );

      expect(screen.getByText("42")).toBeInTheDocument();
    });

    it("should display formatted time", () => {
      const session = createMockSession();

      render(
        <SessionItem
          session={session}
          isSelected={false}
          onSelect={mockOnSelect}
          formatTimeAgo={mockFormatTimeAgo}
        />
      );

      expect(screen.getByText("1 hour ago")).toBeInTheDocument();
      expect(mockFormatTimeAgo).toHaveBeenCalledWith(session.last_modified);
    });

    it("should apply selected styles when isSelected is true", () => {
      const session = createMockSession();

      const { container } = render(
        <SessionItem
          session={session}
          isSelected={true}
          onSelect={mockOnSelect}
          formatTimeAgo={mockFormatTimeAgo}
        />
      );

      // Check for selected class (bg-accent/15)
      const sessionDiv = container.firstChild as HTMLElement;
      expect(sessionDiv.className).toContain("bg-accent/15");
    });
  });

  describe("Click behavior", () => {
    it("should call onSelect when clicked and not selected", async () => {
      const session = createMockSession();

      const { container } = render(
        <SessionItem
          session={session}
          isSelected={false}
          onSelect={mockOnSelect}
          formatTimeAgo={mockFormatTimeAgo}
        />
      );

      const sessionDiv = container.firstChild as HTMLElement;
      fireEvent.click(sessionDiv);

      expect(mockOnSelect).toHaveBeenCalledTimes(1);
    });

    it("should not call onSelect when already selected", () => {
      const session = createMockSession();

      const { container } = render(
        <SessionItem
          session={session}
          isSelected={true}
          onSelect={mockOnSelect}
          formatTimeAgo={mockFormatTimeAgo}
        />
      );

      const sessionDiv = container.firstChild as HTMLElement;
      fireEvent.click(sessionDiv);

      expect(mockOnSelect).not.toHaveBeenCalled();
    });
  });

  describe("Double-click to edit", () => {
    it("should enter edit mode on double-click", async () => {
      const session = createMockSession({ summary: "Original Summary" });

      render(
        <SessionItem
          session={session}
          isSelected={false}
          onSelect={mockOnSelect}
          formatTimeAgo={mockFormatTimeAgo}
        />
      );

      const summaryText = screen.getByText("Original Summary");
      fireEvent.doubleClick(summaryText);

      // Should show input field
      const input = screen.getByRole("textbox");
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue("Original Summary");
    });

    it("should not call onSelect during double-click editing", async () => {
      const session = createMockSession({ summary: "Test Summary" });

      const { container } = render(
        <SessionItem
          session={session}
          isSelected={false}
          onSelect={mockOnSelect}
          formatTimeAgo={mockFormatTimeAgo}
        />
      );

      const summaryText = screen.getByText("Test Summary");
      fireEvent.doubleClick(summaryText);

      // Click on the container while editing
      const sessionDiv = container.firstChild as HTMLElement;
      fireEvent.click(sessionDiv);

      // onSelect should not be called because we're in edit mode
      expect(mockOnSelect).not.toHaveBeenCalled();
    });
  });

  describe("Keyboard handling in edit mode", () => {
    it("should save on Enter key", async () => {
      const session = createMockSession({ summary: "Original" });

      render(
        <SessionItem
          session={session}
          isSelected={false}
          onSelect={mockOnSelect}
          formatTimeAgo={mockFormatTimeAgo}
        />
      );

      // Enter edit mode
      const summaryText = screen.getByText("Original");
      fireEvent.doubleClick(summaryText);

      // Change value and press Enter
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "New Name" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => {
        expect(mockSetCustomName).toHaveBeenCalledWith("New Name");
      });
    });

    it("should cancel on Escape key", async () => {
      const session = createMockSession({ summary: "Original" });

      render(
        <SessionItem
          session={session}
          isSelected={false}
          onSelect={mockOnSelect}
          formatTimeAgo={mockFormatTimeAgo}
        />
      );

      // Enter edit mode
      const summaryText = screen.getByText("Original");
      fireEvent.doubleClick(summaryText);

      // Type something
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "Changed" } });

      // Press Escape
      fireEvent.keyDown(input, { key: "Escape" });

      // Should exit edit mode without saving
      expect(mockSetCustomName).not.toHaveBeenCalled();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
  });

  describe("Save button behavior", () => {
    it("should save custom name when save button is clicked", async () => {
      const session = createMockSession({ summary: "Original" });

      render(
        <SessionItem
          session={session}
          isSelected={false}
          onSelect={mockOnSelect}
          formatTimeAgo={mockFormatTimeAgo}
        />
      );

      // Enter edit mode
      const summaryText = screen.getByText("Original");
      fireEvent.doubleClick(summaryText);

      // Change value
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "Custom Name" } });

      // Click save button (Check icon) - title is the i18n key since mock returns key
      const saveButton = screen.getByTitle("common.save");
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockSetCustomName).toHaveBeenCalledWith("Custom Name");
      });
    });

    it("should clear custom name when saved with empty value", async () => {
      const session = createMockSession({ summary: "Original" });

      render(
        <SessionItem
          session={session}
          isSelected={false}
          onSelect={mockOnSelect}
          formatTimeAgo={mockFormatTimeAgo}
        />
      );

      // Enter edit mode
      const summaryText = screen.getByText("Original");
      fireEvent.doubleClick(summaryText);

      // Clear input
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "" } });

      // Click save button - title is the i18n key since mock returns key
      const saveButton = screen.getByTitle("common.save");
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockSetCustomName).toHaveBeenCalledWith(undefined);
      });
    });

    it("should clear custom name when saved with original summary", async () => {
      const session = createMockSession({ summary: "Original Summary" });

      render(
        <SessionItem
          session={session}
          isSelected={false}
          onSelect={mockOnSelect}
          formatTimeAgo={mockFormatTimeAgo}
        />
      );

      // Enter edit mode
      const summaryText = screen.getByText("Original Summary");
      fireEvent.doubleClick(summaryText);

      // Input already has original summary, just save
      const saveButton = screen.getByTitle("common.save");
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockSetCustomName).toHaveBeenCalledWith(undefined);
      });
    });
  });

  describe("Cancel button behavior", () => {
    it("should cancel editing without saving", async () => {
      const session = createMockSession({ summary: "Original" });

      render(
        <SessionItem
          session={session}
          isSelected={false}
          onSelect={mockOnSelect}
          formatTimeAgo={mockFormatTimeAgo}
        />
      );

      // Enter edit mode
      const summaryText = screen.getByText("Original");
      fireEvent.doubleClick(summaryText);

      // Type new name
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "Modified" } });

      // Click cancel button
      const cancelButton = screen.getByTitle("common.cancel");
      fireEvent.click(cancelButton);

      // Should exit edit mode without saving
      expect(mockSetCustomName).not.toHaveBeenCalled();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
  });

  describe("Native rename menu visibility", () => {
    it("should show Claude native rename menu for claude provider", () => {
      const session = createMockSession({ provider: "claude" });

      render(
        <SessionItem
          session={session}
          isSelected={false}
          onSelect={mockOnSelect}
          formatTimeAgo={mockFormatTimeAgo}
        />
      );

      expect(screen.getByText("Rename in Claude Code")).toBeInTheDocument();
    });

    it("should show OpenCode native rename menu for opencode provider", () => {
      const session = createMockSession({ provider: "opencode" });

      render(
        <SessionItem
          session={session}
          isSelected={false}
          onSelect={mockOnSelect}
          formatTimeAgo={mockFormatTimeAgo}
        />
      );

      expect(screen.getByText("Rename in OpenCode")).toBeInTheDocument();
    });

    it("should hide native rename menu for unsupported provider", () => {
      const session = createMockSession({ provider: "codex" });

      render(
        <SessionItem
          session={session}
          isSelected={false}
          onSelect={mockOnSelect}
          formatTimeAgo={mockFormatTimeAgo}
        />
      );

      expect(screen.queryByText("Rename in Claude Code")).not.toBeInTheDocument();
      expect(screen.queryByText("Rename in OpenCode")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Native rename not supported for this provider")
      ).not.toBeInTheDocument();
    });
  });

  describe("Tool use and error indicators", () => {
    it("should show tool use indicator when has_tool_use is true", () => {
      const session = createMockSession({ has_tool_use: true });

      render(
        <SessionItem
          session={session}
          isSelected={false}
          onSelect={mockOnSelect}
          formatTimeAgo={mockFormatTimeAgo}
        />
      );

      // Wrench icon should be present (lucide renders as svg)
      const container = screen.getByText(session.message_count.toString())
        .closest("div")?.parentElement;
      expect(container?.innerHTML).toContain("svg");
    });

    it("should show error indicator when has_errors is true", () => {
      const session = createMockSession({ has_errors: true });

      render(
        <SessionItem
          session={session}
          isSelected={false}
          onSelect={mockOnSelect}
          formatTimeAgo={mockFormatTimeAgo}
        />
      );

      // AlertTriangle icon should be present
      const container = screen.getByText(session.message_count.toString())
        .closest("div")?.parentElement;
      expect(container?.innerHTML).toContain("svg");
    });
  });
});
