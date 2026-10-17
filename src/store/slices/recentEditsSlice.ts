/**
 * The Recent Edits screen's preferences and rows (plan T9b).
 *
 * The toolbar's Edits screen is the one recent-edits surface: the docked
 * panel beside the transcript is gone, and with it the page/dock modes. The
 * screen took over what only the dock had - project/session scope, grouping
 * per scope, row density, the missing-on-disk filter, request-keyed pages
 * with load-more, restore authorised against the rows' own request, the
 * restored-row patch - and the page's own load path (`analytics.recentEdits`)
 * went away, so one request-keyed slot is the screen's data.
 */
import type { StateCreator } from "zustand";
import { toast } from "sonner";
import type { FullAppStore } from "./types";
import type { RecentFileEdit } from "../../types";
import { fetchRecentEdits } from "../../services/analyticsApi";
import { ownWork, type WorkContext } from "@/navigation/ownership";
import { RECENT_EDITS_DENSITY_KEY } from "@/navigation/storageMigration";

const PAGE_SIZE = 20;

/** Row height preset. `compact` is the two-line row, `standard` the full card. */
export type RecentEditsDensity = "standard" | "compact";

/** Which edits the list covers. */
export type RecentEditsScope = "project" | "session";

/** One row per file (latest state) or one row per edit event (chronological). */
export type RecentEditsGrouping = "file" | "edit";

const DENSITIES = ["standard", "compact"] as const;
const SCOPES = ["project", "session"] as const;
const GROUPINGS = ["file", "edit"] as const;

/**
 * Storage keys mirror the field names in kebab-case, matching `navigator-open`
 * and `message-filter`. The dock's keys (mode, open, its density, its width)
 * are deleted once by `navigation/storageMigration.ts`; the page's density is
 * this screen's `recent-edits-density`.
 */
const STORAGE_KEYS = {
  density: RECENT_EDITS_DENSITY_KEY,
  scope: "recent-edits-scope",
  groupingProject: "recent-edits-grouping-project",
  groupingSession: "recent-edits-grouping-session",
  missingOnly: "recent-edits-missing-only",
} as const;

/**
 * Read a persisted string union, falling back to the default when the key is
 * absent or holds anything outside the allowed set. Following `filterSlice`, a
 * stale or hand-edited value can never put the screen into an unrenderable state.
 */
const readEnum = <T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T
): T => {
  try {
    const stored = localStorage.getItem(key);
    return allowed.includes(stored as T) ? (stored as T) : fallback;
  } catch {
    return fallback;
  }
};

const readBool = (key: string, fallback: boolean): boolean => {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === "true";
  } catch {
    return fallback;
  }
};

const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Persistence is best-effort; ignore quota/availability failures.
  }
};

/** What the screen is showing, plus the request that produced it. */
export interface RecentEditsListResult {
  files: RecentFileEdit[];
  totalEditsCount: number;
  uniqueFilesCount: number;
  projectCwd?: string;
  offset: number;
  limit: number;
  hasMore: boolean;
  /**
   * The exact request this answers. Compared by identity, never re-derived from
   * the response.
   */
  requestKey: string;
  /**
   * The request itself, so a row can name the project that produced it.
   *
   * Restore is authorised against the project's recorded edits (#525), and the
   * rows on screen may outlive the current selection (#533). Reading the live
   * selection would authorise against a project these rows did not come from.
   */
  request: RecentEditsRequest;
  /**
   * A session file of the project changed since these rows were read (the
   * watcher): they stay on screen, but the next load reads them again
   * instead of serving them from here.
   */
  stale?: boolean;
}

export interface RecentEditsRequest {
  projectPath: string;
  scope: RecentEditsScope;
  grouping: RecentEditsGrouping;
  sessionFilePath?: string;
}

/**
 * Stable identity for a request. Order matters, so build it in one place.
 *
 * Serialized rather than joined on a separator: every separator character is
 * legal somewhere in a POSIX path, so a joined key can collide across genuinely
 * different requests and hand one of them the other's rows.
 */
export const recentEditsRequestKey = (request: RecentEditsRequest): string =>
  JSON.stringify([
    request.projectPath,
    request.scope,
    request.grouping,
    request.scope === "session" ? (request.sessionFilePath ?? "") : "",
  ]);

