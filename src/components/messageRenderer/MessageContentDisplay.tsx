import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CommandRenderer, ImageRenderer } from "../contentRenderer";
import { isImageUrl, isBase64Image } from "../../utils/messageUtils";
import { TooltipButton } from "../../shared/TooltipButton";
import { HighlightedText } from "../common";

interface MessageContentDisplayProps {
  content: string | null;
  messageType: string;
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number; // 메시지 내에서 현재 활성화된 매치 인덱스
}

export const MessageContentDisplay: React.FC<MessageContentDisplayProps> = ({
  content,
  messageType,
  searchQuery = "",
  isCurrentMatch = false,
  currentMatchIndex = 0,
}) => {
  const { t } = useTranslation("components");

  if (!content) return null;

  if (typeof content === "string") {
    // Check for actual XML command tags (not inside backticks/code)
    // Must have opening tag followed by content and closing tag
    const hasCommandTags =
      /<command-name>[\s\S]*?<\/command-name>/.test(content) ||
      /<command-message>[\s\S]*?<\/command-message>/.test(content) ||
      /<command-args>[\s\S]*?<\/command-args>/.test(content) ||
      /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/.test(content) ||
      /<[^>]*-stdout>[\s\S]*?<\/[^>]*>/.test(content) ||
      /<[^>]*-stderr>[\s\S]*?<\/[^>]*>/.test(content);

    if (hasCommandTags) {
      return <CommandRenderer text={content} />;
    }

    if (isImageUrl(content) || isBase64Image(content)) {
      return <ImageRenderer imageUrl={content} />;
    }

    const imageMatch = content.match(
      /(data:image\/[^;\s]+;base64,[A-Za-z0-9+/=]+|https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|svg|webp))/i
    );
    if (imageMatch && imageMatch[1]) {
      const imageUrl = imageMatch[1];
      const textWithoutImage = content.replace(imageMatch[0], "").trim();

      return (
        <>
          <ImageRenderer imageUrl={imageUrl} />
          {textWithoutImage && textWithoutImage.length > 0 && (
            <div className="mt-2">
              <MessageContentDisplay
                content={textWithoutImage}
                messageType={messageType}
                searchQuery={searchQuery}
                isCurrentMatch={isCurrentMatch}
                currentMatchIndex={currentMatchIndex}
              />
            </div>
          )}
        </>
      );
    }
  }

  if (typeof content !== "string") {
    return null; // Or some other fallback for non-string content
  }

  if (messageType === "user") {
    return (
      <div className="mb-3 flex justify-end">
        <div className="max-w-xs sm:max-w-md lg:max-w-lg bg-blue-500 text-white rounded-2xl px-4 py-3 relative group shadow-sm">
          <div className="whitespace-pre-wrap break-words text-sm">
            {searchQuery ? (
              <HighlightedText
                text={content}
                searchQuery={searchQuery}
                isCurrentMatch={isCurrentMatch}
                currentMatchIndex={currentMatchIndex}
              />
            ) : (
              content
            )}
          </div>
          <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <TooltipButton
              onClick={() => navigator.clipboard.writeText(content)}
              className="p-1 rounded-full transition-colors bg-blue-600 hover:bg-blue-700 text-white"
              content={t("messageContentDisplay.copyMessage")}
            >
              <Copy className="w-3 h-3" />
            </TooltipButton>
          </div>
        </div>
      </div>
    );
  } else if (messageType === "assistant") {
    return (
      <div className="mb-3 flex justify-start">
        <div className="max-w-xs sm:max-w-md lg:max-w-2xl bg-green-500/80 text-white rounded-2xl px-4 py-3 relative group shadow-sm">
          {/* 검색 중일 때는 plain text로 렌더링 (성능 + 하이라이팅) */}
          {searchQuery ? (
            <div className="whitespace-pre-wrap break-words text-sm">
              <HighlightedText
                text={content}
                searchQuery={searchQuery}
                isCurrentMatch={isCurrentMatch}
                currentMatchIndex={currentMatchIndex}
              />
            </div>
          ) : (
            <div className="prose prose-sm max-w-none prose-headings:text-white prose-p:text-white prose-a:text-blue-200 prose-code:text-gray-900 prose-code:bg-white prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-blockquote:text-green-100 prose-blockquote:border-l-4 prose-blockquote:border-green-300 prose-blockquote:pl-4 prose-ul:text-white prose-ol:text-white prose-li:text-white">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            </div>
          )}
          <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <TooltipButton
              onClick={() => navigator.clipboard.writeText(content)}
              className="p-1 rounded-full transition-colors bg-green-600 hover:bg-green-700 text-white"
              content={t("messageContentDisplay.copyMessage")}
            >
              <Copy className="w-3 h-3" />
            </TooltipButton>
          </div>
        </div>
      </div>
    );
  }

  // Fallback for other message types like 'system'
  return (
    <div className="prose prose-sm max-w-none">
      <div className="whitespace-pre-wrap text-gray-800">
        {searchQuery ? (
          <HighlightedText
            text={content}
            searchQuery={searchQuery}
            isCurrentMatch={isCurrentMatch}
            currentMatchIndex={currentMatchIndex}
          />
        ) : (
          content
        )}
      </div>
    </div>
  );
};
