/**
 * ActionPanel Component
 *
 * Sidebar actions for Export/Import functionality.
 * Condensed version of the export/import features.
 */

import * as React from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/services/api";
import { saveFileDialog, openFileDialog } from "@/utils/fileDialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, Upload, AlertCircle } from "lucide-react";
import { useSettingsManager } from "../UnifiedSettingsManager";
import type { ClaudeCodeSettings, SettingsScope } from "@/types";
import { Alert, AlertDescription } from "@/components/ui/alert";

// ============================================================================
// Component
// ============================================================================

export const ActionPanel: React.FC = () => {
  const { t } = useTranslation();
  const { allSettings, activeScope, projectPath, loadSettings } = useSettingsManager();

  // State
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [excludeSensitive, setExcludeSensitive] = useState(true);
  const [importScope, setImportScope] = useState<SettingsScope>("user");
  const [importedSettings, setImportedSettings] = useState<ClaudeCodeSettings | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Get settings for export
  const getExportSettings = (): ClaudeCodeSettings => {
    if (!allSettings) return {};
    const content = allSettings[activeScope];
    if (!content) return {};
    try {
      return JSON.parse(content) as ClaudeCodeSettings;
    } catch {
      return {};
    }
  };

  // Remove sensitive data
  const sanitizeSettings = (settings: ClaudeCodeSettings): ClaudeCodeSettings => {
    const sanitized = { ...settings };

    if (sanitized.mcpServers) {
      sanitized.mcpServers = Object.fromEntries(
        Object.entries(sanitized.mcpServers).map(([name, config]) => {
          if (config.env) {
            const sanitizedEnv = Object.fromEntries(
              Object.entries(config.env).map(([key, value]) => {
                if (
                  key.toLowerCase().includes("key") ||
                  key.toLowerCase().includes("token") ||
                  key.toLowerCase().includes("secret")
                ) {
                  return [key, "YOUR_" + key.toUpperCase() + "_HERE"];
                }
                return [key, value];
              })
            );
            return [name, { ...config, env: sanitizedEnv }];
          }
          return [name, config];
        })
      );
    }

    return sanitized;
  };

  // Check if current scope has settings
  const hasSettings = allSettings?.[activeScope] != null;

  // Handle export
  const handleExport = async () => {
    if (!hasSettings) return;

    setIsExporting(true);
    setExportError(null);
    try {
      const currentSettings = getExportSettings();
      const settingsToExport = excludeSensitive
        ? sanitizeSettings(currentSettings)
        : currentSettings;

      const saved = await saveFileDialog(JSON.stringify(settingsToExport, null, 2), {
        filters: [{ name: "JSON", extensions: ["json"] }],
        defaultPath: `claude-settings-${activeScope}.json`,
      });

      if (saved) {
        setIsExportOpen(false);
      }
    } catch (error) {
      console.error("Export failed:", error);
      setExportError(String(error));
    } finally {
      setIsExporting(false);
    }
  };

  // Handle import file selection
  const handleImportSelect = async () => {
    setIsImporting(true);
    try {
      const content = await openFileDialog({
        filters: [{ name: "JSON", extensions: ["json"] }],
      });

      if (content) {
        const parsed = JSON.parse(content) as ClaudeCodeSettings;
        setImportedSettings(parsed);
        setImportError(null);
        setIsImportOpen(true);
      }
    } catch (error) {
      console.error("Import failed:", error);
      setImportError(String(error));
      setIsImportOpen(true);
    } finally {
      setIsImporting(false);
    }
  };

  // Apply imported settings
  const handleApplyImport = async () => {
    if (!importedSettings) return;

    setImportError(null);
    try {
      await api("save_settings", {
        scope: importScope,
        content: JSON.stringify(importedSettings, null, 2),
        projectPath: importScope !== "user" ? projectPath : undefined,
      });

      await loadSettings();
      setIsImportOpen(false);
      setImportedSettings(null);
    } catch (error) {
      console.error("Apply import failed:", error);
      setImportError(String(error));
    }
  };

  return (
    <div className="space-y-1">
      {/* Export Button */}
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start h-8 text-muted-foreground hover:text-accent hover:bg-accent/10 transition-colors duration-150"
        onClick={() => setIsExportOpen(true)}
        disabled={!hasSettings}
      >
        <Download className="w-4 h-4 mr-2 text-muted-foreground" />
        {t("settingsManager.exportImport.export")}
      </Button>

      {/* Import Button */}
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start h-8 text-muted-foreground hover:text-accent hover:bg-accent/10 transition-colors duration-150"
        onClick={handleImportSelect}
        disabled={isImporting}
      >
        <Upload className="w-4 h-4 mr-2 text-muted-foreground" />
        {isImporting
          ? t("common.loading")
          : t("settingsManager.exportImport.import")}
      </Button>

      {/* Export Dialog */}
      <Dialog open={isExportOpen} onOpenChange={setIsExportOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("settingsManager.exportImport.export")}</DialogTitle>
            <DialogDescription>
              {t("settingsManager.exportImport.exportDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="text-sm">
              <span className="text-muted-foreground">
                {t("settingsManager.exportImport.exportScope")}:
              </span>{" "}
              <span className="font-medium">
                {t(`settingsManager.scope.${activeScope}`)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={excludeSensitive}
                onCheckedChange={setExcludeSensitive}
                id="exclude-sensitive"
              />
              <Label htmlFor="exclude-sensitive" className="text-sm">
                {t("settingsManager.exportImport.excludeSensitive")}
              </Label>
            </div>
          </div>
          {exportError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">{exportError}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsExportOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleExport} disabled={isExporting}>
              <Download className="w-4 h-4 mr-2" />
              {isExporting
                ? t("common.loading")
                : t("settingsManager.exportImport.exportButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Preview Dialog */}
      <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {t("settingsManager.exportImport.previewTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 flex-1 overflow-hidden">
            <div>
              <Label>{t("settingsManager.exportImport.targetScope")}</Label>
              <Select
                value={importScope}
                onValueChange={(v) => setImportScope(v as SettingsScope)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">
                    {t("settingsManager.scope.user")}
                  </SelectItem>
                  <SelectItem value="project" disabled={!projectPath}>
                    {t("settingsManager.scope.project")}
                  </SelectItem>
                  <SelectItem value="local" disabled={!projectPath}>
                    {t("settingsManager.scope.local")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 overflow-auto">
              <Label>{t("settingsManager.exportImport.preview")}</Label>
              <pre className="bg-muted p-3 rounded-lg text-xs overflow-auto max-h-[200px] font-mono mt-1">
                {importedSettings ? JSON.stringify(importedSettings, null, 2) : ""}
              </pre>
            </div>
          </div>
          {importError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">{importError}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsImportOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleApplyImport} disabled={!importedSettings}>
              {t("settingsManager.exportImport.apply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
