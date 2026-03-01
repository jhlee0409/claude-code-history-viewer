// src/components/ProjectTree/components/GroupHeader.tsx
import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { GroupHeaderProps } from "../types";

export const GroupHeader: React.FC<GroupHeaderProps> = ({
  groupKey,
  label,
  icon,
  count,
  isExpanded,
  ariaLevel = 1,
  onToggle,
  variant,
}) => {
  const { t } = useTranslation();
  const variantColors = {
    directory: {
      text: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-500/20",
      border: "border-l-blue-500/50",
      badge: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
      expandIcon: "text-blue-500",
    },
    worktree: {
      text: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-500/20",
      border: "border-l-emerald-500/50",
      badge: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
      expandIcon: "text-emerald-500",
    },
  };

  const colors = variantColors[variant];

  return (
    <button
      type="button"
      role="treeitem"
      data-tree-node="group"
      data-tree-key={groupKey}
      data-tree-expandable="true"
      aria-level={ariaLevel}
      onClick={onToggle}
      tabIndex={-1}
      aria-expanded={isExpanded}
      aria-label={t("project.a11y.groupToggleLabel", {
        action: isExpanded
          ? t("project.a11y.collapseGroup", "Collapse")
          : t("project.a11y.expandGroup", "Expand"),
        label,
        count,
        defaultValue: `${isExpanded ? "Collapse" : "Expand"} ${label} group (${count} projects)`,
      })}
      className={cn(
        "w-full px-4 py-2 flex items-center gap-2.5",
        "text-left transition-all duration-300",
        "hover:bg-accent/8",
        "border-l-2 border-transparent",
        isExpanded && "bg-accent/5",
        isExpanded && colors.border
      )}
    >
      {/* Expand Icon */}
      <span
        className={cn(
          "transition-all duration-300",
          isExpanded ? colors.expandIcon : "text-muted-foreground"
        )}
      >
        {isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5" />
        )}
      </span>

      {/* Icon */}
      <div
        className={cn(
          "w-6 h-6 rounded-md flex items-center justify-center transition-all duration-300",
          isExpanded ? colors.bg : "bg-muted/50",
          isExpanded ? colors.expandIcon : "text-muted-foreground"
        )}
      >
        {icon}
      </div>

      {/* Label */}
      <span
        className={cn(
          "text-sm truncate flex-1 transition-colors duration-300",
          isExpanded ? `${colors.text} font-semibold` : "text-sidebar-foreground/80"
        )}
        title={label}
      >
        {label}
      </span>

      {/* Count Badge */}
      <span className={cn("flex items-center gap-1 text-2xs font-mono px-1.5 py-0.5 rounded", colors.badge)}>
        {count}
      </span>
    </button>
  );
};
