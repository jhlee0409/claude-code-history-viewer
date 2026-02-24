/**
 * Global Stats Slice
 *
 * Handles global statistics across all projects.
 */

import type { GlobalStatsSummary } from "../../types";
import { AppErrorType } from "../../types";
import type { StateCreator } from "zustand";
import { toast } from "sonner";
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

    // Convert dateFilter to RFC3339 strings for the backend.
    // Ensure endDate includes the full local day for parity with other stats slices.
    const startDate =
      dateFilter.start != null ? dateFilter.start.toISOString() : undefined;
    const endDateObj =
      dateFilter.end != null ? new Date(dateFilter.end) : null;
    if (endDateObj != null) {
      endDateObj.setHours(23, 59, 59, 999);
    }
    const endDate = endDateObj?.toISOString();

    try {
      // Provider scope intentionally follows ProjectTree provider tabs (activeProviders).
      // Do not introduce an independent analytics provider filter here.
      const canLoadConversationSummary = hasAnyConversationBreakdownProvider(
        activeProviders
      );
      const [summary, conversationSummary] = await Promise.all([
        fetchGlobalStatsSummary(
          claudePath,
          "billing_total",
          activeProviders,
          startDate,
          endDate,
        ),
        canLoadConversationSummary
          ? fetchGlobalStatsSummary(
              claudePath,
              "conversation_only",
              activeProviders,
              startDate,
              endDate,
            ).catch((error) => {
              console.warn(
                "Failed to load conversation-only global stats:",
                error
              );
              toast.warning(
                "Conversation-only global stats could not be loaded. Showing billing totals only."
              );
              return null;
            })
          : Promise.resolve(null),
      ]);
      if (requestId !== getRequestId("globalStats")) {
        return;
      }
      set({
        globalSummary: summary,
        globalConversationSummary: conversationSummary,
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
