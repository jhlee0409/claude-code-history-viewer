/**
 * MetricCard Component
 *
 * Displays a single metric with icon, value, trend, and optional sub-value.
 */

import React from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { layout } from "../../renderers";
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
        "group relative overflow-hidden rounded-xl",
        "bg-card/80 backdrop-blur-sm",
        "border border-border/50",
        "transition-all duration-300",
        "hover:border-border hover:shadow-lg"
      )}
    >
      {/* Glow effect on hover */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at 50% 0%, color-mix(in oklch, ${colorVar} 10%, transparent), transparent 70%)`,
          boxShadow: `var(--glow-${colorVariant})`,
        }}
      />

      {/* Top accent line */}
      <div
        className="absolute top-0 left-4 right-4 h-[2px] rounded-b"
        style={{ backgroundColor: colorVar }}
      />

      <div className="relative p-5">
        {/* Header row */}
        <div className="flex items-center justify-between mb-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: `color-mix(in oklch, ${colorVar} 20%, transparent)` }}
          >
            <Icon className="w-5 h-5" style={{ color: colorVar }} />
          </div>
          {trend !== undefined && (
            <div
              className={cn(
                "flex items-center gap-0.5 px-2 py-1 rounded-full font-semibold tracking-wide",
                layout.smallText,
                trend > 0
                  ? "bg-success/15 text-success"
                  : trend < 0
                  ? "bg-destructive/15 text-destructive"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {trend > 0 ? (
                <ArrowUpRight className="w-3 h-3" />
              ) : trend < 0 ? (
                <ArrowDownRight className="w-3 h-3" />
              ) : null}
              {trend > 0 ? "+" : ""}
              {trend}%
            </div>
          )}
        </div>

        {/* Value */}
        <div className="font-mono text-3xl font-bold tracking-tight text-foreground mb-1">
          {value}
        </div>

        {/* Label */}
        <div className={cn(layout.bodyText, "font-medium text-muted-foreground uppercase tracking-wider")}>
          {label}
        </div>

        {/* Sub value */}
        {subValue && (
          <div className={cn("mt-2 text-muted-foreground/70 font-mono", layout.smallText)}>
            {subValue}
          </div>
        )}
      </div>
    </div>
  );
};

MetricCard.displayName = "MetricCard";
