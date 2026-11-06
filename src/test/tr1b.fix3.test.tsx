/**
 * TR1b CodeRabbit round (PR #746): 4378493992 and 4378494005, each as a class.
 *
 * 4378493992 — `skipToolResults` on a message's content array (set by
 * ClaudeMessageNode when the message's `toolUseResult` is drawn by the result
 * router below the content) hid a paired call's results and an orphan
 * `tool_result`, but a server / API result whose call is not in the message
 * (`web_search_tool_result`, `mcp_tool_result` …) still rendered as its own
 * row. The rule here: every branch that renders a result block honours
 * `skipToolResults` the same way — a paired call keeps its row without the
 * results, an orphan result (tool_result or any server result type) is not
 * drawn. `skipToolResults` false is the control: every result is shown. The
 * caller-level cases are the messages that reach the app (Claude's own
 * shapes): their results stay visible.
 *
 * 4378494005 — a counted search hit in a text-editor result's file content
 * opened the content fold, but the fold showed the first 500 characters only,
 * so a hit past them was counted and never marked. The rule, as a class:
 * when search opens a body for a hit, the opened body shows that hit marked.
 * The text-editor preview shows the whole content when it holds the hit; a
 * one-line body value (a result title, a URL, a file path) that the ellipsis
 * cuts wraps instead when it holds the hit (real-browser geometry:
 * scripts/ui-capture/test/legacyRows.test.mjs, "CR-4378494005").
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import i18n from "@/i18n";
import { ThemeProvider } from "@/contexts/theme";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { useAppStore } from "@/store/useAppStore";
import { ClaudeContentArrayRenderer } from "@/components/contentRenderer/ClaudeContentArrayRenderer";
import { ToolExecutionResultRouter } from "@/components/messageRenderer/ToolExecutionResultRouter";
import { ClaudeMessageNode } from "@/components/MessageViewer/components/ClaudeMessageNode";
import { SERVER_RESULT_TYPES } from "@/components/contentRenderer/contentEntries";
import type { ClaudeMessage } from "@/types";

const CWD = "/Users/dev/work/kiln";
const WJ = /\u2060/g;

const Providers = ({ children, scope = "msg-tr1b-fix3" }: { children: ReactNode; scope?: string }) => (
  <ThemeProvider>
    <ExpandKeyProvider value={scope}>{children}</ExpandKeyProvider>
  </ThemeProvider>
);

interface ContentProps {
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
  skipToolResults?: boolean;
  skipToolCalls?: boolean;
}

const renderContent = (content: unknown[], props: ContentProps = {}) =>
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
/** Open everything a user can open: row disclosures, show-all toggles, inner folds. */
const openEverything = (root: HTMLElement) => {
  for (let guard = 0; guard < 80; guard += 1) {
    const next = [...root.querySelectorAll<HTMLElement>("button[aria-expanded=false]")].find((b) => !b.dataset.fix3Opened);
    if (!next) return;
    next.dataset.fix3Opened = "1";
    fireEvent.click(next);
  }
};
/** What a user can see: the subtree without anything inside a `hidden` element. */
const visibleText = (root: HTMLElement) => {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[hidden]").forEach((el) => el.remove());
  return text(clone);
};
/** The marks outside any `hidden` element, lower-cased. */
const visibleMarks = (root: HTMLElement) =>
  [...root.querySelectorAll("mark")].filter((m) => !m.closest("[hidden]")).map((m) => text(m).toLowerCase());

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
// 4378493992: every result branch honours skipToolResults
// ---------------------------------------------------------------------------

