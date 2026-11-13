/**
 * "Filter matches" in the project list menu: project names, session names,
 * or both. The last checked one can't be turned off.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectListMenu } from "../ProjectListMenu";
import type { SidebarFilterScope } from "@/utils/sidebarFilter";

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) };
});

function open(filterScope: SidebarFilterScope) {
  const onFilterScopeChange = vi.fn();
  render(
    <ProjectListMenu
      sort="recent"
      onSortChange={vi.fn()}
      groupingMode="none"
      providers={[]}
      isAllProvidersSelected
      onToggleProvider={vi.fn()}
      onResetProviders={vi.fn()}
      onDiscoverProviders={vi.fn()}
      isDiscovering={false}
      filterScope={filterScope}
      onFilterScopeChange={onFilterScopeChange}
    />
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "project.listOptions" }), { key: "Enter" });
  const item = (name: string) => screen.getByRole("menuitemcheckbox", { name });
  return { onFilterScopeChange, item };
}

describe("ProjectListMenu: filter matches", () => {
  it("toggles one target and keeps the other", () => {
    const { onFilterScopeChange, item } = open({ matchProjects: true, matchSessions: true });
    expect(item("project.filter.target.sessions")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(item("project.filter.target.sessions"));
    expect(onFilterScopeChange).toHaveBeenCalledWith({ matchProjects: true, matchSessions: false });
  });

  it("keeps the last checked target on", () => {
    const { item } = open({ matchProjects: false, matchSessions: true });
    expect(item("project.filter.target.projects")).toHaveAttribute("aria-checked", "false");
    expect(item("project.filter.target.sessions")).toHaveAttribute("aria-disabled", "true");
  });
});
