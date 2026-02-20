/**
 * Analytics Hook
 *
 * 높은 응집도: Analytics 관련 모든 비즈니스 로직을 한 곳에 집중
 * 낮은 결합도: 컴포넌트는 이 hook만 의존하면 됨
 * 가독성: 명확한 함수명과 예측 가능한 동작
 */

import { useCallback, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store/useAppStore";
import type { UseAnalyticsReturn } from "../types/analytics";

export const useAnalytics = (): UseAnalyticsReturn => {
  const { t } = useTranslation();
  const dateFilterKeyRef = useRef<string | null>(null);
  const {
    // Store state
    analytics,
    sessions,
    selectedProject,
    selectedSession,
    isLoadingTokenStats,
    sessionTokenStats,
    projectTokenStats,
    dateFilter,

    // Store actions
    setAnalyticsCurrentView,
    setAnalyticsProjectSummary,
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
   * 캐시 전략: 같은 프로젝트/세션의 데이터가 있으면 재사용
   */
  const switchToTokenStats = useCallback(async () => {
    const project = useAppStore.getState().selectedProject;
    if (!project) {
      throw new Error(t('common.hooks.noProjectSelected'));
    }

    setAnalyticsCurrentView("tokenStats");
    clearAnalyticsErrors();

    // 캐시 확인
    const hasCachedProjectTokenStats =
      projectTokenStats && projectTokenStats.length > 0 &&
      projectTokenStats[0]?.project_name === project.name;
    const hasCachedSessionTokenStats =
      selectedSession &&
      sessionTokenStats?.session_id === selectedSession.actual_session_id;

    // 모든 데이터가 캐시되어 있으면 로드 스킵
    if (hasCachedProjectTokenStats && (!selectedSession || hasCachedSessionTokenStats)) {
      return;
    }

    try {
      const promises: Promise<void>[] = [];

      // 프로젝트 전체 통계 로드 (캐시 없으면)
      if (!hasCachedProjectTokenStats) {
        promises.push(loadProjectTokenStats(project.path));
      }

      // 현재 세션 통계 로드 (선택된 경우, 캐시 없으면)
      if (selectedSession && !hasCachedSessionTokenStats) {
        promises.push(loadSessionTokenStats(selectedSession.file_path));
      }

      await Promise.all(promises);
    } catch (error) {
      console.error("Failed to load token stats:", error);
      throw error;
    }
  }, [
    t,
    projectTokenStats,
    selectedSession,
    sessionTokenStats?.session_id,
    setAnalyticsCurrentView,
    clearAnalyticsErrors,
    loadProjectTokenStats,
    loadSessionTokenStats,
  ]);

  /**
   * 분석 뷰로 전환
   * 캐시 전략: 같은 프로젝트/세션의 데이터가 있으면 재사용
   * NOTE: Token Statistics 로딩과 완전히 분리됨 - 각 뷰는 독립적으로 동작
   */
  const switchToAnalytics = useCallback(async () => {
    const project = useAppStore.getState().selectedProject;
    if (!project) {
      throw new Error(t('common.hooks.noProjectSelected'));
    }

    setAnalyticsCurrentView("analytics");
    clearAnalyticsErrors();

    // 캐시 확인: 같은 프로젝트의 데이터가 이미 있는지
    const hasCachedProjectSummary =
      analytics.projectSummary?.project_name === project.name;
    const hasCachedSessionComparison =
      selectedSession &&
      analytics.sessionComparison?.session_id === selectedSession.actual_session_id;
    const hasCachedSessionTokenStats =
      selectedSession &&
      sessionTokenStats?.session_id === selectedSession.actual_session_id;

    // 모든 데이터가 캐시되어 있으면 로드 스킵
    if (hasCachedProjectSummary && (!selectedSession || (hasCachedSessionComparison && hasCachedSessionTokenStats))) {
      return;
    }

    try {
      // 순차 실행: 프로젝트 요약 먼저, 그 다음 세션 비교
      // (병렬 실행 시 182개 파일을 동시에 두 번 읽어 I/O 경쟁 발생 - 4초 → 순차 시 ~200ms)

      // 1. 프로젝트 요약 로드 (캐시 없으면)
      if (!hasCachedProjectSummary) {
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
      }

      // 2. 세션 데이터 로드 (프로젝트 요약 완료 후)
      // NOTE: sessionTokenStats도 함께 로드하여 탭 표시 조건(hasSessionData)을 충족
      if (selectedSession && (!hasCachedSessionComparison || !hasCachedSessionTokenStats)) {
        setAnalyticsLoadingSessionComparison(true);
        try {
          const sessionPromises: Promise<unknown>[] = [];

          if (!hasCachedSessionComparison) {
            sessionPromises.push(
              loadSessionComparison(
                selectedSession.actual_session_id,
                project.path
              ).then((comparison) => {
                setAnalyticsSessionComparison(comparison);
              })
            );
          }

          if (!hasCachedSessionTokenStats) {
            sessionPromises.push(loadSessionTokenStats(selectedSession.file_path));
          }

          if (sessionPromises.length > 0) {
            await Promise.all(sessionPromises);
          }
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
    selectedProject,
    selectedSession,
    analytics.projectSummary?.project_name,
    analytics.sessionComparison?.session_id,
    sessionTokenStats?.session_id,
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
      // 캐시 확인: 이미 로드된 데이터면 스킵
      const hasCachedSessionComparison =
        analytics.sessionComparison?.session_id === selectedSession.actual_session_id;
      const hasCachedSessionTokenStats =
        sessionTokenStats?.session_id === selectedSession.actual_session_id;

      // 둘 다 캐시되어 있으면 로드 스킵
      if (hasCachedSessionComparison && hasCachedSessionTokenStats) {
        return;
      }

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
      // 캐시 확인: 이미 로드된 데이터면 스킵
      const hasCachedSessionTokenStats =
        sessionTokenStats?.session_id === selectedSession.actual_session_id;

      if (hasCachedSessionTokenStats) {
        return;
      }

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

    if (!selectedProject) {
      return;
    }

    const update = async () => {
      try {
        if (computed.isTokenStatsView) {
          await loadProjectTokenStats(selectedProject.path);
        } else if (computed.isAnalyticsView) {
          setAnalyticsLoadingProjectSummary(true);
          const summary = await loadProjectStatsSummary(selectedProject.path);
          setAnalyticsProjectSummary(summary);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t("common.hooks.projectSummaryLoadFailed");
        setAnalyticsProjectSummaryError(message);
      } finally {
        setAnalyticsLoadingProjectSummary(false);
      }
    };

    if (computed.isTokenStatsView || computed.isAnalyticsView) {
      void update();
    }
  }, [
    dateFilter.start?.getTime(),
    dateFilter.end?.getTime(),
    computed.isTokenStatsView,
    computed.isAnalyticsView,
    selectedProject?.path,
    loadProjectTokenStats,
    loadProjectStatsSummary,
    setAnalyticsLoadingProjectSummary,
    setAnalyticsProjectSummary,
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
      refreshAnalytics,
      clearAll,
    },
    computed,
  };
};
