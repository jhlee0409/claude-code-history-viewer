import { memo } from "react";
import { ExternalLink, Search, AlertCircle, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { layout } from "@/components/renderers";
import type {
  WebSearchResultItem,
  WebSearchToolError,
} from "../../types";

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
  const { t } = useTranslation("components");

  if (isError(content)) {
    return (
      <div className={cn("bg-destructive/10 border border-destructive/30", layout.rounded, layout.containerPadding)}>
        <div className={cn("flex items-center mb-2", layout.iconSpacing)}>
          <AlertCircle className={cn(layout.iconSize, "text-destructive")} />
          <span className={cn(layout.titleText, "text-destructive")}>
            {t("webSearchResultRenderer.error", {
              defaultValue: "Search Error",
            })}
          </span>
          <span className={cn(layout.monoText, "text-destructive/70")}>{toolUseId}</span>
        </div>
        <div className={cn(layout.bodyText, "text-destructive")}>
          <span className="font-medium">{content.error_code}:</span>{" "}
          {content.message}
        </div>
      </div>
    );
  }

  const results = content as WebSearchResultItem[];

  return (
    <div className={cn("bg-tool-web/10 border border-tool-web/30", layout.rounded, layout.containerPadding)}>
      <div className={cn("flex items-center mb-2", layout.iconSpacing)}>
        <Search className={cn(layout.iconSize, "text-tool-web")} />
        <span className={cn(layout.titleText, "text-foreground")}>
          {t("webSearchResultRenderer.title", {
            defaultValue: "Web Search Results",
          })}
        </span>
        <span className={cn(layout.smallText, "text-tool-web")}>
          ({results.length}{" "}
          {t("webSearchResultRenderer.results", { defaultValue: "results" })})
        </span>
      </div>

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
    </div>
  );
});
