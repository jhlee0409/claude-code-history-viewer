import type { ToolResultLike } from "./shared";

export function extractWorkflowResultText(
  results: ToolResultLike[],
): string | null {
  for (const r of results) {
    const c = r.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      for (const item of c) {
        if (
          typeof item === "object" &&
          item != null &&
          (item as Record<string, unknown>).type === "text" &&
          "text" in item
        )
          return String((item as Record<string, unknown>).text);
      }
    }
  }
  return null;
}

/**
 * Extract the workflow run id (wf_…) a Workflow tool call belongs to.
 * The launch tool_result contains the run's transcript dir, e.g.
 * "Transcript dir: …/subagents/workflows/wf_1a198a78-3be" — that run id is
 * the only stable link between the tool call and the agent transcripts
 * stored under subagents/workflows/<run>/ (#449).
 */
export function parseWorkflowRunId(results: ToolResultLike[]): string | null {
  const text = extractWorkflowResultText(results);
  if (!text) return null;
  const match = /workflows[\\/]+(wf_[A-Za-z0-9][\w.-]*)/.exec(text);
  return match?.[1] ?? null;
}

/** Workflow name declared in the script's `meta` block, if present. */
export function parseWorkflowName(script: string | null): string | null {
  if (!script) return null;
  const match = /name:\s*['"]([^'"\n]{1,120})['"]/.exec(script);
  return match?.[1] ?? null;
}
