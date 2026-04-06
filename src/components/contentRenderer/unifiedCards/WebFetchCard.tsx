import { memo } from "react";
import { cn } from "@/lib/utils";
import { Renderer } from "@/shared/RendererHeader";
import { ToolIcon } from "../../ToolIcon";
import { getVariantStyles, layout } from "../../renderers";
import type { Props } from "./shared";
import { str, isError } from "./shared";
import { StatusBadge } from "./StatusBadge";
import { ResultBlock } from "./ResultBlock";

export const WebFetchCard = memo(function WebFetchCard({ toolUse, toolResults }: Props) {
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const url = str(input, "url") ?? "";
  const prompt = str(input, "prompt");
  const styles = getVariantStyles("web");


  return (
    <Renderer className={styles.container} hasError={toolResults.length > 0 && toolResults.some(isError)} expandKey={`unified-${(toolUse.id as string) || ""}`}>
      <Renderer.Header
        title="WebFetch"
        icon={<ToolIcon toolName="WebFetch" className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={<StatusBadge results={toolResults} />}
      />
      <Renderer.Content>
        <code className={cn(layout.monoText, "block mb-2 p-2 rounded border bg-card border-border text-tool-web break-all")}>
          {url}
        </code>
        {prompt && (
          <div className={cn(layout.smallText, "text-muted-foreground mb-2")}>{prompt}</div>
        )}
        <ResultBlock results={toolResults} />
      </Renderer.Content>
    </Renderer>
  );
});
