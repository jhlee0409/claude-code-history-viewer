/**
 * CodeExecutionToolResultRenderer - Renders legacy Python code execution results
 *
 * Displays stdout/stderr output from Python code execution with appropriate styling.
 * Supports both successful results and error conditions for the legacy code execution API.
 */

import { memo } from "react";
import { Code } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "../renderers";
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
  const successStyles = getVariantStyles("success");
  const errorMessages = getCommonToolErrorMessages(t);

  return (
    <TerminalExecutionResultRenderer
      toolUseId={toolUseId}
      content={content}
      icon={<Code className={cn(layout.iconSize, successStyles.icon)} />}
      title={t("codeExecutionToolResultRenderer.title")}
      errorTitle={t("codeExecutionToolResultRenderer.error")}
      noOutputLabel={t("codeExecutionToolResultRenderer.noOutput")}
      errorMessages={errorMessages}
      successVariant="success"
    />
  );
});
