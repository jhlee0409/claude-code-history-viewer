/**
 * useExport Hook
 *
 * Triggers conversation export in the selected format.
 * Handles file save dialog and toast notifications.
 */

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ExportFormat } from "@/types/export";
import type { ClaudeMessage } from "@/types";

function sanitizeFilename(name: string): string {
  // Remove filesystem-invalid characters (Windows: <>:"/\|?*, also control chars)
  // eslint-disable-next-line no-control-regex
  const safe = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  // Limit length to avoid path issues
  return safe.slice(0, 200) || "conversation";
}

export function useExport(messages: ClaudeMessage[], sessionName: string) {
  const { t } = useTranslation();
  const [isExporting, setIsExporting] = useState(false);

  const exportConversation = useCallback(
    async (format: ExportFormat) => {
      if (messages.length === 0) return;
      setIsExporting(true);

      try {
        const safeName = sanitizeFilename(sessionName);
        let content: string;
        let defaultPath: string;
        let mimeType: string;

        switch (format) {
          case "markdown": {
            const { exportToMarkdown } = await import("@/services/export/markdownExporter");
            content = exportToMarkdown(messages, sessionName);
            defaultPath = `${safeName}.md`;
            mimeType = "text/markdown";
            break;
          }
          case "json": {
            const { exportToJson } = await import("@/services/export/jsonExporter");
            content = exportToJson(messages, sessionName);
            defaultPath = `${safeName}.json`;
            mimeType = "application/json";
            break;
          }
          case "html": {
            const { exportToHtml } = await import("@/services/export/htmlExporter");
            content = exportToHtml(messages, sessionName);
            defaultPath = `${safeName}.html`;
            mimeType = "text/html";
            break;
          }
        }

        const { saveFileDialog } = await import("@/utils/fileDialog");
        const saved = await saveFileDialog(content, {
          defaultPath,
          mimeType,
          filters: [{ name: format.toUpperCase(), extensions: [defaultPath.split(".").pop() ?? format] }],
        });

        if (saved) {
          toast.success(t("session.export.success"));
        }
      } catch (error) {
        console.error("[useExport] export failed:", error);
        toast.error(t("session.export.error"));
      } finally {
        setIsExporting(false);
      }
    },
    [messages, sessionName, t],
  );

  return { isExporting, exportConversation };
}
