import React, {
  useEffect,
  useRef,
  useCallback,
  useState,
  useMemo,
  useDeferredValue,
} from "react";
import { OverlayScrollbarsComponent, type OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import { Loader2, MessageCircle, ChevronDown, ChevronUp, Search, X, HelpCircle, ChevronRight, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ClaudeMessage, ClaudeSession, ProgressData } from "../types";
import type { SearchState, SearchFilterType } from "../store/useAppStore";
import { ClaudeContentArrayRenderer } from "./contentRenderer";
import {
  ClaudeToolUseDisplay,
  MessageContentDisplay,
  ToolExecutionResultRouter,
  ProgressRenderer,
  AgentProgressGroupRenderer,
} from "./messageRenderer";
import { AgentTaskGroupRenderer, type AgentTask } from "./toolResultRenderer";
import { getToolName } from "./CollapsibleToolResult";
import { extractClaudeMessageContent } from "../utils/messageUtils";
import { cn } from "@/lib/utils";
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
  // Agent task grouping
  agentTaskGroup?: AgentTask[];
  isAgentTaskGroupMember?: boolean; // true if part of a group but not the leader
  // Agent progress grouping
  agentProgressGroup?: { entries: AgentProgressEntry[]; agentId: string };
  isAgentProgressGroupMember?: boolean; // true if part of a progress group but not the leader
}

interface MessageHeaderProps {
  message: ClaudeMessage;
}

const hasSystemCommandContent = (message: ClaudeMessage): boolean => {
  const content = extractClaudeMessageContent(message);
  if (!content || typeof content !== "string") return false;
  // Check for actual XML tag pairs, not just strings in backticks
  return /<command-name>[\s\S]*?<\/command-name>/.test(content) ||
         /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/.test(content) ||
         /<command-message>[\s\S]*?<\/command-message>/.test(content);
};

// Helper to check if a message is an agent task launch (isAsync: true)
const isAgentTaskLaunchMessage = (message: ClaudeMessage): boolean => {
  if (!message.toolUseResult || typeof message.toolUseResult !== "object") return false;
  const result = message.toolUseResult as Record<string, unknown>;
  return result.isAsync === true && typeof result.agentId === "string";
};

// Helper to check if a message is an agent task completion
// Handles: status "completed"/"error", or synchronous completion (isAsync === false)
const isAgentTaskCompletionMessage = (message: ClaudeMessage): boolean => {
  if (!message.toolUseResult || typeof message.toolUseResult !== "object") return false;
  const result = message.toolUseResult as Record<string, unknown>;
  if (typeof result.agentId !== "string") return false;
  // Synchronous completion (isAsync === false)
  if (result.isAsync === false) return true;
  // Async completion with status "completed" or "error" (and isAsync is undefined)
  return result.isAsync === undefined &&
         (result.status === "completed" || result.status === "error");
};

// Helper to check if a message is an agent task launch (used by extractAgentTask)
const isAgentTaskMessage = (message: ClaudeMessage): boolean => {
  return isAgentTaskLaunchMessage(message);
};

// Helper to extract agent task info from a message
const extractAgentTask = (message: ClaudeMessage): AgentTask | null => {
  if (!isAgentTaskMessage(message)) return null;
  const result = message.toolUseResult as Record<string, unknown>;
  return {
    agentId: String(result.agentId),
    description: String(result.description || ""),
    status: (result.status === "completed" ? "completed" :
             result.status === "error" ? "error" : "async_launched") as AgentTask["status"],
    outputFile: result.outputFile ? String(result.outputFile) : undefined,
    prompt: result.prompt ? String(result.prompt) : undefined,
  };
};

