import type { FlattenedMessageItem } from "../MessageViewer/types";
import { contentEntries } from "../contentRenderer/contentEntries";
import { getMessageKind } from "../MessageViewer/helpers/messageKinds";
import { legacyToolCallOutcome, toolFamily, toolOutcome } from "./toolOutcome";
import type { TranscriptBlock } from "./transcriptItems";

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Reuse the existing content pairing. This layer never walks trees or parses result evidence. */
export function transcriptBlocks(source: FlattenedMessageItem): TranscriptBlock[] {
  const message = source.message;
  const rendererSource = { ...source };
  Reflect.deleteProperty(rendererSource, "originalIndex");
  const grouped = source.isGroupLeader || source.isGroupMember || source.isProgressGroupLeader || source.isProgressGroupMember || source.isTaskOperationGroupLeader || source.isTaskOperationGroupMember;
  const arrayContent = Array.isArray(message.content) && message.content.length > 0;
  const legacyUse = message.type === "assistant" && !arrayContent ? message.toolUse : undefined;
  const content: unknown[] = arrayContent ? message.content as unknown[] : [legacyUse ?? message.content];
  const entries = grouped ? [{ kind: "item" as const, key: "group", index: 0, item: message.content }] : contentEntries(content);
  return entries.map(entry => {
    const paired = entry.kind !== "item";
    const value = paired ? entry.toolUse : entry.item;
    const index = paired ? content.indexOf(entry.toolUse) : entry.index;
    const results = entry.kind === "toolExecution" ? entry.toolResults : entry.kind === "serverExecution" ? entry.results : [];
    const call = paired || (object(value) && (value === legacyUse || ["tool_use", "server_tool_use", "mcp_tool_use"].includes(String(value.type))));
    const use = call && object(value) ? value : null;
    const family = toolFamily(String(use?.name ?? use?.tool_name ?? ""));
    const outcome = use ? (use === legacyUse ? legacyToolCallOutcome(message, use, family) : toolOutcome(use, results, family, message.provider)) : undefined;
    const input = object(use?.input) ? use.input : null;
    const path = input?.file_path ?? input?.path;
    const messageKind = getMessageKind(message);
    const prose = typeof value === "string" || (object(value) && ["text", "thinking", "redacted_thinking"].includes(String(value.type)));
    const kind: TranscriptBlock["kind"] = grouped ? "checklist" : use ? "toolRow" : ["command", "context", "agent-update", "system"].includes(messageKind) ? "notice" : prose ? "prose" : "fallback";
    return {
      id: `${message.uuid}#${index}`, messageUuid: message.uuid, contentIndex: index,
      sourceBlockIds: [index, ...results.map(result => content.indexOf(result))].map(i => `${message.uuid}#${i}`),
      kind, source: rendererSource, value, outcome,
      foldable: family === "read-search" && outcome?.lifecycle === "completed" && outcome.verdict === "succeeded",
      file: typeof path === "string" ? path : undefined,
    };
  });
}
