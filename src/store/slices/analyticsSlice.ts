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
  MetricMode,
  StatsMode,
} from "../../types";
import type { AnalyticsState, AnalyticsViewType } from "../../types/analytics";
import { initialAnalyticsState } from "../../types/analytics";
import type { StateCreator } from "zustand";
import { toast } from "sonner";
import type { FullAppStore } from "./types";
import { fetchRecentEdits } from "../../services/analyticsApi";
import { canLoadMore } from "../../utils/pagination";

const RECENT_EDITS_PAGE_SIZE = 20;

/**
 * Identifies the newest load-more request. Deliberately module state rather
 * than store state: it is not something any view renders, and the navigation
 * hook keeps its own request sequence the same way.
 */
let recentEditsLoadMoreSeq = 0;

// ============================================================================
// State Interface
// ============================================================================

export interface AnalyticsSliceState {
  analytics: AnalyticsState;
}

export interface AnalyticsSliceActions {
  setAnalyticsCurrentView: (view: AnalyticsViewType) => void;
  setAnalyticsStatsMode: (mode: StatsMode) => void;
  setAnalyticsMetricMode: (mode: MetricMode) => void;
  setAnalyticsProjectSummary: (summary: ProjectStatsSummary | null) => void;
  setAnalyticsProjectConversationSummary: (summary: ProjectStatsSummary | null) => void;
  setAnalyticsSessionComparison: (comparison: SessionComparison | null) => void;
  setAnalyticsLoadingProjectSummary: (loading: boolean) => void;
  setAnalyticsLoadingSessionComparison: (loading: boolean) => void;
  setAnalyticsProjectSummaryError: (error: string | null) => void;
  setAnalyticsSessionComparisonError: (error: string | null) => void;
  setAnalyticsRecentEdits: (edits: RecentEditsResult | null) => void;
  setAnalyticsRecentEditsSearchQuery: (query: string) => void;
  setAnalyticsLoadingRecentEdits: (loading: boolean) => void;
  setAnalyticsRecentEditsError: (error: string | null) => void;
  loadRecentEdits: (projectPath: string) => Promise<PaginatedRecentEdits>;
  loadMoreRecentEdits: (projectPath: string) => Promise<void>;
  invalidateRecentEdits: (projectPath: string) => void;
  resetAnalytics: () => void;
  clearAnalyticsErrors: () => void;
}

export type AnalyticsSlice = AnalyticsSliceState & AnalyticsSliceActions;

// ============================================================================
// Initial State
// ============================================================================

