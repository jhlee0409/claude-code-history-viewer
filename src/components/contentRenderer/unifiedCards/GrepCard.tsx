import { memo } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Renderer } from "@/shared/RendererHeader";
import { ToolIcon } from "../../ToolIcon";
import { getVariantStyles, layout } from "../../renderers";
import type { Props } from "./shared";
import { str, isError } from "./shared";
import { StatusBadge } from "./StatusBadge";
import { ResultBlock } from "./ResultBlock";

export const GrepCard = memo(function GrepCard({ toolUse, toolResults }: Props) {
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const pattern = str(input, "pattern") ?? "";
  const path = str(input, "path");
  const glob = str(input, "glob");
  const outputMode = str(input, "output_mode");
  const styles = getVariantStyles("search");


  const scope = path ?? glob ?? "";

  return (
    <Renderer className={styles.container} hasError={toolResults.length > 0 && toolResults.some(isError)} expandKey={`unified-${(toolUse.id as string) || ""}`}>
      <Renderer.Header
        title="Grep"
        icon={<ToolIcon toolName="Grep" className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={
          <div className={cn("flex items-center gap-2", layout.smallText)}>
            {outputMode && (
              <code className={cn(layout.monoText, "text-muted-foreground")}>{outputMode}</code>
            )}
            <StatusBadge results={toolResults} />
          </div>
        }
      />
      <Renderer.Content>
        <div className={cn("flex items-center gap-2 mb-2 p-2 rounded border", "bg-card border-border")}>
          <Search className={cn(layout.iconSizeSmall, "text-tool-search shrink-0")} />
          <code className={cn(layout.monoText, "text-tool-search font-semibold")}>{pattern}</code>
          {scope && (
            <span className={cn(layout.smallText, "text-muted-foreground ml-1 truncate")}>in {scope}</span>
          )}
        </div>
        <ResultBlock results={toolResults} />
      </Renderer.Content>
    </Renderer>
  );
});
