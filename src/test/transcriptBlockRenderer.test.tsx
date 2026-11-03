import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ThemeProvider } from "@/contexts/theme";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { ClaudeMessageNode } from "@/components/MessageViewer/components/ClaudeMessageNode";
import { ClaudeContentArrayRenderer } from "@/components/contentRenderer/ClaudeContentArrayRenderer";
import { TranscriptBlockRenderer } from "@/components/transcript/TranscriptBlockRenderer";
import { transcriptBlocks } from "@/components/transcript/transcriptBlocks";

import { flattened } from "@/components/transcript/transcriptItems.fixtures";
import type { FlattenedMessageItem } from "@/components/MessageViewer/types";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { records } from "./transcript.renderParity.fixtures";
import "@/i18n";

afterEach(() => { cleanup(); useExpandRegistry.getState().clearAll(); });
function open(container: HTMLElement) {
  for (const button of container.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]')) fireEvent.click(button);
}
function signature(container: HTMLElement) {
  return {
    text: container.textContent,
    pres: [...container.querySelectorAll("pre")].map(node => node.textContent),
    images: [...container.querySelectorAll("img")].map(node => node.getAttribute("src")),
    marks: [...container.querySelectorAll("mark")].map(node => [node.textContent, node.className]),
    controls: [...container.querySelectorAll("button")].map(node => [node.textContent, node.title, node.getAttribute("aria-label"), node.getAttribute("aria-expanded")]),
  };
}
describe("whole-record body bridge", () => {
  it.each(records)("preserves %s text/order/record bytes/search and opened controls", (_name, message) => {
    const source = flattened([message]).find((item): item is FlattenedMessageItem => item.type === "message")!;
    const blocks = transcriptBlocks(source);
    const options = { searchQuery: "needle", isMatch: true, isCurrentMatch: true, currentMatchIndex: 1 };
    const legacy = render(<ThemeProvider><ClaudeMessageNode message={message} depth={0} {...options} /></ThemeProvider>);
    open(legacy.container);
    const expected = blocks[0]?.render.kind === "content" ? legacy.container.querySelector<HTMLElement>('[data-message-uuid] > .max-w-4xl > .w-full') ?? legacy.container : legacy.container;
    const expectedSignature = signature(expected);
    legacy.unmount();
    const bridge = render(<ThemeProvider>{blocks.map(block => <TranscriptBlockRenderer key={block.id} block={block} {...options} />)}</ThemeProvider>);
    open(bridge.container);
    expect(signature(bridge.container)).toEqual(expectedSignature);
  });

  it("keeps two original-index disclosure lifetimes, focus and native text selection on append", () => {
    const content = [{ type: "thinking", thinking: "first reasoning" }, { type: "text", text: "selected needle" }, { type: "thinking", thinking: "second reasoning" }];
    const view = (items: unknown[]) => <ThemeProvider><ExpandKeyProvider value="identity"><ClaudeContentArrayRenderer content={items} /></ExpandKeyProvider></ThemeProvider>;
    const result = render(view(content));
    const buttons = result.container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]');
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]!);
    expect(buttons[0]!.getAttribute("aria-expanded")).toBe("false");
    expect(buttons[1]!.getAttribute("aria-expanded")).toBe("true");
    buttons[1]!.focus();
    const text = result.container.querySelector("p")!.firstChild!;
    const range = document.createRange(); range.selectNodeContents(text);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    result.rerender(view([...content, { type: "text", text: "appended" }]));
    expect(result.container.querySelectorAll('button[aria-expanded]')[1]).toBe(buttons[1]);
    expect(document.activeElement).toBe(buttons[1]);
    expect(window.getSelection()!.toString()).toBe("selected needle");
    expect(useExpandRegistry.getState().states["identity:item-2:thinking-2"]).toBe(true);
  });
});
