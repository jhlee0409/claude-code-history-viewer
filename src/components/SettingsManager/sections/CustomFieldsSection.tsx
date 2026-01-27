/**
 * CustomFieldsSection Component
 *
 * Displays custom/unknown fields in the settings that are not part of
 * the official Claude Code settings schema.
 */

import * as React from "react";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ClaudeCodeSettings } from "@/types";

// ============================================================================
// Constants - Known Official Fields
// ============================================================================

/**
 * Official fields from ClaudeCodeSettings interface
 * Fields not in this list will be shown as "custom"
 */
const OFFICIAL_FIELDS = new Set([
  "$schema",
  "permissions",
  "model",
  "customApiKeyResponsibleUseAcknowledged",
  "hooks",
  "statusLine",
  "enabledPlugins",
  "extraKnownMarketplaces",
  "mcpServers",
  "feedbackSurveyState",
  "env",
]);

/**
 * Fields already covered by other sections
 * These won't be shown even though they are official
 */
const COVERED_BY_SECTIONS = new Set([
  "model",
  "customApiKeyResponsibleUseAcknowledged",
  "statusLine",
  "permissions",
  "mcpServers",
  "hooks",
  "env",
]);

// ============================================================================
// Types
// ============================================================================

interface CustomFieldsSectionProps {
  settings: ClaudeCodeSettings;
  isExpanded: boolean;
  onToggle: () => void;
  onChange: (updates: Partial<ClaudeCodeSettings>) => void;
  readOnly?: boolean;
}

interface CustomField {
  key: string;
  value: unknown;
  isOfficial: boolean; // true if it's an official field not covered by other sections
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract custom fields from settings
 */
function extractCustomFields(
  settings: ClaudeCodeSettings
): CustomField[] {
  const fields: CustomField[] = [];

  for (const [key, value] of Object.entries(settings)) {
    // Skip fields covered by other sections
    if (COVERED_BY_SECTIONS.has(key)) continue;
    // Skip $schema metadata
    if (key === "$schema") continue;

    const isOfficial = OFFICIAL_FIELDS.has(key);
    fields.push({ key, value, isOfficial });
  }

  // Sort: official uncovered fields first, then custom fields
  return fields.sort((a, b) => {
    if (a.isOfficial !== b.isOfficial) {
      return a.isOfficial ? -1 : 1;
    }
    return a.key.localeCompare(b.key);
  });
}

/**
 * Safely stringify value for display
 */
function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Parse string value back to proper type
 */
function parseValue(str: string): unknown {
  // Try to parse as JSON first
  try {
    return JSON.parse(str);
  } catch {
    // Return as string if not valid JSON
    return str;
  }
}

// ============================================================================
// Component
// ============================================================================

export const CustomFieldsSection: React.FC<CustomFieldsSectionProps> = React.memo(({
  settings,
  isExpanded,
  onToggle,
  onChange,
  readOnly = false,
}) => {
  const { t } = useTranslation();
  const [newFieldKey, setNewFieldKey] = useState("");
  const [newFieldValue, setNewFieldValue] = useState("");

  // Extract custom fields
  const customFields = useMemo(
    () => extractCustomFields(settings),
    [settings]
  );

  // Count for badge
  const fieldCount = customFields.length;

  // Handle field value change
  const handleFieldChange = (key: string, newValue: string) => {
    const parsedValue = parseValue(newValue);
    onChange({ [key]: parsedValue } as Partial<ClaudeCodeSettings>);
  };

  // Handle field delete
  const handleFieldDelete = (key: string) => {
    // Create a new settings object without the deleted key
    const newSettings = { ...settings };
    delete (newSettings as Record<string, unknown>)[key];
    onChange(newSettings);
  };

  // Handle add new field
  const handleAddField = () => {
    if (!newFieldKey.trim()) return;

    const parsedValue = parseValue(newFieldValue || '""');
    onChange({ [newFieldKey.trim()]: parsedValue } as Partial<ClaudeCodeSettings>);
    setNewFieldKey("");
    setNewFieldValue("");
  };

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-3 px-4 rounded-lg text-muted-foreground hover:text-accent hover:bg-accent/10 border border-border/40 transition-colors duration-150">
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <AlertCircle className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">
            {t("settingsManager.unified.sections.custom")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {fieldCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {fieldCount}
            </Badge>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertCircle className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs">
                  {t("settingsManager.unified.sections.customDescription")}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-4 pb-4 space-y-4">
          {fieldCount === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              {t("settingsManager.unified.custom.noFields")}
            </p>
          ) : (
            <div className="space-y-3">
              {customFields.map(({ key, value, isOfficial }) => (
                <div
                  key={key}
                  className="flex gap-2 items-start p-3 bg-muted/50 rounded-lg"
                >
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <Label className="font-mono text-sm font-medium">
                        {key}
                      </Label>
                      {isOfficial ? (
                        <Badge variant="outline" className="text-xs">
                          {t("settingsManager.unified.custom.officialUncovered")}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">
                          {t("settingsManager.unified.custom.custom")}
                        </Badge>
                      )}
                    </div>

                    {typeof value === "object" ? (
                      <textarea
                        className="w-full min-h-[80px] px-3 py-2 text-sm font-mono bg-background border rounded-md resize-y"
                        value={stringifyValue(value)}
                        onChange={(e) => handleFieldChange(key, e.target.value)}
                        disabled={readOnly}
                      />
                    ) : (
                      <Input
                        className="font-mono text-sm"
                        value={stringifyValue(value)}
                        onChange={(e) => handleFieldChange(key, e.target.value)}
                        disabled={readOnly}
                      />
                    )}
                  </div>

                  {!readOnly && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-destructive hover:text-destructive"
                      onClick={() => handleFieldDelete(key)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add new field */}
          {!readOnly && (
            <div className="border-t pt-4 mt-4">
              <Label className="text-sm font-medium mb-2 block">
                {t("settingsManager.unified.custom.addNew")}
              </Label>
              <div className="flex gap-2">
                <Input
                  placeholder={t("settingsManager.unified.custom.keyPlaceholder")}
                  value={newFieldKey}
                  onChange={(e) => setNewFieldKey(e.target.value)}
                  className="flex-1 font-mono"
                />
                <Input
                  placeholder={t("settingsManager.unified.custom.valuePlaceholder")}
                  value={newFieldValue}
                  onChange={(e) => setNewFieldValue(e.target.value)}
                  className="flex-1 font-mono"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleAddField}
                  disabled={!newFieldKey.trim()}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {t("settingsManager.unified.custom.addHint")}
              </p>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

CustomFieldsSection.displayName = "CustomFieldsSection";
