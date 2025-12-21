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
 *
 * Features:
 * - Case-insensitive search matching
 * - KakaoTalk-style highlighting: bright yellow for current match, light yellow for others
 * - Accessibility support with aria-current attribute
 * - Scroll targeting with data-search-highlight attribute
 *
 * Performance:
 * - Memoized with useMemo to prevent unnecessary recalculations
 * - React.memo wrapper to prevent parent re-renders
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
    const parts: (string | React.ReactElement)[] = [];
    let lastIndex = 0;
    let matchIndex = 0;

    const textLower = text.toLowerCase();
    let currentIndex = textLower.indexOf(query);

    while (currentIndex !== -1) {
      // Add text before match
      if (currentIndex > lastIndex) {
        parts.push(text.slice(lastIndex, currentIndex));
      }

      // Add highlighted match
      const matchedText = text.slice(currentIndex, currentIndex + query.length);
      const isFirstMatch = matchIndex === 0;

      // Create unique key using position and text snippet to avoid collisions
      const keyId = `${currentIndex}-${matchedText.slice(0, 10)}`;

      parts.push(
        <mark
          key={keyId}
          // Scroll target for current match's first highlight
          {...(isCurrentMatch && isFirstMatch ? { 'data-search-highlight': 'current' } : {})}
          // Accessibility: indicate current match for screen readers
          aria-current={isCurrentMatch && isFirstMatch ? 'true' : undefined}
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

    // Add remaining text after last match
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
