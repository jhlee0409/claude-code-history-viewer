import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageSquare } from "lucide-react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { cn } from "@/lib/utils";
import { SessionList } from "@/components/ProjectTree/components/SessionList";
import { getProviderBadgeStyle, getProviderId, getProviderLabel } from "@/utils/providers";
import type { ClaudeProject, ClaudeSession } from "@/types";

interface SessionsPaneProps {
  selectedProject: ClaudeProject;
  sessions: ClaudeSession[];
  sessionsTotal?: number;
  hasMoreSessions?: boolean;
  selectedSession: ClaudeSession | null;
  isLoading: boolean;
  isLoadingMoreSessions?: boolean;
  onSessionSelect: (session: ClaudeSession) => void;
  onSessionHover?: (session: ClaudeSession) => void;
  onLoadMoreSessions?: () => void;
  formatTimeAgo: (date: string) => string;
  width: number;
  isResizing?: boolean;
  onResizeStart?: (e: React.MouseEvent<HTMLElement>) => void;
}

// Header + list controls (search/sort/source/selection bar) above the virtual
// list; subtracted from the measured pane height so the list fills the rest.
const LIST_CHROME_HEIGHT = 150;

/**
 * Sessions of the selected project as their own column beside the project
 * explorer, so expanding a project never pushes the other projects out of view
 * and the session list keeps its own scroll.
 */
export function SessionsPane({
  selectedProject,
  sessions,
  sessionsTotal,
  hasMoreSessions,
  selectedSession,
  isLoading,
  isLoadingMoreSessions,
  onSessionSelect,
  onSessionHover,
  onLoadMoreSessions,
  formatTimeAgo,
  width,
  isResizing,
  onResizeStart,
}: SessionsPaneProps) {
  const { t } = useTranslation();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyHeight, setBodyHeight] = useState(0);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBodyHeight(entry.contentRect.height);
    });
    observer.observe(el);
    setBodyHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  const providerId = getProviderId(selectedProject.provider ?? undefined);
  const providerLabel = getProviderLabel((key, fallback) => t(key, fallback), providerId);
  const count = sessionsTotal ?? sessions.length;

  return (
    <aside
      id="sessions-pane"
      aria-label={t("session.pane.title")}
      className="flex shrink-0 h-full"
    >
      <div
        className="flex flex-col min-w-0 h-full bg-sidebar border-r border-border/50"
        style={{ width }}
      >
        <div className="px-3 py-2.5 border-b border-border/50 flex items-center gap-2 min-w-0">
          <MessageSquare className="w-3.5 h-3.5 text-accent shrink-0" />
          <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground shrink-0">
            {t("session.pane.title")}
          </span>
          <span className="text-xs text-foreground truncate min-w-0" title={selectedProject.actual_path}>
            {selectedProject.name}
          </span>
          <span
            className={cn(
              "px-1.5 py-0.5 text-2xs font-medium rounded-full shrink-0 leading-none",
              getProviderBadgeStyle(providerId),
            )}
          >
            {providerLabel}
          </span>
          <span className="ml-auto text-2xs text-muted-foreground shrink-0 tabular-nums">
            {count}
          </span>
        </div>

        <div ref={bodyRef} className="flex-1 min-h-0">
          <OverlayScrollbarsComponent
            className="h-full"
            options={{ scrollbars: { theme: "os-theme-custom", autoHide: "leave" } }}
          >
            <SessionList
              sessions={sessions}
              sessionsTotal={sessionsTotal}
              hasMoreSessions={hasMoreSessions}
              selectedSession={selectedSession}
              isLoading={isLoading}
              isLoadingMoreSessions={isLoadingMoreSessions}
              onSessionSelect={onSessionSelect}
              onSessionHover={onSessionHover}
              onLoadMoreSessions={onLoadMoreSessions}
              formatTimeAgo={formatTimeAgo}
              variant="pane"
              listHeight={Math.max(200, bodyHeight - LIST_CHROME_HEIGHT)}
            />
          </OverlayScrollbarsComponent>
        </div>
      </div>

      {onResizeStart && (
        <div
          className={cn(
            "w-3 cursor-col-resize flex-shrink-0",
            "hover:bg-accent/20 active:bg-accent/30 transition-colors",
            isResizing && "bg-accent/30",
          )}
          onMouseDown={onResizeStart}
        />
      )}
    </aside>
  );
}
