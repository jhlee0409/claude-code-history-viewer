/**
 * Plan §6 reachability, driven through the real shell (T7 review R7).
 *
 * `reachability.t7.test.tsx` renders each control on its own with its own
 * spies, so it would still pass if the shell stopped wiring a control to
 * its action (say AppLayout dropped `onOpenSettingsManager`). Here the
 * whole app renders - App, AppLayout, Header, ProjectTree, the command
 * runner, the modal provider and container, the ⌘K palette and the real
 * store - and every entry that moved in T7, plus representative gear
 * preferences, is activated from the DOM. Each row asserts what the user
 * would see change: the screen (`view`), the modal that opened, the store
 * value or the event the updater listens for. Only the screens' bodies, the
 * folder picker / feedback form bodies and the backend are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ClaudeProject, ClaudeSession } from "@/types";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  Toaster: () => null,
}));
vi.mock("@/hooks/useAppInitialization", () => ({ useAppInitialization: () => {} }));
vi.mock("@/hooks/useUpdater", () => ({
  useUpdater: () => ({ state: { isChecking: false, currentVersion: "1.0.0", hasUpdate: false } }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
const platformState = vi.hoisted(() => ({ isMobile: false }));
vi.mock("@/contexts/platform", () => ({
  usePlatform: () => ({ platform: "desktop", isDesktop: true, isMobile: platformState.isMobile }),
  DesktopOnly: ({ children }: { children: ReactNode }) => <>{children}</>,
  MobileOnly: () => null,
}));
vi.mock("@/hooks/useMediaQuery", () => ({
  useMediaQuery: () => true,
  useIsXlUp: () => false,
  useIsLgUp: () => true,
  XL_BREAKPOINT: 1280,
}));

/** A screen body: its name, so a row can see which screen the shell shows. */
const { screenStub } = vi.hoisted(() => ({
  screenStub: (name: string) => () => <div data-screen={name} />,
}));
vi.mock("@/components/MessageViewer", () => ({ MessageViewer: screenStub("MessageViewer") }));
vi.mock("@/components/TokenStatsViewer", () => ({ TokenStatsViewer: screenStub("TokenStatsViewer") }));
vi.mock("@/components/AnalyticsDashboard", () => ({ AnalyticsDashboard: screenStub("AnalyticsDashboard") }));
vi.mock("@/components/RecentEditsViewer", () => ({ RecentEditsViewer: screenStub("RecentEditsViewer") }));
vi.mock("@/components/SettingsManager", () => ({ SettingsManager: screenStub("SettingsManager") }));
vi.mock("@/components/SessionBoard/SessionBoard", () => ({ SessionBoard: screenStub("SessionBoard") }));
vi.mock("@/components/ArchiveManager", () => ({ ArchiveManager: screenStub("ArchiveManager") }));
vi.mock("@/components/MessageNavigator", () => ({
  MessageNavigator: (props: { asideId?: string }) => <aside id={props.asideId} data-screen="MessageNavigator" />,
}));
vi.mock("@/components/SimpleUpdateManager", () => ({ SimpleUpdateManager: () => null }));
vi.mock("@/components/modals/feedback/FeedbackModal", () => ({
  FeedbackModal: () => <div data-modal="feedback" />,
}));
vi.mock("@/components/modals/folderSelect/FolderSelector", () => ({
  FolderSelector: (props: { mode?: string }) => <div data-modal="folderSelector" data-mode={props.mode} />,
}));

import i18n from "@/i18n";
import App from "@/App";
import { ModalProvider } from "@/contexts/modal/ModalProvider";
import { ThemeProvider } from "@/contexts/theme";
import { useAppStore } from "@/store/useAppStore";
import { useLanguageStore } from "@/store/useLanguageStore";
import { MANUAL_UPDATE_CHECK_EVENT } from "@/commands/useCommandContext";

