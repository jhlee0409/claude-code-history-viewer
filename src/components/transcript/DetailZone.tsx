/**
 * DetailZone (owner option B, 2026-10-25): one zone of an opened ToolRow
 * detail — what the agent was given (`input`: a description, a prompt, a
 * question, the recorded change, the input JSON) or what came back
 * (`result`: output wells, result prose, a failure text).
 *
 * Each zone is a labelled region (`<section aria-labelledby>`) whose first
 * line is a small caption label — "Input" / "Result" in the app's locale —
 * then optional `meta` on the same line (Agent: duration · tokens · tools
 * next to "Result"; the JSON fallback's recorded keys next to "Input"). The
 * label is UI text: a drag across the zone selects the content, not the word.
 * The line wraps rather than overflowing its zone (review F1): the label
 * keeps its width, the meta moves under it when it does not fit beside it,
 * and a long unbroken token (a snake_case input key) breaks inside itself —
 * never clipped or truncated, so every key stays readable.
 *
 * The input zone has a thin rule on its left: a 1px solid border in the
 * neutral `--line-input` token, flush with the detail's left edge. It must
 * never read as OutputBlock's stderr zone, whose rule is 2px (`--line`, or
 * `--status-danger-line` when the call failed) and sits inset inside the
 * output well: different width, colour and inset. A border (not a fill), so
 * forced colours keep it. The result zone has no rule; the label alone
 * marks it.
 *
 * A zone appears only when it has content: `show={false}` renders nothing,
 * and `show="whenTargetCut"` renders only while the row cuts its target
 * (a zone whose only content is the whole target, `TargetWell`). Recorded
 * outcome facts and "Copy tool ID" are the detail meta line's, outside
 * both zones (ToolRow).
 */
import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { WhenTargetCut } from "./ToolRow";

export type DetailZoneKind = "input" | "result";

export interface DetailZoneProps {
  kind: DetailZoneKind;
  /** Caption meta on the label's line, after the label. */
  meta?: ReactNode;
  /** Whether the zone has content (default `true`); `"whenTargetCut"`: only while the row's target is cut. */
  show?: boolean | "whenTargetCut";
  children?: ReactNode;
}

const LABEL_KEY = {
  input: "toolRow.inputZone",
  result: "toolRow.resultZone",
} as const;

function Zone({ kind, meta, children }: Omit<DetailZoneProps, "show">) {
  const { t } = useTranslation();
  const labelId = useId();
  return (
    <section data-detail-zone={kind} aria-labelledby={labelId} className={cn("space-y-1", kind === "input" && "border-l border-line-input pl-3")}>
      <div data-zone-label="" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-3">
        <span id={labelId} className="shrink-0 select-none">
          {t(LABEL_KEY[kind])}
        </span>
        {meta != null && meta !== false && (
          <span data-zone-meta="" className="flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-1 break-words *:min-w-0">
            {meta}
          </span>
        )}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function DetailZone({ show = true, ...zone }: DetailZoneProps) {
  if (show === false) return null;
  if (show === "whenTargetCut") {
    return (
      <WhenTargetCut>
        <Zone {...zone} />
      </WhenTargetCut>
    );
  }
  return <Zone {...zone} />;
}
