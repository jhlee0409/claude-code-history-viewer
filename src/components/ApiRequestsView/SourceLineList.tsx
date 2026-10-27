import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, X, Minus, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SourceLine } from "@/types/apiView.types";
import { ApiContent } from "./ApiContent";
import { JumpLink } from "./JumpLink";
import { anchors, useApiNav } from "./navigation";
import { clockStamp, previewHeadline } from "./format";
import { Num } from "@/lib/format/Num";

/** Whether the line's text reached the request; links to the message it is in. */
function InRequestMark({ line, requestId }: { line: SourceLine; requestId: string | null }) {
  const { t } = useTranslation();
  const [Icon, color, key] =
    line.in_request === true
      ? [Check, "text-success", "messageViewer.apiView.inRequest"]
      : line.in_request === false
        ? [X, "text-destructive", "messageViewer.apiView.notInRequest"]
        : [Minus, "text-muted-foreground", "messageViewer.apiView.unchecked"];
  const label = t(key);
  const mark = (
    <span role="img" aria-label={label} title={label} className={cn("shrink-0", color)}>
      <Icon className="w-3.5 h-3.5" />
    </span>
  );
  if (requestId == null || line.found_in == null) return mark;
  return (
    <JumpLink requestId={requestId} anchor={anchors.message(requestId, line.found_in)}>
      <span title={t("messageViewer.apiView.foundIn", { index: line.found_in })}>{mark}</span>
    </JumpLink>
  );
}

/** The tool call a tool result answers or a hook ran around, as a link. */
function ToolLink({ line }: { line: SourceLine }) {
  const { t } = useTranslation();
  const nav = useApiNav();
  const call = line.tool_use_id ? nav?.links.toolUses.get(line.tool_use_id) : undefined;
  if (!call || !line.tool_use_id) return null;
  const key = line.kind === "user:tool_result" ? "messageViewer.apiView.answers" : "messageViewer.apiView.around";
  return (
    <JumpLink requestId={call.requestId} anchor={anchors.toolUse(line.tool_use_id)}>
      {t(key, { tool: call.name, n: call.number })}
    </JumpLink>
  );
}

interface RowProps {
  line: SourceLine;
  /** The request the line fed; `null` for lines outside every request. */
  requestId: string | null;
  /** The message this line is, verbatim, in that request. */
  sameAs: number | undefined;
  defaultOpen: boolean;
}

function SourceLineRow({ line, requestId, sameAs, defaultOpen }: RowProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li id={requestId ? anchors.line(requestId, line.line) : undefined} className="py-1 rounded-row">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-muted-foreground hover:text-foreground shrink-0"
          aria-expanded={open}
          aria-label={t("messageViewer.apiView.lineToggle", { line: line.line })}
        >
          <Chevron className="w-3.5 h-3.5" />
        </button>
        <InRequestMark line={line} requestId={requestId} />
        <span data-mono="id" className="font-mono text-muted-foreground tabular-nums w-14 shrink-0">L{line.line}</span>
        <span data-mono="code" className="font-mono shrink-0">{line.kind}</span>
        {line.label && (
          <span className={cn("shrink-0", line.label === "error" ? "text-destructive" : "text-muted-foreground")}>
            {line.label}
          </span>
        )}
        <ToolLink line={line} />
        {line.timestamp && (
          <span className="text-muted-foreground tabular-nums shrink-0"><Num>{clockStamp(line.timestamp)}</Num></span>
        )}
        {requestId != null && sameAs != null && (
          <JumpLink requestId={requestId} anchor={anchors.message(requestId, sameAs)}>
            {t("messageViewer.apiView.sameAsMessage", { index: sameAs })}
          </JumpLink>
        )}
        {!open && <span className="truncate text-muted-foreground min-w-0 flex-1">{previewHeadline(line.preview)}</span>}
      </div>
      {open && (
        <div className="ml-8">
          {/* A tool result's link to its call is already in the row. */}
          <ApiContent content={line.content} toolLinks={line.kind !== "user:tool_result"} />
        </div>
      )}
    </li>
  );
}

interface SourceLineListProps {
  lines: SourceLine[];
  requestId?: string | null;
  /** Line number → index of the message that line is, verbatim. */
  sameAs?: ReadonlyMap<number, number>;
}

/**
 * Transcript lines with everything they say. Inside a request a line is
 * open, unless it is one of the request's messages verbatim (then it links
 * there instead of repeating it) or put no text into the context (then all
 * it has is its record). Lines outside every request start closed.
 */
export function SourceLineList({ lines, requestId = null, sameAs }: SourceLineListProps) {
  return (
    <ul className="space-y-0">
      {lines.map((line) => {
        const same = sameAs?.get(line.line);
        return (
          <SourceLineRow
            key={line.line}
            line={line}
            requestId={requestId}
            sameAs={same}
            defaultOpen={requestId != null && same == null && !line.record}
          />
        );
      })}
    </ul>
  );
}