export interface RecentEditsSliceState {
  recentEditsDensity: RecentEditsDensity;
  recentEditsScope: RecentEditsScope;
  /**
   * Grouping is stored per scope, so switching scope does not clobber the
   * choice made in the other one.
   */
  recentEditsGroupingProject: RecentEditsGrouping;
  recentEditsGroupingSession: RecentEditsGrouping;
  /** Show only files that no longer exist on disk. */
  recentEditsMissingOnly: boolean;

  // Fetch state. Not persisted: it is data, not preference.
  recentEditsList: RecentEditsListResult | null;
  /**
   * The request the screen most recently asked for. A response is only
   * accepted while it still matches, so switching scope mid-flight cannot land
   * stale rows on top of the newer request.
   */
  recentEditsRequestedKey: string | null;
  isLoadingRecentEdits: boolean;
  isLoadingMoreRecentEdits: boolean;
  /** The current request's failure (its first page). */
  recentEditsError: string | null;
}

/**
 * Distinguishes two requests that carry the *same* key.
 *
 * The key answers "which question is being asked". It cannot answer "which
 * asking of it", and equality reads the same across a clear-and-restart: null
 * the key, set it back to the identical value, and an in-flight response from
 * before the reset satisfies `key === key` and lands (#538). Deselecting a
 * project and re-selecting it is exactly that sequence.
 *
 * Bumped when a request starts, so a captured value identifies one attempt
 * rather than one question. Module state, not store state: nothing renders it.
 */
let recentEditsGeneration = 0;

/**
 * The first page in flight, so a second ask for the same request while it
 * runs (the navigation's loader and the screen's own effect, both on entry)
 * shares it instead of starting over and disowning it.
 */
let inFlight: { key: string; generation: number; promise: Promise<void> } | null = null;

export interface LoadRecentEditsOptions {
  /** Read again even when the rows on screen answer this request (a refresh). */
  force?: boolean;
}

export interface RecentEditsSliceActions {
  setRecentEditsDensity: (density: RecentEditsDensity) => void;
  setRecentEditsScope: (scope: RecentEditsScope) => void;
  /** Explicitly targets one scope's grouping so the other cannot be clobbered. */
  setRecentEditsGrouping: (
    scope: RecentEditsScope,
    grouping: RecentEditsGrouping
  ) => void;
  setRecentEditsMissingOnly: (missingOnly: boolean) => void;
  /**
   * The first page of `request`. No-ops when the rows already answer it (and
   * are not stale) unless forced; shares a load of the same request already
   * running. Records a failure as the request's error; never throws.
   */
  loadRecentEditsList: (
    request: RecentEditsRequest,
    options?: LoadRecentEditsOptions
  ) => Promise<void>;
  loadMoreRecentEditsList: (request: RecentEditsRequest) => Promise<void>;
  /**
   * Drop the fetched page and everything derived from it, leaving the
   * persisted preferences alone (the project selection was cleared). Nulling
   * the requested key also disowns any fetch still in flight.
   */
  clearRecentEditsList: () => void;
  /**
   * A session file of `projectPath` changed: rows read for that project are
   * stale. They stay on screen; the next load reads them again.
   */
  invalidateRecentEdits: (projectPath: string) => void;
  /**
   * Mark one row as present on disk again after a successful restore, without
   * refetching the page and scrolling the list out from under the user.
   */
  markRecentEditRestored: (filePath: string) => void;
}

export type RecentEditsSlice = RecentEditsSliceState & RecentEditsSliceActions;

/**
 * Built as a factory, like `filterSlice`, so localStorage is read when the store
 * is created rather than once at module import. Tests that seed localStorage
 * before constructing a store then see what they wrote.
 */
const initialRecentEditsState = (): RecentEditsSliceState => ({
  recentEditsDensity: readEnum(STORAGE_KEYS.density, DENSITIES, "standard"),
  // Project-wide by default, as the page always was; a stored choice of
  // session scope is kept.
  recentEditsScope: readEnum(STORAGE_KEYS.scope, SCOPES, "project"),
  recentEditsGroupingProject: readEnum(STORAGE_KEYS.groupingProject, GROUPINGS, "file"),
  recentEditsGroupingSession: readEnum(STORAGE_KEYS.groupingSession, GROUPINGS, "edit"),
  recentEditsMissingOnly: readBool(STORAGE_KEYS.missingOnly, false),
  recentEditsList: null,
  recentEditsRequestedKey: null,
  isLoadingRecentEdits: false,
  isLoadingMoreRecentEdits: false,
  recentEditsError: null,
});

