import { memo } from "react";
import { ExternalLink, Search, AlertCircle, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "@/components/renderers";
import type {
  WebSearchResultItem,
  WebSearchToolError,
} from "../../types";
import { ToolResultCard } from "./ToolResultCard";

type Props = {
  toolUseId: string;
  content: WebSearchResultItem[] | WebSearchToolError;
};

const isError = (
  content: WebSearchResultItem[] | WebSearchToolError
): content is WebSearchToolError => {
  return (
    typeof content === "object" &&
    !Array.isArray(content) &&
    "type" in content &&
    content.type === "error"
  );
};

export const WebSearchResultRenderer = memo(function WebSearchResultRenderer({
  toolUseId,
  content,
}: Props) {
  const { t } = useTranslation();
  const webStyles = getVariantStyles("web");

  if (isError(content)) {
    return (
      <ToolResultCard
        title={t("webSearchResultRenderer.error")}
        icon={<AlertCircle className={cn(layout.iconSize, "text-destructive")} />}
        variant="error"
        toolUseId={toolUseId}
      >
        <div className={cn(layout.bodyText, "text-destructive")}>
          <span className="font-medium">{content.error_code}:</span>{" "}
          {content.message}
        </div>
      </ToolResultCard>
    );
  }

  const results = content as WebSearchResultItem[];

  return (
    <ToolResultCard
      title={t("webSearchResultRenderer.title")}
      icon={<Search className={cn(layout.iconSize, webStyles.icon)} />}
      variant="web"
      toolUseId={toolUseId}
      rightContent={
        <span className={cn(layout.smallText, "px-1.5 py-0.5 rounded", webStyles.badge, webStyles.badgeText)}>
          {results.length} {t("webSearchResultRenderer.results")}
        </span>
      }
    >
      {results.length === 0 && (
        <div className={cn(layout.smallText, "text-muted-foreground italic")}>
          {t("webSearchResultRenderer.noResults")}
        </div>
      )}

      <div className="space-y-1.5">
        {results.map((result) => (
          <div
            key={result.url}
            className={cn("bg-card border border-border", layout.containerPadding, layout.rounded)}
          >
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn("flex items-start group", layout.iconSpacing)}
            >
              <ExternalLink className={cn(layout.iconSizeSmall, "text-tool-web mt-0.5 flex-shrink-0")} />
              <div className="flex-1 min-w-0">
                <div className={cn(layout.bodyText, "font-medium text-foreground group-hover:text-accent truncate")}>
                  {result.title}
                </div>
                <div className={cn(layout.smallText, "text-muted-foreground truncate")}>
                  {result.url}
                </div>
                {result.page_age && (
                  <div className={cn("flex items-center mt-1", layout.iconSpacing, layout.smallText, "text-muted-foreground")}>
                    <Clock className={layout.iconSizeSmall} />
                    <span>{result.page_age}</span>
                  </div>
                )}
              </div>
            </a>
          </div>
        ))}
      </div>
    </ToolResultCard>
  );
});
