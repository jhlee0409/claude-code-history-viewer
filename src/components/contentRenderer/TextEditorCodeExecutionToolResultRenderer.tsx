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
import { ToolResultCard } from "./ToolResultCard";
import { getCommonToolErrorMessages } from "./toolResultErrorMessages";

type Props = {
  toolUseId: string;
  content: TextEditorResult | TextEditorError;
};

const isTextEditorError = (
  content: TextEditorResult | TextEditorError
): content is TextEditorError => {
  return content.type === "text_editor_code_execution_tool_result_error";
};

const TEXT_PREVIEW_LENGTH = 500;

export const TextEditorCodeExecutionToolResultRenderer = memo(
  function TextEditorCodeExecutionToolResultRenderer({
    toolUseId,
    content,
  }: Props) {
    const { t } = useTranslation();
    const errorMessages: Record<string, string> = {
      ...getCommonToolErrorMessages(t),
      file_not_found: t("toolError.fileNotFound"),
      permission_denied: t("toolError.permissionDenied"),
    };

    if (isTextEditorError(content)) {
      return (
        <ToolResultCard
          title={t("textEditorCodeExecutionToolResultRenderer.error")}
          icon={<AlertCircle className={cn(layout.iconSize, "text-destructive")} />}
          variant="error"
          toolUseId={toolUseId}
        >
          <div className={cn(layout.bodyText, "text-destructive")}>
            {errorMessages[content.error_code] || content.error_code}
          </div>
        </ToolResultCard>
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
          return t("textEditorCodeExecutionToolResultRenderer.view");
        case "create":
          return t("textEditorCodeExecutionToolResultRenderer.create");
        case "delete":
          return t("textEditorCodeExecutionToolResultRenderer.delete");
        case "edit":
        default:
          return t("textEditorCodeExecutionToolResultRenderer.edit");
      }
    };

    const truncateContent = (text: string): string => {
      return text.length > TEXT_PREVIEW_LENGTH
        ? text.substring(0, TEXT_PREVIEW_LENGTH) + "..."
        : text;
    };

    return (
      <ToolResultCard
        title={getOperationLabel()}
        icon={
          <span className={cn("flex items-center", layout.iconGap)}>
            {getOperationIcon()}
            {success !== false ? (
              <CheckCircle className={cn(layout.iconSizeSmall, "text-success")} />
            ) : (
              <AlertCircle className={cn(layout.iconSizeSmall, warningStyles.icon)} />
            )}
          </span>
        }
        variant="warning"
        toolUseId={toolUseId}
      >
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
                {t("textEditorCodeExecutionToolResultRenderer.showContent")}
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
      </ToolResultCard>
    );
  }
);
