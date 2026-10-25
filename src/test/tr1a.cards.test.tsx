/**
 * TR1a: the six remaining paired cards (WebSearch, WebFetch, Agent,
 * Workflow, AskUserQuestion, Default incl. MCP) are ToolRows.
 *
 * - Head: the recorded tool name (D-R5) · the target, relative when it is a
 *   path (D1) · the outcome from `toolOutcome` only (failed / interrupted /
 *   no result shown, success and unknown quiet). No RendererHeader frame, no
 *   tint, danger styling only when the verdict is failed.
 * - Amendment 7: an `error_code` alone (WebFetch `url_not_accessible`)
 *   is \"Failed · <code>\"; the opened detail states the code once more never
 *   (no \"Claude API Response\" JSON box, no echoed `{\"error_code\":…}`).
 * - NC3 / NC5 / #731: the failure is said once (no \"An error occurred\"
 *   title); opened Agent / Workflow bodies carry no green check and no fill;
 *   the subagent type is plain text; prompt / result are not nested boxes;
 *   a preview shows no raw markdown markers.
 * - D-R1: the Default path routes by name (one table); any other name gets
 *   honest JSON with a \"Show all\" disclosure when capped.
 * - Props keep acting: search highlight + auto-open (an effect keyed on the
 *   query: collapse while matching stays collapsed, a new matching query
 *   opens again), onViewSubagent, the workflow's agent list.
 * - Characterization: every piece of information the old card showed is
 *   still there once everything is opened.
 *
 * Inputs follow the harness fixture shapes (scripts/ui-capture/fixtures) as
 * the #727 API delivers them: per-result metadata on the result block.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import i18n from "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { useAppStore } from "@/store/useAppStore";
import { UnifiedToolExecutionRenderer } from "@/components/contentRenderer/UnifiedToolExecutionRenderer";
import { ToolRow } from "@/components/transcript/ToolRow";
import { toolFamily, toolOutcome } from "@/components/transcript/toolOutcome";
import { formatterFor } from "@/lib/format/useFormat";
import { BODY_BY_NAME, bodyKindFor } from "@/components/contentRenderer/unifiedCards/toolBodies";
import type { SubagentSession } from "@/types";

const CWD = "/Users/dev/work/kiln";
const WJ = /\u2060/g;

const own = (toolUseResult: unknown) => ({
  toolUseResult,
  toolUseResultSource: { messageUuid: "u", sessionId: "s", contentIndex: 0, association: "single_result" },
});

type Results = Record<string, unknown>[];
const RESULTS = {
  none: [] as Results,
  plain: [{ content: "Done: 3 items." }] as Results,
  isError: [{ content: "Request failed with status 500", is_error: true }] as Results,
  // The WebFetch fixture (inner.mjs `outcomes`): the code only in the block's own metadata, echoed as JSON text.
  errorCodeOnly: [{ content: [{ type: "text", text: '{"error_code":"url_not_accessible"}' }], ...own({ error_code: "url_not_accessible" }) }] as Results,
  interrupted: [{ content: "[Request interrupted by user for tool use]", is_error: true, ...own({ interrupted: true }) }] as Results,
};

interface HeadCase {
  card: string;
  name: string;
  input: Record<string, unknown>;
  /** Text the collapsed row shows as its target. */
  target: string;
  /** Caption meta the collapsed row shows. */
  meta?: string[];
}

const ASK_INPUT = {
  questions: [
    {
      question: "Which storage backend?",
      header: "Storage",
      multiSelect: false,
      options: [
        { label: "SQLite", description: "Bundled file database" },
        { label: "PostgreSQL", description: "Networked server" },
      ],
    },
  ],
};

const HEADS: HeadCase[] = [
  { card: "WebSearchCard", name: "WebSearch", input: { query: "Retry-After HTTP-date delta-seconds" }, target: "Retry-After HTTP-date delta-seconds" },
  { card: "WebFetchCard", name: "WebFetch", input: { url: "https://status.example.com/api", prompt: "Is the API up?" }, target: "https://status.example.com/api" },
  {
    card: "AgentCard",
    name: "Task",
    input: { description: "Audit the production bundle", prompt: "List the five largest modules.", subagent_type: "general-purpose", run_in_background: true },
    target: "Audit the production bundle",
    meta: ["general-purpose", "background"],
  },
  { card: "WorkflowCard", name: "Workflow", input: { description: "Nightly triage", script: "export const meta = { name: 'triage-nightly' };" }, target: "triage-nightly" },
  { card: "AskUserQuestionCard", name: "AskUserQuestion", input: ASK_INPUT, target: "Which storage backend?" },
  { card: "DefaultCard (MCP)", name: "mcp__github__create_issue", input: { title: "Flaky preview test", body: "It fails on CI." }, target: "Flaky preview test" },
  { card: "DefaultCard (path input)", name: "mcp__fs__read_text_file", input: { path: `${CWD}/src/preview/renderPreview.ts` }, target: "src/preview/renderPreview.ts" },
];

