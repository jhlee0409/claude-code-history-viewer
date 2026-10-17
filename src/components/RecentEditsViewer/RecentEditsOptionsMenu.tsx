/**
 * The `...` menu in the Edits screen's controls row.
 *
 * Holds grouping and the missing-on-disk filter. These live here
 * rather than in `SettingsManager`, which covers MCP servers, presets and paths
 * and has no appearance section. Grouping also changes what you are looking at,
 * so changing it should not mean leaving the view.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { Ellipsis } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { RecentEditsGrouping } from "@/store/slices/recentEditsSlice";

const radioItemClass =
  "pl-2 [&>span:first-child]:hidden data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground";

export interface RecentEditsOptionsMenuProps {
  grouping: RecentEditsGrouping;
  onGroupingChange: (grouping: RecentEditsGrouping) => void;
  missingOnly: boolean;
  onMissingOnlyChange: (missingOnly: boolean) => void;
  className?: string;
}

export const RecentEditsOptionsMenu: React.FC<RecentEditsOptionsMenuProps> = ({
  grouping,
  onGroupingChange,
  missingOnly,
  onMissingOnlyChange,
  className,
}) => {
  const { t } = useTranslation();
  const label = t("recentEdits.panelOptions", "List options");

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
          <Ellipsis className="h-4 w-4" aria-hidden="true" />
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

      </DropdownMenuContent>
    </DropdownMenu>
  );
};

RecentEditsOptionsMenu.displayName = "RecentEditsOptionsMenu";
