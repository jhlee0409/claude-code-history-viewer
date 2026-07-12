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
import { useAppStore } from "@/store/useAppStore";

function sanitizeFilename(name: string): string {
  // Remove filesystem-invalid characters (Windows: <>:"/\|?*, also control chars)
  // eslint-disable-next-line no-control-regex
  const safe = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  // Limit length to avoid path issues
  return safe.slice(0, 200) || "conversation";
}

export function useExport(
  messages: ClaudeMessage[],
  sessionName: string,
  options?: {
    includeSidechain?: boolean;
    /**
     * Resolves the messages to export. Used when the store only holds a
     * paginated window of the session — export must cover the COMPLETE
     * conversation, not just what has been scrolled into memory.
     */
    resolveMessages?: () => Promise<ClaudeMessage[]>;
  },
) {
  const { t } = useTranslation();
  const [isExporting, setIsExporting] = useState(false);
  const { messageFilter, isMessageFilterActive } = useAppStore();
  const includeSidechain = options?.includeSidechain === true;
  const resolveMessages = options?.resolveMessages;

  const exportConversation = useCallback(
    async (format: ExportFormat) => {
      if (messages.length === 0) return;
      setIsExporting(true);

      try {
        const exportMessages = resolveMessages
          ? await resolveMessages()
          : messages;
        if (exportMessages.length === 0) return;
        const safeName = sanitizeFilename(sessionName);
        let content: string;
        let defaultPath: string;
        let mimeType: string;

        // Pass content type filter to exporters when filters are active
        const ctFilter = isMessageFilterActive() ? messageFilter.contentTypes : undefined;
        // When exporting a subagent session directly, its messages are all
        // sidechain — keep them instead of filtering them out (issue #433).
        const exportOptions = { includeSidechain };

        switch (format) {
          case "markdown": {
            const { exportToMarkdown } = await import("@/services/export/markdownExporter");
            content = exportToMarkdown(exportMessages, sessionName, ctFilter, exportOptions);
            defaultPath = `${safeName}.md`;
            mimeType = "text/markdown";
            break;
          }
          case "json": {
            const { exportToJson } = await import("@/services/export/jsonExporter");
            content = exportToJson(exportMessages, sessionName, ctFilter, exportOptions);
            defaultPath = `${safeName}.json`;
            mimeType = "application/json";
            break;
          }
          case "html": {
            const { exportToHtml } = await import("@/services/export/htmlExporter");
            content = exportToHtml(exportMessages, sessionName, ctFilter, exportOptions);
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
    [messages, sessionName, t, messageFilter, isMessageFilterActive, includeSidechain, resolveMessages],
  );

  return { isExporting, exportConversation };
}
