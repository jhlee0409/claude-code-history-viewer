import { memo } from "react";
import { UnifiedToolExecutionRenderer } from "./UnifiedToolExecutionRenderer";
import type { BaseRendererProps } from "../renderers";

/**
 * ToolUseRenderer (TR1b): a `tool_use` that reaches a render path without
 * its result — a top-level block without a string id
 * (`ClaudeContentArrayRenderer`), a `tool_use` nested in a tool result's
 * content array (`ContentArrayRenderer`), a message's legacy `toolUse`
 * field (`ClaudeToolUseDisplay`).
 *
 * It is the paired path's own card (`UnifiedToolExecutionRenderer`: the
 * TR0 / TR1a ToolRows, the D-R1 name → body table for any other name) with
 * the results it was given — none on these paths, so the row says "No
 * result recorded" (neutral; a history viewer has nothing pending). The
 * sixteen legacy `toolUseRenderers/*` cards it used to switch between are
 * absorbed into those patterns and deleted (amendment 9); routing is by the
 * recorded name only (D-R1): the old input-shape sniffing (`file_path` +
 * `content` → "File creation", `old_string` + `new_string` → edit,
 * `description` + `prompt` → "Task") is gone, and an unknown name gets the
 * honest JSON of its whole input instead.
 *
 * Every rendered instance needs its own expand scope: callers wrap each
 * entry in an `ExpandKeyProvider` (an id-less call's row key is the same for
 * every id-less call).
 */
interface ToolUseRendererProps extends BaseRendererProps {
  toolUse: Record<string, unknown>;
  /** The call's results when the caller paired them (nested arrays); none by default. */
  toolResults?: Record<string, unknown>[];
}

const NO_RESULTS: Record<string, unknown>[] = [];

export const ToolUseRenderer = memo(function ToolUseRenderer({
  toolUse,
  toolResults = NO_RESULTS,
  searchQuery,
  isCurrentMatch,
  currentMatchIndex,
}: ToolUseRendererProps) {
  return (
    <UnifiedToolExecutionRenderer
      toolUse={toolUse}
      toolResults={toolResults}
      searchQuery={searchQuery}
      isCurrentMatch={isCurrentMatch}
      currentMatchIndex={currentMatchIndex}
    />
  );
});
