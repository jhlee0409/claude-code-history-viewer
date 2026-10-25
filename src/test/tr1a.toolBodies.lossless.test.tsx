/**
 * TR1a fix round 1 (review F1–F3): a routed structured body in the Default
 * path (`unifiedCards/toolBodies.tsx`) is a lossless, searchable view of the
 * recorded input.
 *
 * 1. Shape gate: a body is chosen only when the input fully matches the
 *    shape that body reads (every array member an object, every field it
 *    dereferences of the expected type, every status one it can show as
 *    itself). Anything else is the honest JSON of the whole input. A body
 *    never throws (review F1: `plan: [null]` / `todos: [null]` reached the
 *    app's error screen).
 * 2. Nothing recorded is lost: every recorded value the body does not show
 *    (top level and nested: `activeForm`, item ids, a `medium` priority the
 *    list leaves out, unknown keys) stays in the opened detail's "other
 *    recorded fields" JSON (review F2).
 * 3. Search reaches every text sink: todo / plan text, the explanation, the
 *    notebook source and path, the task summary / description, the
 *    retained JSON get the search marks; a capped sink opens for a hit
 *    (review F3).
 *
 * The first eight cases are the reviewer's probes (round 1, reviewer.test.tsx)
 * as written; they pass on base 399db89f and fail on c4c5a377.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import i18n from "@/i18n";
import { UnifiedToolExecutionRenderer } from "@/components/contentRenderer/UnifiedToolExecutionRenderer";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";

const CWD = "/Users/dev/work/kiln";
const WJ = /\u2060/g;

let n = 0;
beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => {
  cleanup();
  useExpandRegistry.getState().clearAll();
});

/** Open every collapsed disclosure (the row, show-all caps), as a user can. */
function openAll(container: HTMLElement) {
  for (let i = 0; i < 30; i++) {
    const b = [...container.querySelectorAll<HTMLElement>("button")].find((el) => el.getAttribute("aria-expanded") === "false");
    if (!b) break;
    fireEvent.click(b);
  }
}

/** The reviewer's helper: render the paired call and open everything (`click: false`: open nothing). */
function tool(name: string, input: unknown, searchQuery = "", content: unknown = "OK", click = true) {
  const id = `lossless${++n}`;
  const v = render(
    <ExpandKeyProvider value={`probe${n}`}>
      <UnifiedToolExecutionRenderer
        toolUse={{ type: "tool_use", id, name, input }}
        toolResults={[{ type: "tool_result", tool_use_id: id, content }]}
        searchQuery={searchQuery}
        isCurrentMatch
        currentMatchIndex={0}
      />
    </ExpandKeyProvider>,
  );
  if (click) openAll(v.container);
  return v;
}

/** Render + open without letting a body's exception escape as a non-assertion error. */
function opened(name: string, input: unknown, searchQuery = "", click = true): HTMLElement {
  let container: HTMLElement | null = null;
  expect(() => {
    container = tool(name, input, searchQuery, "OK", click).container;
  }, `${name} renders and opens without throwing`).not.toThrow();
  return container as unknown as HTMLElement;
}

const detailOf = (root: Element) => {
  const detail = root.querySelector("[data-tool-detail]:not([hidden])");
  expect(detail, "the opened row detail").not.toBeNull();
  return detail as HTMLElement;
};
const text = (el: Element) => (el.textContent ?? "").replace(WJ, "");
const wells = (root: Element) => [...root.querySelectorAll("pre[data-output-text]")].map((el) => text(el));
const marks = (root: Element) => [...root.querySelectorAll("mark")].map((el) => (el.textContent ?? "").toLowerCase());
/** The "other recorded fields" JSON block of an opened structured body, parsed. */
const retained = (root: Element): unknown => {
  const pre = root.querySelector("[data-input-json='rest'] pre[data-output-text]");
  expect(pre, "the other-recorded-fields JSON block").not.toBeNull();
  return JSON.parse(text(pre as Element));
};
/**
 * Keys whose value a body shows in another form, not as its text: a status
 * as the list's mark or the step's translated label, the notebook path
 * relative to the cwd (D1; the whole path is its `title` / `data-path`).
 */
