"use client";

import { Globe } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import { Renderer } from "../../shared/RendererHeader";
import { cn } from "../../utils/cn";
import { COLORS } from "../../constants/colors";

type Props = {
  searchData: Record<string, unknown>;
};

export const WebSearchRenderer = ({ searchData }: Props) => {
  const { t } = useTranslation('components');
  const query = typeof searchData.query === "string" ? searchData.query : "";
  const results = Array.isArray(searchData.results) ? searchData.results : [];
  const durationSeconds =
    typeof searchData.durationSeconds === "number"
      ? searchData.durationSeconds
      : null;

  return (
    <Renderer
      className={cn(
        "bg-blue-50 dark:bg-blue-900/20",
        "border-blue-200 dark:border-blue-800"
      )}
    >
      <Renderer.Header
        title={t('webSearchRenderer.title')}
        icon={<Globe className={cn("w-4 h-4", COLORS.semantic.info.icon)} />}
        titleClassName={COLORS.semantic.info.text}
        rightContent={
          durationSeconds && (
            <span className={cn("text-xs", COLORS.semantic.info.text)}>
              {durationSeconds.toFixed(2)}{t('webSearchRenderer.seconds')}
            </span>
          )
        }
      />
      <Renderer.Content>
        {/* 검색 정보 */}
        <div className="mb-3">
          <div className={cn("text-xs font-medium mb-1", COLORS.ui.text.tertiary)}>
            {t('webSearchRenderer.query')}
          </div>
          <code className={cn(
            "text-sm px-2 py-1 rounded block",
            "bg-gray-100 dark:bg-gray-800",
            COLORS.ui.text.primary
          )}>
            {query}
          </code>
        </div>

        {/* 검색 결과 */}
        {results.length > 0 && (
          <div>
            <div className={cn("text-xs font-medium mb-2", COLORS.ui.text.tertiary)}>
              {t('webSearchRenderer.results', { count: results.length })}
            </div>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {results.map((result: unknown, index: number) => (
                <div
                  key={index}
                  className={cn(
                    "p-3 rounded border transition-colors",
                    "bg-white dark:bg-gray-800",
                    "border-gray-200 dark:border-gray-700",
                    "hover:border-blue-300 dark:hover:border-blue-600"
                  )}
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
                        <div className={cn(
                          "prose prose-sm max-w-none",
                          "prose-headings:text-gray-900 dark:prose-headings:text-gray-100",
                          "prose-p:text-gray-700 dark:prose-p:text-gray-300",
                          "prose-a:text-blue-600 dark:prose-a:text-blue-400",
                          "prose-code:text-red-600 dark:prose-code:text-red-400",
                          "prose-code:bg-gray-100 dark:prose-code:bg-gray-800"
                        )}>
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
                                  <div className={cn(
                                    "prose prose-sm max-w-none",
                                    "prose-headings:text-gray-900 dark:prose-headings:text-gray-100",
                                    "prose-p:text-gray-700 dark:prose-p:text-gray-300"
                                  )}>
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                      {item.text}
                                    </ReactMarkdown>
                                  </div>
                                ) : (
                                  <pre className={cn(
                                    "text-xs overflow-x-auto p-2 rounded",
                                    "bg-gray-50 dark:bg-gray-900",
                                    COLORS.ui.text.secondary
                                  )}>
                                    {JSON.stringify(item, null, 2)}
                                  </pre>
                                )}
                              </div>
                            ))}
                          </div>
                        );
                      }

                      return (
                        <pre className={cn(
                          "text-xs overflow-x-auto p-2 rounded",
                          "bg-gray-50 dark:bg-gray-900",
                          COLORS.ui.text.secondary
                        )}>
                          {JSON.stringify(result, null, 2)}
                        </pre>
                      );
                    })()
                  ) : (
                    <div className={cn("text-sm italic", COLORS.ui.text.muted)}>
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
      <h4 className={cn("font-medium text-sm leading-tight", COLORS.ui.text.primary)}>
        {title}
      </h4>
    )}
    {url && (
      <div className="flex items-center space-x-2">
        <Globe className="w-3 h-3 text-green-500 dark:text-green-400 shrink-0" />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-green-600 dark:text-green-400 hover:underline truncate"
          title={url}
        >
          {url.length > 60 ? `${url.substring(0, 60)}...` : url}
        </a>
      </div>
    )}
    {description && (
      <div className={cn("text-sm leading-relaxed", COLORS.ui.text.secondary)}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {description}
        </ReactMarkdown>
      </div>
    )}
  </div>
);
