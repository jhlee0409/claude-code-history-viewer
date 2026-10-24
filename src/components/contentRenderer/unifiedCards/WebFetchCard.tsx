import { memo } from "react";
import { cn } from "@/lib/utils";
import { Renderer } from "@/shared/RendererHeader";
import { ToolIcon } from "../../ToolIcon";
import { getVariantStyles, layout } from "../../renderers";
import type { Props } from "./shared";
import { CARD_FRAME, str, summarizeToolInput } from "./shared";
import { OutcomeStatus } from "../../transcript/OutcomeStatus";
import { toolFamily, toolOutcome } from "../../transcript/toolOutcome";
import { ResultBlock } from "./ResultBlock";

export const WebFetchCard = memo(function WebFetchCard({ toolUse, toolResults }: Props) {
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const url = str(input, "url") ?? "";
  const prompt = str(input, "prompt");
  const styles = getVariantStyles("web");
  const outcome = toolOutcome(toolUse, toolResults, toolFamily((toolUse.name as string) || "WebFetch"));

  return (
    <Renderer className={CARD_FRAME} hasError={outcome.verdict === "failed"} expandKey={`unified-${(toolUse.id as string) || ""}`}>
      <Renderer.Header
        title="WebFetch"
        icon={<ToolIcon toolName="WebFetch" className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        summary={summarizeToolInput(input)}
        rightContent={<OutcomeStatus outcome={outcome} />}
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
