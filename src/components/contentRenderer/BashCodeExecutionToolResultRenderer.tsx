/**
 * BashCodeExecutionToolResultRenderer - a `bash_code_execution_tool_result`
 * (TR1b): stdout / stderr as one OutputBlock, the outcome from its recorded
 * return code or error code (TerminalExecutionResultRenderer).
 */

import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { BashCodeExecutionResult, BashCodeExecutionError } from "../../types";
import { TerminalExecutionResultRenderer } from "./TerminalExecutionResultRenderer";
import { getCommonToolErrorMessages } from "./toolResultErrorMessages";

interface BashCodeExecutionToolResultRendererProps {
  toolUseId: string;
  content: BashCodeExecutionResult | BashCodeExecutionError;
}

export const BashCodeExecutionToolResultRenderer = memo(
  function BashCodeExecutionToolResultRenderer({
    toolUseId,
    content,
  }: BashCodeExecutionToolResultRendererProps) {
    const { t } = useTranslation();
    return (
      <TerminalExecutionResultRenderer
        toolUseId={toolUseId}
        content={content}
        verb="bash_code_execution"
        resultType="bash_code_execution_tool_result"
        noOutputLabel={t("bashCodeExecutionToolResultRenderer.noOutput")}
        errorMessages={getCommonToolErrorMessages(t)}
      />
    );
  }
);
