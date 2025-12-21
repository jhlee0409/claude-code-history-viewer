import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import {
  type AppState,
  type ClaudeProject,
  type ClaudeSession,
  type ClaudeMessage,
  type SearchFilters,
  type SessionTokenStats,
  type ProjectStatsSummary,
  type SessionComparison,
  type GlobalStatsSummary,
  type AppError,
  AppErrorType,
} from "../types";
import {
  type AnalyticsState,
  type AnalyticsViewType,
  initialAnalyticsState,
} from "../types/analytics";
import {
  buildSearchIndex,
  searchMessages as searchMessagesFromIndex,
  clearSearchIndex,
} from "../utils/searchIndex";

// Tauri API가 사용 가능한지 확인하는 함수
const isTauriAvailable = () => {
  try {
    // Tauri v2에서는 invoke 함수가 바로 사용 가능합니다
    return typeof window !== "undefined" && typeof invoke === "function";
  } catch {
    return false;
  }
};

interface AppStore extends AppState {
  // Filter state
  excludeSidechain: boolean;

  // Analytics state
  analytics: AnalyticsState;

  // Session search state (클라이언트 측 검색)
  sessionSearch: SearchState;

  // Global stats state
  globalSummary: GlobalStatsSummary | null;
  isLoadingGlobalStats: boolean;

  // Actions
  initializeApp: () => Promise<void>;
  scanProjects: () => Promise<void>;
  selectProject: (project: ClaudeProject) => Promise<void>;
  selectSession: (session: ClaudeSession) => Promise<void>;
  refreshCurrentSession: () => Promise<void>;
  searchMessages: (query: string, filters?: SearchFilters) => Promise<void>;
  setSearchFilters: (filters: SearchFilters) => void;
  setError: (error: AppError | null) => void;
  setClaudePath: (path: string) => void;
  loadSessionTokenStats: (sessionPath: string) => Promise<void>;
  loadProjectTokenStats: (projectPath: string) => Promise<void>;
  loadProjectStatsSummary: (
    projectPath: string
  ) => Promise<ProjectStatsSummary>;
  loadSessionComparison: (
    sessionId: string,
    projectPath: string
  ) => Promise<SessionComparison>;
  clearTokenStats: () => void;
  setExcludeSidechain: (exclude: boolean) => void;

  // Session search actions (카카오톡 스타일 네비게이션 검색)
  setSessionSearchQuery: (query: string) => void;
  goToNextMatch: () => void;
  goToPrevMatch: () => void;
  goToMatchIndex: (index: number) => void;
  clearSessionSearch: () => void;

  // Global stats actions
  loadGlobalStats: () => Promise<void>;
  clearGlobalStats: () => void;

  // Analytics actions
  setAnalyticsCurrentView: (view: AnalyticsViewType) => void;
  setAnalyticsProjectSummary: (summary: ProjectStatsSummary | null) => void;
  setAnalyticsSessionComparison: (comparison: SessionComparison | null) => void;
  setAnalyticsLoadingProjectSummary: (loading: boolean) => void;
  setAnalyticsLoadingSessionComparison: (loading: boolean) => void;
  setAnalyticsProjectSummaryError: (error: string | null) => void;
  setAnalyticsSessionComparisonError: (error: string | null) => void;
  resetAnalytics: () => void;
  clearAnalyticsErrors: () => void;
}

// 검색 매치 정보
export interface SearchMatch {
  messageUuid: string;
  messageIndex: number; // messages 배열 내 인덱스
}

// 검색 관련 상태 (카카오톡 스타일 네비게이션)
export interface SearchState {
  query: string;
  matches: SearchMatch[];
  currentMatchIndex: number;
  isSearching: boolean;
  /**
   * @deprecated matches 필드를 사용하세요. 이 필드는 하위 호환성을 위해 유지됩니다.
   */
  results: ClaudeMessage[];
}

