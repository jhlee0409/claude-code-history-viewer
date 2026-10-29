import type { ClaudeMessage, ContentItem } from "@/types";
import { flattenMessageTree } from "../MessageViewer/helpers/flattenMessageTree";
import type { FlattenedMessage } from "../MessageViewer/types";

export const user = (uuid: string, content: ClaudeMessage["content"] = uuid): ClaudeMessage => ({ uuid, content, type: "user", role: "user", sessionId: "s", timestamp: "2026-01-01T12:00:00Z" });
export const assistant = (uuid: string, content: ClaudeMessage["content"] = uuid): ClaudeMessage => ({ ...user(uuid, content), type: "assistant", role: "assistant" });
export const flattened = (messages: ClaudeMessage[]): FlattenedMessage[] => flattenMessageTree({ messages, agentTaskGroups: new Map(), agentTaskMemberUuids: new Set(), agentProgressGroups: new Map(), agentProgressMemberUuids: new Set(), taskOperationGroups: new Map(), taskOperationMemberUuids: new Set() });
export const member = (...entries: [string, number | null][]) => new Map(entries);
export const tool = (uuid: string, name = "Read", result: Record<string, unknown> | null = { content: "ok" }) => assistant(uuid, [
  { type: "tool_use", id: uuid, name, input: { file_path: `/project/${uuid}.ts` } },
  ...(result === null ? [] : [{ type: "tool_result", tool_use_id: uuid, ...result }]),
] as ContentItem[]);
