import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecentEditsScopeToggle, RecentEditsDensityToggle } from "@/components/RecentEditsViewer/RecentEditsToggles";
import { FilterToolbar } from "@/components/MessageViewer/components/FilterToolbar";
import { useAppStore } from "@/store/useAppStore";

vi.mock("react-i18next", () => ({ initReactI18next: { type: "3rdParty", init: () => {} }, useTranslation: () => ({ t: (key: string, fallback?: unknown) => typeof fallback === "string" ? fallback : key }) }));

describe("consumer characterization and adoption", () => {
  it("characterizes scope availability, hint and callback values", () => {
    const change = vi.fn();
    const { container } = render(<RecentEditsScopeToggle value="project" sessionDisabled onChange={change} />);
    fireEvent.click(screen.getByText("Session"));
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Project"));
    expect(change).toHaveBeenCalledExactlyOnceWith("project");
    expect(container.querySelector('[title="Select a session to scope edits to it"]')).toBeInTheDocument();
  });
  it("uses radio semantics for scope and density without losing names or disabled options", () => {
    render(<><RecentEditsScopeToggle value="project" sessionDisabled onChange={() => {}} /><RecentEditsDensityToggle value="compact" onChange={() => {}} /></>);
    expect(screen.getAllByRole("radiogroup")).toHaveLength(2);
    expect(screen.getByRole("radio", { name: "Session" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Project" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Compact rows" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Full cards" })).toHaveAttribute("title", "Full cards");
  });
  it("characterizes independent filter state and then requires roving rather than toggling on arrows", () => {
    useAppStore.getState().resetMessageFilter();
    render(<FilterToolbar totalCount={10} filteredCount={5} hasParallelTasks />);
    const user = screen.getByRole("button", { name: "filter.role.user" });
    const assistant = screen.getByRole("button", { name: "filter.role.assistant" });
    const initial = user.getAttribute("aria-pressed");
    fireEvent.click(user);
    expect(user.getAttribute("aria-pressed")).not.toBe(initial);
    const afterClick = user.getAttribute("aria-pressed");
    const toolbar = screen.getByRole("toolbar", { name: "filter.title" });
    expect(within(toolbar).getAllByRole("button").filter((button) => button.tabIndex === 0)).toHaveLength(1);
    fireEvent.keyDown(user, { key: "ArrowRight" });
    expect(assistant).toHaveFocus();
    expect(user).toHaveAttribute("aria-pressed", afterClick);
  });
});
