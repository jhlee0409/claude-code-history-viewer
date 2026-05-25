// src/components/ProjectTree/components/SessionList.tsx
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FixedSizeList as List } from "react-window";
import { Search, X, SortDesc, SortAsc } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  matchesEntrypointFilter,
  ENTRYPOINT_FILTER_OPTIONS,
  ENTRYPOINT_FILTER_LABEL_KEYS,
} from "@/utils/entrypoint";
import { SessionItem } from "../../SessionItem";
import { useAppStore } from "@/store/useAppStore";
import type { SessionListProps } from "../types";
import type { ClaudeSession } from "../../../types";
import type { SessionSortOrder, SessionEntrypointFilter } from "@/types/metadata.types";

// SessionItem fixed row height. Sized to fit a 2-line wrapped name:
//   py-2.5 (20px) + name 2 × text-xs/leading-relaxed (39px)
//   + gap-1.5 (6px) + meta text-2xs (15px) ≈ 80px → 88px with safety margin.
// Bumping this matters because react-window's FixedSizeList stacks rows at
// `index * height`; a row taller than the height visually overlaps the next
// row (#284). line-clamp-2 caps the worst case at 2 lines.
const SESSION_ITEM_HEIGHT = 88;
// Virtual scroll을 적용할 최소 세션 수
const VIRTUALIZATION_THRESHOLD = 20;
// Virtual list의 최대 표시 높이
const MAX_LIST_HEIGHT = 400;

interface SessionRowProps {
  index: number;
  style: React.CSSProperties;
  data: {
    sessions: ClaudeSession[];
    selectedSession: ClaudeSession | null;
    onSessionSelect: (session: ClaudeSession) => void;
    onSessionHover?: (session: ClaudeSession) => void;
    formatTimeAgo: (date: string) => string;
  };
}

const SessionRow: React.FC<SessionRowProps> = ({ index, style, data }) => {
  const { sessions, selectedSession, onSessionSelect, onSessionHover, formatTimeAgo } = data;
  const session = sessions[index];

  if (!session) {
    return null;
  }

  return (
    <div style={style}>
      <SessionItem
        session={session}
        isSelected={selectedSession?.session_id === session.session_id}
        onSelect={() => onSessionSelect(session)}
        onHover={() => onSessionHover?.(session)}
        formatTimeAgo={formatTimeAgo}
      />
    </div>
  );
};

interface SessionListControlsProps {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  sessionSortOrder: SessionSortOrder;
  onToggleSortOrder: () => void;
  sessionEntrypointFilter: SessionEntrypointFilter;
  onEntrypointFilterChange: (filter: SessionEntrypointFilter) => void;
}

/**
 * Search + sort + source(entrypoint) filter controls for a session list.
 * Extracted into one component so the default and virtualized render paths
 * share a single implementation instead of duplicating the markup.
 */
