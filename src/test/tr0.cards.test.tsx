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

  it("an exit code shows once in the opened detail (the output's meta), not twice", () => {
    const count = (text: string, word: string) => text.split(word).length - 1;
    const ok = card("Bash", { command: "pnpm lint" }, [{ content: "ok", ...own({ stdout: "ok", stderr: "", interrupted: false, isImage: false, exitCode: 0 }) }]);
    open(ok.container);
    expect(count(ok.container.textContent ?? "", "Exit code 0")).toBe(1);
    ok.unmount();
    const int = card("Bash", { command: "pnpm e2e" }, [{ content: "Running 48 tests", ...own({ stdout: "Running 48 tests", stderr: "", interrupted: true, isImage: false, exitCode: 130 }) }]);
    open(int.container);
    expect(count(int.container.textContent ?? "", "Exit code 130")).toBe(1);
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
    ["file tree", "src/\n├── a.ts\n└── b.ts", "File Structure"],
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
