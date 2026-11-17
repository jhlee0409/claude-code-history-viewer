/**
 * TR1b review round 1 (PR #746): F1 and F2 + CodeRabbit 4377267887.
 *
 * F1 — pairing must never consume a result the card does not show. A nested
 * call and its result became one row (`contentEntries`); the card then decides
 * what of the result it shows. Edit showed results only for a failed or
 * interrupted call, Agent / Task only the first text block; everything else
 * the pairing had taken out of the array was gone. The rule here, as a class:
 * every card the nested pairing (and the top-level paired path, which uses the
 * same cards) can route to keeps every recorded result part visible, in
 * recorded order, in every verdict (succeeded / no signal / failed /
 * interrupted). The only content a card may leave out is what it already
 * shows: the Write / Edit confirmation sentence that names the row's own file
 * (hidden on the top-level path before TR1b; nested now matches it), and an
 * error-code echo the row's status already states.
 *
 * F2 — a server / API result whose call is not in the message (an orphan
 * `web_search_tool_result` …) became a closed ResultRow with no search
 * wiring: a counted hit (its title, URL …) stayed hidden. Standalone server
 * results now take the same per-query reveal + highlight contract as paired
 * server calls: the row opens once per query (an effect keyed on the query)
 * and every counted field is marked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { Component, StrictMode, useEffect, type ReactNode } from "react";
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
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <div data-testid="app-error">An unexpected error occurred: {this.state.error.message}</div> : this.props.children;
  }
}

const Providers = ({ children, scope = "msg-tr1b-fix1" }: { children: ReactNode; scope?: string }) => (
  <ThemeProvider>
    <Boundary>
      <ExpandKeyProvider value={scope}>{children}</ExpandKeyProvider>
    </Boundary>
  </ThemeProvider>
);

interface SearchProps {
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
}

const renderContent = (content: unknown[], props: SearchProps = {}) =>
  render(
    <Providers>
      <ClaudeContentArrayRenderer content={content} {...props} />
    </Providers>,
  );

const renderRouter = (toolResult: unknown[], searchQuery?: string) =>
  render(
    <Providers>
      <ToolExecutionResultRouter toolResult={toolResult} searchQuery={searchQuery} />
    </Providers>,
  );

const text = (el: Element) => (el.textContent ?? "").replace(WJ, "");
const rows = (root: Element) => [...root.querySelectorAll<HTMLElement>("[data-tool-row]")];
const wrapperOf = (row: HTMLElement) => row.closest("[data-tool-row-wrapper]") as HTMLElement;
const buttonOf = (row: HTMLElement) => row.querySelector("button[aria-expanded]") as HTMLElement;
const marks = (root: Element) => [...root.querySelectorAll("mark")].map((m) => text(m).toLowerCase());
/** Open everything a user can open: row disclosures, show-all toggles, inner folds. */
const openEverything = (root: HTMLElement) => {
  for (let guard = 0; guard < 80; guard += 1) {
    const next = [...root.querySelectorAll<HTMLElement>("button[aria-expanded=false]")].find((b) => !b.dataset.fix1Opened);
    if (!next) return;
    next.dataset.fix1Opened = "1";
    fireEvent.click(next);
  }
};
/** What a user can see: the subtree without anything inside a `hidden` element. */
const visibleHtml = (root: HTMLElement) => {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[hidden]").forEach((el) => el.remove());
  return clone.innerHTML.replace(WJ, "");
};
const visibleText = (root: HTMLElement) => {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[hidden]").forEach((el) => el.remove());
  return text(clone);
};

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options as never) as string;

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
// F1: whole call-plus-result preservation, card × verdict × route
// ---------------------------------------------------------------------------

/** Every card the pairing can route a `tool_use` to (UnifiedToolExecutionRenderer + the D-R1 body table). */
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

const CASES = CARDS.flatMap((c) => VERDICTS.map((v) => ({ ...c, ...v, label: `${c.card} · ${v.verdict}` })));

