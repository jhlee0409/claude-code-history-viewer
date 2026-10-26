import { memo } from "react";
import { useTranslation } from "react-i18next";
import { ToolIcon } from "../../ToolIcon";
import { CodeTarget, TargetWell, ToolRow, WhenTargetCut } from "../../transcript/ToolRow";
import { ToolResultOutputs } from "../../transcript/ToolResultOutputs";
import { DetailZone } from "../../transcript/DetailZone";
import { hasShownResults, toolFamily, toolOutcome } from "../../transcript/toolOutcome";
import { useToolPathContext } from "../../transcript/pathContext";
import { PathText } from "@/lib/format/PathText";
import type { Props } from "./shared";
import { str } from "./shared";
import { isNonEmptyString, shownIf, unshown } from "./recordShape";
import { OtherRecordedFields } from "./toolBodyParts";

/** Grep's `output_mode` values, in words (renderer audit TC12). */
const OUTPUT_MODE_KEYS = {
  files_with_matches: "toolRow.grepModeFiles",
  content: "toolRow.grepModeContent",
  count: "toolRow.grepModeCount",
} as const;

/** The output mode in words; a mode this list does not know, as recorded (a code literal). */
function OutputMode({ mode }: { mode: string }) {
  const { t } = useTranslation();
  const key = Object.hasOwn(OUTPUT_MODE_KEYS, mode) ? OUTPUT_MODE_KEYS[mode as keyof typeof OUTPUT_MODE_KEYS] : null;
  return key ? <span>{t(key)}</span> : <code data-mono="code" className="font-mono">{mode}</code>;
}

export const GrepCard = memo(function GrepCard({ toolUse, toolResults, searchQuery, isCurrentMatch, currentMatchIndex }: Props) {
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
  const rest = unshown(input, { pattern: shownIf(isNonEmptyString), path: shownIf(isNonEmptyString), glob: shownIf(isNonEmptyString), output_mode: shownIf(isNonEmptyString) });
  const hasRest = Object.keys(rest).length > 0;

  return (
    <ToolRow
      icon={<ToolIcon toolName="Grep" title={null} className="w-4 h-4" />}
      verb={name}
      target={pattern ? <CodeTarget text={pattern} /> : undefined}
      meta={
        <>
          {path && <PathText path={path} ctx={pathCtx} />}
          {glob && <span data-mono="code" className="font-mono">{glob}</span>}
          {outputMode && <OutputMode mode={outputMode} />}
        </>
      }
      outcome={outcome}
      family={family}
      toolId={toolId}
      expandKey={expandKey}
    >
      <DetailZone kind="input" show={hasRest ? true : pattern ? "whenTargetCut" : false}>
        {pattern && (
          <WhenTargetCut>
            <TargetWell text={pattern} />
          </WhenTargetCut>
        )}
        <OtherRecordedFields rest={rest} expandKey={expandKey} searchQuery={searchQuery} isCurrentMatch={isCurrentMatch} currentMatchIndex={currentMatchIndex} />
      </DetailZone>
      <DetailZone kind="result" show={hasShownResults(toolResults)}>
        {/* Content-mode matches are records: one line each, the well scrolls sideways (TC13). */}
        <ToolResultOutputs results={toolResults} family={family} expandKey={expandKey} failed={outcome.verdict === "failed"} wrap={outputMode !== "content"} />
      </DetailZone>
    </ToolRow>
  );
});