// Group agent task messages by timestamp (within 2 seconds) - non-consecutive grouping
// Also includes completion messages linked by agentId
const groupAgentTasks = (
  messages: ClaudeMessage[]
): Map<string, { tasks: AgentTask[]; messageUuids: Set<string> }> => {
  const groups = new Map<string, { tasks: AgentTask[]; messageUuids: Set<string> }>();

  // First, extract all agent task LAUNCH messages with their timestamps
  const agentTaskMessages: { msg: ClaudeMessage; task: AgentTask; timestamp: number }[] = [];
  for (const msg of messages) {
    const task = extractAgentTask(msg);
    if (task) {
      agentTaskMessages.push({
        msg,
        task,
        timestamp: new Date(msg.timestamp).getTime(),
      });
    }
  }

  // Sort by timestamp to ensure proper grouping
  agentTaskMessages.sort((a, b) => a.timestamp - b.timestamp);

  // Group by timestamp proximity (within 2 seconds)
  let currentGroup: { leaderId: string; tasks: AgentTask[]; messageUuids: Set<string>; timestamp: number } | null = null;

  // Map to track agentId -> group for completion message linking
  const agentIdToGroup = new Map<string, { tasks: AgentTask[]; messageUuids: Set<string> }>();

  for (const { msg, task, timestamp } of agentTaskMessages) {
    // Check if this task belongs to the current group (within 2 seconds)
    if (currentGroup && Math.abs(timestamp - currentGroup.timestamp) <= 2000) {
      currentGroup.tasks.push(task);
      currentGroup.messageUuids.add(msg.uuid);
      agentIdToGroup.set(task.agentId, groups.get(currentGroup.leaderId)!);
    } else {
      // Start a new group
      currentGroup = {
        leaderId: msg.uuid,
        tasks: [task],
        messageUuids: new Set([msg.uuid]),
        timestamp,
      };
      const groupData = {
        tasks: currentGroup.tasks,
        messageUuids: currentGroup.messageUuids,
      };
      groups.set(currentGroup.leaderId, groupData);
      agentIdToGroup.set(task.agentId, groupData);
    }
  }

  // Now find completion messages and link them to groups by agentId
  for (const msg of messages) {
    if (isAgentTaskCompletionMessage(msg)) {
      const result = msg.toolUseResult as Record<string, unknown>;
      const agentId = String(result.agentId);
      const group = agentIdToGroup.get(agentId);

      if (group) {
        group.messageUuids.add(msg.uuid);
        const task = group.tasks.find(t => t.agentId === agentId);
        if (task) {
          // Set status based on result.status or fallback to "completed" for synchronous completions
          if (result.status === "error") {
            task.status = "error";
          } else {
            task.status = "completed";
          }
        }
      }
    }

    // Handle queue-operation messages with <task-notification> tags
    if (msg.type === "queue-operation") {
      const content = extractClaudeMessageContent(msg);
      if (content && typeof content === "string" && content.includes("<task-notification>")) {
        // Extract task-id from content
        const taskIdMatch = content.match(/<task-id>([^<]+)<\/task-id>/);
        const taskId = taskIdMatch?.[1];
        if (taskId) {
          const group = agentIdToGroup.get(taskId);

          if (group) {
            group.messageUuids.add(msg.uuid);
            const task = group.tasks.find(t => t.agentId === taskId);
            if (task) {
              task.status = "completed";
            }
          }
        }
      }
    }

    // Handle user messages with <task-notification> tags (batched notifications)
    if (msg.type === "user") {
      const content = extractClaudeMessageContent(msg);
      if (content && typeof content === "string" && content.includes("<task-notification>")) {
        // Extract ALL task-ids from content (may contain multiple)
        const taskIdMatches = [...content.matchAll(/<task-id>([^<]+)<\/task-id>/g)];

        for (const match of taskIdMatches) {
          const taskId = match[1];
          if (taskId) {
            const group = agentIdToGroup.get(taskId);

            if (group) {
              group.messageUuids.add(msg.uuid);
              const task = group.tasks.find(t => t.agentId === taskId);
              if (task) {
                task.status = "completed";
              }
            }
          }
        }
      }
    }
  }

  return groups;
};

// Interface for agent progress entries
interface AgentProgressEntry {
  data: ProgressData;
  timestamp: string;
  uuid: string;
}

// Helper to check if a message is an agent progress message
const isAgentProgressMessage = (message: ClaudeMessage): boolean => {
  if (message.type !== "progress") return false;
  const data = message.data as ProgressData | undefined;
  return data?.type === "agent_progress" && typeof data?.agentId === "string";
};

// Extract agentId from a progress message
const getAgentIdFromProgress = (message: ClaudeMessage): string | null => {
  if (!isAgentProgressMessage(message)) return null;
  const data = message.data as ProgressData;
  return data.agentId || null;
};

