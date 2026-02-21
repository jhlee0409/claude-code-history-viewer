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
  ProjectStatsSummary,
  SessionComparison,
} from "../../types";
import { AppErrorType } from "../../types";
import type { StateCreator } from "zustand";
import { buildSearchIndex, clearSearchIndex } from "../../utils/searchIndex";
import type { FullAppStore } from "./types";
import {
  fetchSessionTokenStats,
  fetchProjectTokenStats,
  fetchProjectStatsSummary,
  fetchSessionComparison,
} from "../../services/analyticsApi";
import {
  type ProjectTokenStatsPaginationState,
  createInitialPaginationWithCount,
  canLoadMore,
  getNextOffset,
} from "../../utils/pagination";
import { nextRequestId, getRequestId } from "../../utils/requestId";

// ============================================================================
// State Interface
// ============================================================================

/** Pagination state for project token stats */
export type ProjectTokenStatsPagination = ProjectTokenStatsPaginationState;

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

/** Initial pagination state — shared with `clearProjectSelection` to avoid duplication. */
export const INITIAL_PAGINATION = {
  currentOffset: 0,
  pageSize: 0,
  totalCount: 0,
  hasMore: false,
  isLoadingMore: false,
} as const;

const initialMessageState: MessageSliceState = {
  messages: [],
  pagination: { ...INITIAL_PAGINATION },
  isLoadingMessages: false,
  isLoadingTokenStats: false,
  sessionTokenStats: null,
  projectTokenStats: [],
  projectTokenStatsPagination: createInitialPaginationWithCount(TOKENS_STATS_PAGE_SIZE),
};

// ============================================================================
// Slice Creator
// ============================================================================

export const createMessageSlice: StateCreator<
  FullAppStore,
  [],
  [],
  MessageSlice
