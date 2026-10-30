import { memo, useContext, useEffect, useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCaptureExpandState } from "@/contexts/CaptureExpandContext";
import { OutputBlock } from "../transcript/OutputBlock";
import { ResultRow } from "../transcript/ResultRow";
import { ResultRowContext } from "../transcript/resultRowContext";
import { Marked } from "../transcript/ToolRow";
import { DiffActionsMenu, DiffComparisonBody, type ComparisonMode } from "../transcript/DiffViewComparison";
import { patchSection } from "../transcript/patchDiff";
import { getCommonToolErrorMessages } from "./toolResultErrorMessages";
import { searchHits } from "./unifiedCards/shared";
import { safeStringify } from "@/utils/jsonUtils";

/** GROUNDED_SPEC: discriminate create/view/str_replace/error, not operation/path/success.
 * https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L7085-L7192
 * Unknown/legacy fields stay recorded JSON; no path or full-file text is invented. */
export const TextEditorCodeExecutionToolResultRenderer = memo(function TextEditorCodeExecutionToolResultRenderer({ toolUseId, content }: { toolUseId: string; content: unknown }) {
  const { t } = useTranslation();
  const { highlight } = useContext(ResultRowContext);
  const [showContent, setShowContent] = useCaptureExpandState(`text-editor-${toolUseId}`, false);
  const [mode, setMode] = useState<ComparisonMode>("unified");
  const contentId = useId();
  const c = content != null && typeof content === "object" && !Array.isArray(content) ? content as Record<string, unknown> : {};
  const fileText = typeof c.content === "string" ? c.content : undefined;
  const hitQuery = highlight && searchHits(highlight.searchQuery, fileText) ? highlight.searchQuery : undefined;
  useEffect(() => { if (hitQuery != null && hitQuery.trim() !== "") setShowContent(true); }, [hitQuery, setShowContent]);
  const result = { type: "text_editor_code_execution_tool_result", tool_use_id: toolUseId, content };
  const error = c.type === "text_editor_code_execution_tool_result_error";
  const view = c.type === "text_editor_code_execution_view_result";
  const create = c.type === "text_editor_code_execution_create_result";
  const replace = c.type === "text_editor_code_execution_str_replace_result";
  const label = view ? t("textEditorCodeExecutionToolResultRenderer.view") : create ? t("textEditorCodeExecutionToolResultRenderer.create") : replace ? "str_replace" : undefined;
  // Draw only compatible unified-hunk syntax. The SDK supplies nullable coordinates:
  // null/absent stays blank; never invoke patchSection's default start of 1.
  const lines = Array.isArray(c.lines) && c.lines.every((line): line is string => typeof line === "string" && /^[ +-]/.test(line)) ? c.lines : null;
  const compatible = replace && lines != null && (c.old_lines == null || c.old_lines === lines.filter(line => !line.startsWith("+")).length) && (c.new_lines == null || c.new_lines === lines.filter(line => !line.startsWith("-")).length);
  const coordinate = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const sections = compatible ? [patchSection(lines, coordinate(c.old_start), coordinate(c.new_start))] : [];
  const rest = Object.fromEntries(Object.entries(c).filter(([key]) => !(key === "content" && fileText != null)));
  const errors = getCommonToolErrorMessages(t);
  return <ResultRow verb="text_editor_code_execution" result={result} toolUseId={toolUseId} meta={label}>
    {error && typeof c.error_code === "string" && errors[c.error_code] && <div className="text-body text-fg-2">{errors[c.error_code]}</div>}
    {error && typeof c.error_message === "string" && <div className="text-body text-fg-2"><Marked text={c.error_message} highlight={highlight} /></div>}
    {sections.length > 0 && <>
      <DiffActionsMenu mode={mode} onModeChange={setMode} copies={[{ label: t("common.copy"), text: lines!.join("\n") }]} />
      <DiffComparisonBody mode={mode} sections={sections} filePath="" expandKey={`editor-diff-${toolUseId}`} highlight={highlight} />
    </>}
    {fileText != null && <div className="mt-2">
      <Button variant="ghost" size="sm" type="button" onClick={() => setShowContent(prev => !prev)} aria-expanded={showContent} aria-controls={contentId} className="h-auto whitespace-normal justify-start font-normal text-caption text-fg-3">
        <ChevronRight className={cn("w-3.5 h-3.5 transition-transform", showContent && "rotate-90")} />{t("textEditorCodeExecutionToolResultRenderer.showContent")}
      </Button>
      <div id={contentId} hidden={!showContent}>{showContent && <OutputBlock text={fileText} source="file" expandKey={`text-editor-content-${toolUseId}`} searchQuery={highlight?.searchQuery} highlight={highlight} />}</div>
    </div>}
    {/* Nullable metadata and unsupported rows remain available verbatim. */}
    <OutputBlock text={safeStringify(Object.keys(c).length > 0 ? rest : content, 2)} source="text" json expandKey={`editor-record-${toolUseId}`} searchQuery={highlight?.searchQuery} highlight={highlight} />
  </ResultRow>;
});
