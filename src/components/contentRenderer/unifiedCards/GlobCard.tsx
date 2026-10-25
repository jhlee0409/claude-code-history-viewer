import { memo } from "react";
import { ToolIcon } from "../../ToolIcon";
import { CodeTarget, TargetWell, ToolRow } from "../../transcript/ToolRow";
import { ToolResultOutputs } from "../../transcript/ToolResultOutputs";
import { DetailZone } from "../../transcript/DetailZone";
import { hasShownResults, toolFamily, toolOutcome } from "../../transcript/toolOutcome";
import { useToolPathContext } from "../../transcript/pathContext";
import { PathText } from "@/lib/format/PathText";
import type { Props } from "./shared";
import { str } from "./shared";

export const GlobCard = memo(function GlobCard({ toolUse, toolResults }: Props) {
  const pathCtx = useToolPathContext();
  const name = (toolUse.name as string) || "Glob";
  const toolId = (toolUse.id as string) || "";
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  // Claude Code: {pattern, path?}; oh-my-pi/pi: {path} where path is the glob.
  const pattern = str(input, "pattern") ?? str(input, "path") ?? "";
  const path = str(input, "pattern") ? str(input, "path") : null;
  const family = toolFamily(name);
  const outcome = toolOutcome(toolUse, toolResults, family);
  const expandKey = `unified-${toolId}`;

  return (
    <ToolRow
      icon={<ToolIcon toolName="Glob" title={null} className="w-4 h-4" />}
      verb={name}
      target={pattern ? <CodeTarget text={pattern} /> : undefined}
      meta={path ? <PathText path={path} ctx={pathCtx} /> : undefined}
      outcome={outcome}
      family={family}
      toolId={toolId}
      expandKey={expandKey}
    >
      <DetailZone kind="input" show={pattern ? "whenTargetCut" : false}>
        <TargetWell text={pattern} />
      </DetailZone>
      <DetailZone kind="result" show={hasShownResults(toolResults)}>
        <ToolResultOutputs results={toolResults} family={family} expandKey={expandKey} failed={outcome.verdict === "failed"} />
      </DetailZone>
    </ToolRow>
  );
});
