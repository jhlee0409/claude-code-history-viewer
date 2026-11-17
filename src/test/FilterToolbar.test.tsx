import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterToolbar } from "@/components/MessageViewer/components/FilterToolbar";

const { toggleContentTypeMock, togglePromptsAndFinalRepliesMock, useAppStoreMock, storeState } = vi.hoisted(() => {
  const toggleContentType = vi.fn();
  const togglePromptsAndFinalReplies = vi.fn();
  const state = {
    messageFilter: {
      roles: { user: true, assistant: true },
      contentTypes: {
        text: true,
        thinking: true,
        toolCalls: true,
        commands: true,
        parallelTasks: true,
      },
    },
    toggleRole: vi.fn(),
    toggleContentType,
    togglePromptsAndFinalReplies,
    resetMessageFilter: vi.fn(),
    isMessageFilterActive: () => false,
    isApiViewOpen: false,
    toggleApiView: vi.fn(),
  };

  return {
    toggleContentTypeMock: toggleContentType,
    togglePromptsAndFinalRepliesMock: togglePromptsAndFinalReplies,
    useAppStoreMock: () => state,
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

describe("FilterToolbar", () => {
  it("only shows the Parallel Tasks filter for sessions containing that category", () => {
    const { rerender } = render(
      <FilterToolbar totalCount={2} filteredCount={2} hasParallelTasks={false} />,
    );

    expect(screen.queryByRole("button", {
      name: "filter.content.parallelTasks",
    })).not.toBeInTheDocument();

    rerender(
      <FilterToolbar totalCount={2} filteredCount={2} hasParallelTasks />,
    );
    const toggle = screen.getByRole("button", {
      name: "filter.content.parallelTasks",
    });
    fireEvent.click(toggle);
    expect(toggleContentTypeMock).toHaveBeenCalledWith("parallelTasks");
  });

  it("leaves the filters inert, with the reason, while the API view is open", () => {
    storeState.isApiViewOpen = true;
    toggleContentTypeMock.mockClear();
    togglePromptsAndFinalRepliesMock.mockClear();
    try {
      render(<FilterToolbar totalCount={2} filteredCount={2} hasParallelTasks apiViewAvailable />);
      const text = screen.getByRole("button", { name: "filter.content.text" });
      expect(text).toHaveAttribute("aria-disabled", "true");
      expect(text).toHaveAttribute("title", "messageViewer.apiView.filtersDisabled");
      expect(text).not.toBeDisabled();
      fireEvent.click(text);
      expect(toggleContentTypeMock).not.toHaveBeenCalled();
      const prompts = screen.getByRole("button", { name: "filter.promptsAndFinalReplies" });
      expect(prompts).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(prompts);
      expect(togglePromptsAndFinalRepliesMock).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "messageViewer.apiView.toggle" })).not.toHaveAttribute("aria-disabled");
    } finally {
      storeState.isApiViewOpen = false;
    }
  });

  it("offers no API view for sessions it cannot read, and keeps their filters live", () => {
    storeState.isApiViewOpen = true;
    toggleContentTypeMock.mockClear();
    try {
      render(<FilterToolbar totalCount={2} filteredCount={2} hasParallelTasks />);
      expect(screen.queryByRole("button", { name: "messageViewer.apiView.toggle" })).toBeNull();
      const text = screen.getByRole("button", { name: "filter.content.text" });
      expect(text).not.toHaveAttribute("aria-disabled");
      fireEvent.click(text);
      expect(toggleContentTypeMock).toHaveBeenCalledWith("text");
    } finally {
      storeState.isApiViewOpen = false;
    }
  });

  it("toggles the prompts-and-final-replies view and explains it in the tooltip", () => {
    render(<FilterToolbar totalCount={2} filteredCount={2} hasParallelTasks={false} />);
    const toggle = screen.getByRole("button", { name: "filter.promptsAndFinalReplies" });
    expect(toggle).toHaveAttribute("title", "filter.promptsAndFinalRepliesHint");
    fireEvent.click(toggle);
    expect(togglePromptsAndFinalRepliesMock).toHaveBeenCalledTimes(1);
  });
});
