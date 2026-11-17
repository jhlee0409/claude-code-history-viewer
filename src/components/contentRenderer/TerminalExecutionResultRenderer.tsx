import { memo, useContext } from "react";
import { cn } from "@/lib/utils";
import { layout } from "../renderers";
import { OutputBlock } from "../transcript/OutputBlock";
import { ResultRow } from "../transcript/ResultRow";
import { ResultRowContext } from "../transcript/resultRowContext";

interface ExecutionResultLike {
  stdout?: string;
  stderr?: string;
  return_code?: number;
}

interface ExecutionErrorLike {
  error_code: string;
}

type Content = ExecutionResultLike | ExecutionErrorLike;

const isExecutionError = (content: Content): content is ExecutionErrorLike => content !== null && typeof content === "object" && "error_code" in content;

interface Props {
  toolUseId: string;
  content: Content;
  /** The recorded tool name the result answers (`code_execution`, `bash_code_execution`). */
  verb: string;
  /** The result block's type, for the outcome adapter. */
  resultType: string;
  noOutputLabel: string;
  errorMessages: Record<string, string>;
}

/**
 * A code / bash execution result (TR1b, amendment 17): its head is its call's
 * ToolRow (or `ResultRow` alone), whose outcome comes from `toolOutcome` —
 * the recorded `return_code` decides (exit 0 succeeded, else "Failed · exit
 * code N"), an `error_code` reads "Failed · <code>". The body is a plain
 * output: one OutputBlock with the stdout and stderr zones (stderr in the
 * danger style only when the verdict is failed), search hits marked. No
 * success glyph, no exit-code pill: the code is stated by the row.
 */
export const TerminalExecutionResultRenderer = memo(function TerminalExecutionResultRenderer({ toolUseId, content, verb, resultType, noOutputLabel, errorMessages }: Props) {
  const { highlight } = useContext(ResultRowContext);
  const result = { type: resultType, tool_use_id: toolUseId, content };

  if (isExecutionError(content)) {
    const explanation = errorMessages[content.error_code];
    return (
      <ResultRow verb={verb} family="process" result={result} toolUseId={toolUseId}>
        {explanation && <div className={cn(layout.bodyText, "text-fg-2")}>{explanation}</div>}
      </ResultRow>
    );
  }

  const stdout = typeof content?.stdout === "string" ? content.stdout : "";
  const stderr = typeof content?.stderr === "string" ? content.stderr : "";
  const failed = typeof content?.return_code === "number" && content.return_code !== 0;

  return (
    <ResultRow verb={verb} family="process" result={result} toolUseId={toolUseId}>
      {stdout || stderr ? (
        <OutputBlock
          text={stdout}
          errorText={stderr || undefined}
          source="command"
          failed={failed}
          expandKey={`exec-${toolUseId}`}
          searchQuery={highlight?.searchQuery}
          highlight={highlight ? { isCurrentMatch: highlight.isCurrentMatch, currentMatchIndex: highlight.currentMatchIndex } : undefined}
        />
      ) : (
        <div className={cn(layout.smallText, "text-muted-foreground italic")}>{noOutputLabel}</div>
      )}
    </ResultRow>
  );
});