const SessionListControls: React.FC<SessionListControlsProps> = ({
  searchQuery,
  onSearchQueryChange,
  sessionSortOrder,
  onToggleSortOrder,
  sessionEntrypointFilter,
  onEntrypointFilterChange,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-1.5 px-2 py-1.5 border-b border-border/30">
      {/* Search + Sort */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input
            placeholder={t("session.filter.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className="h-7 pl-7 pr-7 text-xs"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchQueryChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2"
              aria-label={t("session.filter.clearSearch")}
            >
              <X className="w-3 h-3 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>
        <button
          onClick={onToggleSortOrder}
          className="p-1.5 rounded hover:bg-muted/50 transition-colors"
          aria-label={
            sessionSortOrder === "newest"
              ? t("session.filter.sortOldestFirst")
              : t("session.filter.sortNewestFirst")
          }
          title={
            sessionSortOrder === "newest"
              ? t("session.filter.sortOldestFirst")
              : t("session.filter.sortNewestFirst")
          }
        >
          {sessionSortOrder === "newest" ? (
            <SortDesc className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <SortAsc className="w-3.5 h-3.5 text-accent" />
          )}
        </button>
      </div>

      {/* Source (entrypoint) segmented filter */}
      <div className="flex items-center gap-1.5">
        <span className="text-2xs text-muted-foreground shrink-0">
          {t("session.filter.source.label")}
        </span>
        <div
          className="flex items-center gap-0.5 flex-wrap"
          role="group"
          aria-label={t("session.filter.source.label")}
        >
          {ENTRYPOINT_FILTER_OPTIONS.map((option) => {
            const isActive = sessionEntrypointFilter === option;
            return (
              <button
                key={option}
                onClick={() => onEntrypointFilterChange(option)}
                aria-pressed={isActive}
                className={cn(
                  "px-1.5 py-0.5 rounded text-2xs font-medium transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted/50"
                )}
              >
                {t(ENTRYPOINT_FILTER_LABEL_KEYS[option])}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const SessionList: React.FC<SessionListProps> = ({
  sessions,
  selectedSession,
  isLoading,
  onSessionSelect,
  onSessionHover,
  formatTimeAgo,
  variant = "default",
}) => {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const {
    sessionSortOrder,
    setSessionSortOrder,
    sessionEntrypointFilter,
    setSessionEntrypointFilter,
    getSessionDisplayName,
  } = useAppStore();

  const isWorktree = variant === "worktree";
  const isMain = variant === "main";
  const borderClass = isWorktree
    ? "border-l border-emerald-500/30"
    : isMain
      ? "border-l border-accent/30"
      : "border-l-2 border-accent/20";

  const containerClass = isWorktree || isMain ? "ml-4 pl-2" : "ml-6 pl-3";

  // Filter and sort sessions
  const filteredAndSortedSessions = useMemo(() => {
    let result = [...sessions];

    // Sort
    result.sort((a, b) => {
      const dateA = new Date(a.last_modified).getTime();
      const dateB = new Date(b.last_modified).getTime();
      return sessionSortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });

    // Filter by source (entrypoint)
    if (sessionEntrypointFilter !== 'all') {
      result = result.filter((session) =>
        matchesEntrypointFilter(session.entrypoint, sessionEntrypointFilter)
      );
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(session => {
        const displayName = getSessionDisplayName(session.session_id, session.summary);
        return (
          displayName?.toLowerCase().includes(query) ||
          session.summary?.toLowerCase().includes(query) ||
          session.session_id.toLowerCase().includes(query)
        );
      });
    }

    return result;
  }, [sessions, sessionSortOrder, sessionEntrypointFilter, searchQuery, getSessionDisplayName]);

  // Show controls only if we have enough sessions
  const showControls = sessions.length >= 3;

  const handleToggleSortOrder = () =>
    setSessionSortOrder(sessionSortOrder === 'newest' ? 'oldest' : 'newest');

  const controls = showControls ? (
    <SessionListControls
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      sessionSortOrder={sessionSortOrder}
      onToggleSortOrder={handleToggleSortOrder}
      sessionEntrypointFilter={sessionEntrypointFilter}
      onEntrypointFilterChange={setSessionEntrypointFilter}
    />
  ) : null;

  // Virtual list에 전달할 데이터 memoize
  const itemData = useMemo(
    () => ({
      sessions: filteredAndSortedSessions,
      selectedSession,
      onSessionSelect,
      onSessionHover,
      formatTimeAgo,
    }),
    [filteredAndSortedSessions, selectedSession, onSessionSelect, onSessionHover, formatTimeAgo]
  );

  // 리스트 높이 계산
  const listHeight = useMemo(() => {
    const totalHeight = filteredAndSortedSessions.length * SESSION_ITEM_HEIGHT;
    return Math.min(totalHeight, MAX_LIST_HEIGHT);
  }, [filteredAndSortedSessions.length]);

  // Virtual scroll 사용 여부
  const useVirtualScroll = filteredAndSortedSessions.length >= VIRTUALIZATION_THRESHOLD;

  if (isLoading) {
    return (
      <div className={cn(containerClass, borderClass, "space-y-2 py-2")}>
        {[1, 2, isWorktree || isMain ? 0 : 3].filter(Boolean).map((i) => (
          <div key={i} className="flex items-center gap-2.5 py-2 px-3">
            <Skeleton variant="circular" className="w-5 h-5" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-2 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className={cn(containerClass, "py-2 text-2xs text-muted-foreground", isWorktree || isMain ? "ml-5" : "ml-7")}>
        {t("components:session.notFound", "No sessions")}
      </div>
    );
  }

  // 세션 수가 적으면 기존 방식 유지
  if (!useVirtualScroll) {
    return (
      <div className={cn(containerClass, borderClass, (isWorktree || isMain) && "py-1.5")}>
        {controls}

        {/* Session List */}
        <div className="space-y-1 py-2">
          {filteredAndSortedSessions.length === 0 ? (
            <div className="py-2 text-2xs text-muted-foreground text-center">
              {t("session.filter.noResults", "No matching sessions")}
            </div>
          ) : (
            filteredAndSortedSessions.map((session) => (
              <SessionItem
                key={session.session_id}
                session={session}
                isSelected={selectedSession?.session_id === session.session_id}
                onSelect={() => onSessionSelect(session)}
                onHover={() => onSessionHover?.(session)}
                formatTimeAgo={formatTimeAgo}
              />
            ))
          )}
        </div>
      </div>
    );
  }

  // 세션 수가 많으면 virtual scroll 적용
  return (
    <div className={cn(containerClass, borderClass, (isWorktree || isMain) && "py-1.5")}>
      {controls}

      {/* Virtual Scroll List */}
      <div className="py-2">
        {filteredAndSortedSessions.length === 0 ? (
          <div className="py-2 text-2xs text-muted-foreground text-center">
            {t("session.filter.noResults", "No matching sessions")}
          </div>
        ) : (
          <List
            height={listHeight}
            itemCount={filteredAndSortedSessions.length}
            itemSize={SESSION_ITEM_HEIGHT}
            width="100%"
            itemData={itemData}
            overscanCount={5}
            className="session-virtual-list"
          >
            {SessionRow}
          </List>
        )}
      </div>
    </div>
  );
};
