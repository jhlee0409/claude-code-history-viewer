import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAppStore } from "../../store/useAppStore";
import { ownPlace } from "../../navigation/ownership";
import {
  loadProjectAnalytics,
  loadSessionAnalytics,
} from "../../navigation/screenData";

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

  const view = useAppStore((s) => s.view);
  const {
    analytics,
    selectedProject,
    selectedSession,
    isLoadingTokenStats,
    sessionTokenStats,
    dateFilter,
    loadProjectTokenStats,
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
      view === "analytics" &&
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

      // A reload of the open screen's data, owned like any other screen load
      // (`loadSessionAnalytics`): a navigation since it started drops it.
      const project = useAppStore.getState().selectedProject;
      const session = useAppStore.getState().selectedSession;
      const updateSessionData = async () => {
        if (!project || !session) return;
        await loadSessionAnalytics(useAppStore.getState, project, session, {
          comparison: !hasCachedSessionComparison,
          tokenStats: !hasCachedSessionTokenStats,
          failureText: t("common.hooks.sessionComparisonLoadFailed"),
        });
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
    view,
    analytics.sessionComparison?.session_id,
    analytics.isLoadingSessionComparison,
    isLoadingTokenStats,
  ]);

  /**
   * Session change auto-refresh for token stats view
   */
  useEffect(() => {
    if (isLoadingTokenStats) {
      return;
    }

    if (
      view === "tokenStats" &&
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
    view,
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
    // A reload of the open screen: a newer date change or any navigation
    // since then owns what it would write.
    const ownsPlace = ownPlace(useAppStore.getState);
    const isStaleRequest = () =>
      requestSeq !== dateFilterRequestSeqRef.current || !ownsPlace();

    // Global stats keeps the project selected, so ask the screen, not the
    // selection. Project analytics without a project renders the overview too.
    const isGlobalScope =
      view === "globalStats" || (!selectedProjectPath && view === "analytics");

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
          const { selectedProject: project, selectedSession: session } =
            useAppStore.getState();
          if (!project) return;
          await loadProjectAnalytics(useAppStore.getState, project, session, {
            ownsPlace,
            clearComparisonWithoutSession: true,
            failureText: {
              summary: t("common.hooks.projectSummaryLoadFailed"),
              comparison: t("common.hooks.sessionComparisonLoadFailed"),
            },
          });
        }
      } catch (err) {
        if (isStaleRequest()) {
          return;
        }
        // Global and token stats. Project analytics never lands here: its
        // loader records and reports a failure itself.
        const message =
          err instanceof Error
            ? err.message
            : t("common.hooks.projectSummaryLoadFailed");
        toast.error(message);
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
    view,
    computed.isTokenStatsView,
    computed.isAnalyticsView,
    selectedSessionId,
    selectedSessionFilePath,
    selectedProjectPath,
    loadGlobalStats,
    loadProjectTokenStats,
    loadSessionTokenStats,
    t,
  ]);
}
