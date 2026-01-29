/**
 * SettingsSidebar Component
 *
 * Redesigned sidebar with simplified structure:
 * - Context selector (replaces scope switcher)
 * - Preset panel (Settings + MCP presets)
 * - Advanced options (collapsed by default, includes Export/Import)
 */

import * as React from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SettingsScope } from "@/types";
import { ContextSelector } from "./ContextSelector";
import { PresetPanel } from "./PresetPanel";
import { ActionPanel } from "./ActionPanel";

// ============================================================================
// Types
// ============================================================================

interface SettingsSidebarProps {
  availableScopes: Record<SettingsScope, boolean>;
}

// ============================================================================
// Component
// ============================================================================

export const SettingsSidebar: React.FC<SettingsSidebarProps> = ({
  availableScopes,
}) => {
  const { t } = useTranslation();

  // Collapsed state for each section
  // Context is always visible (not collapsible)
  const [presetsExpanded, setPresetsExpanded] = useState(true);
  // Advanced options collapsed by default (progressive disclosure)
  const [advancedExpanded, setAdvancedExpanded] = useState(false);

  return (
    <aside
      className={cn(
        "w-60 shrink-0 flex flex-col gap-3",
        "border-r border-border/40 pr-4",
        "overflow-y-auto min-h-0"
      )}
    >
      {/* Context Selector - Always visible, not collapsible */}
      <div className="space-y-1">
        <h3 className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-1">
          {t("settingsManager.unified.sidebar.context") || "Context"}
        </h3>
        <ContextSelector availableScopes={availableScopes} />
      </div>

      {/* Divider */}
      <div className="border-t border-border/40" />

      {/* Presets Section */}
      <Collapsible open={presetsExpanded} onOpenChange={setPresetsExpanded}>
        <CollapsibleTrigger
          className={cn(
            "flex items-center gap-1 w-full py-1.5 px-2 rounded-md",
            "text-muted-foreground hover:text-accent hover:bg-accent/10 transition-colors duration-150"
          )}
        >
          {presetsExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          )}
          <h3 className="text-[11px] font-semibold text-foreground/70 uppercase tracking-wider">
            {t("settingsManager.unified.sidebar.presets")}
          </h3>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <PresetPanel />
        </CollapsibleContent>
      </Collapsible>

      {/* Divider */}
      <div className="border-t border-border/40" />

      {/* Advanced Options - Now directly after Presets */}
      <Collapsible open={advancedExpanded} onOpenChange={setAdvancedExpanded}>
        <CollapsibleTrigger
          className={cn(
            "flex items-center gap-1.5 w-full py-1.5 px-2 rounded-md",
            "text-muted-foreground/70 hover:text-muted-foreground hover:bg-muted/50 transition-colors duration-150"
          )}
        >
          <Settings2 className="w-3.5 h-3.5" />
          <span className="text-[11px] font-medium flex-1 text-left">
            {t("settingsManager.unified.sidebar.advanced") || "Advanced"}
          </span>
          {advancedExpanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <ActionPanel />
        </CollapsibleContent>
      </Collapsible>
    </aside>
  );
};
