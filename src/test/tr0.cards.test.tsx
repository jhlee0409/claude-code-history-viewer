/**
 * TR0 adoption in the Claude core cards (Bash, Read, Grep, Glob, Write, Edit
 * header) and StringRenderer's raw output (plan TR0, D1/D2/D3/D6).
 *
 * Inputs are the harness fixture shapes (scripts/ui-capture/fixtures/inner.mjs)
 * as the #727 API delivers them: per-result metadata on the result block.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import i18n from "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { useAppStore } from "@/store/useAppStore";
import { UnifiedToolExecutionRenderer } from "@/components/contentRenderer/UnifiedToolExecutionRenderer";
import { StringRenderer } from "@/components/toolResultRenderer/StringRenderer";
import { ClaudeContentArrayRenderer } from "@/components/contentRenderer/ClaudeContentArrayRenderer";

const CWD = "/Users/dev/work/kiln";
const wrap = (ui: ReactNode) => render(<ExpandKeyProvider value="msg-cards">{ui}</ExpandKeyProvider>);
const own = (toolUseResult: unknown) => ({
  toolUseResult,
  toolUseResultSource: { messageUuid: "u", sessionId: "s", contentIndex: 0, association: "single_result" },
});
const card = (name: string, input: Record<string, unknown>, results: Record<string, unknown>[], id = `toolu_${name}_${Math.random().toString(36).slice(2)}`) =>
  wrap(
    <UnifiedToolExecutionRenderer
      toolUse={{ type: "tool_use", id, name, input }}
      toolResults={results.map((r) => ({ type: "tool_result", tool_use_id: id, ...r }))}
    />,
  );
const rowOf = (container: HTMLElement) => {
  const el = container.querySelector("[data-tool-row]");
  expect(el, "a ToolRow header ([data-tool-row])").not.toBeNull();
  return el as HTMLElement;
};
const open = (container: HTMLElement) => {
  const button = within(rowOf(container)).queryByRole("button", { expanded: false });
  expect(button, "the row's collapsed disclosure button").not.toBeNull();
  fireEvent.click(button as HTMLElement);
};
const SUCCESS = /completed|success|성공|완료/i;
/** The opened ToolRow detail's own meta line (not an OutputBlock's). */
const detailMeta = (container: HTMLElement) => container.querySelector("[data-tool-detail] > [data-meta]")?.textContent ?? "";

const E15 = { stdout: "", stderr: "fatal: not a git repository (or any of the parent directories): .git", interrupted: false };

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => {
  useExpandRegistry.getState().clearAll();
  useAppStore.setState({
    selectedProject: { name: "kiln", path: "/Users/dev/.claude/projects/-Users-dev-work-kiln", actual_path: CWD, session_count: 1, message_count: 1, last_modified: "" } as never,
    homeDir: "/Users/dev",
  });
});

