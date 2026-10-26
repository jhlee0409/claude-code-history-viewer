/**
 * WebFetchToolResultRenderer - Renders web fetch tool execution results
 *
 * Displays web page or PDF content retrieval results from the web_fetch beta feature.
 * Shows URL, title, retrieved timestamp, and content preview with appropriate styling
 * for success and error states.
 */

import { memo, useContext } from "react";
import { Markdown } from "../common";
import { Clock, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { layout } from "../renderers";
import { ResultRow } from "../transcript/ResultRow";
import { ResultRowContext } from "../transcript/resultRowContext";
import { Marked } from "../transcript/ToolRow";
import { oneLineValueClass } from "./oneLineValue";
import { getCommonToolErrorMessages } from "./toolResultErrorMessages";
import { useFormat } from "@/lib/format/useFormat";
import { Num } from "@/lib/format/Num";

/** Web fetch result content structure */
interface WebFetchResult {
  type: "web_fetch_result";
  url: string;
  content?: {
    type: "document";
    source?: {
      type: "base64" | "text" | "url";
      media_type?: string;
      data?: string;
      url?: string;
    };
    title?: string;
  };
  retrieved_at?: string;
}

/** Web fetch error structure */
interface WebFetchError {
  type: "web_fetch_tool_error";
  error_code:
    | "invalid_input"
    | "url_too_long"
    | "url_not_allowed"
    | "url_not_accessible"
    | "too_many_requests"
    | "unsupported_content_type"
    | "max_uses_exceeded"
    | "unavailable";
}

type Props = {
  toolUseId: string;
  content: WebFetchResult | WebFetchError;
};

const isWebFetchError = (
  content: WebFetchResult | WebFetchError
): content is WebFetchError => {
  return content.type === "web_fetch_tool_error";
};

const TEXT_PREVIEW_LENGTH = 500;

export const WebFetchToolResultRenderer = memo(function WebFetchToolResultRenderer({
  toolUseId,
  content,
}: Props) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { highlight } = useContext(ResultRowContext);
  const result = { type: "web_fetch_tool_result", tool_use_id: toolUseId, content };
  const errorMessages: Record<string, string> = {
    ...getCommonToolErrorMessages(t),
    invalid_input: t("toolError.invalidUrlFormat"),
    url_too_long: t("toolError.urlTooLong"),
    url_not_allowed: t("toolError.urlNotAllowed"),
    url_not_accessible: t("toolError.urlNotAccessible"),
    unsupported_content_type: t("toolError.unsupportedContentType"),
    max_uses_exceeded: t("toolError.maxUsesExceeded"),
  };

  if (isWebFetchError(content)) {
    return (
      <ResultRow verb="web_fetch" result={result} toolUseId={toolUseId}>
        {errorMessages[content.error_code] && <div className={cn(layout.bodyText, "text-fg-2")}>{errorMessages[content.error_code]}</div>}
      </ResultRow>
    );
  }

  const { url, content: docContent, retrieved_at } = content;
  const title = docContent?.title;
  const source = docContent?.source;

  const getPreview = (): string | null => {
    if (!source) return null;
    if (source.type === "text" && source.data) {
      if (source.data.length <= TEXT_PREVIEW_LENGTH) return source.data;

      // Truncate at line boundary to avoid breaking markdown syntax
      const lines = source.data.split("\n");
      const previewLines: string[] = [];
      let charCount = 0;
      for (const line of lines) {
        if (charCount + line.length > TEXT_PREVIEW_LENGTH && previewLines.length > 0) break;
        previewLines.push(line);
        charCount += line.length + 1; // +1 for newline
      }

      // If truncated preview has an unclosed code fence, remove it
      const preview = previewLines.join("\n");
      const fenceCount = (preview.match(/^```/gm) || []).length;
      if (fenceCount % 2 !== 0) {
        while (previewLines.length > 0) {
          const last = previewLines[previewLines.length - 1] ?? "";
          if (last.startsWith("```") || last.trim() === "") {
            previewLines.pop();
          } else {
            break;
          }
        }
      }

      return previewLines.join("\n") + "\n...";
    }
    if (source.type === "base64" && source.media_type === "application/pdf") {
      return t("webFetchToolResultRenderer.pdfDocument");
    }
    return null;
  };

  const preview = getPreview();

  return (
    <ResultRow verb="web_fetch" result={result} toolUseId={toolUseId}>
      <div className={cn("flex items-center mb-2", layout.iconGap)}>
        <ExternalLink className={cn(layout.iconSizeSmall, "text-fg-3")} />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            layout.bodyText,
            "underline max-w-md text-fg-2",
            oneLineValueClass(String(url ?? ""), highlight),
            "hover:opacity-80"
          )}
        >
          <Marked text={String(url ?? "")} highlight={highlight} />
        </a>
      </div>

      {title && (
        <div className={cn(layout.bodyText, "font-medium mb-2 text-foreground")}>
          <Marked text={title} highlight={highlight} />
        </div>
      )}

      {retrieved_at && (
        <div className={cn("flex items-center mb-2", layout.iconGap, layout.smallText, "text-fg-3")}>
          <Clock className={layout.iconSizeSmall} />
          <span>
            {t("webFetchToolResultRenderer.retrievedAt")}:{" "}
            <Num>{fmt.dateTime(retrieved_at)}</Num>
          </span>
        </div>
      )}

      {preview && (
        <details className="mt-2">
          <summary className={cn(layout.smallText, "cursor-pointer hover:opacity-80", "text-fg-3")}>
            {t("webFetchToolResultRenderer.showContent")}
          </summary>
          <Markdown
            className={cn(
              "mt-2 overflow-x-auto bg-muted text-foreground",
              layout.containerPadding,
              layout.rounded,
              layout.smallText,
              layout.codeMaxHeight
            )}
          >
            {preview}
          </Markdown>
        </details>
      )}
    </ResultRow>
  );
});
