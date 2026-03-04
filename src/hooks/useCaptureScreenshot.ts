/**
 * useCaptureScreenshot Hook
 *
 * Handles screenshot capture using html-to-image and file saving.
 * Supports both Tauri (native save dialog) and web (browser download) modes.
 *
 * The caller is responsible for managing isCapturing state so the
 * capture renderer can mount before the ref is accessed.
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { saveBinaryFileDialog } from "../utils/fileDialog";
import { dataUrlToUint8Array } from "../utils/imageUtils";

export const MAX_CAPTURE_MESSAGES = 50;

export function useCaptureScreenshot() {
  const { t } = useTranslation();

  /**
   * Capture the given DOM element as a PNG and save it.
   * The element must already be mounted and visible on screen.
   */
  const captureElement = useCallback(
    async (containerEl: HTMLElement, sessionId?: string) => {
      try {
        const { toPng } = await import("html-to-image");
        const dataUrl = await toPng(containerEl, {
          pixelRatio: 2,
          backgroundColor: "#09090b", // zinc-950
        });

        const bytes = dataUrlToUint8Array(dataUrl);

        const timestamp = new Date()
          .toISOString()
          .replace(/[:.]/g, "-")
          .slice(0, 19);
        const prefix = sessionId ? sessionId.slice(0, 8) : "capture";
        const defaultFilename = `capture-${prefix}-${timestamp}.png`;

        const saved = await saveBinaryFileDialog(bytes, {
          defaultPath: defaultFilename,
          filters: [{ name: "PNG Image", extensions: ["png"] }],
          mimeType: "image/png",
        });

        if (saved) {
          return { success: true, message: t("captureMode.captureSuccess") };
        }
        return { success: false, message: "" }; // User cancelled
      } catch (err) {
        console.error("[useCaptureScreenshot] capture failed:", err);
        return {
          success: false,
          message: t("captureMode.captureError"),
        };
      }
    },
    [t],
  );

  return { captureElement };
}
