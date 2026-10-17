/**
 * Shortcut grammar, per-platform resolution and key matching (plan §4.4).
 *
 * A shortcut is an accelerator string, `Modifier+...+Key`, in the token set
 * Tauri's menu accelerators accept, so the native menu (T11a) can take the
 * same string:
 *
 * - modifiers: `Cmd` (⌘), `Ctrl`, `Alt` (⌥), `Shift`, and `CmdOrCtrl` - ⌘ on
 *   macOS, Ctrl elsewhere. Desktop entries name the real key per OS; the
 *   WebUI entry runs on any OS, so it uses `CmdOrCtrl`.
 * - key: one letter or digit, `[`, `]`, `,`, `ArrowLeft/Right/Up/Down`, or
 *   `PageUp/PageDown`.
 *
 * Which entry applies: the WebUI always uses `web` (browser-reserved keys
 * such as ⌘[ ⌘] get a fallback there); the desktop app uses its OS's entry.
 */

import { isTauri } from "@/utils/platform";

export type Os = "mac" | "win" | "linux";
export type Runtime = "desktop" | "web";

export interface ShortcutSet {
  mac: string;
  win: string;
  linux: string;
  web: string;
}

/** Where the app runs: the shortcut entry and the meaning of `CmdOrCtrl`. */
export interface KeyEnvironment {
  os: Os;
  runtime: Runtime;
}

export interface Chord {
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Normalized key: lower-case letter/digit, `[`, `]`, `,`, or `ArrowLeft`... */
  key: string;
}

const ARROWS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const;
/** Page keys: Ctrl+PageUp/PageDown switch tabs on Windows and Linux. */
const PAGE_KEYS = ["PageUp", "PageDown"] as const;
const PUNCTUATION_CODES: Readonly<Record<string, string>> = {
  "[": "BracketLeft",
  "]": "BracketRight",
  ",": "Comma",
};

/** The entry that applies in `env`, or null for a command without one. */
export function shortcutFor(set: ShortcutSet | null, env: KeyEnvironment): string | null {
  if (!set) return null;
  return env.runtime === "web" ? set.web : set[env.os];
}

/** Parse an accelerator for `os`; throws on a token outside the grammar. */
export function parseAccelerator(accelerator: string, os: Os): Chord {
  const parts = accelerator.split("+");
  const keyToken = parts.pop();
  const chord: Chord = { meta: false, ctrl: false, alt: false, shift: false, key: "" };
  for (const modifier of parts) {
    switch (modifier) {
      case "Cmd":
        chord.meta = true;
        break;
      case "Ctrl":
        chord.ctrl = true;
        break;
      case "CmdOrCtrl":
        if (os === "mac") chord.meta = true;
        else chord.ctrl = true;
        break;
      case "Alt":
        chord.alt = true;
        break;
      case "Shift":
        chord.shift = true;
        break;
      default:
        throw new Error(`Unknown modifier "${modifier}" in "${accelerator}"`);
    }
  }
  if (!keyToken) throw new Error(`Missing key in "${accelerator}"`);
  if (/^[A-Za-z0-9]$/.test(keyToken)) chord.key = keyToken.toLowerCase();
  else if (keyToken in PUNCTUATION_CODES) chord.key = keyToken;
  else if ((ARROWS as readonly string[]).includes(keyToken)) chord.key = keyToken;
  else if ((PAGE_KEYS as readonly string[]).includes(keyToken)) chord.key = keyToken;
  else throw new Error(`Unknown key "${keyToken}" in "${accelerator}"`);
  return chord;
}

/** The `KeyboardEvent.code` of the physical key that types `key` on US QWERTY. */
function codeOf(key: string): string {
  if (/^[a-z]$/.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return PUNCTUATION_CODES[key] ?? key;
}

/** A printable ASCII key, i.e. the layout produced a Latin character. */
const isAsciiKey = (key: string): boolean => key.length === 1 && key.charCodeAt(0) < 128;

type KeyEventLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/**
 * Whether `event` is `chord`. Modifiers must match exactly (⌘K is not ⌘⇧K,
 * and Ctrl+K on macOS is not ⌘K). The key matches by the character typed;
 * the physical key (`code`) counts only when the layout typed no ASCII
 * character - a Hangul/kana input source, or ⌥ on macOS (⌥T types `†`) - so a
 * Dvorak user's ⌘K stays the key labeled K.
 */
export function matchesChord(event: KeyEventLike, chord: Chord): boolean {
  if (
    event.metaKey !== chord.meta ||
    event.ctrlKey !== chord.ctrl ||
    event.altKey !== chord.alt ||
    event.shiftKey !== chord.shift
  ) {
    return false;
  }
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key === chord.key) return true;
  return !isAsciiKey(event.key) && event.code === codeOf(chord.key);
}

const MAC_SYMBOLS = { ctrl: "⌃", alt: "⌥", shift: "⇧", meta: "⌘" } as const;
const KEY_LABELS: Readonly<Record<string, string>> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  PageUp: "PgUp",
  PageDown: "PgDn",
};

/** How a shortcut is written on `os`: `⌘⇧F` on macOS, `Ctrl+Shift+F` elsewhere. */
export function formatAccelerator(accelerator: string, os: Os): string {
  const chord = parseAccelerator(accelerator, os);
  const key = KEY_LABELS[chord.key] ?? chord.key.toUpperCase();
  if (os === "mac") {
    // ⌘ first, as the app's hints have always written it (⌘⇧F).
    const order = ["meta", "ctrl", "alt", "shift"] as const;
    return order.filter((m) => chord[m]).map((m) => MAC_SYMBOLS[m]).join("") + key;
  }
  const names: string[] = [];
  if (chord.ctrl) names.push("Ctrl");
  if (chord.meta) names.push("Win");
  if (chord.alt) names.push("Alt");
  if (chord.shift) names.push("Shift");
  return [...names, key].join("+");
}

/** The OS this browser or webview runs on. */
export function detectOs(userAgent: string = typeof navigator === "undefined" ? "" : navigator.userAgent): Os {
  if (/mac|iphone|ipad/i.test(userAgent)) return "mac";
  if (/windows/i.test(userAgent)) return "win";
  return "linux";
}

/** The environment this app instance runs in. */
export function currentKeyEnvironment(): KeyEnvironment {
  return { os: detectOs(), runtime: isTauri() ? "desktop" : "web" };
}

/** How `set` is written where the app runs, or null without a shortcut. */
export function shortcutLabel(set: ShortcutSet | null, env: KeyEnvironment = currentKeyEnvironment()): string | null {
  const accelerator = shortcutFor(set, env);
  return accelerator ? formatAccelerator(accelerator, env.os) : null;
}
