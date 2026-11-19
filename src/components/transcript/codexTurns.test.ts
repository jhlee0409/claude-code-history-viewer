import { describe, expect, it } from "vitest";
import type { ClaudeMessage } from "@/types";
import { getFilteredClassifiedMessages } from "../MessageNavigator/classifiedRows";
import { groupTurns } from "../MessageNavigator/outline/groupTurns";
import { applyMessageDisplayFilter } from "../MessageViewer/helpers/messageDisplayFilter";
import { buildTranscriptItems } from "./transcriptItems";
import { retainLoadedCodexStarts } from "./codexTurns";
import { assistant } from "./transcriptItems.fixtures";
import { flattenMessageTree } from "../MessageViewer/helpers/flattenMessageTree";
import { flattened, tool, user } from "./transcriptItems.fixtures";

const turn = (id: string) => ({ started: { type: "task_started", turn_id: id }, context: { turn_id: id, model: "synthetic" } });
const withTurn = (message: ClaudeMessage, id: string): ClaudeMessage => ({ ...message, provider: "codex", codexEvidence: { turn: turn(id) } });
const goal = (id: string) => withTurn(user(id, '<codex_internal_context source="user_goal">Synthetic goal</codex_internal_context>'), id);
const start = (id: string): ClaudeMessage => ({ ...withTurn(user(`start-${id}`), id), type: "progress", role: "system", data: { type: "waiting_for_task", status: "started", taskId: id } });
const humanOnly = { roles: { user: true, assistant: false }, contentTypes: { text: true, thinking: true, toolCalls: true, commands: true, parallelTasks: true } };

