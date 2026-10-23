/**
 * ToolRow (plan §4.3, §4.2 screen rules, TR0): one tool call as one row.
 *
 * The row is not a card: no fill, no border. Minimum height `--row-tool`
 * (`--row-touch` on phones and coarse pointers), list text, a neutral icon,
 * the verb in medium `--fg-2`, the target (a `PathText`, a command or a
 * query, in the code font), and caption meta on the right.
 *
 * Outcome (from `toolOutcome`, never read from the result here):
 * - succeeded / unknown: nothing in the row — no pill, no "Completed".
 *   Opened, the detail states neutral facts: "Result not verified · No exit
 *   code recorded" when a process left no exit code.
 * - Every recorded outcome fact shows exactly once when the row is open,
 *   counting the header label and the detail meta (review R3-F2): the
 *   header label states what it states ("Failed · exit code 1",
 *   "Failed · <API error code>", "Interrupted"); the detail meta adds every
 *   other recorded fact — an exit code (0 included), an error code, "not
 *   verified", "parts disagree" — whatever the verdict and whether or not any
 *   output exists. Outputs (OutputBlock) never repeat them.
 * - failed: a danger icon + "Failed", "Failed · exit code N" (only a recorded
 *   N) or "Failed · <API error code>".
 * - interrupted: a warning icon + "Interrupted". no result: an `--fg-3`
 *   icon + "No result recorded". Each state has its own icon shape and words.
 *
 * The header is a disclosure (`aria-expanded` + `aria-controls`); its open
 * state lives in the capture expand registry like every renderer. The
 * opened detail is its content, then one meta line: the facts, ended by
 * "Copy tool ID" — a small ghost text button, the only way to the tool id,
 * never the detail's first line (renderer audit TC10).
 *
 * A command / pattern target (`CodeTarget`) may be cut: by the ellipsis, or
 * because only its first line fits the row. The row measures it while open
 * (ResizeObserver) and its `TargetWell` repeats the whole text in the detail
 * only then (renderer audit TC8); the target's `title` always holds it.
 */
import { createContext, useCallback, useContext, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronRight, CircleDashed, CirclePause, CircleX } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { cn } from "@/lib/utils";
import { useToggle } from "@/hooks/useToggle";
import { RendererDefaultsContext } from "@/shared/rendererDefaults";
import { copyTextToClipboard } from "@/utils/clipboard";
import type { ToolFamily, ToolOutcome } from "./toolOutcome";

export interface ToolRowProps {
  /** The tool's icon; the row colours it `--fg-3`. */
  icon: ReactNode;
  /** The tool name as recorded (Read, Bash, …). */
  verb: string;
  /** What the call acted on: a `PathText`, `<CodeTarget>` … */
  target?: ReactNode;
  /** Caption meta on the right (range, scope, counts). */
  meta?: ReactNode;
  outcome: ToolOutcome;
  family: ToolFamily;
  toolId?: string;
  /** Expand-registry key (stable per tool call). */
  expandKey: string;
  /** Force the detail open (e.g. a search match inside). */
  autoExpand?: boolean;
  /** The opened detail. */
  children?: ReactNode;
}

/**
 * A command or query target, in the code font. `text` is what the row shows
 * (Bash: the first line); `full` is the whole recorded text, kept in `title`.
 */
export function CodeTarget({ text, full = text }: { text: string; full?: string }) {
  return (
    <code
      data-mono="code"
      data-row-target=""
      data-row-target-partial={text.trim() === full.trim() ? undefined : ""}
      className="truncate font-mono text-code text-fg"
      title={full}
    >
      {text}
    </code>
  );
}

/** Is the open row's `CodeTarget` cut? Provided by ToolRow to its detail. */
const TargetCutContext = createContext(false);

/**
 * Whether the row's code target does not show all of its text: only part of
 * it is shown, or the ellipsis cut it (scrollWidth > clientWidth). Measured
 * while the detail is open, again whenever the target's box changes size, and
 * whenever the target changes (re-render or DOM text / partial mark), since
 * its box may keep the same size.
 */
function useTargetCut(scope: RefObject<HTMLElement | null>, active: boolean, target: unknown): boolean {
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const root = active ? scope.current : null;
    if (!root) {
      setCut(false);
      return;
    }
    let resize: ResizeObserver | null = null;
    let observed: HTMLElement | null = null;
    const measure = () => {
      const target = root.querySelector<HTMLElement>("[data-row-target]");
      if (target !== observed) {
        resize?.disconnect();
        observed = target;
        if (target && typeof ResizeObserver !== "undefined") {
          resize = new ResizeObserver(measure);
          resize.observe(target);
        }
      }
      setCut(target ? target.hasAttribute("data-row-target-partial") || target.scrollWidth > target.clientWidth : false);
    };
    measure();
    const mutation =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(measure);
    mutation?.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-row-target-partial", "title"],
    });
    return () => {
      mutation?.disconnect();
      resize?.disconnect();
    };
  }, [scope, active, target]);
  return cut;
}

/**
 * The whole command, pattern or query in the opened detail, shown only when
 * the row's target is cut (otherwise the row already shows all of it).
 * Identifiers wrap anywhere so a long token stays inside the transcript column.
 */
export function TargetWell({ text }: { text: string }) {
  const cut = useContext(TargetCutContext);
  if (!cut) return null;
  return (
    <pre className="m-0 whitespace-pre-wrap wrap-anywhere rounded-row bg-surface-well px-3 py-2 font-mono text-code text-fg">
      <code data-mono="code">{text}</code>
    </pre>
  );
}

