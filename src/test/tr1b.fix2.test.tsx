/**
 * TR1b review round 2 (PR #746): R2-F1 — every card keeps a result's
 * recorded part order, for any arrangement.
 *
 * Round 1 made each paired card show every part of its result, but the
 * Agent / Task card lifted "the first text anywhere in the results" into its
 * prose slot and rendered every other part after it: a result recorded as
 * image → text showed text → image. The rule here, as a class: whatever a
 * card does with a result (a prose slot, a confirmation it leaves out, a
 * stream zone), the parts it shows appear in the order they were recorded.
 * A prose slot may take a text only when that text is the very first part.
 *
 * The matrix is every arrangement of one to three parts over {text, image}
 * (14 shapes, which include image → text, text → image, image → text → text,
 * text → text → image and image → image → text) plus two shapes split over
 * two results, for every card the pairing routes a `tool_use` to × each
 * verdict × the nested route (a result's content array) and the top-level
 * paired path. The same arrangements run for MCP results (paired and
 * orphan), orphan `tool_result` rows, and a web_search result list. Each case
 * asserts the exact recorded sequence of the visible parts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import i18n from "@/i18n";
import { ThemeProvider } from "@/contexts/theme";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { useAppStore } from "@/store/useAppStore";
import { ClaudeContentArrayRenderer } from "@/components/contentRenderer/ClaudeContentArrayRenderer";
import { UnifiedToolExecutionRenderer } from "@/components/contentRenderer/UnifiedToolExecutionRenderer";
import { ToolExecutionResultRouter } from "@/components/messageRenderer/ToolExecutionResultRouter";

const CWD = "/Users/dev/work/kiln";
const WJ = /\u2060/g;
/** Three distinct 1×1 PNGs (red, green, blue): each image part is told apart by its data. */
const PNGS = [
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGO4I2f0HwAFMgIsjP5jlwAAAABJRU5ErkJggg==",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQWxDwHwAD/AIOou9YlgAAAABJRU5ErkJggg==",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPQiLrzHwAEagJeFJhuHAAAAABJRU5ErkJggg==",
] as const;

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <div data-testid="app-error">An unexpected error occurred: {this.state.error.message}</div> : this.props.children;
  }
}

const Providers = ({ children }: { children: ReactNode }) => (
  <ThemeProvider>
    <Boundary>
      <ExpandKeyProvider value="msg-tr1b-fix2">{children}</ExpandKeyProvider>
    </Boundary>
  </ThemeProvider>
);

const renderContent = (content: unknown[]) =>
  render(
    <Providers>
      <ClaudeContentArrayRenderer content={content} />
    </Providers>,
  );

const renderRouter = (toolResult: unknown[]) =>
  render(
    <Providers>
      <ToolExecutionResultRouter toolResult={toolResult} />
    </Providers>,
  );

const ROUTES = [
  ["nested in a result's content array (ContentArrayRenderer)", (blocks: unknown[]) => renderRouter(blocks)],
  ["top-level (ClaudeContentArrayRenderer)", (blocks: unknown[]) => renderContent(blocks)],
] as const;

const rows = (root: Element) => [...root.querySelectorAll<HTMLElement>("[data-tool-row]")];
/** Open everything a user can open: row disclosures, show-all toggles, inner folds. */
const openEverything = (root: HTMLElement) => {
  for (let guard = 0; guard < 80; guard += 1) {
    const next = [...root.querySelectorAll<HTMLElement>("button[aria-expanded=false]")].find((b) => !b.dataset.fix2Opened);
    if (!next) return;
    next.dataset.fix2Opened = "1";
    fireEvent.click(next);
  }
};
/** What a user can see: the subtree without anything inside a `hidden` element. */
const visibleHtml = (root: HTMLElement) => {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[hidden]").forEach((el) => el.remove());
  return clone.innerHTML.replace(WJ, "");
};

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
    messages: [],
    pagination: { currentOffset: 0, pageSize: 100, totalCount: 0, hasMore: false, isLoadingMore: false },
  } as never);
});

// ---------------------------------------------------------------------------
// Arrangements
// ---------------------------------------------------------------------------

type Kind = "text" | "image";

/** One recorded part: its label in the expected sequence, the string that finds it in the DOM, its Claude and MCP blocks. */
interface Part {
  label: string;
  token: string;
  claude: Record<string, unknown>;
  mcp: Record<string, unknown>;
}

/** One case's results: each result's parts, in recorded order. */
interface Arrangement {
  name: string;
  results: Kind[][];
}

/** Every sequence of one to three parts over {text, image}: 2 + 4 + 8 = 14 shapes. */
const SEQUENCES: Kind[][] = [1, 2, 3].flatMap((length) =>
  Array.from({ length: 2 ** length }, (_, n) => Array.from({ length }, (_, i) => ((n >> (length - 1 - i)) & 1 ? "image" : "text") as Kind)),
);

