import { memo } from "react";
import { Search, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SearchResultContent, TextContent } from "../../types";

type Props = {
  searchResult: SearchResultContent;
};

export const SearchResultRenderer = memo(function SearchResultRenderer({
  searchResult,
}: Props) {
  const { t } = useTranslation("components");
  const { title, source, content } = searchResult;

  return (
    <div className="bg-teal-50 border border-teal-200 rounded-lg p-3">
      <div className="flex items-center space-x-2 mb-2">
        <Search className="w-4 h-4 text-teal-600" />
        <span className="text-xs font-medium text-teal-800">
          {t("searchResultRenderer.title", { defaultValue: "Search Result" })}
        </span>
      </div>

      <div className="mb-2">
        <div className="flex items-center space-x-2">
          <FileText className="w-3 h-3 text-teal-500" />
          <span className="text-sm font-medium text-teal-800">{title}</span>
        </div>
        <div className="text-xs text-teal-600 mt-0.5">{source}</div>
      </div>

      {content && content.length > 0 && (
        <div className="mt-2 space-y-1">
          {content.map((textContent: TextContent, index: number) => (
            <div
              key={index}
              className="text-sm text-teal-700 bg-teal-100/50 rounded p-2"
            >
              {textContent.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
