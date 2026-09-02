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
        "bg-card border-b border-border"
      )}
    >
      {/* Left: Recording indicator + status */}
      <div className="flex items-center gap-4">
        {/* Live recording dot */}
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive" />
          </span>
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("captureMode.active")}
          </span>
        </div>

        {/* Divider */}
        {(hiddenCount > 0 || hasSelection) && (
          <div className="h-4 w-px bg-border" />
        )}

        {/* Hidden count - minimal */}
        {hiddenCount > 0 && (
          <button
            onClick={restoreAllMessages}
            className={cn(
              "flex items-center gap-2 group",
              "text-muted-foreground hover:text-foreground transition-colors"
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
            {hiddenCount > 0 && <div className="h-4 w-px bg-border" />}
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono tabular-nums text-accent">
                {t("captureMode.selectedCount", { count: selectedCount })}
              </span>
              <button
                onClick={onClearSelection}
                className="text-muted-foreground hover:text-foreground transition-colors"
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
          <span className="text-xs text-muted-foreground/70 italic">
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
              "bg-accent hover:bg-accent/90",
              "text-accent-foreground",
              "border border-accent",
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
            "flex items-center gap-1.5 px-3 py-1.5",
            "text-xs font-medium",
            "bg-muted hover:bg-muted/80",
            "text-foreground/80 hover:text-foreground",
            "border border-border",
            "rounded transition-all duration-150"
          )}
        >
          <X className="w-3.5 h-3.5" />
          <span>{t("captureMode.exit")}</span>
        </button>
      </div>
    </div>
  );
}
