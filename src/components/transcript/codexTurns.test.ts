import { describe, expect, it } from "vitest";
import type { ClaudeMessage } from "@/types";
import { getFilteredClassifiedMessages } from "../MessageNavigator/classifiedRows";
import { groupTurns } from "../MessageNavigator/outline/groupTurns";
import { applyMessageDisplayFilter } from "../MessageViewer/helpers/messageDisplayFilter";
import { buildTranscriptItems } from "./transcriptItems";
import { flattened, tool, user } from "./transcriptItems.fixtures";

const turn = (id: string) => ({ started: { type: "task_started", turn_id: id }, context: { turn_id: id, model: "synthetic" } });
const withTurn = (message: ClaudeMessage, id: string): ClaudeMessage => ({ ...message, provider: "codex", codexEvidence: { turn: turn(id) } });
const goal = (id: string) => withTurn(user(id, '<codex_internal_context source="user_goal">Synthetic goal</codex_internal_context>'), id);
const humanOnly = { roles: { user: true, assistant: false }, contentTypes: { text: true, thinking: true, toolCalls: true, commands: true, parallelTasks: true } };

describe("Codex producer turn identity through real model and outline routes", () => {
  it("separates consecutive no-input producer cycles without numbering them as prompts", () => {
    const messages = [withTurn(user("human"), "h"), withTurn(tool("human-tool"), "h"), goal("g1"), withTurn(tool("goal-tool1"), "g1"), goal("g2"), withTurn(tool("goal-tool2"), "g2"), withTurn(user("next"), "n")];
    const model = buildTranscriptItems(flattened(messages), new Map());
    expect(model.turns.map(t => [t.kind, t.summary.tools])).toEqual([["human", 1], ["automated", 1], ["automated", 1], ["human", 0]]);
    const outline = groupTurns(getFilteredClassifiedMessages(messages));
    expect(outline.map(t => [t.kind, t.turnNumber, t.counts.toolCalls])).toEqual([["human", 1, 1], ["automated", null, 1], ["automated", null, 1], ["human", 2, 0]]);
    expect(applyMessageDisplayFilter(messages, humanOnly).map(m => m.uuid)).toEqual(["human", "next"]);
    expect(buildTranscriptItems(flattened(messages), new Map(), { previous: model }).turns[1]).toBe(model.turns[1]);
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
    const messages = [withTurn(user("human"), "h"), withTurn(tool("startup"), "g"), goal("g"), withTurn(tool("work"), "g")];
    expect(buildTranscriptItems(flattened(messages), new Map()).turns.map(t => [t.kind, t.summary.tools])).toEqual([["human", 0], ["automated", 2]]);
    expect(groupTurns(getFilteredClassifiedMessages(messages)).map(t => [t.kind, t.counts.toolCalls])).toEqual([["human", 0], ["automated", 2]]);
  });

  it("retains known memberships and canonical starts without inventing ordinals", () => {
    const messages = [withTurn(user("human"), "h"), goal("g"), withTurn(tool("work"), "g")];
    expect(buildTranscriptItems(flattened(messages), new Map([["human", 1], ["g", 2], ["work", 2]])).turns.map(t => [t.kind, t.ordinal])).toEqual([["human", 1], ["automated", 2]]);
  });
});