describe("Codex producer turn identity through real model and outline routes", () => {
  it.each([false, true])("carries an empty automated start to the first retained same-cycle outline row (previous identity %s)", identified => {
    const prior = identified ? withTurn(user("human"), "h") : user("human");
    const empty = withTurn(assistant("empty", [{ type: "text", text: "  " }]), "g");
    const messages = [prior, start("g"), empty, { ...goal("g"), timestamp: "2026-01-02T12:00:00Z" }, withTurn(tool("work"), "g")];
    for (const visible of [messages, retainLoadedCodexStarts(messages, messages.filter(m => m.type !== "progress"))]) {
      const outline = groupTurns(getFilteredClassifiedMessages(visible));
      expect(outline.map(t => [t.kind, t.counts.toolCalls])).toEqual([["human", 0], ["automated", 1]]);
      expect(outline[1]?.turnStartUuid).toBe("g");
      expect(buildTranscriptItems(flattened(visible), new Map()).turns.map(t => [t.kind, t.summary.tools])).toEqual([["human", 0], ["automated", 1]]);
    }
    const hidden = flattenMessageTree({ messages, hiddenMessageIds: ["empty"], agentTaskGroups: new Map(), agentTaskMemberUuids: new Set(), agentProgressGroups: new Map(), agentProgressMemberUuids: new Set(), taskOperationGroups: new Map(), taskOperationMemberUuids: new Set() });
    expect(hidden.some(row => row.type === "hidden-placeholder")).toBe(true);
    expect(buildTranscriptItems(hidden, new Map()).turns.map(t => [t.kind, t.summary.tools])).toEqual([["human", 0], ["automated", 1]]);
    expect(groupTurns(getFilteredClassifiedMessages(messages.filter(m => m.uuid !== "empty"))).map(t => t.kind)).toEqual(["human", "automated"]);
    // Cropping away the actual loaded marker must not promote copied turn evidence.
    expect(groupTurns(getFilteredClassifiedMessages(messages.slice(2))).map(t => t.kind)).toEqual(["unknown"]);
  });
  it("separates consecutive no-input producer cycles without numbering them as prompts", () => {
    const messages = [withTurn(user("human"), "h"), withTurn(tool("human-tool"), "h"), start("g1"), goal("g1"), withTurn(tool("goal-tool1"), "g1"), start("g2"), goal("g2"), withTurn(tool("goal-tool2"), "g2"), withTurn(user("next"), "n")];
    const model = buildTranscriptItems(flattened(messages), new Map());
    expect(model.turns.map(t => [t.kind, t.summary.tools])).toEqual([["human", 1], ["automated", 1], ["automated", 1], ["human", 0]]);
    const outline = groupTurns(getFilteredClassifiedMessages(messages));
    expect(outline.map(t => [t.kind, t.turnNumber, t.counts.toolCalls])).toEqual([["human", 1, 1], ["automated", null, 1], ["automated", null, 1], ["human", 2, 0]]);
    expect(applyMessageDisplayFilter(messages, humanOnly).filter(m => m.type === "user").map(m => m.uuid)).toEqual(["human", "next"]);
    expect(buildTranscriptItems(flattened(messages), new Map(), { previous: model }).turns[1]).toBe(model.turns[1]);
  });
  it("keeps a human turn tail unknown when its start progress and prompt are outside the window", () => {
    const messages = [withTurn(user("env", "<environment_context>cwd</environment_context>"), "h"), withTurn(user("prompt", "Please fix the bug"), "h"), withTurn(tool("work1"), "h"), withTurn(user("later-env", "<environment_context>cwd</environment_context>"), "h"), withTurn(tool("work2"), "h")];
    const window = messages.slice(2);
    expect(groupTurns(getFilteredClassifiedMessages(window)).map(t => t.kind)).toEqual(["unknown"]);
    expect(buildTranscriptItems(flattened(window), new Map()).turns.map(t => t.kind)).toEqual(["unknown"]);
    expect(applyMessageDisplayFilter(window, humanOnly).map(m => m.uuid)).toContain("later-env");
  });
  it("does not mistake a completion progress row carrying copied started evidence for the start", () => {
    const completion = { ...start("h"), uuid: "end-h", data: { type: "task_complete", status: "completed", taskId: "h" } };
    const messages = [withTurn(tool("tail-work"), "h"), withTurn(user("tail-context", "<environment_context>cwd</environment_context>"), "h"), completion];
    expect(groupTurns(getFilteredClassifiedMessages(messages)).map(t => t.kind)).toEqual(["unknown"]);
    expect(buildTranscriptItems(flattened(messages), new Map()).turns.map(t => t.kind)).toEqual(["unknown"]);
  });
  it("keeps literal wrappers without a loaded producer start out of automated ownership", () => {
    const messages = [withTurn(user("h"), "h"), withTurn(user("literal", "<environment_context>my notes</environment_context>"), "literal"), withTurn(tool("work"), "literal")];
    expect(groupTurns(getFilteredClassifiedMessages(messages)).map(t => t.kind)).toEqual(["human", "unknown"]);
    expect(buildTranscriptItems(flattened(messages), new Map()).turns.map(t => t.kind)).toEqual(["human", "unknown"]);
    expect(applyMessageDisplayFilter(messages, humanOnly).map(m => m.uuid)).toContain("literal");
  });
  it("keeps one model turn per automated outline cycle including loaded progress", () => {
    const messages = [withTurn(user("h"), "h"), start("g1"), withTurn(tool("startup"), "g1"), goal("g1"), withTurn(tool("work1"), "g1"), start("g2"), goal("g2"), withTurn(tool("work2"), "g2")];
    const model = buildTranscriptItems(flattened(messages), new Map());
    const outline = groupTurns(getFilteredClassifiedMessages(messages));
    expect(model.turns.filter(t => t.kind === "automated")).toHaveLength(outline.filter(t => t.kind === "automated").length);
    expect(model.turns.map(t => [t.kind, t.summary.tools])).toEqual([["human", 0], ["automated", 2], ["automated", 1]]);
    expect(model.turns.filter(t => t.kind === "automated").every(t => !t.partial)).toBe(true);
  });
  it("keeps an automated cycle whole across a date divider", () => {
    const messages = [start("g"), goal("g"), { ...withTurn(tool("next-day"), "g"), timestamp: "2026-01-02T12:00:00Z" }];
    const model = buildTranscriptItems(flattened(messages), new Map());
    expect(model.turns).toHaveLength(1);
    expect(model.items.filter(i => i.kind === "date-divider")).toHaveLength(2);
    expect(model.turns[0]?.summary.tools).toBe(1);
  });
  it("does not create a second outline boundary for a heartbeat inside its loaded automated cycle", () => {
    const heartbeat = { ...withTurn(user("heartbeat", "<heartbeat>\n  <automation_id>a</automation_id>\n  <current_time_iso>2026-01-01T00:00:00Z</current_time_iso>\n  <instructions>\nCheck\n  </instructions>\n</heartbeat>"), "g"), codexEvidence: { turn: turn("g"), contentItems: [{type: "input_text"}], contentItemKinds: ["user.heartbeat"] } };
    const messages = [start("g"), goal("g"), heartbeat, withTurn(tool("work"), "g")];
    expect(groupTurns(getFilteredClassifiedMessages(messages)).map(t => [t.kind, t.counts.toolCalls])).toEqual([["automated", 1]]);
    expect(buildTranscriptItems(flattened(messages), new Map()).turns).toHaveLength(1);
  });
  it("does not split injected goal context within a human producer turn", () => {
    const messages = [withTurn(user("human"), "h"), withTurn(goal("injected"), "h"), withTurn(tool("work"), "h")];
    expect(groupTurns(getFilteredClassifiedMessages(messages)).map(t => [t.kind, t.counts.toolCalls])).toEqual([["human", 1]]);
  });
  it("does not infer automated identity from a tag, missing/null/mismatched identities or assistant-only partial windows", () => {
    for (const evidence of [undefined, { turn: { context: { turn_id: "g" } } }, { turn: { started: { turn_id: null }, context: { turn_id: null } } }, { turn: { started: { turn_id: "other" }, context: { turn_id: "g" } } }]) {
      const messages = [user("h"), { ...goal("g"), codexEvidence: evidence }, tool("work")];
      expect(buildTranscriptItems(flattened(messages), new Map()).turns).toHaveLength(1);
    }
    expect(buildTranscriptItems(flattened([withTurn(tool("partial"), "g")]), new Map()).turns[0]?.kind).toBe("unknown");
  });
  it("stops partial producer work leaking into a preceding human turn", () => {
    const messages = [withTurn(user("human"), "h"), withTurn(tool("partial"), "g")];
    expect(buildTranscriptItems(flattened(messages), new Map()).turns.map(t => [t.kind, t.summary.tools])).toEqual([["human", 0], ["unknown", 1]]);
    expect(groupTurns(getFilteredClassifiedMessages(messages)).map(t => [t.kind, t.turnNumber, t.counts.toolCalls])).toEqual([["human", 1, 0], ["unknown", null, 1]]);
  });

  it("owns startup assistant work before a no-input cycle's contextual user fragment", () => {
    const messages = [withTurn(user("human"), "h"), start("g"), withTurn(tool("startup"), "g"), goal("g"), withTurn(tool("work"), "g")];
    expect(buildTranscriptItems(flattened(messages), new Map()).turns.map(t => [t.kind, t.summary.tools])).toEqual([["human", 0], ["automated", 2]]);
    expect(groupTurns(getFilteredClassifiedMessages(messages)).map(t => [t.kind, t.counts.toolCalls])).toEqual([["human", 0], ["automated", 2]]);
  });

  it("retains known memberships and canonical starts without inventing ordinals", () => {
    const messages = [withTurn(user("human"), "h"), start("g"), goal("g"), withTurn(tool("work"), "g")];
    expect(buildTranscriptItems(flattened(messages), new Map([["human", 1], ["start-g", 2], ["g", 2], ["work", 2]])).turns.map(t => [t.kind, t.ordinal])).toEqual([["human", 1], ["automated", 2]]);
  });
});