// Group consecutive agent progress messages by agentId
// Only groups progress messages that appear consecutively in the message list
const groupAgentProgressMessages = (
  messages: ClaudeMessage[]
): Map<string, { entries: AgentProgressEntry[]; messageUuids: Set<string> }> => {
  const groups = new Map<string, { entries: AgentProgressEntry[]; messageUuids: Set<string> }>();

  let prevAgentId: string | null = null;
  let prevWasProgress = false;
  let currentGroup: { leaderId: string; entries: AgentProgressEntry[]; messageUuids: Set<string> } | null = null;

  for (const msg of messages) {
    const agentId = getAgentIdFromProgress(msg);

    if (agentId) {
      // This is a progress message
      const entry: AgentProgressEntry = {
        data: msg.data as ProgressData,
        timestamp: msg.timestamp,
        uuid: msg.uuid,
      };

      // Check if this continues the current group (same agentId and previous was also progress)
      if (prevWasProgress && prevAgentId === agentId && currentGroup) {
        // Append to current group
        currentGroup.entries.push(entry);
        currentGroup.messageUuids.add(msg.uuid);
      } else {
        // Start a new group
        currentGroup = {
          leaderId: msg.uuid,
          entries: [entry],
          messageUuids: new Set([msg.uuid]),
        };
        groups.set(msg.uuid, {
          entries: currentGroup.entries,
          messageUuids: currentGroup.messageUuids,
        });
      }

      prevAgentId = agentId;
      prevWasProgress = true;
    } else {
      // Not a progress message - reset tracking
      prevAgentId = null;
      prevWasProgress = false;
      currentGroup = null;
    }
  }

  return groups;
};

const MessageHeader = ({ message }: MessageHeaderProps) => {
  const { t } = useTranslation("components");
  const isToolResultMessage = !!message.toolUseResult && message.type === "user";
  const isSystemContent = hasSystemCommandContent(message);
  const toolName = isToolResultMessage
    ? getToolName(message.toolUse as Record<string, unknown> | undefined, message.toolUseResult)
    : null;
  const isLeftAligned = message.type !== "user" || isToolResultMessage || isSystemContent;

  return (
    <div className={cn(
      "flex items-center mb-1 text-xs text-muted-foreground",
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
          <span className="px-1.5 py-0.5 text-xs font-mono bg-warning/20 text-warning-foreground rounded-full">
            {t("messageViewer.branch")}
          </span>
        )}
      </div>

      {message.type === "assistant" && message.model && (
        <div className="relative group flex items-center gap-1.5">
          <span className="text-muted-foreground">{getShortModelName(message.model)}</span>
          {message.usage && (
            <>
              <HelpCircle className="w-3 h-3 cursor-help text-muted-foreground" />
              <div className={cn(
                "absolute bottom-full mb-2 right-0 w-52 bg-popover text-popover-foreground",
                "text-xs rounded-md p-2.5",
                "opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg z-10 border border-border"
              )}>
                <p className="mb-1"><strong>{t("assistantMessageDetails.model")}:</strong> {message.model}</p>
                <p className="mb-1"><strong>{t("messageViewer.time")}:</strong> {formatTime(message.timestamp)}</p>
                {message.usage.input_tokens && <p>{t("assistantMessageDetails.input")}: {message.usage.input_tokens.toLocaleString()}</p>}
                {message.usage.output_tokens && <p>{t("assistantMessageDetails.output")}: {message.usage.output_tokens.toLocaleString()}</p>}
                {message.usage.cache_creation_input_tokens ? <p>{t("assistantMessageDetails.cacheCreation")}: {message.usage.cache_creation_input_tokens.toLocaleString()}</p> : null}
                {message.usage.cache_read_input_tokens ? <p>{t("assistantMessageDetails.cacheRead")}: {message.usage.cache_read_input_tokens.toLocaleString()}</p> : null}
                <div className="absolute right-4 top-full w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-popover"></div>
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
    <div className="rounded-md border mx-4 my-2 bg-info/10 border-info/30">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "w-full flex items-center gap-1.5 px-3 py-2 h-8",
          "text-left hover:bg-info/20 transition-colors rounded-md"
        )}
      >
        <ChevronRight
          className={cn(
            "w-4 h-4 transition-transform flex-shrink-0 text-info",
            isExpanded && "rotate-90"
          )}
        />
        <FileText className="w-4 h-4 flex-shrink-0 text-info" />
        <span className="text-sm font-medium text-info-foreground">
          {t("messageViewer.priorContext")}
        </span>
        <span className="text-xs ml-auto text-info">
          {formatTimeShort(timestamp)}
        </span>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 text-sm text-info-foreground">
          {content}
        </div>
      )}
    </div>
  );
};

