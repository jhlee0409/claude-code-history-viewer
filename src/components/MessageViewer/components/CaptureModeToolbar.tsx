/**
 * Capture Mode Toolbar
 *
 * Displays toolbar when capture mode is active.
 * Shows hidden count, restore all button, and done button.
 */

import { Camera, RotateCcw, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../store/useAppStore";

export function CaptureModeToolbar() {
  const { t } = useTranslation();
  const { hiddenMessageIds, restoreAllMessages, exitCaptureMode } =
    useAppStore();

  const hiddenCount = hiddenMessageIds.length;

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-primary text-primary-foreground border-b border-primary/20">
      <div className="flex items-center gap-2">
        <Camera className="w-4 h-4" />
        <span className="font-medium">{t("captureMode.active")}</span>
        {hiddenCount > 0 && (
          <span className="px-2 py-0.5 text-xs bg-primary-foreground/20 rounded-full">
            {t("captureMode.hiddenCount", { count: hiddenCount })}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {hiddenCount > 0 && (
          <button
            onClick={restoreAllMessages}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-foreground/10 hover:bg-primary-foreground/20 rounded-md transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {t("captureMode.restoreAll")}
          </button>
        )}
        <button
          onClick={exitCaptureMode}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-foreground text-primary hover:bg-primary-foreground/90 rounded-md transition-colors font-medium"
        >
          <Check className="w-3.5 h-3.5" />
          {t("captureMode.done")}
        </button>
      </div>
    </div>
  );
}