describe("Bash card", () => {
  it("E15: quiet row, no Completed, stderr zone, 'Result not verified' in the detail", () => {
    const { container } = card("Bash", { command: "git status --porcelain", description: "Check the working tree" }, [{ content: E15.stderr, ...own({ ...E15 }) }]);
    expect(rowOf(container)).not.toBeNull();
    expect(container.textContent).not.toMatch(SUCCESS);
    expect(container.querySelector("[class*='success'], [class*='destructive']")).toBeNull();
    open(container);
    expect(container.textContent).not.toMatch(SUCCESS);
    expect(screen.queryByText("Result not verified · No exit code recorded")).not.toBeNull();
    expect(container.querySelector("[data-stderr]")?.textContent).toContain(E15.stderr);
  });

  it("exit 1: 'Failed · exit code 1' in the collapsed row", () => {
    const stdout = " FAIL  src/preview/renderPreview.test.ts\n Tests  1 failed | 211 passed (212)";
    const { container } = card("Bash", { command: "pnpm vitest run src/preview" }, [{ content: `Exit code 1\n${stdout}`, is_error: true, ...own({ stdout, stderr: "", interrupted: false, isImage: false, exitCode: 1 }) }]);
    expect(within(rowOf(container)).queryByText("Failed · exit code 1")).not.toBeNull();
  });

  it("warning + exit 0: no success pill, stderr still shown, exit code 0 as meta", () => {
    const { container } = card("Bash", { command: "pnpm lint" }, [{ content: "warning\n✔ No problems found", ...own({ stdout: "✔ No problems found", stderr: "warning: React version not specified", interrupted: false, isImage: false, exitCode: 0 }) }]);
    expect(container.textContent).not.toMatch(SUCCESS);
    open(container);
    expect(container.querySelector("[data-stderr]")?.textContent).toContain("warning: React version not specified");
    expect(container.textContent).toContain("Exit code 0");
  });

  it("an exit code shows once in the opened detail (the row detail's meta), not twice", () => {
    const count = (text: string, word: string) => text.split(word).length - 1;
    const ok = card("Bash", { command: "pnpm lint" }, [{ content: "ok", ...own({ stdout: "ok", stderr: "", interrupted: false, isImage: false, exitCode: 0 }) }]);
    open(ok.container);
    expect(count(ok.container.textContent ?? "", "Exit code 0")).toBe(1);
    expect(detailMeta(ok.container)).toContain("Exit code 0");
    ok.unmount();
    const int = card("Bash", { command: "pnpm e2e" }, [{ content: "Running 48 tests", ...own({ stdout: "Running 48 tests", stderr: "", interrupted: true, isImage: false, exitCode: 130 }) }]);
    open(int.container);
    expect(count(int.container.textContent ?? "", "Exit code 130")).toBe(1);
    expect(detailMeta(int.container)).toContain("Exit code 130");
  });

  it("exit code 0 with non-text-only content: the document and 'Exit code 0' both show, once (review R2-F3)", () => {
    const doc = { type: "document", title: "ZERO_DOCUMENT", source: { type: "text", media_type: "text/plain", data: "DOC_BODY" } };
    const { container } = card("Bash", { command: "probe-zero-nontext" }, [{ content: [doc], ...own({ exitCode: 0, stdout: "", stderr: "" }) }]);
    expect(rowOf(container).getAttribute("data-tool-verdict")).toBe("succeeded");
    expect(rowOf(container).textContent).not.toMatch(/exit code/i);
    open(container);
    expect(container.textContent).toContain("ZERO_DOCUMENT");
    expect(detailMeta(container)).toContain("Exit code 0");
    expect((container.textContent ?? "").split("Exit code 0").length - 1).toBe(1);
  });

  it("a failed exit code with no output text: the header's 'Failed · exit code 2' is its only mention when opened (R3-F2: exactly once)", () => {
    const { container } = card("Bash", { command: "probe-failed-empty" }, [{ content: [], ...own({ exitCode: 2, stdout: "", stderr: "" }) }]);
    expect(within(rowOf(container)).queryByText("Failed · exit code 2")).not.toBeNull();
    open(container);
    expect(detailMeta(container)).not.toMatch(/exit code 2/i);
    expect((container.textContent ?? "").match(/exit code 2/gi)).toHaveLength(1);
  });

  it("no result: 'No result recorded' instead of a Pending pill", () => {
    const { container } = card("Bash", { command: "pnpm release --dry-run" }, []);
    expect(within(rowOf(container)).queryByText("No result recorded")).not.toBeNull();
    expect(container.textContent).not.toMatch(/pending/i);
  });

  it("the command is the target, in the code font", () => {
    const { container } = card("Bash", { command: "git status --porcelain" }, []);
    const target = rowOf(container).querySelector("[data-mono='code']") as HTMLElement;
    expect(target.textContent).toBe("git status --porcelain");
  });
});

