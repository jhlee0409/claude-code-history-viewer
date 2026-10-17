import { describe, expect, it } from "vitest";
import { detectOs, formatAccelerator, matchesChord, parseAccelerator, shortcutFor } from "./keys";

const key = (init: Partial<KeyboardEventInit> & { key: string; code?: string }) =>
  new KeyboardEvent("keydown", init);

const BACK = { mac: "Cmd+[", win: "Alt+ArrowLeft", linux: "Alt+ArrowLeft", web: "Alt+ArrowLeft" };

describe("shortcutFor", () => {
  it("takes the OS entry on the desktop and the web entry in the WebUI", () => {
    expect(shortcutFor(BACK, { os: "mac", runtime: "desktop" })).toBe("Cmd+[");
    expect(shortcutFor(BACK, { os: "win", runtime: "desktop" })).toBe("Alt+ArrowLeft");
    expect(shortcutFor(BACK, { os: "mac", runtime: "web" })).toBe("Alt+ArrowLeft");
    expect(shortcutFor(null, { os: "mac", runtime: "web" })).toBeNull();
  });
});

describe("parseAccelerator", () => {
  it("resolves CmdOrCtrl to ⌘ on macOS and Ctrl elsewhere", () => {
    expect(parseAccelerator("CmdOrCtrl+K", "mac")).toMatchObject({ meta: true, ctrl: false, key: "k" });
    expect(parseAccelerator("CmdOrCtrl+K", "win")).toMatchObject({ meta: false, ctrl: true, key: "k" });
    expect(parseAccelerator("CmdOrCtrl+K", "linux")).toMatchObject({ meta: false, ctrl: true, key: "k" });
  });

  it("rejects tokens outside the grammar", () => {
    expect(() => parseAccelerator("Hyper+K", "mac")).toThrow();
    expect(() => parseAccelerator("Cmd+Enter", "mac")).toThrow();
    expect(() => parseAccelerator("Cmd+", "mac")).toThrow();
  });
});

describe("matchesChord", () => {
  const cmdK = parseAccelerator("Cmd+K", "mac");
  const ctrlK = parseAccelerator("CmdOrCtrl+K", "win");

  it("matches ⌘ on macOS and Ctrl elsewhere, never the other", () => {
    expect(matchesChord(key({ key: "k", code: "KeyK", metaKey: true }), cmdK)).toBe(true);
    expect(matchesChord(key({ key: "k", code: "KeyK", ctrlKey: true }), cmdK)).toBe(false);
    expect(matchesChord(key({ key: "k", code: "KeyK", ctrlKey: true }), ctrlK)).toBe(true);
    expect(matchesChord(key({ key: "k", code: "KeyK", metaKey: true }), ctrlK)).toBe(false);
  });

  it("requires the exact modifier set", () => {
    expect(matchesChord(key({ key: "K", code: "KeyK", metaKey: true, shiftKey: true }), cmdK)).toBe(false);
    expect(matchesChord(key({ key: "K", code: "KeyK", metaKey: true, shiftKey: true }), parseAccelerator("Cmd+Shift+K", "mac"))).toBe(true);
  });

  it("falls back to the physical key when the layout types no ASCII", () => {
    // Korean 2-set: ⌘ + the K key types "ㅏ"; ⌥T on macOS types "†".
    expect(matchesChord(key({ key: "ㅏ", code: "KeyK", metaKey: true }), cmdK)).toBe(true);
    expect(matchesChord(key({ key: "†", code: "KeyT", altKey: true }), parseAccelerator("Alt+T", "mac"))).toBe(true);
  });

  it("follows the typed letter on a Latin layout (Dvorak ⌘K is the key labeled K)", () => {
    // Dvorak: the QWERTY-K position types "t".
    expect(matchesChord(key({ key: "t", code: "KeyK", metaKey: true }), cmdK)).toBe(false);
    expect(matchesChord(key({ key: "k", code: "KeyV", metaKey: true }), cmdK)).toBe(true);
  });

  it("parses and writes the page keys (Ctrl+PageDown: next tab on Windows/Linux)", () => {
    const chord = parseAccelerator("Ctrl+PageDown", "win");
    expect(chord).toMatchObject({ ctrl: true, key: "PageDown" });
    expect(matchesChord({ key: "PageDown", code: "PageDown", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }, chord)).toBe(true);
    expect(formatAccelerator("Ctrl+PageUp", "win")).toBe("Ctrl+PgUp");
  });

  it("matches brackets and arrows", () => {
    expect(matchesChord(key({ key: "[", code: "BracketLeft", metaKey: true }), parseAccelerator("Cmd+[", "mac"))).toBe(true);
    expect(matchesChord(key({ key: "ArrowLeft", code: "ArrowLeft", altKey: true }), parseAccelerator("Alt+ArrowLeft", "win"))).toBe(true);
  });
});

