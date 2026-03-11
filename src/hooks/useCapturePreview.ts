/**
 * useCapturePreview Hook
 *
 * Captures a DOM element as PNG and stores the data URL for preview.
 * The caller renders a preview modal; on "Save" the image is written to disk.
 */

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { saveBinaryFileDialog } from "../utils/fileDialog";
import { dataUrlToUint8Array } from "../utils/imageUtils";

export interface CapturePreviewState {
  /** Data URL of the captured image (null when no preview) */
  previewDataUrl: string | null;
  /** Natural width of the captured image */
  previewWidth: number;
  /** Natural height of the captured image */
  previewHeight: number;
}

export function useCapturePreview() {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<CapturePreviewState>({
    previewDataUrl: null,
    previewWidth: 0,
    previewHeight: 0,
  });
  const [sessionIdRef, setSessionIdRef] = useState<string | undefined>();

  /**
   * Capture the given DOM element as PNG and open the preview.
   */
  const captureAndPreview = useCallback(
    async (containerEl: HTMLElement, sessionId?: string) => {
      try {
        const { toPng } = await import("html-to-image");
        const backgroundColor =
          getComputedStyle(document.body).backgroundColor || "#09090b";
        const dataUrl = await toPng(containerEl, {
          pixelRatio: 2,
          backgroundColor,
        });

        // Decode dimensions from the data URL
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = dataUrl;
        });

        setPreview({
          previewDataUrl: dataUrl,
          previewWidth: img.naturalWidth,
          previewHeight: img.naturalHeight,
        });
        setSessionIdRef(sessionId);

        return { success: true, message: "" };
      } catch (err) {
        console.error("[useCapturePreview] capture failed:", err);
        return {
          success: false,
          message: t("captureMode.captureError"),
        };
      }
    },
    [t],
  );

  /**
   * Save the previewed image to disk via save dialog.
   */
  const savePreview = useCallback(async () => {
    if (!preview.previewDataUrl) return { success: false, message: "" };

    try {
      const bytes = dataUrlToUint8Array(preview.previewDataUrl);

      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      const prefix = sessionIdRef ? sessionIdRef.slice(0, 8) : "capture";
      const defaultFilename = `capture-${prefix}-${timestamp}.png`;

      const saved = await saveBinaryFileDialog(bytes, {
        defaultPath: defaultFilename,
        filters: [{ name: "PNG Image", extensions: ["png"] }],
        mimeType: "image/png",
      });

      if (saved) {
        setPreview({ previewDataUrl: null, previewWidth: 0, previewHeight: 0 });
        return { success: true, message: t("captureMode.captureSuccess") };
      }
      return { success: false, message: "" }; // User cancelled
    } catch (err) {
      console.error("[useCapturePreview] save failed:", err);
      return { success: false, message: t("captureMode.captureError") };
    }
  }, [preview.previewDataUrl, sessionIdRef, t]);

  /**
   * Discard the preview without saving.
   */
  const discardPreview = useCallback(() => {
    setPreview({ previewDataUrl: null, previewWidth: 0, previewHeight: 0 });
  }, []);

  return {
    ...preview,
    captureAndPreview,
    savePreview,
    discardPreview,
  };
}
