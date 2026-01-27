/**
 * GeneralSection Component
 *
 * Accordion section for general settings:
 * - Model selection
 * - API key acknowledgment
 */

import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronRight, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClaudeCodeSettings, ClaudeModel } from "@/types";

// ============================================================================
// Types
// ============================================================================

interface GeneralSectionProps {
  settings: ClaudeCodeSettings;
  isExpanded: boolean;
  onToggle: () => void;
  onChange: (updates: Partial<ClaudeCodeSettings>) => void;
  readOnly: boolean;
}

// ============================================================================
// Component
// ============================================================================

export const GeneralSection: React.FC<GeneralSectionProps> = React.memo(({
  settings,
  isExpanded,
  onToggle,
  onChange,
  readOnly,
}) => {
  const { t } = useTranslation();

  const handleModelChange = (value: string) => {
    onChange({ model: value as ClaudeModel });
  };

  const handleApiKeyAcknowledgeChange = (checked: boolean) => {
    onChange({ customApiKeyResponsibleUseAcknowledged: checked });
  };

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger
        className={cn(
          "flex items-center justify-between w-full py-3 px-4 rounded-lg",
          "border border-border/40 transition-colors duration-150",
          "text-muted-foreground hover:text-accent hover:bg-accent/10 hover:border-border/60",
          isExpanded && "bg-accent/10 border-border/60 text-foreground"
        )}
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background: "color-mix(in oklch, var(--accent) 15%, transparent)",
            }}
          >
            <Settings2 className="w-4 h-4 text-accent" />
          </div>
          <span className="font-medium text-sm">
            {t("settingsManager.unified.sections.general")}
          </span>
        </div>
        {settings.model && (
          <span className="text-xs text-muted-foreground font-mono">
            {settings.model}
          </span>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="pl-10 pr-4 pb-4 pt-2 space-y-4">
          {/* Model Selection */}
          <div className="space-y-2">
            <Label htmlFor="model-select">
              {t("settingsManager.visual.model")}
            </Label>
            <Select
              value={settings.model || ""}
              onValueChange={handleModelChange}
              disabled={readOnly}
            >
              <SelectTrigger id="model-select" className="w-full">
                <SelectValue
                  placeholder={t("settingsManager.visual.selectModel")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="opus">
                  Opus ({t("settingsManager.unified.model.opus")})
                </SelectItem>
                <SelectItem value="sonnet">
                  Sonnet ({t("settingsManager.unified.model.sonnet")})
                </SelectItem>
                <SelectItem value="haiku">
                  Haiku ({t("settingsManager.unified.model.haiku")})
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("settingsManager.unified.model.description")}
            </p>
          </div>

          {/* API Key Acknowledgment */}
          <div className="flex items-center justify-between py-2 border-t border-border/40">
            <div className="space-y-0.5">
              <Label htmlFor="api-key-acknowledge">
                {t("settingsManager.visual.apiKey")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("settingsManager.visual.apiKeyAcknowledge")}
              </p>
            </div>
            <Switch
              id="api-key-acknowledge"
              checked={settings.customApiKeyResponsibleUseAcknowledged ?? false}
              onCheckedChange={handleApiKeyAcknowledgeChange}
              disabled={readOnly}
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

GeneralSection.displayName = "GeneralSection";