const toListResult = (
  request: RecentEditsRequest,
  result: {
    files: RecentFileEdit[];
    total_edits_count: number;
    unique_files_count: number;
    project_cwd?: string;
    offset: number;
    limit: number;
    has_more: boolean;
  },
  previousFiles: RecentFileEdit[] = []
): RecentEditsListResult => ({
  files: [...previousFiles, ...result.files],
  totalEditsCount: result.total_edits_count,
  uniqueFilesCount: result.unique_files_count,
  projectCwd: result.project_cwd,
  offset: result.offset,
  limit: result.limit,
  hasMore: result.has_more,
  requestKey: recentEditsRequestKey(request),
  request,
});

/**
 * The place a request was asked for (`navigation/ownership.ts`): its project,
 * and for session scope its session. A load for A never writes once B is
 * open, even when nothing newer of its kind started - moving to B's
 * conversation or another tab asks the Edits screen nothing, so neither the
 * key nor the generation moves. Project-wide rows still land after a move to
 * another session of the same project (same-context cache warming).
 */
const contextOf = (request: RecentEditsRequest): WorkContext => ({
  projectPath: request.projectPath,
  sessionPath: request.scope === "session" ? (request.sessionFilePath ?? null) : undefined,
});

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const createRecentEditsSlice: StateCreator<
  FullAppStore,
  [],
  [],
  RecentEditsSlice
