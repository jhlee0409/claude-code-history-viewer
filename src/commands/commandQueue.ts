/**
 * The one command executor (docs/adr/0001-native-menu-input-ownership.md).
 *
 * Every way to run a command - a key (`shortcuts.ts`), the ⌘K palette, a
 * toolbar or sidebar control (`CommandRunner.ts`) and a native menu event
 * (`menuJournal.ts`) - hands it to this one first-in, first-out queue, so
 * commands run in the order they arrived, whatever input they came from.
 *
 * - Nothing waiting (the steady state): a command runs at once, in the
 *   caller's task. A key costs no extra latency.
 * - A **hold** keeps the commands that arrive after it waiting behind it. The
 *   menu journal takes one while it asks the host for menu events chosen
 *   before that point (its first pull after the page loads, a refetch after a
 *   gap); it runs those events at the hold's place, then releases it, and
 *   the waiting commands run in order. So a New Tab chosen in the menu during
 *   a reload runs before a ⌘W pressed while the page was still asking.
 * - A hold is bounded: after `HOLD_LIMIT_MS` the waiting commands run anyway
 *   (a hung host call must not freeze the keyboard); events the holder runs
 *   later go to the back of the queue.
 *
 * A command started from inside a running command runs after it, not
 * inside it. A command that throws is logged and the queue goes on.
 *
 * A command waiting here keeps the target it was issued against
 * (`commandTarget.ts`): the tab the user saw in front when they issued it,
 * whatever runs ahead of it.
 */

/** The longest a hold keeps later commands waiting. */
export const HOLD_LIMIT_MS = 1000;

export interface CommandHold {
  /** Run `job` at the hold's place: before everything that arrived after the hold. */
  run: (job: () => void) => void;
  /** Let the commands waiting behind the hold run. Idempotent. */
  release: () => void;
}

export interface CommandQueue {
  /** Run `job` now, or after everything ahead of it. */
  submit: (job: () => void) => void;
  /** Keep commands submitted from now on waiting until `release` (at most `holdLimitMs`). */
  hold: () => CommandHold;
}

interface JobEntry {
  kind: "job";
  job: () => void;
}

interface HoldEntry {
  kind: "hold";
  /** The holder's own commands, run at this place. */
  jobs: Array<() => void>;
  open: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface CommandQueueOptions {
  holdLimitMs?: number;
}

export function createCommandQueue({ holdLimitMs = HOLD_LIMIT_MS }: CommandQueueOptions = {}): CommandQueue {
  const entries: Array<JobEntry | HoldEntry> = [];
  let flushing = false;

  const runSafely = (job: () => void) => {
    try {
      job();
    } catch (error) {
      console.error("Command failed:", error);
    }
  };

  /** Run from the front until an open hold (or the end). */
  const flush = () => {
    if (flushing) return; // the running loop picks it up
    flushing = true;
    try {
      while (entries.length > 0) {
        const head = entries[0]!;
        if (head.kind === "job") {
          entries.shift();
          runSafely(head.job);
          continue;
        }
        const own = head.jobs.shift();
        if (own) {
          runSafely(own);
          continue;
        }
        if (head.open) break;
        entries.shift();
      }
    } finally {
      flushing = false;
    }
  };

  const submit = (job: () => void) => {
    entries.push({ kind: "job", job });
    flush();
  };

  const close = (entry: HoldEntry) => {
    if (!entry.open) return;
    entry.open = false;
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
    flush();
  };

  const hold = (): CommandHold => {
    const entry: HoldEntry = { kind: "hold", jobs: [], open: true, timer: null };
    entries.push(entry);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (!entry.open) return;
      console.warn(`A command hold outlived ${holdLimitMs} ms; running the commands waiting behind it.`);
      close(entry);
    }, holdLimitMs);
    return {
      run: (job) => {
        if (!entry.open) {
          submit(job); // the hold is over: the back of the queue
          return;
        }
        entry.jobs.push(job);
        flush();
      },
      release: () => close(entry),
    };
  };

  return { submit, hold };
}

/** The app's one command queue: every input runs its commands through it. */
export const appCommandQueue: CommandQueue = createCommandQueue();
