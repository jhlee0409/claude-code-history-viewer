import { FileText } from "lucide-react";
import { Renderer } from "../../shared/RendererHeader";
import { useTranslation } from 'react-i18next';
import { layout } from "@/components/renderers";
import { cn } from "@/lib/utils";
import { HighlightedText } from "../common/HighlightedText";

type Props = {
  toolResult: Record<string, unknown>;
  searchQuery?: string;
};

export const FileListRenderer = ({ toolResult, searchQuery }: Props) => {
  const { t } = useTranslation('components');
  return (
    <Renderer className="bg-tool-file/10 border-tool-file/30">
      <Renderer.Header
        title={t('fileListRenderer.fileList', { count: Number(toolResult.numFiles) })}
        icon={<FileText className={cn(layout.iconSize, "text-tool-file")} />}
        titleClassName="text-foreground"
      />

      <Renderer.Content>
        <div className="space-y-1">
          {(toolResult.filenames as string[]).map(
            (filePath: string, idx: number) => {
              const pathParts = filePath.split("/");
              const fileName = pathParts[pathParts.length - 1] || filePath;
              const directory = filePath.substring(
                0,
                filePath.lastIndexOf("/")
              );

              return (
                <div
                  key={idx}
                  className={cn("flex items-center border bg-card border-border", layout.iconSpacing, layout.containerPadding, layout.rounded)}
                >
                  <FileText className={cn(layout.iconSize, "text-muted-foreground")} />
                  <div className="flex-1 min-w-0">
                    <div className={`${layout.monoText} text-foreground`}>
                      {searchQuery ? (
                        <HighlightedText text={fileName} searchQuery={searchQuery} />
                      ) : (
                        fileName
                      )}
                    </div>
                    {directory && (
                      <div className={`${layout.monoText} text-muted-foreground`}>
                        {searchQuery ? (
                          <HighlightedText text={directory} searchQuery={searchQuery} />
                        ) : (
                          directory
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            }
          )}
        </div>
      </Renderer.Content>
    </Renderer>
  );
};
