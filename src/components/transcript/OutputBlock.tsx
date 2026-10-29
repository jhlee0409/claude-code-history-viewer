/**
 * OutputBlock (plan §4.3, D6, TR0): tool output as recorded.
 *
 * One well (`--surface-well`, code font). Text keeps every space and line
 * break and is never read as Markdown. ANSI colour renders through AnsiText;
 * the app's existing file-tree / JSON / table (and, for command output,
 * test / build / package) detection only adds a quiet label.
 *
 * stderr always gets its own zone with a left rule: a warning beside exit
 * code 0 stays visible, and so does E15's fatal stderr with no exit code.
 * The zone is labelled with the stream's name, the code literal `stderr`, in
 * every locale: a word like "error output" would call a warning beside exit
 * code 0 an error (renderer audit TC6). Danger styling (rule and text) is
 * the failed verdict's alone (`failed`, plan amendment #1); otherwise the
 * zone is neutral. Recorded outcome facts (exit code …) are not the output's: the
 * ToolRow detail that holds it shows them, once.
 * Long output is capped at `lineCap` lines per zone with "Show all n lines";
 * a search match past the cap opens it.
 *
 * `highlight` (TR1a, the generic JSON body): with a search query, the hits
 * in the text and in the stderr zone are marked (plain text only; ANSI
 * output is not marked).
 *
 * Text wraps by default. `wrap={false}` keeps each recorded line on one
 * visual line and lets the well scroll sideways, for output whose lines are
 * records (Grep content-mode matches: a soft-wrapped match would read as the
 * next match, TC13).
 */
import { useEffect, useId, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useCaptureExpandState } from "@/contexts/CaptureExpandContext";
import { copyTextToClipboard } from "@/utils/clipboard";
import { hasAnsiCodes, stripAnsiCodes } from "@/utils/ansiToHtml";
import { AnsiText } from "../common/AnsiText";
import { HighlightedText } from "../common/HighlightedText";
import { detectOutputKind, type OutputKind } from "./outputKind";

export const DEFAULT_LINE_CAP = 15;

/**
 * Which detected kinds get a label: `command` output gets all of the
 * CommandOutputDisplay labels, generic `text` the structural ones, and file
 * contents (`file`) none.
 */
export type OutputSource = "command" | "text" | "file";

export interface OutputBlockProps {
  /** Main output (stdout, or the result text). */
  text?: string;
  /** stderr, shown in its own zone. */
  errorText?: string;
  searchQuery?: string;
  lineCap?: number;
  /** Capture-registry key for the show-all state. */
  expandKey?: string;
  source?: OutputSource;
  /** `false`: no soft wrapping — one line per recorded line, the well scrolls sideways. */
  wrap?: boolean;
  /** `false`: the meta leaves out the line count (the caller already shows it). */
  showLineCount?: boolean;
  /** The row's verdict is `failed`: the stderr zone takes the danger rule and text. */
  failed?: boolean;
  /** Mark the `searchQuery` hits in the text (which match is current). */
  highlight?: { isCurrentMatch?: boolean; currentMatchIndex?: number };
}

const LABELLED: Record<OutputSource, ReadonlySet<OutputKind>> = {
  command: new Set(["fileTree", "json", "test", "build", "package", "table"]),
  text: new Set(["fileTree", "json", "table"]),
  file: new Set(),
};

const KIND_LABEL_KEY = {
  fileTree: "toolResult.fileStructure",
  json: "commandOutputDisplay.jsonOutput",
  test: "commandOutputDisplay.testResults",
  build: "commandOutputDisplay.buildOutput",
  package: "commandOutputDisplay.packageManagement",
  table: "commandOutputDisplay.tableOutput",
} as const;

const linesOf = (text: string) => (text === "" ? [] : text.split("\n"));

type Mark = { searchQuery: string; isCurrentMatch?: boolean; currentMatchIndex?: number } | null;

