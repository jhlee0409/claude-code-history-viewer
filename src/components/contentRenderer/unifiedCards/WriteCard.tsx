import { memo } from "react";
import { useTranslation } from "react-i18next";
import { ToolIcon } from "../../ToolIcon";
import { ToolRow } from "../../transcript/ToolRow";
import { OutputBlock } from "../../transcript/OutputBlock";
import { ToolResultOutputs } from "../../transcript/ToolResultOutputs";
import { toolFamily, toolOutcome } from "../../transcript/toolOutcome";
import { useToolPathContext } from "../../transcript/pathContext";
import { PathText } from "@/lib/format/PathText";
import type { Props } from "./shared";
import { str, strAny } from "./shared";

export const WriteCard = memo(function WriteCard({ toolUse, toolResults }: Props) {
  const { t } = useTranslation();
  const pathCtx = useToolPathContext();
  const name = (toolUse.name as string) || "Write";
  const toolId = (toolUse.id as string) || "";
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const filePath = strAny(input, "file_path", "path") ?? "";
  const content = str(input, "content");
  const family = toolFamily(name);
  const outcome = toolOutcome(toolUse, toolResults, family);
  const expandKey = `unified-${toolId}`;

  return (
    <ToolRow
      icon={<ToolIcon toolName="Write" className="w-4 h-4" />}
      verb={name}
      target={filePath ? <PathText path={filePath} ctx={pathCtx} className="text-code text-fg" /> : undefined}
      meta={content != null ? <span>{t("toolRow.lineCount", { count: content.split("\n").length })}</span> : undefined}
      outcome={outcome}
      family={family}
      toolId={toolId}
      expandKey={expandKey}
    >
      {content != null && <OutputBlock text={content} source="file" expandKey={`${expandKey}-content`} />}
      <ToolResultOutputs results={toolResults} family={family} expandKey={expandKey} />
    </ToolRow>
  );
});
