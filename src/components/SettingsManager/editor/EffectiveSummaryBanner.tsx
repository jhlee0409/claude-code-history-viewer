/**
 * EffectiveSummaryBanner Component
 *
 * Simple status bar showing active settings summary.
 * No collapsible, no expansion - just clean inline info.
 */

import * as React from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Info, AlertTriangle } from "lucide-react";
import type { AllSettingsResponse } from "@/types";
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
// Component
// ============================================================================

export const EffectiveSummaryBanner: React.FC<EffectiveSummaryBannerProps> = ({
  allSettings,
}) => {
  const { t } = useTranslation();

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

  // Check if there's anything to show
  const hasContent = merged.model.value || serverCount > 0 || permissionCount > 0 || hookCount > 0 || envCount > 0;

  if (!hasContent) {
    return null;
  }

  return (
    <div className="mt-3 shrink-0">
      <div className="bg-muted/30 border border-border/30 rounded-lg px-3 py-2">
        <div className="flex items-center gap-3 flex-wrap text-sm">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Info className="w-3.5 h-3.5" />
            <span className="text-xs font-medium">
              {t("settingsManager.unified.banner.whatsActive")}:
            </span>
          </div>

          {/* Model */}
          {merged.model.value && (
            <Badge variant="secondary" className="text-xs font-mono">
              {merged.model.value}
            </Badge>
          )}

          {/* MCP Servers */}
          {serverCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {serverCount} MCP
              {conflicts.length > 0 && (
                <AlertTriangle className="w-3 h-3 ml-1 text-amber-500" />
              )}
            </Badge>
          )}

          {/* Permissions */}
          {permissionCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {permissionCount} {t("settingsManager.overview.permissions")}
            </Badge>
          )}

          {/* Hooks */}
          {hookCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {hookCount} {t("settingsManager.unified.banner.hookTypes")}
            </Badge>
          )}

          {/* Environment Variables */}
          {envCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {envCount} env
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
};
