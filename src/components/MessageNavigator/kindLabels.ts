import type { MessageKind } from "../MessageViewer/helpers/messageKinds";

/** i18n key of the label each navigator row shows for its kind. */
export const KIND_LABEL_KEYS = {
  prompt: "navigator.kind.prompt",
  command: "navigator.kind.command",
  "agent-update": "navigator.kind.agentUpdate",
  context: "navigator.kind.context",
  reply: "navigator.kind.reply",
  tool: "navigator.kind.tool",
  system: "navigator.kind.system",
  summary: "navigator.kind.summary",
} as const satisfies Record<MessageKind, string>;

export function getKindLabelKey(kind: MessageKind) {
  return KIND_LABEL_KEYS[kind] ?? KIND_LABEL_KEYS.system;
}
