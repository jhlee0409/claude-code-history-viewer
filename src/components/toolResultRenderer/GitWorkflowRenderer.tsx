"use client";
import { useId } from "react";
import { Button } from "@/components/ui/button";

import { GitBranch, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RecordedResult } from "@/components/transcript/RecordedResult";
import { cn } from "@/lib/utils";
import { layout } from "@/components/renderers";
import { useCaptureExpandState } from "@/contexts/CaptureExpandContext";
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
  const showFilesContentId = useId();
  const showDiffContentId = useId();
  const { t } = useTranslation();
  const command = gitData.command || "";
  const status = gitData.status || "";
  const files = gitData.files || [];
  const diff = gitData.diff || "";

  const [showFiles, setShowFiles] = useCaptureExpandState("git-files", false);
  const [showDiff, setShowDiff] = useCaptureExpandState("git-diff", false);

  return (
    <RecordedResult title={t('gitWorkflowRenderer.gitWorkflow')}
        icon={<GitBranch className="w-4 h-4" />}
        meta={
          command && (
            <code className={`${layout.monoText} px-2 py-1 rounded bg-tool-git/20 text-tool-git`}>
              git {String(command)}
            </code>
          )
        } record={gitData} expandKey={"git-result"} searchQuery={searchQuery}>
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
            <Button aria-expanded={showFiles} aria-controls={showFilesContentId} variant="ghost" size="sm"
              type="button"
              onClick={() => setShowFiles(prev => !prev)}
              className={cn("h-auto whitespace-normal justify-start font-normal", cn("flex items-center font-medium cursor-pointer text-tool-git", layout.iconSpacing, layout.bodyText))}
            >
              <ChevronRight className={cn(layout.iconSizeSmall, "transition-transform", showFiles && "rotate-90")} />
              <span>{t('gitWorkflowRenderer.changedFiles', { count: files.length })}</span>
            </Button>
            <div id={showFilesContentId} hidden={!showFiles}>{showFiles && (
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
            )}</div>
          </div>
        )}

        {diff && (
          <div>
            <Button aria-expanded={showDiff} aria-controls={showDiffContentId} variant="ghost" size="sm"
              type="button"
              onClick={() => setShowDiff(prev => !prev)}
              className={cn("h-auto whitespace-normal justify-start font-normal", cn("flex items-center font-medium cursor-pointer text-tool-git", layout.iconSpacing, layout.bodyText))}
            >
              <ChevronRight className={cn(layout.iconSizeSmall, "transition-transform", showDiff && "rotate-90")} />
              <span>{t('gitWorkflowRenderer.viewDiff')}</span>
            </Button>
            <div id={showDiffContentId} hidden={!showDiff}>{showDiff && (
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
            )}</div>
          </div>
        )}
      </RecordedResult>
  );
};
