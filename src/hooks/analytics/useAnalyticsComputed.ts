import { useMemo } from "react";
import { useAppStore } from "../../store/useAppStore";
import { isProjectView, type View } from "../../navigation/place";

/**
 * The screen that renders for a view (plan §4.1 validity): a project screen
 * without a project renders the empty screen. `navigate` already lands there;
 * this is the render-side half, so no state can show a project screen that
 * has no project.
 */
function screenFor(view: View, hasProject: boolean): View {
  return isProjectView(view) && !hasProject ? "empty" : view;
}

/**
 * Screen flags for the current place. One flag per screen; global stats is
 * its own screen (`isGlobalStatsView`), not project analytics plus a flag.
 */
export function useAnalyticsComputed() {
  const hasProject = useAppStore((s) => s.selectedProject != null);
  const view = screenFor(useAppStore((s) => s.view), hasProject);
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
      isEmptyView: view === "empty",
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
