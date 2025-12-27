import { ThinkingRenderer } from "./ThinkingRenderer";
import { ToolUseRenderer } from "./ToolUseRenderer";
import { ImageRenderer } from "./ImageRenderer";
import { RedactedThinkingRenderer } from "./RedactedThinkingRenderer";
import { ServerToolUseRenderer } from "./ServerToolUseRenderer";
import { WebSearchResultRenderer } from "./WebSearchResultRenderer";
import { DocumentRenderer } from "./DocumentRenderer";
import { CitationRenderer } from "./CitationRenderer";
import { SearchResultRenderer } from "./SearchResultRenderer";
import { ClaudeToolResultItem } from "../toolResultRenderer";
import { useTranslation } from "react-i18next";
import type { SearchFilterType } from "../../store/useAppStore";
import type {
  DocumentContent,
  SearchResultContent,
  WebSearchResultItem,
  WebSearchToolError,
  Citation,
} from "../../types";

type Props = {
  content: unknown[];
  searchQuery?: string;
  filterType?: SearchFilterType;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number; // 메시지 내에서 현재 활성화된 매치 인덱스
};

// Type guard for content items
const isContentItem = (item: unknown): item is Record<string, unknown> => {
  return item !== null && typeof item === "object";
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
            if (typeof item.text === "string") {
              const citations = item.citations as Citation[] | undefined;
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
            return null;
          }

          case "image":
            // Claude API 형태의 이미지 객체 처리
            if (item.source && typeof item.source === "object") {
              const source = item.source as Record<string, unknown>;
              if (source.type === "base64" && source.data && source.media_type) {
                const imageUrl = `data:${source.media_type};base64,${source.data}`;
                return <ImageRenderer key={index} imageUrl={imageUrl} />;
              }
              if (source.type === "url" && source.url) {
                return <ImageRenderer key={index} imageUrl={source.url as string} />;
              }
            }
            return null;

          case "thinking":
            if (typeof item.thinking === "string") {
              return <ThinkingRenderer key={index} content={item.thinking} />;
            }
            if (typeof item.content === "string") {
              return <ThinkingRenderer key={index} content={item.content} />;
            }
            return null;

          case "redacted_thinking":
            if (typeof item.data === "string") {
              return <RedactedThinkingRenderer key={index} data={item.data} />;
            }
            return null;

          case "server_tool_use":
            return (
              <ServerToolUseRenderer
                key={index}
                id={item.id as string}
                name={item.name as string}
                input={item.input as Record<string, unknown>}
              />
            );

          case "web_search_tool_result":
            return (
              <WebSearchResultRenderer
                key={index}
                toolUseId={item.tool_use_id as string}
                content={item.content as WebSearchResultItem[] | WebSearchToolError}
              />
            );

          case "document":
            return (
              <DocumentRenderer
                key={index}
                document={item as unknown as DocumentContent}
              />
            );

          case "search_result":
            return (
              <SearchResultRenderer
                key={index}
                searchResult={item as unknown as SearchResultContent}
              />
            );

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
            // 기본 JSON 렌더링
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
                  {JSON.stringify(item, null, 2)}
                </pre>
              </div>
            );
        }
      })}
    </div>
  );
};
