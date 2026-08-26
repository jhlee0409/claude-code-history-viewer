import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAppStore } from "../../store/useAppStore";
import { AppErrorType, type MetricMode, type StatsMode } from "../../types";

/**
 * Sequence number for Recent Edits fetches, so a request can tell whether it is
 * still the most recent one.
 *
 * Module scope rather than a ref: several components mount this hook, and a
 * per-instance ref would let two of them each believe they are the latest.
 */
let recentEditsRequestSeq = 0;

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
    // Load archives list when switching to archive view.
    const store = useAppStore.getState();
    if (!store.archive.isLoadingArchives) {
      void store.loadArchives();
    }
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

    // Read the cache at call time rather than from the render closure.
    // `refreshAnalytics` clears it and then calls this in the same tick, so a
    // closed-over value is a render behind and reports a hit on data that no
    // longer exists, leaving the view empty. That was survivable only while the
    // guard never held.
    const cached = useAppStore.getState().analytics.recentEdits;
    // No `files.length` condition: with request identity on the entry, an empty
    // result is a valid answer ("this project has no edits") rather than an
    // absent one. Requiring a non-empty list made such a project miss the cache
    // on every visit and re-walk its whole JSONL set forever.
    const hasCachedRecentEdits =
      cached && cached.requestedProjectPath === project.path;

    if (hasCachedRecentEdits) {
      return;
    }

    const requestId = ++recentEditsRequestSeq;
    // One predicate for both outcomes. A late failure is every bit as capable
    // of writing over a newer request's state as a late success is, and the
    // two paths disagreeing about what ownership means is how that gets
    // missed.
    const stillOwnsRecentEdits = () =>
      recentEditsRequestSeq === requestId &&
      useAppStore.getState().selectedProject?.path === project.path;

    try {
      setAnalyticsLoadingRecentEdits(true);
      const result = await loadRecentEdits(project.path);

      // The user may have switched projects while this was in flight. Writing
      // anyway would show one project's edits under another's identity, and the
      // cache guard would then treat that as a valid hit indefinitely.
      //
      // The sequence check is the other half of the same rule. A project path
      // cannot tell two requests for the *same* project apart, so refreshing
      // while the first load was still running let the slower of the two land
      // last and overwrite the newer result, cursor included.
      if (!stillOwnsRecentEdits()) {
        return;
      }

      setAnalyticsRecentEdits({
        files: result.files,
        total_edits_count: result.total_edits_count,
        unique_files_count: result.unique_files_count,
        project_cwd: result.project_cwd,
        requestedProjectPath: project.path,
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
      if (stillOwnsRecentEdits()) {
        setAnalyticsRecentEditsError(errorMessage);
      }
      console.error("Failed to load recent edits:", error);
      throw error;
    } finally {
      // Clear on the *latest* request rather than on the selected project.
      // Keying this to the selection stranded the flag: a request whose project
      // was deselected would never clear it, and nothing else does, because
      // `resetAnalytics` runs in `clearProjectSelection` rather than on a
      // project switch. Keying it to the sequence still stops a late loser from
      // reporting a newer request as finished.
      if (recentEditsRequestSeq === requestId) {
        setAnalyticsLoadingRecentEdits(false);
      }
    }
  }, [
    t,
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
        if (!useAppStore.getState().archive.isLoadingArchives) {
          await useAppStore.getState().loadArchives();
        }
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
