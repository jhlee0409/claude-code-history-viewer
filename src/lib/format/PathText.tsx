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
 */
import type { ClipboardEvent } from "react";
import { cn } from "@/lib/utils";
import { formatPath, type PathContext } from "./path";

export interface PathTextProps {
  path: string;
  ctx?: PathContext;
  className?: string;
}

const compact = (text: string) => text.replace(/\s+/g, "");

export function PathText({ path, ctx, className }: PathTextProps) {
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
          {formatted.dir}
        </span>
      )}
      <span data-path-part="name" className="min-w-0 max-w-full break-all">
        {formatted.name}
      </span>
    </span>
  );
}
