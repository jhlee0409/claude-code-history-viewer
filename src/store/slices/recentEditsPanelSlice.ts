import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";

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
});

export const createRecentEditsPanelSlice: StateCreator<
  FullAppStore,
  [],
  [],
  RecentEditsPanelSlice
> = (set) => ({
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
