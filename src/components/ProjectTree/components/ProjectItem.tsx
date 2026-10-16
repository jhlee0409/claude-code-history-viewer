// src/components/ProjectTree/components/ProjectItem.tsx
import React from "react";
import { CircleAlert, ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ProjectItemProps } from "../types";
import { getWorktreeLabel } from "../../../utils/worktreeUtils";
import { getProviderId, getProviderLabel } from "../../../utils/providers";
import { getProjectDisplayName, isProjectPathUnavailable } from "../../../utils/pathUtils";
import { ProviderDot } from "./ProviderDot";

/**
 * One project row (plan T7): a single line - chevron, name, provider dot(s),
 * session count. The full path is the row's tooltip, so the name keeps the
 * row's width instead of sharing it with a path line and provider chips.
 *
 * A click on the chevron only expands or collapses (`onToggle`); a click on
 * the rest of the row is the caller's `onClick` (open the project, or, for
 * the open project, expand/collapse it - plan §9b F3).
 */
export const ProjectItem: React.FC<ProjectItemProps> = ({
  project,
  isExpanded,
  isSelected,
  isRetained = false,
  ariaLevel = 1,
  onToggle,
  onClick,
  onContextMenu,
  variant = "default",
  showProviderBadge = true,
  providerSiblings = [],
  hasInlineChildren = true,
  reserveTrailingSpace = false,
}) => {
  const { t } = useTranslation();

  const isMain = variant === "main";
  const isWorktree = variant === "worktree";
  const isExpandable = project.session_count > 0 && hasInlineChildren;
  const isPathUnavailable = isProjectPathUnavailable(project);
  const actualPath = project.actual_path || project.path || project.name;

  const providerId = getProviderId(project.provider);
  const providers = [project, ...providerSiblings];
  const providerNames = providers
    .map((p) => {
      const label = getProviderLabel((key, fallback) => t(key, fallback), getProviderId(p.provider));
      return p.custom_directory_label ? `${label} (${p.custom_directory_label})` : label;
    })
    .join(", ");
  const displayName = isMain
    ? t("project.main", "main")
    : isWorktree
      ? getWorktreeLabel(project.actual_path)
      : getProjectDisplayName({ ...project, provider: providerId });
  const showDots = showProviderBadge || providerSiblings.length > 0;

  return (
    <button
      type="button"
      role="treeitem"
      data-tree-node="project"
      data-row="project"
      data-project-path={project.path}
      data-selection={isSelected ? (isRetained ? "retained" : "active") : undefined}
      aria-level={ariaLevel}
      aria-selected={isSelected}
      aria-expanded={isExpandable ? isExpanded : undefined}
      tabIndex={-1}
      title={showDots ? `${actualPath}\n${providerNames}` : actualPath}
      onClick={(e) => {
        // The chevron is a disclosure, not a link: it never opens the project.
        if ((e.target as HTMLElement).closest("[data-chevron]")) {
          if (isExpandable) onToggle();
          return;
        }
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" && isExpandable && !isExpanded) {
          e.preventDefault();
          onToggle();
        } else if (e.key === "ArrowLeft" && isExpandable && isExpanded) {
          e.preventDefault();
          onToggle();
        } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
          // Keyboard route to the row menu (hide, copy path, switch provider).
          e.preventDefault();
          onContextMenu(e as unknown as React.MouseEvent);
        }
      }}
      onContextMenu={onContextMenu}
      className={cn(
        "group/project w-full h-7 flex items-center gap-1.5 pl-1 pr-2 rounded-md",
        "text-left text-list outline-none transition-colors cursor-pointer",
        "focus-visible:ring-2 focus-visible:ring-accent",
        isSelected
          ? isRetained
            ? "bg-muted/60 text-foreground/80"
            : "bg-accent/15 text-foreground"
          : "text-sidebar-foreground/85 hover:bg-muted/60",
        reserveTrailingSpace && "pr-16"
      )}
    >
      <span
        data-chevron
        aria-hidden="true"
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground",
          isExpandable ? "hover:bg-muted hover:text-foreground" : "opacity-0"
        )}
      >
        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </span>

      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          isSelected && "font-medium",
          isWorktree && "text-success"
        )}
      >
        {displayName}
      </span>

      {isPathUnavailable && (
        <span
          data-testid="project-path-unavailable"
          aria-label={t("project.pathUnavailable", "Location unavailable")}
          title={t("project.pathUnavailablePath", {
            path: actualPath,
            defaultValue: "Last-known location is unavailable: {{path}}",
          })}
          className="flex-shrink-0 text-warning"
        >
          <CircleAlert className="w-3.5 h-3.5" aria-hidden="true" />
        </span>
      )}

      {showDots && (
        <span className="flex shrink-0 items-center gap-0.5" aria-label={providerNames} role="img">
          {providers.map((p) => (
            <ProviderDot key={p.path} provider={p.provider} />
          ))}
        </span>
      )}

      <span className="shrink-0 min-w-4 text-right text-caption tabular-nums text-muted-foreground">
        {project.session_count}
      </span>
    </button>
  );
};
