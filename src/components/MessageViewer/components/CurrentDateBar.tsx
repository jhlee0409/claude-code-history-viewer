/**
 * CurrentDateBar Component
 *
 * The date of the first visible message, in its own row above the message
 * list (the sticky date header of chat apps). It takes layout space instead
 * of floating over the list, so it never covers message text.
 *
 * @tanstack/react-virtual positions rows absolutely, so CSS sticky does not
 * work; the label is derived from the first visible virtual item instead.
 * The rendered rows include overscan above the viewport, so "first visible"
 * is the first row that ends below the scroll offset, not the first row.
 */

import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { VirtualItem } from "@tanstack/react-virtual";
import { formatDateDivider } from "../../../utils/time";
import { findFirstVisibleRowIndex } from "../helpers/visibleMessage";
import type { FlattenedMessage } from "../types";

type CurrentDateBarProps = {
  virtualRows: VirtualItem[];
  /** The virtualizer's scroll offset, in the same coordinates as `row.start`. */
  scrollOffset: number;
  flattenedMessages: FlattenedMessage[];
};

/**
 * Find the current date based on the first visible virtual row: walk back
 * from it to the nearest date divider or message with a timestamp.
 */
function resolveCurrentDate(
  firstVisibleIndex: number,
  flattenedMessages: FlattenedMessage[],
): string | null {
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

export const CurrentDateBar: React.FC<CurrentDateBarProps> = React.memo(
  ({ virtualRows, scrollOffset, flattenedMessages }) => {
    const firstVisibleIndex = findFirstVisibleRowIndex(virtualRows, scrollOffset);
    // Subscribed so a language switch re-renders and re-formats the label.
    const { i18n } = useTranslation();
    const language = i18n.language;

    const dateLabel = useMemo(() => {
      if (firstVisibleIndex < 0) return null;
      const timestamp = resolveCurrentDate(firstVisibleIndex, flattenedMessages);
      return timestamp ? formatDateDivider(timestamp, language) : null;
    }, [firstVisibleIndex, flattenedMessages, language]);

    // The row keeps its height while the label is still unknown, so the list
    // below does not jump when the first rows are measured.
    return (
      <div
        data-current-date
        className="shrink-0 h-7 flex items-center justify-center px-4 border-b border-border/40 bg-card/60 select-none"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="truncate text-caption font-medium text-muted-foreground">
          {dateLabel ?? ""}
        </span>
      </div>
    );
  },
);

CurrentDateBar.displayName = "CurrentDateBar";
