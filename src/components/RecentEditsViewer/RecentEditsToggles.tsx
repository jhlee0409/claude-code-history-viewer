/**
 * Segmented controls for the Edits screen's controls row.
 *
 * Drawn with the app's one segmented style (`.segmented` / `.segmented-item`
 * in index.css, shared with the analytics sub-tabs and metric toggle): the
 * selected item is keyed on its `aria-checked` and carries an accent outline
 * that stays visible in the dark theme. An earlier review round invented a
 * filled-accent style that looked foreign next to the analytics dashboard.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { TextAlignJustify, Rows2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import type {
  RecentEditsDensity,
  RecentEditsScope,
} from "@/store/slices/recentEditsSlice";

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
  sessionDisabled?: boolean;
  /**
   * With no project selected either, neither scope resolves. Named after the
   * button it governs, like `sessionDisabled`: one flag per button means no
   * combination of the two can contradict itself, which a single `disabled`
   * plus an "and also project" flag would allow.
   */
  projectDisabled?: boolean;
  className?: string;
}

export const RecentEditsScopeToggle: React.FC<RecentEditsScopeToggleProps> = ({
  value,
  onChange,
  sessionDisabled = false,
  projectDisabled = false,
  className,
}) => {
  const { t } = useTranslation();
  // Nothing selected at all is the more fundamental problem, so it wins the
  // tooltip: telling someone to pick a session is useless advice when they
  // have not picked a project either.
  // Reuses the page view's existing hint rather than adding a second string in
  // the same register: both are tooltips on a control disabled for want of a
  // project.
  const disabledHint = projectDisabled
    ? t("recentEdits.selectProjectFirst", "Select a project first")
    : t("recentEdits.scopeNeedsSession", "Select a session to scope edits to it");

  return (
    // The title sits on the wrapper, not the buttons: a disabled button does
    // not reliably fire the mouse events a native tooltip needs.
    <span
      className={cn("inline-flex", className)}
      title={sessionDisabled || projectDisabled ? disabledHint : undefined}
    >
      <Segmented value={value} onValueChange={(scope) => onChange(scope as RecentEditsScope)} aria-label={SCOPES.map((scope) => t(scope.labelKey, scope.fallback)).join(" / ")} size="toolbar">
        {SCOPES.map((scope) => {

          /*
            Only session scope needs a session. Project scope works with a
            project alone, and is what the panel falls back to, so disabling the
            whole control dimmed and blocked the option the user was already
            looking at. It read as the panel being broken rather than as one
            mode being unavailable.
          */
          const scopeDisabled =
            scope.id === "session" ? sessionDisabled : projectDisabled;
          return (
            <SegmentedItem
              key={scope.id}
              value={scope.id}
              disabled={scopeDisabled}
              className={scopeDisabled ? "cursor-not-allowed" : undefined}
            >
              {t(scope.labelKey, scope.fallback)}
            </SegmentedItem>
          );
        })}
      </Segmented>
    </span>
  );
};

RecentEditsScopeToggle.displayName = "RecentEditsScopeToggle";

const DENSITIES: Array<{
  id: RecentEditsDensity;
  labelKey: string;
  fallback: string;
  Icon: typeof TextAlignJustify;
}> = [
  {
    id: "compact",
    labelKey: "recentEdits.densityCompact",
    fallback: "Compact rows",
    Icon: TextAlignJustify,
  },
  {
    id: "standard",
    labelKey: "recentEdits.densityFull",
    fallback: "Full cards",
    Icon: Rows2,
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
    <Segmented value={value} onValueChange={(density) => onChange(density as RecentEditsDensity)} aria-label={DENSITIES.map((density) => t(density.labelKey, density.fallback)).join(" / ")} size="toolbar" className={className}>
      {DENSITIES.map(({ id, labelKey, fallback, Icon }) => {

        const label = t(labelKey, fallback);
        return (
          <SegmentedItem
            key={id}
            value={id}
            aria-label={label}
            title={label}
            className="px-2"
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </SegmentedItem>
        );
      })}
    </Segmented>
  );
};

RecentEditsDensityToggle.displayName = "RecentEditsDensityToggle";
