/**
 * Sidebar Filter Slice
 *
 * The project explorer filter: the query, what it matches (project names,
 * session names, or both), and the sessions it matched per project. Lives in
 * the store rather than in ProjectTree so the session list (inline or in the
 * sessions pane) can show only the matching sessions of the open project.
 */

import type { StateCreator } from "zustand";
import type { ClaudeSession } from "@/types";
import type { SidebarFilterScope } from "@/utils/sidebarFilter";
import type { FullAppStore } from "./types";

const SCOPE_STORAGE_KEY = "projectTree.filterScope";

const DEFAULT_SCOPE: SidebarFilterScope = { matchProjects: true, matchSessions: true };

const loadScope = (): SidebarFilterScope => {
  try {
    const raw = localStorage.getItem(SCOPE_STORAGE_KEY);
    if (!raw) return DEFAULT_SCOPE;
    const parsed = JSON.parse(raw) as Partial<SidebarFilterScope>;
    const scope = {
      matchProjects: parsed.matchProjects !== false,
      matchSessions: parsed.matchSessions !== false,
    };
    // At least one target must stay on, otherwise nothing could ever match.
    return scope.matchProjects || scope.matchSessions ? scope : DEFAULT_SCOPE;
  } catch {
    return DEFAULT_SCOPE;
  }
};

const saveScope = (scope: SidebarFilterScope) => {
  try {
    localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(scope));
  } catch {
    // localStorage may be unavailable; the in-memory scope still works.
  }
};

// ============================================================================
// State Interface
// ============================================================================

export interface SidebarFilterSliceState {
  sidebarFilterQuery: string;
  sidebarFilterScope: SidebarFilterScope;
  /** What the filter currently lets through. Null while the query is empty. */
  sidebarFilterResult: SidebarFilterResult | null;
}

export interface SidebarFilterResult {
  /** Paths of the projects the sidebar shows (provider filter applied too). */
  projectPaths: string[];
  /**
   * Projects shown only because some of their sessions match, mapped to those
   * sessions. A project matched by its own name is absent: all its sessions
   * are in.
   */
  sessionMatchesByProject: Record<string, ClaudeSession[]>;
}

export interface SidebarFilterSliceActions {
  setSidebarFilterQuery: (query: string) => void;
  /** Ignored when it would turn both targets off. */
  setSidebarFilterScope: (scope: SidebarFilterScope) => void;
  setSidebarFilterResult: (result: SidebarFilterResult | null) => void;
}

export type SidebarFilterSlice = SidebarFilterSliceState & SidebarFilterSliceActions;

// ============================================================================
// Slice Creator
// ============================================================================

export const createSidebarFilterSlice: StateCreator<
  FullAppStore,
  [],
  [],
  SidebarFilterSlice
> = (set) => ({
  sidebarFilterQuery: "",
  sidebarFilterScope: loadScope(),
  sidebarFilterResult: null,

  setSidebarFilterQuery: (query) => set({ sidebarFilterQuery: query }),

  setSidebarFilterScope: (scope) => {
    if (!scope.matchProjects && !scope.matchSessions) return;
    saveScope(scope);
    set({ sidebarFilterScope: scope });
  },

  setSidebarFilterResult: (result) => set({ sidebarFilterResult: result }),
});