/** A distinct non-confirmation result with ordered attachments: text, an image, text. */
function resultFor(id: string, extra: Record<string, unknown>, tag: string) {
  return {
    type: "tool_result",
    tool_use_id: id,
    content: [
      { type: "text", text: `ZephyrFirst-${tag}: the tool reported a first fact.` },
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
      { type: "text", text: `ZephyrLast-${tag}: and a last fact after the image.` },
    ],
    ...extra,
  };
}

const ROUTES = [
  ["nested in a result's content array (ContentArrayRenderer)", (blocks: unknown[]) => renderRouter(blocks)],
  ["top-level paired path (ClaudeContentArrayRenderer)", (blocks: unknown[]) => renderContent(blocks)],
] as const;

function expectWholeResult(container: HTMLElement, tag: string) {
  expect(container.querySelector("[data-testid=app-error]"), "the app error boundary caught a render error").toBeNull();
  expect(rows(container).length, "the call and its result pair into one row").toBe(1);
  openEverything(container);
  const html = visibleHtml(container);
  const first = html.indexOf(`ZephyrFirst-${tag}`);
  const image = html.indexOf(`data:image/png;base64,${PNG.slice(0, 16)}`);
  const last = html.indexOf(`ZephyrLast-${tag}`);
  const shown = visibleText(container).slice(0, 1500);
  expect(first, `the first text part is visible: ${shown}`).toBeGreaterThanOrEqual(0);
  expect(image, `the image part is visible: ${shown}`).toBeGreaterThanOrEqual(0);
  expect(last, `the last text part is visible: ${shown}`).toBeGreaterThanOrEqual(0);
  expect(first < image && image < last, "the parts keep their recorded order").toBe(true);
}

describe("F1: a paired result's recorded parts stay visible, card × verdict, nested and top-level", () => {
  describe.each(ROUTES)("%s", (_route, mount) => {
    it.each(CASES)("$label", (c) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const id = `toolu_f1_${c.name}`;
      const tag = `${c.name}`;
      const { container } = mount([{ type: "tool_use", id, name: c.name, input: c.input }, resultFor(id, c.extra, tag)]);
      expectWholeResult(container, tag);
    });
  });
});

describe("F1: server / MCP calls keep their result content in every verdict", () => {
  const SERVER = [
    {
      label: "web_search · results",
      call: { type: "server_tool_use", id: "srv_f1", name: "web_search", input: { query: "retry" } },
      result: { type: "web_search_tool_result", tool_use_id: "srv_f1", content: [{ type: "web_search_result", url: "https://example.test/zephyr", title: "ZephyrServerTitle" }] },
      needle: "ZephyrServerTitle",
    },
    {
      label: "web_search · error code",
      call: { type: "server_tool_use", id: "srv_f1", name: "web_search", input: { query: "retry" } },
      result: { type: "web_search_tool_result", tool_use_id: "srv_f1", content: { type: "web_search_tool_result_error", error_code: "unavailable", message: "ZephyrServerError" } },
      needle: "ZephyrServerError",
    },
    {
      label: "mcp · succeeded",
      call: { type: "mcp_tool_use", id: "mcp_f1", server_name: "github", name: "create_issue", input: { title: "x" } },
      result: { type: "mcp_tool_result", tool_use_id: "mcp_f1", is_error: false, content: [{ type: "text", text: "ZephyrMcpOk" }] },
      needle: "ZephyrMcpOk",
    },
    {
      label: "mcp · failed",
      call: { type: "mcp_tool_use", id: "mcp_f1", server_name: "github", name: "create_issue", input: { title: "x" } },
      result: { type: "mcp_tool_result", tool_use_id: "mcp_f1", is_error: true, content: [{ type: "text", text: "ZephyrMcpFailed" }] },
      needle: "ZephyrMcpFailed",
    },
  ];
  describe.each(ROUTES)("%s", (_route, mount) => {
    it.each(SERVER)("$label", (c) => {
      const { container } = mount([c.call, c.result]);
      expect(rows(container).length).toBe(1);
      openEverything(container);
      expect(visibleText(container)).toContain(c.needle);
    });
  });
});

