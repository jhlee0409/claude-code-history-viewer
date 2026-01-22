/**
 * TextEditorCodeExecutionToolResultRenderer - Renders text editor file operation results
 *
 * Displays file operations (view, create, edit, delete) with appropriate styling.
 * Supports both successful operations and error conditions with file content preview.
 */

import { memo } from "react";
import { FileEdit, CheckCircle, AlertCircle, Eye, FilePlus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { TextEditorResult, TextEditorError } from "../../types";
import { getVariantStyles, layout } from "../renderers";

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
      const errorStyles = getVariantStyles("error");

      return (
        <div className={cn(layout.rounded, "border", errorStyles.container)}>
          <div className={cn("flex items-center justify-between", layout.headerPadding, layout.headerHeight)}>
            <div className={cn("flex items-center", layout.iconGap)}>
              <AlertCircle className={cn(layout.iconSize, errorStyles.icon)} />
              <span className={cn(layout.titleText, errorStyles.title)}>
                {t("textEditorCodeExecutionToolResultRenderer.error", {
                  defaultValue: "Text Editor Error",
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

    const { operation, path, content: fileContent, success } = content;

    const warningStyles = getVariantStyles("warning");
    const successStyles = getVariantStyles("success");
    const errorStyles = getVariantStyles("error");

    const getOperationIcon = () => {
      switch (operation) {
        case "view":
          return <Eye className={cn(layout.iconSize, warningStyles.icon)} />;
        case "create":
          return <FilePlus className={cn(layout.iconSize, successStyles.icon)} />;
        case "delete":
          return <Trash2 className={cn(layout.iconSize, errorStyles.icon)} />;
        case "edit":
        default:
          return <FileEdit className={cn(layout.iconSize, warningStyles.icon)} />;
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
      <div className={cn(layout.rounded, "border", warningStyles.container)}>
        <div className={cn("flex items-center justify-between", layout.headerPadding, layout.headerHeight)}>
          <div className={cn("flex items-center", layout.iconGap)}>
            {getOperationIcon()}
            {success !== false ? (
              <CheckCircle className={cn(layout.iconSizeSmall, "text-success")} />
            ) : (
              <AlertCircle className={cn(layout.iconSizeSmall, warningStyles.icon)} />
            )}
            <span className={cn(layout.titleText, warningStyles.title)}>
              {getOperationLabel()}
            </span>
          </div>
          <div className={cn("flex items-center shrink-0", layout.iconGap, layout.smallText)}>
            <span className={cn(layout.monoText, warningStyles.accent)}>
              {toolUseId}
            </span>
          </div>
        </div>

        <div className={layout.contentPadding}>
          {/* File path */}
          {path && (
            <div className={cn(
              layout.monoText,
              "mb-2 px-2 py-1 truncate bg-warning/20",
              layout.rounded,
              warningStyles.accent
            )}>
              {path}
            </div>
          )}

          {/* File content preview */}
          {fileContent && (
            <details className="mt-2">
              <summary className={cn(
                layout.smallText,
                "cursor-pointer hover:opacity-80",
                warningStyles.accent
              )}>
                {t("textEditorCodeExecutionToolResultRenderer.showContent", {
                  defaultValue: "Show file content",
                })}
              </summary>
              <pre className={cn(
                "mt-2 p-2 overflow-x-auto whitespace-pre-wrap",
                layout.monoText,
                layout.rounded,
                layout.codeMaxHeight,
                "bg-warning/20",
                warningStyles.accent
              )}>
                {truncateContent(fileContent)}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
);
