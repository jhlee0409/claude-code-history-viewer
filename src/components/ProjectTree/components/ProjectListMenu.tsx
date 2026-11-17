// src/components/ProjectTree/components/ProjectListMenu.tsx
import { useTranslation } from "react-i18next";
import { Clock, FolderTree, GitBranch, List, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { GroupingMode } from "@/types/metadata.types";
import type { ProviderId } from "@/types";
import { ProviderDot } from "./ProviderDot";

export type ProjectSort = "recent" | "name";

export interface ProviderOption {
  id: ProviderId;
  label: string;
  count: number;
  checked: boolean;
}

interface ProjectListMenuProps {
  sort: ProjectSort;
  onSortChange: (sort: ProjectSort) => void;
  groupingMode: GroupingMode;
  onGroupingModeChange?: (mode: GroupingMode) => void;
  providers: ProviderOption[];
  isAllProvidersSelected: boolean;
  onToggleProvider: (id: ProviderId) => void;
  onResetProviders: () => void;
  onDiscoverProviders: () => void;
  isDiscovering: boolean;
}

const GROUPINGS: ReadonlyArray<{ mode: GroupingMode; icon: typeof List; key: string }> = [
  { mode: "none", icon: List, key: "project.groupingNone" },
  { mode: "directory", icon: FolderTree, key: "project.groupingDirectory" },
  { mode: "worktree", icon: GitBranch, key: "project.groupingWorktree" },
  { mode: "time", icon: Clock, key: "project.groupingTime" },
];

/**
 * The project list's view options in one menu beside the filter (plan T7):
 * sort (recent activity first by default), grouping and the provider filter.
 * They used to be a row of icon toggles and a provider panel above the list,
 * which pushed the projects down and truncated the header.
 */
export function ProjectListMenu({
  sort,
  onSortChange,
  groupingMode,
  onGroupingModeChange,
  providers,
  isAllProvidersSelected,
  onToggleProvider,
  onResetProviders,
  onDiscoverProviders,
  isDiscovering,
}: ProjectListMenuProps) {
  const { t } = useTranslation();
  const filtered = !isAllProvidersSelected;
  const label = t("project.listOptions");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          data-project-list-menu
          className={cn(
            "relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
            "text-muted-foreground hover:bg-muted hover:text-foreground",
            filtered && "text-accent"
          )}
        >
          <SlidersHorizontal className="w-4 h-4" />
          {filtered && <span aria-hidden="true" className="absolute right-1 top-1 block h-1.5 w-1.5 rounded-full bg-accent" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>{t("project.sort.label")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={sort} onValueChange={(value) => onSortChange(value as ProjectSort)}>
          <DropdownMenuRadioItem value="recent">{t("project.sort.recent")}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="name">{t("project.sort.name")}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        {onGroupingModeChange && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("project.grouping")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={groupingMode}
              onValueChange={(value) => onGroupingModeChange(value as GroupingMode)}
            >
              {GROUPINGS.map(({ mode, icon: Glyph, key }) => (
                <DropdownMenuRadioItem key={mode} value={mode}>
                  <Glyph className="mr-2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                  {t(key)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("project.providers")}</DropdownMenuLabel>
        {providers.map((provider) => (
          <DropdownMenuCheckboxItem
            key={provider.id}
            checked={provider.checked}
            onSelect={(e) => {
              e.preventDefault();
              onToggleProvider(provider.id);
            }}
          >
            <ProviderDot provider={provider.id} className="mr-2" />
            <span className="flex-1 truncate">{provider.label}</span>
            <span className="ml-2 text-caption tabular-nums text-muted-foreground">{provider.count}</span>
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuItem disabled={isAllProvidersSelected} onSelect={onResetProviders}>
          <RotateCcw className="mr-2 w-4 h-4" aria-hidden="true" />
          {t("project.resetProviderFilters")}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isDiscovering}
          onSelect={(e) => {
            e.preventDefault();
            onDiscoverProviders();
          }}
        >
          <Search className="mr-2 w-4 h-4" aria-hidden="true" />
          {isDiscovering ? t("project.discoveringProviders") : t("project.discoverProviders")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
