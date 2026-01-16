/**
 * Analytics Hook
 *
 * 높은 응집도: Analytics 관련 모든 비즈니스 로직을 한 곳에 집중
 * 낮은 결합도: 컴포넌트는 이 hook만 의존하면 됨
 * 가독성: 명확한 함수명과 예측 가능한 동작
 */

import { useCallback, useMemo, useEffect } from "react";
import { useAppStore } from "../store/useAppStore";
import type { UseAnalyticsReturn } from "../types/analytics";

export const useAnalytics = (): UseAnalyticsReturn => {
  const {
    // Store state
    analytics,
    selectedProject,
    selectedSession,
    isLoadingTokenStats,

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
   * 토큰 통계 뷰로 전환
   * 데이터 로딩이 필요하므로 비동기 처리
   */
  const switchToTokenStats = useCallback(async () => {
    if (!selectedProject) {
      throw new Error("프로젝트가 선택되지 않았습니다.");
    }

    try {
      setAnalyticsCurrentView("tokenStats");
      clearAnalyticsErrors();

      // 프로젝트 전체 통계 로드
      await loadProjectTokenStats(selectedProject.path);

      // 현재 세션 통계 로드 (선택된 경우)
      if (selectedSession) {
        await loadSessionTokenStats(selectedSession.file_path);
      }
    } catch (error) {
      console.error("Failed to load token stats:", error);
      throw error;
    }
  }, [
    selectedProject,
    selectedSession,
    setAnalyticsCurrentView,
    clearAnalyticsErrors,
    loadProjectTokenStats,
    loadSessionTokenStats,
  ]);

  /**
   * 분석 뷰로 전환
   * 복잡한 데이터 로딩이 필요하므로 에러 핸들링 포함
   */
  const switchToAnalytics = useCallback(async () => {
    if (!selectedProject) {
      throw new Error("프로젝트가 선택되지 않았습니다.");
    }

    try {
      setAnalyticsCurrentView("analytics");
      clearAnalyticsErrors();

      // 프로젝트 요약 로드
      setAnalyticsLoadingProjectSummary(true);
      try {
        const summary = await loadProjectStatsSummary(selectedProject.path);
        setAnalyticsProjectSummary(summary);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "프로젝트 요약 로드 실패";
        setAnalyticsProjectSummaryError(errorMessage);
        throw error;
      } finally {
        setAnalyticsLoadingProjectSummary(false);
      }

      // 세션 비교 로드 (선택된 경우)
      if (selectedSession) {
        setAnalyticsLoadingSessionComparison(true);
        try {
          const comparison = await loadSessionComparison(
            selectedSession.actual_session_id,
            selectedProject.path
          );
          setAnalyticsSessionComparison(comparison);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "세션 비교 로드 실패";
          setAnalyticsSessionComparisonError(errorMessage);
          // 세션 비교 실패는 치명적이지 않으므로 에러를 throw하지 않음
        } finally {
          setAnalyticsLoadingSessionComparison(false);
        }
      }
    } catch (error) {
      console.error("Failed to load analytics:", error);
      throw error;
    }
  }, [
    selectedProject,
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
  ]);

  /**
   * 최근 편집 뷰로 전환
   * 프로젝트의 모든 파일 편집 기록을 로드
   */
  const switchToRecentEdits = useCallback(async () => {
    if (!selectedProject) {
      throw new Error("프로젝트가 선택되지 않았습니다.");
    }

    try {
      setAnalyticsCurrentView("recentEdits");
      clearAnalyticsErrors();

      setAnalyticsLoadingRecentEdits(true);
      try {
        const result = await loadRecentEdits(selectedProject.path);
        setAnalyticsRecentEdits(result);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "최근 편집 로드 실패";
        setAnalyticsRecentEditsError(errorMessage);
        throw error;
      } finally {
        setAnalyticsLoadingRecentEdits(false);
      }
    } catch (error) {
      console.error("Failed to load recent edits:", error);
      throw error;
    }
  }, [
    selectedProject,
    setAnalyticsCurrentView,
    clearAnalyticsErrors,
    setAnalyticsLoadingRecentEdits,
    setAnalyticsRecentEdits,
    setAnalyticsRecentEditsError,
    loadRecentEdits,
  ]);

  /**
   * 현재 뷰의 분석 데이터 새로고침
   * 현재 뷰에 따라 적절한 데이터만 다시 로드
   */
  const refreshAnalytics = useCallback(async () => {
    switch (analytics.currentView) {
      case "tokenStats":
        await switchToTokenStats();
        break;
      case "analytics":
        await switchToAnalytics();
        break;
      case "recentEdits":
        await switchToRecentEdits();
        break;
      case "messages":
        // 메시지 뷰는 별도 새로고침 로직 없음
        break;
      default:
        console.warn("Unknown analytics view:", analytics.currentView);
    }
  }, [analytics.currentView, switchToTokenStats, switchToAnalytics, switchToRecentEdits]);

  /**
   * 모든 analytics 상태 초기화
   */
  const clearAll = useCallback(() => {
    resetAnalytics();
    clearTokenStats();
  }, [resetAnalytics, clearTokenStats]);

  /**
   * 계산된 값들 (메모이제이션으로 성능 최적화)
   */
  const computed = useMemo(
    () => ({
      isTokenStatsView: analytics.currentView === "tokenStats",
      isAnalyticsView: analytics.currentView === "analytics",
      isMessagesView: analytics.currentView === "messages",
      isRecentEditsView: analytics.currentView === "recentEdits",
      hasAnyError: !!(
        analytics.projectSummaryError ||
        analytics.sessionComparisonError ||
        analytics.recentEditsError
      ),
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
   */
  useEffect(() => {
    if (analytics.currentView === "analytics" && selectedProject && selectedSession) {
      const updateSessionComparison = async () => {
        try {
          setAnalyticsLoadingSessionComparison(true);
          const comparison = await loadSessionComparison(
            selectedSession.actual_session_id,
            selectedProject.path
          );
          setAnalyticsSessionComparison(comparison);
          setAnalyticsSessionComparisonError(null);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "세션 비교 로드 실패";
          setAnalyticsSessionComparisonError(errorMessage);
          console.error("Failed to update session comparison:", error);
        } finally {
          setAnalyticsLoadingSessionComparison(false);
        }
      };

      updateSessionComparison();
    }
  }, [
    selectedSession?.actual_session_id,
    selectedProject?.path,
    selectedProject,
    selectedSession,
    analytics.currentView,
    loadSessionComparison,
    setAnalyticsLoadingSessionComparison,
    setAnalyticsSessionComparison,
    setAnalyticsSessionComparisonError,
  ]);

  /**
   * 사이드 이팩트: 토큰 통계 뷰에서 세션 변경 시 세션 토큰 통계 자동 새로고침
   */
  useEffect(() => {
    if (analytics.currentView === "tokenStats" && selectedSession) {
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
    selectedSession?.session_id,
    selectedSession?.file_path,
    selectedSession,
    analytics.currentView,
    loadSessionTokenStats,
  ]);

  return {
    state: analytics,
    actions: {
      switchToMessages,
      switchToTokenStats,
      switchToAnalytics,
      switchToRecentEdits,
      refreshAnalytics,
      clearAll,
    },
    computed,
  };
};
