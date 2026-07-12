/**
 * Size thresholds for rendering large tool/file content.
 *
 * Prism tokenization emits a <div> per line and a <span> per token — a
 * multi-MB Write/Read payload inside one virtualized row freezes the UI and
 * wrecks row-height estimation. Above HIGHLIGHT_MAX_CHARS content renders as
 * plain text; above PLAIN_PREVIEW_CHARS it is truncated with an explicit
 * "show all" opt-in.
 */

export const HIGHLIGHT_MAX_CHARS = 50_000;

export const PLAIN_PREVIEW_CHARS = 200_000;

export const isTooLargeToHighlight = (content: string): boolean =>
  content.length > HIGHLIGHT_MAX_CHARS;

/** "12.3 KB" / "4.5 MB" style label for a JS string's UTF-16 length. */
export const formatCharSize = (chars: number): string => {
  if (chars < 1024) return `${chars} chars`;
  const kb = chars / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
};
