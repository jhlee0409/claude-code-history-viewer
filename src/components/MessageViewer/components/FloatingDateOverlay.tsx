/**
 * FloatingDateOverlay Component
 *
 * Displays the current date as a floating header at the top of the
 * message viewport, mimicking sticky date headers in chat apps.
 *
 * Since @tanstack/react-virtual uses position: absolute for rows,
 * CSS sticky doesn't work. Instead, we track the first visible
 * virtual item and derive the current date from it.
 */

import React, { useMemo, useState, useEffect, useRef } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { formatDateDivider } from "../../../utils/time";
import type { FlattenedMessage } from "../types";

type FloatingDateOverlayProps = {
  virtualRows: VirtualItem[];
  flattenedMessages: FlattenedMessage[];
};

/** How long (ms) after scrolling stops before the overlay fades out. */
const FADE_OUT_DELAY_MS = 1500;

/**
 * Find the current date label based on the first visible virtual row.
 * Walks backward from the first visible item to find the nearest date-divider
 * or message with a timestamp.
 */
function resolveCurrentDate(
  firstVisibleIndex: number,
  flattenedMessages: FlattenedMessage[],
): string | null {
  // Walk backward from first visible item to find the applicable date
  for (let i = firstVisibleIndex; i >= 0; i--) {
    const item = flattenedMessages[i];
    if (!item) continue;

    if (item.type === "date-divider") {
      return item.timestamp;
    }

    if (item.type === "message" && item.message.timestamp) {
      return item.message.timestamp;
    }
  }

  return null;
}

export const FloatingDateOverlay: React.FC<FloatingDateOverlayProps> = React.memo(
  ({ virtualRows, flattenedMessages }) => {
    const [isVisible, setIsVisible] = useState(true);
    const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const prevIndexRef = useRef<number>(-1);

    // Derive first visible index
    const firstVisibleIndex = virtualRows.length > 0 ? virtualRows[0]!.index : -1;

    // Resolve the current date label
    const currentTimestamp = useMemo(
      () => {
        if (firstVisibleIndex < 0) return null;
        return resolveCurrentDate(firstVisibleIndex, flattenedMessages);
      },
      [firstVisibleIndex, flattenedMessages],
    );

    const dateLabel = useMemo(
      () => (currentTimestamp ? formatDateDivider(currentTimestamp) : null),
      [currentTimestamp],
    );

    // Show overlay when scroll position changes, fade out after delay
    useEffect(() => {
      if (firstVisibleIndex < 0) return;

      // Only react to actual scroll position changes
      if (prevIndexRef.current === firstVisibleIndex) return;
      prevIndexRef.current = firstVisibleIndex;

      setIsVisible(true);

      // Clear existing timer
      if (fadeTimerRef.current != null) {
        clearTimeout(fadeTimerRef.current);
      }

      // Schedule fade out
      fadeTimerRef.current = setTimeout(() => {
        setIsVisible(false);
      }, FADE_OUT_DELAY_MS);

      return () => {
        if (fadeTimerRef.current != null) {
          clearTimeout(fadeTimerRef.current);
        }
      };
    }, [firstVisibleIndex]);

    if (!dateLabel) return null;

    return (
      <div
        className={cn(
          "absolute top-2 left-1/2 -translate-x-1/2 z-20",
          "px-3 py-1 rounded-full",
          "bg-popover/90 backdrop-blur-sm",
          "border border-border/50 shadow-sm",
          "text-[11px] font-medium text-muted-foreground",
          "transition-opacity duration-300",
          "pointer-events-none select-none",
          isVisible ? "opacity-100" : "opacity-0",
        )}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {dateLabel}
      </div>
    );
  },
);

FloatingDateOverlay.displayName = "FloatingDateOverlay";
