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
      text: "text-info",
      bg: "bg-info/20",
      border: "border-l-info/50",
      badge: "bg-info/15 text-info",
      expandIcon: "text-info",
    },
    worktree: {
      text: "text-success",
      bg: "bg-success/20",
      border: "border-l-success/50",
      badge: "bg-success/15 text-success",
      expandIcon: "text-success",
    },
    unavailable: {
      text: "text-warning",
      bg: "bg-warning/20",
      border: "border-l-warning/50",
      badge: "bg-warning/15 text-warning",
      expandIcon: "text-warning",
    },
    temporary: {
      text: "text-muted-foreground",
      bg: "bg-muted",
      border: "border-l-border",
      badge: "bg-muted text-muted-foreground",
      expandIcon: "text-muted-foreground",
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
