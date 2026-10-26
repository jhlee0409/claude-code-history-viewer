/**
 * TextEditorCodeExecutionToolResultRenderer - Renders text editor file operation results
 *
 * Displays file operations (view, create, edit, delete) with appropriate styling.
 * Supports both successful operations and error conditions with file content preview.
 */

import { memo, useContext, useEffect, useId } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { TextEditorResult, TextEditorError } from "../../types";
import { layout } from "../renderers";
import { useCaptureExpandState } from "@/contexts/CaptureExpandContext";
import { ResultRow } from "../transcript/ResultRow";
import { ResultRowContext } from "../transcript/resultRowContext";
import { Marked } from "../transcript/ToolRow";
import { getCommonToolErrorMessages } from "./toolResultErrorMessages";
import { searchHits } from "./unifiedCards/shared";
import { oneLineValueClass } from "./oneLineValue";

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
    const [showContent, setShowContent] = useCaptureExpandState(`text-editor-${toolUseId}`, false);
    const { highlight } = useContext(ResultRowContext);
    const contentId = useId();
    // A counted search hit in the file content opens the content fold once per
    // query (keyed on the query, as ToolRow's reveal), so the mark is seen.
    const fileText = isTextEditorError(content) ? undefined : content.content;
    const contentHitQuery = highlight && searchHits(highlight.searchQuery, fileText) ? highlight.searchQuery : undefined;
    useEffect(() => {
      if (contentHitQuery !== undefined && contentHitQuery.trim() !== "") setShowContent(true);
    }, [contentHitQuery, setShowContent]);
    const result = { type: "text_editor_code_execution_tool_result", tool_use_id: toolUseId, content };
    const errorMessages: Record<string, string> = {
      ...getCommonToolErrorMessages(t),
      file_not_found: t("toolError.fileNotFound"),
      permission_denied: t("toolError.permissionDenied"),
    };

    if (isTextEditorError(content)) {
      return (
        <ResultRow verb="text_editor_code_execution" result={result} toolUseId={toolUseId}>
          {errorMessages[content.error_code] && <div className={cn(layout.bodyText, "text-fg-2")}>{errorMessages[content.error_code]}</div>}
        </ResultRow>
      );
    }

    const { operation, path, content: fileContent, success } = content;

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
      <ResultRow
        verb="text_editor_code_execution"
        result={result}
        toolUseId={toolUseId}
        meta={success === false ? `${getOperationLabel()} · success: false` : getOperationLabel()}
      >
          {/* File path */}
          {path && (
            <div className={cn(layout.monoText, "mb-2 text-fg-2", oneLineValueClass(path, highlight))}>
              <Marked text={path} highlight={highlight} />
            </div>
          )}

          {/* File content preview */}
          {fileContent && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowContent(prev => !prev)}
                aria-expanded={showContent}
                aria-controls={contentId}
                className={cn(layout.smallText, "flex items-center gap-1 cursor-pointer hover:opacity-80 text-fg-3")}
              >
                <ChevronRight className={cn("w-3.5 h-3.5 transition-transform", showContent && "rotate-90")} />
                {t("textEditorCodeExecutionToolResultRenderer.showContent")}
              </button>
              <div id={contentId} hidden={!showContent}>
                {showContent && (
                  <pre className={cn("mt-2 p-2 overflow-x-auto whitespace-pre-wrap bg-surface-well text-fg", layout.monoText, layout.rounded, layout.codeMaxHeight)}>
                    {/* A content hit opened the fold: the whole file, so a hit past the preview is shown and marked (CodeRabbit 4378494005). */}
                    <Marked text={contentHitQuery !== undefined ? fileContent : truncateContent(fileContent)} highlight={highlight} />
                  </pre>
                )}
              </div>
            </div>
          )}
      </ResultRow>
    );
  }
);
