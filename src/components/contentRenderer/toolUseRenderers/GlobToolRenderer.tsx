import { memo } from "react";
import { FolderSearch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Renderer } from "@/shared/RendererHeader";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "@/components/renderers";

interface GlobToolInput {
  pattern?: string;
  path?: string;
}

interface Props {
  toolId: string;
  input: GlobToolInput;
}

export const GlobToolRenderer = memo(function GlobToolRenderer({ toolId, input }: Props) {
  const { t } = useTranslation();
  const styles = getVariantStyles("file");

  return (
    <Renderer className={styles.container}>
      <Renderer.Header
        title={t("tools.glob", { defaultValue: "Glob" })}
        icon={<FolderSearch className={cn(layout.iconSize, styles.icon)} />}
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
        <div className={cn("p-2 border bg-card border-border", layout.rounded, "space-y-1.5")}>
          <div className="flex items-center gap-2">
            <span className={cn(layout.smallText, "text-muted-foreground shrink-0")}>pattern:</span>
            <code className={cn(layout.bodyText, "font-mono text-foreground")}>{input.pattern ?? ""}</code>
          </div>
          {input.path && (
            <div className="flex items-center gap-2">
              <span className={cn(layout.smallText, "text-muted-foreground shrink-0")}>path:</span>
              <code className={cn(layout.bodyText, "font-mono text-info break-all")}>{input.path}</code>
            </div>
          )}
        </div>
      </Renderer.Content>
    </Renderer>
  );
});