const initialAnalyticsSliceState: AnalyticsSliceState = {
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

  setAnalyticsStatsMode: (mode: StatsMode) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        statsMode: mode,
      },
    }));
  },

  setAnalyticsMetricMode: (mode: MetricMode) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        metricMode: mode,
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

  setAnalyticsProjectConversationSummary: (summary: ProjectStatsSummary | null) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        projectConversationSummary: summary,
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
        // Bumping here, rather than at each call site, is what makes the
        // generation true for all three writers of the cache without any of
        // them having to remember.
        recentEditsGeneration: state.analytics.recentEditsGeneration + 1,
      },
    }));
  },

  invalidateRecentEdits: (projectPath: string) => {
    const cached = get().analytics.recentEdits;
    // Only the entry fetched for this project is stale. An entry belonging to
    // another project is somebody else's cache, and a `null` one has nothing
    // to invalidate.
    if (!cached || cached.requestedProjectPath !== projectPath) {
      return;
    }

    set((state) => ({
      analytics: {
        ...state.analytics,
        // The rows stay; only the identity that makes them reusable is
        // dropped. Clearing the data instead would blank the panel under a
        // user who is reading it, on nothing more than a background file
        // event. The next visit misses the guard and refetches.
        recentEdits: { ...cached, requestedProjectPath: undefined },
        // Declaring the list stale has to stop a load-more that is already in
        // flight from appending a page to it, the same way a refresh does.
        recentEditsGeneration: state.analytics.recentEditsGeneration + 1,
      },
    }));
  },

  setAnalyticsRecentEditsSearchQuery: (query: string) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        recentEditsSearchQuery: query,
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
    // Required parameters are guarded at the top, per the repo checklist. An
    // empty path would otherwise reach the backend as an invalid argument.
    if (!projectPath.trim()) {
      return;
    }

    const { analytics } = get();
    const { recentEditsPagination, recentEdits } = analytics;

    if (!canLoadMore(recentEditsPagination)) {
      return;
    }

    // The cached rows and the pagination cursor may belong to a different
    // project than the one being asked for. Appending here would staple one
    // project's page onto another's rows and then tag the mixture with a
    // request identity that looks valid to the cache guard.
    //
    // An exact match, rather than "not some other owner": an absent cache is
    // not something to extend either, because there is no page to continue.
    // Every writer records the path it fetched for, so a legitimate caller
    // always has one.
    if (recentEdits?.requestedProjectPath !== projectPath) {
      return;
    }

    // Set loading state
    const requestId = ++recentEditsLoadMoreSeq;
    set((state) => ({
      analytics: {
        ...state.analytics,
        recentEditsPagination: {
          ...state.analytics.recentEditsPagination,
          isLoadingMore: true,
        },
      },
    }));

    // Only the newest request may release the flag. It is global, so a
    // superseded request clearing it re-enables Show More while a newer one is
    // still running, and the extra click costs a full walk of the project's
    // logs even though the generation check would discard its rows.
    //
    // Ownership here is "newest", not "same project". A request nobody has
    // superseded still releases the flag on its way out, which is what keeps
    // it from being stranded when its own project is deselected.
    const releaseLoadingFlag = () => {
      if (recentEditsLoadMoreSeq !== requestId) return;
      set((state) => ({
        analytics: {
          ...state.analytics,
          recentEditsPagination: {
            ...state.analytics.recentEditsPagination,
            isLoadingMore: false,
          },
        },
      }));
    };

    // The version of the list this page is being fetched to continue.
    const generation = analytics.recentEditsGeneration;

    try {
      // The rows already held ARE the next offset. A stored cursor is a second
      // copy of that fact, and the two desync the moment the list is replaced
      // without the cursor being reset, which `setAnalyticsRecentEdits` cannot
      // do because it does not own the cursor. The dock panel already derives
      // its offset this way.
      const nextOffset = recentEdits.files.length;

      const result = await fetchRecentEdits(projectPath, {
        offset: nextOffset,
        limit: RECENT_EDITS_PAGE_SIZE,
      });

      // The pre-await guard above only proves ownership at the moment the
      // request started. The other two cache writers already re-check after
      // their await; this one did not, so a page fetched for project A could
      // still land after the user selected B, under B's pagination state.
      const latest = get();
      // Ownership answers "whose list is this". The generation answers "which
      // version of it", which ownership cannot: a refresh can replace the list
      // with one of the same length under the same owner, and this page does
      // not continue that one.
      if (
        recentEditsLoadMoreSeq !== requestId ||
        latest.selectedProject?.path !== projectPath ||
        latest.analytics.recentEdits?.requestedProjectPath !== projectPath ||
        latest.analytics.recentEditsGeneration !== generation
      ) {
        releaseLoadingFlag();
        return;
      }

      // Append new files to existing list. The guard above has already proven
      // this cache is present, owned and current.
      const existingFiles = latest.analytics.recentEdits.files;
      const newFiles = [...existingFiles, ...result.files];

      set((state) => ({
        analytics: {
          ...state.analytics,
          recentEdits: {
            files: newFiles,
            total_edits_count: result.total_edits_count,
            unique_files_count: result.unique_files_count,
            project_cwd: result.project_cwd,
            requestedProjectPath: projectPath,
          },
          // This write is a new version of the list too, so a second page
          // racing this one cannot also commit.
          recentEditsGeneration: state.analytics.recentEditsGeneration + 1,
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
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to load more recent edits:", error);

      // The same predicate the success path uses. Reporting a failure is a
      // write to state shared with whatever is on screen now, so a request the
      // user has already navigated away from must not do it.
      const latest = get();
      const stillOwns =
        recentEditsLoadMoreSeq === requestId &&
        latest.selectedProject?.path === projectPath &&
        latest.analytics.recentEdits?.requestedProjectPath === projectPath &&
        latest.analytics.recentEditsGeneration === generation;

      if (stillOwns) {
        toast.error(`Failed to load more edits: ${message}`);
        set((state) => ({
          analytics: {
            ...state.analytics,
            recentEditsError: `Failed to load more edits: ${message}`,
          },
        }));
      }

      releaseLoadingFlag();
    }
  },

  resetAnalytics: () => {
    // Everything else goes back to its initial value, but the generation is a
    // counter rather than a value: restoring it to 0 makes its numbers
    // reusable, and a request in flight that captured the old 1 would then be
    // accepted by the new 1. It only ever moves forward.
    set((state) => ({
      analytics: {
        ...initialAnalyticsState,
        recentEditsGeneration: state.analytics.recentEditsGeneration + 1,
      },
    }));
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
