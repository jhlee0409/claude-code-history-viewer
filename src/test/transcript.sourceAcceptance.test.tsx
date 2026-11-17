import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ContentItem } from "@/types";
import type { FlattenedMessageItem } from "@/components/MessageViewer/types";
import type { TranscriptBlock } from "@/components/transcript/transcriptItems";
import { ClaudeMessageNode } from "@/components/MessageViewer/components/ClaudeMessageNode";
import { TranscriptBlockRenderer } from "@/components/transcript/TranscriptBlockRenderer";
import { transcriptBlocks } from "@/components/transcript/transcriptBlocks";
import { buildTranscriptItems, itemIndexForTarget } from "@/components/transcript/transcriptItems";
import { ThemeProvider } from "@/contexts/theme";
import { CodexFileChangeProvider } from "@/components/transcript/CodexFileChanges";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { assistant } from "@/components/transcript/transcriptItems.fixtures";
import { ResultProviderContext } from "@/components/transcript/resultProvider";
import { groupCases, producerDiff, rawExtras, sourceCases, sourceRow } from "./transcript.sourceAcceptance.fixtures";
import i18n from "@/i18n";

const options = { searchQuery: "needle", isMatch: true, isCurrentMatch: true, currentMatchIndex: 1 };
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
afterEach(() => {
  cleanup(); useExpandRegistry.getState().clearAll(); vi.restoreAllMocks(); window.getSelection()?.removeAllRanges();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});
