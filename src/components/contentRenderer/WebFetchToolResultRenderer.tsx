import { memo } from "react";
import { Globe, FileText, Clock, AlertCircle, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

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
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-3">
        <div className="flex items-center space-x-2 mb-2">
          <AlertCircle className="w-4 h-4 text-red-600" />
          <span className="text-xs font-medium text-red-800">
            {t("webFetchToolResultRenderer.error", { defaultValue: "Web Fetch Error" })}
          </span>
          <span className="text-xs text-red-500 font-mono">{toolUseId}</span>
        </div>
        <div className="text-sm text-red-700">
          {ERROR_MESSAGES[content.error_code] || content.error_code}
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

  return (
    <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-3">
      <div className="flex items-center space-x-2 mb-2">
        {isPDF ? (
          <FileText className="w-4 h-4 text-cyan-600" />
        ) : (
          <Globe className="w-4 h-4 text-cyan-600" />
        )}
        <span className="text-xs font-medium text-cyan-800">
          {t("webFetchToolResultRenderer.title", { defaultValue: "Web Fetch Result" })}
        </span>
        <span className="text-xs text-cyan-500 font-mono">{toolUseId}</span>
      </div>

      {/* URL */}
      <div className="flex items-center space-x-2 mb-2">
        <ExternalLink className="w-3 h-3 text-cyan-500" />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-cyan-700 hover:text-cyan-900 underline truncate max-w-md"
        >
          {url}
        </a>
      </div>

      {/* Title */}
      {title && (
        <div className="text-sm font-medium text-cyan-800 mb-2">{title}</div>
      )}

      {/* Retrieved at */}
      {retrieved_at && (
        <div className="flex items-center space-x-1 text-xs text-cyan-500 mb-2">
          <Clock className="w-3 h-3" />
          <span>
            {t("webFetchToolResultRenderer.retrievedAt", { defaultValue: "Retrieved" })}:{" "}
            {new Date(retrieved_at).toLocaleString()}
          </span>
        </div>
      )}

      {/* Content preview */}
      {preview && (
        <details className="mt-2">
          <summary className="text-xs text-cyan-600 cursor-pointer hover:text-cyan-800">
            {t("webFetchToolResultRenderer.showContent", {
              defaultValue: "Show content preview",
            })}
          </summary>
          <pre className="mt-2 text-xs text-cyan-700 bg-cyan-100 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-64">
            {preview}
          </pre>
        </details>
      )}
    </div>
  );
});
