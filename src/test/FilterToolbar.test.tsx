import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterToolbar } from "@/components/MessageViewer/components/FilterToolbar";

const { toggleContentTypeMock, useAppStoreMock, storeState } = vi.hoisted(() => {
  const toggleContentType = vi.fn();
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
    resetMessageFilter: vi.fn(),
    isMessageFilterActive: () => false,
    isApiViewOpen: false,
    toggleApiView: vi.fn(),
  };

  return {
    toggleContentTypeMock: toggleContentType,
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
    try {
      render(<FilterToolbar totalCount={2} filteredCount={2} hasParallelTasks />);
      const text = screen.getByRole("button", { name: "filter.content.text" });
      expect(text).toHaveAttribute("aria-disabled", "true");
      expect(text).toHaveAttribute("title", "messageViewer.apiView.filtersDisabled");
      expect(text).not.toBeDisabled();
      fireEvent.click(text);
      expect(toggleContentTypeMock).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "messageViewer.apiView.toggle" })).not.toHaveAttribute("aria-disabled");
    } finally {
      storeState.isApiViewOpen = false;
    }
  });
});
