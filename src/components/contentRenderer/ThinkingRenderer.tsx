import { useState, useEffect, memo } from "react";
import { Bot, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { layout } from "@/components/renderers";
import { HighlightedText } from "../common/HighlightedText";

type Props = {
  thinking: string;
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
};

export const ThinkingRenderer = memo(function ThinkingRenderer({
  thinking,
  searchQuery,
  isCurrentMatch = false,
  currentMatchIndex = 0,
}: Props) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  // 검색 쿼리가 있고 내용에 매칭되면 자동으로 펼치기
  useEffect(() => {
    if (searchQuery && thinking.toLowerCase().includes(searchQuery.toLowerCase())) {
      setIsExpanded(true);
    }
  }, [searchQuery, thinking]);

  if (!thinking) return null;

  const firstLine = thinking.split("\n")[0]?.slice(0, 100) || "";
  const hasMore = thinking.length > firstLine.length || thinking.includes("\n");

  return (
    <div className={cn("bg-thinking border border-thinking-border mt-2 overflow-hidden", layout.rounded)}>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "w-full flex items-center text-left",
          layout.headerPadding,
          layout.headerHeight,
          layout.iconGap,
          "hover:bg-thinking/80 transition-colors"
        )}
      >
        <ChevronRight
          className={cn(
            layout.iconSize,
            "shrink-0 transition-transform duration-200 text-thinking-muted",
            isExpanded && "rotate-90"
          )}
        />
        <Bot className={cn(layout.iconSize, "text-thinking-foreground shrink-0")} />
        <span className={cn(layout.titleText, "text-thinking-foreground")}>
          {t("thinkingRenderer.title")}
        </span>
        {!isExpanded && (
          <span className={cn(layout.smallText, "text-thinking-muted truncate italic")}>
            {firstLine}
            {hasMore && "..."}
          </span>
        )}
      </button>

      {isExpanded && (
        <div className={layout.contentPadding}>
          <div className={cn(layout.bodyText, "text-thinking-foreground whitespace-pre-wrap")}>
            {searchQuery ? (
              <HighlightedText
                text={thinking}
                searchQuery={searchQuery}
                isCurrentMatch={isCurrentMatch}
                currentMatchIndex={currentMatchIndex}
              />
            ) : (
              thinking
            )}
          </div>
        </div>
      )}
    </div>
  );
});
