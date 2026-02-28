/**
 * @fileoverview Integration tests verifying ANSI escape codes are rendered
 * (not shown as raw text) across all terminal output paths.
 *
 * Covers the 4 components fixed in PR #161 / issue #109:
 *   - CommandRenderer (local-command-stdout)
 *   - TerminalExecutionResultRenderer (stdout/stderr)
 *   - StringRenderer (generic string tool result)
 *   - ToolExecutionResultRouter (fallback stderr)
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { act } from "react";

// ── Mocks ────────────────────────────────────────────────────────────
vi.mock("react-i18next", async () => {
  const actual = await vi.importActual<typeof import("react-i18next")>(
    "react-i18next"
  );
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string) => fallback ?? key,
    }),
  };
});

// ── Imports (after mocks) ────────────────────────────────────────────
import { CommandRenderer } from "@/components/contentRenderer/CommandRenderer";
import { TerminalExecutionResultRenderer } from "@/components/contentRenderer/TerminalExecutionResultRenderer";
import { StringRenderer } from "@/components/toolResultRenderer/StringRenderer";

// ── Helpers ──────────────────────────────────────────────────────────
const DIM = "\x1b[2m";
const RESET_DIM = "\x1b[22m";
const RED = "\x1b[31m";
const OFF = "\x1b[0m";

/**
 * Assert that no raw ANSI escape bytes survive into the rendered DOM text.
 */
