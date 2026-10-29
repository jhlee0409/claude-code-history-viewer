/**
 * The pieces the Default path's routed bodies are built from (TR1a, D-R1;
 * the table and the routing are in `toolBodies.tsx`): the input as honest
 * JSON, the recorded values a structured body does not show (computed by
 * `recordShape.ts`), one summary line.
 */
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { PathContext } from "@/lib/format/path";
import { Marked, type TextHighlight } from "../../transcript/ToolRow";
import { OutputBlock } from "../../transcript/OutputBlock";
import { useToolPathContext } from "../../transcript/pathContext";
import { keysCaption } from "./recordShape";
import { searchHits } from "./shared";
import { resultSearchText } from "../../transcript/resultSearchText";
import { useResultSearch } from "../../transcript/resultProvider";

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
 * The input as honest JSON, capped with "Show all". Whole (the JSON
 * fallback), it sits in the Input zone, whose label line names its keys
 * ("Input (keys)", `keysCaption`). `rest`: it holds what a structured body
 * does not show, captioned "Other recorded fields (keys)" — a second
 * "Input" inside the Input zone would say it twice.
 */
export function InputJson({ value, ctx, rest = false }: { value: Record<string, unknown>; ctx: BodyContext; rest?: boolean }) {
  const keys = keysCaption(value);
  return (
    <section data-input-json={rest ? "rest" : "whole"} className="space-y-1">
      {rest && (
        <div className="break-words text-caption text-fg-3">
          {ctx.t("toolRow.otherRecordedFields")}
          {keys && ` ${keys}`}
        </div>
      )}
      <OutputBlock
        text={JSON.stringify(value, null, 2)}
        json
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

/**
 * A dedicated card's input values its head and Input zone do not show
 * (TR1b, amendment 9: what the deleted legacy renderers showed — Bash's
 * background flag, Grep's flags, WebSearch's domain lists, Agent's
 * `run_in_background: false` — stays visible), as the "Other recorded
 * fields" JSON; nothing when the card shows every value. A search hit in
 * them is marked.
 */
export function OtherRecordedFields({
  rest,
  expandKey,
  searchQuery,
  isCurrentMatch,
  currentMatchIndex,
}: {
  rest: Record<string, unknown>;
  expandKey: string;
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
}) {
  const { t } = useTranslation();
  const pathCtx = useToolPathContext();
  const inherited = useResultSearch();
  searchQuery = searchQuery ?? inherited.searchQuery;
  isCurrentMatch = isCurrentMatch ?? inherited.isCurrentMatch;
  currentMatchIndex = currentMatchIndex ?? inherited.currentMatchIndex;
  const hit = searchQuery !== undefined && searchQuery.trim() !== "" && searchHits(searchQuery, resultSearchText(rest));
  const highlight = hit && searchQuery ? { searchQuery, isCurrentMatch, currentMatchIndex } : undefined;
  return <Leftover ctx={{ input: rest, expandKey, pathCtx, t, searchQuery, highlight }} rest={rest} />;
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
