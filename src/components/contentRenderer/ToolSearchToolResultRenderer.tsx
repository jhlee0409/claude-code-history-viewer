import { memo } from "react";
import { Search, Wrench, AlertCircle, Server } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Tool search result item */
interface ToolSearchResult {
  type: "tool_search_tool_search_result";
  tool_name: string;
  server_name?: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

/** Tool search error */
interface ToolSearchError {
  type: "tool_search_tool_result_error";
  error_code:
    | "invalid_tool_input"
    | "unavailable"
    | "too_many_requests"
    | "no_results";
}

type Props = {
  toolUseId: string;
  content: ToolSearchResult[] | ToolSearchError;
};

const isToolSearchError = (
  content: ToolSearchResult[] | ToolSearchError
): content is ToolSearchError => {
  return !Array.isArray(content) && content.type === "tool_search_tool_result_error";
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid_tool_input: "Invalid search query",
  unavailable: "Service temporarily unavailable",
  too_many_requests: "Rate limit exceeded",
  no_results: "No matching tools found",
};

export const ToolSearchToolResultRenderer = memo(
  function ToolSearchToolResultRenderer({ toolUseId, content }: Props) {
    const { t } = useTranslation("components");

    if (isToolSearchError(content)) {
      return (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="flex items-center space-x-2 mb-2">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <span className="text-xs font-medium text-red-800">
              {t("toolSearchToolResultRenderer.error", {
                defaultValue: "Tool Search Error",
              })}
            </span>
            <span className="text-xs text-red-500 font-mono">{toolUseId}</span>
          </div>
          <div className="text-sm text-red-700">
            {ERROR_MESSAGES[content.error_code] || content.error_code}
          </div>
        </div>
      );
    }

    const results = content;

    if (!results || results.length === 0) {
      return (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <div className="flex items-center space-x-2 mb-2">
            <Search className="w-4 h-4 text-gray-600" />
            <span className="text-xs font-medium text-gray-800">
              {t("toolSearchToolResultRenderer.title", {
                defaultValue: "Tool Search",
              })}
            </span>
            <span className="text-xs text-gray-500 font-mono">{toolUseId}</span>
          </div>
          <div className="text-xs text-gray-500 italic">
            {t("toolSearchToolResultRenderer.noResults", {
              defaultValue: "No tools found",
            })}
          </div>
        </div>
      );
    }

    return (
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
        <div className="flex items-center space-x-2 mb-3">
          <Search className="w-4 h-4 text-indigo-600" />
          <span className="text-xs font-medium text-indigo-800">
            {t("toolSearchToolResultRenderer.title", {
              defaultValue: "Tool Search Results",
            })}
          </span>
          <span className="text-xs text-indigo-500 font-mono">{toolUseId}</span>
          <span className="text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">
            {results.length}{" "}
            {t("toolSearchToolResultRenderer.found", { defaultValue: "found" })}
          </span>
        </div>

        <div className="space-y-2">
          {results.map((result, index) => (
            <div
              key={`${result.tool_name}-${index}`}
              className="bg-white border border-indigo-100 rounded p-2"
            >
              <div className="flex items-center space-x-2 mb-1">
                <Wrench className="w-3 h-3 text-indigo-500" />
                <span className="text-sm font-medium text-indigo-800">
                  {result.tool_name}
                </span>
              </div>

              {result.server_name && (
                <div className="flex items-center space-x-1 text-xs text-indigo-500 mb-1">
                  <Server className="w-3 h-3" />
                  <span className="font-mono">{result.server_name}</span>
                </div>
              )}

              {result.description && (
                <div className="text-xs text-indigo-600 mt-1">
                  {result.description}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }
);
