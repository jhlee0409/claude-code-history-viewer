import React, { useState, useMemo, Children, isValidElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CommandRenderer, ImageRenderer, TaskNotificationRenderer, hasTaskNotification } from "../contentRenderer";
import { isImageUrl, isBase64Image } from "../../utils/messageUtils";
import { TooltipButton } from "../../shared/TooltipButton";
import { HighlightedText } from "../common";
import { layout } from "@/components/renderers";
import { cn } from "@/lib/utils";

const LINE_LIMIT = 3;
const TABLE_ROW_LIMIT = 2;

// Get line count and preview text
const getTextInfo = (text: string) => {
  const lines = text.split('\n');
  const lineCount = lines.length;
  const preview = lines.slice(0, LINE_LIMIT).join('\n');
  return { lineCount, preview, needsExpand: lineCount > LINE_LIMIT };
};

// Collapsible table component for markdown
const CollapsibleTable = ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Extract thead and tbody from children
  const childArray = Children.toArray(children);
  const thead = childArray.find(
    (child) => isValidElement(child) && child.type === "thead"
  );
  const tbody = childArray.find(
    (child) => isValidElement(child) && child.type === "tbody"
  ) as React.ReactElement<{ children?: React.ReactNode }> | undefined;

  // Count rows in tbody
  let rowCount = 0;
  if (tbody?.props?.children) {
    rowCount = Children.count(tbody.props.children);
  }

  const needsExpand = rowCount > TABLE_ROW_LIMIT;

  // Get limited rows for preview
  const getLimitedTbody = () => {
    if (!tbody?.props?.children || !needsExpand || isExpanded) {
      return tbody;
    }

    const rows = Children.toArray(tbody.props.children);
    const limitedRows = rows.slice(0, TABLE_ROW_LIMIT);

    return React.cloneElement(tbody, {
      children: limitedRows,
    });
  };

  return (
    <div className="relative">
      <table {...props}>
        {thead}
        {getLimitedTbody()}
      </table>

      {needsExpand && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            "flex items-center justify-center gap-1 w-full py-1.5 mt-1",
            "text-2xs text-muted-foreground hover:text-foreground",
            "border-t border-border/50",
            "transition-colors"
          )}
        >
          <ChevronDown className={cn(
            "w-3 h-3 transition-transform",
            isExpanded && "rotate-180"
          )} />
          <span>
            {isExpanded
              ? "Show less"
              : `Show ${rowCount - TABLE_ROW_LIMIT} more rows...`}
          </span>
        </button>
      )}
    </div>
  );
};

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
  const [isExpanded, setIsExpanded] = useState(false);

  // Check if content needs expand (for both user and assistant)
  const textInfo = useMemo(() => {
    if (typeof content === "string") {
      return getTextInfo(content);
    }
    return { lineCount: 0, preview: "", needsExpand: false };
  }, [content]);

  if (!content) return null;

  if (typeof content === "string") {
    // Check for task-notification tags (agent task results)
    if (hasTaskNotification(content)) {
      return <TaskNotificationRenderer text={content} />;
    }

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
    const showPreview = textInfo.needsExpand && !isExpanded && !searchQuery;
    const displayContent = showPreview ? textInfo.preview : content;

    return (
      <div className="mb-3 flex justify-end">
        <div className="max-w-xs sm:max-w-md lg:max-w-lg bg-accent text-accent-foreground rounded-2xl px-4 py-3 relative group shadow-sm">
          <div className={cn(
            "whitespace-pre-wrap break-words",
            layout.bodyText
          )}>
            {searchQuery ? (
              <HighlightedText
                text={content}
                searchQuery={searchQuery}
                isCurrentMatch={isCurrentMatch}
                currentMatchIndex={currentMatchIndex}
              />
            ) : (
              displayContent
            )}
          </div>

          {/* Show more / Show less button */}
          {textInfo.needsExpand && !searchQuery && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className={cn(
                "flex items-center gap-1 mt-1.5 text-2xs",
                "text-accent-foreground/70 hover:text-accent-foreground",
                "transition-colors"
              )}
            >
              <ChevronDown className={cn(
                "w-3 h-3 transition-transform",
                isExpanded && "rotate-180"
              )} />
              <span>
                {isExpanded
                  ? t("messageContentDisplay.showLess", { defaultValue: "Show less" })
                  : t("messageContentDisplay.showMore", { defaultValue: "Show more..." })}
              </span>
            </button>
          )}

          <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <TooltipButton
              onClick={() => navigator.clipboard.writeText(content)}
              className="p-1 rounded-full transition-colors bg-accent/80 hover:bg-accent/60 text-accent-foreground"
              content={t("messageContentDisplay.copyMessage")}
            >
              <Copy className={layout.iconSizeSmall} />
            </TooltipButton>
          </div>
        </div>
      </div>
    );
  } else if (messageType === "assistant") {
    const showPreview = textInfo.needsExpand && !isExpanded && !searchQuery;
    const displayContent = showPreview ? textInfo.preview : content;

    return (
      <div className="mb-3 flex justify-start">
        <div className="max-w-xs sm:max-w-md lg:max-w-2xl bg-secondary text-secondary-foreground rounded-2xl px-4 py-3 relative group shadow-sm border border-border">
          {/* 검색 중일 때는 plain text로 렌더링 (성능 + 하이라이팅) */}
          {searchQuery ? (
            <div className={`whitespace-pre-wrap break-words ${layout.bodyText}`}>
              <HighlightedText
                text={content}
                searchQuery={searchQuery}
                isCurrentMatch={isCurrentMatch}
                currentMatchIndex={currentMatchIndex}
              />
            </div>
          ) : (
            <div className={cn(
              layout.prose,
              "prose-headings:text-foreground prose-p:text-foreground prose-a:text-accent",
              "prose-code:text-foreground prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded",
              "prose-pre:bg-card prose-pre:text-foreground prose-pre:border prose-pre:border-border",
              "prose-blockquote:text-muted-foreground prose-blockquote:border-l-4 prose-blockquote:border-accent prose-blockquote:pl-4",
              "prose-ul:text-foreground prose-ol:text-foreground prose-li:text-foreground"
            )}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  table: CollapsibleTable,
                }}
              >
                {displayContent}
              </ReactMarkdown>
            </div>
          )}

          {/* Show more / Show less button */}
          {textInfo.needsExpand && !searchQuery && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className={cn(
                "flex items-center gap-1 mt-2 text-2xs",
                "text-muted-foreground hover:text-foreground",
                "transition-colors"
              )}
            >
              <ChevronDown className={cn(
                "w-3 h-3 transition-transform",
                isExpanded && "rotate-180"
              )} />
              <span>
                {isExpanded
                  ? t("messageContentDisplay.showLess", { defaultValue: "Show less" })
                  : t("messageContentDisplay.showMore", { defaultValue: "Show more..." })}
              </span>
            </button>
          )}

          <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <TooltipButton
              onClick={() => navigator.clipboard.writeText(content)}
              className="p-1 rounded-full transition-colors bg-muted hover:bg-muted/80 text-muted-foreground"
              content={t("messageContentDisplay.copyMessage")}
            >
              <Copy className={layout.iconSizeSmall} />
            </TooltipButton>
          </div>
        </div>
      </div>
    );
  }

  // Fallback for other message types like 'system'
  return (
    <div className={layout.prose}>
      <div className="whitespace-pre-wrap text-foreground">
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