function failedLabel(outcome: ToolOutcome, t: TFunction): string {
  if (outcome.errorCode !== undefined) return t("toolOutcome.failedErrorCode", { code: outcome.errorCode });
  if (outcome.exitCode !== undefined) return t("toolOutcome.failedExitCode", { code: outcome.exitCode });
  return t("toolOutcome.failed");
}

/** What the collapsed row says; `null` = quiet. */
function RowStatus({ outcome }: { outcome: ToolOutcome }) {
  const { t } = useTranslation();
  if (outcome.lifecycle === "no-result") {
    return (
      <span className="inline-flex items-center gap-1 text-fg-3">
        <CircleDashed data-outcome-icon="no-result" aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-fg-3" />
        {t("toolOutcome.noResult")}
      </span>
    );
  }
  if (outcome.lifecycle === "interrupted") {
    return (
      <span className="inline-flex items-center gap-1 text-status-warning-fg">
        <CirclePause data-outcome-icon="interrupted" aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-status-warning-fg" />
        {t("toolOutcome.interrupted")}
      </span>
    );
  }
  if (outcome.verdict === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-status-danger-fg">
        <CircleX data-outcome-icon="failed" aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-status-danger-fg" />
        {failedLabel(outcome, t)}
      </span>
    );
  }
  return null;
}

/**
 * Facts for the opened detail's meta: each recorded fact the header label
 * does not already state (exactly once when open, R3-F2), then "not
 * verified" and "parts disagree".
 */
function detailFacts(outcome: ToolOutcome, family: ToolFamily, t: TFunction): string[] {
  const failed = outcome.lifecycle === "completed" && outcome.verdict === "failed";
  // What the header label already says (`failedLabel`, RowStatus).
  const headerSaysErrorCode = failed && outcome.errorCode !== undefined;
  const headerSaysExitCode = failed && !headerSaysErrorCode && outcome.exitCode !== undefined;
  const facts: string[] = [];
  if (outcome.exitCode !== undefined && !headerSaysExitCode) facts.push(t("toolOutcome.exitCode", { code: outcome.exitCode }));
  if (outcome.errorCode !== undefined && !headerSaysErrorCode) facts.push(t("toolOutcome.errorCode", { code: outcome.errorCode }));
  if (outcome.verdict === "unknown" && outcome.lifecycle === "completed" && outcome.reason === "no-exit-code") {
    facts.push(t("toolOutcome.notVerifiedNoExitCode"));
  } else if (outcome.verdict === "unknown" && outcome.lifecycle === "completed" && family === "process") {
    facts.push(t("toolOutcome.notVerified"));
  }
  if (outcome.reason === "conflict") facts.push(t("toolOutcome.conflict"));
  return facts;
}

function CopyToolId({ toolId }: { toolId: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await copyTextToClipboard(toolId);
    } catch {
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [toolId]);
  return (
    <button
      type="button"
      onClick={onCopy}
      className="inline-flex min-h-6 items-center rounded-row px-1 text-caption text-fg-3 hover:bg-surface-hover hover:text-fg"
    >
      {copied ? t("toolRow.toolIdCopied") : t("toolRow.copyToolId")}
    </button>
  );
}

export function ToolRow({ icon, verb, target, meta, outcome, family, toolId, expandKey, autoExpand, children }: ToolRowProps) {
  const { t } = useTranslation();
  const ambient = useContext(RendererDefaultsContext);
  const [isOpen, toggle] = useToggle(expandKey, ambient.defaultExpanded);
  const open = isOpen || autoExpand === true;
  const detailId = useId();
  const facts = open ? detailFacts(outcome, family, t) : [];
  const targetRef = useRef<HTMLSpanElement>(null);
  const targetCut = useTargetCut(targetRef, open, target);

  return (
    <div data-tool-row-wrapper="" className="mt-1">
      <div
        data-tool-row=""
        data-tool-verdict={outcome.verdict}
        data-tool-lifecycle={outcome.lifecycle}
        className="flex min-h-row-tool max-sm:min-h-row-touch pointer-coarse:min-h-row-touch items-stretch gap-2 text-list"
      >
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={detailId}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-row px-1 text-left hover:bg-surface-hover"
        >
          <ChevronRight aria-hidden="true" className={cn("w-3.5 h-3.5 shrink-0 text-fg-3 transition-transform", open && "rotate-90")} />
          <span data-tool-icon="" className="flex shrink-0 items-center text-fg-3">
            {icon}
          </span>
          <span className="shrink-0 font-medium text-fg-2">{verb}</span>
          {target && (
            <span ref={targetRef} className="flex min-w-0 flex-1 items-center">
              {target}
            </span>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-2 text-caption text-fg-3">
          {meta}
          <RowStatus outcome={outcome} />
        </div>
      </div>
      <div id={detailId} data-tool-detail="" hidden={!open} className="pl-6">
        {open && (
          <TargetCutContext.Provider value={targetCut}>
            <div className="space-y-2 pb-2">{children}</div>
            {(facts.length > 0 || toolId) && (
              <div data-meta="" className="flex min-h-row-list flex-wrap items-center gap-2 text-caption text-fg-3">
                {facts.map((fact) => (
                  <span key={fact}>{fact}</span>
                ))}
                {toolId && <CopyToolId toolId={toolId} />}
              </div>
            )}
          </TargetCutContext.Provider>
        )}
      </div>
    </div>
  );
}
