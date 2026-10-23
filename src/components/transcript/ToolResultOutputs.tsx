/**
 * The opened detail's results. A result's recorded content is never lost or
 * reordered (PR #728 reviews F1, R2-F1, R2-F2).
 *
 * Each result renders its content as ordered parts (`resultContent`), in
 * recorded order: a contiguous text run → one OutputBlock, a contiguous
 * non-text run (image, document, search_result, unknown blocks, objects) →
 * the existing result renderers, in place.
 *
 * Stream fields (stdout / stderr, as `normalizeResult` reads them) are extra
 * evidence: with stream text, one OutputBlock shows the stdout / stderr zones
 * first, and the content's text runs are that same output and are not
 * repeated; the non-text parts follow in their order. A content object is a
 * part unless it is exactly the stream record those zones show; a
 * stream-shaped object they did not fully show goes to the generic fallback
 * (every key, as recorded).
 *
 * "No output" only when there are no parts and no stream text; a result with
 * neither content nor streams keeps the old result router. Recorded outcome
 * facts (exit code, interrupted, error code, "not verified") are not shown
 * here: the ToolRow's opened detail owns them, once.
 */
import { ResultBlock } from "../contentRenderer/unifiedCards/ResultBlock";
import { FallbackRenderer } from "../toolResultRenderer/FallbackRenderer";
import { RendererDefaultsContext } from "@/shared/rendererDefaults";
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

/** The generic fallback, opened like ResultBlock's renderers: every key, as recorded. */
function GenericResult({ value }: { value: Record<string, unknown> }) {
  return (
    <RendererDefaultsContext.Provider value={NESTED_OPEN}>
      <div className="mt-2">
        <FallbackRenderer toolResult={value} />
      </div>
    </RendererDefaultsContext.Provider>
  );
}

const NESTED_OPEN = { defaultExpanded: true };

function ResultOutput({ result, family, source, blockKey }: { result: ToolResultLike; family: ToolFamily; source?: OutputSource; blockKey: string }) {
  const options = { bareCodeIsExitCode: family === "process" };
  const n = normalizeResult(result, options);
  const content = resultContent(result, options);
  const hasStreams = n.stdout !== undefined || n.stderr !== undefined;
  const streamText = (n.stdout ?? "") !== "" || (n.stderr ?? "") !== "";

  if (!hasStreams && !content.recorded) return <ResultBlock results={[result]} />;

  // With stream text, the content's text runs are that output (shown once).
  const parts = streamText ? content.parts.filter((part) => part.kind !== "text") : content.parts;
  // The first output keeps the result's own show-all key; later runs get their own.
  const firstText = parts.findIndex((part) => part.kind === "text");
  return (
    <>
      {streamText && <OutputBlock expandKey={blockKey} text={n.stdout} errorText={n.stderr} source={source} />}
      {parts.map((part, index) =>
        part.kind === "text" ? (
          <OutputBlock key={index} expandKey={index === firstText ? blockKey : `${blockKey}-part-${index}`} text={part.text} source={source} />
        ) : part.generic && !Array.isArray(part.value) ? (
          <GenericResult key={index} value={part.value} />
        ) : (
          <ResultBlock key={index} results={[{ content: part.value }]} />
        ),
      )}
      {!streamText && parts.length === 0 && <OutputBlock expandKey={blockKey} text="" source={source} />}
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
