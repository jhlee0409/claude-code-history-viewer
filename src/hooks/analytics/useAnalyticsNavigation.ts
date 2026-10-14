import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAppStore } from "../../store/useAppStore";
import { supportsRecentEdits } from "../../utils/providers";
import { AppErrorType, type MetricMode, type StatsMode } from "../../types";
import type { View } from "../../navigation/place";
import { ownPlace, type PlaceOwner } from "../../navigation/ownership";
import {
  loadProjectAnalytics,
  loadRecentEditsScreen,
  loadTokenStatsScreen,
  reloadBoard,
} from "../../navigation/screenData";

export function useAnalyticsNavigation() {
  const { t } = useTranslation();
  const {
    navigate,
    stepPlaceHistory,
    setAnalyticsStatsMode,
    setAnalyticsMetricMode,
    setAnalyticsProjectSummary,
    setAnalyticsProjectConversationSummary,
    setAnalyticsSessionComparison,
    setAnalyticsProjectSummaryError,
    setAnalyticsSessionComparisonError,
    setAnalyticsRecentEdits,
    resetAnalytics,
    clearAnalyticsErrors,
    loadGlobalStats,
    clearTokenStats,
    clearBoard,
  } = useAppStore();

  // Every switch below is a navigation: `navigate` commits the screen at once
  // (synchronously, before its first await), and the switch then loads the
  // screen's data as that navigation (`enterScreen`). The data loaders are
  // shared with `refreshAnalytics`, which reloads the open screen without
  // navigating (`src/navigation/screenData.ts`).

  /**
   * Commit `view` and take ownership of the navigation that did it, so the
   * screen's data is written only while that navigation is still in charge.
   */
  const enterScreen = useCallback(
    (view: View): PlaceOwner => {
      void navigate({ view });
      return ownPlace(useAppStore.getState);
    },
    [navigate]
  );

  const requireProject = useCallback(() => {
    const project = useAppStore.getState().selectedProject;
    if (!project) {
      throw new Error(t("common.hooks.noProjectSelected"));
    }
    return project;
  }, [t]);

  const loadTokenStatsData = useCallback(async () => {
    const { selectedProject, selectedSession } = useAppStore.getState();
    if (!selectedProject) return;
    try {
      await loadTokenStatsScreen(
        useAppStore.getState,
        selectedProject,
        selectedSession
      );
    } catch (error) {
      console.error("Failed to load token stats:", error);
      throw error;
    }
  }, []);

  const loadAnalyticsData = useCallback(
    async (ownsPlace: PlaceOwner) => {
      const { selectedProject, selectedSession } = useAppStore.getState();
      if (!selectedProject) return;
      try {
        await loadProjectAnalytics(
          useAppStore.getState,
          selectedProject,
          selectedSession,
          {
            ownsPlace,
            failureText: {
              summary: t("common.hooks.projectSummaryLoadFailed"),
              comparison: t("common.hooks.sessionComparisonLoadFailed"),
            },
          }
        );
      } catch (error) {
        console.error("Failed to load analytics:", error);
        throw error;
      }
    },
    [t]
  );

  const loadRecentEditsData = useCallback(
    async (ownsPlace: PlaceOwner) => {
      const project = useAppStore.getState().selectedProject;
      if (!project) return;

      // The view explains the gap itself; asking the backend would only error
      // (WebUI) or read the wrong provider's files (desktop) (#643).
      if (!supportsRecentEdits(project.provider)) {
        return;
      }

      // Read the cache at call time rather than from the render closure.
      // `refreshAnalytics` clears it and then loads in the same tick, so a
      // closed-over value is a render behind and reports a hit on data that
      // no longer exists, leaving the view empty.
      const cached = useAppStore.getState().analytics.recentEdits;
      // No `files.length` condition: with request identity on the entry, an
      // empty result is a valid answer ("this project has no edits") rather
      // than an absent one. Requiring a non-empty list made such a project
      // miss the cache on every visit and re-walk its whole JSONL set forever.
      if (cached && cached.requestedProjectPath === project.path) {
        return;
      }

      await loadRecentEditsScreen(useAppStore.getState, project, {
        ownsPlace,
        failureText: t("common.hooks.recentEditsLoadFailed"),
      });
    },
    [t]
  );

  const switchToMessages = useCallback(() => {
    void navigate({ view: "conversation" });
    clearAnalyticsErrors();
  }, [navigate, clearAnalyticsErrors]);

  const switchToSettings = useCallback(() => {
    void navigate({ view: "settingsManager" });
    clearAnalyticsErrors();
  }, [navigate, clearAnalyticsErrors]);

  /** Global stats keeps the project and session as the place's context. */
  const switchToGlobalStats = useCallback(async () => {
    enterScreen("globalStats");
    await loadGlobalStats();
  }, [enterScreen, loadGlobalStats]);

  const switchToArchive = useCallback(() => {
    enterScreen("archive");
    clearAnalyticsErrors();
    // Load archives list when switching to archive view.
    const store = useAppStore.getState();
    if (!store.archive.isLoadingArchives) {
      void store.loadArchives();
    }
  }, [enterScreen, clearAnalyticsErrors]);

  const switchToTokenStats = useCallback(async () => {
    requireProject();
    enterScreen("tokenStats");
    clearAnalyticsErrors();
    await loadTokenStatsData();
  }, [requireProject, enterScreen, clearAnalyticsErrors, loadTokenStatsData]);

  const switchToAnalytics = useCallback(async () => {
    requireProject();
    const ownsPlace = enterScreen("analytics");
    clearAnalyticsErrors();
    await loadAnalyticsData(ownsPlace);
  }, [requireProject, enterScreen, clearAnalyticsErrors, loadAnalyticsData]);

  const switchToRecentEdits = useCallback(async () => {
    requireProject();
    const ownsPlace = enterScreen("edits");
    clearAnalyticsErrors();
    await loadRecentEditsData(ownsPlace);
  }, [requireProject, enterScreen, clearAnalyticsErrors, loadRecentEditsData]);

  const switchToBoard = useCallback(async () => {
    const project = requireProject();

    const provider = project.provider ?? "claude";
    if (provider !== "claude") {
      void navigate({ view: "conversation" });
      clearAnalyticsErrors();
      toast.warning(t("session.boardNotSupported"));
      return;
    }

    const ownsPlace = enterScreen("board");
    clearAnalyticsErrors();
    try {
      const { boardSessions, loadBoardSessions, dateFilter, sessions } =
        useAppStore.getState();
      const hasAnySessionsLoaded = Object.keys(boardSessions).length > 0;

      const firstSession = Object.values(boardSessions)[0];
      const needsFullReload =
        !hasAnySessionsLoaded ||
        (firstSession &&
          firstSession.session.project_name !== project.name) ||
        sessions.length > Object.keys(boardSessions).length;

      if (needsFullReload && sessions.length > 0) {
        await loadBoardSessions(sessions);
        // The date range below frames this board; a navigation since then
        // owns the screen and its filter.
        if (!ownsPlace()) return;

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

            useAppStore.getState().setDateFilter({
              start: new Date(minTime),
              end: new Date(maxTime),
            });
          }
        }
      }
    } catch (error) {
      console.error("Failed to load board:", error);
      if (!ownsPlace()) return;
      window.alert(
        `Failed to load board: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, [t, navigate, requireProject, enterScreen, clearAnalyticsErrors]);

  /**
   * Switch billing / conversation statistics. A reload of the open screen:
   * it never navigates, and its writes stop once the user does.
   */
  const setStatsMode = useCallback(
    async (
      mode: StatsMode,
      options?: { isGlobalScope?: boolean }
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

      const ownsPlace = ownPlace(useAppStore.getState);
      const state = useAppStore.getState();
      const project = state.selectedProject;
      const session = state.selectedSession;
      const screen = state.view;
      const isGlobalScope =
        options?.isGlobalScope ??
        (screen === "globalStats" || (!project && screen === "analytics"));

      try {
        if (isGlobalScope) {
          await loadGlobalStats();
          return;
        }

        if (screen === "tokenStats") {
          await loadTokenStatsData();
          return;
        }

        if (screen === "analytics") {
          await loadAnalyticsData(ownsPlace);
        }
      } catch (error) {
        if (!ownsPlace()) return;
        const errorMessage =
          error instanceof Error
            ? error.message
            : t("common.hooks.projectSummaryLoadFailed");
        toast.error(errorMessage);
        if (screen === "analytics") {
          setAnalyticsProjectSummaryError(errorMessage);
          if (session != null) {
            setAnalyticsSessionComparisonError(errorMessage);
          }
          return;
        }

        if (screen === "tokenStats") {
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
      loadTokenStatsData,
      loadAnalyticsData,
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

  /**
   * Reload the open screen's data. A reload, not a navigation (plan §4.2): it
   * never calls `navigate`, so it neither advances the epoch nor records
   * history, and a navigation that starts meanwhile supersedes it.
   */
  const refreshAnalytics = useCallback(async () => {
    const ownsPlace = ownPlace(useAppStore.getState);
    const { view } = useAppStore.getState();
    switch (view) {
      case "tokenStats":
        clearTokenStats();
        await loadTokenStatsData();
        break;
      case "analytics":
        clearAnalyticsErrors();
        setAnalyticsProjectSummary(null);
        setAnalyticsProjectConversationSummary(null);
        setAnalyticsSessionComparison(null);
        await loadAnalyticsData(ownsPlace);
        break;
      case "edits":
        clearAnalyticsErrors();
        setAnalyticsRecentEdits(null);
        await loadRecentEditsData(ownsPlace);
        break;
      case "board":
        await reloadBoard(useAppStore.getState);
        break;
      case "globalStats":
        await loadGlobalStats();
        break;
      case "conversation":
      case "empty":
      case "settingsManager":
        break;
      case "archive":
        if (!useAppStore.getState().archive.isLoadingArchives) {
          await useAppStore.getState().loadArchives();
        }
        break;
      default:
        console.warn("Unknown analytics view:", view);
    }
  }, [
    loadGlobalStats,
    loadTokenStatsData,
    loadAnalyticsData,
    loadRecentEditsData,
    clearTokenStats,
    clearAnalyticsErrors,
    setAnalyticsProjectSummary,
    setAnalyticsProjectConversationSummary,
    setAnalyticsSessionComparison,
    setAnalyticsRecentEdits,
  ]);

  /** Open a screen and load its data: one entry point per `view`. */
  const openView = useCallback(
    async (view: View) => {
      switch (view) {
        case "analytics":
          return switchToAnalytics();
        case "tokenStats":
          return switchToTokenStats();
        case "edits":
          return switchToRecentEdits();
        case "board":
          return switchToBoard();
        case "globalStats":
          return switchToGlobalStats();
        case "settingsManager":
          return switchToSettings();
        case "archive":
          return switchToArchive();
        case "conversation":
        case "empty":
          return switchToMessages();
      }
    },
    [
      switchToAnalytics,
      switchToTokenStats,
      switchToRecentEdits,
      switchToBoard,
      switchToGlobalStats,
      switchToSettings,
      switchToArchive,
      switchToMessages,
    ]
  );

  /**
   * Back/forward through the places this window has been (plan §4.1: the
   * document owns its history). Restores the context first, then opens the
   * screen with its data; neither step records a new entry.
   */
  const stepHistory = useCallback(
    async (direction: "back" | "forward"): Promise<boolean> => {
      const entry = stepPlaceHistory(direction);
      if (!entry) return false;
      const restored = await navigate(
        {
          view: entry.view,
          project: entry.project,
          session: entry.session,
          messageId: entry.messageId,
        },
        { record: false }
      );
      if (!restored) return false;
      if (entry.view !== "conversation" && entry.view !== "empty") {
        await openView(entry.view);
      }
      return true;
    },
    [navigate, openView, stepPlaceHistory]
  );
  const goBack = useCallback(() => stepHistory("back"), [stepHistory]);
  const goForward = useCallback(() => stepHistory("forward"), [stepHistory]);

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
    switchToGlobalStats,
    openView,
    goBack,
    goForward,
    setStatsMode,
    setMetricMode,
    refreshAnalytics,
    clearAll,
  };
}
