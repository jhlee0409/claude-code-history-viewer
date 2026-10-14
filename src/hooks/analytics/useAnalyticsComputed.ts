import { useMemo } from "react";
import { useAppStore } from "../../store/useAppStore";

/**
 * Screen flags for the current place. One flag per `view`; global stats is
 * its own screen (`isGlobalStatsView`), not project analytics plus a flag.
 */
export function useAnalyticsComputed() {
  const view = useAppStore((s) => s.view);
  const analytics = useAppStore((s) => s.analytics);
  const isLoadingTokenStats = useAppStore((s) => s.isLoadingTokenStats);

  return useMemo(
    () => ({
      isTokenStatsView: view === "tokenStats",
      isAnalyticsView: view === "analytics",
      isGlobalStatsView: view === "globalStats",
      isMessagesView: view === "conversation",
      isRecentEditsView: view === "edits",
      isSettingsView: view === "settingsManager",
      isBoardView: view === "board",
      isArchiveView: view === "archive",
      hasAnyError: !!(
        analytics.projectSummaryError ||
        analytics.sessionComparisonError ||
        analytics.recentEditsError
      ),
      isLoadingAnalytics:
        analytics.isLoadingProjectSummary ||
        analytics.isLoadingSessionComparison,
      isLoadingTokenStats,
      isLoadingRecentEdits: analytics.isLoadingRecentEdits,
      isAnyLoading:
        analytics.isLoadingProjectSummary ||
        analytics.isLoadingSessionComparison ||
        analytics.isLoadingRecentEdits ||
        isLoadingTokenStats,
    }),
    [
      view,
      analytics.projectSummaryError,
      analytics.sessionComparisonError,
      analytics.recentEditsError,
      analytics.isLoadingProjectSummary,
      analytics.isLoadingSessionComparison,
      analytics.isLoadingRecentEdits,
      isLoadingTokenStats,
    ]
  );
}
