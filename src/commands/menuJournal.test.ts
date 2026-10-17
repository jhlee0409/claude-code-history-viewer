/**
 * The menu-event journal (plan §4.4, T11a): every menu event has the host's
 * sequence number, runs once, oldest first, and stays in the host's journal
 * until the frontend acknowledges it - across startup, a page reload, a
 * replaced listener, late or failed replies.
 *
 * The fake host below keeps the Rust journal's rules
 * (`src-tauri/src/menu/journal.rs`): `record` numbers an event and keeps it,
 * `pull` returns everything not yet acknowledged, `ack` drops what was run.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  memoryCursorStore,
  startMenuJournal,
  type LiveMenuEvent,
  type MenuCursorStore,
  type MenuJournalDeps,
  type MenuJournalSnapshot,
} from "./menuJournal";
import { createCommandQueue, type CommandQueue } from "./commandQueue";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The Rust journal, in memory. `hold` makes the next pulls wait for `release`. */
function fakeHost(epoch = "boot-1") {
  let seq = 0;
  let floor = 0;
  let retained: { seq: number; id: string }[] = [];
  const listeners = new Set<(event: LiveMenuEvent) => void>();
  const held: Array<{ reply: Deferred<MenuJournalSnapshot>; snapshot: MenuJournalSnapshot }> = [];
  let holding = false;
  let failNextPulls = 0;
  const acks: number[] = [];
  const snapshot = (): MenuJournalSnapshot => ({ epoch, floor, events: retained.map((e) => ({ ...e })) });
  const host = {
    acks,
    pulls: 0,
    /** A menu click or accelerator: numbered, kept, emitted to whoever listens. */
    choose(id: string): LiveMenuEvent {
      seq += 1;
      const event = { epoch, seq, id };
      retained.push({ seq, id });
      listeners.forEach((listener) => listener(event));
      return event;
    },
    /** Record without delivering (the page is reloading or not listening yet). */
    chooseUnheard(id: string) {
      seq += 1;
      retained.push({ seq, id });
    },
    deliver: (event: LiveMenuEvent) => listeners.forEach((listener) => listener(event)),
    hold: () => {
      holding = true;
    },
    /** Answer held pulls: in the given order (indexes), each with the snapshot taken when it was asked. */
    release(order?: number[]) {
      holding = false;
      const replies = held.splice(0, held.length);
      for (const index of order ?? replies.map((_, i) => i)) {
        const entry = replies[index]!;
        entry.reply.resolve(entry.snapshot);
      }
    },
    failPulls: (n: number) => {
      failNextPulls = n;
    },
    retained: () => retained.map((e) => e.seq),
    listenerCount: () => listeners.size,
    deps(run: (id: string) => void, cursor: MenuCursorStore, extra: Partial<MenuJournalDeps> = {}): MenuJournalDeps {
      return {
        issue: (id) => () => run(id),
        cursor,
        queue: createCommandQueue(),
        retryDelaysMs: [0, 0],
        listen: async (handler) => {
          listeners.add(handler);
          return () => listeners.delete(handler);
        },
        pull: () => {
          host.pulls += 1;
          if (failNextPulls > 0) {
            failNextPulls -= 1;
            return Promise.reject(new Error("injected pull failure"));
          }
          if (holding) {
            const reply = deferred<MenuJournalSnapshot>();
            held.push({ reply, snapshot: snapshot() });
            return reply.promise;
          }
          return Promise.resolve(snapshot());
        },
        ack: async (ackEpoch, upTo) => {
          if (ackEpoch !== epoch) return;
          acks.push(upTo);
          floor = Math.max(floor, upTo);
          retained = retained.filter((e) => e.seq > floor);
        },
        ...extra,
      };
    },
  };
  return host;
}

const stops: Array<() => void> = [];
afterEach(() => {
  while (stops.length) stops.pop()?.();
});

function start(host: ReturnType<typeof fakeHost>, ran: string[], cursor: MenuCursorStore = memoryCursorStore(), extra: Partial<MenuJournalDeps> = {}) {
  const journal = startMenuJournal(host.deps((id) => ran.push(id), cursor, { queue: createCommandQueue(), ...extra }));
  stops.push(journal.stop);
  return journal;
}

