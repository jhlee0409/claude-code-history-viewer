/**
 * Analytics Hook
 *
 * 높은 응집도: Analytics 관련 모든 비즈니스 로직을 한 곳에 집중
 * 낮은 결합도: 컴포넌트는 이 hook만 의존하면 됨
 * 가독성: 명확한 함수명과 예측 가능한 동작
 */

import { useCallback, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAppStore } from "../store/useAppStore";
import type { UseAnalyticsReturn } from "../types/analytics";
import { AppErrorType, type MetricMode, type StatsMode } from "../types";

export const useAnalytics = (): UseAnalyticsReturn => {
  const { t } = useTranslation();
  const dateFilterKeyRef = useRef<string | null>(null);
  const dateFilterRequestSeqRef = useRef(0);
  const analyticsSessionAutoloadAttemptKeyRef = useRef<string | null>(null);
  const tokenStatsSessionAutoloadAttemptKeyRef = useRef<string | null>(null);
  const {
    // Store state
    analytics,
    sessions,
    selectedProject,
    selectedSession,
    isLoadingTokenStats,
    sessionTokenStats,
    dateFilter,

    // Store actions
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

    // Data loading actions
    loadProjectTokenStats,
    loadProjectStatsSummary,
    loadSessionComparison,
    loadSessionTokenStats,
    loadRecentEdits,
    loadGlobalStats,
    clearTokenStats,
    clearBoard,
  } = useAppStore();

  /**
   * 메시지 뷰로 전환
   * 단순한 뷰 변경이므로 동기적 처리
   */
  const switchToMessages = useCallback(() => {
    setAnalyticsCurrentView("messages");
    clearAnalyticsErrors();
  }, [setAnalyticsCurrentView, clearAnalyticsErrors]);

  /**
   * 설정 뷰로 전환
   * 단순한 뷰 변경이므로 동기적 처리
   */
  const switchToSettings = useCallback(() => {
    setAnalyticsCurrentView("settings");
    clearAnalyticsErrors();
  }, [setAnalyticsCurrentView, clearAnalyticsErrors]);

  /**
   * 토큰 통계 뷰로 전환
   * 날짜 필터 정확성을 위해 진입 시 항상 데이터를 다시 로드한다.
   */
  const switchToTokenStats = useCallback(async () => {
    const project = useAppStore.getState().selectedProject;
    if (!project) {
      throw new Error(t('common.hooks.noProjectSelected'));
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

  /**
   * 분석 뷰로 전환
   * 날짜 필터 정확성을 위해 진입 시 항상 데이터를 다시 로드한다.
   * NOTE: Token Statistics 로딩과 완전히 분리됨 - 각 뷰는 독립적으로 동작
   */
  const switchToAnalytics = useCallback(async () => {
    const project = useAppStore.getState().selectedProject;
    if (!project) {
      throw new Error(t('common.hooks.noProjectSelected'));
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
          error instanceof Error ? error.message : t('common.hooks.projectSummaryLoadFailed');
        setAnalyticsProjectSummaryError(errorMessage);
        throw error;
      } finally {
        setAnalyticsLoadingProjectSummary(false);
      }

      // NOTE: sessionTokenStats도 함께 로드하여 탭 표시 조건(hasSessionData)을 충족
      if (selectedSession) {
        setAnalyticsLoadingSessionComparison(true);
        try {
          const [comparison] = await Promise.all([
            loadSessionComparison(selectedSession.actual_session_id, project.path),
            loadSessionTokenStats(selectedSession.file_path),
          ]);
          setAnalyticsSessionComparison(comparison);
          setAnalyticsSessionComparisonError(null);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : t('common.hooks.sessionComparisonLoadFailed');
          setAnalyticsSessionComparisonError(errorMessage);
          // 세션 비교 실패는 치명적이지 않으므로 throw하지 않음
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

  /**
   * 최근 편집 뷰로 전환
   * 캐시 전략: 같은 프로젝트의 데이터가 있으면 재사용
   */
  const switchToRecentEdits = useCallback(async () => {
    const project = useAppStore.getState().selectedProject;
    if (!project) {
      throw new Error(t('common.hooks.noProjectSelected'));
    }

    setAnalyticsCurrentView("recentEdits");
    clearAnalyticsErrors();

    // 캐시 확인: 같은 프로젝트의 recent edits가 이미 있는지
    const hasCachedRecentEdits =
      analytics.recentEdits &&
      analytics.recentEdits.files.length > 0 &&
      analytics.recentEdits.project_cwd === project.path;

    // 캐시가 있으면 로드 스킵
    if (hasCachedRecentEdits) {
      return;
    }

    try {
      setAnalyticsLoadingRecentEdits(true);
      const result = await loadRecentEdits(project.path);

      // Update both the result and pagination state
      setAnalyticsRecentEdits({
        files: result.files,
        total_edits_count: result.total_edits_count,
        unique_files_count: result.unique_files_count,
        project_cwd: result.project_cwd,
      });

      // Update pagination state via direct store update
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
        error instanceof Error ? error.message : t('common.hooks.recentEditsLoadFailed');
      setAnalyticsRecentEditsError(errorMessage);
      console.error("Failed to load recent edits:", error);
      throw error;
    } finally {
      setAnalyticsLoadingRecentEdits(false);
    }
  }, [
    t,
    selectedProject,
    analytics.recentEdits,
    setAnalyticsCurrentView,
    clearAnalyticsErrors,
    setAnalyticsLoadingRecentEdits,
    setAnalyticsRecentEdits,
    setAnalyticsRecentEditsError,
    loadRecentEdits,
  ]);

  /**
   * 보드 뷰로 전환
   * 프로젝트의 최근 세션들을 로드하여 보드 시각화
   */
  const switchToBoard = useCallback(async () => {
    const project = useAppStore.getState().selectedProject;
    if (!project) {
      throw new Error(t('common.hooks.noProjectSelected'));
    }

    const provider = project.provider ?? "claude";
    if (provider !== "claude") {
      setAnalyticsCurrentView("messages");
      clearAnalyticsErrors();
      toast.warning(t('session.boardNotSupported'));
      return;
    }

    try {
      const { boardSessions, loadBoardSessions, dateFilter, setDateFilter, sessions } = useAppStore.getState();
      const hasAnySessionsLoaded = Object.keys(boardSessions).length > 0;

      setAnalyticsCurrentView("board");
      clearAnalyticsErrors();

      // If no sessions are loaded for this board yet, load them all
      // Or if the project changed (we check if any loaded session doesn't belong to current project)
      const firstSession = Object.values(boardSessions)[0];
      const needsFullReload = !hasAnySessionsLoaded ||
        (firstSession && firstSession.session.project_name !== project.name) ||
        (sessions.length > Object.keys(boardSessions).length);

      if (needsFullReload && sessions.length > 0) {
        // Load all sessions to "map the full range" as requested
        // Note: This might be slow if there are 100s, but we'll start with this and optimize if needed.
        await loadBoardSessions(sessions);

        // Initialize or Update date filter to the full range
        // We do this if we just reloaded the board (new project) OR if the filter is empty
        if (sessions.length > 0 && (needsFullReload || (!dateFilter.start && !dateFilter.end))) {
          // Calculate true min/max range across all sessions
          const timestamps = sessions.flatMap(s => [
            new Date(s.first_message_time).getTime(),
            new Date(s.last_modified).getTime()
          ]).filter(t => !isNaN(t) && t > 0);

          if (timestamps.length > 0) {
            const minTime = Math.min(...timestamps);
            const maxTime = Math.max(...timestamps);

            setDateFilter({
              start: new Date(minTime), // Start exactly at first file/msg
              end: new Date(maxTime)    // End exactly at last modified
            });
          }
        }
      }
    } catch (error) {
      console.error("Failed to load board:", error);
      // Surface error to user
      window.alert(`Failed to load board: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [t, selectedProject, sessions, setAnalyticsCurrentView, clearAnalyticsErrors]);

  /**
   * 통계 모드 변경
   * - billing_total: 청구 기준(사이드체인 포함)
   * - conversation_only: 대화 기준(사이드체인 제외)
   *
   * Provider 필터(activeProviders)는 프로젝트 트리 탭의 단일 소스를 그대로 사용한다.
   */
  const setStatsMode = useCallback(
    async (mode: StatsMode, options?: { isViewingGlobalStats?: boolean }) => {
      const currentMode = useAppStore.getState().analytics.statsMode;
      if (currentMode === mode) {
        return;
      }

      setAnalyticsStatsMode(mode);
      clearTokenStats();
      setAnalyticsProjectSummary(null);
      setAnalyticsSessionComparison(null);
      setAnalyticsProjectSummaryError(null);
      setAnalyticsSessionComparisonError(null);

      const state = useAppStore.getState();
      const project = state.selectedProject;
      const session = state.selectedSession;
      const currentView = state.analytics.currentView;
      const isGlobalScope =
        options?.isViewingGlobalStats ?? (!project && currentView === "analytics");

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
                loadSessionComparison(session.actual_session_id, project.path),
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
          error instanceof Error ? error.message : t("common.hooks.projectSummaryLoadFailed");
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
   * 현재 뷰의 분석 데이터 강제 새로고침
   * 캐시를 무시하고 데이터를 다시 로드
   */
  const refreshAnalytics = useCallback(async () => {
    // 현재 뷰에 해당하는 캐시만 초기화 후 다시 로드
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
        // 메시지 뷰는 별도 새로고침 로직 없음
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

  /**
   * 모든 analytics 상태 초기화
   * 프로젝트 변경 시 호출 권장
   */
  const clearAll = useCallback(() => {
    resetAnalytics();
    clearTokenStats();
    clearBoard();
  }, [resetAnalytics, clearTokenStats, clearBoard]);

  /**
   * 계산된 값들 (메모이제이션으로 성능 최적화)
   */
  const computed = useMemo(
    () => ({
      isTokenStatsView: analytics.currentView === "tokenStats",
      isAnalyticsView: analytics.currentView === "analytics",
      isMessagesView: analytics.currentView === "messages",
      isRecentEditsView: analytics.currentView === "recentEdits",
      isSettingsView: analytics.currentView === "settings",
      isBoardView: analytics.currentView === "board",
      hasAnyError: !!(
        analytics.projectSummaryError ||
        analytics.sessionComparisonError ||
        analytics.recentEditsError
      ),
      // 각 뷰별 로딩 상태
      isLoadingAnalytics:
        analytics.isLoadingProjectSummary ||
        analytics.isLoadingSessionComparison,
      isLoadingTokenStats,
      isLoadingRecentEdits: analytics.isLoadingRecentEdits,
      // 전체 로딩 상태 (필요시 사용)
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

  /**
   * 사이드 이팩트: 세션 변경 시 analytics 데이터 자동 새로고침
   * analytics 뷰가 활성화되어 있을 때만 실행
   * NOTE: sessionTokenStats도 함께 로드하여 탭 표시 조건(hasSessionData)을 충족
   */
  useEffect(() => {
    // 로딩 중이면 스킵 (중복 호출 방지)
    if (analytics.isLoadingSessionComparison || isLoadingTokenStats) {
      return;
    }

    if (analytics.currentView === "analytics" && selectedProject && selectedSession) {
      const autoloadKey = `${selectedSession.actual_session_id}:${dateFilter.start?.getTime() ?? "none"}:${dateFilter.end?.getTime() ?? "none"}`;
      // 캐시 확인: 이미 로드된 데이터면 스킵
      const hasCachedSessionComparison =
        analytics.sessionComparison?.session_id === selectedSession.actual_session_id;
      const hasCachedSessionTokenStats =
        sessionTokenStats?.session_id === selectedSession.actual_session_id;

      // 둘 다 캐시되어 있으면 로드 스킵
      if (hasCachedSessionComparison && hasCachedSessionTokenStats) {
        analyticsSessionAutoloadAttemptKeyRef.current = null;
        return;
      }
      // Prevent infinite retries for the same session + date filter tuple.
      if (analyticsSessionAutoloadAttemptKeyRef.current === autoloadKey) {
        return;
      }
      analyticsSessionAutoloadAttemptKeyRef.current = autoloadKey;

      const updateSessionData = async () => {
        try {
          setAnalyticsLoadingSessionComparison(true);

          const promises: Promise<unknown>[] = [];

          // 캐시 없는 것만 로드
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
            promises.push(loadSessionTokenStats(selectedSession.file_path));
          }

          await Promise.all(promises);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : t('common.hooks.sessionComparisonLoadFailed');
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
   * 사이드 이팩트: 토큰 통계 뷰에서 세션 변경 시 세션 토큰 통계 자동 새로고침
   */
  useEffect(() => {
    // 로딩 중이면 스킵 (중복 호출 방지)
    if (isLoadingTokenStats) {
      return;
    }

    if (analytics.currentView === "tokenStats" && selectedSession) {
      const autoloadKey = `${selectedSession.actual_session_id}:${dateFilter.start?.getTime() ?? "none"}:${dateFilter.end?.getTime() ?? "none"}`;
      // 캐시 확인: 이미 로드된 데이터면 스킵
      const hasCachedSessionTokenStats =
        sessionTokenStats?.session_id === selectedSession.actual_session_id;

      if (hasCachedSessionTokenStats) {
        tokenStatsSessionAutoloadAttemptKeyRef.current = null;
        return;
      }
      // Prevent infinite retries for the same session + date filter tuple.
      if (tokenStatsSessionAutoloadAttemptKeyRef.current === autoloadKey) {
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
   * 사이드 이팩트: 필터 변경 시 토큰 통계 자동 새로고침
   */
  useEffect(() => {
    const currentDateFilterKey = `${dateFilter.start?.getTime() ?? "none"}:${dateFilter.end?.getTime() ?? "none"}`;

    // Skip initial render and only react to real date filter changes.
    if (dateFilterKeyRef.current === null) {
      dateFilterKeyRef.current = currentDateFilterKey;
      return;
    }
    if (dateFilterKeyRef.current === currentDateFilterKey) {
      return;
    }
    dateFilterKeyRef.current = currentDateFilterKey;
    const requestSeq = ++dateFilterRequestSeqRef.current;
    const isStaleRequest = () => requestSeq !== dateFilterRequestSeqRef.current;

    const isGlobalScope = !selectedProject && analytics.currentView === "analytics";

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
          const promises: Promise<unknown>[] = [loadProjectTokenStats(selectedProject.path)];
          if (selectedSession) {
            promises.push(loadSessionTokenStats(selectedSession.file_path));
          }
          await Promise.all(promises);
          if (isStaleRequest()) {
            return;
          }
        } else if (computed.isAnalyticsView) {
          setAnalyticsLoadingProjectSummary(true);
          const summary = await loadProjectStatsSummary(selectedProject.path);
          if (isStaleRequest()) {
            return;
          }
          setAnalyticsProjectSummary(summary);

          if (selectedSession) {
            setAnalyticsLoadingSessionComparison(true);
            try {
              const [comparison] = await Promise.all([
                loadSessionComparison(selectedSession.actual_session_id, selectedProject.path),
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
              // Clear stale comparison values when the filtered comparison request fails.
              setAnalyticsSessionComparison(null);
              setAnalyticsSessionComparisonError(message);
            } finally {
              if (!isStaleRequest()) {
                setAnalyticsLoadingSessionComparison(false);
              }
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
          err instanceof Error ? err.message : t("common.hooks.projectSummaryLoadFailed");
        setAnalyticsProjectSummaryError(message);
      } finally {
        // Always clear loading state regardless of stale check to prevent
        // isLoadingProjectSummary from getting stuck as true permanently.
        if (computed.isAnalyticsView) {
          setAnalyticsLoadingProjectSummary(false);
        }
      }
    };

    if (isGlobalScope || computed.isTokenStatsView || computed.isAnalyticsView) {
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
    t
  ]);

  return {
    state: analytics,
    actions: {
      switchToMessages,
      switchToTokenStats,
      switchToAnalytics,
      switchToRecentEdits,
      switchToSettings,
      switchToBoard,
      setStatsMode,
      setMetricMode,
      refreshAnalytics,
      clearAll,
    },
    computed,
  };
};
