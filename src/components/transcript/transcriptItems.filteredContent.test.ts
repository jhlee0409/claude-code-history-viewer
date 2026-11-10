import { expect, it } from "vitest";
import { buildTranscriptItems, itemIndexForTarget, type TranscriptModel, type TurnChunk } from "./transcriptItems";
import { assistant, flattened, tool, user } from "./transcriptItems.fixtures";
import type { ContentItem } from "@/types";
import { supplementalRecords } from "@/test/transcript.sourceAcceptance.fixtures";

const all = { text: true, thinking: true, commands: true, toolCalls: true, parallelTasks: true };
const chunks = (model: TranscriptModel) => model.items.filter((item): item is TurnChunk => item.kind === "turn");
const projection = (model: TranscriptModel) => ({
  blocks: model.turns.flatMap(turn => turn.blocks.map(block => block.value)),
  summary: model.turns.map(turn => turn.summary),
  runs: [...new Set(model.runByBlockId.values())].map(run => run.blocks.map(block => block.value)),
  chunks: chunks(model).map(chunk => [chunk.entries.length, chunk.posinset, chunk.setsize]),
});
const build = (content: unknown[], contentTypes = all, previous?: TranscriptModel, captureMode = false) => {
  const message = assistant("mixed", content as ContentItem[]);
  const options = { contentTypes, previous, captureMode, complete: true, viewportHeight: 100, estimateBlockHeight: () => 20 };
  return buildTranscriptItems(flattened([message]), new Map([["mixed", 1]]), options);
};

it.each([25, 49])("hidden entries cannot affect %i-call runs, summaries, chunk limits or explicit target coordinates", count => {
  const calls = Array.from({ length: count }, (_, i) => tool(`r${i}`).content as ContentItem[]).flat();
  const base = build(calls);
  const content = calls.flatMap((item, i) => i % 2 === 0 ? [{ type: "thinking", thinking: "hidden" }, item] : [item]);
  const filtered = { ...all, thinking: false };
  const hidden = build(content, filtered);
  expect(projection(hidden)).toEqual(projection(base));
  expect(hidden.turns[0]!.blocks.map(block => block.contentIndex)).toEqual(Array.from({ length: count }, (_, i) => i * 3 + 1));
  expect(hidden.turns[0]!.blocks.every(block => block.source.message.content === content)).toBe(true);
  for (const capture of [false, true]) {
    const original = build(calls, all, undefined, capture);
    const inserted = build(content, filtered, undefined, capture);
    expect(projection(inserted)).toEqual(projection(original));
    expect(itemIndexForTarget(inserted, { messageUuid: "mixed" })?.itemIndex)
      .toBe(itemIndexForTarget(original, { messageUuid: "mixed" })?.itemIndex);
    expect(itemIndexForTarget(inserted, { messageUuid: "mixed" })?.blockId).toBe("mixed#1");
    for (let i = 0; i < count; i++) {
      expect(itemIndexForTarget(inserted, { messageUuid: "mixed", contentIndex: i * 3 })).toBeNull();
      for (const result of [0, 1]) {
        expect(itemIndexForTarget(inserted, { messageUuid: "mixed", contentIndex: i * 3 + 1 + result })?.itemIndex)
          .toBe(itemIndexForTarget(original, { messageUuid: "mixed", contentIndex: i * 2 + result })?.itemIndex);
      }
    }
  }
});

it.each([
  ["thinking", { type: "thinking", thinking: "hidden" }],
  ["thinking", { type: "redacted_thinking", data: "hidden" }],
  ["text", { type: "text", text: "hidden" }],
  ["commands", { type: "command", content: "<command-name>/help</command-name>" }],
] as const)("%s filter transitions recompute visibility without stale cached blocks", (key, entry) => {
  const content = [...tool("a").content as ContentItem[], entry, ...tool("b").content as ContentItem[]];
  const visible = build(content);
  expect(new Set(visible.runByBlockId.values()).size).toBe(0);
  const hidden = build(content, { ...all, [key]: false }, visible);
  expect(hidden.turns[0]!.blocks.map(block => block.contentIndex)).toEqual([0, 3]);
  expect(new Set(hidden.runByBlockId.values()).size).toBe(1);
  const restored = build(content, all, hidden);
  expect(projection(restored)).toEqual(projection(visible));
  expect(restored.turns[0]!.blocks[1]!.value).toBe(entry);
});

