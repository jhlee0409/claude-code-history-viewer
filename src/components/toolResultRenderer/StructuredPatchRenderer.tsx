import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileContent } from "../FileContent";
import { RecordedResult } from "@/components/transcript/RecordedResult";
import { DiffActionsMenu, DiffComparisonBody, type ComparisonMode } from "../transcript/DiffViewComparison";
import { patchAfterText, structuredSections } from "../transcript/patchDiff";
import { PathText } from "@/lib/format/PathText";
import { useToolPathContext } from "../transcript/pathContext";
import { OtherRecordedFields } from "../contentRenderer/unifiedCards/toolBodyParts";

export const StructuredPatchRenderer = ({ toolResult }: { toolResult: Record<string, unknown> }) => {
  const { t } = useTranslation();
  const pathCtx = useToolPathContext();
  const [mode, setMode] = useState<ComparisonMode>("unified");
  const filePath = typeof toolResult.filePath === "string" ? toolResult.filePath : "";
  const content = typeof toolResult.content === "string" ? toolResult.content : "";
  const sections = structuredSections(toolResult.structuredPatch);
  // The original patch record remains available, including metadata and unsupported
  // rows; the reconstructed sides are fragments, never claimed as whole files.
  const recorded = Object.fromEntries(Object.entries(toolResult).filter(([key]) => !(key === "filePath" && filePath) && !(key === "content" && content)));
  return <RecordedResult title={t("structuredPatch.fileChanges")} icon={<RefreshCw className="w-4 h-4" />} record={toolResult} expandKey="patch-result"
    target={filePath ? <PathText path={filePath} ctx={pathCtx} className="text-code text-fg" /> : undefined}>
    <div className="flex min-h-row-list flex-wrap items-center justify-between gap-2 text-caption text-fg-3">
      <span>{t("structuredPatch.areasChanged", { count: sections.length })}</span>
      {sections.length > 0 && <DiffActionsMenu mode={mode} onModeChange={setMode} copies={[{ label: t("diffViewer.copyAfterCode"), text: patchAfterText(sections) }]} />}
    </div>
    {sections.length > 0 && <DiffComparisonBody mode={mode} sections={sections} filePath={filePath} expandKey="structured-patch" />}
    {content && <FileContent title={t("structuredPatch.updatedFileContent")} fileData={{ content, filePath, numLines: content.split("\n").length, startLine: 1, totalLines: content.split("\n").length }} />}
    <OtherRecordedFields rest={recorded} expandKey="structured-patch-record" />
  </RecordedResult>;
};
