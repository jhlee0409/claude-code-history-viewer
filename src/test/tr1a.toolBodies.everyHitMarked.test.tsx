/**
 * TR1a fix round 2 (review round 2: R2-F1, R2-F2): every search hit counted
 * in a routed Default body's input is visibly marked somewhere in the
 * opened row.
 *
 * 1. PathText runs the highlighter over the whole shown path and spreads the
 *    marks onto its folder / name parts, so a hit across the split is marked
 *    (as two pieces, `data-search-hit-part` start / end; joined here).
 * 2. A field counts as shown only where its recorded text appears verbatim
 *    in the body. A status drawn as an icon or a translated label, a path
 *    shown relative to a base, are shown for display but not verbatim:
 *    while the query hits such a field's recorded value, the field (with
 *    that value) is in the "other recorded fields" JSON, marked. With no
 *    query, or no hit there, the JSON stays exactly as before.
 * 3. The invariant: for each route × a fixture value in every field it
 *    consumes, searching that recorded value marks it in the opened row.
 *
 * The first four cases are the reviewer's round-2 probes
 * (`candidates.test.tsx`), with the split path hit joined.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import i18n from "@/i18n";
import { UnifiedToolExecutionRenderer } from "@/components/contentRenderer/UnifiedToolExecutionRenderer";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeProject } from "@/types";

const PROJECT = "/Users/dev/work/kiln";
const WJ = /\u2060/g;

let n = 0;
beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => {
  cleanup();
  useExpandRegistry.getState().clearAll();
});
afterEach(() => {
  useAppStore.setState({ selectedProject: null });
});

/** Open every collapsed disclosure (the row, show-all caps), as a user can. */
function openAll(container: HTMLElement) {
  for (let i = 0; i < 30; i++) {
    const b = [...container.querySelectorAll<HTMLElement>("button")].find((el) => el.getAttribute("aria-expanded") === "false");
    if (!b) break;
    fireEvent.click(b);
  }
}

/** Render the paired call with the query, open everything; the whole row (head + detail). */
function openedRow(name: string, input: unknown, searchQuery: string): HTMLElement {
  const id = `everyhit${++n}`;
  const v = render(
    <ExpandKeyProvider value={`everyhit-probe${n}`}>
      <UnifiedToolExecutionRenderer
        toolUse={{ type: "tool_use", id, name, input }}
        toolResults={[{ type: "tool_result", tool_use_id: id, content: "OK" }]}
        searchQuery={searchQuery}
        isCurrentMatch
        currentMatchIndex={0}
      />
    </ExpandKeyProvider>,
  );
  openAll(v.container);
  return v.container;
}

const text = (el: Element) => (el.textContent ?? "").replace(WJ, "");

/** The marked search hits in `root`, lower-cased; a path hit split over the folder / name parts is joined into one. */
function markedHits(root: Element): string[] {
  const hits: string[] = [];
  let open: string | null = null;
  for (const mark of root.querySelectorAll("mark")) {
    const piece = text(mark);
    const part = mark.getAttribute("data-search-hit-part");
    if (open !== null && part === "end") {
      hits.push(open + piece);
      open = null;
    } else if (part === "start") {
      open = piece;
    } else {
      hits.push(piece);
    }
  }
  return hits.map((h) => h.toLowerCase());
}

/** The "other recorded fields" JSON of an opened structured body, parsed (`undefined` when there is none). */
function retained(root: Element): unknown {
  const pre = root.querySelector("[data-input-json='rest'] pre[data-output-text]");
  return pre ? JSON.parse(text(pre)) : undefined;
}

const structured = (root: Element) => expect(root.querySelector("[data-input-json='whole']"), "the structured body, not the JSON fallback").toBeNull();

// ---------------------------------------------------------------------------
// The reviewer's round-2 probes
// ---------------------------------------------------------------------------

describe("review round 2 probes: a counted input hit is marked in the opened row", () => {
  it.each([
    ["path-span", "NotebookEdit", { notebook_path: "/work/notebooks/report.ipynb", new_source: "x=1" }, "notebooks/report.ipynb"],
    ["plan-label", "update_plan", { plan: [{ step: "Review the code", status: "pending" }] }, "pending"],
    ["todo-status", "todowrite", { todos: [{ content: "Review the code", status: "in_progress" }] }, "in_progress"],
    ["task-label", "TaskUpdate", { taskId: "1", status: "in_progress" }, "in_progress"],
  ] as const)("%s: %s", (_key, name, input, query) => {
    const row = openedRow(name, input, query);
    structured(row);
    expect(markedHits(row)).toContain(query);
  });
});

// ---------------------------------------------------------------------------
// Rule 2: a status shown as an icon / label is in the retained JSON while the query hits it
// ---------------------------------------------------------------------------

