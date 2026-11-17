/**
 * PathText: a file path as the app shows it (plan §4.4, F3a).
 *
 * Renders `formatPath`'s display — relative to the message cwd, the project
 * or `~`, else whole — and keeps the recorded path one hover or copy away:
 * `title` and copying the whole text give the full path, and `data-path` /
 * `data-path-kind` let tests and the capture probes check the rule.
 *
 * The file name is never cut. Only the folder part ellipsises, and in a
 * narrow column the name wraps onto its own line instead of being shortened.
 *
 * Not for code or command output: paths inside an output block or a code
 * block stay exactly as recorded.
 *
 * `highlight` (TR1a fix 1, fix 2): with a search query, the hits in the
 * whole shown path are found once and their marks spread onto the folder and
 * file-name parts. A hit across the split is two pieces, the folder's with
 * `data-search-hit-part="start"`, the name's with `"end"`; the current match
 * is the n-th hit of the whole path, its first piece the scroll target. A
 * hit only in the part the relative form leaves out is in `title` /
 * `data-path`, not marked (a routed body that shortens a path keeps it in
 * its other-recorded-fields JSON then). No query: the markup is as before.
 */
import type { ClipboardEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { searchMarkBaseClass, searchMarkCurrentClass, searchMarkOtherClass } from "@/components/common/HighlightedText";
import { searchRanges } from "@/components/common/searchMarks";
import { formatPath, type PathContext } from "./path";

export interface PathTextProps {
  path: string;
  ctx?: PathContext;
  className?: string;
  /** Mark these search hits in the shown text. */
  highlight?: { searchQuery: string; isCurrentMatch?: boolean; currentMatchIndex?: number };
}

type Highlight = NonNullable<PathTextProps["highlight"]>;

/**
 * One part of the shown path (`text`, starting at `from` in the whole shown
 * string), with the pieces of the whole path's hits that fall in it marked.
 */
function Part({ text, from, hits, highlight }: { text: string; from: number; hits: [number, number][]; highlight?: Highlight }) {
  if (!highlight || hits.length === 0) return <>{text}</>;
  const to = from + text.length;
  const out: ReactNode[] = [];
  let at = from;
  hits.forEach(([start, end], index) => {
    const pieceStart = Math.max(start, from);
    const pieceEnd = Math.min(end, to);
    if (pieceStart >= pieceEnd) return;
    if (pieceStart > at) out.push(text.slice(at - from, pieceStart - from));
    const active = (highlight.isCurrentMatch ?? false) && index === (highlight.currentMatchIndex ?? 0);
    // The hit's first piece carries the scroll target (one per hit).
    const target = active && start >= from;
    const piece = start < from ? "end" : end > to ? "start" : undefined;
    out.push(
      <mark
        key={start}
        data-search-hit-part={piece}
        {...(target ? { "data-search-highlight": "current" } : {})}
        aria-current={target ? "true" : undefined}
        className={cn(searchMarkBaseClass, active ? searchMarkCurrentClass : searchMarkOtherClass, piece === "start" && "pr-0", piece === "end" && "pl-0")}
      >
        {text.slice(pieceStart - from, pieceEnd - from)}
      </mark>,
    );
    at = pieceEnd;
  });
  if (at < to) out.push(text.slice(at - from));
  return <>{out}</>;
}

const compact = (text: string) => text.replace(/\s+/g, "");

export function PathText({ path, ctx, className, highlight }: PathTextProps) {
  const formatted = formatPath(path, ctx);
  const display = `${formatted.dir}${formatted.name}`;
  const hits = highlight ? searchRanges(display, highlight.searchQuery) : [];

  // Copying the whole shortened text copies the path it stands for; a partial
  // selection copies just what was selected.
  const onCopy = (event: ClipboardEvent<HTMLSpanElement>) => {
    const selected = window.getSelection()?.toString() ?? "";
    if (compact(selected) !== compact(display)) return;
    event.clipboardData.setData("text/plain", formatted.full);
    event.preventDefault();
  };

  return (
    <span
      data-path={formatted.full}
      data-path-kind={formatted.kind}
      data-mono="path"
      title={formatted.full}
      onCopy={onCopy}
      className={cn("inline-flex min-w-0 max-w-full flex-wrap font-mono", className)}
    >
      {formatted.dir && (
        <span data-path-part="dir" className="min-w-0 max-w-full truncate">
          <Part text={formatted.dir} from={0} hits={hits} highlight={highlight} />
        </span>
      )}
      <span data-path-part="name" className="min-w-0 max-w-full break-all">
        <Part text={formatted.name} from={formatted.dir.length} hits={hits} highlight={highlight} />
      </span>
    </span>
  );
}
