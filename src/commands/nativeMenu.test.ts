/**
 * The desktop's native-menu bridge (plan §4.4, T11a): the menu the Rust side
 * builds from the manifest runs the same registry commands through the menu
 * journal, and shows the app's language and command state. The state is only
 * shown: no key and no menu event depends on it (the page owns every app key,
 * `shortcuts.ts`; ordering and delivery are the journal's, `menuJournal.ts`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import raw from "./manifest.json";
import { COMMAND_MANIFEST, MENU_ACCELERATORS, PREDEFINED_MENU_ITEMS } from "./manifest";
import { COMMANDS, type CommandActions, type CommandContext } from "./registry";
import { createShortcutHandler, menuCarriesAppKeys } from "./shortcuts";
import type { KeyEnvironment } from "./keys";
import { memoryCursorStore, type LiveMenuEvent, type MenuJournalSnapshot } from "./menuJournal";
import {
  MENU_CHECKS,
  MENU_COMMAND_IDS,
  computeMenuState,
  startMenuBridge,
  type MenuBridgeDeps,
  type MenuState,
} from "./nativeMenu";
import en from "@/i18n/locales/en/common.json";

/** `n` open tabs t1…tn, the first in front. */
const tabsOf = (n: number) => ({ activeId: "t1", ids: Array.from({ length: n }, (_, i) => `t${i + 1}`) });

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
    selectTab: vi.fn(),
    zoom: vi.fn(),
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
    tabs: tabsOf(3),
    ownPlace: () => () => true,
    actions,
    ...overrides,
  };
}

const MAC_DESKTOP: KeyEnvironment = { os: "mac", runtime: "desktop" };
const WIN_DESKTOP: KeyEnvironment = { os: "win", runtime: "desktop" };
const LINUX_DESKTOP: KeyEnvironment = { os: "linux", runtime: "desktop" };
const MAC_WEB: KeyEnvironment = { os: "mac", runtime: "web" };

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const last = <T,>(list: T[]): T | undefined => list[list.length - 1];

/**
 * A fake Rust side. `sync` replies when the test says so; the native menu is
 * modelled as the state the host *applied*, which the test may apply before
 * the reply is delivered (review-2 A1). Menu events go through a journal
 * like `journal.rs`: numbered, kept until acknowledged.
 */
