import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { NavigatorEntry } from "../NavigatorEntry";
import { flattenOutlineRows } from "./flattenOutline";
import { findPinnedTurnKey } from "./pinnedTurn";
import { OutlineTaskRow } from "./OutlineTaskRow";
import { OutlineTurnHeader } from "./OutlineTurnHeader";
import { PinnedTurnHeader } from "./PinnedTurnHeader";
import type { TurnGroup } from "./types";

interface NavigatorOutlineProps {
  turns: TurnGroup[];
  openKeys: ReadonlySet<string>;
  setOpenKeys: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** The real turn's key (its turnStartUuid) whose header should show the active-turn styling, or null. */
  activeTurnKey: string | null;
  targetMessageUuid: string | null;
  hasMore: boolean;
  /** Number of real turns in the loaded window, for "Prompt {{n}} of {{total}}". */
  totalTurns: number;
  navigateToMessage: (uuid: string) => void;
  keyboardHelpId: string;
}

/**
 * The outline's own virtualized tree, mounted only in outline mode so list
 * mode's virtualizer in `MessageNavigator.tsx` is never touched. Owns its
 * own roving-focus index; `openKeys` is lifted to `MessageNavigator` so the
 * person button can clear it (Design, "Person button... in outline mode").
 */
export const NavigatorOutline: React.FC<NavigatorOutlineProps> = ({
  turns,
  openKeys,
  setOpenKeys,
  activeTurnKey,
  targetMessageUuid,
  hasMore,
  totalTurns,
  navigateToMessage,
  keyboardHelpId,
}) => {
  const { t } = useTranslation();
  const scrollElementRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const [focusedIndex, setFocusedIndex] = useState(0);
  // Tracks the target uuid this focus index was last synced to, so a
  // row-count change from opening/closing a turn (which changes `rows`
  // without changing the target) only clamps the index instead of
  // re-jumping focus back to the target (Build order step 9, "Keep focus
  // index valid when rows open/close").
  const lastTargetRef = useRef<string | null>(null);

  const rows = useMemo(() => flattenOutlineRows(turns, openKeys), [turns, openKeys]);

  useEffect(() => {
    if (rows.length === 0) {
      setFocusedIndex(0);
      return;
    }
    if (targetMessageUuid && targetMessageUuid !== lastTargetRef.current) {
      const index = rows.findIndex((row) => row.key === targetMessageUuid);
      if (index >= 0) {
        lastTargetRef.current = targetMessageUuid;
        setFocusedIndex(index);
        return;
      }
    }
    lastTargetRef.current = targetMessageUuid;
    setFocusedIndex((prev) => Math.max(0, Math.min(prev, rows.length - 1)));
  }, [rows, targetMessageUuid]);

  const estimateSize = useCallback(
    (index: number) => {
      const row = rows[index];
      if (!row) return 60;
      if (row.type === "turn") {
        let height = 34;
        if (row.turn.header) height += 36;
        const { counts } = row.turn;
        if (
          counts.replies > 0 ||
          counts.toolCalls > 0 ||
          counts.agentsStarted > 0 ||
          counts.agentUpdates > 0
        ) {
          height += 22;
        }
        return height;
      }
      return row.child.type === "task" ? 56 : 60;
    },
    [rows],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize,
    overscan: 5,
    getItemKey: (index) => rows[index]?.key ?? index,
  });

  const setTurnOpen = useCallback(
    (key: string, open: boolean) => {
      setOpenKeys((prev) => {
        if (prev.has(key) === open) return prev;
        const next = new Set(prev);
        if (open) next.add(key);
        else next.delete(key);
        return next;
      });
    },
    [setOpenKeys],
  );

  const toggleTurnOpen = useCallback(
    (key: string) => {
      setOpenKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [setOpenKeys],
  );

  const activateHeader = useCallback(
    (turn: TurnGroup) => {
      if (turn.turnStartUuid) navigateToMessage(turn.turnStartUuid);
      toggleTurnOpen(turn.key);
    },
    [navigateToMessage, toggleTurnOpen],
  );

  const focusRowAt = useCallback(
    (index: number) => {
      if (rows.length === 0) return;
      const clamped = Math.max(0, Math.min(index, rows.length - 1));
      const row = rows[clamped];
      if (!row) return;
      setFocusedIndex(clamped);
      virtualizer.scrollToIndex(clamped, { align: "auto" });
      requestAnimationFrame(() => {
        rowRefs.current.get(row.key)?.focus();
      });
    },
    [rows, virtualizer],
  );

  const handleRowKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      // Alt+Arrow belongs to the message list's prompt jump (usePromptJump),
      // which ignores any event already defaultPrevented. Returning before
      // any preventDefault keeps it working from an outline row too
      // (Verified constraints, "Keyboard ownership of Alt+Arrow").
      if (event.altKey) return;
      if (rows.length === 0) return;
      const row = rows[focusedIndex];
      if (!row) return;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          focusRowAt(focusedIndex + 1);
          break;
        case "ArrowUp":
          event.preventDefault();
          focusRowAt(focusedIndex - 1);
          break;
        case "Home":
          event.preventDefault();
          focusRowAt(0);
          break;
        case "End":
          event.preventDefault();
          focusRowAt(rows.length - 1);
          break;
        case "ArrowRight":
          event.preventDefault();
          if (row.type === "turn") {
            if (!row.isOpen) {
              setTurnOpen(row.key, true);
            } else {
              const next = rows[focusedIndex + 1];
              if (next && next.type === "child" && next.turnKey === row.key) {
                focusRowAt(focusedIndex + 1);
              }
            }
          }
          break;
        case "ArrowLeft":
          event.preventDefault();
          if (row.type === "turn") {
            if (row.isOpen) setTurnOpen(row.key, false);
          } else {
            const parentIndex = rows.findIndex(
              (candidate) => candidate.type === "turn" && candidate.key === row.turnKey,
            );
            if (parentIndex >= 0) focusRowAt(parentIndex);
          }
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          if (row.type === "turn") {
            activateHeader(row.turn);
          } else if (row.child.type === "message") {
            navigateToMessage(row.child.entry.uuid);
          } else {
            navigateToMessage(row.child.navigateUuid);
          }
          break;
        default:
          break;
      }
    },
    [rows, focusedIndex, focusRowAt, setTurnOpen, activateHeader, navigateToMessage],
  );

  const virtualItems = virtualizer.getVirtualItems();
  // Read directly at render time rather than via a scroll-state effect: the
  // virtualizer already re-renders this component on scroll (Design, "Pinned
  // turn header" — "the virtualizer re-renders on scroll").
  const scrollTop = scrollElementRef.current?.scrollTop ?? 0;
  const pinnedTurnKey = findPinnedTurnKey(rows, virtualItems, scrollTop);
  const pinnedTurn = pinnedTurnKey ? turns.find((turn) => turn.key === pinnedTurnKey) ?? null : null;

  if (rows.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-xs text-muted-foreground text-center">{t("navigator.noMessages")}</p>
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0">
      {pinnedTurn && (
        <PinnedTurnHeader
          turn={pinnedTurn}
          hasMore={hasMore}
          totalTurns={totalTurns}
          onClick={() => navigateToMessage(pinnedTurn.turnStartUuid ?? pinnedTurn.firstUuid)}
        />
      )}
      <div
        ref={scrollElementRef}
        role="tree"
        aria-label={t("navigator.title")}
        aria-describedby={keyboardHelpId}
        className="h-full overflow-auto"
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
            const row = rows[virtualItem.index];
            if (!row) return null;

            const commonStyle: React.CSSProperties = {
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualItem.start}px)`,
            };
            const registerRef = (element: HTMLButtonElement | null) => {
              if (element) rowRefs.current.set(row.key, element);
              else rowRefs.current.delete(row.key);
              virtualizer.measureElement(element);
            };
            const isFocused = virtualItem.index === focusedIndex;

            if (row.type === "turn") {
              return (
                <OutlineTurnHeader
                  key={row.key}
                  turn={row.turn}
                  isOpen={row.isOpen}
                  isActive={row.key === activeTurnKey}
                  isFocused={isFocused}
                  hasMore={hasMore}
                  totalTurns={totalTurns}
                  onActivate={() => activateHeader(row.turn)}
                  onFocus={() => setFocusedIndex(virtualItem.index)}
                  onKeyDown={handleRowKeyDown}
                  registerRef={registerRef}
                  style={commonStyle}
                  dataIndex={virtualItem.index}
                  ariaPosInSet={row.posInSet}
                  ariaSetSize={row.setSize}
                />
              );
            }

            if (row.child.type === "task") {
              const task = row.child;
              return (
                <OutlineTaskRow
                  key={row.key}
                  task={task}
                  isFocused={isFocused}
                  onActivate={() => navigateToMessage(task.navigateUuid)}
                  onFocus={() => setFocusedIndex(virtualItem.index)}
                  onKeyDown={handleRowKeyDown}
                  registerRef={registerRef}
                  style={commonStyle}
                  dataIndex={virtualItem.index}
                  ariaPosInSet={row.posInSet}
                  ariaSetSize={row.setSize}
                />
              );
            }

            return (
              <NavigatorEntry
                key={row.key}
                entry={row.child.entry}
                isActive={row.child.entry.uuid === targetMessageUuid}
                isFocused={isFocused}
                onClick={navigateToMessage}
                onFocus={() => setFocusedIndex(virtualItem.index)}
                onNavigate={handleRowKeyDown}
                registerRef={registerRef}
                style={commonStyle}
                itemRole="treeitem"
                ariaLevel={2}
                ariaPosInSet={row.posInSet}
                ariaSetSize={row.setSize}
                dataIndex={virtualItem.index}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};