const SHOWN_AS_LABEL = new Set(["status", "notebook_path"]);
/** Every leaf value (string / number / boolean / null) of a recorded input, but those shown as a label. */
const leaves = (value: unknown, key = ""): string[] =>
  value !== null && typeof value === "object"
    ? Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => leaves(v, Array.isArray(value) ? key : k))
    : SHOWN_AS_LABEL.has(key)
      ? []
      : [String(value)];

// ---------------------------------------------------------------------------
// The reviewer's eight probes (round 1), as written
// ---------------------------------------------------------------------------

describe("review round 1 probes", () => {
  it("preserves activeForm and nested extra fields of TodoWrite input", () => {
    const v = tool("TodoWrite", { todos: [{ content: "Audit dependencies", status: "in_progress", activeForm: "Auditing dependencies", id: "todo-preserved-17" }] });
    expect(v.container.textContent).toContain("Auditing dependencies");
    expect(v.container.textContent).toContain("todo-preserved-17");
  });

  it.each([
    ["TodoWrite", { todos: [{ content: "needle dependency", status: "pending" }] }],
    ["update_plan", { plan: [{ step: "needle deployment", status: "pending" }], explanation: "Prepare" }],
    ["NotebookEdit", { notebook_path: "/work/a.ipynb", new_source: 'print("needle")', cell_type: "code", edit_mode: "replace" }],
    ["TaskCreate", { subject: "needle worker", description: "Create it" }],
    ["TaskUpdate", { taskId: "1", status: "pending", subject: "needle worker" }],
  ] as const)("%s retains marked search hits in the structured input", (name, input) => {
    const v = tool(name, input, "needle");
    expect([...v.container.querySelectorAll("mark")].map((x) => x.textContent)).toContain("needle");
  });

  it("TodoWrite malformed array falls back instead of throwing", () => {
    expect(() => tool("TodoWrite", { todos: [null] })).not.toThrow();
  });

  it("update_plan malformed array falls back instead of throwing", () => {
    expect(() => tool("update_plan", { plan: [null] })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 1. Shape gate: a malformed member of each consumed field type → the JSON
// ---------------------------------------------------------------------------

const TODO = { content: "Write the tests", status: "pending" };
const STEP = { step: "Write the tests", status: "pending" };
const NOTEBOOK = { notebook_path: `${CWD}/notebooks/eda.ipynb`, cell_number: 3, new_source: "df.describe()", cell_type: "code", edit_mode: "replace" };

const MALFORMED: [string, string, Record<string, unknown>][] = [
  // TodoWrite / todowrite: the list reads every member's content, status, priority, id.
  ...(["TodoWrite", "todowrite"] as const).flatMap((name): [string, string, Record<string, unknown>][] => [
    [name, "todos: [null]", { todos: [null] }],
    [name, "todos: [number]", { todos: [7] }],
    [name, "todos: [string]", { todos: ["Write the tests"] }],
    [name, "todos: [array]", { todos: [[TODO]] }],
    [name, "todos: a later member null", { todos: [TODO, null] }],
    [name, "content: object", { todos: [{ ...TODO, content: { text: "Write the tests" } }] }],
    [name, "content: null", { todos: [{ ...TODO, content: null }] }],
    [name, "status: number", { todos: [{ ...TODO, status: 1 }] }],
    [name, "status: missing", { todos: [{ content: "Write the tests" }] }],
    [name, "status: one the list has no mark for (cancelled)", { todos: [{ ...TODO, status: "cancelled" }] }],
    [name, "priority: object", { todos: [{ ...TODO, priority: { level: "high" } }] }],
    [name, "id: object", { todos: [{ ...TODO, id: { n: 1 } }] }],
    [name, "todos: object", { todos: { first: TODO } }],
  ]),
  // update_plan: the steps' step + status, the explanation.
  ["update_plan", "plan: [null]", { plan: [null] }],
  ["update_plan", "plan: [number]", { plan: [3] }],
  ["update_plan", "plan: [string]", { plan: ["Write the tests"] }],
  ["update_plan", "plan: a later member null", { plan: [STEP, null] }],
  ["update_plan", "step: number", { plan: [{ ...STEP, step: 4 }] }],
  ["update_plan", "step: object", { plan: [{ ...STEP, step: { text: "Write" } }] }],
  ["update_plan", "status: number", { plan: [{ ...STEP, status: 2 }] }],
  ["update_plan", "status: missing", { plan: [{ step: "Write the tests" }] }],
  ["update_plan", "status: one the steps label as another (blocked)", { plan: [{ ...STEP, status: "blocked" }] }],
  ["update_plan", "status: an inherited name (constructor)", { plan: [{ ...STEP, status: "constructor" }] }],
  ["update_plan", "explanation: object", { plan: [STEP], explanation: { why: "x" } }],
  ["update_plan", "explanation: number", { plan: [STEP], explanation: 5 }],
  ["update_plan", "explanation: null", { plan: [STEP], explanation: null }],
  ["update_plan", "plan: object", { plan: { first: STEP } }],
  // NotebookEdit: path, cell number / id, source, mode, type.
  ["NotebookEdit", "notebook_path: number", { ...NOTEBOOK, notebook_path: 12 }],
  ["NotebookEdit", "cell_number: string", { ...NOTEBOOK, cell_number: "3" }],
  ["NotebookEdit", "cell_id: number", { ...NOTEBOOK, cell_number: undefined, cell_id: 9 }],
  ["NotebookEdit", "new_source: object", { ...NOTEBOOK, new_source: { lines: ["df"] } }],
  ["NotebookEdit", "new_source: array", { ...NOTEBOOK, new_source: ["df.describe()"] }],
  ["NotebookEdit", "edit_mode: number", { ...NOTEBOOK, edit_mode: 1 }],
  ["NotebookEdit", "cell_type: object", { ...NOTEBOOK, cell_type: { kind: "code" } }],
  // TaskCreate: subject, description, active form.
  ["TaskCreate", "subject: number", { subject: 4, description: "All six cards" }],
  ["TaskCreate", "description: object", { subject: "Migrate", description: { text: "All six" } }],
  ["TaskCreate", "activeForm: array", { subject: "Migrate", activeForm: ["Migrating"] }],
  // TaskUpdate: id, status, subject, owner, the block lists.
  ["TaskUpdate", "taskId: number", { taskId: 4, status: "completed" }],
  ["TaskUpdate", "status: object", { taskId: "4", status: { done: true } }],
  ["TaskUpdate", "subject: number", { taskId: "4", subject: 9 }],
  ["TaskUpdate", "owner: array", { taskId: "4", owner: ["builder"] }],
  ["TaskUpdate", "addBlocks: string", { taskId: "4", addBlocks: "5" }],
  ["TaskUpdate", "addBlocks: a number member", { taskId: "4", addBlocks: ["5", 6] }],
  ["TaskUpdate", "addBlockedBy: a null member", { taskId: "4", addBlockedBy: [null] }],
];

describe("1. shape gate: a malformed record is the honest JSON of the whole input, never a throw", () => {
  it.each(MALFORMED)("%s · %s → JSON", (name, _label, raw) => {
    // `undefined` fields are dropped, as a JSON record would have them.
    const input = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
    const container = opened(name, input);
    const detail = detailOf(container);
    expect(wells(detail), "the whole recorded input as JSON").toContain(JSON.stringify(input, null, 2));
    expect(detail.querySelector("[data-tool-summary]"), "no structured summary line").toBeNull();
  });

  it("a well-shaped record still gets its structured body (positive control per route)", () => {
    const cases: [string, Record<string, unknown>][] = [
      ["TodoWrite", { todos: [TODO] }],
      ["update_plan", { plan: [STEP], explanation: "Why" }],
      ["NotebookEdit", NOTEBOOK],
      ["TaskCreate", { subject: "Migrate", description: "All six" }],
      ["TaskUpdate", { taskId: "4", status: "completed" }],
    ];
    for (const [name, input] of cases) {
      const container = opened(name, input);
      expect(wells(detailOf(container)), `${name}: not the JSON`).not.toContain(JSON.stringify(input, null, 2));
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Nothing recorded is lost: what a body does not show stays in the detail
// ---------------------------------------------------------------------------

interface Lossless {
  name: string;
  input: Record<string, unknown>;
  /** Exactly what the body does not show (the "other recorded fields" JSON). */
  rest: unknown;
  /** Values the body shows, so they are not repeated in the JSON. */
  shown: string[];
}

const LOSSLESS: Lossless[] = [
  {
    name: "TodoWrite",
    input: {
      todos: [
        { content: "Audit dependencies", status: "in_progress", activeForm: "Auditing dependencies", id: "todo-preserved-17", priority: "medium" },
        { content: "Ship the fix", status: "completed", priority: "high", owner: { team: "web" } },
        { content: "Write notes", status: "pending" },
      ],
      merge: true,
    },
    rest: { todos: [{ activeForm: "Auditing dependencies", id: "todo-preserved-17", priority: "medium" }, { owner: { team: "web" } }, {}], merge: true },
    shown: ["Audit dependencies", "Ship the fix", "high", "Write notes"],
  },
  {
    name: "todowrite",
    input: { todos: [{ content: "Audit dependencies", status: "pending", id: "oc-1", priority: "low" }] },
    rest: { todos: [{ id: "oc-1" }] },
    shown: ["Audit dependencies", "low"],
  },
  {
    // An item without content is shown whole (the list prints it as JSON): nothing of it is hidden.
    name: "TodoWrite",
    input: { todos: [{ status: "pending", activeForm: "Waiting" }], note: "kept" },
    rest: { note: "kept" },
    shown: ["Waiting"],
  },
  {
    name: "update_plan",
    input: { explanation: "", plan: [{ step: "Red tests", status: "completed", note: "first" }, { step: "Cards", status: "in_progress" }], turn: 3 },
    rest: { explanation: "", plan: [{ note: "first" }, {}], turn: 3 },
    shown: ["Red tests", "Cards"],
  },
  {
    name: "NotebookEdit",
    input: { ...NOTEBOOK, cell_id: "cell-abc", edit_mode: "", language: "python" },
    // The summary names the cell by its number; the id it leaves out stays.
    rest: { cell_id: "cell-abc", edit_mode: "", language: "python" },
    shown: ["notebooks/eda.ipynb", "df.describe()", "code"],
  },
  {
    name: "TaskCreate",
    input: { subject: "Migrate the cards", description: "", activeForm: "Migrating the cards", metadata: { lane: "TR1a" } },
    rest: { description: "", metadata: { lane: "TR1a" } },
    shown: ["Migrate the cards", "Migrating the cards"],
  },
  {
    name: "TaskUpdate",
    input: { taskId: "4", status: "in_progress", owner: "", addBlocks: [], addBlockedBy: ["2"], description: "Re-run the gates", activeForm: "Re-running" },
    rest: { owner: "", addBlocks: [], description: "Re-run the gates", activeForm: "Re-running" },
    shown: ["#4", "In Progress", "#2"],
  },
];

describe("2. nothing recorded is lost: unshown values (top level and nested) stay in the other-recorded-fields JSON", () => {
  it.each(LOSSLESS.map((c, i) => [`${c.name} #${i}`, c] as const))("%s", (_label, c) => {
    const container = opened(c.name, c.input);
    const detail = detailOf(container);
    // Every recorded value is on screen (the row target counts: TaskUpdate's "#4").
    for (const leaf of leaves(c.input)) expect(text(container), `recorded value ${leaf}`).toContain(leaf);
    expect(retained(detail)).toEqual(c.rest);
    for (const value of c.shown) expect(text(container), `shown value ${value}`).toContain(value);
    expect(wells(detail), "a structured body, not the whole JSON").not.toContain(JSON.stringify(c.input, null, 2));
  });

  it("a body that shows every recorded value has no other-recorded-fields block", () => {
    const detail = detailOf(opened("update_plan", { explanation: "Why", plan: [STEP] }));
    expect(detail.querySelector("[data-input-json='rest']")).toBeNull();
  });

  it("retained fields are searchable: each nested value is marked, and a hit past the JSON cap opens it", () => {
    const todos = Array.from({ length: 12 }, (_, i) => ({ content: `Item ${i}`, status: "pending", activeForm: `Working on item ${i}`, id: `todo-${i}` }));
    // Nothing clicked: the hit opens the row and the capped JSON by itself.
    const container = opened("TodoWrite", { todos }, "todo-11", false);
    const detail = detailOf(container);
    expect(marks(detail)).toContain("todo-11");
    const rest = detail.querySelector("[data-input-json='rest']");
    expect(rest?.querySelector("mark")?.textContent).toBe("todo-11");
  });
});

// ---------------------------------------------------------------------------
// 3. Search reaches every text sink of a structured body
// ---------------------------------------------------------------------------

const SINKS: [string, string, Record<string, unknown>, string][] = [
  ["TodoWrite", "item text", { todos: [{ content: "Rotate the keys", status: "pending" }] }, "rotate"],
  ["TodoWrite", "a shown priority", { todos: [{ content: "Rotate", status: "pending", priority: "urgent" }] }, "urgent"],
  ["TodoWrite", "an item shown whole (no content)", { todos: [{ status: "pending", activeForm: "Rotating keys" }] }, "rotating"],
  ["todowrite", "item text", { todos: [{ content: "Rotate the keys", status: "pending" }] }, "keys"],
  ["update_plan", "step", { plan: [{ step: "Rotate the keys", status: "pending" }] }, "rotate"],
  ["update_plan", "explanation", { explanation: "Rotation is due", plan: [STEP] }, "rotation"],
  ["NotebookEdit", "path target", NOTEBOOK, "eda.ipynb"],
  ["NotebookEdit", "summary line", NOTEBOOK, "replace"],
  ["NotebookEdit", "source", NOTEBOOK, "describe"],
  ["TaskCreate", "subject (row target + summary)", { subject: "Rotate the keys" }, "rotate"],
  ["TaskCreate", "active form", { subject: "Rotate", activeForm: "Rotating the keys" }, "rotating"],
  ["TaskCreate", "description", { subject: "Rotate", description: "Every key older than 90 days" }, "older"],
  ["TaskUpdate", "row target", { taskId: "481", status: "pending" }, "481"],
  ["TaskUpdate", "owner in the summary", { taskId: "4", owner: "keymaster" }, "keymaster"],
  ["TaskUpdate", "unknown status in the summary", { taskId: "4", status: "parked" }, "parked"],
  ["TaskUpdate", "retained JSON", { taskId: "4", description: "Rotate quarterly" }, "quarterly"],
];

describe("3. search marks reach every structured text sink", () => {
  it.each(SINKS)("%s · %s", (name, _sink, input, query) => {
    const detail = detailOf(opened(name, input, query));
    expect(marks(detail), `a mark for "${query}" in the opened detail`).toContain(query);
  });

  it("the row target of a routed body is marked too (TaskCreate subject, NotebookEdit path)", () => {
    const task = opened("TaskCreate", { subject: "Rotate the keys" }, "keys");
    expect(task.querySelector("[data-tool-row] mark")?.textContent).toBe("keys");
    cleanup();
    const notebook = opened("NotebookEdit", NOTEBOOK, "eda");
    expect(notebook.querySelector("[data-tool-row] mark")?.textContent).toBe("eda");
  });

  it("a hit past the notebook source's line cap opens the cap and is marked (current match)", () => {
    const source = Array.from({ length: 40 }, (_, i) => (i === 34 ? "needle = load()" : `line_${i} = ${i}`)).join("\n");
    // Nothing clicked: the hit opens the row and the source's cap by itself.
    const container = opened("NotebookEdit", { ...NOTEBOOK, new_source: source }, "needle", false);
    const detail = detailOf(container);
    expect(text(detail), "the cap opened for the hit").toContain("needle = load()");
    const mark = detail.querySelector("mark");
    expect(mark?.textContent).toBe("needle");
    expect(mark?.getAttribute("aria-current")).toBe("true");
  });
});
