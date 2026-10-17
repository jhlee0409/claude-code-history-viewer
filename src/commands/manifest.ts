/**
 * The command manifest, typed (plan §4.4).
 *
 * `manifest.json` is the one list of app commands and native menu items: id,
 * label, shortcut per platform, where the native menu puts it. It is JSON so
 * the Rust menu (`src-tauri/src/menu/`) builds the real menu from the same
 * file, in the file's order. `registry.ts` attaches what only the frontend
 * knows (icon, enabled, run) to the `frontend` entries; `predefined` entries
 * are the OS's own menu items (copy, quit...), listed so the menu and the
 * duplicate-shortcut checks see them.
 */
import raw from "./manifest.json";
import type { Os, ShortcutSet } from "./keys";

/**
 * Every app command id, in palette order. `registry.test.ts` checks it equals
 * the manifest's frontend ids.
 */
export const COMMAND_IDS = [
  "palette.open",
  "go.back",
  "go.forward",
  "edit.find",
  "view.toggleInspector",
  "view.toggleMinimap",
  "view.zoomIn",
  "view.zoomOut",
  "view.actualSize",
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
  "app.preferences",
] as const;

export type CommandId = (typeof COMMAND_IDS)[number];

/** Native menus (§4.4); `app` is the macOS application menu. */
export const MENU_IDS = ["app", "file", "edit", "view", "go", "window", "help"] as const;
export type MenuId = (typeof MENU_IDS)[number];

/** Where an `app` entry goes on Windows and Linux, which have no app menu. */
export type MenuElsewhere = "file" | "help";

interface MenuPlacement {
  /** Native menu it belongs to, or null with an `exceptionReason` (D6). */
  menu: MenuId | null;
  menuElsewhere?: MenuElsewhere;
  /** Starts a new group: a separator goes before it. */
  separatorBefore?: boolean;
}

export interface CommandManifestEntry extends MenuPlacement {
  id: CommandId;
  /** i18n key of the command's title. */
  labelKey: string;
  /** i18n key of its menu title when that differs (a ticked toggle names the thing). */
  menuLabelKey?: string;
  /** Accelerators per platform (`keys.ts`), or null for a command without one. */
  shortcut: ShortcutSet | null;
  /**
   * A second key per platform that only the DOM listener runs - one the
   * native menu cannot match (⌘+ beside Zoom In's ⌘=). The menu shows `shortcut`.
   */
  shortcutAlias?: ShortcutSet;
  /** `frontend`: the registry runs it. */
  source: "frontend";
  /** A menu checkbox: the item is ticked while the thing it toggles is on. */
  toggle?: boolean;
  exceptionReason?: string;
  /** False keeps it out of the ⌘K command list (the palette's own opener). */
  palette?: boolean;
}

/** An OS-provided menu item (`predefined`): the OS runs it. */
export interface PredefinedMenuEntry extends MenuPlacement {
  id: string;
  labelKey: string;
  /** The accelerator the OS gives the item, on each platform it has one. */
  shortcut: Partial<Record<Os, string>> | null;
  source: "predefined";
  /** Which OS item: `about`, `copy`, `quit`... */
  predefined: string;
  /** Platforms the item exists on. */
  platforms: Os[];
  menu: MenuId;
}

export type ManifestEntry = CommandManifestEntry | PredefinedMenuEntry;

/** Every manifest entry, in menu order. */
export const MANIFEST_ENTRIES: readonly ManifestEntry[] = raw.commands as unknown as readonly ManifestEntry[];

const paletteOrder = (id: CommandId): number => COMMAND_IDS.indexOf(id);

/** The app commands, in palette order. */
export const COMMAND_MANIFEST: readonly CommandManifestEntry[] = MANIFEST_ENTRIES.filter(
  (entry): entry is CommandManifestEntry => entry.source === "frontend",
).sort((a, b) => paletteOrder(a.id) - paletteOrder(b.id));

/** The OS's own menu items. */
export const PREDEFINED_MENU_ITEMS: readonly PredefinedMenuEntry[] = MANIFEST_ENTRIES.filter(
  (entry): entry is PredefinedMenuEntry => entry.source === "predefined",
);

/**
 * Where the native menu owns the app commands' shortcuts (§4.4, §9b A1). Off
 * on Windows and Linux until their smoke checklist passes: there the DOM
 * listener keeps them and the menu shows its items without accelerators.
 */
export const NATIVE_SHORTCUTS: Readonly<Record<Os, boolean>> = raw.nativeShortcuts;
