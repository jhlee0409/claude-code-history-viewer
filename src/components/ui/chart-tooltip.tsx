import React from "react";
import { TooltipContent } from "./tooltip";
import { cn } from "@/lib/utils";

export interface ChartTooltipRow {
  label: string;
  value: string | number;
  color?: string;
}

interface ChartTooltipProps {
  title: string;
  subtitle?: string;
  rows?: ChartTooltipRow[];
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
  children?: React.ReactNode;
}

export const ChartTooltip: React.FC<ChartTooltipProps> = ({
  title,
  subtitle,
  rows,
  side = "top",
  className,
  children,
}) => {
  return (
    <TooltipContent
      side={side}
      className={cn("font-mono text-xs px-3 py-2", className)}
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[12px]">{title}</span>
          {subtitle && (
            <span className="text-primary-foreground/60 font-normal text-[10px]">
              {subtitle}
            </span>
          )}
        </div>
        {rows && rows.length > 0 && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
            {rows.map((row, idx) => (
              <React.Fragment key={`${row.label}-${idx}`}>
                <span className="text-primary-foreground/60">{row.label}</span>
                <span
                  className="text-right font-medium"
                  style={row.color ? { color: row.color } : undefined}
                >
                  {row.value}
                </span>
              </React.Fragment>
            ))}
          </div>
        )}
        {children}
      </div>
    </TooltipContent>
  );
};

ChartTooltip.displayName = "ChartTooltip";
