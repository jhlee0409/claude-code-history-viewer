import React, { useMemo, memo } from "react";
import { cn } from "../../utils/cn";

interface HighlightedTextProps {
  text: string;
  searchQuery: string;
  isCurrentMatch?: boolean;
  className?: string;
}

/**
 * 검색어를 하이라이트하여 텍스트를 렌더링하는 컴포넌트
 * 카카오톡 스타일: 현재 매치는 진한 노랑, 다른 매치는 연한 노랑
 */
const HighlightedTextComponent: React.FC<HighlightedTextProps> = ({
  text,
  searchQuery,
  isCurrentMatch = false,
  className,
}) => {
  const highlightedContent = useMemo(() => {
    if (!searchQuery.trim()) {
      return text;
    }

    const query = searchQuery.toLowerCase();
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let matchIndex = 0;

    const textLower = text.toLowerCase();
    let currentIndex = textLower.indexOf(query);

    while (currentIndex !== -1) {
      // 매치 전 텍스트 추가
      if (currentIndex > lastIndex) {
        parts.push(text.slice(lastIndex, currentIndex));
      }

      // 하이라이트된 텍스트 추가
      const matchedText = text.slice(currentIndex, currentIndex + query.length);
      const isFirstMatch = matchIndex === 0;

      parts.push(
        <mark
          key={`highlight-${matchIndex}`}
          // 현재 매치의 첫 번째 하이라이트에 스크롤 타겟 속성 추가
          {...(isCurrentMatch && isFirstMatch ? { 'data-search-highlight': 'current' } : {})}
          className={cn(
            "rounded px-0.5 transition-colors",
            isCurrentMatch
              ? "bg-yellow-400 dark:bg-yellow-500 text-gray-900 ring-2 ring-yellow-500 dark:ring-yellow-400"
              : "bg-yellow-200 dark:bg-yellow-600/50 text-gray-900 dark:text-gray-100"
          )}
        >
          {matchedText}
        </mark>
      );

      lastIndex = currentIndex + query.length;
      matchIndex++;
      currentIndex = textLower.indexOf(query, lastIndex);
    }

    // 마지막 매치 이후 텍스트 추가
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  }, [text, searchQuery, isCurrentMatch]);

  return <span className={className}>{highlightedContent}</span>;
};

// React.memo로 불필요한 리렌더링 방지
export const HighlightedText = memo(HighlightedTextComponent);

export default HighlightedText;
