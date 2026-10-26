/**
 * TR1b: the Claude legacy / unpaired tool paths render as ToolRows.
 *
 * Plan-v3 TR1b (+ v3.1 amendments 9, 10, 14, D-R1, D-R3, D-R5, D-R6), the
 * reachability map in scratch/tr1b/reachability.md:
 *
 * - An unpaired `tool_use` that reaches the legacy `ToolUseRenderer` (a
 *   top-level block without a string id; a `tool_use` nested in a tool
 *   result's content array; a message's legacy `toolUse` field) is a
 *   ToolRow: the recorded name, the target, "No result recorded" (neutral).
 *   No success pill, no tool-colour fill, no card head.
 * - #734: a nested `update_plan` / `TodoWrite` whose list holds a non-object
 *   member opens as JSON (TR1a's shape gate) and never reaches the app's
 *   error boundary, through the real route (ToolExecutionResultRouter →
 *   ContentArrayRenderer → ToolUseRenderer) under the real providers.
 * - Page-boundary orphan: a `tool_result` whose call is on an earlier page
 *   is a row whose head says so, the result in the Result zone; the verdict
 *   comes from the result alone (never a fake one).
 * - Server / MCP tool calls (`server_tool_use`, `mcp_tool_use`) are one
 *   ToolRow each, with their result block in its Result zone (one row per
 *   call: the old separate result card is gone).
 * - Characterization (amendment 9): every information item the old legacy
 *   renderers showed is still shown (or in "other recorded fields") once
 *   everything is opened. These pass on the base too.
 * - Props keep acting: search marks + auto-open (an effect keyed on the
 *   query), copy tool ID at the end of the detail meta line, expand state
 *   per rendered instance, every disclosure with aria-expanded +
 *   aria-controls to a real element (amendment 14).
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
import { ClaudeToolUseDisplay } from "@/components/messageRenderer/ClaudeToolUseDisplay";
import { formatterFor } from "@/lib/format/useFormat";

const CWD = "/Users/dev/work/kiln";
const WJ = /\u2060/g;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** The app's error boundary, as a test double: it shows the error instead of the children. */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <div data-testid="app-error">An unexpected error occurred: {this.state.error.message}</div> : this.props.children;
  }
}

const Providers = ({ children, scope = "msg-tr1b" }: { children: ReactNode; scope?: string }) => (
  <ThemeProvider>
    <Boundary>
      <ExpandKeyProvider value={scope}>{children}</ExpandKeyProvider>
    </Boundary>
  </ThemeProvider>
);

interface SearchProps {
  searchQuery?: string;
  filterType?: "content" | "toolId";
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
}

function renderContent(content: unknown[], props: SearchProps = {}) {
  const element = (p: SearchProps) => (
    <Providers>
      <ClaudeContentArrayRenderer content={content} {...p} />
    </Providers>
  );
  const view = render(element(props));
  return { ...view, rerenderWith: (p: SearchProps) => view.rerender(element(p)) };
}

const renderRouter = (toolResult: Record<string, unknown> | unknown[]) =>
  render(
    <Providers>
      <ToolExecutionResultRouter toolResult={toolResult} />
    </Providers>,
  );

