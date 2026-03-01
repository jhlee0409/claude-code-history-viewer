/**
 * Shared Markdown renderer with centralized plugin configuration.
 *
 * Wraps ReactMarkdown with remarkGfm and a consistent `layout.prose` wrapper.
 * Use this for all simple markdown rendering across the app.
 *
 * For advanced use cases (custom components like CollapsibleTable, custom prose
 * classes), use ReactMarkdown directly with remarkGfm.
 */

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { layout } from "@/components/renderers";
import { cn } from "@/lib/utils";

/** Module-level plugin array for stable reference across renders. */
const REMARK_PLUGINS = [remarkGfm];

interface MarkdownProps {
  children: string;
  /** Additional classes merged with `layout.prose` on the wrapper div. */
  className?: string;
}

export const Markdown = memo(function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn(layout.prose, className)}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
        {children}
      </ReactMarkdown>
    </div>
  );
});
