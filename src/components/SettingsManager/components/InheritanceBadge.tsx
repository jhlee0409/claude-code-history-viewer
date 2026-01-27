/**
 * InheritanceBadge Component
 *
 * Simple visual indicator showing the source scope of a setting value.
 * Color-coded by scope (User, Project, Local, Managed).
 * Intentionally minimal - no tooltips, just clear visual hierarchy.
 */

import * as React from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { User, FolderOpen, FileCode, Building2 } from "lucide-react";
import type { SettingsScope } from "@/types";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

interface InheritanceBadgeProps {
  /** The scope this value comes from */
  source: SettingsScope;
  /** Size variant */
  size?: "sm" | "md";
  /** Show full label or just icon */
  showLabel?: boolean;
  className?: string;
}

// ============================================================================
// Scope Styles
// ============================================================================

const scopeConfig: Record<
  SettingsScope,
  {
    icon: React.ReactNode;
    color: string;
    bgColor: string;
  }
> = {
  user: {
    icon: <User className="w-3 h-3" />,
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-100 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800",
  },
  project: {
    icon: <FolderOpen className="w-3 h-3" />,
    color: "text-green-600 dark:text-green-400",
    bgColor: "bg-green-100 dark:bg-green-900/30 border-green-200 dark:border-green-800",
  },
  local: {
    icon: <FileCode className="w-3 h-3" />,
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-100 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800",
  },
  managed: {
    icon: <Building2 className="w-3 h-3" />,
    color: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-100 dark:bg-purple-900/30 border-purple-200 dark:border-purple-800",
  },
};

// ============================================================================
// Component
// ============================================================================

export const InheritanceBadge: React.FC<InheritanceBadgeProps> = ({
  source,
  size = "sm",
  showLabel = true,
  className,
}) => {
  const { t } = useTranslation();
  const config = scopeConfig[source];

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 font-normal",
        config.bgColor,
        config.color,
        size === "sm" ? "text-[10px] h-5 px-1.5" : "text-xs h-6 px-2",
        className
      )}
    >
      {config.icon}
      {showLabel && <span>{t(`settingsManager.scope.${source}`)}</span>}
    </Badge>
  );
};

export default InheritanceBadge;
