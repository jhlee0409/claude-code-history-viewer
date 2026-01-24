/**
 * Analytics Slice
 *
 * Handles analytics dashboard state and recent edits.
 */

import type {
  ProjectStatsSummary,
  SessionComparison,
  RecentEditsResult,
  PaginatedRecentEdits,
} from "../../types";
import type { AnalyticsState, AnalyticsViewType } from "../../types/analytics";
import { initialAnalyticsState } from "../../types/analytics";
import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";
import { fetchRecentEdits } from "../../services/analyticsApi";
import { canLoadMore, getNextOffset } from "../../utils/pagination";

const RECENT_EDITS_PAGE_SIZE = 20;

// ============================================================================
// State Interface
// ============================================================================

export interface AnalyticsSliceState {
  analytics: AnalyticsState;
}

export interface AnalyticsSliceActions {
  setAnalyticsCurrentView: (view: AnalyticsViewType) => void;
  setAnalyticsProjectSummary: (summary: ProjectStatsSummary | null) => void;
  setAnalyticsSessionComparison: (comparison: SessionComparison | null) => void;
  setAnalyticsLoadingProjectSummary: (loading: boolean) => void;
  setAnalyticsLoadingSessionComparison: (loading: boolean) => void;
  setAnalyticsProjectSummaryError: (error: string | null) => void;
  setAnalyticsSessionComparisonError: (error: string | null) => void;
  setAnalyticsRecentEdits: (edits: RecentEditsResult | null) => void;
  setAnalyticsLoadingRecentEdits: (loading: boolean) => void;
  setAnalyticsRecentEditsError: (error: string | null) => void;
  loadRecentEdits: (projectPath: string) => Promise<PaginatedRecentEdits>;
  loadMoreRecentEdits: (projectPath: string) => Promise<void>;
  resetAnalytics: () => void;
  clearAnalyticsErrors: () => void;
}

export type AnalyticsSlice = AnalyticsSliceState & AnalyticsSliceActions;

// ============================================================================
// Initial State
// ============================================================================

export const initialAnalyticsSliceState: AnalyticsSliceState = {
  analytics: initialAnalyticsState,
};

// ============================================================================
// Slice Creator
// ============================================================================

export const createAnalyticsSlice: StateCreator<
  FullAppStore,
  [],
  [],
  AnalyticsSlice
> = (set, get) => ({
  ...initialAnalyticsSliceState,

  setAnalyticsCurrentView: (view: AnalyticsViewType) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        currentView: view,
      },
    }));
  },

  setAnalyticsProjectSummary: (summary: ProjectStatsSummary | null) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        projectSummary: summary,
      },
    }));
  },

  setAnalyticsSessionComparison: (comparison: SessionComparison | null) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        sessionComparison: comparison,
      },
    }));
  },

  setAnalyticsLoadingProjectSummary: (loading: boolean) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        isLoadingProjectSummary: loading,
      },
    }));
  },

  setAnalyticsLoadingSessionComparison: (loading: boolean) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        isLoadingSessionComparison: loading,
      },
    }));
  },

  setAnalyticsProjectSummaryError: (error: string | null) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        projectSummaryError: error,
      },
    }));
  },

  setAnalyticsSessionComparisonError: (error: string | null) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        sessionComparisonError: error,
      },
    }));
  },

  setAnalyticsRecentEdits: (edits: RecentEditsResult | null) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        recentEdits: edits,
      },
    }));
  },

  setAnalyticsLoadingRecentEdits: (loading: boolean) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        isLoadingRecentEdits: loading,
      },
    }));
  },

  setAnalyticsRecentEditsError: (error: string | null) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        recentEditsError: error,
      },
    }));
  },

  loadRecentEdits: async (projectPath: string) => {
    return fetchRecentEdits(projectPath, {
      offset: 0,
      limit: RECENT_EDITS_PAGE_SIZE,
    });
  },

  loadMoreRecentEdits: async (projectPath: string) => {
    const { analytics } = get();
    const { recentEditsPagination, recentEdits } = analytics;

    if (!canLoadMore(recentEditsPagination)) {
      return;
    }

    // Set loading state
    set((state) => ({
      analytics: {
        ...state.analytics,
        recentEditsPagination: {
          ...state.analytics.recentEditsPagination,
          isLoadingMore: true,
        },
      },
    }));

    try {
      const nextOffset = getNextOffset(recentEditsPagination);

      const result = await fetchRecentEdits(projectPath, {
        offset: nextOffset,
        limit: RECENT_EDITS_PAGE_SIZE,
      });

      // Append new files to existing list
      const existingFiles = recentEdits?.files ?? [];
      const newFiles = [...existingFiles, ...result.files];

      set((state) => ({
        analytics: {
          ...state.analytics,
          recentEdits: {
            files: newFiles,
            total_edits_count: result.total_edits_count,
            unique_files_count: result.unique_files_count,
            project_cwd: result.project_cwd,
          },
          recentEditsPagination: {
            totalEditsCount: result.total_edits_count,
            uniqueFilesCount: result.unique_files_count,
            offset: result.offset,
            limit: result.limit,
            hasMore: result.has_more,
            isLoadingMore: false,
          },
        },
      }));
    } catch (error) {
      console.error("Failed to load more recent edits:", error);
      set((state) => ({
        analytics: {
          ...state.analytics,
          recentEditsPagination: {
            ...state.analytics.recentEditsPagination,
            isLoadingMore: false,
          },
        },
      }));
    }
  },

  resetAnalytics: () => {
    set({ analytics: initialAnalyticsState });
  },

  clearAnalyticsErrors: () => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        projectSummaryError: null,
        sessionComparisonError: null,
        recentEditsError: null,
      },
    }));
  },
});