const isEmptyMessage = (message: ClaudeMessage): boolean => {
  // Messages with tool use or results should be shown
  if (message.toolUse || message.toolUseResult) return false;

  // Progress messages should be shown
  if (message.type === "progress" && message.data) return false;

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

const ClaudeMessageNode = React.memo(({ message, isCurrentMatch, isMatch, searchQuery, filterType = "content", currentMatchIndex, agentTaskGroup, isAgentTaskGroupMember, agentProgressGroup, isAgentProgressGroupMember }: MessageNodeProps) => {
  if (message.isSidechain) {
    return null;
  }

  // Render hidden placeholders for group members to preserve DOM nodes for search/highlight
  if (isAgentTaskGroupMember) {
    return (
      <div
        data-message-uuid={message.uuid}
        className="hidden"
        aria-hidden="true"
      />
    );
  }

  if (isAgentProgressGroupMember) {
    return (
      <div
        data-message-uuid={message.uuid}
        className="hidden"
        aria-hidden="true"
      />
    );
  }

  // Skip empty messages (no content, or only command tags)
  if (isEmptyMessage(message)) {
    return null;
  }

  // Render grouped agent tasks
  if (agentTaskGroup && agentTaskGroup.length > 0) {
    return (
      <div data-message-uuid={message.uuid} className="w-full px-4 py-2">
        <div className="max-w-4xl mx-auto">
          <AgentTaskGroupRenderer tasks={agentTaskGroup} timestamp={message.timestamp} />
        </div>
      </div>
    );
  }

  // Render grouped agent progress (replaces individual ProgressRenderer for agent_progress)
  if (agentProgressGroup && agentProgressGroup.entries.length > 0) {
    return (
      <div data-message-uuid={message.uuid} className="w-full px-4 py-2">
        <div className="max-w-4xl mx-auto">
          <AgentProgressGroupRenderer
            entries={agentProgressGroup.entries}
            agentId={agentProgressGroup.agentId}
          />
        </div>
      </div>
    );
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

  // Progress messages get special rendering (non-agent progress types)
  if (message.type === "progress" && message.data) {
    return (
      <div data-message-uuid={message.uuid} className="w-full px-4 py-1">
        <div className="max-w-4xl mx-auto">
          <ProgressRenderer
            data={message.data as ProgressData}
            toolUseID={message.toolUseID}
            parentToolUseID={message.parentToolUseID}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      data-message-uuid={message.uuid}
      className={cn(
        "w-full px-4 py-2 transition-colors duration-300",
        message.isSidechain && "bg-muted",
        // 현재 매치된 메시지 강조
        isCurrentMatch && "bg-highlight-current ring-2 ring-warning",
        // 다른 매치 메시지 연한 강조
        isMatch && !isCurrentMatch && "bg-highlight"
      )}
    >
      <div className="max-w-4xl mx-auto">
        {/* Compact message header */}
        <MessageHeader message={message} />

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
            <ToolExecutionResultRouter
              toolResult={message.toolUseResult}
              depth={0}
              searchQuery={searchQuery}
              isCurrentMatch={isCurrentMatch}
              currentMatchIndex={currentMatchIndex}
            />
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
  const scrollContainerRef = useRef<OverlayScrollbarsComponentRef>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Helper to get the scroll viewport element
  const getScrollViewport = useCallback(() => {
    return scrollContainerRef.current?.osInstance()?.elements().viewport ?? null;
  }, []);

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

  // 이전 세션 ID를 추적
  const prevSessionIdRef = useRef<string | null>(null);

  // 맨 아래로 스크롤하는 함수
  const scrollToBottom = useCallback(() => {
    const element = getScrollViewport();
    if (element) {
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
  }, [getScrollViewport]);

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
    const viewport = getScrollViewport();
    if (!viewport) return;

    // 먼저 하이라이트된 텍스트 요소를 찾음
    const highlightElement = viewport.querySelector(
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
      const messageElement = viewport.querySelector(
        `[data-message-uuid="${matchUuid}"]`
      );

      if (messageElement) {
        messageElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    }
  }, [getScrollViewport]);

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
    const viewport = getScrollViewport();
    if (viewport) {
      viewport.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [getScrollViewport]);

  // 스크롤 이벤트 최적화 (쓰로틀링 적용)
  useEffect(() => {
    let throttleTimer: ReturnType<typeof setTimeout> | null = null;

    const handleScroll = () => {
      if (throttleTimer) return;

      throttleTimer = setTimeout(() => {
        try {
          const viewport = getScrollViewport();
          if (viewport) {
            const { scrollTop, scrollHeight, clientHeight } = viewport;
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

    // Delay to ensure OverlayScrollbars is initialized
    const timer = setTimeout(() => {
      const scrollElement = getScrollViewport();
      if (scrollElement) {
        scrollElement.addEventListener("scroll", handleScroll, { passive: true });
        handleScroll();
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      if (throttleTimer) {
        clearTimeout(throttleTimer);
      }
      const scrollElement = getScrollViewport();
      if (scrollElement) {
        scrollElement.removeEventListener("scroll", handleScroll);
      }
    };
  }, [displayMessages.length, getScrollViewport]);

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
  };

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
            setSearchQuery("");
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
