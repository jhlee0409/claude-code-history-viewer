import { useTranslation } from "react-i18next";
import { Check, X, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SourceLine } from "@/types/apiView.types";
import { ApiContent } from "./ApiContent";
import { JumpLink } from "./JumpLink";
import { anchors, useApiNav } from "./navigation";
import type { OpenLines } from "./openLines";
import { clockStamp, previewHeadline } from "./format";
import { Num } from "@/lib/format/Num";

/** Whether the line's text reached the request; links to the message it is in. */
function InRequestMark({ line, requestId }: { line: SourceLine; requestId: string | null }) {
  const { t } = useTranslation();
  // Unchecked lines (no recorded messages) get no mark at all.
  if (line.in_request == null) return null;
  const [Icon, color, key] = line.in_request
    ? [Check, "text-success", "messageViewer.apiView.inRequest"]
    : [X, "text-destructive", "messageViewer.apiView.notInRequest"];
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

/** "Expand all" / "Collapse all" for a list of lines. */
export function ToggleAllLines({ state }: { state: OpenLines }) {
  const { t } = useTranslation();
  return (
    <button type="button" onClick={state.toggleAll} className="text-caption text-muted-foreground underline hover:text-foreground">
      {state.allOpen ? t("messageViewer.apiView.collapseAll") : t("messageViewer.apiView.expandAll")}
    </button>
  );
}

interface RowProps {
  line: SourceLine;
  /** The request the line fed; `null` for lines outside every request. */
  requestId: string | null;
  /** The message this line is, verbatim, in that request. */
  sameAs: number | undefined;
  open: boolean;
  onToggle: (line: number) => void;
}

function SourceLineRow({ line, requestId, sameAs, open, onToggle }: RowProps) {
  const { t } = useTranslation();
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li id={requestId ? anchors.line(requestId, line.line) : undefined} className="py-1 rounded-row">
      {/* The whole header toggles the line; the links in it do not. */}
      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption cursor-pointer"
        onClick={(e) => {
          if (!(e.target as Element).closest("button:not([data-line-toggle]), a")) onToggle(line.line);
        }}
      >
        <button
          type="button"
          data-line-toggle
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
            {line.label === "error" ? t("messageViewer.apiView.toolError") : line.label}
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
  state: OpenLines;
  requestId?: string | null;
  /** Line number → index of the message that line is, verbatim. */
  sameAs?: ReadonlyMap<number, number>;
}

/**
 * Transcript lines with everything they say, each closed to a one-line
 * header until opened. A line that is one of the request's messages
 * verbatim links there instead of repeating it.
 */
export function SourceLineList({ lines, state, requestId = null, sameAs }: SourceLineListProps) {
  return (
    <ul className="space-y-0">
      {lines.map((line) => (
        <SourceLineRow
          key={line.line}
          line={line}
          requestId={requestId}
          sameAs={sameAs?.get(line.line)}
          open={state.open.has(line.line)}
          onToggle={state.toggle}
        />
      ))}
    </ul>
  );
}
