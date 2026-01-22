import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EnhancedDiffViewer } from "../EnhancedDiffViewer";
import { FileContent } from "../FileContent";
import { Renderer } from "../../shared/RendererHeader";
import { layout } from "@/components/renderers";

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
    <Renderer className="bg-tool-code/10 border-tool-code/30">
      <Renderer.Header
        title={t("structuredPatch.fileChanges")}
        icon={<RefreshCw className="w-4 h-4 text-tool-code" />}
        titleClassName="text-foreground"
        rightContent={
          filePath && (
            <span className={`${layout.smallText} text-tool-code truncate max-w-[250px]`} title={filePath}>
              {formatShortPath(filePath)}
            </span>
          )
        }
      />
      <Renderer.Content>
        {/* 파일 경로 */}
        <div className="mb-3">
          <div className={`${layout.smallText} font-medium mb-1 text-muted-foreground`}>
            {t("structuredPatch.filePath")}
          </div>
          <code className={`${layout.monoText} block bg-secondary text-foreground p-1.5 rounded`}>
            {filePath}
          </code>
        </div>

        {/* 변경 통계 */}
        {patches.length > 0 && (
          <div className="mb-3">
            <div className={`${layout.smallText} font-medium mb-1 text-muted-foreground`}>
              {t("structuredPatch.changeStats")}
            </div>
            <div className={`p-2 rounded border ${layout.smallText} bg-card border-border`}>
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
            <div className={`${layout.smallText} font-medium mb-2 text-muted-foreground`}>
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
