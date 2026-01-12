import React, {
  useEffect,
  useRef,
  useCallback,
  useState,
  useMemo,
  useDeferredValue,
} from "react";
import { Loader2, MessageCircle, ChevronDown, ChevronUp, Search, X, HelpCircle, ChevronRight, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ClaudeMessage, ClaudeSession } from "../types";
import type { SearchState, SearchFilterType } from "../store/useAppStore";
import { ClaudeContentArrayRenderer } from "./contentRenderer";
import {
  ClaudeToolUseDisplay,
  MessageContentDisplay,
  ToolExecutionResultRouter,
} from "./messageRenderer";
import { getToolName } from "./CollapsibleToolResult";
import { extractClaudeMessageContent } from "../utils/messageUtils";
import { cn } from "../utils/cn";
import { COLORS } from "../constants/colors";
import { formatTime, formatTimeShort } from "../utils/time";
import { getShortModelName } from "../utils/model";

// Search configuration constants
const SEARCH_MIN_CHARS = 2; // Minimum characters required to trigger search
const SCROLL_HIGHLIGHT_DELAY_MS = 100; // Delay to wait for DOM update before scrolling

interface MessageViewerProps {
  messages: ClaudeMessage[];
  isLoading: boolean;
  selectedSession: ClaudeSession | null;
  sessionSearch: SearchState;
  onSearchChange: (query: string) => void;
  onFilterTypeChange: (filterType: SearchFilterType) => void;
  onClearSearch: () => void;
  onNextMatch?: () => void;
  onPrevMatch?: () => void;
}

interface MessageNodeProps {
  message: ClaudeMessage;
  depth: number;
  isCurrentMatch?: boolean;
  isMatch?: boolean;
  searchQuery?: string;
  filterType?: SearchFilterType;
  currentMatchIndex?: number; // 메시지 내에서 현재 활성화된 매치 인덱스
}

interface MessageHeaderProps {
  message: ClaudeMessage;
  t: (key: string, options?: Record<string, unknown>) => string;
}

const hasSystemCommandContent = (message: ClaudeMessage): boolean => {
  const content = extractClaudeMessageContent(message);
  if (!content || typeof content !== "string") return false;
  // Check for actual XML tag pairs, not just strings in backticks
  return /<command-name>[\s\S]*?<\/command-name>/.test(content) ||
         /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/.test(content) ||
         /<command-message>[\s\S]*?<\/command-message>/.test(content);
};

