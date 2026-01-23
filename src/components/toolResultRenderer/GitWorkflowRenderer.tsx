"use client";

import { GitBranch, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Renderer } from "../../shared/RendererHeader";
import { cn } from "@/lib/utils";
import { layout } from "@/components/renderers";
import { HighlightedText } from "../common/HighlightedText";

type Props = {
  gitData: Record<string, unknown>;
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
};

export const GitWorkflowRenderer = ({
  gitData,
  searchQuery,
  isCurrentMatch = false,
  currentMatchIndex = 0,
}: Props) => {
  const { t } = useTranslation();
  const command = gitData.command || "";
  const status = gitData.status || "";
  const files = gitData.files || [];
  const diff = gitData.diff || "";

  const [showFiles, setShowFiles] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  return (
    <Renderer className="bg-tool-git/10 border-tool-git/30">
      <Renderer.Header
        title={t('gitWorkflowRenderer.gitWorkflow')}
        icon={<GitBranch className={cn(layout.iconSize, "text-tool-git")} />}
        titleClassName="text-foreground"
        rightContent={
          command && (
            <code className={`${layout.monoText} px-2 py-1 rounded bg-tool-git/20 text-tool-git`}>
              git {String(command)}
            </code>
          )
        }
      />
      <Renderer.Content>
        {status && (
          <div className={`mb-2 ${layout.bodyText} text-tool-git`}>
            <span className="font-medium">{t('gitWorkflowRenderer.status')}</span>{" "}
            {searchQuery ? (
              <HighlightedText
                text={String(status)}
                searchQuery={searchQuery}
                isCurrentMatch={isCurrentMatch}
                currentMatchIndex={currentMatchIndex}
              />
            ) : (
              String(status)
            )}
          </div>
        )}

        {Array.isArray(files) && files.length > 0 && (
          <div className="mb-2">
            <button
              type="button"
              onClick={() => setShowFiles(!showFiles)}
              className={cn("flex items-center font-medium cursor-pointer text-tool-git", layout.iconSpacing, layout.bodyText)}
            >
              <ChevronRight className={cn(layout.iconSizeSmall, "transition-transform", showFiles && "rotate-90")} />
              <span>{t('gitWorkflowRenderer.changedFiles', { count: files.length })}</span>
            </button>
            {showFiles && (
              <div className="mt-2 space-y-1">
                {files.map((file, idx) => (
                  <div
                    key={idx}
                    className={`${layout.monoText} px-2 py-1 rounded bg-tool-git/20 text-tool-git`}
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
              </div>
            )}
          </div>
        )}

        {diff && (
          <div>
            <button
              type="button"
              onClick={() => setShowDiff(!showDiff)}
              className={cn("flex items-center font-medium cursor-pointer text-tool-git", layout.iconSpacing, layout.bodyText)}
            >
              <ChevronRight className={cn(layout.iconSizeSmall, "transition-transform", showDiff && "rotate-90")} />
              <span>{t('gitWorkflowRenderer.viewDiff')}</span>
            </button>
            {showDiff && (
              <pre className={`mt-2 ${layout.monoText} p-2 rounded overflow-auto max-h-48 bg-muted text-foreground`}>
                {searchQuery ? (
                  <HighlightedText
                    text={String(diff)}
                    searchQuery={searchQuery}
                    isCurrentMatch={isCurrentMatch}
                    currentMatchIndex={currentMatchIndex}
                  />
                ) : (
                  String(diff)
                )}
              </pre>
            )}
          </div>
        )}
      </Renderer.Content>
    </Renderer>
  );
};
