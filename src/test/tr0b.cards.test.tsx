/**
 * TR0b: the six cards TR0 did not convert (WebFetch, WebSearch, Agent,
 * AskUserQuestion, Workflow, Default incl. MCP) state their outcome with
 * TR0's adapter and ToolRow's status words, and draw a neutral frame.
 *
 * - no result → "No result recorded" + its glyph; never "Pending";
 * - succeeded / unknown → nothing: no status word, no success colour;
 * - `is_error`, an `error_code` alone (WebFetch `url_not_accessible`) →
 *   "Failed" / "Failed · <code>"; interrupted → "Interrupted";
 * - the card frame never carries a tool tint or success fill; the error
 *   frame appears only when the adapter says failed;
 * - the card's status element is the very element ToolRow renders for the
 *   same outcome (one implementation, shared).
 *
 * Inputs are the harness fixture shapes (scripts/ui-capture/fixtures) as the
 * #727 API delivers them: per-result metadata on the result block.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ReactNode } from "react";
import i18n from "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { UnifiedToolExecutionRenderer } from "@/components/contentRenderer/UnifiedToolExecutionRenderer";
import { ToolRow } from "@/components/transcript/ToolRow";
import { toolFamily, toolOutcome } from "@/components/transcript/toolOutcome";

const ROOT = resolve(__dirname, "../..");
const CARDS_DIR = join(ROOT, "src/components/contentRenderer/unifiedCards");

const own = (toolUseResult: unknown) => ({
  toolUseResult,
  toolUseResultSource: { messageUuid: "u", sessionId: "s", contentIndex: 0, association: "single_result" },
});

interface CardCase {
  card: string;
  name: string;
  input: Record<string, unknown>;
}

/** One tool per card; DefaultCard twice (an MCP tool and an unknown process tool). */
const CARDS: CardCase[] = [
  { card: "WebFetchCard", name: "WebFetch", input: { url: "https://status.example.com/api", prompt: "Is the API up?" } },
  { card: "WebSearchCard", name: "WebSearch", input: { query: "Retry-After HTTP-date delta-seconds" } },
  { card: "AgentCard", name: "Task", input: { description: "Audit the production bundle", prompt: "List the five largest modules.", subagent_type: "general-purpose" } },
  {
    card: "AskUserQuestionCard",
    name: "AskUserQuestion",
    input: { questions: [{ question: "Which storage backend?", header: "Storage", multiSelect: false, options: [{ label: "SQLite" }, { label: "PostgreSQL" }] }] },
  },
  { card: "WorkflowCard", name: "Workflow", input: { description: "Nightly triage", script: "export const meta = { name: 'triage' };" } },
  { card: "DefaultCard (MCP)", name: "mcp__github__create_issue", input: { title: "Flaky preview test" } },
  { card: "DefaultCard (unknown)", name: "exec_command", input: { cmd: "make check" } },
];

type Results = Record<string, unknown>[];
const RESULTS = {
  none: [] as Results,
  plain: [{ content: "Done: 3 items." }] as Results,
  isError: [{ content: "Request failed with status 500", is_error: true }] as Results,
  // The WebFetch fixture shape: the code is recorded only in the block's own metadata.
  errorCodeOnly: [{ content: [{ type: "text", text: '{"error_code":"url_not_accessible"}' }], ...own({ error_code: "url_not_accessible" }) }] as Results,
  interrupted: [{ content: "[Request interrupted by user for tool use]", is_error: true, ...own({ interrupted: true }) }] as Results,
};

let seq = 0;
const wrap = (ui: ReactNode) => render(<ExpandKeyProvider value="msg-tr0b">{ui}</ExpandKeyProvider>);
const toolUseOf = (c: CardCase) => ({ type: "tool_use", id: `toolu_tr0b_${++seq}`, name: c.name, input: c.input });
const resultsFor = (id: string, results: Results) => results.map((r) => ({ type: "tool_result", tool_use_id: id, ...r }));

