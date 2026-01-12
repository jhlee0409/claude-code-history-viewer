"use client";

import { FileText, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Renderer } from "../../shared/RendererHeader";
import { cn } from "../../utils/cn";
import { COLORS } from "../../constants/colors";

type Props = {
  contextData: Record<string, unknown>;
};

export const CodebaseContextRenderer = ({ contextData }: Props) => {
  const { t } = useTranslation('components');
  const filesAnalyzed =
    contextData.files_analyzed || contextData.filesAnalyzed || 0;
  const contextWindow =
    contextData.context_window || contextData.contextWindow || "";
  const relevantFiles =
    contextData.relevant_files || contextData.relevantFiles || [];

  const [showFiles, setShowFiles] = useState(false);

  return (
    <Renderer
      className={cn(
        "bg-indigo-50 dark:bg-indigo-900/20",
        "border-indigo-200 dark:border-indigo-800"
      )}
    >
      <Renderer.Header
        title={t('codebaseContextRenderer.codebaseContext')}
        icon={<FileText className={cn("w-4 h-4", COLORS.tools.system.icon)} />}
        titleClassName={COLORS.tools.system.text}
      />
      <Renderer.Content>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className={cn("font-medium", COLORS.tools.system.text)}>
              {t('codebaseContextRenderer.analyzedFiles')}
            </span>
            <span className={cn("ml-2", COLORS.ui.text.primary)}>
              {t('codebaseContextRenderer.filesCount', { count: Number(filesAnalyzed) })}
            </span>
          </div>
          <div>
            <span className={cn("font-medium", COLORS.tools.system.text)}>
              {t('codebaseContextRenderer.contextWindow')}
            </span>
            <span className={cn("ml-2", COLORS.ui.text.primary)}>
              {String(contextWindow)}
            </span>
          </div>
        </div>

        {Array.isArray(relevantFiles) && relevantFiles.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowFiles(!showFiles)}
              className={cn(
                "flex items-center space-x-1 text-sm font-medium cursor-pointer",
                COLORS.tools.system.text
              )}
            >
              <ChevronRight className={cn("w-3 h-3 transition-transform", showFiles && "rotate-90")} />
              <span>{t('codebaseContextRenderer.relevantFiles', { count: relevantFiles.length })}</span>
            </button>
            {showFiles && (
              <div className="mt-2 space-y-1">
                {relevantFiles.slice(0, 10).map((file, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "text-xs font-mono px-2 py-1 rounded",
                      "bg-indigo-100 dark:bg-indigo-900/40",
                      COLORS.tools.system.text
                    )}
                  >
                    {String(file)}
                  </div>
                ))}
                {relevantFiles.length > 10 && (
                  <div className={cn("text-xs italic", COLORS.ui.text.muted)}>
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
