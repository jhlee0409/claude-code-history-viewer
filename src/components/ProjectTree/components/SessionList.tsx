// src/components/ProjectTree/components/SessionList.tsx
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FixedSizeList as List } from "react-window";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { SessionItem } from "../../SessionItem";
import type { SessionListProps } from "../types";
import type { ClaudeSession } from "../../../types";

// SessionItem의 대략적인 높이 (py-2.5 + 내용)
const SESSION_ITEM_HEIGHT = 72;
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

  const isWorktree = variant === "worktree";
  const isMain = variant === "main";
  const borderClass = isWorktree
    ? "border-l border-emerald-500/30"
    : isMain
      ? "border-l border-accent/30"
      : "border-l-2 border-accent/20";

  const containerClass = isWorktree || isMain ? "ml-4 pl-2" : "ml-6 pl-3";

  // Virtual list에 전달할 데이터 memoize
  const itemData = useMemo(
    () => ({
      sessions,
      selectedSession,
      onSessionSelect,
      onSessionHover,
      formatTimeAgo,
    }),
    [sessions, selectedSession, onSessionSelect, onSessionHover, formatTimeAgo]
  );

  // 리스트 높이 계산
  const listHeight = useMemo(() => {
    const totalHeight = sessions.length * SESSION_ITEM_HEIGHT;
    return Math.min(totalHeight, MAX_LIST_HEIGHT);
  }, [sessions.length]);

  // Virtual scroll 사용 여부
  const useVirtualScroll = sessions.length >= VIRTUALIZATION_THRESHOLD;

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
      <div className={cn(containerClass, borderClass, "space-y-1 py-2", (isWorktree || isMain) && "py-1.5")}>
        {sessions.map((session) => (
          <SessionItem
            key={session.session_id}
            session={session}
            isSelected={selectedSession?.session_id === session.session_id}
            onSelect={() => onSessionSelect(session)}
            onHover={() => onSessionHover?.(session)}
            formatTimeAgo={formatTimeAgo}
          />
        ))}
      </div>
    );
  }

  // 세션 수가 많으면 virtual scroll 적용
  return (
    <div className={cn(containerClass, borderClass, "py-2", (isWorktree || isMain) && "py-1.5")}>
      <List
        height={listHeight}
        itemCount={sessions.length}
        itemSize={SESSION_ITEM_HEIGHT}
        width="100%"
        itemData={itemData}
        overscanCount={5}
        className="session-virtual-list"
      >
        {SessionRow}
      </List>
    </div>
  );
};
