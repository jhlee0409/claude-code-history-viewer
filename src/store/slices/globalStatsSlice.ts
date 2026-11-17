/**
 * Global Stats Slice
 *
 * Handles global statistics across all projects.
 */

import type { GlobalStatsSummary } from "../../types";
import type { StateCreator } from "zustand";
import { toast } from "sonner";
import type { FullAppStore } from "./types";
import { ownWork } from "@/navigation/ownership";
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

    // Custom Claude directories must be aggregated into the global summary too,
    // matching the project list and search (#362).
    const customClaudePaths = get().userMetadata?.settings?.customClaudePaths;

    // Global stats are not scoped to a project: the latest request owns the
    // data; feedback also needs the place it started on.
    const owner = ownWork(get, {
      isLatest: () => requestId === getRequestId("globalStats"),
    });
    set({ isLoadingGlobalStats: true });

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
          customClaudePaths,
        ),
        canLoadConversationSummary
          ? fetchGlobalStatsSummary(
              claudePath,
              "conversation_only",
              activeProviders,
              startDate,
              endDate,
              customClaudePaths,
            ).catch((error) => {
              console.warn(
                "Failed to load conversation-only global stats:",
                error
              );
              if (owner.ownsFeedback()) {
                toast.warning(
                  "Conversation-only global stats could not be loaded. Showing billing totals only."
                );
              }
              return null;
            })
          : Promise.resolve(null),
      ]);
      if (!owner.ownsData()) return;
      set({
        globalSummary: summary,
        globalConversationSummary: canLoadConversationSummary
          ? conversationSummary
          : summary,
      });
    } catch (error) {
      console.error("Failed to load global stats:", error);
      if (!owner.ownsData()) return;
      set({ globalSummary: null, globalConversationSummary: null });
      if (!owner.ownsFeedback()) return;
      const message = error instanceof Error ? error.message : String(error);
      // The screen is one tab's: its notification, never the app's error
      // screen (which would hide every tab).
      toast.error(`Failed to load global stats: ${message}`);
    } finally {
      if (owner.ownsSpinner()) {
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
