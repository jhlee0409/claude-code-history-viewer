/**
 * Plan amendment 6 (renderer re-audit TC2 / TC3 / TC4), TR2a acceptance:
 * - a failed Edit shows its recorded error text in the opened detail (TR0
 *   adapter + OutputBlock rules: the text as recorded);
 * - a MultiEdit shows all n edits, each as DiffView lines;
 * - the collapsed row's "+a −d" and the DiffView's counts come from one
 *   function, so they agree — a replace_all edit and a multi-hunk edit
 *   included — and match the lines the diff draws.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import i18n from "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { useAppStore } from "@/store/useAppStore";
import { UnifiedToolExecutionRenderer } from "@/components/contentRenderer/UnifiedToolExecutionRenderer";

const CWD = "/Users/dev/work/kiln";
const FILE = `${CWD}/src/preview/renderPreview.ts`;

const card = (name: string, input: Record<string, unknown>, results: Record<string, unknown>[]) => {
  const id = `toolu_tr2a_${Math.random().toString(36).slice(2)}`;
  return render(
    <ExpandKeyProvider value="msg-tr2a">
      <UnifiedToolExecutionRenderer
        toolUse={{ type: "tool_use", id, name, input }}
        toolResults={results.map((r) => ({ type: "tool_result", tool_use_id: id, ...r }))}
      />
    </ExpandKeyProvider>,
  );
};
const rowOf = (container: HTMLElement) => container.querySelector("[data-tool-row]") as HTMLElement;
const openRow = (container: HTMLElement) => fireEvent.click(within(rowOf(container)).getByRole("button", { expanded: false }));
const detail = (container: HTMLElement) => container.querySelector("[data-tool-detail]") as HTMLElement;
/** The row's visible "+a −d". */
const rowCounts = (container: HTMLElement) => {
  const text = rowOf(container).querySelector("[aria-hidden='true'][data-mono='code']")?.textContent ?? "";
  const m = /^\+(\d+) −(\d+)$/.exec(text);
  expect(m, `row counts '${text}'`).not.toBeNull();
  return { added: Number(m?.[1]), removed: Number(m?.[2]) };
};
/** The DiffView's own counts, and the +/− lines it draws. */
const diffCounts = (container: HTMLElement) => {
  const view = container.querySelector("[data-diff-view]");
  expect(view, "the DiffView in the opened Edit").not.toBeNull();
  return {
    stated: { added: Number(view?.getAttribute("data-diff-added")), removed: Number(view?.getAttribute("data-diff-removed")) },
    drawn: {
      added: view?.querySelectorAll("[data-diff-line='add']").length ?? 0,
      removed: view?.querySelectorAll("[data-diff-line='del']").length ?? 0,
    },
  };
};

const ERROR = "<tool_use_error>String to replace not found in file.\nString:   return input.trimEnd();</tool_use_error>";

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
  });
});

describe("TC2: a failed Edit shows why it failed", () => {
  it("the recorded error text is in the opened detail, as recorded", () => {
    const { container } = card("Edit", { file_path: FILE, old_string: "  return input.trimEnd();\n", new_string: "  return input.trim();\n" }, [
      { content: ERROR, is_error: true },
    ]);
    expect(rowOf(container).getAttribute("data-tool-verdict")).toBe("failed");
    openRow(container);
    const output = detail(container).querySelector("[data-output]");
    expect(output, "an OutputBlock with the error text").not.toBeNull();
    expect(output?.textContent).toContain("String to replace not found in file.");
    expect(output?.textContent).toContain("String:   return input.trimEnd();");
    // The attempted change is still shown.
    expect(diffCounts(container).drawn).toEqual({ added: 1, removed: 1 });
  });

  it("a succeeded Edit's confirmation sentence adds nothing and stays out (as before)", () => {
    const { container } = card("Edit", { file_path: FILE, old_string: "a\n", new_string: "b\n" }, [{ content: `The file ${FILE} has been updated successfully.` }]);
    openRow(container);
    expect(detail(container).querySelector("[data-output]")).toBeNull();
    expect(detail(container).textContent).not.toContain("has been updated");
  });
});

describe("TC3: a MultiEdit shows all n edits", () => {
  const edits = [
    { old_string: "const a = 1;\n", new_string: "const a = 2;\n" },
    { old_string: "const b = 1;\n", new_string: "const b = 2;\nconst c = 3;\n" },
    { old_string: "// old note\n", new_string: "", replace_all: true },
  ];

  it("each edit becomes its own DiffView section with its lines", () => {
    const { container } = card("MultiEdit", { file_path: FILE, edits }, [{ content: `Applied 3 edits to ${FILE}` }]);
    openRow(container);
    const view = container.querySelector("[data-diff-view]") as HTMLElement;
    expect(view, "the DiffView in the opened MultiEdit").not.toBeNull();
    expect([...view.querySelectorAll("[data-diff-section]")].map((el) => el.textContent)).toEqual(["Edit 1 of 3", "Edit 2 of 3", "Edit 3 of 3"]);
    const code = [...view.querySelectorAll("[data-diff-line]")].map((l) => `${l.getAttribute("data-diff-line")} ${l.querySelector("[data-diff-code]")?.textContent}`);
    expect(code).toEqual(["del const a = 1;", "add const a = 2;", "del const b = 1;", "add const b = 2;", "add const c = 3;", "del // old note"]);
  });

  it("the meta line names the operation: 3 edits", () => {
    const { container } = card("MultiEdit", { file_path: FILE, edits }, [{ content: "ok" }]);
    openRow(container);
    expect(container.querySelector("[data-edit-meta]")?.textContent).toBe("3 edits");
  });
});

describe("TC4: one change-count source for the row and the DiffView", () => {
  const ctx = Array.from({ length: 10 }, (_, i) => `ctx ${i}`).join("\n");
  it.each([
    ["a one-line replacement (fixture)", "Edit", { old_string: "  return input.trim();\n", new_string: "  return input.trim().replace(/\\s+/g, \" \");\n" }],
    ["a multi-line replacement", "Edit", { old_string: "a\nb\nc\n", new_string: "a\nB\nC\nD\n" }],
    ["no trailing newline on one side", "Edit", { old_string: "x\ny", new_string: "x\ny\nz\n" }],
    ["a replace_all edit", "Edit", { old_string: "foo", new_string: "bar\nbaz", replace_all: true }],
    ["a multi-hunk edit", "Edit", { old_string: `first\n${ctx}\nlast\n`, new_string: `FIRST\n${ctx}\nLAST\nextra\n` }],
    ["a MultiEdit", "MultiEdit", { edits: [{ old_string: "a\n", new_string: "A\nA2\n" }, { old_string: "b\nc\n", new_string: "" }] }],
  ] as const)("%s", (_label, name, input) => {
    const { container } = card(name, { file_path: FILE, ...input }, [{ content: "ok" }]);
    const row = rowCounts(container);
    openRow(container);
    const diff = diffCounts(container);
    expect(diff.stated).toEqual(row);
    expect(diff.drawn).toEqual(row);
  });
});
