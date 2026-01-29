/**
 * HooksSection Component
 *
 * Accordion section for lifecycle hooks settings.
 * Supports UserPromptSubmit, Stop, and custom hooks.
 */

import * as React from "react";
import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronRight, Zap, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClaudeCodeSettings, HookCommand } from "@/types";

// ============================================================================
// Types
// ============================================================================

interface HooksSectionProps {
  settings: ClaudeCodeSettings;
  isExpanded: boolean;
  onToggle: () => void;
  onChange: (updates: Partial<ClaudeCodeSettings>) => void;
  readOnly: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const BUILTIN_HOOKS = ["UserPromptSubmit", "Stop", "SessionStart", "SessionEnd"];

// ============================================================================
// Hook Card Sub-component
// ============================================================================

interface HookCardProps {
  hookName: string;
  commands: HookCommand[];
  onDelete: () => void;
  onRemoveCommand: (index: number) => void;
  readOnly: boolean;
}

const HookCard: React.FC<HookCardProps> = React.memo(({
  hookName,
  commands,
  onDelete,
  onRemoveCommand,
  readOnly,
}) => {
  const { t } = useTranslation();
  const [isDeleteConfirm, setIsDeleteConfirm] = useState(false);
  const [commandConfirmIndex, setCommandConfirmIndex] = useState<number | null>(null);

  return (
    <div className="border rounded-lg p-3 bg-card">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs font-mono">
            {hookName}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {t("settingsManager.unified.hooks.commandCount", { count: commands.length })}
          </span>
        </div>
        {!readOnly && (
          <div>
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
      <div className="space-y-1">
        {commands.map((cmd, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2 text-xs font-mono bg-muted rounded px-2 py-1 group"
          >
            <code className="flex-1 truncate">
              {cmd.command} {cmd.args?.join(" ")}
            </code>
            {cmd.timeout && (
              <span className="text-muted-foreground">
                ({cmd.timeout}ms)
              </span>
            )}
            {!readOnly && (
              commandConfirmIndex === idx ? (
                <div className="flex gap-1">
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-5 text-xs px-2"
                    onClick={() => {
                      onRemoveCommand(idx);
                      setCommandConfirmIndex(null);
                    }}
                  >
                    {t("common.delete")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 text-xs px-2"
                    onClick={() => setCommandConfirmIndex(null)}
                  >
                    {t("common.cancel")}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100"
                  onClick={() => setCommandConfirmIndex(idx)}
                  aria-label={t("common.remove")}
                >
                  <X className="w-3 h-3" />
                </Button>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
});

HookCard.displayName = "HookCard";

// ============================================================================
// Main Component
// ============================================================================

export const HooksSection: React.FC<HooksSectionProps> = React.memo(({
  settings,
  isExpanded,
  onToggle,
  onChange,
  readOnly,
}) => {
  const { t } = useTranslation();

  // Dialog state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newHookType, setNewHookType] = useState<string>("UserPromptSubmit");
  const [newCommand, setNewCommand] = useState("");
  const [newArgs, setNewArgs] = useState("");

  const hooks = settings.hooks ?? {};
  const hookEntries = Object.entries(hooks).filter(
    ([, commands]) => commands && commands.length > 0
  );
  const hookCount = hookEntries.length;

  // Handle add hook
  const handleAddHook = () => {
    if (!newCommand.trim()) return;

    const trimmedArgs = newArgs.trim();
    const newHookCommand: HookCommand = {
      command: newCommand.trim(),
      args: trimmedArgs ? trimmedArgs.split(/\s+/) : undefined,
    };

    const currentHooks = hooks[newHookType] ?? [];
    const updatedHooks = {
      ...hooks,
      [newHookType]: [...currentHooks, newHookCommand],
    };

    onChange({ hooks: updatedHooks });

    // Reset form
    setNewCommand("");
    setNewArgs("");
    setIsAddOpen(false);
  };

  // Handle delete hook type
  const handleDeleteHook = (hookName: string) => {
    const rest = Object.fromEntries(
      Object.entries(hooks).filter(([k]) => k !== hookName)
    );
    onChange({ hooks: rest });
  };

  // Handle remove single command from hook
  const handleRemoveCommand = (hookName: string, commandIndex: number) => {
    const currentCommands = hooks[hookName] ?? [];
    const updatedCommands = currentCommands.filter((_, i) => i !== commandIndex);

    if (updatedCommands.length === 0) {
      handleDeleteHook(hookName);
    } else {
      onChange({
        hooks: {
          ...hooks,
          [hookName]: updatedCommands,
        },
      });
    }
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
              <Zap className="w-4 h-4 text-accent" />
            </div>
            <span className="font-medium text-sm">
              {t("settingsManager.unified.sections.hooks")}
            </span>
          </div>
          {hookCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {hookCount}
            </Badge>
          )}
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="pl-10 pr-4 pb-4 pt-2 space-y-3">
            {/* Action bar */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {t("settingsManager.unified.hooks.description")}
              </span>
              {!readOnly && (
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setIsAddOpen(true)}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  {t("settingsManager.unified.hooks.add")}
                </Button>
              )}
            </div>

            {/* Hook list */}
            {hookCount === 0 ? (
              <div className="text-center py-4 text-sm text-muted-foreground border rounded-lg">
                {t("settingsManager.unified.hooks.empty")}
              </div>
            ) : (
              <div className="space-y-2">
                {hookEntries.map(([name, commands]) => (
                  <HookCard
                    key={name}
                    hookName={name}
                    commands={commands || []}
                    onDelete={() => handleDeleteHook(name)}
                    onRemoveCommand={(idx) => handleRemoveCommand(name, idx)}
                    readOnly={readOnly}
                  />
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Add Hook Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("settingsManager.unified.hooks.addTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("settingsManager.unified.hooks.hookType")}</Label>
              <Select value={newHookType} onValueChange={setNewHookType}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUILTIN_HOOKS.map((hook) => (
                    <SelectItem key={hook} value={hook}>
                      {hook}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("settingsManager.mcp.command")}</Label>
              <Input
                value={newCommand}
                onChange={(e) => setNewCommand(e.target.value)}
                placeholder={t("settingsManager.mcp.commandPlaceholder")}
                className="mt-1"
              />
            </div>
            <div>
              <Label>{t("settingsManager.mcp.args")}</Label>
              <Input
                value={newArgs}
                onChange={(e) => setNewArgs(e.target.value)}
                placeholder={t("settingsManager.mcp.argsPlaceholder")}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleAddHook} disabled={!newCommand.trim()}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});

HooksSection.displayName = "HooksSection";
