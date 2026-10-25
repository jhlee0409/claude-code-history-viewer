/**
 * Owner-approved signals #12 and #14 (signal audit, owner decision 2026-10-25).
 *
 * #12 — an opened row's detail ends with a 1px hairline in the neutral faint
 * line token (`--line-faint`), with 8px inside it and 8px after it, so the
 * reader sees where one opened call ends and the next row begins. Opened
 * rows only: a closed row has no line and no extra space (collapsed rows stay
 * pixel-identical). Not a frame: only the bottom edge. Where two opened rows
 * meet there is one line between them, never two.
 *
 * #14 — the row icon carries the tool kind in the user's language as its
 * accessible name and native tooltip (Bash → "Terminal" / "터미널", Read →
 * "File read" …), from one shared kind map keyed by the recorded tool name
 * (provider aliases included: `shell` is Bash). The recorded name stays the
 * visible verb (D-R5). Unknown and MCP names get the generic kind ("Tool" /
 * "도구"), never one guessed from a substring. The icon is not a new tab
 * stop, and the row button's accessible name is unchanged except for the
 * icon's own label in front: kind + verb + target.
 *
 * The real-browser side (computed hairline colour = the faint token, one line
 * between two opened rows, the icon outside the Tab order) is
 * scripts/ui-capture/test/ioSignals.test.mjs.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, within } from "@testing-library/react";
import i18n from "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { useAppStore } from "@/store/useAppStore";
import { UnifiedToolExecutionRenderer } from "@/components/contentRenderer/UnifiedToolExecutionRenderer";
import { CodeTarget, ToolRow } from "@/components/transcript/ToolRow";
import { toolFamily, toolOutcome } from "@/components/transcript/toolOutcome";

const CWD = "/Users/dev/work/kiln";
const WJ = /\u2060/g;

type Results = Record<string, unknown>[];

let seq = 0;
const nextId = () => `toolu_sig_${++seq}`;

function renderTool(name: string, input: unknown, results: Results = []) {
  const id = nextId();
  const toolUse = { type: "tool_use", id, name, input };
  const toolResults = results.map((r) => ({ type: "tool_result", tool_use_id: id, ...r }));
  return render(
    <ExpandKeyProvider value="msg-sig">
      <UnifiedToolExecutionRenderer toolUse={toolUse} toolResults={toolResults} />
    </ExpandKeyProvider>,
  );
}

const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(WJ, "");
const classesOf = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
const disclosure = (root: HTMLElement) => {
  const button = root.querySelector<HTMLElement>("[data-tool-row] button[aria-expanded]");
  expect(button, "the row's disclosure button").not.toBeNull();
  return button!;
};
const open = (root: HTMLElement) => {
  const button = disclosure(root);
  if (button.getAttribute("aria-expanded") !== "true") fireEvent.click(button);
  const detail = root.querySelector<HTMLElement>("[data-tool-detail]:not([hidden])");
  expect(detail, "the opened row detail").not.toBeNull();
  return detail!;
};

/** The accessible name testing-library computes for `el` (accname 1.2). */
function accessibleName(scope: HTMLElement, role: string, el: HTMLElement): string {
  let name: string | null = null;
  within(scope).getAllByRole(role, {
    name: (computed, candidate) => {
      if (candidate === el) name = computed;
      return candidate === el;
    },
  });
  expect(name, `the ${role}'s accessible name`).not.toBeNull();
  return (name as unknown as string).replace(WJ, "").replace(/\s+/g, " ").trim();
}

/** Elements a keyboard user reaches with Tab, in DOM order (jsdom: no layout, so by element kind + tabindex). */
const tabStops = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, summary, [tabindex], [contenteditable='true']")].filter(
    (el) => !el.closest("[hidden]") && !(el as HTMLButtonElement).disabled && el.getAttribute("tabindex") !== "-1",
  );

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
// #12 — the hairline after an opened detail
// ---------------------------------------------------------------------------

const HAIRLINE = ["border-b", "border-line-faint", "pb-2", "mb-2"];

