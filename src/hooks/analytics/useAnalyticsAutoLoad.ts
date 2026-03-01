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

  /**
   * Session change auto-refresh for analytics view
   */
  useEffect(() => {
    if (analytics.isLoadingSessionComparison || isLoadingTokenStats) {
      return;
    }

    if (
      analytics.currentView === "analytics" &&
      selectedProject &&
      selectedSession
    ) {
      const autoloadKey = `${selectedSession.actual_session_id}:${dateFilter.start?.getTime() ?? "none"}:${dateFilter.end?.getTime() ?? "none"}`;
      const hasCachedSessionComparison =
        analytics.sessionComparison?.session_id ===
        selectedSession.actual_session_id;
      const hasCachedSessionTokenStats =
        sessionTokenStats?.session_id === selectedSession.actual_session_id;

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
                selectedSession.actual_session_id,
                selectedProject.path
              ).then((comparison) => {
                setAnalyticsSessionComparison(comparison);
                setAnalyticsSessionComparisonError(null);
              })
            );
          }

          if (!hasCachedSessionTokenStats) {
            promises.push(
              loadSessionTokenStats(selectedSession.file_path)
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
    selectedSession?.actual_session_id,
    selectedProject?.path,
    selectedProject,
    selectedSession,
    dateFilter.start?.getTime(),
    dateFilter.end?.getTime(),
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

    if (analytics.currentView === "tokenStats" && selectedSession) {
      const autoloadKey = `${selectedSession.actual_session_id}:${dateFilter.start?.getTime() ?? "none"}:${dateFilter.end?.getTime() ?? "none"}`;
      const hasCachedSessionTokenStats =
        sessionTokenStats?.session_id === selectedSession.actual_session_id;

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
          await loadSessionTokenStats(selectedSession.file_path);
        } catch (error) {
          console.error("Failed to update session token stats:", error);
        }
      };

      updateSessionTokenStats();
    }
  }, [
    dateFilter.start?.getTime(),
    dateFilter.end?.getTime(),
    selectedSession?.actual_session_id,
    selectedSession?.file_path,
    selectedSession,
    sessionTokenStats?.session_id,
    analytics.currentView,
    isLoadingTokenStats,
    loadSessionTokenStats,
  ]);

  /**
   * Date filter change auto-refresh
   */
  useEffect(() => {
    const currentDateFilterKey = `${dateFilter.start?.getTime() ?? "none"}:${dateFilter.end?.getTime() ?? "none"}`;

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

    const isGlobalScope =
      !selectedProject && analytics.currentView === "analytics";

    const update = async () => {
      try {
        if (isGlobalScope) {
          await loadGlobalStats();
          return;
        }

        if (!selectedProject) {
          return;
        }

        if (computed.isTokenStatsView) {
          const promises: Promise<unknown>[] = [
            loadProjectTokenStats(selectedProject.path),
          ];
          if (selectedSession) {
            promises.push(
              loadSessionTokenStats(selectedSession.file_path)
            );
          }
          await Promise.all(promises);
          if (isStaleRequest()) {
            return;
          }
        } else if (computed.isAnalyticsView) {
          setAnalyticsLoadingProjectSummary(true);
          const summary = await loadProjectStatsSummary(
            selectedProject.path
          );
          if (isStaleRequest()) {
            return;
          }
          setAnalyticsProjectSummary(summary);

          if (selectedSession) {
            setAnalyticsLoadingSessionComparison(true);
            try {
              const [comparison] = await Promise.all([
                loadSessionComparison(
                  selectedSession.actual_session_id,
                  selectedProject.path
                ),
                loadSessionTokenStats(selectedSession.file_path),
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
    dateFilter.start?.getTime(),
    dateFilter.end?.getTime(),
    analytics.currentView,
    computed.isTokenStatsView,
    computed.isAnalyticsView,
    selectedSession?.actual_session_id,
    selectedSession?.file_path,
    selectedProject?.path,
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
