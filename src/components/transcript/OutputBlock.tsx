/**
 * OutputBlock (plan §4.3, D6, TR0): tool output as recorded.
 *
 * One well (`--surface-well`, code font). Text keeps every space and line
 * break and is never read as Markdown. ANSI colour renders through AnsiText;
 * the app's existing file-tree / JSON / table (and, for command output,
 * test / build / package) detection only adds a quiet label.
 *
 * stderr gets its own zone — danger text and a left rule — whatever the
 * verdict: a warning beside exit code 0 stays visible, and so does E15's
 * fatal stderr with no exit code. Recorded outcome facts (exit code …) are
 * not the output's: the ToolRow detail that holds it shows them, once.
 * Long output is capped at `lineCap` lines per zone with "Show all n lines";
 * a search match past the cap opens it.
 */
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useCaptureExpandState } from "@/contexts/CaptureExpandContext";
import { copyTextToClipboard } from "@/utils/clipboard";
import { hasAnsiCodes } from "@/utils/ansiToHtml";
import { AnsiText } from "../common/AnsiText";
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

function Zone({ text, className }: { text: string; className?: string }) {
  return (
    <pre data-output-text="" className={cn("m-0 overflow-x-auto whitespace-pre-wrap break-words font-mono text-code", className)}>
      {hasAnsiCodes(text) ? <AnsiText text={text} /> : text}
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
}: OutputBlockProps) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useCaptureExpandState(`${expandKey}:all`, false);
  const [copied, setCopied] = useState(false);

  const main = text ?? "";
  const stderr = errorText ?? "";
  const mainLines = linesOf(main);
  const errLines = linesOf(stderr);
  const total = mainLines.length + errLines.length;
  const overCap = mainLines.length > lineCap || errLines.length > lineCap;
  const query = searchQuery?.trim().toLowerCase() ?? "";
  const searchHit = query !== "" && `${main}\n${stderr}`.toLowerCase().includes(query);
  const open = showAll || searchHit;
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
        <span>{total === 0 ? t("outputBlock.empty") : t("outputBlock.lineCount", { count: total })}</span>
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
      {main !== "" && <Zone text={cap(mainLines, main)} className="px-3 py-2" />}
      {stderr !== "" && (
        <div data-stderr="" className="mx-3 mb-2 border-l-2 border-status-danger-line pl-2">
          <span className="text-caption text-fg-3">{t("outputBlock.stderr")}</span>
          <Zone text={cap(errLines, stderr)} className="text-status-danger-fg" />
        </div>
      )}
      {main === "" && stderr === "" && <div className="pb-2" />}
      {overCap && !searchHit && (
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-caption text-fg-2 hover:text-fg"
          >
            {showAll ? t("outputBlock.showLess") : t("outputBlock.showAll", { count: total })}
          </button>
        </div>
      )}
    </div>
  );
}
