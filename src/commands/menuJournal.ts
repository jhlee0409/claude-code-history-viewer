/**
 * The menu-event journal, frontend half (plan §4.4, T11a).
 *
 * The host (`src-tauri/src/menu/journal.rs`) gives every app-command menu
 * event - a click, or an accelerator that reached the menu - the next
 * sequence number of its run (`epoch`), keeps it until it is acknowledged,
 * and emits it live. That one numbered journal is the only delivery rule:
 *
 * - Events run strictly in sequence order, each once. The page remembers the
 *   last sequence it ran (`cursor`); anything at or below it is a duplicate.
 * - A live event is only a hint. The page listens first, then pulls the
 *   journal (everything not yet acknowledged); until that first answer it
 *   holds live events. A gap (a live event past the next expected one) pulls
 *   again - the missing events are still in the journal.
 * - Running an event writes the cursor (sessionStorage, which survives a
 *   page reload) in the same task, then acknowledges it so the host can drop
 *   it. A lost acknowledgement costs nothing: the next page or listener reads
 *   the cursor and skips what already ran.
 * - A stopped journal (unmount, effect re-run) runs nothing more; whatever it
 *   had not run is still in the host's journal for the next one. A reply that
 *   lands late is either for a stopped journal (ignored) or a duplicate.
 * - A failed pull retries with a short backoff, then reports once; the next
 *   event pulls again. Nothing is lost meanwhile: the host keeps it.
 */

/** The event the host emits for a menu item. */
export const MENU_COMMAND_EVENT = "menu-command";

export interface MenuEvent {
  seq: number;
  /** The command id. */
  id: string;
}

/** A live `menu-command` event: the host run it belongs to, its number, its command. */
export interface LiveMenuEvent extends MenuEvent {
  epoch: string;
}

/** What `menu_journal` returns: every event not yet acknowledged. */
export interface MenuJournalSnapshot {
  epoch: string;
  /** Every event at or below this number is gone from the journal (acknowledged, or dropped when full). */
  floor: number;
  events: MenuEvent[];
}

/** Where the last run sequence number is kept, per host run. */
export interface MenuCursorStore {
  read: (epoch: string) => number | null;
  write: (epoch: string, seq: number) => void;
}

export interface MenuJournalDeps {
  /** Listen for live menu events; resolves to the unlisten function. */
  listen: (handler: (event: LiveMenuEvent) => void) => Promise<() => void>;
  pull: () => Promise<MenuJournalSnapshot>;
  /** Tell the host every event up to `seq` ran. */
  ack: (epoch: string, seq: number) => Promise<void>;
  run: (id: string) => void;
  cursor: MenuCursorStore;
  /** Waits before each retry of a failed pull (default `PULL_RETRY_DELAYS_MS`). */
  retryDelaysMs?: readonly number[];
  /** A pull failed and its retries too (once per outage). */
  onPullError?: (error: unknown) => void;
}

export const PULL_RETRY_DELAYS_MS: readonly number[] = [250, 1000, 4000];

export interface MenuJournal {
  stop: () => void;
}

/** A cursor kept in memory only (tests; a webview without sessionStorage). */
export function memoryCursorStore(): MenuCursorStore {
  let saved: { epoch: string; seq: number } | null = null;
  return {
    read: (epoch) => (saved?.epoch === epoch ? saved.seq : null),
    write: (epoch, seq) => {
      saved = { epoch, seq };
    },
  };
}

const CURSOR_KEY = "menu-journal.cursor";

/** The page's cursor: sessionStorage survives a reload of the same web view; memory if it is unavailable. */
export function sessionCursorStore(): MenuCursorStore {
  const memory = memoryCursorStore();
  return {
    read: (epoch) => {
      try {
        const saved = JSON.parse(window.sessionStorage.getItem(CURSOR_KEY) ?? "null") as {
          epoch?: unknown;
          seq?: unknown;
        } | null;
        if (saved?.epoch === epoch && typeof saved.seq === "number") return saved.seq;
      } catch {
        // fall through to memory
      }
      return memory.read(epoch);
    },
    write: (epoch, seq) => {
      memory.write(epoch, seq);
      try {
        window.sessionStorage.setItem(CURSOR_KEY, JSON.stringify({ epoch, seq }));
      } catch {
        // memory still has it for this page
      }
    },
  };
}

