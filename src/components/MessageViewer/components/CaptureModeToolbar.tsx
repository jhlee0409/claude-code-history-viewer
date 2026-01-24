/**
 * Capture Mode Toolbar
 *
 * Displays toolbar when capture mode is active.
 * Editorial/viewfinder aesthetic for professional screenshot capture.
 */

import { Aperture, RotateCcw, Check, Scissors } from "lucide-react";
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
        "flex items-center justify-between px-4 py-2.5",
        "bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900",
        "text-zinc-100 border-b border-zinc-700/50",
        "shadow-lg shadow-black/20"
      )}
    >
      {/* Left: Mode indicator with viewfinder aesthetic */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-2.5 py-1 bg-zinc-700/50 rounded-md border border-zinc-600/50">
          <Aperture className="w-4 h-4 text-amber-400 animate-pulse-subtle" />
          <span className="text-sm font-medium tracking-wide uppercase text-zinc-300">
            {t("captureMode.active")}
          </span>
        </div>

        {/* Hidden count with scissors icon */}
        {hiddenCount > 0 && (
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Scissors className="w-3.5 h-3.5" />
            <span className="text-xs font-mono tabular-nums">
              {t("captureMode.hiddenCount", { count: hiddenCount })}
            </span>
          </div>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {hiddenCount > 0 && (
          <button
            onClick={restoreAllMessages}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs",
              "bg-transparent hover:bg-zinc-700/50",
              "border border-zinc-600/50 hover:border-zinc-500/50",
              "rounded-md transition-all duration-200",
              "text-zinc-400 hover:text-zinc-200"
            )}
          >
            <RotateCcw className="w-3 h-3" />
            <span className="font-medium">{t("captureMode.restoreAll")}</span>
          </button>
        )}
        <button
          onClick={exitCaptureMode}
          className={cn(
            "flex items-center gap-1.5 px-4 py-1.5 text-xs",
            "bg-amber-500 hover:bg-amber-400",
            "text-zinc-900 font-semibold",
            "rounded-md transition-all duration-200",
            "shadow-md shadow-amber-500/20 hover:shadow-amber-400/30"
          )}
        >
          <Check className="w-3.5 h-3.5" />
          <span>{t("captureMode.done")}</span>
        </button>
      </div>
    </div>
  );
}
