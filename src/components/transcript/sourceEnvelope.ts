import type { FlattenedMessageItem } from "../MessageViewer/types";
import type { ContentEntry } from "../contentRenderer/contentEntries";

export type SourceRoute = "tasks" | "agent-progress" | "operations" | "summary" | "snapshot" | "progress" | "system" | "default";
export type BlockRender = { kind: "source"; route: SourceRoute } | { kind: "content"; entry: ContentEntry; first: boolean; last: boolean };

/** Finite ownership table: these bodies are source envelopes, never one copy per content item. */
export function sourceRoute(source: Omit<FlattenedMessageItem, "originalIndex">): SourceRoute {
  if (source.agentTaskGroup?.length) return "tasks";
  if (source.agentProgressGroup?.entries.length) return "agent-progress";
  if (source.taskOperationGroup?.length) return "operations";
  const message = source.message;
  if (message.type === "summary") return "summary";
  if (message.type === "file-history-snapshot") return "snapshot";
  if (message.type === "progress" && message.data) return "progress";
  if (message.type === "system") return "system";
  return "default";
}

export { legacyOwnership } from "../MessageViewer/helpers/sourceEnvelopeOwnership";