let seq = 0;
const nextId = () => `toolu_tr1a_${++seq}`;
const wrap = (ui: ReactNode, scope = "msg-tr1a") => render(<ExpandKeyProvider value={scope}>{ui}</ExpandKeyProvider>);
const toolResultsFor = (id: string, results: Results) => results.map((r) => ({ type: "tool_result", tool_use_id: id, ...r }));

interface RenderProps {
  onViewSubagent?: (id: string) => void;
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
}

function renderTool(name: string, input: Record<string, unknown>, results: Results = [], props: RenderProps = {}, id = nextId()) {
  const toolUse = { type: "tool_use", id, name, input };
  const toolResults = toolResultsFor(id, results);
  const element = (p: RenderProps) => (
    <ExpandKeyProvider value="msg-tr1a">
      <UnifiedToolExecutionRenderer toolUse={toolUse} toolResults={toolResults} {...p} />
    </ExpandKeyProvider>
  );
  const view = render(element(props));
  return { ...view, toolUse, toolResults, rerenderWith: (p: RenderProps) => view.rerender(element(p)) };
}

const rowOf = (root: Element) => {
  const row = root.querySelector("[data-tool-row]");
  expect(row, "a ToolRow head ([data-tool-row])").not.toBeNull();
  return row as HTMLElement;
};
const rowButton = (root: Element) => {
  const button = rowOf(root).querySelector("button[aria-expanded]");
  expect(button, "the row's disclosure button").not.toBeNull();
  return button as HTMLElement;
};
const isOpen = (root: Element) => rowButton(root).getAttribute("aria-expanded") === "true";
const openRow = (root: Element) => {
  const button = rowButton(root);
  if (button.getAttribute("aria-expanded") !== "true") fireEvent.click(button);
  expect(isOpen(root), "the row opened").toBe(true);
};
const detailOf = (root: Element) => {
  const detail = root.querySelector("[data-tool-detail]:not([hidden])");
  expect(detail, "the opened row detail").not.toBeNull();
  return detail as HTMLElement;
};
/** Open everything a user can open: disclosures, show-all toggles, and the old cards' unlabelled folds. */
const openEverything = (root: HTMLElement) => {
  for (let guard = 0; guard < 30; guard += 1) {
    const next = [...root.querySelectorAll<HTMLElement>("button")].find(
      (b) => b.getAttribute("aria-expanded") === "false" || /^Toggle /.test(b.getAttribute("aria-label") ?? "") && !b.dataset.tr1aOpened,
    );
    if (!next) return;
    next.dataset.tr1aOpened = "1";
    fireEvent.click(next);
  }
};
const text = (el: Element) => (el.textContent ?? "").replace(WJ, "");
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;
const classesIn = (root: Element) => [root, ...root.querySelectorAll("*")].flatMap((el) => (el.getAttribute("class") ?? "").split(/\s+/)).filter(Boolean);
const statusOf = (root: Element) => root.querySelector("[data-outcome-icon]")?.parentElement ?? null;

function toolRowStatusHtml(toolUse: Record<string, unknown>, toolResults: Results): string | null {
  const family = toolFamily(String(toolUse.name));
  const view = wrap(<ToolRow icon={<span />} verb="x" outcome={toolOutcome(toolUse, toolResults, family)} family={family} expandKey={`row-${nextId()}`} />);
  const html = statusOf(view.container)?.outerHTML ?? null;
  view.unmount();
  return html;
}

/** A tool tint, a status fill or a success colour (the old cards' frames, pills and bands). */
const TINT = /^(?:[a-z-]+:)*(?:bg|border)-(?:tool-[a-z]+|success|amber-\d+|primary|destructive|muted|card|secondary)(?:\/\d+)?$/;
const DANGER = /destructive|danger/;

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
    subagentSessions: [],
  });
});

// ---------------------------------------------------------------------------
// The head
// ---------------------------------------------------------------------------

