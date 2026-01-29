/**
 * EditorFooter Component
 *
 * Footer bar with Save/Reset buttons and editor mode toggle.
 */

import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Save, RotateCcw, Code, Eye, Loader2 } from "lucide-react";
import type { EditorMode } from "./SettingsEditorPane";

// ============================================================================
// Types
// ============================================================================

interface EditorFooterProps {
  editorMode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  hasUnsavedChanges: boolean;
  onSave: () => void;
  onReset: () => void;
  readOnly: boolean;
  isSaving?: boolean;
  hasJsonError?: boolean;
}

// ============================================================================
// Component
// ============================================================================

export const EditorFooter: React.FC<EditorFooterProps> = ({
  editorMode,
  onModeChange,
  hasUnsavedChanges,
  onSave,
  onReset,
  readOnly,
  isSaving = false,
  hasJsonError = false,
}) => {
  const { t } = useTranslation();

  return (
    <div className="border-t border-border/40 px-4 py-3 flex items-center justify-between bg-card/80">
      {/* Left: Mode Toggle */}
      <div className="flex items-center gap-0.5 border border-border/40 rounded-md p-0.5 bg-muted/50">
        <Button
          variant={editorMode === "visual" ? "secondary" : "ghost"}
          size="sm"
          className={`h-7 px-2.5 gap-1.5 transition-colors duration-150 ${
            editorMode === "visual" ? "shadow-sm" : "hover:bg-accent/10 hover:text-accent"
          }`}
          onClick={() => onModeChange("visual")}
        >
          <Eye className="w-3.5 h-3.5" />
          <span className="text-xs">{t("settingsManager.mode.visual")}</span>
        </Button>
        <Button
          variant={editorMode === "json" ? "secondary" : "ghost"}
          size="sm"
          className={`h-7 px-2.5 gap-1.5 transition-colors duration-150 ${
            editorMode === "json" ? "shadow-sm" : "hover:bg-accent/10 hover:text-accent"
          }`}
          onClick={() => onModeChange("json")}
        >
          <Code className="w-3.5 h-3.5" />
          <span className="text-xs">{t("settingsManager.mode.json")}</span>
        </Button>
      </div>

      {/* Right: Action Buttons */}
      <div className="flex items-center gap-2">
        {/* Reset Button */}
        <Button
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={onReset}
          disabled={!hasUnsavedChanges || readOnly}
        >
          <RotateCcw className="w-4 h-4 mr-1.5" />
          {t("settingsManager.unified.footer.reset")}
        </Button>

        {/* Save Button */}
        <Button
          size="sm"
          className="h-8"
          onClick={onSave}
          disabled={!hasUnsavedChanges || readOnly || isSaving || hasJsonError}
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-1.5" />
          )}
          {isSaving
            ? t("settingsManager.unified.footer.saving")
            : t("settingsManager.unified.footer.save")}
        </Button>
      </div>
    </div>
  );
};
