import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterToolbar } from "@/components/MessageViewer/components/FilterToolbar";

const { toggleContentTypeMock, togglePromptsAndFinalRepliesMock, useAppStoreMock } = vi.hoisted(() => {
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
  };

  return {
    toggleContentTypeMock: toggleContentType,
    togglePromptsAndFinalRepliesMock: togglePromptsAndFinalReplies,
    useAppStoreMock: () => state,
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

  it("toggles the prompts-and-final-replies view and explains it in the tooltip", () => {
    render(<FilterToolbar totalCount={2} filteredCount={2} hasParallelTasks={false} />);
    const toggle = screen.getByRole("button", { name: "filter.promptsAndFinalReplies" });
    expect(toggle).toHaveAttribute("title", "filter.promptsAndFinalRepliesHint");
    fireEvent.click(toggle);
    expect(togglePromptsAndFinalRepliesMock).toHaveBeenCalledTimes(1);
  });
});
