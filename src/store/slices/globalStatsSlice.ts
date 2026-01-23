/**
 * Global Stats Slice
 *
 * Handles global statistics across all projects.
 */

import { invoke } from "@tauri-apps/api/core";
import type { GlobalStatsSummary } from "../../types";
import { AppErrorType } from "../../types";
import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";

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

export const initialGlobalStatsState: GlobalStatsSliceState = {
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

  loadGlobalStats: async () => {
    const { claudePath } = get();
    if (!claudePath) return;

    set({ isLoadingGlobalStats: true });
    get().setError(null);

    try {
      const summary = await invoke<GlobalStatsSummary>(
        "get_global_stats_summary",
        { claudePath }
      );
      set({ globalSummary: summary });
    } catch (error) {
      console.error("Failed to load global stats:", error);
      get().setError({ type: AppErrorType.UNKNOWN, message: String(error) });
      set({ globalSummary: null });
    } finally {
      set({ isLoadingGlobalStats: false });
    }
  },

  clearGlobalStats: () => {
    set({ globalSummary: null });
  },
});
