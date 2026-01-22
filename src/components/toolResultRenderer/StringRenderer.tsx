"use client";

import { useState, useEffect } from "react";
import { Folder, Check, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Renderer } from "../../shared/RendererHeader";
import { layout } from "@/components/renderers";
import { cn } from "@/lib/utils";

type Props = {
  result: string;
  searchQuery?: string;
};

export const StringRenderer = ({ result, searchQuery }: Props) => {
  const { t } = useTranslation("components");
  // 파일 트리나 디렉토리 구조인지 확인
  const isFileTree =
    result.includes("/") &&
    (result.includes("- ") || result.includes("├") || result.includes("└"));

  // 접기/펼치기 상태 관리
  const [isExpanded, setIsExpanded] = useState(false);

  // 검색 쿼리가 있고 내용에 매칭되면 자동으로 펼치기
  useEffect(() => {
    if (searchQuery && result.toLowerCase().includes(searchQuery.toLowerCase())) {
      setIsExpanded(true);
    }
  }, [searchQuery, result]);
  const MAX_LINES = 15; // 최대 표시 줄 수
  const resultLines = result.split("\n");
  const shouldCollapse = resultLines.length > MAX_LINES;
  const displayResult =
    shouldCollapse && !isExpanded
      ? resultLines.slice(0, MAX_LINES).join("\n")
      : result;

  return (
    <Renderer className="bg-tool-file/10 border-tool-file/30">
      <Renderer.Header
        title={isFileTree ? t("toolResult.fileStructure") : t("toolResult.toolExecutionResult")}
        icon={
          isFileTree ? (
            <Folder className={cn(layout.iconSize, "text-tool-file")} />
          ) : (
            <Check className={cn(layout.iconSize, "text-tool-file")} />
          )
        }
        titleClassName="text-tool-file"
        rightContent={
          shouldCollapse && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className={`${layout.smallText} px-2 py-1 rounded transition-colors bg-secondary text-foreground hover:bg-secondary/80`}
            >
              {isExpanded ? (
                <>
                  <span>{t("toolResult.collapse")} ▲</span>
                </>
              ) : (
                <>
                  <span>{t("toolResult.expand")} ({resultLines.length}{t("toolResult.lines")}) ▼</span>
                </>
              )}
            </button>
          )
        }
      />
      <Renderer.Content>
        <div className="bg-card border-border">
          {isFileTree ? (
            <div className={`text-foreground ${layout.monoText}`}>{displayResult}</div>
          ) : (
            <div className={`p-3 ${layout.prose}`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {displayResult}
              </ReactMarkdown>
            </div>
          )}
          {shouldCollapse && !isExpanded && (
            <div className="bg-card border-t border-border pt-2">
              <button
                onClick={() => setIsExpanded(true)}
                className={cn(layout.smallText, "text-foreground hover:text-accent transition-colors")}
              >
                <FileText className={cn(layout.iconSizeSmall, "inline mr-1")} />
                {resultLines.length - MAX_LINES}{t("toolResult.lines")} {t("toolResult.showMore")}
              </button>
            </div>
          )}
        </div>
      </Renderer.Content>
    </Renderer>
  );
};
