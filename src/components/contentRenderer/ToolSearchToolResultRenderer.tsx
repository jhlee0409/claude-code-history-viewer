/**
 * ToolSearchToolResultRenderer - Renders MCP tool search results
 *
 * Displays tool discovery results from the MCP tool_search beta feature.
 * Shows found tools with their names, descriptions, server sources, and input schemas.
 * Handles error states and empty results with appropriate styling.
 */

import { memo } from "react";
import { Search, Wrench, AlertCircle, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "../renderers";

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
      const errorStyles = getVariantStyles("error");

      return (
        <div className={cn(layout.rounded, "border", errorStyles.container)}>
          <div className={cn("flex items-center justify-between", layout.headerPadding, layout.headerHeight)}>
            <div className={cn("flex items-center", layout.iconGap)}>
              <AlertCircle className={cn(layout.iconSize, errorStyles.icon)} />
              <span className={cn(layout.titleText, errorStyles.title)}>
                {t("toolSearchToolResultRenderer.error", {
                  defaultValue: "Tool Search Error",
                })}
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

    const results = content;

    if (!results || results.length === 0) {
      const neutralStyles = getVariantStyles("neutral");

      return (
        <div className={cn(layout.rounded, "border", neutralStyles.container)}>
          <div className={cn("flex items-center justify-between", layout.headerPadding, layout.headerHeight)}>
            <div className={cn("flex items-center", layout.iconGap)}>
              <Search className={cn(layout.iconSize, neutralStyles.icon)} />
              <span className={cn(layout.titleText, neutralStyles.title)}>
                {t("toolSearchToolResultRenderer.title", {
                  defaultValue: "Tool Search",
                })}
              </span>
            </div>
            <div className={cn("flex items-center shrink-0", layout.iconGap, layout.smallText)}>
              <span className={cn(layout.monoText, "text-muted-foreground")}>
                {toolUseId}
              </span>
            </div>
          </div>
          <div className={layout.contentPadding}>
            <div className={cn(layout.smallText, "text-muted-foreground italic")}>
              {t("toolSearchToolResultRenderer.noResults", {
                defaultValue: "No tools found",
              })}
            </div>
          </div>
        </div>
      );
    }

    const infoStyles = getVariantStyles("info");

    return (
      <div className={cn(layout.rounded, "border", infoStyles.container)}>
        <div className={cn("flex items-center justify-between", layout.headerPadding, layout.headerHeight)}>
          <div className={cn("flex items-center", layout.iconGap)}>
            <Search className={cn(layout.iconSize, infoStyles.icon)} />
            <span className={cn(layout.titleText, infoStyles.title)}>
              {t("toolSearchToolResultRenderer.title", {
                defaultValue: "Tool Search Results",
              })}
            </span>
          </div>
          <div className={cn("flex items-center shrink-0", layout.iconGap, layout.smallText)}>
            <span className={cn(layout.monoText, infoStyles.accent)}>
              {toolUseId}
            </span>
            <span className={cn(layout.smallText, "px-1.5 py-0.5 rounded", infoStyles.badge, infoStyles.badgeText)}>
              {results.length}{" "}
              {t("toolSearchToolResultRenderer.found", { defaultValue: "found" })}
            </span>
          </div>
        </div>

        <div className={layout.contentPadding}>
          <div className="space-y-2">
            {results.map((result, index) => (
              <div
                key={`${result.tool_name}-${index}`}
                className="bg-card border border-border rounded p-2"
              >
                <div className={cn("flex items-center mb-1", layout.iconGap)}>
                  <Wrench className={cn(layout.iconSizeSmall, infoStyles.accent)} />
                  <span className={cn(layout.bodyText, "font-medium", infoStyles.title)}>
                    {result.tool_name}
                  </span>
                </div>

                {result.server_name && (
                  <div className={cn("flex items-center mb-1", layout.iconGap, layout.smallText, infoStyles.accent)}>
                    <Server className={layout.iconSizeSmall} />
                    <span className="font-mono">{result.server_name}</span>
                  </div>
                )}

                {result.description && (
                  <div className={cn(layout.smallText, "mt-1", infoStyles.accent)}>
                    {result.description}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
);
