/**
 * ClaudeContentArrayRenderer - Renders arrays of Claude API content items
 *
 * Handles different content types:
 * - text: Plain text content
 * - image: Base64 encoded images
 * - thinking: AI reasoning blocks
 * - tool_use (+ its results), server_tool_use / mcp_tool_use (+ their
 *   server results): one ToolRow per call (`contentEntries`, TR1b)
 * - tool_result / a server result whose call is not in the message: its own
 *   row (a page-boundary orphan)
 * - `skipToolResults` (ClaudeMessageNode: the message's `toolUseResult` is
 *   drawn below the content) holds for every result branch alike: a paired
 *   call keeps its row without its results, an orphan result (tool_result or
 *   any server result) is not drawn (CodeRabbit 4378493992 on PR #746)
 * - Unknown types: Fallback JSON display
 */

import { memo, useMemo } from "react";
import { ResultProviderContext, useResultProvider } from "../transcript/resultProvider";
import { Markdown } from "../common";
import { ThinkingRenderer } from "./ThinkingRenderer";
import { RedactedThinkingRenderer } from "./RedactedThinkingRenderer";
import { ToolUseRenderer } from "./ToolUseRenderer";
import { ImageRenderer } from "./ImageRenderer";
import { CommandRenderer } from "./CommandRenderer";
import { ServerToolUseRenderer } from "./ServerToolUseRenderer";
import { DocumentRenderer } from "./DocumentRenderer";
import { SearchResultRenderer } from "./SearchResultRenderer";
import { MCPToolUseRenderer } from "./MCPToolUseRenderer";
import { StandaloneServerResult } from "./ServerResult";
import { contentEntries, SERVER_RESULT_TYPES, type ContentEntry } from "./contentEntries";
import { ContainerUploadRenderer } from "./ContainerUploadRenderer";
import { OpenCodeStepRenderer } from "./OpenCodeStepRenderer";
import { UnifiedToolExecutionRenderer } from "./UnifiedToolExecutionRenderer";
import { ClaudeToolResultItem } from "../toolResultRenderer";
import { HighlightedText } from "../common/HighlightedText";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "../renderers";
import { TruncatedPre } from "../common/TruncatedPre";
import { ExpandKeyProvider, useExpandKeyPrefix } from "@/contexts/CaptureExpandContext";
import type { SearchFilterType } from "../../store/useAppStore";
import { isDocumentContent, isSearchResultContent, isContainerUploadContent } from "@/utils/contentTypeGuards";

type Props = {
  provider?: string;
  content: unknown[];
  searchQuery?: string;
  /** Accepted for callers; tool rows mark hits in ids and content alike. */
  filterType?: SearchFilterType;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
  /** Draw no result block: every call's results and every orphan result (tool_result, server results). */
  skipToolResults?: boolean;
  skipText?: boolean;
  /** Skip only the first text block (already rendered as the message bubble). */
  skipFirstText?: boolean;
  skipThinking?: boolean;
  skipCommands?: boolean;
  skipToolCalls?: boolean;
  onViewSubagent?: (toolUseId: string) => void;
};

// Broad guard used by normalization; this intentionally does not require a "type" field.
const isObjectItem = (item: unknown): item is Record<string, unknown> => {
  return item !== null && typeof item === "object";
};