describe("#12 the hairline that ends an opened row's detail", () => {
  it("opened: the detail ends with a 1px faint line (border-b + --line-faint), 8px inside and 8px after, after the meta line", () => {
    const { container } = renderTool("Bash", { command: "pnpm build", description: "Build the app" }, [
      { content: "build ok", toolUseResult: { stdout: "build ok", stderr: "", exitCode: 0 } },
    ]);
    const detail = open(container);
    const classes = classesOf(detail);
    for (const cls of HAIRLINE) expect(classes, `the opened detail carries ${cls}`).toContain(cls);
    expect(classes.some((c) => /^border-(t|l|r|x|y)?$/.test(c) && c !== "border-b"), "only the bottom edge: not a frame").toBe(false);
    expect(classes.some((c) => /^(rounded|bg-|shadow)/.test(c)), "no box, fill or shadow").toBe(false);
    expect(classes.some((c) => /^border-(line|line-input|status-danger-line)$/.test(c)), "the faint token, not the zone or stderr line").toBe(false);
    const meta = detail.querySelector(":scope > [data-meta]");
    expect(meta, "the meta line").not.toBeNull();
    expect(detail.lastElementChild, "the line (the detail's bottom edge) comes right after the meta line").toBe(meta);
  });

  it("closed: no line and no extra space (the collapsed row is unchanged)", () => {
    const { container } = renderTool("Bash", { command: "pnpm build" }, [{ content: "ok" }]);
    const button = disclosure(container);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const detail = container.querySelector<HTMLElement>("[data-tool-detail]")!;
    expect(detail.hidden, "the closed detail is hidden").toBe(true);
    for (const cls of HAIRLINE) expect(classesOf(detail), `the closed detail has no ${cls}`).not.toContain(cls);
    const wrapper = container.querySelector<HTMLElement>("[data-tool-row-wrapper]")!;
    expect(classesOf(wrapper), "the row wrapper carries no line").toEqual(["mt-1"]);
  });

  it("closing an opened row removes the line again", () => {
    const { container } = renderTool("Read", { file_path: `${CWD}/src/a.ts` }, [{ content: "export const a = 1;" }]);
    const detail = open(container);
    expect(classesOf(detail)).toContain("border-b");
    fireEvent.click(disclosure(container));
    for (const cls of HAIRLINE) expect(classesOf(detail), `closed again: no ${cls}`).not.toContain(cls);
  });

  it("two opened rows that meet: exactly one line between them", () => {
    const family = toolFamily("Bash");
    const outcome = toolOutcome({ id: "x", name: "Bash" }, [], family);
    const { container } = render(
      <ExpandKeyProvider value="msg-sig-pair">
        <ToolRow icon={<span />} verb="Bash" target={<CodeTarget text="pnpm lint" />} outcome={outcome} family={family} toolId="toolu_a" expandKey="a">
          <p>first</p>
        </ToolRow>
        <ToolRow icon={<span />} verb="Bash" target={<CodeTarget text="pnpm test" />} outcome={outcome} family={family} toolId="toolu_b" expandKey="b">
          <p>second</p>
        </ToolRow>
      </ExpandKeyProvider>,
    );
    const buttons = [...container.querySelectorAll<HTMLElement>("[data-tool-row] button[aria-expanded]")];
    expect(buttons).toHaveLength(2);
    for (const b of buttons) fireEvent.click(b);
    const [firstHead, secondHead] = [...container.querySelectorAll<HTMLElement>("[data-tool-row]")];
    // Every element with a horizontal line class between the first row's head and the second row's head.
    const lines = [...container.querySelectorAll<HTMLElement>("*")].filter((el) => {
      const after = firstHead!.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
      const before = el.compareDocumentPosition(secondHead!) & Node.DOCUMENT_POSITION_FOLLOWING;
      const contains = el.contains(secondHead!);
      return after && (before || el === secondHead) && !contains && classesOf(el).some((c) => /^(border-(b|t|y)|divide-y)$/.test(c));
    });
    expect(lines.map((el) => el.getAttribute("data-tool-detail") !== null), "one line: the first opened detail's").toEqual([true]);
    const secondWrapper = secondHead!.closest("[data-tool-row-wrapper]")!;
    for (const el of [secondWrapper, secondHead!]) {
      expect(classesOf(el).some((c) => /^border-(t|y)?$/.test(c)), "the next row adds no line on top").toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// #14 — the translated tool kind on the row icon
// ---------------------------------------------------------------------------

interface KindCase {
  name: string;
  input: unknown;
  results?: Results;
  en: string;
  ko: string;
}

const KIND_CASES: KindCase[] = [
  { name: "Bash", input: { command: "pnpm build" }, en: "Terminal", ko: "터미널" },
  { name: "shell", input: { command: "ls" }, en: "Terminal", ko: "터미널" },
  { name: "Read", input: { file_path: `${CWD}/src/a.ts` }, en: "File read", ko: "파일 읽기" },
  { name: "read_file", input: { file_path: `${CWD}/src/a.ts` }, en: "File read", ko: "파일 읽기" },
  { name: "Write", input: { file_path: `${CWD}/src/n.ts`, content: "x" }, en: "File write", ko: "파일 쓰기" },
  { name: "Edit", input: { file_path: `${CWD}/src/a.ts`, old_string: "a", new_string: "b" }, en: "File edit", ko: "파일 편집" },
  { name: "MultiEdit", input: { file_path: `${CWD}/src/a.ts`, edits: [{ old_string: "a", new_string: "b" }] }, en: "File edit", ko: "파일 편집" },
  { name: "Grep", input: { pattern: "TODO" }, en: "Content search", ko: "내용 검색" },
  { name: "Glob", input: { pattern: "**/*.ts" }, en: "File search", ko: "파일 찾기" },
  { name: "WebSearch", input: { query: "Retry-After" }, en: "Web search", ko: "웹 검색" },
  { name: "WebFetch", input: { url: "https://example.com", prompt: "?" }, en: "Web fetch", ko: "웹 가져오기" },
  { name: "Task", input: { description: "Audit", prompt: "Go", subagent_type: "general-purpose" }, en: "Agent", ko: "에이전트" },
  { name: "Agent", input: { description: "Audit", prompt: "Go" }, en: "Agent", ko: "에이전트" },
  { name: "Workflow", input: { description: "Nightly", script: "export const meta = {};" }, en: "Workflow", ko: "워크플로" },
  { name: "AskUserQuestion", input: { questions: [{ question: "Which?", multiSelect: false, options: [] }] }, en: "Question", ko: "질문" },
  { name: "TodoWrite", input: { todos: [{ content: "Do it", status: "pending", activeForm: "Doing it" }] }, en: "To-do list", ko: "할 일 목록" },
  { name: "todowrite", input: { todos: [{ content: "Do it", status: "pending", activeForm: "Doing it" }] }, en: "To-do list", ko: "할 일 목록" },
  { name: "update_plan", input: { plan: [{ step: "One", status: "pending" }] }, en: "Plan", ko: "계획" },
  { name: "NotebookEdit", input: { notebook_path: `${CWD}/a.ipynb`, new_source: "x", edit_mode: "replace" }, en: "Notebook edit", ko: "노트북 편집" },
  { name: "TaskCreate", input: { subject: "Ship" }, en: "Task list", ko: "작업 목록" },
  { name: "TaskUpdate", input: { taskId: "7", status: "completed" }, en: "Task list", ko: "작업 목록" },
  { name: "apply_patch", input: { input: "*** Begin Patch" }, en: "File edit", ko: "파일 편집" },
  // Generic: MCP, unknown, and names that only look like a known tool (never guessed from a substring).
  { name: "mcp__github__create_issue", input: { title: "Flaky" }, en: "Tool", ko: "도구" },
  { name: "FrobnicateWidget", input: { a: 1 }, en: "Tool", ko: "도구" },
  { name: "ReadMcpResourceTool", input: { uri: "x" }, en: "Tool", ko: "도구" },
  { name: "BashOutput", input: { bash_id: "1" }, en: "Tool", ko: "도구" },
  { name: "WebFetchLite", input: { url: "x" }, en: "Tool", ko: "도구" },
];

/** The row icon (its own wrapper in the row head). */
const iconOf = (root: HTMLElement) => {
  const icon = root.querySelector<HTMLElement>("[data-tool-row] [data-tool-icon]");
  expect(icon, "the row icon").not.toBeNull();
  return icon!;
};

describe("#14 the tool kind on the row icon", () => {
  describe.each(["en", "ko"] as const)("%s", (lng) => {
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

    it.each(KIND_CASES.map((c) => [c.name, c] as const))("%s: the icon's tooltip and accessible name are the kind; the verb stays the recorded name", (_name, c) => {
      const { container } = renderTool(c.name, c.input, c.results ?? []);
      const kind = c[lng];
      const icon = iconOf(container);
      expect(icon.getAttribute("title"), "the native tooltip").toBe(kind);
      expect(icon.getAttribute("aria-label"), "the icon's own label").toBe(kind);
      expect(icon.getAttribute("role"), "an image with a name (aria-label on a bare span is ignored)").toBe("img");
      expect([...icon.querySelectorAll("[title]")].map((el) => el.getAttribute("title")), "no inner tooltip overrides the kind on hover").toEqual([]);
      expect(text(container.querySelector("[data-tool-verb]")), "the visible verb is the recorded name (D-R5)").toBe(c.name);
    });
  });

  it.each(KIND_CASES.filter((c) => ["Bash", "Read", "Task", "mcp__github__create_issue"].includes(c.name)).map((c) => [c.name, c] as const))(
    "%s: the row button reads kind + verb + target (only the icon's label is added)",
    (_name, c) => {
      const { container } = renderTool(c.name, c.input, c.results ?? []);
      const button = disclosure(container);
      const name = accessibleName(container, "button", button);
      // The same button without its icon: what the row read before the icon had a name.
      const clone = button.cloneNode(true) as HTMLElement;
      clone.querySelector("[data-tool-icon]")?.remove();
      const host = document.createElement("div");
      host.appendChild(clone);
      document.body.appendChild(host);
      const without = accessibleName(host, "button", clone);
      host.remove();
      expect(without, "the verb is in the name").toContain(c.name);
      expect(name).toBe(`${c.en} ${without}`);
      expect(within(container).getByRole("img", { name: c.en }), "the icon is an image named by the kind").toBe(iconOf(container));
    },
  );

  it("the icon is not a tab stop: Tab reaches the row button (closed), then the detail's own stops (opened), as before", () => {
    const { container } = renderTool("Bash", { command: "pnpm build", description: "Build" }, [
      { content: "ok", toolUseResult: { stdout: "ok", stderr: "", exitCode: 0 } },
    ]);
    const icon = iconOf(container);
    expect(icon.hasAttribute("tabindex"), "no tabindex on the icon").toBe(false);
    expect(icon.querySelector("[tabindex], button, a[href]"), "nothing focusable inside the icon").toBeNull();
    const button = disclosure(container);
    expect(tabStops(container), "closed: one stop, the row button").toEqual([button]);
    open(container);
    const stops = tabStops(container);
    expect(stops[0]).toBe(button);
    expect(stops.some((el) => el.closest("[data-tool-icon]")), "no stop inside the icon").toBe(false);
    // As on the part-2 head: the output's own copy control, then Copy tool ID.
    const stopOf = (el: HTMLElement) => `${el.tagName.toLowerCase()} ${el.getAttribute("aria-label") ?? el.getAttribute("title") ?? text(el)}`.trim();
    expect(stops.slice(1).map(stopOf), "opened: then the detail's own stops, unchanged").toEqual(["button Copy output", "button Copy tool ID"]);
  });

  it("every kind label exists, non-empty, in all five locales", () => {
    const keys = [
      "toolRow.kindTerminal",
      "toolRow.kindFileRead",
      "toolRow.kindFileWrite",
      "toolRow.kindFileEdit",
      "toolRow.kindContentSearch",
      "toolRow.kindFileSearch",
      "toolRow.kindWebSearch",
      "toolRow.kindWebFetch",
      "toolRow.kindAgent",
      "toolRow.kindWorkflow",
      "toolRow.kindQuestion",
      "toolRow.kindTodoList",
      "toolRow.kindPlan",
      "toolRow.kindNotebookEdit",
      "toolRow.kindTaskList",
      "toolRow.kindGeneric",
    ];
    for (const lng of ["en", "ko", "ja", "zh-CN", "zh-TW"]) {
      const file = resolve(__dirname, `../i18n/locales/${lng}/renderers.json`);
      const json = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      for (const key of keys) {
        expect(typeof json[key] === "string" && (json[key] as string).trim() !== "", `${lng}: ${key}`).toBe(true);
      }
    }
  });
});
