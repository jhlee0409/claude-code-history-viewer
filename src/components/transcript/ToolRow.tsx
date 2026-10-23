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
 *   Opened, the detail states neutral facts: "Exit code 0", or "Result not
 *   verified · No exit code recorded" when a process left no exit code.
 * - failed: a danger icon + "Failed", "Failed · exit code N" (only a recorded
 *   N) or "Failed · <API error code>".
 * - interrupted: a warning icon + "Interrupted". no result: an `--fg-3`
 *   icon + "No result recorded". Each state has its own icon shape and words.
 *
 * The header is a disclosure (`aria-expanded` + `aria-controls`); its open
 * state lives in the capture expand registry like every renderer. The tool
 * id is reachable only through "Copy tool ID" in the opened detail.
 */
import { useCallback, useContext, useId, useState, type ReactNode } from "react";
import { Check, ChevronRight, CircleDashed, CirclePause, CircleX, Hash } from "lucide-react";
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

/** A command or query target, in the code font. */
export function CodeTarget({ text }: { text: string }) {
  return (
    <code data-mono="code" className="truncate font-mono text-code text-fg" title={text}>
      {text}
    </code>
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

/** Neutral facts for the opened detail. */
function detailFacts(outcome: ToolOutcome, family: ToolFamily, t: TFunction): string[] {
  const facts: string[] = [];
  if (outcome.lifecycle === "interrupted" && outcome.exitCode !== undefined) {
    facts.push(t("toolOutcome.exitCode", { code: outcome.exitCode }));
  } else if (outcome.verdict === "succeeded" && outcome.exitCode !== undefined) {
    facts.push(t("toolOutcome.exitCode", { code: outcome.exitCode }));
  } else if (outcome.verdict === "unknown" && outcome.lifecycle === "completed" && outcome.reason === "no-exit-code") {
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
      aria-label={t("toolRow.copyToolId")}
      title={copied ? t("toolRow.toolIdCopied") : t("toolRow.copyToolId")}
      className="ml-auto inline-flex size-6 items-center justify-center rounded-row text-fg-3 hover:bg-surface-hover hover:text-fg"
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Hash className="w-3.5 h-3.5" />}
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
          {target && <span className="flex min-w-0 flex-1 items-center">{target}</span>}
        </button>
        <div className="flex shrink-0 items-center gap-2 text-caption text-fg-3">
          {meta}
          <RowStatus outcome={outcome} />
        </div>
      </div>
      <div id={detailId} data-tool-detail="" hidden={!open} className="pl-6">
        {open && (
          <>
            {(facts.length > 0 || toolId) && (
              <div data-meta="" className="flex min-h-row-list flex-wrap items-center gap-2 text-caption text-fg-3">
                {facts.map((fact) => (
                  <span key={fact}>{fact}</span>
                ))}
                {toolId && <CopyToolId toolId={toolId} />}
              </div>
            )}
            <div className="space-y-2 pb-2">{children}</div>
          </>
        )}
      </div>
    </div>
  );
}
