/**
 * CitationRenderer Component
 *
 * Renders a list of citations from Claude API responses, displaying document references
 * with their locations (character ranges, page numbers, or content blocks) and cited text.
 */
import { memo } from "react";
import { Quote, FileText, Hash } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { layout } from "@/components/renderers";
import type { Citation } from "../../types";

type Props = {
  citations: Citation[];
};

export const CitationRenderer = memo(function CitationRenderer({
  citations,
}: Props) {
  const { t } = useTranslation();

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
          <span className={cn(layout.smallText, "text-muted-foreground")}>
            {t("citationRenderer.charLocation", {start: citation.start_char_index,
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
          <span className={cn(layout.smallText, "text-muted-foreground")}>
            {citation.start_page_number === citation.end_page_number
              ? t("citationRenderer.singlePage", {page: citation.start_page_number,
                })
              : t("citationRenderer.pageRange", {start: citation.start_page_number,
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
          <span className={cn(layout.smallText, "text-muted-foreground")}>
            {t("citationRenderer.blockLocation", {start: citation.start_block_index,
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
        return <FileText className={cn(layout.iconSizeSmall, "text-info")} />;
      case "content_block_location":
        return <Hash className={cn(layout.iconSizeSmall, "text-info")} />;
      default:
        return <Quote className={cn(layout.iconSizeSmall, "text-info")} />;
    }
  };

  return (
    <div className="mt-2 border-t border-info/20 pt-2">
      <div className={cn("flex items-center mb-2", layout.iconGap)}>
        <Quote className={cn(layout.iconSizeSmall, "text-info")} />
        <span className={cn(layout.titleText, "text-info")}>
          {t("citationRenderer.title")} (
          {citations.length})
        </span>
      </div>

      <div className="space-y-1">
        {citations.map((citation, index) => (
          <div
            key={index}
            className={cn("bg-info/10 border border-info/20", layout.containerPadding, layout.rounded)}
          >
            <div className={cn("flex items-start", layout.iconSpacing)}>
              {getTypeIcon(citation.type)}
              <div className="flex-1 min-w-0">
                <div className={cn("flex items-center flex-wrap", layout.iconSpacing)}>
                  <span className={cn(layout.titleText, "text-info")}>
                    [{citation.document_index + 1}]
                  </span>
                  {citation.document_title && (
                    <span className={cn(layout.smallText, "text-info truncate")}>
                      {citation.document_title}
                    </span>
                  )}
                  {getLocationInfo(citation)}
                </div>
                <div className={cn("mt-1 text-info italic line-clamp-2", layout.bodyText)}>
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