const MessageHeader = ({ message, t }: MessageHeaderProps) => {
  const isToolResultMessage = !!message.toolUseResult && message.type === "user";
  const isSystemContent = hasSystemCommandContent(message);
  const toolName = isToolResultMessage
    ? getToolName(message.toolUse as Record<string, unknown> | undefined, message.toolUseResult)
    : null;
  const isLeftAligned = message.type !== "user" || isToolResultMessage || isSystemContent;

  return (
    <div className={cn(
      "flex items-center mb-1 text-xs text-gray-500 dark:text-gray-400",
      isLeftAligned ? "justify-between" : "justify-end"
    )}>
      <div className="flex items-center gap-1.5">
        <span className="font-medium">
          {isToolResultMessage && toolName
            ? toolName
            : isSystemContent
            ? t("messageViewer.system")
            : message.type === "user"
            ? t("messageViewer.user")
            : message.type === "assistant"
            ? t("messageViewer.claude")
            : t("messageViewer.system")}
        </span>
        <span>·</span>
        <span>{formatTimeShort(message.timestamp)}</span>
        {message.isSidechain && (
          <span className="px-1.5 py-0.5 text-[10px] bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-300 rounded-full">
            {t("messageViewer.branch")}
          </span>
        )}
      </div>

      {message.type === "assistant" && message.model && (
        <div className="relative group flex items-center gap-1">
          <span className="text-gray-400 dark:text-gray-500">{getShortModelName(message.model)}</span>
          {message.usage && (
            <>
              <HelpCircle className="w-3 h-3 cursor-help text-gray-400 dark:text-gray-500" />
              <div className="absolute bottom-full mb-2 right-0 w-52 bg-gray-800 dark:bg-gray-700 text-white text-xs rounded-lg p-2.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg z-10">
                <p className="mb-1"><strong>{t("assistantMessageDetails.model")}:</strong> {message.model}</p>
                <p className="mb-1"><strong>{t("messageViewer.time")}:</strong> {formatTime(message.timestamp)}</p>
                {message.usage.input_tokens && <p>{t("assistantMessageDetails.input")}: {message.usage.input_tokens.toLocaleString()}</p>}
                {message.usage.output_tokens && <p>{t("assistantMessageDetails.output")}: {message.usage.output_tokens.toLocaleString()}</p>}
                {message.usage.cache_creation_input_tokens ? <p>{t("assistantMessageDetails.cacheCreation")}: {message.usage.cache_creation_input_tokens.toLocaleString()}</p> : null}
                {message.usage.cache_read_input_tokens ? <p>{t("assistantMessageDetails.cacheRead")}: {message.usage.cache_read_input_tokens.toLocaleString()}</p> : null}
                <div className="absolute right-4 top-full w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-gray-800 dark:border-t-gray-700"></div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

interface SummaryMessageProps {
  content: string;
  timestamp: string;
}

const SummaryMessage = ({ content, timestamp }: SummaryMessageProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { t } = useTranslation("components");

  return (
    <div className={cn(
      "rounded-lg border mx-4 my-2",
      COLORS.semantic.info.bg,
      COLORS.semantic.info.border
    )}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left",
          "hover:bg-blue-100/50 dark:hover:bg-blue-900/30 transition-colors rounded-lg"
        )}
      >
        <ChevronRight
          className={cn(
            "w-4 h-4 transition-transform flex-shrink-0",
            COLORS.semantic.info.icon,
            isExpanded && "rotate-90"
          )}
        />
        <FileText className={cn("w-4 h-4 flex-shrink-0", COLORS.semantic.info.icon)} />
        <span className={cn("text-xs font-medium", COLORS.semantic.info.text)}>
          {t("messageViewer.priorContext")}
        </span>
        <span className={cn("text-xs ml-auto", COLORS.semantic.info.icon)}>
          {formatTimeShort(timestamp)}
        </span>
      </button>

      {isExpanded && (
        <div className={cn("px-3 pb-3 text-sm", COLORS.semantic.info.text)}>
          {content}
        </div>
      )}
    </div>
  );
};

const isEmptyMessage = (message: ClaudeMessage): boolean => {
  // Messages with tool use or results should be shown
  if (message.toolUse || message.toolUseResult) return false;

  // Check for array content (tool results, etc.)
  if (message.content && Array.isArray(message.content) && message.content.length > 0) {
    return false;
  }

  const content = extractClaudeMessageContent(message);

  // No content at all
  if (!content) return true;

  // Non-string content that exists
  if (typeof content !== "string") return false;

  // Strip command tags and check if anything remains
  const stripped = content
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, "")
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, "")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
    .replace(/<[^>]*(?:stdout|output)[^>]*>[\s\S]*?<\/[^>]*>/g, "")
    .replace(/<[^>]*(?:stderr|error)[^>]*>[\s\S]*?<\/[^>]*>/g, "")
    .trim();

  return stripped.length === 0;
};

const ClaudeMessageNode = React.memo(({ message, depth, isCurrentMatch, isMatch, searchQuery, filterType = "content", currentMatchIndex }: MessageNodeProps) => {
  const { t } = useTranslation("components");

  if (message.isSidechain) {
    return null;
  }

  // Skip empty messages (no content, or only command tags)
  if (isEmptyMessage(message)) {
    return null;
  }

  // Summary messages get special collapsible rendering
  if (message.type === "summary") {
    const summaryContent = typeof message.content === "string"
      ? message.content
      : "";
    return (
      <div data-message-uuid={message.uuid} className="max-w-4xl mx-auto">
        <SummaryMessage content={summaryContent} timestamp={message.timestamp} />
      </div>
    );
  }

  return (
    <div
      data-message-uuid={message.uuid}
      className={cn(
        "w-full px-4 py-2 transition-colors duration-300",
        message.isSidechain && "bg-gray-100 dark:bg-gray-800",
        // 현재 매치된 메시지 강조
        isCurrentMatch && "bg-yellow-100 dark:bg-yellow-900/30 ring-2 ring-yellow-400 dark:ring-yellow-500",
        // 다른 매치 메시지 연한 강조
        isMatch && !isCurrentMatch && "bg-yellow-50 dark:bg-yellow-900/10"
      )}
    >
      <div className="max-w-4xl mx-auto">
        {/* Compact message header */}
        <MessageHeader message={message} t={t} />

        {/* 메시지 내용 */}
        <div className="w-full">
          {/* Message Content */}
          <MessageContentDisplay
            content={extractClaudeMessageContent(message)}
            messageType={message.type}
            searchQuery={searchQuery}
            isCurrentMatch={isCurrentMatch}
            currentMatchIndex={currentMatchIndex}
          />

          {/* Claude API Content Array */}
          {message.content &&
            typeof message.content === "object" &&
            Array.isArray(message.content) &&
            (message.type !== "assistant" ||
              (message.type === "assistant" &&
                !extractClaudeMessageContent(message))) && (
              <div className="mb-2">
                <ClaudeContentArrayRenderer
                  content={message.content}
                  searchQuery={searchQuery}
                  filterType={filterType}
                  isCurrentMatch={isCurrentMatch}
                  currentMatchIndex={currentMatchIndex}
                  skipToolResults={!!message.toolUseResult}
                />
              </div>
            )}

          {/* Tool Use */}
          {message.toolUse && (
            <ClaudeToolUseDisplay toolUse={message.toolUse} />
          )}

          {/* Tool Result */}
          {message.toolUseResult && (
            <ToolExecutionResultRouter toolResult={message.toolUseResult} depth={0} />
          )}
        </div>
      </div>
    </div>
  );
});

ClaudeMessageNode.displayName = 'ClaudeMessageNode';

// 타입 안전한 parent UUID 추출 함수
const getParentUuid = (message: ClaudeMessage): string | null | undefined => {
  const msgWithParent = message as ClaudeMessage & {
    parentUuid?: string;
    parent_uuid?: string;
  };
  return msgWithParent.parentUuid || msgWithParent.parent_uuid;
};

export const MessageViewer: React.FC<MessageViewerProps> = ({
  messages,
  isLoading,
  selectedSession,
  sessionSearch,
  onSearchChange,
  onFilterTypeChange,
  onClearSearch,
  onNextMatch,
  onPrevMatch,
}) => {
  const { t } = useTranslation("components");
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Optimistic UI: 입력 상태를 별도로 관리 (startTransition으로 비긴급 업데이트)
  const [searchQuery, setSearchQuery] = useState("");

  // useDeferredValue: 검색은 백그라운드에서 처리
  const deferredSearchQuery = useDeferredValue(searchQuery);

  // 검색 진행 중 여부 (시각적 피드백용)
  const isSearchPending = searchQuery !== deferredSearchQuery;

  // 입력 핸들러: controlled input으로 상태 업데이트
  const handleSearchInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  }, []);

  // deferred 값이 변경될 때만 검색 실행
  useEffect(() => {
    // 빈 문자열이면 검색 초기화
    if (deferredSearchQuery.length === 0) {
      onSearchChange("");
      return;
    }

    // 최소 글자 수 미만이면 검색하지 않음
    if (deferredSearchQuery.length < SEARCH_MIN_CHARS) {
      return;
    }

    // 최소 글자 수 이상일 때만 검색 실행
    onSearchChange(deferredSearchQuery);
  }, [deferredSearchQuery, onSearchChange]);

  // 세션 변경 시 검색어 초기화
  useEffect(() => {
    setSearchQuery("");
  }, [selectedSession?.session_id]);

  // 카카오톡 스타일: 항상 전체 메시지 표시 (필터링 없음)
  const displayMessages = messages;

  // 매치된 메시지 UUID Set (효율적인 조회용)
  const matchedUuids = useMemo(() => {
    return new Set(sessionSearch.matches?.map(m => m.messageUuid) || []);
  }, [sessionSearch.matches]);

  // 현재 매치 정보 (UUID와 메시지 내 인덱스)
  const currentMatch = useMemo(() => {
    if (sessionSearch.currentMatchIndex >= 0 && sessionSearch.matches?.length > 0) {
      const match = sessionSearch.matches[sessionSearch.currentMatchIndex];
      return match ? {
        messageUuid: match.messageUuid,
        matchIndex: match.matchIndex,
      } : null;
    }
    return null;
  }, [sessionSearch.currentMatchIndex, sessionSearch.matches]);

  const currentMatchUuid = currentMatch?.messageUuid ?? null;

  // 메시지 트리 구조 메모이제이션 (성능 최적화)
  const { rootMessages, uniqueMessages } = useMemo(() => {
    if (displayMessages.length === 0) {
      return { rootMessages: [], uniqueMessages: [] };
    }

    // 중복 제거
    const uniqueMessages = Array.from(
      new Map(displayMessages.map((msg) => [msg.uuid, msg])).values()
    );

    // 루트 메시지 찾기
    const roots: ClaudeMessage[] = [];
    uniqueMessages.forEach((msg) => {
      const parentUuid = getParentUuid(msg);
      if (!parentUuid) {
        roots.push(msg);
      }
    });

    return { rootMessages: roots, uniqueMessages };
  }, [displayMessages]);

  // 이전 세션 ID를 추적
  const prevSessionIdRef = useRef<string | null>(null);

  // 맨 아래로 스크롤하는 함수
  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      const element = scrollContainerRef.current;
      // 여러 번 시도하여 확실히 맨 아래로 이동
      const attemptScroll = (attempts = 0) => {
        element.scrollTop = element.scrollHeight;
        if (
          attempts < 3 &&
          element.scrollTop < element.scrollHeight - element.clientHeight - 10
        ) {
          setTimeout(() => attemptScroll(attempts + 1), 50);
        }
      };
      attemptScroll();
    }
  }, []);

  // 새로운 세션 선택 시 스크롤을 맨 아래로 이동 (채팅 스타일)
  useEffect(() => {
    // 세션이 실제로 변경되었고, 메시지가 로드된 경우에만 실행
    if (
      selectedSession &&
      prevSessionIdRef.current !== selectedSession.session_id &&
      messages.length > 0 &&
      !isLoading
    ) {
      // 이전 세션 ID 업데이트
      prevSessionIdRef.current = selectedSession.session_id;

      // DOM이 완전히 업데이트된 후 스크롤 실행
      setTimeout(() => scrollToBottom(), 100);
    }
  }, [selectedSession, messages.length, isLoading, scrollToBottom]);

  // 검색어 초기화 핸들러
  const handleClearSearch = useCallback(() => {
    setSearchQuery("");
    onClearSearch();
    searchInputRef.current?.focus();
  }, [onClearSearch]);

  // 현재 매치된 하이라이트 텍스트로 스크롤 이동
  const scrollToHighlight = useCallback((matchUuid: string | null) => {
    if (!scrollContainerRef.current) return;

    // 먼저 하이라이트된 텍스트 요소를 찾음
    const highlightElement = scrollContainerRef.current.querySelector(
      '[data-search-highlight="current"]'
    );

    if (highlightElement) {
      // 하이라이트된 텍스트로 스크롤
      highlightElement.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }

    // 하이라이트 요소가 없으면 메시지 영역으로 스크롤 (fallback)
    if (matchUuid) {
      const messageElement = scrollContainerRef.current.querySelector(
        `[data-message-uuid="${matchUuid}"]`
      );

      if (messageElement) {
        messageElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    }
  }, []);

  // 현재 매치 변경 시 해당 하이라이트로 스크롤
  useEffect(() => {
    if (currentMatchUuid) {
      // DOM 업데이트 후 스크롤 (렌더링 완료 대기)
      const timer = setTimeout(() => {
        scrollToHighlight(currentMatchUuid);
      }, SCROLL_HIGHLIGHT_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [currentMatchUuid, sessionSearch.currentMatchIndex, scrollToHighlight]);

  // 키보드 단축키 핸들러
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        // Shift+Enter: 이전 매치
        onPrevMatch?.();
      } else {
        // Enter: 다음 매치
        onNextMatch?.();
      }
    } else if (e.key === "Escape") {
      // Escape: 검색 초기화
      handleClearSearch();
    }
  }, [onNextMatch, onPrevMatch, handleClearSearch]);

  // 스크롤 위치 상태 추가
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [showScrollToTop, setShowScrollToTop] = useState(false);

  // 맨 위로 스크롤하는 함수
  const scrollToTop = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  // 스크롤 이벤트 최적화 (쓰로틀링 적용)
  useEffect(() => {
    let throttleTimer: ReturnType<typeof setTimeout> | null = null;

    const handleScroll = () => {
      if (throttleTimer) return;

      throttleTimer = setTimeout(() => {
        try {
          if (scrollContainerRef.current) {
            const { scrollTop, scrollHeight, clientHeight } =
              scrollContainerRef.current;
            const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
            const isNearTop = scrollTop < 100;
            setShowScrollToBottom(!isNearBottom && displayMessages.length > 5);
            setShowScrollToTop(!isNearTop && displayMessages.length > 5);
          }
        } catch (error) {
          console.error("Scroll handler error:", error);
        }
        throttleTimer = null;
      }, 100);
    };

    const scrollElement = scrollContainerRef.current;
    if (scrollElement) {
      scrollElement.addEventListener("scroll", handleScroll, { passive: true });
      handleScroll();

      return () => {
        if (throttleTimer) {
          clearTimeout(throttleTimer);
        }
        scrollElement.removeEventListener("scroll", handleScroll);
      };
    }
  }, [displayMessages.length]);

  if (isLoading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="flex items-center space-x-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{t("messageViewer.loadingMessages")}</span>
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 h-full">
        <div className="mb-4">
          <MessageCircle className="w-16 h-16 mx-auto text-gray-400" />
        </div>
        <h3 className="text-lg font-medium mb-2">
          {t("messageViewer.noMessages")}
        </h3>
        <p className="text-sm text-center whitespace-pre-line">
          {t("messageViewer.noMessagesDescription")}
        </p>
      </div>
    );
  }

  const renderMessageTree = (
    message: ClaudeMessage,
    depth = 0,
    visitedIds = new Set<string>(),
    keyPrefix = ""
  ): React.ReactNode[] => {
    // 순환 참조 방지
    if (visitedIds.has(message.uuid)) {
      console.warn(`Circular reference detected for message: ${message.uuid}`);
      return [];
    }

    visitedIds.add(message.uuid);
    const children = displayMessages.filter((m) => {
      const parentUuid = getParentUuid(m);
      return parentUuid === message.uuid;
    });

    // 고유한 키 생성
    const uniqueKey = keyPrefix ? `${keyPrefix}-${message.uuid}` : message.uuid;

    // 검색 매치 상태 확인
    const isMatch = matchedUuids.has(message.uuid);
    const isCurrentMatch = currentMatchUuid === message.uuid;
    const messageMatchIndex = isCurrentMatch ? currentMatch?.matchIndex : undefined;

    // 현재 메시지를 먼저 추가하고, 자식 메시지들을 이어서 추가
    const result: React.ReactNode[] = [
      <ClaudeMessageNode
        key={uniqueKey}
        message={message}
        depth={depth}
        isMatch={isMatch}
        isCurrentMatch={isCurrentMatch}
        searchQuery={sessionSearch.query}
        filterType={sessionSearch.filterType}
        currentMatchIndex={messageMatchIndex}
      />,
    ];

    // 자식 메시지들을 재귀적으로 추가 (depth 증가)
    children.forEach((child, index) => {
      const childNodes = renderMessageTree(
        child,
        depth + 1,
        new Set(visitedIds),
        `${uniqueKey}-child-${index}`
      );
      result.push(...childNodes);
    });

    return result;
  };

  return (
    <div className="relative flex-1 h-full flex flex-col">
      {/* Compact Toolbar */}
      <div
        role="search"
        className={cn(
          "flex items-center gap-3 px-4 py-2 border-b sticky top-0 z-10",
          COLORS.ui.background.secondary,
          COLORS.ui.border.light
        )}
      >
        {/* Filter Toggle */}
        <button
          type="button"
          onClick={() => {
            onFilterTypeChange(sessionSearch.filterType === "content" ? "toolId" : "content");
            setSearchQuery("");
          }}
          className={cn(
            "text-xs px-2 py-1.5 rounded-md transition-colors whitespace-nowrap",
            "hover:bg-gray-200 dark:hover:bg-gray-700",
            COLORS.ui.background.tertiary,
            COLORS.ui.text.secondary
          )}
          title={t("messageViewer.filterType")}
        >
          {sessionSearch.filterType === "content"
            ? t("messageViewer.filterContent")
            : t("messageViewer.filterToolId")}
        </button>

        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className={cn(
            "absolute left-2.5 top-1/2 transform -translate-y-1/2 w-4 h-4",
            COLORS.ui.text.muted
          )} />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={handleSearchInput}
            onKeyDown={handleSearchKeyDown}
            placeholder={t("messageViewer.searchPlaceholder")}
            aria-label={t("messageViewer.searchPlaceholder")}
            className={cn(
              "w-full pl-8 pr-8 py-1.5 rounded-md border text-sm",
              "focus:outline-none focus:ring-2 focus:ring-blue-500",
              COLORS.ui.background.primary,
              COLORS.ui.border.light,
              COLORS.ui.text.primary
            )}
          />
          {searchQuery && (
            isSearchPending ? (
              <div className="absolute right-2.5 top-1/2 transform -translate-y-1/2">
                <Loader2 className={cn("w-3.5 h-3.5 animate-spin", COLORS.ui.text.muted)} />
              </div>
            ) : (
              <button
                type="button"
                onClick={handleClearSearch}
                aria-label="Clear search"
                className={cn(
                  "absolute right-2 top-1/2 transform -translate-y-1/2",
                  "p-0.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700",
                  COLORS.ui.text.muted
                )}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )
          )}
        </div>

        {/* Match Navigation */}
        {sessionSearch.query && sessionSearch.matches && sessionSearch.matches.length > 0 && (
          <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
            <span className="font-medium tabular-nums">
              {sessionSearch.currentMatchIndex + 1}/{sessionSearch.matches.length}
            </span>
            <button
              type="button"
              onClick={onPrevMatch}
              disabled={sessionSearch.matches.length === 0}
              aria-label="Previous match (Shift+Enter)"
              title="Shift+Enter"
              className={cn(
                "p-1 rounded transition-colors",
                "hover:bg-gray-200 dark:hover:bg-gray-700",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onNextMatch}
              disabled={sessionSearch.matches.length === 0}
              aria-label="Next match (Enter)"
              title="Enter"
              className={cn(
                "p-1 rounded transition-colors",
                "hover:bg-gray-200 dark:hover:bg-gray-700",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Meta Info */}
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span>{messages.length} {t("messageViewer.messagesShort")}</span>
          {selectedSession?.has_tool_use && (
            <span>· {t("messageViewer.toolsUsed")}</span>
          )}
          {selectedSession?.has_errors && (
            <span className="text-orange-500 dark:text-orange-400">· {t("messageViewer.hasErrors")}</span>
          )}
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto scrollbar-thin"
        style={{ scrollBehavior: "auto" }}
      >
        {/* 디버깅 정보 */}
        {import.meta.env.DEV && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 p-2 text-xs text-yellow-800 dark:text-yellow-200 border-b space-y-1">
            <div>
              {t("messageViewer.debugInfo.messages", {
                current: displayMessages.length,
                total: messages.length,
              })}{" "}
              | 검색: {sessionSearch.query || "(없음)"}
            </div>
            <div>
              {t("messageViewer.debugInfo.session", {
                sessionId: selectedSession?.session_id?.slice(-8),
              })}{" "}
              |{" "}
              {t("messageViewer.debugInfo.file", {
                fileName: selectedSession?.file_path
                  ?.split("/")
                  .pop()
                  ?.slice(0, 20),
              })}
            </div>
          </div>
        )}
        <div className="max-w-4xl mx-auto">
          {/* 검색 결과 없음 */}
          {sessionSearch.query && (!sessionSearch.matches || sessionSearch.matches.length === 0) && !sessionSearch.isSearching && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <Search className="w-12 h-12 mb-4 text-gray-400" />
              <p className="text-lg font-medium mb-2">
                {t("messageViewer.noSearchResults")}
              </p>
              <p className="text-sm">
                {t("messageViewer.tryDifferentKeyword")}
              </p>
            </div>
          )}

          {/* 메시지 목록 */}
          {displayMessages.length > 0 && !sessionSearch.query && (
            <div className="flex items-center justify-center py-4">
              <div className={cn("text-sm", COLORS.ui.text.muted)}>
                {t("messageViewer.allMessagesLoaded", {
                  count: messages.length,
                })}
              </div>
            </div>
          )}

          {/* 메시지 렌더링 */}
          {displayMessages.length > 0 && (() => {
            try {
              if (rootMessages.length > 0) {
                // 트리 구조 렌더링
                return rootMessages
                  .map((message) => renderMessageTree(message, 0, new Set()))
                  .flat();
              } else {
                // 평면 구조 렌더링
                return uniqueMessages.map((message, index) => {
                  const uniqueKey =
                    message.uuid && message.uuid !== "unknown-session"
                      ? `${message.uuid}-${index}`
                      : `fallback-${index}-${message.timestamp}-${message.type}`;

                  const isMatch = matchedUuids.has(message.uuid);
                  const isCurrentMatch = currentMatchUuid === message.uuid;
                  const messageMatchIndex = isCurrentMatch ? currentMatch?.matchIndex : undefined;

                  return (
                    <ClaudeMessageNode
                      key={uniqueKey}
                      message={message}
                      depth={0}
                      isMatch={isMatch}
                      isCurrentMatch={isCurrentMatch}
                      searchQuery={sessionSearch.query}
                      filterType={sessionSearch.filterType}
                      currentMatchIndex={messageMatchIndex}
                    />
                  );
                });
              }
            } catch (error) {
              console.error("Message rendering error:", error);
              console.error("Message state when error occurred:", {
                displayMessagesLength: displayMessages.length,
                rootMessagesLength: rootMessages.length,
                firstMessage: displayMessages[0],
                lastMessage: displayMessages[displayMessages.length - 1],
              });

              // 에러 발생 시 안전한 fallback 렌더링
              return (
                <div
                  key="error-fallback"
                  className="flex items-center justify-center p-8"
                >
                  <div className="text-center text-red-600">
                    <div className="text-lg font-semibold mb-2">
                      {t("messageViewer.renderError")}
                    </div>
                    <div className="text-sm">
                      {t("messageViewer.checkConsole")}
                    </div>
                    <button
                      type="button"
                      onClick={() => window.location.reload()}
                      className="mt-4 px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
                    >
                      {t("messageViewer.refresh")}
                    </button>
                  </div>
                </div>
              );
            }
          })()}
        </div>

        {/* Floating scroll buttons */}
        <div className="fixed bottom-10 right-2 flex flex-col gap-2 z-50">
          {showScrollToTop && (
            <button
              type="button"
              onClick={scrollToTop}
              className={cn(
                "p-3 rounded-full shadow-lg transition-all duration-300",
                "bg-blue-500/50 hover:bg-blue-600 text-white",
                "hover:scale-110 focus:outline-none focus:ring-4 focus:ring-blue-300",
                "dark:bg-blue-600/50 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
              )}
              title={t("messageViewer.scrollToTop")}
              aria-label={t("messageViewer.scrollToTop")}
            >
              <ChevronUp className="w-3 h-3" />
            </button>
          )}
          {showScrollToBottom && (
            <button
              type="button"
              onClick={scrollToBottom}
              className={cn(
                "p-3 rounded-full shadow-lg transition-all duration-300",
                "bg-blue-500/50 hover:bg-blue-600 text-white",
                "hover:scale-110 focus:outline-none focus:ring-4 focus:ring-blue-300",
                "dark:bg-blue-600/50 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
              )}
              title={t("messageViewer.scrollToBottom")}
              aria-label={t("messageViewer.scrollToBottom")}
            >
              <ChevronDown className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
