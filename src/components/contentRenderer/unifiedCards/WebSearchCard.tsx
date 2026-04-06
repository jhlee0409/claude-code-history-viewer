import { memo } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Renderer } from "@/shared/RendererHeader";
import { ToolIcon } from "../../ToolIcon";
import { getVariantStyles, layout } from "../../renderers";
import type { Props } from "./shared";
import { isError } from "./shared";
import { StatusBadge } from "./StatusBadge";
import { ResultBlock } from "./ResultBlock";

export const WebSearchCard = memo(function WebSearchCard({ toolUse, toolResults }: Props) {
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const query = (typeof input.query === "string" ? input.query : "") as string;
  const styles = getVariantStyles("web");


  return (
    <Renderer className={styles.container} hasError={toolResults.length > 0 && toolResults.some(isError)} expandKey={`unified-${(toolUse.id as string) || ""}`}>
      <Renderer.Header
        title="WebSearch"
        icon={<ToolIcon toolName="WebSearch" className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={<StatusBadge results={toolResults} />}
      />
      <Renderer.Content>
        <div className={cn("flex items-center gap-2 mb-2 p-2 rounded border", "bg-card border-border")}>
          <Search className={cn(layout.iconSizeSmall, "text-tool-web shrink-0")} />
          <span className={cn(layout.bodyText, "text-tool-web font-medium")}>{query}</span>
        </div>
        <ResultBlock results={toolResults} />
      </Renderer.Content>
    </Renderer>
  );
});
