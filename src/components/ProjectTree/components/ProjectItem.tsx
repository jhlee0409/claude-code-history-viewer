// src/components/ProjectTree/components/ProjectItem.tsx
import React from "react";
import { ChevronDown, ChevronRight, Folder, GitBranch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ProjectItemProps } from "../types";
import { getWorktreeLabel } from "../../../utils/worktreeUtils";
import {
  getProviderDotStyle,
  getProviderId,
  getProviderLabel,
} from "../../../utils/providers";
import { TruncatedScrollText } from "../../ui/TruncatedScrollText";

function getSourceRows(label: string, t: (key: string, fallback: string) => string): string[] {
  const podmanMatch = label.match(/^Podman:\s*(.+?)\s*@\s*(.+)$/);
  if (podmanMatch) {
    return [`${t("project.source.podman", "Podman")}: ${podmanMatch[1]}`, podmanMatch[2]];
  }
  const wslMatch = label.match(/^WSL:\s*(.+)$/);
  if (wslMatch) {
    return [`${t("project.source.wsl", "WSL")}: ${wslMatch[1]}`];
  }
  return [label.replace(/^🌐\s*/, "")];
}

export const ProjectItem: React.FC<ProjectItemProps> = ({
  project,
  isExpanded,
  isSelected,
  ariaLevel = 1,
  onToggle,
  onClick,
  onContextMenu,
  variant = "default",
  showProviderBadge = true,
}) => {
  const { t } = useTranslation();

  const isMain = variant === "main";
  const isWorktree = variant === "worktree";
  const isGrouped = isMain || isWorktree;
  const isExpandable = project.session_count > 0;

  const displayName = isMain
    ? t("project.main", "main")
    : isWorktree
      ? getWorktreeLabel(project.actual_path)
      : project.name;

  const providerId = getProviderId(project.provider);
  const baseProviderLabel = getProviderLabel(
    (key, fallback) => t(key, fallback),
    providerId
  );
  const sourceLabel = project.source?.displayLabel ?? project.custom_directory_label;
  const sourceTitle = project.source?.debugLabel ?? sourceLabel;
  const sourceRows = sourceLabel ? getSourceRows(sourceLabel, t) : [];
  const providerLabel = sourceLabel
    ? `${baseProviderLabel} (${sourceTitle})`
    : baseProviderLabel;

  return (
    <button
      type="button"
      role="treeitem"
      data-tree-node="project"
      aria-level={ariaLevel}
      aria-selected={isSelected}
      aria-expanded={isExpandable ? isExpanded : undefined}
      tabIndex={-1}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" && isExpandable && !isExpanded) {
          e.preventDefault();
          onToggle();
        } else if (e.key === "ArrowLeft" && isExpandable && isExpanded) {
          e.preventDefault();
          onToggle();
        }
      }}
      onContextMenu={onContextMenu}
      className={cn(
        "w-full flex items-center gap-2",
        "text-left transition-all duration-200 rounded-md cursor-pointer outline-none",
        isGrouped ? "px-2 py-1.5" : "px-4 py-2.5",
        isGrouped ? "focus:ring-2 focus:ring-accent" : "focus:ring-2 focus:ring-accent",
        isGrouped
          ? "hover:bg-accent/10"
          : "hover:bg-accent/8 hover:pl-5 border-l-2 border-transparent",
        !isGrouped && isExpanded && "bg-accent/10 border-l-accent pl-5",
        isGrouped && isMain && "hover:bg-accent/10",
        isGrouped && isWorktree && "hover:bg-emerald-500/10",
        isGrouped && isExpanded && (isMain ? "bg-accent/15" : "bg-emerald-500/15")
      )}
    >
      {/* Expand Icon */}
      <span
        aria-label={isExpanded ? t("common.collapse", "Collapse") : t("common.expand", "Expand")}
        className={cn(
          "transition-all duration-200 p-0.5 -m-0.5 rounded",
          isExpanded
            ? isWorktree
              ? "text-emerald-500"
              : "text-accent"
            : "text-muted-foreground"
        )}
      >
        {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </span>

      {/* Icon */}
      {isGrouped ? (
        isMain ? (
          <span title="Project">
            <Folder
              className={cn(
                "w-3.5 h-3.5 transition-colors",
                isExpanded ? "text-accent" : "text-muted-foreground"
              )}
            />
          </span>
        ) : (
          <span title="Worktree">
            <GitBranch
              className={cn(
                "w-3.5 h-3.5 transition-colors",
                isExpanded ? "text-emerald-500" : "text-emerald-600/60 dark:text-emerald-400/60"
              )}
            />
          </span>
        )
      ) : (
        <div
          className={cn(
            "w-6 h-6 rounded-md flex items-center justify-center transition-all duration-300",
            isExpanded ? "bg-accent/20 text-accent" : "bg-muted/50 text-muted-foreground"
          )}
        >
          <Folder className="w-3.5 h-3.5" />
        </div>
      )}

      {showProviderBadge && (
        <span
          className={cn(
            "h-2 w-2 rounded-full flex-shrink-0 self-center",
            getProviderDotStyle(providerId)
          )}
          aria-hidden="true"
          title={providerLabel}
        />
      )}

      <div className="flex-1 min-w-0 py-0.5">
        <div className="flex min-w-0 items-center">
          {/* Project Name — middle-ellipsis by default, marquee on hover */}
          <TruncatedScrollText
            text={displayName}
            title={project.actual_path}
            className={cn(
              "min-w-0 flex-1 transition-colors",
              isGrouped ? "text-xs" : "text-sm",
              isExpanded
                ? isWorktree
                  ? "text-emerald-600 dark:text-emerald-400 font-medium"
                  : isGrouped
                    ? "text-accent font-medium"
                    : "text-accent font-semibold"
                : isGrouped
                  ? "text-muted-foreground"
                  : "text-sidebar-foreground/80",
              !isGrouped && "duration-300"
            )}
          />
        </div>

        {showProviderBadge && sourceRows.length > 0 && (
          <div
            className="mt-0.5 space-y-0.5 text-2xs leading-tight text-muted-foreground/75"
            title={providerLabel}
          >
            <div className="truncate font-medium">
              {sourceRows[0]}
            </div>
            {sourceRows[1] && (
              <div className="truncate font-mono text-[10px] text-muted-foreground/60">
                {sourceRows[1]}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Session Count */}
      {(!isGrouped && project.session_count > 0) || isGrouped ? (
        <span
          className={cn(
            "text-2xs font-mono rounded",
            isGrouped
              ? "text-muted-foreground/60"
              : cn(
                "px-1.5 py-0.5",
                isExpanded ? "text-accent/70 bg-accent/10" : "text-muted-foreground/60"
              )
          )}
        >
          {project.session_count}
        </span>
      ) : null}
    </button>
  );
};
