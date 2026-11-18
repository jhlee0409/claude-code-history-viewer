/**
 * ClaudeAiExportsSection Component
 *
 * Settings section for claude.ai account exports (Settings → Privacy →
 * Export data on claude.ai, #674). The user adds the downloaded zip or the
 * folder it was extracted to; the app reads it in place and shows its
 * conversations under the Claude.ai provider. Removing an export only
 * forgets it - the export itself is never touched.
 */

import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ChevronDown,
  ChevronRight,
  FileArchive,
  FolderOpen,
  MessagesSquare,
  Plus,
  Trash,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isTauri } from "@/utils/platform";
import { useAppStore } from "@/store/useAppStore";

interface ClaudeAiExportsSectionProps {
  isExpanded: boolean;
  onToggle: (open: boolean) => void;
  readOnly?: boolean;
}

const normalizePath = (p: string): string => p.trim().replace(/[\\/]+$/, "");

export function ClaudeAiExportsSection({
  isExpanded,
  onToggle,
  readOnly = false,
}: ClaudeAiExportsSectionProps) {
  const { t } = useTranslation();
  const exports = useAppStore((s) => s.userMetadata?.settings?.claudeAiExports) ?? [];
  const addClaudeAiExport = useAppStore((s) => s.addClaudeAiExport);
  const removeClaudeAiExport = useAppStore((s) => s.removeClaudeAiExport);

  const [isAdding, setIsAdding] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [newPath, setNewPath] = React.useState("");
  const [newLabel, setNewLabel] = React.useState("");
  const [addError, setAddError] = React.useState<string | null>(null);

  const pathInputId = React.useId();
  const labelInputId = React.useId();

  const resetForm = () => {
    setIsAdding(false);
    setNewPath("");
    setNewLabel("");
    setAddError(null);
  };

  const choose = async (directory: boolean) => {
    try {
      // Desktop-only plugin: the WebUI build has no native dialog.
      const dialog = await import("@tauri-apps/plugin-dialog");
      const selected = await dialog.open({
        directory,
        multiple: false,
        title: t("settings.claudeAiExports.add"),
        ...(directory ? {} : { filters: [{ name: "Zip", extensions: ["zip"] }] }),
      });
      if (typeof selected === "string") {
        setNewPath(selected);
        setAddError(null);
      }
    } catch (err) {
      toast.error(t("settingsManager.errors.folderSelectFailed", { detail: String(err) }));
    }
  };

  const handleAdd = async () => {
    const path = normalizePath(newPath);
    if (!path) return;
    if (exports.some((e) => normalizePath(e.path) === path)) {
      setAddError(t("settings.claudeAiExports.duplicate"));
      return;
    }
    setIsSaving(true);
    try {
      const added = await addClaudeAiExport(path, newLabel.trim() || undefined);
      resetForm();
      toast.success(t("settings.claudeAiExports.added", { count: added.conversations }));
    } catch (err) {
      setAddError(t("settings.claudeAiExports.invalid", { detail: String(err) }));
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async (path: string) => {
    if (!window.confirm(t("settings.claudeAiExports.removeConfirm"))) return;
    try {
      await removeClaudeAiExport(path);
    } catch (err) {
      toast.error(t("settings.claudeAiExports.removeFailed", { detail: String(err) }));
    }
  };

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-body font-medium hover:bg-muted/50 transition-colors">
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0" />
        )}
        <MessagesSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span>{t("settings.claudeAiExports")}</span>
        {exports.length > 0 && (
          <span className="ml-auto text-list text-muted-foreground">{exports.length}</span>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-3 px-3 pb-3">
          <p className="text-list text-muted-foreground">
            {t("settings.claudeAiExports.description")}
          </p>

          {exports.map((entry) => (
            <div
              key={entry.path}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-body"
            >
              <div className="flex-1 min-w-0">
                <div data-mono="path" className="truncate font-mono text-list">{entry.path}</div>
                {entry.label && (
                  <span className="text-list text-muted-foreground">{entry.label}</span>
                )}
              </div>
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive hover:text-destructive"
                  onClick={() => handleRemove(entry.path)}
                  aria-label={t("settings.claudeAiExports.remove")}
                >
                  <Trash className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}

          {exports.length === 0 && !isAdding && (
            <p className="text-list text-muted-foreground italic">
              {t("settings.claudeAiExports.empty")}
            </p>
          )}

          {!readOnly && isAdding ? (
            <div
              className={cn(
                "space-y-2 rounded-md border border-border p-3",
                addError && "border-destructive"
              )}
            >
              <div className="space-y-1">
                <Label htmlFor={pathInputId} className="text-list">
                  {t("settings.claudeAiExports.path")}
                </Label>
                <div className="flex gap-1">
                  <Input
                    id={pathInputId}
                    value={newPath}
                    onChange={(e) => {
                      setNewPath(e.target.value);
                      setAddError(null);
                    }}
                    placeholder={t("settings.claudeAiExports.pathPlaceholder")}
                    data-mono="path"
                    className="h-8 text-list font-mono"
                  />
                  {isTauri() && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0"
                        onClick={() => choose(false)}
                        aria-label={t("settings.claudeAiExports.chooseZip")}
                      >
                        <FileArchive className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0"
                        onClick={() => choose(true)}
                        aria-label={t("settings.claudeAiExports.chooseFolder")}
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
                {!isTauri() && (
                  <p className="text-list text-muted-foreground">
                    {t("settings.claudeAiExports.webPathHint")}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor={labelInputId} className="text-list">
                  {t("settings.claudeAiExports.label")}
                </Label>
                <Input
                  id={labelInputId}
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder={t("settings.claudeAiExports.labelPlaceholder")}
                  className="h-8 text-list"
                />
              </div>

              {addError && (
                <p role="alert" className="text-list text-destructive">
                  {addError}
                </p>
              )}

              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="sm" className="h-7 text-list" onClick={resetForm}>
                  {t("common.cancel")}
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-list"
                  onClick={handleAdd}
                  disabled={!newPath.trim() || isSaving}
                >
                  {t("settings.claudeAiExports.add")}
                </Button>
              </div>
            </div>
          ) : !readOnly ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-8 text-list"
              onClick={() => setIsAdding(true)}
            >
              <Plus className="h-3.5 w-3.5 mr-2" />
              {t("settings.claudeAiExports.add")}
            </Button>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
