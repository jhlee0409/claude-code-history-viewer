import { memo } from "react";
import { ToolIcon } from "../../ToolIcon";
import { CodeTarget, TargetWell, ToolRow } from "../../transcript/ToolRow";
import { ToolResultOutputs } from "../../transcript/ToolResultOutputs";
import { DetailZone } from "../../transcript/DetailZone";
import { hasShownResults, toolFamily, toolOutcome } from "../../transcript/toolOutcome";
import type { Props } from "./shared";
import { str } from "./shared";

/**
 * WebFetch (TR1a): the URL is the row's target; opened, the Input zone holds
 * the prompt and the whole URL when the row cuts it, the Result zone the
 * result as recorded. A fetch that
 * failed with an API error code (`url_not_accessible`) says
 * "Failed · <code>" in the row, once: the result's `{"error_code": …}` echo
 * is left out of the detail (amendment 7, renderer audit NC1).
 */
export const WebFetchCard = memo(function WebFetchCard({ toolUse, toolResults }: Props) {
  const name = (toolUse.name as string) || "WebFetch";
  const toolId = (toolUse.id as string) || "";
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const url = str(input, "url") ?? "";
  const prompt = str(input, "prompt");
  const family = toolFamily(name);
  const outcome = toolOutcome(toolUse, toolResults, family);
  const expandKey = `unified-${toolId}`;

  return (
    <ToolRow
      icon={<ToolIcon toolName="WebFetch" title={null} className="w-4 h-4" />}
      verb={name}
      target={url ? <CodeTarget text={url} /> : undefined}
      outcome={outcome}
      family={family}
      toolId={toolId}
      expandKey={expandKey}
    >
      <DetailZone kind="input" show={prompt ? true : url ? "whenTargetCut" : false}>
        {prompt && <p className="whitespace-pre-wrap text-list text-fg-2">{prompt}</p>}
        {url && <TargetWell text={url} />}
      </DetailZone>
      <DetailZone kind="result" show={hasShownResults(toolResults)}>
        <ToolResultOutputs results={toolResults} family={family} expandKey={expandKey} failed={outcome.verdict === "failed"} />
      </DetailZone>
    </ToolRow>
  );
});
