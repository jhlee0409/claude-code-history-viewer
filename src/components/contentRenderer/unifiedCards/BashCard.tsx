import { memo } from "react";
import { ToolIcon } from "../../ToolIcon";
import { CodeTarget, CodeWell, ToolRow } from "../../transcript/ToolRow";
import { ToolResultOutputs } from "../../transcript/ToolResultOutputs";
import { toolFamily, toolOutcome } from "../../transcript/toolOutcome";
import type { Props } from "./shared";
import { str, num } from "./shared";
import { useFormat } from "@/lib/format/useFormat";
import { Num } from "@/lib/format/Num";

const firstLine = (text: string) => text.trimStart().split("\n")[0] ?? "";

export const BashCard = memo(function BashCard({ toolUse, toolResults }: Props) {
  const fmt = useFormat();
  const name = (toolUse.name as string) || "Bash";
  const toolId = (toolUse.id as string) || "";
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const command = str(input, "command") ?? "";
  const description = str(input, "description");
  const timeout = num(input, "timeout");
  const family = toolFamily(name);
  const outcome = toolOutcome(toolUse, toolResults, family);
  const expandKey = `unified-${toolId}`;

  return (
    <ToolRow
      icon={<ToolIcon toolName="Bash" className="w-4 h-4" />}
      verb={name}
      target={command ? <CodeTarget text={firstLine(command)} /> : undefined}
      meta={timeout != null ? <Num>{fmt.duration(timeout)}</Num> : undefined}
      outcome={outcome}
      family={family}
      toolId={toolId}
      expandKey={expandKey}
    >
      {description && <p className="text-list text-fg-2">{description}</p>}
      {command && <CodeWell text={command} />}
      <ToolResultOutputs results={toolResults} family={family} source="command" expandKey={expandKey} />
    </ToolRow>
  );
});
