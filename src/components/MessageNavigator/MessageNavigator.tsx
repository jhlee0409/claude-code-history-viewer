import React, { useRef, useCallback, useState, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { ListTree, Search, X, PanelRightClose, PanelRight, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClaudeMessage } from "../../types";
import { useAppStore } from "../../store/useAppStore";
import { NavigatorEntry } from "./NavigatorEntry";
import { useNavigatorEntries } from "./useNavigatorEntries";

// Height estimation constants for virtual scrolling
const ESTIMATED_CHARS_PER_LINE = 40; // Conservative estimate for small text
const BASE_ENTRY_HEIGHT = 34; // py-2 (16px) + header row (~16px) + mb-0.5 (2px)
const PREVIEW_LINE_HEIGHT = 20; // Approximate height of one text line with line-height

interface MessageNavigatorProps {
  messages: ClaudeMessage[];
  width: number;
  isResizing: boolean;
  onResizeStart: (e: React.MouseEvent<HTMLElement>) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const MessageNavigator: React.FC<MessageNavigatorProps> = ({
  messages,
  width,
  isResizing,
  onResizeStart,
  isCollapsed,
  onToggleCollapse,
}) => {
  const { t } = useTranslation();
  const scrollElementRef = useRef<HTMLDivElement>(null);
  const [filterText, setFilterText] = useState("");
  const [userOnly, setUserOnly] = useState(false);

  const { navigateToMessage, targetMessageUuid } = useAppStore();

  // Transform messages to navigator entries
  const allEntries = useNavigatorEntries(messages);

  // Apply local filter
  const entries = useMemo(() => {
    let filtered = allEntries;
    if (userOnly) {
      filtered = filtered.filter((e) => e.role === "user");
    }
    if (filterText.trim()) {
      const lower = filterText.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.preview.toLowerCase().includes(lower) ||
          e.role.toLowerCase().includes(lower)
      );
    }
    return filtered;
  }, [allEntries, filterText, userOnly]);

  // Height estimation function for @tanstack/react-virtual
  const estimateSize = useCallback((index: number) => {
    const entry = entries[index];
    if (!entry) return 60;

    // Heuristic: estimate number of preview lines based on text length,
    // clamped to the max of 2 lines (due to line-clamp-2).
    const previewLength = entry.preview?.length ?? 0;
    const estimatedLines = Math.min(
      2,
      Math.max(1, Math.ceil(previewLength / ESTIMATED_CHARS_PER_LINE))
    );

    return BASE_ENTRY_HEIGHT + estimatedLines * PREVIEW_LINE_HEIGHT;
  }, [entries]);

  // Initialize virtualizer
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize,
    overscan: 5,
  });

  const handleEntryClick = useCallback(
    (uuid: string) => {
      navigateToMessage(uuid);
    },
    [navigateToMessage]
  );

  // Get virtual items
  const virtualItems = virtualizer.getVirtualItems();

  // Collapsed view
  if (isCollapsed) {
    return (
      <aside
        role="complementary"
        aria-label={t("navigator.title")}
        className={cn(
          "flex-shrink-0 bg-sidebar border-l border-border/50 flex h-full",
          isResizing && "select-none"
        )}
        style={{ width: "48px" }}
      >
        <div className="flex-1 flex flex-col items-center py-3 gap-2 relative">
          {/* Left accent border */}
          <div className="absolute left-0 inset-y-0 w-[2px] bg-gradient-to-b from-accent/40 via-accent/60 to-accent/40" />

          {/* Expand Button */}
          <button
            onClick={onToggleCollapse}
            className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center",
              "bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
            )}
            title={t("navigator.toggle")}
            aria-label={t("navigator.toggle")}
          >
            <PanelRight className="w-4 h-4" />
          </button>

          <div className="w-6 h-px bg-accent/20" />

          {/* Navigator icon */}
          <ListTree className="w-4 h-4 text-muted-foreground" />

          {/* Entry count */}
          <span className="text-2xs font-mono text-muted-foreground">{allEntries.length}</span>
        </div>
      </aside>
    );
  }

  // Expanded view
  return (
    <aside
      role="complementary"
      aria-label={t("navigator.title")}
      className={cn(
        "relative flex flex-col bg-sidebar border-l border-border/50 h-full",
        isResizing && "select-none"
      )}
      style={{ width, minWidth: width, maxWidth: width }}
    >
      {/* Resize handle (left edge) */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/30 active:bg-accent/50 z-10"
        onMouseDown={onResizeStart}
      />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 shrink-0">
        <ListTree className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground flex-1">
          {t("navigator.title")}
        </span>
        <span className="text-2xs text-muted-foreground tabular-nums">
          {entries.length}
        </span>
        <button
          onClick={() => setUserOnly((prev) => !prev)}
          className={cn(
            "p-0.5 rounded transition-colors",
            userOnly
              ? "bg-blue-500/20 text-blue-500"
              : "hover:bg-accent/10 text-muted-foreground hover:text-foreground"
          )}
          aria-label={t("navigator.userOnly", "Show user messages only")}
          title={t("navigator.userOnly", "Show user messages only")}
        >
          <User className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onToggleCollapse}
          className="p-0.5 rounded hover:bg-accent/10 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={t("navigator.toggle")}
        >
          <PanelRightClose className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Filter input */}
      <div className="px-2 py-1.5 border-b border-border/30 shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" />
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder={t("navigator.filter")}
            aria-label={t("navigator.filter")}
            className="w-full pl-6 pr-2 py-1 text-xs bg-muted/30 border border-border/30 rounded focus:outline-none focus:ring-1 focus:ring-accent/40 placeholder:text-muted-foreground/40"
          />
          {filterText && (
            <button
              onClick={() => setFilterText("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-accent/10"
              aria-label={t("common.cancel")}
            >
              <X className="w-2.5 h-2.5 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Entry list with virtual scrolling */}
      {entries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-xs text-muted-foreground text-center">
            {filterText ? t("messageViewer.noSearchResults") : t("navigator.noMessages")}
          </p>
        </div>
      ) : (
        <div
          ref={scrollElementRef}
          className="flex-1 overflow-auto"
          style={{ contain: "strict" }}
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualItems.map((virtualItem) => {
              const entry = entries[virtualItem.index];
              if (!entry) return null;

              return (
                <NavigatorEntry
                  key={entry.uuid}
                  entry={entry}
                  isActive={entry.uuid === targetMessageUuid}
                  onClick={handleEntryClick}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                />
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
};
