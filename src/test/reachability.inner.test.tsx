/**
 * Plan §6 (중간 PR 도달성) — the TR0 rows only. Each row of the table is an
 * entry users had before TR0 and where it lives after TR0, exercised on the
 * real Claude core card (`UnifiedToolExecutionRenderer` → Bash card →
 * ToolRow) with the real i18n bundles, pointer and keyboard-reachable
 * controls:
 *
 * | 기능                         | before (develop)          | after TR0                                   |
 * |------------------------------|---------------------------|---------------------------------------------|
 * | 도구 ID 보기                 | mono badge in the header  | opened detail → "도구 ID 복사" (copies it)   |
 * | 결과 없는 도구 표시          | yellow Pending pill       | "결과 기록 없음", neutral `--fg-3` icon      |
 * | 판정 근거 없는 도구 (E15)    | red card + green Completed| quiet row + stderr zone + "결과 확인 안 됨"  |
 *
 * Later PRs (TR1a–c, TR5 …) add their own rows here. The 390 / touch side of
 * these rows (row ≥ 44px, no page overflow) is measured by the capture
 * harness probes (`toolRowMetrics`), which jsdom cannot lay out.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import i18n from "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { useAppStore } from "@/store/useAppStore";
import { UnifiedToolExecutionRenderer } from "@/components/contentRenderer/UnifiedToolExecutionRenderer";

const CWD = "/Users/dev/work/kiln";
const E15 = { stdout: "", stderr: "fatal: not a git repository (or any of the parent directories): .git", interrupted: false };
const SUCCESS_WORDS = /completed|success|성공|완료/i;
const PENDING_WORDS = /pending|대기/i;
/** Fill / tint classes that carry a verdict or a tool colour. */
const COLOURED = "[class*='success'], [class*='green'], [class*='emerald'], [class*='destructive'], [class*='tool-'], [class*='warning'], [class*='amber'], [class*='yellow']";

const own = (toolUseResult: unknown) => ({
  toolUseResult,
  toolUseResultSource: { messageUuid: "u", sessionId: "s", contentIndex: 0, association: "single_result" },
});

function bashCard(id: string, command: string, results: Record<string, unknown>[]) {
  const ui: ReactNode = (
    <ExpandKeyProvider value={`msg-${id}`}>
      <UnifiedToolExecutionRenderer
        toolUse={{ type: "tool_use", id, name: "Bash", input: { command } }}
        toolResults={results.map((r) => ({ type: "tool_result", tool_use_id: id, ...r }))}
      />
    </ExpandKeyProvider>
  );
  return render(ui);
}

/** The row header ([data-tool-row]); an assertion, not a crash, when absent. */
function rowOf(container: HTMLElement): HTMLElement {
  const row = container.querySelector("[data-tool-row]");
  expect(row, "a ToolRow header ([data-tool-row])").not.toBeNull();
  return row as HTMLElement;
}

/** The row's disclosure: a native button (Enter/Space activate it), in the tab order. */
function disclosureOf(container: HTMLElement): HTMLButtonElement {
  const button = within(rowOf(container)).queryByRole("button", { expanded: false });
  expect(button, "the row's collapsed disclosure button").not.toBeNull();
  const el = button as HTMLButtonElement;
  expect(el.tagName).toBe("BUTTON");
  expect(el.disabled).toBe(false);
  expect(el.tabIndex).toBeGreaterThanOrEqual(0);
  expect(el.getAttribute("aria-controls")).toBeTruthy();
  return el;
}

function openRow(container: HTMLElement): HTMLElement {
  const button = disclosureOf(container);
  button.focus();
  expect(document.activeElement).toBe(button);
  fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("true");
  const detail = document.getElementById(button.getAttribute("aria-controls") as string);
  expect(detail, "the detail the disclosure controls").not.toBeNull();
  expect((detail as HTMLElement).hidden).toBe(false);
  return detail as HTMLElement;
}

