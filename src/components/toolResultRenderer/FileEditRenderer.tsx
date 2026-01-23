"use client";

import { Edit } from "lucide-react";
import { useCopyButton } from "../../hooks/useCopyButton";
import { useTranslation } from 'react-i18next';
import { EnhancedDiffViewer } from "../EnhancedDiffViewer";
import { FileContent } from "../FileContent";
import { Renderer } from "../../shared/RendererHeader";
import { cn } from "@/lib/utils";
import { layout } from "@/components/renderers";

type Props = {
  toolResult: Record<string, unknown>;
  searchQuery?: string;
};

export const FileEditRenderer = ({ toolResult, searchQuery }: Props) => {
  const { t } = useTranslation();
  const { renderCopyButton } = useCopyButton();
  const filePath =
    typeof toolResult.filePath === "string" ? toolResult.filePath : "";
  const oldString =
    typeof toolResult.oldString === "string" ? toolResult.oldString : "";
  const newString =
    typeof toolResult.newString === "string" ? toolResult.newString : "";
  const originalFile =
    typeof toolResult.originalFile === "string" ? toolResult.originalFile : "";
  const replaceAll =
    typeof toolResult.replaceAll === "boolean" ? toolResult.replaceAll : false;
  const userModified =
    typeof toolResult.userModified === "boolean"
      ? toolResult.userModified
      : false;

  // Compute file content after applying the edit
  const fileAfterChange =
    originalFile && oldString
      ? replaceAll
        ? originalFile.split(oldString).join(newString)
        : originalFile.replace(oldString, newString)
      : "";

  const formatShortPath = (path: string): string => {
    if (!path) return "";
    const parts = path.split('/').filter(Boolean);
    if (parts.length <= 3) return parts.join('/');
    return `…/${parts.slice(-3).join('/')}`;
  };

  return (
    <Renderer className="bg-tool-code/10 border-tool-code/30">
      <Renderer.Header
        title={t('fileEditRenderer.fileEditResult')}
        icon={<Edit className={cn(layout.iconSize, "text-tool-code")} />}
        titleClassName="text-foreground"
        rightContent={
          <div className={cn("flex items-center", layout.iconGap)}>
            {filePath && (
              <span className={cn(layout.smallText, "text-tool-code truncate max-w-[250px]")} title={filePath}>
                {formatShortPath(filePath)}
              </span>
            )}
            {newString &&
              renderCopyButton(
                newString,
                `edit-result-${filePath}`,
                t('fileEditRenderer.copyChangedResult'),
                true
              )}
            {fileAfterChange &&
              renderCopyButton(
                fileAfterChange,
                `file-after-change-${filePath}`,
                t('fileEditRenderer.copyFileAfterChange')
              )}
            {originalFile &&
              renderCopyButton(
                originalFile,
                `original-file-${filePath}`,
                t('fileEditRenderer.copyOriginalFile'),
                true
              )}
          </div>
        }
      />
      <Renderer.Content>
        {/* 파일 경로 */}
        <div className="mb-3">
          <div className={`${layout.smallText} font-medium mb-1 text-muted-foreground`}>
            {t('fileEditRenderer.filePath')}
          </div>
          <code className={`${layout.monoText} block bg-secondary text-foreground p-1.5 rounded`}>
            {filePath}
          </code>
        </div>

        {/* 편집 정보 */}
        <div className={cn("grid grid-cols-2 mb-3", layout.iconGap, layout.smallText)}>
          <div className={cn("border bg-card border-border", layout.containerPadding, layout.rounded)}>
            <div className="text-muted-foreground">{t('fileEditRenderer.editType')}</div>
            <div className="text-tool-code">
              {replaceAll ? t('fileEditRenderer.fullReplace') : t('fileEditRenderer.partialReplace')}
            </div>
          </div>
          <div className={cn("border bg-card border-border", layout.containerPadding, layout.rounded)}>
            <div className="text-muted-foreground">{t('fileEditRenderer.userModified')}</div>
            <div
              className={cn(
                "font-medium",
                userModified ? "text-warning" : "text-success"
              )}
            >
              {userModified ? t('fileEditRenderer.yes') : t('fileEditRenderer.no')}
            </div>
          </div>
        </div>

        {/* 변경 내용 - Enhanced Diff Viewer 사용 */}
        {oldString && newString && (
          <EnhancedDiffViewer
            oldText={oldString}
            newText={newString}
            filePath={filePath}
            showAdvancedDiff={true}
          />
        )}

        {/* 원본 파일 내용 (접기/펼치기 가능) */}
        {originalFile && (
          <div>
            <FileContent
              title={t('fileEditRenderer.originalFileContent')}
              fileData={{
                content: originalFile,
                filePath: filePath,
                numLines: originalFile.split("\n").length,
                startLine: 1,
                totalLines: originalFile.split("\n").length,
              }}
              searchQuery={searchQuery}
            />
          </div>
        )}
      </Renderer.Content>
    </Renderer>
  );
};