function fakeHost(
  ctx: CommandContext,
  options: {
    retryDelaysMs?: number[];
    onSyncError?: (e: unknown) => void;
    /** The first this-many listener registrations fail. */
    failListens?: number;
    onListenError?: (e: unknown) => void;
  } = {},
) {
  let failListens = options.failListens ?? 0;
  const listenCalls = { count: 0 };
  let listener: ((event: LiveMenuEvent) => void) | null = null;
  let changeHandler: (() => void) | null = null;
  let language = "en";
  let seq = 0;
  let retained: { seq: number; id: string; frontTabId: string | null }[] = [];
  /** The front tab the page last reported: what `journal.rs` stamps each event with. */
  let front: string | null = null;
  const syncs: MenuState[] = [];
  const pending: Array<{ state: MenuState; apply: () => void; reply: () => void; resolve: () => void; reject: (e: unknown) => void }> = [];
  let native: MenuState | null = null;
  const unlisten = vi.fn(() => {
    listener = null;
  });
  const unsubscribe = vi.fn(() => {
    changeHandler = null;
  });
  const deps: MenuBridgeDeps = {
    getContext: () => ctx,
    getChecks: () => ({ "view.toggleInspector": false, "view.toggleMinimap": true }),
    getLanguage: () => language,
    sync: (state) =>
      new Promise<void>((resolve, reject) => {
        syncs.push(state);
        front = state.frontTabId ?? null; // taken when the host receives it, before it replies
        const entry = {
          state,
          apply: () => {
            native = state;
          },
          reply: () => resolve(),
          resolve: () => {
            native = state;
            resolve();
          },
          reject,
        };
        pending.push(entry);
      }),
    listen: async (handler) => {
      listenCalls.count += 1;
      if (failListens > 0) {
        failListens -= 1;
        throw new Error("injected listen failure");
      }
      listener = handler;
      return unlisten;
    },
    pullEvents: async (): Promise<MenuJournalSnapshot> => ({ epoch: "e", floor: 0, events: retained.map((e) => ({ ...e })) }),
    ackEvents: async (_epoch, upTo) => {
      retained = retained.filter((e) => e.seq > upTo);
    },
    cursor: memoryCursorStore(),
    subscribe: (onChange) => {
      changeHandler = onChange;
      return unsubscribe;
    },
    retryDelaysMs: options.retryDelaysMs ?? [0, 0],
    onSyncError: options.onSyncError,
    onListenError: options.onListenError,
  };
  const bridge = startMenuBridge(deps);
  stops.push(() => bridge.stop());
  /** A menu click or accelerator: journaled, then emitted. */
  const choose = (id: string) => {
    seq += 1;
    retained.push({ seq, id, frontTabId: front });
    listener?.({ epoch: "e", seq, id, frontTabId: front });
  };
  const keyHandler = createShortcutHandler({ commands: COMMANDS, env: MAC_DESKTOP, getContext: () => ctx });
  /** macOS order (docs/adr/0001-native-menu-input-ownership.md): the page first; a key it leaves goes to the item, if the native item is enabled. */
  const press = (init: KeyboardEventInit, id: string) => {
    const event = new KeyboardEvent("keydown", { ...init, cancelable: true });
    keyHandler(event);
    if (!event.defaultPrevented && native?.items[id]?.enabled !== false) choose(id);
    return event;
  };
  return {
    bridge,
    listenCalls,
    syncs,
    pending,
    unlisten,
    unsubscribe,
    press,
    choose,
    native: () => native,
    change: () => changeHandler?.(),
    setLanguage: (lng: string) => {
      language = lng;
      changeHandler?.();
    },
    /** Answer every pending sync, in order. */
    settle: async () => {
      while (pending.length) {
        pending.shift()?.resolve();
        await flush();
      }
    },
  };
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

describe("menu accelerators", () => {
  it("are on the Mac app's items only; the page owns the keys everywhere and claims them where items carry them", () => {
    expect(MENU_ACCELERATORS).toEqual({ mac: true, win: false, linux: false });
    expect(menuCarriesAppKeys(MAC_DESKTOP)).toBe(true);
    expect(menuCarriesAppKeys(WIN_DESKTOP)).toBe(false);
    expect(menuCarriesAppKeys(LINUX_DESKTOP)).toBe(false);
    expect(menuCarriesAppKeys(MAC_WEB)).toBe(false);
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

  it("reports the tab in front, which the host stamps on every menu event (review-5 F2)", () => {
    const ctx = makeContext({ tabs: { activeId: "t2", ids: ["t1", "t2"] } });
    expect(computeMenuState(ctx, "en", {}).frontTabId).toBe("t2");
  });
});

describe("menu bridge", () => {
  it("runs a menu command once, through the registry's enabled check", async () => {
    const ctx = makeContext({ canGoForward: false });
    const host = fakeHost(ctx);
    await flush();
    host.choose("go.back");
    host.choose("go.forward");
    host.choose("no.such.command");
    await flush();
    expect(ctx.actions.goBack).toHaveBeenCalledTimes(1);
    expect(ctx.actions.goForward).not.toHaveBeenCalled();
  });

  it("runs menu events chosen before it started, oldest first", async () => {
    const log: string[] = [];
    const ctx = loggingContext(log);
    const host = fakeHost(ctx);
    host.choose("tab.new"); // not heard: the listener attaches asynchronously
    host.choose("tab.close");
    await flush();
    await flush();
    expect(log).toEqual(["newTab", "closeTab"]);
  });

  it("retries a listener that failed to attach, tells the user once, then runs the menu commands kept meanwhile in order (review-3 F3)", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const log: string[] = [];
      const onListenError = vi.fn();
      const host = fakeHost(loggingContext(log), { failListens: 3, onListenError, retryDelaysMs: [100, 200] });
      await vi.advanceTimersByTimeAsync(0);
      host.choose("tab.new"); // retained by the host; nobody hears it
      host.choose("tab.close");
      await vi.advanceTimersByTimeAsync(300);
      expect(onListenError).toHaveBeenCalledTimes(1);
      expect(log).toEqual([]);
      await vi.advanceTimersByTimeAsync(200);
      expect(host.listenCalls.count).toBe(4);
      expect(log).toEqual(["newTab", "closeTab"]);
      host.choose("tab.new");
      await vi.advanceTimersByTimeAsync(0);
      expect(log).toEqual(["newTab", "closeTab", "newTab"]);
      expect(onListenError).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
      vi.useRealTimers();
    }
  });

  it("sends the language and state at start, and again when the language changes", async () => {
    const host = fakeHost(makeContext());
    expect(host.syncs).toHaveLength(1);
    await host.settle();
    host.setLanguage("ja");
    await flush();
    expect(last(host.syncs)?.language).toBe("ja");
  });

  it("does not re-send an unchanged state", async () => {
    const host = fakeHost(makeContext());
    await host.settle();
    host.change();
    host.change();
    await flush();
    expect(host.syncs).toHaveLength(1);
  });

  it("coalesces a burst of changes into one sync", async () => {
    const ctx = makeContext({ canGoBack: false });
    const host = fakeHost(ctx);
    await host.settle();
    ctx.canGoBack = true;
    host.change();
    host.change();
    host.setLanguage("ko");
    await flush();
    expect(host.syncs).toHaveLength(2);
  });

  it("keeps one sync in flight and sends the newest state after it, never an older one", async () => {
    const ctx = makeContext({ canGoBack: false });
    const host = fakeHost(ctx);
    await flush();
    ctx.canGoBack = true;
    host.change();
    await flush();
    ctx.canGoBack = false;
    ctx.canGoForward = true;
    host.change();
    await flush();
    expect(host.pending).toHaveLength(1);
    host.pending.shift()?.resolve();
    await flush();
    expect(host.pending).toHaveLength(1);
    expect(host.pending[0]?.state.items["go.back"]).toEqual({ enabled: false });
    expect(host.pending[0]?.state.items["go.forward"]).toEqual({ enabled: true });
  });

  it("retries a failed sync, then stops after its backoff, reports once, and syncs again on the next change", async () => {
    const onSyncError = vi.fn();
    const host = fakeHost(makeContext(), { retryDelaysMs: [0, 0], onSyncError });
    for (let attempt = 0; attempt < 3; attempt++) {
      await flush();
      expect(host.pending, `attempt ${attempt}`).toHaveLength(1);
      host.pending.shift()?.reject(new Error("down"));
      await flush();
    }
    await flush();
    expect(host.pending).toHaveLength(0);
    expect(onSyncError).toHaveBeenCalledTimes(1);
    host.change();
    await flush();
    expect(host.pending).toHaveLength(1);
  });

  it("sends a front-tab change at once, in the same task, though nothing else changed (review-5 F2)", async () => {
    const ctx = makeContext();
    const host = fakeHost(ctx);
    await host.settle();
    ctx.tabs = { ...ctx.tabs, activeId: "t2" };
    host.change();
    expect(host.syncs).toHaveLength(2); // no timer
    expect(last(host.syncs)?.frontTabId).toBe("t2");
    expect(last(host.syncs)?.items).toEqual(host.syncs[0]?.items);
  });

  it("never drops the newest front tab: a change made while a sync is in flight goes right after its reply", async () => {
    const ctx = makeContext();
    const host = fakeHost(ctx);
    expect(host.pending).toHaveLength(1); // t1, in flight
    ctx.tabs = { ...ctx.tabs, activeId: "t2" };
    host.change();
    ctx.tabs = { ...ctx.tabs, activeId: "t3" };
    host.change();
    expect(host.pending).toHaveLength(1); // one in flight at a time
    host.pending.shift()?.resolve();
    await flush();
    expect(host.pending.map((p) => p.state.frontTabId)).toEqual(["t3"]);
  });

  it("a front-tab change sends again after a failed sync, without waiting for its backoff", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const ctx = makeContext();
      const host = fakeHost(ctx, { retryDelaysMs: [1000] });
      host.pending.shift()?.reject(new Error("down"));
      await vi.advanceTimersByTimeAsync(0);
      ctx.tabs = { ...ctx.tabs, activeId: "t2" };
      host.change();
      expect(last(host.syncs)?.frontTabId).toBe("t2");
    } finally {
      error.mockRestore();
      vi.useRealTimers();
    }
  });

  it("a menu event carries the front tab the host last received: a later click does not retarget it", async () => {
    const ctx = makeContext({ tabs: { activeId: "t1", ids: ["t1", "t2"] } });
    const host = fakeHost(ctx);
    await host.settle();
    host.choose("tab.close"); // chosen with t1 in front
    await flush();
    expect(ctx.actions.closeTab).toHaveBeenCalledWith("t1");
  });

  it("stops listening and syncing when stopped", async () => {
    const host = fakeHost(makeContext());
    await host.settle();
    host.bridge.stop();
    expect(host.unlisten).toHaveBeenCalledTimes(1);
    expect(host.unsubscribe).toHaveBeenCalledTimes(1);
    host.setLanguage("ko");
    await flush();
    expect(host.syncs).toHaveLength(1);
  });
});