const ARRANGEMENTS: Arrangement[] = [
  ...SEQUENCES.map((kinds) => ({ name: kinds.join(" → "), results: [kinds] })),
  { name: "split over two results: [image] | [text → text]", results: [["image"], ["text", "text"]] },
  { name: "split over two results: [text] | [image → text]", results: [["text"], ["image", "text"]] },
];

/** The arrangement's parts with unique texts (`tag` keeps them unique per case) and distinct images. */
function partsOf(arrangement: Arrangement, tag: string): Part[][] {
  let texts = 0;
  let images = 0;
  return arrangement.results.map((kinds) =>
    kinds.map((kind) => {
      if (kind === "text") {
        texts += 1;
        const body = `ZephyrText${texts}-${tag}: recorded fact number ${texts}.`;
        return { label: `text${texts}`, token: `ZephyrText${texts}-${tag}`, claude: { type: "text", text: body }, mcp: { type: "text", text: body } };
      }
      const data = PNGS[images] as string;
      images += 1;
      return {
        label: `image${images}`,
        token: `data:image/png;base64,${data}`,
        claude: { type: "image", source: { type: "base64", media_type: "image/png", data } },
        mcp: { type: "image", data, mimeType: "image/png" },
      };
    }),
  );
}

/**
 * The visible parts appear exactly in their recorded sequence: every part is
 * visible (outside any `[hidden]`), and sorting them by DOM position gives
 * the recorded order.
 */
function expectRecordedSequence(container: HTMLElement, parts: Part[]) {
  expect(container.querySelector("[data-testid=app-error]"), "the app error boundary caught a render error").toBeNull();
  openEverything(container);
  const html = visibleHtml(container);
  const found = parts.map((part) => ({ label: part.label, at: html.indexOf(part.token) }));
  expect(
    found.filter((f) => f.at < 0).map((f) => f.label),
    "every recorded part is visible",
  ).toEqual([]);
  const shown = [...found].sort((a, b) => a.at - b.at).map((f) => f.label);
  expect(shown, "the visible parts keep their recorded order").toEqual(parts.map((part) => part.label));
}

// ---------------------------------------------------------------------------
// Every card × verdict × route × arrangement
// ---------------------------------------------------------------------------

/** Every card the pairing can route a `tool_use` to (UnifiedToolExecutionRenderer + the D-R1 body table), as in round 1's matrix. */
const CARDS: { card: string; name: string; input: Record<string, unknown> }[] = [
  { card: "Bash", name: "Bash", input: { command: "pnpm build", description: "Build" } },
  { card: "Read", name: "Read", input: { file_path: `${CWD}/src/a.ts` } },
  { card: "Edit", name: "Edit", input: { file_path: `${CWD}/src/b.ts`, old_string: "before()", new_string: "after()" } },
  { card: "Edit (MultiEdit)", name: "MultiEdit", input: { file_path: `${CWD}/src/c.ts`, edits: [{ old_string: "a()", new_string: "b()" }] } },
  { card: "Write", name: "Write", input: { file_path: `${CWD}/src/d.ts`, content: "export const d = 1;" } },
  { card: "Grep", name: "Grep", input: { pattern: "TODO", path: `${CWD}/src` } },
  { card: "Glob", name: "Glob", input: { pattern: "**/*.ts" } },
  { card: "WebFetch", name: "WebFetch", input: { url: "https://status.example.com", prompt: "Is it up?" } },
  { card: "WebSearch", name: "WebSearch", input: { query: "retry-after" } },
  { card: "Agent", name: "Agent", input: { description: "Audit the bundle", prompt: "List the largest modules." } },
  { card: "Agent (Task)", name: "Task", input: { description: "Audit the bundle", prompt: "List the largest modules.", subagent_type: "general-purpose" } },
  { card: "Workflow", name: "Workflow", input: { description: "Release flow", script: "export const name = 'release';" } },
  { card: "AskUserQuestion", name: "AskUserQuestion", input: { questions: [{ question: "Ship it?", header: "Ship", options: [{ label: "Yes" }, { label: "No" }], multiSelect: false }] } },
  { card: "Default (routed body: TodoWrite)", name: "TodoWrite", input: { todos: [{ content: "Write tests", status: "pending" }] } },
  { card: "Default (routed body: NotebookEdit)", name: "NotebookEdit", input: { notebook_path: `${CWD}/nb.ipynb`, new_source: "x = 1" } },
  { card: "Default (MCP name)", name: "mcp__github__create_issue", input: { title: "Flaky test" } },
  { card: "Default (unknown name)", name: "SomeUnknownTool", input: { alpha: "beta" } },
];

/** Each verdict as the outcome adapter reads it from the result alone. */
const VERDICTS: { verdict: string; extra: Record<string, unknown> }[] = [
  { verdict: "succeeded (exit code 0)", extra: { toolUseResult: { exitCode: 0 } } },
  { verdict: "no error signal", extra: {} },
  { verdict: "failed (is_error)", extra: { is_error: true } },
  { verdict: "interrupted", extra: { toolUseResult: { interrupted: true } } },
];

