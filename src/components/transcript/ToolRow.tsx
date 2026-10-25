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
 *   The collapsed status is `OutcomeStatus`, shared with the cards that keep
 *   their own frame (TR0b).
 *
 * Narrow rows (TR1a, the widest heads: Agent type + background + status, a
 * long MCP name): when the right group does not fit beside a 14rem head
 * (`basis-56`), it moves to its own line under it, right-aligned, and wraps
 * its pieces there instead of running past the row; the head then takes the
 * whole first line, so the target stays visible. A verb that would crowd
 * the target out (a long MCP name) takes at most half of the head and
 * truncates there, the whole name in `title`. The status is never cut. When
 * everything fits, the row is one line, as before.
 *
 * The header is a disclosure (`aria-expanded` + `aria-controls`); its open
 * state lives in the capture expand registry like every renderer. The
 * opened detail is its content — the card's `DetailZone`s, "Input" then
 * "Result" (owner option B), plus asides that lead elsewhere — then one
 * meta line, outside both zones: the facts, ended by "Copy tool ID" — a
 * small ghost text button, the only way to the tool id, never the detail's
 * first line (renderer audit TC10).
 *
 * Where an opened call ends (signal audit #12, owner decision 2026-10-25):
 * the opened detail ends with a 1px `--line-faint` hairline, 8px below its
 * last line and 8px above the next row — only the bottom edge, not a frame,
 * so two opened rows that meet have one line between them. A closed row has
 * no line and no extra space.
 *
 * The icon (signal audit #14) is an image named by the tool kind in the
 * user's language (`toolKind`: Bash → "Terminal" / "터미널", MCP and unknown
 * tools → "Tool" / "도구"), which is also its native tooltip. It is not
 * focusable; the row button reads kind, verb, target. The verb stays the
 * recorded name (D-R5).
 *
 * A command / pattern target (`CodeTarget`, or prose in `TextTarget`) may be
 * cut: by the ellipsis, or because only its first line fits the row. The row
 * measures it while open (ResizeObserver) and its `TargetWell` (or any
 * `WhenTargetCut` content) repeats the whole text in the detail only then
 * (renderer audit TC8); the target's `title` always holds it.
 *
 * Search (TR1a): a caller whose content holds a search hit passes the query
 * as `revealFor`. The row opens once per query — an effect keyed on the
 * query, never `open = stored || hit` — so the user can still collapse it
 * while the query matches, and a different matching query opens it again.
 * Targets and wells take a `highlight` so a hit the row's ellipsis hides is
 * marked again in the opened detail. `detailMeta` leads the detail's meta
 * line (recorded facts a card adds), which "Copy tool ID" still ends.
 */
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { cn } from "@/lib/utils";
import { useToggle } from "@/hooks/useToggle";
import { RendererDefaultsContext } from "@/shared/rendererDefaults";
import { copyTextToClipboard } from "@/utils/clipboard";
import { HighlightedText } from "../common/HighlightedText";
import type { ToolFamily, ToolOutcome } from "./toolOutcome";
import { OutcomeStatus } from "./OutcomeStatus";
import { toolKindLabel } from "./toolKind";

export interface ToolRowProps {
  /** The tool's icon; the row colours it `--fg-3` and names it by the tool kind. Pass it without its own tooltip. */
  icon: ReactNode;
  /** The tool name as recorded (Read, Bash, …); also what the row's tool kind is looked up by. */
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
  /**
   * The search query when a hit lies inside this call (else undefined): the
   * row opens once for each such query, and stays as the user leaves it.
   */
  revealFor?: string;
  /** Recorded facts that lead the opened detail's meta line (before the outcome facts and "Copy tool ID"). */
  detailMeta?: ReactNode;
  /** The opened detail. */
  children?: ReactNode;
}

/** A search hit to mark in a row target or detail text. */
export interface TextHighlight {
  searchQuery: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
}

/** `text` with the search hits marked, or as is when there is no query. */
export function Marked({ text, highlight }: { text: string; highlight?: TextHighlight }) {
  if (!highlight || highlight.searchQuery.trim() === "") return <>{text}</>;
  return (
    <HighlightedText
      text={text}
      searchQuery={highlight.searchQuery}
      isCurrentMatch={highlight.isCurrentMatch}
      currentMatchIndex={highlight.currentMatchIndex}
    />
  );
}

/**
 * A command or query target, in the code font. `text` is what the row shows
 * (Bash: the first line); `full` is the whole recorded text, kept in `title`.
 */
export function CodeTarget({ text, full = text, highlight }: { text: string; full?: string; highlight?: TextHighlight }) {
  return (
    <code
      data-mono="code"
      data-row-target=""
      data-row-target-partial={text.trim() === full.trim() ? undefined : ""}
      className="truncate font-mono text-code text-fg"
      title={full}
    >
      <Marked text={text} highlight={highlight} />
    </code>
  );
}

/**
 * A prose target (an agent's task description, a question, a subject), in
 * the list font. Same contract as `CodeTarget`: `text` is what the row
 * shows, `full` the whole recorded text, kept in `title`.
 */
export function TextTarget({ text, full = text, highlight }: { text: string; full?: string; highlight?: TextHighlight }) {
  return (
    <span data-row-target="" data-row-target-partial={text.trim() === full.trim() ? undefined : ""} className="truncate text-fg" title={full}>
      <Marked text={text} highlight={highlight} />
    </span>
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
export function TargetWell({ text, highlight }: { text: string; highlight?: TextHighlight }) {
  const cut = useContext(TargetCutContext);
  if (!cut) return null;
  return (
    <pre className="m-0 whitespace-pre-wrap wrap-anywhere rounded-row bg-surface-well px-3 py-2 font-mono text-code text-fg">
      <code data-mono="code">
        <Marked text={text} highlight={highlight} />
      </code>
    </pre>
  );
}

/** Detail content shown only when the row's target is cut (a prose target's whole text). */
export function WhenTargetCut({ children }: { children: ReactNode }) {
  const cut = useContext(TargetCutContext);
  return cut ? <>{children}</> : null;
}

/**
 * Facts for the opened detail's meta: each recorded fact the header label
 * does not already state (exactly once when open, R3-F2), then "not
 * verified" and "parts disagree".
 */
function detailFacts(outcome: ToolOutcome, family: ToolFamily, t: TFunction): string[] {
  const failed = outcome.lifecycle === "completed" && outcome.verdict === "failed";
  // What the header label already says (OutcomeStatus).
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

export function ToolRow({ icon, verb, target, meta, outcome, family, toolId, expandKey, revealFor, detailMeta, children }: ToolRowProps) {
  const { t } = useTranslation();
  const ambient = useContext(RendererDefaultsContext);
  const [open, toggle, setOpen] = useToggle(expandKey, ambient.defaultExpanded);
  // A search hit inside opens the row once per query (review rule (m)):
  // keyed on the query itself, so a collapse while it matches holds and a
  // new matching query opens it again.
  useEffect(() => {
    if (revealFor !== undefined && revealFor.trim() !== "") setOpen(true);
  }, [revealFor, setOpen]);
  const detailId = useId();
  const facts = open ? detailFacts(outcome, family, t) : [];
  const targetRef = useRef<HTMLSpanElement>(null);
  const targetCut = useTargetCut(targetRef, open, target);
  const kind = toolKindLabel(verb, t);

  return (
    <div data-tool-row-wrapper="" className="mt-1">
      <div
        data-tool-row=""
        data-tool-verdict={outcome.verdict}
        data-tool-lifecycle={outcome.lifecycle}
        className="flex min-h-row-tool max-sm:min-h-row-touch pointer-coarse:min-h-row-touch flex-wrap items-stretch gap-x-2 text-list"
      >
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={detailId}
          className="flex min-w-0 grow basis-56 items-center gap-2 rounded-row px-1 text-left hover:bg-surface-hover"
        >
          <ChevronRight aria-hidden="true" className={cn("w-3.5 h-3.5 shrink-0 text-fg-3 transition-transform", open && "rotate-90")} />
          <span data-tool-icon="" role="img" aria-label={kind} title={kind} className="flex shrink-0 items-center text-fg-3">
            {icon}
          </span>
          <span data-tool-verb="" className={cn("min-w-0 truncate font-medium text-fg-2", target && "max-w-1/2")} title={verb}>
            {verb}
          </span>
          {target && (
            <span ref={targetRef} className="flex min-w-0 flex-1 items-center">
              {target}
            </span>
          )}
        </button>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-caption text-fg-3">
          {meta}
          <OutcomeStatus outcome={outcome} />
        </div>
      </div>
      <div id={detailId} data-tool-detail="" hidden={!open} className={cn("pl-6", open && "mb-2 border-b border-line-faint pb-2")}>
        {open && (
          <TargetCutContext.Provider value={targetCut}>
            <div className="space-y-2 pb-2">{children}</div>
            {(detailMeta || facts.length > 0 || toolId) && (
              <div data-meta="" className="flex min-h-row-list flex-wrap items-center gap-2 text-caption text-fg-3">
                {detailMeta}
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
