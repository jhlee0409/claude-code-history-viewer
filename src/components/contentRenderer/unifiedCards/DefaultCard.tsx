import { memo } from "react";
import { useTranslation } from "react-i18next";
import { ToolIcon } from "../../ToolIcon";
import { Marked, ToolRow, type TextHighlight } from "../../transcript/ToolRow";
import { ToolResultOutputs } from "../../transcript/ToolResultOutputs";
import { toolFamily, toolOutcome } from "../../transcript/toolOutcome";
import { useToolPathContext } from "../../transcript/pathContext";
import type { Props } from "./shared";
import { searchHits } from "./shared";
import { routedBody } from "./toolBodies";

/**
 * Default (TR1a): every tool no dedicated card owns — MCP tools, other
 * providers' tools — as one ToolRow. Row: the recorded tool name (an MCP
 * name stays whole, D-R5) · the input's summary field (relative when it is a
 * path, D1) · the outcome from `toolOutcome` only. Opened: the body the
 * D-R1 table routes the name to (`toolBodies.tsx`; honest JSON for any other
 * name, capped with "Show all"), then the results as recorded.
 *
 * Search: a hit in the input or the tool id opens the row once per query
 * (an effect keyed on the query). The input's hits are marked in the row
 * target and in the JSON, so one the row's ellipsis hides is still seen; a
 * tool-id hit shows the id, marked, in the detail's meta line.
 */
export const DefaultCard = memo(function DefaultCard({
  toolUse,
  toolResults,
  searchQuery = "",
  isCurrentMatch = false,
  currentMatchIndex = 0,
}: Props) {
  const { t } = useTranslation();
  const pathCtx = useToolPathContext();
  const name = (toolUse.name as string) || "";
  const toolId = (toolUse.id as string) || "";
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const family = toolFamily(name);
  const outcome = toolOutcome(toolUse, toolResults, family);
  const expandKey = `unified-${toolId}`;

  const inputHit = searchHits(searchQuery, JSON.stringify(input, null, 2));
  const idHit = searchHits(searchQuery, toolId);
  const highlight: TextHighlight | undefined = inputHit || idHit ? { searchQuery, isCurrentMatch, currentMatchIndex } : undefined;
  const routed = routedBody(name, { input, expandKey, pathCtx, t, searchQuery, highlight: inputHit ? highlight : undefined });

  return (
    <ToolRow
      icon={<ToolIcon toolName={name} className="w-4 h-4" />}
      verb={name || t("common.unknown")}
      target={routed.target}
      meta={routed.meta}
      outcome={outcome}
      family={family}
      toolId={toolId}
      expandKey={expandKey}
      revealFor={inputHit || idHit ? searchQuery : undefined}
      detailMeta={
        idHit ? (
          <code data-mono="code" className="font-mono">
            <Marked text={toolId} highlight={highlight} />
          </code>
        ) : undefined
      }
    >
      {routed.body}
      <ToolResultOutputs results={toolResults} family={family} expandKey={expandKey} failed={outcome.verdict === "failed"} searchQuery={searchQuery} />
    </ToolRow>
  );
});
