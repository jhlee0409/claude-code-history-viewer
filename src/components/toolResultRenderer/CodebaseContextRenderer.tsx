"use client";
import { useEffect, useId } from "react";
import { Button } from "@/components/ui/button";

import { FileText, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RecordedResult } from "@/components/transcript/RecordedResult";
import { cn } from "@/lib/utils";
import { layout } from "@/components/renderers";
import { useCaptureExpandState } from "@/contexts/CaptureExpandContext";
import { HighlightedText } from "../common/HighlightedText";

type Props = {
  contextData: Record<string, unknown>;
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
};

export const CodebaseContextRenderer = ({
  contextData,
  searchQuery,
  isCurrentMatch = false,
  currentMatchIndex = 0,
}: Props) => {
  const showFilesContentId = useId();
  const { t } = useTranslation();
  const filesAnalyzed =
    contextData.files_analyzed || contextData.filesAnalyzed || 0;
  const contextWindow =
    contextData.context_window || contextData.contextWindow || "";
  const relevantFiles =
    contextData.relevant_files || contextData.relevantFiles || [];

  const [showFiles, setShowFiles] = useCaptureExpandState("codebase-files", false);
  const query = searchQuery?.trim().toLowerCase() ?? "";
  const matchingIndex = query !== "" && Array.isArray(relevantFiles) ? relevantFiles.reduce((last: number, file: unknown, index: number) => String(file).toLowerCase().includes(query) ? index : last, -1) : -1;
  useEffect(() => {
    if (matchingIndex >= 0) setShowFiles(true);
  }, [matchingIndex, query, setShowFiles]);
  const visibleFiles = Array.isArray(relevantFiles) ? (matchingIndex >= 10 ? relevantFiles : relevantFiles.slice(0, 10)) : [];

  return (
    <RecordedResult title={t('codebaseContextRenderer.codebaseContext')}
        icon={<FileText className="w-4 h-4" />} record={contextData} expandKey={"codebase-result"} searchQuery={searchQuery}>
        <div className={`grid grid-cols-2 gap-4 ${layout.bodyText}`}>
          <div>
            <span className="font-medium text-accent">
              {t('codebaseContextRenderer.analyzedFiles')}
            </span>
            <span className="ml-2 text-foreground">
              {t('codebaseContextRenderer.filesCount', { count: Number(filesAnalyzed) })}
            </span>
          </div>
          <div>
            <span className="font-medium text-accent">
              {t('codebaseContextRenderer.contextWindow')}
            </span>
            <span className="ml-2 text-foreground">
              {String(contextWindow)}
            </span>
          </div>
        </div>

        {Array.isArray(relevantFiles) && relevantFiles.length > 0 && (
          <div className="mt-3">
            <Button aria-expanded={showFiles} aria-controls={showFilesContentId} variant="ghost" size="sm"
              type="button"
              onClick={() => setShowFiles(prev => !prev)}
              className={cn("h-auto whitespace-normal justify-start font-normal", cn("flex items-center font-medium cursor-pointer text-accent", layout.iconSpacing, layout.bodyText))}
            >
              <ChevronRight className={cn(layout.iconSizeSmall, "transition-transform", showFiles && "rotate-90")} />
              <span>{t('codebaseContextRenderer.relevantFiles', { count: relevantFiles.length })}</span>
            </Button>
            <div id={showFilesContentId} hidden={!showFiles}>{showFiles && (
              <div className="mt-2 space-y-1">
                {visibleFiles.map((file, idx) => (
                  <div
                    key={idx}
                    className={`${layout.smallText} font-mono px-2 py-1 rounded bg-accent/20 text-accent`}
                  >
                    {searchQuery ? (
                      <HighlightedText
                        text={String(file)}
                        searchQuery={searchQuery}
                        isCurrentMatch={isCurrentMatch}
                        currentMatchIndex={currentMatchIndex}
                      />
                    ) : (
                      String(file)
                    )}
                  </div>
                ))}
                {relevantFiles.length > visibleFiles.length && (
                  <div className={`${layout.smallText} italic text-muted-foreground`}>
                    {t('codebaseContextRenderer.andMoreFiles', { count: relevantFiles.length - visibleFiles.length })}
                  </div>
                )}
              </div>
            )}</div>
          </div>
        )}
      </RecordedResult>
  );
};
