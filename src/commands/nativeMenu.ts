/**
 * The desktop's native-menu bridge (plan §4.4, T11a).
 *
 * The Rust side builds the menu bar from `manifest.json` (App, File, Edit,
 * View, Go, Window, Help). This module is the frontend half. It has two
 * independent jobs, and neither decides who runs a key: the page owns every
 * app shortcut (`shortcuts.ts`).
 *
 * - **Menu events** (`menuJournal.ts`): a menu item - clicked, or its
 *   accelerator when no page listened (mid-reload) - is numbered and kept by
 *   the host until acknowledged. The journal runs each one once, in order,
 *   through `runCommand`, the same `enabled` check the palette and the keys
 *   use; an unknown or disabled id is refused there. They share one command
 *   queue with every other input (`commandQueue.ts`): a key pressed while
 *   the journal is still fetching older menu events runs after them.
 * - **Menu state** (shown only): each change of the app state or the language
 *   is coalesced into one `sync_menu_state` with the language and each menu
 *   command's enabled (and, for a toggle, checked) state, sent only when it
 *   differs from the state the host last applied. One sync is in flight at a
 *   time; a change made meanwhile is sent after its reply, so an older state
 *   never lands after a newer one. A new language makes the host rebuild the
 *   menu. A failed sync forgets the applied state, retries with a short
 *   backoff, then reports once (`onSyncError`) and tries again on the next
 *   change. A stale item can neither swallow nor double a key (the page
 *   claims its keys) nor run a command that cannot run (`runCommand`).
 */
import { COMMAND_MANIFEST, type CommandId } from "./manifest";
import {
  MENU_COMMAND_EVENT,
  startMenuJournal,
  type LiveMenuEvent,
  type MenuCursorStore,
  type MenuJournalSnapshot,
} from "./menuJournal";
import { getCommand, isCommandEnabled, runCommand, type CommandContext } from "./registry";
import { appCommandQueue, type CommandQueue } from "./commandQueue";
import type { AppStore } from "@/store/useAppStore";

export { MENU_COMMAND_EVENT };

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

/** How each toggle entry (`toggle: true`) reads whether it is on. */
export const MENU_CHECKS: Partial<Record<CommandId, (state: AppStore) => boolean>> = {
  "view.toggleInspector": (state) => state.isInspectorOpen,
  "view.toggleMinimap": (state) => state.isMinimapOpen,
};

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
  getContext: () => CommandContext;
  getLanguage: () => string;
  getChecks: () => Partial<Record<string, boolean>>;
  /** Show the state in the native menu. */
  sync: (state: MenuState) => Promise<void>;
  /** Call `onChange` when the app state or the language changes. */
  subscribe: (onChange: () => void) => () => void;
  /** Listen for live menu events; resolves to the unlisten function. */
  listen: (handler: (event: LiveMenuEvent) => void) => Promise<() => void>;
  /** The host's journal: every menu event not yet acknowledged. */
  pullEvents: () => Promise<MenuJournalSnapshot>;
  ackEvents: (epoch: string, seq: number) => Promise<void>;
  /** Where the last run menu event is remembered (survives a page reload). */
  cursor: MenuCursorStore;
  /** Waits before each retry of a failed sync or pull (default `SYNC_RETRY_DELAYS_MS`). */
  retryDelaysMs?: readonly number[];
  /** A sync failed and its retries too: tell the user (once per outage). */
  onSyncError?: (error: unknown) => void;
  /** Pulling the menu journal failed and its retries too (once per outage). */
  onPullError?: (error: unknown) => void;
  /** Where menu commands run (default: the app's one command queue, shared with keys and the palette). */
  queue?: CommandQueue;
}

/** Backoff of a failed sync's retries; after the last one, the next change retries. */
export const SYNC_RETRY_DELAYS_MS: readonly number[] = [250, 1000, 4000];

export interface MenuBridge {
  stop: () => void;
}

/** Keep the native menu's language and enabled/checked items in step with the app (shown only). */
function startMenuStateSync(deps: MenuBridgeDeps): () => void {
  const retryDelays = deps.retryDelaysMs ?? SYNC_RETRY_DELAYS_MS;
  let stopped = false;
  let scheduled = false;
  /** The state the host last applied, or "" while unknown (none yet, or a failed sync). */
  let appliedKey = "";
  let inFlight = false;
  let failures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

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
    if (key === appliedKey) return;
    inFlight = true;
    deps.sync(state).then(
      () => {
        inFlight = false;
        appliedKey = key;
        failures = 0;
        send(); // the state may have moved on while this one was in flight
      },
      (error: unknown) => {
        inFlight = false;
        appliedKey = "";
        console.error("Menu state sync failed:", error);
        if (!stopped) retryLater(error);
      },
    );
  }

  const schedule = () => {
    if (stopped || scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      send();
    }, 0);
  };

  const unsubscribe = deps.subscribe(schedule);
  send();
  return () => {
    stopped = true;
    if (retryTimer !== null) clearTimeout(retryTimer);
    unsubscribe();
  };
}

export function startMenuBridge(deps: MenuBridgeDeps): MenuBridge {
  const journal = startMenuJournal({
    listen: deps.listen,
    pull: deps.pullEvents,
    ack: deps.ackEvents,
    cursor: deps.cursor,
    run: (id) => {
      runCommand(id, deps.getContext());
    },
    queue: deps.queue ?? appCommandQueue,
    retryDelaysMs: deps.retryDelaysMs,
    onPullError: deps.onPullError,
  });
  const stopSync = startMenuStateSync(deps);
  let stopped = false;
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      journal.stop();
      stopSync();
    },
  };
}
