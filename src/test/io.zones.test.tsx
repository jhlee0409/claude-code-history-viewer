/**
 * Input / Result zones (owner option B, 2026-10-25): every opened ToolRow
 * detail says which part is what the agent was given and which part came
 * back. Each zone is a labelled region (`<section aria-labelledby>`) with a
 * small caption label — en "Input" / "Result", ko "입력" / "결과" (+ ja,
 * zh-CN, zh-TW) — and the input zone has a thin left rule, neutral and
 * distinct from OutputBlock's stderr rule.
 *
 * - DetailZone unit: label per locale, `aria-labelledby`, the input rule
 *   (a border, a neutral token, not the stderr classes), none on result,
 *   meta on the label's line, the label is not selectable, a zone without
 *   content renders nothing.
 * - Per card (TR0 Bash · Read · Grep · Glob · Write · Edit, TR1a WebSearch ·
 *   WebFetch · Agent · Workflow · AskUserQuestion · Default/MCP, and the
 *   routed Default bodies): opened, the zones come input → result, each
 *   holds the right content, and the detail meta line (Copy tool ID) stays
 *   outside both. A detail with only output shows only the Result zone.
 * - Runtime guard: every block inside an opened detail sits in a zone, or is
 *   an explicit aside (navigation to other transcripts).
 *
 * The geometry (the input rule ≠ the stderr rule in computed colour / width,
 * labels unclipped at 390 / 125 %) is measured in real WebKit:
 * scripts/ui-capture/test/detailZones.test.mjs.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import i18n from "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { useAppStore } from "@/store/useAppStore";
import { UnifiedToolExecutionRenderer } from "@/components/contentRenderer/UnifiedToolExecutionRenderer";
import { DetailZone } from "@/components/transcript/DetailZone";
import { CodeTarget, ToolRow } from "@/components/transcript/ToolRow";
import { toolFamily, toolOutcome } from "@/components/transcript/toolOutcome";

const CWD = "/Users/dev/work/kiln";
const WJ = /\u2060/g;

type Results = Record<string, unknown>[];

const own = (toolUseResult: unknown) => ({
  toolUseResult,
  toolUseResultSource: { messageUuid: "u", sessionId: "s", contentIndex: 0, association: "single_result" },
});

let seq = 0;
const nextId = () => `toolu_io_${++seq}`;

function renderTool(name: string, input: unknown, results: Results = [], props: { onViewSubagent?: (id: string) => void } = {}) {
  const id = nextId();
  const toolUse = { type: "tool_use", id, name, input };
  const toolResults = results.map((r) => ({ type: "tool_result", tool_use_id: id, ...r }));
  return render(
    <ExpandKeyProvider value="msg-io">
      <UnifiedToolExecutionRenderer toolUse={toolUse} toolResults={toolResults} {...props} />
    </ExpandKeyProvider>,
  );
}

const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(WJ, "");

function openDetail(root: HTMLElement): HTMLElement {
  const button = root.querySelector<HTMLElement>("[data-tool-row] button[aria-expanded]");
  expect(button, "the row's disclosure button").not.toBeNull();
  if (button!.getAttribute("aria-expanded") !== "true") fireEvent.click(button!);
  const detail = root.querySelector<HTMLElement>("[data-tool-detail]:not([hidden])");
  expect(detail, "the opened row detail").not.toBeNull();
  return detail!;
}

const zonesOf = (detail: Element) => [...detail.querySelectorAll<HTMLElement>("[data-detail-zone]")];
const kindsOf = (detail: Element) => zonesOf(detail).map((z) => z.getAttribute("data-detail-zone"));
const zone = (detail: Element, kind: "input" | "result") => detail.querySelector<HTMLElement>(`[data-detail-zone='${kind}']`);
/** The zone's own label element (the one its aria-labelledby names). */
const labelOf = (z: HTMLElement | null) => {
  expect(z, "the zone").not.toBeNull();
  const id = z.getAttribute("aria-labelledby");
  expect(id, "the zone is labelled by its caption").toBeTruthy();
  const label = z!.ownerDocument.getElementById(id!);
  expect(label, "the label element").not.toBeNull();
  return label!;
};
const labelLine = (z: HTMLElement | null) => {
  expect(z, "the zone").not.toBeNull();
  const line = z!.querySelector<HTMLElement>(":scope > [data-zone-label]");
  expect(line, "the zone's label line").not.toBeNull();
  return line!;
};
/** The zone of `kind`, which must be there. */
const mustZone = (root: Element, kind: "input" | "result") => {
  const z = root.querySelector<HTMLElement>(`[data-detail-zone='${kind}']`);
  expect(z, `the ${kind} zone`).not.toBeNull();
  return z!;
};
const classesOf = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

