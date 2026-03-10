/**
 * DateDivider Component
 *
 * Inline date separator shown between messages when the date changes.
 * Displays "Today", "Yesterday", or full date (e.g., "Friday, June 27, 2025").
 */

import React from "react";
import { cn } from "@/lib/utils";
import { formatDateDivider } from "../../../utils/time";

type DateDividerProps = {
  timestamp: string;
};

export const DateDivider: React.FC<DateDividerProps> = React.memo(
  ({ timestamp }) => {
    const label = formatDateDivider(timestamp);

    return (
      <div
        className={cn(
          "flex items-center justify-center py-1.5",
          "select-none pointer-events-none"
        )}
        role="separator"
        aria-label={label}
      >
        <div className="flex-1 h-px bg-border/40" />
        <span
          className={cn(
            "px-3 text-[11px] font-medium",
            "text-muted-foreground/70"
          )}
        >
          {label}
        </span>
        <div className="flex-1 h-px bg-border/40" />
      </div>
    );
  }
);

DateDivider.displayName = "DateDivider";
