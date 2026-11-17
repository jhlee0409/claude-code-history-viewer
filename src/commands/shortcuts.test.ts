import { afterEach, describe, expect, it, vi } from "vitest";
import { createShortcutHandler } from "./shortcuts";
import { COMMANDS, isCommandEnabled, runCommand, type CommandActions, type CommandContext } from "./registry";
import { parseAccelerator, shortcutFor, type KeyEnvironment } from "./keys";

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
    canGoForward: true,
    hasFindTarget: true,
    tabs: tabsOf(3),
    ownPlace: () => () => true,
    actions,
    ...overrides,
  };
}

function setup(env: KeyEnvironment, ctx = makeContext()) {
  const handler = createShortcutHandler({ commands: COMMANDS, env, getContext: () => ctx });
  window.addEventListener("keydown", handler);
  cleanups.push(() => window.removeEventListener("keydown", handler));
  return ctx;
}

const cleanups: Array<() => void> = [];

const press = (init: KeyboardEventInit, target: EventTarget = window) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

const MAC_DESKTOP: KeyEnvironment = { os: "mac", runtime: "desktop" };
const WIN_DESKTOP: KeyEnvironment = { os: "win", runtime: "desktop" };
const MAC_WEB: KeyEnvironment = { os: "mac", runtime: "web" };
const LINUX_DESKTOP: KeyEnvironment = { os: "linux", runtime: "desktop" };

/** The keydown a chord types (US layout). */
function keyInit(accelerator: string, env: KeyEnvironment): KeyboardEventInit {
  const chord = parseAccelerator(accelerator, env.os);
  const codes: Record<string, string> = { "[": "BracketLeft", "]": "BracketRight", ",": "Comma", "=": "Equal", "-": "Minus" };
  const code = /^[a-z]$/.test(chord.key)
    ? `Key${chord.key.toUpperCase()}`
    : /^[0-9]$/.test(chord.key)
      ? `Digit${chord.key}`
      : (codes[chord.key] ?? chord.key);
  return { key: chord.key, code, metaKey: chord.meta, ctrlKey: chord.ctrl, altKey: chord.alt, shiftKey: chord.shift };
}

const actionCalls = (ctx: CommandContext): number =>
  Object.values(ctx.actions).reduce((n, fn) => n + (fn as ReturnType<typeof vi.fn>).mock.calls.length, 0);

