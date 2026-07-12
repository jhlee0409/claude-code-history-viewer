/**
 * Message Slice
 *
 * Handles message loading and session data.
 */

import { api } from "@/services/api";
import { toast } from "sonner";
import type {
  ClaudeMessage,
  ClaudeSession,
  MessagePage,
  PaginationState,
  SessionTokenStats,
  ProjectStatsSummary,
  SessionComparison,
  SubagentSession,
} from "../../types";
import { AppErrorType } from "../../types";
import type { StateCreator } from "zustand";
import { clearSearchIndex } from "../../utils/searchIndex";
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
import { supportsConversationBreakdown } from "../../utils/providers";
import { normalizeDateFilterOptions } from "../../utils/date";
import { getAgentIdFromProgress } from "../../components/MessageViewer/helpers/agentProgressHelpers";

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
  sessionConversationTokenStats: SessionTokenStats | null;
  projectTokenStats: SessionTokenStats[];
  projectConversationTokenStats: SessionTokenStats[];
  projectTokenStatsSummary: ProjectStatsSummary | null;
  projectConversationTokenStatsSummary: ProjectStatsSummary | null;
  projectTokenStatsPagination: ProjectTokenStatsPagination;
  // SubAgent navigation
  subagentSessions: SubagentSession[];
  parentSessionStack: ClaudeSession[];
  /** parentToolUseID → subagent file_path 매핑 (progress 메시지 기반, file_path는 유일 식별자) */
  toolUseToSubagentMap: Map<string, string>;
}

export interface MessageSliceActions {
  selectSession: (session: ClaudeSession) => Promise<void>;
  /** Load the next (older) page of the current session and prepend it. */
  loadMoreMessages: () => Promise<void>;
  /**
   * Make sure the message with `uuid` is inside the loaded window, extending
   * it backwards if needed. Resolves to whether the message is now present.
   */
  ensureMessageLoaded: (uuid: string) => Promise<boolean>;
  /**
   * Fetch the COMPLETE message list of the current session (same sidechain /
   * system-message filtering as the loaded window). Used by consumers that
   * must operate on the full session (export, in-session search) while the
   * store only holds a window. Result is cached per session until the next
   * selectSession call.
   */
  fetchFullSessionMessages: () => Promise<ClaudeMessage[]>;
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
  // SubAgent navigation
  loadSubagents: (sessionPath: string, sourceMessages: ClaudeMessage[]) => Promise<void>;
  navigateToSubagent: (subagent: SubagentSession) => Promise<void>;
  navigateBackToParent: () => Promise<void>;
}

export type MessageSlice = MessageSliceState & MessageSliceActions;

// ============================================================================
// Initial State
// ============================================================================

const TOKENS_STATS_PAGE_SIZE = 20;

/** Messages fetched per page (backend clamps individual requests at 500). */
export const MESSAGE_PAGE_SIZE = 200;

/** Message types hidden by the "show system messages" toggle (client-side). */
const SYSTEM_MESSAGE_TYPES = [
  "queue-operation",
  "progress",
  "file-history-snapshot",
] as const;

/** Initial pagination state — shared with `clearProjectSelection` to avoid duplication. */
export const INITIAL_PAGINATION = {
  currentOffset: 0,
  pageSize: 0,
  totalCount: 0,
  hasMore: false,
  isLoadingMore: false,
} as const;

// 빈 Map 재사용으로 useAppStore 구독자의 불필요한 re-render 방지
const EMPTY_SUBAGENT_MAP: ReadonlyMap<string, string> = new Map();

const areMessagesEquivalent = (
  currentMessages: ClaudeMessage[],
  nextMessages: ClaudeMessage[]
) => {
  if (currentMessages.length !== nextMessages.length) {
    return false;
  }

  return currentMessages.every((message, index) => {
    const nextMessage = nextMessages[index];
    if (message === nextMessage) {
      return true;
    }

    if (
      !nextMessage ||
      message.uuid !== nextMessage.uuid ||
      message.type !== nextMessage.type ||
      message.timestamp !== nextMessage.timestamp
    ) {
      return false;
    }

    return JSON.stringify(message) === JSON.stringify(nextMessage);
  });
};

