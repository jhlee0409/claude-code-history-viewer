import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { usePresets } from "@/hooks/usePresets";
import type { PresetData, ClaudeCodeSettings, SettingsScope } from "@/types";
import { formatPresetDate } from "@/types";
import { ChevronDown, AlertCircle, Settings2, FileJson, Eye, Calendar, Hash } from "lucide-react";

interface PresetManagerProps {
  currentSettings: ClaudeCodeSettings;
  activeScope: SettingsScope;
  onApplyPreset: (settings: ClaudeCodeSettings) => void;
}

export const PresetManager: React.FC<PresetManagerProps> = ({
  currentSettings,
  activeScope,
  onApplyPreset,
}) => {
  const { t } = useTranslation();
  const { presets, isLoading, error, savePreset, deletePreset } = usePresets();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isApplyOpen, setIsApplyOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<PresetData | null>(null);
  const [newPresetName, setNewPresetName] = useState("");
  const [newPresetDescription, setNewPresetDescription] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isJsonExpanded, setIsJsonExpanded] = useState(false);
  const [isDetailJsonExpanded, setIsDetailJsonExpanded] = useState(false);

  // Compute settings summary for better UX
  const settingsSummary = useMemo(() => {
    const keys = Object.keys(currentSettings);
    const hasModel = "model" in currentSettings;
    const hasMcp = "mcpServers" in currentSettings && Object.keys(currentSettings.mcpServers || {}).length > 0;
    const hasPermissions = "permissions" in currentSettings;
    const hasApiKey = "apiKeyHelper" in currentSettings || "primaryApiKey" in currentSettings;

    return {
      totalKeys: keys.length,
      isEmpty: keys.length === 0,
      highlights: [
        hasModel && currentSettings.model,
        hasMcp && `MCP: ${Object.keys(currentSettings.mcpServers || {}).length}`,
        hasPermissions && "Permissions",
        hasApiKey && "API Key",
      ].filter(Boolean) as string[],
    };
  }, [currentSettings]);

  const handleCreatePreset = async () => {
    if (!newPresetName.trim()) return;

    await savePreset({
      name: newPresetName.trim(),
      description: newPresetDescription.trim() || undefined,
      settings: JSON.stringify(currentSettings, null, 2),
    });

    setNewPresetName("");
    setNewPresetDescription("");
    setIsCreateOpen(false);
  };

  const handleApplyPreset = async () => {
    if (!selectedPreset) return;

    try {
      const settings = JSON.parse(selectedPreset.settings) as ClaudeCodeSettings;
      onApplyPreset(settings);
      setIsApplyOpen(false);
      setSelectedPreset(null);
    } catch (e) {
      console.error("Failed to parse preset settings:", e);
    }
  };

  const handleDeletePreset = async (id: string) => {
    await deletePreset(id);
    setDeleteConfirmId(null);
  };

  const openApplyDialog = async (preset: PresetData) => {
    setSelectedPreset(preset);
    setIsApplyOpen(true);
  };

  const openDetailDialog = (preset: PresetData) => {
    setSelectedPreset(preset);
    setIsDetailJsonExpanded(false);
    setIsDetailOpen(true);
  };

  // Compute summary for a preset's settings
  const getPresetSummary = (preset: PresetData) => {
    try {
      const settings = JSON.parse(preset.settings) as ClaudeCodeSettings;
      const keys = Object.keys(settings);
      const hasModel = "model" in settings;
      const hasMcp = "mcpServers" in settings && Object.keys(settings.mcpServers || {}).length > 0;
      const hasPermissions = "permissions" in settings;
      const hasApiKey = "apiKeyHelper" in settings || "primaryApiKey" in settings;

      return {
        settings,
        totalKeys: keys.length,
        highlights: [
          hasModel && settings.model,
          hasMcp && `MCP: ${Object.keys(settings.mcpServers || {}).length}`,
          hasPermissions && "Permissions",
          hasApiKey && "API Key",
        ].filter(Boolean) as string[],
      };
    } catch {
      return { settings: {}, totalKeys: 0, highlights: [] };
    }
  };

  if (isLoading && presets.length === 0) {
    return <div className="text-center py-8">{t("common.loading")}</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header with Create Button */}
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">
          {t("settingsManager.presets.title")}
        </h3>
        <Button onClick={() => setIsCreateOpen(true)}>
          {t("settingsManager.presets.create")}
        </Button>
      </div>

      {/* Error Display */}
      {error && <div className="text-destructive text-sm">{error}</div>}

      {/* Preset List */}
      {presets.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            {t("settingsManager.presets.empty")}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {presets.map((preset) => (
            <Card key={preset.id} variant="interactive">
              <CardHeader className="py-3">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-base">{preset.name}</CardTitle>
                    {preset.description && (
                      <CardDescription>{preset.description}</CardDescription>
                    )}
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatPresetDate(preset.createdAt)}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openDetailDialog(preset)}
                    >
                      <Eye className="w-4 h-4 mr-1" />
                      {t("settingsManager.presets.viewDetail")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openApplyDialog(preset)}
                    >
                      {t("settingsManager.presets.apply")}
                    </Button>
                    {deleteConfirmId === preset.id ? (
                      <>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeletePreset(preset.id)}
                        >
                          {t("common.delete")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteConfirmId(null)}
                        >
                          {t("common.cancel")}
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteConfirmId(preset.id)}
                      >
                        {t("common.delete")}
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {/* Create Preset Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={(open) => {
        setIsCreateOpen(open);
        if (!open) setIsJsonExpanded(false);
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="w-5 h-5" />
              {t("settingsManager.presets.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("settingsManager.presets.sourceScope")}: <span className="font-medium text-foreground">{t(`settingsManager.scope.${activeScope}`)}</span>
            </DialogDescription>
          </DialogHeader>

          {/* Empty Settings Warning */}
          {settingsSummary.isEmpty ? (
            <div className="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
              <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-destructive">
                  {t("settingsManager.presets.emptyWarningTitle")}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("settingsManager.presets.emptyWarningDesc")}
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Settings Summary Card */}
              <div className="bg-muted border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">
                    {t("settingsManager.presets.settingsCount", { count: settingsSummary.totalKeys })}
                  </span>
                </div>
                {settingsSummary.highlights.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {settingsSummary.highlights.map((highlight, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 bg-accent/10 text-accent text-xs rounded-full"
                      >
                        {highlight}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Form Fields */}
              <div className="space-y-4">
                <div>
                  <Label htmlFor="preset-name">{t("settingsManager.presets.name")}</Label>
                  <Input
                    id="preset-name"
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                    placeholder={t("settingsManager.presets.namePlaceholder")}
                    className="mt-1.5"
                    autoFocus
                  />
                </div>
                <div>
                  <Label htmlFor="preset-desc">{t("settingsManager.presets.description")}</Label>
                  <Textarea
                    id="preset-desc"
                    value={newPresetDescription}
                    onChange={(e) => setNewPresetDescription(e.target.value)}
                    placeholder={t("settingsManager.presets.descriptionPlaceholder")}
                    className="mt-1.5 resize-none"
                    rows={2}
                  />
                </div>
              </div>

              {/* Collapsible JSON Preview */}
              <Collapsible open={isJsonExpanded} onOpenChange={setIsJsonExpanded}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between px-3 h-9">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <FileJson className="w-4 h-4" />
                      {t("settingsManager.presets.viewJson")}
                    </span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${isJsonExpanded ? "rotate-180" : ""}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="bg-muted p-3 rounded-lg text-xs overflow-auto max-h-[150px] font-mono mt-2">
                    {JSON.stringify(currentSettings, null, 2)}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            </>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleCreatePreset}
              disabled={!newPresetName.trim() || settingsSummary.isEmpty}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Apply Preset Dialog */}
      <Dialog open={isApplyOpen} onOpenChange={setIsApplyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("settingsManager.presets.applyTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p>
              {t("settingsManager.presets.applyDescription", {
                name: selectedPreset?.name,
              })}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsApplyOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleApplyPreset}>
              {t("settingsManager.presets.apply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preset Detail Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="w-5 h-5" />
              {selectedPreset?.name}
            </DialogTitle>
            {selectedPreset?.description && (
              <DialogDescription>{selectedPreset.description}</DialogDescription>
            )}
          </DialogHeader>

          {selectedPreset && (() => {
            const summary = getPresetSummary(selectedPreset);
            return (
              <div className="space-y-4">
                {/* Metadata */}
                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" />
                    {formatPresetDate(selectedPreset.createdAt)}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Hash className="w-4 h-4" />
                    {t("settingsManager.presets.settingsCount", { count: summary.totalKeys })}
                  </div>
                </div>

                {/* Settings Summary */}
                {summary.highlights.length > 0 && (
                  <div className="bg-muted border rounded-lg p-4">
                    <div className="text-sm font-medium mb-2">
                      {t("settingsManager.presets.includedSettings")}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {summary.highlights.map((highlight, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 bg-accent/10 text-accent text-xs rounded-full"
                        >
                          {highlight}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Collapsible JSON View */}
                <Collapsible open={isDetailJsonExpanded} onOpenChange={setIsDetailJsonExpanded}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-full justify-between px-3 h-9">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <FileJson className="w-4 h-4" />
                        {t("settingsManager.presets.viewJson")}
                      </span>
                      <ChevronDown className={`w-4 h-4 transition-transform ${isDetailJsonExpanded ? "rotate-180" : ""}`} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <pre className="bg-muted p-3 rounded-lg text-xs overflow-auto max-h-[200px] font-mono mt-2">
                      {JSON.stringify(summary.settings, null, 2)}
                    </pre>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            );
          })()}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDetailOpen(false)}>
              {t("common.close")}
            </Button>
            <Button onClick={() => {
              setIsDetailOpen(false);
              if (selectedPreset) {
                openApplyDialog(selectedPreset);
              }
            }}>
              {t("settingsManager.presets.apply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