describe("F1: the review's repro — a completed nested Edit's result text", () => {
  const EDIT = { type: "tool_use", id: "nested_edit", name: "Edit", input: { file_path: "release/notes.md", old_string: "before", new_string: "after" } };
  const RESULT = { type: "tool_result", tool_use_id: "nested_edit", content: "ZephyrEditResult: formatter adjusted indentation; verify the result before publishing." };

  it("through the real card route: Bash row → its result's content array → the nested Edit row shows the result", () => {
    const toolUse = { type: "tool_use", id: "outer_bash", name: "Bash", input: { command: "cat release/review-records.json" } };
    const toolResults = [{ type: "tool_result", tool_use_id: "outer_bash", content: [{ type: "text", text: "nested recorded tools" }, EDIT, RESULT] }];
    const { container } = render(
      <Providers>
        <UnifiedToolExecutionRenderer toolUse={toolUse} toolResults={toolResults} />
      </Providers>,
    );
    openEverything(container);
    expect(visibleText(container)).toContain("ZephyrEditResult: formatter adjusted indentation");
    const nested = rows(container).find((r) => text(r).includes("notes.md")) as HTMLElement;
    const zone = wrapperOf(nested).querySelector("[data-tool-detail] [data-detail-zone=result]");
    expect(zone, "the nested Edit row has a Result zone").not.toBeNull();
    expect(text(zone as Element)).toContain("ZephyrEditResult");
  });
});

describe("F1: what an Edit / Write row may still leave out is only its own confirmation sentence (top-level behaviour before TR1b)", () => {
  const FP = `${CWD}/src/b.ts`;
  const edit = { type: "tool_use", id: "toolu_conf", name: "Edit", input: { file_path: FP, old_string: "before()", new_string: "after()" } };
  const resultZone = (container: HTMLElement) => wrapperOf(rows(container)[0] as HTMLElement).querySelector("[data-tool-detail] [data-detail-zone=result]");
  const HIDDEN = [
    ["the current sentence", `The file ${FP} has been updated successfully.`],
    ["the sentence with the context note", `The file ${FP} has been updated successfully. (file state is current in your context — no need to Read it back)`],
    ["the short sentence (the inner fixture's and earlier pins' shape)", `The file ${FP} has been updated.`],
    ["the legacy cat -n sentence without a snippet (the harness fixture's shape)", `The file ${FP} has been updated. Here's the result of running \`cat -n\` on a snippet of the edited file.`],
  ] as const;
  const SHOWN = [
    ["a note that adds a fact (modified on disk)", `The file ${FP} has been updated successfully. (note: the file had been modified on disk since it was last read; ZephyrDiskNote)`, "ZephyrDiskNote"],
    ["the legacy sentence followed by its cat -n snippet", `The file ${FP} has been updated. Here's the result of running \`cat -n\` on a snippet of the edited file:\n     1\tconst zephyrSnippet = after();`, "zephyrSnippet"],
    ["a confirmation naming another file", `The file ${CWD}/src/zephyr-other.ts has been updated successfully.`, "zephyr-other.ts"],
  ] as const;
  describe.each(ROUTES)("%s", (_route, mount) => {
    it.each(HIDDEN)("left out: %s", (_label, content) => {
      const { container } = mount([edit, { type: "tool_result", tool_use_id: "toolu_conf", content }]);
      openEverything(container);
      expect(resultZone(container), "no Result zone for a pure confirmation").toBeNull();
    });
    it.each(SHOWN)("shown: %s", (_label, content, needle) => {
      const { container } = mount([edit, { type: "tool_result", tool_use_id: "toolu_conf", content }]);
      openEverything(container);
      const zone = resultZone(container);
      expect(zone, "a Result zone").not.toBeNull();
      expect(text(zone as Element)).toContain(needle);
    });
  });
});

