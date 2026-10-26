import { memo } from "react";
import { ToolIcon } from "../../ToolIcon";
import { CodeTarget, TargetWell, ToolRow, WhenTargetCut } from "../../transcript/ToolRow";
import { ToolResultOutputs } from "../../transcript/ToolResultOutputs";
import { DetailZone } from "../../transcript/DetailZone";
import { hasShownResults, toolFamily, toolOutcome } from "../../transcript/toolOutcome";
import type { Props } from "./shared";
import { str } from "./shared";
import { isNonEmptyString, shownIf, unshown } from "./recordShape";
import { OtherRecordedFields } from "./toolBodyParts";

/**
 * WebSearch (TR1a): the query is the row's target; opened, the Input zone
 * holds the whole query when the row cuts it, the Result zone the results
 * as recorded. Outcome from
 * `toolOutcome` only (an `error_code` alone reads "Failed · <code>").
 */
export const WebSearchCard = memo(function WebSearchCard({ toolUse, toolResults, searchQuery, isCurrentMatch, currentMatchIndex }: Props) {
  const name = (toolUse.name as string) || "WebSearch";
  const toolId = (toolUse.id as string) || "";
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const query = str(input, "query") ?? "";
  const family = toolFamily(name);
  const outcome = toolOutcome(toolUse, toolResults, family);
  const expandKey = `unified-${toolId}`;
  const rest = unshown(input, { query: shownIf(isNonEmptyString) });
  const hasRest = Object.keys(rest).length > 0;

  return (
    <ToolRow
      icon={<ToolIcon toolName="WebSearch" title={null} className="w-4 h-4" />}
      verb={name}
      target={query ? <CodeTarget text={query} /> : undefined}
      outcome={outcome}
      family={family}
      toolId={toolId}
      expandKey={expandKey}
    >
      <DetailZone kind="input" show={hasRest ? true : query ? "whenTargetCut" : false}>
        {query && (
          <WhenTargetCut>
            <TargetWell text={query} />
          </WhenTargetCut>
        )}
        <OtherRecordedFields rest={rest} expandKey={expandKey} searchQuery={searchQuery} isCurrentMatch={isCurrentMatch} currentMatchIndex={currentMatchIndex} />
      </DetailZone>
      <DetailZone kind="result" show={hasShownResults(toolResults)}>
        <ToolResultOutputs results={toolResults} family={family} expandKey={expandKey} failed={outcome.verdict === "failed"} />
      </DetailZone>
    </ToolRow>
  );
});
