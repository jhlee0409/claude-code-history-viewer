/**
 * CodeExecutionToolResultRenderer - Renders legacy Python code execution results
 *
 * Displays stdout/stderr output from Python code execution with appropriate styling.
 * Supports both successful results and error conditions for the legacy code execution API.
 */

import { memo } from "react";
import { Terminal, CheckCircle, AlertCircle, Code } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "../renderers";

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

const isCodeExecutionError = (
  content: CodeExecutionResult | CodeExecutionError
): content is CodeExecutionError => {
  return content.type === "code_execution_tool_result_error";
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid_tool_input: "Invalid input provided",
  unavailable: "Service temporarily unavailable",
  too_many_requests: "Rate limit exceeded",
  execution_time_exceeded: "Execution time limit exceeded",
};

export const CodeExecutionToolResultRenderer = memo(function CodeExecutionToolResultRenderer({
  toolUseId,
  content,
}: Props) {
  const { t } = useTranslation("components");

  // Error state
  if (isCodeExecutionError(content)) {
    const errorStyles = getVariantStyles("error");

    return (
      <div className={cn(layout.rounded, "border", errorStyles.container)}>
        <div className={cn("flex items-center justify-between", layout.headerPadding, layout.headerHeight)}>
          <div className={cn("flex items-center", layout.iconGap)}>
            <AlertCircle className={cn(layout.iconSize, errorStyles.icon)} />
            <span className={cn(layout.titleText, errorStyles.title)}>
              {t("codeExecutionToolResultRenderer.error", {
                defaultValue: "Code Execution Error",
              })}
            </span>
          </div>
          <div className={cn("flex items-center shrink-0", layout.iconGap, layout.smallText)}>
            <span className={cn(layout.monoText, errorStyles.accent)}>
              {toolUseId}
            </span>
          </div>
        </div>
        <div className={layout.contentPadding}>
          <div className={cn(layout.bodyText, errorStyles.accent)}>
            {ERROR_MESSAGES[content.error_code] || content.error_code}
          </div>
        </div>
      </div>
    );
  }

  // Success state
  const { stdout, stderr, return_code } = content;
  const isSuccess = return_code === 0;
  const successStyles = getVariantStyles("success");

  return (
    <div className={cn(layout.rounded, "border", successStyles.container)}>
      <div className={cn("flex items-center justify-between", layout.headerPadding, layout.headerHeight)}>
        <div className={cn("flex items-center", layout.iconGap)}>
          <Code className={cn(layout.iconSize, successStyles.icon)} />
          {isSuccess ? (
            <CheckCircle className={cn(layout.iconSizeSmall, "text-success")} />
          ) : (
            <AlertCircle className={cn(layout.iconSizeSmall, "text-warning")} />
          )}
          <span className={cn(layout.titleText, successStyles.title)}>
            {t("codeExecutionToolResultRenderer.title", {
              defaultValue: "Code Execution Result",
            })}
          </span>
        </div>
        <div className={cn("flex items-center shrink-0", layout.iconGap, layout.smallText)}>
          <span className={cn(layout.monoText, successStyles.accent)}>
            {toolUseId}
          </span>
          {return_code !== undefined && (
            <span
              className={cn(
                layout.monoText,
                "px-1.5 py-0.5 rounded",
                isSuccess
                  ? "bg-success/20 text-success"
                  : "bg-warning/20 text-warning"
              )}
            >
              exit: {return_code}
            </span>
          )}
        </div>
      </div>

      <div className={layout.contentPadding}>
        {/* stdout */}
        {stdout && (
          <div className="mb-2">
            <div className={cn("flex items-center space-x-1 mb-1", layout.smallText, "text-success")}>
              <Terminal className={layout.iconSizeSmall} />
              <span className="font-mono">stdout</span>
            </div>
            <pre className={cn(layout.monoText, "text-success bg-secondary rounded p-2 overflow-x-auto whitespace-pre-wrap", layout.codeMaxHeight)}>
              {stdout}
            </pre>
          </div>
        )}

        {/* stderr */}
        {stderr && (
          <div>
            <div className={cn("flex items-center space-x-1 mb-1", layout.smallText, "text-warning")}>
              <AlertCircle className={layout.iconSizeSmall} />
              <span className="font-mono">stderr</span>
            </div>
            <pre className={cn(layout.monoText, "text-warning bg-secondary rounded p-2 overflow-x-auto whitespace-pre-wrap", layout.codeMaxHeight)}>
              {stderr}
            </pre>
          </div>
        )}

        {!stdout && !stderr && (
          <div className={cn(layout.smallText, "italic", successStyles.accent)}>
            {t("codeExecutionToolResultRenderer.noOutput", {
              defaultValue: "No output",
            })}
          </div>
        )}
      </div>
    </div>
  );
});