export const ClaudeContentArrayRenderer = memo(({
  content,
  provider,
  searchQuery = "",
  isCurrentMatch = false,
  currentMatchIndex = 0,
  skipToolResults = false,
  skipText = false,
  skipFirstText = false,
  skipThinking = false,
  skipCommands = false,
  skipToolCalls = false,
  onViewSubagent,
}: Props) => {
  const inheritedProvider = useResultProvider();
  const { t } = useTranslation();
  const normalizedContent = useMemo(() => (Array.isArray(content) ? contentEntries(content) : []), [content]);

  const firstTextIndex = Array.isArray(content)
    ? content.findIndex((item) => isObjectItem(item) && item.type === "text")
    : -1;
  // Each entry gets its own expand-key scope: nested result renderers fall
  // back to a shared "renderer" suffix, so without this every collapsible
  // in the message toggled together.
  const expandPrefix = useExpandKeyPrefix();
  // Every result branch reads these two: a call's results, and an orphan
  // result, which is its own row (so it also goes with the calls).
  const shownResults = (results: Record<string, unknown>[]) => (skipToolResults ? [] : results);
  const skipOrphanResult = skipToolCalls || skipToolResults;

  if (normalizedContent.length === 0) {
    return null;
  }

  const renderEntry = (entry: ContentEntry) => {
        if (entry.kind === "toolExecution") {
          if (skipToolCalls) return null;
          return (
            <UnifiedToolExecutionRenderer
              key={entry.key}
              toolUse={entry.toolUse}
              toolResults={shownResults(entry.toolResults)}
              onViewSubagent={onViewSubagent}
              searchQuery={searchQuery}
              isCurrentMatch={isCurrentMatch}
              currentMatchIndex={currentMatchIndex}
            />
          );
        }

        if (entry.kind === "serverExecution") {
          if (skipToolCalls) return null;
          const results = shownResults(entry.results);
          return entry.toolUse.type === "mcp_tool_use" ? (
            <MCPToolUseRenderer
              toolUse={entry.toolUse}
              results={results}
              searchQuery={searchQuery}
              isCurrentMatch={isCurrentMatch}
              currentMatchIndex={currentMatchIndex}
            />
          ) : (
            <ServerToolUseRenderer
              toolUse={entry.toolUse}
              results={results}
              searchQuery={searchQuery}
              isCurrentMatch={isCurrentMatch}
              currentMatchIndex={currentMatchIndex}
            />
          );
        }

        const { item, index } = entry;
        if (!isObjectItem(item)) {
          return (
            <div key={entry.key} className={cn(layout.bodyText, "text-muted-foreground")}>
              {String(item)}
            </div>
          );
        }

        const itemType = item.type as string;

        switch (itemType) {
          case "text":
            if (skipText) return null;
            if (skipFirstText && index === firstTextIndex) return null;
            if (typeof item.text === "string") {
              return (
                <div
                  key={entry.key}
                  className={cn("bg-card border border-border", layout.containerPadding, layout.rounded)}
                >
                  {searchQuery ? (
                    <div className={cn("whitespace-pre-wrap text-foreground", layout.bodyText)}>
                      <HighlightedText
                        text={item.text}
                        searchQuery={searchQuery}
                        isCurrentMatch={isCurrentMatch}
                        currentMatchIndex={currentMatchIndex}
                      />
                    </div>
                  ) : (
                    <Markdown className="text-foreground">
                      {item.text}
                    </Markdown>
                  )}
                </div>
              );
            }
            return null;

          case "image":
            // Claude API 형태의 이미지 객체 처리
            if (item.source && typeof item.source === "object") {
              const source = item.source as Record<string, unknown>;
              // base64 이미지
              if (
                source.type === "base64" &&
                source.data &&
                source.media_type
              ) {
                const imageUrl = `data:${source.media_type};base64,${source.data}`;
                return <ImageRenderer key={entry.key} imageUrl={imageUrl} />;
              }
              // URL 이미지
              if (source.type === "url" && typeof source.url === "string") {
                return <ImageRenderer key={entry.key} imageUrl={source.url} />;
              }
            }
            return null;

          case "thinking":
            if (skipThinking) return null;
            if (typeof item.thinking === "string") {
              return (
                <ThinkingRenderer
                  key={entry.key}
                  thinking={item.thinking}
                  index={index}
                  searchQuery={searchQuery}
                  isCurrentMatch={isCurrentMatch}
                  currentMatchIndex={currentMatchIndex}
                />
              );
            }
            return null;

          case "tool_use":
            if (skipToolCalls) return null;
            // A tool_use with a string id is a `toolExecution` entry (above);
            // one without reaches here: the same ToolRow, "No result recorded".
            return (
              <ToolUseRenderer
                key={entry.key}
                toolUse={item}
                searchQuery={searchQuery}
                isCurrentMatch={isCurrentMatch}
                currentMatchIndex={currentMatchIndex}
              />
            );

          case "tool_result":
            if (skipOrphanResult) return null;
            // Its call is not in this message: a page-boundary orphan (TR1b).
            return (
              <ClaudeToolResultItem
                key={entry.key}
                toolResult={item}
                index={index}
                atPageBoundary
                searchQuery={searchQuery}
                isCurrentMatch={isCurrentMatch}
                currentMatchIndex={currentMatchIndex}
              />
            );

          case "command": {
            if (skipCommands) return null;
            // Handle command items with content that may contain command XML
            const commandContent = typeof item.content === "string" ? item.content : "";
            if (!commandContent) return null;
            return (
              <div key={entry.key} className={cn("border", layout.containerPadding, layout.rounded, getVariantStyles("system").container)}>
                <CommandRenderer text={commandContent} searchQuery={searchQuery} />
              </div>
            );
          }

          case "critical_system_reminder": {
            const reminderStyles = getVariantStyles("warning");
            const reminderContent = typeof item.content === "string" ? item.content : JSON.stringify(item.content);
            return (
              <div
                key={entry.key}
                className={cn("border", layout.containerPadding, layout.rounded, reminderStyles.container)}
              >
                <div className={cn("flex items-center gap-1.5 mb-1.5", layout.smallText, reminderStyles.title)}>
                  <span className="font-medium">
                    {t("claudeContentArrayRenderer.systemReminder")}
                  </span>
                </div>
                {searchQuery ? (
                  <div className={cn("whitespace-pre-wrap text-foreground", layout.bodyText)}>
                    <HighlightedText
                      text={reminderContent}
                      searchQuery={searchQuery}
                      isCurrentMatch={isCurrentMatch}
                      currentMatchIndex={currentMatchIndex}
                    />
                  </div>
                ) : (
                  <Markdown className="text-foreground">
                    {reminderContent}
                  </Markdown>
                )}
              </div>
            );
          }

          case "redacted_thinking":
            if (skipThinking) return null;
            return (
              <RedactedThinkingRenderer
                key={entry.key}
                data={typeof item.data === "string" ? item.data : ""}
              />
            );



          case "document": {
            if (!isDocumentContent(item)) {
              return null;
            }
            return (
              <DocumentRenderer
                key={entry.key}
                document={item}
              />
            );
          }

          case "search_result": {
            if (!isSearchResultContent(item)) {
              return null;
            }
            return (
              <SearchResultRenderer
                key={entry.key}
                searchResult={item}
              />
            );
          }









          case "opencode_step": {
            const tok = (item.tokens ?? {}) as Record<string, number>;
            return (
              <OpenCodeStepRenderer
                key={entry.key}
                reason={typeof item.reason === "string" ? item.reason : "completed"}
                snapshot={typeof item.snapshot === "string" ? item.snapshot : ""}
                cost={typeof item.cost === "number" ? item.cost : 0}
                tokens={{
                  input: tok.input ?? 0,
                  output: tok.output ?? 0,
                  reasoning: tok.reasoning ?? 0,
                  cache_read: tok.cache_read ?? 0,
                  cache_write: tok.cache_write ?? 0,
                }}
              />
            );
          }

          case "container_upload": {
            if (!isContainerUploadContent(item)) {
              return null;
            }
            return (
              <ContainerUploadRenderer
                key={entry.key}
                fileId={item.file_id}
              />
            );
          }

          default: {
            if (SERVER_RESULT_TYPES.has(itemType)) {
              // A server / API result whose call is not in this message: its own row.
              if (skipOrphanResult) return null;
              return (
                <StandaloneServerResult
                  key={entry.key}
                  block={item}
                  searchQuery={searchQuery}
                  isCurrentMatch={isCurrentMatch}
                  currentMatchIndex={currentMatchIndex}
                />
              );
            }
            // 기본 JSON 렌더링 - warning variant for unknown types
            const warningStyles = getVariantStyles("warning");
            return (
              <div
                key={entry.key}
                className={cn("border", layout.containerPadding, layout.rounded, warningStyles.container)}
              >
                <div className={cn("mb-2", layout.titleText, warningStyles.title)}>
                  {t("claudeContentArrayRenderer.unknownContentType", {contentType: itemType,
                  })}
                </div>
                <TruncatedPre
                  content={JSON.stringify(item, null, 2)}
                  className={cn("overflow-auto", layout.smallText, warningStyles.accent)}
                />
              </div>
            );
          }
        }
  };

  return (
    <ResultProviderContext.Provider value={provider ?? inheritedProvider}>
    <div className="space-y-2 text-caption">
      {normalizedContent.map((entry) => (
        <ExpandKeyProvider key={entry.key} value={`${expandPrefix}:${entry.key}`}>
          {renderEntry(entry)}
        </ExpandKeyProvider>
      ))}
    </div>
    </ResultProviderContext.Provider>
  );
});

ClaudeContentArrayRenderer.displayName = "ClaudeContentArrayRenderer";
