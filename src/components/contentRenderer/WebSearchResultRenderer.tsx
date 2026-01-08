import { memo } from "react";
import { ExternalLink, Search, AlertCircle, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  WebSearchResultItem,
  WebSearchToolError,
} from "../../types";

type Props = {
  toolUseId: string;
  content: WebSearchResultItem[] | WebSearchToolError;
};

const isError = (
  content: WebSearchResultItem[] | WebSearchToolError
): content is WebSearchToolError => {
  return (
    typeof content === "object" &&
    !Array.isArray(content) &&
    "type" in content &&
    content.type === "error"
  );
};

export const WebSearchResultRenderer = memo(function WebSearchResultRenderer({
  toolUseId,
  content,
}: Props) {
  const { t } = useTranslation("components");

  if (isError(content)) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-3">
        <div className="flex items-center space-x-2 mb-2">
          <AlertCircle className="w-4 h-4 text-red-600" />
          <span className="text-xs font-medium text-red-800">
            {t("webSearchResultRenderer.error", {
              defaultValue: "Search Error",
            })}
          </span>
          <span className="text-xs text-red-500 font-mono">{toolUseId}</span>
        </div>
        <div className="text-sm text-red-700">
          <span className="font-medium">{content.error_code}:</span>{" "}
          {content.message}
        </div>
      </div>
    );
  }

  const results = content as WebSearchResultItem[];

  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
      <div className="flex items-center space-x-2 mb-3">
        <Search className="w-4 h-4 text-green-600" />
        <span className="text-xs font-medium text-green-800">
          {t("webSearchResultRenderer.title", {
            defaultValue: "Web Search Results",
          })}
        </span>
        <span className="text-xs text-green-600">
          ({results.length}{" "}
          {t("webSearchResultRenderer.results", { defaultValue: "results" })})
        </span>
      </div>

      <div className="space-y-2">
        {results.map((result) => (
          <div
            key={result.url}
            className="bg-white border border-green-100 rounded p-2"
          >
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start space-x-2 group"
            >
              <ExternalLink className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-green-800 group-hover:text-green-600 truncate">
                  {result.title}
                </div>
                <div className="text-xs text-green-600 truncate">
                  {result.url}
                </div>
                {result.page_age && (
                  <div className="flex items-center space-x-1 mt-1 text-xs text-green-500">
                    <Clock className="w-3 h-3" />
                    <span>{result.page_age}</span>
                  </div>
                )}
              </div>
            </a>
          </div>
        ))}
      </div>
    </div>
  );
});
