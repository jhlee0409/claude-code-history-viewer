/**
 * BashCodeExecutionToolResultRenderer - Renders bash command execution results
 *
 * Displays stdout/stderr output with appropriate styling for success/error states.
 * Supports both successful results and error conditions.
 */

import { memo } from "react";
import { Terminal, CheckCircle, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { BashCodeExecutionResult, BashCodeExecutionError } from "../../types";
import { getVariantStyles, layout } from "@/components/renderers";

interface BashCodeExecutionToolResultRendererProps {
  toolUseId: string;
  content: BashCodeExecutionResult | BashCodeExecutionError;
}

const isBashError = (
  content: BashCodeExecutionResult | BashCodeExecutionError
): content is BashCodeExecutionError => {
  return content.type === "bash_code_execution_tool_result_error";
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid_tool_input: "Invalid input provided",
  unavailable: "Service temporarily unavailable",
  too_many_requests: "Rate limit exceeded",
  execution_time_exceeded: "Execution time limit exceeded",
};

export const BashCodeExecutionToolResultRenderer = memo(
  function BashCodeExecutionToolResultRenderer({
    toolUseId,
    content,
  }: BashCodeExecutionToolResultRendererProps) {
    const { t } = useTranslation("components");

    // Error state
    if (isBashError(content)) {
      const errorStyles = getVariantStyles("error");

      return (
        <div className={cn(layout.rounded, "border", errorStyles.container)}>
          <div className={cn("flex items-center justify-between", layout.headerPadding, layout.headerHeight)}>
            <div className={cn("flex items-center", layout.iconGap)}>
              <AlertCircle className={cn(layout.iconSize, errorStyles.icon)} />
              <span className={cn(layout.titleText, errorStyles.title)}>
                {t("bashCodeExecutionToolResultRenderer.error", {
                  defaultValue: "Bash Execution Error",
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
    const systemStyles = getVariantStyles("system");

    return (
      <div className={cn(layout.rounded, "border", systemStyles.container)}>
        <div className={cn("flex items-center justify-between", layout.headerPadding, layout.headerHeight)}>
          <div className={cn("flex items-center", layout.iconGap)}>
            <Terminal className={cn(layout.iconSize, systemStyles.icon)} />
            {isSuccess ? (
              <CheckCircle className={cn(layout.iconSizeSmall, "text-success")} />
            ) : (
              <AlertCircle className={cn(layout.iconSizeSmall, "text-warning")} />
            )}
            <span className={cn(layout.titleText, systemStyles.title)}>
              {t("bashCodeExecutionToolResultRenderer.title", {
                defaultValue: "Bash Execution",
              })}
            </span>
          </div>
          <div className={cn("flex items-center shrink-0", layout.iconGap, layout.smallText)}>
            <span className={cn(layout.monoText, "text-muted-foreground")}>{toolUseId}</span>
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
              <div className={cn("flex items-center space-x-1 mb-1", layout.smallText, "text-muted-foreground")}>
                <span className="font-mono">stdout:</span>
              </div>
              <pre className={cn(layout.monoText, "bg-secondary text-success rounded p-2 overflow-x-auto whitespace-pre-wrap", layout.codeMaxHeight)}>
                {stdout}
              </pre>
            </div>
          )}

          {/* stderr */}
          {stderr && (
            <div>
              <div className={cn("flex items-center space-x-1 mb-1", layout.smallText, "text-warning")}>
                <span className="font-mono">stderr:</span>
              </div>
              <pre className={cn(layout.monoText, "bg-secondary text-destructive rounded p-2 overflow-x-auto whitespace-pre-wrap", layout.codeMaxHeight)}>
                {stderr}
              </pre>
            </div>
          )}

          {!stdout && !stderr && (
            <div className={cn(layout.smallText, "text-muted-foreground italic")}>
              {t("bashCodeExecutionToolResultRenderer.noOutput", {
                defaultValue: "No output",
              })}
            </div>
          )}
        </div>
      </div>
    );
  }
);
