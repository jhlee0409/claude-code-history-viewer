/**
 * EffectiveSummaryBanner Component
 *
 * Collapsible banner showing a summary of effective settings.
 * Shows key values with their source scopes.
 */

import * as React from "react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp, Info, AlertTriangle } from "lucide-react";
import type { AllSettingsResponse, SettingsScope } from "@/types";
import {
  mergeSettings,
  getTotalMCPServerCount,
  getConflictingServers,
} from "@/utils/settingsMerger";

// ============================================================================
// Types
// ============================================================================

interface EffectiveSummaryBannerProps {
  allSettings: AllSettingsResponse;
}

// ============================================================================
// Scope Badge
// ============================================================================

const scopeColors: Record<SettingsScope, string> = {
  user: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  project: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  local: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  managed: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

// ============================================================================
// Component
// ============================================================================

export const EffectiveSummaryBanner: React.FC<EffectiveSummaryBannerProps> = ({
  allSettings,
}) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  // Merge settings to get effective values
  const merged = useMemo(() => mergeSettings(allSettings), [allSettings]);
  const serverCount = getTotalMCPServerCount(merged);
  const conflicts = getConflictingServers(merged);

  // Calculate permission counts
  const permissionCount =
    merged.permissions.allow.length +
    merged.permissions.deny.length +
    merged.permissions.ask.length;

  // Calculate hook count
  const effectiveHooks = merged.effective.hooks ?? {};
  const hookCount = Object.keys(effectiveHooks).filter(
    (key) => (effectiveHooks[key as keyof typeof effectiveHooks]?.length ?? 0) > 0
  ).length;

  // Calculate env var count
  const envCount = Object.keys(merged.env).length;

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={setIsExpanded}
      className="mb-4"
    >
      <div className="bg-muted border rounded-lg">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full h-auto py-2 px-3 justify-between text-muted-foreground hover:text-accent hover:bg-accent/10 transition-colors duration-150"
          >
            <div className="flex items-center gap-2 text-sm">
              <Info className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium">
                {t("settingsManager.unified.banner.effectiveSettings")}
              </span>
              {/* Quick summary badges */}
              <div className="flex items-center gap-1.5 ml-2">
                {merged.model.value && (
                  <Badge variant="secondary" className="text-xs">
                    {merged.model.value}
                  </Badge>
                )}
                {serverCount > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {serverCount} MCP
                  </Badge>
                )}
                {permissionCount > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {permissionCount} perms
                  </Badge>
                )}
                {conflicts.length > 0 && (
                  <Badge
                    variant="outline"
                    className="text-xs text-amber-600 border-amber-300"
                  >
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    {conflicts.length}
                  </Badge>
                )}
              </div>
            </div>
            {isExpanded ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-3 pb-3 pt-1 border-t space-y-3">
            {/* Model */}
            {merged.model.value && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {t("settingsManager.visual.model")}
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono">{merged.model.value}</span>
                  <Badge
                    variant="outline"
                    className={`text-xs ${scopeColors[merged.model.source]}`}
                  >
                    {t(`settingsManager.scope.${merged.model.source}`)}
                  </Badge>
                </div>
              </div>
            )}

            {/* MCP Servers */}
            {serverCount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {t("settingsManager.mcp.title")}
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono">
                    {t("settingsManager.mcp.serverCount", { count: serverCount })}
                  </span>
                  {conflicts.length > 0 && (
                    <span className="text-xs text-amber-600">
                      ({conflicts.length} {t("settingsManager.overview.conflicts")})
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Permissions */}
            {permissionCount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {t("settingsManager.overview.permissions")}
                </span>
                <div className="flex items-center gap-2 text-xs">
                  {merged.permissions.allow.length > 0 && (
                    <span className="text-green-600 dark:text-green-400">
                      {merged.permissions.allow.length} allow
                    </span>
                  )}
                  {merged.permissions.deny.length > 0 && (
                    <span className="text-red-600 dark:text-red-400">
                      {merged.permissions.deny.length} deny
                    </span>
                  )}
                  {merged.permissions.ask.length > 0 && (
                    <span className="text-amber-600 dark:text-amber-400">
                      {merged.permissions.ask.length} ask
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Hooks */}
            {hookCount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {t("settingsManager.unified.sections.hooks")}
                </span>
                <span className="font-mono">
                  {hookCount} {t("settingsManager.unified.banner.hookTypes")}
                </span>
              </div>
            )}

            {/* Environment Variables */}
            {envCount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {t("settingsManager.unified.sections.env")}
                </span>
                <span className="font-mono">{envCount}</span>
              </div>
            )}

            {/* Empty state */}
            {!merged.model.value &&
              serverCount === 0 &&
              permissionCount === 0 &&
              hookCount === 0 &&
              envCount === 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  {t("settingsManager.unified.banner.noSettings")}
                </p>
              )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};
