"use client";

import { Edit } from "lucide-react";
import { useCopyButton } from "../../hooks/useCopyButton";
import { useTranslation } from 'react-i18next';
import { EnhancedDiffViewer } from "../EnhancedDiffViewer";
import { FileContent } from "../FileContent";
import { Renderer } from "../../shared/RendererHeader";
import { cn } from "../../utils/cn";
import { COLORS } from "../../constants/colors";

type Props = {
  toolResult: Record<string, unknown>;
};

export const FileEditRenderer = ({ toolResult }: Props) => {
  const { t } = useTranslation('components');
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

  const formatShortPath = (path: string): string => {
    if (!path) return "";
    const parts = path.split('/').filter(Boolean);
    if (parts.length <= 3) return parts.join('/');
    return `…/${parts.slice(-3).join('/')}`;
  };

  return (
    <Renderer
      className={cn(COLORS.tools.code.bg, COLORS.tools.code.border)}
    >
      <Renderer.Header
        title={t('fileEditRenderer.fileEditResult')}
        icon={<Edit className={cn("w-4 h-4", COLORS.tools.code.icon)} />}
        titleClassName={COLORS.tools.code.text}
        rightContent={
          <div className="flex items-center gap-2">
            {filePath && (
              <span className="text-xs text-blue-600 dark:text-blue-400 truncate max-w-[250px]" title={filePath}>
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
          <div
            className={cn("text-xs font-medium mb-1", COLORS.ui.text.tertiary)}
          >
            {t('fileEditRenderer.filePath')}
          </div>
          <code
            className={cn(
              "text-sm block",
              COLORS.ui.background.secondary,
              COLORS.ui.text.primary
            )}
          >
            {filePath}
          </code>
        </div>

        {/* 편집 정보 */}
        <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
          <div
            className={cn(
              "p-2 rounded border",
              COLORS.ui.background.primary,
              COLORS.ui.border.medium
            )}
          >
            <div className={cn(COLORS.ui.text.tertiary)}>{t('fileEditRenderer.editType')}</div>
            <div className={cn(COLORS.tools.code.text)}>
              {replaceAll ? t('fileEditRenderer.fullReplace') : t('fileEditRenderer.partialReplace')}
            </div>
          </div>
          <div
            className={cn(
              "p-2 rounded border",
              COLORS.ui.background.primary,
              COLORS.ui.border.medium
            )}
          >
            <div className={cn(COLORS.ui.text.tertiary)}>{t('fileEditRenderer.userModified')}</div>
            <div
              className={cn(
                "font-medium",
                userModified
                  ? COLORS.semantic.warning.text
                  : COLORS.semantic.success.text
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
            />
          </div>
        )}
      </Renderer.Content>
    </Renderer>
  );
};