describe("Read / Grep / Glob / Write cards", () => {
  it("Read: relative path, no success pill, raw output", () => {
    const { container } = card("Read", { file_path: `${CWD}/src/index.ts` }, [{ content: "     1→# not a heading\n     2→export {};" }]);
    expect(rowOf(container).textContent).toContain("src/index.ts");
    expect(rowOf(container).textContent).not.toContain(CWD);
    expect(container.textContent).not.toMatch(SUCCESS);
    open(container);
    expect(container.querySelector("h1, h2, h3")).toBeNull();
    expect(container.querySelector("[data-output]")?.textContent).toContain("1→# not a heading");
  });

  it("Read error: 'Failed' with an icon", () => {
    const { container } = card("Read", { file_path: `${CWD}/missing.ts` }, [{ content: "<tool_use_error>File does not exist.</tool_use_error>", is_error: true }]);
    expect(within(rowOf(container)).queryByText("Failed")).not.toBeNull();
    expect(rowOf(container).querySelector("[data-outcome-icon='failed']")).not.toBeNull();
  });

  it("Grep: the pattern is the target, the scope reads relative", () => {
    const { container } = card("Grep", { pattern: "renderPreview", path: `${CWD}/src`, output_mode: "files_with_matches" }, [{ content: "src/preview/renderPreview.ts" }]);
    const row = rowOf(container);
    expect(row.querySelector("[data-mono='code']")?.textContent).toBe("renderPreview");
    expect(row.textContent).not.toContain(CWD);
    expect(row.querySelector("[data-path]")?.getAttribute("title")).toBe(`${CWD}/src`);
    expect(container.textContent).not.toMatch(SUCCESS);
  });

  it("Glob: the pattern is the target", () => {
    const { container } = card("Glob", { pattern: "**/*.test.ts", path: `${CWD}/src` }, [{ content: "src/a.test.ts" }]);
    expect(rowOf(container).querySelector("[data-mono='code']")?.textContent).toBe("**/*.test.ts");
    expect(rowOf(container).textContent).not.toContain(CWD);
  });

  it("Write: relative path and a translated line count", () => {
    const { container } = card("Write", { file_path: `${CWD}/notes.md`, content: "a\nb\nc" }, [{ content: `File created successfully at: ${CWD}/notes.md` }]);
    expect(rowOf(container).textContent).toContain("notes.md");
    expect(rowOf(container).textContent).not.toContain(CWD);
    expect(rowOf(container).textContent).toContain("3 lines");
    expect(container.querySelector("[class*='success']")).toBeNull();
  });
});