const PROJECT: ClaudeProject = {
  name: "alpha",
  path: "/p/alpha",
  actual_path: "/home/alpha",
  session_count: 2,
  message_count: 2,
  last_modified: "2026-01-02T00:00:00.000Z",
  provider: "claude",
};
const session = (n: number): ClaudeSession => ({
  session_id: `s${n}`,
  actual_session_id: `s${n}`,
  file_path: `/p/alpha/s${n}.jsonl`,
  project_name: "alpha",
  message_count: 2,
  first_message_time: "",
  last_message_time: "",
  last_modified: `2026-01-0${3 - n}T00:00:00.000Z`,
  has_tool_use: false,
  has_errors: false,
  summary: `Session number ${n}`,
  provider: "claude",
});
const S1 = session(1);
const S2 = session(2);

const pristine = useAppStore.getState();
const pristineLanguage = useLanguageStore.getState();
const state = () => useAppStore.getState();
const t = (key: string) => i18n.t(key);

beforeEach(async () => {
  cleanup();
  localStorage.clear();
  // jsdom keeps the URL between tests; a session left in it would reopen
  // on start (a WebUI deep link) in the next test's shell.
  window.history.replaceState(null, "", "/");
  await i18n.changeLanguage("en");
  useLanguageStore.setState(pristineLanguage, true);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  apiMock.mockReset();
  apiMock.mockImplementation(async (command: string) => {
    switch (command) {
      case "load_project_sessions":
      case "load_provider_sessions":
        return [S1, S2];
      case "load_provider_sessions_page":
        return { sessions: [S1, S2], total: 2, nextOffset: 2, hasMore: false };
      case "load_provider_messages_paginated":
        return { messages: [], total_count: 0, has_more: false, next_offset: 0 };
      case "get_session_subagents":
      case "search_messages":
        return [];
      default:
        return null;
    }
  });
  useAppStore.setState(pristine, true);
  useAppStore.setState({
    claudePath: "/home/.claude",
    projects: [PROJECT],
    sessions: [S1, S2],
    sessionsTotal: 2,
    selectedProject: PROJECT,
    selectedSession: S1,
    view: "conversation",
    isMetadataLoaded: true,
    isInspectorOpen: false,
    placeHistory: {
      back: [{ view: "analytics", project: PROJECT, session: S1 }],
      forward: [{ view: "board", project: PROJECT, session: S1 }],
    },
    refreshAllConversations: vi.fn(async () => {}),
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  platformState.isMobile = false;
});

async function renderShell() {
  render(
    <ThemeProvider>
      <ModalProvider>
        <App />
      </ModalProvider>
    </ThemeProvider>
  );
  await act(async () => {});
}

const header = () => screen.getByRole("banner");
const sidebar = () => document.getElementById("project-explorer")!;
const modal = (name: string) => document.querySelector(`[data-modal="${name}"]`);

/** Click a control, then let the shell's async work (navigate, loads) land. */
async function activate(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
}

/** Open the gear menu with the keyboard, as the existing §6 test does. */
async function openGear(): Promise<HTMLElement> {
  const trigger = document.getElementById("app-settings-button")!;
  trigger.focus();
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "Enter" });
  });
  return screen.getByRole("menu");
}

function gearItem(menu: HTMLElement, label: string): HTMLElement {
  const item = Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')).find((el) =>
    el.textContent?.includes(label)
  );
  expect(item, label).toBeDefined();
  return item!;
}

/** Open a gear submenu (Font, Theme, Language) and pick an option in it. */
async function pickInGearSubmenu(title: string, option: string) {
  const menu = await openGear();
  const trigger = gearItem(menu, title);
  trigger.focus();
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "ArrowRight" });
  });
  const sub = screen.getAllByRole("menu").find((m) => m !== menu)!;
  expect(sub, `${title} submenu`).toBeDefined();
  const radio = within(sub)
    .getAllByRole("menuitemradio")
    .find((el) => el.textContent?.includes(option))!;
  expect(radio, option).toBeDefined();
  await activate(radio);
}

/** Open ⌘K from the toolbar, type a command's title (as typed: no "…"), press Enter. */
const paletteButton = () => within(header()).getAllByRole("button", { name: t("common.commandPalette") })[0]!;

async function runFromPalette(labelKey: string) {
  await activate(paletteButton());
  const input = await screen.findByPlaceholderText(t("globalSearch.placeholder"));
  await act(async () => {
    fireEvent.change(input, { target: { value: t(labelKey).replace(/…$/, "") } });
  });
  expect(screen.getAllByRole("option")[0]?.getAttribute("aria-selected"), labelKey).toBe("true");
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
}

