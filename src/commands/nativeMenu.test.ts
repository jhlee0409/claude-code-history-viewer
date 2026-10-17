/**
 * The desktop's native-menu bridge (plan §4.4, T11a): the menu the Rust side
 * builds from the manifest runs the same registry commands, a shortcut has one
 * owner, and the menu follows the app's language and command state.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import raw from "./manifest.json";
import { COMMAND_MANIFEST, NATIVE_SHORTCUTS, PREDEFINED_MENU_ITEMS } from "./manifest";
import { COMMANDS, type CommandActions, type CommandContext } from "./registry";
import { createShortcutHandler } from "./shortcuts";
import type { KeyEnvironment } from "./keys";
import {
  MENU_CHECKS,
  MENU_COMMAND_IDS,
  computeMenuState,
  nativeShortcutsOwned,
  startMenuBridge,
  type MenuBridgeDeps,
  type MenuState,
} from "./nativeMenu";
import en from "@/i18n/locales/en/common.json";

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  const actions: CommandActions = {
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
    newTab: vi.fn(),
    closeTab: vi.fn(),
    cycleTab: vi.fn(),
    selectTabAt: vi.fn(),
  };
  return {
    place: {
      view: "conversation",
      project: { provider: "claude", path: "/p" },
      session: { provider: "claude", filePath: "/p/s.jsonl", sessionId: "s" },
    },
    runtime: "desktop",
    isMobile: false,
    canGoBack: true,
    canGoForward: false,
    hasFindTarget: true,
    tabCount: 3,
    ownPlace: () => () => true,
    actions,
    ...overrides,
  };
}

const MAC_DESKTOP: KeyEnvironment = { os: "mac", runtime: "desktop" };
const WIN_DESKTOP: KeyEnvironment = { os: "win", runtime: "desktop" };
const MAC_WEB: KeyEnvironment = { os: "mac", runtime: "web" };

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const last = <T,>(list: T[]): T | undefined => list[list.length - 1];

/** A fake Rust side: records syncs, delivers menu clicks, hands back a queue. */
function fakeHost(queued: string[] = []) {
  let menuHandler: ((id: string) => void) | null = null;
  let changeHandler: (() => void) | null = null;
  const syncs: MenuState[] = [];
  const unlisten = vi.fn(() => {
    menuHandler = null;
  });
  const unsubscribe = vi.fn(() => {
    changeHandler = null;
  });
  let language = "en";
  const checks: Record<string, boolean> = { "view.toggleInspector": false, "view.toggleMinimap": true };
  const host = {
    syncs,
    unlisten,
    unsubscribe,
    setLanguage: (lng: string) => {
      language = lng;
      changeHandler?.();
    },
    change: () => changeHandler?.(),
    click: (id: string) => menuHandler?.(id),
    isListening: () => menuHandler !== null,
  };
  const deps = (ctx: CommandContext, env: KeyEnvironment = MAC_DESKTOP): MenuBridgeDeps => ({
    env,
    getContext: () => ctx,
    getChecks: () => checks,
    getLanguage: () => language,
    sync: vi.fn(async (state: MenuState) => {
      syncs.push(state);
      return syncs.length === 1 ? queued : [];
    }),
    listen: async (handler) => {
      menuHandler = handler;
      return unlisten;
    },
    subscribe: (onChange) => {
      changeHandler = onChange;
      return unsubscribe;
    },
  });
  return { host, deps };
}

const stops: Array<() => void> = [];
afterEach(() => {
  while (stops.length) stops.pop()?.();
});

