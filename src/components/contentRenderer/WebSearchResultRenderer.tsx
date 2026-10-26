import { memo, useContext } from "react";
import { ExternalLink, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { layout } from "@/components/renderers";
import type { WebSearchResultItem, WebSearchToolError } from "../../types";
import { ResultRow } from "../transcript/ResultRow";
import { ResultRowContext } from "../transcript/resultRowContext";
import { Marked } from "../transcript/ToolRow";
import { getCommonToolErrorMessages } from "./toolResultErrorMessages";

type Props = {
  toolUseId: string;
  content: WebSearchResultItem[] | WebSearchToolError;
};

/**
 * A `web_search_tool_result` (TR1b: its head is its call's ToolRow, or
 * `ResultRow` when the call is not in the message). The body lists each
 * result's title, URL and page age, search hits marked. Any content that is
 * not a result list is an error record (`web_search_tool_result_error` with
 * its `error_code`): the row already says "Failed · <code>", so the body
 * adds only the recorded message or the code's explanation, in neutral text.
 */
export const WebSearchResultRenderer = memo(function WebSearchResultRenderer({ toolUseId, content }: Props) {
  const { t } = useTranslation();
  const { highlight } = useContext(ResultRowContext);
  const result = { type: "web_search_tool_result", tool_use_id: toolUseId, content };

  if (!Array.isArray(content)) {
    const error: Partial<WebSearchToolError> = content !== null && typeof content === "object" ? content : {};
    const code = typeof error.error_code === "string" ? error.error_code : "";
    const message = typeof error.message === "string" && error.message !== "" ? error.message : getCommonToolErrorMessages(t)[code];
    return (
      <ResultRow verb="web_search" result={result} toolUseId={toolUseId}>
        {message && <div className={cn(layout.bodyText, "whitespace-pre-wrap text-fg-2")}>{message}</div>}
      </ResultRow>
    );
  }

  const results = content;

  return (
    <ResultRow verb="web_search" result={result} toolUseId={toolUseId} meta={`${results.length} ${t("webSearchResultRenderer.results")}`}>
      {results.length === 0 && <div className={cn(layout.smallText, "text-muted-foreground italic")}>{t("webSearchResultRenderer.noResults")}</div>}

      <div className="space-y-1.5">
        {results.map((item, index) => (
          <div key={`${item.url}-${index}`} className={cn("bg-card border border-border", layout.containerPadding, layout.rounded)}>
            <a href={item.url} target="_blank" rel="noopener noreferrer" className={cn("flex items-start group", layout.iconSpacing)}>
              <ExternalLink className={cn(layout.iconSizeSmall, "text-fg-3 mt-0.5 flex-shrink-0")} />
              <div className="flex-1 min-w-0">
                <div className={cn(layout.bodyText, "font-medium text-foreground group-hover:text-accent truncate")}>
                  <Marked text={String(item.title ?? "")} highlight={highlight} />
                </div>
                <div className={cn(layout.smallText, "text-muted-foreground truncate")}>
                  <Marked text={String(item.url ?? "")} highlight={highlight} />
                </div>
                {item.page_age && (
                  <div className={cn("flex items-center mt-1", layout.iconSpacing, layout.smallText, "text-muted-foreground")}>
                    <Clock className={layout.iconSizeSmall} />
                    <span>{item.page_age}</span>
                  </div>
                )}
              </div>
            </a>
          </div>
        ))}
      </div>
    </ResultRow>
  );
});
