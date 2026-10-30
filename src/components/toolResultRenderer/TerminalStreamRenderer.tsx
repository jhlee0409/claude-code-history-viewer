import { SquareTerminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RecordedResult } from "../transcript/RecordedResult";
import { OutputBlock } from "../transcript/OutputBlock";
import { legacyExecutionView } from "../transcript/toolOutcome";
import { ToolResultOutputs } from "../transcript/ToolResultOutputs";
import { useResultProvider } from "../transcript/resultProvider";
import { useFormat } from "@/lib/format/useFormat";
import { Num } from "@/lib/format/Num";

type Props = {
  record: Record<string, unknown>;
  searchQuery?: string; isCurrentMatch?: boolean; currentMatchIndex?: number;
};

export const TerminalStreamRenderer = ({ record, searchQuery, isCurrentMatch, currentMatchIndex }: Props) => {
  const { t } = useTranslation();
  const fmt = useFormat();
  const provider = useResultProvider();
  const { command, stream, output, timestamp, content } = record;
  const { outcome, stdout, stderr, remainder } = legacyExecutionView(record, provider);
  const shownString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
  const rest = Object.fromEntries(Object.entries(remainder).filter(([key, value]) => {
    if (key === "type" && value === "terminal_stream") return false;
    if (["command", "stream", "output"].includes(key) && shownString(value)) return false;
    if (key === "content" && value !== null && value !== undefined) return false;
    // Formatted time is not a faithful rendering of the original timestamp.
    return true;
  }));
  const highlight = { isCurrentMatch, currentMatchIndex };
  return (
    <RecordedResult title={t("terminalStreamRenderer.title")} icon={<SquareTerminal className="w-4 h-4" />} record={record} family="process" expandKey="terminal-stream-result" searchQuery={searchQuery} meta={<>{!!command && <code className="break-words">{String(command)}</code>}{!!timestamp && <Num>{fmt.time(String(timestamp))}</Num>}{!!stream && <span>{String(stream)}</span>}</>}>
      <OutputBlock text={stream === "stderr" ? "" : typeof output === "string" ? output : ""} errorText={stream === "stderr" && typeof output === "string" ? output : undefined} source="command" failed={outcome.verdict === "failed"} expandKey="terminal-stream-output" searchQuery={searchQuery} highlight={{ isCurrentMatch, currentMatchIndex }} />
      {(stdout !== "" || stderr !== "") && <OutputBlock text={stdout} errorText={stderr} source="command" failed={outcome.verdict === "failed"} expandKey="terminal-stream-extra" searchQuery={searchQuery} highlight={highlight} />}
      {content != null && <ToolResultOutputs results={[{ content }]} family="process" expandKey="terminal-content" searchQuery={searchQuery} highlight={highlight} outcomeShown={false} />}
      {Object.keys(rest).length > 0 && <OutputBlock json text={JSON.stringify(rest, null, 2)} source="file" expandKey="terminal-recorded" searchQuery={searchQuery} highlight={highlight} />}
    </RecordedResult>
  );
};
