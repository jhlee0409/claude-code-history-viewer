/**
 * The pieces the Default path's routed bodies are built from (TR1a, D-R1;
 * the table and the routing are in `toolBodies.tsx`): the input as honest
 * JSON, the input keys a structured body does not show, one summary line.
 */
import type { TFunction } from "i18next";
import type { PathContext } from "@/lib/format/path";
import type { TextHighlight } from "../../transcript/ToolRow";
import { OutputBlock } from "../../transcript/OutputBlock";

export interface BodyContext {
  input: Record<string, unknown>;
  expandKey: string;
  pathCtx: PathContext;
  t: TFunction;
  /** The in-session search query (the JSON block reveals and marks its hits). */
  searchQuery?: string;
  highlight?: TextHighlight;
}

/** The input as honest JSON: "Input (keys)", then the JSON, capped with "Show all". */
export function InputJson({ value, ctx, blockKey = "input" }: { value: Record<string, unknown>; ctx: BodyContext; blockKey?: string }) {
  const keys = Object.keys(value);
  return (
    <section className="space-y-1">
      <div className="text-caption text-fg-3">
        {ctx.t("common.input")} ({keys.join(", ")})
      </div>
      <OutputBlock
        text={JSON.stringify(value, null, 2)}
        source="file"
        expandKey={`${ctx.expandKey}-${blockKey}`}
        searchQuery={ctx.searchQuery}
        highlight={ctx.highlight ? { isCurrentMatch: ctx.highlight.isCurrentMatch, currentMatchIndex: ctx.highlight.currentMatchIndex } : undefined}
      />
    </section>
  );
}

/** The input keys a structured body does not show, as JSON (nothing recorded is lost). */
export function Leftover({ ctx, shown }: { ctx: BodyContext; shown: readonly string[] }) {
  const rest = Object.fromEntries(Object.entries(ctx.input).filter(([key]) => !shown.includes(key)));
  return Object.keys(rest).length > 0 ? <InputJson value={rest} ctx={ctx} blockKey="input-rest" /> : null;
}

/** One summary line: the facts, separated by "·". */
export function Summary({ items }: { items: (string | null | undefined | false)[] }) {
  const facts = items.filter((item): item is string => typeof item === "string" && item.length > 0);
  if (facts.length === 0) return null;
  return (
    <p data-tool-summary="" className="flex flex-wrap gap-x-2 text-list text-fg-2">
      {facts.map((fact, index) => (
        <span key={index}>
          {index > 0 && (
            <span aria-hidden="true" className="mr-2 text-fg-3">
              ·
            </span>
          )}
          {fact}
        </span>
      ))}
    </p>
  );
}

