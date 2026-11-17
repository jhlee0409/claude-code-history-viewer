import { describe, expect, it } from "vitest";
import type { ClaudeMessage } from "../../../types";
import { getFilteredClassifiedMessages } from "../classifiedRows";
import { groupTurns } from "./groupTurns";
import { buildTurnOfMessage } from "./turnOfMessage";

const makeMessage = (overrides: Record<string, unknown>): ClaudeMessage => ({
  uuid: "message",
  type: "user",
  role: "user",
  timestamp: "2026-09-26T06:29:32.477Z",
  content: "",
  ...overrides,
} as unknown as ClaudeMessage);

describe("buildTurnOfMessage", () => {
  it("maps every raw message uuid to the turn it falls in, including noise and empty rows", () => {
    const messages: ClaudeMessage[] = [
      // Leading, before any prompt.
      makeMessage({ uuid: "noise1", type: "progress", data: { type: "agent_progress" } }),
      makeMessage({ uuid: "p1", content: "First prompt" }),
      makeMessage({
        uuid: "r1",
        type: "assistant",
        role: "assistant",
        content: [{ type: "text", text: "First reply." }],
      }),
      // A noise row and an empty row inside the first turn.
      makeMessage({ uuid: "noise2", type: "queue-operation", operation: "enqueue" }),
      makeMessage({ uuid: "empty1", content: "" }),
      makeMessage({ uuid: "p2", content: "Second prompt" }),
      makeMessage({
        uuid: "r2",
        type: "assistant",
        role: "assistant",
        content: [{ type: "text", text: "Second reply." }],
      }),
    ];

    const turns = groupTurns(getFilteredClassifiedMessages(messages));
    const map = buildTurnOfMessage(messages, turns);

    expect(map.get("noise1")).toBeNull();
    expect(map.get("p1")).toBe("p1");
    expect(map.get("r1")).toBe("p1");
    expect(map.get("noise2")).toBe("p1");
    expect(map.get("empty1")).toBe("p1");
    expect(map.get("p2")).toBe("p2");
    expect(map.get("r2")).toBe("p2");
  });

  it("maps every message to null when the window has no turn start at all", () => {
    const messages: ClaudeMessage[] = [
      makeMessage({ uuid: "noise1", type: "progress", data: { type: "agent_progress" } }),
      makeMessage({ uuid: "out1", content: "<local-command-stdout>ok</local-command-stdout>" }),
    ];

    const turns = groupTurns(getFilteredClassifiedMessages(messages));
    const map = buildTurnOfMessage(messages, turns);

    expect(map.get("noise1")).toBeNull();
    expect(map.get("out1")).toBeNull();
  });

  it("returns an empty map for no messages", () => {
    expect(buildTurnOfMessage([], [])).toEqual(new Map());
  });
});
