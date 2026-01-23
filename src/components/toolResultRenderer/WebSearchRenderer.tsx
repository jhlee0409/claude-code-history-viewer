"use client";

import { Globe } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import { Renderer } from "../../shared/RendererHeader";
import { layout } from "@/components/renderers";
import { cn } from "@/lib/utils";
import { HighlightedText } from "../common/HighlightedText";
import { safeStringify } from "@/utils/jsonUtils";

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
  const query = typeof searchData.query === "string" ? searchData.query : "";
  const results = Array.isArray(searchData.results) ? searchData.results : [];
  const durationSeconds =
    typeof searchData.durationSeconds === "number"
      ? searchData.durationSeconds
      : null;

  return (
    <Renderer className="bg-tool-web/10 border-tool-web/30">
      <Renderer.Header
        title={t('webSearchRenderer.title')}
        icon={<Globe className={cn(layout.iconSize, "text-tool-web")} />}
        titleClassName="text-foreground"
        rightContent={
          durationSeconds && (
            <span className={`${layout.smallText} text-tool-web`}>
              {durationSeconds.toFixed(2)}{t('webSearchRenderer.seconds')}
            </span>
          )
        }
      />
      <Renderer.Content>
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
              {t('webSearchRenderer.results', { count: results.length })}
            </div>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {results.map((result: unknown, index: number) => (
                <div
                  key={index}
                  className="p-3 rounded border transition-colors bg-card border-border hover:border-tool-web/50"
                >
                  {typeof result === "string" ? (
                    (() => {
                      try {
                        const trimmed = result.trim();
                        if (
                          (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
                          (trimmed.startsWith("[") && trimmed.endsWith("]"))
                        ) {
                          const parsed = JSON.parse(trimmed);
                          if (parsed && typeof parsed === "object") {
                            const title = typeof parsed.title === "string" ? parsed.title : null;
                            const url = typeof parsed.url === "string" ? parsed.url : null;
                            const description = typeof parsed.description === "string" ? parsed.description : null;

                            if (title || url || description) {
                              return (
                                <SearchResultItem title={title} url={url} description={description} />
                              );
                            }
                          }
                        }
                      } catch {
                        // JSON 파싱 실패시 일반 텍스트로 처리
                      }

                      return (
                        <div className={layout.prose}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {result}
                          </ReactMarkdown>
                        </div>
                      );
                    })()
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
                                {item && typeof item === "object" && "text" in item && typeof item.text === "string" ? (
                                  <div className={layout.prose}>
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                      {item.text}
                                    </ReactMarkdown>
                                  </div>
                                ) : (
                                  <pre className={`${layout.monoText} overflow-x-auto p-2 rounded bg-muted text-foreground/80`}>
                                    {safeStringify(item, 2)}
                                  </pre>
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
      </Renderer.Content>
    </Renderer>
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
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {description}
        </ReactMarkdown>
      </div>
    )}
  </div>
);
