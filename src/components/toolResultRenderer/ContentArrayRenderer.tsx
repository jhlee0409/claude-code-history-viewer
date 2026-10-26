/**
 * ContentArrayRenderer - Renders Claude API response content arrays
 *
 * Displays metadata (execution time, tokens, tool usage) and content items
 * including text, tool_use, and tool_result types.
 *
 * TR1b: the items pair like a message's own content (`contentEntries`): a
 * nested call and its nested results are one ToolRow (the paired path's
 * card), a call without a result says "No result recorded", a result without
 * its call is its own row ("Call not recorded"). Each entry has its own
 * expand scope. A nested update_plan / TodoWrite whose list holds a
 * non-object member opens as JSON through TR1a's shape gate (#734), instead
 * of crashing the legacy checklist renderers.
 */

import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import { REMARK_PLUGINS, REHYPE_PLUGINS } from "@/lib/markdownPlugins";
import { ThinkingRenderer } from "../contentRenderer/ThinkingRenderer";
import { ToolUseRenderer } from "../contentRenderer/ToolUseRenderer";
import { ServerToolUseRenderer } from "../contentRenderer/ServerToolUseRenderer";
import { MCPToolUseRenderer } from "../contentRenderer/MCPToolUseRenderer";
import { StandaloneServerResult } from "../contentRenderer/ServerResult";
import { ImageRenderer } from "../contentRenderer/ImageRenderer";
import { contentEntries, SERVER_RESULT_TYPES, type ContentEntry } from "../contentRenderer/contentEntries";
import { ExpandKeyProvider, useExpandKeyPrefix } from "@/contexts/CaptureExpandContext";
import { ClaudeToolResultItem } from "./ClaudeToolResultItem";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout, safeStringify } from "../renderers";
import { useFormat } from "@/lib/format/useFormat";
import { Num } from "@/lib/format/Num";

interface ContentArrayRendererProps {
  toolResult: Record<string, unknown>;
  searchQuery?: string;
}

const ALLOWED_IMAGE_TYPES = /^image\/(jpeg|png|gif|webp|bmp|svg\+xml)$/;

/**
 * An image block's URL, under the media-type and scheme allowlists the
 * orphan result card used (TR1b moved it here, so a result's image shows in
 * the Result zone of a paired or an orphan row alike); null otherwise (the
 * block then shows as recorded JSON).
 */
