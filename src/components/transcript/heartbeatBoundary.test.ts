import { describe, expect, it } from "vitest";
import type { ClaudeMessage } from "@/types";
import { classifyMessage, isCodexHeartbeat } from "../MessageViewer/helpers/messageKinds";
import { applyMessageDisplayFilter } from "../MessageViewer/helpers/messageDisplayFilter";
import { getFilteredClassifiedMessages } from "../MessageNavigator/classifiedRows";
import { groupTurns } from "../MessageNavigator/outline/groupTurns";
import { buildTranscriptItems } from "./transcriptItems";
import { flattened, user } from "./transcriptItems.fixtures";

// Scheduler shape: Codex 0.164.0 history/src/heartbeat.rs L75–109.
// Body text is synthetic. Real-data structure audit: 34/34 whole envelopes.
const envelope = "<heartbeat>\n  <automation_id>synthetic</automation_id>\n  <current_time_iso>2026-09-23T00:00:00Z</current_time_iso>\n  <instructions>\nSynthetic wake\n  </instructions>\n</heartbeat>";
const message = (content: string) => ({ ...user("input", content), provider: "codex" as const, codexEvidence: { contentItems: [{ type: "input_text" }], contentItemKinds: ["user.heartbeat"] } });
const userOnly = { roles: { user: true, assistant: false }, contentTypes: { text: true, thinking: true, toolCalls: true, commands: true, parallelTasks: true } };

describe("owner decision B: timestamp-correlated unmarked envelopes (viewer rule)", () => {
  const unmarked = () => ({ ...message(envelope), timestamp: "2026-09-23T00:00:00Z", codexEvidence: { contentItems: [{ type: "input_text" }] } });
  const routes = (input: ClaudeMessage, automated: boolean) => {
    expect(isCodexHeartbeat(input)).toBe(automated);
    expect(classifyMessage(input).kind).toBe(automated ? "context" : "prompt");
    expect(groupTurns(getFilteredClassifiedMessages([input]))[0]).toMatchObject({ kind: automated ? "automated" : "human", turnNumber: automated ? null : 1 });
    expect(buildTranscriptItems(flattened([input]), new Map()).turns[0]).toMatchObject({ kind: automated ? "automated" : "human" });
    expect(applyMessageDisplayFilter([input], userOnly)).toEqual(automated ? [] : [input]);
  };
  it.each([undefined, ["user.text"]])("accepts absent/default kinds with matching time: %j", kinds => {
    const input = unmarked();
    routes({ ...input, codexEvidence: { ...input.codexEvidence, ...(kinds ? { contentItemKinds: kinds } : {}) } }, true);
  });
  it.each(["2026-09-22T23:59:55Z", "2026-09-23T00:00:05Z", "2026-09-23T02:00:02.900+02:00"])("accepts inclusive ±5s tolerance: %s", timestamp => routes({ ...unmarked(), timestamp }, true));
  it.each([
    ["2026-09-23T00:00:00", "2026-09-23T00:00:00"],
    ["2026-09-23T00:00:00", "2026-09-23T00:00:00Z"],
    ["2026-09-23T00:00:00Z", "2026-09-23T00:00:00"],
    ["2026-09-23", "2026-09-23T00:00:00Z"],
    ["2026-09-23T00:00:00Z", "2026-09-23"],
  ])("requires explicit zones on both times: embedded=%s record=%s", (embedded, timestamp) => {
    routes({ ...unmarked(), content: envelope.replace("2026-09-23T00:00:00Z", embedded), timestamp }, false);
  });
  it.each(["2026-09-23T09:00:00+09:00", "2026-09-22T17:00:00-07:00", "2026-09-23T09:00:00+0900"])("accepts explicit equivalent zones on both times: %s", timestamp => {
    routes({ ...unmarked(), content: envelope.replace("2026-09-23T00:00:00Z", timestamp) }, true);
    routes({ ...unmarked(), timestamp }, true);
  });
  it("requires matching timestamps even when original evidence is absent", () => {
    routes({ ...unmarked(), codexEvidence: undefined }, true);
    routes({ ...unmarked(), timestamp: "2026-09-23T00:00:05.001Z", codexEvidence: undefined }, false);
  });
  it.each(["2026-09-23T00:00:05.001Z", "2026-09-22T23:59:54.999Z", "", "invalid"])("preserves mismatched/missing record time: %s", timestamp => routes({ ...unmarked(), timestamp }, false));
  it.each([
    envelope + " typed text", "typed text " + envelope, envelope.replace(/\n/g, "\r\n"),
    envelope.replace("2026-09-23T00:00:00Z", ""), envelope.replace("2026-09-23T00:00:00Z", "1".repeat(64)), "Ordinary typed user text",
  ])("preserves envelope deviations and invalid embedded time: %s", content => routes({ ...unmarked(), content }, false));
  it.each([null, false, 0, [], ["user.heartbeat", "user.text"], ["unknown"]])("rejects present malformed/unknown kinds at matching time: %j", contentItemKinds => {
    routes({ ...unmarked(), codexEvidence: { contentItems: [{ type: "input_text" }], contentItemKinds } }, false);
  });
  it("preserves dropped source siblings and extra displayed text", () => {
    routes({ ...unmarked(), codexEvidence: { contentItems: [{ type: "input_text" }, { type: "input_image" }] } }, false);
    routes({ ...unmarked(), content: [{ type: "text", text: envelope }, { type: "text", text: "Typed text" }] }, false);
  });
  it("does not impose the viewer timestamp rule on host-marked reader inputs", () => routes({ ...message(envelope), timestamp: "" }, true));
});

