/**
 * Capture Mode Toolbar
 *
 * Minimal status bar when capture mode is active.
 * Inspired by professional video editing software.
 */

import { RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useAppStore } from "../../../store/useAppStore";

export function CaptureModeToolbar() {
  const { t } = useTranslation();
  const { hiddenMessageIds, restoreAllMessages, exitCaptureMode } =
    useAppStore();

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
        {hiddenCount > 0 && (
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
      </div>

      {/* Right: Exit button */}
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
  );
}
