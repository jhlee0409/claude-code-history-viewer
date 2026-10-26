/**
 * ResultRow (TR1b): the head of a server / API tool result
 * (`web_search_tool_result`, `web_fetch_tool_result`, `mcp_tool_result`,
 * code execution, text editor, tool search, advisor) — the `ToolResultCard`
 * head these renderers had is gone; their bodies are unchanged.
 *
 * - Inside its call's row (`ResultRowContext.paired`, provided by
 *   `ServerToolUseRenderer`): the body only, after one caption line of
 *   `meta` (a result count). The call's ToolRow already states the outcome
 *   and owns the tool id.
 * - Alone (its call is not in the message): a ToolRow of its own — the
 *   recorded name (the result type without `_tool_result`) · "Call not
 *   recorded" · the outcome from `toolOutcome` over this result only (an
 *   `error_code` reads "Failed · <code>", `is_error` "Failed", a recorded
 *   return code decides a process result); opened, the body in the Result
 *   zone and "Copy tool ID" ending the meta line.
 *
 * No success glyph, no tool-colour fill, no "… Error" title: the outcome is
 * said once, by OutcomeStatus.
 */
import { useContext, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ToolIcon } from "../ToolIcon";
import { DetailZone } from "./DetailZone";
import { TextTarget, ToolRow } from "./ToolRow";
import { ResultRowContext } from "./resultRowContext";
import { toolFamily, toolOutcome, type ToolFamily, type ToolResultLike } from "./toolOutcome";

interface ResultRowProps {
  /** The recorded tool name the result answers (`web_search`, `mcp` …). */
  verb: string;
  /** The result block as the outcome adapter reads it (`content`, `is_error`, own metadata). */
  result: ToolResultLike;
  toolUseId: string;
  family?: ToolFamily;
  /** Caption facts of the result (a result count). */
  meta?: ReactNode;
  children?: ReactNode;
}

export function ResultRow({ verb, result, toolUseId, family = toolFamily(verb), meta, children }: ResultRowProps) {
  const { t } = useTranslation();
  const { paired } = useContext(ResultRowContext);
  if (paired) {
    return (
      <div data-result-body="" className="space-y-1">
        {meta && <div className="text-caption text-fg-3">{meta}</div>}
        {children}
      </div>
    );
  }
  const outcome = toolOutcome(null, [result], family);
  return (
    <ToolRow
      icon={<ToolIcon toolName={verb} title={null} className="w-4 h-4" />}
      verb={verb}
      target={<TextTarget text={t("toolRow.callNotRecorded")} />}
      meta={meta}
      outcome={outcome}
      family={family}
      toolId={toolUseId}
      expandKey={`result-${toolUseId}`}
    >
      <DetailZone kind="result">{children}</DetailZone>
    </ToolRow>
  );
}
