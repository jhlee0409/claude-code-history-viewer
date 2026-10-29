import { SquareTerminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RecordedResult } from "./RecordedResult";
import { OutputBlock } from "./OutputBlock";
import { legacyExecutionView } from "./toolOutcome";
import { useResultProvider } from "./resultProvider";

export function LegacyExecutionResult({ record, searchQuery, isCurrentMatch, currentMatchIndex }: {
  record: Record<string, unknown>; searchQuery?: string; isCurrentMatch?: boolean; currentMatchIndex?: number;
}) {
  const { t } = useTranslation();
  const provider = useResultProvider();
  const view = legacyExecutionView(record, provider);
  const highlight = { isCurrentMatch, currentMatchIndex };
  return (
    <RecordedResult title={t("toolResult.toolExecutionResult")} icon={<SquareTerminal className="w-4 h-4" />} record={record} family="process" expandKey="legacy-execution" searchQuery={searchQuery}>
      {(view.stdout !== "" || view.stderr !== "") && <OutputBlock text={view.stdout} errorText={view.stderr || undefined} source="command" failed={view.outcome.verdict === "failed"} expandKey="legacy-execution-output" searchQuery={searchQuery} highlight={highlight} />}
      {Object.keys(view.remainder).length > 0 && <OutputBlock text={JSON.stringify(view.remainder, null, 2)} source="text" expandKey="legacy-execution-recorded" searchQuery={searchQuery} highlight={highlight} />}
    </RecordedResult>
  );
}
