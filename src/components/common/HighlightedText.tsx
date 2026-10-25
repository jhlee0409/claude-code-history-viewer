import React, { useMemo, memo } from "react";
import { cn } from "@/lib/utils";
import { searchRanges } from "./searchMarks";

/** A search mark's look (also PathText's marks): bright for the current match, light for the others. */
export const searchMarkBaseClass = "rounded px-0.5 transition-colors";
export const searchMarkCurrentClass = "bg-highlight-current text-highlight-foreground ring-2 ring-highlight-current";
export const searchMarkOtherClass = "bg-highlight text-highlight-foreground";

interface HighlightedTextProps {
  text: string;
  searchQuery: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number; // 메시지 내에서 현재 활성화된 매치 인덱스
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
  currentMatchIndex = 0,
  className,
}) => {
  const highlightedContent = useMemo(() => {
    const ranges = searchRanges(text, searchQuery);
    if (ranges.length === 0) {
      return text;
    }

    const parts: (string | React.ReactElement)[] = [];
    let lastIndex = 0;

    ranges.forEach(([start, end], matchIndex) => {
      // Add text before match
      if (start > lastIndex) {
        parts.push(text.slice(lastIndex, start));
      }

      // Add highlighted match
      const matchedText = text.slice(start, end);

      // 이 매치가 현재 활성화된 매치인지 확인
      const isThisMatchActive = isCurrentMatch && matchIndex === currentMatchIndex;

      // Create unique key using position and text snippet to avoid collisions
      const keyId = `${start}-${matchedText.slice(0, 10)}`;

      parts.push(
        <mark
          key={keyId}
          // Scroll target for the active match
          {...(isThisMatchActive ? { 'data-search-highlight': 'current' } : {})}
          // Accessibility: indicate current match for screen readers
          aria-current={isThisMatchActive ? 'true' : undefined}
          className={cn(
            searchMarkBaseClass,
            isThisMatchActive ? searchMarkCurrentClass : searchMarkOtherClass
          )}
        >
          {matchedText}
        </mark>
      );

      lastIndex = end;
    });

    // Add remaining text after last match
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts;
  }, [text, searchQuery, isCurrentMatch, currentMatchIndex]);

  return <span className={className}>{highlightedContent}</span>;
};

// React.memo로 불필요한 리렌더링 방지
export const HighlightedText = memo(HighlightedTextComponent);
