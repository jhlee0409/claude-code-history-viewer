import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { ThemeProvider } from "@/contexts/theme";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { ClaudeContentArrayRenderer } from "@/components/contentRenderer/ClaudeContentArrayRenderer";
import { toolOutcome } from "@/components/transcript/toolOutcome";
import i18n from "@/i18n";
import publicMessages from "./fixtures/codex-preservation-public.json";

beforeAll(async () => { await i18n.changeLanguage("en"); });
beforeEach(() => useExpandRegistry.getState().clearAll());
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGO4I2f0HwAFMgIsjP5jlwAAAABJRU5ErkJggg==";
const call = { type: "tool_use", id: "exec", name: "exec_command", input: { command: "synthetic" } };
function mount(result: Record<string, unknown>, name = "exec_command") {
  const content = [{ ...call, name }, result];
  const view = render(<ThemeProvider><ExpandKeyProvider value="codex-evidence"><ClaudeContentArrayRenderer provider="codex" content={content} /></ExpandKeyProvider></ThemeProvider>);
  for (let n = 0; n < 20; n++) {
    const button = view.container.querySelector<HTMLElement>("button[aria-expanded=false]");
    if (!button) break;
    fireEvent.click(button);
  }
  return view;
}

describe("Codex producer evidence through the paired renderer", () => {
  it("consumes actual Rust public-command fixture results", () => {
    const messages = publicMessages as unknown as Array<{uuid:string; content:Record<string, unknown>[]} >;
    for (const [uuid, code] of [["use-one",0],["use-two",2]] as const) {
      const message = messages.find(m => m.uuid === uuid)!;
      expect(toolOutcome(message.content[0]!, [message.content[1]!], "process", "codex")).toMatchObject({exitCode:code, verdict:code === 0 ? "succeeded" : "failed"});
    }
    const result = messages.find(m => m.uuid === "result-orphan")!.content[0]!;
    const {container} = mount(result, "exec");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(container.textContent).toContain("first-needle");
    expect(container.textContent).toContain("last-needle");
    expect(container.textContent).not.toContain("Type: input_text");
  });
  it.each([0, 2, -1])("consumes preserved header exit %s, not stdout prose", code => {
    const result = { type: "tool_result", tool_use_id: "exec", content: "Error: ordinary stdout", codexOutput: { raw: `Exit code: ${code}\nWall time: 0 seconds\nOutput:\nError: ordinary stdout`, exitCode: code, sourceMessageUuid: "source-result" } };
    expect(toolOutcome(call, [result], "process", "codex")).toMatchObject({ exitCode: code, verdict: code === 0 ? "succeeded" : "failed" });
    const { container } = mount(result);
    expect(container.textContent?.toLowerCase()).toContain(`exit code ${code}`);
  });
  it("renders input text/image/text in recorded order without mutating raw items", () => {
    const result = { type: "tool_result", tool_use_id: "exec", content: [{ type: "input_text", text: "first-needle" }, { type: "input_image", image_url: png, detail: "original" }, { type: "input_text", text: "last-needle" }] };
    const before = JSON.stringify(result);
    const { container } = mount(result, "exec");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(png);
    const output = [...container.querySelectorAll("img, [data-output] pre")].filter(el => el.tagName === "IMG" || el.textContent?.includes("needle")).map(el => el.tagName === "IMG" ? "image" : el.textContent);
    expect(output).toEqual(["first-needle", "image", "last-needle"]);
    expect(container.textContent).not.toContain("Type: input_text");
    expect(JSON.stringify(result)).toBe(before);
  });
  it.each(["javascript:alert(1)", "data:text/html;base64,AAAA", "file:///private/image.png"])("keeps unsupported image reference %s as raw data", image_url => {
    const { container } = mount({ type: "tool_result", tool_use_id: "exec", content: [{ type: "input_image", image_url }] }, "exec");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(image_url);
  });
});
