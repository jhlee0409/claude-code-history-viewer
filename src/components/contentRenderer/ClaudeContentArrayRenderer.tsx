import { memo } from "react";
import { ThinkingRenderer } from "./ThinkingRenderer";
import { ToolUseRenderer } from "./ToolUseRenderer";
import { ImageRenderer } from "./ImageRenderer";
import { RedactedThinkingRenderer } from "./RedactedThinkingRenderer";
import { ServerToolUseRenderer } from "./ServerToolUseRenderer";
import { WebSearchResultRenderer } from "./WebSearchResultRenderer";
import { DocumentRenderer } from "./DocumentRenderer";
import { CitationRenderer } from "./CitationRenderer";
import { SearchResultRenderer } from "./SearchResultRenderer";
import { MCPToolUseRenderer } from "./MCPToolUseRenderer";
import { MCPToolResultRenderer } from "./MCPToolResultRenderer";
import { WebFetchToolResultRenderer } from "./WebFetchToolResultRenderer";
import { CodeExecutionToolResultRenderer } from "./CodeExecutionToolResultRenderer";
import { BashCodeExecutionToolResultRenderer } from "./BashCodeExecutionToolResultRenderer";
import { TextEditorCodeExecutionToolResultRenderer } from "./TextEditorCodeExecutionToolResultRenderer";
import { ToolSearchToolResultRenderer } from "./ToolSearchToolResultRenderer";
import { ClaudeToolResultItem } from "../toolResultRenderer";
import { useTranslation } from "react-i18next";
import { isImageUrl } from "../../utils/messageUtils";
import { safeStringify } from "../../utils/jsonUtils";
import type { SearchFilterType } from "../../store/useAppStore";
import type {
  DocumentContent,
  SearchResultContent,
  WebSearchResultItem,
  WebSearchToolError,
  Citation,
  MCPToolUseContent,
  MCPToolResultContent,
  WebFetchToolResultContent,
  CodeExecutionToolResultContent,
  BashCodeExecutionToolResultContent,
  TextEditorCodeExecutionToolResultContent,
  ToolSearchToolResultContent,
} from "../../types";

type Props = {
  content: unknown[];
  searchQuery?: string;
  filterType?: SearchFilterType;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
};

const isContentItem = (item: unknown): item is Record<string, unknown> => {
  return item !== null && typeof item === "object";
};

const isCitationArray = (citations: unknown): citations is Citation[] => {
  return (
    Array.isArray(citations) &&
    citations.every(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        "type" in c &&
        "cited_text" in c &&
        "document_index" in c
    )
  );
};

const isDocumentContent = (item: unknown): item is DocumentContent => {
  if (typeof item !== "object" || item === null) return false;
  const obj = item as Record<string, unknown>;
  return (
    obj.type === "document" &&
    typeof obj.source === "object" &&
    obj.source !== null
  );
};

const isSearchResultContent = (item: unknown): item is SearchResultContent => {
  if (typeof item !== "object" || item === null) return false;
  const obj = item as Record<string, unknown>;
  return (
    obj.type === "search_result" &&
    typeof obj.title === "string" &&
    typeof obj.source === "string" &&
    Array.isArray(obj.content)
  );
};

const isMCPToolUse = (item: unknown): item is MCPToolUseContent => {
  if (typeof item !== "object" || item === null) return false;
  const obj = item as Record<string, unknown>;
  return (
    obj.type === "mcp_tool_use" &&
    typeof obj.id === "string" &&
    typeof obj.server_name === "string" &&
    typeof obj.tool_name === "string" &&
    typeof obj.input === "object" &&
    obj.input !== null
  );
};

const isMCPToolResult = (item: unknown): item is MCPToolResultContent => {
  if (typeof item !== "object" || item === null) return false;
  const obj = item as Record<string, unknown>;
  return (
    obj.type === "mcp_tool_result" &&
    typeof obj.tool_use_id === "string" &&
    (typeof obj.content === "string" ||
      (typeof obj.content === "object" && obj.content !== null))
  );
};

// 2025 Beta Content Type Guards
const isWebFetchToolResult = (item: unknown): item is WebFetchToolResultContent => {
  if (typeof item !== "object" || item === null) return false;
  const obj = item as Record<string, unknown>;
  return (
    obj.type === "web_fetch_tool_result" &&
    typeof obj.tool_use_id === "string" &&
    typeof obj.content === "object" &&
    obj.content !== null
  );
};

const isCodeExecutionToolResult = (item: unknown): item is CodeExecutionToolResultContent => {
  if (typeof item !== "object" || item === null) return false;
  const obj = item as Record<string, unknown>;
  return (
    obj.type === "code_execution_tool_result" &&
    typeof obj.tool_use_id === "string" &&
    typeof obj.content === "object" &&
    obj.content !== null
  );
};

const isBashCodeExecutionToolResult = (item: unknown): item is BashCodeExecutionToolResultContent => {
  if (typeof item !== "object" || item === null) return false;
  const obj = item as Record<string, unknown>;
  return (
    obj.type === "bash_code_execution_tool_result" &&
    typeof obj.tool_use_id === "string" &&
    typeof obj.content === "object" &&
    obj.content !== null
  );
};

const isTextEditorCodeExecutionToolResult = (item: unknown): item is TextEditorCodeExecutionToolResultContent => {
  if (typeof item !== "object" || item === null) return false;
  const obj = item as Record<string, unknown>;
  return (
    obj.type === "text_editor_code_execution_tool_result" &&
    typeof obj.tool_use_id === "string" &&
    typeof obj.content === "object" &&
    obj.content !== null
  );
};

