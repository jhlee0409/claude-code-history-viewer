import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";
import type { RecentFileEdit } from "../../types";
import { fetchRecentEdits } from "../../services/analyticsApi";

const DOCK_PAGE_SIZE = 20;

/** Where the Recent Edits view is shown. */
export type RecentEditsMode = "page" | "docked";

/** Row height preset. `compact` is the two-line row, `standard` the full card. */
export type RecentEditsDensity = "standard" | "compact";

/** Which edits the list covers. */
export type RecentEditsScope = "project" | "session";

/** One row per file (latest state) or one row per edit event (chronological). */
export type RecentEditsGrouping = "file" | "edit";

const MODES = ["page", "docked"] as const;
const DENSITIES = ["standard", "compact"] as const;
const SCOPES = ["project", "session"] as const;
const GROUPINGS = ["file", "edit"] as const;

/**
 * Storage keys mirror the field names in kebab-case, matching `navigator-open`
 * and `message-filter`. `recent-edits-width` is deliberately absent: that one
 * belongs to `useResizablePanel`, which owns its own persistence.
 */
const STORAGE_KEYS = {
  mode: "recent-edits-mode",
  densityPage: "recent-edits-density-page",
  densityDock: "recent-edits-density-dock",
  scope: "recent-edits-scope",
  groupingProject: "recent-edits-grouping-project",
  groupingSession: "recent-edits-grouping-session",
  missingOnly: "recent-edits-missing-only",
  dockOpen: "recent-edits-dock-open",
} as const;

/**
 * Read a persisted string union, falling back to the default when the key is
 * absent or holds anything outside the allowed set. Following `filterSlice`, a
 * stale or hand-edited value can never put the panel into an unrenderable state.
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

/**
 * What the docked panel is currently showing, plus the request that produced it.
 *
 * The dock keeps its own result rather than sharing `analytics.recentEdits`.
 * The page view is always project-wide and grouped by file; the dock can be
 * session-scoped and chronological. Sharing one cache would mean each view
 * silently overwriting the other's data whenever both are open.
 */
export interface RecentEditsDockResult {
  files: RecentFileEdit[];
  totalEditsCount: number;
  uniqueFilesCount: number;
  projectCwd?: string;
  offset: number;
  limit: number;
  hasMore: boolean;
  /**
   * The exact request this answers. Compared by identity, never re-derived from
   * the response, which is the mistake the page view's cache guard made.
   */
  requestKey: string;
}

export interface RecentEditsDockRequest {
  projectPath: string;
  scope: RecentEditsScope;
  grouping: RecentEditsGrouping;
  sessionFilePath?: string;
}

/**
 * Stable identity for a dock request. Order matters, so build it in one place.
 *
 * Serialized rather than joined on a separator: every separator character is
 * legal somewhere in a POSIX path, so a joined key can collide across genuinely
 * different requests and hand one of them the other's rows.
 */
export const recentEditsDockRequestKey = (
  request: RecentEditsDockRequest
): string =>
  JSON.stringify([
    request.projectPath,
    request.scope,
    request.grouping,
    request.scope === "session" ? (request.sessionFilePath ?? "") : "",
  ]);

export interface RecentEditsPanelSliceState {
  /** Whether Recent Edits renders as the full page or as a docked panel. */
  recentEditsMode: RecentEditsMode;
  /**
   * Density is stored per mode, never as a single key. Docking must not
   * re-densify the full page view, and vice versa.
   */
  recentEditsDensityPage: RecentEditsDensity;
  recentEditsDensityDock: RecentEditsDensity;
  recentEditsScope: RecentEditsScope;
  /**
   * Grouping is stored per scope, so switching scope does not clobber the
   * choice made in the other one.
   */
  recentEditsGroupingProject: RecentEditsGrouping;
  recentEditsGroupingSession: RecentEditsGrouping;
  /** Show only files that no longer exist on disk. */
  recentEditsMissingOnly: boolean;
  isRecentEditsDockOpen: boolean;

