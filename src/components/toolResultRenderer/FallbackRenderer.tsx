import { Braces } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RecordedResult } from "../transcript/RecordedResult";
import { OutputBlock } from "../transcript/OutputBlock";
import { useResultSearch } from "../transcript/resultProvider";

type Props = { toolResult: Record<string, unknown>; searchQuery?: string; isCurrentMatch?: boolean; currentMatchIndex?: number };

/** Unknown records retain every key, value and array position; the cap has show-all. */
export const FallbackRenderer = ({ toolResult, searchQuery, isCurrentMatch, currentMatchIndex }: Props) => {
  const { t } = useTranslation();
  const inherited = useResultSearch();
  const query = searchQuery ?? inherited.searchQuery;
  const highlight = { isCurrentMatch: isCurrentMatch ?? inherited.isCurrentMatch, currentMatchIndex: currentMatchIndex ?? inherited.currentMatchIndex };
  return (
    <RecordedResult title={t("toolResult.toolExecutionResult")} icon={<Braces className="w-4 h-4" />} record={toolResult} expandKey="fallback-result" searchQuery={query}>
      <OutputBlock text={JSON.stringify(toolResult, null, 2)} source="text" expandKey="fallback-json" searchQuery={query} highlight={highlight} />
    </RecordedResult>
  );
};
