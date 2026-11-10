import { describe, expect, it } from "vitest";
import * as entriesModule from "../contentRenderer/ClaudeContentArrayRenderer";
import { transcriptBlocks } from "./transcriptBlocks";
import { assistant, flattened } from "./transcriptItems.fixtures";
import type { ContentItem } from "@/types";
import type { FlattenedMessageItem } from "../MessageViewer/types";

const row = (message: ReturnType<typeof assistant>) => flattened([message]).find((item): item is FlattenedMessageItem => item.type === "message")!;
describe("source envelope ownership", () => {
  it("exposes the entry renderer used by the production array path", () => {
    expect(entriesModule).toHaveProperty("ContentEntryRenderer");
  });
  it.each([null, false, 0, "", { nested: [null, false, 0, ""] }])("retains exact recorded extras %j and one prefix/suffix owner", extra => {
    const source = row({ ...assistant("m", [{ type: "image", source: { type: "url", url: "image" } }, { type: "text", text: "first" }, { type: "text", text: "last" }] as ContentItem[]), toolUseResult: extra } as ReturnType<typeof assistant>);
    const blocks = transcriptBlocks(source);
    expect(blocks.map(block => block.contentIndex)).toEqual([0, 1, 2]);
    expect(blocks.map(block => Reflect.get(block, "render"))).toEqual([
      { kind: "content", entry: { kind: "item", key: "item-0", index: 0, item: source.message.content![0] }, first: true, last: false },
      { kind: "content", entry: { kind: "item", key: "item-1", index: 1, item: source.message.content![1] }, first: false, last: false },
      { kind: "content", entry: { kind: "item", key: "item-2", index: 2, item: source.message.content![2] }, first: false, last: true },
    ]);
    for (const block of blocks) expect(Reflect.get(block.source.message, "toolUseResult")).toEqual(extra);
  });
  it("keeps paired result aliases and original indices rather than sliced positions", () => {
    const source = row(assistant("m", [{ type: "text", text: "first" }, { type: "tool_use", id: "t", name: "Read", input: {} }, { type: "tool_result", tool_use_id: "t", content: "result" }, { type: "thinking", thinking: "last" }]));
    const blocks = transcriptBlocks(source);
    expect(blocks.map(block => block.contentIndex)).toEqual([0, 1, 3]);
    expect(blocks[1]?.sourceBlockIds).toEqual(["m#1", "m#2"]);
    expect(Reflect.get(blocks[2]!, "render")).toMatchObject({ entry: { index: 3, key: "item-3" } });
  });
});