describe("shortcut handler", () => {
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
    document.body.innerHTML = "";
  });

  describe("platform mapping", () => {
    it("uses ⌘[ ⌘] for back/forward in the Mac app", () => {
      const ctx = setup(MAC_DESKTOP);
      press({ key: "[", code: "BracketLeft", metaKey: true });
      press({ key: "]", code: "BracketRight", metaKey: true });
      expect(ctx.actions.goBack).toHaveBeenCalledTimes(1);
      expect(ctx.actions.goForward).toHaveBeenCalledTimes(1);
    });

    it("ignores Ctrl in place of ⌘ on macOS", () => {
      const ctx = setup(MAC_DESKTOP);
      press({ key: "k", code: "KeyK", ctrlKey: true });
      press({ key: "[", code: "BracketLeft", ctrlKey: true });
      expect(ctx.actions.openPalette).not.toHaveBeenCalled();
      expect(ctx.actions.goBack).not.toHaveBeenCalled();
    });

    it("uses Ctrl and Alt+Arrow on Windows", () => {
      const ctx = setup(WIN_DESKTOP);
      press({ key: "k", code: "KeyK", ctrlKey: true });
      press({ key: "k", code: "KeyK", metaKey: true });
      press({ key: "ArrowLeft", altKey: true });
      expect(ctx.actions.openPalette).toHaveBeenCalledTimes(1);
      expect(ctx.actions.goBack).toHaveBeenCalledTimes(1);
    });
  });

  describe("WebUI fallback keys", () => {
    it("leaves ⌘[ ⌘] to the browser and takes ⌥←→ instead", () => {
      const ctx = setup(MAC_WEB);
      const browserBack = press({ key: "[", code: "BracketLeft", metaKey: true });
      expect(browserBack.defaultPrevented).toBe(false);
      expect(ctx.actions.goBack).not.toHaveBeenCalled();
      press({ key: "ArrowLeft", code: "ArrowLeft", altKey: true });
      press({ key: "ArrowRight", code: "ArrowRight", altKey: true });
      expect(ctx.actions.goBack).toHaveBeenCalledTimes(1);
      expect(ctx.actions.goForward).toHaveBeenCalledTimes(1);
    });

    it("keeps ⌘K and ⌘F on macOS browsers", () => {
      const ctx = setup(MAC_WEB);
      press({ key: "k", code: "KeyK", metaKey: true });
      press({ key: "f", code: "KeyF", metaKey: true });
      expect(ctx.actions.openPalette).toHaveBeenCalledTimes(1);
      expect(ctx.actions.focusFind).toHaveBeenCalledTimes(1);
    });
  });

  describe("focus and composition", () => {
    it("ignores every shortcut while an IME is composing", () => {
      const ctx = setup(LINUX_DESKTOP);
      press({ key: "k", code: "KeyK", ctrlKey: true, isComposing: true });
      press({ key: "f", code: "KeyF", ctrlKey: true, keyCode: 229 } as KeyboardEventInit);
      expect(ctx.actions.openPalette).not.toHaveBeenCalled();
      expect(ctx.actions.focusFind).not.toHaveBeenCalled();
      cleanups.pop()?.();
      setup(MAC_DESKTOP, ctx);
      press({ key: "k", code: "KeyK", metaKey: true, isComposing: true });
      press({ key: "f", code: "KeyF", metaKey: true, keyCode: 229 } as KeyboardEventInit);
      expect(ctx.actions.openPalette).not.toHaveBeenCalled();
      expect(ctx.actions.focusFind).not.toHaveBeenCalled();
    });

    it("leaves Alt+Arrow to a text field (word movement)", () => {
      const ctx = setup(WIN_DESKTOP);
      const input = document.body.appendChild(document.createElement("input"));
      const event = press({ key: "ArrowLeft", altKey: true }, input);
      expect(ctx.actions.goBack).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it("lets ⌘F and ⌘K through from a text field, as intended", () => {
      const ctx = setup(MAC_DESKTOP);
      const input = document.body.appendChild(document.createElement("textarea"));
      press({ key: "f", code: "KeyF", metaKey: true }, input);
      press({ key: "k", code: "KeyK", metaKey: true }, input);
      expect(ctx.actions.focusFind).toHaveBeenCalledTimes(1);
      expect(ctx.actions.openPalette).toHaveBeenCalledTimes(1);
    });

    it("does not navigate behind a modal dialog", () => {
      const ctx = setup(MAC_DESKTOP);
      const dialog = document.body.appendChild(document.createElement("div"));
      dialog.setAttribute("role", "dialog");
      const button = dialog.appendChild(document.createElement("button"));
      press({ key: "[", code: "BracketLeft", metaKey: true }, button);
      press({ key: "f", code: "KeyF", metaKey: true }, button);
      expect(ctx.actions.goBack).not.toHaveBeenCalled();
      expect(ctx.actions.focusFind).not.toHaveBeenCalled();
    });
  });

  /**
   * The WebUI's tab keys are ⌥+letter/digit. On macOS ⌥ types a character
   * (⌥W `∑`, ⌥T `†`, ⌥1 `¡`) or starts a dead key (⌥E, ⌥U), and ⌥⇧← → select
   * by word: in a text field these are typing, never tab commands. Outside
   * text fields the physical key still runs the command.
   */
  describe("WebUI ⌥ tab keys and text entry (T8 review #3)", () => {
    const fields = () => {
      const input = document.body.appendChild(document.createElement("input"));
      const area = document.body.appendChild(document.createElement("textarea"));
      const editable = document.body.appendChild(document.createElement("div"));
      editable.setAttribute("contenteditable", "true");
      const inner = editable.appendChild(document.createElement("span"));
      return [input, area, editable, inner];
    };

    it("leaves ⌥W ⌥T ⌥1 and ⌥⇧→ to an input, a textarea and contenteditable", () => {
      const ctx = setup(MAC_WEB);
      for (const field of fields()) {
        const events = [
          press({ key: "∑", code: "KeyW", altKey: true }, field),
          press({ key: "†", code: "KeyT", altKey: true }, field),
          press({ key: "¡", code: "Digit1", altKey: true }, field),
          press({ key: "ArrowRight", code: "ArrowRight", altKey: true, shiftKey: true }, field),
        ];
        expect(events.map((e) => e.defaultPrevented)).toEqual([false, false, false, false]);
      }
      expect(ctx.actions.closeTab).not.toHaveBeenCalled();
      expect(ctx.actions.newTab).not.toHaveBeenCalled();
      expect(ctx.actions.selectTab).not.toHaveBeenCalled();
      expect(ctx.actions.cycleTab).not.toHaveBeenCalled();
    });

    it("dead keys ⌥E and ⌥U and the composed letter after them run nothing, in a field or not", () => {
      const ctx = setup(MAC_WEB);
      const [input] = fields();
      for (const target of [input!, window]) {
        for (const code of ["KeyE", "KeyU"]) {
          const dead = press({ key: "Dead", code, altKey: true }, target);
          const composed = press({ key: "é", code: "KeyE", isComposing: true }, target);
          expect([dead.defaultPrevented, composed.defaultPrevented]).toEqual([false, false]);
        }
      }
      const calls = Object.values(ctx.actions).reduce((n, fn) => n + (fn as ReturnType<typeof vi.fn>).mock.calls.length, 0);
      expect(calls).toBe(0);
    });

    it("composing ⌥W does not close the tab", () => {
      const ctx = setup(MAC_WEB);
      press({ key: "∑", code: "KeyW", altKey: true, isComposing: true });
      expect(ctx.actions.closeTab).not.toHaveBeenCalled();
    });

    it("outside text fields ⌥W ⌥T ⌥2 still run by their physical key", () => {
      const ctx = setup(MAC_WEB);
      const button = document.body.appendChild(document.createElement("button"));
      expect(press({ key: "∑", code: "KeyW", altKey: true }, button).defaultPrevented).toBe(true);
      press({ key: "†", code: "KeyT", altKey: true }, button);
      press({ key: "™", code: "Digit2", altKey: true });
      expect(ctx.actions.closeTab).toHaveBeenCalledTimes(1);
      expect(ctx.actions.newTab).toHaveBeenCalledTimes(1);
      expect(ctx.actions.selectTab).toHaveBeenCalledWith("t2");
    });

    it("the desktop's ⌘W ⌘T ⌘1 still work from a text field, as in a browser", () => {
      const ctx = setup(MAC_DESKTOP);
      const [input] = fields();
      press({ key: "w", code: "KeyW", metaKey: true }, input);
      press({ key: "t", code: "KeyT", metaKey: true }, input);
      press({ key: "1", code: "Digit1", metaKey: true }, input);
      expect(ctx.actions.closeTab).toHaveBeenCalledTimes(1);
      expect(ctx.actions.newTab).toHaveBeenCalledTimes(1);
      expect(ctx.actions.selectTab).toHaveBeenCalledWith("t1");
    });
  });

  describe("single execution", () => {
    it("runs once when two listeners are installed", () => {
      const ctx = makeContext();
      setup(MAC_DESKTOP, ctx);
      setup(MAC_DESKTOP, ctx);
      press({ key: "k", code: "KeyK", metaKey: true });
      expect(ctx.actions.openPalette).toHaveBeenCalledTimes(1);
    });

    it("leaves a key another handler already took", () => {
      const ctx = setup(MAC_DESKTOP);
      const event = new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: true, cancelable: true });
      event.preventDefault();
      window.dispatchEvent(event);
      expect(ctx.actions.openPalette).not.toHaveBeenCalled();
    });

    it("binds no zoom key on Windows: WebView2 zooms (and pinches) itself there", () => {
      const ctx = setup(WIN_DESKTOP);
      for (const init of [
        { key: "=", code: "Equal", ctrlKey: true },
        { key: "+", code: "Equal", ctrlKey: true, shiftKey: true },
        { key: "-", code: "Minus", ctrlKey: true },
        { key: "0", code: "Digit0", ctrlKey: true },
      ]) {
        expect(press(init).defaultPrevented, init.key).toBe(false);
      }
      expect(ctx.actions.zoom).not.toHaveBeenCalled();
      press({ key: "k", code: "KeyK", ctrlKey: true });
      expect(ctx.actions.openPalette).toHaveBeenCalledTimes(1);
    });

    it("runs Ctrl+= Ctrl++ Ctrl+- Ctrl+0 once each on Linux (the zoom commands own zoom there)", () => {
      const ctx = setup(LINUX_DESKTOP);
      press({ key: "=", code: "Equal", ctrlKey: true });
      press({ key: "+", code: "Equal", ctrlKey: true, shiftKey: true });
      press({ key: "-", code: "Minus", ctrlKey: true });
      press({ key: "0", code: "Digit0", ctrlKey: true });
      expect(vi.mocked(ctx.actions.zoom).mock.calls).toEqual([["in"], ["in"], ["out"], ["reset"]]);
    });
  });

  /**
   * The Mac app's menu items carry the same keys. Measured in the real app
   * (docs/adr/0001-native-menu-input-ownership.md): the web view sees a ⌘ key before the
   * menu, and a key the page prevents never runs the menu item. So the page
   * owns every app key outright and claims (prevents) each one it matches,
   * run or not: no key depends on the native item's enabled state, which is
   * only ever an asynchronous copy (review R1, review-2 A1).
   */
  describe("the page owns every app key; in the Mac app it claims each one", () => {
    it("claims a key it does not run - command disabled, in a field or dialog it skips, composing", () => {
      const ctx = setup(MAC_DESKTOP, makeContext({ canGoBack: false }));
      const input = document.body.appendChild(document.createElement("input"));
      const dialog = document.body.appendChild(document.createElement("div"));
      dialog.setAttribute("role", "dialog");
      const inDialog = dialog.appendChild(document.createElement("input"));
      expect(press({ key: "[", code: "BracketLeft", metaKey: true }).defaultPrevented).toBe(true);
      ctx.canGoBack = true;
      expect(press({ key: "[", code: "BracketLeft", metaKey: true }, input).defaultPrevented).toBe(true);
      expect(press({ key: "t", code: "KeyT", metaKey: true }, inDialog).defaultPrevented).toBe(true);
      expect(press({ key: "k", code: "KeyK", metaKey: true, isComposing: true }).defaultPrevented).toBe(true);
      expect(actionCalls(ctx)).toBe(0);
    });

    it("leaves keys it does not run to the browser in the WebUI and to the web view on Windows/Linux", () => {
      for (const env of [MAC_WEB, WIN_DESKTOP, LINUX_DESKTOP]) {
        const ctx = setup(env, makeContext({ canGoBack: false, canGoForward: false, tabs: tabsOf(1 )}));
        const key = env.runtime === "web" ? { key: "ArrowLeft", code: "ArrowLeft", altKey: true } : { key: "ArrowLeft", altKey: true };
        expect(press(key).defaultPrevented, `${env.os}/${env.runtime}`).toBe(false);
        expect(actionCalls(ctx)).toBe(0);
        while (cleanups.length) cleanups.pop()?.();
      }
    });

    /**
     * The macOS order, modelled: the page's listener first; a key it leaves
     * goes on to the menu item, which runs it only while the native item is
     * enabled. The native state is any snapshot - stale, pending, or failed
     * to sync - so it is tried both ways for every command and both command
     * states: a press runs exactly once when the command can run, else never.
     */
    it("runs every Mac app shortcut exactly once per press, whatever the native item's state (census)", () => {
      let checked = 0;
      for (const command of COMMANDS) {
        const accelerator = shortcutFor(command.shortcut, MAC_DESKTOP);
        if (!accelerator) continue;
        for (const commandCanRun of [true, false]) {
          for (const nativeEnabled of [true, false]) {
            const ctx = makeContext({
              canGoBack: commandCanRun,
              canGoForward: commandCanRun,
              hasFindTarget: commandCanRun,
              tabs: tabsOf(commandCanRun ? 9 : 1),
              place: commandCanRun
                ? makeContext().place
                : { view: "settingsManager", project: { provider: "codex", path: "/q" }, session: null },
            });
            const runnable = isCommandEnabled(command, ctx);
            const handler = createShortcutHandler({ commands: COMMANDS, env: MAC_DESKTOP, getContext: () => ctx });
            const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...keyInit(accelerator, MAC_DESKTOP) });
            handler(event);
            if (!event.defaultPrevented && nativeEnabled) runCommand(command.id, ctx);
            expect(actionCalls(ctx), `${command.id} canRun=${runnable} native=${nativeEnabled}`).toBe(runnable ? 1 : 0);
            expect(event.defaultPrevented, command.id).toBe(true);
            checked += 1;
          }
        }
      }
      expect(checked).toBeGreaterThanOrEqual(4 * 20);
    });
  });
});