describe.each(HEADS)("$card ($name): ToolRow head", (c) => {
  it("is a ToolRow: the recorded tool name, then the target; no card frame, no tint", () => {
    const { container } = renderTool(c.name, c.input, RESULTS.plain);
    const row = rowOf(container);
    const verb = row.querySelector("[data-tool-verb]");
    expect(verb?.textContent ?? null, "the verb is the recorded tool name").toBe(c.name);
    expect(text(row)).toContain(c.target);
    for (const meta of c.meta ?? []) expect(text(row)).toContain(meta);
    expect(text(row), "no absolute path in the row (D1)").not.toContain("/Users/dev");
    expect(container.querySelector(".overflow-hidden.border"), "no RendererHeader card frame").toBeNull();
    expect(classesIn(container).filter((cls) => TINT.test(cls))).toEqual([]);
  });

  it("success / unknown is quiet: no status, no glyph, no danger styling", () => {
    const { container } = renderTool(c.name, c.input, RESULTS.plain);
    expect(container.querySelector("[data-outcome-icon]")).toBeNull();
    expect(text(rowOf(container))).not.toMatch(/completed|success|failed|error/i);
    expect(classesIn(container).filter((cls) => DANGER.test(cls))).toEqual([]);
  });

  it("no result: 'No result recorded' in the row, from the adapter (ToolRow's element)", () => {
    const { container, toolUse, toolResults } = renderTool(c.name, c.input, RESULTS.none);
    expect(within(rowOf(container)).queryByText("No result recorded")).not.toBeNull();
    expect(statusOf(rowOf(container))?.outerHTML ?? null).toBe(toolRowStatusHtml(toolUse, toolResults));
    expect(text(container)).not.toMatch(/pending/i);
  });

  it("error_code only (amendment 7): 'Failed · url_not_accessible' in the row; failure said once when opened", () => {
    const { container, toolUse, toolResults } = renderTool(c.name, c.input, RESULTS.errorCodeOnly);
    const row = rowOf(container);
    expect(within(row).queryByText("Failed · url_not_accessible")).not.toBeNull();
    expect(statusOf(row)?.outerHTML ?? null).toBe(toolRowStatusHtml(toolUse, toolResults));
    expect(row.getAttribute("data-tool-verdict")).toBe("failed");
    openRow(container);
    const all = text(container);
    expect(all).not.toContain("An error occurred");
    expect(count(all, "Failed"), all).toBe(1);
    expect(count(all, "url_not_accessible"), all).toBe(1);
    expect(all).not.toContain("Claude API Response");
  });

  it("is_error: 'Failed' once; the danger colour only in the status", () => {
    const { container } = renderTool(c.name, c.input, RESULTS.isError);
    const row = rowOf(container);
    expect(within(row).queryByText("Failed")).not.toBeNull();
    openRow(container);
    expect(count(text(container), "Failed")).toBe(1);
    expect(text(container)).not.toContain("An error occurred");
    const status = statusOf(row) as HTMLElement;
    const outside = [...container.querySelectorAll("*")].filter((el) => !status.contains(el) && el !== status && DANGER.test(el.getAttribute("class") ?? "") && !el.closest("[data-stderr]"));
    expect(outside.map((el) => el.outerHTML.slice(0, 120))).toEqual([]);
  });

  it("interrupted: 'Interrupted' in the row, no danger styling", () => {
    const { container } = renderTool(c.name, c.input, RESULTS.interrupted);
    expect(within(rowOf(container)).queryByText("Interrupted")).not.toBeNull();
    expect(classesIn(container).filter((cls) => DANGER.test(cls))).toEqual([]);
  });

  it("'Copy tool ID' ends the opened detail's meta line (amendment 4)", () => {
    const { container } = renderTool(c.name, c.input, RESULTS.plain);
    openRow(container);
    const meta = detailOf(container).querySelector(":scope > [data-meta]");
    expect(meta, "the detail meta line").not.toBeNull();
    const last = meta?.lastElementChild;
    expect(last?.tagName).toBe("BUTTON");
    expect(last?.textContent).toBe("Copy tool ID");
  });
});

