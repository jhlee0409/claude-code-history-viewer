/**
 * SettingsSidebar Component
 *
 * Left sidebar containing collapsible sections:
 * - Scope switcher
 * - Preset panel (Settings + MCP presets)
 * - Action panel (Export/Import)
 */

import * as React from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SettingsScope } from "@/types";
import { ScopeSwitcher } from "./ScopeSwitcher";
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
  const [scopesExpanded, setScopesExpanded] = useState(true);
  const [presetsExpanded, setPresetsExpanded] = useState(true);
  const [actionsExpanded, setActionsExpanded] = useState(true);

  return (
    <aside
      className={cn(
        "w-60 shrink-0 flex flex-col gap-2",
        "border-r border-border/40 pr-4",
        "overflow-auto"
      )}
    >
      {/* Scope Switcher Section */}
      <Collapsible open={scopesExpanded} onOpenChange={setScopesExpanded}>
        <CollapsibleTrigger
          className={cn(
            "flex items-center gap-1 w-full py-1.5 px-2 rounded-md",
            "text-muted-foreground hover:text-accent hover:bg-accent/10 transition-colors duration-150"
          )}
        >
          {scopesExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          )}
          <h3 className="text-[11px] font-semibold text-foreground/70 uppercase tracking-wider">
            {t("settingsManager.unified.sidebar.scopes")}
          </h3>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <ScopeSwitcher availableScopes={availableScopes} />
        </CollapsibleContent>
      </Collapsible>

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

      {/* Actions Section */}
      <Collapsible open={actionsExpanded} onOpenChange={setActionsExpanded}>
        <CollapsibleTrigger
          className={cn(
            "flex items-center gap-1 w-full py-1.5 px-2 rounded-md",
            "text-muted-foreground hover:text-accent hover:bg-accent/10 transition-colors duration-150"
          )}
        >
          {actionsExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          )}
          <h3 className="text-[11px] font-semibold text-foreground/70 uppercase tracking-wider">
            {t("settingsManager.unified.sidebar.actions")}
          </h3>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <ActionPanel />
        </CollapsibleContent>
      </Collapsible>
    </aside>
  );
};
