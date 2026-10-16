/**
 * Analytics 관련 타입 정의
 * 가독성과 예측 가능성을 위한 명확한 타입 구조
 */

import type { ProjectStatsSummary, SessionComparison, RecentEditsResult } from './index';
import type { RecentEditsPaginationState } from '../utils/pagination';
import type { MetricMode, StatsMode } from "./stats.types";

/**
 * Pagination state for recent edits
 * Re-exported from pagination utilities for backwards compatibility
 */
export type RecentEditsPagination = RecentEditsPaginationState;

/**
 * Analytics 상태 인터페이스
 * - 높은 응집도: 관련된 상태들을 하나로 묶음
 * - 낮은 결합도: 각 상태는 독립적으로 관리 가능
 */
export interface AnalyticsState {
  // The open screen is navigation state (`view`, navigationSlice), not
  // analytics state.
  statsMode: StatsMode;
  metricMode: MetricMode;

  // 데이터 상태
  projectSummary: ProjectStatsSummary | null;
  projectConversationSummary: ProjectStatsSummary | null;
  sessionComparison: SessionComparison | null;
  recentEdits: RecentEditsResult | null;
  recentEditsPagination: RecentEditsPagination;
  /**
   * Bumped on every write to `recentEdits`, a clear included. A page fetched
   * against an older generation no longer continues the list on screen, so it
   * must not be appended to it.
   */
  recentEditsGeneration: number;

  recentEditsSearchQuery: string;

  // 로딩 상태
  isLoadingProjectSummary: boolean;
  isLoadingSessionComparison: boolean;
  isLoadingRecentEdits: boolean;

  // 에러 상태
  projectSummaryError: string | null;
  sessionComparisonError: string | null;
  recentEditsError: string | null;

  /**
   * Whose each value is: the project path (or, for the session comparison,
   * the session file path) it was loaded for. A screen shows a value only on
   * its owner's place (`navigation/screenOwner.ts`).
   */
  projectSummaryOwner: string | null;
  projectConversationSummaryOwner: string | null;
  sessionComparisonOwner: string | null;
  recentEditsOwner: string | null;
  projectSummaryErrorOwner: string | null;
  sessionComparisonErrorOwner: string | null;
  recentEditsErrorOwner: string | null;
}

/**
 * Analytics 액션 인터페이스
 * 단일 책임 원칙을 따라 각 액션은 하나의 역할만 수행
 */
export interface AnalyticsActions {
  // 데이터 설정
  setProjectSummary: (summary: ProjectStatsSummary | null) => void;
  setProjectConversationSummary: (summary: ProjectStatsSummary | null) => void;
  setSessionComparison: (comparison: SessionComparison | null) => void;
  setRecentEdits: (edits: RecentEditsResult | null) => void;
  setRecentEditsSearchQuery: (query: string) => void;

  // 로딩 상태 관리
  setLoadingProjectSummary: (loading: boolean) => void;
  setLoadingSessionComparison: (loading: boolean) => void;
  setLoadingRecentEdits: (loading: boolean) => void;

  // 에러 상태 관리
  setProjectSummaryError: (error: string | null) => void;
  setSessionComparisonError: (error: string | null) => void;
  setRecentEditsError: (error: string | null) => void;

  // 복합 액션 (비즈니스 로직)
  switchToMessages: () => void;
  switchToTokenStats: () => void;
  switchToAnalytics: () => void;
  switchToRecentEdits: () => void;
  setStatsMode: (mode: StatsMode, options?: { isGlobalScope?: boolean }) => Promise<void>;
  setMetricMode: (mode: MetricMode) => void;

  // 초기화
  resetAnalytics: () => void;
  clearErrors: () => void;
}

/**
 * Analytics 초기 상태
 */
import { createInitialRecentEditsPagination } from '../utils/pagination';

export const initialRecentEditsPagination: RecentEditsPagination =
  createInitialRecentEditsPagination();

export const initialAnalyticsState: AnalyticsState = {
  statsMode: "billing_total",
  metricMode: "tokens",
  projectSummary: null,
  projectConversationSummary: null,
  sessionComparison: null,
  recentEdits: null,
  recentEditsPagination: initialRecentEditsPagination,
  recentEditsGeneration: 0,
  recentEditsSearchQuery: "",
  isLoadingProjectSummary: false,
  isLoadingSessionComparison: false,
  isLoadingRecentEdits: false,
  projectSummaryError: null,
  sessionComparisonError: null,
  recentEditsError: null,
  projectSummaryOwner: null,
  projectConversationSummaryOwner: null,
  sessionComparisonOwner: null,
  recentEditsOwner: null,
  projectSummaryErrorOwner: null,
  sessionComparisonErrorOwner: null,
  recentEditsErrorOwner: null,
};

/**
 * Analytics Hook 리턴 타입
 * 컴포넌트에서 필요한 최소한의 인터페이스만 노출
 */
export interface UseAnalyticsReturn {
  // 상태 (읽기 전용)
  readonly state: AnalyticsState;

  // 액션 (예측 가능한 이름)
  readonly actions: {
    switchToMessages: () => void;
    switchToTokenStats: () => Promise<void>;
    switchToAnalytics: () => Promise<void>;
    switchToRecentEdits: () => Promise<void>;
    switchToSettings: () => void;
    switchToBoard: () => Promise<void>;
    switchToArchive: () => void;
    switchToGlobalStats: () => Promise<void>;
    /** Open a screen of the current context and load its data. */
    openView: (view: import("../navigation/place").View) => Promise<void>;
    /** Back/forward through visited places; false at either end. */
    goBack: () => Promise<boolean>;
    goForward: () => Promise<boolean>;
    setStatsMode: (mode: StatsMode, options?: { isGlobalScope?: boolean }) => Promise<void>;
    setMetricMode: (mode: MetricMode) => void;
    refreshAnalytics: () => Promise<void>;
    clearAll: () => void;
  };

  // 계산된 값들
  readonly computed: {
    isTokenStatsView: boolean;
    /** Project analytics; global stats is `isGlobalStatsView`. */
    isAnalyticsView: boolean;
    isGlobalStatsView: boolean;
    isMessagesView: boolean;
    isRecentEditsView: boolean;
    isSettingsView: boolean;
    isBoardView: boolean;
    isArchiveView: boolean;
    /** A fallback (or a project screen without a project): nothing to show. */
    isEmptyView: boolean;
    hasAnyError: boolean;
    isLoadingAnalytics: boolean;
    isLoadingTokenStats: boolean;
    isLoadingRecentEdits: boolean;
    isAnyLoading: boolean;
  };
}

/**
 * Analytics 컨텍스트 타입
 * 프로젝트와 세션 정보를 담는 컨텍스트
 */
export interface AnalyticsContext {
  selectedProject: {
    name: string;
    path: string;
  } | null;
  selectedSession: {
    session_id: string;
    file_path: string;
  } | null;
}
