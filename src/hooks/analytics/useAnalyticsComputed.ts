import { useMemo } from "react";
import { useAppStore } from "../../store/useAppStore";

export function useAnalyticsComputed() {
  const analytics = useAppStore((s) => s.analytics);
  const isLoadingTokenStats = useAppStore((s) => s.isLoadingTokenStats);

  return useMemo(
    () => ({
      isTokenStatsView: analytics.currentView === "tokenStats",
      isAnalyticsView: analytics.currentView === "analytics",
      isMessagesView: analytics.currentView === "messages",
      isRecentEditsView: analytics.currentView === "recentEdits",
      isSettingsView: analytics.currentView === "settings",
      isBoardView: analytics.currentView === "board",
      isArchiveView: analytics.currentView === "archive",
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
      analytics.currentView,
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