export function startMenuJournal(deps: MenuJournalDeps): MenuJournal {
  const retryDelays = deps.retryDelaysMs ?? PULL_RETRY_DELAYS_MS;
  let stopped = false;
  let unlisten: (() => void) | null = null;
  /** The host run whose numbers we follow; null until the first pull answers. */
  let epoch: string | null = null;
  /** The last sequence number run in `epoch`. */
  let cursor = 0;
  /** Events known but not yet run, by number. */
  const pending = new Map<number, string>();
  /** Live events before the first pull answered (their epoch is not known to be current yet). */
  let early: LiveMenuEvent[] = [];
  let pulling = false;
  let pullAgain = false;
  let failures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let acking = false;
  let acked = 0;

  const accept = (seq: number, id: string) => {
    if (seq > cursor) pending.set(seq, id);
  };

  const sendAck = () => {
    if (stopped || acking || epoch === null || cursor <= acked) return;
    const ackEpoch = epoch;
    const upTo = cursor;
    acking = true;
    deps.ack(ackEpoch, upTo).then(
      () => {
        acking = false;
        if (epoch === ackEpoch) acked = Math.max(acked, upTo);
        sendAck();
      },
      (error: unknown) => {
        // The host keeps the events; the cursor keeps them from running twice.
        acking = false;
        console.error("Menu event acknowledgement failed:", error);
      },
    );
  };

  /** Run every event that is next in line. A gap left behind asks the journal again. */
  const drain = (afterPull: boolean) => {
    if (epoch === null) return;
    for (;;) {
      if (stopped) return;
      const next = cursor + 1;
      const id = pending.get(next);
      if (id === undefined) break;
      pending.delete(next);
      cursor = next;
      deps.cursor.write(epoch, cursor);
      try {
        deps.run(id);
      } catch (error) {
        // One broken command must not hold up the events after it.
        console.error(`Menu command ${id} failed:`, error);
      }
    }
    sendAck();
    if (pending.size > 0 && !afterPull) pull();
  };

  const applySnapshot = (snapshot: MenuJournalSnapshot) => {
    if (snapshot.epoch !== epoch) {
      epoch = snapshot.epoch;
      cursor = 0;
      acked = 0;
      pending.clear();
    }
    cursor = Math.max(cursor, deps.cursor.read(snapshot.epoch) ?? 0, snapshot.floor);
    for (const seq of [...pending.keys()]) if (seq <= cursor) pending.delete(seq);
    for (const event of early) if (event.epoch === epoch) accept(event.seq, event.id);
    early = [];
    for (const event of snapshot.events) accept(event.seq, event.id);
    drain(true);
    // A held event newer than this answer leaves a gap the journal had not
    // reached yet when it answered: ask again. (A gap inside the answer cannot
    // be filled, so it does not loop.)
    const covered = snapshot.events.reduce((max, event) => Math.max(max, event.seq), snapshot.floor);
    if ([...pending.keys()].some((seq) => seq > covered)) pullAgain = true;
  };

  const retryLater = (error: unknown) => {
    if (failures < retryDelays.length) {
      const delay = retryDelays[failures];
      failures += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        pull();
      }, delay);
    } else if (failures === retryDelays.length) {
      failures += 1; // report once; the next event pulls again
      deps.onPullError?.(error);
    }
  };

  function pull(): void {
    if (stopped) return;
    if (pulling || retryTimer !== null) {
      pullAgain = true;
      return;
    }
    pulling = true;
    deps.pull().then(
      (snapshot) => {
        pulling = false;
        if (stopped) return;
        failures = 0;
        applySnapshot(snapshot);
        if (pullAgain) {
          pullAgain = false;
          pull();
        }
      },
      (error: unknown) => {
        pulling = false;
        if (stopped) return;
        pullAgain = false;
        console.error("Menu journal pull failed:", error);
        retryLater(error);
      },
    );
  }

  const receive = (event: LiveMenuEvent) => {
    if (stopped) return;
    if (epoch === null || event.epoch !== epoch) {
      // Not yet in step with the host (or it restarted): hold it and ask the journal.
      early.push(event);
      if (!pulling) pull();
      return;
    }
    accept(event.seq, event.id);
    drain(false);
  };

  deps
    .listen(receive)
    .then((stopListening) => {
      if (stopped) {
        stopListening();
        return;
      }
      unlisten = stopListening;
    })
    .catch((error: unknown) => console.error("Menu event listener failed:", error))
    // Listen first, then pull: an event chosen in between is in the journal or heard live.
    .finally(() => pull());

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      unlisten?.();
      unlisten = null;
    },
  };
}
