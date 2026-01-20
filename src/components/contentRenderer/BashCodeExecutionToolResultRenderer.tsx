import { memo } from "react";
import { Terminal, CheckCircle, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BashCodeExecutionResult, BashCodeExecutionError } from "../../types";

type Props = {
  toolUseId: string;
  content: BashCodeExecutionResult | BashCodeExecutionError;
};

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
  function BashCodeExecutionToolResultRenderer({ toolUseId, content }: Props) {
    const { t } = useTranslation("components");

    if (isBashError(content)) {
      return (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="flex items-center space-x-2 mb-2">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <span className="text-xs font-medium text-red-800">
              {t("bashCodeExecutionToolResultRenderer.error", {
                defaultValue: "Bash Execution Error",
              })}
            </span>
            <span className="text-xs text-red-500 font-mono">{toolUseId}</span>
          </div>
          <div className="text-sm text-red-700">
            {ERROR_MESSAGES[content.error_code] || content.error_code}
          </div>
        </div>
      );
    }

    const { stdout, stderr, return_code } = content;
    const isSuccess = return_code === 0;

    return (
      <div className="bg-slate-50 border border-slate-300 rounded-lg p-3">
        <div className="flex items-center space-x-2 mb-2">
          <Terminal className="w-4 h-4 text-slate-600" />
          {isSuccess ? (
            <CheckCircle className="w-3 h-3 text-green-500" />
          ) : (
            <AlertCircle className="w-3 h-3 text-orange-500" />
          )}
          <span className="text-xs font-medium text-slate-800">
            {t("bashCodeExecutionToolResultRenderer.title", {
              defaultValue: "Bash Execution",
            })}
          </span>
          <span className="text-xs text-slate-500 font-mono">{toolUseId}</span>
          {return_code !== undefined && (
            <span
              className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                isSuccess
                  ? "bg-green-100 text-green-700"
                  : "bg-orange-100 text-orange-700"
              }`}
            >
              exit: {return_code}
            </span>
          )}
        </div>

        {/* stdout */}
        {stdout && (
          <div className="mb-2">
            <div className="flex items-center space-x-1 text-xs text-slate-500 mb-1">
              <span className="font-mono">stdout:</span>
            </div>
            <pre className="text-xs bg-slate-900 text-green-400 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-64 font-mono">
              {stdout}
            </pre>
          </div>
        )}

        {/* stderr */}
        {stderr && (
          <div>
            <div className="flex items-center space-x-1 text-xs text-orange-600 mb-1">
              <span className="font-mono">stderr:</span>
            </div>
            <pre className="text-xs bg-slate-900 text-red-400 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-64 font-mono">
              {stderr}
            </pre>
          </div>
        )}

        {!stdout && !stderr && (
          <div className="text-xs text-slate-500 italic">
            {t("bashCodeExecutionToolResultRenderer.noOutput", {
              defaultValue: "No output",
            })}
          </div>
        )}
      </div>
    );
  }
);
