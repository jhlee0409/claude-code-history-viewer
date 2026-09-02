import { memo } from "react";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Renderer } from "@/shared/RendererHeader";
import { ToolIcon } from "../../ToolIcon";
import { getVariantStyles, layout } from "../../renderers";
import type { Props } from "./shared";
import { num, strAny, isError, summarizeToolInput } from "./shared";
import { StatusBadge } from "./StatusBadge";
import { ResultBlock } from "./ResultBlock";

export const ReadCard = memo(function ReadCard({ toolUse, toolResults }: Props) {
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const filePath = strAny(input, "file_path", "path") ?? "";
  const offset = num(input, "offset");
  const limit = num(input, "limit");
  const styles = getVariantStyles("code");


  const rangeLabel = offset != null || limit != null
    ? ` (${offset != null ? `L${offset}` : ""}${offset != null && limit != null ? "–" : ""}${limit != null ? `${(offset ?? 0) + (limit ?? 0)}` : ""})`
    : "";

  return (
    <Renderer className={styles.container} hasError={toolResults.length > 0 && toolResults.some(isError)} expandKey={`unified-${(toolUse.id as string) || ""}`}>
      <Renderer.Header
        title="Read"
        icon={<ToolIcon toolName="Read" className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={<StatusBadge results={toolResults} />}
        summary={summarizeToolInput(input)}
      />
      <Renderer.Content>
        <div className={cn("flex items-center gap-2 mb-2 p-2 rounded border", "bg-card border-border")}>
          <FileText className={cn(layout.iconSizeSmall, "text-info shrink-0")} />
          <code className={cn(layout.monoText, "text-info break-all")}>{filePath}{rangeLabel}</code>
        </div>
        <ResultBlock results={toolResults} />
      </Renderer.Content>
    </Renderer>
  );
});