/** One server result per type the renderer routes (`SERVER_RESULT_TYPES`), each with a distinct body text. */
const SERVER_RESULTS: { type: string; needle: string; block: (id: string) => Record<string, unknown> }[] = [
  {
    type: "web_search_tool_result",
    needle: "ZephyrSkipSearchTitle",
    block: (id) => ({ type: "web_search_tool_result", tool_use_id: id, content: [{ type: "web_search_result", title: "ZephyrSkipSearchTitle", url: "https://example.test/skip" }] }),
  },
  {
    type: "web_fetch_tool_result",
    needle: "ZephyrSkipFetchTitle",
    block: (id) => ({ type: "web_fetch_tool_result", tool_use_id: id, content: { type: "web_fetch_result", url: "https://example.test/fetch", content: { type: "document", title: "ZephyrSkipFetchTitle", source: { type: "text", media_type: "text/plain", data: "body" } } } }),
  },
  {
    type: "code_execution_tool_result",
    needle: "ZephyrSkipCodeOut",
    block: (id) => ({ type: "code_execution_tool_result", tool_use_id: id, content: { type: "code_execution_result", stdout: "ZephyrSkipCodeOut", stderr: "", return_code: 0 } }),
  },
  {
    type: "bash_code_execution_tool_result",
    needle: "ZephyrSkipBashOut",
    block: (id) => ({ type: "bash_code_execution_tool_result", tool_use_id: id, content: { type: "bash_code_execution_result", stdout: "ZephyrSkipBashOut", stderr: "", return_code: 0 } }),
  },
  {
    type: "text_editor_code_execution_tool_result",
    needle: "zephyr-skip-editor.py",
    block: (id) => ({ type: "text_editor_code_execution_tool_result", tool_use_id: id, content: { type: "text_editor_code_execution_result", operation: "view", path: "/tmp/zephyr-skip-editor.py", content: "print(1)" } }),
  },
  {
    type: "tool_search_tool_result",
    needle: "ZephyrSkipToolName",
    block: (id) => ({ type: "tool_search_tool_result", tool_use_id: id, content: [{ tool_name: "ZephyrSkipToolName", description: "a tool" }] }),
  },
  {
    type: "advisor_tool_result",
    needle: "ZephyrSkipAdvice",
    block: (id) => ({ type: "advisor_tool_result", tool_use_id: id, content: { type: "advisor_result", text: "ZephyrSkipAdvice: keep the change small." } }),
  },
  {
    type: "mcp_tool_result",
    needle: "ZephyrSkipMcpText",
    block: (id) => ({ type: "mcp_tool_result", tool_use_id: id, is_error: false, content: [{ type: "text", text: "ZephyrSkipMcpText" }] }),
  },
];

/** The two flags a result branch reads, and what each must show. */
const SKIP = [
  { label: "skipToolResults: true", skipToolResults: true, shown: false },
  { label: "skipToolResults: false (control)", skipToolResults: false, shown: true },
] as const;

const ORPHAN_CASES = [
  ...SERVER_RESULTS.map((r) => ({ label: `orphan ${r.type}`, needle: r.needle, content: [r.block(`missing_${r.type}`)] })),
  { label: "orphan tool_result", needle: "ZephyrSkipToolResult", content: [{ type: "tool_result", tool_use_id: "missing_tool_call", content: "ZephyrSkipToolResult: 3 files" }] },
];

const PAIRED_CASES = [
  ...SERVER_RESULTS.filter((r) => r.type !== "mcp_tool_result").map((r) => ({
    label: `server_tool_use + ${r.type}`,
    needle: r.needle,
    call: "ZephyrSkipServerCall",
    content: [{ type: "server_tool_use", id: `srv_${r.type}`, name: r.type.replace(/_tool_result$/, ""), input: { query: "ZephyrSkipServerCall" } }, r.block(`srv_${r.type}`)],
  })),
  {
    label: "mcp_tool_use + mcp_tool_result",
    needle: "ZephyrSkipMcpText",
    call: "ZephyrSkipMcpCall",
    content: [{ type: "mcp_tool_use", id: "mcp_paired", server_name: "kiln", name: "deploy", tool_name: "deploy", input: { description: "ZephyrSkipMcpCall" } }, SERVER_RESULTS[SERVER_RESULTS.length - 1]!.block("mcp_paired")],
  },
  {
    label: "tool_use + tool_result",
    needle: "ZephyrSkipPairedResult",
    call: "ZephyrSkipPairedCall",
    content: [
      { type: "tool_use", id: "toolu_paired", name: "Bash", input: { command: "echo ZephyrSkipPairedCall" } },
      { type: "tool_result", tool_use_id: "toolu_paired", content: "ZephyrSkipPairedResult" },
    ],
  },
];

describe("4378493992: every server result type is a result branch", () => {
  it("SERVER_RESULT_TYPES is exactly the set this matrix covers", () => {
    expect([...SERVER_RESULT_TYPES].sort()).toEqual(SERVER_RESULTS.map((r) => r.type).sort());
  });
});

