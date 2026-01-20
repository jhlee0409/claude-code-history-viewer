import { memo } from "react";
import { FileEdit, CheckCircle, AlertCircle, Eye, FilePlus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TextEditorResult, TextEditorError } from "../../types";

type Props = {
  toolUseId: string;
  content: TextEditorResult | TextEditorError;
};

const isTextEditorError = (
  content: TextEditorResult | TextEditorError
): content is TextEditorError => {
  return content.type === "text_editor_code_execution_tool_result_error";
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid_tool_input: "Invalid input provided",
  unavailable: "Service temporarily unavailable",
  too_many_requests: "Rate limit exceeded",
  execution_time_exceeded: "Execution time limit exceeded",
  file_not_found: "File not found",
  permission_denied: "Permission denied",
};

const TEXT_PREVIEW_LENGTH = 500;

export const TextEditorCodeExecutionToolResultRenderer = memo(
  function TextEditorCodeExecutionToolResultRenderer({
    toolUseId,
    content,
  }: Props) {
    const { t } = useTranslation("components");

    if (isTextEditorError(content)) {
      return (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="flex items-center space-x-2 mb-2">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <span className="text-xs font-medium text-red-800">
              {t("textEditorCodeExecutionToolResultRenderer.error", {
                defaultValue: "Text Editor Error",
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

    const { operation, path, content: fileContent, success } = content;

    const getOperationIcon = () => {
      switch (operation) {
        case "view":
          return <Eye className="w-4 h-4 text-amber-600" />;
        case "create":
          return <FilePlus className="w-4 h-4 text-green-600" />;
        case "delete":
          return <Trash2 className="w-4 h-4 text-red-600" />;
        case "edit":
        default:
          return <FileEdit className="w-4 h-4 text-amber-600" />;
      }
    };

    const getOperationLabel = () => {
      switch (operation) {
        case "view":
          return t("textEditorCodeExecutionToolResultRenderer.view", {
            defaultValue: "View File",
          });
        case "create":
          return t("textEditorCodeExecutionToolResultRenderer.create", {
            defaultValue: "Create File",
          });
        case "delete":
          return t("textEditorCodeExecutionToolResultRenderer.delete", {
            defaultValue: "Delete File",
          });
        case "edit":
        default:
          return t("textEditorCodeExecutionToolResultRenderer.edit", {
            defaultValue: "Edit File",
          });
      }
    };

    const truncateContent = (text: string): string => {
      return text.length > TEXT_PREVIEW_LENGTH
        ? text.substring(0, TEXT_PREVIEW_LENGTH) + "..."
        : text;
    };

    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <div className="flex items-center space-x-2 mb-2">
          {getOperationIcon()}
          {success !== false ? (
            <CheckCircle className="w-3 h-3 text-green-500" />
          ) : (
            <AlertCircle className="w-3 h-3 text-orange-500" />
          )}
          <span className="text-xs font-medium text-amber-800">
            {getOperationLabel()}
          </span>
          <span className="text-xs text-amber-500 font-mono">{toolUseId}</span>
        </div>

        {/* File path */}
        {path && (
          <div className="text-sm text-amber-700 font-mono mb-2 bg-amber-100 px-2 py-1 rounded truncate">
            {path}
          </div>
        )}

        {/* File content preview */}
        {fileContent && (
          <details className="mt-2">
            <summary className="text-xs text-amber-600 cursor-pointer hover:text-amber-800">
              {t("textEditorCodeExecutionToolResultRenderer.showContent", {
                defaultValue: "Show file content",
              })}
            </summary>
            <pre className="mt-2 text-xs text-amber-700 bg-amber-100 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-64 font-mono">
              {truncateContent(fileContent)}
            </pre>
          </details>
        )}
      </div>
    );
  }
);