describe("menu manifest (D6)", () => {
  it("puts every frontend command in a menu, or names why not", () => {
    for (const entry of COMMAND_MANIFEST) {
      if (entry.menu === null) expect(entry.exceptionReason, entry.id).toBeTruthy();
    }
    expect(MENU_COMMAND_IDS.size).toBe(COMMAND_MANIFEST.filter((e) => e.menu !== null).length);
  });

  it("has a registry handler for every command the menu can send", () => {
    for (const id of MENU_COMMAND_IDS) {
      const command = COMMANDS.find((c) => c.id === id);
      expect(command, id).toBeDefined();
      expect(typeof command?.run, id).toBe("function");
    }
  });

  it("titles every menu entry, predefined ones included, with an existing English key", () => {
    for (const entry of raw.commands) {
      expect(en, entry.id).toHaveProperty([entry.labelKey]);
      if ("menuLabelKey" in entry && entry.menuLabelKey) expect(en, entry.id).toHaveProperty([entry.menuLabelKey]);
    }
    for (const menu of ["file", "edit", "view", "go", "window", "help"]) {
      expect(en, menu).toHaveProperty([`common.menu.${menu}`]);
    }
  });

  it("knows how to tick every toggle entry", () => {
    const toggles = COMMAND_MANIFEST.filter((e) => e.toggle).map((e) => e.id);
    expect(toggles.length).toBeGreaterThan(0);
    expect(Object.keys(MENU_CHECKS).sort()).toEqual([...toggles].sort());
  });

  it("places every app-menu entry somewhere on Windows and Linux", () => {
    for (const entry of [...COMMAND_MANIFEST, ...PREDEFINED_MENU_ITEMS]) {
      if (entry.menu === "app" && entry.id !== "app.services") {
        const platforms = "platforms" in entry ? entry.platforms : ["mac", "win", "linux"];
        if (platforms.some((p) => p !== "mac")) expect(entry.menuElsewhere, entry.id).toBeTruthy();
      }
    }
  });

  it("puts Back/Forward (⌘[ ⌘]), Claude Code Settings, Archive, Feedback, Updates and Settings… (⌘,) in menus (§6)", () => {
    const where = (id: string) => COMMAND_MANIFEST.find((e) => e.id === id);
    expect(where("go.back")).toMatchObject({ menu: "go", shortcut: { mac: "Cmd+[" } });
    expect(where("go.forward")).toMatchObject({ menu: "go", shortcut: { mac: "Cmd+]" } });
    expect(where("go.settingsManager")).toMatchObject({ menu: "go" });
    expect(en["common.command.openSettingsManager"]).toContain("Claude Code Settings");
    expect(where("go.archive")).toMatchObject({ menu: "go" });
    expect(where("help.feedback")).toMatchObject({ menu: "help" });
    expect(where("app.checkForUpdates")).toMatchObject({ menu: "app" });
    expect(where("app.preferences")).toMatchObject({ menu: "app", shortcut: { mac: "Cmd+," } });
  });

  it("binds no OS item's chord to an app command on any desktop", () => {
    for (const os of ["mac", "win", "linux"] as const) {
      const taken = new Map<string, string>();
      for (const entry of PREDEFINED_MENU_ITEMS) {
        const accelerator = entry.shortcut?.[os];
        if (accelerator && entry.platforms.includes(os)) taken.set(accelerator, entry.id);
      }
      for (const entry of COMMAND_MANIFEST) {
        const accelerator = entry.shortcut?.[os];
        if (accelerator) expect(taken.get(accelerator), `${entry.id} on ${os}`).toBeUndefined();
      }
    }
  });
});

describe("shortcut owner", () => {
  it("is the native menu in the Mac app, the DOM elsewhere until the smoke checklist passes", () => {
    expect(NATIVE_SHORTCUTS).toEqual({ mac: true, win: false, linux: false });
    expect(nativeShortcutsOwned(MAC_DESKTOP)).toBe(true);
    expect(nativeShortcutsOwned(WIN_DESKTOP)).toBe(false);
    expect(nativeShortcutsOwned({ os: "linux", runtime: "desktop" })).toBe(false);
    expect(nativeShortcutsOwned(MAC_WEB)).toBe(false);
  });
});

describe("menu state", () => {
  it("sends the language and each menu command's enabled and checked state", () => {
    const ctx = makeContext({ canGoBack: true, canGoForward: false });
    const state = computeMenuState(ctx, "ko", { "view.toggleInspector": true, "view.toggleMinimap": false });
    expect(state.language).toBe("ko");
    expect(Object.keys(state.items).sort()).toEqual([...MENU_COMMAND_IDS].sort());
    expect(state.items["go.back"]).toEqual({ enabled: true });
    expect(state.items["go.forward"]).toEqual({ enabled: false });
    expect(state.items["view.toggleInspector"]).toEqual({ enabled: true, checked: true });
    expect(state.items["view.toggleMinimap"]).toEqual({ enabled: true, checked: false });
  });
});