describe("Edit card: header only", () => {
  it("Edit · relative path · +a −d in a ToolRow; the body opens without a second click", () => {
    const { container } = card(
      "Edit",
      { file_path: `${CWD}/src/preview/renderPreview.ts`, old_string: "  return input.trim();\n", new_string: "  return input.trim().replace(/\\s+/g, \" \");\n" },
      [{ content: `The file ${CWD}/src/preview/renderPreview.ts has been updated.` }],
    );
    const row = rowOf(container);
    expect(within(row).queryByText("Edit")).not.toBeNull();
    expect(row.textContent).toContain("src/preview/renderPreview.ts");
    expect(row.textContent).not.toContain(CWD);
    expect(row.textContent).toContain("+1");
    expect(row.textContent).toContain("−1");
    open(container);
    const nested = container.querySelectorAll("[data-tool-detail] button[aria-expanded]");
    for (const button of nested) expect(button.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("StringRenderer: raw output, not Markdown", () => {
  it("'# heading' stays text and lines stay lines", () => {
    const { container } = wrap(<StringRenderer result={"# heading\n  two  spaces\n**x**"} />);
    const button = container.querySelector("button[aria-expanded='false']");
    if (button) fireEvent.click(button);
    expect(container.querySelector("h1, h2, strong")).toBeNull();
    const pre = container.querySelector("[data-output] pre[data-output-text]");
    expect(pre, "an OutputBlock text well").not.toBeNull();
    expect(pre?.textContent).toBe("# heading\n  two  spaces\n**x**");
  });
});

describe("StringRenderer: neutral header (plan D3: no success claim, no tool colour)", () => {
  const TOOL_COLOUR = "[class*='tool-']";
  for (const [label, text, title] of [
    ["plain output", "ok: 3 files changed\nsecond line", "Tool Execution Result"],
    // TR9: what the text is (a file tree) is the opened well's label; the header stays neutral.
    ["file tree", "src/\n├── a.ts\n└── b.ts", "Tool Execution Result"],
  ] as const) {
    it(`${label}: no check mark, no tool-colour fill or title, neutral --fg-3 icon`, () => {
      const { container } = wrap(<StringRenderer result={text} />);
      expect(screen.queryByText(title), "the neutral label stays").not.toBeNull();
      expect(container.querySelector("svg.lucide-check"), "a check mark claims success").toBeNull();
      expect(container.querySelector(TOOL_COLOUR), "tool-colour fill / border / title").toBeNull();
      const header = container.querySelector("button[aria-expanded]") as HTMLElement;
      const icons = [...header.querySelectorAll("svg")].filter((svg) => !svg.classList.contains("lucide-chevron-right"));
      expect(icons).toHaveLength(1);
      expect(icons[0]?.getAttribute("class")).toContain("text-fg-3");
    });
  }
});

describe("inline per-result metadata beside an unassigned envelope (review F2)", () => {
  it("Bash: the block's own exit code 2 and stdout are shown; the outer payload is not", () => {
    const { container } = card("Bash", { command: "git status --porcelain" }, [
      {
        content: "INLINE_CONTENT",
        toolUseResult: { exitCode: 2, stdout: "INLINE_FAILED", stderr: "" },
        toolUseResultSource: { messageUuid: "u", sessionId: "s", contentIndex: 0, association: "unassigned", resultContentIndices: [0], unassignedToolUseResult: { exitCode: 0, stdout: "OUTER_UNASSIGNED_DO_NOT_USE" } },
      },
    ]);
    expect(rowOf(container).getAttribute("data-tool-verdict")).toBe("failed");
    expect(within(rowOf(container)).queryByText("Failed · exit code 2")).not.toBeNull();
    open(container);
    expect(container.querySelector("[data-output]")?.textContent).toContain("INLINE_FAILED");
    expect(container.textContent).not.toContain("OUTER_UNASSIGNED_DO_NOT_USE");
    expect(container.textContent).not.toContain("No exit code recorded");
  });
});

describe("aliased tool names use their normalized evidence (independent review)", () => {
  it.each([
    ["Bash", { content: "done" }, "unknown"],
    ["shell", { content: "done" }, "unknown"],
    ["bash", { content: "permission denied", is_error: true }, "failed"],
    ["read", { content: "file text" }, "succeeded"],
    ["read_file", { content: "file text" }, "succeeded"],
    ["grep", { content: "missing", is_error: true }, "failed"],
    ["glob", { content: "src/a.ts" }, "succeeded"],
  ] as const)("%s → %s, no process status invented", (name, result, verdict) => {
    const { container } = card(name, { command: "probe", path: "a.txt" }, [result]);
    expect(rowOf(container).getAttribute("data-tool-verdict")).toBe(verdict);
  });
});

describe("non-tool content keeps its renderers (StringRenderer callers)", () => {
  it("prose, image, document and an unknown block in a message", () => {
    const { container } = wrap(
      <ClaudeContentArrayRenderer
        content={[
          { type: "text", text: "plain prose" },
          { type: "image", source: { type: "url", url: "https://example.com/image.png" } },
          { type: "document", source: { type: "text", media_type: "text/plain", data: "docpayload" }, title: "Probe document" },
          { type: "novel-type", marker: "unknownpayload" },
        ]}
      />,
    );
    expect(container.textContent).toContain("plain prose");
    expect(container.querySelector("img")).not.toBeNull();
    expect(container.textContent).toContain("Probe document");
    expect(container.textContent).toContain("unknownpayload");
  });
});

// ---------------------------------------------------------------------------
// Review round 3 (R3-F2) and the renderer audit items TR0 created
// (TC6/7/8/10/12/13/15, TR9).
// ---------------------------------------------------------------------------

const DOC = { type: "document", title: "MIDDLE_DOCUMENT", source: { type: "text", media_type: "text/plain", data: "BODY" } };

describe("recorded outcome facts survive in the opened row (review R3-F2)", () => {
  it("interrupted + error_code + exit 2: 'Interrupted' in the header; exit code and error code in the detail, each once", () => {
    const { container } = card("Bash", { command: "probe" }, [{ content: "", ...own({ interrupted: true, error_code: "INTERRUPT_ERROR", exitCode: 2 }) }]);
    expect(within(rowOf(container)).queryByText("Interrupted")).not.toBeNull();
    open(container);
    const text = container.textContent ?? "";
    expect(text.match(/INTERRUPT_ERROR/g), text).toHaveLength(1);
    expect(text.match(/exit code 2/gi), text).toHaveLength(1);
    expect(text.match(/interrupted/gi), text).toHaveLength(1);
    expect(detailMeta(container)).toContain("INTERRUPT_ERROR");
    expect(detailMeta(container)).toContain("Exit code 2");
  });

  it("an API error code beside exit 0: 'Failed · EACCES' in the header, 'Exit code 0' in the detail, each once", () => {
    const { container } = card("Read", { file_path: "a.txt" }, [{ content: [DOC], ...own({ error_code: "EACCES", exitCode: 0 }) }]);
    open(container);
    const text = container.textContent ?? "";
    expect(text.match(/EACCES/g), text).toHaveLength(1);
    expect(detailMeta(container)).toMatch(/exit code 0/i);
    expect(text.match(/exit code 0/gi), text).toHaveLength(1);
  });

  for (const name of ["Bash", "Read", "Write"]) {
    for (const content of ["", "RAW_OUTPUT", [DOC]]) {
      it(`${name}: a recorded exit code 0 shows once in the detail beside ${JSON.stringify(content).slice(0, 24)}`, () => {
        const { container } = card(name, { command: "probe", file_path: "a.txt", content: "INPUT" }, [{ content, ...own({ exitCode: 0, stdout: "", stderr: "" }) }]);
        open(container);
        const detail = container.querySelector("[data-tool-detail]")?.textContent ?? "";
        expect(detail.match(/exit code 0/gi)).toHaveLength(1);
      });
    }
  }
});

describe("TC7: an interrupted result's own sentence is not hidden by its stdout (fixture: e2e)", () => {
  it("opened: the stdout zone, then '[Request interrupted by user for tool use]'", () => {
    const { container } = card("Bash", { command: "pnpm e2e" }, [
      { content: "[Request interrupted by user for tool use]", is_error: true, ...own({ stdout: "Running 48 tests using 4 workers", stderr: "", interrupted: true, isImage: false, exitCode: 130 }) },
    ]);
    open(container);
    const text = container.textContent ?? "";
    expect(text).toContain("Running 48 tests using 4 workers");
    expect(text).toContain("[Request interrupted by user for tool use]");
  });
});

/**
 * TC8 (owner default): the opened detail repeats the command / pattern in a
 * well only when the row's target does not show all of it — cut by the
 * ellipsis (measured: scrollWidth > clientWidth) or only its first line
 * shown. The target's `title` always holds the full text. jsdom has no
 * layout, so the row target's geometry is stubbed: 8 px per character in a
 * 200 px box.
 */
describe("TC8: the full-target well appears only when the row's target is cut", () => {
  const descriptors = {
    scrollWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth"),
    clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"),
  };
  const inRowTarget = (el: HTMLElement) => el.tagName === "CODE" && el.closest("[data-tool-row]") !== null;
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return inRowTarget(this) ? (this.textContent ?? "").length * 8 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return inRowTarget(this) ? 200 : 0;
      },
    });
  });
  afterAll(() => {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
    }
  });
  /** Every element in the opened detail that shows `text` whole (the well). */
  const wells = (container: HTMLElement, text: string) =>
    [...container.querySelectorAll("[data-tool-detail] pre")].filter((el) => el.textContent === text);
  const LONG = "pnpm exec vitest run src/components/transcript --reporter=verbose --coverage";

  it.each([
    ["Bash", { command: "pnpm build" }, "pnpm build"],
    ["Grep", { pattern: "renderPreview" }, "renderPreview"],
    ["Glob", { pattern: "**/*.test.ts" }, "**/*.test.ts"],
  ] as const)("%s: a target that fits: no duplicate well when opened; the title still holds it", (name, input, text) => {
    const { container } = card(name, input, [{ content: "ok" }]);
    open(container);
    expect(wells(container, text), "no well").toHaveLength(0);
    expect(rowOf(container).querySelector(`[title="${text}"]`)).not.toBeNull();
  });

  it.each([
    ["Bash", { command: LONG }, LONG],
    ["Grep", { pattern: LONG }, LONG],
    ["Glob", { pattern: LONG }, LONG],
  ] as const)("%s: a target cut by the ellipsis: the opened detail shows it whole", (name, input, text) => {
    const { container } = card(name, input, [{ content: "ok" }]);
    open(container);
    expect(wells(container, text)).toHaveLength(1);
    expect(rowOf(container).querySelector("code")?.getAttribute("title")).toBe(text);
  });

  it("Bash: a multi-line command shows its first line in the row, the whole command in the title and in the well", () => {
    const command = "cd src\npnpm build";
    const { container } = card("Bash", { command }, [{ content: "ok" }]);
    const target = rowOf(container).querySelector("code") as HTMLElement;
    expect(target.textContent).toBe("cd src");
    expect(target.getAttribute("title")).toBe(command);
    open(container);
    expect(wells(container, command)).toHaveLength(1);
  });

  it("an open row re-measures when its full target changes but the shown first line does not (review round 4)", () => {
    const id = "toolu_bash_rerender";
    const ui = (command: string) => (
      <ExpandKeyProvider value="msg-cards">
        <UnifiedToolExecutionRenderer
          toolUse={{ type: "tool_use", id, name: "Bash", input: { command } }}
          toolResults={[{ type: "tool_result", tool_use_id: id, content: "ok" }]}
        />
      </ExpandKeyProvider>
    );
    const view = render(ui("short"));
    open(view.container);
    expect(wells(view.container, "short"), "fits: no well").toHaveLength(0);
    view.rerender(ui("short\necho second-line"));
    expect(wells(view.container, "short\necho second-line"), "now only partly shown: the well").toHaveLength(1);
    view.rerender(ui("short"));
    expect(wells(view.container, "short"), "fits again: no well").toHaveLength(0);
  });
});