export const useAppStore = create<AppStore>((set, get) => ({
  // Initial state
  claudePath: "",
  projects: [],
  selectedProject: null,
  sessions: [],
  selectedSession: null,
  messages: [],
  // Note: Pagination is deprecated - all messages are loaded at once
  pagination: {
    currentOffset: 0,
    pageSize: 0, // Always 0 - pagination disabled
    totalCount: 0,
    hasMore: false,
    isLoadingMore: false,
  },
  searchQuery: "",
  searchResults: [],
  searchFilters: {},
  isLoading: false,
  isLoadingProjects: false,
  isLoadingSessions: false,
  isLoadingMessages: false,
  isLoadingTokenStats: false,
  error: null,
  sessionTokenStats: null,
  projectTokenStats: [],
  excludeSidechain: true,

  // Session search state (카카오톡 스타일 네비게이션 검색)
  sessionSearch: {
    query: "",
    matches: [],
    currentMatchIndex: -1,
    isSearching: false,
    results: [], // Legacy
  },

  // Analytics state
  analytics: initialAnalyticsState,

  // Global stats state
  globalSummary: null,
  isLoadingGlobalStats: false,

  // Actions
  initializeApp: async () => {
    set({ isLoading: true, error: null });
    try {
      if (!isTauriAvailable()) {
        throw new Error(
          "Tauri API를 사용할 수 없습니다. 데스크톱 앱에서 실행해주세요."
        );
      }

      // Try to load saved settings first
      try {
        const store = await load("settings.json", { autoSave: false });
        const savedPath = await store.get<string>("claudePath");

        if (savedPath) {
          // Validate saved path
          const isValid = await invoke<boolean>("validate_claude_folder", {
            path: savedPath,
          });
          if (isValid) {
            set({ claudePath: savedPath });
            await get().scanProjects();
            return;
          }
        }
      } catch {
        // Store doesn't exist yet, that's okay
        console.log("No saved settings found");
      }

      // Try default path
      const claudePath = await invoke<string>("get_claude_folder_path");
      set({ claudePath });
      await get().scanProjects();
    } catch (error) {
      console.error("Failed to initialize app:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Parse error type from message
      let errorType = AppErrorType.UNKNOWN;
      let message = errorMessage;

      if (errorMessage.includes("CLAUDE_FOLDER_NOT_FOUND:")) {
        errorType = AppErrorType.CLAUDE_FOLDER_NOT_FOUND;
        message = errorMessage.split(":")[1] || errorMessage;
      } else if (errorMessage.includes("PERMISSION_DENIED:")) {
        errorType = AppErrorType.PERMISSION_DENIED;
        message = errorMessage.split(":")[1] || errorMessage;
      } else if (errorMessage.includes("Tauri API")) {
        errorType = AppErrorType.TAURI_NOT_AVAILABLE;
      }

      set({ error: { type: errorType, message } });
    } finally {
      set({ isLoading: false });
    }
  },

  scanProjects: async () => {
    const { claudePath } = get();
    if (!claudePath) return;

    set({ isLoadingProjects: true, error: null });
    try {
      const start = performance.now();
      const projects = await invoke<ClaudeProject[]>("scan_projects", {
        claudePath,
      });
      const duration = performance.now() - start;
      if (import.meta.env.DEV) {
        console.log(
          `🚀 [Frontend] scanProjects: ${
            projects.length
          }개 프로젝트, ${duration.toFixed(1)}ms`
        );
      }

      set({ projects });
    } catch (error) {
      console.error("Failed to scan projects:", error);
      set({ error: { type: AppErrorType.UNKNOWN, message: String(error) } });
    } finally {
      set({ isLoadingProjects: false });
    }
  },

  selectProject: async (project: ClaudeProject) => {
    set({
      selectedProject: project,
      sessions: [],
      selectedSession: null,
      messages: [],
      isLoadingSessions: true,
    });
    try {
      const sessions = await invoke<ClaudeSession[]>("load_project_sessions", {
        projectPath: project.path,
        excludeSidechain: get().excludeSidechain,
      });
      set({ sessions });
    } catch (error) {
      console.error("Failed to load project sessions:", error);
      set({ error: { type: AppErrorType.UNKNOWN, message: String(error) } });
    } finally {
      set({ isLoadingSessions: false });
    }
  },

  selectSession: async (session: ClaudeSession) => {
    // 이전 세션의 검색 인덱스 초기화
    clearSearchIndex();

    set({
      selectedSession: session,
      messages: [],
      pagination: {
        currentOffset: 0,
        pageSize: 0,
        totalCount: 0,
        hasMore: false,
        isLoadingMore: false,
      },
      sessionSearch: {
        query: "",
        matches: [],
        currentMatchIndex: -1,
        results: [],
        isSearching: false,
      },
      isLoadingMessages: true,
    });

    try {
      const sessionPath = session.file_path;
      const start = performance.now();

      // 전체 메시지 한 번에 로드 (페이지네이션 제거)
      const allMessages = await invoke<ClaudeMessage[]>(
        "load_session_messages",
        { sessionPath }
      );

      // sidechain 필터링 (프론트엔드에서 처리)
      const filteredMessages = get().excludeSidechain
        ? allMessages.filter((m) => !m.isSidechain)
        : allMessages;

      const duration = performance.now() - start;
      if (import.meta.env.DEV) {
        console.log(
          `🚀 [Frontend] selectSession: ${filteredMessages.length}개 메시지 로드, ${duration.toFixed(1)}ms`
        );
      }

      // FlexSearch 인덱스 구축 (동기 실행, 대부분의 경우 수 밀리초 이내 완료)
      buildSearchIndex(filteredMessages);

      set({
        messages: filteredMessages,
        pagination: {
          currentOffset: filteredMessages.length,
          pageSize: filteredMessages.length,
          totalCount: filteredMessages.length,
          hasMore: false,
          isLoadingMore: false,
        },
        isLoadingMessages: false,
      });
    } catch (error) {
      console.error("Failed to load session messages:", error);
      set({
        error: { type: AppErrorType.UNKNOWN, message: String(error) },
        isLoadingMessages: false,
      });
    }
  },

  searchMessages: async (query: string, filters: SearchFilters = {}) => {
    const { claudePath } = get();
    if (!claudePath || !query.trim()) {
      set({ searchResults: [], searchQuery: "" });
      return;
    }

    set({ isLoadingMessages: true, searchQuery: query });
    try {
      const results = await invoke<ClaudeMessage[]>("search_messages", {
        claudePath,
        query,
        filters,
      });
      set({ searchResults: results });
    } catch (error) {
      console.error("Failed to search messages:", error);
      set({ error: { type: AppErrorType.UNKNOWN, message: String(error) } });
    } finally {
      set({ isLoadingMessages: false });
    }
  },

  refreshCurrentSession: async () => {
    const { selectedProject, selectedSession, analytics } = get();

    if (!selectedSession) {
      console.warn("No session selected for refresh");
      return;
    }

    console.log("새로고침 시작:", selectedSession.session_id);

    // 로딩 상태 설정 (selectSession이 내부적으로 isLoadingMessages를 관리함)
    set({ error: null });

    try {
      // 프로젝트 세션 목록도 새로고침하여 message_count 업데이트
      if (selectedProject) {
        const sessions = await invoke<ClaudeSession[]>(
          "load_project_sessions",
          {
            projectPath: selectedProject.path,
            excludeSidechain: get().excludeSidechain,
          }
        );
        set({ sessions });
      }

      // 현재 세션을 다시 로드
      await get().selectSession(selectedSession);
      
      // 분석 뷰일 때 분석 데이터도 새로고침
      if (selectedProject && (analytics.currentView === "tokenStats" || analytics.currentView === "analytics")) {
        console.log("분석 데이터 새로고침 시작:", analytics.currentView);
        
        if (analytics.currentView === "tokenStats") {
          // 토큰 통계 새로고침
          await get().loadProjectTokenStats(selectedProject.path);
          if (selectedSession?.file_path) {
            await get().loadSessionTokenStats(selectedSession.file_path);
          }
        } else if (analytics.currentView === "analytics") {
          // 분석 대시보드 새로고침
          const projectSummary = await invoke<ProjectStatsSummary>(
            "get_project_stats_summary",
            { projectPath: selectedProject.path }
          );
          get().setAnalyticsProjectSummary(projectSummary);
          
          // 세션 비교 데이터도 새로고침
          if (selectedSession) {
            const sessionComparison = await invoke<SessionComparison>(
              "get_session_comparison",
              { 
                sessionId: selectedSession.actual_session_id,
                projectPath: selectedProject.path 
              }
            );
            get().setAnalyticsSessionComparison(sessionComparison);
          }
        }
        
        console.log("분석 데이터 새로고침 완료");
      }
      
      console.log("새로고침 완료");
    } catch (error) {
      console.error("새로고침 실패:", error);
      set({ error: { type: AppErrorType.UNKNOWN, message: String(error) } });
    }
  },

  setSearchFilters: (filters: SearchFilters) => {
    set({ searchFilters: filters });
  },

  setError: (error: AppError | null) => {
    set({ error });
  },

  setClaudePath: async (path: string) => {
    set({ claudePath: path });

    // Save to persistent storage
    try {
      const store = await load("settings.json", { autoSave: false });
      await store.set("claudePath", path);
      await store.save();
    } catch (error) {
      console.error("Failed to save claude path:", error);
    }
  },

  loadSessionTokenStats: async (sessionPath: string) => {
    try {
      set({ isLoadingTokenStats: true, error: null });
      const stats = await invoke<SessionTokenStats>("get_session_token_stats", {
        sessionPath,
      });
      set({ sessionTokenStats: stats });
    } catch (error) {
      console.error("Failed to load session token stats:", error);
      set({
        error: {
          type: AppErrorType.UNKNOWN,
          message: `Failed to load token stats: ${error}`,
        },
        sessionTokenStats: null,
      });
    } finally {
      set({ isLoadingTokenStats: false });
    }
  },

  loadProjectTokenStats: async (projectPath: string) => {
    try {
      set({ isLoadingTokenStats: true, error: null });
      const stats = await invoke<SessionTokenStats[]>(
        "get_project_token_stats",
        {
          projectPath,
        }
      );
      set({ projectTokenStats: stats });
    } catch (error) {
      console.error("Failed to load project token stats:", error);
      set({
        error: {
          type: AppErrorType.UNKNOWN,
          message: `Failed to load project token stats: ${error}`,
        },
        projectTokenStats: [],
      });
    } finally {
      set({ isLoadingTokenStats: false });
    }
  },

  loadProjectStatsSummary: async (projectPath: string) => {
    try {
      const summary = await invoke("get_project_stats_summary", {
        projectPath,
      });
      return summary as ProjectStatsSummary;
    } catch (error) {
      console.error("Failed to load project stats summary:", error);
      throw error;
    }
  },

  loadSessionComparison: async (sessionId: string, projectPath: string) => {
    try {
      const comparison = await invoke("get_session_comparison", {
        sessionId,
        projectPath,
      });
      return comparison as SessionComparison;
    } catch (error) {
      console.error("Failed to load session comparison:", error);
      throw error;
    }
  },

  clearTokenStats: () => {
    set({ sessionTokenStats: null, projectTokenStats: [] });
  },

  // Global stats actions
  loadGlobalStats: async () => {
    const { claudePath } = get();
    if (!claudePath) return;

    set({ isLoadingGlobalStats: true, error: null });
    try {
      const summary = await invoke<GlobalStatsSummary>(
        "get_global_stats_summary",
        { claudePath }
      );
      set({ globalSummary: summary });
    } catch (error) {
      console.error("Failed to load global stats:", error);
      set({
        error: { type: AppErrorType.UNKNOWN, message: String(error) },
        globalSummary: null
      });
    } finally {
      set({ isLoadingGlobalStats: false });
    }
  },

  clearGlobalStats: () => {
    set({ globalSummary: null });
  },

  setExcludeSidechain: (exclude: boolean) => {
    set({ excludeSidechain: exclude });
    // 필터 변경 시 현재 프로젝트와 세션 새로고침
    const { selectedProject, selectedSession } = get();
    if (selectedProject) {
      // 프로젝트 다시 로드하여 세션 목록의 message_count 업데이트
      get().selectProject(selectedProject);
    }
    if (selectedSession) {
      get().selectSession(selectedSession);
    }
  },

  // Analytics actions
  setAnalyticsCurrentView: (view: AnalyticsViewType) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        currentView: view,
      },
    }));
  },

  setAnalyticsProjectSummary: (summary: ProjectStatsSummary | null) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        projectSummary: summary,
      },
    }));
  },

  setAnalyticsSessionComparison: (comparison: SessionComparison | null) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        sessionComparison: comparison,
      },
    }));
  },

  setAnalyticsLoadingProjectSummary: (loading: boolean) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        isLoadingProjectSummary: loading,
      },
    }));
  },

  setAnalyticsLoadingSessionComparison: (loading: boolean) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        isLoadingSessionComparison: loading,
      },
    }));
  },

  setAnalyticsProjectSummaryError: (error: string | null) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        projectSummaryError: error,
      },
    }));
  },

  setAnalyticsSessionComparisonError: (error: string | null) => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        sessionComparisonError: error,
      },
    }));
  },

  resetAnalytics: () => {
    set({ analytics: initialAnalyticsState });
  },

  clearAnalyticsErrors: () => {
    set((state) => ({
      analytics: {
        ...state.analytics,
        projectSummaryError: null,
        sessionComparisonError: null,
      },
    }));
  },

  // Session search actions (카카오톡 스타일 네비게이션 검색)
  setSessionSearchQuery: (query: string) => {
    const { messages } = get();

    if (!query.trim()) {
      set({
        sessionSearch: {
          query: "",
          matches: [],
          currentMatchIndex: -1,
          isSearching: false,
          results: [],
        },
      });
      return;
    }

    set((state) => ({
      sessionSearch: {
        ...state.sessionSearch,
        query,
        isSearching: true,
      },
    }));

    try {
      // FlexSearch를 사용한 고속 검색 (역색인 기반 O(1) ~ O(log n))
      const searchResults = searchMessagesFromIndex(query);

      // SearchMatch 형식으로 변환 (유효한 인덱스만 필터링)
      const matches: SearchMatch[] = searchResults
        .filter((result) => result.messageIndex >= 0 && result.messageIndex < messages.length)
        .map((result) => ({
          messageUuid: result.messageUuid,
          messageIndex: result.messageIndex,
        }));

      // 매치 결과 저장 (첫 번째 매치로 자동 이동)
      set({
        sessionSearch: {
          query,
          matches,
          currentMatchIndex: matches.length > 0 ? 0 : -1,
          isSearching: false,
          results: matches.map((m) => messages[m.messageIndex]), // Legacy 호환
        },
      });
    } catch (error) {
      console.error("Search failed:", error);
      set({
        sessionSearch: {
          query,
          matches: [],
          currentMatchIndex: -1,
          isSearching: false,
          results: [],
        },
      });
    }
  },

  // 다음 검색 결과로 이동
  goToNextMatch: () => {
    const { sessionSearch } = get();
    if (sessionSearch.matches.length === 0) return;

    const nextIndex = (sessionSearch.currentMatchIndex + 1) % sessionSearch.matches.length;
    set({
      sessionSearch: {
        ...sessionSearch,
        currentMatchIndex: nextIndex,
      },
    });
  },

  // 이전 검색 결과로 이동
  goToPrevMatch: () => {
    const { sessionSearch } = get();
    if (sessionSearch.matches.length === 0) return;

    const prevIndex = sessionSearch.currentMatchIndex <= 0
      ? sessionSearch.matches.length - 1
      : sessionSearch.currentMatchIndex - 1;
    set({
      sessionSearch: {
        ...sessionSearch,
        currentMatchIndex: prevIndex,
      },
    });
  },

  // 특정 인덱스로 이동
  goToMatchIndex: (index: number) => {
    const { sessionSearch } = get();
    if (index < 0 || index >= sessionSearch.matches.length) return;

    set({
      sessionSearch: {
        ...sessionSearch,
        currentMatchIndex: index,
      },
    });
  },

  clearSessionSearch: () => {
    set({
      sessionSearch: {
        query: "",
        matches: [],
        currentMatchIndex: -1,
        isSearching: false,
        results: [],
      },
    });
  },
}));
