/**
 * Manifest and registry invariants (plan §4.4).
 */
import { describe, expect, it, vi } from "vitest";
import raw from "./manifest.json";
import { parseAccelerator, shortcutFor, type KeyEnvironment } from "./keys";
import { COMMAND_IDS, COMMAND_MANIFEST, MENU_IDS } from "./manifest";
import {
  COMMANDS,
  dispatchCommand,
  getCommand,
  paletteCommands,
  runCommand,
  type CommandActions,
  type CommandContext,
} from "./registry";
import en from "@/i18n/locales/en/common.json";
import i18n from "@/i18n";
import { toast } from "sonner";
import { createCommandQueue } from "./commandQueue";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const ENVIRONMENTS: KeyEnvironment[] = [
  { os: "mac", runtime: "desktop" },
  { os: "win", runtime: "desktop" },
  { os: "linux", runtime: "desktop" },
  { os: "mac", runtime: "web" },
  { os: "win", runtime: "web" },
  { os: "linux", runtime: "web" },
];

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
    zoom: vi.fn(),
  };
  return {
    place: { view: "conversation" },
    runtime: "desktop",
    isMobile: false,
    canGoBack: false,
    canGoForward: false,
    hasFindTarget: false,
    tabCount: 1,
    ownPlace: vi.fn(() => () => true),
    actions,
    ...overrides,
  };
}

const CONVERSATION = {
  view: "conversation" as const,
  project: { provider: "claude", path: "/p" },
  session: { provider: "claude", filePath: "/p/s.jsonl", sessionId: "s" },
};

describe("command manifest", () => {
  it("lists exactly the typed command ids, each once", () => {
    const ids = raw.commands.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    const frontend = raw.commands.filter((entry) => entry.source === "frontend").map((entry) => entry.id);
    expect([...frontend].sort()).toEqual([...COMMAND_IDS].sort());
  });

  it("has a handler for every frontend command", () => {
    for (const entry of COMMAND_MANIFEST.filter((e) => e.source === "frontend")) {
      const command = getCommand(entry.id);
      expect(command, entry.id).toBeDefined();
      expect(typeof command?.run, entry.id).toBe("function");
      expect(command?.icon, entry.id).toBeDefined();
    }
  });

  it("puts every command in a known menu, or names why not (D6)", () => {
    for (const entry of COMMAND_MANIFEST) {
      if (entry.menu === null) {
        expect(entry.exceptionReason, entry.id).toBeTruthy();
      } else {
        expect(MENU_IDS, entry.id).toContain(entry.menu);
      }
    }
  });

  it("titles every command with an existing English key", () => {
    for (const entry of COMMAND_MANIFEST) {
      expect(en, entry.id).toHaveProperty([entry.labelKey]);
    }
  });

  it("gives every shortcut all four platform entries in the grammar", () => {
    for (const entry of COMMAND_MANIFEST) {
      if (!entry.shortcut) continue;
      expect(Object.keys(entry.shortcut).sort(), entry.id).toEqual(["linux", "mac", "web", "win"]);
      for (const env of ENVIRONMENTS) {
        const accelerator = shortcutFor(entry.shortcut, env);
        expect(accelerator, `${entry.id} ${env.os}/${env.runtime}`).toBeTruthy();
        expect(() => parseAccelerator(accelerator as string, env.os)).not.toThrow();
      }
    }
  });

  it.each(ENVIRONMENTS)("binds no chord to two commands on $os/$runtime", (env) => {
    const seen = new Map<string, string>();
    for (const entry of COMMAND_MANIFEST) {
      const accelerator = shortcutFor(entry.shortcut, env);
      if (!accelerator) continue;
      const key = JSON.stringify(parseAccelerator(accelerator, env.os));
      expect(seen.get(key), `${entry.id} collides on ${accelerator}`).toBeUndefined();
      seen.set(key, entry.id);
    }
  });

  it("maps the desktop's ⌘ to Ctrl outside macOS", () => {
    for (const entry of COMMAND_MANIFEST) {
      if (!entry.shortcut) continue;
      expect(entry.shortcut.win, entry.id).not.toMatch(/\bCmd\b/);
      expect(entry.shortcut.linux, entry.id).not.toMatch(/\bCmd\b/);
      expect(entry.shortcut.mac, entry.id).not.toMatch(/\bCtrl\b|CmdOrCtrl/);
    }
  });

  it("keeps browser-reserved chords out of the WebUI entries", () => {
    // ⌘T/⌘W/⌘N/⌘1-9/⌘[ ⌘] belong to the browser (plan §4.4 fallback keys),
    // as do its tab switches: Ctrl+PageUp/PageDown and ⌘⌥←→.
    const reserved = /^(CmdOrCtrl|Cmd|Ctrl)\+(T|W|N|[1-9]|\[|\]|PageUp|PageDown)$|^(Cmd|CmdOrCtrl)\+Alt\+Arrow(Left|Right)$/;
    for (const entry of COMMAND_MANIFEST) {
      if (!entry.shortcut) continue;
      expect(entry.shortcut.web, entry.id).not.toMatch(reserved);
    }
  });

  it("uses the owner's tab keys on the Mac app (⌘T ⌘W ⌘1-9) and ⌥ in the WebUI", () => {
    expect(getCommand("tab.new")?.shortcut).toMatchObject({ mac: "Cmd+T", web: "Alt+T" });
    expect(getCommand("tab.close")?.shortcut).toMatchObject({ mac: "Cmd+W", web: "Alt+W" });
    for (let n = 1; n <= 8; n += 1) {
      expect(getCommand(`tab.goTo${n}`)?.shortcut).toMatchObject({ mac: `Cmd+${n}`, web: `Alt+${n}` });
    }
    expect(getCommand("tab.goToLast")?.shortcut).toMatchObject({ mac: "Cmd+9", web: "Alt+9" });
  });

  it("uses the plan's keys for back/forward: ⌘[ ⌘] on the Mac app, ⌥←→ in the WebUI", () => {
    expect(getCommand("go.back")?.shortcut).toMatchObject({ mac: "Cmd+[", web: "Alt+ArrowLeft" });
    expect(getCommand("go.forward")?.shortcut).toMatchObject({ mac: "Cmd+]", web: "Alt+ArrowRight" });
  });
});

