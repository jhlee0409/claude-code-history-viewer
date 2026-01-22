/**
 * ContentArrayRenderer - Renders Claude API response content arrays
 *
 * Displays metadata (execution time, tokens, tool usage) and content items
 * including text, tool_use, and tool_result types.
 */

import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThinkingRenderer, ToolUseRenderer } from "../contentRenderer";
import { ClaudeToolResultItem } from "./ClaudeToolResultItem";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout, safeStringify } from "../renderers";

interface ContentArrayRendererProps {
  toolResult: Record<string, unknown>;
  searchQuery?: string;
}

export const ContentArrayRenderer = ({ toolResult, searchQuery }: ContentArrayRendererProps) => {
  const { t } = useTranslation("components");
  const styles = getVariantStyles("info");

  const content = Array.isArray(toolResult.content) ? toolResult.content : [];
  const totalDurationMs =
    typeof toolResult.totalDurationMs === "number" ? toolResult.totalDurationMs : null;
  const totalTokens =
    typeof toolResult.totalTokens === "number" ? toolResult.totalTokens : null;
  const totalToolUseCount =
    typeof toolResult.totalToolUseCount === "number" ? toolResult.totalToolUseCount : null;
  const wasInterrupted =
    typeof toolResult.wasInterrupted === "boolean" ? toolResult.wasInterrupted : null;
  const usage =
    toolResult.usage && typeof toolResult.usage === "object"
      ? (toolResult.usage as Record<string, unknown>)
      : null;

  return (
    <div className={cn("mt-2 border", layout.containerPadding, layout.rounded, styles.container)}>
      {/* Header */}
      <div className={cn("flex items-center mb-2", layout.iconSpacing)}>
        <Bot className={cn(layout.iconSize, styles.icon)} />
        <span className={cn(layout.titleText, styles.title)}>
          {t("contentArray.claudeApiResponse")}
        </span>
      </div>

      {/* Metadata grid */}
      <div className={cn("grid grid-cols-2 mb-3", layout.iconGap, layout.smallText)}>
        {totalDurationMs && (
          <div className={cn("bg-card border border-border", layout.containerPadding, layout.rounded)}>
            <div className="text-muted-foreground">{t("contentArray.executionTime")}</div>
            <div className="font-medium text-foreground">
              {(totalDurationMs / 1000).toFixed(2)}{t("contentArray.seconds")}
            </div>
          </div>
        )}
        {totalTokens && (
          <div className={cn("bg-card border border-border", layout.containerPadding, layout.rounded)}>
            <div className="text-muted-foreground">{t("contentArray.totalTokens")}</div>
            <div className="font-medium text-foreground">{totalTokens.toLocaleString()}</div>
          </div>
        )}
        {totalToolUseCount && (
          <div className={cn("bg-card border border-border", layout.containerPadding, layout.rounded)}>
            <div className="text-muted-foreground">{t("contentArray.toolUseCount")}</div>
            <div className="font-medium text-foreground">{totalToolUseCount}</div>
          </div>
        )}
        {wasInterrupted !== null && (
          <div className={cn("bg-card border border-border", layout.containerPadding, layout.rounded)}>
            <div className="text-muted-foreground">{t("contentArray.interruptionStatus")}</div>
            <div className={cn("font-medium", wasInterrupted ? "text-destructive" : "text-success")}>
              {wasInterrupted ? t("contentArray.interrupted") : t("contentArray.completed")}
            </div>
          </div>
        )}
      </div>

      {/* Token usage */}
      {usage && (
        <div className="mb-3">
          <div className={cn("text-muted-foreground mb-1", layout.titleText)}>
            {t("contentArray.tokenUsage")}
          </div>
          <div className={cn("bg-card border border-border", layout.containerPadding, layout.smallText, layout.rounded)}>
            <div className={cn("grid grid-cols-2", layout.iconGap)}>
              {typeof usage.input_tokens === "number" && (
                <div>
                  <span className="text-muted-foreground">{t("contentArray.input")}</span>
                  <span className="font-medium text-foreground ml-1">
                    {usage.input_tokens.toLocaleString()}
                  </span>
                </div>
              )}
              {typeof usage.output_tokens === "number" && (
                <div>
                  <span className="text-muted-foreground">{t("contentArray.output")}</span>
                  <span className="font-medium text-foreground ml-1">
                    {usage.output_tokens.toLocaleString()}
                  </span>
                </div>
              )}
              {typeof usage.cache_creation_input_tokens === "number" && (
                <div>
                  <span className="text-muted-foreground">{t("contentArray.cacheCreation")}</span>
                  <span className="font-medium text-foreground ml-1">
                    {usage.cache_creation_input_tokens.toLocaleString()}
                  </span>
                </div>
              )}
              {typeof usage.cache_read_input_tokens === "number" && (
                <div>
                  <span className="text-muted-foreground">{t("contentArray.cacheRead")}</span>
                  <span className="font-medium text-foreground ml-1">
                    {usage.cache_read_input_tokens.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Content items */}
      {content.length > 0 && (
        <div>
          <div className={cn("text-muted-foreground mb-1", layout.titleText)}>
            {t("contentArray.content")}
          </div>
          <div className={cn("space-y", layout.iconGap)}>
            {content.map((item: unknown, index: number) => {
              if (!item || typeof item !== "object") {
                return (
                  <div key={index} className={cn("bg-card border border-border", layout.containerPadding, layout.rounded)}>
                    <div className={cn("text-muted-foreground mb-1", layout.smallText)}>
                      {t("contentArray.typeUnknown")}
                    </div>
                    <pre className={cn("text-foreground/80 whitespace-pre-wrap", layout.smallText)}>
                      {safeStringify(item)}
                    </pre>
                  </div>
                );
              }

              const itemObj = item as Record<string, unknown>;

              return (
                <div
                  key={index}
                  className={cn("bg-card border border-border overflow-y-auto", layout.containerPadding, layout.rounded, layout.contentMaxHeight)}
                >
                  {itemObj.type === "text" && typeof itemObj.text === "string" && (
                    <div className={layout.prose}>
                      {itemObj.text.includes("<thinking>") &&
                      itemObj.text.includes("</thinking>") ? (
                        <ThinkingRenderer thinking={itemObj.text} searchQuery={searchQuery} />
                      ) : (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {itemObj.text}
                        </ReactMarkdown>
                      )}
                    </div>
                  )}
                  {itemObj.type === "tool_use" && <ToolUseRenderer toolUse={itemObj} />}
                  {itemObj.type === "tool_result" && (
                    <ClaudeToolResultItem toolResult={itemObj} index={index} />
                  )}
                  {!["text", "tool_use", "tool_result"].includes(itemObj.type as string) && (
                    <div>
                      <div className={cn("text-muted-foreground mb-1", layout.smallText)}>
                        {t("contentArray.type")} {String(itemObj.type || "unknown")}
                      </div>
                      <pre className={cn("text-foreground/80 whitespace-pre-wrap", layout.smallText)}>
                        {safeStringify(item)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
