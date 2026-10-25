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
 * `highlight` (TR1a fix 1): with a search query, the hits in the shown
 * folder and file name are marked. A hit only in the part the relative form
 * leaves out is in `title` / `data-path`, not marked.
 */
import type { ClipboardEvent } from "react";
import { cn } from "@/lib/utils";
import { HighlightedText } from "@/components/common/HighlightedText";
import { formatPath, type PathContext } from "./path";

export interface PathTextProps {
  path: string;
  ctx?: PathContext;
  className?: string;
  /** Mark these search hits in the shown text. */
  highlight?: { searchQuery: string; isCurrentMatch?: boolean; currentMatchIndex?: number };
}

function Part({ text, highlight }: { text: string; highlight: PathTextProps["highlight"] }) {
  if (!highlight || highlight.searchQuery.trim() === "") return <>{text}</>;
  return <HighlightedText text={text} searchQuery={highlight.searchQuery} isCurrentMatch={highlight.isCurrentMatch} currentMatchIndex={highlight.currentMatchIndex} />;
}

const compact = (text: string) => text.replace(/\s+/g, "");

export function PathText({ path, ctx, className, highlight }: PathTextProps) {
  const formatted = formatPath(path, ctx);
  const display = `${formatted.dir}${formatted.name}`;

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
          <Part text={formatted.dir} highlight={highlight} />
        </span>
      )}
      <span data-path-part="name" className="min-w-0 max-w-full break-all">
        <Part text={formatted.name} highlight={highlight} />
      </span>
    </span>
  );
}
