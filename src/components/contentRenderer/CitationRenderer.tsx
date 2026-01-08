import { memo } from "react";
import { Quote, FileText, Hash } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Citation } from "../../types";

type Props = {
  citations: Citation[];
};

export const CitationRenderer = memo(function CitationRenderer({
  citations,
}: Props) {
  const { t } = useTranslation("components");

  if (!citations || citations.length === 0) return null;

  const getLocationInfo = (citation: Citation) => {
    switch (citation.type) {
      case "char_location": {
        if (
          citation.start_char_index === undefined ||
          citation.end_char_index === undefined
        ) {
          return null;
        }
        return (
          <span className="text-xs text-gray-500">
            {t("citationRenderer.charLocation", {
              defaultValue: "chars {start}-{end}",
              start: citation.start_char_index,
              end: citation.end_char_index,
            })}
          </span>
        );
      }
      case "page_location": {
        if (
          citation.start_page_number === undefined ||
          citation.end_page_number === undefined
        ) {
          return null;
        }
        return (
          <span className="text-xs text-gray-500">
            {citation.start_page_number === citation.end_page_number
              ? t("citationRenderer.singlePage", {
                  defaultValue: "page {page}",
                  page: citation.start_page_number,
                })
              : t("citationRenderer.pageRange", {
                  defaultValue: "pages {start}-{end}",
                  start: citation.start_page_number,
                  end: citation.end_page_number,
                })}
          </span>
        );
      }
      case "content_block_location": {
        if (
          citation.start_block_index === undefined ||
          citation.end_block_index === undefined
        ) {
          return null;
        }
        return (
          <span className="text-xs text-gray-500">
            {t("citationRenderer.blockLocation", {
              defaultValue: "blocks {start}-{end}",
              start: citation.start_block_index,
              end: citation.end_block_index,
            })}
          </span>
        );
      }
      default:
        return null;
    }
  };

  const getTypeIcon = (type: Citation["type"]) => {
    switch (type) {
      case "page_location":
        return <FileText className="w-3 h-3 text-indigo-500" />;
      case "content_block_location":
        return <Hash className="w-3 h-3 text-indigo-500" />;
      default:
        return <Quote className="w-3 h-3 text-indigo-500" />;
    }
  };

  return (
    <div className="mt-2 border-t border-indigo-100 pt-2">
      <div className="flex items-center space-x-1 mb-2">
        <Quote className="w-3 h-3 text-indigo-600" />
        <span className="text-xs font-medium text-indigo-700">
          {t("citationRenderer.title", { defaultValue: "Citations" })} (
          {citations.length})
        </span>
      </div>

      <div className="space-y-1">
        {citations.map((citation, index) => (
          <div
            key={index}
            className="bg-indigo-50 border border-indigo-100 rounded p-2"
          >
            <div className="flex items-start space-x-2">
              {getTypeIcon(citation.type)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2 flex-wrap">
                  <span className="text-xs font-medium text-indigo-800">
                    [{citation.document_index + 1}]
                  </span>
                  {citation.document_title && (
                    <span className="text-xs text-indigo-600 truncate">
                      {citation.document_title}
                    </span>
                  )}
                  {getLocationInfo(citation)}
                </div>
                <div className="mt-1 text-sm text-indigo-700 italic line-clamp-2">
                  "{citation.cited_text}"
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
