/**
 * ClaudeContentArrayRenderer - Renders arrays of Claude API content items
 *
 * Handles different content types:
 * - text: Plain text content
 * - image: Base64 encoded images
 * - thinking: AI reasoning blocks
 * - tool_use: Tool invocations
 * - tool_result: Tool execution results
 * - Unknown types: Fallback JSON display
 */

import { memo } from "react";
import { ThinkingRenderer } from "./ThinkingRenderer";
import { RedactedThinkingRenderer } from "./RedactedThinkingRenderer";
import { ToolUseRenderer } from "./ToolUseRenderer";
import { ImageRenderer } from "./ImageRenderer";
import { CommandRenderer } from "./CommandRenderer";
import { ServerToolUseRenderer } from "./ServerToolUseRenderer";
import { WebSearchResultRenderer } from "./WebSearchResultRenderer";
import { DocumentRenderer } from "./DocumentRenderer";
import { SearchResultRenderer } from "./SearchResultRenderer";
import { MCPToolUseRenderer } from "./MCPToolUseRenderer";
import { MCPToolResultRenderer } from "./MCPToolResultRenderer";
import { WebFetchToolResultRenderer } from "./WebFetchToolResultRenderer";
import { CodeExecutionToolResultRenderer } from "./CodeExecutionToolResultRenderer";
import { BashCodeExecutionToolResultRenderer } from "./BashCodeExecutionToolResultRenderer";
import { TextEditorCodeExecutionToolResultRenderer } from "./TextEditorCodeExecutionToolResultRenderer";
import { ToolSearchToolResultRenderer } from "./ToolSearchToolResultRenderer";
import { ClaudeToolResultItem } from "../toolResultRenderer";
import { HighlightedText } from "../common/HighlightedText";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "../renderers";
import type { SearchFilterType } from "../../store/useAppStore";
import {
  isServerToolUseContent,
  isWebSearchToolResultContent,
  isDocumentContent,
  isSearchResultContent,
  isMCPToolUseContent,
  isMCPToolResultContent,
  isWebFetchToolResultContent,
  isCodeExecutionToolResultContent,
  isBashCodeExecutionToolResultContent,
  isTextEditorCodeExecutionToolResultContent,
  isToolSearchToolResultContent,
} from "@/utils/contentTypeGuards";

type Props = {
  content: unknown[];
  searchQuery?: string;
  filterType?: SearchFilterType;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
  skipToolResults?: boolean;
  skipText?: boolean;
};

// Type guard for content items
const isContentItem = (item: unknown): item is Record<string, unknown> => {
  return item !== null && typeof item === "object";
};

