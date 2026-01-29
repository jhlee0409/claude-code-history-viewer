/**
 * SettingsEditorPane Component
 *
 * Main editor area containing:
 * - Effective settings banner (collapsible)
 * - Accordion sections for different setting categories
 * - Footer with Save/Reset/JSON Mode actions
 */

import * as React from "react";
import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Braces, Undo2, Redo2 } from "lucide-react";
import { useSettingsManager } from "../UnifiedSettingsManager";
import { EffectiveSummaryBanner } from "./EffectiveSummaryBanner";
import { EditorFooter } from "./EditorFooter";
import { GeneralSection } from "../sections/GeneralSection";
import { PermissionsSection } from "../sections/PermissionsSection";
import { MCPServersSection } from "../sections/MCPServersSection";
import { HooksSection } from "../sections/HooksSection";
import { EnvVarsSection } from "../sections/EnvVarsSection";
import { EmptyState } from "../components/EmptyState";
import type { ClaudeCodeSettings } from "@/types";

// ============================================================================
// JSON Editor Hook - undo/redo history management
// ============================================================================

function useJsonEditorHistory(initialText: string) {
  const [history, setHistory] = useState<string[]>([initialText]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const currentText = history[historyIndex] ?? initialText;

  const pushText = useCallback((text: string) => {
    setHistory((prev) => {
      const next = prev.slice(0, historyIndex + 1);
      next.push(text);
      return next;
    });
    setHistoryIndex((prev) => prev + 1);
  }, [historyIndex]);

  const undo = useCallback(() => {
    setHistoryIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const redo = useCallback(() => {
    setHistoryIndex((prev) => Math.min(history.length - 1, prev + 1));
  }, [history.length]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const reset = useCallback((text: string) => {
    setHistory([text]);
    setHistoryIndex(0);
  }, []);

  return { currentText, pushText, undo, redo, canUndo, canRedo, reset };
}

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
    pendingSettings,
    setPendingSettings,
    hasUnsavedChanges,
  } = useSettingsManager();

  // Get effective settings (pending or current) - must be before JSON editor init
  const effectiveSettings = pendingSettings ?? currentSettings;

  // Editor mode state
  const [editorMode, setEditorMode] = useState<EditorMode>("visual");

  // JSON editor state
  const [jsonError, setJsonError] = useState<string | null>(null);
  const jsonEditorRef = useRef<HTMLTextAreaElement>(null);
  const jsonHistory = useJsonEditorHistory(
    JSON.stringify(effectiveSettings, null, 2)
  );

  // Sync JSON editor when switching to JSON mode or when settings change externally
  const prevModeRef = useRef<EditorMode>("visual");
  useEffect(() => {
    if (editorMode === "json" && prevModeRef.current === "visual") {
      jsonHistory.reset(JSON.stringify(effectiveSettings, null, 2));
      setJsonError(null);
    }
    prevModeRef.current = editorMode;
  }, [editorMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle JSON text change from textarea
  const handleJsonChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    jsonHistory.pushText(text);
    try {
      JSON.parse(text);
      setJsonError(null);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : String(err));
    }
  }, [jsonHistory]);

  // Format JSON
  const handleFormatJson = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonHistory.currentText);
      const formatted = JSON.stringify(parsed, null, 2);
      if (formatted !== jsonHistory.currentText) {
        jsonHistory.pushText(formatted);
      }
      setJsonError(null);
    } catch {
      // Can't format invalid JSON - error already shown
    }
  }, [jsonHistory]);

  // Apply JSON changes to pending settings
  const handleApplyJsonToSettings = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonHistory.currentText) as ClaudeCodeSettings;
      setPendingSettings(parsed);
      setJsonError(null);
      return true;
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, [jsonHistory.currentText, setPendingSettings]);

  // Handle mode change - apply JSON edits when leaving JSON mode
  const handleModeChange = useCallback((mode: EditorMode) => {
    if (editorMode === "json" && mode === "visual") {
      // Try to apply JSON changes before switching
      const jsonText = jsonHistory.currentText;
      const currentJson = JSON.stringify(effectiveSettings, null, 2);
      if (jsonText !== currentJson) {
        try {
          const parsed = JSON.parse(jsonText) as ClaudeCodeSettings;
          setPendingSettings(parsed);
        } catch {
          // Don't switch if JSON is invalid
          return;
        }
      }
    }
    setEditorMode(mode);
  }, [editorMode, jsonHistory.currentText, effectiveSettings, setPendingSettings]);

  // Keyboard shortcuts for JSON editor
  const handleJsonKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isMod = e.metaKey || e.ctrlKey;
    if (isMod && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      jsonHistory.undo();
    } else if (isMod && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
      e.preventDefault();
      jsonHistory.redo();
    } else if (isMod && e.key === "s") {
      e.preventDefault();
      if (handleApplyJsonToSettings()) {
        handleSave();
      }
    }
  }, [jsonHistory, handleApplyJsonToSettings]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save operation state
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveResult>(null);

  // Expanded sections state
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["general", "mcp"])
  );

  // Section refs for scrolling
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Clear save result after delay
  React.useEffect(() => {
    if (saveResult) {
      const timer = setTimeout(() => setSaveResult(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [saveResult]);

  // Check if current scope has settings
  const hasSettings = allSettings?.[activeScope] != null;

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
    if (isSaving) return;

    // In JSON mode, apply current JSON text to pendingSettings first
    if (editorMode === "json") {
      if (!handleApplyJsonToSettings()) return;
    }

    // Re-check after potential JSON apply
    const settingsToSave = editorMode === "json"
      ? (() => { try { return JSON.parse(jsonHistory.currentText) as ClaudeCodeSettings; } catch { return null; } })()
      : pendingSettings;

    if (!settingsToSave) return;

    setIsSaving(true);
    setSaveResult(null);

    try {
      await saveSettings(settingsToSave);
      setPendingSettings(null);
      if (editorMode === "json") {
        jsonHistory.reset(JSON.stringify(settingsToSave, null, 2));
        setJsonError(null);
      }
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
  }, [pendingSettings, isSaving, saveSettings, t, editorMode, handleApplyJsonToSettings, jsonHistory]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle reset
  const handleReset = useCallback(() => {
    setPendingSettings(null);
    if (editorMode === "json") {
      jsonHistory.reset(JSON.stringify(currentSettings, null, 2));
      setJsonError(null);
    }
  }, [editorMode, currentSettings, jsonHistory, setPendingSettings]);

  // If no settings exist for this scope
  if (!hasSettings) {
    return (
      <main className="flex-1 min-w-0 overflow-auto">
        <EmptyState scope={activeScope} />
      </main>
    );
  }

  return (
    <main className="flex-1 min-w-0 min-h-0 flex flex-col">
      {/* Main Editor Content */}
      <Card className="flex-1 min-h-0 flex flex-col">
        <CardContent className="flex-1 min-h-0 p-4 overflow-y-auto">
          {editorMode === "visual" ? (
            <div className="space-y-2">
              {/* General Section */}
              <div ref={(el) => { sectionRefs.current["general"] = el; }}>
                <GeneralSection
                  settings={effectiveSettings}
                  isExpanded={expandedSections.has("general")}
                  onToggle={() => toggleSection("general")}
                  onChange={handleSettingsChange}
                  readOnly={isReadOnly}
                />
              </div>

              {/* Permissions Section */}
              <div ref={(el) => { sectionRefs.current["permissions"] = el; }}>
                <PermissionsSection
                  settings={effectiveSettings}
                  isExpanded={expandedSections.has("permissions")}
                  onToggle={() => toggleSection("permissions")}
                  onChange={handleSettingsChange}
                  readOnly={isReadOnly}
                />
              </div>

              {/* MCP Servers Section */}
              <div ref={(el) => { sectionRefs.current["mcp"] = el; }}>
                <MCPServersSection
                  isExpanded={expandedSections.has("mcp")}
                  onToggle={() => toggleSection("mcp")}
                  readOnly={isReadOnly}
                />
              </div>

              {/* Hooks Section */}
              <div ref={(el) => { sectionRefs.current["hooks"] = el; }}>
                <HooksSection
                  settings={effectiveSettings}
                  isExpanded={expandedSections.has("hooks")}
                  onToggle={() => toggleSection("hooks")}
                  onChange={handleSettingsChange}
                  readOnly={isReadOnly}
                />
              </div>

              {/* Environment Variables Section */}
              <div ref={(el) => { sectionRefs.current["env"] = el; }}>
                <EnvVarsSection
                  settings={effectiveSettings}
                  isExpanded={expandedSections.has("env")}
                  onToggle={() => toggleSection("env")}
                  onChange={handleSettingsChange}
                  readOnly={isReadOnly}
                />
              </div>
            </div>
          ) : (
            // JSON Mode - Editable
            <div className="h-full flex flex-col gap-2">
              {/* JSON Toolbar */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 gap-1.5 text-xs"
                  onClick={handleFormatJson}
                  disabled={isReadOnly || !!jsonError}
                  aria-label={t("settingsManager.json.format")}
                >
                  <Braces className="w-3.5 h-3.5" />
                  {t("settingsManager.json.format")}
                </Button>
                <div className="w-px h-4 bg-border/40 mx-1" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 gap-1"
                  onClick={jsonHistory.undo}
                  disabled={!jsonHistory.canUndo || isReadOnly}
                  aria-label={t("settingsManager.json.undo")}
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 gap-1"
                  onClick={jsonHistory.redo}
                  disabled={!jsonHistory.canRedo || isReadOnly}
                  aria-label={t("settingsManager.json.redo")}
                >
                  <Redo2 className="w-3.5 h-3.5" />
                </Button>
                {jsonError && (
                  <span className="ml-2 text-xs text-destructive truncate">
                    {t("settingsManager.json.invalidJson")}: {jsonError}
                  </span>
                )}
              </div>
              {/* JSON Textarea */}
              <textarea
                ref={jsonEditorRef}
                className="flex-1 min-h-0 w-full bg-muted p-4 rounded-lg text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring border border-border/40"
                value={jsonHistory.currentText}
                onChange={handleJsonChange}
                onKeyDown={handleJsonKeyDown}
                onBlur={handleApplyJsonToSettings}
                readOnly={isReadOnly}
                spellCheck={false}
                aria-label={t("settingsManager.mode.json")}
              />
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
          onModeChange={handleModeChange}
          hasUnsavedChanges={hasUnsavedChanges || (editorMode === "json" && jsonHistory.currentText !== JSON.stringify(currentSettings, null, 2))}
          onSave={handleSave}
          onReset={handleReset}
          readOnly={isReadOnly}
          isSaving={isSaving}
          hasJsonError={editorMode === "json" && !!jsonError}
        />
      </Card>

      {/* What's Active? - Effective Settings Summary (collapsed by default) */}
      {allSettings && (
        <EffectiveSummaryBanner allSettings={allSettings} />
      )}
    </main>
  );
};
