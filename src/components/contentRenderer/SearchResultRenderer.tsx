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

type Props = {
  searchResult: SearchResultContent;
};

export const SearchResultRenderer = memo(function SearchResultRenderer({
  searchResult,
}: Props) {
  const { t } = useTranslation("components");
  const { title, source, content } = searchResult;
  const searchStyles = getVariantStyles("search");

  return (
    <div className={cn(layout.rounded, "border", searchStyles.container)}>
      <div className={cn("flex items-center justify-between", layout.headerPadding, layout.headerHeight)}>
        <div className={cn("flex items-center", layout.iconGap)}>
          <Search className={cn(layout.iconSize, searchStyles.icon)} />
          <span className={cn(layout.titleText, searchStyles.title)}>
            {t("searchResultRenderer.title", { defaultValue: "Search Result" })}
          </span>
        </div>
      </div>

      <div className={layout.contentPadding}>
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
      </div>
    </div>
  );
});