describe("TC12: Grep's output mode reads as words, not the raw input enum", () => {
  const meta = (container: HTMLElement) => rowOf(container).textContent ?? "";
  it.each([
    ["files_with_matches", "Files with matches"],
    ["content", "Matching lines"],
    ["count", "Match counts"],
  ])("%s → %s", (mode, words) => {
    const { container } = card("Grep", { pattern: "x", output_mode: mode }, [{ content: "a" }]);
    expect(meta(container)).toContain(words);
    const raw = [...rowOf(container).querySelectorAll("*")].filter((el) => el.textContent === mode);
    expect(raw, `the raw enum ${mode} as its own text`).toHaveLength(0);
  });

  it("speaks Korean", async () => {
    await i18n.changeLanguage("ko");
    try {
      const { container } = card("Grep", { pattern: "x", output_mode: "files_with_matches" }, [{ content: "a" }]);
      expect(meta(container)).toContain("일치하는 파일");
      expect(meta(container)).not.toContain("files_with_matches");
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("an unknown mode is shown as recorded, as a code literal", () => {
    const { container } = card("Grep", { pattern: "x", output_mode: "novel_mode" }, [{ content: "a" }]);
    const literal = [...rowOf(container).querySelectorAll("code[data-mono='code'], [data-mono='code']")].find((el) => el.textContent === "novel_mode");
    expect(literal, rowOf(container).innerHTML).toBeDefined();
  });
});

describe("TC13: Grep content-mode match lines never soft-wrap into a look-alike next match", () => {
  const out = "/Users/dev/work/kiln/src/components/InteractionCard.tsx:48:      className=\"flex min-w-0 items-center gap-2 rounded-row px-1 text-left\"\nsrc/b.ts:2:y";
  it("content mode: each match line stays one line (white-space: pre) in a well that scrolls sideways", () => {
    const { container } = card("Grep", { pattern: "className", output_mode: "content" }, [{ content: out }]);
    open(container);
    const pre = container.querySelector("[data-tool-detail] [data-output] pre[data-output-text]") as HTMLElement;
    const cls = (pre.getAttribute("class") ?? "").split(/\s+/);
    expect(cls).toContain("whitespace-pre");
    expect(cls).not.toContain("whitespace-pre-wrap");
    expect(cls).toContain("overflow-x-auto");
    expect(pre.textContent).toBe(out);
  });

  it("files mode keeps wrapping (a control)", () => {
    const { container } = card("Grep", { pattern: "x", output_mode: "files_with_matches" }, [{ content: "src/a.ts\nsrc/b.ts" }]);
    open(container);
    const pre = container.querySelector("[data-tool-detail] [data-output] pre[data-output-text]") as HTMLElement;
    expect((pre.getAttribute("class") ?? "").split(/\s+/)).toContain("whitespace-pre-wrap");
  });
});

describe("TC15: Write shows its line count once and no absolute-path confirmation well", () => {
  it("the count is the header's alone; the confirmation of the header's own file is left out", () => {
    const { container } = card("Write", { file_path: `${CWD}/notes.md`, content: "a\nb\nc" }, [{ content: `File created successfully at: ${CWD}/notes.md` }]);
    open(container);
    const text = container.textContent ?? "";
    expect(text.match(/3 lines/g), text).toHaveLength(1);
    expect(rowOf(container).textContent).toContain("3 lines");
    expect(text).not.toContain("File created successfully");
    expect(text).not.toContain(CWD);
    expect(container.querySelector("[data-tool-detail] [data-output] pre")?.textContent).toBe("a\nb\nc");
  });

  it("the updated-file sentence with Claude's trailing note is a confirmation too", () => {
    const sentence = `The file ${CWD}/notes.md has been updated successfully. (file state is current in your context — no need to Read it back)`;
    const { container } = card("Write", { file_path: `${CWD}/notes.md`, content: "a" }, [{ content: [{ type: "text", text: sentence }] }]);
    open(container);
    expect(container.textContent).not.toContain("has been updated");
  });

  it("a confirmation naming another file shows that path relative (PathText), not the sentence", () => {
    const { container } = card("Write", { file_path: `${CWD}/notes.md`, content: "a" }, [{ content: `File created successfully at: ${CWD}/docs/other.md` }]);
    open(container);
    const detail = container.querySelector("[data-tool-detail]") as HTMLElement;
    expect(detail.textContent).toContain("docs/other.md");
    expect(detail.textContent).not.toContain(CWD);
    expect(detail.querySelector(`[title="${CWD}/docs/other.md"]`)).not.toBeNull();
  });

  it("leaving out the confirmation sentence keeps the same result's own stdout / stderr (review round 4)", () => {
    const { container } = card("Write", { file_path: `${CWD}/notes.md`, content: "INPUT" }, [
      { content: `File created successfully at: ${CWD}/notes.md`, ...own({ stdout: "WRITE_DISTINCT_STDOUT", stderr: "WRITE_WARNING", exitCode: 0 }) },
    ]);
    open(container);
    const text = container.textContent ?? "";
    expect(text).toContain("WRITE_DISTINCT_STDOUT");
    expect(text).toContain("WRITE_WARNING");
    expect(container.querySelector("[data-tool-detail] [data-stderr]")).not.toBeNull();
    expect(text).not.toContain("File created successfully");
  });

  it("a confirmation with empty streams still adds nothing (no 'No output')", () => {
    const { container } = card("Write", { file_path: `${CWD}/notes.md`, content: "INPUT" }, [
      { content: `File created successfully at: ${CWD}/notes.md`, ...own({ stdout: "", stderr: "" }) },
    ]);
    open(container);
    expect(container.textContent).not.toContain("No output");
    expect(container.textContent).not.toContain("File created successfully");
  });

  it("anything else (an error) stays as recorded", () => {
    const { container } = card("Write", { file_path: `${CWD}/notes.md`, content: "a" }, [{ content: "EACCES: permission denied, open 'notes.md'", is_error: true }]);
    open(container);
    expect(container.textContent).toContain("EACCES: permission denied");
  });
});

describe("TR9: StringRenderer says 'File Structure' once, in one box", () => {
  it("a collapsed string result opens itself when the search query matches it (CodeRabbit 4362895001)", () => {
    const { container } = wrap(<StringRenderer result={"alpha\nNeedle line\nomega"} searchQuery="  needle " />);
    const button = container.querySelector("button[aria-expanded]") as HTMLElement;
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("[data-output]")?.textContent).toContain("Needle line");
  });

  it("a non-matching query leaves it collapsed (a control)", () => {
    const { container } = wrap(<StringRenderer result={"alpha\nomega"} searchQuery="needle" />);
    expect(container.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("[data-output]")).toBeNull();
  });

  it("the user can still collapse it while the query matches, as before TR0 (review round 6)", () => {
    const { container } = wrap(<StringRenderer result={"alpha\nNeedle line"} searchQuery="needle" />);
    const button = container.querySelector("button[aria-expanded]") as HTMLElement;
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("[data-output]")).toBeNull();
  });

  it("after a collapse, a different matching query opens it again (review round 7)", () => {
    const result = "alpha\nNeedle Otherword line";
    const { container, rerender } = wrap(<StringRenderer result={result} searchQuery="needle" />);
    const button = container.querySelector("button[aria-expanded]") as HTMLElement;
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    rerender(
      <ExpandKeyProvider value="msg-cards">
        <StringRenderer result={result} searchQuery="otherword" />
      </ExpandKeyProvider>,
    );
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("[data-output]")?.textContent).toContain("Otherword");
  });

  it("opened file tree: the label once, and no bordered card around the well", () => {
    const { container } = wrap(<StringRenderer result={"src/\n├── a.ts\n└── b.ts"} />);
    const button = container.querySelector("button[aria-expanded='false']");
    if (button) fireEvent.click(button);
    const well = container.querySelector("[data-output]") as HTMLElement;
    expect(well, "the OutputBlock well").not.toBeNull();
    expect((container.textContent ?? "").match(/File Structure/g)).toHaveLength(1);
    for (let el = well.parentElement; el && el !== container; el = el.parentElement) {
      expect((el.getAttribute("class") ?? "").split(/\s+/), el.outerHTML.slice(0, 120)).not.toContain("border");
    }
  });
});

