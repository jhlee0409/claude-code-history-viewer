/**
 * ToolRow (plan §4.3, §4.2 screen rules, TR0).
 *
 * - succeeded / unknown never say "Completed" / "Success" and show no pill;
 * - unknown says "Result not verified" in the opened detail;
 * - failed / interrupted / no-result carry an icon shape and words, never a
 *   colour alone, and "exit code N" only when N was recorded;
 * - the header is a disclosure (`aria-expanded` + `aria-controls`) with a
 *   minimum height (`min-h-row-tool`), no fixed height, no fill or border;
 * - the tool id is reachable only through "copy" in the opened detail;
 * - a path target reads relative, with the full path in `title`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import i18n from "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { useAppStore } from "@/store/useAppStore";
import { ToolRow } from "./ToolRow";
import type { ToolOutcome } from "./toolOutcome";
import { UnifiedToolExecutionRenderer } from "@/components/contentRenderer/UnifiedToolExecutionRenderer";

const wrap = (ui: ReactNode) => render(<ExpandKeyProvider value="msg-1">{ui}</ExpandKeyProvider>);

const OUTCOMES = {
  succeeded: { lifecycle: "completed", verdict: "succeeded", reason: "exit-zero", exitCode: 0 },
  readOk: { lifecycle: "completed", verdict: "succeeded", reason: "no-error-signal" },
  unknown: { lifecycle: "completed", verdict: "unknown", reason: "no-exit-code" },
  failedExit: { lifecycle: "completed", verdict: "failed", reason: "provider-error", exitCode: 1 },
  failedApi: { lifecycle: "completed", verdict: "failed", reason: "api-error-code", errorCode: "url_not_accessible" },
  failedPlain: { lifecycle: "completed", verdict: "failed", reason: "provider-error" },
  conflict: { lifecycle: "completed", verdict: "failed", reason: "conflict", exitCode: 2 },
  interrupted: { lifecycle: "interrupted", verdict: "failed", reason: "interrupted", exitCode: 130 },
  noResult: { lifecycle: "no-result", verdict: "unknown", reason: "no-result-recorded" },
} satisfies Record<string, ToolOutcome>;

const row = (outcome: ToolOutcome, key: string, family: "process" | "read-search" | "other" = "process") =>
  wrap(
    <ToolRow
      icon={<span data-testid="tool-icon" />}
      verb="Bash"
      target={<code data-mono="code">pnpm build</code>}
      outcome={outcome}
      family={family}
      toolId="toolu_01ABCDEF"
      expandKey={key}
    >
      <p>detail body</p>
    </ToolRow>,
  );

const header = (container: HTMLElement) => {
  const el = container.querySelector("[data-tool-row]");
  expect(el, "a ToolRow header ([data-tool-row])").not.toBeNull();
  return el as HTMLElement;
};
const toggle = () => {
  const buttons = screen.queryAllByRole("button", { expanded: false });
  expect(buttons.length, "a collapsed disclosure button").toBeGreaterThan(0);
  return buttons[0];
};
const SUCCESS_WORDS = /completed|success|succeeded|성공|완료/i;

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => {
  useExpandRegistry.getState().clearAll();
});

describe("ToolRow: no success claims", () => {
  it.each([
    ["succeeded", OUTCOMES.succeeded],
    ["read ok", OUTCOMES.readOk],
    ["unknown", OUTCOMES.unknown],
  ] as const)("%s: no Completed word and no success pill, collapsed or open", (_n, outcome) => {
    const { container } = row(outcome, `ok-${_n}`);
    expect(container.textContent).not.toMatch(SUCCESS_WORDS);
    expect(container.querySelector("[class*='success']")).toBeNull();
    fireEvent.click(toggle());
    expect(container.textContent).not.toMatch(SUCCESS_WORDS);
    expect(container.querySelector("[class*='success']")).toBeNull();
  });

  it("unknown: the collapsed row is quiet, the detail says the result is not verified", () => {
    const { container } = row(OUTCOMES.unknown, "unknown");
    expect(header(container).textContent).not.toMatch(/not verified|failed|interrupted/i);
    expect(container.querySelector("[data-outcome-icon]")).toBeNull();
    fireEvent.click(toggle());
    expect(screen.queryByText("Result not verified · No exit code recorded")).not.toBeNull();
  });

  it("succeeded: the detail shows the recorded exit code as neutral meta", () => {
    const { container } = row(OUTCOMES.succeeded, "succeeded");
    expect(header(container).textContent).not.toMatch(/exit code/i);
    fireEvent.click(toggle());
    const meta = container.querySelector("[data-tool-detail] [data-meta]");
    expect(meta?.textContent).toContain("Exit code 0");
    expect(meta?.getAttribute("class")).toContain("text-fg-3");
  });
});

describe("ToolRow: failed / interrupted / no result", () => {
  it("failed with an exit code: danger icon + 'Failed · exit code 1' in the row", () => {
    const { container } = row(OUTCOMES.failedExit, "failed-exit");
    expect(within(header(container)).queryByText("Failed · exit code 1")).not.toBeNull();
    const icon = header(container).querySelector("[data-outcome-icon='failed']");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("class")).toContain("text-status-danger-fg");
  });

  it("failed without a recorded exit code: no number is invented", () => {
    const { container } = row(OUTCOMES.failedPlain, "failed-plain");
    expect(within(header(container)).queryByText("Failed")).not.toBeNull();
    expect(header(container).textContent).not.toMatch(/exit code/i);
  });

  it("failed with an API error code: 'Failed · <code>'", () => {
    const { container } = row(OUTCOMES.failedApi, "failed-api", "read-search");
    expect(within(header(container)).queryByText("Failed · url_not_accessible")).not.toBeNull();
  });

  it("conflict: the detail says the result parts disagree", () => {
    const { container } = row(OUTCOMES.conflict, "conflict");
    expect(within(header(container)).queryByText("Failed · exit code 2")).not.toBeNull();
    fireEvent.click(toggle());
    expect(screen.queryByText("Result parts disagree")).not.toBeNull();
  });

  it("interrupted: warning icon + 'Interrupted'", () => {
    const { container } = row(OUTCOMES.interrupted, "interrupted");
    expect(within(header(container)).queryByText("Interrupted")).not.toBeNull();
    const icon = header(container).querySelector("[data-outcome-icon='interrupted']");
    expect(icon?.getAttribute("class")).toContain("text-status-warning-fg");
  });

  it("no result: fg-3 icon + 'No result recorded', no warning colour", () => {
    const { container } = row(OUTCOMES.noResult, "no-result");
    expect(within(header(container)).queryByText("No result recorded")).not.toBeNull();
    const icon = header(container).querySelector("[data-outcome-icon='no-result']");
    expect(icon?.getAttribute("class")).toContain("text-fg-3");
    expect(container.querySelector("[class*='warning']")).toBeNull();
  });

  it("speaks Korean", async () => {
    await i18n.changeLanguage("ko");
    try {
      const failed = row(OUTCOMES.failedExit, "ko-failed");
      expect(failed.container.textContent).toContain("실패 · 종료 코드 1");
      failed.unmount();
      const interrupted = row(OUTCOMES.interrupted, "ko-int");
      expect(interrupted.container.textContent).toContain("중단됨");
      interrupted.unmount();
      const none = row(OUTCOMES.noResult, "ko-none");
      expect(none.container.textContent).toContain("결과 기록 없음");
      none.unmount();
      const unknown = row(OUTCOMES.unknown, "ko-unknown");
      fireEvent.click(toggle());
      expect(unknown.container.textContent).toContain("결과 확인 안 됨 · 종료 코드 기록 없음");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

describe("ToolRow: shape and disclosure", () => {
  it("is a disclosure: aria-expanded + aria-controls pointing at the detail", () => {
    const { container } = row(OUTCOMES.unknown, "disclosure");
    const button = toggle();
    const controls = button.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const detail = container.querySelector(`[id="${controls}"]`);
    expect(detail).not.toBeNull();
    expect(detail?.textContent).toContain("detail body");
  });

  it("uses a minimum height and list text, never a fixed height, fill or border", () => {
    const { container } = row(OUTCOMES.unknown, "shape");
    const line = header(container);
    const classes = (line.getAttribute("class") ?? "").split(/\s+/);
    expect(classes).toContain("min-h-row-tool");
    expect(classes).toContain("text-list");
    expect(classes.some((c) => /^h-\d/.test(c) || /^h-\[/.test(c))).toBe(false);
    const wrapper = container.querySelector("[data-tool-row-wrapper]");
    expect(wrapper, "the row wrapper").not.toBeNull();
    for (const el of [wrapper, line]) {
      const cls = el?.getAttribute("class") ?? "";
      expect(cls).not.toMatch(/(^|\s)(bg-|border(\s|-|$))/);
    }
  });

  it("verb is medium fg-2, icon fg-3", () => {
    const { container } = row(OUTCOMES.unknown, "verb");
    const verb = within(header(container)).queryByText("Bash");
    expect(verb, "the verb").not.toBeNull();
    expect(verb?.className).toContain("text-fg-2");
    expect(verb?.className).toContain("font-medium");
    const icon = header(container).querySelector("[data-tool-icon]");
    expect(icon?.getAttribute("class")).toContain("text-fg-3");
  });

  it("shows the tool id only through 'copy' in the opened detail", () => {
    const { container } = row(OUTCOMES.unknown, "toolid");
    expect(container.textContent).not.toContain("toolu_01ABCDEF");
    expect(screen.queryByRole("button", { name: /copy tool id/i })).toBeNull();
    fireEvent.click(toggle());
    expect(screen.queryByRole("button", { name: /copy tool id/i })).not.toBeNull();
    expect(container.textContent).not.toContain("toolu_01ABCDEF");
  });
});

describe("ToolRow adoption: a path target reads relative, full path in title", () => {
  beforeEach(() => {
    useAppStore.setState({
      selectedProject: { name: "kiln", path: "/Users/dev/.claude/projects/-Users-dev-work-kiln", actual_path: "/Users/dev/work/kiln", session_count: 1, message_count: 1, last_modified: "" } as never,
      homeDir: "/Users/dev",
    });
  });

  it("Read: src/index.ts in the row, /Users/dev/work/kiln/src/index.ts in title", () => {
    const { container } = wrap(
      <UnifiedToolExecutionRenderer
        toolUse={{ type: "tool_use", id: "toolu_read_1", name: "Read", input: { file_path: "/Users/dev/work/kiln/src/index.ts" } }}
        toolResults={[{ type: "tool_result", tool_use_id: "toolu_read_1", content: "     1→export {};" }]}
      />,
    );
    const line = header(container);
    expect(line).not.toBeNull();
    expect(line.textContent).toContain("src/index.ts");
    expect(line.textContent).not.toContain("/Users/dev/work/kiln");
    const path = line.querySelector("[data-path]");
    expect(path?.getAttribute("title")).toBe("/Users/dev/work/kiln/src/index.ts");
    expect(path?.getAttribute("data-path-kind")).toBe("project");
  });
});
