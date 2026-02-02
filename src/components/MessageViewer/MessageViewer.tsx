/**
 * MessageViewer Component
 *
 * Main component for displaying conversation messages with search and navigation.
 * Uses @tanstack/react-virtual for efficient rendering of large message lists.
 */

import { useRef, useCallback, useMemo, useState, useEffect } from "react";
import { OverlayScrollbarsComponent, type OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import { MessageCircle, ChevronDown, ChevronUp, Search, X, Camera } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { LoadingSpinner, LoadingState } from "@/components/ui/loading";

// Local imports
import type { MessageViewerProps } from "./types";
import { VirtualizedMessageRow } from "./components/VirtualizedMessageRow";
import { CaptureModeToolbar } from "./components/CaptureModeToolbar";
import { useSearchState } from "./hooks/useSearchState";
import { useScrollNavigation } from "./hooks/useScrollNavigation";
import { useMessageVirtualization } from "./hooks/useMessageVirtualization";
import {
  groupAgentTasks,
  groupAgentProgressMessages,
  groupTaskOperations,
} from "./helpers";
import { useAppStore } from "../../store/useAppStore";

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
  onBack,
}) => {
  const { t } = useTranslation();
  const scrollContainerRef = useRef<OverlayScrollbarsComponentRef>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Track when OverlayScrollbars is initialized
  const [scrollElementReady, setScrollElementReady] = useState(false);

  // Capture mode state
  const {
    isCaptureMode,
    hiddenMessageIds,
    enterCaptureMode,
    hideMessage,
    showMessage,
    restoreMessages,
    // Navigation state
    targetMessageUuid,
    shouldHighlightTarget,
    clearTargetMessage,
  } = useAppStore();

  // Search state management
  const {
    searchQuery,
    isSearchPending,
    handleSearchInput,
    handleClearSearch: handleClearSearchState,
  } = useSearchState({
    onSearchChange,
    sessionId: selectedSession?.session_id,
  });

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
  // ... (skip down to render loop)
  // We need to apply the highlight logic in the map function

  // ... inside map ...
  // const isMessage = item.type === "message";
  // const isMatch = isMessage && matchedUuids.has(item.message.uuid);
  // const isTarget = isMessage && shouldHighlightTarget && targetMessageUuid === item.message.uuid;
  // const isCurrentMatch = (isMessage && currentMatchUuid === item.message.uuid) || isTarget;


  // 카카오톡 스타일: 항상 전체 메시지 표시 (필터링 없음)
  const displayMessages = messages;

  // Deduplicate messages for grouping
  const uniqueMessages = useMemo(() => {
    if (displayMessages.length === 0) return [];
    return Array.from(
      new Map(displayMessages.map((msg) => [msg.uuid, msg])).values()
    );
  }, [displayMessages]);

  // Agent task grouping
  const agentTaskGroups = useMemo(() => {
    if (import.meta.env.DEV && uniqueMessages.length > 0) {
      const start = performance.now();
      const result = groupAgentTasks(uniqueMessages);
      console.log(`[MessageViewer] groupAgentTasks: ${uniqueMessages.length} messages, ${(performance.now() - start).toFixed(1)}ms`);
      return result;
    }
    return groupAgentTasks(uniqueMessages);
  }, [uniqueMessages]);

  // Pre-compute Set of all agent task member UUIDs for O(1) membership checks
  const agentTaskMemberUuids = useMemo(() => {
    const memberSet = new Set<string>();
    for (const group of agentTaskGroups.values()) {
      for (const uuid of group.messageUuids) {
        memberSet.add(uuid);
      }
    }
    return memberSet;
  }, [agentTaskGroups]);

  // Agent progress grouping (group agent_progress messages by agentId)
  const agentProgressGroups = useMemo(() => {
    return groupAgentProgressMessages(uniqueMessages);
  }, [uniqueMessages]);

  // Pre-compute Set of all agent progress member UUIDs for O(1) membership checks
  const agentProgressMemberUuids = useMemo(() => {
    const memberSet = new Set<string>();
    for (const group of agentProgressGroups.values()) {
      for (const uuid of group.messageUuids) {
        memberSet.add(uuid);
      }
    }
    return memberSet;
  }, [agentProgressGroups]);

  // Task operation grouping (group consecutive TaskCreate/TaskUpdate/etc. messages)
  const taskOperationGroups = useMemo(() => {
    return groupTaskOperations(uniqueMessages);
  }, [uniqueMessages]);

  // Pre-compute Set of all task operation member UUIDs for O(1) membership checks
  const taskOperationMemberUuids = useMemo(() => {
    const memberSet = new Set<string>();
    for (const group of taskOperationGroups.values()) {
      for (const uuid of group.messageUuids) {
        memberSet.add(uuid);
      }
    }
    return memberSet;
  }, [taskOperationGroups]);

  // Helper to get scroll element from OverlayScrollbars
  // Include scrollElementReady to force virtualizer update when ready
  const getScrollElement = useCallback(() => {
    return scrollContainerRef.current?.osInstance()?.elements().viewport ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollElementReady]);

  // Wait for OverlayScrollbars to initialize
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const maxAttempts = 50; // 최대 50번 시도 (약 500ms)
    const checkInterval = 10; // 10ms 간격
    const startTime = import.meta.env.DEV ? performance.now() : 0;

    const checkScrollElement = () => {
      const element = scrollContainerRef.current?.osInstance()?.elements().viewport;
      if (element && !scrollElementReady) {
        if (import.meta.env.DEV) {
          console.log(`[MessageViewer] scrollElementReady after ${attempts} attempts, ${(performance.now() - startTime).toFixed(1)}ms`);
        }
        setScrollElementReady(true);
        return;
      }

      attempts++;
      if (attempts < maxAttempts) {
        timeoutId = setTimeout(checkScrollElement, checkInterval);
      } else if (import.meta.env.DEV) {
        console.warn(`[MessageViewer] scrollElement not ready after ${maxAttempts} attempts (${maxAttempts * checkInterval}ms)`);
      }
    };

    // Check immediately
    checkScrollElement();

    return () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
  }, [scrollElementReady, selectedSession?.session_id]);

  // Virtual scrolling
  const {
    virtualizer,
    flattenedMessages,
    virtualRows,
    totalSize,
    getScrollIndex,
  } = useMessageVirtualization({
    messages: displayMessages,
    agentTaskGroups,
    agentTaskMemberUuids,
    agentProgressGroups,
    agentProgressMemberUuids,
    taskOperationGroups,
    taskOperationMemberUuids,
    getScrollElement,
    hiddenMessageIds,
    isCaptureMode,
  });

  // Scroll navigation with virtualizer support
  const {
    showScrollToTop,
    showScrollToBottom,
    scrollToTop,
    scrollToBottom,
    scrollReadyForSessionId,
  } = useScrollNavigation({
    scrollContainerRef,
    currentMatchUuid,
    currentMatchIndex: sessionSearch.currentMatchIndex,
    messagesLength: flattenedMessages.length,
    selectedSessionId: selectedSession?.session_id,
    isLoading,
    virtualizer,
    getScrollIndex,
    scrollElementReady,
  });

  // Handle Deep Linking / Scrolling to Target
  useEffect(() => {
    if (targetMessageUuid && scrollElementReady && flattenedMessages.length > 0) {
      // Find the index of the target message in the flattened list
      const index = flattenedMessages.findIndex(
        (item) => item.type === "message" && item.message.uuid === targetMessageUuid
      );

      if (index !== -1) {
        // Scroll with a slight delay to ensure rendering is stable, using 'start' alignment
        // We use a timeout to let the virtualizer settle if it just loaded
        setTimeout(() => {
          virtualizer.scrollToIndex(index, { align: "start", behavior: "smooth" });
        }, 100);

        // Auto-clear the target after a few seconds so the highlight fades
        const timer = setTimeout(() => {
          clearTargetMessage();
        }, 3000);

        return () => clearTimeout(timer);
      }
    }
  }, [targetMessageUuid, scrollElementReady, flattenedMessages, virtualizer, clearTargetMessage]);

  // 검색어 초기화 핸들러
  const handleClearSearch = useCallback(() => {
    handleClearSearchState();
    onClearSearch();
    searchInputRef.current?.focus();
  }, [onClearSearch, handleClearSearchState]);

  // 키보드 단축키 핸들러
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        onPrevMatch?.();
      } else {
        onNextMatch?.();
      }
    } else if (e.key === "Escape") {
      handleClearSearch();
    }
  }, [onNextMatch, onPrevMatch, handleClearSearch]);

  // 세션 전환 중인지 확인 (스크롤 요소 미준비 또는 세션 ID 불일치)
  const isSessionTransitioning = selectedSession?.session_id &&
    (!scrollElementReady || scrollReadyForSessionId !== selectedSession?.session_id);

  // 로딩 중이거나 세션 전환 중일 때 로딩 표시
  if ((isLoading || isSessionTransitioning) && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <LoadingState
          isLoading={true}
          loadingMessage={t("messageViewer.loadingMessages")}
          spinnerSize="md"
          withSparkle={false}
        />
      </div>
    );
  }

  // 세션이 없거나 실제로 메시지가 없는 경우에만 "No Messages" 표시
  if (messages.length === 0 && !isSessionTransitioning) {
    return (
      <LoadingState
        isLoading={false}
        isEmpty={true}
        className="flex-1 h-full"
        emptyComponent={
          <div className="flex flex-col items-center justify-center text-muted-foreground h-full">
            <div className="mb-4">
              <MessageCircle className="w-16 h-16 mx-auto text-muted-foreground/50" />
            </div>
            <h3 className="text-lg font-medium mb-2 text-foreground">
              {t("messageViewer.noMessages")}
            </h3>
            <p className="text-sm text-center whitespace-pre-line">
              {t("messageViewer.noMessagesDescription")}
            </p>
          </div>
        }
      />
    );
  }

  return (
    <div className="relative flex-1 h-full flex flex-col">
      {/* Search Toolbar - Editorial aesthetic */}
      <div
        role="search"
        className={cn(
          "flex items-center gap-3 px-4 py-2.5 border-b sticky top-0 z-10",
          "bg-gradient-to-r from-zinc-900/95 via-zinc-800/95 to-zinc-900/95",
          "backdrop-blur-sm border-zinc-700/50"
        )}
      >
        {/* Back Button */}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className={cn(
              "p-2 mr-2 rounded-lg transition-all duration-200",
              "bg-zinc-800/60 hover:bg-zinc-700/80 text-zinc-400 hover:text-zinc-100",
              "border border-zinc-700/40 hover:border-zinc-600/50"
            )}
            title={t("common.back")}
          >
            <ChevronDown className="w-4 h-4 rotate-90" />
          </button>
        )}

        {/* Filter Toggle - Segmented control style */}
        <div className="flex items-center bg-zinc-800/60 rounded-lg p-0.5 border border-zinc-700/40">
          <button
            type="button"
            onClick={() => onFilterTypeChange("content")}
            className={cn(
              "text-xs px-2.5 py-1 rounded-md transition-all duration-200 whitespace-nowrap",
              sessionSearch.filterType === "content"
                ? "bg-zinc-600/80 text-zinc-100 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            )}
            title={t("messageViewer.filterType")}
          >
            {t("messageViewer.filterContent")}
          </button>
          <button
            type="button"
            onClick={() => onFilterTypeChange("toolId")}
            className={cn(
              "text-xs px-2.5 py-1 rounded-md transition-all duration-200 whitespace-nowrap",
              sessionSearch.filterType === "toolId"
                ? "bg-zinc-600/80 text-zinc-100 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            )}
            title={t("messageViewer.filterType")}
          >
            {t("messageViewer.filterToolId")}
          </button>
        </div>

        {/* Search Input - Glass morphism */}
        <div className="relative flex-1 group">
          <Search className={cn(
            "absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4",
            "text-zinc-500 group-focus-within:text-zinc-300 transition-colors"
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
              "w-full pl-9 pr-9 py-2 rounded-lg text-sm",
              "bg-zinc-800/50 border border-zinc-700/50",
              "text-zinc-100 placeholder:text-zinc-500",
              "focus:outline-none focus:ring-1 focus:ring-zinc-500/50 focus:border-zinc-500/70",
              "transition-all duration-200"
            )}
          />
          {searchQuery && (
            isSearchPending ? (
              <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                <LoadingSpinner size="xs" variant="muted" />
              </div>
            ) : (
              <button
                type="button"
                onClick={handleClearSearch}
                aria-label="Clear search"
                className={cn(
                  "absolute right-2.5 top-1/2 transform -translate-y-1/2",
                  "p-1 rounded-md text-zinc-500",
                  "hover:bg-zinc-700/50 hover:text-zinc-300",
                  "transition-all duration-150"
                )}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )
          )}
        </div>

        {/* Match Navigation - Enhanced touch targets */}
        {sessionSearch.query && sessionSearch.matches && sessionSearch.matches.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-mono tabular-nums text-zinc-300 bg-zinc-700/50 px-2 py-1 rounded-md border border-zinc-600/30">
              {sessionSearch.currentMatchIndex + 1}/{sessionSearch.matches.length}
            </span>
            <div className="flex items-center gap-0.5 bg-zinc-800/60 rounded-lg p-0.5 border border-zinc-700/40">
              <button
                type="button"
                onClick={onPrevMatch}
                disabled={sessionSearch.matches.length === 0}
                aria-label="Previous match (Shift+Enter)"
                title="Shift+Enter"
                className={cn(
                  "p-1.5 rounded-md transition-all duration-150",
                  "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/60",
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                )}
              >
                <ChevronUp className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onNextMatch}
                disabled={sessionSearch.matches.length === 0}
                aria-label="Next match (Enter)"
                title="Enter"
                className={cn(
                  "p-1.5 rounded-md transition-all duration-150",
                  "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/60",
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                )}
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Capture Mode Button - Editorial style entry point */}
        {!isCaptureMode && (
          <button
            type="button"
            onClick={enterCaptureMode}
            className={cn(
              "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg",
              "transition-all duration-200",
              "bg-zinc-700/60 hover:bg-zinc-600/70",
              "text-zinc-300 hover:text-zinc-100",
              "border border-zinc-600/50 hover:border-zinc-500/50",
              "shadow-sm hover:shadow-md"
            )}
            title={t("captureMode.tooltip")}
          >
            <Camera className="w-3.5 h-3.5" />
            <span className="font-medium">{t("captureMode.enter")}</span>
          </button>
        )}

        {/* Meta Info - Subtle pill style */}
        <div className="flex items-center gap-1.5 text-xs text-zinc-400">
          <span className="bg-zinc-800/40 px-2 py-0.5 rounded-full">
            {messages.length} {t("messageViewer.messagesShort")}
          </span>
          {selectedSession?.has_tool_use && (
            <span className="bg-zinc-800/40 px-2 py-0.5 rounded-full">
              {t("messageViewer.toolsUsed")}
            </span>
          )}
          {selectedSession?.has_errors && (
            <span className="bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
              {t("messageViewer.hasErrors")}
            </span>
          )}
        </div>
      </div>

      {/* Capture Mode Toolbar */}
      {isCaptureMode && <CaptureModeToolbar />}

      <OverlayScrollbarsComponent
        ref={scrollContainerRef}
        className="flex-1"
        options={{
          scrollbars: { theme: "os-theme-custom", autoHide: "leave", autoHideDelay: 400 },
        }}
      >
        {/* 디버깅 정보 */}
        {import.meta.env.DEV && (
          <div className="bg-warning/10 p-2 text-xs text-warning-foreground border-b border-warning/20 space-y-1">
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
            <div>
              Virtual: flat={flattenedMessages.length} | rows={virtualRows.length} | size={totalSize}px | ready={scrollElementReady ? "Y" : "N"}
            </div>
            <div>
              Overlay: scrollReady={scrollReadyForSessionId?.slice(-8) ?? "null"} | current={selectedSession?.session_id?.slice(-8) ?? "null"} | show={selectedSession?.session_id && scrollReadyForSessionId !== selectedSession?.session_id ? "Y" : "N"}
            </div>
          </div>
        )}
        {/* 검색 결과 없음 */}
        {sessionSearch.query && (!sessionSearch.matches || sessionSearch.matches.length === 0) && !sessionSearch.isSearching && (
          <div className="max-w-4xl mx-auto flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Search className="w-12 h-12 mb-4 text-muted-foreground/50" />
            <p className="text-lg font-medium mb-2 text-foreground">
              {t("messageViewer.noSearchResults")}
            </p>
            <p className="text-sm">
              {t("messageViewer.tryDifferentKeyword")}
            </p>
          </div>
        )}

        {/* 메시지 목록 헤더 */}
        {displayMessages.length > 0 && !sessionSearch.query && (
          <div className="max-w-4xl mx-auto flex items-center justify-center py-4">
            <div className="text-sm text-muted-foreground">
              {t("messageViewer.allMessagesLoaded", {
                count: messages.length,
              })}
            </div>
          </div>
        )}

        {/* 스크롤 준비 중 로딩 오버레이 */}
        {flattenedMessages.length > 0 && scrollElementReady &&
          scrollReadyForSessionId !== selectedSession?.session_id && (
            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
              <LoadingSpinner size="sm" variant="muted" />
            </div>
          )}

        {/* 가상화된 메시지 렌더링 */}
        {flattenedMessages.length > 0 && scrollElementReady && (
          <div
            style={{
              height: totalSize,
              width: "100%",
              position: "relative",
              // 스크롤 준비 완료 전까지 투명하게 처리하여 점프 현상 방지
              opacity: scrollReadyForSessionId === selectedSession?.session_id ? 1 : 0,
              transition: "opacity 50ms ease-in",
            }}
          >
            {virtualRows.map((virtualRow) => {
              const item = flattenedMessages[virtualRow.index];
              if (!item) return null;

              // Hidden placeholders don't have search match info
              const isMessage = item.type === "message";
              const isMatch = isMessage && matchedUuids.has(item.message.uuid);

              const isTarget = isMessage && shouldHighlightTarget && targetMessageUuid === item.message.uuid;
              const isCurrentMatch = (isMessage && currentMatchUuid === item.message.uuid) || isTarget;

              const messageMatchIndex = (isMessage && currentMatchUuid === item.message.uuid) ? currentMatch?.matchIndex : undefined;

              return (
                <VirtualizedMessageRow
                  key={virtualRow.key}
                  ref={virtualizer.measureElement}
                  virtualRow={virtualRow}
                  item={item}
                  isMatch={isMatch}
                  isCurrentMatch={isCurrentMatch}
                  searchQuery={sessionSearch.query}
                  filterType={sessionSearch.filterType}
                  currentMatchIndex={messageMatchIndex}
                  isCaptureMode={isCaptureMode}
                  onHideMessage={hideMessage}
                  onRestoreOne={showMessage}
                  onRestoreAll={restoreMessages}
                />
              );
            })}
          </div>
        )}

        {/* Floating scroll buttons */}
        <div className="fixed bottom-10 right-2 flex flex-col gap-2 z-50">
          {showScrollToTop && (
            <button
              type="button"
              onClick={scrollToTop}
              className={cn(
                "p-3 rounded-full shadow-lg transition-all duration-300",
                "bg-accent/60 hover:bg-accent text-accent-foreground",
                "hover:scale-110 focus:outline-none focus:ring-4 focus:ring-accent/30"
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
                "bg-accent/60 hover:bg-accent text-accent-foreground",
                "hover:scale-110 focus:outline-none focus:ring-4 focus:ring-accent/30"
              )}
              title={t("messageViewer.scrollToBottom")}
              aria-label={t("messageViewer.scrollToBottom")}
            >
              <ChevronDown className="w-3 h-3" />
            </button>
          )}
        </div>
      </OverlayScrollbarsComponent>
    </div>
  );
};