describe("F1: an Agent / Task result keeps every text block (Claude records agentId / usage as a second block)", () => {
  const call = { type: "tool_use", id: "toolu_task", name: "Task", input: { description: "Audit", prompt: "Audit the bundle." } };
  const result = {
    type: "tool_result",
    tool_use_id: "toolu_task",
    content: [
      { type: "text", text: "Top modules: katex, prismjs." },
      { type: "text", text: "agentId: a1b2c3ZephyrAgent (for resuming to continue this agent's work if needed)\n<usage>total_tokens: 48211</usage>" },
    ],
  };
  it.each(ROUTES)("%s", (_route, mount) => {
    const { container } = mount([call, result]);
    openEverything(container);
    const shown = visibleText(container);
    expect(shown).toContain("Top modules: katex, prismjs.");
    expect(shown).toContain("a1b2c3ZephyrAgent");
  });
});

// ---------------------------------------------------------------------------
// F2: a standalone server result takes the per-query reveal + highlight
// ---------------------------------------------------------------------------

/** One orphan per server result type, with each field the conversation search counts (`serverResultTexts`). */
const ORPHANS: { label: string; block: Record<string, unknown>; queries: string[] }[] = [
  {
    label: "web_search_tool_result",
    block: { type: "web_search_tool_result", tool_use_id: "missing_server_call", content: [{ type: "web_search_result", title: "ZephyrOrphanTitle", url: "https://example.test/zephyr-orphan-url", page_age: "2026-10-01" }] },
    queries: ["ZephyrOrphanTitle", "zephyr-orphan-url"],
  },
  {
    label: "web_fetch_tool_result",
    block: { type: "web_fetch_tool_result", tool_use_id: "missing_fetch", content: { type: "web_fetch_result", url: "https://example.test/zephyr-fetch-url", content: { type: "document", title: "ZephyrFetchTitle", source: { type: "text", media_type: "text/plain", data: "body" } } } },
    queries: ["zephyr-fetch-url", "ZephyrFetchTitle"],
  },
  {
    label: "code_execution_tool_result",
    block: { type: "code_execution_tool_result", tool_use_id: "missing_code", content: { type: "code_execution_result", stdout: "ZephyrCodeOut", stderr: "ZephyrCodeErr", return_code: 0 } },
    queries: ["ZephyrCodeOut", "ZephyrCodeErr"],
  },
  {
    label: "bash_code_execution_tool_result",
    block: { type: "bash_code_execution_tool_result", tool_use_id: "missing_bash", content: { type: "bash_code_execution_result", stdout: "ZephyrBashOut", stderr: "ZephyrBashErr", return_code: 1 } },
    queries: ["ZephyrBashOut", "ZephyrBashErr"],
  },
  {
    label: "text_editor_code_execution_tool_result",
    block: { type: "text_editor_code_execution_tool_result", tool_use_id: "missing_editor", content: { type: "text_editor_code_execution_result", operation: "view", path: "/tmp/zephyr-editor-path.py", content: "print('ZephyrEditorContent')" } },
    queries: ["zephyr-editor-path", "ZephyrEditorContent"],
  },
  {
    label: "tool_search_tool_result",
    block: { type: "tool_search_tool_result", tool_use_id: "missing_search", content: [{ tool_name: "ZephyrToolName", server_name: "zephyr_server", description: "ZephyrToolDescription" }] },
    queries: ["ZephyrToolName", "zephyr_server", "ZephyrToolDescription"],
  },
  {
    label: "mcp_tool_result",
    block: { type: "mcp_tool_result", tool_use_id: "missing_mcp", is_error: false, content: [{ type: "text", text: "ZephyrMcpOrphanText" }] },
    queries: ["ZephyrMcpOrphanText"],
  },
];

const ORPHAN_QUERIES = ORPHANS.flatMap((o) => o.queries.map((query) => ({ ...o, query })));