describe("menu bridge", () => {
  async function start(ctx = makeContext(), queued: string[] = [], env = MAC_DESKTOP) {
    const { host, deps } = fakeHost(queued);
    const bridge = startMenuBridge(deps(ctx, env));
    stops.push(() => bridge.stop());
    await flush();
    return { host, bridge, ctx };
  }

  it("listens before it tells the host it is ready, then runs what the host queued", async () => {
    const ctx = makeContext();
    const { host } = await start(ctx, ["palette.open", "no.such.command"]);
    expect(host.isListening()).toBe(true);
    expect(host.syncs).toHaveLength(1);
    expect(ctx.actions.openPalette).toHaveBeenCalledTimes(1);
  });

  it("runs a menu command once, through the registry's enabled check", async () => {
    const { host, ctx } = await start(makeContext({ canGoForward: false }));
    host.click("go.back");
    host.click("go.forward");
    host.click("no.such.command");
    expect(ctx.actions.goBack).toHaveBeenCalledTimes(1);
    expect(ctx.actions.goForward).not.toHaveBeenCalled();
  });

  it("runs a native shortcut once: the menu runs it and the DOM listener leaves the key alone", async () => {
    const ctx = makeContext({ canGoBack: true });
    const { host, bridge } = await start(ctx);
    const handler = createShortcutHandler({
      commands: COMMANDS,
      env: MAC_DESKTOP,
      getContext: () => ctx,
      ownedByNativeMenu: bridge.owns,
    });
    window.addEventListener("keydown", handler);
    stops.push(() => window.removeEventListener("keydown", handler));
    // macOS delivers ⌘[ to the web view first; unhandled, it reaches the menu.
    const event = new KeyboardEvent("keydown", { key: "[", code: "BracketLeft", metaKey: true, cancelable: true });
    window.dispatchEvent(event);
    if (!event.defaultPrevented) host.click("go.back");
    expect(ctx.actions.goBack).toHaveBeenCalledTimes(1);
  });

  it("gives the key back to the DOM listener while the native item is disabled", async () => {
    const ctx = makeContext({ canGoBack: false });
    const { host, bridge } = await start(ctx);
    expect(bridge.owns("go.back")).toBe(false);
    ctx.canGoBack = true;
    host.change();
    await flush();
    expect(last(host.syncs)?.items["go.back"]).toEqual({ enabled: true });
    expect(bridge.owns("go.back")).toBe(true);
  });

  it("owns nothing outside the Mac app", async () => {
    const { bridge } = await start(makeContext(), [], WIN_DESKTOP);
    expect(bridge.owns("go.back")).toBe(false);
    expect(bridge.owns("palette.open")).toBe(false);
  });

  it("owns no command without a shortcut", async () => {
    const { bridge } = await start();
    expect(bridge.owns("go.settingsManager")).toBe(false);
  });

  it("re-sends the state with the new language when the language changes", async () => {
    const { host } = await start();
    host.setLanguage("ja");
    await flush();
    expect(last(host.syncs)?.language).toBe("ja");
  });

  it("does not re-send an unchanged state", async () => {
    const { host } = await start();
    host.change();
    host.change();
    await flush();
    expect(host.syncs).toHaveLength(1);
  });

  it("coalesces a burst of changes into one sync", async () => {
    const ctx = makeContext({ canGoBack: false });
    const { host } = await start(ctx);
    ctx.canGoBack = true;
    host.change();
    host.change();
    host.setLanguage("ko");
    await flush();
    expect(host.syncs).toHaveLength(2);
  });

  it("stops listening and syncing when stopped", async () => {
    const { host, bridge } = await start();
    bridge.stop();
    expect(host.unlisten).toHaveBeenCalledTimes(1);
    expect(host.unsubscribe).toHaveBeenCalledTimes(1);
    host.setLanguage("ko");
    await flush();
    expect(host.syncs).toHaveLength(1);
  });

  it("drops the listener that resolves after a stop", async () => {
    const { host, deps } = fakeHost();
    const bridge = startMenuBridge(deps(makeContext()));
    bridge.stop();
    await flush();
    expect(host.unlisten).toHaveBeenCalledTimes(1);
    expect(host.syncs).toHaveLength(0);
  });
});
