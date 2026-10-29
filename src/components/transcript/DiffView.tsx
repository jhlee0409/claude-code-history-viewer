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
import { Fragment, useId, useEffect, createContext, useContext } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useCaptureExpandState } from "@/contexts/CaptureExpandContext";
import { replacementCounts } from "@/utils/lineChanges";
import { foldContext, comparedLines, pairLines, type DiffLine, type DiffPair } from "./DiffViewModel";
import type { CompareMethod } from "./advancedCompare";
import { Button } from "@/components/ui/button";
import { useResultSearch, ResultSearchContext } from "./resultProvider";
import { syntaxRanges } from "./diffSyntax";
import { HighlightedText, searchMarkBaseClass, searchMarkCurrentClass, searchMarkOtherClass } from "../common/HighlightedText";
import { searchRanges } from "../common/searchMarks";
import type { TextHighlight } from "./ToolRow";

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
  lines?: DiffLine[];
  /** Legacy reconstructed after-copy payload, including recorded patch metadata. */
  copyText?: string;
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
  split?: boolean;
  filePath?: string;
  method?: CompareMethod;
  highlight?: TextHighlight;
  filter?: "add" | "del";
}

type Item =
  | { type: "section"; key: string; text: string }
  | { type: "line"; key: string; line: DiffLine; pair?: DiffPair }
  | { type: "gap"; key: string; lines: DiffLine[] };

const ROW_TONE = {
  add: { row: "bg-diff-add-bg", gutter: "bg-diff-add-gutter", marker: "text-diff-add-fg" },
  del: { row: "bg-diff-del-bg", gutter: "bg-diff-del-gutter", marker: "text-diff-del-fg" },
  context: { row: undefined, gutter: undefined, marker: undefined },
} as const;

const NUMBER_CELL = "w-px select-none whitespace-nowrap px-2 text-right align-top tabular-nums text-fg-3";

const WORD_TONE = { add: "bg-diff-word-add-bg decoration-diff-word-add-mark", del: "bg-diff-word-del-bg decoration-diff-word-del-mark", context: "" } as const;

const SyntaxContext = createContext("");

function CodeText({ line }: { line: DiffLine }) {
  const highlight = useResultSearch();
  const hits = highlight.searchQuery ? searchRanges(line.text, highlight.searchQuery) : [];
  const emphasis = line.emphasis ?? [];
  const filePath = useContext(SyntaxContext);
  const syntax = syntaxRanges(line.text, filePath);
  if (!emphasis.length && !syntax.length) return <HighlightedText text={line.text} searchQuery={highlight.searchQuery ?? ""} isCurrentMatch={highlight.isCurrentMatch} currentMatchIndex={highlight.currentMatchIndex} />;
  const boundaries = [...new Set([0, line.text.length, ...emphasis.flat(), ...hits.flat(), ...syntax.flatMap(s => [s.start, s.end])])].sort((a, b) => a - b);
  return <>{boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1]!;
    const word = emphasis.some(([a, b]) => start >= a && end <= b);
    const match = hits.findIndex(([a, b]) => start >= a && end <= b);
    const active = highlight.isCurrentMatch && match === (highlight.currentMatchIndex ?? 0);
    const target = active && start === hits[match]?.[0];
    const tone = syntax.find(s => start >= s.start && end <= s.end)?.tone;
    const text = <span data-diff-word={word ? line.kind : undefined} className={cn(word && "underline decoration-2 underline-offset-2", word && WORD_TONE[line.kind], match < 0 && tone)}>{line.text.slice(start, end)}</span>;
    return match < 0 ? <Fragment key={start}>{text}</Fragment> : <mark key={start} data-search-highlight={target ? "current" : undefined} aria-current={target ? "true" : undefined} className={cn(searchMarkBaseClass, active ? searchMarkCurrentClass : searchMarkOtherClass)}>{text}</mark>;
  })}</>;
}

function SplitRow({ pair }: { pair: DiffPair }) {
  const { t } = useTranslation();
  return <tr data-diff-pair="">{(["left", "right"] as const).map(side => {
    const line = pair[side];
    const tone = ROW_TONE[line?.kind ?? "context"];
    return <Fragment key={side}>
      <td data-diff-old-no={side === "left" ? "" : undefined} data-diff-new-no={side === "right" ? "" : undefined} className={cn(NUMBER_CELL, tone.gutter)}>{line ? (side === "left" ? line.oldNo : line.newNo) : ""}</td>
      <td data-diff-marker="" data-diff-line={line?.kind} className={cn("w-px select-none px-1 text-center align-top", tone.gutter, tone.marker)}>{line && line.kind !== "context" && <><span aria-hidden="true">{line.kind === "add" ? "+" : "−"}</span><span className="sr-only">{t(line.kind === "add" ? "diffView.added" : "diffView.removed")}</span></>}</td>
      <td data-diff-code="" className={cn("w-1/2 whitespace-pre pr-3 pl-1 align-top text-fg", tone.row)}>{line && <CodeText line={line} />}</td>
    </Fragment>;
  })}</tr>;
}

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
        <CodeText line={line} />
      </td>
    </tr>
  );
}

/**
 * Folded unchanged lines: their own row group whose first row is a disclosure
 * saying how many; opening shows them in place under it. The toggle stays, so
 * keyboard focus and its state survive (review round 1, amendment 14).
 */
