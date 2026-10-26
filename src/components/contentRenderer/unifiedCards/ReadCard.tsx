import { memo } from "react";
import { ToolIcon } from "../../ToolIcon";
import { ToolRow } from "../../transcript/ToolRow";
import { ToolResultOutputs } from "../../transcript/ToolResultOutputs";
import { DetailZone } from "../../transcript/DetailZone";
import { hasShownResults, toolFamily, toolOutcome } from "../../transcript/toolOutcome";
import { useToolPathContext } from "../../transcript/pathContext";
import { PathText } from "@/lib/format/PathText";
import type { Props } from "./shared";
import { num, strAny } from "./shared";

export const ReadCard = memo(function ReadCard({ toolUse, toolResults }: Props) {
  const pathCtx = useToolPathContext();
  const name = (toolUse.name as string) || "Read";
  const toolId = (toolUse.id as string) || "";
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const filePath = strAny(input, "file_path", "path") ?? "";
  const offset = num(input, "offset");
  const limit = num(input, "limit");
  const family = toolFamily(name);
  const outcome = toolOutcome(toolUse, toolResults, family);
  const expandKey = `unified-${toolId}`;

  const rangeLabel = offset != null || limit != null
    ? `${offset != null ? `L${offset}` : ""}${offset != null && limit != null ? "–" : ""}${limit != null ? `${(offset ?? 0) + (limit ?? 0)}` : ""}`
    : null;

  return (
    <ToolRow
      icon={<ToolIcon toolName="Read" title={null} className="w-4 h-4" />}
      verb={name}
      target={filePath ? <PathText path={filePath} ctx={pathCtx} className="text-code text-fg" /> : undefined}
      meta={rangeLabel ? <span data-mono="code" className="font-mono">{rangeLabel}</span> : undefined}
      outcome={outcome}
      family={family}
      toolId={toolId}
      expandKey={expandKey}
    >
      {/* The path and range are the row's: the opened detail is the result alone. */}
      <DetailZone kind="result" show={hasShownResults(toolResults)}>
        <ToolResultOutputs results={toolResults} family={family} source="file" expandKey={expandKey} failed={outcome.verdict === "failed"} />
      </DetailZone>
    </ToolRow>
  );
});
