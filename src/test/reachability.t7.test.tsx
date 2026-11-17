/**
 * Plan §6 / §9b C2 (T7 gate): nothing the header or the gear menu offered
 * before T7 becomes unreachable.
 *
 * The table lists every former header control and gear-menu entry with the
 * places it lives after T7 (toolbar, sidebar, gear, ⌘K palette, analytics
 * header). Each place is rendered and the entry is run from it with the
 * pointer, a touch tap and - for menus, whose keyboard handling jsdom can
 * run - the keyboard; buttons must be in the tab order (the WebKit run in
 * `scripts/ui-capture/test/sidebar.test.mjs` presses Option+Tab, the toolbar
 * arrows and the sidebar's tree and menu keys for real).
 * Palette places are checked against the command registry: the command
 * exists, the palette lists it, and running it calls the right action.
 *
 * These are component contracts with their own spies; that the real shell
 * wires each entry to its effect is `reachability.shell.test.tsx`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ClaudeProject, ClaudeSession } from "@/types";

const openModal = vi.fn();
vi.mock("@/services/api", () => ({ api: vi.fn(async () => null) }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock("@/contexts/modal", () => ({ useModal: () => ({ openModal }) }));
vi.mock("@/layouts/Header/SessionCopyMenu", () => ({ SessionCopyMenu: () => null }));
vi.mock("@/contexts/platform", () => ({
  usePlatform: () => ({ platform: "desktop", isDesktop: true, isMobile: false }),
  DesktopOnly: ({ children }: { children: ReactNode }) => <>{children}</>,
  MobileOnly: () => null,
}));
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: "en", on: vi.fn(), off: vi.fn(), changeLanguage: vi.fn() },
    }),
  };
});

import { useAppStore } from "@/store/useAppStore";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/contexts/theme";
import { Header } from "@/layouts/Header/Header";
import { ProjectTree } from "@/components/ProjectTree";
import { ContentHeader } from "@/layouts/shell/ContentHeader";
import { AnalyticsSubTabs } from "@/components/AnalyticsDashboard/AnalyticsSubTabs";
import { CommandRunnerContext } from "@/commands/CommandRunner";
import {
  getCommand,
  paletteCommands,
  runCommand,
  type CommandActions,
  type CommandContext,
} from "@/commands/registry";
import { TOOLBAR_TAB_ORDER } from "@/layouts/shell/viewRegistry";
import type { ToolbarView } from "@/navigation/place";
import type { UseAnalyticsReturn } from "@/types/analytics";
import type { UseUpdaterReturn } from "@/hooks/useUpdater";

const PROJECT: ClaudeProject = {
  name: "alpha",
  path: "/p/alpha",
  actual_path: "/home/alpha",
  session_count: 1,
  message_count: 1,
  last_modified: "2026-01-01T00:00:00.000Z",
  provider: "claude",
};
const SESSION: ClaudeSession = {
  session_id: "/p/alpha/s1.jsonl",
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

type Place =
  | { at: "toolbar"; label: string; command?: string }
  | { at: "toolbarTab"; view: ToolbarView }
  | { at: "library"; item: "globalStats" | "archive" | "settingsManager"; prop: SidebarProp }
  | { at: "sidebarHelp" }
  | { at: "gear"; label: string }
  | { at: "palette"; command: string; action: keyof CommandActions }
  | { at: "analyticsSubTab"; tab: "tokens" };
type SidebarProp = "onGlobalStatsClick" | "onOpenArchive" | "onOpenSettingsManager";

/** Every former header control and gear entry, and where it lives after T7. */
const REACHABILITY: { feature: string; before: string; after: Place[] }[] = [
  {
    feature: "Settings Manager",
    before: "gear menu",
    after: [
      { at: "library", item: "settingsManager", prop: "onOpenSettingsManager" },
      { at: "palette", command: "go.settingsManager", action: "openSettingsManager" },
    ],
  },
  {
    feature: "Archive",
    before: "gear menu",
    after: [
      { at: "library", item: "archive", prop: "onOpenArchive" },
      { at: "palette", command: "go.archive", action: "openArchive" },
    ],
  },
  {
    feature: "Feedback",
    before: "gear menu",
    after: [{ at: "sidebarHelp" }, { at: "palette", command: "help.feedback", action: "openFeedback" }],
  },
  {
    feature: "Check for updates (desktop)",
    before: "gear menu",
    after: [
      { at: "gear", label: "common.settings.checkUpdate" },
      { at: "palette", command: "app.checkForUpdates", action: "checkForUpdates" },
    ],
  },
  { feature: "Claude folder", before: "gear menu", after: [{ at: "gear", label: "common.settings.changeFolder" }] },
  {
    feature: "Message filters",
    before: "gear menu",
    after: [{ at: "gear", label: "common.settings.filter.showSystemMessages" }],
  },
  { feature: "View (minimap)", before: "gear menu", after: [{ at: "gear", label: "common.settings.view.showMinimap" }] },
  { feature: "Font", before: "gear menu", after: [{ at: "gear", label: "common.settings.font.title" }] },
  {
    feature: "Accessibility",
    before: "gear menu",
    after: [{ at: "gear", label: "common.settings.accessibility.highContrast" }],
  },
  { feature: "Theme", before: "gear menu", after: [{ at: "gear", label: "common.settings.theme.title" }] },
  { feature: "Language", before: "gear menu", after: [{ at: "gear", label: "common.settings.language.title" }] },
  { feature: "Conversation", before: "header tab", after: [{ at: "toolbarTab", view: "conversation" }] },
  { feature: "Analytics", before: "header tab", after: [{ at: "toolbarTab", view: "analytics" }] },
  { feature: "Recent edits", before: "header tab", after: [{ at: "toolbarTab", view: "edits" }] },
  { feature: "Board", before: "header tab", after: [{ at: "toolbarTab", view: "board" }] },
  {
    feature: "Token stats",
    before: "header tab",
    // The analytics screen's Tokens sub-tab (T9b); the analytics header
    // link it had in T7 is gone.
    after: [{ at: "analyticsSubTab", tab: "tokens" }],
  },
  {
    feature: "Command palette",
    before: "header search button",
    after: [{ at: "toolbar", label: "common.commandPalette", command: "palette.open" }],
  },
  {
    feature: "Refresh all conversations",
    before: "header button",
    after: [{ at: "toolbar", label: "session.refreshAllConversations" }],
  },
  {
    feature: "Global stats",
    before: "sidebar row",
    after: [{ at: "library", item: "globalStats", prop: "onGlobalStatsClick" }],
  },
  {
    feature: "Back / forward",
    before: "⌘[ / ⌘] only",
    after: [
      { at: "toolbar", label: "common.command.back", command: "go.back" },
      { at: "toolbar", label: "common.command.forward", command: "go.forward" },
      { at: "palette", command: "go.back", action: "goBack" },
    ],
  },
  {
    feature: "Inspector (outline: the message navigator)",
    before: "navigator's own collapse button",
    after: [
      { at: "toolbar", label: "common.toolbar.inspector", command: "view.toggleInspector" },
      { at: "palette", command: "view.toggleInspector", action: "toggleInspector" },
    ],
  },
];

