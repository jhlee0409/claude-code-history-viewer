import type { MessageKind } from "../MessageViewer/helpers/messageKinds";

export interface NavigatorEntryData {
  uuid: string;
  role: "user" | "assistant" | "system" | "summary";
  /** What the row is to a reader; separates typed prompts from injected rows */
  kind: MessageKind;
  /** First ~100 chars of text content, stripped of XML/markdown; empty when the row has no text */
  preview: string;
  /** Task status for an agent update, such as "completed" or "failed" */
  status?: string;
  /** ISO timestamp */
  timestamp: string;
  /** Whether this message contains tool use */
  hasToolUse: boolean;
  /** Sequential turn index (visible entries only) */
  turnIndex: number;
}
