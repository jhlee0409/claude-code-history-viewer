/**
 * PermissionsSection Component
 *
 * Accordion section for permissions settings:
 * - Default permission mode (acceptEdits/askPermissions/viewOnly)
 * - Additional directories
 * - Disable bypass permissions mode
 * - Allow list
 * - Deny list
 * - Ask list
 */

import * as React from "react";
import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, ChevronRight, Shield, Plus, X, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClaudeCodeSettings, PermissionDefaultMode } from "@/types";

// ============================================================================
// Types
// ============================================================================

interface PermissionsSectionProps {
  settings: ClaudeCodeSettings;
  isExpanded: boolean;
  onToggle: () => void;
  onChange: (updates: Partial<ClaudeCodeSettings>) => void;
  readOnly: boolean;
}

// ============================================================================
// Permission List Editor Sub-component
// ============================================================================

interface PermissionListEditorProps {
  title: string;
  items: string[];
  onItemsChange: (items: string[]) => void;
  placeholder?: string;
  readOnly: boolean;
  variant: "allow" | "deny" | "ask";
}

const PermissionListEditor: React.FC<PermissionListEditorProps> = React.memo(({
  title,
  items,
  onItemsChange,
  placeholder,
  readOnly,
  variant,
}) => {
  const [newItem, setNewItem] = useState("");
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null);
  const { t } = useTranslation();

  const variantColors = {
    allow: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    deny: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    ask: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  };

  const variantLabelColors = {
    allow: "text-green-800 dark:text-green-200",
    deny: "text-red-800 dark:text-red-200",
    ask: "text-amber-800 dark:text-amber-200",
  };

  const addItem = () => {
    if (newItem.trim() && !items.includes(newItem.trim())) {
      onItemsChange([...items, newItem.trim()]);
      setNewItem("");
    }
  };

  const removeItem = (index: number) => {
    onItemsChange(items.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      <Label className={`text-sm ${variantLabelColors[variant]}`}>
        {title}
      </Label>
      <div className="space-y-1.5">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-1">
            {t("settingsManager.unified.permissions.empty")}
          </p>
        ) : (
          items.map((item, index) => (
            <div
              key={`${item}-${index}`}
              className="flex items-center gap-2 group"
            >
              <Badge
                variant="outline"
                className={`flex-1 justify-start font-mono text-xs py-1 ${variantColors[variant]}`}
              >
                {item}
              </Badge>
              {!readOnly && (
                confirmIndex === index ? (
                  <div className="flex gap-1">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-6 text-xs px-2"
                      onClick={() => {
                        removeItem(index);
                        setConfirmIndex(null);
                      }}
                    >
                      {t("common.delete")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs px-2"
                      onClick={() => setConfirmIndex(null)}
                    >
                      {t("common.cancel")}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => setConfirmIndex(index)}
                    aria-label={t("common.remove")}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                )
              )}
            </div>
          ))
        )}
      </div>
      {!readOnly && (
        <div className="flex gap-2 pt-1">
          <Input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            placeholder={placeholder}
            className="h-8 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addItem();
              }
            }}
          />
          <Button size="sm" className="h-8" onClick={addItem} aria-label={t("common.add")}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
});

PermissionListEditor.displayName = "PermissionListEditor";

// ============================================================================
// Main Component
// ============================================================================

