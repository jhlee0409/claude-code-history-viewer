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
        // Narrow container: horizontal bar with scroll
        "w-full shrink-0 flex flex-row gap-2 overflow-x-auto pb-2 border-b border-border/40",
        // Wide container: vertical sidebar
        "@2xl:w-60 @2xl:flex-col @2xl:gap-3 @2xl:border-b-0 @2xl:border-r @2xl:pr-4 @2xl:pb-0 @2xl:overflow-y-auto @2xl:min-h-0"
      )}
    >
      {/* Context Selector - Always visible, not collapsible */}
      <div className="space-y-1 shrink-0 w-full">
        <h3 className="hidden @2xl:block text-px10 font-semibold text-muted-foreground/60 uppercase tracking-wider px-1">
          {t("settingsManager.unified.sidebar.context") || "Context"}
        </h3>
        <ContextSelector availableScopes={availableScopes} />
      </div>

      {/* Divider */}
      <div className="hidden @2xl:block border-t border-border/40" />

      {/* Presets Section - Desktop only */}
      <div className="hidden @2xl:block">
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
            <h3 className="text-px11 font-semibold text-foreground/70 uppercase tracking-wider">
              {t("settingsManager.unified.sidebar.presets")}
            </h3>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <PresetPanel />
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Divider */}
      <div className="hidden @2xl:block border-t border-border/40" />

      {/* Advanced Options - Desktop only */}
      <div className="hidden @2xl:block">
        <Collapsible open={advancedExpanded} onOpenChange={setAdvancedExpanded}>
          <CollapsibleTrigger
            className={cn(
              "flex items-center gap-1.5 w-full py-1.5 px-2 rounded-md",
              "text-muted-foreground/70 hover:text-muted-foreground hover:bg-muted/50 transition-colors duration-150"
            )}
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span className="text-px11 font-medium flex-1 text-left">
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
      </div>
    </aside>
  );
};
