import { memo } from "react";
import { Terminal, CheckCircle, AlertCircle, Code } from "lucide-react";
import { useTranslation } from "react-i18next";

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

  if (isCodeExecutionError(content)) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-3">
        <div className="flex items-center space-x-2 mb-2">
          <AlertCircle className="w-4 h-4 text-red-600" />
          <span className="text-xs font-medium text-red-800">
            {t("codeExecutionToolResultRenderer.error", {
              defaultValue: "Code Execution Error",
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
    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
      <div className="flex items-center space-x-2 mb-2">
        <Code className="w-4 h-4 text-emerald-600" />
        {isSuccess ? (
          <CheckCircle className="w-3 h-3 text-green-500" />
        ) : (
          <AlertCircle className="w-3 h-3 text-orange-500" />
        )}
        <span className="text-xs font-medium text-emerald-800">
          {t("codeExecutionToolResultRenderer.title", {
            defaultValue: "Code Execution Result",
          })}
        </span>
        <span className="text-xs text-emerald-500 font-mono">{toolUseId}</span>
        {return_code !== undefined && (
          <span
            className={`text-xs px-1.5 py-0.5 rounded ${
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
          <div className="flex items-center space-x-1 text-xs text-emerald-600 mb-1">
            <Terminal className="w-3 h-3" />
            <span>stdout</span>
          </div>
          <pre className="text-xs text-emerald-700 bg-emerald-100 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-64">
            {stdout}
          </pre>
        </div>
      )}

      {/* stderr */}
      {stderr && (
        <div>
          <div className="flex items-center space-x-1 text-xs text-orange-600 mb-1">
            <AlertCircle className="w-3 h-3" />
            <span>stderr</span>
          </div>
          <pre className="text-xs text-orange-700 bg-orange-100 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-64">
            {stderr}
          </pre>
        </div>
      )}

      {!stdout && !stderr && (
        <div className="text-xs text-emerald-500 italic">
          {t("codeExecutionToolResultRenderer.noOutput", {
            defaultValue: "No output",
          })}
        </div>
      )}
    </div>
  );
});
