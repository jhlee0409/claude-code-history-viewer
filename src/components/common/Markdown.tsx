/**
 * Shared Markdown renderer with centralized plugin configuration.
 *
 * Wraps ReactMarkdown with remarkGfm + remarkMath/rehypeKatex (renders
 * `$inline$` and `$$block$$` LaTeX as formulas) and a consistent
 * `layout.prose` wrapper. Use this for all simple markdown rendering across
 * the app.
 *
 * For advanced use cases (custom components like CollapsibleTable, custom prose
 * classes), use ReactMarkdown directly with the same plugin set.
 */

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { layout } from "@/components/renderers";
import { cn } from "@/lib/utils";

/** Module-level plugin arrays for stable reference across renders. */
const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [rehypeKatex];

interface MarkdownProps {
  children: string;
  /** Additional classes merged with `layout.prose` on the wrapper div. */
  className?: string;
}

export const Markdown = memo(function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn(layout.prose, className)}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
});
