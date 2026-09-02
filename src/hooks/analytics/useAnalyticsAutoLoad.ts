import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAppStore } from "../../store/useAppStore";

/**
 * Auto-load side effects for analytics data.
 * Watches for session/date-filter changes and refreshes data accordingly.
 *
 * @param computed - Computed view flags from useAnalyticsComputed
 */
export function useAnalyticsAutoLoad(computed: {
  isTokenStatsView: boolean;
  isAnalyticsView: boolean;
}) {
  const { t } = useTranslation();
  const dateFilterKeyRef = useRef<string | null>(null);
  const dateFilterRequestSeqRef = useRef(0);
  const analyticsSessionAutoloadAttemptKeyRef = useRef<string | null>(null);
  const tokenStatsSessionAutoloadAttemptKeyRef = useRef<string | null>(null);

  const {
    analytics,
    selectedProject,
    selectedSession,
    isLoadingTokenStats,
    sessionTokenStats,
    dateFilter,
    setAnalyticsProjectSummary,
    setAnalyticsSessionComparison,
    setAnalyticsLoadingProjectSummary,
    setAnalyticsLoadingSessionComparison,
    setAnalyticsProjectSummaryError,
    setAnalyticsSessionComparisonError,
    loadProjectTokenStats,
    loadProjectStatsSummary,
    loadSessionComparison,
    loadSessionTokenStats,
    loadGlobalStats,
  } = useAppStore();
  const dateFilterStartMs = dateFilter.start?.getTime() ?? null;
  const dateFilterEndMs = dateFilter.end?.getTime() ?? null;
  const selectedProjectPath = selectedProject?.path ?? null;
  const selectedSessionId = selectedSession?.actual_session_id ?? null;
  const selectedSessionFilePath = selectedSession?.file_path ?? null;

  /**
   * Session change auto-refresh for analytics view
   */
  useEffect(() => {
    if (analytics.isLoadingSessionComparison || isLoadingTokenStats) {
      return;
    }

    if (
      analytics.currentView === "analytics" &&
      selectedProjectPath &&
      selectedSessionId &&
      selectedSessionFilePath
    ) {
      const autoloadKey = `${selectedSessionId}:${dateFilterStartMs ?? "none"}:${dateFilterEndMs ?? "none"}`;
      const hasCachedSessionComparison =
        analytics.sessionComparison?.session_id === selectedSessionId;
      const hasCachedSessionTokenStats =
        sessionTokenStats?.session_id === selectedSessionId;

      if (hasCachedSessionComparison && hasCachedSessionTokenStats) {
        analyticsSessionAutoloadAttemptKeyRef.current = null;
        return;
      }
      if (
        analyticsSessionAutoloadAttemptKeyRef.current === autoloadKey
      ) {
        return;
      }
      analyticsSessionAutoloadAttemptKeyRef.current = autoloadKey;

      const updateSessionData = async () => {
        try {
          setAnalyticsLoadingSessionComparison(true);

          const promises: Promise<unknown>[] = [];

          if (!hasCachedSessionComparison) {
            promises.push(
              loadSessionComparison(
                selectedSessionId,
                selectedProjectPath
              ).then((comparison) => {
                setAnalyticsSessionComparison(comparison);
                setAnalyticsSessionComparisonError(null);
              })
            );
          }

          if (!hasCachedSessionTokenStats) {
            promises.push(
              loadSessionTokenStats(selectedSessionFilePath)
            );
          }

          await Promise.all(promises);
        } catch (error) {
          const errorMessage =
            error instanceof Error
              ? error.message
              : t("common.hooks.sessionComparisonLoadFailed");
          setAnalyticsSessionComparisonError(errorMessage);
          console.error("Failed to update session data:", error);
        } finally {
          setAnalyticsLoadingSessionComparison(false);
        }
      };

      updateSessionData();
    }
  }, [
    t,
    selectedSessionId,
    selectedSessionFilePath,
    selectedProjectPath,
    dateFilterStartMs,
    dateFilterEndMs,
    sessionTokenStats?.session_id,
    analytics.currentView,
    analytics.sessionComparison?.session_id,
    analytics.isLoadingSessionComparison,
    isLoadingTokenStats,
    loadSessionComparison,
    loadSessionTokenStats,
    setAnalyticsLoadingSessionComparison,
    setAnalyticsSessionComparison,
    setAnalyticsSessionComparisonError,
  ]);

  /**
   * Session change auto-refresh for token stats view
   */
  useEffect(() => {
    if (isLoadingTokenStats) {
      return;
    }

    if (
      analytics.currentView === "tokenStats" &&
      selectedSessionId &&
      selectedSessionFilePath
    ) {
      const autoloadKey = `${selectedSessionId}:${dateFilterStartMs ?? "none"}:${dateFilterEndMs ?? "none"}`;
      const hasCachedSessionTokenStats =
        sessionTokenStats?.session_id === selectedSessionId;

      if (hasCachedSessionTokenStats) {
        tokenStatsSessionAutoloadAttemptKeyRef.current = null;
        return;
      }
      if (
        tokenStatsSessionAutoloadAttemptKeyRef.current === autoloadKey
      ) {
        return;
      }
      tokenStatsSessionAutoloadAttemptKeyRef.current = autoloadKey;

      const updateSessionTokenStats = async () => {
        try {
          await loadSessionTokenStats(selectedSessionFilePath);
        } catch (error) {
          console.error("Failed to update session token stats:", error);
        }
      };

      updateSessionTokenStats();
    }
  }, [
    dateFilterStartMs,
    dateFilterEndMs,
    selectedSessionId,
    selectedSessionFilePath,
    sessionTokenStats?.session_id,
    analytics.currentView,
    isLoadingTokenStats,
    loadSessionTokenStats,
  ]);

  /**
   * Date filter change auto-refresh
   */
  useEffect(() => {
    const currentDateFilterKey = `${dateFilterStartMs ?? "none"}:${dateFilterEndMs ?? "none"}`;

    if (dateFilterKeyRef.current === null) {
      dateFilterKeyRef.current = currentDateFilterKey;
      return;
    }
    if (dateFilterKeyRef.current === currentDateFilterKey) {
      return;
    }
    dateFilterKeyRef.current = currentDateFilterKey;
    const requestSeq = ++dateFilterRequestSeqRef.current;
    const isStaleRequest = () =>
      requestSeq !== dateFilterRequestSeqRef.current;

    // Global stats may be open with a project still selected (the overview
    // no longer clears the selection), so ask the flag, not the selection.
    const isGlobalScope =
      (useAppStore.getState().isViewingGlobalStats || !selectedProjectPath) &&
      analytics.currentView === "analytics";

    const update = async () => {
      try {
        if (isGlobalScope) {
          await loadGlobalStats();
          return;
        }

        if (!selectedProjectPath) {
          return;
        }

        if (computed.isTokenStatsView) {
          const promises: Promise<unknown>[] = [
            loadProjectTokenStats(selectedProjectPath),
          ];
          if (selectedSessionFilePath) {
            promises.push(
              loadSessionTokenStats(selectedSessionFilePath)
            );
          }
          await Promise.all(promises);
          if (isStaleRequest()) {
            return;
          }
        } else if (computed.isAnalyticsView) {
          setAnalyticsLoadingProjectSummary(true);
          const summary = await loadProjectStatsSummary(
            selectedProjectPath
          );
          if (isStaleRequest()) {
            return;
          }
          setAnalyticsProjectSummary(summary);

          if (selectedSessionId && selectedSessionFilePath) {
            setAnalyticsLoadingSessionComparison(true);
            try {
              const [comparison] = await Promise.all([
                loadSessionComparison(
                  selectedSessionId,
                  selectedProjectPath
                ),
                loadSessionTokenStats(selectedSessionFilePath),
              ]);
              if (isStaleRequest()) {
                return;
              }
              setAnalyticsSessionComparison(comparison);
              setAnalyticsSessionComparisonError(null);
            } catch (err) {
              if (isStaleRequest()) {
                return;
              }
              const message =
                err instanceof Error
                  ? err.message
                  : t("common.hooks.sessionComparisonLoadFailed");
              setAnalyticsSessionComparison(null);
              setAnalyticsSessionComparisonError(message);
            } finally {
              setAnalyticsLoadingSessionComparison(false);
            }
          } else {
            setAnalyticsSessionComparison(null);
            setAnalyticsSessionComparisonError(null);
          }
        }
      } catch (err) {
        if (isStaleRequest()) {
          return;
        }
        const message =
          err instanceof Error
            ? err.message
            : t("common.hooks.projectSummaryLoadFailed");
        setAnalyticsProjectSummaryError(message);
        toast.error(message);
      } finally {
        if (computed.isAnalyticsView) {
          setAnalyticsLoadingProjectSummary(false);
        }
      }
    };

    if (
      isGlobalScope ||
      computed.isTokenStatsView ||
      computed.isAnalyticsView
    ) {
      void update();
    }
  }, [
    dateFilterStartMs,
    dateFilterEndMs,
    analytics.currentView,
    computed.isTokenStatsView,
    computed.isAnalyticsView,
    selectedSessionId,
    selectedSessionFilePath,
    selectedProjectPath,
    loadGlobalStats,
    loadProjectTokenStats,
    loadSessionTokenStats,
    loadProjectStatsSummary,
    loadSessionComparison,
    setAnalyticsLoadingProjectSummary,
    setAnalyticsLoadingSessionComparison,
    setAnalyticsProjectSummary,
    setAnalyticsSessionComparison,
    setAnalyticsSessionComparisonError,
    setAnalyticsProjectSummaryError,
    t,
  ]);
}
