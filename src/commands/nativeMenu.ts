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
 * - **Ready, in order**: the bridge listens first, then tells the host it is
 *   ready with its first `sync_menu_state`. The host queues menu events that
 *   arrive before that (and after a page reload) and hands them back in the
 *   reply. A live event can reach the page before that reply does, so until
 *   the first reply has run its queue the bridge holds live events and runs
 *   them after it: menu events run in the order they were chosen. A reply
 *   that lands after its bridge stopped (an unmount) is handed to the next
 *   bridge, which runs it ahead of its own.
 * - **State**: each change of the app state or the language is coalesced into
 *   one `sync_menu_state` with the language and each menu command's enabled
 *   (and, for a toggle, checked) state, sent only when it differs from the
 *   state the host last acknowledged. One sync is in flight at a time; a
 *   change made meanwhile is sent after its reply, so an older state never
 *   lands after a newer one. A new language makes the host rebuild the menu.
 * - **Acknowledged state**: the host replies once it has applied the state to
 *   the native menu. A failed sync leaves the native state unknown: the
 *   bridge forgets it, retries with a short backoff, then reports the failure
 *   once (`onSyncError`) and tries again on the next change.
 * - **Shortcut owner**: where the native menu owns shortcuts (the Mac app,
 *   `NATIVE_SHORTCUTS`) the DOM listener skips a menu command's key only
 *   while the host has *acknowledged* its item enabled - the item runs it.
 *   Otherwise (item disabled, not yet acknowledged, or unknown after a failed
 *   sync) the DOM listener keeps the key; the web view sees a key before the
 *   menu does and a key it handles never reaches the menu, so each press runs
 *   once in every transition.
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
  /** Waits before each retry of a failed sync (default `SYNC_RETRY_DELAYS_MS`). */
  retryDelaysMs?: readonly number[];
  /** A sync failed and its retries too: tell the user (once per outage). */
  onSyncError?: (error: unknown) => void;
}

/** Backoff of a failed sync's retries; after the last one, the next change retries. */
export const SYNC_RETRY_DELAYS_MS: readonly number[] = [250, 1000, 4000];

export interface MenuBridge {
  /** Whether the native menu runs this command's shortcut right now. */
  owns: (id: CommandId) => boolean;
  stop: () => void;
}

/** Menu events whose bridge stopped before they could run; the next bridge runs them first. */
let orphaned: string[] = [];
/** The running bridge's intake for orphaned events. */
let adoptOrphans: ((ids: string[]) => void) | null = null;

function handOff(ids: string[]): void {
  if (ids.length === 0) return;
  if (adoptOrphans) adoptOrphans(ids);
  else orphaned.push(...ids);
}

export function startMenuBridge(deps: MenuBridgeDeps): MenuBridge {
  const owning = nativeShortcutsOwned(deps.env);
  const retryDelays = deps.retryDelaysMs ?? SYNC_RETRY_DELAYS_MS;
  let stopped = false;
  let ready = false;
  let scheduled = false;
  let unlisten: (() => void) | null = null;
  /** The state the host last applied, or null while unknown (none yet, or a failed sync). */
  let acknowledged: MenuState | null = null;
  let acknowledgedKey = "";
  let inFlight = false;
  let failures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** The host's startup queue has run; until then live events are held. */
  let drained = false;
  let held: string[] = [];

  const run = (id: string) => {
    if (!stopped) runCommand(id, deps.getContext());
  };

  /** A live menu event: run it, or hold it until the startup queue has run. */
  const receive = (id: string) => {
    if (stopped) return;
    if (drained) run(id);
    else held.push(id);
  };

  /** A reply's queue: the first one runs ahead of everything held. */
  const runQueued = (queued: string[]) => {
    if (stopped) {
      handOff([...queued, ...held]);
      held = [];
      return;
    }
    if (drained) {
      queued.forEach(run);
      return;
    }
    drained = true;
    const ordered = [...orphaned, ...queued, ...held];
    orphaned = [];
    held = [];
    ordered.forEach(run);
  };

  const adopt = (ids: string[]) => {
    if (drained) ids.forEach(run);
    else orphaned.push(...ids);
  };
  adoptOrphans = adopt;

  const retryLater = (error: unknown) => {
    if (failures < retryDelays.length) {
      const delay = retryDelays[failures];
      failures += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        send();
      }, delay);
    } else if (failures === retryDelays.length) {
      failures += 1; // report once; the next change tries again
      deps.onSyncError?.(error);
    }
  };

  function send(): void {
    if (stopped || inFlight) return;
    const state = computeMenuState(deps.getContext(), deps.getLanguage(), deps.getChecks());
    const key = JSON.stringify(state);
    if (key === acknowledgedKey) return;
    inFlight = true;
    deps.sync(state).then(
      (queued) => {
        inFlight = false;
        acknowledged = state;
        acknowledgedKey = key;
        failures = 0;
        runQueued(queued);
        send(); // the state may have moved on while this one was in flight
      },
      (error: unknown) => {
        inFlight = false;
        acknowledged = null;
        acknowledgedKey = "";
        console.error("Menu state sync failed:", error);
        if (stopped) {
          handOff(held);
          held = [];
        } else {
          retryLater(error);
        }
      },
    );
  }

  const schedule = () => {
    if (stopped || !ready || scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      send();
    }, 0);
  };

  const unsubscribe = deps.subscribe(schedule);

  deps
    .listen(receive)
    .then((stopListening) => {
      if (stopped) {
        stopListening();
        return;
      }
      unlisten = stopListening;
      ready = true;
      send();
    })
    .catch((error: unknown) => console.error("Menu event listener failed:", error));

  return {
    owns: (id) => owning && SHORTCUT_COMMAND_IDS.has(id) && acknowledged?.items[id]?.enabled === true,
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (adoptOrphans === adopt) adoptOrphans = null;
      if (retryTimer !== null) clearTimeout(retryTimer);
      if (!inFlight) {
        handOff(held);
        held = [];
      }
      unsubscribe();
      unlisten?.();
      unlisten = null;
    },
  };
}
