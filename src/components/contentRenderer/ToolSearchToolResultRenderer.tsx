/**
 * ToolSearchToolResultRenderer - Renders MCP tool search results
 *
 * Displays tool discovery results from the MCP tool_search beta feature.
 * Shows found tools with their names, descriptions, server sources, and input schemas.
 * Handles error states and empty results with appropriate styling.
 */

import { memo, useContext } from "react";
import { Wrench, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { layout } from "../renderers";
import { ResultRow } from "../transcript/ResultRow";
import { ResultRowContext } from "../transcript/resultRowContext";
import { Marked } from "../transcript/ToolRow";
import { getCommonToolErrorMessages } from "./toolResultErrorMessages";

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

export const ToolSearchToolResultRenderer = memo(
  function ToolSearchToolResultRenderer({ toolUseId, content }: Props) {
    const { t } = useTranslation();
    const errorMessages: Record<string, string> = {
      ...getCommonToolErrorMessages(t),
      no_results: t("toolError.noMatchingToolsFound"),
    };
    const { highlight } = useContext(ResultRowContext);
    const result = { type: "tool_search_tool_result", tool_use_id: toolUseId, content };

    if (isToolSearchError(content)) {
      return (
        <ResultRow verb="tool_search" result={result} toolUseId={toolUseId}>
          {errorMessages[content.error_code] && <div className={cn(layout.bodyText, "text-fg-2")}>{errorMessages[content.error_code]}</div>}
        </ResultRow>
      );
    }

    const results = content;

    if (!results || results.length === 0) {
      return (
        <ResultRow verb="tool_search" result={result} toolUseId={toolUseId}>
          <div className={cn(layout.smallText, "text-muted-foreground italic")}>
            {t("toolSearchToolResultRenderer.noResults")}
          </div>
        </ResultRow>
      );
    }

    return (
      <ResultRow verb="tool_search" result={result} toolUseId={toolUseId} meta={`${results.length} ${t("toolSearchToolResultRenderer.found")}`}>
        <div className="space-y-2">
          {results.map((item, index) => (
            <div
              key={`${item.tool_name}-${index}`}
              className="bg-card border border-border rounded p-2"
            >
              <div className={cn("flex items-center mb-1", layout.iconGap)}>
                <Wrench className={cn(layout.iconSizeSmall, "text-fg-3")} />
                <span className={cn(layout.bodyText, "font-medium text-fg")}>
                  <Marked text={String(item.tool_name ?? "")} highlight={highlight} />
                </span>
              </div>

              {item.server_name && (
                <div className={cn("flex items-center mb-1", layout.iconGap, layout.smallText, "text-fg-3")}>
                  <Server className={layout.iconSizeSmall} />
                  <span className="font-mono">
                    <Marked text={item.server_name} highlight={highlight} />
                  </span>
                </div>
              )}

              {item.description && (
                <div className={cn(layout.smallText, "mt-1 text-fg-2")}>
                  <Marked text={item.description} highlight={highlight} />
                </div>
              )}
            </div>
          ))}
        </div>
      </ResultRow>
    );
  }
);
