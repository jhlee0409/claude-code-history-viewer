"use client";

import { GitBranch, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Renderer } from "../../shared/RendererHeader";
import { cn } from "../../utils/cn";
import { COLORS } from "../../constants/colors";

type Props = {
  gitData: Record<string, unknown>;
};

export const GitWorkflowRenderer = ({ gitData }: Props) => {
  const { t } = useTranslation('components');
  const command = gitData.command || "";
  const status = gitData.status || "";
  const files = gitData.files || [];
  const diff = gitData.diff || "";

  const [showFiles, setShowFiles] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  return (
    <Renderer
      className={cn(
        "bg-orange-50 dark:bg-orange-900/20",
        "border-orange-200 dark:border-orange-800"
      )}
    >
      <Renderer.Header
        title={t('gitWorkflowRenderer.gitWorkflow')}
        icon={<GitBranch className={cn("w-4 h-4", COLORS.tools.task.icon)} />}
        titleClassName={COLORS.tools.task.text}
        rightContent={
          command && (
            <code className={cn(
              "text-xs px-2 py-1 rounded",
              "bg-orange-100 dark:bg-orange-900/40",
              COLORS.tools.task.text
            )}>
              git {String(command)}
            </code>
          )
        }
      />
      <Renderer.Content>
        {status && (
          <div className={cn("mb-2 text-sm", COLORS.tools.task.text)}>
            <span className="font-medium">{t('gitWorkflowRenderer.status')}</span> {String(status)}
          </div>
        )}

        {Array.isArray(files) && files.length > 0 && (
          <div className="mb-2">
            <button
              type="button"
              onClick={() => setShowFiles(!showFiles)}
              className={cn(
                "flex items-center space-x-1 text-sm font-medium cursor-pointer",
                COLORS.tools.task.text
              )}
            >
              <ChevronRight className={cn("w-3 h-3 transition-transform", showFiles && "rotate-90")} />
              <span>{t('gitWorkflowRenderer.changedFiles', { count: files.length })}</span>
            </button>
            {showFiles && (
              <div className="mt-2 space-y-1">
                {files.map((file, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "text-xs font-mono px-2 py-1 rounded",
                      "bg-orange-100 dark:bg-orange-900/40",
                      COLORS.tools.task.text
                    )}
                  >
                    {String(file)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {diff && (
          <div>
            <button
              type="button"
              onClick={() => setShowDiff(!showDiff)}
              className={cn(
                "flex items-center space-x-1 text-sm font-medium cursor-pointer",
                COLORS.tools.task.text
              )}
            >
              <ChevronRight className={cn("w-3 h-3 transition-transform", showDiff && "rotate-90")} />
              <span>{t('gitWorkflowRenderer.viewDiff')}</span>
            </button>
            {showDiff && (
              <pre className={cn(
                "mt-2 text-xs p-2 rounded overflow-auto max-h-48",
                "bg-gray-100 dark:bg-gray-800",
                COLORS.ui.text.primary
              )}>
                {String(diff)}
              </pre>
            )}
          </div>
        )}
      </Renderer.Content>
    </Renderer>
  );
};
