/**
 * Ownership of asynchronous work (plan §4.2): the one rule every write that
 * lands after an `await` follows, in the store and the navigation/analytics
 * hooks. `src/test/asyncOwnership.invariant.test.ts` holds new code to it.
 *
 * | the write                                     | it needs                                       |
 * |-----------------------------------------------|------------------------------------------------|
 * | data (a screen's own error field included)    | `ownsData`: latest request of its kind, same context |
 * | feedback - the global error, a toast, a       | `ownsFeedback`: `ownsData`, and no navigation  |
 * | warning, an alert - and URL / target / place  |   has begun since the work started             |
 * | the spinner it raised                         | `ownsSpinner`, in `finally`: cleared unless a  |
 * |                                               |   newer request of its kind took it over       |
 *
 * "Context" is the project / session the work was asked for: a load for A
 * never writes once B is open, even when nothing newer of its kind started.
 * Data for the same context may still land after a screen-only move (bounded
 * cache warming); feedback never does - it would surface over a screen that
 * did not ask for it.
 */
import type { FullAppStore } from "@/store/slices/types";

type Get = () => Pick<
  FullAppStore,
  "navigationEpoch" | "selectedProject" | "selectedSession"
>;

/**
 * Ownership of the place, taken when asynchronous work starts: true until the
 * next navigation begins. Work left behind by a superseded navigation can no
 * longer take over the screen the user moved to. Reloads take it too, without
 * advancing the epoch, so a reload never supersedes a navigation.
 */
export type PlaceOwner = () => boolean;

/** Take ownership of the current place (see `PlaceOwner`). */
export function ownPlace(
  get: () => Pick<FullAppStore, "navigationEpoch">,
): PlaceOwner {
  const epoch = get().navigationEpoch;
  return () => get().navigationEpoch === epoch;
}

/** What a piece of work was asked for. An omitted field is not scoped. */
export interface WorkContext {
  /** The `selectedProject.path` it was asked for. */
  projectPath?: string | null;
  /** The `selectedSession.file_path` it was asked for. */
  sessionPath?: string | null;
}

/** Whether the open project / session is still the one `context` names. */
function inContext(get: Get, context: WorkContext): () => boolean {
  return () => {
    const { selectedProject, selectedSession } = get();
    return (
      (context.projectPath === undefined ||
        (selectedProject?.path ?? null) === context.projectPath) &&
      (context.sessionPath === undefined ||
        (selectedSession?.file_path ?? null) === context.sessionPath)
    );
  };
}

export interface WorkOwner {
  /** Data: the latest request of its kind, for the context it was asked for. */
  ownsData: () => boolean;
  /**
   * Feedback, URL, target, place: `ownsData`, and no navigation has begun
   * since the work started.
   */
  ownsFeedback: () => boolean;
  /**
   * The spinner this work raised: no newer request of its kind has taken it
   * over. Checked in `finally`, so an abandoned request still clears its own.
   */
  ownsSpinner: () => boolean;
}

export interface OwnWorkOptions {
  context?: WorkContext;
  /** Request identity of its kind; omitted: the work has no rival requests. */
  isLatest?: () => boolean;
  /** Place ownership the caller already took (a navigation, before its first await). */
  ownsPlace?: PlaceOwner;
}

/**
 * Take ownership of one piece of async work. Call it before the first
 * `await`: place ownership is the navigation epoch at that moment.
 */
export function ownWork(get: Get, options: OwnWorkOptions = {}): WorkOwner {
  const isLatest = options.isLatest ?? (() => true);
  const ownsPlace = options.ownsPlace ?? ownPlace(get);
  const sameContext = inContext(get, options.context ?? {});
  const ownsData = () => isLatest() && sameContext();
  return {
    ownsData,
    ownsFeedback: () => ownsData() && ownsPlace(),
    ownsSpinner: isLatest,
  };
}
