/**
 * The command manifest, typed (plan §4.4).
 *
 * `manifest.json` is the one list of app commands: id, label, shortcut per
 * platform, where the native menu puts it. It is JSON so the Rust menu (T11a)
 * can read the same file. `registry.ts` attaches what only the frontend knows
 * (icon, enabled, run).
 */
import raw from "./manifest.json";
import type { ShortcutSet } from "./keys";

/** Every command id. `manifest.test.ts` checks it equals the manifest's ids. */
export const COMMAND_IDS = [
  "palette.open",
  "go.back",
  "go.forward",
  "edit.find",
  "view.toggleInspector",
  "view.toggleMinimap",
  "go.settingsManager",
  "go.archive",
  "help.feedback",
  "app.checkForUpdates",
  "tab.new",
  "tab.close",
  "tab.next",
  "tab.previous",
  "tab.goTo1",
  "tab.goTo2",
  "tab.goTo3",
  "tab.goTo4",
  "tab.goTo5",
  "tab.goTo6",
  "tab.goTo7",
  "tab.goTo8",
  "tab.goToLast",
] as const;

export type CommandId = (typeof COMMAND_IDS)[number];

/** Native menus (§4.4); `app` is the macOS application menu. */
export const MENU_IDS = ["app", "file", "edit", "view", "go", "window", "help"] as const;
export type MenuId = (typeof MENU_IDS)[number];

export interface CommandManifestEntry {
  id: CommandId;
  /** i18n key of the command's title. */
  labelKey: string;
  /** Accelerators per platform (`keys.ts`), or null for a command without one. */
  shortcut: ShortcutSet | null;
  /** `frontend`: the registry runs it; `predefined`: the OS menu item does. */
  source: "frontend" | "predefined";
  /** Native menu it belongs to, or null with an `exceptionReason` (D6). */
  menu: MenuId | null;
  exceptionReason?: string;
  /** False keeps it out of the ⌘K command list (the palette's own opener). */
  palette?: boolean;
}

export const COMMAND_MANIFEST: readonly CommandManifestEntry[] =
  raw.commands as unknown as readonly CommandManifestEntry[];
