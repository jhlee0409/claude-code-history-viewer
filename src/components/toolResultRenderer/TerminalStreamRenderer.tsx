import { SquareTerminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RecordedResult } from "../transcript/RecordedResult";
import { OutputBlock } from "../transcript/OutputBlock";
import { toolOutcome } from "../transcript/toolOutcome";
import { useResultProvider } from "../transcript/resultProvider";
import { useFormat } from "@/lib/format/useFormat";
import { Num } from "@/lib/format/Num";

type Props = {
  command: string; stream: string; output: string; timestamp: string; exitCode: number;
  searchQuery?: string; isCurrentMatch?: boolean; currentMatchIndex?: number;
};

export const TerminalStreamRenderer = ({ command, stream, output, timestamp, exitCode, searchQuery, isCurrentMatch, currentMatchIndex }: Props) => {
  const { t } = useTranslation();
  const fmt = useFormat();
  const provider = useResultProvider();
  const record = { command, stream, output, timestamp, exitCode };
  const outcome = toolOutcome(null, [{ content: record }], "process", provider);
  return (
    <RecordedResult title={t("terminalStreamRenderer.title")} icon={<SquareTerminal className="w-4 h-4" />} record={record} family="process" expandKey="terminal-stream-result" searchQuery={searchQuery} meta={<>{command && <code className="break-words">{command}</code>}{timestamp && <Num>{fmt.time(String(timestamp))}</Num>}{stream && <span>{String(stream)}</span>}</>}>
      <OutputBlock text={stream === "stderr" ? "" : String(output ?? "")} errorText={stream === "stderr" ? String(output ?? "") : undefined} source="command" failed={outcome.verdict === "failed"} expandKey="terminal-stream-output" searchQuery={searchQuery} highlight={{ isCurrentMatch, currentMatchIndex }} />
    </RecordedResult>
  );
};