function fakeActions(): CommandActions {
  return {
    openPalette: vi.fn(),
    openPreferences: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    focusFind: vi.fn(),
    toggleInspector: vi.fn(),
    toggleMinimap: vi.fn(),
    openSettingsManager: vi.fn(),
    openArchive: vi.fn(),
    openFeedback: vi.fn(),
    checkForUpdates: vi.fn(),
  };
}

function commandContext(actions: CommandActions): CommandContext {
  return {
    place: { view: "conversation", project: PROJECT, session: SESSION },
    runtime: "desktop",
    isMobile: false,
    canGoBack: true,
    canGoForward: true,
    hasFindTarget: true,
    tabs: { activeId: "t1", ids: ["t1"] },
    ownPlace: () => ({ isCurrent: () => true }) as unknown as ReturnType<CommandContext["ownPlace"]>,
    actions,
  } as CommandContext;
}

const flagsFor = (view: string) => ({
  isMessagesView: view === "conversation",
  isAnalyticsView: view === "analytics",
  isGlobalStatsView: false,
  isAnalyticsOverview: false,
  isAnalyticsTokens: false,
  isRecentEditsView: view === "edits",
  isBoardView: view === "board",
  isSettingsView: false,
  isArchiveView: false,
  isEmptyView: false,
  hasAnyError: false,
  isLoadingAnalytics: false,
  isLoadingTokenStats: false,
  isLoadingRecentEdits: false,
  isAnyLoading: false,
}) satisfies UseAnalyticsReturn["computed"];

const pristine = useAppStore.getState();

