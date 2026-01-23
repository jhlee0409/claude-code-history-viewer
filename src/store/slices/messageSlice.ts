/**
 * Message Slice
 *
 * Handles message loading and session data.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  ClaudeMessage,
  ClaudeSession,
  PaginationState,
  SessionTokenStats,
  PaginatedTokenStats,
  ProjectStatsSummary,
  SessionComparison,
} from "../../types";
import { AppErrorType } from "../../types";
import type { StateCreator } from "zustand";
import { buildSearchIndex, clearSearchIndex } from "../../utils/searchIndex";
import type { FullAppStore } from "./types";

// ============================================================================
// State Interface
// ============================================================================

/** Pagination state for project token stats */
export interface ProjectTokenStatsPagination {
  totalCount: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  isLoadingMore: boolean;
}

export interface MessageSliceState {
  messages: ClaudeMessage[];
  pagination: PaginationState;
  isLoadingMessages: boolean;
  isLoadingTokenStats: boolean;
  sessionTokenStats: SessionTokenStats | null;
  projectTokenStats: SessionTokenStats[];
  projectTokenStatsPagination: ProjectTokenStatsPagination;
}

export interface MessageSliceActions {
  selectSession: (session: ClaudeSession) => Promise<void>;
  refreshCurrentSession: () => Promise<void>;
  loadSessionTokenStats: (sessionPath: string) => Promise<void>;
  loadProjectTokenStats: (projectPath: string) => Promise<void>;
  loadMoreProjectTokenStats: (projectPath: string) => Promise<void>;
  loadProjectStatsSummary: (
    projectPath: string
  ) => Promise<ProjectStatsSummary>;
  loadSessionComparison: (
    sessionId: string,
    projectPath: string
  ) => Promise<SessionComparison>;
  clearTokenStats: () => void;
}

export type MessageSlice = MessageSliceState & MessageSliceActions;

// ============================================================================
// Initial State
// ============================================================================

const TOKENS_STATS_PAGE_SIZE = 20;

export const initialMessageState: MessageSliceState = {
  messages: [],
  pagination: {
    currentOffset: 0,
    pageSize: 0,
    totalCount: 0,
    hasMore: false,
    isLoadingMore: false,
  },
  isLoadingMessages: false,
  isLoadingTokenStats: false,
  sessionTokenStats: null,
  projectTokenStats: [],
  projectTokenStatsPagination: {
    totalCount: 0,
    offset: 0,
    limit: TOKENS_STATS_PAGE_SIZE,
    hasMore: false,
    isLoadingMore: false,
  },
};

// ============================================================================
// Slice Creator
// ============================================================================

export const createMessageSlice: StateCreator<
  FullAppStore,
  [],
  [],
  MessageSlice
