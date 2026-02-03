import { memo } from "react";
import { FileText, Hash } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Renderer } from "@/shared/RendererHeader";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "@/components/renderers";

interface ReadToolInput {
  file_path?: string;
  offset?: number;
  limit?: number;
}

interface Props {
  toolId: string;
  input: ReadToolInput;
}

export const ReadToolRenderer = memo(function ReadToolRenderer({ toolId, input }: Props) {
  const { t } = useTranslation();
  const styles = getVariantStyles("code");
  const filePath = input.file_path ?? "";
  const hasRange = input.offset != null || input.limit != null;

  return (
    <Renderer className={styles.container}>
      <Renderer.Header
        title={t("tools.readFile", { defaultValue: "Read" })}
        icon={<FileText className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={
          toolId && (
            <code className={cn(layout.monoText, "px-2 py-0.5", layout.rounded, styles.badge, styles.badgeText)}>
              ID: {toolId}
            </code>
          )
        }
      />
      <Renderer.Content>
        <div className={cn("p-2 border bg-card border-border", layout.rounded)}>
          <div className={cn("flex items-center", layout.iconSpacing)}>
            <FileText className={cn(layout.iconSizeSmall, "text-info")} />
            <code className={cn(layout.bodyText, "font-mono text-info break-all")}>{filePath}</code>
          </div>
        </div>
        {hasRange && (
          <div className={cn("mt-2 flex items-center gap-3", layout.smallText, "text-muted-foreground")}>
            {input.offset != null && (
              <span className="flex items-center gap-1">
                <Hash className={layout.iconSizeSmall} />
                offset: {input.offset}
              </span>
            )}
            {input.limit != null && (
              <span className="flex items-center gap-1">
                <Hash className={layout.iconSizeSmall} />
                limit: {input.limit}
              </span>
            )}
          </div>
        )}
      </Renderer.Content>
    </Renderer>
  );
});