describe("menu journal", () => {
  it("runs events chosen during startup (before the page listened), oldest first, then acknowledges them", async () => {
    const host = fakeHost();
    host.chooseUnheard("tab.new");
    host.chooseUnheard("tab.close");
    const ran: string[] = [];
    start(host, ran);
    await flush();
    expect(ran).toEqual(["tab.new", "tab.close"]);
    expect(host.retained()).toEqual([]);
    host.choose("go.back");
    await flush();
    expect(ran).toEqual(["tab.new", "tab.close", "go.back"]);
  });

  it("runs the startup queue before a live event that arrives while the pull is on its way (review R2)", async () => {
    const host = fakeHost();
    host.chooseUnheard("tab.new");
    host.hold();
    const ran: string[] = [];
    start(host, ran);
    await flush();
    host.choose("tab.close");
    await flush();
    expect(ran).toEqual([]);
    host.release();
    await flush();
    expect(ran).toEqual(["tab.new", "tab.close"]);
  });

  it("runs every event once when it comes both live and in a pull", async () => {
    const host = fakeHost();
    const ran: string[] = [];
    start(host, ran);
    await flush();
    const event = host.choose("tab.new");
    host.deliver(event);
    await flush();
    expect(ran).toEqual(["tab.new"]);
  });

  it("fills a gap from the journal before running a later live event", async () => {
    const host = fakeHost();
    const ran: string[] = [];
    start(host, ran);
    await flush();
    host.chooseUnheard("tab.new"); // its live emit was lost
    host.choose("tab.close");
    expect(ran).toEqual([]);
    await flush();
    expect(ran).toEqual(["tab.new", "tab.close"]);
  });

  describe("a replaced listener (effect re-run, StrictMode)", () => {
    it("runs a stopped journal's pending events in the new one, oldest first, when the new pull answers first (review-2 L1)", async () => {
      const host = fakeHost();
      const cursor = memoryCursorStore();
      host.chooseUnheard("tab.new");
      host.hold();
      const ran: string[] = [];
      const first = start(host, ran, cursor);
      await flush();
      first.stop();
      start(host, ran, cursor);
      await flush();
      host.choose("tab.close");
      await flush();
      host.release([1, 0]); // the replacement's pull answers before the stopped one's
      await flush();
      expect(ran).toEqual(["tab.new", "tab.close"]);
    });

    it("does the same when the stopped journal's pull answers first", async () => {
      const host = fakeHost();
      const cursor = memoryCursorStore();
      host.chooseUnheard("tab.new");
      host.hold();
      const ran: string[] = [];
      const first = start(host, ran, cursor);
      await flush();
      first.stop();
      start(host, ran, cursor);
      await flush();
      host.choose("tab.close");
      await flush();
      host.release([0, 1]);
      await flush();
      expect(ran).toEqual(["tab.new", "tab.close"]);
    });

    it("does not run again what the old listener ran, even if its acknowledgement never arrived", async () => {
      const host = fakeHost();
      const cursor = memoryCursorStore();
      const ran: string[] = [];
      const neverAck = { ack: () => new Promise<void>(() => {}) };
      const first = start(host, ran, cursor, neverAck);
      await flush();
      host.choose("tab.new");
      await flush();
      expect(ran).toEqual(["tab.new"]);
      expect(host.retained()).toEqual([1]);
      first.stop();
      start(host, ran, cursor);
      host.choose("tab.close");
      await flush();
      expect(ran).toEqual(["tab.new", "tab.close"]);
      expect(host.listenerCount()).toBe(1);
    });
  });

  describe("a page reload (a new page, same host)", () => {
    it("runs the events chosen during the reload once, in order, after what the old page ran", async () => {
      const host = fakeHost();
      const session = memoryCursorStore(); // stands in for sessionStorage, which survives a reload
      const ran: string[] = [];
      const oldPage = start(host, ran, session, { ack: () => new Promise<void>(() => {}) });
      await flush();
      host.choose("tab.new"); // run by the old page; its ack is lost with the page
      await flush();
      oldPage.stop();
      host.chooseUnheard("tab.new"); // ⌘T ⌘T ⌘W while the new page loads
      host.chooseUnheard("tab.new");
      host.chooseUnheard("tab.close");
      start(host, ran, session);
      await flush();
      expect(ran).toEqual(["tab.new", "tab.new", "tab.new", "tab.close"]);
      expect(host.retained()).toEqual([]);
    });

    it("drops a pull reply that lands after its page went away, without acknowledging or running it", async () => {
      const host = fakeHost();
      const session = memoryCursorStore();
      host.hold();
      const ran: string[] = [];
      const oldPage = start(host, ran, session);
      host.chooseUnheard("tab.new");
      await flush();
      oldPage.stop();
      host.release();
      await flush();
      expect(ran).toEqual([]);
      expect(host.retained()).toEqual([1]); // still there for the new page
      start(host, ran, session);
      await flush();
      expect(ran).toEqual(["tab.new"]);
    });

    it("starts over when the host restarted (a new epoch): its sequence numbers are new", async () => {
      const session = memoryCursorStore();
      const before = fakeHost("boot-1");
      const ran: string[] = [];
      const page = start(before, ran, session);
      await flush();
      before.choose("tab.new");
      before.choose("tab.new");
      await flush();
      page.stop();
      const after = fakeHost("boot-2");
      after.chooseUnheard("palette.open");
      start(after, ran, session);
      await flush();
      expect(ran).toEqual(["tab.new", "tab.new", "palette.open"]);
    });
  });

  describe("failures and late replies", () => {
    it("keeps events through a failed pull and runs them after the retry", async () => {
      const host = fakeHost();
      host.chooseUnheard("tab.new");
      host.failPulls(1);
      const ran: string[] = [];
      start(host, ran);
      host.choose("tab.close");
      await flush();
      await flush();
      expect(ran).toEqual(["tab.new", "tab.close"]);
    });

    it("reports a pull that keeps failing once, and pulls again on the next event", async () => {
      const host = fakeHost();
      host.chooseUnheard("tab.new");
      host.failPulls(3);
      const onPullError = vi.fn();
      const ran: string[] = [];
      start(host, ran, memoryCursorStore(), { onPullError });
      for (let i = 0; i < 4; i++) await flush();
      expect(onPullError).toHaveBeenCalledTimes(1);
      expect(ran).toEqual([]);
      host.choose("tab.close");
      await flush();
      expect(ran).toEqual(["tab.new", "tab.close"]);
    });

    it("pulls again after an in-flight pull when a gap shows up meanwhile, then runs everything in order", async () => {
      const host = fakeHost();
      host.chooseUnheard("tab.new");
      host.hold();
      const ran: string[] = [];
      start(host, ran);
      await flush();
      host.chooseUnheard("tab.close");
      host.choose("go.back"); // a gap (tab.close unheard) asks for another pull
      await flush();
      host.release();
      await flush();
      await flush();
      expect(ran).toEqual(["tab.new", "tab.close", "go.back"]);
    });

    it("keeps unacknowledged events in the host when an acknowledgement fails, and never runs them twice", async () => {
      const host = fakeHost();
      const ran: string[] = [];
      let failAck = true;
      start(host, ran, memoryCursorStore(), {
        ack: async (epoch, seq) => {
          if (failAck) throw new Error("injected ack failure");
          await host.deps(() => {}, memoryCursorStore()).ack(epoch, seq);
        },
      });
      await flush();
      host.choose("tab.new");
      await flush();
      expect(host.retained()).toEqual([1]);
      failAck = false;
      host.choose("tab.close");
      await flush();
      expect(ran).toEqual(["tab.new", "tab.close"]);
      expect(host.retained()).toEqual([]);
    });

    it("skips past events the host dropped (its floor) instead of waiting for them forever", async () => {
      const ran: string[] = [];
      const snapshot: MenuJournalSnapshot = { epoch: "e", floor: 5, events: [{ seq: 6, id: "tab.new" }] };
      const journal = startMenuJournal({
        issue: (id) => () => ran.push(id),
        cursor: memoryCursorStore(),
        queue: createCommandQueue(),
        listen: async () => () => {},
        pull: async () => snapshot,
        ack: async () => {},
      });
      stops.push(journal.stop);
      await flush();
      expect(ran).toEqual(["tab.new"]);
    });
  });

  it("stops listening when stopped, also when the listener attaches after the stop", async () => {
    const host = fakeHost();
    const ran: string[] = [];
    const journal = start(host, ran);
    journal.stop();
    await flush();
    expect(host.listenerCount()).toBe(0);
    host.choose("tab.new");
    await flush();
    expect(ran).toEqual([]);
  });

  describe("one executor with the keys and the palette (review-3 F1)", () => {
    /** A key or palette command: it goes through the same queue as the journal. */
    const press = (queue: CommandQueue, ran: string[], id: string) => queue.submit(() => ran.push(`key:${id}`));

    it("runs a key pressed while the startup pull is on its way after the menu events chosen before it", async () => {
      const host = fakeHost();
      host.chooseUnheard("tab.new"); // chosen in the native menu while the page reloaded
      host.hold();
      const queue = createCommandQueue();
      const ran: string[] = [];
      start(host, ran, memoryCursorStore(), { queue });
      await flush();
      press(queue, ran, "tab.close");
      expect(ran).toEqual([]);
      host.release();
      await flush();
      expect(ran).toEqual(["tab.new", "key:tab.close"]);
    });

    it("holds a key pressed while the listener is still attaching too", () => {
      const host = fakeHost();
      host.chooseUnheard("tab.new");
      const queue = createCommandQueue();
      const ran: string[] = [];
      start(host, ran, memoryCursorStore(), { queue });
      press(queue, ran, "tab.close");
      expect(ran).toEqual([]);
      return flush().then(() => expect(ran).toEqual(["tab.new", "key:tab.close"]));
    });

    it("holds a key behind a refetch after a gap, until the missing event has run", async () => {
      const host = fakeHost();
      const queue = createCommandQueue();
      const ran: string[] = [];
      start(host, ran, memoryCursorStore(), { queue });
      await flush();
      host.hold();
      host.chooseUnheard("tab.new"); // its live emit was lost
      host.choose("go.back"); // a gap: pull again
      press(queue, ran, "tab.close");
      expect(ran).toEqual([]);
      host.release();
      await flush();
      expect(ran).toEqual(["tab.new", "go.back", "key:tab.close"]);
    });

    it("runs a key at once while the journal is in step with the host", async () => {
      const host = fakeHost();
      const queue = createCommandQueue();
      const ran: string[] = [];
      start(host, ran, memoryCursorStore(), { queue });
      await flush();
      host.choose("tab.new");
      press(queue, ran, "tab.close");
      expect(ran).toEqual(["tab.new", "key:tab.close"]);
    });

    it("does not hold keys while a failed pull waits for its retry", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const host = fakeHost();
      host.failPulls(1);
      const queue = createCommandQueue();
      const ran: string[] = [];
      start(host, ran, memoryCursorStore(), { queue, retryDelaysMs: [60_000] });
      await flush();
      press(queue, ran, "tab.close");
      expect(ran).toEqual(["key:tab.close"]);
    });

    it("acknowledges only the events that ran, not those still waiting in the queue", async () => {
      const host = fakeHost();
      host.chooseUnheard("tab.new");
      host.hold();
      const queue = createCommandQueue();
      const ahead = queue.hold(); // something already waiting ahead of the journal
      const ran: string[] = [];
      start(host, ran, memoryCursorStore(), { queue });
      await flush();
      host.chooseUnheard("tab.close");
      host.choose("go.back"); // heard past a gap before the first answer: a second pull follows it
      host.release();
      await flush();
      await flush();
      expect(ran).toEqual([]);
      expect(host.retained()).toEqual([1, 2, 3]); // still the host's until they run
      ahead.release();
      expect(ran).toEqual(["tab.new", "tab.close", "go.back"]);
      await flush();
      expect(host.retained()).toEqual([]);
    });

    it("lets the keys go when stopped while holding them", () => {
      const host = fakeHost();
      host.hold();
      const queue = createCommandQueue();
      const ran: string[] = [];
      const journal = start(host, ran, memoryCursorStore(), { queue });
      press(queue, ran, "tab.close");
      journal.stop();
      expect(ran).toEqual(["key:tab.close"]);
    });
  });

  describe("a listener that fails to attach (review-3 F3)", () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("retries with backoff, reports once, and runs the events kept meanwhile in order once it attaches", async () => {
      vi.useFakeTimers();
      vi.spyOn(console, "error").mockImplementation(() => {});
      const host = fakeHost();
      const attach = host.deps(() => {}, memoryCursorStore()).listen;
      let failures = 3;
      const listen = vi.fn((handler: (event: LiveMenuEvent) => void) =>
        failures-- > 0 ? Promise.reject(new Error("injected listen failure")) : attach(handler),
      );
      const onListenError = vi.fn();
      const queue = createCommandQueue();
      const ran: string[] = [];
      start(host, ran, memoryCursorStore(), { listen, onListenError, queue, retryDelaysMs: [100, 200] });
      await vi.advanceTimersByTimeAsync(0);
      expect(listen).toHaveBeenCalledTimes(1);
      // The startup pull still ran, so keys are not held while the listener is down.
      queue.submit(() => ran.push("key"));
      expect(ran).toEqual(["key"]);
      host.choose("tab.new"); // nobody hears these; the host keeps them
      host.choose("tab.close");
      await vi.advanceTimersByTimeAsync(100);
      expect(listen).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(200);
      expect(listen).toHaveBeenCalledTimes(3);
      expect(onListenError).toHaveBeenCalledTimes(1);
      expect(ran).toEqual(["key"]);
      await vi.advanceTimersByTimeAsync(200); // keeps trying at the last delay; this one attaches
      expect(listen).toHaveBeenCalledTimes(4);
      expect(ran).toEqual(["key", "tab.new", "tab.close"]);
      expect(host.retained()).toEqual([]);
      host.choose("go.back");
      await vi.advanceTimersByTimeAsync(0);
      expect(ran).toEqual(["key", "tab.new", "tab.close", "go.back"]);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(listen).toHaveBeenCalledTimes(4);
      expect(onListenError).toHaveBeenCalledTimes(1);
    });

    it("stops retrying when stopped during the backoff", async () => {
      vi.useFakeTimers();
      vi.spyOn(console, "error").mockImplementation(() => {});
      const host = fakeHost();
      const listen = vi.fn(() => Promise.reject(new Error("injected listen failure")));
      const journal = start(host, [], memoryCursorStore(), { listen, retryDelaysMs: [100] });
      await vi.advanceTimersByTimeAsync(0);
      journal.stop();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(listen).toHaveBeenCalledTimes(1);
    });
  });
});