function safeImageUrl(source: unknown): string | null {
  if (source === null || typeof source !== "object") return null;
  const s = source as Record<string, unknown>;
  if (s.type === "base64" && typeof s.data === "string" && typeof s.media_type === "string" && ALLOWED_IMAGE_TYPES.test(s.media_type)) {
    return `data:${s.media_type};base64,${s.data}`;
  }
  if (s.type === "url" && typeof s.url === "string" && /^https?:\/\//.test(s.url)) return s.url;
  return null;
}

export const ContentArrayRenderer = ({ toolResult, searchQuery }: ContentArrayRendererProps) => {
  const { t } = useTranslation();
  const fmt = useFormat();
  const styles = getVariantStyles("info");
  const expandPrefix = useExpandKeyPrefix();

  const content = Array.isArray(toolResult.content) ? toolResult.content : [];
  const entries = contentEntries(content);

  const renderEntry = (entry: ContentEntry) => {
    if (entry.kind === "toolExecution") {
      return <ToolUseRenderer toolUse={entry.toolUse} toolResults={entry.toolResults} searchQuery={searchQuery} />;
    }
    if (entry.kind === "serverExecution") {
      return entry.toolUse.type === "mcp_tool_use" ? (
        <MCPToolUseRenderer toolUse={entry.toolUse} results={entry.results} searchQuery={searchQuery} />
      ) : (
        <ServerToolUseRenderer toolUse={entry.toolUse} results={entry.results} searchQuery={searchQuery} />
      );
    }
    const { item, index } = entry;
    if (!item || typeof item !== "object") {
      return (
        <div className={cn("bg-card border border-border", layout.containerPadding, layout.rounded)}>
          <div className={cn("text-muted-foreground mb-1", layout.smallText)}>{t("contentArray.typeUnknown")}</div>
          <pre className={cn("text-foreground/80 whitespace-pre-wrap", layout.smallText)}>{safeStringify(item)}</pre>
        </div>
      );
    }
    const itemObj = item as Record<string, unknown>;
    // A nested call without an id, or a nested result whose call is not in this
    // array: one ToolRow each (TR1b), never a card head. A nested orphan has no
    // page: it never claims an earlier page.
    if (itemObj.type === "tool_use") return <ToolUseRenderer toolUse={itemObj} searchQuery={searchQuery} />;
    if (itemObj.type === "tool_result") return <ClaudeToolResultItem toolResult={itemObj} index={index} searchQuery={searchQuery} />;
    if (typeof itemObj.type === "string" && SERVER_RESULT_TYPES.has(itemObj.type)) return <StandaloneServerResult block={itemObj} searchQuery={searchQuery} />;
    const imageUrl = itemObj.type === "image" ? safeImageUrl(itemObj.source) : null;
    if (imageUrl) return <ImageRenderer imageUrl={imageUrl} />;
    return (
      <div className={cn("bg-card border border-border overflow-y-auto", layout.containerPadding, layout.rounded, layout.contentMaxHeight)}>
        {itemObj.type === "text" && typeof itemObj.text === "string" ? (
          <div className={layout.prose}>
            {itemObj.text.includes("<thinking>") && itemObj.text.includes("</thinking>") ? (
              <ThinkingRenderer thinking={itemObj.text} searchQuery={searchQuery} />
            ) : (
              <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} skipHtml>
                {itemObj.text}
              </ReactMarkdown>
            )}
          </div>
        ) : (
          <div>
            <div className={cn("text-muted-foreground mb-1", layout.smallText)}>
              {t("contentArray.type")} {String(itemObj.type || "unknown")}
            </div>
            <pre className={cn("text-foreground/80 whitespace-pre-wrap", layout.smallText)}>{safeStringify(item)}</pre>
          </div>
        )}
      </div>
    );
  };
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
              <Num>{fmt.duration(totalDurationMs)}</Num>
            </div>
          </div>
        )}
        {totalTokens && (
          <div className={cn("bg-card border border-border", layout.containerPadding, layout.rounded)}>
            <div className="text-muted-foreground">{t("contentArray.totalTokens")}</div>
            <div className="font-medium text-foreground"><Num>{fmt.count(totalTokens)}</Num></div>
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
                    <Num>{fmt.count(usage.input_tokens)}</Num>
                  </span>
                </div>
              )}
              {typeof usage.output_tokens === "number" && (
                <div>
                  <span className="text-muted-foreground">{t("contentArray.output")}</span>
                  <span className="font-medium text-foreground ml-1">
                    <Num>{fmt.count(usage.output_tokens)}</Num>
                  </span>
                </div>
              )}
              {typeof usage.cache_creation_input_tokens === "number" && (
                <div>
                  <span className="text-muted-foreground">{t("contentArray.cacheCreation")}</span>
                  <span className="font-medium text-foreground ml-1">
                    <Num>{fmt.count(usage.cache_creation_input_tokens)}</Num>
                  </span>
                </div>
              )}
              {typeof usage.cache_read_input_tokens === "number" && (
                <div>
                  <span className="text-muted-foreground">{t("contentArray.cacheRead")}</span>
                  <span className="font-medium text-foreground ml-1">
                    <Num>{fmt.count(usage.cache_read_input_tokens)}</Num>
                  </span>
                </div>
              )}
              {typeof usage.reasoning_tokens === "number" && (
                <div>
                  <span className="text-muted-foreground">{t("analytics.reasoning", "Reasoning")}</span>
                  <span className="font-medium text-foreground ml-1">
                    <Num>{fmt.count(usage.reasoning_tokens)}</Num>
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
            {entries.map((entry) => (
              <ExpandKeyProvider key={entry.key} value={`${expandPrefix}:nested-${entry.key}`}>
                {renderEntry(entry)}
              </ExpandKeyProvider>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
