/**
 * Analytics Slice
 *
 * Handles analytics dashboard state. The Edits screen's rows live in
 * `recentEditsSlice` (T9b).
 */

import type {
  ProjectStatsSummary,
  SessionComparison,
  MetricMode,
  StatsMode,
} from "../../types";
import type { AnalyticsState } from "../../types/analytics";
import { initialAnalyticsState } from "../../types/analytics";
import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";

// ============================================================================
// State Interface
// ============================================================================

export interface AnalyticsSliceState {
  analytics: AnalyticsState;
}

export interface AnalyticsSliceActions {
  setAnalyticsStatsMode: (mode: StatsMode) => void;
  setAnalyticsMetricMode: (mode: MetricMode) => void;
  // Every value is written with its owner (`navigation/screenOwner.ts`):
  // the project path it was loaded for, or the session file path for the
  // session comparison. Only a clear (`null`) has none.
  setAnalyticsProjectSummary: OwnedSetter<ProjectStatsSummary>;
  setAnalyticsProjectConversationSummary: OwnedSetter<ProjectStatsSummary>;
  setAnalyticsSessionComparison: OwnedSetter<SessionComparison>;
  setAnalyticsLoadingProjectSummary: (loading: boolean) => void;
  setAnalyticsLoadingSessionComparison: (loading: boolean) => void;
  setAnalyticsProjectSummaryError: OwnedSetter<string>;
  setAnalyticsSessionComparisonError: OwnedSetter<string>;
  /** The Board's file link opens the Edits screen searching for that file. */
  setAnalyticsRecentEditsSearchQuery: (query: string) => void;
  resetAnalytics: () => void;
  clearAnalyticsErrors: () => void;
}

/** A screen value's setter: a value with the place it was loaded for, or a clear. */
export interface OwnedSetter<T> {
  (value: null): void;
  (value: T, owner: string): void;
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
> = (set) => ({
  ...initialAnalyticsSliceState,

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

  setAnalyticsProjectSummary: (summary: ProjectStatsSummary | null, owner?: string) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        projectSummary: summary,
        projectSummaryOwner: summary ? (owner ?? null) : null,
      },
    }));
  },

  setAnalyticsProjectConversationSummary: (summary: ProjectStatsSummary | null, owner?: string) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        projectConversationSummary: summary,
        projectConversationSummaryOwner: summary ? (owner ?? null) : null,
      },
    }));
  },

  setAnalyticsSessionComparison: (comparison: SessionComparison | null, owner?: string) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        sessionComparison: comparison,
        sessionComparisonOwner: comparison ? (owner ?? null) : null,
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

  setAnalyticsProjectSummaryError: (error: string | null, owner?: string) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        projectSummaryError: error,
        projectSummaryErrorOwner: error ? (owner ?? null) : null,
      },
    }));
  },

  setAnalyticsSessionComparisonError: (error: string | null, owner?: string) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        sessionComparisonError: error,
        sessionComparisonErrorOwner: error ? (owner ?? null) : null,
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

  resetAnalytics: () => {
    set({ analytics: initialAnalyticsState });
  },

  clearAnalyticsErrors: () => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        projectSummaryError: null,
        sessionComparisonError: null,
        projectSummaryErrorOwner: null,
        sessionComparisonErrorOwner: null,
      },
    }));
  },
});
