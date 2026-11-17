/**
 * DateDivider Component
 *
 * Inline date separator shown between messages when the date changes.
 * Displays "Today", "Yesterday", or full date (e.g., "Friday, June 27, 2025").
 */

import React from "react";
import { cn } from "@/lib/utils";
import { useFormat } from "@/lib/format/useFormat";
import { Num } from "@/lib/format/Num";

type DateDividerProps = {
  timestamp: string;
};

export const DateDivider: React.FC<DateDividerProps> = React.memo(
  ({ timestamp }) => {
    const fmt = useFormat();
    const label = fmt.dateDivider(timestamp);

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
            "px-3 text-caption font-medium",
            "text-muted-foreground/70"
          )}
        >
          <Num>{label}</Num>
        </span>
        <div className="flex-1 h-px bg-border/40" />
      </div>
    );
  }
);

DateDivider.displayName = "DateDivider";