describe("command registry", () => {
  it("offers next/previous tab only with another tab, and ⌘n only when tab n exists", () => {
    const one = makeContext({ tabCount: 1 });
    expect(runCommand("tab.next", one)).toBe(false);
    expect(runCommand("tab.goTo2", one)).toBe(false);
    expect(runCommand("tab.goToLast", one)).toBe(true);
    expect(one.actions.selectTabAt).toHaveBeenCalledWith(9);
    const three = makeContext({ tabCount: 3 });
    expect(runCommand("tab.previous", three)).toBe(true);
    expect(three.actions.cycleTab).toHaveBeenCalledWith(-1);
    expect(runCommand("tab.goTo3", three)).toBe(true);
    expect(three.actions.selectTabAt).toHaveBeenCalledWith(3);
    expect(runCommand("tab.new", one)).toBe(true);
    expect(runCommand("tab.close", one)).toBe(true);
  });

  it("refuses an unknown command", () => {
    expect(runCommand("no.such.command", makeContext())).toBe(false);
  });

  it("refuses a disabled command and runs nothing", () => {
    const ctx = makeContext({ canGoBack: false });
    expect(runCommand("go.back", ctx)).toBe(false);
    expect(ctx.actions.goBack).not.toHaveBeenCalled();
  });

  it("runs an enabled command through its action", () => {
    const ctx = makeContext({ canGoBack: true });
    expect(runCommand("go.back", ctx)).toBe(true);
    expect(ctx.actions.goBack).toHaveBeenCalledTimes(1);
  });

  it("enables find only on a conversation with its find field mounted", () => {
    expect(runCommand("edit.find", makeContext({ place: CONVERSATION }))).toBe(false);
    expect(runCommand("edit.find", makeContext({ place: { view: "analytics" }, hasFindTarget: true }))).toBe(false);
    const ctx = makeContext({ place: CONVERSATION, hasFindTarget: true });
    expect(runCommand("edit.find", ctx)).toBe(true);
    expect(ctx.actions.focusFind).toHaveBeenCalledTimes(1);
  });

  it("enables the inspector toggle only where the inspector can show", () => {
    const session = { provider: "claude", filePath: "/p/s.jsonl", sessionId: "s" };
    // No session: the panel cannot show, so the saved open state must not flip unseen.
    expect(runCommand("view.toggleInspector", makeContext({ place: { view: "conversation" } }))).toBe(false);
    expect(runCommand("view.toggleInspector", makeContext({ place: { view: "analytics", session } }))).toBe(false);
    expect(
      runCommand("view.toggleInspector", makeContext({ place: { view: "conversation", session }, isMobile: true })),
    ).toBe(false);
    const ctx = makeContext({ place: { view: "conversation", session } });
    expect(runCommand("view.toggleInspector", ctx)).toBe(true);
    expect(ctx.actions.toggleInspector).toHaveBeenCalledTimes(1);
  });

  it("disables the archive for another provider's project, like the gear menu", () => {
    const codex = { view: "conversation" as const, project: { provider: "codex", path: "/c" } };
    expect(runCommand("go.archive", makeContext({ place: codex }))).toBe(false);
    expect(runCommand("go.archive", makeContext({ place: { view: "archive" } }))).toBe(false);
    const ctx = makeContext();
    expect(runCommand("go.archive", ctx)).toBe(true);
    expect(ctx.actions.openArchive).toHaveBeenCalledTimes(1);
  });

  it("opens the Settings Manager unless it is already open", () => {
    expect(runCommand("go.settingsManager", makeContext({ place: { view: "settingsManager" } }))).toBe(false);
    const ctx = makeContext();
    expect(runCommand("go.settingsManager", ctx)).toBe(true);
    expect(ctx.actions.openSettingsManager).toHaveBeenCalledTimes(1);
  });

  it("offers the update check on the desktop only", () => {
    expect(runCommand("app.checkForUpdates", makeContext({ runtime: "web" }))).toBe(false);
    expect(paletteCommands(makeContext({ runtime: "web" })).map((c) => c.id)).not.toContain(
      "app.checkForUpdates",
    );
    expect(paletteCommands(makeContext()).map((c) => c.id)).toContain("app.checkForUpdates");
  });

  it("lists every available command in the palette except the palette itself (D12)", () => {
    for (const runtime of ["desktop", "web"] as const) {
      const ctx = makeContext({ runtime });
      const listed = paletteCommands(ctx).map((c) => c.id);
      const expected = COMMANDS.filter(
        (c) => c.id !== "palette.open" && (c.available?.(ctx) ?? true),
      ).map((c) => c.id);
      expect(listed).toEqual(expected);
    }
  });

  it("catches a failing async command instead of leaving it unhandled", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeContext({ canGoBack: true });
    vi.mocked(ctx.actions.goBack).mockRejectedValueOnce(new Error("boom"));
    expect(runCommand("go.back", ctx)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  describe("a failing async command", () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("tells the user which command failed", async () => {
      vi.mocked(toast.error).mockClear();
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const ctx = makeContext({ canGoBack: true });
      vi.mocked(ctx.actions.goBack).mockRejectedValueOnce(new Error("boom"));
      expect(runCommand("go.back", ctx)).toBe(true);
      await flush();
      expect(en).toHaveProperty(["common.command.failed"]);
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(toast.error).toHaveBeenCalledWith(
        i18n.t("common.command.failed", { command: i18n.t("common.command.back") }),
      );
      error.mockRestore();
    });

    it("says nothing once another navigation has superseded the command's own", async () => {
      vi.mocked(toast.error).mockClear();
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      let owned = true;
      const ctx = makeContext({ canGoBack: true, ownPlace: vi.fn(() => () => owned) });
      vi.mocked(ctx.actions.goBack).mockRejectedValueOnce(new Error("boom"));
      expect(runCommand("go.back", ctx)).toBe(true);
      owned = false; // the user moved on before the failure landed
      await flush();
      expect(error).toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      error.mockRestore();
    });

    it("takes ownership after the command has started its navigation", () => {
      // `navigate` advances the epoch before its first await, so ownership
      // taken after `run` belongs to the command's own navigation.
      const ctx = makeContext({ canGoBack: true });
      runCommand("go.back", ctx);
      const [ran] = vi.mocked(ctx.actions.goBack).mock.invocationCallOrder;
      const [owned] = vi.mocked(ctx.ownPlace).mock.invocationCallOrder;
      expect(owned).toBeGreaterThan(ran as number);
    });
  });
});

describe("dispatchCommand: the one executor every input goes through (review-3 F1)", () => {
  it("runs at once in the caller's task when nothing holds the queue", () => {
    const ctx = makeContext();
    expect(dispatchCommand("tab.new", () => ctx, createCommandQueue())).toBe(true);
    expect(ctx.actions.newTab).toHaveBeenCalledTimes(1);
  });

  it("waits behind a hold and runs with the context of the moment it runs", () => {
    const queue = createCommandQueue();
    let ctx = makeContext({ tabCount: 1 });
    const hold = queue.hold();
    expect(dispatchCommand("tab.close", () => ctx, queue)).toBe(true);
    expect(ctx.actions.closeTab).not.toHaveBeenCalled();
    const later = makeContext({ tabCount: 2 });
    ctx = later;
    hold.release();
    expect(later.actions.closeTab).toHaveBeenCalledTimes(1);
  });

  it("refuses an unknown or disabled command now and queues nothing", () => {
    const queue = createCommandQueue();
    const ctx = makeContext({ canGoBack: false });
    expect(dispatchCommand("go.back", () => ctx, queue)).toBe(false);
    expect(dispatchCommand("no.such.command", () => ctx, queue)).toBe(false);
    expect(ctx.actions.goBack).not.toHaveBeenCalled();
  });
});
