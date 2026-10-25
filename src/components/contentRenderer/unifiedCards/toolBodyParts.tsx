/**
 * The pieces the Default path's routed bodies are built from (TR1a, D-R1;
 * the table and the routing are in `toolBodies.tsx`): the input as honest
 * JSON, the recorded values a structured body does not show (computed by
 * `recordShape.ts`), one summary line.
 */
import type { TFunction } from "i18next";
import type { PathContext } from "@/lib/format/path";
import { Marked, type TextHighlight } from "../../transcript/ToolRow";
import { OutputBlock } from "../../transcript/OutputBlock";

export interface BodyContext {
  input: Record<string, unknown>;
  expandKey: string;
  pathCtx: PathContext;
  t: TFunction;
  /** The in-session search query (a capped block opens for its hits). */
  searchQuery?: string;
  /** Set when the query hits the input: every text the body shows marks the hits. */
  highlight?: TextHighlight;
}

/**
 * The input as honest JSON: "Input (keys)", then the JSON, capped with
 * "Show all". `rest`: it holds what a structured body does not show.
 */
export function InputJson({ value, ctx, rest = false }: { value: Record<string, unknown>; ctx: BodyContext; rest?: boolean }) {
  const keys = Object.keys(value);
  return (
    <section data-input-json={rest ? "rest" : "whole"} className="space-y-1">
      <div className="text-caption text-fg-3">
        {ctx.t("common.input")} ({keys.join(", ")})
      </div>
      <OutputBlock
        text={JSON.stringify(value, null, 2)}
        source="file"
        expandKey={`${ctx.expandKey}-${rest ? "input-rest" : "input"}`}
        searchQuery={ctx.searchQuery}
        highlight={ctx.highlight ? { isCurrentMatch: ctx.highlight.isCurrentMatch, currentMatchIndex: ctx.highlight.currentMatchIndex } : undefined}
      />
    </section>
  );
}

/** The recorded values a structured body does not show, as JSON (nothing recorded is lost); nothing when it shows them all. */
export function Leftover({ ctx, rest }: { ctx: BodyContext; rest: Record<string, unknown> }) {
  return Object.keys(rest).length > 0 ? <InputJson value={rest} ctx={ctx} rest /> : null;
}

/** One summary line: the facts, separated by "·", search hits marked. */
export function Summary({ items, highlight }: { items: (string | null | undefined | false)[]; highlight?: TextHighlight }) {
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
          <Marked text={fact} highlight={highlight} />
        </span>
      ))}
    </p>
  );
}