beforeEach(() => {
  cleanup();
  openModal.mockClear();
  useAppStore.setState(pristine, true);
  useAppStore.setState({
    view: "conversation",
    selectedProject: PROJECT,
    selectedSession: SESSION,
    projects: [PROJECT],
    sessions: [SESSION],
    placeHistory: { back: [{ view: "empty", project: null, session: null }], forward: [{ view: "analytics", project: PROJECT, session: SESSION }] },
    refreshAllConversations: vi.fn(async () => {}),
  } as never);
});

function renderToolbar(actions: CommandActions) {
  const analyticsActions = {
    switchToMessages: vi.fn(),
    switchToAnalytics: vi.fn(async () => {}),
    switchToRecentEdits: vi.fn(async () => {}),
    switchToBoard: vi.fn(async () => {}),
  };
  render(
    <CommandRunnerContext.Provider value={() => commandContext(actions)}>
      <ThemeProvider>
      <TooltipProvider>
        <Header
          analyticsActions={analyticsActions as unknown as UseAnalyticsReturn["actions"]}
          analyticsComputed={flagsFor(useAppStore.getState().view)}
          updater={{ state: { isChecking: false } } as unknown as UseUpdaterReturn}
        />
      </TooltipProvider>
      </ThemeProvider>
    </CommandRunnerContext.Provider>
  );
  return analyticsActions;
}

function renderSidebar() {
  const props = {
    onGlobalStatsClick: vi.fn(),
    onOpenArchive: vi.fn(),
    onOpenSettingsManager: vi.fn(),
    onOpenHelp: vi.fn(),
  };
  render(
    <TooltipProvider>
      <ProjectTree
        projects={[PROJECT]}
        sessions={[SESSION]}
        selectedProject={PROJECT}
        selectedSession={SESSION}
        onProjectSelect={vi.fn()}
        onSessionSelect={vi.fn()}
        isLoading={false}
        {...props}
      />
    </TooltipProvider>
  );
  return props;
}

/** Pointer click, touch tap: each must run the entry once more. */
function activateByPointerAndTouch(element: HTMLElement, calls: () => number) {
  const before = calls();
  fireEvent.click(element);
  expect(calls()).toBe(before + 1);
  fireEvent.pointerDown(element, { pointerType: "touch" });
  fireEvent.pointerUp(element, { pointerType: "touch" });
  fireEvent.click(element);
  expect(calls()).toBe(before + 2);
}

/** A control the keyboard reaches: an enabled button in the tab order. */
function expectInTabOrder(element: HTMLElement) {
  expect(element.tagName).toBe("BUTTON");
  expect((element as HTMLButtonElement).disabled).toBe(false);
  expect(element.tabIndex).toBeGreaterThanOrEqual(0);
}

/** Open the gear menu with the keyboard and find an entry by its label. */
function openGearByKeyboard(): HTMLElement {
  const trigger = document.getElementById("app-settings-button")!;
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.getByRole("menu");
}

