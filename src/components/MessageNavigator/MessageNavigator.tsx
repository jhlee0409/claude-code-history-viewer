import React, { useRef, useCallback, useState, useMemo, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { Indent, ListTree, Search, X, PanelRightClose, PanelRight, User, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClaudeMessage } from "../../types";
import { useAppStore } from "../../store/useAppStore";
import {
  filterMessagesByCategory,
  getMessageUuidsByCategory,
} from "../MessageViewer/helpers";
import { getPromptJumpKeysLabel } from "../MessageViewer/helpers/promptJump";
import { getFilteredClassifiedMessages } from "./classifiedRows";
import { getKindLabelKey } from "./kindLabels";
import { NavigatorEntry } from "./NavigatorEntry";
import { findTurnKeyForUuid } from "./outline/flattenOutline";
import { NavigatorOutline } from "./outline/NavigatorOutline";
import { buildTurnOfMessage } from "./outline/turnOfMessage";
import { useOutlineTurns } from "./outline/useOutlineTurns";

// Height estimation constants for virtual scrolling
const ESTIMATED_CHARS_PER_LINE = 40; // Conservative estimate for small text
const BASE_ENTRY_HEIGHT = 34; // py-2 (16px) + header row (~16px) + mb-0.5 (2px)
const PREVIEW_LINE_HEIGHT = 20; // Approximate height of one text line with line-height

/** List mode never reads the message-to-turn map, so it skips building one. */
const EMPTY_TURN_MAP: ReadonlyMap<string, string | null> = new Map();

interface MessageNavigatorProps {
  messages: ClaudeMessage[];
  width?: number;
  isResizing: boolean;
  onResizeStart: (e: React.MouseEvent<HTMLElement>) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  asideId?: string;
}

export const MessageNavigator: React.FC<MessageNavigatorProps> = ({
  messages,
  width,
  isResizing,
  onResizeStart,
  isCollapsed,
  onToggleCollapse,
  asideId = "message-navigator",
}) => {
  const { t } = useTranslation();
  const keyboardHelpId = `${asideId}-keyboard-help`;
  // The shortcut acts on the message list, so the panel only describes it.
  const promptJumpHint = t("navigator.promptJumpHint", { keys: getPromptJumpKeysLabel() });
  const scrollElementRef = useRef<HTMLDivElement>(null);
  const entryRefs = useRef(new Map<string, HTMLButtonElement>());
  const [filterText, setFilterText] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(0);

  const {
    navigateToMessage,
    targetMessageUuid,
    userOnlyFilter,
    toggleUserOnlyFilter,
    showParallelTasksInNavigator,
    toggleShowParallelTasksInNavigator,
    navigatorViewMode,
    toggleNavigatorViewMode,
    visibleMessageUuid,
    selectedSession,
  } = useAppStore();
  // Selectors (not the destructure above) so a store mock missing these
  // fields - like the accessibility test's - still renders list mode
  // instead of throwing.
  const pagination = useAppStore((s) => s.pagination);
  const hasParallelTasks = useMemo(
    () => getMessageUuidsByCategory(messages, "parallel-task").size > 0,
    [messages],
  );

  // Transform messages to navigator entries
  const navigatorMessages = useMemo(
    () => filterMessagesByCategory(
      messages,
      "parallel-task",
      showParallelTasksInNavigator,
    ),
    [messages, showParallelTasksInNavigator],
  );

  // One shared, filtered, classified row list feeds both the flat list's
  // entries and the outline's turns, so the noise-filter rule cannot drift
  // between the two (Design, "A shared, filtered, classified row list").
  const classifiedRows = useMemo(
    () => getFilteredClassifiedMessages(navigatorMessages),
    [navigatorMessages],
  );
  const allEntries = useMemo(() => classifiedRows.map((row) => row.entry), [classifiedRows]);
  const turns = useOutlineTurns(classifiedRows);
  const realTurnsCount = useMemo(
    () => turns.filter((turn) => turn.turnStartUuid !== null).length,
    [turns],
  );

  // Apply local filter (kind label + text), matching what each row displays
  const entries = useMemo(() => {
    let filtered = allEntries;
    if (userOnlyFilter) {
      // Rows the user typed: prompts and slash commands, not agent updates
      // or injected context that Claude Code also stores as user messages.
      filtered = filtered.filter((e) => e.kind === "prompt" || e.kind === "command");
    }
    const lower = filterText.trim().toLowerCase();
    if (lower) {
      filtered = filtered.filter(
        (e) =>
          e.preview.toLowerCase().includes(lower) ||
          t(getKindLabelKey(e.kind)).toLowerCase().includes(lower)
      );
    }
    return filtered;
  }, [allEntries, filterText, userOnlyFilter, t]);

  // Outline mode, and whether it is actually RENDERED right now: a
  // non-empty filter falls back to the flat list even in outline mode
  // (Design, "Free-text filter in outline mode").
  const isOutline = navigatorViewMode === "outline";
  const isOutlineRendered = isOutline && filterText.trim().length === 0;

  // Open/closed turn keys: local, unpersisted state so the person button can
  // clear it (State). A session change closes every turn; opening a turn
  // never closes another, so pagination prepends keep what the user opened.
  const sessionId = selectedSession?.session_id;
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());
  // The session and target the open-turn effect last acted on.
  const openedForRef = useRef<{ sessionId: string | undefined; target: string | null } | null>(null);
  useEffect(() => {
    setOpenKeys(new Set());
    openedForRef.current = null;
  }, [sessionId]);
  useEffect(() => {
    // Messages load after the session is selected, so wait for turns.
    if (turns.length === 0) return;
    const target = targetMessageUuid ?? null;
    const handled = openedForRef.current;
    const isFirstLoad = handled === null || handled.sessionId !== sessionId;
    if (!isFirstLoad && handled.target === target) return;
    const key = findTurnKeyForUuid(turns, target);
    // A target on a page that has not loaded yet: try again when it arrives.
    if (target !== null && key === null) return;
    openedForRef.current = { sessionId, target };
    if (key === null) return;
    // First load opens the target's turn (State). After that, only a target
    // hidden inside a closed turn opens it; a header target (the prompt jump
    // lands on these) is already visible, and opening it would expand every
    // turn the reader jumps through.
    const targetIsHeader = turns.some((turn) => turn.turnStartUuid === target);
    if (!isFirstLoad && targetIsHeader) return;
    setOpenKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, [turns, targetMessageUuid, sessionId]);

  // The turn containing the message currently visible in the main
  // transcript, for the outline's active-header highlight (Design,
  // "Highlighting the turn in view"). Built from the RAW `messages` prop,
  // not `navigatorMessages`, so a hidden/noise row still resolves.
  const turnOfMessage = useMemo(
    () => (isOutline ? buildTurnOfMessage(messages, turns) : EMPTY_TURN_MAP),
    [isOutline, messages, turns],
  );
  const activeTurnKey =
    visibleMessageUuid != null ? turnOfMessage.get(visibleMessageUuid) ?? null : null;

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

  useEffect(() => {
    if (entries.length === 0) {
      setFocusedIndex(0);
      return;
    }

    if (targetMessageUuid) {
      const selectedIndex = entries.findIndex((entry) => entry.uuid === targetMessageUuid);
      if (selectedIndex >= 0) {
        setFocusedIndex(selectedIndex);
        return;
      }
    }

    setFocusedIndex((prev) => Math.max(0, Math.min(prev, entries.length - 1)));
  }, [entries, targetMessageUuid]);

  const focusEntryAt = useCallback((index: number) => {
    const clampedIndex = Math.max(0, Math.min(index, entries.length - 1));
    const entry = entries[clampedIndex];
    if (!entry) return;

    setFocusedIndex(clampedIndex);
    virtualizer.scrollToIndex(clampedIndex, { align: "auto" });

    requestAnimationFrame(() => {
      entryRefs.current.get(entry.uuid)?.focus();
    });
  }, [entries, virtualizer]);

  const handleEntryKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    // Alt+Arrow belongs to the message list's prompt jump (usePromptJump).
    if (entries.length === 0 || event.altKey) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusEntryAt(focusedIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusEntryAt(focusedIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        focusEntryAt(0);
        break;
      case "End":
        event.preventDefault();
        focusEntryAt(entries.length - 1);
        break;
      case "Enter":
      case " ":
        if (entries[focusedIndex]) {
          event.preventDefault();
          navigateToMessage(entries[focusedIndex].uuid);
        }
        break;
      default:
        break;
    }
  }, [entries, focusEntryAt, focusedIndex, navigateToMessage]);

  // In outline mode the person button closes every open turn as a one-time
  // action instead of filtering rows (Design, "Person button... in outline
  // mode"); it never reopens anything. It closes on every click, not only
  // when the shared boolean turns on, so "Close all turns" always does what
  // its name says even if list mode left the boolean on.
  const handlePersonButtonClick = useCallback(() => {
    if (isOutlineRendered) {
      setOpenKeys(new Set());
    }
    toggleUserOnlyFilter();
  }, [isOutlineRendered, toggleUserOnlyFilter]);

  // Get virtual items
  const virtualItems = virtualizer.getVirtualItems();

  // Collapsed view
  if (isCollapsed) {
    return (
      <aside
        id={asideId}
        role="complementary"
        aria-label={t("navigator.title")}
        tabIndex={-1}
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
      id={asideId}
      role="complementary"
      aria-label={t("navigator.title")}
      aria-describedby={keyboardHelpId}
      tabIndex={-1}
      className={cn(
        "relative flex flex-col bg-sidebar border-l border-border/50 h-full",
        isResizing && "select-none",
        width == null && "w-full"
      )}
      style={width != null ? { width, minWidth: width, maxWidth: width } : undefined}
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
          {isOutlineRendered ? realTurnsCount : entries.length}
        </span>
        <button
          onClick={toggleNavigatorViewMode}
          className={cn(
            "p-0.5 rounded transition-colors",
            isOutline
              ? "bg-accent/20 text-accent"
              : "hover:bg-accent/10 text-muted-foreground hover:text-foreground"
          )}
          aria-label={t("navigator.viewMode.outline")}
          aria-pressed={isOutline}
          title={t("navigator.viewMode.toggle")}
        >
          <Indent className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handlePersonButtonClick}
          className={cn(
            "p-0.5 rounded transition-colors",
            userOnlyFilter
              ? "bg-blue-500/20 text-blue-500"
              : "hover:bg-accent/10 text-muted-foreground hover:text-foreground"
          )}
          aria-label={isOutlineRendered ? t("navigator.outline.closeAllTurns") : t("navigator.userOnly")}
          aria-pressed={userOnlyFilter}
          title={`${isOutlineRendered ? t("navigator.outline.closeAllTurns") : t("navigator.userOnly")}\n${promptJumpHint}`}
        >
          <User className="w-3.5 h-3.5" />
        </button>
        {hasParallelTasks && (
          <button
            onClick={toggleShowParallelTasksInNavigator}
            className={cn(
              "p-0.5 rounded transition-colors",
              showParallelTasksInNavigator
                ? "bg-tool-task/20 text-tool-task"
                : "hover:bg-accent/10 text-muted-foreground hover:text-foreground"
            )}
            aria-label={t("navigator.showParallelTasks")}
            aria-pressed={showParallelTasksInNavigator}
            title={t("navigator.showParallelTasks")}
          >
            <Zap className="w-3.5 h-3.5" />
          </button>
        )}
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
      {isOutlineRendered ? (
        <NavigatorOutline
          turns={turns}
          openKeys={openKeys}
          setOpenKeys={setOpenKeys}
          activeTurnKey={activeTurnKey}
          targetMessageUuid={targetMessageUuid ?? null}
          hasMore={pagination?.hasMore ?? false}
          totalTurns={realTurnsCount}
          navigateToMessage={navigateToMessage}
          keyboardHelpId={keyboardHelpId}
        />
      ) : entries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-xs text-muted-foreground text-center">
            {filterText ? t("messageViewer.noSearchResults") : t("navigator.noMessages")}
          </p>
        </div>
      ) : (
        <div
          ref={scrollElementRef}
          role="listbox"
          aria-label={t("navigator.title")}
          aria-describedby={keyboardHelpId}
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
                  isFocused={virtualItem.index === focusedIndex}
                  onClick={handleEntryClick}
                  onFocus={() => setFocusedIndex(virtualItem.index)}
                  onNavigate={handleEntryKeyDown}
                  registerRef={(element) => {
                    if (element) {
                      entryRefs.current.set(entry.uuid, element);
                    } else {
                      entryRefs.current.delete(entry.uuid);
                    }
                  }}
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

      <p id={keyboardHelpId} className="sr-only">
        {t(
          "navigator.a11y.keyboardHelp",
          "Keyboard: use arrow keys to move between messages, Home and End to jump, and Enter or Space to open the focused message."
        )}{" "}
        {promptJumpHint}
      </p>
    </aside>
  );
};
