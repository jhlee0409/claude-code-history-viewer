/**
 * The `...` menu in the Recent Edits panel header.
 *
 * Holds grouping, the missing-on-disk filter, and undocking. These live here
 * rather than in `SettingsManager`, which covers MCP servers, presets and paths
 * and has no appearance section. Grouping also changes what you are looking at,
 * so changing it should not mean leaving the view.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, PanelRightClose } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { RecentEditsGrouping } from "@/store/slices/recentEditsPanelSlice";

const radioItemClass =
  "pl-2 [&>span:first-child]:hidden data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground";

export interface RecentEditsOptionsMenuProps {
  grouping: RecentEditsGrouping;
  onGroupingChange: (grouping: RecentEditsGrouping) => void;
  missingOnly: boolean;
  onMissingOnlyChange: (missingOnly: boolean) => void;
  /** Omitted when the view is already the full page, where undocking is a no-op. */
  onUndock?: () => void;
  className?: string;
}

export const RecentEditsOptionsMenu: React.FC<RecentEditsOptionsMenuProps> = ({
  grouping,
  onGroupingChange,
  missingOnly,
  onMissingOnlyChange,
  onUndock,
  className,
}) => {
  const { t } = useTranslation();
  const label = t("recentEdits.panelOptions", "Panel options");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={cn(
            "rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            className
          )}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          {t("recentEdits.groupBy", "Group edits by")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={grouping}
          onValueChange={(value) =>
            onGroupingChange(value as RecentEditsGrouping)
          }
        >
          <DropdownMenuRadioItem value="file" className={radioItemClass}>
            {t("recentEdits.groupByFile", "File (latest state)")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="edit" className={radioItemClass}>
            {t("recentEdits.groupByEdit", "Edit (chronological)")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuLabel>
          {t("recentEdits.showFilter", "Show")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={missingOnly ? "missing" : "all"}
          onValueChange={(value) => onMissingOnlyChange(value === "missing")}
        >
          <DropdownMenuRadioItem value="all" className={radioItemClass}>
            {t("recentEdits.showAll", "All files")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="missing" className={radioItemClass}>
            {t("recentEdits.showMissingOnly", "Missing on disk only")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        {onUndock && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onUndock}>
              <PanelRightClose
                className="mr-2 h-4 w-4 text-foreground"
                aria-hidden="true"
              />
              <span>{t("recentEdits.undockToPage", "Undock to full page")}</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

RecentEditsOptionsMenu.displayName = "RecentEditsOptionsMenu";
