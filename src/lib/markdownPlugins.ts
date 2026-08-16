/**
 * Shared remark/rehype plugin configuration for every ReactMarkdown instance
 * in the app (GFM + LaTeX math via KaTeX). Import this instead of
 * constructing a local plugin array so the renderers can't drift apart when
 * a plugin or option changes.
 */

import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

/** Module-level plugin arrays for stable reference across renders. */
export const REMARK_PLUGINS = [remarkGfm, remarkMath];
export const REHYPE_PLUGINS = [rehypeKatex];