const isToolSearchToolResult = (item: unknown): item is ToolSearchToolResultContent => {
  if (typeof item !== "object" || item === null) return false;
  const obj = item as Record<string, unknown>;
  return (
    obj.type === "tool_search_tool_result" &&
    typeof obj.tool_use_id === "string" &&
    (Array.isArray(obj.content) ||
      (typeof obj.content === "object" && obj.content !== null))
  );
};

export const ClaudeContentArrayRenderer = memo(function ClaudeContentArrayRenderer({
  content,
  searchQuery = "",
  filterType = "content",
  isCurrentMatch = false,
  currentMatchIndex = 0,
}: Props) {
  const { t } = useTranslation("components");
  if (!Array.isArray(content) || content.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {content.map((item, index) => {
        if (!isContentItem(item)) {
          return (
            <div key={index} className="text-sm text-gray-600">
              {String(item)}
            </div>
          );
        }

        const itemType = item.type as string;

        switch (itemType) {
          case "text": {
            if (typeof item.text !== "string") return null;
            const citations = isCitationArray(item.citations)
              ? item.citations
              : undefined;
            return (
              <div key={index}>
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <div className="whitespace-pre-wrap text-gray-800">
                    {item.text}
                  </div>
                </div>
                {citations && citations.length > 0 && (
                  <CitationRenderer citations={citations} />
                )}
              </div>
            );
          }

          case "image": {
            if (!item.source || typeof item.source !== "object") return null;
            const source = item.source as Record<string, unknown>;
            if (
              source.type === "base64" &&
              typeof source.data === "string" &&
              typeof source.media_type === "string"
            ) {
              const imageUrl = `data:${source.media_type};base64,${source.data}`;
              return <ImageRenderer key={index} imageUrl={imageUrl} />;
            }
            if (
              source.type === "url" &&
              typeof source.url === "string" &&
              isImageUrl(source.url)
            ) {
              return <ImageRenderer key={index} imageUrl={source.url} />;
            }
            return null;
          }

          case "thinking":
            if (typeof item.thinking === "string") {
              return <ThinkingRenderer key={index} content={item.thinking} />;
            }
            if (typeof item.content === "string") {
              return <ThinkingRenderer key={index} content={item.content} />;
            }
            return null;

          case "redacted_thinking":
            if (typeof item.data !== "string") return null;
            return <RedactedThinkingRenderer key={index} data={item.data} />;

          case "server_tool_use": {
            if (
              typeof item.id !== "string" ||
              typeof item.name !== "string" ||
              typeof item.input !== "object" ||
              item.input === null
            ) {
              return null;
            }
            return (
              <ServerToolUseRenderer
                key={index}
                id={item.id}
                name={item.name}
                input={item.input as Record<string, unknown>}
              />
            );
          }

          case "web_search_tool_result": {
            if (
              typeof item.tool_use_id !== "string" ||
              (!Array.isArray(item.content) &&
                (typeof item.content !== "object" || item.content === null))
            ) {
              return null;
            }
            return (
              <WebSearchResultRenderer
                key={index}
                toolUseId={item.tool_use_id}
                content={item.content as WebSearchResultItem[] | WebSearchToolError}
              />
            );
          }

          case "document": {
            if (!isDocumentContent(item)) return null;
            return <DocumentRenderer key={index} document={item} />;
          }

          case "search_result": {
            if (!isSearchResultContent(item)) return null;
            return <SearchResultRenderer key={index} searchResult={item} />;
          }

          case "mcp_tool_use": {
            if (!isMCPToolUse(item)) return null;
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
            if (!isMCPToolResult(item)) return null;
            return (
              <MCPToolResultRenderer
                key={index}
                toolUseId={item.tool_use_id}
                content={item.content}
                isError={item.is_error}
              />
            );
          }

          // 2025 Beta Content Types
          case "web_fetch_tool_result": {
            if (!isWebFetchToolResult(item)) return null;
            return (
              <WebFetchToolResultRenderer
                key={index}
                toolUseId={item.tool_use_id}
                content={item.content}
              />
            );
          }

          case "code_execution_tool_result": {
            if (!isCodeExecutionToolResult(item)) return null;
            return (
              <CodeExecutionToolResultRenderer
                key={index}
                toolUseId={item.tool_use_id}
                content={item.content}
              />
            );
          }

          case "bash_code_execution_tool_result": {
            if (!isBashCodeExecutionToolResult(item)) return null;
            return (
              <BashCodeExecutionToolResultRenderer
                key={index}
                toolUseId={item.tool_use_id}
                content={item.content}
              />
            );
          }

          case "text_editor_code_execution_tool_result": {
            if (!isTextEditorCodeExecutionToolResult(item)) return null;
            return (
              <TextEditorCodeExecutionToolResultRenderer
                key={index}
                toolUseId={item.tool_use_id}
                content={item.content}
              />
            );
          }

          case "tool_search_tool_result": {
            if (!isToolSearchToolResult(item)) return null;
            return (
              <ToolSearchToolResultRenderer
                key={index}
                toolUseId={item.tool_use_id}
                content={item.content}
              />
            );
          }

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
            return (
              <ClaudeToolResultItem
                toolResult={item}
                index={index}
                searchQuery={filterType === "toolId" ? searchQuery : ""}
                isCurrentMatch={isCurrentMatch}
                currentMatchIndex={currentMatchIndex}
              />
            );

          default:
            return (
              <div
                key={index}
                className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg"
              >
                <div className="text-xs font-medium text-yellow-800 mb-2">
                  {t("claudeContentArrayRenderer.unknownContentType", {
                    defaultValue: "Unknown Content Type: {contentType}",
                    contentType: itemType,
                  })}
                </div>
                <pre className="text-xs text-yellow-700 overflow-auto">
                  {safeStringify(item)}
                </pre>
              </div>
            );
        }
      })}
    </div>
  );
});
