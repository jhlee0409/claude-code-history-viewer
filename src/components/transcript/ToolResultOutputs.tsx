/**
 * The opened detail's results. A result's recorded content is never lost.
 *
 * Stream fields (stdout / stderr, from the result's own metadata or its
 * content object, via `normalizeResult`) are extra evidence:
 *  - with stream text, an OutputBlock shows the stdout / stderr zones and the
 *    recorded exit code; the content's text is that same output and is not
 *    repeated;
 *  - without stream text (absent or `""`), the content's text is shown in an
 *    OutputBlock.
 * Either way the content's non-text parts (image, document, search_result,
 * unknown blocks, other objects) still go through the existing result
 * renderers below. "No output" only when nothing is recorded anywhere; a
 * result with neither content nor streams keeps the old result router.
 */
import { ResultBlock } from "../contentRenderer/unifiedCards/ResultBlock";
import { OutputBlock, type OutputSource } from "./OutputBlock";
import { normalizeResult, resultContent, type ToolFamily, type ToolResultLike } from "./toolOutcome";

interface ToolResultOutputsProps {
  results: ToolResultLike[];
  family: ToolFamily;
  /** Which output labels apply (OutputBlock `source`). */
  source?: OutputSource;
  /** Prefix for each block's show-all state. */
  expandKey: string;
}

function ResultOutput({ result, family, source, blockKey }: { result: ToolResultLike; family: ToolFamily; source?: OutputSource; blockKey: string }) {
  const n = normalizeResult(result, { bareCodeIsExitCode: family === "process" });
  const content = resultContent(result);
  const hasStreams = n.stdout !== undefined || n.stderr !== undefined;
  const streamText = (n.stdout ?? "") !== "" || (n.stderr ?? "") !== "";
  const text = content.text ?? "";
  const rest = content.rest === undefined ? null : <ResultBlock results={[{ content: content.rest }]} />;

  if (!hasStreams && !content.recorded) return <ResultBlock results={[result]} />;

  let output = null;
  if (streamText) {
    output = <OutputBlock expandKey={blockKey} text={n.stdout} errorText={n.stderr} recordedExitCode={n.exitCode} source={source} />;
  } else if (text !== "" || rest === null) {
    // The content's text, or "No output" when nothing at all is recorded.
    output = <OutputBlock expandKey={blockKey} text={text} recordedExitCode={n.exitCode} source={source} />;
  }
  return (
    <>
      {output}
      {rest}
    </>
  );
}

export function ToolResultOutputs({ results, family, source, expandKey }: ToolResultOutputsProps) {
  return (
    <>
      {results.map((result, index) => {
        const key = `${expandKey}-result-${index}`;
        return <ResultOutput key={key} result={result} family={family} source={source} blockKey={key} />;
      })}
    </>
  );
}