describe("F2: a server result whose call is not in the message opens for a counted hit and marks it", () => {
  it.each(ORPHAN_QUERIES)("$label · $query", ({ block, query }) => {
    const { container } = renderContent([block], { searchQuery: query, isCurrentMatch: true, currentMatchIndex: 0 });
    const row = rows(container)[0] as HTMLElement;
    expect(text(row)).toContain(t("toolRow.callNotRecorded"));
    expect(buttonOf(row).getAttribute("aria-expanded"), "the hit opened the row").toBe("true");
    expect(visibleText(wrapperOf(row))).toContain(query);
    expect(marks(wrapperOf(row)), "the counted hit is marked").toContain(query.toLowerCase());
  });

  it("no query, or a query it does not hold: the row stays closed and nothing is marked", () => {
    for (const searchQuery of ["", "nothing-like-this"]) {
      useExpandRegistry.getState().clearAll();
      const { container, unmount } = renderContent([ORPHANS[0]!.block], { searchQuery });
      const row = rows(container)[0] as HTMLElement;
      expect(buttonOf(row).getAttribute("aria-expanded"), JSON.stringify(searchQuery)).toBe("false");
      expect(marks(container)).toEqual([]);
      unmount();
    }
  });

  it("nested in a result's content array: the same reveal and marks", () => {
    const { container } = renderRouter([ORPHANS[0]!.block], "ZephyrOrphanTitle");
    const row = rows(container)[0] as HTMLElement;
    expect(buttonOf(row).getAttribute("aria-expanded")).toBe("true");
    expect(marks(wrapperOf(row))).toContain("zephyrorphantitle");
  });

  it("paired control: the call's row still opens and marks a result title", () => {
    const { container } = renderContent(
      [
        { type: "server_tool_use", id: "srv_paired", name: "web_search", input: { query: "paired" } },
        { type: "web_search_tool_result", tool_use_id: "srv_paired", content: [{ type: "web_search_result", title: "ZephyrPairedTitle", url: "https://example.test/paired" }] },
      ],
      { searchQuery: "ZephyrPairedTitle" },
    );
    const row = rows(container)[0] as HTMLElement;
    expect(buttonOf(row).getAttribute("aria-expanded")).toBe("true");
    expect(marks(wrapperOf(row))).toContain("zephyrpairedtitle");
  });

  it("transition matrix under StrictMode effect replay: closed → match opens → collapse holds for the same query → a new matching query opens → whitespace clears the marks", () => {
    let setups = 0;
    let cleanups = 0;
    function Witness() {
      useEffect(() => {
        setups += 1;
        return () => {
          cleanups += 1;
        };
      }, []);
      return null;
    }
    const block = { type: "web_search_tool_result", tool_use_id: "strict_orphan", content: [{ type: "web_search_result", title: "alpha beta title", url: "https://example.test/alpha" }] };
    const element = (searchQuery: string) => (
      <StrictMode>
        <Providers scope="fix1-strict">
          <Witness />
          <ClaudeContentArrayRenderer content={[block]} searchQuery={searchQuery} />
        </Providers>
      </StrictMode>
    );
    const view = render(element(""));
    const toggle = () => view.container.querySelector("[data-tool-row] > button[aria-expanded]") as HTMLElement;
    expect(setups, "StrictMode replayed the effects").toBe(2);
    expect(cleanups).toBe(1);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    view.rerender(element("alpha"));
    expect(toggle().getAttribute("aria-expanded"), "a matching query opens it").toBe("true");
    expect(marks(view.container)).toContain("alpha");
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    view.rerender(element("alpha"));
    expect(toggle().getAttribute("aria-expanded"), "the same query: the user's collapse holds").toBe("false");
    view.rerender(element("beta"));
    expect(toggle().getAttribute("aria-expanded"), "a different matching query opens it again").toBe("true");
    expect(marks(view.container)).toContain("beta");
    view.rerender(element(" "));
    expect(marks(view.container)).toEqual([]);
    view.unmount();
  });
});
