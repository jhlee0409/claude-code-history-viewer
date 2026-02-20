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
import { ToolResultCard } from "./ToolResultCard";
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

    if (isToolSearchError(content)) {
      return (
        <ToolResultCard
          title={t("toolSearchToolResultRenderer.error")}
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

    const results = content;

    if (!results || results.length === 0) {
      return (
        <ToolResultCard
          title={t("toolSearchToolResultRenderer.title")}
          icon={<Search className={cn(layout.iconSize, "text-muted-foreground")} />}
          variant="neutral"
          toolUseId={toolUseId}
        >
          <div className={cn(layout.smallText, "text-muted-foreground italic")}>
            {t("toolSearchToolResultRenderer.noResults")}
          </div>
        </ToolResultCard>
      );
    }

    const infoStyles = getVariantStyles("info");

    return (
      <ToolResultCard
        title={t("toolSearchToolResultRenderer.title")}
        icon={<Search className={cn(layout.iconSize, infoStyles.icon)} />}
        variant="info"
        toolUseId={toolUseId}
        rightContent={
          <span className={cn(layout.smallText, "px-1.5 py-0.5 rounded", infoStyles.badge, infoStyles.badgeText)}>
            {results.length} {t("toolSearchToolResultRenderer.found")}
          </span>
        }
      >
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
      </ToolResultCard>
    );
  }
);
