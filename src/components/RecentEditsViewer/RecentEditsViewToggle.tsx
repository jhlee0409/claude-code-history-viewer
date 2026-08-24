import React from "react";
import { useTranslation } from "react-i18next";
import { FileText, PanelRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type RecentEditsView = "page" | "sidebar";

export interface RecentEditsViewToggleProps {
  value: RecentEditsView;
  onChange: (next: RecentEditsView) => void;
  /**
   * Sidebar is unreachable without a session and below the dock's own
   * breakpoint. Disabled rather than hidden: a control that vanishes teaches
   * nothing, while a disabled one with a reason advertises that the mode exists.
   */
  sidebarDisabled?: boolean;
  sidebarDisabledHint?: string;
  className?: string;
}

/**
 * One control for "am I reading this as a page or as a sidebar", rendered in
 * both places rather than duplicated.
 *
 * Replaces a pair of prose buttons - "Dock beside transcript" on the page and
 * "Undock to full page" buried in the panel's overflow menu. Those named the
 * transition; this names the destination, which is what a toggle is for, and it
 * fits the panel header at its 280px minimum where the sentences did not.
 *
 * The long strings survive as `title` and `aria-label`, so nothing is lost on
 * hover or to a screen reader.
 */
export const RecentEditsViewToggle: React.FC<RecentEditsViewToggleProps> = ({
  value,
  onChange,
  sidebarDisabled = false,
  sidebarDisabledHint,
  className,
}) => {
  const { t } = useTranslation();

  const options: Array<{
    id: RecentEditsView;
    label: string;
    hint: string;
    Icon: typeof FileText;
    disabled: boolean;
  }> = [
    {
      id: "page",
      label: t("recentEdits.viewAsPage", "Page"),
      hint: t("recentEdits.undockToPage", "Undock to full page"),
      Icon: FileText,
      disabled: false,
    },
    {
      id: "sidebar",
      label: t("recentEdits.viewAsSidebar", "Sidebar"),
      hint: sidebarDisabled
        ? (sidebarDisabledHint ?? t("recentEdits.dockToPanel", "Dock beside transcript"))
        : t("recentEdits.dockToPanel", "Dock beside transcript"),
      Icon: PanelRight,
      disabled: sidebarDisabled,
    },
  ];

  return (
    <div
      role="group"
      aria-label={t("recentEdits.viewModeLabel", "View")}
      className={cn(
        "inline-flex shrink-0 items-center overflow-hidden rounded-md border border-border",
        className
      )}
    >
      {options.map(({ id, label, hint, Icon, disabled }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => !disabled && onChange(id)}
            title={hint}
            aria-label={hint}
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-px11 font-medium transition-colors",
              "border-r border-border last:border-r-0",
              active
                ? "bg-accent/20 text-accent"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
              disabled && "cursor-not-allowed opacity-50 hover:bg-transparent"
            )}
          >
            <Icon className="h-3 w-3" aria-hidden="true" />
            {/*
              Label always shown. At two short words the whole control is about
              110px, which fits the panel header even at its 280px minimum, and
              a viewport breakpoint could not describe that anyway: the dock is
              a resizable panel whose width is independent of the window.
            */}
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
};

RecentEditsViewToggle.displayName = "RecentEditsViewToggle";
