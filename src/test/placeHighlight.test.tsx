/**
 * Plan §9b C3 / D1: every highlight is a projection of the current place.
 *
 * Rendered against the real store, for the situations the audit caught
 * (captures 10 and 12) and the ones C3 lists:
 *
 * | situation              | header tab | library row  | tree        |
 * |------------------------|------------|--------------|-------------|
 * | empty start            | none       | none         | –           |
 * | global stats (kept ctx)| none       | global stats | retained    |
 * | archive / settings     | none       | that row     | retained    |
 * | project screens        | that tab   | none         | active      |
 *
 * Capture 10: global stats with a project open showed the header's
 * "Analytics" tab as selected. Capture 12: the archive kept the sidebar's
 * "Global stats" row selected.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ClaudeProject, ClaudeSession } from "@/types";
import type { View } from "@/navigation/place";

vi.mock("@/services/api", () => ({ api: vi.fn(async () => null) }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock("@/contexts/modal", () => ({ useModal: () => ({ openModal: vi.fn() }) }));
vi.mock("@/layouts/Header/SettingDropdown", () => ({ SettingDropdown: () => null }));
vi.mock("@/layouts/Header/SessionCopyMenu", () => ({ SessionCopyMenu: () => null }));
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: "en", on: vi.fn(), off: vi.fn() },
    }),
  };
});

import { useAppStore } from "@/store/useAppStore";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Header } from "@/layouts/Header/Header";
import { VIEW_PANEL_ID, viewTabId } from "@/layouts/Header/viewTabIds";
import { BottomTabBar } from "@/components/mobile/BottomTabBar";
import { selectPlace } from "@/store/slices/navigationSlice";
import { activeLibraryItem, activeMobileTab } from "@/navigation/place";
import type { UseAnalyticsReturn } from "@/types/analytics";
import type { UseUpdaterReturn } from "@/hooks/useUpdater";

const PROJECT: ClaudeProject = {
  name: "alpha",
  path: "/p/alpha",
  actual_path: "/home/alpha",
  session_count: 1,
  message_count: 1,
  last_modified: "",
  provider: "claude",
};
const SESSION: ClaudeSession = {
  session_id: "s1",
  actual_session_id: "s1",
  file_path: "/p/alpha/s1.jsonl",
  project_name: "alpha",
  message_count: 1,
  first_message_time: "",
  last_message_time: "",
  last_modified: "",
  has_tool_use: false,
  has_errors: false,
  provider: "claude",
};

const pristine = useAppStore.getState();

function at(view: View, withContext: boolean) {
  useAppStore.setState(pristine, true);
  useAppStore.setState({
    view,
    selectedProject: withContext ? PROJECT : null,
    selectedSession: withContext ? SESSION : null,
  });
}

const flagsFor = (view: View) =>
  ({
    isMessagesView: view === "conversation",
    isAnalyticsView: view === "analytics",
    isAnalyticsOverview: view === "analytics",
    isAnalyticsTokens: false,
    isGlobalStatsView: view === "globalStats",
    isRecentEditsView: view === "edits",
    isBoardView: view === "board",
    isSettingsView: view === "settingsManager",
    isArchiveView: view === "archive",
    isEmptyView: view === "empty",
    hasAnyError: false,
    isLoadingAnalytics: false,
    isLoadingTokenStats: false,
    isLoadingRecentEdits: false,
    isAnyLoading: false,
  }) satisfies UseAnalyticsReturn["computed"];

function renderHeader(view: View) {
  return render(
    <TooltipProvider>
      <Header
        analyticsActions={{} as UseAnalyticsReturn["actions"]}
        analyticsComputed={flagsFor(view)}
        updater={{} as UseUpdaterReturn}
      />
    </TooltipProvider>
  );
}

/** The header tabs that report themselves selected, by their i18n label. */
function selectedTabs(): string[] {
  const tablist = screen.queryByRole("tablist");
  if (!tablist) return [];
  return within(tablist)
    .getAllByRole("tab")
    .filter((tab) => tab.getAttribute("aria-selected") === "true")
    .map((tab) => tab.getAttribute("aria-label") ?? "");
}

describe("header view tabs follow the place", () => {
  beforeEach(() => {
    useAppStore.setState(pristine, true);
  });

  it("are tabs in a tablist, each reporting aria-selected", () => {
    at("analytics", true);
    renderHeader("analytics");
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    // Token stats has no tab of its own since T7 (plan C1).
    expect(tabs).toHaveLength(4);
    for (const tab of tabs) {
      expect(["true", "false"]).toContain(tab.getAttribute("aria-selected"));
    }
  });

  it("empty start: the tabs stay in place, disabled, none selected", () => {
    at("conversation", false);
    renderHeader("conversation");
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.every((tab) => (tab as HTMLButtonElement).disabled)).toBe(true);
    expect(selectedTabs()).toEqual([]);
  });

  it.each(["globalStats", "archive", "settingsManager"] as const)(
    "%s with a project open selects no tab (capture 10)",
    (view) => {
      at(view, true);
      renderHeader(view);
      expect(selectedTabs()).toEqual([]);
    }
  );

  it.each([
    ["conversation", "common.place.messages"],
    ["analytics", "common.place.analytics"],
    ["edits", "common.place.edits"],
    ["board", "common.place.board"],
  ] as const)("%s selects exactly the %s tab", (view, label) => {
    at(view, true);
    renderHeader(view);
    expect(selectedTabs()).toEqual([label]);
  });

  it("the analytics tokens sub-tab keeps the analytics tab selected (T9b)", () => {
    at("analytics", true);
    useAppStore.setState({ analyticsTab: "tokens" });
    renderHeader("analytics");
    expect(selectedTabs()).toEqual(["common.place.analytics"]);
  });
});