> = (set, get) => ({
  ...initialRecentEditsState(),

  setRecentEditsDensity: (density) => {
    write(STORAGE_KEYS.density, density);
    set({ recentEditsDensity: density });
  },

  setRecentEditsScope: (scope) => {
    write(STORAGE_KEYS.scope, scope);
    set({ recentEditsScope: scope });
  },

  setRecentEditsGrouping: (scope, grouping) => {
    if (scope === "session") {
      write(STORAGE_KEYS.groupingSession, grouping);
      set({ recentEditsGroupingSession: grouping });
      return;
    }
    write(STORAGE_KEYS.groupingProject, grouping);
    set({ recentEditsGroupingProject: grouping });
  },

  setRecentEditsMissingOnly: (missingOnly) => {
    write(STORAGE_KEYS.missingOnly, String(missingOnly));
    set({ recentEditsMissingOnly: missingOnly });
  },

  loadRecentEditsList: (request, options = {}) => {
    const key = recentEditsRequestKey(request);
    const current = get().recentEditsList;
    // Identity match on the request that produced the data, so a repeat visit
    // with unchanged scope and grouping does not re-walk the project. An
    // empty answer is an answer too ("this project has no edits").
    if (!options.force && current?.requestKey === key && !current.stale) {
      // Claim the key even though nothing is fetched: a request in flight for
      // another key must not land on top of the rows being shown. Its error
      // goes too - an error renders in preference to rows, and only a fetch
      // start otherwise clears it.
      set({
        recentEditsRequestedKey: key,
        isLoadingRecentEdits: false,
        recentEditsError: null,
      });
      return Promise.resolve();
    }
    if (
      !options.force &&
      inFlight &&
      inFlight.key === key &&
      inFlight.generation === recentEditsGeneration &&
      get().recentEditsRequestedKey === key
    ) {
      return inFlight.promise;
    }

    const generation = ++recentEditsGeneration;
    set({
      isLoadingRecentEdits: true,
      // A page still loading for the rows this request replaces is disowned
      // (the generation) and never lowers its spinner: lowered here, or
      // load-more stays blocked for the new rows.
      isLoadingMoreRecentEdits: false,
      recentEditsError: null,
      recentEditsRequestedKey: key,
    });
    // Taken before the first await (`ownWork`). Request identity is both the
    // key and the generation, because they answer different questions: the
    // key rejects an answer to a question no longer being asked, the
    // generation an answer to an earlier asking of the same one. The context
    // rejects an answer for a place no longer open.
    const owner = ownWork(get, {
      context: contextOf(request),
      isLatest: () =>
        recentEditsGeneration === generation && get().recentEditsRequestedKey === key,
    });
    const promise = (async () => {
      try {
        const result = await fetchRecentEdits(request.projectPath, {
          offset: 0,
          limit: PAGE_SIZE,
          grouping: request.grouping,
          sessionFilePath: request.scope === "session" ? request.sessionFilePath : undefined,
        });
        if (!owner.ownsData()) return;
        set({ recentEditsList: toListResult(request, result) });
      } catch (error) {
        console.error("Failed to load recent edits:", error);
        // The screen's own error is data (`ownsData`), not feedback.
        if (!owner.ownsData()) return;
        set({ recentEditsError: messageOf(error) });
      } finally {
        // Only the newest attempt may lower the spinner. A superseded one doing
        // it would report a request that is still running as finished. An
        // abandoned one (its place closed) still lowers its own.
        if (recentEditsGeneration === generation) {
          set({ isLoadingRecentEdits: false });
        }
        if (inFlight?.generation === generation) inFlight = null;
      }
    })();
    inFlight = { key, generation, promise };
    return promise;
  },

  clearRecentEditsList: () => {
    // No generation bump: if a request follows, it bumps on its way in and
    // disowns anything older; if none follows, the null key rejects the stale
    // response on its own.
    set({
      recentEditsList: null,
      recentEditsRequestedKey: null,
      isLoadingRecentEdits: false,
      isLoadingMoreRecentEdits: false,
      recentEditsError: null,
    });
  },

  invalidateRecentEdits: (projectPath) => {
    const current = get().recentEditsList;
    // Only rows read for this project are stale; another project's rows and
    // an empty slot have nothing to invalidate.
    if (!current || current.request.projectPath !== projectPath || current.stale) return;
    // The rows stay: clearing them would blank the screen under a user who
    // is reading it, on nothing more than a background file event.
    set({ recentEditsList: { ...current, stale: true } });
  },

  markRecentEditRestored: (filePath) =>
    set((state) => {
      const current = state.recentEditsList;
      if (!current) return {};
      return {
        recentEditsList: {
          ...current,
          files: current.files.map((edit) =>
            edit.file_path === filePath ? { ...edit, exists_on_disk: true } : edit
          ),
        },
      };
    }),

  loadMoreRecentEditsList: async (request) => {
    const key = recentEditsRequestKey(request);
    const current = get().recentEditsList;
    if (!current || current.requestKey !== key || !current.hasMore) return;
    if (get().isLoadingMoreRecentEdits) return;
    // A file the rows were read from changed, so the offsets the next page
    // would continue from may have moved: start the request over instead of
    // appending a page that could skip or repeat rows.
    if (current.stale) {
      await get().loadRecentEditsList(request, { force: true });
      return;
    }

    // Captured, not bumped. A page continues the request that is already in
    // the slot rather than starting a new one, so it must be discarded by the
    // same reset that discards that request - including a clear-and-restart
    // where the key comes back identical (#538).
    const generation = recentEditsGeneration;
    // Taken before the await (`ownWork`): the page is data for the place it
    // continues; the failure toast is feedback on top of that.
    const owner = ownWork(get, {
      context: contextOf(request),
      isLatest: () =>
        recentEditsGeneration === generation && get().recentEditsRequestedKey === key,
    });
    set({ isLoadingMoreRecentEdits: true });
    try {
      const result = await fetchRecentEdits(request.projectPath, {
        // Every page starts from offset 0, so the rows already held ARE the
        // next offset. Adding the last page's own offset double-counts it and
        // skips a whole page from the third request onward.
        offset: current.files.length,
        limit: PAGE_SIZE,
        grouping: request.grouping,
        sessionFilePath: request.scope === "session" ? request.sessionFilePath : undefined,
      });
      const latest = get().recentEditsList;
      // Appending onto a different request's rows would interleave two result
      // sets, so a scope change mid-flight discards this page; so does a move
      // to another place, which asked for none of it.
      if (!owner.ownsData()) return;
      if (!latest || latest.requestKey !== key) return;
      // Declared stale while the page was in flight: the same moved offsets.
      if (latest.stale) return;
      set({ recentEditsList: toListResult(request, result, latest.files) });
    } catch (error) {
      console.error("Failed to load more recent edits:", error);
      // Same ownership rule as the success path: a late failure from a request
      // the user has already moved on from says nothing. The rows already on
      // screen stay (as the page did); the button stays to try again.
      if (owner.ownsFeedback()) toast.error(`Failed to load more edits: ${messageOf(error)}`);
    } finally {
      // A superseded page must not lower a flag the current request owns.
      if (recentEditsGeneration === generation) {
        set({ isLoadingMoreRecentEdits: false });
      }
    }
  },
});