describe("a field shown in another form is retained, with its recorded value, while the query hits it", () => {
  it("todowrite in_progress: the status (drawn as an icon) is retained per member, positions kept", () => {
    const input = { todos: [{ content: "Read the spec", status: "pending" }, { content: "Review the code", status: "in_progress" }] };
    const row = openedRow("todowrite", input, "in_progress");
    expect(retained(row)).toEqual({ todos: [{}, { status: "in_progress" }] });
    expect(markedHits(row)).toContain("in_progress");
  });

  it("TodoWrite pending: the same through the upper-case name", () => {
    const row = openedRow("TodoWrite", { todos: [{ content: "Read the spec", status: "pending", activeForm: "Reading the spec" }] }, "pending");
    expect(retained(row)).toEqual({ todos: [{ status: "pending", activeForm: "Reading the spec" }] });
  });

  it("update_plan pending: the status (a translated label) is retained", () => {
    const row = openedRow("update_plan", { explanation: "Order", plan: [{ step: "Review the code", status: "pending" }, { step: "Ship", status: "completed" }] }, "pending");
    expect(retained(row)).toEqual({ plan: [{ status: "pending" }, {}] });
    expect(markedHits(row)).toContain("pending");
  });

  it("TaskUpdate in_progress: the status (shown as \"In Progress\") is retained", () => {
    const row = openedRow("TaskUpdate", { taskId: "7", status: "in_progress", subject: "Port the parser" }, "in_progress");
    expect(retained(row)).toEqual({ status: "in_progress" });
    expect(markedHits(row)).toContain("in_progress");
  });

  it("TaskUpdate with a status it shows as recorded (no label for it): nothing retained, the summary marks it", () => {
    const row = openedRow("TaskUpdate", { taskId: "7", status: "blocked" }, "blocked");
    expect(retained(row)).toBeUndefined();
    expect(markedHits(row)).toContain("blocked");
  });

  it("NotebookEdit: a path shown relative to the project is retained while the query hits the recorded path", () => {
    useAppStore.setState({ selectedProject: { actual_path: PROJECT } as unknown as ClaudeProject });
    const path = `${PROJECT}/notebooks/eda.ipynb`;
    const row = openedRow("NotebookEdit", { notebook_path: path, cell_number: 3, new_source: "df.describe()" }, "work/kiln");
    expect(row.querySelector("[data-path]")?.textContent, "the row target is relative").toBe("notebooks/eda.ipynb");
    expect(retained(row)).toEqual({ notebook_path: path });
    expect(markedHits(row)).toContain("work/kiln");
  });

  it("no query, or a query that hits only verbatim fields: the retained JSON is exactly as before", () => {
    const todo = { todos: [{ content: "Review the code", status: "in_progress", activeForm: "Reviewing" }] };
    expect(retained(openedRow("todowrite", todo, ""))).toEqual({ todos: [{ activeForm: "Reviewing" }] });
    expect(retained(openedRow("todowrite", todo, "Review the code"))).toEqual({ todos: [{ activeForm: "Reviewing" }] });
    expect(retained(openedRow("todowrite", todo, "no such text"))).toEqual({ todos: [{ activeForm: "Reviewing" }] });
    const plan = { plan: [{ step: "Review the code", status: "pending" }] };
    expect(retained(openedRow("update_plan", plan, ""))).toBeUndefined();
    expect(retained(openedRow("update_plan", plan, "Review"))).toBeUndefined();
    const task = { taskId: "7", status: "in_progress" };
    expect(retained(openedRow("TaskUpdate", task, ""))).toBeUndefined();
    expect(retained(openedRow("TaskUpdate", task, "#7"))).toBeUndefined();
    useAppStore.setState({ selectedProject: { actual_path: PROJECT } as unknown as ClaudeProject });
    const notebook = { notebook_path: `${PROJECT}/notebooks/eda.ipynb`, new_source: "x" };
    expect(retained(openedRow("NotebookEdit", notebook, ""))).toBeUndefined();
    expect(retained(openedRow("NotebookEdit", notebook, "x"))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Rule 3: the invariant, per route × every consumed field
// ---------------------------------------------------------------------------

interface RouteCase {
  route: string;
  name: string;
  input: Record<string, unknown>;
  /** One recorded value of every consumed field (and the retained ones). */
  values: string[];
  /** Shown relative to this project root. */
  project?: string;
}

const NB_PATH = `${PROJECT}/notebooks/report.ipynb`;

const ROUTES: RouteCase[] = [
  ...(["TodoWrite", "todowrite"] as const).map(
    (name): RouteCase => ({
      route: "todo",
      name,
      input: {
        todos: [
          { content: "Audit the lockfile", status: "pending", priority: "high", id: "todo-id-17", activeForm: "Auditing the lockfile" },
          { content: "Ship the build", status: "in_progress", priority: "medium" },
          { content: "Write the notes", status: "completed", priority: "low", extraKey: "member extra" },
        ],
        topExtra: "top-level extra",
      },
      values: ["Audit the lockfile", "Ship the build", "Write the notes", "pending", "in_progress", "completed", "high", "medium", "low", "todo-id-17", "Auditing the lockfile", "member extra", "top-level extra"],
    }),
  ),
  {
    route: "todo (an item without content, printed whole)",
    name: "todowrite",
    input: { todos: [{ status: "completed", id: "bare-item" }] },
    values: ["completed", "bare-item"],
  },
  {
    route: "plan",
    name: "update_plan",
    input: {
      explanation: "Reorder the release",
      plan: [
        { step: "Review the code", status: "pending" },
        { step: "Run the suite", status: "in_progress" },
        { step: "Tag the build", status: "completed", owner: "step extra" },
        { step: "Drop the flag", status: "deleted" },
      ],
    },
    values: ["Reorder the release", "Review the code", "Run the suite", "Tag the build", "Drop the flag", "pending", "in_progress", "completed", "deleted", "step extra"],
  },
  {
    route: "plan (empty explanation)",
    name: "update_plan",
    input: { explanation: "", plan: [{ step: "Only step", status: "pending" }] },
    values: ["Only step", "pending"],
  },
  {
    route: "notebook (absolute path)",
    name: "NotebookEdit",
    input: { notebook_path: "/work/notebooks/report.ipynb", cell_number: 7, cell_id: "cell-abc", new_source: "x = 41", edit_mode: "replace", cell_type: "markdown", extra: "nb extra" },
    values: ["/work/notebooks/report.ipynb", "notebooks/report.ipynb", "report.ipynb", "/work/", "7", "cell-abc", "x = 41", "replace", "markdown", "nb extra"],
  },
  {
    route: "notebook (path relative to the project)",
    name: "NotebookEdit",
    project: PROJECT,
    input: { notebook_path: NB_PATH, cell_id: "cell-xyz", new_source: "y = 2", edit_mode: "insert", cell_type: "code" },
    values: [NB_PATH, PROJECT, "notebooks/report.ipynb", "report.ipynb", "cell-xyz", "y = 2", "insert", "code"],
  },
  {
    route: "notebook (Windows path)",
    name: "NotebookEdit",
    input: { notebook_path: "C:\\work\\notebooks\\report.ipynb", new_source: "z = 3" },
    // A backslash is escaped in the input's JSON, so a query holding one is no
    // counted input hit (DefaultCard searches the JSON); the split over
    // backslash separators is pinned in PathText.test.tsx.
    values: ["C:", "report.ipynb", "z = 3"],
  },
  {
    route: "taskCreate",
    name: "TaskCreate",
    input: { subject: "Port the parser", description: "Move it to Rust", activeForm: "Porting the parser", metadata: { lane: "create extra" } },
    values: ["Port the parser", "Move it to Rust", "Porting the parser", "create extra"],
  },
  ...(["pending", "in_progress", "completed", "deleted", "blocked"] as const).map(
    (status): RouteCase => ({
      route: `taskUpdate (${status})`,
      name: "TaskUpdate",
      input: { taskId: "42", status, subject: "Port the lexer", owner: "agent-b", addBlocks: ["43"], addBlockedBy: ["41"], description: "update extra" },
      values: ["42", status, "Port the lexer", "agent-b", "43", "41", "update extra"],
    }),
  ),
];

const INVARIANT = ROUTES.flatMap((c) => c.values.map((value) => [c.route, c.name, value, c] as const));

describe("invariant: searching any recorded value of a routed body marks it in the opened row", () => {
  it.each(INVARIANT)("%s · %s · %j", (_route, name, value, c) => {
    if (c.project) useAppStore.setState({ selectedProject: { actual_path: c.project } as unknown as ClaudeProject });
    // DefaultCard's own rule for a counted input hit.
    expect(JSON.stringify(c.input, null, 2).toLowerCase(), "the value is a counted input hit").toContain(value.toLowerCase());
    const row = openedRow(name, c.input, value);
    structured(row);
    expect(markedHits(row), `a <mark> whose text is ${JSON.stringify(value)}`).toContain(value.toLowerCase());
  });
});

// ---------------------------------------------------------------------------
// CodeRabbit 4370643919: the JSON caption lists keys only for an object input
// ---------------------------------------------------------------------------

describe("the whole-input JSON caption names keys only for an object input", () => {
  const caption = (root: Element) => text(root.querySelector("[data-input-json='whole'] > div")!).trim();
  it.each([
    ["array", ["first", "second"]],
    ["string", "abc"],
  ])("%s input: the caption is the plain label, no index list", (_kind, input) => {
    const root = openedRow("mcp__probe__tool", input, "");
    expect(caption(root)).toBe(i18n.t("common.input"));
  });
  it("object input: the caption lists its keys", () => {
    const root = openedRow("mcp__probe__tool", { alpha: 1, beta: 2 }, "");
    expect(caption(root)).toBe(`${i18n.t("common.input")} (alpha, beta)`);
  });
});