export const ClaudeContentArrayRenderer = memo(({
  content,
  searchQuery = "",
  filterType = "content",
  isCurrentMatch = false,
  currentMatchIndex = 0,
  skipToolResults = false,
  skipText = false,
}: Props) => {
  const { t } = useTranslation();
  if (!Array.isArray(content) || content.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {content.map((item, index) => {
        if (!isContentItem(item)) {
          return (
            <div key={index} className={cn(layout.bodyText, "text-muted-foreground")}>
              {String(item)}
            </div>
          );
        }

        const itemType = item.type as string;

        switch (itemType) {
          case "text":
            if (skipText) return null;
            if (typeof item.text === "string") {
              return (
                <div
                  key={index}
                  className={cn("bg-card border border-border", layout.containerPadding, layout.rounded)}
                >
                  <div className={cn("whitespace-pre-wrap text-foreground", layout.bodyText)}>
                    {searchQuery ? (
                      <HighlightedText
                        text={item.text}
                        searchQuery={searchQuery}
                        isCurrentMatch={isCurrentMatch}
                        currentMatchIndex={currentMatchIndex}
                      />
                    ) : (
                      item.text
                    )}
                  </div>
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
                return <ImageRenderer key={index} imageUrl={imageUrl} />;
              }
              // URL 이미지
              if (source.type === "url" && typeof source.url === "string") {
                return <ImageRenderer key={index} imageUrl={source.url} />;
              }
            }
            return null;

          case "thinking":
            if (typeof item.thinking === "string") {
              return (
                <ThinkingRenderer
                  key={index}
                  thinking={item.thinking}
                  searchQuery={searchQuery}
                  isCurrentMatch={isCurrentMatch}
                  currentMatchIndex={currentMatchIndex}
                />
              );
            }
            return null;

          case "tool_use":
            return (
              <ToolUseRenderer
                key={index}
                toolUse={item}
                searchQuery={filterType === "toolId" ? searchQuery : ""}
                isCurrentMatch={isCurrentMatch}
                currentMatchIndex={currentMatchIndex}
              />
            );

          case "tool_result":
            if (skipToolResults) return null;
            return (
              <ClaudeToolResultItem
                key={index}
                toolResult={item}
                index={index}
                searchQuery={filterType === "toolId" ? searchQuery : ""}
                isCurrentMatch={isCurrentMatch}
                currentMatchIndex={currentMatchIndex}
              />
            );

          case "command": {
            // Handle command items with content that may contain command XML
            const commandContent = typeof item.content === "string" ? item.content : "";
            if (!commandContent) return null;
            return (
              <div key={index} className={cn("border", layout.containerPadding, layout.rounded, getVariantStyles("system").container)}>
                <CommandRenderer text={commandContent} searchQuery={searchQuery} />
              </div>
            );
          }

          case "critical_system_reminder": {
            const reminderStyles = getVariantStyles("warning");
            const reminderContent = typeof item.content === "string" ? item.content : JSON.stringify(item.content);
            return (
              <div
                key={index}
                className={cn("border", layout.containerPadding, layout.rounded, reminderStyles.container)}
              >
                <div className={cn("flex items-center gap-1.5 mb-1.5", layout.smallText, reminderStyles.title)}>
                  <span className="font-medium">
                    {t("claudeContentArrayRenderer.systemReminder", { defaultValue: "System Reminder" })}
                  </span>
                </div>
                <div className={cn("whitespace-pre-wrap", layout.bodyText, "text-foreground")}>
                  {searchQuery ? (
                    <HighlightedText
                      text={reminderContent}
                      searchQuery={searchQuery}
                      isCurrentMatch={isCurrentMatch}
                      currentMatchIndex={currentMatchIndex}
                    />
                  ) : (
                    reminderContent
                  )}
                </div>
              </div>
            );
          }

          case "redacted_thinking":
            return (
              <RedactedThinkingRenderer
                key={index}
                data={typeof item.data === "string" ? item.data : ""}
              />
            );

          case "server_tool_use": {
            if (!isServerToolUseContent(item)) {
              return null;
            }
            return (
              <ServerToolUseRenderer
                key={index}
                id={item.id}
                name={item.name}
                input={item.input}
              />
            );
          }

          case "web_search_tool_result": {
            if (!isWebSearchToolResultContent(item)) {
              return null;
            }
            return (
              <WebSearchResultRenderer
                key={index}
                toolUseId={item.tool_use_id}
                content={item.content}
              />
            );
          }

          case "document": {
            if (!isDocumentContent(item)) {
              return null;
            }
            return (
              <DocumentRenderer
                key={index}
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
                key={index}
                searchResult={item}
              />
            );
          }

          case "mcp_tool_use": {
            if (!isMCPToolUseContent(item)) {
              return null;
            }
            return (
              <MCPToolUseRenderer
                key={index}
                id={item.id}
                serverName={item.server_name}
                toolName={item.tool_name}
                input={item.input}
              />
            );
          }

          case "mcp_tool_result": {
            if (!isMCPToolResultContent(item)) {
              return null;
            }
            return (
              <MCPToolResultRenderer
                key={index}
                toolUseId={item.tool_use_id}
                content={item.content}
                isError={item.is_error === true}
              />
            );
          }

          case "web_fetch_tool_result": {
            if (!isWebFetchToolResultContent(item)) {
              return null;
            }
            return (
              <WebFetchToolResultRenderer
                key={index}
                toolUseId={item.tool_use_id}
                content={item.content}
              />
            );
          }

          case "code_execution_tool_result": {
            if (!isCodeExecutionToolResultContent(item)) {
              return null;
            }
            return (
              <CodeExecutionToolResultRenderer
                key={index}
                toolUseId={item.tool_use_id}
                content={item.content}
              />
            );
          }

          case "bash_code_execution_tool_result": {
            if (!isBashCodeExecutionToolResultContent(item)) {
              return null;
            }
            return (
              <BashCodeExecutionToolResultRenderer
                key={index}
                toolUseId={item.tool_use_id}
                content={item.content}
              />
            );
          }

          case "text_editor_code_execution_tool_result": {
            if (!isTextEditorCodeExecutionToolResultContent(item)) {
              return null;
            }
            return (
              <TextEditorCodeExecutionToolResultRenderer
                key={index}
                toolUseId={item.tool_use_id}
                content={item.content}
              />
            );
          }

          case "tool_search_tool_result": {
            if (!isToolSearchToolResultContent(item)) {
              return null;
            }
            return (
              <ToolSearchToolResultRenderer
                key={index}
                toolUseId={item.tool_use_id}
                content={item.content}
              />
            );
          }

          default: {
            // 기본 JSON 렌더링 - warning variant for unknown types
            const warningStyles = getVariantStyles("warning");
            return (
              <div
                key={index}
                className={cn("border", layout.containerPadding, layout.rounded, warningStyles.container)}
              >
                <div className={cn("mb-2", layout.titleText, warningStyles.title)}>
                  {t("claudeContentArrayRenderer.unknownContentType", {
                    defaultValue: "Unknown Content Type: {contentType}",
                    contentType: itemType,
                  })}
                </div>
                <pre className={cn("overflow-auto", layout.smallText, warningStyles.accent)}>
                  {JSON.stringify(item, null, 2)}
                </pre>
              </div>
            );
          }
        }
      })}
    </div>
  );
});

ClaudeContentArrayRenderer.displayName = "ClaudeContentArrayRenderer";