const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});

beforeAll(async () => {
  await i18n.changeLanguage("ko");
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
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});
afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("TR0 reachability (plan §6)", () => {
  it("도구 ID 보기: not a header badge any more; the opened detail's 'Copy tool ID' copies it", async () => {
    const id = "toolu_01ReachabilityToolId000000";
    const { container } = bashCard(id, "pnpm build", [{ content: "Exit code 1\nbuild failed", is_error: true, ...own({ stdout: "build failed", stderr: "", interrupted: false, exitCode: 1 }) }]);

    // Collapsed: the id is nowhere on screen (no mono badge in the row).
    expect(container.textContent).not.toContain(id);

    // Pointer: open the card's first disclosure, whatever shape the card has.
    const first = container.querySelector("button[aria-expanded='false']");
    expect(first, "a collapsed disclosure").not.toBeNull();
    fireEvent.click(first as HTMLElement);
    expect(within(container).queryByRole("button", { name: "도구 ID 복사" }), "'Copy tool ID' once opened").not.toBeNull();
    fireEvent.click(first as HTMLElement);

    expect(rowOf(container).textContent).not.toContain(id);
    const detail = openRow(container);
    const copy = within(detail).queryByRole("button", { name: "도구 ID 복사" });
    expect(copy, "a 'Copy tool ID' button in the opened detail").not.toBeNull();
    expect((copy as HTMLButtonElement).tabIndex).toBeGreaterThanOrEqual(0);
    fireEvent.click(copy as HTMLButtonElement);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(id));
    await waitFor(() => expect((copy as HTMLElement).getAttribute("title")).toBe("도구 ID 복사됨"));
  });

  it("결과 없는 도구: '결과 기록 없음' with a neutral --fg-3 icon, no Pending pill", () => {
    const { container } = bashCard("toolu_reach_noresult", "pnpm release --dry-run", []);
    expect(container.textContent).not.toMatch(PENDING_WORDS);
    expect(container.textContent).toContain("결과 기록 없음");
    const row = rowOf(container);
    expect(within(row).queryByText("결과 기록 없음")).not.toBeNull();
    const icon = row.querySelector("[data-outcome-icon='no-result']");
    expect(icon, "the no-result icon (shape, not colour alone)").not.toBeNull();
    expect(icon?.getAttribute("class")).toContain("text-fg-3");
    expect(container.textContent).not.toMatch(PENDING_WORDS);
    expect(container.querySelector(COLOURED)).toBeNull();
  });

  it("E15: quiet row, stderr zone and '결과 확인 안 됨' in the detail, no green / Completed", () => {
    const { container } = bashCard("toolu_reach_e15", "git status --porcelain", [{ content: E15.stderr, ...own({ ...E15 }) }]);
    expect(container.textContent).not.toMatch(SUCCESS_WORDS);
    expect(container.querySelector("[class*='success'], [class*='green'], [class*='emerald']")).toBeNull();
    const row = rowOf(container);
    // Quiet: no outcome icon or words in the collapsed row, nothing tinted.
    expect(row.querySelector("[data-outcome-icon]")).toBeNull();
    expect(row.getAttribute("data-tool-verdict")).toBe("unknown");
    expect(container.textContent).not.toMatch(SUCCESS_WORDS);
    expect(container.querySelector(COLOURED)).toBeNull();

    const detail = openRow(container);
    expect(within(detail).queryByText("결과 확인 안 됨 · 종료 코드 기록 없음")).not.toBeNull();
    const stderr = detail.querySelector("[data-stderr]");
    expect(stderr, "the stderr zone").not.toBeNull();
    expect(stderr?.textContent).toContain(E15.stderr);
    expect(container.textContent).not.toMatch(SUCCESS_WORDS);
    expect(container.querySelector("[class*='success'], [class*='green'], [class*='emerald']")).toBeNull();
  });
});
