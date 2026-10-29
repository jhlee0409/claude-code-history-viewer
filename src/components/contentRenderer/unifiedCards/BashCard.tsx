import { memo } from "react";
import { useResultProvider } from "../../transcript/resultProvider";
import { ToolIcon } from "../../ToolIcon";
import { CodeTarget, TargetWell, ToolRow } from "../../transcript/ToolRow";
import { DetailZone } from "../../transcript/DetailZone";
import { ToolResultOutputs } from "../../transcript/ToolResultOutputs";
import { hasShownResults, toolFamily, toolOutcome } from "../../transcript/toolOutcome";
import type { Props } from "./shared";
import { str, num } from "./shared";
import { isNonEmptyString, isNumber, shownIf, unshown } from "./recordShape";
import { OtherRecordedFields } from "./toolBodyParts";
import { useFormat } from "@/lib/format/useFormat";
import { Num } from "@/lib/format/Num";

const firstLine = (text: string) => text.trimStart().split("\n")[0] ?? "";

export const BashCard = memo(function BashCard({ toolUse, toolResults, searchQuery, isCurrentMatch, currentMatchIndex }: Props) {
  const provider = useResultProvider();
  const fmt = useFormat();
  const name = (toolUse.name as string) || "Bash";
  const toolId = (toolUse.id as string) || "";
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const command = str(input, "command") ?? "";
  const description = str(input, "description");
  const timeout = num(input, "timeout");
  const family = toolFamily(name);
  const outcome = toolOutcome(toolUse, toolResults, family, provider);
  const expandKey = `unified-${toolId}`;
  const rest = unshown(input, { command: shownIf(isNonEmptyString), description: shownIf(isNonEmptyString), timeout: shownIf(isNumber) });
  const hasRest = Object.keys(rest).length > 0;

  return (
    <ToolRow
      icon={<ToolIcon toolName="Bash" title={null} className="w-4 h-4" />}
      verb={name}
      target={command ? <CodeTarget text={firstLine(command)} full={command} /> : undefined}
      meta={timeout != null ? <Num>{fmt.duration(timeout)}</Num> : undefined}
      outcome={outcome}
      family={family}
      toolId={toolId}
      expandKey={expandKey}
    >
      <DetailZone kind="input" show={description || hasRest ? true : command ? "whenTargetCut" : false}>
        {description && <p className="text-list text-fg-2">{description}</p>}
        {command && <TargetWell text={command} />}
        <OtherRecordedFields rest={rest} expandKey={expandKey} searchQuery={searchQuery} isCurrentMatch={isCurrentMatch} currentMatchIndex={currentMatchIndex} />
      </DetailZone>
      <DetailZone kind="result" show={hasShownResults(toolResults)}>
        <ToolResultOutputs results={toolResults} family={family} source="command" expandKey={expandKey} failed={outcome.verdict === "failed"} />
      </DetailZone>
    </ToolRow>
  );
});