async function check(place: Place) {
  switch (place.at) {
    case "palette": {
      const command = getCommand(place.command);
      expect(command, place.command).toBeDefined();
      const actions = fakeActions();
      const ctx = commandContext(actions);
      expect(paletteCommands(ctx).map((c) => c.id)).toContain(place.command);
      expect(runCommand(place.command, ctx)).toBe(true);
      expect(actions[place.action]).toHaveBeenCalledTimes(1);
      return;
    }
    case "toolbar": {
      const actions = fakeActions();
      renderToolbar(actions);
      const banner = screen.getByRole("banner");
      const button = within(banner).getAllByRole("button", { name: place.label })[0]!;
      expectInTabOrder(button);
      if (place.command) {
        const action = Object.entries({
          "palette.open": actions.openPalette,
          "go.back": actions.goBack,
          "go.forward": actions.goForward,
          "view.toggleInspector": actions.toggleInspector,
        }).find(([id]) => id === place.command)![1] as ReturnType<typeof vi.fn>;
        activateByPointerAndTouch(button, () => action.mock.calls.length);
      } else {
        const refresh = useAppStore.getState().refreshAllConversations as unknown as ReturnType<typeof vi.fn>;
        activateByPointerAndTouch(button, () => refresh.mock.calls.length);
      }
      return;
    }
    case "toolbarTab": {
      // Start on another screen so every tab (conversation included) acts.
      useAppStore.setState({ view: place.view === "conversation" ? "analytics" : "conversation" });
      const analyticsActions = renderToolbar(fakeActions());
      const index = TOOLBAR_TAB_ORDER.indexOf(place.view);
      const tab = within(screen.getByRole("tablist")).getAllByRole("tab")[index]!;
      expect((tab as HTMLButtonElement).disabled).toBe(false);
      const target = {
        conversation: analyticsActions.switchToMessages,
        analytics: analyticsActions.switchToAnalytics,
        edits: analyticsActions.switchToRecentEdits,
        board: analyticsActions.switchToBoard,
      }[place.view];
      fireEvent.click(tab);
      expect(target).toHaveBeenCalled();
      return;
    }
    case "library": {
      const props = renderSidebar();
      const row = document.querySelector<HTMLElement>(`[data-library-item="${place.item}"]`)!;
      expect(row, place.item).not.toBeNull();
      expectInTabOrder(row);
      const spy = props[place.prop];
      activateByPointerAndTouch(row, () => spy.mock.calls.length);
      return;
    }
    case "sidebarHelp": {
      const props = renderSidebar();
      const button = screen.getByRole("button", { name: "common.helpMenu.feedback" });
      expectInTabOrder(button);
      activateByPointerAndTouch(button, () => props.onOpenHelp.mock.calls.length);
      return;
    }
    case "gear": {
      renderToolbar(fakeActions());
      const menu = openGearByKeyboard();
      // Submenu triggers read "title · current value"; match the title part.
      const entry = Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')).find((item) =>
        item.textContent?.includes(place.label)
      );
      expect(entry, place.label).toBeDefined();
      return;
    }
    case "analyticsSubTab": {
      render(
        <ContentHeader view="analytics" selectedSession={SESSION} globalOverviewDescription="" />
      );
      expect(document.querySelector("[data-related-view]")).toBeNull();
      cleanup();
      const onChange = vi.fn();
      render(<AnalyticsSubTabs value="overview" onChange={onChange} />);
      const tab = document.querySelector<HTMLElement>(`[data-analytics-tab="${place.tab}"]`)!;
      expect(tab.getAttribute("role")).toBe("tab");
      activateByPointerAndTouch(tab, () => onChange.mock.calls.length);
      expect(onChange).toHaveBeenCalledWith(place.tab);
      // The keyboard reaches it from the selected sub-tab, the tablist's one stop.
      const selected = document.querySelector<HTMLElement>('[data-analytics-tab="overview"]')!;
      expectInTabOrder(selected);
      onChange.mockClear();
      fireEvent.keyDown(selected, { key: "ArrowRight" });
      expect(onChange).toHaveBeenCalledWith(place.tab);
      return;
    }
  }
}

describe("§6 reachability after T7", () => {
  it("lists every former header control and gear entry", () => {
    expect(REACHABILITY.map((r) => r.feature)).toMatchInlineSnapshot(`
      [
        "Settings Manager",
        "Archive",
        "Feedback",
        "Check for updates (desktop)",
        "Claude folder",
        "Message filters",
        "View (minimap)",
        "Font",
        "Accessibility",
        "Theme",
        "Language",
        "Conversation",
        "Analytics",
        "Recent edits",
        "Board",
        "Token stats",
        "Command palette",
        "Refresh all conversations",
        "Global stats",
        "Back / forward",
        "Inspector (outline: the message navigator)",
      ]
    `);
    for (const entry of REACHABILITY) expect(entry.after.length, entry.feature).toBeGreaterThan(0);
  });

  it.each(REACHABILITY.flatMap((entry) => entry.after.map((place) => [entry.feature, place.at, place] as const)))(
    "%s is reachable from %s",
    async (_feature, _at, place) => {
      await check(place);
    }
  );

  it("the gear menu no longer offers what moved out of it", () => {
    renderToolbar(fakeActions());
    const menu = openGearByKeyboard();
    for (const moved of ["common.place.claudeCodeSettings", "common.place.archive", "feedback.title"]) {
      expect(within(menu).queryByText(moved), moved).toBeNull();
    }
  });

  it("gear entries run from the keyboard (Enter on the focused item)", () => {
    renderToolbar(fakeActions());
    const menu = openGearByKeyboard();
    const folder = within(menu).getByText("common.settings.changeFolder").closest<HTMLElement>('[role="menuitem"]')!;
    folder.focus();
    fireEvent.keyDown(folder, { key: "Enter" });
    expect(openModal).toHaveBeenCalledWith("folderSelector", { mode: "change" });
  });
});
