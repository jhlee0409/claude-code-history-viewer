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
import { hasAnyConversationBreakdownProvider } from "../../utils/providers";

// ============================================================================
// State Interface
// ============================================================================

export interface GlobalStatsSliceState {
  globalSummary: GlobalStatsSummary | null;
  globalConversationSummary: GlobalStatsSummary | null;
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
  globalConversationSummary: null,
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
    const { claudePath, activeProviders, dateFilter } = get();
    if (!claudePath) return;

    set({ isLoadingGlobalStats: true });
    get().setError(null);

    // Convert dateFilter to RFC3339 strings for the backend
    const startDate = dateFilter.start?.toISOString();
    const endDate = dateFilter.end?.toISOString();

    try {
      // Provider scope intentionally follows ProjectTree provider tabs (activeProviders).
      // Do not introduce an independent analytics provider filter here.
      const canLoadConversationSummary = hasAnyConversationBreakdownProvider(
        activeProviders
      );
      const summary = await fetchGlobalStatsSummary(
        claudePath,
        activeProviders,
        "billing_total",
        startDate,
        endDate,
      );
      const conversationSummary = canLoadConversationSummary
        ? await fetchGlobalStatsSummary(
            claudePath,
            activeProviders,
            "conversation_only",
            startDate,
            endDate,
          ).catch((error) => {
            console.warn(
              "Failed to load conversation-only global stats, falling back to billing total:",
              error
            );
            return null;
          })
        : null;
      if (requestId !== getRequestId("globalStats")) {
        return;
      }
      set({
        globalSummary: summary,
        globalConversationSummary: conversationSummary ?? summary,
      });
    } catch (error) {
      if (requestId !== getRequestId("globalStats")) {
        return;
      }
      console.error("Failed to load global stats:", error);
      get().setError({ type: AppErrorType.UNKNOWN, message: String(error) });
      set({ globalSummary: null, globalConversationSummary: null });
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
      globalConversationSummary: null,
      isLoadingGlobalStats: false,
    });
  },
});
