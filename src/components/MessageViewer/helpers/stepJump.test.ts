import { describe, expect, it } from "vitest";
import type { VirtualItem } from "@tanstack/react-virtual";
import type { ClaudeMessage } from "../../../types";
import type { FlattenedMessage, FlattenedMessageItem } from "../types";
import { buildStepTurns, findStepIndex, findStepReference, isStepRow, type StepReference } from "./stepJump";

const message = (uuid: string, fields: Record<string, unknown>): ClaudeMessage =>
  ({ uuid, timestamp: "2026-11-18T10:00:00Z", sessionId: "s", ...fields }) as unknown as ClaudeMessage;

const prompt = (uuid: string) => message(uuid, { type: "user", content: `Prompt ${uuid}` });
const reply = (uuid: string) =>
  message(uuid, { type: "assistant", content: [{ type: "text", text: `Reply ${uuid}` }] });
/** A tool call with its result merged in, as the backend loads it. */
const toolCall = (uuid: string) =>
  message(uuid, {
    type: "assistant",
    content: [{ type: "tool_use", id: `call-${uuid}`, name: "Bash", input: { command: "ls" } }],
    toolUse: { id: `call-${uuid}`, name: "Bash" },
    toolUseResult: { stdout: "ok" },
  });
const context = (uuid: string) =>
  message(uuid, { type: "user", content: "<system-reminder>injected</system-reminder>" });
const agentUpdate = (uuid: string) =>
  message(uuid, {
    type: "user",
    content: "<task-notification><task-id>t1</task-id><status>completed</status><summary>Done</summary></task-notification>",
  });

