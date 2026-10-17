/**
 * The desktop's native-menu bridge (plan §4.4, T11a).
 *
 * The Rust side builds the menu bar from `manifest.json` (App, File, Edit,
 * View, Go, Window, Help). This module is the frontend half:
 *
 * - **Running**: a menu item - clicked, or its accelerator - arrives as one
 *   `menu-command` event with the command id and runs through `runCommand`,
 *   the same `enabled` check the palette and the shortcuts use. An unknown or
 *   disabled id is refused there.
 * - **Ready**: the bridge listens first, then tells the host it is ready with
 *   its first `sync_menu_state`. The host queues menu events that arrive
 *   before that (and after a page reload) and hands them back in the reply;
 *   they run then.
 * - **State**: each change of the app state or the language is coalesced into
 *   one `sync_menu_state` with the language and each menu command's enabled
 *   (and, for a toggle, checked) state, sent only when it differs from the
 *   last one. A new language makes the host rebuild the menu in it.
 * - **Shortcut owner**: where the native menu owns shortcuts (the Mac app,
 *   `NATIVE_SHORTCUTS`) the DOM listener skips a menu command's key while its
 *   menu item is enabled - the item runs it. While the item is disabled the
 *   OS does not fire its accelerator, so the DOM listener keeps the key and a
 *   state that is briefly stale cannot leave a key dead.
 */
import type { KeyEnvironment } from "./keys";
import { COMMAND_MANIFEST, NATIVE_SHORTCUTS, type CommandId } from "./manifest";
import { getCommand, isCommandEnabled, runCommand, type CommandContext } from "./registry";
import type { AppStore } from "@/store/useAppStore";

/** The event the host emits for a menu item, payload = command id. */
export const MENU_COMMAND_EVENT = "menu-command";

export interface MenuItemState {
  enabled: boolean;
  /** Toggle items only: whether the item is ticked. */
  checked?: boolean;
}

/** What `sync_menu_state` sends: the UI language and each menu command's state. */
export interface MenuState {
  language: string;
  items: Record<string, MenuItemState>;
}

const MENU_ENTRIES = COMMAND_MANIFEST.filter((entry) => entry.menu !== null);

/** The commands the native menu lists (D6: every frontend command, or an exception). */
export const MENU_COMMAND_IDS: ReadonlySet<CommandId> = new Set(MENU_ENTRIES.map((entry) => entry.id));

/** Menu commands with a shortcut: the ones whose key the menu can own. */
const SHORTCUT_COMMAND_IDS: ReadonlySet<CommandId> = new Set(
  MENU_ENTRIES.filter((entry) => entry.shortcut !== null).map((entry) => entry.id),
);

/** How each toggle entry (`toggle: true`) reads whether it is on. */
export const MENU_CHECKS: Partial<Record<CommandId, (state: AppStore) => boolean>> = {
  "view.toggleInspector": (state) => state.isInspectorOpen,
  "view.toggleMinimap": (state) => state.isMinimapOpen,
};

/** Whether the native menu owns the app commands' shortcuts in `env`. */
export const nativeShortcutsOwned = (env: KeyEnvironment): boolean =>
  env.runtime === "desktop" && NATIVE_SHORTCUTS[env.os];

export function computeMenuState(
  ctx: CommandContext,
  language: string,
  checks: Partial<Record<string, boolean>>,
): MenuState {
  const items: Record<string, MenuItemState> = {};
  for (const entry of MENU_ENTRIES) {
    const command = getCommand(entry.id);
    const enabled = command != null && isCommandEnabled(command, ctx);
    items[entry.id] = entry.toggle ? { enabled, checked: checks[entry.id] ?? false } : { enabled };
  }
  return { language, items };
}

/** What the bridge needs from the host and the app; `nativeMenuHost.ts` wires the real ones. */
export interface MenuBridgeDeps {
  env: KeyEnvironment;
  getContext: () => CommandContext;
  getLanguage: () => string;
  getChecks: () => Partial<Record<string, boolean>>;
  /** Send the state; resolves to the menu events the host queued before it. */
  sync: (state: MenuState) => Promise<string[]>;
  /** Listen for menu events; resolves to the unlisten function. */
  listen: (handler: (id: string) => void) => Promise<() => void>;
  /** Call `onChange` when the app state or the language changes. */
  subscribe: (onChange: () => void) => () => void;
}

export interface MenuBridge {
  /** Whether the native menu runs this command's shortcut right now. */
  owns: (id: CommandId) => boolean;
  stop: () => void;
}

export function startMenuBridge(deps: MenuBridgeDeps): MenuBridge {
  const owning = nativeShortcutsOwned(deps.env);
  let stopped = false;
  let ready = false;
  let scheduled = false;
  let unlisten: (() => void) | null = null;
  let lastSent: MenuState | null = null;
  let lastKey = "";

  const run = (id: string) => {
    if (!stopped) runCommand(id, deps.getContext());
  };

  const send = async () => {
    const state = computeMenuState(deps.getContext(), deps.getLanguage(), deps.getChecks());
    const key = JSON.stringify(state);
    if (key === lastKey) return;
    lastKey = key;
    lastSent = state;
    try {
      const queued = await deps.sync(state);
      queued.forEach(run);
    } catch (error) {
      console.error("Menu state sync failed:", error);
      lastKey = ""; // send it again on the next change
    }
  };

  const schedule = () => {
    if (stopped || !ready || scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      if (!stopped) void send();
    }, 0);
  };

  const unsubscribe = deps.subscribe(schedule);

  deps
    .listen(run)
    .then((stopListening) => {
      if (stopped) {
        stopListening();
        return;
      }
      unlisten = stopListening;
      ready = true;
      void send();
    })
    .catch((error: unknown) => console.error("Menu event listener failed:", error));

  return {
    owns: (id) => owning && SHORTCUT_COMMAND_IDS.has(id) && lastSent?.items[id]?.enabled !== false,
    stop: () => {
      if (stopped) return;
      stopped = true;
      unsubscribe();
      unlisten?.();
      unlisten = null;
    },
  };
}