function renderCard(c: CardCase, results: Results, props: { onViewSubagent?: (id: string) => void } = {}) {
  const toolUse = toolUseOf(c);
  const toolResults = resultsFor(toolUse.id, results);
  const view = wrap(<UnifiedToolExecutionRenderer toolUse={toolUse} toolResults={toolResults} {...props} />);
  const frame = view.container.firstElementChild as HTMLElement;
  expect(frame, "the card's frame element").not.toBeNull();
  return { ...view, toolUse, toolResults, frame };
}

/** The outcome status element (ToolRow's: the element holding the outcome glyph). */
const statusOf = (root: Element) => root.querySelector("[data-outcome-icon]")?.parentElement ?? null;

/** What ToolRow renders as its collapsed status for the same tool call. */
function toolRowStatusHtml(toolUse: Record<string, unknown>, toolResults: Results): string | null {
  const family = toolFamily(String(toolUse.name));
  const view = wrap(
    <ToolRow icon={<span />} verb="x" outcome={toolOutcome(toolUse, toolResults, family)} family={family} expandKey={`row-${++seq}`} />,
  );
  const html = statusOf(view.container)?.outerHTML ?? null;
  view.unmount();
  return html;
}

const openCard = (root: HTMLElement) => {
  const button = within(root).queryAllByRole("button", { expanded: false })[0];
  expect(button, "the card's collapsed disclosure").toBeDefined();
  fireEvent.click(button as HTMLElement);
};

const OLD_WORDS = /pending|completed|success/i;
const STATUS_WORDS = /pending|completed|success|failed|interrupted|no result recorded|\berror\b/i;
const TINT = /(^|\s)(bg|border)-(tool-[a-z]+|success)(\/\d+)?(\s|$)/;
const ERROR_FRAME = "border-destructive/50";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => {
  useExpandRegistry.getState().clearAll();
});

describe.each(CARDS)("$card ($name)", (c) => {
  it("no result: 'No result recorded' with its glyph, never Pending / Completed (collapsed or open)", () => {
    const { frame } = renderCard(c, RESULTS.none);
    expect(frame.textContent).not.toMatch(OLD_WORDS);
    expect(within(frame).queryByText("No result recorded"), "the no-result status words").not.toBeNull();
    expect(frame.querySelector("[data-outcome-icon='no-result']"), "the no-result glyph").not.toBeNull();
    openCard(frame);
    expect(frame.textContent).not.toMatch(OLD_WORDS);
  });

  it("a plain result (succeeded / unknown): no status word, no glyph, no success colour", () => {
    const { frame } = renderCard(c, RESULTS.plain);
    expect(frame.textContent).not.toMatch(STATUS_WORDS);
    expect(frame.querySelector("[data-outcome-icon]")).toBeNull();
    expect(frame.querySelector("[class*='success']"), "no success colour in the collapsed card").toBeNull();
    expect(frame.className).not.toMatch(/success/);
  });

  it("is_error: 'Failed' with the failed glyph and the error frame", () => {
    const { frame } = renderCard(c, RESULTS.isError);
    expect(within(frame).queryByText("Failed"), "the failed status words").not.toBeNull();
    expect(frame.querySelector("[data-outcome-icon='failed']")).not.toBeNull();
    expect(frame.className).toContain(ERROR_FRAME);
  });

  it("error_code only (WebFetch url_not_accessible shape): 'Failed · url_not_accessible', error frame", () => {
    const { frame } = renderCard(c, RESULTS.errorCodeOnly);
    expect(frame.textContent).not.toMatch(OLD_WORDS);
    expect(within(frame).queryByText("Failed · url_not_accessible")).not.toBeNull();
    expect(frame.className).toContain(ERROR_FRAME);
  });

  it("interrupted: 'Interrupted' with its glyph; no error frame (the adapter does not say failed)", () => {
    const { frame } = renderCard(c, RESULTS.interrupted);
    expect(within(frame).queryByText("Interrupted")).not.toBeNull();
    expect(frame.querySelector("[data-outcome-icon='interrupted']")).not.toBeNull();
    expect(frame.className).not.toContain("destructive");
  });

  it.each(Object.keys(RESULTS) as (keyof typeof RESULTS)[])("frame (%s): no tool tint or success fill; error frame only when failed", (state) => {
    const { frame, toolUse, toolResults } = renderCard(c, RESULTS[state]);
    expect(frame.className).not.toMatch(TINT);
    const failed = toolOutcome(toolUse, toolResults, toolFamily(c.name)).verdict === "failed";
    if (failed) expect(frame.className).toContain(ERROR_FRAME);
    else expect(frame.className).not.toContain("destructive");
  });

  it.each(["none", "isError", "errorCodeOnly", "interrupted"] as const)("%s: the card's status is the element ToolRow renders", (state) => {
    const { frame, toolUse, toolResults } = renderCard(c, RESULTS[state]);
    const expected = toolRowStatusHtml(toolUse, toolResults);
    expect(expected, "ToolRow states this outcome").not.toBeNull();
    expect(statusOf(frame)?.outerHTML ?? null).toBe(expected);
  });
});