describe("WebFetch url_not_accessible (transcript-failure fixture)", () => {
  it("the row says Failed · url_not_accessible; the detail shows the URL and prompt, no JSON box and no echoed code", () => {
    const { container } = renderTool("WebFetch", { url: "https://status.example.com/api", prompt: "Is the API up?" }, RESULTS.errorCodeOnly);
    expect(within(rowOf(container)).queryByText("Failed · url_not_accessible")).not.toBeNull();
    openRow(container);
    const detail = detailOf(container);
    expect(text(detail)).toContain("Is the API up?");
    expect(text(detail)).not.toContain('"error_code"');
    expect(text(detail)).not.toContain("Claude API Response");
  });

  it("a different error text beside the code is kept (only the exact echo is dropped)", () => {
    const { container } = renderTool("WebFetch", { url: "https://a.example" }, [
      { content: [{ type: "text", text: "Fetch failed: DNS lookup for a.example timed out" }], ...own({ error_code: "url_not_accessible" }) },
    ]);
    openRow(container);
    expect(text(detailOf(container))).toContain("Fetch failed: DNS lookup for a.example timed out");
  });

  it("a successful fetch: quiet row, the result text in the detail", () => {
    const { container } = renderTool("WebFetch", { url: "https://example.com/changelog", prompt: "What changed in 2.3?" }, [
      { content: "2.3 adds retry headers.", ...own({ code: 200, codeText: "OK", result: "2.3 adds retry headers.", bytes: 2048, durationMs: 120, url: "https://example.com/changelog" }) },
    ]);
    expect(container.querySelector("[data-outcome-icon]")).toBeNull();
    openRow(container);
    expect(text(detailOf(container))).toContain("2.3 adds retry headers.");
  });
});

// ---------------------------------------------------------------------------
// Characterization: what each old card showed is still shown
// ---------------------------------------------------------------------------

describe("characterization: every recorded piece the old card showed is still shown (all opened)", () => {
  const fmt = formatterFor("en");

  it("WebSearch: query and result text", () => {
    const { container } = renderTool("WebSearch", { query: "vitest browser mode" }, [{ content: "Web search results for query: vitest browser mode\n\nLinks: [...]" }]);
    openEverything(container);
    expect(text(container)).toContain("vitest browser mode");
    expect(text(container)).toContain("Links: [...]");
  });

  it("WebFetch: url, prompt and result text", () => {
    const { container } = renderTool("WebFetch", { url: "https://example.com/changelog", prompt: "What changed in 2.3?" }, [{ content: "2.3 adds retry headers." }]);
    openEverything(container);
    for (const piece of ["https://example.com/changelog", "What changed in 2.3?", "2.3 adds retry headers."]) expect(text(container)).toContain(piece);
  });

  it("Agent: description, type, background, model, isolation, prompt, result and its stats, view conversation", () => {
    const onViewSubagent = vi.fn();
    const { container, toolUse } = renderTool(
      "Task",
      { description: "Audit the production bundle", prompt: "List the five largest modules.", subagent_type: "general-purpose", run_in_background: true, model: "claude-sonnet-4", isolation: "worktree" },
      [{ content: [{ type: "text", text: "The largest module is **vendor.js**." }], totalDurationMs: 2_000, totalTokens: 12_400, totalToolUseCount: 3 }],
      { onViewSubagent },
    );
    openEverything(container);
    const all = text(container);
    for (const piece of ["Audit the production bundle", "general-purpose", "background", "claude-sonnet-4", "worktree", "List the five largest modules.", "vendor.js"]) {
      expect(all, piece).toContain(piece);
    }
    expect(all).toContain(fmt.duration(2_000).replace(WJ, ""));
    expect(all).toContain(fmt.tokens(12_400).replace(WJ, ""));
    expect(all).toContain("3");
    fireEvent.click(within(container).getByRole("button", { name: "View Conversation" }));
    expect(onViewSubagent).toHaveBeenCalledWith(toolUse.id);
  });

  it("Workflow: description, name, run id, script, result and the run's agents", () => {
    const navigateToSubagent = vi.fn(async () => {});
    const runId = "wf_1a198a78-3be";
    const agent: SubagentSession = {
      agent_id: "a1",
      file_path: "/x/agent-a1.jsonl",
      message_count: 7,
      file_size: 1,
      first_message_time: null,
      last_message_time: null,
      summary: "Checked the schema",
      tool_use_id: null,
      workflow_run_id: runId,
    };
    useAppStore.setState({ subagentSessions: [agent], navigateToSubagent } as never);
    const script = "export const meta = { name: 'verify-schemas' };\nphase('Verify')";
    const { container } = renderTool("Workflow", { description: "Confirm schemas before building", script }, [
      { content: `Workflow launched in background. Task ID: w364\nTranscript dir: /tmp/p/subagents/workflows/${runId}` },
    ]);
    openEverything(container);
    const all = text(container);
    for (const piece of ["Confirm schemas before building", "verify-schemas", runId, "phase('Verify')", "Workflow launched in background.", "Checked the schema", "7 messages"]) {
      expect(all, piece).toContain(piece);
    }
    const agentButton = within(container).getAllByRole("button", { name: "View Conversation" })[0];
    expect(agentButton).toBeDefined();
    fireEvent.click(agentButton as HTMLElement);
    expect(navigateToSubagent).toHaveBeenCalledWith(agent);
  });

  it("AskUserQuestion: header, question, every option label and description, and the answer", () => {
    const { container } = renderTool("AskUserQuestion", ASK_INPUT, [{ content: 'User has answered your questions: "Which storage backend?"="SQLite".' }]);
    openEverything(container);
    for (const piece of ["Storage", "Which storage backend?", "SQLite", "Bundled file database", "PostgreSQL", "Networked server", '"SQLite"']) {
      expect(text(container), piece).toContain(piece);
    }
  });

  it("Default (MCP): the input keys and values, and the result", () => {
    const { container } = renderTool("mcp__github__create_issue", { title: "Flaky preview test", labels: ["ci"] }, [{ content: "Created issue #812" }]);
    openEverything(container);
    for (const piece of ["Input", "title", "labels", '"Flaky preview test"', '"ci"', "Created issue #812"]) expect(text(container), piece).toContain(piece);
  });
});