describe("R2-F1: a paired result's parts keep their recorded order, card × verdict × route × arrangement", () => {
  describe.each(ROUTES)("%s", (_route, mount) => {
    describe.each(CARDS)("$card", (c) => {
      // Tuples with a `%s` title: vitest cuts a `$label` value at 40 characters.
      const cases = VERDICTS.flatMap((v) => ARRANGEMENTS.map((a) => [`${v.verdict} · ${a.name}`, { ...v, arrangement: a }] as const));
      it.each(cases)("%s", (_label, { extra, arrangement }) => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const id = `toolu_r2_${c.name}`;
        const parts = partsOf(arrangement, c.name);
        const results = parts.map((result) => ({ type: "tool_result", tool_use_id: id, content: result.map((p) => p.claude), ...extra }));
        const { container } = mount([{ type: "tool_use", id, name: c.name, input: c.input }, ...results]);
        expect(rows(container).length, "the call and its results pair into one row").toBe(1);
        expectRecordedSequence(container, parts.flat());
      });
    });
  });
});

describe("R2-F1: server / API results keep their recorded order", () => {
  describe.each(ROUTES)("%s", (_route, mount) => {
    const mcpCases = [false, true].flatMap((isError) =>
      ARRANGEMENTS.filter((a) => a.results.length === 1).map((a) => [`${isError ? "failed" : "succeeded"} · ${a.name}`, { isError, arrangement: a }] as const),
    );

    it.each(mcpCases)("paired mcp_tool_result · %s", (_label, { isError, arrangement }) => {
      const parts = partsOf(arrangement, "mcp").flat();
      const { container } = mount([
        { type: "mcp_tool_use", id: "mcp_r2", server_name: "github", name: "create_issue", input: { title: "x" } },
        { type: "mcp_tool_result", tool_use_id: "mcp_r2", is_error: isError, content: parts.map((p) => p.mcp) },
      ]);
      expect(rows(container).length).toBe(1);
      expectRecordedSequence(container, parts);
    });

    it.each(mcpCases)("orphan mcp_tool_result (call not recorded) · %s", (_label, { isError, arrangement }) => {
      const parts = partsOf(arrangement, "mcporphan").flat();
      const { container } = mount([{ type: "mcp_tool_result", tool_use_id: "mcp_missing", is_error: isError, content: parts.map((p) => p.mcp) }]);
      expect(rows(container).length).toBe(1);
      expectRecordedSequence(container, parts);
    });

    it("a web_search result list, paired and orphan", () => {
      const list = ["ZephyrSearchA", "ZephyrSearchB", "ZephyrSearchC"].map((title) => ({ type: "web_search_result", title, url: `https://example.test/${title}` }));
      const sequence = list.map((r) => ({ label: r.title, token: r.title }) as Part);
      const paired = mount([
        { type: "server_tool_use", id: "srv_r2", name: "web_search", input: { query: "order" } },
        { type: "web_search_tool_result", tool_use_id: "srv_r2", content: list },
      ]);
      expectRecordedSequence(paired.container, sequence);
      paired.unmount();
      const orphan = mount([{ type: "web_search_tool_result", tool_use_id: "srv_missing", content: list }]);
      expectRecordedSequence(orphan.container, sequence);
    });
  });
});

describe("R2-F1: an orphan tool_result (its call not recorded) keeps its recorded order", () => {
  describe.each(ROUTES)("%s", (_route, mount) => {
    it.each(ARRANGEMENTS.filter((a) => a.results.length === 1).map((a) => [a.name, a] as const))("%s", (_name, arrangement) => {
      const parts = partsOf(arrangement, "orphan").flat();
      const { container } = mount([{ type: "tool_result", tool_use_id: "toolu_r2_missing_call", content: parts.map((p) => p.claude) }]);
      expect(rows(container).length).toBe(1);
      expectRecordedSequence(container, parts);
    });
  });
});

describe("R2-F1: the review's repro through the real card route", () => {
  it("Bash row → its result's content array → the nested Task's image → text → text result stays image → text → text", () => {
    const toolUse = { type: "tool_use", id: "outer", name: "Bash", input: { command: "cat leading-order.json" } };
    const result = {
      type: "tool_result",
      tool_use_id: "nested_task",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: PNGS[0] } },
        { type: "text", text: "ZephyrAfterImage: recorded AFTER the red image." },
        { type: "text", text: "agentId: ZephyrAgent\n<usage>total_tokens: 48211</usage>" },
      ],
    };
    const toolResults = [
      {
        type: "tool_result",
        tool_use_id: "outer",
        content: [{ type: "tool_use", id: "nested_task", name: "Task", input: { description: "Leading image order", prompt: "Describe the capture" } }, result],
      },
    ];
    const { container } = render(
      <Providers>
        <UnifiedToolExecutionRenderer toolUse={toolUse} toolResults={toolResults} />
      </Providers>,
    );
    expectRecordedSequence(container, [
      { label: "image", token: `data:image/png;base64,${PNGS[0]}` },
      { label: "ZephyrAfterImage", token: "ZephyrAfterImage" },
      { label: "agentId", token: "ZephyrAgent" },
    ] as Part[]);
  });
});