function wrapper(source: FlattenedMessageItem, children: ReactNode) {
  return <ThemeProvider><CodexFileChangeProvider messages={[source.message]}>{children}</CodexFileChangeProvider></ThemeProvider>;
}
function legacy(source: FlattenedMessageItem) {
  return <ClaudeMessageNode {...options} message={source.message} depth={source.depth}
    agentTaskGroup={source.agentTaskGroup} isAgentTaskGroupMember={source.isGroupMember}
    agentProgressGroup={source.agentProgressGroup} isAgentProgressGroupMember={source.isProgressGroupMember}
    taskOperationGroup={source.taskOperationGroup} isTaskOperationGroupMember={source.isTaskOperationGroupMember}
    taskRegistry={source.taskRegistry} hideHeader={source.isContinuation} />;
}
function bridge(blocks: TranscriptBlock[]) {
  return blocks.map((block, index) => <TranscriptBlockRenderer key={`${block.id}:${index}`} block={block} {...options} />);
}
function body(container: HTMLElement, blocks: TranscriptBlock[]) {
  return blocks[0]?.render.kind === "content"
    ? container.querySelector<HTMLElement>('[data-message-uuid] > .max-w-4xl > .w-full')!
    : container;
}
function canonical(node: HTMLElement) { return node.innerHTML.replace(/_r_[a-z0-9]+_/g, "REACT_ID"); }
function signature(container: HTMLElement) {
  // Walk text and media together: independent text/image lists miss a moved image.
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  const ordered: string[][] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) ordered.push(["text", node.textContent ?? ""]);
    if (node instanceof HTMLImageElement) ordered.push(["image", node.src, node.alt]);
  }
  return {
    ordered,
    pres: [...container.querySelectorAll("pre")].map(node => node.textContent),
    marks: [...container.querySelectorAll("mark")].map(node => [node.textContent, node.className]),
    data: [...container.querySelectorAll("*")].flatMap(node => [...node.attributes].filter(attr => attr.name.startsWith("data-")).map(attr => [attr.name, attr.value])),
    controls: [...container.querySelectorAll("button")].map(node => [node.textContent, node.title, node.getAttribute("aria-label"), node.getAttribute("aria-expanded")]),
    registry: { ...useExpandRegistry.getState().states },
  };
}
function openAll(container: HTMLElement) {
  // Nested group items appear only after their parent opens.
  for (let depth = 0; depth < 10; depth++) {
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]:not([aria-haspopup])')];
    if (!buttons.length) return;
    for (const button of buttons) fireEvent.click(button);
  }
  throw new Error("disclosure expansion did not converge");
}
async function copyPayloads(container: HTMLElement) {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  try {
    for (const button of container.querySelectorAll<HTMLButtonElement>("button")) {
      if (/copy/i.test(`${button.title} ${button.getAttribute("aria-label")} ${button.textContent}`)) {
        await act(async () => { fireEvent.click(button); });
      }
    }
    return writeText.mock.calls.map(([value]) => value as string);
  } finally {
    if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
}

describe("TR3 source acceptance", () => {
  it.each(sourceCases)("whole-record %s preserves closed/open order, data keys, copy bytes and expansion ownership", async (_name, source) => {
    const blocks = transcriptBlocks(source);
    const before = render(wrapper(source, legacy(source)));
    const expectedClosed = signature(body(before.container, blocks));
    const expectedDom = canonical(before.container);
    openAll(before.container);
    const expectedOpen = signature(body(before.container, blocks));
    const expectedCopy = await copyPayloads(body(before.container, blocks));
    before.unmount();
    useExpandRegistry.getState().clearAll();
    const after = render(wrapper(source, bridge(blocks)));
    expect(signature(after.container)).toEqual(expectedClosed);
    if (blocks[0]?.render.kind === "source") expect(canonical(after.container)).toBe(expectedDom);
    openAll(after.container);
    expect(signature(after.container)).toEqual(expectedOpen);
    expect(await copyPayloads(after.container)).toEqual(expectedCopy);
    const positiveNeedles: Record<string, string[]> = {
      "snapshot present": ["recorded.ts"],
      "legacy with array siblings": ["prefix needle", "reason needle", "tail needle", "legacy needle"],
      "source extras": ["nested needle"],
      "command item stdout": ["stdout needle"],
      "remaining entry families": ["reminder needle", "search needle", "result needle", "file-needle", "nested needle"],
      "tasks": ["description 0 needle", "description 1 needle", "prompt 0 needle", "prompt 1 needle"],
      "agent-progress": ["progress needle"],
      "operations": ["operation needle"],
    };
    for (const needle of positiveNeedles[_name] ?? []) expect(after.container.textContent).toContain(needle);
    if (_name.startsWith("paired ") || _name.startsWith("orphan ")) {
      const type = _name.replace(/^(paired|orphan) /, "");
      const needle = ({ web_search_tool_result: "web needle", web_fetch_tool_result: "fetch needle", code_execution_tool_result: "code needle", bash_code_execution_tool_result: "bash needle", text_editor_code_execution_tool_result: "editor needle", tool_search_tool_result: "needle", advisor_tool_result: "advisor needle", mcp_tool_result: "mcp needle" } as Record<string, string>)[type]!;
      expect(after.container.textContent).toContain(needle);
    }
    if (_name.includes("FileChange")) {
      expect(after.container.querySelectorAll("[data-codex-file-change]")).toHaveLength(1);
      expect(after.container.textContent).toContain("producer-needle");
      // A copy menu has separate interaction tests; the recorded diff remains exact.
      expect(source.message.codexEvidence?.fileChanges?.[0]?.record).toEqual(expect.objectContaining({ type: "event_msg" }));
      expect(JSON.stringify(source.message.codexEvidence)).toContain(JSON.stringify(producerDiff).slice(1, -1));
    }
  });

  it.each(groupCases)("uses a real nonempty %s leader and aliases every hidden member", (route, rows) => {
    expect(rows).toHaveLength(2);
    const blocks = transcriptBlocks(rows[0]!);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.render).toEqual({ kind: "source", route });
    const model = buildTranscriptItems(rows, new Map());
    const leaderIndex = itemIndexForTarget(model, { messageUuid: rows[0]!.message.uuid });
    expect(leaderIndex).not.toBeNull();
    expect(itemIndexForTarget(model, { messageUuid: rows[1]!.message.uuid })).toEqual(leaderIndex);
  });

  it("retains exact nested null/false/zero/empty extras through the opened source body", () => {
    const source = sourceRow(assistant("extras", [{ type: "future", ...rawExtras }]));
    const view = render(wrapper(source, bridge(transcriptBlocks(source))));
    expect(JSON.parse(view.container.querySelector("pre")!.textContent!)).toEqual({ type: "future", ...rawExtras });
  });

  it("copies full recorded group paths, not displayed basenames", async () => {
    const source = groupCases[0]![1][0]!;
    const view = render(wrapper(source, bridge(transcriptBlocks(source))));
    openAll(view.container);
    expect(await copyPayloads(view.container)).toEqual(["/recorded/task-a.jsonl", "/recorded/task-b.jsonl"]);
  });

  it("copies the exact producer FileChange patch through the source-owned menu", async () => {
    const source = sourceCases.find(([name]) => name === "default array FileChange")![1];
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const view = render(wrapper(source, bridge(transcriptBlocks(source))));
    const trigger = view.container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    trigger.focus(); fireEvent.keyDown(trigger, { key: "Enter" });
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: i18n.t("diffView.copyPatch") })));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(producerDiff);
    // Radix defers its focus-scope teardown; flush it before JSDOM disappears.
    view.unmount();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  });

  it("keeps original source-index disclosure nodes, selection and current mark on append", () => {
    const message = assistant("identity", [
      { type: "thinking", thinking: "first reasoning" },
      { type: "tool_use", id: "call", name: "Read", input: {} },
      { type: "tool_result", tool_use_id: "call", content: "result" },
      { type: "thinking", thinking: "second reasoning" },
      { type: "text", text: "selected needle needle" },
    ]);
    const view = (source: FlattenedMessageItem) => wrapper(source, bridge(transcriptBlocks(source)));
    const result = render(view(sourceRow(message)));
    const buttons = [...result.container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')];
    const last = buttons.at(-1)!;
    fireEvent.click(last); last.focus();
    expect(useExpandRegistry.getState().states["identity:item-3:thinking-3"]).toBe(true);
    expect(buttons[0]).toHaveAttribute("aria-expanded", "false");
    const mark = result.container.querySelector("mark")!;
    const range = document.createRange(); range.selectNodeContents(mark);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    result.rerender(view(sourceRow({ ...message, content: [...message.content as ContentItem[], { type: "text", text: "appended" }] })));
    expect(result.container.querySelectorAll('button[aria-expanded]')[buttons.length - 1]).toBe(last);
    expect(document.activeElement).toBe(last);
    expect(window.getSelection()!.toString()).toBe("needle");
    expect(result.container.querySelector("mark")).toBe(mark);
    expect(result.container.querySelectorAll("mark")[1]?.className).toContain("current");
  });

  it.each(["codex", "claude"])("preserves explicit %s provider over inherited context", provider => {
    const source = sourceRow({ ...assistant("provider", [
      { type: "tool_use", id: "provider-call", name: "custom", input: {} },
      { type: "tool_result", tool_use_id: "provider-call", content: "needle", toolUseResult: { metadata: { exit_code: 7 } } },
    ]), provider });
    const view = render(<ResultProviderContext.Provider value={provider === "codex" ? "claude" : "codex"}>{wrapper(source, bridge(transcriptBlocks(source)))}</ResultProviderContext.Provider>);
    expect(view.container.querySelector("[data-tool-row]")).toHaveAttribute("data-tool-verdict", provider === "codex" ? "failed" : "unknown");
  });

  it.each(["delete", "duplicate", "reindex"])("the same parity oracle rejects a %s source-block mutation", mutation => {
    const source = sourceRow(assistant("mutation", [
      { type: "tool_use", id: "call", name: "Read", input: {} },
      { type: "tool_result", tool_use_id: "call", content: "result needle" },
      { type: "thinking", thinking: "retained reasoning needle" },
      { type: "text", text: "tail needle" },
    ]));
    const blocks = transcriptBlocks(source);
    const before = render(wrapper(source, legacy(source))); openAll(before.container);
    const expected = signature(body(before.container, blocks));
    before.unmount(); useExpandRegistry.getState().clearAll();
    const control = render(wrapper(source, bridge(blocks))); openAll(control.container);
    expect(signature(control.container)).toEqual(expected);
    control.unmount(); useExpandRegistry.getState().clearAll();
    const mutated = mutation === "delete" ? blocks.filter(block => block.contentIndex !== 2)
      : mutation === "duplicate" ? [...blocks, blocks[1]!]
      : blocks.map((block, index): TranscriptBlock => block.render.kind === "content" && block.render.entry.kind === "item"
        ? { ...block, contentIndex: index, render: { ...block.render, entry: { ...block.render.entry, index, key: `item-${index}` } } } : block);
    const after = render(wrapper(source, bridge(mutated))); openAll(after.container);
    const actual = signature(after.container);
    if (mutation === "reindex") {
      // Reindexing also defeats first-text ownership and duplicates the prefix.
      expect(actual.ordered.filter(([kind, text]) => kind === "text" && text === "tail ")).toHaveLength(2);
      expect(actual.registry["mutation:item-1:thinking-1"]).toBe(true);
      expect(actual.registry).not.toHaveProperty("mutation:item-2:thinking-2");
    } else {
      expect(actual.ordered.filter(([kind, text]) => kind === "text" && text === "retained reasoning ").length).toBe(mutation === "delete" ? 0 : 2);
    }
    // Only an assertion mismatch counts; missing providers/import/setup errors escape.
    expect(() => expect(actual).toEqual(expected)).toThrowError(expect.objectContaining({ name: "AssertionError" }));
  });
});