/**
 * The tabs interaction contract (WAI-ARIA APG tabs, manual activation): one
 * tab stop, arrows / Home / End move focus between enabled tabs, Enter or
 * Space opens. Ported from the independent T2 review's keyboard probes.
 */
describe("header view tabs keyboard", () => {
  const tabs = () =>
    within(screen.getByRole("tablist")).getAllByRole("tab") as HTMLElement[];
  const focus = (el: HTMLElement) => act(() => el.focus());
  const press = (key: string) =>
    fireEvent.keyDown(document.activeElement as Element, { key });

  beforeEach(() => {
    useAppStore.setState(pristine, true);
  });

  it("Right Arrow moves focus to the next view tab", () => {
    at("conversation", true);
    renderHeader("conversation");
    focus(tabs()[0]!);
    press("ArrowRight");
    expect(document.activeElement).toBe(tabs()[1]);
  });

  it("only one tab is in the Tab sequence: the selected one", () => {
    at("analytics", true);
    renderHeader("analytics");
    const stops = tabs().filter((tab) => tab.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("with no tab selected (an app screen), the first tab is the stop", () => {
    at("globalStats", true);
    renderHeader("globalStats");
    const stops = tabs().filter((tab) => tab.tabIndex === 0);
    expect(stops).toEqual([tabs()[0]]);
  });

  it("Left Arrow wraps, Home and End jump to the ends", () => {
    at("conversation", true);
    renderHeader("conversation");
    const all = tabs();
    focus(all[0]!);
    press("ArrowLeft");
    expect(document.activeElement).toBe(all[all.length - 1]);
    press("Home");
    expect(document.activeElement).toBe(all[0]);
    press("End");
    expect(document.activeElement).toBe(all[all.length - 1]);
  });

  it("the tab stop roves with focus: arrows, Home and End move tabIndex=0", () => {
    at("conversation", true);
    renderHeader("conversation");
    const stops = () => tabs().filter((tab) => tab.tabIndex === 0);
    focus(tabs()[0]!);
    press("ArrowRight");
    expect(document.activeElement).toBe(tabs()[1]);
    expect(stops()).toEqual([tabs()[1]]);
    press("End");
    expect(stops()).toEqual([tabs()[tabs().length - 1]]);
    press("Home");
    expect(stops()).toEqual([tabs()[0]]);
    press("ArrowLeft");
    expect(stops()).toEqual([tabs()[tabs().length - 1]]);
  });

  it("the roving stop goes back to the selected tab once the place changes", () => {
    at("conversation", true);
    renderHeader("conversation");
    focus(tabs()[0]!);
    press("ArrowRight");
    act(() => useAppStore.setState({ view: "board" }));
    const stops = tabs().filter((tab) => tab.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("each tab controls the main view panel and carries a stable id", () => {
    at("analytics", true);
    renderHeader("analytics");
    for (const tab of tabs()) {
      expect(tab.getAttribute("aria-controls")).toBe(VIEW_PANEL_ID);
    }
    expect(tabs()[1]?.id).toBe(viewTabId("analytics"));
  });
});

describe("library and tree projections from the store", () => {
  const library = () => activeLibraryItem(selectPlace(useAppStore.getState()));

  it("archive no longer leaves global stats selected (capture 12)", async () => {
    at("conversation", true);
    await useAppStore.getState().navigate({ view: "globalStats" });
    expect(library()).toBe("globalStats");

    await useAppStore.getState().navigate({ view: "archive" });
    expect(library()).toBe("archive");
  });

  it("opening a session from global stats clears the library row", async () => {
    at("globalStats", false);
    await useAppStore
      .getState()
      .navigate({ view: "conversation", project: PROJECT, session: SESSION });
    expect(library()).toBeNull();
  });
});

describe("mobile tab bar follows the place", () => {
  const renderBar = () => {
    const tab = activeMobileTab(selectPlace(useAppStore.getState()));
    return render(
      <BottomTabBar activeTab={tab} onOpenSidebar={vi.fn()} onSwitchView={vi.fn()} hasProject />
    );
  };
  const current = () =>
    screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-current") === "page")
      .map((b) => b.getAttribute("aria-label"));

  it.each([
    ["conversation", ["common.place.messages"]],
    ["analytics", ["common.place.analytics"]],
    ["board", ["common.place.board"]],
    ["settingsManager", ["common.place.claudeCodeSettings"]],
    ["globalStats", []],
    ["archive", []],
  ] as const)("%s → %j", (view, expected) => {
    at(view, true);
    renderBar();
    expect(current()).toEqual(expected);
  });
});
