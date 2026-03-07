import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAppStore } from "../../store/useAppStore";
import { AppErrorType, type MetricMode, type StatsMode } from "../../types";

export function useAnalyticsNavigation() {
  const { t } = useTranslation();
  const {
    analytics,
    selectedSession,
    setAnalyticsCurrentView,
    setAnalyticsStatsMode,
    setAnalyticsMetricMode,
    setAnalyticsProjectSummary,
    setAnalyticsProjectConversationSummary,
    setAnalyticsSessionComparison,
    setAnalyticsLoadingProjectSummary,
    setAnalyticsLoadingSessionComparison,
    setAnalyticsProjectSummaryError,
    setAnalyticsSessionComparisonError,
    setAnalyticsRecentEdits,
    setAnalyticsLoadingRecentEdits,
    setAnalyticsRecentEditsError,
    resetAnalytics,
    clearAnalyticsErrors,
    loadProjectTokenStats,
    loadProjectStatsSummary,
    loadSessionComparison,
    loadSessionTokenStats,
    loadRecentEdits,
    loadGlobalStats,
    clearTokenStats,
    clearBoard,
  } = useAppStore();

  const switchToMessages = useCallback(() => {
    setAnalyticsCurrentView("messages");
    clearAnalyticsErrors();
  }, [setAnalyticsCurrentView, clearAnalyticsErrors]);

  const switchToSettings = useCallback(() => {
    setAnalyticsCurrentView("settings");
    clearAnalyticsErrors();
  }, [setAnalyticsCurrentView, clearAnalyticsErrors]);

  const switchToArchive = useCallback(() => {
    setAnalyticsCurrentView("archive");
    clearAnalyticsErrors();
    // Load archives list when switching to archive view
    useAppStore.getState().loadArchives();
  }, [setAnalyticsCurrentView, clearAnalyticsErrors]);

  const switchToTokenStats = useCallback(async () => {
    const project = useAppStore.getState().selectedProject;
    if (!project) {
      throw new Error(t("common.hooks.noProjectSelected"));
    }

    setAnalyticsCurrentView("tokenStats");
    clearAnalyticsErrors();

    try {
      const promises: Promise<void>[] = [];
      promises.push(loadProjectTokenStats(project.path));

      if (selectedSession) {
        promises.push(loadSessionTokenStats(selectedSession.file_path));
      }

      await Promise.all(promises);
    } catch (error) {
      console.error("Failed to load token stats:", error);
      throw error;
    }
  }, [
    t,
    selectedSession,
    setAnalyticsCurrentView,
    clearAnalyticsErrors,
    loadProjectTokenStats,
    loadSessionTokenStats,
  ]);

  const switchToAnalytics = useCallback(async () => {
    const project = useAppStore.getState().selectedProject;
    if (!project) {
      throw new Error(t("common.hooks.noProjectSelected"));
    }

    setAnalyticsCurrentView("analytics");
    clearAnalyticsErrors();

    try {
      setAnalyticsLoadingProjectSummary(true);
      try {
        const summary = await loadProjectStatsSummary(project.path);
        setAnalyticsProjectSummary(summary);
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : t("common.hooks.projectSummaryLoadFailed");
        setAnalyticsProjectSummaryError(errorMessage);
        throw error;
      } finally {
        setAnalyticsLoadingProjectSummary(false);
      }

      if (selectedSession) {
        setAnalyticsLoadingSessionComparison(true);
        try {
          const [comparison] = await Promise.all([
            loadSessionComparison(
              selectedSession.actual_session_id,
              project.path
            ),
            loadSessionTokenStats(selectedSession.file_path),
          ]);
          setAnalyticsSessionComparison(comparison);
          setAnalyticsSessionComparisonError(null);
        } catch (error) {
          const errorMessage =
            error instanceof Error
              ? error.message
              : t("common.hooks.sessionComparisonLoadFailed");
          setAnalyticsSessionComparisonError(errorMessage);
        } finally {
          setAnalyticsLoadingSessionComparison(false);
        }
      }
    } catch (error) {
      console.error("Failed to load analytics:", error);
      throw error;
    }
  }, [
    t,
    selectedSession,
    setAnalyticsCurrentView,
    clearAnalyticsErrors,
    setAnalyticsLoadingProjectSummary,
    setAnalyticsLoadingSessionComparison,
    setAnalyticsProjectSummary,
    setAnalyticsSessionComparison,
    setAnalyticsProjectSummaryError,
    setAnalyticsSessionComparisonError,
    loadProjectStatsSummary,
    loadSessionComparison,
    loadSessionTokenStats,
  ]);

  const switchToRecentEdits = useCallback(async () => {
    const project = useAppStore.getState().selectedProject;
    if (!project) {
      throw new Error(t("common.hooks.noProjectSelected"));
    }

    setAnalyticsCurrentView("recentEdits");
    clearAnalyticsErrors();

    const hasCachedRecentEdits =
      analytics.recentEdits &&
      analytics.recentEdits.files.length > 0 &&
      analytics.recentEdits.project_cwd === project.path;

    if (hasCachedRecentEdits) {
      return;
    }

    try {
      setAnalyticsLoadingRecentEdits(true);
      const result = await loadRecentEdits(project.path);

      setAnalyticsRecentEdits({
        files: result.files,
        total_edits_count: result.total_edits_count,
        unique_files_count: result.unique_files_count,
        project_cwd: result.project_cwd,
      });

      useAppStore.setState((state) => ({
        analytics: {
          ...state.analytics,
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
      const errorMessage =
        error instanceof Error
          ? error.message
          : t("common.hooks.recentEditsLoadFailed");
      setAnalyticsRecentEditsError(errorMessage);
      console.error("Failed to load recent edits:", error);
      throw error;
    } finally {
      setAnalyticsLoadingRecentEdits(false);
    }
  }, [
    t,
    analytics.recentEdits,
    setAnalyticsCurrentView,
    clearAnalyticsErrors,
    setAnalyticsLoadingRecentEdits,
    setAnalyticsRecentEdits,
    setAnalyticsRecentEditsError,
    loadRecentEdits,
  ]);

  const switchToBoard = useCallback(async () => {
    const project = useAppStore.getState().selectedProject;
    if (!project) {
      throw new Error(t("common.hooks.noProjectSelected"));
    }

    const provider = project.provider ?? "claude";
    if (provider !== "claude") {
      setAnalyticsCurrentView("messages");
      clearAnalyticsErrors();
      toast.warning(t("session.boardNotSupported"));
      return;
    }

    try {
      const {
        boardSessions,
        loadBoardSessions,
        dateFilter,
        setDateFilter,
        sessions,
      } = useAppStore.getState();
      const hasAnySessionsLoaded = Object.keys(boardSessions).length > 0;

      setAnalyticsCurrentView("board");
      clearAnalyticsErrors();

      const firstSession = Object.values(boardSessions)[0];
      const needsFullReload =
        !hasAnySessionsLoaded ||
        (firstSession &&
          firstSession.session.project_name !== project.name) ||
        sessions.length > Object.keys(boardSessions).length;

      if (needsFullReload && sessions.length > 0) {
        await loadBoardSessions(sessions);

        if (
          sessions.length > 0 &&
          (needsFullReload || (!dateFilter.start && !dateFilter.end))
        ) {
          const timestamps = sessions
            .flatMap((s) => [
              new Date(s.first_message_time).getTime(),
              new Date(s.last_modified).getTime(),
            ])
            .filter((t) => !isNaN(t) && t > 0);

          if (timestamps.length > 0) {
            const minTime = Math.min(...timestamps);
            const maxTime = Math.max(...timestamps);

            setDateFilter({
              start: new Date(minTime),
              end: new Date(maxTime),
            });
          }
        }
      }
    } catch (error) {
      console.error("Failed to load board:", error);
      window.alert(
        `Failed to load board: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, [t, setAnalyticsCurrentView, clearAnalyticsErrors]);

  const setStatsMode = useCallback(
    async (
      mode: StatsMode,
      options?: { isViewingGlobalStats?: boolean }
    ) => {
      const currentMode = useAppStore.getState().analytics.statsMode;
      if (currentMode === mode) {
        return;
      }

      setAnalyticsStatsMode(mode);
      clearTokenStats();
      setAnalyticsProjectSummary(null);
      setAnalyticsProjectConversationSummary(null);
      setAnalyticsSessionComparison(null);
      setAnalyticsProjectSummaryError(null);
      setAnalyticsSessionComparisonError(null);

      const state = useAppStore.getState();
      const project = state.selectedProject;
      const session = state.selectedSession;
      const currentView = state.analytics.currentView;
      const isGlobalScope =
        options?.isViewingGlobalStats ??
        (!project && currentView === "analytics");

      try {
        if (isGlobalScope) {
          await loadGlobalStats();
          return;
        }

        if (!project) {
          return;
        }

        if (currentView === "tokenStats") {
          await loadProjectTokenStats(project.path);
          if (session) {
            await loadSessionTokenStats(session.file_path);
          }
          return;
        }

        if (currentView === "analytics") {
          setAnalyticsLoadingProjectSummary(true);
          try {
            const summary = await loadProjectStatsSummary(project.path);
            setAnalyticsProjectSummary(summary);
          } finally {
            setAnalyticsLoadingProjectSummary(false);
          }

          if (session) {
            setAnalyticsLoadingSessionComparison(true);
            try {
              const [comparison] = await Promise.all([
                loadSessionComparison(
                  session.actual_session_id,
                  project.path
                ),
                loadSessionTokenStats(session.file_path),
              ]);
              setAnalyticsSessionComparison(comparison);
            } finally {
              setAnalyticsLoadingSessionComparison(false);
            }
          }
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : t("common.hooks.projectSummaryLoadFailed");
        toast.error(errorMessage);
        if (currentView === "analytics") {
          setAnalyticsProjectSummaryError(errorMessage);
          if (session != null) {
            setAnalyticsSessionComparisonError(errorMessage);
          }
          return;
        }

        if (currentView === "tokenStats") {
          useAppStore.getState().setError({
            type: AppErrorType.UNKNOWN,
            message: errorMessage,
          });
          return;
        }

        setAnalyticsProjectSummaryError(errorMessage);
      }
    },
    [
      clearTokenStats,
      loadGlobalStats,
      loadProjectStatsSummary,
      loadProjectTokenStats,
      loadSessionComparison,
      loadSessionTokenStats,
      setAnalyticsLoadingProjectSummary,
      setAnalyticsLoadingSessionComparison,
      setAnalyticsProjectSummary,
      setAnalyticsProjectConversationSummary,
      setAnalyticsProjectSummaryError,
      setAnalyticsSessionComparison,
      setAnalyticsSessionComparisonError,
      setAnalyticsStatsMode,
      t,
    ]
  );

  const setMetricMode = useCallback(
    (mode: MetricMode) => {
      setAnalyticsMetricMode(mode);
    },
    [setAnalyticsMetricMode]
  );

  const refreshAnalytics = useCallback(async () => {
    switch (analytics.currentView) {
      case "tokenStats":
        clearTokenStats();
        await switchToTokenStats();
        break;
      case "analytics":
        setAnalyticsProjectSummary(null);
        setAnalyticsProjectConversationSummary(null);
        setAnalyticsSessionComparison(null);
        await switchToAnalytics();
        break;
      case "recentEdits":
        setAnalyticsRecentEdits(null);
        await switchToRecentEdits();
        break;
      case "board":
        await switchToBoard();
        break;
      case "messages":
        break;
      case "archive":
        await useAppStore.getState().loadArchives();
        break;
      default:
        console.warn("Unknown analytics view:", analytics.currentView);
    }
  }, [
    analytics.currentView,
    switchToTokenStats,
    switchToAnalytics,
    switchToRecentEdits,
    switchToBoard,
    clearTokenStats,
    setAnalyticsProjectSummary,
    setAnalyticsProjectConversationSummary,
    setAnalyticsSessionComparison,
    setAnalyticsRecentEdits,
  ]);

  const clearAll = useCallback(() => {
    resetAnalytics();
    clearTokenStats();
    clearBoard();
  }, [resetAnalytics, clearTokenStats, clearBoard]);

  return {
    switchToMessages,
    switchToTokenStats,
    switchToAnalytics,
    switchToRecentEdits,
    switchToSettings,
    switchToBoard,
    switchToArchive,
    setStatsMode,
    setMetricMode,
    refreshAnalytics,
    clearAll,
  };
}
