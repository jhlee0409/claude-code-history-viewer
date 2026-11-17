/**
 * DiffView (plan §4.3 DiffView row, TR2a; acceptance D5).
 *
 * Unified view only: every line has two line-number cells (old, new), a
 * +/− marker cell (blank on context lines) and the code. Colours come only
 * from the diff tokens, and the dark theme defines every one of them, so no
 * white table shows in dark. The marker is a text glyph, so added and
 * removed lines stay distinguishable in forced colours (backgrounds are
 * dropped there). A large diff stops at a line cap with an
 * "n more lines" disclosure.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import i18n from "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { DiffView, type DiffSection } from "./DiffView";

const show = (sections: DiffSection[], extra: Partial<Parameters<typeof DiffView>[0]> = {}) =>
  render(
    <ExpandKeyProvider value="msg-diff">
      <DiffView sections={sections} expandKey="diff-test" {...extra} />
    </ExpandKeyProvider>,
  );

const root = (container: HTMLElement) => {
  const el = container.querySelector("[data-diff-view]");
  expect(el, "the DiffView root ([data-diff-view])").not.toBeNull();
  return el as HTMLElement;
};

const lines = (container: HTMLElement) => [...root(container).querySelectorAll<HTMLElement>("[data-diff-line]")];

const cell = (line: HTMLElement, name: "old-no" | "new-no" | "marker" | "code") => {
  const el = line.querySelector<HTMLElement>(`[data-diff-${name}]`);
  expect(el, `[data-diff-${name}] in ${line.outerHTML.slice(0, 160)}`).not.toBeNull();
  return el as HTMLElement;
};

/** The marker cell's visible glyph (its screen-reader word is separate). */
const glyph = (line: HTMLElement) => cell(line, "marker").querySelector("[aria-hidden='true']")?.textContent ?? "";

const OLD = "export function renderPreview(input: string) {\n  return input.trim();\n}\n";
const NEW = "export function renderPreview(input: string) {\n  return input.trim().replace(/\\s+/g, \" \");\n  // collapsed\n}\n";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => {
  useExpandRegistry.getState().clearAll();
});

describe("DiffView line model: two line numbers, a +/− column, the code", () => {
  it("every added line shows +, every removed line −, context lines a blank marker", () => {
    const { container } = show([{ oldText: OLD, newText: NEW }]);
    const all = lines(container);
    expect(all.map((l) => l.getAttribute("data-diff-line"))).toEqual(["context", "del", "add", "add", "context"]);
    for (const line of all) {
      const kind = line.getAttribute("data-diff-line");
      if (kind === "add") expect(glyph(line)).toBe("+");
      else if (kind === "del") expect(glyph(line)).toBe("−");
      else expect(cell(line, "marker").textContent).toBe("");
    }
  });

  it("both line-number columns: context lines carry both, a removed line the old one, an added line the new one", () => {
    const { container } = show([{ oldText: OLD, newText: NEW, oldStart: 10, newStart: 10 }]);
    const numbers = lines(container).map((l) => [cell(l, "old-no").textContent, cell(l, "new-no").textContent]);
    expect(numbers).toEqual([
      ["10", "10"],
      ["11", ""],
      ["", "11"],
      ["", "12"],
      ["12", "13"],
    ]);
  });

  it("the code cell keeps the recorded text, whitespace included", () => {
    const { container } = show([{ oldText: OLD, newText: NEW }]);
    expect(lines(container).map((l) => cell(l, "code").textContent)).toEqual([
      "export function renderPreview(input: string) {",
      "  return input.trim();",
      "  return input.trim().replace(/\\s+/g, \" \");",
      "  // collapsed",
      "}",
    ]);
  });

  it("states its counts once for assistive tech and as data (the Edit row reads the same function)", () => {
    const { container } = show([{ oldText: OLD, newText: NEW }]);
    const el = root(container);
    expect(el.getAttribute("data-diff-added")).toBe("2");
    expect(el.getAttribute("data-diff-removed")).toBe("1");
    expect(el.querySelector(".sr-only")?.textContent).toBe("2 lines added, 1 line removed");
  });

  it("several sections (MultiEdit): each section's lines, numbered on their own, with a label between", () => {
    const { container } = show([
      { oldText: "a\n", newText: "A\n" },
      { oldText: "b\n", newText: "B\n", oldStart: 7, newStart: 7 },
    ]);
    const labels = [...root(container).querySelectorAll("[data-diff-section]")].map((el) => el.textContent);
    expect(labels).toEqual(["Edit 1 of 2", "Edit 2 of 2"]);
    expect(lines(container).map((l) => `${l.getAttribute("data-diff-line")}:${cell(l, "old-no").textContent}/${cell(l, "new-no").textContent}`)).toEqual([
      "del:1/",
      "add:/1",
      "del:7/",
      "add:/7",
    ]);
    expect(root(container).getAttribute("data-diff-added")).toBe("2");
  });

  it("whole-file diffs fold unchanged lines beyond the context into one gap row that opens", () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    const after = before.replace("line 20\n", "line twenty\n");
    const { container } = show([{ oldText: before, newText: after }], { context: 3 });
    // 3 context + del + add + 3 context
    expect(lines(container)).toHaveLength(8);
    const gaps = [...root(container).querySelectorAll<HTMLElement>("[data-diff-gap]")];
    expect(gaps.map((g) => g.textContent)).toEqual(["16 unchanged lines", "17 unchanged lines"]);
    fireEvent.click(within(gaps[0]).getByRole("button"));
    expect(lines(container)).toHaveLength(8 + 16);
  });

  it("the folded-context toggle is a disclosure that stays put and keeps focus (review round 1)", () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    const after = before.replace("line 20\n", "line twenty\n");
    const { container } = show([{ oldText: before, newText: after }], { context: 3 });
    const button = within(root(container).querySelector<HTMLElement>("[data-diff-gap]")!).getByRole("button");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const controls = button.getAttribute("aria-controls");
    expect(controls, "aria-controls").toBeTruthy();
    const target = container.querySelector(`[id="${controls}"]`);
    expect(target, "the controlled region exists while closed").not.toBeNull();
    button.focus();
    fireEvent.click(button);
    expect(button.isConnected, "the toggle is still in the document").toBe(true);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(`[id="${controls}"]`)?.querySelectorAll("[data-diff-line]").length).toBe(16);
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(lines(container)).toHaveLength(8);
  });

  it("the folded-context toggle row is not part of a code selection (review round 2)", () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    const after = before.replace("line 20\n", "line twenty\n");
    const { container } = show([{ oldText: before, newText: after }], { context: 3 });
    for (const gap of root(container).querySelectorAll<HTMLElement>("[data-diff-gap]")) {
      expect(gap.querySelector("td")?.className, "the toggle cell opts out of text selection").toMatch(/(^|\s)select-none(\s|$)/);
    }
  });
});

