/**
 * CodeExecutionToolResultRenderer - a legacy Python `code_execution_tool_result`
 * (TR1b): stdout / stderr as one OutputBlock, the outcome from its recorded
 * return code or error code (TerminalExecutionResultRenderer).
 */

import { memo } from "react";
import { useTranslation } from "react-i18next";
import { TerminalExecutionResultRenderer } from "./TerminalExecutionResultRenderer";
import { getCommonToolErrorMessages } from "./toolResultErrorMessages";

/** Legacy Python code execution result */
interface CodeExecutionResult {
  type: "code_execution_result";
  stdout?: string;
  stderr?: string;
  return_code?: number;
}

/** Code execution error */
interface CodeExecutionError {
  type: "code_execution_tool_result_error";
  error_code:
    | "invalid_tool_input"
    | "unavailable"
    | "too_many_requests"
    | "execution_time_exceeded";
}

type Props = {
  toolUseId: string;
  content: CodeExecutionResult | CodeExecutionError;
};

export const CodeExecutionToolResultRenderer = memo(function CodeExecutionToolResultRenderer({
  toolUseId,
  content,
}: Props) {
  const { t } = useTranslation();
  return (
    <TerminalExecutionResultRenderer
      toolUseId={toolUseId}
      content={content}
      verb="code_execution"
      resultType="code_execution_tool_result"
      noOutputLabel={t("codeExecutionToolResultRenderer.noOutput")}
      errorMessages={getCommonToolErrorMessages(t)}
    />
  );
});
