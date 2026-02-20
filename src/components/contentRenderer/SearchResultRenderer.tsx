/**
 * SearchResultRenderer Component
 *
 * Renders search result content blocks from Claude API.
 * Displays search title, source, and result excerpts using the search variant design tokens.
 *
 * @example
 * ```tsx
 * <SearchResultRenderer searchResult={searchResultContent} />
 * ```
 */

import { memo } from "react";
import { Search, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SearchResultContent, TextContent } from "../../types";
import { getVariantStyles, layout } from "@/components/renderers";
import { cn } from "@/lib/utils";
import { ToolResultCard } from "./ToolResultCard";

type Props = {
  searchResult: SearchResultContent;
};

export const SearchResultRenderer = memo(function SearchResultRenderer({
  searchResult,
}: Props) {
  const { t } = useTranslation();
  const { title, source, content } = searchResult;
  const searchStyles = getVariantStyles("search");

  return (
    <ToolResultCard
      title={t("searchResultRenderer.title")}
      icon={<Search className={cn(layout.iconSize, searchStyles.icon)} />}
      variant="search"
    >
      <div className="mb-2">
        <div className={cn("flex items-center", layout.iconGap)}>
          <FileText className={cn(layout.iconSizeSmall, searchStyles.accent)} />
          <span className={cn(layout.bodyText, "font-medium", searchStyles.title)}>{title}</span>
        </div>
        <div className={cn(layout.smallText, "mt-0.5", searchStyles.icon)}>{source}</div>
      </div>

      {content && content.length > 0 && (
        <div className="mt-2 space-y-1">
          {content.map((textContent: TextContent, index: number) => (
            <div
              key={index}
              className={cn(layout.bodyText, layout.containerPadding, layout.rounded, searchStyles.badge, searchStyles.accent)}
            >
              {textContent.text}
            </div>
          ))}
        </div>
      )}
    </ToolResultCard>
  );
});
