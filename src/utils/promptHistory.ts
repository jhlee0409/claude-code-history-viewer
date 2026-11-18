import type { ClaudeSession } from "@/types";

/**
 * `storage_type` of a Claude Code session whose transcript is gone: only the
 * prompts the user sent survive, read from Claude Code's `history.jsonl`
 * (#764). No replies, tool calls or token usage, and no file of its own, so
 * it cannot be renamed, moved, deleted or resumed.
 */
export const PROMPT_HISTORY_STORAGE_TYPE = "prompt_history";

export function isPromptHistorySession(
  session: Pick<ClaudeSession, "storage_type"> | null | undefined,
): boolean {
  return session?.storage_type === PROMPT_HISTORY_STORAGE_TYPE;
}
