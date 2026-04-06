import { memo } from "react";
import { FolderSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { Renderer } from "@/shared/RendererHeader";
import { ToolIcon } from "../../ToolIcon";
import { getVariantStyles, layout } from "../../renderers";
import type { Props } from "./shared";
import { str, isError } from "./shared";
import { StatusBadge } from "./StatusBadge";
import { ResultBlock } from "./ResultBlock";

export const GlobCard = memo(function GlobCard({ toolUse, toolResults }: Props) {
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const pattern = str(input, "pattern") ?? "";
  const path = str(input, "path");
  const styles = getVariantStyles("file");


  return (
    <Renderer className={styles.container} hasError={toolResults.length > 0 && toolResults.some(isError)} expandKey={`unified-${(toolUse.id as string) || ""}`}>
      <Renderer.Header
        title="Glob"
        icon={<ToolIcon toolName="Glob" className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={<StatusBadge results={toolResults} />}
      />
      <Renderer.Content>
        <div className={cn("flex items-center gap-2 mb-2 p-2 rounded border", "bg-card border-border")}>
          <FolderSearch className={cn(layout.iconSizeSmall, "text-tool-file shrink-0")} />
          <code className={cn(layout.monoText, "text-tool-file font-semibold")}>{pattern}</code>
          {path && (
            <span className={cn(layout.smallText, "text-muted-foreground ml-1 truncate")}>in {path}</span>
          )}
        </div>
        <ResultBlock results={toolResults} />
      </Renderer.Content>
    </Renderer>
  );
});
