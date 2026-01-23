/**
 * MessageViewer Component
 *
 * Main component for displaying conversation messages with search and navigation.
 */

import React, { useRef, useCallback, useMemo } from "react";
import { OverlayScrollbarsComponent, type OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import { Loader2, MessageCircle, ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ClaudeMessage } from "../../types";

// Local imports
import type { MessageViewerProps } from "./types";
import { ClaudeMessageNode } from "./components/ClaudeMessageNode";
import { useSearchState } from "./hooks/useSearchState";
import { useScrollNavigation } from "./hooks/useScrollNavigation";
import {
  groupAgentTasks,
  groupAgentProgressMessages,
  getAgentIdFromProgress,
  getParentUuid,
} from "./helpers";

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
  const scrollContainerRef = useRef<OverlayScrollbarsComponentRef>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  // Scroll navigation
  const {
    showScrollToTop,
    showScrollToBottom,
    scrollToTop,
    scrollToBottom,
  } = useScrollNavigation({
    scrollContainerRef,
    currentMatchUuid,
    currentMatchIndex: sessionSearch.currentMatchIndex,
    messagesLength: messages.length,
    selectedSessionId: selectedSession?.session_id,
    isLoading,
  });

  // 카카오톡 스타일: 항상 전체 메시지 표시 (필터링 없음)
  const displayMessages = messages;

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

  // Agent task grouping
  const agentTaskGroups = useMemo(() => {
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

  // Render message tree recursively
  const renderMessageTree = useCallback((
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

    // Check if this message is part of an agent task group
    const groupInfo = agentTaskGroups.get(message.uuid);
    const isGroupLeader = !!groupInfo;
    const isGroupMember = !isGroupLeader && agentTaskMemberUuids.has(message.uuid);

    // Check if this message is part of an agent progress group
    const progressGroupInfo = agentProgressGroups.get(message.uuid);
    const isProgressGroupLeader = !!progressGroupInfo;
    const isProgressGroupMember = !isProgressGroupLeader && agentProgressMemberUuids.has(message.uuid);

    // Get agentId for progress group leader
    const progressAgentId = isProgressGroupLeader
      ? getAgentIdFromProgress(message)
      : null;

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
        agentTaskGroup={isGroupLeader ? groupInfo.tasks : undefined}
        isAgentTaskGroupMember={isGroupMember}
        agentProgressGroup={isProgressGroupLeader && progressAgentId ? {
          entries: progressGroupInfo.entries,
          agentId: progressAgentId,
        } : undefined}
        isAgentProgressGroupMember={isProgressGroupMember}
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
  }, [
    displayMessages,
    matchedUuids,
    currentMatchUuid,
    currentMatch,
    sessionSearch.query,
    sessionSearch.filterType,
    agentTaskGroups,
    agentTaskMemberUuids,
    agentProgressGroups,
    agentProgressMemberUuids,
  ]);

  // Render flat message list
  const renderFlatMessages = useCallback(() => {
    return uniqueMessages.map((message, index) => {
      const uniqueKey =
        message.uuid && message.uuid !== "unknown-session"
          ? `${message.uuid}-${index}`
          : `fallback-${index}-${message.timestamp}-${message.type}`;

      const isMatch = matchedUuids.has(message.uuid);
      const isCurrentMatch = currentMatchUuid === message.uuid;
      const messageMatchIndex = isCurrentMatch ? currentMatch?.matchIndex : undefined;

      // Check if this message is part of an agent task group
      const groupInfo = agentTaskGroups.get(message.uuid);
      const isGroupLeader = !!groupInfo;
      const isGroupMember = !isGroupLeader && agentTaskMemberUuids.has(message.uuid);

      // Check if this message is part of an agent progress group
      const progressGroupInfo = agentProgressGroups.get(message.uuid);
      const isProgressGroupLeader = !!progressGroupInfo;
      const isProgressGroupMember = !isProgressGroupLeader && agentProgressMemberUuids.has(message.uuid);

      // Get agentId for progress group leader
      const progressAgentId = isProgressGroupLeader
        ? getAgentIdFromProgress(message)
        : null;

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
          agentTaskGroup={isGroupLeader ? groupInfo.tasks : undefined}
          isAgentTaskGroupMember={isGroupMember}
          agentProgressGroup={isProgressGroupLeader && progressAgentId ? {
            entries: progressGroupInfo.entries,
            agentId: progressAgentId,
          } : undefined}
          isAgentProgressGroupMember={isProgressGroupMember}
        />
      );
    });
  }, [
    uniqueMessages,
    matchedUuids,
    currentMatchUuid,
    currentMatch,
    sessionSearch.query,
    sessionSearch.filterType,
    agentTaskGroups,
    agentTaskMemberUuids,
    agentProgressGroups,
    agentProgressMemberUuids,
  ]);

  if (isLoading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="flex items-center space-x-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{t("messageViewer.loadingMessages")}</span>
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground h-full">
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
    );
  }

  return (
    <div className="relative flex-1 h-full flex flex-col">
      {/* Compact Toolbar */}
      <div
        role="search"
        className={cn(
          "flex items-center gap-3 px-4 py-2 border-b sticky top-0 z-10",
          "bg-secondary/50 border-border"
        )}
      >
        {/* Filter Toggle */}
        <button
          type="button"
          onClick={() => {
            onFilterTypeChange(sessionSearch.filterType === "content" ? "toolId" : "content");
          }}
          className={cn(
            "text-xs px-2 py-1.5 rounded-md transition-colors whitespace-nowrap",
            "hover:bg-secondary/80",
            "bg-secondary text-secondary-foreground"
          )}
          title={t("messageViewer.filterType")}
        >
          {sessionSearch.filterType === "content"
            ? t("messageViewer.filterContent")
            : t("messageViewer.filterToolId")}
        </button>

        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
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
              "focus:outline-none focus:ring-2 focus:ring-ring",
              "bg-background border-border text-foreground"
            )}
          />
          {searchQuery && (
            isSearchPending ? (
              <div className="absolute right-2.5 top-1/2 transform -translate-y-1/2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <button
                type="button"
                onClick={handleClearSearch}
                aria-label="Clear search"
                className={cn(
                  "absolute right-2 top-1/2 transform -translate-y-1/2",
                  "p-0.5 rounded-full hover:bg-secondary text-muted-foreground"
                )}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )
          )}
        </div>

        {/* Match Navigation */}
        {sessionSearch.query && sessionSearch.matches && sessionSearch.matches.length > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
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
                "hover:bg-secondary",
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
                "hover:bg-secondary",
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
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{messages.length} {t("messageViewer.messagesShort")}</span>
          {selectedSession?.has_tool_use && (
            <span>· {t("messageViewer.toolsUsed")}</span>
          )}
          {selectedSession?.has_errors && (
            <span className="text-destructive">· {t("messageViewer.hasErrors")}</span>
          )}
        </div>
      </div>

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
          </div>
        )}
        <div className="max-w-4xl mx-auto">
          {/* 검색 결과 없음 */}
          {sessionSearch.query && (!sessionSearch.matches || sessionSearch.matches.length === 0) && !sessionSearch.isSearching && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Search className="w-12 h-12 mb-4 text-muted-foreground/50" />
              <p className="text-lg font-medium mb-2 text-foreground">
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
              <div className="text-sm text-muted-foreground">
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
                return renderFlatMessages();
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
                  <div className="text-center text-destructive">
                    <div className="text-lg font-semibold mb-2">
                      {t("messageViewer.renderError")}
                    </div>
                    <div className="text-sm text-destructive/80">
                      {t("messageViewer.checkConsole")}
                    </div>
                    <button
                      type="button"
                      onClick={() => window.location.reload()}
                      className="mt-4 px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors"
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