const screenShown = () => document.querySelector("[data-screen]:not([data-screen=MessageNavigator])")?.getAttribute("data-screen");

describe("§6 reachability through the real shell", () => {
  describe("moved to the sidebar library", () => {
    it.each([
      ["globalStats", "globalStats"],
      ["archive", "archive"],
      ["settingsManager", "settingsManager"],
    ] as const)("the %s row opens its screen", async (item, view) => {
      await renderShell();
      await activate(sidebar().querySelector(`[data-library-item="${item}"]`)!);
      await waitFor(() => expect(state().view).toBe(view));
    });

    it("the help button opens the feedback form", async () => {
      await renderShell();
      expect(modal("feedback")).toBeNull();
      await activate(within(sidebar()).getByRole("button", { name: t("common.helpMenu.feedback") }));
      await waitFor(() => expect(modal("feedback")).not.toBeNull());
    });
  });

  describe("moved to (or kept in) the ⌘K palette", () => {
    it.each([
      ["common.command.openSettingsManager", () => expect(state().view).toBe("settingsManager")],
      ["common.command.openArchive", () => expect(state().view).toBe("archive")],
      ["common.command.sendFeedback", () => expect(modal("feedback")).not.toBeNull()],
      ["common.command.back", () => expect(state().view).toBe("analytics")],
      ["common.command.toggleInspector", () => expect(state().isInspectorOpen).toBe(true)],
    ] as const)("%s runs from the palette", async (labelKey, expectEffect) => {
      await renderShell();
      await runFromPalette(labelKey);
      await waitFor(expectEffect);
    });

    it("check for updates runs from the palette (desktop)", async () => {
      const heard = vi.fn();
      window.addEventListener(MANUAL_UPDATE_CHECK_EVENT, heard);
      try {
        await renderShell();
        await runFromPalette("common.command.checkForUpdates");
        await waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
      } finally {
        window.removeEventListener(MANUAL_UPDATE_CHECK_EVENT, heard);
      }
    });
  });

  describe("toolbar", () => {
    it.each([
      ["analytics", "conversation", "analytics"],
      ["edits", "conversation", "edits"],
      ["board", "conversation", "board"],
      ["conversation", "analytics", "conversation"],
    ] as const)("the %s tab opens its screen", async (tab, from, view) => {
      useAppStore.setState({ view: from });
      await renderShell();
      await activate(document.getElementById(`view-tab-${tab}`)!);
      await waitFor(() => expect(state().view).toBe(view));
    });

    it("back and forward move through the place history", async () => {
      await renderShell();
      await activate(within(header()).getByRole("button", { name: t("common.command.back") }));
      await waitFor(() => expect(state().view).toBe("analytics"));
      await activate(within(header()).getByRole("button", { name: t("common.command.forward") }));
      await waitFor(() => expect(state().view).toBe("conversation"));
    });

    it("the inspector button opens and closes the inspector, on its outline (the message navigator)", async () => {
      await renderShell();
      expect(document.getElementById("inspector")).toBeNull();
      expect(document.querySelector('[data-screen="MessageNavigator"]')).toBeNull();
      await activate(within(header()).getByRole("button", { name: t("common.toolbar.inspector") }));
      expect(state().isInspectorOpen).toBe(true);
      expect(document.getElementById("inspector")).not.toBeNull();
      expect(document.querySelector('[data-screen="MessageNavigator"]')).not.toBeNull();
      await activate(within(header()).getByRole("button", { name: t("common.toolbar.inspector") }));
      expect(state().isInspectorOpen).toBe(false);
      expect(document.getElementById("inspector")).toBeNull();
    });

    it.each([
      ["no session is open", { selectedSession: null }],
      ["the screen has no inspector", { view: "analytics" }],
    ] as const)("where %s, the inspector button is disabled and ⌘⇧M keeps the saved state", async (_, patch) => {
      useAppStore.setState(patch as never);
      await renderShell();
      const toggle = within(header()).getByRole("button", { name: t("common.toolbar.inspector") });
      expect(toggle).toBeDisabled();
      await act(async () => {
        fireEvent.keyDown(window, { key: "M", ctrlKey: true, shiftKey: true });
      });
      expect(state().isInspectorOpen).toBe(false);
      expect(document.getElementById("inspector")).toBeNull();
    });

    it("beside an open conversation, ⌘⇧M opens the inspector (the control for the row above)", async () => {
      await renderShell();
      await act(async () => {
        fireEvent.keyDown(window, { key: "M", ctrlKey: true, shiftKey: true });
      });
      expect(state().isInspectorOpen).toBe(true);
      expect(document.getElementById("inspector")).not.toBeNull();
    });

    it("the inspector button says whether the panel is open and which element it controls", async () => {
      await renderShell();
      const toggle = within(header()).getByRole("button", { name: t("common.toolbar.inspector") });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      await activate(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(toggle).toHaveAttribute("aria-controls", "inspector");
      expect(document.getElementById(toggle.getAttribute("aria-controls")!)).not.toBeNull();
    });

    it.each(["tokens", "info"] as const)("on a phone, a saved open %s inspector is not mounted and loads nothing", async (tab) => {
      platformState.isMobile = true;
      useAppStore.setState({ isInspectorOpen: true, inspectorTab: tab } as never);
      await renderShell();
      expect(document.getElementById("inspector")).toBeNull();
      const commands = apiMock.mock.calls.map(([c]) => String(c));
      expect(commands.filter((c) => /token_stats/.test(c))).toEqual([]);
      // The preference itself is kept for the desktop.
      expect(state().isInspectorOpen).toBe(true);
    });

    it("opening the inspector focuses its tab; Escape closes it and returns focus to the toolbar button", async () => {
      await renderShell();
      const toggle = within(header()).getByRole("button", { name: t("common.toolbar.inspector") });
      await activate(toggle);
      const outline = await screen.findByRole("tab", { name: t("common.inspector.tab.outline") });
      await waitFor(() => expect(document.activeElement).toBe(outline));
      await act(async () => {
        fireEvent.keyDown(outline, { key: "Escape" });
      });
      expect(state().isInspectorOpen).toBe(false);
      expect(document.getElementById("inspector")).toBeNull();
      expect(document.activeElement).toBe(toggle);
    });

    it("the palette button opens the palette", async () => {
      await renderShell();
      await activate(paletteButton());
      expect(await screen.findByPlaceholderText(t("globalSearch.placeholder"))).toBeTruthy();
    });

    it("refresh reloads every conversation", async () => {
      await renderShell();
      await activate(within(header()).getByRole("button", { name: t("session.refreshAllConversations") }));
      expect(state().refreshAllConversations).toHaveBeenCalledTimes(1);
    });
  });

  it("token stats open as the analytics Tokens sub-tab, and Overview goes back (T9b)", async () => {
    await renderShell();
    await activate(document.getElementById("view-tab-analytics")!);
    await waitFor(() => expect(screenShown()).toBe("AnalyticsDashboard"));
    expect(document.querySelector('[data-related-view]')).toBeNull();
    await activate(document.querySelector('[data-analytics-tab="tokens"]')!);
    await waitFor(() => expect(state().analyticsTab).toBe("tokens"));
    expect(state().view).toBe("analytics");
    expect(screenShown()).toBe("TokenStatsViewer");
    // The toolbar's analytics tab stays the selected one.
    expect(document.getElementById("view-tab-analytics")!.getAttribute("aria-selected")).toBe("true");
    await activate(document.querySelector('[data-analytics-tab="overview"]')!);
    await waitFor(() => expect(state().analyticsTab).toBe("overview"));
    expect(screenShown()).toBe("AnalyticsDashboard");
  });

  describe("gear menu", () => {
    it("check for updates", async () => {
      const heard = vi.fn();
      window.addEventListener(MANUAL_UPDATE_CHECK_EVENT, heard);
      try {
        await renderShell();
        await activate(gearItem(await openGear(), t("common.settings.checkUpdate")));
        expect(heard).toHaveBeenCalledTimes(1);
      } finally {
        window.removeEventListener(MANUAL_UPDATE_CHECK_EVENT, heard);
      }
    });

    it("Claude folder opens the folder picker", async () => {
      await renderShell();
      await activate(gearItem(await openGear(), t("common.settings.changeFolder")));
      await waitFor(() => expect(modal("folderSelector")?.getAttribute("data-mode")).toBe("change"));
    });

    it("message filter, minimap and high contrast toggle their setting", async () => {
      await renderShell();
      const before = {
        system: state().showSystemMessages,
        minimap: state().isMinimapOpen,
        contrast: state().highContrast,
      };
      await activate(gearItem(await openGear(), t("common.settings.filter.showSystemMessages")));
      await waitFor(() => expect(state().showSystemMessages).toBe(!before.system));
      cleanup();
      await renderShell();
      await activate(gearItem(await openGear(), t("common.settings.view.showMinimap")));
      await waitFor(() => expect(state().isMinimapOpen).toBe(!before.minimap));
      cleanup();
      await renderShell();
      await activate(gearItem(await openGear(), t("common.settings.accessibility.highContrast")));
      await waitFor(() => expect(state().highContrast).toBe(!before.contrast));
    });

    it("font size, theme and language are picked from their submenus", async () => {
      await renderShell();
      await pickInGearSubmenu(t("common.settings.font.title"), "(120%)");
      await waitFor(() => expect(state().fontScale).toBe(120));
      cleanup();
      await renderShell();
      await pickInGearSubmenu(t("common.settings.theme.title"), t("common.settings.theme.dark"));
      await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
      cleanup();
      await renderShell();
      await pickInGearSubmenu(t("common.settings.language.title"), "한국어");
      await waitFor(() => expect(useLanguageStore.getState().language).toBe("ko"));
    });
  });

  describe("conversation tabs (T8)", () => {
    const strip = () => screen.getByRole("tablist", { name: t("common.tabs.label") });
    const tabs = () => within(strip()).getAllByRole("tab");
    const selectedTab = () => tabs().find((tab) => tab.getAttribute("aria-selected") === "true");
    const key = async (init: KeyboardEventInit) => {
      await act(async () => {
        fireEvent.keyDown(window, { bubbles: true, cancelable: true, ...init });
      });
    };

    it("the strip shows the open tab, selected and named after its session", async () => {
      await renderShell();
      expect(tabs()).toHaveLength(1);
      expect(selectedTab()?.textContent).toContain("Session number 1");
    });

    it("a session deleted while open: the tab's notice renders, never the app's error screen (review #6)", async () => {
      await renderShell();
      apiMock.mockImplementation(async (command: string) => {
        if (command === "load_provider_messages_paginated") throw new Error("No such file or directory (os error 2)");
        if (command === "load_provider_sessions_page") return { sessions: [S2], total: 1, nextOffset: 1, hasMore: false };
        return command === "load_project_sessions" || command === "load_provider_sessions" ? [S2] : null;
      });
      // The watcher's reload of the open session finds the file gone.
      await act(async () => {
        await state().reloadCurrent("watcher");
      });

      const notice = await waitFor(() => {
        const found = document.querySelector('[role="alert"][data-tab-unavailable="session"]');
        expect(found).not.toBeNull();
        return found as HTMLElement;
      });
      expect(notice.textContent).toContain(t("common.tabs.unavailable.session"));
      expect(screen.queryByText(t("common.errorOccurred"))).toBeNull();
      expect(header()).toBeTruthy();
      expect(selectedTab()?.textContent).toContain("Session number 1");
      // Its Close button closes the tab: one empty tab is left.
      await activate(within(notice).getByRole("button", { name: t("common.tabs.closeThis") }));
      await waitFor(() => expect(document.querySelector("[data-tab-unavailable]")).toBeNull());
      expect(tabs()).toHaveLength(1);
      expect(selectedTab()?.textContent).toContain(t("common.tabs.empty"));
    });

    it("a tab whose project folder was deleted between scans: its notice renders, the tabs stay and the other tab opens (re-review #1)", async () => {
      await renderShell();
      await activate(within(document.querySelector('[data-slot="tabs"]')!).getByRole("button", { name: t("common.command.newTab") }));
      await waitFor(() => expect(tabs()).toHaveLength(2));
      const blankTab = state().activeDocumentId;
      // The folder goes; the project is still listed (no scan since).
      apiMock.mockImplementation(async (command: string) => {
        if (command === "load_provider_sessions_page" || command === "load_provider_sessions" || command === "load_project_sessions") {
          throw new Error("Failed to resolve project_path: No such file or directory (os error 2)");
        }
        if (command === "load_provider_messages_paginated") throw new Error("No such file or directory (os error 2)");
        return null;
      });

      await activate(tabs()[0]!);

      const notice = await waitFor(() => {
        const found = document.querySelector('[role="alert"][data-tab-unavailable="project"]');
        expect(found).not.toBeNull();
        return found as HTMLElement;
      });
      expect(notice.textContent).toContain(t("common.tabs.unavailable.project"));
      expect(screen.queryByText(t("common.errorOccurred"))).toBeNull();
      expect(header()).toBeTruthy();
      expect(tabs()).toHaveLength(2);
      expect(selectedTab()).toBe(tabs()[0]);
      expect(selectedTab()?.textContent).toContain("Session number 1");

      // The other tab opens from the strip.
      await activate(tabs()[1]!);
      await waitFor(() => expect(state().activeDocumentId).toBe(blankTab));
      expect(document.querySelector("[data-tab-unavailable]")).toBeNull();
      expect(screen.queryByText(t("common.errorOccurred"))).toBeNull();
      expect(selectedTab()).toBe(tabs()[1]);
    });

    it.each([
      ["common.command.newTab", 2],
      ["common.command.closeTab", 1],
    ] as const)("%s runs from the palette", async (labelKey, count) => {
      await renderShell();
      await runFromPalette(labelKey);
      await waitFor(() => expect(state().documents).toHaveLength(count));
    });

    it("next / previous tab run from the palette", async () => {
      await renderShell();
      await activate(within(document.querySelector('[data-slot="tabs"]')!).getByRole("button", { name: t("common.command.newTab") }));
      const second = state().activeDocumentId;
      await runFromPalette("common.command.previousTab");
      await waitFor(() => expect(state().activeDocumentId).not.toBe(second));
      await runFromPalette("common.command.nextTab");
      await waitFor(() => expect(state().activeDocumentId).toBe(second));
    });

    it("the + button opens an empty tab; clicking the first tab goes back to its session", async () => {
      await renderShell();
      await activate(within(document.querySelector('[data-slot="tabs"]')!).getByRole("button", { name: t("common.command.newTab") }));
      await waitFor(() => expect(tabs()).toHaveLength(2));
      expect(state().selectedSession).toBeNull();
      expect(selectedTab()?.textContent).toContain(t("common.tabs.empty"));
      await activate(tabs()[0]!);
      await waitFor(() => expect(state().selectedSession?.file_path).toBe(S1.file_path));
      expect(selectedTab()).toBe(tabs()[0]);
    });

    it("Ctrl+click on a sidebar session opens it in a new tab and keeps the first", async () => {
      await renderShell();
      const row = within(sidebar()).getByText("Session number 2");
      await act(async () => {
        fireEvent.click(row, { ctrlKey: true });
      });
      await waitFor(() => expect(state().selectedSession?.file_path).toBe(S2.file_path));
      expect(tabs()).toHaveLength(2);
      expect(tabs()[0]?.textContent).toContain("Session number 1");
      expect(selectedTab()).toBe(tabs()[1]);
    });

    it("Ctrl+click on a toolbar screen tab opens that screen in a new tab", async () => {
      await renderShell();
      await act(async () => {
        fireEvent.click(document.getElementById("view-tab-analytics")!, { ctrlKey: true });
      });
      await waitFor(() => expect(state().view).toBe("analytics"));
      expect(tabs()).toHaveLength(2);
      expect(tabs()[0]?.textContent).toContain("Session number 1");
    });

    // jsdom is a browser, not the desktop app: the WebUI keys apply, since
    // the browser keeps ⌘T ⌘W ⌘1-9 for itself (plan §4.4).
    it("the WebUI shortcuts open, switch and close tabs (⌥T, ⌥1, ⌥⇧→, ⌥W)", async () => {
      await renderShell();
      await key({ key: "t", code: "KeyT", altKey: true });
      await waitFor(() => expect(state().documents).toHaveLength(2));
      const second = state().activeDocumentId;
      await key({ key: "1", code: "Digit1", altKey: true });
      await waitFor(() => expect(state().activeDocumentId).not.toBe(second));
      await key({ key: "ArrowRight", code: "ArrowRight", altKey: true, shiftKey: true });
      await waitFor(() => expect(state().activeDocumentId).toBe(second));
      await key({ key: "w", code: "KeyW", altKey: true });
      await waitFor(() => expect(state().documents).toHaveLength(1));
      expect(state().selectedSession?.file_path).toBe(S1.file_path);
    });

    it("keyboard in the strip: one tab stop, arrows move focus, Enter opens, Delete closes", async () => {
      await renderShell();
      await activate(within(document.querySelector('[data-slot="tabs"]')!).getByRole("button", { name: t("common.command.newTab") }));
      await waitFor(() => expect(tabs()).toHaveLength(2));
      expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, 0]);
      tabs()[1]!.focus();
      await act(async () => {
        fireEvent.keyDown(tabs()[1]!, { key: "ArrowRight" });
      });
      expect(document.activeElement).toBe(tabs()[0]);
      expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1]);
      await activate(tabs()[0]!);
      await waitFor(() => expect(state().selectedSession?.file_path).toBe(S1.file_path));
      await act(async () => {
        fireEvent.keyDown(tabs()[1]!, { key: "Delete" });
      });
      await waitFor(() => expect(tabs()).toHaveLength(1));
    });

    it("Delete on a focused tab moves focus to the tab that takes its place (review #8)", async () => {
      await renderShell();
      const plus = () => within(document.querySelector('[data-slot="tabs"]')!).getByRole("button", { name: t("common.command.newTab") });
      await activate(plus());
      await activate(plus());
      await waitFor(() => expect(tabs()).toHaveLength(3));
      const ids = tabs().map((tab) => tab.dataset.documentId);

      // The middle tab (not the open one): its right neighbour takes focus.
      tabs()[1]!.focus();
      await act(async () => {
        fireEvent.keyDown(tabs()[1]!, { key: "Delete" });
      });
      await waitFor(() => expect(tabs()).toHaveLength(2));
      expect(document.activeElement).toBe(tabs()[1]);
      expect((document.activeElement as HTMLElement).dataset.documentId).toBe(ids[2]);
      expect(tabs()[1]!.tabIndex).toBe(0);

      // The last tab, which is open: its left neighbour opens and takes focus.
      await act(async () => {
        fireEvent.keyDown(tabs()[1]!, { key: "Backspace" });
      });
      await waitFor(() => expect(tabs()).toHaveLength(1));
      await waitFor(() => expect(document.activeElement).toBe(tabs()[0]));
      expect(tabs()[0]!.dataset.documentId).toBe(ids[0]);

      // The only tab: the empty tab that replaces it takes focus.
      await act(async () => {
        fireEvent.keyDown(tabs()[0]!, { key: "Delete" });
      });
      await waitFor(() => expect(tabs()[0]!.dataset.documentId).not.toBe(ids[0]));
      await waitFor(() => expect(document.activeElement).toBe(tabs()[0]));
    });

    it("the close shortcut from a focused tab keeps focus in the strip (review #8)", async () => {
      await renderShell();
      await activate(within(document.querySelector('[data-slot="tabs"]')!).getByRole("button", { name: t("common.command.newTab") }));
      await waitFor(() => expect(tabs()).toHaveLength(2));
      selectedTab()!.focus();
      await act(async () => {
        fireEvent.keyDown(selectedTab()!, { key: "w", code: "KeyW", altKey: true, bubbles: true, cancelable: true });
      });
      await waitFor(() => expect(tabs()).toHaveLength(1));
      await waitFor(() => expect(document.activeElement).toBe(tabs()[0]));
    });

    it("a tab that cannot open says why inside the tab, and closes from there", async () => {
      useAppStore.setState({
        documents: [{ ...state().documents[0]!, unavailable: "session" }],
      });
      await renderShell();
      const notice = screen.getByRole("alert");
      expect(notice.textContent).toContain(t("common.tabs.unavailable.session"));
      await activate(within(notice).getByRole("button", { name: t("common.tabs.closeThis") }));
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
      expect(state().selectedProject).toBeNull();
    });
  });
});
