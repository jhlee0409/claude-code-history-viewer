/**
 * DiffView (plan §4.3 DiffView row, TR2a; acceptance D5): the unified diff.
 *
 * Every line: two line-number cells (old, new), a +/− marker cell (blank on
 * context lines) and the code, whitespace kept. Colours come only from the
 * diff tokens (`--diff-*`, defined for every theme, dark included: no white
 * table). The marker is a text glyph from the DOM, so an added and a removed
 * line stay apart in forced colours, where backgrounds are dropped; screen
 * readers hear "Added" / "Removed" instead of the glyph.
 *
 * Sections are old → new replacements (an Edit, each edit of a MultiEdit, a
 * whole file): several are labelled "Edit i of n". Unchanged runs farther
 * than `context` lines from a change fold into a gap row the user can open.
 * Past `lineCap` lines the rest waits behind "Show n more lines" (a
 * disclosure: aria-expanded + aria-controls).
 *
 * The counts it states (`data-diff-added` / `data-diff-removed` and a
 * screen-reader sentence) come from `replacementCounts`, the function the
 * Edit row's "+a −d" uses, over the same diff the lines come from.
 *
 * Its disclosures keep their state in the capture expand registry
 * (`expandKey`), so it needs an `ExpandKeyProvider` above it.
 */
import { Fragment, useId } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useCaptureExpandState } from "@/contexts/CaptureExpandContext";
import { replacementCounts } from "@/utils/lineChanges";
import { foldContext, sectionLines, type DiffLine } from "./DiffViewModel";

/** Lines shown before "Show n more lines". */
export const DIFF_LINE_CAP = 50;
/** Unchanged lines kept on each side of a change. */
export const DIFF_CONTEXT = 3;

/** One old → new replacement. `oldStart` / `newStart`: the first line's number in the file (default 1). */
export interface DiffSection {
  oldText: string;
  newText: string;
  oldStart?: number;
  newStart?: number;
}

export interface DiffViewProps {
  sections: DiffSection[];
  /** Capture-registry key prefix for the cap and gap disclosures. */
  expandKey: string;
  /** Lines shown before "Show n more lines". */
  lineCap?: number;
  /** Unchanged lines kept around each change; farther ones fold into a gap row. */
  context?: number;
  /** Accessible name of the diff (e.g. the file's relative path). */
  label?: string;
}

type Item =
  | { type: "section"; key: string; text: string }
  | { type: "line"; key: string; line: DiffLine }
  | { type: "gap"; key: string; lines: DiffLine[] };

const ROW_TONE = {
  add: { row: "bg-diff-add-bg", gutter: "bg-diff-add-gutter", marker: "text-diff-add-fg" },
  del: { row: "bg-diff-del-bg", gutter: "bg-diff-del-gutter", marker: "text-diff-del-fg" },
  context: { row: undefined, gutter: undefined, marker: undefined },
} as const;

const NUMBER_CELL = "w-px select-none whitespace-nowrap px-2 text-right align-top tabular-nums text-fg-3";

function LineRow({ line }: { line: DiffLine }) {
  const { t } = useTranslation();
  const tone = ROW_TONE[line.kind];
  return (
    <tr data-diff-line={line.kind} className={tone.row}>
      <td data-diff-old-no="" className={cn(NUMBER_CELL, tone.gutter)}>
        {line.oldNo ?? ""}
      </td>
      <td data-diff-new-no="" className={cn(NUMBER_CELL, tone.gutter)}>
        {line.newNo ?? ""}
      </td>
      <td data-diff-marker="" className={cn("w-px select-none px-1 text-center align-top", tone.gutter, tone.marker)}>
        {line.kind === "add" && (
          <>
            <span aria-hidden="true">+</span>
            <span className="sr-only">{t("diffView.added")}</span>
          </>
        )}
        {line.kind === "del" && (
          <>
            <span aria-hidden="true">−</span>
            <span className="sr-only">{t("diffView.removed")}</span>
          </>
        )}
      </td>
      <td data-diff-code="" className="whitespace-pre pr-3 pl-1 align-top text-fg">
        {line.text}
      </td>
    </tr>
  );
}

/**
 * Folded unchanged lines: their own row group whose first row is a disclosure
 * saying how many; opening shows them in place under it. The toggle stays, so
 * keyboard focus and its state survive (review round 1, amendment 14).
 */
