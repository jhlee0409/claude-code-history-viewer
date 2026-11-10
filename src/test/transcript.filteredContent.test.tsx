// Regression witnesses imported from the supplementary child2 review at f11ec525.
import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ThemeProvider } from "@/contexts/theme";
import { ClaudeMessageNode } from "@/components/MessageViewer/components/ClaudeMessageNode";
import { TranscriptBlockRenderer } from "@/components/transcript/TranscriptBlockRenderer";
import { transcriptBlocks } from "@/components/transcript/transcriptBlocks";
import { buildTranscriptItems } from "@/components/transcript/transcriptItems";
import { assistant, tool, flattened } from "@/components/transcript/transcriptItems.fixtures";
import { useAppStore } from "@/store/useAppStore";
import { applyMessageDisplayFilter } from "@/components/MessageViewer/helpers/messageDisplayFilter";
import type { ContentItem } from "@/types";
import "@/i18n";

const initial = useAppStore.getState().messageFilter;
afterEach(() => { cleanup(); useAppStore.setState({ messageFilter: initial }); });

it("hidden thinking content cannot break successful calls or create a null-render block", () => {
  const first = tool("first"), second = tool("second");
  const message = assistant("mixed", [...first.content as ContentItem[], { type: "thinking", thinking: "hidden reasoning" }, ...second.content as ContentItem[]]);
  const filter = { ...initial, contentTypes: { ...initial.contentTypes, thinking: false } };
  useAppStore.setState({ messageFilter: filter });
  const filtered = applyMessageDisplayFilter([message], filter);
  expect(filtered).toHaveLength(1);
  const actual = render(<ThemeProvider><ClaudeMessageNode message={message} depth={0} /></ThemeProvider>);
  expect(actual.container.querySelectorAll("[data-tool-row]")).toHaveLength(2);
  expect(actual.container.textContent).not.toContain("hidden reasoning");
  actual.unmount();
  const row = flattened([message]).find(row => row.type === "message")!;
  if (row.type !== "message") throw new Error("missing message row");
  const hidden = transcriptBlocks(row).find(block => block.contentIndex === 2)!;
  const hiddenView = render(<ThemeProvider><TranscriptBlockRenderer block={hidden} /></ThemeProvider>);
  expect(hiddenView.container.innerHTML).toBe("");
  const options = { complete: true, contentTypes: filter.contentTypes };
  const model = buildTranscriptItems(flattened(filtered), new Map([[message.uuid, 1]]), options);
  expect(model.turns[0]!.blocks.map(block => block.contentIndex)).toEqual([0, 3]);
  expect(new Set(model.runByBlockId.values()).size).toBe(1);
  expect(model.turns[0]!.blocks[0]!.source.message).toBe(message);
});

it("hidden tool-call content cannot remain in summary tools/files", () => {
  const message = assistant("text-with-tool", [{ type: "text", text: "visible prose" }, ...tool("call").content as ContentItem[]]);
  const filter = { ...initial, contentTypes: { ...initial.contentTypes, toolCalls: false } };
  useAppStore.setState({ messageFilter: filter });
  const filtered = applyMessageDisplayFilter([message], filter);
  expect(filtered).toHaveLength(1);
  const actual = render(<ThemeProvider><ClaudeMessageNode message={message} depth={0} /></ThemeProvider>);
  expect(actual.container.textContent).toContain("visible prose");
  expect(actual.container.querySelectorAll("[data-tool-row]")).toHaveLength(0);
  const options = { complete: true, contentTypes: filter.contentTypes };
  const model = buildTranscriptItems(flattened(filtered), new Map([[message.uuid, 1]]), options);
  expect(model.turns[0]!.summary).toEqual({ tools: 0, files: 0, failed: 0, unverified: 0 });
});
