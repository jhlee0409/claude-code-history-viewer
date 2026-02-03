// src/components/ProjectTree/components/ProjectItem.tsx
import React from "react";
import { ChevronDown, ChevronRight, Folder, GitBranch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ProjectItemProps } from "../types";
import { getWorktreeLabel } from "../../../utils/worktreeUtils";

export const ProjectItem: React.FC<ProjectItemProps> = ({
  project,
  isExpanded,
  isSelected: _isSelected,
  onToggle,
  onClick,
  onContextMenu,
  variant = "default",
}) => {
  void _isSelected; // Reserved for future selection highlighting
  const { t } = useTranslation();

  const isMain = variant === "main";
  const isWorktree = variant === "worktree";
  const isGrouped = isMain || isWorktree;

  const displayName = isMain
    ? t("project.main", "main")
    : isWorktree
      ? getWorktreeLabel(project.actual_path)
      : project.name;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          onClick();
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
        role="button"
        tabIndex={0}
        aria-label={isExpanded ? "Collapse" : "Expand"}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation();
            e.preventDefault();
            onToggle();
          }
        }}
        className={cn(
          "transition-all duration-200 p-0.5 -m-0.5 rounded hover:bg-black/10",
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

      {/* Project Name */}
      <span
        className={cn(
          "truncate flex-1 transition-colors",
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
        title={project.actual_path}
      >
        {displayName}
      </span>

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
    </div>
  );
};
