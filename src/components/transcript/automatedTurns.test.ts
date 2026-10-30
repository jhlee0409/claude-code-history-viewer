import { describe, expect, it } from "vitest";
import { buildTranscriptItems } from "./transcriptItems";
import { flattened, tool, user } from "./transcriptItems.fixtures";
import { isTurnStart } from "./isTurnStart";
import { classifyMessage } from "../MessageViewer/helpers/messageKinds";
import { applyMessageDisplayFilter } from "../MessageViewer/helpers/messageDisplayFilter";

const automatic = [
  { ...user("automatic", "<task-notification><task-id>synthetic</task-id><status>completed</status><summary>Synthetic notification</summary></task-notification>"), provider: "claude" as const },
  { ...user("automatic", "<heartbeat>Synthetic client wake</heartbeat>"), provider: "codex" as const },
];

describe("owner decision: automatic producer cycles are not human prompts", () => {
  it.each(automatic)("excludes $provider automation from user-only display/export, retaining it in all-messages", notification => {
    const messages = [user("human"), notification];
    const contentTypes = { text: true, thinking: true, toolCalls: true, commands: true, parallelTasks: true };
    expect(applyMessageDisplayFilter(messages, { roles: { user: true, assistant: false }, contentTypes }).map(message => message.uuid)).toEqual(["human"]);
    expect(applyMessageDisplayFilter(messages, { roles: { user: true, assistant: true }, contentTypes })).toEqual(messages);
  });
  it.each(automatic)("separates $provider automatic work and its summary from the human turn", notification => {
    const messages = [user("human"), tool("human-read"), notification, tool("automatic-read"), tool("automatic-failure", "Read", { content: "synthetic denied", is_error: true }), user("next-human")];
    const model = buildTranscriptItems(flattened(messages), new Map());
    expect(model.turns).toHaveLength(3);
    expect(model.turns.map(turn => ({ kind: Reflect.get(turn, "kind"), uuids: turn.blocks.map(block => block.messageUuid), summary: turn.summary }))).toEqual([
      { kind: "human", uuids: ["human", "human-read"], summary: { tools: 1, files: 1, failed: 0, unverified: 0 } },
      { kind: "automated", uuids: ["automatic", "automatic-read", "automatic-failure"], summary: { tools: 2, files: 2, failed: 1, unverified: 0 } },
      { kind: "human", uuids: ["next-human"], summary: { tools: 0, files: 0, failed: 0, unverified: 0 } },
    ]);
    expect(isTurnStart(notification, { inSubagent: false })).toBe(true);
    expect(["prompt", "command"]).not.toContain(classifyMessage(notification).kind);
    const again = buildTranscriptItems(flattened(messages), new Map(), { previous: model });
    expect(again.turns[1]).toBe(model.turns[1]);
  });

  it.each(automatic)("retains automated kind with known membership for $provider", notification => {
    const messages = [user("human"), notification, tool("automatic-read")];
    const model = buildTranscriptItems(flattened(messages), new Map([["human", 1], ["automatic", 2], ["automatic-read", 2]]));
    expect(model.turns).toHaveLength(2);
    expect(model.turns[1]).toMatchObject({ kind: "automated", ordinal: 2, partial: false, summary: { tools: 1 } });
    expect(model.turns[0]?.summary.tools).toBe(0);
  });

  it("does not invent a human or automated kind for a partial assistant-only turn", () => {
    const model = buildTranscriptItems(flattened([tool("partial")]), new Map());
    expect(model.turns[0]).toMatchObject({ kind: "unknown", partial: true });
  });

  it("does not reinterpret ordinary typed text, an unknown-provider tag, or mixed heartbeat text", () => {
    for (const message of [user("typed", "Synthetic human prompt"), user("unknown", "<heartbeat>Synthetic text</heartbeat>"), { ...user("mixed", "<heartbeat>Synthetic wake</heartbeat> Synthetic typed suffix"), provider: "codex" as const }]) {
      expect(classifyMessage(message).kind).toBe("prompt");
      expect(buildTranscriptItems(flattened([message]), new Map()).turns[0]).toMatchObject({ kind: "human" });
    }
  });
});