/**
 * TC4: the Edit row's "+a −d" and the change counts of the diff box below it
 * (still the old FileEditRenderer body until TR2a) come from one source, so
 * they agree. A multi-line replacement is where they used to differ: the row
 * counted lines (+3 −2), the box counted changed blocks (+1 −1).
 */
describe("TC4: the Edit row's +a −d agrees with the box's change counts", () => {
  /** The value printed under a statistics label in the opened box. */
  const stat = (container: HTMLElement, label: string) => {
    const el = [...container.querySelectorAll("[data-tool-detail] div")].find((d) => d.textContent === label && d.childElementCount === 0);
    expect(el, `the box's '${label}' statistic`).toBeDefined();
    return el?.nextElementSibling?.textContent ?? "";
  };

  it.each([
    ["a multi-line replacement", "a\nb\nc\n", "a\nB\nC\nD\n", 3, 2],
    ["a one-line replacement (fixture)", "  return input.trim();\n", "  return input.trim().replace(/\\s+/g, \" \");\n", 1, 1],
    // The row ignores a missing newline at the end; the box must count the same way.
    ["no trailing newline on one side", "x\ny", "x\ny\nz\n", 1, 0],
  ] as const)("%s", (_label, oldString, newString, added, removed) => {
    const { container } = card("Edit", { file_path: `${CWD}/src/a.ts`, old_string: oldString, new_string: newString }, [{ content: "ok" }]);
    // The visible "+a −d" (its spoken form is a separate sr-only sentence).
    const row = rowOf(container).querySelector("[aria-hidden='true'][data-mono='code']")?.textContent ?? "";
    const counts = /^\+(\d+) −(\d+)$/.exec(row);
    expect(counts, row).not.toBeNull();
    open(container);
    const box = { added: stat(container, "Additions"), removed: stat(container, "Deletions") };
    expect({ row: `+${counts?.[1]} −${counts?.[2]}`, box: `${box.added} ${box.removed}` }).toEqual({ row: `+${added} −${removed}`, box: `+${added} -${removed}` });
  });
});

