/**
 * Segmented controls for the Recent Edits panel header.
 *
 * Both copy `src/components/ui/MetricModeToggle.tsx` exactly: track
 * `bg-muted/30 rounded-lg p-1 gap-1`, active `bg-card text-foreground
 * shadow-sm`, inactive `text-muted-foreground hover:text-foreground`, and
 * `aria-pressed` per button. An earlier review round invented a filled-accent
 * style that looked foreign next to the analytics dashboard.
 */

import React from "react";
import { useTranslation } from "react-i18next";
// `Rows` is this lucide version's name for the two-row glyph the design calls
// `Rows2`. The rename to `Rows2` landed after lucide-react 0.300, which is what
// the project pins, so importing `Rows2` here resolves to undefined.
import { AlignJustify, Rows } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  RecentEditsDensity,
  RecentEditsScope,
} from "@/store/slices/recentEditsPanelSlice";

const TRACK_CLASS = "flex items-center gap-1 p-1 bg-muted/30 rounded-lg";

const buttonClass = (active: boolean, extra?: string) =>
  cn(
    "rounded-md text-px11 font-medium transition-all duration-200",
    active
      ? "bg-card text-foreground shadow-sm"
      : "text-muted-foreground hover:text-foreground",
    extra
  );

const SCOPES: Array<{
  id: RecentEditsScope;
  labelKey: string;
  fallback: string;
}> = [
  {
    id: "session",
    labelKey: "recentEdits.scopeSession",
    fallback: "Session",
  },
  {
    id: "project",
    labelKey: "recentEdits.scopeProject",
    fallback: "Project",
  },
];

export interface RecentEditsScopeToggleProps {
  value: RecentEditsScope;
  onChange: (scope: RecentEditsScope) => void;
  /**
   * With no session selected, session scope has nothing to point at. The
   * control is disabled with an explanatory tooltip rather than hidden: a
   * disabled control advertises that session scoping exists and what unlocks
   * it, a hidden one teaches nothing.
   */
  disabled?: boolean;
  className?: string;
}

export const RecentEditsScopeToggle: React.FC<RecentEditsScopeToggleProps> = ({
  value,
  onChange,
  disabled = false,
  className,
}) => {
  const { t } = useTranslation();
  const disabledHint = t(
    "recentEdits.scopeNeedsSession",
    "Select a session to scope edits to it"
  );

  return (
    // The title sits on the wrapper, not the buttons: a disabled button does
    // not reliably fire the mouse events a native tooltip needs.
    <span
      className={cn("inline-flex", className)}
      title={disabled ? disabledHint : undefined}
    >
      <div className={TRACK_CLASS}>
        {SCOPES.map((scope) => {
          const active = value === scope.id;
          /*
            Only session scope needs a session. Project scope works with a
            project alone, and is what the panel falls back to, so disabling the
            whole control dimmed and blocked the option the user was already
            looking at. It read as the panel being broken rather than as one
            mode being unavailable.
          */
          const scopeDisabled = disabled && scope.id === "session";
          return (
            <button
              key={scope.id}
              type="button"
              aria-pressed={active}
              disabled={scopeDisabled}
              onClick={() => onChange(scope.id)}
              className={buttonClass(
                active,
                cn(
                  "px-3 py-1.5",
                  scopeDisabled && "cursor-not-allowed opacity-50"
                )
              )}
            >
              {t(scope.labelKey, scope.fallback)}
            </button>
          );
        })}
      </div>
    </span>
  );
};

RecentEditsScopeToggle.displayName = "RecentEditsScopeToggle";

const DENSITIES: Array<{
  id: RecentEditsDensity;
  labelKey: string;
  fallback: string;
  Icon: typeof AlignJustify;
}> = [
  {
    id: "compact",
    labelKey: "recentEdits.densityCompact",
    fallback: "Compact rows",
    Icon: AlignJustify,
  },
  {
    id: "standard",
    labelKey: "recentEdits.densityFull",
    fallback: "Full cards",
    Icon: Rows,
  },
];

export interface RecentEditsDensityToggleProps {
  value: RecentEditsDensity;
  onChange: (density: RecentEditsDensity) => void;
  className?: string;
}

export const RecentEditsDensityToggle: React.FC<
  RecentEditsDensityToggleProps
> = ({ value, onChange, className }) => {
  const { t } = useTranslation();

  return (
    <div className={cn(TRACK_CLASS, className)}>
      {DENSITIES.map(({ id, labelKey, fallback, Icon }) => {
        const active = value === id;
        const label = t(labelKey, fallback);
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            aria-label={label}
            title={label}
            onClick={() => onChange(id)}
            className={buttonClass(active, "px-2 py-1.5")}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
};

RecentEditsDensityToggle.displayName = "RecentEditsDensityToggle";