const initialMessageState: MessageSliceState = {
  messages: [],
  pagination: { ...INITIAL_PAGINATION },
  isLoadingMessages: false,
  isLoadingTokenStats: false,
  sessionTokenStats: null,
  sessionConversationTokenStats: null,
  projectTokenStats: [],
  projectConversationTokenStats: [],
  projectTokenStatsSummary: null,
  projectConversationTokenStatsSummary: null,
  projectTokenStatsPagination: createInitialPaginationWithCount(TOKENS_STATS_PAGE_SIZE),
  subagentSessions: [],
  parentSessionStack: [],
  toolUseToSubagentMap: EMPTY_SUBAGENT_MAP as Map<string, string>,
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
  // Flag set by navigateToSubagent/navigateBackToParent to prevent
  // selectSession from clearing the parentSessionStack.
  let isSubagentNav = false;

  // Concurrent-navigation guard for navigateToSubagent/navigateBackToParent.
  // Rapid double-click corrupts parentSessionStack (duplicate push before await resolves).
  let subagentNavInFlight = false;

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

  const canLoadConversationBreakdown = (): boolean => {
    const provider = get().selectedProject?.provider ?? "claude";
    return supportsConversationBreakdown(provider);
  };

  // ============================================================================
  // Pagination internals
  // ============================================================================

  // Full-session fetch cache for export / in-session search. Keyed so a
  // filter-relevant state change misses the cache; cleared on selectSession.
  let fullSessionCache: {
    key: string;
    promise: Promise<ClaudeMessage[]>;
  } | null = null;

  // Serializes older-page loads (button, near-top autoload, ensureMessageLoaded)
  // so concurrent callers can't fetch the same offset twice.
  let loadOlderChain: Promise<void> = Promise.resolve();

  // Incremented at the start of every selectSession. Guards two races the
  // file_path check alone cannot: (a) two overlapping in-place reloads of the
  // SAME file with different filter settings — the stale one must not land
  // last; (b) older-page loads queued for a session the user has since left
  // and returned to via a fresh reload.
  let sessionLoadEpoch = 0;

  const applySystemMessageFilter = (
    messages: ClaudeMessage[]
  ): ClaudeMessage[] => {
    if (get().showSystemMessages) return messages;
    return messages.filter(
      (m) =>
        !(SYSTEM_MESSAGE_TYPES as readonly string[]).includes(m.type)
    );
  };

  /** Whether sidechain messages should be excluded server-side right now. */
  const shouldExcludeSidechain = (treatAsSubagent: boolean): boolean =>
    get().excludeSidechain && !treatAsSubagent;

  const fetchMessagePage = (
    provider: string,
    sessionPath: string,
    offset: number,
    limit: number,
    excludeSidechain: boolean
  ): Promise<MessagePage> =>
    api<MessagePage>("load_provider_messages_paginated", {
      provider,
      sessionPath,
      offset,
      limit,
      excludeSidechain,
    });

  /**
   * Fetch a window of at least `span` messages from the newest end, issuing
   * as many page requests as needed (the backend clamps a single request at
   * 500). Returns messages in chronological order.
   */
  const fetchWindow = async (
    provider: string,
    sessionPath: string,
    span: number,
    excludeSidechain: boolean
  ): Promise<{ messages: ClaudeMessage[]; page: Omit<MessagePage, "messages"> }> => {
    const accumulated: ClaudeMessage[] = [];
    let offset = 0;
    let totalCount = 0;
    let hasMore = false;

    for (;;) {
      const remaining = span - offset;
      if (remaining <= 0) break;
      const page = await fetchMessagePage(
        provider,
        sessionPath,
        offset,
        Math.min(remaining, 500),
        excludeSidechain
      );
      accumulated.unshift(...page.messages);
      totalCount = page.total_count;
      hasMore = page.has_more;
      if (!page.has_more || page.next_offset === offset) {
        offset = page.next_offset;
        break;
      }
      offset = page.next_offset;
    }

    return {
      messages: accumulated,
      page: { total_count: totalCount, has_more: hasMore, next_offset: offset },
    };
  };

  /**
   * Load one older page (chat-style prepend) for the current session.
   * Serialized through `loadOlderChain`; stale responses are dropped when the
   * user navigated away mid-flight. Duplicate uuids (window overlap after the
   * live session file grew) are dropped on prepend.
   */
  const loadOlderPage = (limit: number): Promise<void> => {
    // Capture the target at QUEUE time: a run executing after the user
    // navigated away must not silently page the newly selected session.
    const queuedSession = get().selectedSession;
    const queuedEpoch = sessionLoadEpoch;

    const run = async (): Promise<void> => {
      const session = get().selectedSession;
      if (
        !queuedSession ||
        queuedEpoch !== sessionLoadEpoch ||
        session?.file_path !== queuedSession.file_path
      ) {
        return;
      }
      const { pagination } = get();
      if (!session || !pagination.hasMore || pagination.isLoadingMore) return;

      const sessionPath = session.file_path;
      const provider = session.provider ?? "claude";
      const inSubagent = get().parentSessionStack.length > 0;

      set({ pagination: { ...pagination, isLoadingMore: true } });
      try {
        const page = await fetchMessagePage(
          provider,
          sessionPath,
          pagination.currentOffset,
          limit,
          shouldExcludeSidechain(inSubagent)
        );

        // Stale guard: user switched sessions (or reloaded in place) while
        // this page was in flight.
        if (
          queuedEpoch !== sessionLoadEpoch ||
          get().selectedSession?.file_path !== sessionPath
        ) {
          return;
        }

        const existing = get().messages;
        const known = new Set(existing.map((m) => m.uuid));
        const fresh = applySystemMessageFilter(
          page.messages.filter((m) => !known.has(m.uuid))
        );

        set({
          messages: fresh.length > 0 ? [...fresh, ...existing] : existing,
          pagination: {
            currentOffset: page.next_offset,
            pageSize: MESSAGE_PAGE_SIZE,
            totalCount: page.total_count,
            hasMore: page.has_more,
            isLoadingMore: false,
          },
        });
      } catch (error) {
        if (
          queuedEpoch !== sessionLoadEpoch ||
          get().selectedSession?.file_path !== sessionPath
        ) {
          return;
        }
        console.error("Failed to load earlier messages:", error);
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Failed to load earlier messages: ${message}`);
        set({
          pagination: { ...get().pagination, isLoadingMore: false },
        });
      }
    };

    const next = loadOlderChain.then(run, run);
    loadOlderChain = next.catch(() => undefined);
    return next;
  };

  return {
    ...initialMessageState,

  selectSession: async (session: ClaudeSession) => {
    // In-place reloads share a file_path, so the path guard alone cannot drop
    // a stale overlapping reload (e.g. two quick filter toggles) — the epoch
    // does. Captured before any await.
    const epoch = ++sessionLoadEpoch;
    // Subagent intent를 await 전에 캡처하여 async race 차단.
    // - isSubagentNav: navigateToSubagent가 세팅한 1회성 플래그
    // - isInPlaceReload: filter toggle/refreshCurrentSession에서 같은 세션을 재로드하는 경우
    //   이때 parentSessionStack이 비어있지 않다면 유저는 서브에이전트를 보고 있던 상태.
    // 이 값을 이후 로직 전체에서 참조해야 await 중 stack 변이로 인한 blank 화면·sidechain leak 방지.
    const isInPlaceReload = get().selectedSession?.file_path === session.file_path;
    const wasInSubagent = get().parentSessionStack.length > 0;
    const shouldTreatAsSubagent =
      isSubagentNav || (isInPlaceReload && wasInSubagent);
    const preserveStack = shouldTreatAsSubagent;
    isSubagentNav = false;

    if (isInPlaceReload) {
      if (get().messages.length === 0) {
        set({ isLoadingMessages: true });
      }
    } else {
      clearSearchIndex();
      set({
        messages: [],
        pagination: { ...INITIAL_PAGINATION },
        isLoadingMessages: true,
        subagentSessions: [],
        toolUseToSubagentMap: EMPTY_SUBAGENT_MAP as Map<string, string>,
        ...(preserveStack ? {} : { parentSessionStack: [] }),
      });

      // Message filters intentionally persist across session switches (see
      // filterSlice localStorage persistence); the toolbar reset button clears them.
    }

    get().setSelectedSession(session);
    // Note: sessionSearch state reset is handled by searchSlice

    // The session file may have changed (or the session did) — the cached
    // full-session fetch is no longer trustworthy either way.
    fullSessionCache = null;

    try {
      const sessionPath = session.file_path;
      const start = performance.now();

      const provider = session.provider ?? "claude";

      // Window span: initial open loads the newest page; an in-place reload
      // (filter toggle, watcher refresh) preserves the window the user has
      // already paged in so their scroll position's content doesn't vanish.
      const span = isInPlaceReload
        ? Math.max(MESSAGE_PAGE_SIZE, get().pagination.currentOffset)
        : MESSAGE_PAGE_SIZE;

      // Sidechain filtering happens server-side at classification stage —
      // subagent 세션은 모든 메시지가 isSidechain=true이므로 필터 우회.
      const { messages: windowMessages, page } = await fetchWindow(
        provider,
        sessionPath,
        span,
        shouldExcludeSidechain(shouldTreatAsSubagent)
      );

      // Stale response guard: 다른 세션으로 이동했거나(경로), 같은 세션의 더
      // 새로운 reload가 시작되었으면(epoch) 중단.
      if (
        epoch !== sessionLoadEpoch ||
        get().selectedSession?.file_path !== session.file_path
      ) {
        return;
      }

      // Apply system message filter (client-side; window-local)
      const filteredMessages = applySystemMessageFilter(windowMessages);

      const duration = performance.now() - start;
      if (import.meta.env.DEV) {
        console.log(
          `[Frontend] selectSession: ${filteredMessages.length}/${page.total_count}개 메시지 로드 (window), ${duration.toFixed(1)}ms`
        );
      }

      const nextPagination: PaginationState = {
        currentOffset: page.next_offset,
        pageSize: MESSAGE_PAGE_SIZE,
        totalCount: page.total_count,
        hasMore: page.has_more,
        isLoadingMore: false,
      };

      if (isInPlaceReload && areMessagesEquivalent(get().messages, filteredMessages)) {
        set({ isLoadingMessages: false, pagination: nextPagination });
        return;
      }

      // Update state first to allow UI to render immediately
      set({
        messages: filteredMessages,
        pagination: nextPagination,
        isLoadingMessages: false,
      });

      // Load subagent sessions (non-blocking). windowMessages는 시스템 메시지 필터
      // 적용 전 — meta.json 기반 매핑(주 경로)은 window와 무관하게 동작.
      void get().loadSubagents(sessionPath, windowMessages);

      // Search index is built lazily on first search to avoid blocking UI
      // when loading large sessions (47k+ messages with tokenize:"full" is expensive).
    } catch (error) {
      // Stale error guard: 경로·epoch 둘 중 하나라도 어긋나면 abandoned request의
      // 에러·로딩 상태를 현재 UI에 덮어쓰지 않음 (success path guard 미러링)
      if (
        epoch !== sessionLoadEpoch ||
        get().selectedSession?.file_path !== session.file_path
      ) {
        return;
      }

      console.error("Failed to load session messages:", error);
      // 서브에이전트 로딩 실패 시 toast로 알림 (전체 페이지 에러 방지).
      // shouldTreatAsSubagent(pre-await 캡처)를 사용해 await 중 stack 변이에 영향받지 않음.
      const message = error instanceof Error ? error.message : String(error);
      if (shouldTreatAsSubagent) {
        toast.error(`Failed to load subagent messages: ${message}`);
      } else {
        get().setError({ type: AppErrorType.UNKNOWN, message });
      }
      set({ isLoadingMessages: false });
    }
  },

  loadMoreMessages: async () => {
    await loadOlderPage(MESSAGE_PAGE_SIZE);
  },

  ensureMessageLoaded: async (uuid: string) => {
    const isLoaded = () => get().messages.some((m) => m.uuid === uuid);
    if (isLoaded()) return true;

    const session = get().selectedSession;
    if (!session || !get().pagination.hasMore) return false;
    const epoch = sessionLoadEpoch;

    const sessionPath = session.file_path;
    const provider = session.provider ?? "claude";
    const inSubagent = get().parentSessionStack.length > 0;

    let offset: number | null;
    try {
      offset = await api<number | null>("get_provider_message_offset", {
        provider,
        sessionPath,
        messageUuid: uuid,
        excludeSidechain: shouldExcludeSidechain(inSubagent),
      });
    } catch (error) {
      console.error("Failed to locate message offset:", error);
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to locate message: ${message}`);
      return false;
    }
    if (offset == null) return false;
    if (get().selectedSession?.file_path !== sessionPath) return false;

    // Extend the window until it covers offset (+1 because offset is 0-based
    // from the newest end). Pages are serialized through loadOlderChain.
    const needed = offset + 1;
    while (
      epoch === sessionLoadEpoch &&
      get().selectedSession?.file_path === sessionPath &&
      get().pagination.hasMore &&
      get().pagination.currentOffset < needed
    ) {
      const before = get().pagination.currentOffset;
      await loadOlderPage(
        Math.min(needed - get().pagination.currentOffset, 500)
      );
      // No forward progress (error path) — bail out instead of spinning.
      if (get().pagination.currentOffset === before) break;
    }

    // The uuid may still be absent even when covered (e.g. a claude
    // tool_result that merged into its assistant message) — report honestly.
    return isLoaded();
  },

  fetchFullSessionMessages: async () => {
    const session = get().selectedSession;
    if (!session) return [];

    // Loaded window already covers the whole session — reuse it.
    if (!get().pagination.hasMore) return get().messages;

    const inSubagent = get().parentSessionStack.length > 0;
    const excludeSidechain = shouldExcludeSidechain(inSubagent);
    const showSystem = get().showSystemMessages;
    const key = `${session.file_path}|${excludeSidechain}|${showSystem}`;

    if (fullSessionCache?.key === key) {
      return fullSessionCache.promise;
    }

    const provider = session.provider ?? "claude";
    const promise = (async () => {
      const all = await api<ClaudeMessage[]>("load_provider_messages", {
        provider,
        sessionPath: session.file_path,
      });
      const sidechainFiltered = excludeSidechain
        ? all.filter((m) => !m.isSidechain)
        : all;
      return showSystem
        ? sidechainFiltered
        : sidechainFiltered.filter(
            (m) =>
              !(SYSTEM_MESSAGE_TYPES as readonly string[]).includes(m.type)
          );
    })();

    fullSessionCache = { key, promise };
    // A failed fetch must not poison the cache.
    promise.catch(() => {
      if (fullSessionCache?.promise === promise) {
        fullSessionCache = null;
      }
    });
    return promise;
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
          ? await api<ClaudeSession[]>("load_provider_sessions", {
              provider,
              projectPath: selectedProject.path,
              excludeSidechain: get().excludeSidechain,
            })
          : await api<ClaudeSession[]>("load_project_sessions", {
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
          const dateOptions = normalizeDateFilterOptions(get().dateFilter);

          const projectSummary = await fetchProjectStatsSummary(
            selectedProject.path,
            {
              ...dateOptions,
              stats_mode: "billing_total",
            }
          );
          let projectConversationSummary = projectSummary;
          if (canLoadConversationBreakdown()) {
            projectConversationSummary = await fetchProjectStatsSummary(
              selectedProject.path,
              {
                ...dateOptions,
                stats_mode: "conversation_only",
              }
            ).catch((error) => {
              console.warn(
                "Failed to load conversation-only project summary:",
                error
              );
              toast.warning(
                "Conversation-only project summary could not be loaded. Showing billing totals only."
              );
              return projectSummary;
            });
          }
          get().setAnalyticsProjectSummary(projectSummary);
          get().setAnalyticsProjectConversationSummary(projectConversationSummary);

          if (selectedSession) {
            const sessionComparison = await fetchSessionComparison(
              selectedSession.actual_session_id,
              selectedProject.path,
              "billing_total",
              dateOptions
            );
            get().setAnalyticsSessionComparison(sessionComparison);
          }
        }

        console.log("분석 데이터 새로고침 완료");
      }

      console.log("새로고침 완료");
    } catch (error) {
      console.error("새로고침 실패:", error);
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`새로고침 실패: ${message}`);
      get().setError({ type: AppErrorType.UNKNOWN, message: String(error) });
    }
  },

  loadSessionTokenStats: async (sessionPath: string) => {
    const requestId = nextRequestId("sessionTokenStats");
    const loadingEpoch = beginTokenStatsLoading();
    try {
      get().setError(null);
      const dateOptions = normalizeDateFilterOptions(get().dateFilter);
      const breakdown = canLoadConversationBreakdown();
      const [stats, conversationStatsRaw] = await Promise.all([
        fetchSessionTokenStats(sessionPath, "billing_total", dateOptions),
        breakdown
          ? fetchSessionTokenStats(
              sessionPath,
              "conversation_only",
              dateOptions
            ).catch((error) => {
              if (requestId !== getRequestId("sessionTokenStats")) {
                return null;
              }
              console.warn(
                "Failed to load conversation-only session stats:",
                error
              );
              toast.warning(
                "Conversation-only session stats could not be loaded. Showing billing totals only."
              );
              return null;
            })
          : Promise.resolve(null),
      ]);
      const conversationStats = breakdown ? conversationStatsRaw : stats;
      if (requestId !== getRequestId("sessionTokenStats")) return;
      set({ sessionTokenStats: stats, sessionConversationTokenStats: conversationStats });
    } catch (error) {
      if (requestId !== getRequestId("sessionTokenStats")) return;
      console.error("Failed to load session token stats:", error);
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to load session token stats: ${message}`);
      get().setError({
        type: AppErrorType.UNKNOWN,
        message: `Failed to load token stats: ${error}`,
      });
      set({ sessionTokenStats: null, sessionConversationTokenStats: null });
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
        projectConversationTokenStats: [],
        projectTokenStatsSummary: null,
        projectConversationTokenStatsSummary: null,
        projectTokenStatsPagination: {
          ...initialMessageState.projectTokenStatsPagination,
        },
      });
      get().setError(null);

      const dateOptions = normalizeDateFilterOptions(get().dateFilter);
      const breakdown = canLoadConversationBreakdown();

      const [
        billingResponse,
        conversationResponseRaw,
        billingSummary,
        conversationSummaryRaw,
      ] = await Promise.all([
        fetchProjectTokenStats(projectPath, {
          offset: 0,
          limit: TOKENS_STATS_PAGE_SIZE,
          ...dateOptions,
          stats_mode: "billing_total",
        }),
        breakdown
          ? fetchProjectTokenStats(projectPath, {
              offset: 0,
              limit: TOKENS_STATS_PAGE_SIZE,
              ...dateOptions,
              stats_mode: "conversation_only",
            }).catch((error) => {
              if (requestId !== getRequestId("projectTokenStats")) {
                return null;
              }
              console.warn(
                "Failed to load conversation-only project token stats:",
                error
              );
              toast.warning(
                "Conversation-only project stats could not be loaded. Showing billing totals only."
              );
              return null;
            })
          : Promise.resolve(null),
        fetchProjectStatsSummary(projectPath, {
          ...dateOptions,
          stats_mode: "billing_total",
        }).catch((error) => {
          if (requestId !== getRequestId("projectTokenStats")) {
            return null;
          }
          console.warn(
            "Failed to load project token stats summary, falling back to loaded-page aggregate:",
            error
          );
          toast.warning(
            "Project stats summary could not be loaded. Showing page aggregate only."
          );
          return null;
        }),
        breakdown
          ? fetchProjectStatsSummary(projectPath, {
              ...dateOptions,
              stats_mode: "conversation_only",
            }).catch((error) => {
              if (requestId !== getRequestId("projectTokenStats")) {
                return null;
              }
              console.warn(
                "Failed to load conversation-only project summary:",
                error
              );
              toast.warning(
                "Conversation-only project summary could not be loaded. Showing billing totals only."
              );
              return null;
            })
          : Promise.resolve(null),
      ]);
      const conversationResponse = breakdown
        ? conversationResponseRaw
        : billingResponse;
      const conversationSummary = breakdown
        ? conversationSummaryRaw
        : billingSummary;

      if (requestId !== getRequestId("projectTokenStats")) return;
      set({
        projectTokenStats: billingResponse.items,
        projectConversationTokenStats: conversationResponse?.items ?? [],
        projectTokenStatsSummary: billingSummary,
        projectConversationTokenStatsSummary: conversationSummary,
        projectTokenStatsPagination: {
          totalCount: billingResponse.total_count,
          offset: billingResponse.offset,
          limit: billingResponse.limit,
          hasMore: billingResponse.has_more,
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
      set({
        projectTokenStats: [],
        projectConversationTokenStats: [],
        projectTokenStatsSummary: null,
        projectConversationTokenStatsSummary: null,
      });
    } finally {
      endTokenStatsLoading(loadingEpoch);
    }
  },

  loadMoreProjectTokenStats: async (projectPath: string) => {
    const { projectTokenStatsPagination, projectTokenStats, projectConversationTokenStats } = get();

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
      const dateOptions = normalizeDateFilterOptions(get().dateFilter);
      const breakdown = canLoadConversationBreakdown();
      const [billingResponse, conversationResponseRaw] = await Promise.all([
        fetchProjectTokenStats(projectPath, {
          offset: nextOffset,
          limit: TOKENS_STATS_PAGE_SIZE,
          ...dateOptions,
          stats_mode: "billing_total",
        }),
        breakdown
          ? fetchProjectTokenStats(projectPath, {
              offset: nextOffset,
              limit: TOKENS_STATS_PAGE_SIZE,
              ...dateOptions,
              stats_mode: "conversation_only",
            }).catch((error) => {
              if (snapshotId !== getRequestId("projectTokenStats")) {
                return null;
              }
              console.warn(
                "Failed to load conversation-only project stats page:",
                error
              );
              toast.warning(
                "Conversation-only project stats could not be loaded. Showing billing totals only."
              );
              return null;
            })
          : Promise.resolve(null),
      ]);
      const conversationResponse = breakdown
        ? conversationResponseRaw
        : billingResponse;

      if (snapshotId !== getRequestId("projectTokenStats")) return;
      set({
        projectTokenStats: [...projectTokenStats, ...billingResponse.items],
        projectConversationTokenStats: [
          ...projectConversationTokenStats,
          ...(conversationResponse?.items ?? []),
        ],
        projectTokenStatsPagination: {
          totalCount: billingResponse.total_count,
          offset: billingResponse.offset,
          limit: billingResponse.limit,
          hasMore: billingResponse.has_more,
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
      const dateOptions = normalizeDateFilterOptions(get().dateFilter);

      const billing = await fetchProjectStatsSummary(projectPath, {
        ...dateOptions,
        stats_mode: "billing_total",
      });
      const conversation = canLoadConversationBreakdown()
        ? await fetchProjectStatsSummary(projectPath, {
            ...dateOptions,
            stats_mode: "conversation_only",
          }).catch((error) => {
            console.warn(
              "Failed to load conversation-only project summary:",
              error
            );
            toast.warning(
              "Conversation-only project summary could not be loaded. Showing billing totals only."
            );
            return billing;
          })
        : billing;
      get().setAnalyticsProjectConversationSummary(conversation);
      return billing;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to load project stats summary:", error);
      toast.error(`Failed to load project stats summary: ${message}`);
      get().setError({ type: AppErrorType.UNKNOWN, message: String(error) });
      throw error;
    }
  },

  loadSessionComparison: async (sessionId: string, projectPath: string) => {
    const dateOptions = normalizeDateFilterOptions(get().dateFilter);
    try {
      return await fetchSessionComparison(
        sessionId,
        projectPath,
        "billing_total",
        dateOptions
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      console.error("Failed to load session comparison:", error);
      toast.error(`Failed to load session comparison: ${message}`);
      throw error;
    }
  },

  clearTokenStats: () => {
    // Bump both request IDs so any in-flight token stats requests are invalidated.
    nextRequestId("sessionTokenStats");
    nextRequestId("projectTokenStats");
    resetTokenStatsLoading();
    set({
      sessionTokenStats: null,
      sessionConversationTokenStats: null,
      projectTokenStats: [],
      projectConversationTokenStats: [],
      projectTokenStatsSummary: null,
      projectConversationTokenStatsSummary: null,
      projectTokenStatsPagination: createInitialPaginationWithCount(
        TOKENS_STATS_PAGE_SIZE
      ),
    });
  },

  // ============================================================================
  // SubAgent Navigation
  // ============================================================================

  loadSubagents: async (
    sessionPath: string,
    sourceMessages: ClaudeMessage[],
  ) => {
    try {
      const subagents = await api<SubagentSession[]>("get_session_subagents", {
        sessionPath,
      });
      // Guard: only update if still viewing the same session
      if (get().selectedSession?.file_path === sessionPath) {
        // toolUseId → subagent file_path 매핑. 두 소스 사용:
        // 1) (신형) subagent.tool_use_id — agent-<id>.meta.json에서 읽은 Task tool_use id.
        //    progress 메시지가 없는 다중 subagent 세션도 정확히 매핑 (#288).
        // 2) (구형 back-compat) progress 메시지의 parentToolUseID ↔ agentId.
        // Map 값은 file_path(유일 식별자) — agent_id는 filename stem 기반이라 충돌 가능.
        // sourceMessages는 반드시 pre-filter(allMessages) — post-filter는 progress 제거됨.
        let map: Map<string, string> | ReadonlyMap<string, string> =
          EMPTY_SUBAGENT_MAP;
        if (subagents.length > 0) {
          const built = new Map<string, string>();

          // Primary (newer format): meta.json toolUseId, authoritative per file.
          for (const sub of subagents) {
            if (sub.tool_use_id) {
              built.set(sub.tool_use_id, sub.file_path);
            }
          }

          // Back-compat (older sessions without meta.json): progress messages.
          // Only fill gaps not already mapped from meta.json (meta.json wins).
          const byAgentId = new Map(subagents.map((s) => [s.agent_id, s]));
          for (const msg of sourceMessages) {
            if (msg.type !== "progress" || !msg.parentToolUseID) continue;
            if (built.has(msg.parentToolUseID)) continue;
            const agentId = getAgentIdFromProgress(msg);
            if (!agentId) continue;
            const sub = byAgentId.get(agentId);
            if (sub) {
              built.set(msg.parentToolUseID, sub.file_path);
            }
          }

          if (built.size > 0) map = built;
        }
        set({
          subagentSessions: subagents,
          toolUseToSubagentMap: map as Map<string, string>,
        });
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("[loadSubagents] Failed:", error);
      }
      // 여전히 같은 세션을 보고 있을 때만 피드백 + 상태 초기화.
      // CLAUDE.md 가이드: async 실패는 사용자에게 가시적 피드백 필요.
      if (get().selectedSession?.file_path === sessionPath) {
        const message = error instanceof Error ? error.message : String(error);
        toast.warning(`Failed to load subagent sessions: ${message}`);
        set({
          subagentSessions: [],
          toolUseToSubagentMap: EMPTY_SUBAGENT_MAP as Map<string, string>,
        });
      }
    }
  },

  navigateToSubagent: async (subagent: SubagentSession) => {
    if (subagentNavInFlight) return;
    const currentSession = get().selectedSession;
    if (!currentSession) return;

    subagentNavInFlight = true;
    try {
    // Push current session onto the navigation stack
    set((state) => ({
      parentSessionStack: [...state.parentSessionStack, currentSession],
    }));

    // Create a synthetic ClaudeSession for the subagent
    const syntheticSession: ClaudeSession = {
      session_id: subagent.file_path,
      actual_session_id: subagent.agent_id,
      file_path: subagent.file_path,
      project_name: currentSession.project_name,
      message_count: subagent.message_count,
      first_message_time: subagent.first_message_time ?? "",
      last_message_time: subagent.last_message_time ?? "",
      last_modified: subagent.last_message_time ?? "",
      has_tool_use: false,
      has_errors: false,
      summary: subagent.summary ?? subagent.agent_id,
    };

    isSubagentNav = true;
    await get().selectSession(syntheticSession);
    } finally {
      subagentNavInFlight = false;
    }
  },

  navigateBackToParent: async () => {
    if (subagentNavInFlight) return;
    const stack = get().parentSessionStack;
    if (stack.length === 0) return;

    subagentNavInFlight = true;
    try {
      const parentSession = stack[stack.length - 1]!;
      const remainingStack = stack.slice(0, -1);
      set({ parentSessionStack: remainingStack });

      // remainingStack이 비어있으면 top-level로 복귀 → isSubagentNav=false여야
      // selectSession에서 sidechain 필터가 정상 적용됨.
      // 중첩 서브에이전트 체인에서 한 단계만 pop하는 경우에만 플래그 유지.
      isSubagentNav = remainingStack.length > 0;
      await get().selectSession(parentSession);
    } finally {
      subagentNavInFlight = false;
    }
  },
  };
};
