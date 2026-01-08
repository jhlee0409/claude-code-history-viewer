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
import { ClaudeToolResultItem } from "../toolResultRenderer";
import { useTranslation } from "react-i18next";
import type { SearchFilterType } from "../../store/useAppStore";
import type {
  DocumentContent,
  SearchResultContent,
  WebSearchResultItem,
  WebSearchToolError,
  Citation,
  MCPToolResultData,
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

const isDocumentContent = (item: Record<string, unknown>): boolean => {
  return (
    item.type === "document" &&
    typeof item.source === "object" &&
    item.source !== null
  );
};

const isSearchResultContent = (item: Record<string, unknown>): boolean => {
  return (
    item.type === "search_result" &&
    typeof item.title === "string" &&
    typeof item.source === "string" &&
    Array.isArray(item.content)
  );
};

const isMCPToolUse = (item: Record<string, unknown>): boolean => {
  return (
    item.type === "mcp_tool_use" &&
    typeof item.id === "string" &&
    typeof item.server_name === "string" &&
    typeof item.tool_name === "string" &&
    typeof item.input === "object" &&
    item.input !== null
  );
};

const isMCPToolResult = (item: Record<string, unknown>): boolean => {
  return (
    item.type === "mcp_tool_result" &&
    typeof item.tool_use_id === "string" &&
    (typeof item.content === "string" ||
      (typeof item.content === "object" && item.content !== null))
  );
};

const safeStringify = (obj: unknown, indent = 2): string => {
  try {
    return JSON.stringify(obj, null, indent);
  } catch {
    return "[Unable to stringify - possible circular reference]";
  }
};

export const ClaudeContentArrayRenderer = ({
  content,
  searchQuery = "",
  filterType = "content",
  isCurrentMatch = false,
  currentMatchIndex = 0,
}: Props) => {
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
            if (source.type === "url" && typeof source.url === "string") {
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
            return (
              <DocumentRenderer
                key={index}
                document={item as unknown as DocumentContent}
              />
            );
          }

          case "search_result": {
            if (!isSearchResultContent(item)) return null;
            return (
              <SearchResultRenderer
                key={index}
                searchResult={item as unknown as SearchResultContent}
              />
            );
          }

          case "mcp_tool_use": {
            if (!isMCPToolUse(item)) return null;
            return (
              <MCPToolUseRenderer
                key={index}
                id={item.id as string}
                serverName={item.server_name as string}
                toolName={item.tool_name as string}
                input={item.input as Record<string, unknown>}
              />
            );
          }

          case "mcp_tool_result": {
            if (!isMCPToolResult(item)) return null;
            return (
              <MCPToolResultRenderer
                key={index}
                toolUseId={item.tool_use_id as string}
                content={item.content as MCPToolResultData | string}
                isError={
                  typeof item.is_error === "boolean" ? item.is_error : undefined
                }
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
};