function GapRows({ lines, stateKey, split }: { lines: DiffLine[]; stateKey: string; split?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useCaptureExpandState(stateKey, false);
  const groupId = useId();
  return (
    <tbody id={groupId} data-diff-gap-group="">
      <tr data-diff-gap="">
        {/* UI text, not code: a drag across opened lines selects code only (review round 2). */}
        <td colSpan={split ? 6 : 4} className="select-none px-2 py-1 font-sans text-caption text-diff-hunk-fg">
          <Button variant="ghost" size="sm"
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={groupId}
            className="rounded-row px-1 hover:bg-surface-hover hover:text-fg"
          >
            {t("diffView.unchangedLines", { count: lines.length })}
          </Button>
        </td>
      </tr>
      {open && lines.map((line, index) => split ? <SplitRow key={index} pair={{ left: line, right: line }} /> : <LineRow key={index} line={line} />)}
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

export function DiffView({ sections, expandKey, lineCap = DIFF_LINE_CAP, context = DIFF_CONTEXT, label, split = false, filePath = "", method, highlight, filter }: DiffViewProps) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useCaptureExpandState(`${expandKey}:all`, false);
  const bodyId = useId();
  const inherited = useResultSearch();
  const search = highlight ? { ...inherited, ...highlight } : inherited;
  const query = search.searchQuery;
  const hit = !!query?.trim() && sections.some(s => searchRanges(s.oldText + "\n" + s.newText, query).length > 0);
  useEffect(() => { if (hit) setShowAll(true); }, [query, hit, setShowAll]);
  const counts = sections.reduce((total, section) => {
    const counts = section.lines ? { added: section.lines.filter(l => l.kind === "add").length, removed: section.lines.filter(l => l.kind === "del").length } : replacementCounts([[section.oldText, section.newText]]);
    return { added: total.added + counts.added, removed: total.removed + counts.removed };
  }, { added: 0, removed: 0 });

  const items: Item[] = [];
  sections.forEach((section, s) => {
    if (sections.length > 1) items.push({ type: "section", key: `s${s}`, text: t("diffView.section", { index: s + 1, total: sections.length }) });
    const allLines = comparedLines(section.oldText, section.newText, section.oldStart, section.newStart, method, section.lines);
    const rows = filter ? allLines.filter(line => line.kind === filter).map(line => ({ type: "line" as const, line })) : foldContext(allLines, hit ? Infinity : context);
    let run: DiffLine[] = [];
    const flush = () => {
      if (split) pairLines(run).forEach(pair => items.push({ type: "line", key: `s${s}-${items.length}`, line: (pair.left ?? pair.right)!, pair }));
      else run.forEach(line => items.push({ type: "line", key: `s${s}-${items.length}`, line }));
      run = [];
    };
    rows.forEach(row => {
      if (row.type === "line") run.push(row.line);
      else { flush(); items.push({ type: "gap", key: `s${s}-${items.length}`, lines: row.lines }); }
    });
    flush();
  });

  // The cap counts drawn lines; everything from the first line past it waits.
  let seen = 0;
  const cut = items.findIndex((item) => item.type === "line" && ++seen > lineCap);
  const hidden = cut < 0 ? 0 : items.slice(cut).filter((item) => item.type === "line").length;
  const visible = cut < 0 || showAll ? items : items.slice(0, cut);

  return (
    <ResultSearchContext.Provider value={search}>
    <SyntaxContext.Provider value={split ? filePath : ""}>
    <div data-diff-view="" data-diff-mode={split ? "sideBySide" : method ? "advanced" : "unified"} data-diff-added={counts.added} data-diff-removed={counts.removed} className="rounded-row bg-surface-well text-fg">
      <p className="sr-only">{`${t("toolRow.linesAdded", { count: counts.added })}, ${t("toolRow.linesRemoved", { count: counts.removed })}`}</p>
      {/* A long line scrolls sideways: the region is reachable from the keyboard. */}
      <div className="overflow-x-auto py-1" tabIndex={0} role="group" aria-label={label ?? t("diffView.code")}>
        <table id={bodyId} data-mono="code" className="min-w-full border-collapse font-mono text-code">
          <thead className="sr-only">
            <tr>
              <th scope="col">{t("diffView.oldLine")}</th>
              {!split && <th scope="col">{t("diffView.newLine")}</th>}
              <th scope="col">{t("diffView.change")}</th>
              <th scope="col">{split ? t("diffViewer.before") : t("diffView.code")}</th>
              {split && <><th scope="col">{t("diffView.newLine")}</th><th scope="col">{t("diffView.change")}</th><th scope="col">{t("diffViewer.after")}</th></>}
            </tr>
          </thead>
          {groups(visible).map((group) =>
            group.type === "gap" ? (
              <GapRows split={split} key={group.item.key} lines={group.item.lines} stateKey={`${expandKey}:gap-${group.item.key}`} />
            ) : (
              <tbody key={group.items[0]?.key ?? "rows"}>
                {group.items.map((item) => (
                  <Fragment key={item.key}>
                    {item.type === "section" && (
                      <tr data-diff-section="">
                        <td colSpan={split ? 6 : 4} className="px-2 py-1 font-sans text-caption text-diff-hunk-fg">
                          {item.text}
                        </td>
                      </tr>
                    )}
                    {item.type === "line" && (item.pair ? <SplitRow pair={item.pair} /> : <LineRow line={item.line} />)}
                  </Fragment>
                ))}
              </tbody>
            ),
          )}
        </table>
      </div>
      {hidden > 0 && (
        <div className="px-3 pb-2">
          <Button variant="ghost" size="sm"
            type="button"
            onClick={() => setShowAll((v) => !v)}
            aria-expanded={showAll}
            aria-controls={bodyId}
            className="text-caption text-fg-2 hover:text-fg"
          >
            {showAll ? t("diffView.showLess") : t("diffView.showMore", { count: hidden })}
          </Button>
        </div>
      )}
    </div>
    </SyntaxContext.Provider>
    </ResultSearchContext.Provider>
  );
}
