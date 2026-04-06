import { memo } from "react";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Renderer } from "@/shared/RendererHeader";
import { ToolIcon } from "../../ToolIcon";
import { getVariantStyles, layout } from "../../renderers";
import type { Props } from "./shared";
import { str, truncate, isError } from "./shared";
import { StatusBadge } from "./StatusBadge";
import { ResultBlock } from "./ResultBlock";

export const WriteCard = memo(function WriteCard({ toolUse, toolResults }: Props) {
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const filePath = str(input, "file_path") ?? "";
  const content = str(input, "content");
  const styles = getVariantStyles("success");


  return (
    <Renderer className={styles.container} hasError={toolResults.length > 0 && toolResults.some(isError)} expandKey={`unified-${(toolUse.id as string) || ""}`}>
      <Renderer.Header
        title="Write"
        icon={<ToolIcon toolName="Write" className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={<StatusBadge results={toolResults} />}
      />
      <Renderer.Content>
        <div className={cn("flex items-center gap-2 mb-2 p-2 rounded border", "bg-card border-border")}>
          <FileText className={cn(layout.iconSizeSmall, "text-info shrink-0")} />
          <code className={cn(layout.monoText, "text-info break-all")}>{filePath}</code>
        </div>
        {content && (
          <details>
            <summary className={cn(layout.smallText, "cursor-pointer text-muted-foreground mb-1")}>
              {content.split("\n").length} lines
            </summary>
            <pre className={cn(layout.monoText, "p-2 bg-secondary text-foreground/80 rounded overflow-auto whitespace-pre-wrap", layout.codeMaxHeight)}>
              {truncate(content)}
            </pre>
          </details>
        )}
        <ResultBlock results={toolResults} />
      </Renderer.Content>
    </Renderer>
  );
});
