/**
 * EnvVarsSection Component
 *
 * Accordion section for environment variables.
 * Allows adding/removing key-value pairs with sensitive value masking.
 */

import * as React from "react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ChevronDown, ChevronRight, Key, Plus, Trash2, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClaudeCodeSettings } from "@/types";

// ============================================================================
// Types
// ============================================================================

interface EnvVarsSectionProps {
  settings: ClaudeCodeSettings;
  isExpanded: boolean;
  onToggle: () => void;
  onChange: (updates: Partial<ClaudeCodeSettings>) => void;
  readOnly: boolean;
}

// ============================================================================
// Env Var Card Sub-component
// ============================================================================

interface EnvVarCardProps {
  envKey: string;
  value: string;
  onDelete: () => void;
  readOnly: boolean;
}

const EnvVarCard: React.FC<EnvVarCardProps> = React.memo(({
  envKey,
  value,
  onDelete,
  readOnly,
}) => {
  const { t } = useTranslation();
  const [isDeleteConfirm, setIsDeleteConfirm] = useState(false);
  const [showValue, setShowValue] = useState(false);

  const isSensitive =
    envKey.toLowerCase().includes("key") ||
    envKey.toLowerCase().includes("token") ||
    envKey.toLowerCase().includes("secret") ||
    envKey.toLowerCase().includes("password");

  const displayValue = () => {
    if (showValue || !isSensitive) {
      return value;
    }
    if (value.length <= 8) {
      return String.fromCharCode(8226).repeat(8);
    }
    return value.slice(0, 4) + String.fromCharCode(8226).repeat(4) + value.slice(-4);
  };

  return (
    <div className="border rounded-lg p-3 bg-card">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <code className="font-mono text-sm font-medium">{envKey}</code>
            {isSensitive && (
              <Badge variant="outline" className="text-xs">
                {t("settingsManager.unified.env.sensitive")}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <code className="font-mono text-xs text-muted-foreground truncate">
              {displayValue()}
            </code>
            {isSensitive && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0"
                onClick={() => setShowValue(!showValue)}
                aria-label={showValue ? t("common.hide") : t("common.show")}
              >
                {showValue ? (
                  <EyeOff className="w-3 h-3" />
                ) : (
                  <Eye className="w-3 h-3" />
                )}
              </Button>
            )}
          </div>
        </div>
        {!readOnly && (
          <div className="ml-2">
            {isDeleteConfirm ? (
              <div className="flex gap-1">
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => {
                    onDelete();
                    setIsDeleteConfirm(false);
                  }}
                >
                  {t("common.delete")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => setIsDeleteConfirm(false)}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setIsDeleteConfirm(true)}
                aria-label={t("common.delete")}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

EnvVarCard.displayName = "EnvVarCard";

// ============================================================================
// Main Component
// ============================================================================

export const EnvVarsSection: React.FC<EnvVarsSectionProps> = React.memo(({
  settings,
  isExpanded,
  onToggle,
  onChange,
  readOnly,
}) => {
  const { t } = useTranslation();
  const instanceId = useId();

  // Dialog state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const envVars = settings.env ?? {};
  const envEntries = Object.entries(envVars);
  const envCount = envEntries.length;

  // Handle add env var
  const handleAddEnvVar = () => {
    if (!newKey.trim()) return;

    const updatedEnv = {
      ...envVars,
      [newKey.trim()]: newValue,
    };

    onChange({ env: updatedEnv });

    // Reset form
    setNewKey("");
    setNewValue("");
    setIsAddOpen(false);
  };

  // Handle delete env var
  const handleDeleteEnvVar = (key: string) => {
    const rest = Object.fromEntries(
      Object.entries(envVars).filter(([k]) => k !== key)
    );
    onChange({ env: Object.keys(rest).length > 0 ? rest : undefined });
  };

  return (
    <>
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
              <Key className="w-4 h-4 text-accent" />
            </div>
            <span className="font-medium text-sm">
              {t("settingsManager.unified.sections.env")}
            </span>
          </div>
          {envCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {envCount}
            </Badge>
          )}
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="pl-10 pr-4 pb-4 pt-2 space-y-3">
            {/* Action bar */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {t("settingsManager.unified.env.description")}
              </span>
              {!readOnly && (
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setIsAddOpen(true)}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  {t("settingsManager.unified.env.add")}
                </Button>
              )}
            </div>

            {/* Env var list */}
            {envCount === 0 ? (
              <div className="text-center py-4 text-sm text-muted-foreground border rounded-lg">
                {t("settingsManager.unified.env.empty")}
              </div>
            ) : (
              <div className="space-y-2">
                {envEntries.map(([key, value]) => (
                  <EnvVarCard
                    key={key}
                    envKey={key}
                    value={value}
                    onDelete={() => handleDeleteEnvVar(key)}
                    readOnly={readOnly}
                  />
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Add Env Var Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("settingsManager.unified.env.addTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor={`${instanceId}-env-key`}>{t("settingsManager.unified.env.key")}</Label>
              <Input
                id={`${instanceId}-env-key`}
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder={t("settingsManager.unified.env.keyPlaceholder")}
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <Label htmlFor={`${instanceId}-env-value`}>{t("settingsManager.unified.env.value")}</Label>
              <Input
                id={`${instanceId}-env-value`}
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder={t("settingsManager.unified.env.valuePlaceholder")}
                type="password"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("settingsManager.unified.env.valueHint")}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleAddEnvVar} disabled={!newKey.trim()}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});

EnvVarsSection.displayName = "EnvVarsSection";