describe("4378493992: an orphan result (tool_result or any server result) honours skipToolResults", () => {
  describe.each(SKIP)("$label", ({ skipToolResults, shown }) => {
    it.each(ORPHAN_CASES)("$label", ({ content, needle }) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { container } = renderContent(content, { skipToolResults });
      openEverything(container);
      if (shown) {
        expect(rows(container).length, "the orphan is its own row").toBe(1);
        expect(visibleText(container), "the result body is shown").toContain(needle);
      } else {
        expect(rows(container).length, `no row is drawn for a result the message skips: ${visibleText(container).slice(0, 200)}`).toBe(0);
        expect(visibleText(container), "the result body is not shown").not.toContain(needle);
      }
    });
  });

  it("skipToolCalls hides every orphan result too (an orphan's row is its call's row)", () => {
    for (const { content, needle } of ORPHAN_CASES) {
      const { container, unmount } = renderContent(content, { skipToolCalls: true });
      expect(rows(container).length, needle).toBe(0);
      unmount();
    }
  });
});

describe("4378493992: a paired call keeps its row; its results honour skipToolResults", () => {
  describe.each(SKIP)("$label", ({ skipToolResults, shown }) => {
    it.each(PAIRED_CASES)("$label", ({ content, needle, call }) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { container } = renderContent(content, { skipToolResults });
      expect(rows(container).length, "the call is one row").toBeGreaterThanOrEqual(1);
      openEverything(container);
      const shownText = visibleText(container);
      expect(shownText, "the call itself is always shown").toContain(call);
      if (shown) expect(shownText, "the result is shown").toContain(needle);
      else expect(shownText, "the skipped result is not shown").not.toContain(needle);
    });
  });
});

/** A message as the app passes it to ClaudeMessageNode. */
function message(type: "user" | "assistant", content: unknown[], extra: Partial<ClaudeMessage> = {}): ClaudeMessage {
  return {
    uuid: `fix3-${type}-${Math.abs(JSON.stringify(content).length)}`,
    parentUuid: null,
    sessionId: "fix3",
    timestamp: "2026-10-27T01:00:00.000Z",
    type,
    content,
    ...(type === "assistant" ? { model: "claude-opus-4" } : {}),
    ...extra,
  } as unknown as ClaudeMessage;
}

const renderNode = (msg: ClaudeMessage) =>
  render(
    <Providers scope={msg.uuid}>
      <ClaudeMessageNode message={msg} depth={0} />
    </Providers>,
  );

describe("4378493992: the caller (ClaudeMessageNode) sets skipToolResults only when the message's toolUseResult is drawn below; every shape the app receives keeps its results", () => {
  it("Claude's server results (an assistant message, no toolUseResult): the paired advisor result and an orphan web_search result are shown", () => {
    const { container } = renderNode(
      message("assistant", [
        { type: "server_tool_use", id: "srv_advisor", name: "advisor", input: {} },
        SERVER_RESULTS[6]!.block("srv_advisor"),
        SERVER_RESULTS[0]!.block("missing_search_call"),
      ]),
    );
    openEverything(container);
    expect(visibleText(container)).toContain("ZephyrSkipAdvice");
    expect(visibleText(container)).toContain("ZephyrSkipSearchTitle");
  });

  it("a tool result with an inline tool_result and a toolUseResult (Claude, ForgeCode, CodeBuddy): the result is shown", () => {
    const { container } = renderNode(
      message("user", [{ type: "tool_result", tool_use_id: "toolu_elsewhere", content: "ZephyrInlineResult: 2 files" }], { toolUseResult: { stdout: "ZephyrInlineResult: 2 files", stderr: "" } } as never),
    );
    openEverything(container);
    expect(visibleText(container)).toContain("ZephyrInlineResult");
  });

  it("the remainder of a merged tool result (toolUseResult kept, its tool_result moved to the call): the router draws the toolUseResult and the remaining text stays", () => {
    const { container } = renderNode(message("user", [{ type: "text", text: "ZephyrRemainderText" }], { toolUseResult: { stdout: "ZephyrLegacyStdout", stderr: "" } } as never));
    openEverything(container);
    expect(visibleText(container)).toContain("ZephyrRemainderText");
    expect(visibleText(container)).toContain("ZephyrLegacyStdout");
  });
});

// ---------------------------------------------------------------------------
// 4378494005: a body that search opens shows the hit, marked
// ---------------------------------------------------------------------------