/** A context whose actions log their names, in call order. */
function loggingContext(log: string[]): CommandContext {
  const ctx = makeContext({ tabs: tabsOf(2 )});
  ctx.actions = new Proxy(ctx.actions, {
    get: (_target, name) => () => {
      log.push(String(name));
    },
  }) as CommandActions;
  return ctx;
}

const BACK_KEY: KeyboardEventInit = { key: "[", code: "BracketLeft", metaKey: true };

/**
 * The races of the earlier "native owns the key while acknowledged enabled"
 * design, replayed against the fixed owner: each press of an enabled command
 * runs once, whatever the menu state is doing.
 */
describe("no key depends on the menu state (review R1, review-2 A1)", () => {
  it("runs ⌘[ once while an enable is still on its way to the native item (R1)", async () => {
    const ctx = makeContext({ canGoBack: false });
    const host = fakeHost(ctx);
    await host.settle();
    expect(host.native()?.items["go.back"]).toEqual({ enabled: false });
    ctx.canGoBack = true;
    host.change();
    await flush();
    expect(host.pending).toHaveLength(1); // held: the native item is still disabled
    host.press(BACK_KEY, "go.back");
    expect(ctx.actions.goBack).toHaveBeenCalledTimes(1);
  });

  it("runs ⌘[ once after a failed sync, with no retry yet (R1)", async () => {
    const ctx = makeContext({ canGoBack: false });
    const host = fakeHost(ctx, { retryDelaysMs: [] });
    await host.settle();
    ctx.canGoBack = true;
    host.change();
    await flush();
    host.pending.shift()?.reject(new Error("injected IPC failure"));
    await flush();
    host.press(BACK_KEY, "go.back");
    expect(ctx.actions.goBack).toHaveBeenCalledTimes(1);
  });

  it("runs ⌘[ once when a disable was applied natively but its reply is still on its way, and Back is enabled again (A1)", async () => {
    const ctx = makeContext({ canGoBack: true });
    const host = fakeHost(ctx);
    await host.settle();
    ctx.canGoBack = false;
    host.change();
    await flush();
    const disabling = host.pending.shift();
    disabling?.apply(); // the native item is now disabled; the reply is held in transport
    expect(host.native()?.items["go.back"]).toEqual({ enabled: false });
    ctx.canGoBack = true;
    host.change();
    await flush();
    host.press(BACK_KEY, "go.back");
    expect(ctx.actions.goBack).toHaveBeenCalledTimes(1);
    disabling?.reply();
    await flush();
  });

  it("runs every press exactly once (or never when disabled) across enable/disable/failure transitions", async () => {
    const ctx = makeContext({ canGoBack: false });
    const host = fakeHost(ctx, { retryDelaysMs: [] });
    const expectOnePressRuns = (label: string) => {
      const before = vi.mocked(ctx.actions.goBack).mock.calls.length;
      host.press(BACK_KEY, "go.back");
      expect(vi.mocked(ctx.actions.goBack).mock.calls.length - before, label).toBe(ctx.canGoBack ? 1 : 0);
    };
    await flush();
    expectOnePressRuns("before the first reply");
    await host.settle();
    for (const enabled of [true, false, true, false]) {
      ctx.canGoBack = enabled;
      host.change();
      await flush();
      expectOnePressRuns(`pending ${enabled}`);
      host.pending[0]?.apply();
      expectOnePressRuns(`applied, reply pending ${enabled}`);
      ctx.canGoBack = !enabled;
      expectOnePressRuns(`applied, context flipped ${enabled}`);
      ctx.canGoBack = enabled;
      await host.settle();
      expectOnePressRuns(`acknowledged ${enabled}`);
    }
    for (const enabled of [true, false]) {
      ctx.canGoBack = enabled;
      host.change();
      await flush();
      host.pending.shift()?.reject(new Error("down"));
      await flush();
      expectOnePressRuns(`after a failed sync ${enabled}`);
    }
  });
});

