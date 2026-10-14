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
import { render, screen, within } from "@testing-library/react";
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
    isGlobalStatsView: view === "globalStats",
    isTokenStatsView: view === "tokenStats",
    isRecentEditsView: view === "edits",
    isBoardView: view === "board",
    isSettingsView: view === "settingsManager",
    isArchiveView: view === "archive",
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
    expect(tabs).toHaveLength(5);
    for (const tab of tabs) {
      expect(["true", "false"]).toContain(tab.getAttribute("aria-selected"));
    }
  });

  it("empty start: no tablist at all", () => {
    at("conversation", false);
    renderHeader("conversation");
    expect(screen.queryByRole("tablist")).toBeNull();
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
    ["conversation", "message.view"],
    ["analytics", "analytics.dashboard"],
    ["tokenStats", "messages.tokenStats.existing"],
    ["edits", "recentEdits.title"],
    ["board", "session.board.title"],
  ] as const)("%s selects exactly its own tab", (view, label) => {
    at(view, true);
    renderHeader(view);
    expect(selectedTabs()).toEqual([label]);
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
    ["conversation", ["common.mobile.tab.messages"]],
    ["analytics", ["common.mobile.tab.analytics"]],
    ["board", ["common.mobile.tab.board"]],
    ["settingsManager", ["common.mobile.tab.settings"]],
    ["globalStats", []],
    ["archive", []],
  ] as const)("%s → %j", (view, expected) => {
    at(view, true);
    renderBar();
    expect(current()).toEqual(expected);
  });
});