/** A file of numbered lines, `length` characters or more, with `needles` placed at the given character offsets. */
function fileWith(needles: [number, string][], length = 1400): string {
  const lines: string[] = [];
  let size = 0;
  for (let n = 1; size < length; n += 1) {
    const line = `line ${String(n).padStart(3, "0")}: value = ${n * 7}`;
    lines.push(line);
    size += line.length + 1;
  }
  let body = lines.join("\n");
  for (const [at, needle] of [...needles].sort((a, b) => b[0] - a[0])) body = `${body.slice(0, at)}${needle}${body.slice(at)}`;
  return body;
}

const DEEP = "ZephyrDeepEditorHit";
const EDITOR_PATH = "/srv/kiln/config/zephyr-settings.toml";

const editorBlock = (id: string, content: string) => ({
  type: "text_editor_code_execution_tool_result",
  tool_use_id: id,
  content: { type: "text_editor_code_execution_result", operation: "view", path: EDITOR_PATH, content },
});

const EDITOR_ROUTES = [
  ["orphan, a message's own content (ClaudeContentArrayRenderer)", (block: Record<string, unknown>, q?: string) => renderContent([block], { searchQuery: q, isCurrentMatch: true, currentMatchIndex: 0 })],
  ["orphan, nested in a result's content array (ContentArrayRenderer)", (block: Record<string, unknown>, q?: string) => renderRouter([block], q)],
  [
    "paired with its server_tool_use call",
    (block: Record<string, unknown>, q?: string) =>
      renderContent([{ type: "server_tool_use", id: block.tool_use_id, name: "text_editor_code_execution", input: { command: "view", path: EDITOR_PATH } }, block], {
        searchQuery: q,
        isCurrentMatch: true,
        currentMatchIndex: 0,
      }),
  ],
] as const;

/** The "Show content" fold of the text-editor body. */
const contentFold = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>("button[aria-expanded]")].find((b) => text(b) === t("textEditorCodeExecutionToolResultRenderer.showContent")) ?? null;

const HIT_PLACES: { label: string; needles: [number, string][] }[] = [
  { label: "one hit past the 500-character preview", needles: [[820, DEEP]] },
  { label: "one hit near the end of the file", needles: [[1380, DEEP]] },
  { label: "two hits, one inside the preview and one past it", needles: [[120, DEEP], [1100, DEEP]] },
  { label: "a hit straddling the 500-character boundary", needles: [[492, DEEP]] },
];

describe("4378494005: a text-editor result opened by a content hit shows every hit, marked", () => {
  describe.each(EDITOR_ROUTES)("%s", (_route, mount) => {
    it.each(HIT_PLACES)("$label", ({ needles }) => {
      const file = fileWith(needles);
      const { container } = mount(editorBlock(`editor_${needles.length}_${needles[0]![0]}`, file), DEEP);
      const row = rows(container)[0] as HTMLElement;
      expect(buttonOf(row).getAttribute("aria-expanded"), "the hit opened the row").toBe("true");
      const fold = contentFold(wrapperOf(row));
      expect(fold?.getAttribute("aria-expanded"), "the content hit opened the content fold").toBe("true");
      const marks = visibleMarks(wrapperOf(row)).filter((m) => m === DEEP.toLowerCase());
      expect(marks.length, `every hit in the file is marked: ${visibleText(wrapperOf(row)).slice(-300)}`).toBe(needles.length);
    });
  });

  it("control: without a query the fold stays closed, then OutputBlock caps lines with a lossless show-all disclosure", () => {
    const file = fileWith([[820, DEEP]]);
    const { container } = renderContent([editorBlock("editor_plain", file)]);
    const row = rows(container)[0] as HTMLElement;
    fireEvent.click(buttonOf(row));
    const fold = contentFold(wrapperOf(row))!;
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(fold);
    const output = wrapperOf(row).querySelector<HTMLElement>("[data-output]")!;
    expect(output.querySelector("[data-output-text]")?.textContent).toBe(file.split("\n").slice(0, 15).join("\n"));
    expect(visibleText(output)).not.toContain(DEEP);
    const all = output.querySelector<HTMLElement>("button[aria-expanded]")!;
    expect(all.getAttribute("aria-controls")).toBeTruthy();
    fireEvent.click(all);
    expect(all.getAttribute("aria-expanded")).toBe("true");
    expect(output.querySelector("[data-output-text]")?.textContent).toBe(file);
  });

  it("control: a query that hits only the path opens the row, marks the path, and leaves the content fold closed", () => {
    const { container } = renderContent([editorBlock("editor_path", fileWith([[820, DEEP]]))], { searchQuery: "zephyr-settings" });
    const row = rows(container)[0] as HTMLElement;
    expect(buttonOf(row).getAttribute("aria-expanded")).toBe("true");
    expect(contentFold(wrapperOf(row))?.getAttribute("aria-expanded")).toBe("false");
    expect(visibleMarks(wrapperOf(row))).toContain("zephyr-settings");
  });
});