describe("View → Zoom (§9b A1)", () => {
  const ZOOM_IDS = ["view.zoomIn", "view.zoomOut", "view.actualSize"] as const;

  it("lists Zoom In ⌘=, Zoom Out ⌘- and Actual Size ⌘0 in the View menu, on every desktop", () => {
    const view = COMMAND_MANIFEST.filter((e) => e.menu === "view").map((e) => e.id);
    expect(view).toEqual(["view.toggleInspector", "view.toggleMinimap", ...ZOOM_IDS]);
    const where = (id: string) => COMMAND_MANIFEST.find((e) => e.id === id);
    expect(where("view.zoomIn")).toMatchObject({ shortcut: { mac: "Cmd+=", win: "Ctrl+=", linux: "Ctrl+=" } });
    expect(where("view.zoomOut")).toMatchObject({ shortcut: { mac: "Cmd+-", win: "Ctrl+-", linux: "Ctrl+-" } });
    expect(where("view.actualSize")).toMatchObject({ shortcut: { mac: "Cmd+0", win: "Ctrl+0", linux: "Ctrl+0" } });
    for (const id of ZOOM_IDS) expect(MENU_COMMAND_IDS.has(id), id).toBe(true);
  });

  it("keeps the engine's zoom hotkeys off on macOS/Linux and on on Windows (WebView2 pinch, review-2 F4)", async () => {
    const conf = (await import("../../src-tauri/tauri.conf.json")).default;
    const onWindows = (await import("../../src-tauri/tauri.windows.conf.json")).default;
    expect(conf.app.windows.map((w: { zoomHotkeysEnabled?: boolean }) => w.zoomHotkeysEnabled)).toEqual([false]);
    expect(onWindows.app.windows.map((w: { zoomHotkeysEnabled?: boolean }) => w.zoomHotkeysEnabled)).toEqual([true]);
  });

  function pressAll(env: KeyEnvironment, ctx = makeContext()) {
    const handler = createShortcutHandler({ commands: COMMANDS, env, getContext: () => ctx });
    const prevented = [
      { key: "=", code: "Equal" },
      { key: "+", code: "Equal", shiftKey: true },
      { key: "-", code: "Minus" },
      { key: "0", code: "Digit0" },
    ].map((init) => {
      const modifier = env.os === "mac" ? { metaKey: true } : { ctrlKey: true };
      const event = new KeyboardEvent("keydown", { ...init, ...modifier, cancelable: true });
      handler(event);
      return event.defaultPrevented;
    });
    return { ctx, prevented };
  }

  it("runs ⌘= ⌘+ ⌘- ⌘0 once each in the Mac app and Ctrl+… once each on Linux, by the page", () => {
    for (const env of [MAC_DESKTOP, LINUX_DESKTOP]) {
      const { ctx, prevented } = pressAll(env);
      expect(prevented, env.os).toEqual([true, true, true, true]);
      expect(vi.mocked(ctx.actions.zoom).mock.calls, env.os).toEqual([["in"], ["in"], ["out"], ["reset"]]);
    }
  });

  it("leaves Ctrl+= Ctrl++ Ctrl+- Ctrl+0 to WebView2 on Windows, where the menu items still zoom", async () => {
    const { ctx, prevented } = pressAll(WIN_DESKTOP);
    expect(prevented).toEqual([false, false, false, false]);
    expect(ctx.actions.zoom).not.toHaveBeenCalled();
    const host = fakeHost(ctx);
    await flush();
    host.choose("view.zoomIn");
    host.choose("view.actualSize");
    await flush();
    expect(vi.mocked(ctx.actions.zoom).mock.calls).toEqual([["in"], ["reset"]]);
  });

  it("leaves ⌘= ⌘- ⌘0 to the browser's own zoom in the WebUI", () => {
    const { ctx, prevented } = pressAll(MAC_WEB, makeContext({ runtime: "web" }));
    expect(prevented).toEqual([false, false, false, false]);
    expect(ctx.actions.zoom).not.toHaveBeenCalled();
  });
});