  // Dock fetch state. Not persisted: it is data, not preference.
  recentEditsDock: RecentEditsDockResult | null;
  /**
   * The request the panel most recently asked for. A response is only accepted
   * while it still matches, so switching scope mid-flight cannot land stale
   * rows on top of the newer request.
   */
  recentEditsDockRequestedKey: string | null;
  isLoadingRecentEditsDock: boolean;
  isLoadingMoreRecentEditsDock: boolean;
  recentEditsDockError: string | null;
}

export interface RecentEditsPanelSliceActions {
  setRecentEditsMode: (mode: RecentEditsMode) => void;
  /** Explicitly targets one mode's density so the other cannot be clobbered. */
  setRecentEditsDensity: (
    mode: RecentEditsMode,
    density: RecentEditsDensity
  ) => void;
  setRecentEditsScope: (scope: RecentEditsScope) => void;
  /** Explicitly targets one scope's grouping so the other cannot be clobbered. */
  setRecentEditsGrouping: (
    scope: RecentEditsScope,
    grouping: RecentEditsGrouping
  ) => void;
  setRecentEditsMissingOnly: (missingOnly: boolean) => void;
  setRecentEditsDockOpen: (open: boolean) => void;
  toggleRecentEditsDock: () => void;
  /** No-ops when the current result already answers this exact request. */
  loadRecentEditsDock: (request: RecentEditsDockRequest) => Promise<void>;
  loadMoreRecentEditsDock: (request: RecentEditsDockRequest) => Promise<void>;
}

export type RecentEditsPanelSlice = RecentEditsPanelSliceState &
  RecentEditsPanelSliceActions;

/**
 * Built as a factory, like `filterSlice`, so localStorage is read when the store
 * is created rather than once at module import. Tests that seed localStorage
 * before constructing a store then see what they wrote.
 */
const initialRecentEditsPanelState = (): RecentEditsPanelSliceState => ({
  recentEditsMode: readEnum(STORAGE_KEYS.mode, MODES, "page"),
  recentEditsDensityPage: readEnum(
    STORAGE_KEYS.densityPage,
    DENSITIES,
    "standard"
  ),
  recentEditsDensityDock: readEnum(
    STORAGE_KEYS.densityDock,
    DENSITIES,
    "compact"
  ),
  recentEditsScope: readEnum(STORAGE_KEYS.scope, SCOPES, "session"),
  recentEditsGroupingProject: readEnum(
    STORAGE_KEYS.groupingProject,
    GROUPINGS,
    "file"
  ),
  recentEditsGroupingSession: readEnum(
    STORAGE_KEYS.groupingSession,
    GROUPINGS,
    "edit"
  ),
  recentEditsMissingOnly: readBool(STORAGE_KEYS.missingOnly, false),
  isRecentEditsDockOpen: readBool(STORAGE_KEYS.dockOpen, false),
  recentEditsDock: null,
  recentEditsDockRequestedKey: null,
  isLoadingRecentEditsDock: false,
  isLoadingMoreRecentEditsDock: false,
  recentEditsDockError: null,
});

const toDockResult = (
  requestKey: string,
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
): RecentEditsDockResult => ({
  files: [...previousFiles, ...result.files],
  totalEditsCount: result.total_edits_count,
  uniqueFilesCount: result.unique_files_count,
  projectCwd: result.project_cwd,
  offset: result.offset,
  limit: result.limit,
  hasMore: result.has_more,
  requestKey,
});

export const createRecentEditsPanelSlice: StateCreator<
  FullAppStore,
  [],
  [],
  RecentEditsPanelSlice