const text = (el: Element) => (el.textContent ?? "").replace(WJ, "");
const rows = (root: Element) => [...root.querySelectorAll<HTMLElement>("[data-tool-row]")];
const rowWith = (root: Element, needle: string) => {
  const row = rows(root).find((r) => text(r).includes(needle));
  expect(row, `a ToolRow head ([data-tool-row]) showing "${needle}"`).toBeTruthy();
  return row as HTMLElement;
};
const firstRow = (root: Element) => {
  const row = rows(root)[0];
  expect(row, "a ToolRow head ([data-tool-row])").toBeTruthy();
  return row as HTMLElement;
};
const wrapperOf = (row: HTMLElement) => row.closest("[data-tool-row-wrapper]") as HTMLElement;
const buttonOf = (row: HTMLElement) => row.querySelector("button[aria-expanded]") as HTMLElement;
const open = (row: HTMLElement) => {
  const button = buttonOf(row);
  expect(button, "the row's disclosure button").not.toBeNull();
  if (button.getAttribute("aria-expanded") !== "true") fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("true");
};
const detailOf = (row: HTMLElement) => {
  const detail = wrapperOf(row).querySelector(":scope > [data-tool-detail]:not([hidden])");
  expect(detail, "the opened row detail").not.toBeNull();
  return detail as HTMLElement;
};
const statusText = (row: HTMLElement) => (row.querySelector("[data-outcome-icon]")?.parentElement?.textContent ?? "").trim();
const verbOf = (row: HTMLElement) => row.querySelector("[data-tool-verb]")?.textContent ?? null;
/** Open everything a user can open: row disclosures, show-all toggles and the old cards' folds. */
const openEverything = (root: HTMLElement) => {
  for (let guard = 0; guard < 60; guard += 1) {
    const next = [...root.querySelectorAll<HTMLElement>("button")].find(
      (b) => (b.getAttribute("aria-expanded") === "false" || /^(Toggle |Show input)/.test(b.getAttribute("aria-label") ?? b.textContent ?? "")) && !b.dataset.tr1bOpened,
    );
    if (!next) return;
    next.dataset.tr1bOpened = "1";
    fireEvent.click(next);
  }
};
const classesIn = (root: Element) => [root, ...root.querySelectorAll("*")].flatMap((el) => (el.getAttribute("class") ?? "").split(/\s+/)).filter(Boolean);
/** A tool tint, a status fill or a success colour (the old cards' frames, pills and bands). */
const TINT = /^(?:[a-z-]+:)*(?:bg|border)-(?:tool-[a-z]+|success|primary|destructive|info|warning|card|secondary)(?:\/\d+)?$/;
const SUCCESS = /^(?:[a-z-]+:)*text-success$/;

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
// Unpaired tool_use → "No result recorded" row
// ---------------------------------------------------------------------------

const UNPAIRED = { type: "tool_use", name: "Bash", input: { command: "pnpm release --dry-run", description: "Dry-run the release" } };