describe("DefaultCard (unknown process tool): a recorded exit code reads as ToolRow says it", () => {
  it("exit code 2 → 'Failed · exit code 2'", () => {
    const { frame, toolUse, toolResults } = renderCard(CARDS[6], [{ content: "make: *** [check] Error 2", ...own({ exitCode: 2 }) }]);
    expect(within(frame).queryByText("Failed · exit code 2")).not.toBeNull();
    expect(statusOf(frame)?.outerHTML ?? null).toBe(toolRowStatusHtml(toolUse, toolResults));
  });
});

describe("the cards keep their props acting", () => {
  it("AgentCard: onViewSubagent still opens the subagent conversation", () => {
    const onViewSubagent = vi.fn();
    const { frame, toolUse } = renderCard(CARDS[2], RESULTS.plain, { onViewSubagent });
    openCard(frame);
    fireEvent.click(within(frame).getByRole("button", { name: "View Conversation" }));
    expect(onViewSubagent).toHaveBeenCalledWith(toolUse.id);
  });

  it.each([CARDS[3], CARDS[5]])("$card: a search hit inside the input still opens the card", (c) => {
    const toolUse = toolUseOf(c);
    const query = c.name === "AskUserQuestion" ? "PostgreSQL" : "Flaky preview";
    const view = wrap(<UnifiedToolExecutionRenderer toolUse={toolUse} toolResults={[]} searchQuery={query} isCurrentMatch currentMatchIndex={0} />);
    expect(view.container.querySelector("mark")?.textContent?.toLowerCase()).toBe(query.toLowerCase());
  });
});

describe("one status implementation", () => {
  const sources = (readdirSync(join(ROOT, "src"), { recursive: true }) as string[])
    .map((rel) => join(ROOT, "src", rel))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !f.includes("types.generated") && statSync(f).isFile());

  it("the old StatusBadge is gone", () => {
    expect(existsSync(join(CARDS_DIR, "StatusBadge.tsx"))).toBe(false);
    expect(sources.filter((f) => /\bStatusBadge\b/.test(readFileSync(f, "utf8")))).toEqual([]);
  });

  it("the status words are rendered by exactly one transcript module", () => {
    for (const key of ["toolOutcome.noResult", "toolOutcome.interrupted", "toolOutcome.failedErrorCode"]) {
      const users = sources.filter((f) => readFileSync(f, "utf8").includes(`"${key}"`)).map((f) => f.replace(`${ROOT}/`, ""));
      expect(users, key).toHaveLength(1);
      expect(users[0], key).toMatch(/^src\/components\/transcript\//);
    }
  });
});