const LABELS: Record<string, { input: string; result: string }> = {
  en: { input: "Input", result: "Result" },
  ko: { input: "입력", result: "결과" },
  ja: { input: "入力", result: "結果" },
  "zh-CN": { input: "输入", result: "结果" },
  "zh-TW": { input: "輸入", result: "結果" },
};

/** OutputBlock's stderr zone classes (neutral and failed). */
const STDERR_RULE = ["border-l-2", "border-line", "border-status-danger-line"];

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
// DetailZone unit
// ---------------------------------------------------------------------------

describe("DetailZone", () => {
  describe.each(Object.keys(LABELS))("%s", (lng) => {
    beforeAll(async () => {
      await act(async () => {
        await i18n.changeLanguage(lng);
      });
    });
    afterAll(async () => {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    });
    it.each(["input", "result"] as const)("%s: the caption label in this locale names the region", (kind) => {
      const { container } = render(
        <DetailZone kind={kind}>
          <p>content</p>
        </DetailZone>,
      );
      const z = container.querySelector<HTMLElement>(`section[data-detail-zone='${kind}']`);
      expect(z, "a <section> zone").not.toBeNull();
      const label = labelOf(z!);
      expect(text(label)).toBe(LABELS[lng]![kind]);
      expect(z!.contains(label), "the label is inside its zone").toBe(true);
      expect(text(z)).toContain("content");
    });
  });

  it("the input zone has a thin neutral left rule (a border, not a fill); the result zone has none", () => {
    const { container } = render(
      <>
        <DetailZone kind="input">
          <p>in</p>
        </DetailZone>
        <DetailZone kind="result">
          <p>out</p>
        </DetailZone>
      </>,
    );
    const input = classesOf(mustZone(container, "input"));
    const result = classesOf(mustZone(container, "result"));
    expect(input, "a 1px left border").toContain("border-l");
    expect(input, "a neutral line token").toContain("border-line-input");
    for (const cls of STDERR_RULE) expect(input, `not the stderr rule's ${cls}`).not.toContain(cls);
    expect(input.some((c) => /^bg-/.test(c)), "no fill: forced colours keep a border, not a background").toBe(false);
    expect(result.some((c) => /^border-l/.test(c)), "the result zone has no rule").toBe(false);
    expect(result.some((c) => /^bg-/.test(c)), "no fill on the result zone").toBe(false);
  });

  it("meta sits on the label's line, after the label", () => {
    const { container } = render(
      <DetailZone kind="result" meta={<span data-testid="stats">2s · 12.4K</span>}>
        <p>out</p>
      </DetailZone>,
    );
    const z = mustZone(container, "result");
    const line = labelLine(z);
    const label = labelOf(z);
    expect(line.contains(label)).toBe(true);
    const stats = container.querySelector("[data-testid='stats']")!;
    expect(line.contains(stats), "meta on the label's line").toBe(true);
    expect(label.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING, "meta after the label").toBeTruthy();
  });

  it("the label is caption text the user does not select with the content", () => {
    const { container } = render(
      <DetailZone kind="input">
        <p>in</p>
      </DetailZone>,
    );
    const label = labelOf(mustZone(container, "input"));
    expect(classesOf(label)).toContain("select-none");
    expect(label.closest("code, pre"), "not inside code").toBeNull();
  });

  it("show={false} renders nothing", () => {
    const { container } = render(
      <DetailZone kind="input" show={false}>
        <p>in</p>
      </DetailZone>,
    );
    expect(container.querySelector("[data-detail-zone]")).toBeNull();
    expect(text(container)).toBe("");
  });

  it('show="whenTargetCut": only while the row cuts its target', () => {
    const outcome = toolOutcome({ id: "x", name: "Bash" }, [], toolFamily("Bash"));
    const row = (command: string) => (
      <ExpandKeyProvider value={`msg-cut-${command.length}`}>
        <ToolRow icon={<span />} verb="Bash" target={<CodeTarget text={command.split("\n")[0]!} full={command} />} outcome={outcome} family="process" expandKey="cut">
          <DetailZone kind="input" show="whenTargetCut">
            <p>whole command</p>
          </DetailZone>
        </ToolRow>
      </ExpandKeyProvider>
    );
    const cut = render(row("line one\nline two"));
    expect(kindsOf(openDetail(cut.container))).toEqual(["input"]);
    cut.unmount();
    useExpandRegistry.getState().clearAll();
    const whole = render(row("one line"));
    expect(kindsOf(openDetail(whole.container))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Per-card adoption
// ---------------------------------------------------------------------------

interface ZoneCase {
  title: string;
  name: string;
  input: unknown;
  results: Results;
  /** The zones, in order. */
  kinds: ("input" | "result")[];
  /** Text each zone holds. */
  inInput?: string[];
  inResult?: string[];
  /** Text no zone holds (the detail meta line, asides). */
  outside?: string[];
  props?: { onViewSubagent?: (id: string) => void };
}

const EDIT_ERROR = "<tool_use_error>String to replace not found in file.</tool_use_error>";

const CASES: ZoneCase[] = [
  // TR0
  {
    title: "Bash: description and the whole multi-line command are input; the output is the result",
    name: "Bash",
    input: { command: "pnpm build\n  --filter app", description: "Build the app" },
    results: [{ content: "build ok", ...own({ stdout: "build ok", stderr: "", exitCode: 0 }) }],
    kinds: ["input", "result"],
    inInput: ["Build the app", "--filter app"],
    inResult: ["build ok"],
  },
  {
    title: "Bash: a one-line command the row shows whole and no description: only the result",
    name: "Bash",
    input: { command: "git status" },
    results: [{ content: "clean", ...own({ stdout: "clean", stderr: "", exitCode: 0 }) }],
    kinds: ["result"],
    inResult: ["clean"],
  },
  {
    title: "Bash failed: stderr stays inside the result",
    name: "Bash",
    input: { command: "pnpm test", description: "Run the tests" },
    results: [{ content: "1 failed", is_error: true, ...own({ stdout: "", stderr: "1 failed", exitCode: 1 }) }],
    kinds: ["input", "result"],
    inInput: ["Run the tests"],
    inResult: ["1 failed", "stderr"],
  },
  {
    title: "Read: the path is in the row: only the result",
    name: "Read",
    input: { file_path: `${CWD}/src/a.ts` },
    results: [{ content: "export const a = 1;" }],
    kinds: ["result"],
    inResult: ["export const a = 1;"],
  },
  {
    title: "Grep: only the result when the row shows the pattern whole",
    name: "Grep",
    input: { pattern: "TODO", output_mode: "content" },
    results: [{ content: "src/a.ts:1: TODO" }],
    kinds: ["result"],
    inResult: ["src/a.ts:1: TODO"],
  },
  {
    title: "Glob: only the result when the row shows the pattern whole",
    name: "Glob",
    input: { pattern: "**/*.ts" },
    results: [{ content: "src/a.ts\nsrc/b.ts" }],
    kinds: ["result"],
    inResult: ["src/b.ts"],
  },
  {
    title: "Write: the written content is input; a result naming another file is the result",
    name: "Write",
    input: { file_path: `${CWD}/src/new.ts`, content: "export const created = true;" },
    results: [{ content: `File created successfully at: ${CWD}/src/other.ts` }],
    kinds: ["input", "result"],
    inInput: ["export const created = true;"],
    inResult: ["src/other.ts"],
  },
  {
    title: "Write: the confirmation for its own file adds nothing: only the input",
    name: "Write",
    input: { file_path: `${CWD}/src/new.ts`, content: "export const created = true;" },
    results: [{ content: `File created successfully at: ${CWD}/src/new.ts` }],
    kinds: ["input"],
    inInput: ["export const created = true;"],
  },
  {
    title: "Edit: the diff (the recorded change) is input; the failure text is the result",
    name: "Edit",
    input: { file_path: `${CWD}/src/a.ts`, old_string: "return input.trimEnd();", new_string: "return input.trim();" },
    results: [{ content: EDIT_ERROR, is_error: true }],
    kinds: ["input", "result"],
    inInput: ["return input.trim();"],
    inResult: ["String to replace not found in file."],
  },
  {
    title: "Edit succeeded: the diff only (the confirmation stays out)",
    name: "Edit",
    input: { file_path: `${CWD}/src/a.ts`, old_string: "a", new_string: "b" },
    results: [{ content: `The file ${CWD}/src/a.ts has been updated.` }],
    kinds: ["input"],
    outside: ["has been updated"],
  },
  // TR1a
  {
    title: "WebSearch: only the results when the row shows the query whole",
    name: "WebSearch",
    input: { query: "Retry-After" },
    results: [{ content: "Retry-After: HTTP-date or seconds" }],
    kinds: ["result"],
    inResult: ["HTTP-date or seconds"],
  },
  {
    title: "WebFetch: the prompt is input; the fetched answer is the result",
    name: "WebFetch",
    input: { url: "https://example.com/changelog", prompt: "What changed in 2.3?" },
    results: [{ content: "2.3 adds retry headers." }],
    kinds: ["input", "result"],
    inInput: ["What changed in 2.3?"],
    inResult: ["2.3 adds retry headers."],
  },
  {
    title: "WebFetch failed with only an error code: the input alone (the code is said once, in the row)",
    name: "WebFetch",
    input: { url: "https://status.example.com/api", prompt: "Is the API up?" },
    results: [{ content: [{ type: "text", text: '{"error_code":"url_not_accessible"}' }], ...own({ error_code: "url_not_accessible" }) }],
    kinds: ["input"],
    inInput: ["Is the API up?"],
    outside: ["url_not_accessible"],
  },
  {
    title: "Agent: the prompt is input; the report is the result; View Conversation is an aside",
    name: "Task",
    input: { description: "Audit the production bundle", prompt: "List the five largest modules.", subagent_type: "general-purpose" },
    results: [{ content: [{ type: "text", text: "The largest module is vendor.js." }], totalDurationMs: 2_000, totalTokens: 12_400, totalToolUseCount: 3 }],
    kinds: ["input", "result"],
    inInput: ["List the five largest modules."],
    inResult: ["The largest module is vendor.js."],
    outside: ["View Conversation"],
    props: { onViewSubagent: () => undefined },
  },
  {
    title: "Workflow: description and script are input; the run's result is the result",
    name: "Workflow",
    input: { description: "Nightly triage", script: "export const meta = { name: 'triage-nightly' };" },
    results: [{ content: "Triage finished: 4 issues labelled." }],
    kinds: ["input", "result"],
    inInput: ["Nightly triage", "export const meta"],
    inResult: ["Triage finished"],
  },
  {
    title: "AskUserQuestion: the questions and options are input; the answer is the result",
    name: "AskUserQuestion",
    input: {
      questions: [{ question: "Which storage backend?", header: "Storage", multiSelect: false, options: [{ label: "SQLite", description: "Bundled file database" }, { label: "PostgreSQL" }] }],
    },
    results: [{ content: 'User has answered your questions: "SQLite".' }],
    kinds: ["input", "result"],
    inInput: ["Storage", "Which storage backend?", "Bundled file database", "PostgreSQL"],
    inResult: ["User has answered"],
  },
  {
    title: "AskUserQuestion without an answer: the input alone",
    name: "AskUserQuestion",
    input: { questions: [{ question: "Which storage backend?", multiSelect: false, options: [] }] },
    results: [],
    kinds: ["input"],
    inInput: ["Which storage backend?"],
  },
  {
    title: "Default / MCP: the input JSON is input; the tool's answer is the result",
    name: "mcp__github__create_issue",
    input: { title: "Flaky preview test", body: "It fails on CI." },
    results: [{ content: "Created issue #42" }],
    kinds: ["input", "result"],
    inInput: ["Flaky preview test", "It fails on CI."],
    inResult: ["Created issue #42"],
  },
  // Routed Default bodies (toolBodies.tsx)
  {
    title: "TodoWrite: the list and its other recorded fields are input",
    name: "todowrite",
    input: { todos: [{ content: "Write the migration", status: "in_progress", activeForm: "Writing the migration" }] },
    results: [{ content: "Todos have been modified successfully." }],
    kinds: ["input", "result"],
    inInput: ["Write the migration", "Writing the migration"],
    inResult: ["Todos have been modified successfully."],
  },
  {
    title: "update_plan: explanation and steps are input",
    name: "update_plan",
    input: { explanation: "Split the work", plan: [{ step: "Add the zone primitive", status: "completed" }] },
    results: [{ content: "Plan updated" }],
    kinds: ["input", "result"],
    inInput: ["Split the work", "Add the zone primitive"],
    inResult: ["Plan updated"],
  },
  {
    title: "NotebookEdit: summary and new source are input",
    name: "NotebookEdit",
    input: { notebook_path: `${CWD}/nb/a.ipynb`, cell_number: 3, new_source: "print('hi')", edit_mode: "replace", cell_type: "code" },
    results: [{ content: "Updated cell 3" }],
    kinds: ["input", "result"],
    inInput: ["replace", "print('hi')"],
    inResult: ["Updated cell 3"],
  },
  {
    title: "TaskCreate: subject and description are input",
    name: "TaskCreate",
    input: { subject: "Ship the zones", description: "Labels on every opened row" },
    results: [{ content: "Task #7 created" }],
    kinds: ["input", "result"],
    inInput: ["Ship the zones", "Labels on every opened row"],
    inResult: ["Task #7 created"],
  },
  {
    title: "TaskUpdate: the summary line is input",
    name: "TaskUpdate",
    input: { taskId: "7", status: "completed", owner: "jack" },
    results: [{ content: "Updated task #7" }],
    kinds: ["input", "result"],
    inInput: ["jack"],
    inResult: ["Updated task #7"],
  },
  {
    title: "JSON fallback for a non-object input: input",
    name: "mcp__probe__tool",
    input: ["first", "second"],
    results: [],
    kinds: ["input"],
    inInput: ["first", "second"],
  },
];

describe.each(CASES)("$title", (c) => {
  it("opened: zones input → result, each holding its content; the meta line outside both", () => {
    const { container } = renderTool(c.name, c.input, c.results, c.props);
    const detail = openDetail(container);
    expect(kindsOf(detail), "the zones, in order").toEqual(c.kinds);
    for (const z of zonesOf(detail)) expect(text(labelOf(z)), "each zone has its label").toBe(LABELS.en![z.getAttribute("data-detail-zone") as "input" | "result"]);
    const input = zone(detail, "input");
    const result = zone(detail, "result");
    for (const t of c.inInput ?? []) expect(text(input), `input holds ${JSON.stringify(t)}`).toContain(t);
    for (const t of c.inResult ?? []) expect(text(result), `result holds ${JSON.stringify(t)}`).toContain(t);
    for (const t of c.inInput ?? []) if (!(c.inResult ?? []).some((r) => r.includes(t) || t.includes(r))) expect(text(result), `${JSON.stringify(t)} is not in the result`).not.toContain(t);
    for (const t of c.inResult ?? []) if (!(c.inInput ?? []).some((r) => r.includes(t) || t.includes(r))) expect(text(input), `${JSON.stringify(t)} is not in the input`).not.toContain(t);
    for (const t of c.outside ?? []) for (const z of zonesOf(detail)) expect(text(z), `${JSON.stringify(t)} is in no zone`).not.toContain(t);
    // The detail meta line (facts + Copy tool ID) is the detail's own, after the zones.
    const meta = detail.querySelector(":scope > [data-meta]");
    expect(meta, "the detail meta line").not.toBeNull();
    expect(meta!.closest("[data-detail-zone]"), "the meta line is in no zone").toBeNull();
    expect(text(meta)).toContain("Copy tool ID");
  });

  it("runtime guard: every block of the detail sits in a zone or is an explicit aside", () => {
    const { container } = renderTool(c.name, c.input, c.results, c.props);
    const detail = openDetail(container);
    const content = [...detail.children].filter((el) => !el.matches("[data-meta]"));
    for (const box of content) {
      for (const child of box.children) {
        const ok = child.matches("[data-detail-zone], [data-detail-aside]");
        expect(ok, `a bare block in the detail: <${child.tagName.toLowerCase()} class="${child.getAttribute("class") ?? ""}"> ${text(child).slice(0, 60)}`).toBe(true);
      }
    }
    for (const well of detail.querySelectorAll("[data-output], [data-prose], [data-diff-view], [data-file-edit], [data-input-json], pre")) {
      expect(well.closest("[data-detail-zone], [data-detail-aside]"), `a bare well: ${text(well).slice(0, 60)}`).not.toBeNull();
    }
  });
});

describe("Agent: its stats sit on the Result label's line", () => {
  it("duration, tokens and tool count on the Result line; no separate Prompt / Result captions", () => {
    const { container } = renderTool(
      "Task",
      { description: "Audit", prompt: "List modules." },
      [{ content: [{ type: "text", text: "vendor.js" }], totalDurationMs: 2_000, totalTokens: 12_400, totalToolUseCount: 3 }],
    );
    const detail = openDetail(container);
    const result = mustZone(detail, "result");
    const line = labelLine(result);
    expect(text(labelOf(result))).toBe("Result");
    expect(text(line)).toContain("12.4K");
    expect(text(line)).toContain("3");
    expect(text(line)).toMatch(/2(\.0)?\s?s/);
    expect(text(detail).match(/Prompt/g), "no 'Prompt' caption beside the Input label").toBeNull();
    expect(text(detail).match(/Result/g)?.length, "'Result' once, as the zone label").toBe(1);
  });
});

describe("AskUserQuestion: the per-question rule is subordinate to the Input zone's rule", () => {
  // Owner decision (part 2): keep both rules, but the question rule must not read as a second
  // input zone (nor as a stderr zone): thinner-or-equal and fainter than the zone's rule.
  it("1px --line-faint, inset inside the zone; not the zone's rule, not the stderr rule", () => {
    const { container } = renderTool("AskUserQuestion", {
      questions: [
        { question: "Which storage backend?", header: "Storage", multiSelect: false, options: [{ label: "SQLite" }] },
        { question: "Which port?", multiSelect: false, options: [{ label: "5432" }] },
      ],
    });
    const input = mustZone(openDetail(container), "input");
    const ruled = [...input.querySelectorAll<HTMLElement>("*")].filter((el) => classesOf(el).some((c) => /^border-l(-|$)/.test(c)));
    expect(ruled.length, "one rule per question").toBe(2);
    for (const q of ruled) {
      const cls = classesOf(q);
      expect(cls, "a 1px rule").toContain("border-l");
      expect(cls, "the faint line token, quieter than the zone's --line-input").toContain("border-line-faint");
      expect(cls, "not the Input zone's own rule colour").not.toContain("border-line-input");
      for (const s of STDERR_RULE) expect(cls, `not the stderr rule's ${s}`).not.toContain(s);
      expect(q.parentElement?.closest("[data-detail-zone='input']"), "inset inside the Input zone").toBe(input);
    }
  });
});

describe("Default JSON: the zone label line names the keys once", () => {
  it("object input: Input · (alpha, beta) on one label line", () => {
    const { container } = renderTool("mcp__probe__tool", { alpha: 1, beta: 2 }, []);
    const input = mustZone(openDetail(container), "input");
    // The label, then the keys as the label line's meta: the old "Input (alpha, beta)" caption, once.
    expect([...labelLine(input).children].map((el) => text(el))).toEqual(["Input", "(alpha, beta)"]);
    expect(text(input).match(/Input/g)?.length, "'Input' once").toBe(1);
  });
  it("a structured body's leftover JSON is captioned 'Other recorded fields', not a second 'Input'", () => {
    const { container } = renderTool("TaskCreate", { subject: "Ship", extra: "kept" }, []);
    const input = mustZone(openDetail(container), "input");
    const rest = input.querySelector("[data-input-json='rest']");
    expect(rest, "the leftover JSON").not.toBeNull();
    expect(text(rest)).toContain("Other recorded fields (extra)");
    expect(text(input).match(/Input/g)?.length, "'Input' once").toBe(1);
  });
});

describe("zones in Korean", () => {
  beforeAll(async () => {
    await act(async () => {
      await i18n.changeLanguage("ko");
    });
  });
  afterAll(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });
  it("a WebFetch opened in ko: 입력 then 결과", () => {
    const { container } = renderTool("WebFetch", { url: "https://example.com/changelog", prompt: "What changed in 2.3?" }, [{ content: "2.3 adds retry headers." }]);
    const detail = openDetail(container);
    expect(zonesOf(detail).map((z) => text(labelOf(z)))).toEqual(["입력", "결과"]);
  });
});
