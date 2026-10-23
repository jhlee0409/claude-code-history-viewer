/**
 * The opened detail's results. A result's recorded content is never lost or
 * reordered (PR #728 reviews F1, R2-F1, R2-F2, R3-F1).
 *
 * Each result renders its content as ordered parts (`resultContent`), in
 * recorded order: a contiguous text run → one OutputBlock, a contiguous
 * non-text run (image, document, search_result, unknown blocks, objects) →
 * the existing result renderers, in place.
 *
 * Stream fields (stdout / stderr, as `normalizeResult` reads them) are extra
 * evidence: with stream text, one OutputBlock shows the stdout / stderr zones
 * first, then every part in recorded order. A text run is left out only when
 * it is identical to what those zones show (`shownByStreams`); any other run
 * — an interruption sentence, a note the tool appended — stays. A content
 * object is a part unless it is exactly the stream record the zones show; a
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
import { normalizeResult, resultContent, type ContentPart, type ToolFamily, type ToolResultLike } from "./toolOutcome";

interface ToolResultOutputsProps {
  results: ToolResultLike[];
  family: ToolFamily;
  /** Which output labels apply (OutputBlock `source`). */
  source?: OutputSource;
  /** Prefix for each block's show-all state. */
  expandKey: string;
  /** `false`: each output line stays one line and the well scrolls sideways (OutputBlock `wrap`). */
  wrap?: boolean;
  /** The row's verdict is `failed` (OutputBlock `failed`: danger-styled stderr). */
  failed?: boolean;
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

const trimTrailingNewlines = (text: string) => text.replace(/\n+$/, "");

/**
 * The texts the stream zones show, in every form a result's content records
 * them: stdout, stderr, and their combination as Claude writes it (stdout +
 * stderr — real history, where stderr carries its own leading newline — or
 * joined by a newline), each compared without trailing newlines. An empty
 * run adds nothing beside stream text, so it counts as shown.
 */
function shownByStreams(stdout: string, stderr: string): (part: ContentPart) => boolean {
  const forms = new Set(["", stdout, stderr, stdout + stderr, `${stdout}\n${stderr}`].map(trimTrailingNewlines));
  return (part) => part.kind === "text" && forms.has(trimTrailingNewlines(part.text));
}

function ResultOutput({ result, family, source, blockKey, wrap, failed }: { result: ToolResultLike; family: ToolFamily; source?: OutputSource; blockKey: string; wrap?: boolean; failed?: boolean }) {
  const options = { bareCodeIsExitCode: family === "process" };
  const n = normalizeResult(result, options);
  const content = resultContent(result, options);
  const hasStreams = n.stdout !== undefined || n.stderr !== undefined;
  const stdout = n.stdout ?? "";
  const stderr = n.stderr ?? "";
  const streamText = stdout !== "" || stderr !== "";

  if (!hasStreams && !content.recorded) return <ResultBlock results={[result]} />;

  const shown = streamText ? shownByStreams(stdout, stderr) : null;
  const parts = shown ? content.parts.filter((part) => !shown(part)) : content.parts;
  // One show-all key per block: the first output block keeps the result's own key.
  const firstText = streamText ? -1 : parts.findIndex((part) => part.kind === "text");
  return (
    <>
      {streamText && <OutputBlock expandKey={blockKey} text={n.stdout} errorText={n.stderr} source={source} wrap={wrap} failed={failed} />}
      {parts.map((part, index) =>
        part.kind === "text" ? (
          <OutputBlock key={index} expandKey={index === firstText ? blockKey : `${blockKey}-part-${index}`} text={part.text} source={source} wrap={wrap} />
        ) : part.generic && !Array.isArray(part.value) ? (
          <GenericResult key={index} value={part.value} />
        ) : (
          <ResultBlock key={index} results={[{ content: part.value }]} />
        ),
      )}
      {!streamText && parts.length === 0 && <OutputBlock expandKey={blockKey} text="" source={source} wrap={wrap} />}
    </>
  );
}

export function ToolResultOutputs({ results, family, source, expandKey, wrap, failed }: ToolResultOutputsProps) {
  return (
    <>
      {results.map((result, index) => {
        const key = `${expandKey}-result-${index}`;
        return <ResultOutput key={key} result={result} family={family} source={source} blockKey={key} wrap={wrap} failed={failed} />;
      })}
    </>
  );
}
