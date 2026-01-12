import { ThinkingRenderer } from "./ThinkingRenderer";
import { ToolUseRenderer } from "./ToolUseRenderer";
import { ImageRenderer } from "./ImageRenderer";
import { ClaudeToolResultItem } from "../toolResultRenderer";
import { useTranslation } from "react-i18next";
import type { SearchFilterType } from "../../store/useAppStore";

type Props = {
  content: unknown[];
  searchQuery?: string;
  filterType?: SearchFilterType;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
  skipToolResults?: boolean;
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
  skipToolResults = false,
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
          case "text":
            if (typeof item.text === "string") {
              return (
                <div
                  key={index}
                  className="p-3 bg-gray-50 border border-gray-200 rounded-lg"
                >
                  <div className="whitespace-pre-wrap text-gray-800">
                    {item.text}
                  </div>
                </div>
              );
            }
            return null;

          case "image":
            // Claude API 형태의 이미지 객체 처리
            if (item.source && typeof item.source === "object") {
              const source = item.source as Record<string, unknown>;
              if (
                source.type === "base64" &&
                source.data &&
                source.media_type
              ) {
                const imageUrl = `data:${source.media_type};base64,${source.data}`;
                return <ImageRenderer key={index} imageUrl={imageUrl} />;
              }
            }
            return null;

          case "thinking":
            if (typeof item.thinking === "string") {
              return <ThinkingRenderer key={index} thinking={item.thinking} />;
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