> = (set, get) => ({
  ...initialRecentEditsPanelState(),

  setRecentEditsMode: (mode) => {
    write(STORAGE_KEYS.mode, mode);
    set({ recentEditsMode: mode });
  },

  setRecentEditsDensity: (mode, density) => {
    if (mode === "docked") {
      write(STORAGE_KEYS.densityDock, density);
      set({ recentEditsDensityDock: density });
      return;
    }
    write(STORAGE_KEYS.densityPage, density);
    set({ recentEditsDensityPage: density });
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

  setRecentEditsDockOpen: (open) => {
    write(STORAGE_KEYS.dockOpen, String(open));
    set({ isRecentEditsDockOpen: open });
  },

  toggleRecentEditsDock: () =>
    set((state) => {
      const next = !state.isRecentEditsDockOpen;
      write(STORAGE_KEYS.dockOpen, String(next));
      return { isRecentEditsDockOpen: next };
    }),

  loadRecentEditsDock: async (request) => {
    const key = recentEditsDockRequestKey(request);
    const current = get().recentEditsDock;
    // Identity match on the request that produced the data, so a repeat visit
    // with unchanged scope and grouping does not re-walk the project.
    if (current?.requestKey === key && current.files.length > 0) {
      // Claim the key even though nothing is fetched. Switching away and back
      // while another request is in flight would otherwise leave that request
      // still owning the slot, and its response would land on top of the rows
      // being shown.
      //
      // The error has to go with it. The panel renders an error in preference
      // to rows, and the error is only otherwise cleared when a fetch starts,
      // which a cache hit never does: a failure from the request being
      // abandoned would sit over these perfectly good rows indefinitely.
      set({
        recentEditsDockRequestedKey: key,
        isLoadingRecentEditsDock: false,
        recentEditsDockError: null,
      });
      return;
    }

    set({
      isLoadingRecentEditsDock: true,
      recentEditsDockError: null,
      recentEditsDockRequestedKey: key,
    });
    try {
      const result = await fetchRecentEdits(request.projectPath, {
        offset: 0,
        limit: DOCK_PAGE_SIZE,
        grouping: request.grouping,
        sessionFilePath:
          request.scope === "session" ? request.sessionFilePath : undefined,
      });
      // Scope or grouping may have changed while this was in flight. Only the
      // answer to the question still being asked is allowed to land.
      if (get().recentEditsDockRequestedKey !== key) return;
      set({ recentEditsDock: toDockResult(key, result) });
    } catch (error) {
      if (get().recentEditsDockRequestedKey !== key) return;
      set({
        recentEditsDockError:
          error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (get().recentEditsDockRequestedKey === key) {
        set({ isLoadingRecentEditsDock: false });
      }
    }
  },

  loadMoreRecentEditsDock: async (request) => {
    const key = recentEditsDockRequestKey(request);
    const current = get().recentEditsDock;
    if (!current || current.requestKey !== key || !current.hasMore) return;
    if (get().isLoadingMoreRecentEditsDock) return;

    set({ isLoadingMoreRecentEditsDock: true });
    try {
      const result = await fetchRecentEdits(request.projectPath, {
        // Every page starts from offset 0, so the rows already held ARE the
        // next offset. Adding the last page's own offset double-counts it and
        // skips a whole page from the third request onward.
        offset: current.files.length,
        limit: DOCK_PAGE_SIZE,
        grouping: request.grouping,
        sessionFilePath:
          request.scope === "session" ? request.sessionFilePath : undefined,
      });
      const latest = get().recentEditsDock;
      // Appending onto a different request's rows would interleave two result
      // sets, so a scope change mid-flight discards this page.
      if (!latest || latest.requestKey !== key) return;
      set({ recentEditsDock: toDockResult(key, result, latest.files) });
    } catch (error) {
      // Same ownership rule as the success path. A late failure from a request
      // the user has already moved on from must not paint an error over rows
      // that loaded fine.
      if (get().recentEditsDockRequestedKey !== key) return;
      set({
        recentEditsDockError:
          error instanceof Error ? error.message : String(error),
      });
    } finally {
      set({ isLoadingMoreRecentEditsDock: false });
    }
  },
});

/**
 * The density that applies right now. Kept beside the slice so the
 * mode-to-key mapping lives in exactly one place.
 */
export const selectRecentEditsDensity = (
  state: RecentEditsPanelSliceState
): RecentEditsDensity =>
  state.recentEditsMode === "docked"
    ? state.recentEditsDensityDock
    : state.recentEditsDensityPage;

/** The grouping that applies to the currently selected scope. */
export const selectRecentEditsGrouping = (
  state: RecentEditsPanelSliceState
): RecentEditsGrouping =>
  state.recentEditsScope === "session"
    ? state.recentEditsGroupingSession
    : state.recentEditsGroupingProject;
