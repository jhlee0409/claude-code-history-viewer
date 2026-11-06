"use client";

import { Globe } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { REMARK_PLUGINS, REHYPE_PLUGINS } from "@/lib/markdownPlugins";
import { useTranslation } from "react-i18next";
import { RecordedResult } from "@/components/transcript/RecordedResult";
import { layout } from "@/components/renderers";
import { cn } from "@/lib/utils";
import { HighlightedText } from "../common/HighlightedText";
import { safeStringify } from "@/utils/jsonUtils";
import { TruncatedPre } from "@/components/common/TruncatedPre";
import { useFormat } from "@/lib/format/useFormat";
import { Num } from "@/lib/format/Num";
// Compatibility only: Claude Code 2.1.285 emits batch objects + commentary,
// not JSON-string links (docs/contracts/anthropic-server-tools.md).
// Normalize once so the legacy count and renderer inspect the same items.
const legacyResult = (item: unknown): unknown => {
  if (typeof item !== "string") return item;
  try {
    const parsed: unknown = JSON.parse(item);
    if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed) &&
      ["title", "url", "description"].some(key => typeof (parsed as Record<string, unknown>)[key] === "string" && (parsed as Record<string, unknown>)[key])) return parsed;
  } catch { /* Malformed JSON remains commentary. */ }
  return item;
};
const legacyLinkCount = (items: unknown[]): number => items.reduce<number>((count, item) => {
  if (item == null || typeof item !== "object" || Array.isArray(item)) return count;
  const result = item as Record<string, unknown>;
  const url = typeof result.url === "string" ? result.url : "";
  // Direct presentation wins over nested content, exactly as below.
  if ([result.title, url, result.description].some(value => typeof value === "string" && value)) return count + (url ? 1 : 0);
  return count + (Array.isArray(result.content) ? result.content.filter(link => link != null && typeof link === "object" && "url" in link && typeof link.url === "string" && link.url).length : 0);
}, 0);

type Props = {
  searchData: Record<string, unknown>;
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
};

export const WebSearchRenderer = ({
  searchData,
  searchQuery,
  isCurrentMatch = false,
  currentMatchIndex = 0,
}: Props) => {
  const { t } = useTranslation();
  const fmt = useFormat();
  const query = typeof searchData.query === "string" ? searchData.query : "";
  const results = Array.isArray(searchData.results) ? searchData.results.map(legacyResult) : [];
  const durationSeconds =
    typeof searchData.durationSeconds === "number"
      ? searchData.durationSeconds
      : null;

  return (
    <RecordedResult title={t('webSearchRenderer.title')}
        icon={<Globe className="w-4 h-4" />}
        meta={
          durationSeconds && (
            <span className={`${layout.smallText} text-tool-web`}>
              <Num>{fmt.duration(durationSeconds * 1000)}</Num>
            </span>
          )
        } record={searchData} expandKey={"web-result"} searchQuery={searchQuery}>
        {/* 검색 정보 */}
        <div className="mb-3">
          <div className={`${layout.smallText} font-medium mb-1 text-muted-foreground`}>
            {t('webSearchRenderer.query')}
          </div>
          <code className={`${layout.bodyText} px-2 py-1 rounded block bg-muted text-foreground`}>
            {searchQuery ? (
              <HighlightedText
                text={query}
                searchQuery={searchQuery}
                isCurrentMatch={isCurrentMatch}
                currentMatchIndex={currentMatchIndex}
              />
            ) : (
              query
            )}
          </code>
        </div>

        {/* 검색 결과 */}
        {results.length > 0 && (
          <div>
            <div className={`${layout.smallText} font-medium mb-2 text-muted-foreground`}>
              {t("webSearchRenderer.linkCount", { count: legacyLinkCount(results) })}
            </div>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {results.map((result: unknown, index: number) => (
                <div
                  key={index}
                  className="p-3 rounded border transition-colors bg-card border-border hover:border-tool-web/50"
                >
                  {typeof result === "string" ? (
                    <div className={layout.prose}>
                      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} skipHtml>
                        {result}
                      </ReactMarkdown>
                    </div>
                  ) : result && typeof result === "object" ? (
                    (() => {
                      const resultObj = result as Record<string, unknown>;
                      const title = typeof resultObj.title === "string" ? resultObj.title : null;
                      const url = typeof resultObj.url === "string" ? resultObj.url : null;
                      const description = typeof resultObj.description === "string" ? resultObj.description : null;

                      if (title || url || description) {
                        return <SearchResultItem title={title} url={url} description={description} />;
                      }

                      if ("content" in resultObj && Array.isArray(resultObj.content)) {
                        return (
                          <div className="space-y-2">
                            {resultObj.content.map((item: unknown, idx: number) => (
                              <div key={idx}>
                                {item && typeof item === "object" && "url" in item && typeof item.url === "string" ? (
                                  <SearchResultItem title={"title" in item && typeof item.title === "string" ? item.title : null} url={item.url} description={null} />
                                ) : item && typeof item === "object" && "text" in item && typeof item.text === "string" ? (
                                  <div className={layout.prose}>
                                    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} skipHtml>
                                      {item.text}
                                    </ReactMarkdown>
                                  </div>
                                ) : (
                                  <TruncatedPre
                                    content={safeStringify(item, 2)}
                                    className={`${layout.monoText} overflow-x-auto p-2 rounded bg-muted text-foreground/80`}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        );
                      }

                      return (
                        <pre className={`${layout.monoText} overflow-x-auto p-2 rounded bg-muted text-foreground/80`}>
                          {safeStringify(result, 2)}
                        </pre>
                      );
                    })()
                  ) : (
                    <div className={`${layout.bodyText} italic text-muted-foreground`}>
                      {t('webSearchRenderer.unknownResultFormat')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </RecordedResult>
  );
};

const SearchResultItem = ({
  title,
  url,
  description,
}: {
  title: string | null;
  url: string | null;
  description: string | null;
}) => (
  <div className="space-y-2">
    {title && (
      <h4 className={`font-medium ${layout.bodyText} leading-tight text-foreground`}>
        {title}
      </h4>
    )}
    {url && (
      <div className={cn("flex items-center", layout.iconSpacing)}>
        <Globe className={cn(layout.iconSizeSmall, "text-tool-web shrink-0")} />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={`${layout.smallText} text-tool-web hover:underline truncate`}
          title={url}
        >
          {url.length > 60 ? `${url.substring(0, 60)}...` : url}
        </a>
      </div>
    )}
    {description && (
      <div className={`${layout.bodyText} leading-relaxed text-foreground/80`}>
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} skipHtml>
          {description}
        </ReactMarkdown>
      </div>
    )}
  </div>
);
