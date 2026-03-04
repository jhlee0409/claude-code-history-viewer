/**
 * ScreenshotPreviewModal Component
 *
 * Fullscreen portal-based modal for previewing captured screenshots.
 * Supports zoom (wheel + buttons) and drag-to-pan.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn, ZoomOut, Maximize2, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useImageZoomPan } from "../../../hooks/useImageZoomPan";

interface ScreenshotPreviewModalProps {
  /** Data URL of the captured image */
  dataUrl: string;
  /** Natural width of the image (px) */
  width: number;
  /** Natural height of the image (px) */
  height: number;
  /** Called when user confirms save */
  onSave: () => void;
  /** Called when user cancels / closes */
  onClose: () => void;
}

export function ScreenshotPreviewModal({
  dataUrl,
  width,
  height,
  onSave,
  onClose,
}: ScreenshotPreviewModalProps) {
  const { t } = useTranslation();
  const viewportRef = useRef<HTMLDivElement>(null);

  const {
    zoom,
    panX,
    panY,
    zoomIn,
    zoomOut,
    resetZoom,
    handleWheel,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  } = useImageZoomPan();

  // Fit to screen on mount
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || width === 0 || height === 0) return;
    // Use a small timeout to let the portal mount
    const raf = requestAnimationFrame(() => {
      const rect = vp.getBoundingClientRect();
      // Subtract toolbar height (approximately 48px) and add some padding
      resetZoom(rect.width - 32, rect.height - 32, width, height);
    });
    return () => cancelAnimationFrame(raf);
  }, [width, height, resetZoom]);

  // ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const handleFitToScreen = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    resetZoom(rect.width - 32, rect.height - 32, width, height);
  }, [width, height, resetZoom]);

  const [isDragging, setIsDragging] = useState(false);
  const zoomPercent = Math.round(zoom * 100);

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 99999 }}
      className="flex flex-col bg-black/95 backdrop-blur-sm"
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-900/90 border-b border-zinc-800">
        {/* Left: dimensions */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-zinc-400">
            {t("captureMode.preview.dimensions", { width, height })}
          </span>
          <span className="text-xs font-mono text-zinc-500">
            {t("captureMode.preview.zoomLevel", { percent: zoomPercent })}
          </span>
        </div>

        {/* Center: zoom controls */}
        <div className="flex items-center gap-1 bg-zinc-800/60 rounded-lg p-0.5 border border-zinc-700/40">
          <button
            type="button"
            onClick={zoomOut}
            className={cn(
              "p-1.5 rounded-md transition-all duration-150",
              "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/60",
            )}
            aria-label={t("captureMode.preview.zoomOut")}
            title={t("captureMode.preview.zoomOut")}
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleFitToScreen}
            className={cn(
              "p-1.5 rounded-md transition-all duration-150",
              "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/60",
            )}
            aria-label={t("captureMode.preview.fitToScreen")}
            title={t("captureMode.preview.fitToScreen")}
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={zoomIn}
            className={cn(
              "p-1.5 rounded-md transition-all duration-150",
              "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/60",
            )}
            aria-label={t("captureMode.preview.zoomIn")}
            title={t("captureMode.preview.zoomIn")}
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>

        {/* Right: save + close */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSave}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded",
              "bg-blue-600 hover:bg-blue-500 text-white",
              "border border-blue-500 hover:border-blue-400",
              "transition-all duration-150",
            )}
          >
            <Save className="w-3.5 h-3.5" />
            {t("captureMode.preview.save")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "p-1.5 rounded-md transition-all duration-150",
              "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/60",
            )}
            aria-label={t("captureMode.preview.cancel")}
            title={t("captureMode.preview.cancel")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Image viewport */}
      <div
        ref={viewportRef}
        className="flex-1 overflow-hidden"
        style={{ cursor: isDragging ? "grabbing" : "grab" }}
        onWheel={handleWheel}
        onMouseDown={(e) => {
          setIsDragging(true);
          handleMouseDown(e);
        }}
        onMouseMove={handleMouseMove}
        onMouseUp={() => {
          setIsDragging(false);
          handleMouseUp();
        }}
        onMouseLeave={() => {
          setIsDragging(false);
          handleMouseUp();
        }}
      >
        <img
          src={dataUrl}
          alt="Screenshot preview"
          draggable={false}
          style={{
            transformOrigin: "0 0",
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
            imageRendering: zoom > 1 ? "pixelated" : "auto",
            maxWidth: "none",
          }}
        />
      </div>
    </div>,
    document.body,
  );
}