function Zone({ id, text, wrap, className, mark = null }: { id: string; text: string; wrap: boolean; className?: string; mark?: Mark }) {
  return (
    <pre
      id={id}
      data-output-text=""
      // An unwrapped well scrolls sideways: keep it reachable from the keyboard.
      tabIndex={wrap ? undefined : 0}
      className={cn("m-0 overflow-x-auto font-mono text-code", wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre", className)}
    >
      {mark ? (
        <HighlightedText text={stripAnsiCodes(text)} searchQuery={mark.searchQuery} isCurrentMatch={mark.isCurrentMatch} currentMatchIndex={mark.currentMatchIndex} />
      ) : hasAnsiCodes(text) ? (
        <AnsiText text={text} />
      ) : (
        text
      )}
    </pre>
  );
}

export function OutputBlock({
  text,
  errorText,
  searchQuery,
  lineCap = DEFAULT_LINE_CAP,
  expandKey = "output",
  source = "text",
  wrap = true,
  showLineCount = true,
  failed = false,
  highlight,
}: OutputBlockProps) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useCaptureExpandState(`${expandKey}:all`, false);
  const [copied, setCopied] = useState(false);
  const zoneId = useId();
  const mainId = `${zoneId}-out`;
  const errId = `${zoneId}-err`;

  const main = text ?? "";
  const stderr = errorText ?? "";
  const mainLines = linesOf(main);
  const errLines = linesOf(stderr);
  const total = mainLines.length + errLines.length;
  const overCap = mainLines.length > lineCap || errLines.length > lineCap;
  const query = searchQuery?.trim().toLowerCase() ?? "";
  const searchHit = query !== "" && `${main}\n${stderr}`.toLowerCase().includes(query);
  // A search hit past the cap opens the whole block once; the toggle then says
  // so and still collapses it (review round 6); a new matching query reveals
  // again (review round 7).
  useEffect(() => {
    if (searchHit) setShowAll(true);
  }, [searchHit, query, setShowAll]);
  const open = showAll;
  const mark: Mark = highlight && query !== "" && searchQuery ? { searchQuery, ...highlight } : null;
  const cap = (lines: string[], whole: string) => (open || lines.length <= lineCap ? whole : lines.slice(0, lineCap).join("\n"));

  const kind = main === "" ? null : detectOutputKind(main);
  const kindLabel = kind && kind !== "terminal" && LABELLED[source].has(kind) ? t(KIND_LABEL_KEY[kind]) : null;

  const onCopy = async () => {
    try {
      await copyTextToClipboard(stderr === "" ? main : main === "" ? stderr : `${main}\n${stderr}`);
    } catch {
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div data-output="" className="rounded-row bg-surface-well text-fg">
      <div data-meta="" className="flex min-w-0 flex-wrap items-center gap-2 px-3 pt-2 text-caption text-fg-3">
        {kindLabel && <span>{kindLabel}</span>}
        {total === 0 ? <span>{t("outputBlock.empty")}</span> : showLineCount && <span>{t("outputBlock.lineCount", { count: total })}</span>}
        <button
          type="button"
          onClick={onCopy}
          aria-label={t("outputBlock.copy")}
          title={copied ? t("common.copied") : t("outputBlock.copy")}
          className="ml-auto inline-flex size-6 items-center justify-center rounded-row text-fg-3 hover:bg-surface-hover hover:text-fg"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      {main !== "" && <Zone id={mainId} text={cap(mainLines, main)} wrap={wrap} className="px-3 py-2" mark={mark} />}
      {stderr !== "" && (
        <div data-stderr="" className={cn("mx-3 mb-2 border-l-2 pl-2", failed ? "border-status-danger-line" : "border-line")}>
          <code data-mono="code" className="text-caption text-fg-3">
            stderr
          </code>
          <Zone id={errId} text={cap(errLines, stderr)} wrap={wrap} className={failed ? "text-status-danger-fg" : undefined} mark={mark} />
        </div>
      )}
      {main === "" && stderr === "" && <div className="pb-2" />}
      {overCap && (
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            aria-expanded={showAll}
            aria-controls={[main !== "" && mainId, stderr !== "" && errId].filter(Boolean).join(" ")}
            className="text-caption text-fg-2 hover:text-fg"
          >
            {showAll ? t("outputBlock.showLess") : t("outputBlock.showAll", { count: total })}
          </button>
        </div>
      )}
    </div>
  );
}
