/**
 * The opened detail's results, as OutputBlocks.
 *
 * Each result goes through `normalizeResult`: recorded stdout/stderr (the
 * result's own metadata or its content object) become an OutputBlock with a
 * stderr zone and the recorded exit code; a plain string result becomes an
 * OutputBlock of that text. Anything else (content arrays, images, documents,
 * other objects) keeps the existing result router, so no content type loses
 * its renderer.
 */
import { ResultBlock } from "../contentRenderer/unifiedCards/ResultBlock";
import { OutputBlock, type OutputSource } from "./OutputBlock";
import { normalizeResult, type ToolFamily, type ToolResultLike } from "./toolOutcome";

interface ToolResultOutputsProps {
  results: ToolResultLike[];
  family: ToolFamily;
  /** Which output labels apply (OutputBlock `source`). */
  source?: OutputSource;
  /** Prefix for each block's show-all state. */
  expandKey: string;
}

export function ToolResultOutputs({ results, family, source, expandKey }: ToolResultOutputsProps) {
  return (
    <>
      {results.map((result, index) => {
        const key = `${expandKey}-result-${index}`;
        const n = normalizeResult(result, { bareCodeIsExitCode: family === "process" });
        const structured = n.stdout !== undefined || n.stderr !== undefined;
        const structuredText = (n.stdout ?? "") !== "" || (n.stderr ?? "") !== "";
        if (structured && (structuredText || !n.text)) {
          return (
            <OutputBlock key={key} expandKey={key} text={n.stdout} errorText={n.stderr} recordedExitCode={n.exitCode} source={source} />
          );
        }
        if (n.text !== undefined) {
          return <OutputBlock key={key} expandKey={key} text={n.text} recordedExitCode={n.exitCode} source={source} />;
        }
        return <ResultBlock key={key} results={[result]} />;
      })}
    </>
  );
}