/**
 * Plan amendment #1 (renderer re-audit, owner-approved): the stderr zone is
 * always its own visible zone labelled `stderr`, and it takes the danger
 * rule and colour only when the row's verdict is `failed`. A warning beside
 * exit code 0 and E15's stderr with no exit code (unknown) stay neutral.
 */
describe("amendment #1: the stderr zone is danger-styled only when the verdict is failed", () => {
  const zoneOf = (container: HTMLElement) => {
    const zone = container.querySelector("[data-tool-detail] [data-stderr]") as HTMLElement | null;
    expect(zone, "the stderr zone").not.toBeNull();
    return zone as HTMLElement;
  };
  const dangerClasses = (zone: HTMLElement) =>
    [zone, ...zone.querySelectorAll("*")].flatMap((el) => (el.getAttribute("class") ?? "").split(/\s+/)).filter((c) => c.includes("danger"));

  it.each([
    ["E15 (unknown)", { content: E15.stderr, ...own({ ...E15 }) }, "unknown"],
    ["a warning beside exit code 0 (succeeded)", { content: "✔ No problems found", ...own({ stdout: "✔ No problems found", stderr: "warning: React version not specified", interrupted: false, isImage: false, exitCode: 0 }) }, "succeeded"],
  ] as const)("%s: neutral zone, still shown with its label", (_label, r, verdict) => {
    const { container } = card("Bash", { command: "probe" }, [r]);
    expect(rowOf(container).getAttribute("data-tool-verdict")).toBe(verdict);
    open(container);
    const zone = zoneOf(container);
    expect(zone.firstElementChild?.textContent).toBe("stderr");
    expect(dangerClasses(zone), zone.outerHTML.slice(0, 300)).toEqual([]);
    expect(zone.getAttribute("class")).toContain("border-line");
  });

  it("a failed row (exit 1): danger rule and danger text", () => {
    const { container } = card("Bash", { command: "pnpm build" }, [
      { content: "Exit code 1\nerror TS2322", is_error: true, ...own({ stdout: "", stderr: "error TS2322", interrupted: false, isImage: false, exitCode: 1 }) },
    ]);
    expect(rowOf(container).getAttribute("data-tool-verdict")).toBe("failed");
    open(container);
    const zone = zoneOf(container);
    expect(zone.getAttribute("class")).toContain("border-status-danger-line");
    expect(zone.querySelector("pre")?.getAttribute("class")).toContain("text-status-danger-fg");
  });
});
