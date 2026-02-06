export interface NavigatorEntryData {
  uuid: string;
  role: "user" | "assistant" | "system" | "summary";
  /** First ~100 chars of text content, stripped of XML/markdown */
  preview: string;
  /** ISO timestamp */
  timestamp: string;
  /** Whether this message contains tool use */
  hasToolUse: boolean;
  /** Sequential turn index (visible entries only) */
  turnIndex: number;
}