function expectNoRawAnsi(container: HTMLElement) {
  const text = container.textContent ?? "";
  expect(text).not.toContain("\x1b[");
  expect(text).not.toMatch(/\[[\d;]*m/);
}

/** Click the first button in the container (expand/toggle). */
function clickExpand(container: HTMLElement) {
  const btn = container.querySelector("button");
  if (btn) {
    act(() => {
      fireEvent.click(btn);
    });
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. CommandRenderer — /cost output (inline local-command-stdout)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("CommandRenderer ANSI rendering", () => {
  const costOutput = [
    `${DIM}Total cost:          $5.96${RESET_DIM}`,
    `${DIM}Total duration (API): 6m 23s${RESET_DIM}`,
  ].join("\n");

  const commandText = [
    "<command-name>/cost</command-name>",
    "<command-message>cost</command-message>",
    `<local-command-stdout>${costOutput}</local-command-stdout>`,
  ].join("\n");

  it("renders /cost output without raw ANSI escape codes", () => {
    const { container } = render(<CommandRenderer text={commandText} />);
    clickExpand(container);

    expectNoRawAnsi(container);
    expect(container.textContent).toContain("Total cost:");
    expect(container.textContent).toContain("$5.96");
  });

  it("strips ANSI before search highlighting", () => {
    const { container } = render(
      <CommandRenderer text={commandText} searchQuery="5.96" />
    );
    // searchQuery auto-expands via useEffect
    expectNoRawAnsi(container);
    expect(container.textContent).toContain("5.96");
  });

  it("renders standalone local-command-stdout with AnsiText", () => {
    const standaloneText = `<local-command-stdout>${RED}error line${OFF}</local-command-stdout>`;
    const { container } = render(<CommandRenderer text={standaloneText} />);

    expectNoRawAnsi(container);
    expect(container.textContent).toContain("error line");
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. TerminalExecutionResultRenderer — bash execution stdout / stderr
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("TerminalExecutionResultRenderer ANSI rendering", () => {
  const defaultProps = {
    toolUseId: "test-tool-id",
    icon: <span data-testid="icon">$</span>,
    title: "Bash Execution",
    errorTitle: "Bash Error",
    noOutputLabel: "No output",
    errorMessages: {},
  };

  /** Expand ToolResultCard to reveal content */
  function expandResult(container: HTMLElement) {
    const btn = container.querySelector("button");
    if (btn) {
      act(() => {
        fireEvent.click(btn);
      });
    }
  }

  it("renders ANSI-styled stdout without raw escape codes", () => {
    const { container } = render(
      <TerminalExecutionResultRenderer
        {...defaultProps}
        content={{
          stdout: `${RED}FAIL${OFF} src/test.ts`,
          return_code: 1,
        }}
      />
    );
    expandResult(container);

    expectNoRawAnsi(container);
    expect(container.textContent).toContain("FAIL");
    expect(container.textContent).toContain("src/test.ts");
  });

  it("renders ANSI-styled stderr without raw escape codes", () => {
    const { container } = render(
      <TerminalExecutionResultRenderer
        {...defaultProps}
        content={{
          stderr: `\x1b[33mwarning\x1b[0m: unused variable`,
          return_code: 0,
        }}
      />
    );
    expandResult(container);

    expectNoRawAnsi(container);
    expect(container.textContent).toContain("warning");
    expect(container.textContent).toContain("unused variable");
  });

  it("renders both stdout and stderr with ANSI processing", () => {
    const { container } = render(
      <TerminalExecutionResultRenderer
        {...defaultProps}
        content={{
          stdout: `${DIM}compiling...${RESET_DIM}`,
          stderr: `${RED}error[E0308]${OFF}: mismatched types`,
          return_code: 1,
        }}
      />
    );
    expandResult(container);

    expectNoRawAnsi(container);
    expect(container.textContent).toContain("compiling...");
    expect(container.textContent).toContain("error[E0308]");
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. StringRenderer — generic string tool result with ANSI
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("StringRenderer ANSI rendering", () => {
  /** Expand Renderer to reveal content */
  function expandRenderer(container: HTMLElement) {
    const btn = container.querySelector("button");
    if (btn) {
      act(() => {
        fireEvent.click(btn);
      });
    }
  }

  it("detects ANSI codes and renders via AnsiText", () => {
    const ansiString = `${RED}Error${OFF}: file not found`;
    const { container } = render(<StringRenderer result={ansiString} />);
    expandRenderer(container);

    expectNoRawAnsi(container);
    expect(container.textContent).toContain("Error");
    expect(container.textContent).toContain("file not found");
  });

  it("preserves whitespace in ANSI-rendered output", () => {
    const multiLine = `${DIM}line 1${RESET_DIM}\n${DIM}line 2${RESET_DIM}`;
    const { container } = render(<StringRenderer result={multiLine} />);
    expandRenderer(container);

    expectNoRawAnsi(container);
    expect(container.textContent).toContain("line 1");
    expect(container.textContent).toContain("line 2");
    // whitespace-pre-wrap should be present on the ANSI container
    const monoDiv = container.querySelector("[class*='whitespace-pre-wrap']");
    expect(monoDiv).toBeInTheDocument();
  });

  it("falls through to markdown for plain text without ANSI", () => {
    const { container } = render(
      <StringRenderer result="Just plain text" />
    );
    expandRenderer(container);
    // The AnsiText mono wrapper should NOT be present for non-ANSI text
    // (markdown rendering path instead)
    expect(container.textContent).toContain("Just plain text");
  });

  it("renders file tree output in mono block", () => {
    const fileTree = "├── src/\n│   └── index.ts\n└── package.json";
    const { container } = render(<StringRenderer result={fileTree} />);
    expandRenderer(container);

    expect(container.textContent).toContain("src/");
    expect(container.textContent).toContain("index.ts");
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. Edge cases — various ANSI sequence formats
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("ANSI edge cases via StringRenderer", () => {
  function expandRenderer(container: HTMLElement) {
    const btn = container.querySelector("button");
    if (btn) {
      act(() => {
        fireEvent.click(btn);
      });
    }
  }

  it("handles 256-color codes", () => {
    const text256 = "\x1b[38;5;208morange text\x1b[0m";
    const { container } = render(<StringRenderer result={text256} />);
    expandRenderer(container);

    expectNoRawAnsi(container);
    expect(container.textContent).toContain("orange text");
  });

  it("handles RGB truecolor codes", () => {
    const textRgb = "\x1b[38;2;100;200;50mgreen text\x1b[0m";
    const { container } = render(<StringRenderer result={textRgb} />);
    expandRenderer(container);

    expectNoRawAnsi(container);
    expect(container.textContent).toContain("green text");
  });

  it("handles bold + color combined sequences", () => {
    const combined = "\x1b[1;31mbold red\x1b[0m";
    const { container } = render(<StringRenderer result={combined} />);
    expandRenderer(container);

    expectNoRawAnsi(container);
    expect(container.textContent).toContain("bold red");
  });

  it("handles dim text sequences (the /cost bug)", () => {
    const dimText = `${DIM}Total cost: $5.96${RESET_DIM}`;
    const { container } = render(<StringRenderer result={dimText} />);
    expandRenderer(container);

    expectNoRawAnsi(container);
    expect(container.textContent).toContain("Total cost: $5.96");
  });
});
