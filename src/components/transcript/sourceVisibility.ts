import type { ClaudeMessage } from "@/types";
import type { FlattenedMessageItem } from "../MessageViewer/types";
import { isEmptyMessage } from "../MessageViewer/helpers/messageHelpers";
import { sourceRoute } from "./sourceEnvelope";

/** The message renderer's early-return policy, shared with the data projection. */
export function sourceVisibility(message: ClaudeMessage, inSubagent: boolean, member: boolean): "visible" | "member" | "hidden" {
  if (message.isSidechain && !inSubagent) return "hidden";
  if (member) return "member";
  if (isEmptyMessage(message)) return "hidden";
  return "visible";
}

export function rowVisibility(row: FlattenedMessageItem, inSubagent = false) {
  if (sourceRoute(row) === "snapshot" && row.message.type === "file-history-snapshot" && !row.message.snapshot) return "hidden";
  return sourceVisibility(row.message, inSubagent, row.isGroupMember || row.isProgressGroupMember || row.isTaskOperationGroupMember);
}
