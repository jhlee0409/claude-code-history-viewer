/**
 * MetricCard Component
 *
 * Clean metric card with accent border and clear hierarchy.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GrowthTrend, MetricCardProps } from "../types";

type TrendDirection = "up" | "down" | "flat";

const DIRECTION_STYLE: Record<TrendDirection, { className: string; Icon: React.ElementType }> = {
  up: { className: "bg-success/10 text-success", Icon: ArrowUpRight },
  down: { className: "bg-destructive/10 text-destructive", Icon: ArrowDownRight },
  flat: { className: "bg-muted text-muted-foreground", Icon: Minus },
};

const pctDirection = (value: number): TrendDirection =>
  value > 0 ? "up" : value < 0 ? "down" : "flat";

/** Above +100% a percentage is hard to read, so the chip shows a multiple instead. */
const MULTIPLE_ABOVE_PCT = 100;

/** "2.5" / "5" / "62": one decimal below 10×, whole numbers from 10× on. */
const formatMultiple = (pct: number): string => {
  const ratio = 1 + pct / 100;
  return ratio < 10 ? String(Math.round(ratio * 10) / 10) : String(Math.round(ratio));
};

/**
 * Day-over-day trend chip. Only `pct` shows a number; the other kinds share
 * the same chip with an arrow and an explanation for hover and screen readers.
 */
const TrendChip: React.FC<{ trend?: GrowthTrend }> = ({ trend }) => {
  const { t } = useTranslation();
  if (!trend || trend.kind === "none") return null;

  const chip = (direction: TrendDirection, content: React.ReactNode, description?: string) => {
    const { className, Icon } = DIRECTION_STYLE[direction];
    return (
      <div
        data-testid="metric-card-trend"
        title={description}
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded-md text-caption font-semibold",
          className
        )}
      >
        <Icon className="w-3 h-3" aria-hidden="true" />
        {content}
        {description && <span className="sr-only">{description}</span>}
      </div>
    );
  };

  switch (trend.kind) {
    case "pct": {
      const direction = pctDirection(trend.value);
      // The number alone does not say which way it moved; the arrow is visual only.
      const description =
        direction === "up"
          ? t("analytics.trend.upDescription")
          : direction === "down"
            ? t("analytics.trend.downDescription")
            : t("analytics.trend.flatDescription");
      if (trend.value > MULTIPLE_ABOVE_PCT) {
        const multiple = formatMultiple(trend.value);
        // "62×" alone is ambiguous ("62 times more" vs "62 times as much",
        // notably for 倍 in Chinese), so the explanation states the ratio.
        return chip(
          "up",
          <span>{t("analytics.trend.times", { value: multiple })}</span>,
          t("analytics.trend.timesDescription", { value: multiple })
        );
      }
      return chip(direction, <span>{Math.abs(trend.value)}%</span>, description);
    }
    case "new":
      return chip(
        "up",
        <span aria-hidden="true">{t("analytics.trend.new")}</span>,
        t("analytics.trend.newDescription")
      );
    case "up-small-base":
      return chip("up", null, t("analytics.trend.upSmallBase"));
    case "down-small-base":
      return chip("down", null, t("analytics.trend.downSmallBase"));
    case "flat":
      return chip("flat", null, t("analytics.trend.flatSmallBase"));
  }
};

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
      <div className="relative p-3 md:p-5 flex flex-col h-full">
        {/* Top row: Icon + Trend */}
        <div className="flex items-start justify-between mb-3">
          <div
            className="w-8 h-8 md:w-10 md:h-10 rounded-lg flex items-center justify-center"
            style={{
              background: `color-mix(in oklch, ${colorVar} 15%, transparent)`,
            }}
          >
            <Icon className="w-4 h-4 md:w-5 md:h-5" style={{ color: colorVar }} />
          </div>

          <TrendChip trend={trend} />
        </div>

        {/* Value */}
        <div className="font-mono text-2xl leading-tight font-bold tracking-tight text-foreground mb-1 tabular-nums break-words min-w-0">
          {value}
        </div>

        {/* Label */}
        <div className="text-caption font-medium text-muted-foreground uppercase tracking-wider mb-auto">
          {label}
        </div>

        {/* Sub value */}
        {subValue && (
          <div className="mt-3 pt-3 border-t border-border/30">
            <div className="font-mono text-caption text-muted-foreground/70">
              {subValue}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

MetricCard.displayName = "MetricCard";
