/**
 * Global Stats Slice
 *
 * Handles global statistics across all projects.
 */

import type { GlobalStatsSummary } from "../../types";
import { AppErrorType } from "../../types";
import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";
import { fetchGlobalStatsSummary } from "../../services/analyticsApi";
import { nextRequestId, getRequestId } from "../../utils/requestId";

// ============================================================================
// State Interface
// ============================================================================

export interface GlobalStatsSliceState {
  globalSummary: GlobalStatsSummary | null;
  isLoadingGlobalStats: boolean;
}

export interface GlobalStatsSliceActions {
  loadGlobalStats: () => Promise<void>;
  clearGlobalStats: () => void;
}

export type GlobalStatsSlice = GlobalStatsSliceState & GlobalStatsSliceActions;

// ============================================================================
// Initial State
// ============================================================================

const initialGlobalStatsState: GlobalStatsSliceState = {
  globalSummary: null,
  isLoadingGlobalStats: false,
};

// ============================================================================
// Slice Creator
// ============================================================================

export const createGlobalStatsSlice: StateCreator<
  FullAppStore,
  [],
  [],
  GlobalStatsSlice
> = (set, get) => ({
  ...initialGlobalStatsState,

  // NOTE: loadGlobalStats filters by activeProviders on the server side.
  // This is intentionally asymmetric with scanProjects (which loads all providers
  // and filters client-side) because stats aggregation is expensive and benefits
  // from only processing the providers the user has selected.
  loadGlobalStats: async () => {
    const requestId = nextRequestId("globalStats");
    const { claudePath, activeProviders } = get();
    if (!claudePath) return;

    set({ isLoadingGlobalStats: true });
    get().setError(null);

    try {
      const summary = await fetchGlobalStatsSummary(claudePath, activeProviders);
      if (requestId !== getRequestId("globalStats")) {
        return;
      }
      set({ globalSummary: summary });
    } catch (error) {
      if (requestId !== getRequestId("globalStats")) {
        return;
      }
      console.error("Failed to load global stats:", error);
      get().setError({ type: AppErrorType.UNKNOWN, message: String(error) });
      set({ globalSummary: null });
    } finally {
      if (requestId === getRequestId("globalStats")) {
        set({ isLoadingGlobalStats: false });
      }
    }
  },

  clearGlobalStats: () => {
    // Bump the request ID so any in-flight global stats requests are invalidated.
    nextRequestId("globalStats");
    set({
      globalSummary: null,
      isLoadingGlobalStats: false,
    });
  },
});
