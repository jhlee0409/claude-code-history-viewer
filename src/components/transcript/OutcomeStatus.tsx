/**
 * OutcomeStatus (plan §4.2 screen rules, TR0; shared since TR0b): what a
 * collapsed tool call says about its outcome, from `toolOutcome` alone.
 *
 * - succeeded / unknown: nothing (`null`) — no pill, no "Completed".
 * - no result: an `--fg-3` dashed circle + "No result recorded".
 * - interrupted: a warning pause icon + "Interrupted".
 * - failed: a danger icon + "Failed", "Failed · exit code N" (only a recorded
 *   N) or "Failed · <API error code>".
 *
 * Each state has its own icon shape and words, never a colour alone. ToolRow
 * and the cards that keep their own frame (WebFetch, WebSearch, Agent,
 * AskUserQuestion, Workflow, Default) render this one element; its text size
 * comes from the caption line that holds it.
 */
import { CircleDashed, CirclePause, CircleX } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { ToolOutcome } from "./toolOutcome";

function failedLabel(outcome: ToolOutcome, t: TFunction): string {
  if (outcome.errorCode !== undefined) return t("toolOutcome.failedErrorCode", { code: outcome.errorCode });
  if (outcome.exitCode !== undefined) return t("toolOutcome.failedExitCode", { code: outcome.exitCode });
  return t("toolOutcome.failed");
}

/** What the collapsed call says; `null` = quiet. */
export function OutcomeStatus({ outcome }: { outcome: ToolOutcome }) {
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
