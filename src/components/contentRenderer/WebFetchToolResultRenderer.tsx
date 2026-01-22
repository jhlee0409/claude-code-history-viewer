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

const ERROR_MESSAGES: Record<string, string> = {
  invalid_input: "Invalid URL format",
  url_too_long: "URL exceeds maximum length (250 characters)",
  url_not_allowed: "URL blocked by domain filtering",
  url_not_accessible: "Failed to fetch content (HTTP error)",
  too_many_requests: "Rate limit exceeded",
  unsupported_content_type: "Content type not supported",
  max_uses_exceeded: "Maximum web fetch uses exceeded",
  unavailable: "Service temporarily unavailable",
};

const TEXT_PREVIEW_LENGTH = 500;

export const WebFetchToolResultRenderer = memo(function WebFetchToolResultRenderer({
  toolUseId,
  content,
}: Props) {
  const { t } = useTranslation("components");

  if (isWebFetchError(content)) {
    const errorStyles = getVariantStyles("error");

    return (
      <div className={cn(layout.rounded, "border", errorStyles.container)}>
        <div className={cn("flex items-center justify-between", layout.headerPadding, layout.headerHeight)}>
          <div className={cn("flex items-center", layout.iconGap)}>
            <AlertCircle className={cn(layout.iconSize, errorStyles.icon)} />
            <span className={cn(layout.titleText, errorStyles.title)}>
              {t("webFetchToolResultRenderer.error", { defaultValue: "Web Fetch Error" })}
            </span>
          </div>
          <div className={cn("flex items-center shrink-0", layout.iconGap, layout.smallText)}>
            <span className={cn(layout.monoText, errorStyles.accent)}>
              {toolUseId}
            </span>
          </div>
        </div>
        <div className={layout.contentPadding}>
          <div className={cn(layout.bodyText, errorStyles.accent)}>
            {ERROR_MESSAGES[content.error_code] || content.error_code}
          </div>
        </div>
      </div>
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
      return "[PDF Document]";
    }
    return null;
  };

  const preview = getPreview();
  const isPDF = source?.media_type === "application/pdf";
  const webStyles = getVariantStyles("web");

  return (
    <div className={cn(layout.rounded, "border", webStyles.container)}>
      <div className={cn("flex items-center justify-between", layout.headerPadding, layout.headerHeight)}>
        <div className={cn("flex items-center", layout.iconGap)}>
          {isPDF ? (
            <FileText className={cn(layout.iconSize, webStyles.icon)} />
          ) : (
            <Globe className={cn(layout.iconSize, webStyles.icon)} />
          )}
          <span className={cn(layout.titleText, "text-foreground")}>
            {t("webFetchToolResultRenderer.title", { defaultValue: "Web Fetch Result" })}
          </span>
        </div>
        <div className={cn("flex items-center shrink-0", layout.iconGap, layout.smallText)}>
          <span className={cn(layout.monoText, webStyles.accent)}>
            {toolUseId}
          </span>
        </div>
      </div>

      <div className={layout.contentPadding}>
        {/* URL */}
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

        {/* Title */}
        {title && (
          <div className={cn(layout.bodyText, "font-medium mb-2 text-foreground")}>
            {title}
          </div>
        )}

        {/* Retrieved at */}
        {retrieved_at && (
          <div className={cn("flex items-center mb-2", layout.iconGap, layout.smallText, webStyles.accent)}>
            <Clock className={layout.iconSizeSmall} />
            <span>
              {t("webFetchToolResultRenderer.retrievedAt", { defaultValue: "Retrieved" })}:{" "}
              {new Date(retrieved_at).toLocaleString()}
            </span>
          </div>
        )}

        {/* Content preview */}
        {preview && (
          <details className="mt-2">
            <summary className={cn(
              layout.smallText,
              "cursor-pointer hover:opacity-80",
              webStyles.accent
            )}>
              {t("webFetchToolResultRenderer.showContent", {
                defaultValue: "Show content preview",
              })}
            </summary>
            <pre className={cn(
              "mt-2 overflow-x-auto whitespace-pre-wrap bg-muted text-foreground",
              layout.containerPadding,
              layout.rounded,
              layout.smallText,
              layout.codeMaxHeight
            )}>
              {preview}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
});
