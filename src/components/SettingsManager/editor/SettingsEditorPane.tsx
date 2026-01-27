/**
 * SettingsEditorPane Component
 *
 * Main editor area containing:
 * - Effective settings banner (collapsible)
 * - Accordion sections for different setting categories
 * - Footer with Save/Reset/JSON Mode actions
 */

import * as React from "react";
import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, XCircle } from "lucide-react";
import { useSettingsManager } from "../UnifiedSettingsManager";
import { EffectiveSummaryBanner } from "./EffectiveSummaryBanner";
import { EditorFooter } from "./EditorFooter";
import { GeneralSection } from "../sections/GeneralSection";
import { PermissionsSection } from "../sections/PermissionsSection";
import { MCPServersSection } from "../sections/MCPServersSection";
import { HooksSection } from "../sections/HooksSection";
import { EnvVarsSection } from "../sections/EnvVarsSection";
import { CustomFieldsSection } from "../sections/CustomFieldsSection";
import { EmptyState } from "../components/EmptyState";
import type { ClaudeCodeSettings } from "@/types";

// ============================================================================
// Types
// ============================================================================

export type EditorMode = "visual" | "json";

// ============================================================================
// Component
// ============================================================================

// Save result feedback type
type SaveResult = {
  type: "success" | "error";
  message: string;
} | null;

export const SettingsEditorPane: React.FC = () => {
  const { t } = useTranslation();
  const {
    allSettings,
    activeScope,
    currentSettings,
    isReadOnly,
    saveSettings,
  } = useSettingsManager();

  // Editor mode state
  const [editorMode, setEditorMode] = useState<EditorMode>("visual");

  // Pending changes state (for dirty tracking)
  const [pendingSettings, setPendingSettings] = useState<ClaudeCodeSettings | null>(null);

  // Save operation state
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveResult>(null);

  // Expanded sections state
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["general", "mcp"])
  );

  // Clear save result after delay
  React.useEffect(() => {
    if (saveResult) {
      const timer = setTimeout(() => setSaveResult(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [saveResult]);

  // Check if current scope has settings
  const hasSettings = allSettings?.[activeScope] !== null;

  // Get effective settings (pending or current)
  const effectiveSettings = pendingSettings ?? currentSettings;

  // Check if there are unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    if (!pendingSettings) return false;
    return JSON.stringify(pendingSettings) !== JSON.stringify(currentSettings);
  }, [pendingSettings, currentSettings]);

  // Handle section toggle
  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  // Handle settings change from a section
  const handleSettingsChange = (updates: Partial<ClaudeCodeSettings>) => {
    setPendingSettings((prev) => ({
      ...(prev ?? currentSettings),
      ...updates,
    }));
  };

  // Handle save with feedback
  const handleSave = useCallback(async () => {
    if (!pendingSettings || isSaving) return;

    setIsSaving(true);
    setSaveResult(null);

    try {
      await saveSettings(pendingSettings);
      setPendingSettings(null);
      setSaveResult({
        type: "success",
        message: t("settingsManager.save.success"),
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setSaveResult({
        type: "error",
        message: t("settingsManager.save.error", { error: errorMessage }),
      });
    } finally {
      setIsSaving(false);
    }
  }, [pendingSettings, isSaving, saveSettings, t]);

  // Handle reset
  const handleReset = () => {
    setPendingSettings(null);
  };

  // Reset pending settings when scope changes
  React.useEffect(() => {
    setPendingSettings(null);
  }, [activeScope]);

  // If no settings exist for this scope
  if (!hasSettings) {
    return (
      <main className="flex-1 min-w-0 overflow-auto">
        <EmptyState scope={activeScope} />
      </main>
    );
  }

  return (
    <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
      {/* Effective Settings Banner */}
      {allSettings && (
        <EffectiveSummaryBanner allSettings={allSettings} />
      )}

      {/* Main Editor Content */}
      <Card className="flex-1 flex flex-col overflow-hidden">
        <CardContent className="flex-1 overflow-auto p-4">
          {editorMode === "visual" ? (
            <div className="space-y-2">
              {/* General Section */}
              <GeneralSection
                settings={effectiveSettings}
                isExpanded={expandedSections.has("general")}
                onToggle={() => toggleSection("general")}
                onChange={handleSettingsChange}
                readOnly={isReadOnly}
              />

              {/* Permissions Section */}
              <PermissionsSection
                settings={effectiveSettings}
                isExpanded={expandedSections.has("permissions")}
                onToggle={() => toggleSection("permissions")}
                onChange={handleSettingsChange}
                readOnly={isReadOnly}
              />

              {/* MCP Servers Section */}
              <MCPServersSection
                isExpanded={expandedSections.has("mcp")}
                onToggle={() => toggleSection("mcp")}
                readOnly={isReadOnly}
              />

              {/* Hooks Section */}
              <HooksSection
                settings={effectiveSettings}
                isExpanded={expandedSections.has("hooks")}
                onToggle={() => toggleSection("hooks")}
                onChange={handleSettingsChange}
                readOnly={isReadOnly}
              />

              {/* Environment Variables Section */}
              <EnvVarsSection
                settings={effectiveSettings}
                isExpanded={expandedSections.has("env")}
                onToggle={() => toggleSection("env")}
                onChange={handleSettingsChange}
                readOnly={isReadOnly}
              />

              {/* Custom Fields Section */}
              <CustomFieldsSection
                settings={effectiveSettings}
                isExpanded={expandedSections.has("custom")}
                onToggle={() => toggleSection("custom")}
                onChange={handleSettingsChange}
                readOnly={isReadOnly}
              />
            </div>
          ) : (
            // JSON Mode
            <div className="h-full">
              <pre className="bg-muted p-4 rounded-lg text-sm font-mono overflow-auto h-full">
                {JSON.stringify(effectiveSettings, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>

        {/* Save Result Feedback */}
        {saveResult && (
          <div className="px-4 pb-2">
            <Alert
              variant={saveResult.type === "error" ? "destructive" : "default"}
              className={saveResult.type === "success" ? "border-green-500 bg-green-50 dark:bg-green-950/20" : ""}
            >
              {saveResult.type === "success" ? (
                <CheckCircle className="h-4 w-4 text-green-600" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              <AlertDescription className="text-sm">
                {saveResult.message}
              </AlertDescription>
            </Alert>
          </div>
        )}

        {/* Footer */}
        <EditorFooter
          editorMode={editorMode}
          onModeChange={setEditorMode}
          hasUnsavedChanges={hasUnsavedChanges}
          onSave={handleSave}
          onReset={handleReset}
          readOnly={isReadOnly}
          isSaving={isSaving}
        />
      </Card>
    </main>
  );
};