it("tool filters remove call/result aliases, summary counts and whole hidden rows, not surrounding prose", () => {
  const content = [{ type: "text", text: "visible" }, ...tool("a").content as ContentItem[]];
  const visible = build(content);
  const hidden = build(content, { ...all, toolCalls: false }, visible);
  expect(hidden.turns[0]!.summary).toEqual({ tools: 0, files: 0, failed: 0, unverified: 0 });
  expect(hidden.turns[0]!.blocks.map(block => block.contentIndex)).toEqual([0]);
  expect(itemIndexForTarget(hidden, { messageUuid: "mixed", contentIndex: 2 })).toBeNull();
  expect(projection(build(content, all, hidden))).toEqual(projection(visible));
  const onlyHidden = build(tool("a").content as ContentItem[], { ...all, toolCalls: false });
  expect(onlyHidden.turns).toHaveLength(0);
  // Flatten's date separator remains a non-article source boundary.
  expect(chunks(onlyHidden)).toHaveLength(0);
  expect(onlyHidden.items.every(item => item.kind === "date-divider")).toBe(true);
});

it("malformed null-render entries cannot break runs, but visible empty/fallback entries still do", () => {
  const malformed = [{ type: "thinking" }, { type: "thinking", thinking: "" }, { type: "text", text: 0 }, { type: "command", content: "" }, { type: "image" }, { type: "document" }, { type: "search_result" }];
  const calls = [...tool("a").content as ContentItem[], ...tool("b").content as ContentItem[]];
  const content = [...calls.slice(0, 2), ...malformed, ...calls.slice(2)];
  expect(projection(build(content))).toEqual(projection(build(calls)));
  for (const entry of [{ type: "text", text: "" }, { type: "unknown", nested: { null: null, false: false, zero: 0 } }, false, 0]) {
    const model = build([...calls.slice(0, 2), entry, ...calls.slice(2)]);
    expect(model.turns[0]!.blocks).toHaveLength(3);
    expect(new Set(model.runByBlockId.values()).size).toBe(0);
  }
});

it("hidden whole rows with different membership cannot split the displayed turn", () => {
  const messages = [tool("a"), assistant("hidden", [{ type: "thinking", thinking: "hidden" }]), tool("b")];
  const options = { complete: true, contentTypes: { ...all, thinking: false } };
  const model = buildTranscriptItems(flattened(messages), new Map([["a", 1], ["hidden", 2], ["b", 1]]), options);
  expect(model.turns).toHaveLength(1);
  expect(new Set(model.runByBlockId.values()).size).toBe(1);
});

it("assistant-only filters do not remove user content or mutate source entries", () => {
  const message = user("u", [{ type: "text", text: "human" }, { type: "thinking", thinking: "retained" }]);
  const options = { contentTypes: { ...all, text: false, thinking: false } };
  const model = buildTranscriptItems(flattened([message]), new Map(), options);
  expect(model.turns[0]!.blocks.map(block => block.contentIndex)).toEqual([0, 1]);
  expect(model.turns[0]!.blocks.every(block => block.source.message === message)).toBe(true);
});

it.each(["default array FileChange", "legacy with array siblings"])("keeps once-only source extras when every array entry is filtered: %s", name => {
  const message = supplementalRecords.find(([label]) => label === name)![1];
  const options = { contentTypes: { ...all, text: false, thinking: false } };
  const model = buildTranscriptItems(flattened([message]), new Map(), options);
  expect(model.turns).toHaveLength(1);
  expect(model.turns[0]!.blocks).toHaveLength(1);
  const block = model.turns[0]!.blocks[0]!;
  expect(block.render.kind).toBe("source");
  expect(block.source.message).toBe(message);
  expect(block.foldable).toBe(false);
});
