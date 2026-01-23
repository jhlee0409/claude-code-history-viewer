"use client";

import { FileText, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Renderer } from "../../shared/RendererHeader";
import { cn } from "@/lib/utils";
import { layout } from "@/components/renderers";
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
  const { t } = useTranslation();
  const filesAnalyzed =
    contextData.files_analyzed || contextData.filesAnalyzed || 0;
  const contextWindow =
    contextData.context_window || contextData.contextWindow || "";
  const relevantFiles =
    contextData.relevant_files || contextData.relevantFiles || [];

  const [showFiles, setShowFiles] = useState(false);

  return (
    <Renderer className="bg-accent/10 border-accent/30">
      <Renderer.Header
        title={t('codebaseContextRenderer.codebaseContext')}
        icon={<FileText className={cn(layout.iconSize, "text-accent")} />}
        titleClassName="text-accent"
      />
      <Renderer.Content>
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
            <button
              type="button"
              onClick={() => setShowFiles(!showFiles)}
              className={cn("flex items-center font-medium cursor-pointer text-accent", layout.iconSpacing, layout.bodyText)}
            >
              <ChevronRight className={cn(layout.iconSizeSmall, "transition-transform", showFiles && "rotate-90")} />
              <span>{t('codebaseContextRenderer.relevantFiles', { count: relevantFiles.length })}</span>
            </button>
            {showFiles && (
              <div className="mt-2 space-y-1">
                {relevantFiles.slice(0, 10).map((file, idx) => (
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
                {relevantFiles.length > 10 && (
                  <div className={`${layout.smallText} italic text-muted-foreground`}>
                    {t('codebaseContextRenderer.andMoreFiles', { count: relevantFiles.length - 10 })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Renderer.Content>
    </Renderer>
  );
};