/**
 * Every one-line body value of a server result that search counts and marks:
 * its mark must not sit inside an ellipsis cut (`truncate`), which hides the
 * part of the line past the box. The real-browser geometry is in
 * legacyRows.test.mjs; here the structure.
 */
const LONG = "a-very-long-segment-that-keeps-going".repeat(6);
const ONE_LINE_HITS: { label: string; needle: string; block: Record<string, unknown> }[] = [
  {
    label: "web_search result title",
    needle: "ZephyrTitleTail",
    block: { type: "web_search_tool_result", tool_use_id: "line_title", content: [{ type: "web_search_result", title: `A result title ${LONG.replace(/-/g, " ")} ZephyrTitleTail`, url: "https://example.test/t" }] },
  },
  {
    label: "web_search result URL",
    needle: "ZephyrUrlTail",
    block: { type: "web_search_tool_result", tool_use_id: "line_url", content: [{ type: "web_search_result", title: "Title", url: `https://docs.example.test/${LONG}/ZephyrUrlTail` }] },
  },
  {
    label: "web_fetch URL",
    needle: "ZephyrFetchTail",
    block: { type: "web_fetch_tool_result", tool_use_id: "line_fetch", content: { type: "web_fetch_result", url: `https://docs.example.test/${LONG}/ZephyrFetchTail`, content: { type: "document", title: "Doc", source: { type: "text", media_type: "text/plain", data: "body" } } } },
  },
  {
    label: "text_editor path",
    needle: "ZephyrPathTail",
    block: { type: "text_editor_code_execution_tool_result", tool_use_id: "line_path", content: { type: "text_editor_code_execution_result", operation: "view", path: `/srv/${LONG}/ZephyrPathTail.toml`, content: "x = 1" } },
  },
];

describe("4378494005: a one-line body value holding the hit is not cut by an ellipsis", () => {
  it.each(ONE_LINE_HITS)("$label", ({ needle, block }) => {
    const { container } = renderContent([block], { searchQuery: needle, isCurrentMatch: true, currentMatchIndex: 0 });
    const row = rows(container)[0] as HTMLElement;
    expect(buttonOf(row).getAttribute("aria-expanded")).toBe("true");
    const mark = [...wrapperOf(row).querySelectorAll("[data-tool-detail] mark")].find((m) => text(m).toLowerCase() === needle.toLowerCase());
    expect(mark, "the hit is marked in the opened detail").toBeTruthy();
    expect(mark!.closest(".truncate"), `the marked line is not an ellipsis cut: ${mark!.closest(".truncate")?.className}`).toBeNull();
  });

  it.each(ONE_LINE_HITS.filter(({ label }) => label !== "text_editor path"))("control: without a hit, the $label stays one line with an ellipsis", ({ block }) => {
    const { container } = renderContent([block], { searchQuery: "" });
    const row = rows(container)[0] as HTMLElement;
    fireEvent.click(buttonOf(row));
    expect(wrapperOf(row).querySelectorAll("[data-tool-detail] .truncate").length).toBeGreaterThan(0);
  });
  it("control: invented legacy editor path stays exact recorded JSON, not an SDK path field", () => {
    // SDK cb5fba4198 messages.ts:7085-7192 has no result.path/operation.
    // Keep the hit/mark assertions above; migrate only the obsolete ellipsis contract.
    const { block } = ONE_LINE_HITS.find(({ label }) => label === "text_editor path")!;
    const { container } = renderContent([block], { searchQuery: "" });
    const row = rows(container)[0] as HTMLElement;
    fireEvent.click(buttonOf(row));
    const record = [...wrapperOf(row).querySelectorAll("[data-output-text]")].map(e => e.textContent).find(value => value?.includes('"path"'));
    const metadata = Object.fromEntries(Object.entries(block.content as Record<string, unknown>).filter(([key]) => key !== "content"));
    expect(JSON.parse(record!)).toEqual(metadata);
    expect(wrapperOf(row).querySelectorAll("[data-tool-detail] .truncate")).toHaveLength(0);
  });
});
