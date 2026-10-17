import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAppStore } from "../../store/useAppStore";
import {
  type ClaudeProject,
  type MetricMode,
  type StatsMode,
} from "../../types";
import {
  projectRefOf,
  viewAfterLeavingProject,
  type AnalyticsTab,
  type View,
} from "../../navigation/place";
import { ownPlace, type PlaceOwner } from "../../navigation/ownership";
import {
  loadProjectAnalytics,
  loadRecentEditsScreen,
  loadTokenStatsScreen,
  reloadBoard,
} from "../../navigation/screenData";

/** Whether `project` is still among the scanned projects. */
function isKnownProject(project: ClaudeProject): boolean {
  const ref = projectRefOf(project);
  return useAppStore
    .getState()
    .projects.some((candidate) => {
      const other = projectRefOf(candidate);
      return other?.path === ref?.path && other?.provider === ref?.provider;
    });
}

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
   * Commit `view` (and, on analytics, the sub-tab when one is named) and take
   * ownership of the navigation that did it, so the screen's data is written
   * only while that navigation is still in charge.
   */
  const enterScreen = useCallback(
    (view: View, analyticsTab?: AnalyticsTab): PlaceOwner => {
      void navigate(analyticsTab ? { view, analyticsTab } : { view });
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

  /** The Edits screen's rows (`recentEditsSlice`, keyed by their request). */
  const loadRecentEditsData = useCallback(
    (options?: { force?: boolean }) => loadRecentEditsScreen(useAppStore.getState, options),
    []
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

  /**
   * Project analytics on `tab` (T9b: the overview or the token statistics,
   * which used to be a screen of their own). Without a tab it opens the
   * sub-tab the place already holds - the one last shown in this tab, or the
   * one a restored tab or history entry just put there.
   */
  const switchToAnalytics = useCallback(
    async (tab?: AnalyticsTab) => {
      requireProject();
      const ownsPlace = enterScreen("analytics", tab);
      clearAnalyticsErrors();
      if (useAppStore.getState().analyticsTab === "tokens") {
        await loadTokenStatsData();
      } else {
        await loadAnalyticsData(ownsPlace);
      }
    },
    [requireProject, enterScreen, clearAnalyticsErrors, loadTokenStatsData, loadAnalyticsData]
  );

  const switchToRecentEdits = useCallback(async () => {
    requireProject();
    enterScreen("edits");
    clearAnalyticsErrors();
    await loadRecentEditsData();
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
      const { boardSessions, boardOwner, loadBoardSessions, dateFilter, sessions } =
        useAppStore.getState();
      const hasAnySessionsLoaded = Object.keys(boardSessions).length > 0;

      // The cached board belongs to the open project only when it holds the
      // open project's sessions, compared by file: a project name is the
      // last directory segment, so two projects can both be "repo".
      const listed = new Set(sessions.map((s) => s.file_path));
      const holdsOtherSessions = Object.values(boardSessions).some(
        (board) => !listed.has(board.session.file_path)
      );
      const needsFullReload =
        !hasAnySessionsLoaded ||
        // Loaded for another project (`navigation/screenOwner.ts`).
        boardOwner !== project.path ||
        holdsOtherSessions ||
        sessions.length > Object.keys(boardSessions).length;

      // An empty list loads too: the empty board is the project's own.
      if (needsFullReload) {
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
      const screen = state.view;
      const onTokens = screen === "analytics" && state.analyticsTab === "tokens";
      const isGlobalScope =
        options?.isGlobalScope ??
        (screen === "globalStats" || (!project && screen === "analytics"));

      try {
        if (isGlobalScope) {
          await loadGlobalStats();
          return;
        }

        if (onTokens) {
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
        // Project analytics never lands here: its loader records and
        // reports a failure itself (`loadProjectAnalytics`).
        toast.error(errorMessage);
        // The token stats sub-tab is one tab's: the notification is all
        // (never the app's error screen, which would hide every tab).
        if (onTokens || !project) return;

        setAnalyticsProjectSummaryError(errorMessage, project.path);
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
    const { view, analyticsTab } = useAppStore.getState();
    switch (view) {
      case "analytics":
        if (analyticsTab === "tokens") {
          clearTokenStats();
          await loadTokenStatsData();
          break;
        }
        clearAnalyticsErrors();
        setAnalyticsProjectSummary(null);
        setAnalyticsProjectConversationSummary(null);
        setAnalyticsSessionComparison(null);
        await loadAnalyticsData(ownsPlace);
        break;
      case "edits":
        clearAnalyticsErrors();
        await loadRecentEditsData({ force: true });
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
  ]);

  /** Open a screen and load its data: one entry point per `view`. */
  const openView = useCallback(
    async (view: View) => {
      switch (view) {
        case "analytics":
          return switchToAnalytics();
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
      // A place whose project has gone since (deleted, provider turned off)
      // falls back like any place missing its context, with the reason.
      if (entry.project && !isKnownProject(entry.project)) {
        toast.info(t("project.notFound"));
        return navigate(
          { project: null, view: viewAfterLeavingProject(entry.view) },
          { record: false }
        );
      }
      const restored = await navigate(
        {
          view: entry.view,
          analyticsTab: entry.analyticsTab,
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
    [t, navigate, openView, stepPlaceHistory]
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
