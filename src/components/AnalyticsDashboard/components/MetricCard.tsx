/**
 * MetricCard Component
 *
 * Clean metric card with accent border and clear hierarchy.
 */

import React from "react";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MetricCardProps } from "../types";

export const MetricCard: React.FC<MetricCardProps> = ({
  icon: Icon,
  label,
  value,
  subValue,
  trend,
  colorVariant,
}) => {
  const colorVar = `var(--metric-${colorVariant})`;

  return (
    <div
      className={cn(
        "group relative overflow-hidden",
        "rounded-lg",
        "bg-card/80 backdrop-blur-sm",
        "border border-border/40",
        "transition-all duration-300",
        "hover:bg-card hover:border-border/60"
      )}
    >
      <div className="relative p-5 flex flex-col h-full">
        {/* Top row: Icon + Trend */}
        <div className="flex items-start justify-between mb-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{
              background: `color-mix(in oklch, ${colorVar} 15%, transparent)`,
            }}
          >
            <Icon className="w-5 h-5" style={{ color: colorVar }} />
          </div>

          {/* Trend indicator */}
          {trend !== undefined && (
            <div
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold",
                trend > 0
                  ? "bg-success/10 text-success"
                  : trend < 0
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground"
              )}
            >
              {trend > 0 ? (
                <ArrowUpRight className="w-3 h-3" />
              ) : trend < 0 ? (
                <ArrowDownRight className="w-3 h-3" />
              ) : (
                <Minus className="w-3 h-3" />
              )}
              <span>{Math.abs(trend)}%</span>
            </div>
          )}
        </div>

        {/* Value */}
        <div className="font-mono text-3xl font-bold tracking-tight text-foreground mb-1 tabular-nums">
          {value}
        </div>

        {/* Label */}
        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-auto">
          {label}
        </div>

        {/* Sub value */}
        {subValue && (
          <div className="mt-3 pt-3 border-t border-border/30">
            <div className="font-mono text-[11px] text-muted-foreground/70">
              {subValue}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

MetricCard.displayName = "MetricCard";
