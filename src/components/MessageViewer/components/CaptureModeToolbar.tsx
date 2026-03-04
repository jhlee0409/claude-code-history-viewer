/**
 * Capture Mode Toolbar
 *
 * Minimal status bar when capture mode is active.
 * Shows range selection info and screenshot capture button.
 */

import { Camera, Loader2, RotateCcw, X, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useAppStore } from "../../../store/useAppStore";
import { isMacOS } from "../../../utils/platform";

interface CaptureModeToolbarProps {
  selectedCount: number;
  hasSelection: boolean;
  onScreenshot: () => void;
  onClearSelection: () => void;
}

export function CaptureModeToolbar({
  selectedCount,
  hasSelection,
  onScreenshot,
  onClearSelection,
}: CaptureModeToolbarProps) {
  const { t } = useTranslation();
  const {
    hiddenMessageIds,
    restoreAllMessages,
    exitCaptureMode,
    isCapturing,
  } = useAppStore();

  const hiddenCount = hiddenMessageIds.length;

  return (
    <div
      className={cn(
        "flex items-center justify-between px-4 py-2",
        "bg-zinc-950 border-b border-zinc-800"
      )}
    >
      {/* Left: Recording indicator + status */}
      <div className="flex items-center gap-4">
        {/* Live recording dot */}
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
          </span>
          <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
            {t("captureMode.active")}
          </span>
        </div>

        {/* Divider */}
        {(hiddenCount > 0 || hasSelection) && (
          <div className="h-4 w-px bg-zinc-800" />
        )}

        {/* Hidden count - minimal */}
        {hiddenCount > 0 && (
          <button
            onClick={restoreAllMessages}
            className={cn(
              "flex items-center gap-2 group",
              "text-zinc-500 hover:text-zinc-300 transition-colors"
            )}
            title={t("captureMode.restoreAll")}
          >
            <span className="text-xs font-mono tabular-nums">
              {hiddenCount} {hiddenCount === 1 ? "block" : "blocks"} hidden
            </span>
            <RotateCcw className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        )}

        {/* Selection info */}
        {hasSelection && (
          <>
            {hiddenCount > 0 && <div className="h-4 w-px bg-zinc-800" />}
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono tabular-nums text-blue-400">
                {t("captureMode.selectedCount", { count: selectedCount })}
              </span>
              <button
                onClick={onClearSelection}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
                title={t("captureMode.clearSelection")}
                aria-label={t("captureMode.clearSelection")}
              >
                <XCircle className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        )}

        {/* Selection hint with OS-specific modifier keys */}
        {!hasSelection && (
          <span className="text-xs text-zinc-600 italic">
            {t("captureMode.selectMessages")}
            {" · "}
            {isMacOS()
              ? t("captureMode.modifierHintMac")
              : t("captureMode.modifierHintOther")}
          </span>
        )}
      </div>

      {/* Right: Screenshot + Exit buttons */}
      <div className="flex items-center gap-2">
        {/* Screenshot button */}
        {hasSelection && (
          <button
            onClick={onScreenshot}
            disabled={isCapturing}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5",
              "text-xs font-medium",
              "bg-blue-600 hover:bg-blue-500",
              "text-white",
              "border border-blue-500 hover:border-blue-400",
              "rounded transition-all duration-150",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {isCapturing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{t("captureMode.capturing")}</span>
              </>
            ) : (
              <>
                <Camera className="w-3.5 h-3.5" />
                <span>{t("captureMode.screenshot")}</span>
              </>
            )}
          </button>
        )}

        {/* Exit button */}
        <button
          onClick={exitCaptureMode}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5",
            "text-xs font-medium",
            "bg-zinc-800 hover:bg-zinc-700",
            "text-zinc-300 hover:text-zinc-100",
            "border border-zinc-700 hover:border-zinc-600",
            "rounded transition-all duration-150"
          )}
        >
          <span>{t("captureMode.done")}</span>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
