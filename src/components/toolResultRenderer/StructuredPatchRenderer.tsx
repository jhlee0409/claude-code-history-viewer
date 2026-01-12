import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EnhancedDiffViewer } from "../EnhancedDiffViewer";
import { FileContent } from "../FileContent";
import { Renderer } from "../../shared/RendererHeader";
import { cn } from "../../utils/cn";
import { COLORS } from "../../constants/colors";

type Props = {
  toolResult: Record<string, unknown>;
};

export const StructuredPatchRenderer = ({ toolResult }: Props) => {
  const { t } = useTranslation("components");
  const filePath =
    typeof toolResult.filePath === "string" ? toolResult.filePath : "";
  const content =
    typeof toolResult.content === "string" ? toolResult.content : "";
  const patches = Array.isArray(toolResult.structuredPatch)
    ? toolResult.structuredPatch
    : [];

  // Reconstruct old and new content from patches
  const reconstructDiff = () => {
    if (patches.length === 0) return { oldStr: "", newStr: "" };

    const oldLines: string[] = [];
    const newLines: string[] = [];

    patches.forEach((patch: Record<string, unknown>) => {
      if (Array.isArray(patch.lines)) {
        patch.lines.forEach((line: unknown) => {
          if (typeof line === "string") {
            if (line.startsWith("-")) {
              oldLines.push(line.substring(1));
            } else if (line.startsWith("+")) {
              newLines.push(line.substring(1));
            } else {
              // Context line (no prefix or space prefix)
              const contextLine = line.startsWith(" ")
                ? line.substring(1)
                : line;
              oldLines.push(contextLine);
              newLines.push(contextLine);
            }
          }
        });
      }
    });

    return {
      oldStr: oldLines.join("\n"),
      newStr: newLines.join("\n"),
    };
  };

  const { oldStr, newStr } = reconstructDiff();

  const formatShortPath = (path: string): string => {
    if (!path) return "";
    const parts = path.split('/').filter(Boolean);
    if (parts.length <= 3) return parts.join('/');
    return `…/${parts.slice(-3).join('/')}`;
  };

  return (
    <Renderer
      className={cn(COLORS.tools.task.bg, COLORS.tools.task.border)}
    >
      <Renderer.Header
        title={t("structuredPatch.fileChanges")}
        icon={<RefreshCw className={cn("w-4 h-4", COLORS.tools.task.icon)} />}
        titleClassName={COLORS.tools.task.text}
        rightContent={
          filePath && (
            <span className="text-xs text-blue-600 dark:text-blue-400 truncate max-w-[250px]" title={filePath}>
              {formatShortPath(filePath)}
            </span>
          )
        }
      />
      <Renderer.Content>
        {/* 파일 경로 */}
        <div className="mb-3">
          <div
            className={cn("text-xs font-medium mb-1", COLORS.ui.text.tertiary)}
          >
            {t("structuredPatch.filePath")}
          </div>
          <code
            className={cn(
              "text-sm block",
              COLORS.message.assistant.bg,
              COLORS.message.assistant.text
            )}
          >
            {filePath}
          </code>
        </div>

        {/* 변경 통계 */}
        {patches.length > 0 && (
          <div className="mb-3">
            <div
              className={cn("text-xs font-medium mb-1", COLORS.ui.text.tertiary)}
            >
              {t("structuredPatch.changeStats")}
            </div>
            <div
              className={cn(
                "p-2 rounded border text-xs",
                COLORS.ui.background.primary,
                COLORS.ui.border.medium
              )}
            >
              {t("structuredPatch.areasChanged", { count: patches.length })}
            </div>
          </div>
        )}

        {/* Diff Viewer */}
        {patches.length > 0 && (oldStr || newStr) && (
          <EnhancedDiffViewer
            oldText={oldStr}
            newText={newStr}
            filePath={filePath}
            showAdvancedDiff={true}
          />
        )}

        {/* 전체 파일 내용 */}
        {content && (
          <div>
            <div
              className={cn("text-xs font-medium mb-2", COLORS.ui.text.tertiary)}
            >
              {t("structuredPatch.updatedFile")}
            </div>
            <FileContent
              title={t("structuredPatch.updatedFileContent")}
              fileData={{
                content: content,
                filePath: filePath,
                numLines: content.split("\n").length,
                startLine: 1,
                totalLines: content.split("\n").length,
              }}
            />
          </div>
        )}
      </Renderer.Content>
    </Renderer>
  );
};
