import { memo } from "react";
import { ToolIcon } from "../../ToolIcon";
import { CodeTarget, ToolRow } from "../../transcript/ToolRow";
import { ToolResultOutputs } from "../../transcript/ToolResultOutputs";
import { toolFamily, toolOutcome } from "../../transcript/toolOutcome";
import { useToolPathContext } from "../../transcript/pathContext";
import { PathText } from "@/lib/format/PathText";
import type { Props } from "./shared";
import { str } from "./shared";

export const GrepCard = memo(function GrepCard({ toolUse, toolResults }: Props) {
  const pathCtx = useToolPathContext();
  const name = (toolUse.name as string) || "Grep";
  const toolId = (toolUse.id as string) || "";
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const pattern = str(input, "pattern") ?? "";
  const path = str(input, "path");
  const glob = str(input, "glob");
  const outputMode = str(input, "output_mode");
  const family = toolFamily(name);
  const outcome = toolOutcome(toolUse, toolResults, family);
  const expandKey = `unified-${toolId}`;

  return (
    <ToolRow
      icon={<ToolIcon toolName="Grep" className="w-4 h-4" />}
      verb={name}
      target={pattern ? <CodeTarget text={pattern} /> : undefined}
      meta={
        <>
          {path && <PathText path={path} ctx={pathCtx} />}
          {glob && <span data-mono="code" className="font-mono">{glob}</span>}
          {outputMode && <span>{outputMode}</span>}
        </>
      }
      outcome={outcome}
      family={family}
      toolId={toolId}
      expandKey={expandKey}
    >
      <ToolResultOutputs results={toolResults} family={family} expandKey={expandKey} />
    </ToolRow>
  );
});
