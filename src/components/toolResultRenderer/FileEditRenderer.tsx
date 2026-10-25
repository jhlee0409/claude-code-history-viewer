/**
 * FileEditRenderer (plan §4.3 "펼친 Edit", TR2a; acceptance D4): one meta
 * line, then the diff — nothing between them.
 *
 * The meta line: the relative path (only where no row above already names
 * the file), the operation kind (Replace / Replace all / n edits), the
 * user-modified flag when the record says so, and the `…` menu: comparison
 * mode (Unified = DiffView; the older advanced compare and side-by-side
 * viewers, unchanged until TR2b), the copies (changed result, file after
 * change, original file — each when it can be told), Open in Recent edits.
 *
 * Kept from the props it took at 12e952c0 (TR2a base): `filePath`,
 * `oldString` / `newString`, `replaceAll`, `userModified`, `originalFile`
 * (copies, the file's own line numbers, and the original content after the
 * diff) and `searchQuery` (still opens that original content on a hit).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileContent } from "../FileContent";
import { PathText } from "@/lib/format/PathText";
import { formatPath } from "@/lib/format/path";
import { useToolPathContext } from "../transcript/pathContext";
import { DiffActionsMenu, DiffComparisonBody, type ComparisonMode, type CopyAction } from "../transcript/DiffViewComparison";
import type { DiffSection } from "../transcript/DiffView";
import { editStartLines, fileAfterEdits, type EditReplacement } from "../transcript/DiffViewModel";
import { openFileInEdits } from "../transcript/openFileInEdits";
import { placeNameKey } from "@/navigation/placeNames";

type Props = {
  toolResult: Record<string, unknown>;
  searchQuery?: string;
  /** The replacements to show (a MultiEdit's edits); default: the result's own old → new pair. */
  edits?: EditReplacement[];
  /** `multiEdit`: the meta line counts the edits instead of naming the replace kind. */
  kind?: "edit" | "multiEdit";
  /** `false` where a row above already names the file (the Edit ToolRow). */
  showPath?: boolean;
  /** Capture-registry key for the diff's disclosures. */
  expandKey?: string;
  /** `false`: the original file's whole text is not shown after the diff (it still numbers the lines and feeds the copies). */
  showOriginalContent?: boolean;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

function Separator() {
  return <span aria-hidden="true"> · </span>;
}

export const FileEditRenderer = ({ toolResult, searchQuery, edits, kind = "edit", showPath = true, expandKey, showOriginalContent = true }: Props) => {
  const { t } = useTranslation();
  const pathCtx = useToolPathContext();
  const [mode, setMode] = useState<ComparisonMode>("unified");

  const filePath = text(toolResult.filePath);
  const oldString = text(toolResult.oldString);
  const newString = text(toolResult.newString);
  const originalFile = text(toolResult.originalFile);
  const replaceAll = toolResult.replaceAll === true;
  const userModified = toolResult.userModified === true;

  const replacements: EditReplacement[] = edits ?? [{ oldString, newString, replaceAll }];
  const starts = editStartLines(originalFile, replacements);
  const sections: DiffSection[] = replacements.flatMap((edit, index) =>
    edit.oldString === "" && edit.newString === ""
      ? []
      : [{ oldText: edit.oldString, newText: edit.newString, oldStart: starts[index], newStart: starts[index] }],
  );

  const operation =
    kind === "multiEdit"
      ? t("fileEditRenderer.operationEdits", { count: replacements.length })
      : replaceAll
        ? t("fileEditRenderer.operationReplaceAll")
        : t("fileEditRenderer.operationReplace");

  const fileAfterChange = fileAfterEdits(originalFile, replacements);
  const copies: CopyAction[] = [
    ...(kind === "edit" && newString ? [{ label: t("fileEditRenderer.copyChangedResult"), text: newString }] : []),
    ...(fileAfterChange ? [{ label: t("fileEditRenderer.copyFileAfterChange"), text: fileAfterChange }] : []),
    ...(originalFile ? [{ label: t("fileEditRenderer.copyOriginalFile"), text: originalFile }] : []),
  ];
  const shownPath = filePath ? formatPath(filePath, pathCtx) : null;

  return (
    <div data-file-edit="">
      <div data-edit-meta="" className="flex min-h-row-list min-w-0 flex-wrap items-center gap-x-2 text-caption text-fg-3">
        {showPath && filePath && (
          <>
            <PathText path={filePath} ctx={pathCtx} className="text-code text-fg-2" />
            <Separator />
          </>
        )}
        <span>{operation}</span>
        {userModified && (
          <>
            <Separator />
            <span>{t("fileEditRenderer.modifiedByUser")}</span>
          </>
        )}
        <DiffActionsMenu
          mode={mode}
          onModeChange={setMode}
          copies={copies}
          openIn={filePath ? { label: t("diffView.openIn", { place: t(placeNameKey("edits")) }), onSelect: () => openFileInEdits(filePath, t) } : undefined}
        />
      </div>
      {sections.length > 0 && (
        <DiffComparisonBody
          mode={mode}
          sections={sections}
          filePath={filePath}
          expandKey={expandKey ?? `file-edit:${filePath}`}
          label={shownPath ? `${shownPath.dir}${shownPath.name}` : undefined}
        />
      )}
      {originalFile && showOriginalContent && (
        <div className="mt-2">
          <FileContent
            title={t("fileEditRenderer.originalFileContent")}
            fileData={{
              content: originalFile,
              filePath: filePath,
              numLines: originalFile.split("\n").length,
              startLine: 1,
              totalLines: originalFile.split("\n").length,
            }}
            searchQuery={searchQuery}
          />
        </div>
      )}
    </div>
  );
};