describe("an unpaired tool_use on a legacy path is a ToolRow with 'No result recorded'", () => {
  const routes: [string, () => ReturnType<typeof render>][] = [
    ["a top-level tool_use without a string id (ClaudeContentArrayRenderer)", () => renderContent([UNPAIRED])],
    ["a tool_use nested in a result's content array (ToolExecutionResultRouter → ContentArrayRenderer)", () => renderRouter([{ ...UNPAIRED, id: "toolu_nested_1" }])],
    ["a nested tool_use under a content array object (Task-shaped toolUseResult)", () => renderRouter({ content: [{ type: "text", text: "Spawned." }, { ...UNPAIRED, id: "toolu_nested_2" }] })],
    [
      "a message's legacy toolUse field (ClaudeToolUseDisplay)",
      () =>
        render(
          <Providers>
            <ClaudeToolUseDisplay toolUse={{ id: "toolu_legacy_field", name: "Bash", input: UNPAIRED.input }} />
          </Providers>,
        ),
    ],
  ];

  it.each(routes)("%s", (_label, mount) => {
    const { container } = mount();
    const row = rowWith(container, "pnpm release --dry-run");
    expect(verbOf(row), "the verb is the recorded tool name (D-R5)").toBe("Bash");
    expect(statusText(row)).toBe(t("toolOutcome.noResult"));
    expect(row.getAttribute("data-tool-lifecycle")).toBe("no-result");
    expect(row.getAttribute("data-tool-verdict"), "neutral: no verdict claimed").toBe("unknown");
    // No old card head, success pill or tool-colour fill around the row.
    const wrapper = wrapperOf(row);
    expect(classesIn(wrapper).filter((c) => TINT.test(c) || SUCCESS.test(c))).toEqual([]);
    open(row);
    expect(text(detailOf(row))).toContain("Dry-run the release");
    expect(container.querySelector("[data-testid=app-error]")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #734
// ---------------------------------------------------------------------------

describe("#734: a nested update_plan / TodoWrite with a malformed list member opens as JSON, never the error boundary", () => {
  const CASES = [
    { name: "update_plan", input: { plan: [null] }, json: ['"plan": [', "null"] },
    { name: "TodoWrite", input: { todos: [null] }, json: ['"todos": [', "null"] },
    { name: "update_plan", input: { explanation: "x", plan: [{ step: "ok", status: "completed" }, 7] }, json: ['"plan": [', "7"] },
  ];

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it.each(CASES)("router array route: $name $input", (c) => {
    const { container } = renderRouter([{ type: "tool_use", id: "nested-tool", name: c.name, input: c.input }]);
    openEverything(container);
    expect(container.querySelector("[data-testid=app-error]"), "the app error boundary caught a render error").toBeNull();
    const row = rowWith(container, c.name);
    open(row);
    for (const fragment of c.json) expect(text(detailOf(row))).toContain(fragment);
  });

  it.each(CASES)("the real card route: a Bash result whose content array holds the nested call ($name)", (c) => {
    const toolUse = { type: "tool_use", id: "toolu_outer", name: "Bash", input: { command: "cat plan.json" } };
    const toolResults = [{ type: "tool_result", tool_use_id: "toolu_outer", content: [{ type: "text", text: "plan below" }, { type: "tool_use", id: "nested-tool", name: c.name, input: c.input }] }];
    const { container } = render(
      <Providers>
        <UnifiedToolExecutionRenderer toolUse={toolUse} toolResults={toolResults} />
      </Providers>,
    );
    fireEvent.click(buttonOf(rowWith(container, "cat plan.json")));
    openEverything(container);
    expect(container.querySelector("[data-testid=app-error]"), "the app error boundary caught a render error").toBeNull();
    const nested = rowWith(container, c.name);
    open(nested);
    for (const fragment of c.json) expect(text(detailOf(nested))).toContain(fragment);
  });
});

// ---------------------------------------------------------------------------
// Page-boundary orphan result
// ---------------------------------------------------------------------------

const ORPHAN_ID = "toolu_orphan_000000000000000000";
const orphan = (extra: Record<string, unknown> = {}) => ({ type: "tool_result", tool_use_id: ORPHAN_ID, content: "ok: 3 files changed", ...extra });

describe("page-boundary orphan result: a row whose head says the call is on an earlier page", () => {
  it("older messages not loaded yet: the head says 'Call on an earlier page'; the result is in the Result zone; no verdict invented", () => {
    useAppStore.setState({ pagination: { currentOffset: 100, pageSize: 100, totalCount: 300, hasMore: true, isLoadingMore: false } } as never);
    const { container } = renderContent([orphan()]);
    const row = rowWith(container, t("toolRow.callOnEarlierPage"));
    expect(t("toolRow.callOnEarlierPage")).not.toBe("toolRow.callOnEarlierPage");
    expect(statusText(row), "no status: a completed result without an error signal is quiet").toBe("");
    expect(text(row)).not.toContain(t("toolOutcome.noResult"));
    open(row);
    const result = detailOf(row).querySelector("[data-detail-zone=result]");
    expect(result, "the Result zone").not.toBeNull();
    expect(text(result as Element)).toContain("ok: 3 files changed");
  });

  it("the call is in an earlier loaded message (the older page arrived, the backend paired per page): same head, the call's recorded name as the verb", () => {
    useAppStore.setState({
      messages: [
        { uuid: "a1", type: "assistant", content: [{ type: "tool_use", id: ORPHAN_ID, name: "Bash", input: { command: "git commit" } }] },
        { uuid: "u1", type: "user", content: [orphan()] },
      ],
    } as never);
    const { container } = renderContent([orphan()]);
    const row = rowWith(container, t("toolRow.callOnEarlierPage"));
    expect(verbOf(row)).toBe("Bash");
  });

  it("every message loaded and no call anywhere: the head says 'Call not recorded' instead (no false page claim)", () => {
    const { container } = renderContent([orphan()]);
    const row = rowWith(container, t("toolRow.callNotRecorded"));
    expect(t("toolRow.callNotRecorded")).not.toBe("toolRow.callNotRecorded");
    expect(text(row)).not.toContain(t("toolRow.callOnEarlierPage"));
  });

  it("is_error: the row says Failed once, from the adapter", () => {
    useAppStore.setState({ pagination: { currentOffset: 100, pageSize: 100, totalCount: 300, hasMore: true, isLoadingMore: false } } as never);
    const { container } = renderContent([orphan({ content: "Error: permission denied", is_error: true })]);
    const row = rowWith(container, t("toolRow.callOnEarlierPage"));
    expect(statusText(row)).toBe(t("toolOutcome.failed"));
    expect(row.getAttribute("data-tool-verdict")).toBe("failed");
    open(row);
    expect(text(wrapperOf(row)).split(t("toolOutcome.failed")).length - 1, "the failure is said once").toBe(1);
  });

  it("its streams and recorded exit code come through the adapter (no fake verdict)", () => {
    const { container } = renderContent([orphan({ content: "", toolUseResult: { stdout: "built", stderr: "warn: x", exitCode: 0, interrupted: false } })]);
    const row = firstRow(container);
    open(row);
    const detail = text(detailOf(row));
    expect(detail).toContain("built");
    expect(detail).toContain("warn: x");
    expect(detail).toContain(t("toolOutcome.exitCode", { code: 0 }));
  });

  it("'Copy tool ID' ends the opened detail's meta line", () => {
    const { container } = renderContent([orphan()]);
    const row = firstRow(container);
    open(row);
    const meta = detailOf(row).querySelector(":scope > [data-meta]");
    expect(meta?.lastElementChild?.textContent).toBe(t("toolRow.copyToolId"));
  });

  it("characterization: an image and a tool_reference in the orphan's content stay visible", () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEUlEQVR4nGP4z8DwHwlwMDAAAAD//wMAx1wH+QAAAABJRU5ErkJggg==";
    const { container } = renderContent([
      orphan({ content: [{ type: "text", text: "see image" }, { type: "image", source: { type: "base64", media_type: "image/png", data: png } }, { type: "tool_reference", tool_name: "mcp__fs__read" }] }),
    ]);
    openEverything(container);
    expect(text(container)).toContain("see image");
    expect(container.querySelector(`img[src^="data:image/png;base64,"]`), "the image").not.toBeNull();
    expect(text(container)).toContain("mcp__fs__read");
  });

  it("a nested orphan (a tool_result inside a result's content array) never claims an earlier page", () => {
    useAppStore.setState({ pagination: { currentOffset: 100, pageSize: 100, totalCount: 300, hasMore: true, isLoadingMore: false } } as never);
    const { container } = renderRouter([{ type: "tool_result", tool_use_id: "toolu_inner", content: "inner result" }]);
    const row = rowWith(container, t("toolRow.callNotRecorded"));
    expect(text(row)).not.toContain(t("toolRow.callOnEarlierPage"));
  });

  it("a nested call and its nested result pair into one row", () => {
    const { container } = renderRouter([
      { type: "tool_use", id: "toolu_inner", name: "Grep", input: { pattern: "TODO" } },
      { type: "tool_result", tool_use_id: "toolu_inner", content: "src/a.ts:3: TODO" },
    ]);
    expect(rows(container)).toHaveLength(1);
    const row = rowWith(container, "TODO");
    expect(statusText(row)).not.toBe(t("toolOutcome.noResult"));
    open(row);
    expect(text(detailOf(row))).toContain("src/a.ts:3: TODO");
  });
});

// ---------------------------------------------------------------------------
// server_tool_use / mcp_tool_use: one row per call
// ---------------------------------------------------------------------------

const SEARCH_CALL = { type: "server_tool_use", id: "srvtoolu_01", name: "web_search", input: { query: "Retry-After HTTP-date RFC 9110" } };
const SEARCH_RESULT = {
  type: "web_search_tool_result",
  tool_use_id: "srvtoolu_01",
  content: [
    { type: "web_search_result", url: "https://www.rfc-editor.org/rfc/rfc9110#field.retry-after", title: "RFC 9110: HTTP Semantics - Retry-After", page_age: "2022-06-01" },
    { type: "web_search_result", url: "https://developer.mozilla.org/docs/Web/HTTP/Headers/Retry-After", title: "Retry-After - HTTP | MDN" },
  ],
};
const MCP_CALL = { type: "mcp_tool_use", id: "mcptoolu_01", server_name: "github", tool_name: "create_issue", input: { title: "Flaky preview test", body: "It fails on CI." } };
const MCP_RESULT = { type: "mcp_tool_result", tool_use_id: "mcptoolu_01", is_error: false, content: [{ type: "text", text: "Created issue #812" }] };

describe("server and MCP tool calls are one ToolRow each, their result in the Result zone", () => {
  it("web_search: verb = recorded name, the query as target, quiet; opened: the input and every result", () => {
    const { container } = renderContent([SEARCH_CALL, SEARCH_RESULT]);
    expect(rows(container), "one row for the call and its result").toHaveLength(1);
    const row = rowWith(container, "Retry-After HTTP-date RFC 9110");
    expect(verbOf(row)).toBe("web_search");
    expect(statusText(row)).toBe("");
    open(row);
    const detail = detailOf(row);
    const result = detail.querySelector("[data-detail-zone=result]");
    expect(result, "the Result zone").not.toBeNull();
    expect(text(result as Element)).toContain("RFC 9110: HTTP Semantics - Retry-After");
    expect(text(result as Element)).toContain("developer.mozilla.org");
    expect(classesIn(wrapperOf(row)).filter((c) => SUCCESS.test(c))).toEqual([]);
    expect(detail.querySelector(":scope > [data-meta]")?.lastElementChild?.textContent).toBe(t("toolRow.copyToolId"));
  });

  it("web_search error: 'Failed · <code>' once; no 'error' card title", () => {
    const { container } = renderContent([SEARCH_CALL, { type: "web_search_tool_result", tool_use_id: "srvtoolu_01", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } }]);
    expect(container.querySelector("[data-testid=app-error]")).toBeNull();
    const row = rowWith(container, "Retry-After HTTP-date RFC 9110");
    expect(statusText(row)).toBe(t("toolOutcome.failedErrorCode", { code: "max_uses_exceeded" }));
    open(row);
    // The old card's title ("Search Error", key deleted with it).
    expect(text(wrapperOf(row))).not.toContain("Search Error");
  });

  it("server call with no result block: 'No result recorded'", () => {
    const { container } = renderContent([SEARCH_CALL]);
    expect(statusText(rowWith(container, "Retry-After"))).toBe(t("toolOutcome.noResult"));
  });

  it("mcp_tool_use: verb = recorded tool name, the server as meta, the result text inside", () => {
    const { container } = renderContent([MCP_CALL, MCP_RESULT]);
    expect(rows(container)).toHaveLength(1);
    const row = rowWith(container, "create_issue");
    expect(verbOf(row)).toBe("create_issue");
    expect(text(row)).toContain("github");
    open(row);
    expect(text(detailOf(row))).toContain("Created issue #812");
    expect(text(detailOf(row))).toContain("It fails on CI.");
  });

  it("mcp_tool_use in the Messages API's documented shape (`name`, no `tool_name`): verb = that recorded name", () => {
    const call = { type: "mcp_tool_use", id: MCP_CALL.id, server_name: MCP_CALL.server_name, name: "create_issue", input: MCP_CALL.input };
    const { container } = renderContent([call, MCP_RESULT]);
    expect(rows(container)).toHaveLength(1);
    const row = rows(container)[0];
    expect(verbOf(row)).toBe("create_issue");
    expect(text(row)).toContain("github");
  });

  it("mcp_tool_result is_error: Failed once", () => {
    const { container } = renderContent([MCP_CALL, { ...MCP_RESULT, is_error: true, content: [{ type: "text", text: "rate limited" }] }]);
    const row = rowWith(container, "create_issue");
    expect(statusText(row)).toBe(t("toolOutcome.failed"));
    open(row);
    expect(text(detailOf(row))).toContain("rate limited");
    // The old card's title ("MCP Error", key deleted with it).
    expect(text(wrapperOf(row))).not.toContain("MCP Error");
  });

  it("a server result whose call is not in the message: its own row ('Call not recorded'), the result inside", () => {
    const { container } = renderContent([SEARCH_RESULT]);
    const row = rowWith(container, t("toolRow.callNotRecorded"));
    open(row);
    expect(text(detailOf(row))).toContain("Retry-After - HTTP | MDN");
  });

  it("code_execution: stdout / stderr as output, the return code as the verdict's evidence", () => {
    const { container } = renderContent([
      { type: "server_tool_use", id: "srvtoolu_code", name: "code_execution", input: { code: "print(1/0)" } },
      { type: "code_execution_tool_result", tool_use_id: "srvtoolu_code", content: { type: "code_execution_result", stdout: "", stderr: "ZeroDivisionError: division by zero", return_code: 1 } },
    ]);
    const row = rowWith(container, "print(1/0)");
    expect(statusText(row)).toBe(t("toolOutcome.failedExitCode", { code: 1 }));
    open(row);
    expect(text(detailOf(row))).toContain("ZeroDivisionError: division by zero");
  });
});

// ---------------------------------------------------------------------------
// Characterization: every information item the old renderer showed
// ---------------------------------------------------------------------------

const fmt = formatterFor("en");

interface CharCase {
  label: string;
  name: string;
  input: Record<string, unknown>;
  /** Each item: one string, or alternatives (any one shown is enough). */
  items: (string | string[])[];
}

const CHARACTERIZATION: CharCase[] = [
  { label: "Bash", name: "Bash", input: { command: "pnpm test --run", description: "Run the tests", timeout: 120000, run_in_background: true }, items: ["pnpm test --run", "Run the tests", fmt.duration(120000), ["background", "Background"]] },
  { label: "Read", name: "Read", input: { file_path: `${CWD}/src/a.ts`, offset: 10, limit: 20 }, items: ["a.ts", "10", ["20", "L10–30"]] },
  { label: "Glob", name: "Glob", input: { pattern: "**/*.tsx", path: `${CWD}/src/components` }, items: ["**/*.tsx", "components"] },
  {
    label: "Grep",
    name: "Grep",
    input: { pattern: "TODO\\(tr1b\\)", path: `${CWD}/src`, glob: "*.tsx", type: "rust", "-i": true, "-n": true, "-C": 3, multiline: true, head_limit: 25, output_mode: "content" },
    items: ["TODO\\(tr1b\\)", "*.tsx", "rust", "-i", "-n", ["-C 3", '"-C": 3'], ["--multiline", '"multiline": true'], "25", ["content", "Matching lines"]],
  },
  { label: "WebFetch", name: "WebFetch", input: { url: "https://status.example.com/api", prompt: "Is the API up?" }, items: ["https://status.example.com/api", "Is the API up?"] },
  { label: "WebSearch", name: "WebSearch", input: { query: "Retry-After", allowed_domains: ["rfc-editor.org"], blocked_domains: ["spam.example"] }, items: ["Retry-After", "rfc-editor.org", "spam.example"] },
  {
    label: "MultiEdit",
    name: "MultiEdit",
    input: { file_path: `${CWD}/src/b.ts`, edits: [{ old_string: "alpha()", new_string: "beta()" }, { old_string: "gamma()", new_string: "delta()" }] },
    items: ["b.ts", "alpha()", "beta()", "gamma()", "delta()"],
  },
  { label: "TodoWrite", name: "TodoWrite", input: { todos: [{ content: "Write the red tests", status: "pending", activeForm: "Writing the red tests" }, { content: "Ship TR1b", status: "completed" }] }, items: ["Write the red tests", "Ship TR1b"] },
  {
    label: "NotebookEdit",
    name: "NotebookEdit",
    input: { notebook_path: `${CWD}/notebooks/eda.ipynb`, cell_number: 3, new_source: "df.describe()", cell_type: "code", edit_mode: "replace" },
    items: ["eda.ipynb", "3", "df.describe()", "code", "replace"],
  },
  { label: "TaskCreate", name: "TaskCreate", input: { subject: "Ship TR1b", description: "Migrate the legacy rows", activeForm: "Shipping TR1b" }, items: ["Ship TR1b", "Migrate the legacy rows", "Shipping TR1b"] },
  {
    label: "TaskUpdate",
    name: "TaskUpdate",
    input: { taskId: "7", status: "in_progress", subject: "Review", owner: "jack", addBlocks: ["8"], addBlockedBy: ["6"] },
    items: ["#7", ["In progress", "in_progress"], "Review", "jack", "#8", "#6"],
  },
  { label: "TaskOutput", name: "TaskOutput", input: { task_id: "bash_17", block: true, timeout: 30000 }, items: ["bash_17", "true", ["30000", fmt.duration(30000)]] },
  { label: "Task", name: "Task", input: { description: "Audit the bundle", prompt: "List the five largest modules.", subagent_type: "general-purpose", run_in_background: false }, items: ["Audit the bundle", "List the five largest modules.", "general-purpose", "false"] },
  { label: "apply_patch", name: "apply_patch", input: { patch: "*** Begin Patch\n*** Update File: src/c.ts\n-old line\n+new line\n*** End Patch" }, items: ["src/c.ts", "-old line", "+new line"] },
  { label: "update_plan", name: "update_plan", input: { explanation: "Two steps.", plan: [{ step: "Write tests", status: "completed" }, { step: "Fix", status: "in_progress" }] }, items: ["Two steps.", "Write tests", "Fix"] },
  { label: "Write (ToolUseRenderer's file-creation branch)", name: "Write", input: { file_path: `${CWD}/src/new.ts`, content: "export const created = 1;" }, items: ["new.ts", "export const created = 1;"] },
  { label: "Edit (ToolUseRenderer's edit branch)", name: "Edit", input: { file_path: `${CWD}/src/d.ts`, old_string: "foo()", new_string: "bar()" }, items: ["d.ts", "foo()", "bar()"] },
  { label: "an unknown name (Default branch)", name: "SomeUnknownTool", input: { alpha: "beta", count: 3 }, items: ["SomeUnknownTool", "alpha", "beta", "count"] },
  { label: "an MCP name (MCPToolUseRenderer via ToolUseRenderer)", name: "mcp__github__create_issue", input: { title: "Flaky preview" }, items: ["github", "create_issue", "Flaky preview"] },
  { label: "shape sniffing L1 (file_path + content under another name)", name: "save_file", input: { file_path: `${CWD}/src/e.ts`, content: "saved body" }, items: ["e.ts", "saved body"] },
  { label: "shape sniffing L3 (description + prompt under another name)", name: "delegate", input: { description: "Delegated task", prompt: "Do the thing." }, items: ["Delegated task", "Do the thing."] },
];

const shown = (haystack: string, item: string | string[]) => (Array.isArray(item) ? item : [item]).some((alt) => haystack.toLowerCase().includes(alt.toLowerCase()));

describe("characterization (amendment 9): every item the old legacy renderer showed is still shown, all opened", () => {
  describe.each([
    ["nested in a result's content array", (c: CharCase) => renderRouter([{ type: "tool_use", id: `toolu_char_${c.name}`, name: c.name, input: c.input }])],
    ["a top-level tool_use without an id", (c: CharCase) => renderContent([{ type: "tool_use", name: c.name, input: c.input }])],
  ] as const)("%s", (_route, mount) => {
    it.each(CHARACTERIZATION)("$label", (c) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { container } = mount(c);
      openEverything(container);
      expect(container.querySelector("[data-testid=app-error]")).toBeNull();
      const all = text(container);
      const missing = c.items.filter((item) => !shown(all, item));
      expect(missing, all.slice(0, 2000)).toEqual([]);
    });
  });

  it("server_tool_use: its name, query and every input value; MCP: server, tool and input values", () => {
    const { container } = renderContent([{ ...SEARCH_CALL, input: { query: "Retry-After", max_uses: 3 } }, { ...MCP_CALL }]);
    openEverything(container);
    const all = text(container);
    for (const item of ["Retry-After", "max_uses", "3", "github", "create_issue", "Flaky preview test", "It fails on CI."]) expect(all).toContain(item);
  });

  it("web_search_tool_result: each title, URL and page age", () => {
    const { container } = renderContent([SEARCH_CALL, SEARCH_RESULT]);
    openEverything(container);
    const all = text(container);
    for (const item of ["RFC 9110: HTTP Semantics - Retry-After", "https://www.rfc-editor.org/rfc/rfc9110#field.retry-after", "2022-06-01", "Retry-After - HTTP | MDN"]) expect(all).toContain(item);
  });
});

// ---------------------------------------------------------------------------
// Search: every counted hit marked; auto-open as an effect keyed on the query
// ---------------------------------------------------------------------------

const marks = (root: Element) => [...root.querySelectorAll("mark")].map((m) => text(m).toLowerCase());

describe("search keeps acting on the new rows", () => {
  it("orphan, searching by tool id: the row opens and the id is marked in the detail", () => {
    const { container } = renderContent([orphan()], { searchQuery: "orphan_0000", filterType: "toolId" });
    const row = firstRow(container);
    expect(buttonOf(row).getAttribute("aria-expanded")).toBe("true");
    expect(marks(detailOf(row)).join("")).toContain("orphan_0000");
  });

  it("orphan, content search: a hit in the result text opens the row and is marked", () => {
    const { container } = renderContent([orphan()], { searchQuery: "files changed" });
    const row = firstRow(container);
    expect(buttonOf(row).getAttribute("aria-expanded")).toBe("true");
    expect(marks(detailOf(row))).toContain("files changed");
  });

  it("orphan transition matrix: match → open; collapse while matching stays; a new matching query opens; clear keeps the user's state", () => {
    const view = renderContent([orphan()], { searchQuery: "files" });
    const row = () => firstRow(view.container);
    expect(buttonOf(row()).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(buttonOf(row()));
    expect(buttonOf(row()).getAttribute("aria-expanded")).toBe("false");
    view.rerenderWith({ searchQuery: "files" });
    expect(buttonOf(row()).getAttribute("aria-expanded"), "same query: stays collapsed").toBe("false");
    view.rerenderWith({ searchQuery: "changed" });
    expect(buttonOf(row()).getAttribute("aria-expanded"), "a different matching query opens it again").toBe("true");
    view.rerenderWith({ searchQuery: "" });
    expect(marks(view.container)).toEqual([]);
  });

  it("id-less tool_use (Default route): an input hit opens the row and is marked", () => {
    const { container } = renderContent([{ type: "tool_use", name: "SomeUnknownTool", input: { alpha: "needle-value" } }], { searchQuery: "needle" });
    const row = firstRow(container);
    expect(buttonOf(row).getAttribute("aria-expanded")).toBe("true");
    expect(marks(wrapperOf(row)).some((m) => m.includes("needle"))).toBe(true);
  });

  it("server call: a hit in the input opens the row and is marked", () => {
    const { container } = renderContent([SEARCH_CALL, SEARCH_RESULT], { searchQuery: "HTTP-date" });
    const row = firstRow(container);
    expect(buttonOf(row).getAttribute("aria-expanded")).toBe("true");
    expect(marks(wrapperOf(row))).toContain("http-date");
  });

  it("server call: a hit in a result title (counted by the search index) opens the row and is marked", () => {
    const { container } = renderContent([SEARCH_CALL, SEARCH_RESULT], { searchQuery: "MDN" });
    const row = firstRow(container);
    expect(buttonOf(row).getAttribute("aria-expanded")).toBe("true");
    expect(marks(wrapperOf(row))).toContain("mdn");
  });

  it("MCP call: hits in the server name, tool name and the result text are marked", () => {
    for (const query of ["github", "create_issue", "issue #812"]) {
      useExpandRegistry.getState().clearAll();
      const { container, unmount } = renderContent([MCP_CALL, MCP_RESULT], { searchQuery: query });
      const row = firstRow(container);
      expect(buttonOf(row).getAttribute("aria-expanded"), query).toBe("true");
      expect(marks(wrapperOf(row)), query).toContain(query.toLowerCase());
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Expand state per rendered instance; disclosure aria (amendment 14)
// ---------------------------------------------------------------------------

describe("expand state is per rendered instance", () => {
  it("two id-less tool_uses in one message: opening one leaves the other closed", () => {
    const { container } = renderContent([
      { type: "tool_use", name: "Bash", input: { command: "echo one" } },
      { type: "tool_use", name: "Bash", input: { command: "echo two" } },
    ]);
    open(rowWith(container, "echo one"));
    expect(buttonOf(rowWith(container, "echo two")).getAttribute("aria-expanded")).toBe("false");
  });

  it("two nested tool_uses in one result array: opening one leaves the other closed", () => {
    // Outside a paired card (no ambient default-open): the router at the top level.
    const { container } = renderRouter([
      { type: "tool_use", name: "Bash", input: { command: "echo one" } },
      { type: "tool_use", name: "Bash", input: { command: "echo two" } },
    ]);
    const one = buttonOf(rowWith(container, "echo one"));
    const two = buttonOf(rowWith(container, "echo two"));
    const before = two.getAttribute("aria-expanded");
    fireEvent.click(one);
    expect(two.getAttribute("aria-expanded")).toBe(before);
    expect(one.getAttribute("aria-expanded")).not.toBe(before);
  });

  it("two orphans in one message: opening one leaves the other closed", () => {
    const { container } = renderContent([orphan(), { ...orphan(), tool_use_id: "toolu_orphan_2", content: "second" }]);
    expect(rows(container), "two orphan rows").toHaveLength(2);
    const [a, b] = rows(container) as [HTMLElement, HTMLElement];
    open(a);
    expect(buttonOf(b).getAttribute("aria-expanded")).toBe("false");
  });
});

describe("every disclosure toggle in the new rows has aria-expanded + aria-controls to a real element (amendment 14)", () => {
  it.each([
    ["unpaired", () => renderContent([UNPAIRED])],
    ["orphan", () => renderContent([orphan({ content: Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n") })])],
    ["server", () => renderContent([SEARCH_CALL, SEARCH_RESULT])],
    ["mcp", () => renderContent([MCP_CALL, MCP_RESULT])],
    ["nested", () => renderRouter([{ ...UNPAIRED, id: "toolu_n" }])],
  ])("%s", (_label, mount) => {
    const { container } = mount();
    openEverything(container);
    const toggles = [...container.querySelectorAll<HTMLElement>("button[aria-expanded]")];
    expect(toggles.length).toBeGreaterThan(0);
    for (const toggle of toggles) {
      const ids = (toggle.getAttribute("aria-controls") ?? "").split(/\s+/).filter(Boolean);
      expect(ids.length, toggle.outerHTML.slice(0, 200)).toBeGreaterThan(0);
      for (const id of ids) expect(document.getElementById(id), `aria-controls → #${id}`).not.toBeNull();
    }
    // The old folds without aria ("Show input") are gone.
    const unlabelled = [...container.querySelectorAll<HTMLElement>("button")].filter((b) => /Show input/.test(b.textContent ?? "") && !b.hasAttribute("aria-expanded"));
    expect(unlabelled).toEqual([]);
  });
});