describe("formatAccelerator", () => {
  it("writes macOS symbols and spelled-out names elsewhere", () => {
    expect(formatAccelerator("Cmd+Shift+F", "mac")).toBe("⌘⇧F");
    expect(formatAccelerator("CmdOrCtrl+Shift+F", "linux")).toBe("Ctrl+Shift+F");
    expect(formatAccelerator("Alt+ArrowLeft", "mac")).toBe("⌥←");
    expect(formatAccelerator("Alt+ArrowLeft", "win")).toBe("Alt+←");
    expect(formatAccelerator("Cmd+[", "mac")).toBe("⌘[");
  });
});

describe("detectOs", () => {
  it("reads the user agent", () => {
    expect(detectOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("mac");
    expect(detectOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("win");
    expect(detectOs("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
  });
});

describe("zoom keys (= - Plus)", () => {
  it("parses = and - as keys, and Plus as the + character", () => {
    expect(parseAccelerator("Cmd+=", "mac")).toMatchObject({ meta: true, shift: false, key: "=" });
    expect(parseAccelerator("Ctrl+-", "win")).toMatchObject({ ctrl: true, key: "-" });
    expect(parseAccelerator("CmdOrCtrl+Plus", "linux")).toMatchObject({ ctrl: true, key: "+" });
  });

  it("matches ⌘= and ⌘-, and ⌘+ whether or not the layout needs ⇧ for +", () => {
    const zoomIn = parseAccelerator("Cmd+=", "mac");
    const plus = parseAccelerator("Cmd+Plus", "mac");
    const zoomOut = parseAccelerator("Cmd+-", "mac");
    expect(matchesChord(key({ key: "=", code: "Equal", metaKey: true }), zoomIn)).toBe(true);
    // US layout: + is ⇧=.
    expect(matchesChord(key({ key: "+", code: "Equal", metaKey: true, shiftKey: true }), zoomIn)).toBe(false);
    expect(matchesChord(key({ key: "+", code: "Equal", metaKey: true, shiftKey: true }), plus)).toBe(true);
    // German layout / numpad: + without ⇧.
    expect(matchesChord(key({ key: "+", code: "BracketRight", metaKey: true }), plus)).toBe(true);
    expect(matchesChord(key({ key: "+", code: "Equal", shiftKey: true }), plus)).toBe(false);
    // A web view that reports ⇧= by its unshifted character.
    expect(matchesChord(key({ key: "=", code: "Equal", metaKey: true, shiftKey: true }), plus)).toBe(true);
    expect(matchesChord(key({ key: "=", code: "Equal", metaKey: true, shiftKey: true }), zoomIn)).toBe(false);
    expect(matchesChord(key({ key: "-", code: "Minus", metaKey: true }), zoomOut)).toBe(true);
  });

  it("writes them as ⌘= ⌘- ⌘0 and Ctrl+=", () => {
    expect(formatAccelerator("Cmd+=", "mac")).toBe("⌘=");
    expect(formatAccelerator("Cmd+-", "mac")).toBe("⌘-");
    expect(formatAccelerator("Cmd+0", "mac")).toBe("⌘0");
    expect(formatAccelerator("Ctrl+=", "win")).toBe("Ctrl+=");
  });
});
