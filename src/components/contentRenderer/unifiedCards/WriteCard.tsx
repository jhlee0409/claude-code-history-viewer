import { memo } from "react";
import { useTranslation } from "react-i18next";
import { ToolIcon } from "../../ToolIcon";
import { ToolRow } from "../../transcript/ToolRow";
import { OutputBlock } from "../../transcript/OutputBlock";
import { ToolResultOutputs } from "../../transcript/ToolResultOutputs";
import { toolFamily, toolOutcome, writeConfirmationPath } from "../../transcript/toolOutcome";
import { useToolPathContext } from "../../transcript/pathContext";
import { PathText } from "@/lib/format/PathText";
import type { Props } from "./shared";
import { str, strAny } from "./shared";

/**
 * Write: path target, the written line count in the header meta (once), the
 * written content in a file well. A result that is only Claude's confirmation
 * sentence ("File created successfully at: <absolute path>") adds nothing
 * when it names the header's own file and is left out; naming another file,
 * it shows that path the PathText way (relative, full path in `title`).
 * Anything else is shown as recorded (renderer audit TC15).
 */
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
  const confirmations = toolResults.map((result) => writeConfirmationPath(result));
  const otherResults = toolResults.filter((_, index) => confirmations[index] === null);
  const otherPaths = confirmations.filter((path): path is string => path !== null && path !== filePath);

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
      {content != null && <OutputBlock text={content} source="file" showLineCount={false} expandKey={`${expandKey}-content`} />}
      {otherPaths.map((path, index) => (
        <p key={index} className="text-list text-fg-2">
          <PathText path={path} ctx={pathCtx} className="text-code" />
        </p>
      ))}
      <ToolResultOutputs results={otherResults} family={family} expandKey={expandKey} />
    </ToolRow>
  );
});