// ---------------------------------------------------------------------------
// NC3 / #731: opened Agent and Workflow bodies
// ---------------------------------------------------------------------------

describe("NC3: the opened Agent body", () => {
  const AGENT = { description: "Audit the production bundle", prompt: "List the **five** largest modules.", subagent_type: "Explore", run_in_background: true };
  const RESULT = [{ content: [{ type: "text", text: "**ToolUseCard** is the largest." }], totalTokens: 900 }];

  it("the subagent type is plain text: no pill, no uppercase, no tracking", () => {
    const { container } = renderTool("Task", AGENT, RESULT);
    const type = within(rowOf(container)).queryByText("Explore");
    expect(type, "the subagent type in the row").not.toBeNull();
    const cls = type?.getAttribute("class") ?? "";
    expect(cls).not.toMatch(/uppercase|tracking|border|bg-|px-/);
  });

  it("opened: no green check, no success colour, no fill or tint anywhere in the body", () => {
    const { container } = renderTool("Task", AGENT, RESULT);
    openEverything(container);
    expect(container.querySelector(".lucide-circle-check, .lucide-circle-check-big, .lucide-check")).toBeNull();
    expect(classesIn(container).filter((cls) => /success/.test(cls))).toEqual([]);
    expect(classesIn(container).filter((cls) => TINT.test(cls))).toEqual([]);
  });

  it("prompt and result are not nested boxes: the only disclosures inside the detail are 'show all' toggles wired with aria-controls", () => {
    const { container } = renderTool("Task", AGENT, RESULT);
    openRow(container);
    const detail = detailOf(container);
    expect(text(detail)).toContain("largest modules");
    expect(text(detail)).toContain("ToolUseCard");
    for (const button of detail.querySelectorAll("button[aria-expanded]")) {
      const controls = button.getAttribute("aria-controls") ?? "";
      expect(controls, button.outerHTML.slice(0, 120)).not.toBe("");
      for (const id of controls.split(/\s+/)) expect(document.getElementById(id), `aria-controls → #${id}`).not.toBeNull();
    }
    expect(detail.querySelector("[aria-label='Toggle prompt'], [aria-label='Toggle result']")).toBeNull();
  });

  it("previews show no raw markdown markers", () => {
    const { container } = renderTool("Task", { prompt: "**Audit** the `bundle` and _report_" }, RESULT);
    const row = rowOf(container);
    expect(text(row)).toContain("Audit the bundle and report");
    expect(text(row)).not.toMatch(/\*\*|`|_report_/);
    openRow(container);
    expect(text(detailOf(container))).not.toContain("**");
  });

  it("a long prompt is capped with a 'Show all' disclosure (aria-expanded + aria-controls), never cut silently", () => {
    const prompt = Array.from({ length: 40 }, (_, i) => `Step ${i + 1}: check module ${i + 1}.`).join("\n\n");
    const { container } = renderTool("Task", { description: "Long audit", prompt }, RESULT);
    openRow(container);
    const detail = detailOf(container);
    expect(text(detail)).not.toContain("Step 40:");
    const showAll = [...detail.querySelectorAll("button[aria-expanded='false']")].find((b) => /Show all/.test(b.textContent ?? ""));
    expect(showAll, "a Show all toggle").toBeDefined();
    const target = document.getElementById(showAll?.getAttribute("aria-controls") ?? "");
    expect(target).not.toBeNull();
    fireEvent.click(showAll as HTMLElement);
    expect(showAll?.getAttribute("aria-expanded")).toBe("true");
    expect(text(detail)).toContain("Step 40:");
  });
});

describe("#731: the opened Workflow body", () => {
  it("no green check, no success colour, no tint or fill band", () => {
    const { container } = renderTool("Workflow", { description: "Nightly triage", script: "export const meta = { name: 'triage-nightly' };" }, [{ content: "Workflow launched." }]);
    openEverything(container);
    expect(container.querySelector(".lucide-circle-check, .lucide-circle-check-big")).toBeNull();
    expect(classesIn(container).filter((cls) => /success/.test(cls))).toEqual([]);
    expect(classesIn(container).filter((cls) => TINT.test(cls))).toEqual([]);
    expect(text(container)).toContain("Workflow launched.");
  });
});

// ---------------------------------------------------------------------------
// D-R1: the Default path's name → body table
// ---------------------------------------------------------------------------

describe("D-R1: one name → body table for the Default path", () => {
  it("the table", () => {
    expect(bodyKindFor("TodoWrite")).toBe("todo");
    expect(bodyKindFor("todowrite")).toBe("todo");
    expect(bodyKindFor("update_plan")).toBe("plan");
    expect(bodyKindFor("NotebookEdit")).toBe("notebook");
    expect(bodyKindFor("TaskCreate")).toBe("taskCreate");
    expect(bodyKindFor("TaskUpdate")).toBe("taskUpdate");
    // No parser for its input exists in the tree yet (TR2b owns it): honest JSON.
    expect(bodyKindFor("apply_patch")).toBe("json");
    expect(bodyKindFor("mcp__github__create_issue")).toBe("json");
    expect(bodyKindFor("constructor")).toBe("json");
    expect(bodyKindFor("__proto__")).toBe("json");
    expect(Object.keys(BODY_BY_NAME).sort()).toEqual(["NotebookEdit", "TaskCreate", "TaskUpdate", "TodoWrite", "apply_patch", "todowrite", "update_plan"]);
  });

  it("TodoWrite → the structured todo list in the detail, not JSON", () => {
    const todos = [
      { content: "Write the red tests", status: "completed", activeForm: "Writing" },
      { content: "Convert the cards", status: "in_progress", activeForm: "Converting" },
      { content: "Run the gates", status: "pending", activeForm: "Running" },
    ];
    const { container } = renderTool("TodoWrite", { todos }, [{ content: "Todos have been modified successfully." }]);
    expect(text(rowOf(container))).toContain("3 items");
    openRow(container);
    const detail = detailOf(container);
    for (const todo of todos) expect(text(detail)).toContain(todo.content);
    expect(text(detail)).not.toContain('"todos"');
  });

  it("update_plan → the plan steps and explanation, not JSON", () => {
    const { container } = renderTool("update_plan", { explanation: "Ship TR1a first", plan: [{ step: "Red tests", status: "completed" }, { step: "Cards", status: "in_progress" }] }, [{ content: "Plan updated" }]);
    expect(text(rowOf(container))).toContain("2 tasks");
    openRow(container);
    const detail = detailOf(container);
    for (const piece of ["Ship TR1a first", "Red tests", "Cards"]) expect(text(detail)).toContain(piece);
    expect(text(detail)).not.toContain('"plan"');
  });

  it("NotebookEdit → relative notebook path in the row, one summary line, the new source", () => {
    const { container } = renderTool("NotebookEdit", { notebook_path: `${CWD}/notebooks/eda.ipynb`, cell_number: 3, new_source: "df.describe()", cell_type: "code", edit_mode: "replace" }, [{ content: "Updated cell 3" }]);
    const row = rowOf(container);
    expect(text(row)).toContain("notebooks/eda.ipynb");
    expect(text(row)).not.toContain("/Users/dev");
    openRow(container);
    const summary = detailOf(container).querySelector("[data-tool-summary]");
    expect(summary, "the summary line").not.toBeNull();
    for (const piece of ["replace", "3", "code"]) expect(text(summary as Element)).toContain(piece);
    expect(text(detailOf(container))).toContain("df.describe()");
    expect(text(detailOf(container))).not.toContain('"notebook_path"');
  });

  it("TaskCreate → the subject in the row, one summary line", () => {
    const { container } = renderTool("TaskCreate", { subject: "Migrate the cards", description: "All six cards", activeForm: "Migrating the cards" }, [{ content: "Task #4 created" }]);
    expect(text(rowOf(container))).toContain("Migrate the cards");
    openRow(container);
    const detail = detailOf(container);
    expect(detail.querySelector("[data-tool-summary]")).not.toBeNull();
    for (const piece of ["All six cards", "Migrating the cards", "Task #4 created"]) expect(text(detail)).toContain(piece);
    expect(text(detail)).not.toContain('"subject"');
  });

  it("TaskUpdate → the task number in the row, one summary line with the status", () => {
    const { container } = renderTool("TaskUpdate", { taskId: "4", status: "completed", owner: "builder", addBlocks: ["5"] }, [{ content: "Updated task #4 status" }]);
    expect(text(rowOf(container))).toContain("#4");
    openRow(container);
    const summary = detailOf(container).querySelector("[data-tool-summary]");
    expect(summary, "the summary line").not.toBeNull();
    for (const piece of ["Completed", "builder", "#5"]) expect(text(summary as Element)).toContain(piece);
    expect(text(detailOf(container))).not.toContain('"taskId"');
  });

  it("apply_patch → honest JSON (no parser in the tree yet; TR2b)", () => {
    const { container } = renderTool("apply_patch", { patch: "*** Begin Patch\n*** Update File: a.ts\n@@\n-a\n+b\n*** End Patch" }, [{ content: "Done!" }]);
    openRow(container);
    expect(text(detailOf(container))).toContain('"patch"');
  });

  it("an unknown name with long input: JSON capped behind a 'Show all' disclosure with aria-expanded + aria-controls; nothing CSS-clipped", () => {
    const input = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`field_${i + 1}`, `value ${i + 1}`]));
    const { container } = renderTool("mcp__kiln__bulk_update", input, [{ content: "ok" }]);
    openRow(container);
    const detail = detailOf(container);
    expect(text(detail)).toContain('"field_1"');
    expect(text(detail)).not.toContain('"field_30"');
    for (const el of detail.querySelectorAll("pre")) expect(el.getAttribute("class") ?? "").not.toMatch(/max-h-|overflow-hidden|line-clamp/);
    const showAll = [...detail.querySelectorAll("button[aria-expanded='false']")].find((b) => /Show all/.test(b.textContent ?? ""));
    expect(showAll, "a Show all toggle").toBeDefined();
    expect(document.getElementById((showAll?.getAttribute("aria-controls") ?? "").split(" ")[0] ?? "")).not.toBeNull();
    fireEvent.click(showAll as HTMLElement);
    expect(showAll?.getAttribute("aria-expanded")).toBe("true");
    expect(text(detail)).toContain('"field_30"');
  });
});

// ---------------------------------------------------------------------------
// Search: highlight + auto-open (effect keyed on the query)
// ---------------------------------------------------------------------------

describe("search keeps acting (Default, AskUserQuestion, Workflow)", () => {
  const DEFAULT_INPUT = { title: "Flaky preview test", body: "The renderPreview snapshot differs on CI." };

  it("Default: a hit opens the row and is highlighted; collapse while matching stays collapsed; a new matching query opens again; clear keeps it", () => {
    const view = renderTool("mcp__github__create_issue", DEFAULT_INPUT, [], {});
    expect(isOpen(view.container)).toBe(false);
    view.rerenderWith({ searchQuery: "snapshot", isCurrentMatch: true, currentMatchIndex: 0 });
    expect(isOpen(view.container), "a match opens the row").toBe(true);
    expect(detailOf(view.container).querySelector("mark")?.textContent?.toLowerCase()).toBe("snapshot");
    fireEvent.click(rowButton(view.container));
    expect(isOpen(view.container), "collapse while still matching").toBe(false);
    view.rerenderWith({ searchQuery: "snapshot", isCurrentMatch: true, currentMatchIndex: 0 });
    expect(isOpen(view.container), "same query, re-render: stays collapsed").toBe(false);
    view.rerenderWith({ searchQuery: "renderPreview", isCurrentMatch: true, currentMatchIndex: 0 });
    expect(isOpen(view.container), "a different matching query opens it again").toBe(true);
    view.rerenderWith({ searchQuery: "" });
    expect(view.container.querySelector("mark")).toBeNull();
  });

  it("Default: a hit hidden by the row's ellipsis is highlighted in the opened detail", () => {
    const long = `${"Investigate the flaky preview pipeline ".repeat(6)}needle-at-the-end`;
    const view = renderTool("mcp__github__create_issue", { title: long }, [], { searchQuery: "needle-at-the-end", isCurrentMatch: true, currentMatchIndex: 0 });
    expect(isOpen(view.container)).toBe(true);
    const marks = [...detailOf(view.container).querySelectorAll("mark")].map((m) => m.textContent);
    expect(marks).toContain("needle-at-the-end");
  });

  it("Default: searching by tool id opens the row and highlights the id in the detail", () => {
    const id = nextId();
    const view = renderTool("mcp__github__create_issue", DEFAULT_INPUT, [], { searchQuery: id, isCurrentMatch: true, currentMatchIndex: 0 }, id);
    expect(isOpen(view.container)).toBe(true);
    const meta = detailOf(view.container).querySelector(":scope > [data-meta]");
    expect(meta?.querySelector("mark")?.textContent).toBe(id);
  });

  it("Default: no hit leaves it collapsed and unmarked", () => {
    const view = renderTool("mcp__github__create_issue", DEFAULT_INPUT, [], { searchQuery: "nonexistent-term" });
    expect(isOpen(view.container)).toBe(false);
    expect(view.container.querySelector("mark")).toBeNull();
  });

  it("AskUserQuestion: a hit in an option opens the row and highlights it; collapse while matching stays collapsed", () => {
    const view = renderTool("AskUserQuestion", ASK_INPUT, [], { searchQuery: "PostgreSQL", isCurrentMatch: true, currentMatchIndex: 0 });
    expect(isOpen(view.container)).toBe(true);
    expect([...detailOf(view.container).querySelectorAll("mark")].map((m) => m.textContent)).toContain("PostgreSQL");
    fireEvent.click(rowButton(view.container));
    view.rerenderWith({ searchQuery: "PostgreSQL", isCurrentMatch: true, currentMatchIndex: 0 });
    expect(isOpen(view.container)).toBe(false);
    view.rerenderWith({ searchQuery: "SQLite", isCurrentMatch: true, currentMatchIndex: 0 });
    expect(isOpen(view.container)).toBe(true);
  });

  it("Workflow: a hit in the name / description opens the row and is highlighted in the detail", () => {
    const longName = `nightly-${"triage-".repeat(12)}needle`;
    const view = renderTool("Workflow", { description: "Nightly triage of the inbox", script: `export const meta = { name: '${longName}' };` }, [], { searchQuery: "needle", isCurrentMatch: true, currentMatchIndex: 0 });
    expect(isOpen(view.container)).toBe(true);
    expect([...view.container.querySelectorAll("mark")].map((m) => m.textContent)).toContain("needle");
    view.rerenderWith({ searchQuery: "inbox", isCurrentMatch: true, currentMatchIndex: 0 });
    expect([...detailOf(view.container).querySelectorAll("mark")].map((m) => m.textContent)).toContain("inbox");
  });
});

// ---------------------------------------------------------------------------
// Expand state: unique per rendered instance (Pitfall p)
// ---------------------------------------------------------------------------

describe("expand state is per instance", () => {
  it("two Default rows in one message: opening one leaves the other closed", () => {
    const a = nextId();
    const b = nextId();
    const { container } = wrap(
      <>
        <div data-case="a">
          <UnifiedToolExecutionRenderer toolUse={{ type: "tool_use", id: a, name: "mcp__x__one", input: { q: "one" } }} toolResults={[]} />
        </div>
        <div data-case="b">
          <UnifiedToolExecutionRenderer toolUse={{ type: "tool_use", id: b, name: "mcp__x__two", input: { q: "two" } }} toolResults={[]} />
        </div>
      </>,
    );
    const first = container.querySelector("[data-case='a']") as HTMLElement;
    const second = container.querySelector("[data-case='b']") as HTMLElement;
    openRow(first);
    expect(isOpen(second)).toBe(false);
  });

  it("an Agent's prompt and result 'Show all' toggles are separate", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}.`).join("\n\n");
    const { container } = renderTool("Task", { description: "Long", prompt: long }, [{ content: [{ type: "text", text: long }] }]);
    openRow(container);
    const toggles = [...detailOf(container).querySelectorAll("button[aria-expanded]")].filter((b) => /Show all|Show less/.test(b.textContent ?? ""));
    expect(toggles.length).toBe(2);
    act(() => {
      fireEvent.click(toggles[0] as HTMLElement);
    });
    expect(toggles[0]?.getAttribute("aria-expanded")).toBe("true");
    expect(toggles[1]?.getAttribute("aria-expanded")).toBe("false");
  });
});
