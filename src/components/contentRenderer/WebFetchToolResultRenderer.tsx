/**
 * WebFetchToolResultRenderer - Renders web fetch tool execution results
 *
 * Displays web page or PDF content retrieval results from the web_fetch beta feature.
 * Shows URL, title, retrieved timestamp, and content preview with appropriate styling
 * for success and error states.
 */

import { memo } from "react";
import { Globe, FileText, Clock, AlertCircle, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "../renderers";
import { ToolResultCard } from "./ToolResultCard";
import { getCommonToolErrorMessages } from "./toolResultErrorMessages";

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
      <ToolResultCard
        title={t("webFetchToolResultRenderer.error")}
        icon={<AlertCircle className={cn(layout.iconSize, "text-destructive")} />}
        variant="error"
        toolUseId={toolUseId}
      >
        <div className={cn(layout.bodyText, "text-destructive")}>
          {errorMessages[content.error_code] || content.error_code}
        </div>
      </ToolResultCard>
    );
  }

  const { url, content: docContent, retrieved_at } = content;
  const title = docContent?.title;
  const source = docContent?.source;

  const getPreview = (): string | null => {
    if (!source) return null;
    if (source.type === "text" && source.data) {
      return source.data.length > TEXT_PREVIEW_LENGTH
        ? source.data.substring(0, TEXT_PREVIEW_LENGTH) + "..."
        : source.data;
    }
    if (source.type === "base64" && source.media_type === "application/pdf") {
      return t("webFetchToolResultRenderer.pdfDocument");
    }
    return null;
  };

  const preview = getPreview();
  const isPDF = source?.media_type === "application/pdf";
  const webStyles = getVariantStyles("web");

  return (
    <ToolResultCard
      title={t("webFetchToolResultRenderer.title")}
      icon={
        isPDF ? (
          <FileText className={cn(layout.iconSize, webStyles.icon)} />
        ) : (
          <Globe className={cn(layout.iconSize, webStyles.icon)} />
        )
      }
      variant="web"
      toolUseId={toolUseId}
    >
      <div className={cn("flex items-center mb-2", layout.iconGap)}>
        <ExternalLink className={cn(layout.iconSizeSmall, webStyles.accent)} />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            layout.bodyText,
            "underline truncate max-w-md",
            webStyles.accent,
            "hover:opacity-80"
          )}
        >
          {url}
        </a>
      </div>

      {title && <div className={cn(layout.bodyText, "font-medium mb-2 text-foreground")}>{title}</div>}

      {retrieved_at && (
        <div className={cn("flex items-center mb-2", layout.iconGap, layout.smallText, webStyles.accent)}>
          <Clock className={layout.iconSizeSmall} />
          <span>
            {t("webFetchToolResultRenderer.retrievedAt")}:{" "}
            {new Date(retrieved_at).toLocaleString()}
          </span>
        </div>
      )}

      {preview && (
        <details className="mt-2">
          <summary className={cn(layout.smallText, "cursor-pointer hover:opacity-80", webStyles.accent)}>
            {t("webFetchToolResultRenderer.showContent")}
          </summary>
          <pre
            className={cn(
              "mt-2 overflow-x-auto whitespace-pre-wrap bg-muted text-foreground",
              layout.containerPadding,
              layout.rounded,
              layout.smallText,
              layout.codeMaxHeight
            )}
          >
            {preview}
          </pre>
        </details>
      )}
    </ToolResultCard>
  );
});