function GapRows({ lines, stateKey }: { lines: DiffLine[]; stateKey: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useCaptureExpandState(stateKey, false);
  const groupId = useId();
  return (
    <tbody id={groupId} data-diff-gap-group="">
      <tr data-diff-gap="">
        {/* UI text, not code: a drag across opened lines selects code only (review round 2). */}
        <td colSpan={4} className="select-none px-2 py-1 font-sans text-caption text-diff-hunk-fg">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={groupId}
            className="rounded-row px-1 hover:bg-surface-hover hover:text-fg"
          >
            {t("diffView.unchangedLines", { count: lines.length })}
          </button>
        </td>
      </tr>
      {open && lines.map((line, index) => <LineRow key={index} line={line} />)}
    </tbody>
  );
}

/** Consecutive non-gap items share one row group; each gap is its own group. */
function groups(items: Item[]): Array<{ type: "gap"; item: Extract<Item, { type: "gap" }> } | { type: "rows"; items: Item[] }> {
  const out: Array<{ type: "gap"; item: Extract<Item, { type: "gap" }> } | { type: "rows"; items: Item[] }> = [];
  for (const item of items) {
    if (item.type === "gap") out.push({ type: "gap", item });
    else {
      const last = out[out.length - 1];
      if (last?.type === "rows") last.items.push(item);
      else out.push({ type: "rows", items: [item] });
    }
  }
  return out;
}

export function DiffView({ sections, expandKey, lineCap = DIFF_LINE_CAP, context = DIFF_CONTEXT, label }: DiffViewProps) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useCaptureExpandState(`${expandKey}:all`, false);
  const bodyId = useId();
  const counts = replacementCounts(sections.map((s) => [s.oldText, s.newText] as const));

  const items: Item[] = [];
  sections.forEach((section, s) => {
    if (sections.length > 1) items.push({ type: "section", key: `s${s}`, text: t("diffView.section", { index: s + 1, total: sections.length }) });
    const rows = foldContext(sectionLines(section.oldText, section.newText, section.oldStart, section.newStart), context);
    rows.forEach((row, r) => {
      const key = `s${s}-${r}`;
      items.push(row.type === "line" ? { type: "line", key, line: row.line } : { type: "gap", key, lines: row.lines });
    });
  });

  // The cap counts drawn lines; everything from the first line past it waits.
  let seen = 0;
  const cut = items.findIndex((item) => item.type === "line" && ++seen > lineCap);
  const hidden = cut < 0 ? 0 : items.slice(cut).filter((item) => item.type === "line").length;
  const visible = cut < 0 || showAll ? items : items.slice(0, cut);

  return (
    <div data-diff-view="" data-diff-added={counts.added} data-diff-removed={counts.removed} className="rounded-row bg-surface-well text-fg">
      <p className="sr-only">{`${t("toolRow.linesAdded", { count: counts.added })}, ${t("toolRow.linesRemoved", { count: counts.removed })}`}</p>
      {/* A long line scrolls sideways: the region is reachable from the keyboard. */}
      <div className="overflow-x-auto py-1" tabIndex={0} role="group" aria-label={label ?? t("diffView.code")}>
        <table id={bodyId} data-mono="code" className="min-w-full border-collapse font-mono text-code">
          <thead className="sr-only">
            <tr>
              <th scope="col">{t("diffView.oldLine")}</th>
              <th scope="col">{t("diffView.newLine")}</th>
              <th scope="col">{t("diffView.change")}</th>
              <th scope="col">{t("diffView.code")}</th>
            </tr>
          </thead>
          {groups(visible).map((group) =>
            group.type === "gap" ? (
              <GapRows key={group.item.key} lines={group.item.lines} stateKey={`${expandKey}:gap-${group.item.key}`} />
            ) : (
              <tbody key={group.items[0]?.key ?? "rows"}>
                {group.items.map((item) => (
                  <Fragment key={item.key}>
                    {item.type === "section" && (
                      <tr data-diff-section="">
                        <td colSpan={4} className="px-2 py-1 font-sans text-caption text-diff-hunk-fg">
                          {item.text}
                        </td>
                      </tr>
                    )}
                    {item.type === "line" && <LineRow line={item.line} />}
                  </Fragment>
                ))}
              </tbody>
            ),
          )}
        </table>
      </div>
      {hidden > 0 && (
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            aria-expanded={showAll}
            aria-controls={bodyId}
            className="text-caption text-fg-2 hover:text-fg"
          >
            {showAll ? t("diffView.showLess") : t("diffView.showMore", { count: hidden })}
          </button>
        </div>
      )}
    </div>
  );
}