describe("DiffView colours: diff tokens only, defined for dark", () => {
  const css = readFileSync(resolve(__dirname, "../../index.css"), "utf8");
  /** The declarations of the first rule whose selector is exactly `selector`. */
  const block = (selector: string) => {
    const at = css.indexOf(`\n${selector} {`);
    expect(at, `${selector} block in index.css`).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("\n}", at));
  };
  const lightness = (body: string, name: string) => {
    const m = new RegExp(`--${name}:\\s*oklch\\(([0-9.]+)`).exec(body);
    expect(m, `--${name} as oklch()`).not.toBeNull();
    return Number(m?.[1]);
  };

  it("added / removed rows use the diff background tokens; nothing else paints the table", () => {
    const { container } = show([{ oldText: OLD, newText: NEW }]);
    for (const line of lines(container)) {
      const classes = (line.getAttribute("class") ?? "").split(/\s+/);
      const kind = line.getAttribute("data-diff-line");
      if (kind === "add") expect(classes).toContain("bg-diff-add-bg");
      else if (kind === "del") expect(classes).toContain("bg-diff-del-bg");
      else expect(classes.filter((c) => c.startsWith("bg-"))).toEqual([]);
    }
    const every = [root(container), ...root(container).querySelectorAll("*")].flatMap((el) => (el.getAttribute("class") ?? "").split(/\s+/));
    // No raw palette (white table, green-100 …) and no hex: only tokens.
    expect(every.filter((c) => /^(?:dark:)?(?:bg|text|border)-(?:white|black|(?:red|green|gray|slate|zinc|neutral)-\d+)/.test(c) || c.includes("#"))).toEqual([]);
  });

  it("the dark themes define dark diff backgrounds (no white table in dark)", () => {
    for (const selector of [".dark", ".dark.high-contrast"]) {
      const body = block(selector);
      for (const name of ["diff-add-bg", "diff-del-bg", "diff-add-gutter", "diff-del-gutter"]) {
        expect(lightness(body, name), `${selector} --${name}`).toBeLessThan(0.4);
      }
    }
    expect(css).toMatch(/--color-diff-add-bg:\s*var\(--diff-add-bg\)/);
    expect(css).toMatch(/--color-diff-del-bg:\s*var\(--diff-del-bg\)/);
  });
});

describe("DiffView in forced colours: the marker is text, not colour", () => {
  it("each changed line's marker is a real text glyph in the DOM, plus a spoken word", () => {
    const { container } = show([{ oldText: OLD, newText: NEW }]);
    for (const line of lines(container)) {
      const kind = line.getAttribute("data-diff-line");
      if (kind === "context") continue;
      const marker = cell(line, "marker");
      // A glyph from the DOM survives forced colours (backgrounds do not); a
      // CSS ::before or a colour-only cue would not be in textContent.
      expect(marker.textContent?.startsWith(kind === "add" ? "+" : "−")).toBe(true);
      expect(marker.querySelector(".sr-only")?.textContent).toBe(kind === "add" ? "Added" : "Removed");
    }
  });
});

describe("DiffView large-diff cap: n more lines", () => {
  const big = Array.from({ length: 120 }, (_, i) => `new ${i + 1}`).join("\n") + "\n";

  it("shows at most lineCap lines, then a disclosure with aria-expanded and aria-controls", () => {
    const { container } = show([{ oldText: "", newText: big }], { lineCap: 50 });
    expect(lines(container)).toHaveLength(50);
    const button = within(root(container)).getByRole("button", { name: "Show 70 more lines" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const controls = button.getAttribute("aria-controls") ?? "";
    expect(controls).not.toBe("");
    expect(document.getElementById(controls), "aria-controls names a rendered element").not.toBeNull();
    fireEvent.click(button);
    expect(lines(container)).toHaveLength(120);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.textContent).toBe("Show fewer lines");
  });

  it("no disclosure when the diff fits", () => {
    const { container } = show([{ oldText: OLD, newText: NEW }], { lineCap: 50 });
    expect(within(root(container)).queryByRole("button")).toBeNull();
  });
});
