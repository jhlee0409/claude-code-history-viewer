/**
 * SectionCard Component
 *
 * A card wrapper for dashboard sections with colored accent.
 */

import React from "react";
import { cn } from "@/lib/utils";
import type { SectionCardProps } from "../types";

export const SectionCard: React.FC<SectionCardProps> = ({
  title,
  icon: Icon,
  colorVariant = "accent",
  children,
  className,
}) => {
  const colorVar = colorVariant === "accent" ? "var(--accent)" : `var(--metric-${colorVariant})`;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl",
        "bg-card/60 backdrop-blur-sm",
        "border border-border/50",
        className
      )}
    >
      {/* Top accent line */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{ background: `linear-gradient(90deg, transparent, ${colorVar}, transparent)` }}
      />

      <div className="p-5">
        {/* Header */}
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-4">
          {Icon && (
            <div
              className="w-6 h-6 rounded-md flex items-center justify-center"
              style={{ background: `color-mix(in oklch, ${colorVar} 15%, transparent)` }}
            >
              <Icon className="w-3.5 h-3.5" style={{ color: colorVar }} />
            </div>
          )}
          {title}
        </h3>

        {children}
      </div>
    </div>
  );
};

SectionCard.displayName = "SectionCard";
