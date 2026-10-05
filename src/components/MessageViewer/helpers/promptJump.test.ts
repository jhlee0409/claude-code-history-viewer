import { describe, expect, it } from "vitest";
import type { ClaudeMessage } from "../../../types";
import type { FlattenedMessage, FlattenedMessageItem } from "../types";
import { findTurnStartIndex } from "./promptJump";

const row = (
  uuid: string,
  overrides: Record<string, unknown>,
  flags: Partial<FlattenedMessageItem> = {},
): FlattenedMessage => ({
  type: "message",
  message: {
    uuid,
    type: "user",
    role: "user",
    timestamp: "2026-10-04T10:00:00Z",
    content: "",
    ...overrides,
  } as unknown as ClaudeMessage,
  depth: 0,
  originalIndex: 0,
  isGroupLeader: false,
  isGroupMember: false,
  isProgressGroupLeader: false,
  isProgressGroupMember: false,
  isTaskOperationGroupLeader: false,
  isTaskOperationGroupMember: false,
  isContinuation: false,
  ...flags,
});

const prompt = (uuid: string) => row(uuid, { content: `Prompt ${uuid}` });
const reply = (uuid: string) => row(uuid, {
  type: "assistant",
  role: "assistant",
  content: [{ type: "text", text: `Reply ${uuid}` }],
});
const divider: FlattenedMessage = { type: "date-divider", timestamp: "2026-10-04T00:00:00Z" };

describe("findTurnStartIndex", () => {
  // 0 prompt, 1 reply, 2 divider, 3 command, 4 command output, 5 reply, 6 prompt, 7 reply
  const rows: FlattenedMessage[] = [
    prompt("p1"),
    reply("r1"),
    divider,
    row("c1", { content: "<command-message>wrap</command-message>\n<command-name>/wrap</command-name>" }),
    row("o1", { content: "<local-command-stdout>Wrapped.</local-command-stdout>" }),
    reply("r2"),
    prompt("p2"),
    reply("r3"),
  ];

  it("moves forward past replies, dividers and command output", () => {
    expect(findTurnStartIndex(rows, 0, "next")).toBe(3);
    expect(findTurnStartIndex(rows, 3, "next")).toBe(6);
  });

  it("moves back to the start of the current turn from inside it", () => {
    expect(findTurnStartIndex(rows, 5, "previous")).toBe(3);
    expect(findTurnStartIndex(rows, 7, "previous")).toBe(6);
  });

  it("moves back to the earlier turn from a turn start", () => {
    expect(findTurnStartIndex(rows, 6, "previous")).toBe(3);
    expect(findTurnStartIndex(rows, 3, "previous")).toBe(0);
  });

  it("returns null at either end of the loaded rows", () => {
    expect(findTurnStartIndex(rows, 0, "previous")).toBeNull();
    expect(findTurnStartIndex(rows, 6, "next")).toBeNull();
  });

  it("starts from the top when no row is in view", () => {
    expect(findTurnStartIndex(rows, -1, "next")).toBe(0);
    expect(findTurnStartIndex(rows, -1, "previous")).toBeNull();
  });

  it("skips rows folded into a group and hidden-block placeholders", () => {
    const grouped: FlattenedMessage[] = [
      prompt("p1"),
      { type: "hidden-placeholder", hiddenCount: 2, hiddenUuids: ["x", "y"] },
      row("member", { content: "Folded prompt" }, { isGroupMember: true }),
      prompt("p2"),
    ];
    expect(findTurnStartIndex(grouped, 0, "next")).toBe(3);
  });
});
