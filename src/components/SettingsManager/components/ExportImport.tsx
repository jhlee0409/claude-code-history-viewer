import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Download, Upload, Archive, FolderOpen, ShieldAlert } from "lucide-react";
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
import type { ClaudeCodeSettings, SettingsScope, AllSettingsResponse } from "@/types";
import { isSensitiveKey, analyzeSensitiveData } from "@/utils/securityUtils";

// Backup file format for Export All / Import All
interface SettingsBackup {
  version: number;
  exportedAt: string;
  scopes: {
    user?: ClaudeCodeSettings;
    project?: ClaudeCodeSettings;
    local?: ClaudeCodeSettings;
  };
}

interface ExportImportProps {
  allSettings: AllSettingsResponse | null;
  projectPath?: string;
  onImport?: () => void;
}

export const ExportImport: React.FC<ExportImportProps> = ({
  allSettings,
  projectPath,
  onImport,
}) => {
  const { t } = useTranslation();
  const [exportScope, setExportScope] = useState<SettingsScope>("user");
  const [excludeSensitive, setExcludeSensitive] = useState(true);
  const [isImportPreviewOpen, setIsImportPreviewOpen] = useState(false);
  const [importedSettings, setImportedSettings] = useState<ClaudeCodeSettings | null>(null);
  const [importScope, setImportScope] = useState<SettingsScope>("user");
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Export All / Import All state
  const [isExportingAll, setIsExportingAll] = useState(false);
  const [isImportingAll, setIsImportingAll] = useState(false);
  const [isImportAllPreviewOpen, setIsImportAllPreviewOpen] = useState(false);
  const [importedBackup, setImportedBackup] = useState<SettingsBackup | null>(null);

  // Get settings for selected export scope
  const getExportSettings = (): ClaudeCodeSettings => {
    if (!allSettings) return {};
    const content = allSettings[exportScope];
    if (!content) return {};
    try {
      return JSON.parse(content) as ClaudeCodeSettings;
    } catch {
      return {};
    }
  };

  // Remove sensitive data from settings
  const sanitizeSettings = (settings: ClaudeCodeSettings): ClaudeCodeSettings => {
    const sanitized = { ...settings };

    // Sanitize top-level env vars
    if (sanitized.env) {
      sanitized.env = Object.fromEntries(
        Object.entries(sanitized.env).map(([key, value]) => {
          if (isSensitiveKey(key)) {
            return [key, "YOUR_" + key.toUpperCase() + "_HERE"];
          }
          return [key, value];
        })
      );
    }

    // Sanitize MCP server env vars
    if (sanitized.mcpServers) {
      sanitized.mcpServers = Object.fromEntries(
        Object.entries(sanitized.mcpServers).map(([name, config]) => {
          if (config.env) {
            const sanitizedEnv = Object.fromEntries(
              Object.entries(config.env).map(([key, value]) => {
                if (isSensitiveKey(key)) {
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

  // Analyze if current export settings contain sensitive data
  const sensitiveAnalysis = useMemo(() => {
    const settings = getExportSettings();
    return analyzeSensitiveData(settings);
  }, [allSettings, exportScope]);

  // Check if export scope has settings
  const hasExportSettings = allSettings != null && allSettings[exportScope] != null;

  const handleExport = async () => {
    if (!hasExportSettings) return;

    setIsExporting(true);
    try {
      const currentSettings = getExportSettings();
      const settingsToExport = excludeSensitive
        ? sanitizeSettings(currentSettings)
        : currentSettings;

      const filePath = await save({
        filters: [{ name: "JSON", extensions: ["json"] }],
        defaultPath: `claude-settings-${exportScope}.json`,
      });

      if (filePath) {
        await invoke("write_text_file", {
          path: filePath,
          content: JSON.stringify(settingsToExport, null, 2),
        });
      }
    } catch (error) {
      console.error("Export failed:", error);
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async () => {
    setIsImporting(true);
    try {
      const filePath = await open({
        filters: [{ name: "JSON", extensions: ["json"] }],
        multiple: false,
      });

      if (filePath && typeof filePath === "string") {
        const content = await invoke<string>("read_text_file", {
          path: filePath,
        });
        const parsed = JSON.parse(content) as ClaudeCodeSettings;
        setImportedSettings(parsed);
        setIsImportPreviewOpen(true);
      }
    } catch (error) {
      console.error("Import failed:", error);
    } finally {
      setIsImporting(false);
    }
  };

  const handleApplyImport = async () => {
    if (!importedSettings) return;

    // Validate projectPath for non-user scopes
    if (importScope !== "user" && !projectPath) {
      console.error("Apply import failed: projectPath is required for project/local scope");
      return;
    }

    try {
      await invoke("save_settings", {
        scope: importScope,
        content: JSON.stringify(importedSettings, null, 2),
        projectPath: importScope !== "user" ? projectPath : undefined,
      });

      onImport?.();
      setIsImportPreviewOpen(false);
      setImportedSettings(null);
    } catch (error) {
      console.error("Apply import failed:", error);
    }
  };

  // Parse settings for a scope
  const parseSettings = (content: string | null): ClaudeCodeSettings | undefined => {
    if (!content) return undefined;
    try {
      return JSON.parse(content) as ClaudeCodeSettings;
    } catch {
      return undefined;
    }
  };

  // Calculate available scopes for export all
  const availableScopesForExport = useMemo(() => {
    if (!allSettings) return [];
    const scopes: SettingsScope[] = [];
    if (allSettings.user) scopes.push("user");
    if (allSettings.project) scopes.push("project");
    if (allSettings.local) scopes.push("local");
    return scopes;
  }, [allSettings]);

  const hasAnySettings = availableScopesForExport.length > 0;

  // Export All handler
  const handleExportAll = async () => {
    if (!hasAnySettings) return;

    setIsExportingAll(true);
    try {
      const backup: SettingsBackup = {
        version: 1,
        exportedAt: new Date().toISOString(),
        scopes: {},
      };

      // Collect settings from all scopes
      if (allSettings?.user) {
        const settings = parseSettings(allSettings.user);
        if (settings) {
          backup.scopes.user = excludeSensitive ? sanitizeSettings(settings) : settings;
        }
      }
      if (allSettings?.project) {
        const settings = parseSettings(allSettings.project);
        if (settings) {
          backup.scopes.project = excludeSensitive ? sanitizeSettings(settings) : settings;
        }
      }
      if (allSettings?.local) {
        const settings = parseSettings(allSettings.local);
        if (settings) {
          backup.scopes.local = excludeSensitive ? sanitizeSettings(settings) : settings;
        }
      }

      const filePath = await save({
        filters: [{ name: "JSON", extensions: ["json"] }],
        defaultPath: `claude-settings-backup-${new Date().toISOString().split("T")[0]}.json`,
      });

      if (filePath) {
        await invoke("write_text_file", {
          path: filePath,
          content: JSON.stringify(backup, null, 2),
        });
      }
    } catch (error) {
      console.error("Export all failed:", error);
    } finally {
      setIsExportingAll(false);
    }
  };

  // Import All handler
  const handleImportAll = async () => {
    setIsImportingAll(true);
    try {
      const filePath = await open({
        filters: [{ name: "JSON", extensions: ["json"] }],
        multiple: false,
      });

      if (filePath && typeof filePath === "string") {
        const content = await invoke<string>("read_text_file", {
          path: filePath,
        });
        const parsed = JSON.parse(content) as SettingsBackup;

        // Validate backup format
        if (parsed.version && parsed.scopes) {
          setImportedBackup(parsed);
          setIsImportAllPreviewOpen(true);
        } else {
          console.error("Invalid backup format");
        }
      }
    } catch (error) {
      console.error("Import all failed:", error);
    } finally {
      setIsImportingAll(false);
    }
  };

  // Apply imported backup
  const handleApplyImportAll = async () => {
    if (!importedBackup) return;

    try {
      // Apply each scope
      if (importedBackup.scopes.user) {
        await invoke("save_settings", {
          scope: "user",
          content: JSON.stringify(importedBackup.scopes.user, null, 2),
        });
      }
      if (importedBackup.scopes.project) {
        if (!projectPath) {
          console.error("Cannot apply project scope: projectPath is undefined");
          return;
        }
        await invoke("save_settings", {
          scope: "project",
          content: JSON.stringify(importedBackup.scopes.project, null, 2),
          projectPath,
        });
      }
      if (importedBackup.scopes.local) {
        if (!projectPath) {
          console.error("Cannot apply local scope: projectPath is undefined");
          return;
        }
        await invoke("save_settings", {
          scope: "local",
          content: JSON.stringify(importedBackup.scopes.local, null, 2),
          projectPath,
        });
      }

      onImport?.();
      setIsImportAllPreviewOpen(false);
      setImportedBackup(null);
    } catch (error) {
      console.error("Apply import all failed:", error);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("settingsManager.exportImport.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Export Section */}
          <div className="space-y-3">
            <div>
              <Label>{t("settingsManager.exportImport.export")}</Label>
              <p className="text-sm text-muted-foreground">
                {t("settingsManager.exportImport.exportDescription")}
              </p>
            </div>

            {/* Export Scope Selection */}
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Label className="text-sm">{t("settingsManager.exportImport.exportScope")}</Label>
                <Select value={exportScope} onValueChange={(v) => setExportScope(v as SettingsScope)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user" disabled={allSettings?.user === null}>
                      {t("settingsManager.scope.user")} {allSettings?.user === null && "(empty)"}
                    </SelectItem>
                    <SelectItem value="project" disabled={allSettings?.project === null}>
                      {t("settingsManager.scope.project")} {allSettings?.project === null && "(empty)"}
                    </SelectItem>
                    <SelectItem value="local" disabled={allSettings?.local === null}>
                      {t("settingsManager.scope.local")} {allSettings?.local === null && "(empty)"}
                    </SelectItem>
                    <SelectItem value="managed" disabled={allSettings?.managed === null}>
                      {t("settingsManager.scope.managed")} {allSettings?.managed === null && "(empty)"}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleExport}
                disabled={isExporting || !hasExportSettings}
                className="mt-6"
              >
                <Download className="w-4 h-4 mr-2" />
                {isExporting ? t("common.loading") : t("settingsManager.exportImport.exportButton")}
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={excludeSensitive}
                onCheckedChange={setExcludeSensitive}
              />
              <Label className="text-sm">
                {t("settingsManager.exportImport.excludeSensitive")}
              </Label>
            </div>

            {/* Sensitive data warning */}
            {!excludeSensitive && (sensitiveAnalysis.hasEnvSecrets || sensitiveAnalysis.hasMcpSecrets) && (
              <Alert variant="destructive" className="mt-3">
                <ShieldAlert className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  {t("settingsManager.exportImport.sensitiveWarning", {
                    envCount: sensitiveAnalysis.envSecretCount,
                    mcpCount: sensitiveAnalysis.mcpServerWithSecretsCount,
                  })}
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div className="border-t pt-4" />

          {/* Import Section */}
          <div className="flex items-center justify-between">
            <div>
              <Label>{t("settingsManager.exportImport.import")}</Label>
              <p className="text-sm text-muted-foreground">
                {t("settingsManager.exportImport.importDescription")}
              </p>
            </div>
            <Button variant="outline" onClick={handleImport} disabled={isImporting}>
              <Upload className="w-4 h-4 mr-2" />
              {isImporting ? t("common.loading") : t("settingsManager.exportImport.importButton")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Export All / Import All Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Archive className="w-5 h-5" />
            {t("settingsManager.exportImport.exportAll")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Export All Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label>{t("settingsManager.exportImport.exportAll")}</Label>
                <p className="text-sm text-muted-foreground">
                  {t("settingsManager.exportImport.exportAllDescription")}
                </p>
              </div>
              <Button
                onClick={handleExportAll}
                disabled={isExportingAll || !hasAnySettings}
              >
                <Download className="w-4 h-4 mr-2" />
                {isExportingAll ? t("common.loading") : t("settingsManager.exportImport.exportAllButton")}
              </Button>
            </div>
            {hasAnySettings && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {t("settingsManager.exportImport.scopesIncluded")}:
                </span>
                {availableScopesForExport.map((scope) => (
                  <Badge key={scope} variant="secondary" className="text-xs">
                    {t(`settingsManager.scope.${scope}`)}
                  </Badge>
                ))}
              </div>
            )}
            {!hasAnySettings && (
              <p className="text-sm text-muted-foreground italic">
                {t("settingsManager.exportImport.noSettings")}
              </p>
            )}
          </div>

          <div className="border-t pt-4" />

          {/* Import All Section */}
          <div className="flex items-center justify-between">
            <div>
              <Label>{t("settingsManager.exportImport.importAll")}</Label>
              <p className="text-sm text-muted-foreground">
                {t("settingsManager.exportImport.importAllDescription")}
              </p>
            </div>
            <Button variant="outline" onClick={handleImportAll} disabled={isImportingAll}>
              <FolderOpen className="w-4 h-4 mr-2" />
              {isImportingAll ? t("common.loading") : t("settingsManager.exportImport.importAllButton")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Import Preview Dialog */}
      <Dialog open={isImportPreviewOpen} onOpenChange={setIsImportPreviewOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t("settingsManager.exportImport.previewTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 flex-1 overflow-hidden">
            <div>
              <Label>{t("settingsManager.exportImport.targetScope")}</Label>
              <Select value={importScope} onValueChange={(v) => setImportScope(v as SettingsScope)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">{t("settingsManager.scope.user")}</SelectItem>
                  <SelectItem value="project">{t("settingsManager.scope.project")}</SelectItem>
                  <SelectItem value="local">{t("settingsManager.scope.local")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 overflow-auto">
              <Label>{t("settingsManager.exportImport.preview")}</Label>
              <pre className="bg-muted p-4 rounded-lg text-sm overflow-auto max-h-[300px] font-mono">
                {importedSettings ? JSON.stringify(importedSettings, null, 2) : ""}
              </pre>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsImportPreviewOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleApplyImport}>
              {t("settingsManager.exportImport.apply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import All Preview Dialog */}
      <Dialog open={isImportAllPreviewOpen} onOpenChange={setIsImportAllPreviewOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t("settingsManager.exportImport.importAllPreviewTitle")}</DialogTitle>
            <DialogDescription>
              {importedBackup?.exportedAt && (
                <span className="text-xs">
                  Exported: {new Date(importedBackup.exportedAt).toLocaleString()}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 flex-1 overflow-hidden">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {t("settingsManager.exportImport.importAllConfirm")}
              </AlertDescription>
            </Alert>

            {importedBackup && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {t("settingsManager.exportImport.scopesIncluded")}:
                  </span>
                  {Object.keys(importedBackup.scopes).map((scope) => (
                    <Badge key={scope} variant="secondary" className="text-xs">
                      {t(`settingsManager.scope.${scope}`)}
                    </Badge>
                  ))}
                </div>

                <div className="flex-1 overflow-auto space-y-3">
                  {importedBackup.scopes.user && (
                    <div>
                      <Label className="text-xs font-medium">
                        {t("settingsManager.scope.user")}
                      </Label>
                      <pre className="bg-muted p-3 rounded text-xs overflow-auto max-h-[120px] font-mono">
                        {JSON.stringify(importedBackup.scopes.user, null, 2)}
                      </pre>
                    </div>
                  )}
                  {importedBackup.scopes.project && (
                    <div>
                      <Label className="text-xs font-medium">
                        {t("settingsManager.scope.project")}
                      </Label>
                      <pre className="bg-muted p-3 rounded text-xs overflow-auto max-h-[120px] font-mono">
                        {JSON.stringify(importedBackup.scopes.project, null, 2)}
                      </pre>
                    </div>
                  )}
                  {importedBackup.scopes.local && (
                    <div>
                      <Label className="text-xs font-medium">
                        {t("settingsManager.scope.local")}
                      </Label>
                      <pre className="bg-muted p-3 rounded text-xs overflow-auto max-h-[120px] font-mono">
                        {JSON.stringify(importedBackup.scopes.local, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsImportAllPreviewOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleApplyImportAll} variant="destructive">
              {t("settingsManager.exportImport.apply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
