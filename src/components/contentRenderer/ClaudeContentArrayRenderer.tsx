/** Production message-array path: normalize once, retain original source keys. */
import { memo, useMemo } from "react";
import { contentEntries } from "./contentEntries";
import { ContentEntryRenderer, type ContentEntryOptions } from "./ContentEntryRenderer";
export { ContentEntryRenderer } from "./ContentEntryRenderer";

type Props = ContentEntryOptions & { content: unknown[] };
export const ClaudeContentArrayRenderer = memo(({ content, ...options }: Props) => {
  const entries = useMemo(() => Array.isArray(content) ? contentEntries(content) : [], [content]);
  const firstTextIndex = Array.isArray(content) ? content.findIndex(item => item !== null && typeof item === "object" && (item as Record<string, unknown>).type === "text") : -1;
  if (!entries.length) return null;
  return <div className="space-y-2 text-caption">{entries.map(entry =>
    <ContentEntryRenderer key={entry.key} entry={entry} firstTextIndex={firstTextIndex} {...options} />
  )}</div>;
});
ClaudeContentArrayRenderer.displayName = "ClaudeContentArrayRenderer";