const row = (msg: ClaudeMessage, flags: Partial<FlattenedMessageItem> = {}): FlattenedMessage => ({
  type: "message",
  message: msg,
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
const divider: FlattenedMessage = { type: "date-divider", timestamp: "2026-11-18T00:00:00Z" };

// p1: r1 t1 r2 | p2: t2 r3
const messages = [prompt("p1"), reply("r1"), toolCall("t1"), reply("r2"), prompt("p2"), toolCall("t2"), reply("r3")];
const rows = messages.map((msg) => row(msg));
const turns = buildStepTurns(messages);
const at = (index: number, scrolledPast = false): StepReference => ({ index, scrolledPast });
const uuidAt = (list: readonly FlattenedMessage[], index: number | null) => {
  const item = index === null ? undefined : list[index];
  return item?.type === "message" ? item.message.uuid : null;
};
const step = (reference: StepReference, direction: "previous" | "next", list = rows, stepTurns = turns) =>
  uuidAt(list, findStepIndex(list, reference, direction, stepTurns, false));

describe("buildStepTurns", () => {
  it("groups messages into the outline's turns and marks their prompts", () => {
    expect(turns.turnOf.get("r1")).toBe(turns.turnOf.get("p1"));
    expect(turns.turnOf.get("r2")).toBe(turns.turnOf.get("p1"));
    expect(turns.turnOf.get("t2")).toBe(turns.turnOf.get("p2"));
    expect(turns.turnOf.get("t2")).not.toBe(turns.turnOf.get("r2"));
    expect([...turns.starts]).toEqual(["p1", "p2"]);
  });

  it("starts a turn at an agent update, as the outline does", () => {
    const withUpdate = buildStepTurns([prompt("p1"), reply("r1"), agentUpdate("u1"), reply("r2")]);
    expect(withUpdate.turnOf.get("r2")).toBe(withUpdate.turnOf.get("u1"));
    expect(withUpdate.turnOf.get("r2")).not.toBe(withUpdate.turnOf.get("r1"));
  });

  it("puts a row the outline drops into the turn it sits in", () => {
    const empty = message("e1", { type: "assistant", content: [] });
    const withEmpty = buildStepTurns([prompt("p1"), reply("r1"), empty, prompt("p2")]);
    expect(withEmpty.turnOf.get("e1")).toBe(withEmpty.turnOf.get("p1"));
  });
});

describe("isStepRow", () => {
  it("counts assistant replies and tool calls, not prompts, injected context or folded rows", () => {
    const ctxTurns = buildStepTurns([prompt("p1"), context("c1"), reply("r1")]);
    expect(isStepRow(row(reply("r1")), ctxTurns, false)).toBe(true);
    expect(isStepRow(row(toolCall("t1")), turns, false)).toBe(true);
    expect(isStepRow(row(prompt("p1")), ctxTurns, false)).toBe(false);
    expect(isStepRow(row(context("c1")), ctxTurns, false)).toBe(false);
    expect(isStepRow(row(reply("r1"), { isGroupMember: true }), ctxTurns, false)).toBe(false);
    expect(isStepRow(divider, ctxTurns, false)).toBe(false);
  });

  it("skips a subagent's rows in the main view, which are collapsed there", () => {
    const sidechain = row(message("s1", { type: "assistant", isSidechain: true, content: [{ type: "text", text: "x" }] }));
    expect(isStepRow(sidechain, turns, false)).toBe(false);
    expect(isStepRow(sidechain, turns, true)).toBe(true);
  });
});

describe("findStepIndex", () => {
  it("moves to the next and previous step of the turn", () => {
    expect(step(at(1), "next")).toBe("t1");
    expect(step(at(2), "next")).toBe("r2");
    expect(step(at(3), "previous")).toBe("t1");
  });

  it("goes from a prompt to its turn's first step, and not back past it", () => {
    expect(step(at(0), "next")).toBe("r1");
    expect(step(at(0), "previous")).toBeNull();
    expect(step(at(1), "previous")).toBeNull();
  });

  it("stops at the turn's last step instead of crossing into the next turn", () => {
    expect(step(at(3), "next")).toBeNull();
    expect(step(at(6), "next")).toBeNull();
    expect(step(at(5), "previous")).toBeNull();
  });

  it("steps back to the start of a step whose head is scrolled out of view", () => {
    expect(step(at(2, true), "previous")).toBe("t1");
    expect(step(at(2, false), "previous")).toBe("r1");
  });

  it("skips date dividers, injected context and folded group members", () => {
    const list = [
      row(prompt("p1")),
      divider,
      row(context("c1")),
      row(reply("r1"), { isGroupMember: true }),
      row(toolCall("t1")),
    ];
    const listTurns = buildStepTurns([prompt("p1"), context("c1"), reply("r1"), toolCall("t1")]);
    expect(step(at(0), "next", list, listTurns)).toBe("t1");
    expect(step(at(4), "previous", list, listTurns)).toBeNull();
  });

  it("keeps the turns when a display filter hides the prompts", () => {
    // Only assistant rows shown; turns still come from every loaded message.
    const shown = rows.filter((item) => item.type === "message" && item.message.type === "assistant");
    expect(step(at(2), "next", shown)).toBeNull(); // r2 is p1's last step
    expect(step(at(3), "next", shown)).toBe("r3");
  });
});

describe("findStepReference", () => {
  const items = (sizes: number[]): VirtualItem[] => {
    let start = 0;
    return sizes.map((size, index) => {
      const item = { index, start, size, end: start + size, key: index, lane: 0 } as VirtualItem;
      start += size;
      return item;
    });
  };

  it("takes the first row showing more than a sliver below the top edge", () => {
    expect(findStepReference(items([100, 100, 100]), rows, 0)).toEqual({ index: 0, scrolledPast: false });
    // Row 0 shows 10px: row 1 is the one being read.
    expect(findStepReference(items([100, 100, 100]), rows, 90)).toEqual({ index: 1, scrolledPast: false });
  });

  it("marks a row whose head is above the top edge as scrolled past", () => {
    expect(findStepReference(items([100, 400, 100]), rows, 250)).toEqual({ index: 1, scrolledPast: true });
    // A jump's target sits at the top give or take subpixel rounding.
    expect(findStepReference(items([100, 400, 100]), rows, 101)).toEqual({ index: 1, scrolledPast: false });
  });

  it("ignores collapsed rows and returns null before layout", () => {
    expect(findStepReference(items([0, 100]), rows, 0)).toEqual({ index: 1, scrolledPast: false });
    expect(findStepReference([], rows, 0)).toBeNull();
  });
});