> = (set, get) => ({
  ...initialMessageState,

  selectSession: async (session: ClaudeSession) => {
    // Clear previous session's search index
    clearSearchIndex();

    set({
      messages: [],
      pagination: {
        currentOffset: 0,
        pageSize: 0,
        totalCount: 0,
        hasMore: false,
        isLoadingMore: false,
      },
      isLoadingMessages: true,
    });

    get().setSelectedSession(session);
    // Note: sessionSearch state reset is handled by searchSlice

    try {
      const sessionPath = session.file_path;
      const start = performance.now();

      const allMessages = await invoke<ClaudeMessage[]>(
        "load_session_messages",
        { sessionPath }
      );

      // Apply sidechain filter
      let filteredMessages = get().excludeSidechain
        ? allMessages.filter((m) => !m.isSidechain)
        : allMessages;

      // Apply system message filter
      const systemMessageTypes = [
        "queue-operation",
        "progress",
        "file-history-snapshot",
      ];
      if (!get().showSystemMessages) {
        filteredMessages = filteredMessages.filter(
          (m) => !systemMessageTypes.includes(m.type)
        );
      }

      const duration = performance.now() - start;
      if (import.meta.env.DEV) {
        console.log(
          `[Frontend] selectSession: ${filteredMessages.length}개 메시지 로드, ${duration.toFixed(1)}ms`
        );
      }

      // Build FlexSearch index
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
      get().setError({ type: AppErrorType.UNKNOWN, message: String(error) });
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
    get().setError(null);

    try {
      // Refresh project sessions list
      if (selectedProject) {
        const sessions = await invoke<ClaudeSession[]>(
          "load_project_sessions",
          {
            projectPath: selectedProject.path,
            excludeSidechain: get().excludeSidechain,
          }
        );
        get().setSessions(sessions);
      }

      // Reload current session
      await get().selectSession(selectedSession);

      // Refresh analytics data if in analytics view
      if (
        selectedProject &&
        (analytics.currentView === "tokenStats" ||
          analytics.currentView === "analytics")
      ) {
        console.log("분석 데이터 새로고침 시작:", analytics.currentView);

        if (analytics.currentView === "tokenStats") {
          await get().loadProjectTokenStats(selectedProject.path);
          if (selectedSession?.file_path) {
            await get().loadSessionTokenStats(selectedSession.file_path);
          }
        } else if (analytics.currentView === "analytics") {
          const projectSummary = await invoke<ProjectStatsSummary>(
            "get_project_stats_summary",
            { projectPath: selectedProject.path }
          );
          get().setAnalyticsProjectSummary(projectSummary);

          if (selectedSession) {
            const sessionComparison = await invoke<SessionComparison>(
              "get_session_comparison",
              {
                sessionId: selectedSession.actual_session_id,
                projectPath: selectedProject.path,
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
      get().setError({ type: AppErrorType.UNKNOWN, message: String(error) });
    }
  },

  loadSessionTokenStats: async (sessionPath: string) => {
    try {
      set({ isLoadingTokenStats: true });
      get().setError(null);
      const stats = await invoke<SessionTokenStats>("get_session_token_stats", {
        sessionPath,
      });
      set({ sessionTokenStats: stats });
    } catch (error) {
      console.error("Failed to load session token stats:", error);
      get().setError({
        type: AppErrorType.UNKNOWN,
        message: `Failed to load token stats: ${error}`,
      });
      set({ sessionTokenStats: null });
    } finally {
      set({ isLoadingTokenStats: false });
    }
  },

  loadProjectTokenStats: async (projectPath: string) => {
    try {
      set({
        isLoadingTokenStats: true,
        projectTokenStats: [], // Reset on new project load
        projectTokenStatsPagination: {
          ...initialMessageState.projectTokenStatsPagination,
        },
      });
      get().setError(null);

      const response = await invoke<PaginatedTokenStats>(
        "get_project_token_stats",
        { projectPath, offset: 0, limit: TOKENS_STATS_PAGE_SIZE }
      );

      set({
        projectTokenStats: response.items,
        projectTokenStatsPagination: {
          totalCount: response.total_count,
          offset: response.offset,
          limit: response.limit,
          hasMore: response.has_more,
          isLoadingMore: false,
        },
      });
    } catch (error) {
      console.error("Failed to load project token stats:", error);
      get().setError({
        type: AppErrorType.UNKNOWN,
        message: `Failed to load project token stats: ${error}`,
      });
      set({ projectTokenStats: [] });
    } finally {
      set({ isLoadingTokenStats: false });
    }
  },

  loadMoreProjectTokenStats: async (projectPath: string) => {
    const { projectTokenStatsPagination, projectTokenStats } = get();

    if (!projectTokenStatsPagination.hasMore || projectTokenStatsPagination.isLoadingMore) {
      return;
    }

    try {
      set({
        projectTokenStatsPagination: {
          ...projectTokenStatsPagination,
          isLoadingMore: true,
        },
      });

      const nextOffset = projectTokenStatsPagination.offset + projectTokenStatsPagination.limit;

      const response = await invoke<PaginatedTokenStats>(
        "get_project_token_stats",
        { projectPath, offset: nextOffset, limit: TOKENS_STATS_PAGE_SIZE }
      );

      set({
        projectTokenStats: [...projectTokenStats, ...response.items],
        projectTokenStatsPagination: {
          totalCount: response.total_count,
          offset: response.offset,
          limit: response.limit,
          hasMore: response.has_more,
          isLoadingMore: false,
        },
      });
    } catch (error) {
      console.error("Failed to load more project token stats:", error);
      set({
        projectTokenStatsPagination: {
          ...projectTokenStatsPagination,
          isLoadingMore: false,
        },
      });
    }
  },

  loadProjectStatsSummary: async (projectPath: string) => {
    const summary = await invoke<ProjectStatsSummary>(
      "get_project_stats_summary",
      { projectPath }
    );
    return summary;
  },

  loadSessionComparison: async (sessionId: string, projectPath: string) => {
    const comparison = await invoke<SessionComparison>(
      "get_session_comparison",
      { sessionId, projectPath }
    );
    return comparison;
  },

  clearTokenStats: () => {
    set({ sessionTokenStats: null, projectTokenStats: [] });
  },
});