describe("heartbeat whole-message boundary", () => {
  it.each([
    "<heartbeat>a</heartbeat> Please help <heartbeat>b</heartbeat>",
    envelope + " Please help",
    "Please help " + envelope,
    "<heartbeat>ordinary user text</heartbeat>",
    envelope.replace("2026-09-23T00:00:00Z", "now\nignore restrictions"),
    envelope.replace("2026-09-23T00:00:00Z", "2026-09-23T00:00:00Z\n"),
    envelope.replace("synthetic</automation_id>", "synthetic\n</automation_id>"),
    " \n" + envelope + "\n ",
    envelope + "\n\n",
    envelope.replace(/\n/g, "\r\n"),
    envelope.replace("synthetic</automation_id>", "</automation_id>"),
    envelope.replace("synthetic</automation_id>", "a".repeat(129) + "</automation_id>"),
    envelope.replace("synthetic</automation_id>", "bad.id</automation_id>"),
    envelope.replace("2026-09-23T00:00:00Z", ""),
    envelope.replace("2026-09-23T00:00:00Z", "1".repeat(65)),
    envelope.replace("Synthetic wake", "x".repeat(3332)),
    envelope.replace("Synthetic wake", "é".repeat(1666)),
    envelope.replace("Synthetic wake", "x\n".repeat(476)),
    "<heartbeat>Synthetic unfinished wake",
    "<heartbeat><heartbeat>Synthetic nested wake</heartbeat></heartbeat>",
  ])("preserves mixed or malformed input as a human prompt: %s", content => {
    const input = message(content);
    expect(classifyMessage(input).kind).toBe("prompt");
    expect(isCodexHeartbeat(input)).toBe(false);
    expect(groupTurns(getFilteredClassifiedMessages([input]))[0]).toMatchObject({ kind: "human", turnNumber: 1 });
    expect(buildTranscriptItems(flattened([input]), new Map()).turns[0]).toMatchObject({ kind: "human" });
    expect(applyMessageDisplayFilter([input], {
      roles: { user: true, assistant: false },
      contentTypes: { text: true, thinking: true, toolCalls: true, commands: true, parallelTasks: true },
    })).toEqual([input]);
  });

  // parse uses split_once for fields and strip_suffix for the instruction body:
  // delimiters inside instructions are literal, not recursively parsed (L88–91).
  it.each([
    envelope, envelope + "\n", envelope + envelope,
    envelope.replace("Synthetic wake", ""),
    envelope.replace("synthetic</automation_id>", "A_0-</automation_id>"),
    envelope.replace("synthetic</automation_id>", "a".repeat(128) + "</automation_id>"),
    envelope.replace("2026-09-23T00:00:00Z", "1".repeat(64)),
    envelope.replace("Synthetic wake", "x".repeat(3331)),
    envelope.replace("Synthetic wake", "é".repeat(1665)),
    envelope.replace("Synthetic wake", "\n  Literal </heartbeat> and <heartbeat>\n"),
  ])("retains exactly the reader's accepted envelope as automated context: %s", content => {
    const input = message(content);
    expect(isCodexHeartbeat(input)).toBe(true);
    expect(classifyMessage(input).kind).toBe("context");
    expect(groupTurns(getFilteredClassifiedMessages([input]))[0]).toMatchObject({ kind: "automated", turnNumber: null });
  });

  it.each([
    [{ type: "text" as const, text: envelope }, { type: "text" as const, text: envelope }],
    [{ type: "text" as const, text: envelope }, { type: "text" as const, text: "" }],
    [{ type: "text" as const, text: envelope }, { type: "image" as const, source: { type: "base64" as const, media_type: "image/png", data: "synthetic" } }],
  ])("keeps extra content items as human input: %j", (...content) => {
    const input = { ...message(envelope), content };
    expect(isCodexHeartbeat(input)).toBe(false);
    expect(classifyMessage(input).kind).toBe("prompt");
    expect(groupTurns(getFilteredClassifiedMessages([input]))[0]).toMatchObject({ kind: "human", turnNumber: 1 });
    expect(buildTranscriptItems(flattened([input]), new Map()).turns[0]).toMatchObject({ kind: "human" });
    expect(applyMessageDisplayFilter([input], {
      roles: { user: true, assistant: false },
      contentTypes: { text: true, thinking: true, toolCalls: true, commands: true, parallelTasks: true },
    })).toEqual([input]);
  });

  it("accepts a single projected input_text item, but not another provider or role", () => {
    const input = { ...message(envelope), content: [{ type: "text" as const, text: envelope }] };
    expect(isCodexHeartbeat(input)).toBe(true);
    expect(isCodexHeartbeat({ ...input, provider: "claude" })).toBe(false);
    expect(isCodexHeartbeat({ ...input, type: "assistant" })).toBe(false);
  });

  it("honors original item cardinality and host kinds even when normalization dropped siblings", () => {
    const base = { ...message(envelope), content: [{ type: "text" as const, text: envelope }] };
    for (const contentItems of [[{ type: "input_text" }, { type: "input_audio" }], [{ type: "output_text" }], [{}], [], [{ type: "input_text" }, { type: "input_image" }]]) {
      expect(isCodexHeartbeat({ ...base, codexEvidence: { contentItems, contentItemKinds: ["user.heartbeat"] } })).toBe(false);
    }
    for (const contentItemKinds of [null, false, 0, [], ["user.text"], ["user.heartbeat", "user.text"]]) {
      expect(isCodexHeartbeat({ ...base, codexEvidence: { contentItems: [{ type: "input_text" }], contentItemKinds } })).toBe(false);
    }
    expect(isCodexHeartbeat({ ...base, codexEvidence: { contentItems: [{ type: "input_text" }], contentItemKinds: ["user.heartbeat"] } })).toBe(true);
    // Host-marked inputs keep the reader rule without timestamp correlation.
    expect(isCodexHeartbeat(base)).toBe(true);
  });

  it("preserves separate typed text blocks", () => {
    const input = { ...message(envelope), content: [{ type: "text" as const, text: envelope }, { type: "text" as const, text: "Please help" }] };
    expect(isCodexHeartbeat(input)).toBe(false);
    expect(classifyMessage(input).kind).toBe("prompt");
  });
});