export const PermissionsSection: React.FC<PermissionsSectionProps> = React.memo(({
  settings,
  isExpanded,
  onToggle,
  onChange,
  readOnly,
}) => {
  const { t } = useTranslation();
  const [newDirectory, setNewDirectory] = useState("");
  const [dirConfirmIndex, setDirConfirmIndex] = useState<number | null>(null);

  const allowList = settings.permissions?.allow ?? [];
  const denyList = settings.permissions?.deny ?? [];
  const askList = settings.permissions?.ask ?? [];
  const additionalDirectories = settings.permissions?.additionalDirectories ?? [];
  const defaultMode = settings.permissions?.defaultMode ?? "askPermissions";
  const disableBypassPermissionsMode = settings.permissions?.disableBypassPermissionsMode === "disable";

  const totalCount = allowList.length + denyList.length + askList.length;

  const updatePermissions = (updates: Partial<ClaudeCodeSettings["permissions"]>) => {
    onChange({
      permissions: {
        ...settings.permissions,
        allow: allowList,
        deny: denyList,
        ask: askList,
        additionalDirectories,
        defaultMode,
        ...(disableBypassPermissionsMode ? { disableBypassPermissionsMode: "disable" as const } : {}),
        ...updates,
      },
    });
  };

  const handleAllowChange = (items: string[]) => {
    updatePermissions({ allow: items });
  };

  const handleDenyChange = (items: string[]) => {
    updatePermissions({ deny: items });
  };

  const handleAskChange = (items: string[]) => {
    updatePermissions({ ask: items });
  };

  const handleDefaultModeChange = (value: string) => {
    updatePermissions({ defaultMode: value as PermissionDefaultMode });
  };

  const handleBypassToggle = (checked: boolean) => {
    updatePermissions({ disableBypassPermissionsMode: checked ? "disable" : undefined });
  };

  const addDirectory = () => {
    if (newDirectory.trim() && !additionalDirectories.includes(newDirectory.trim())) {
      updatePermissions({
        additionalDirectories: [...additionalDirectories, newDirectory.trim()],
      });
      setNewDirectory("");
    }
  };

  const removeDirectory = (index: number) => {
    updatePermissions({
      additionalDirectories: additionalDirectories.filter((_, i) => i !== index),
    });
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
            <Shield className="w-4 h-4 text-accent" />
          </div>
          <span className="font-medium text-sm">
            {t("settingsManager.unified.sections.permissions")}
          </span>
        </div>
        {totalCount > 0 && (
          <Badge variant="secondary" className="text-xs">
            {totalCount}
          </Badge>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="pl-10 pr-4 pb-4 pt-2 space-y-6">
          {/* Default Mode & Bypass Settings */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground border-b pb-2">
              {t("settingsManager.permissions.modeSettings")}
            </h4>

            {/* Default Permission Mode */}
            <div className="space-y-2">
              <Label className="text-sm">
                {t("settingsManager.permissions.defaultMode")}
              </Label>
              <Select
                value={defaultMode}
                onValueChange={handleDefaultModeChange}
                disabled={readOnly}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="acceptEdits">
                    {t("settingsManager.permissions.mode.acceptEdits")}
                  </SelectItem>
                  <SelectItem value="askPermissions">
                    {t("settingsManager.permissions.mode.askPermissions")}
                  </SelectItem>
                  <SelectItem value="viewOnly">
                    {t("settingsManager.permissions.mode.viewOnly")}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("settingsManager.permissions.defaultModeDesc")}
              </p>
            </div>

            {/* Disable Bypass Permissions Mode */}
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label className="text-sm">
                  {t("settingsManager.permissions.disableBypass")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("settingsManager.permissions.disableBypassDesc")}
                </p>
              </div>
              <Switch
                checked={disableBypassPermissionsMode}
                onCheckedChange={handleBypassToggle}
                disabled={readOnly}
              />
            </div>
          </div>

          {/* Additional Directories */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground border-b pb-2 flex items-center gap-2">
              <FolderOpen className="w-4 h-4" />
              {t("settingsManager.permissions.additionalDirectories")}
            </h4>
            <p className="text-xs text-muted-foreground">
              {t("settingsManager.permissions.additionalDirectoriesDesc")}
            </p>

            <div className="space-y-1.5">
              {additionalDirectories.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-1">
                  {t("settingsManager.permissions.noAdditionalDirs")}
                </p>
              ) : (
                additionalDirectories.map((dir, index) => (
                  <div
                    key={`${dir}-${index}`}
                    className="flex items-center gap-2 group"
                  >
                    <Badge
                      variant="outline"
                      className="flex-1 justify-start font-mono text-xs py-1 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                    >
                      {dir}
                    </Badge>
                    {!readOnly && (
                      dirConfirmIndex === index ? (
                        <div className="flex gap-1">
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-6 text-xs px-2"
                            onClick={() => {
                              removeDirectory(index);
                              setDirConfirmIndex(null);
                            }}
                          >
                            {t("common.delete")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs px-2"
                            onClick={() => setDirConfirmIndex(null)}
                          >
                            {t("common.cancel")}
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => setDirConfirmIndex(index)}
                          aria-label={t("common.remove")}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      )
                    )}
                  </div>
                ))
              )}
            </div>
            {!readOnly && (
              <div className="flex gap-2 pt-1">
                <Input
                  value={newDirectory}
                  onChange={(e) => setNewDirectory(e.target.value)}
                  placeholder={t("settingsManager.permissions.directoryPlaceholder")}
                  className="h-8 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addDirectory();
                    }
                  }}
                />
                <Button size="sm" className="h-8" onClick={addDirectory} aria-label={t("settingsManager.permissions.addDirectory")}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>

          {/* Permission Lists */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground border-b pb-2">
              {t("settingsManager.permissions.patternRules")}
            </h4>

            {/* Allow List */}
            <PermissionListEditor
              title={t("settingsManager.visual.allowList")}
              items={allowList}
              onItemsChange={handleAllowChange}
              placeholder={t("settingsManager.permissions.allowPlaceholder")}
              readOnly={readOnly}
              variant="allow"
            />

            {/* Deny List */}
            <PermissionListEditor
              title={t("settingsManager.visual.denyList")}
              items={denyList}
              onItemsChange={handleDenyChange}
              placeholder={t("settingsManager.permissions.denyPlaceholder")}
              readOnly={readOnly}
              variant="deny"
            />

            {/* Ask List */}
            <PermissionListEditor
              title={t("settingsManager.unified.permissions.askList")}
              items={askList}
              onItemsChange={handleAskChange}
              placeholder={t("settingsManager.permissions.askPlaceholder")}
              readOnly={readOnly}
              variant="ask"
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

PermissionsSection.displayName = "PermissionsSection";