> = (set, get) => {
  let tokenStatsLoadingEpoch = 0;
  let tokenStatsInFlight = 0;

  const beginTokenStatsLoading = (): number => {
    const epoch = tokenStatsLoadingEpoch;
    tokenStatsInFlight += 1;
    if (tokenStatsInFlight === 1) {
      set({ isLoadingTokenStats: true });
    }
    return epoch;
  };

  const endTokenStatsLoading = (epoch: number): void => {
    if (epoch !== tokenStatsLoadingEpoch) {
      return;
    }
    tokenStatsInFlight = Math.max(0, tokenStatsInFlight - 1);
    if (tokenStatsInFlight === 0) {
      set({ isLoadingTokenStats: false });
    }
  };

  const resetTokenStatsLoading = (): void => {
    tokenStatsLoadingEpoch += 1;
    tokenStatsInFlight = 0;
    set({ isLoadingTokenStats: false });
  };

  return {
    ...initialMessageState,

  selectSession: async (session: ClaudeSession) => {
    // Clear previous session's search index
    clearSearchIndex();

    set({
      messages: [],
      pagination: { ...INITIAL_PAGINATION },
      isLoadingMessages: true,
    });

    get().setSelectedSession(session);
    // Note: sessionSearch state reset is handled by searchSlice

    try {
      const sessionPath = session.file_path;
      const start = performance.now();

      const provider = session.provider ?? "claude";
      const allMessages = await invoke<ClaudeMessage[]>("load_provider_messages", {
        provider,
        sessionPath,
      });

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

      // Update state first to allow UI to render immediately
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

      // Build FlexSearch index asynchronously after UI renders
      // The buildSearchIndex now internally uses chunked async processing
      if ("requestIdleCallback" in window) {
        (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(() => {
          buildSearchIndex(filteredMessages);
        });
      } else {
        setTimeout(() => {
          buildSearchIndex(filteredMessages);
        }, 0);
      }
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
        const provider = selectedProject.provider ?? "claude";
        const sessions = provider !== "claude"
          ? await invoke<ClaudeSession[]>("load_provider_sessions", {
              provider,
              projectPath: selectedProject.path,
              excludeSidechain: get().excludeSidechain,
            })
          : await invoke<ClaudeSession[]>("load_project_sessions", {
              projectPath: selectedProject.path,
              excludeSidechain: get().excludeSidechain,
            });
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
          const projectSummary = await fetchProjectStatsSummary(selectedProject.path);
          get().setAnalyticsProjectSummary(projectSummary);

          if (selectedSession) {
            const sessionComparison = await fetchSessionComparison(
              selectedSession.actual_session_id,
              selectedProject.path
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
    const requestId = nextRequestId("sessionTokenStats");
    const loadingEpoch = beginTokenStatsLoading();
    try {
      get().setError(null);

      const stats = await fetchSessionTokenStats(sessionPath);
      if (requestId !== getRequestId("sessionTokenStats")) return;
      set({ sessionTokenStats: stats });
    } catch (error) {
      if (requestId !== getRequestId("sessionTokenStats")) return;
      console.error("Failed to load session token stats:", error);
      get().setError({
        type: AppErrorType.UNKNOWN,
        message: `Failed to load token stats: ${error}`,
      });
      set({ sessionTokenStats: null });
    } finally {
      endTokenStatsLoading(loadingEpoch);
    }
  },

  loadProjectTokenStats: async (projectPath: string) => {
    const requestId = nextRequestId("projectTokenStats");
    const loadingEpoch = beginTokenStatsLoading();
    try {
      set({
        projectTokenStats: [], // Reset on new project load
        projectTokenStatsPagination: {
          ...initialMessageState.projectTokenStatsPagination,
        },
      });
      get().setError(null);

      const { dateFilter } = get();

      // Ensure end date includes the full day
      const endDate = dateFilter.end ? new Date(dateFilter.end) : null;
      if (endDate) {
        endDate.setHours(23, 59, 59, 999);
      }

      const response = await fetchProjectTokenStats(projectPath, {
        offset: 0,
        limit: TOKENS_STATS_PAGE_SIZE,
        start_date: dateFilter.start?.toISOString(),
        end_date: endDate?.toISOString(),
      });

      if (requestId !== getRequestId("projectTokenStats")) return;
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
      if (requestId !== getRequestId("projectTokenStats")) return;
      console.error("Failed to load project token stats:", error);
      get().setError({
        type: AppErrorType.UNKNOWN,
        message: `Failed to load project token stats: ${error}`,
      });
      set({ projectTokenStats: [] });
    } finally {
      endTokenStatsLoading(loadingEpoch);
    }
  },

  loadMoreProjectTokenStats: async (projectPath: string) => {
    const { projectTokenStatsPagination, projectTokenStats } = get();

    if (!canLoadMore(projectTokenStatsPagination)) {
      return;
    }

    // Snapshot the current request ID to detect if a full reset happened mid-flight.
    const snapshotId = getRequestId("projectTokenStats");

    try {
      set({
        projectTokenStatsPagination: {
          ...projectTokenStatsPagination,
          isLoadingMore: true,
        },
      });

      const nextOffset = getNextOffset(projectTokenStatsPagination);
      const { dateFilter } = get();

      // Ensure end date includes the full day
      const endDate = dateFilter.end ? new Date(dateFilter.end) : null;
      if (endDate) {
        endDate.setHours(23, 59, 59, 999);
      }

      const response = await fetchProjectTokenStats(projectPath, {
        offset: nextOffset,
        limit: TOKENS_STATS_PAGE_SIZE,
        start_date: dateFilter.start?.toISOString(),
        end_date: endDate?.toISOString(),
      });

      if (snapshotId !== getRequestId("projectTokenStats")) return;
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
      if (snapshotId !== getRequestId("projectTokenStats")) return;
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
    try {
      const { dateFilter } = get();

      // Ensure end date includes the full day
      const endDate = dateFilter.end ? new Date(dateFilter.end) : null;
      if (endDate) {
        endDate.setHours(23, 59, 59, 999);
      }

      return await fetchProjectStatsSummary(projectPath, {
        start_date: dateFilter.start?.toISOString(),
        end_date: endDate?.toISOString(),
      });
    } catch (error) {
      console.error("Failed to load project stats summary:", error);
      get().setError({ type: AppErrorType.UNKNOWN, message: String(error) });
      window.alert(`Failed to load project stats summary: ${String(error)}`);
      throw error;
    }
  },

  loadSessionComparison: async (sessionId: string, projectPath: string) => {
    return fetchSessionComparison(sessionId, projectPath);
  },

  clearTokenStats: () => {
    // Bump both request IDs so any in-flight token stats requests are invalidated.
    nextRequestId("sessionTokenStats");
    nextRequestId("projectTokenStats");
    resetTokenStatsLoading();
    set({
      sessionTokenStats: null,
      projectTokenStats: [],
      projectTokenStatsPagination: createInitialPaginationWithCount(
        TOKENS_STATS_PAGE_SIZE
      ),
    });
  },
  };
};
