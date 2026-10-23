/**
 * OutputBlock (plan §4.3, D6, TR0): raw output on a well, whitespace kept,
 * no Markdown; ANSI / tree / table detection as before; a stderr zone that
 * does not depend on the verdict; a line cap with "Show all n lines"; copy.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import i18n from "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { OutputBlock } from "./OutputBlock";
import { detectCommandOutputKind } from "./outputKind";

const wrap = (ui: ReactNode) => render(<ExpandKeyProvider value="msg-out">{ui}</ExpandKeyProvider>);
const body = (container: HTMLElement) => {
  const el = container.querySelector("[data-output] pre[data-output-text]");
  expect(el, "the OutputBlock text well (pre[data-output-text])").not.toBeNull();
  return el as HTMLElement;
};
const visibleLines = (el: HTMLElement) => (el.textContent ?? "").split("\n");

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => {
  useExpandRegistry.getState().clearAll();
});

describe("OutputBlock: raw text", () => {
  it('"a\\nb" stays two lines in one preformatted block', () => {
    const { container } = wrap(<OutputBlock text={"a\nb"} />);
    const pre = body(container);
    expect(pre).not.toBeNull();
    expect(visibleLines(pre)).toEqual(["a", "b"]);
    expect(pre.querySelector("p, br")).toBeNull();
    expect(container.querySelector("[data-output] [data-meta]")?.textContent).toContain("2 lines");
  });

  it("'# title' and **bold** are not Markdown", () => {
    const { container } = wrap(<OutputBlock text={"# title\n\n**bold** and _it_"} />);
    expect(container.querySelector("h1, h2, h3, strong, em")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(body(container).textContent).toBe("# title\n\n**bold** and _it_");
  });

  it("keeps spaces and tabs exactly", () => {
    const text = "  indented\n\ttabbed   trailing   \n\n\nafter blanks";
    const { container } = wrap(<OutputBlock text={text} />);
    expect(body(container).textContent).toBe(text);
    expect(body(container).className).toContain("whitespace-pre-wrap");
  });

  it("sits on the well surface in the code font", () => {
    const { container } = wrap(<OutputBlock text="x" />);
    const block = container.querySelector("[data-output]");
    expect(block?.getAttribute("class")).toContain("bg-surface-well");
    expect(body(container).className).toContain("font-mono");
    expect(body(container).className).toContain("text-code");
  });
});

describe("OutputBlock: ANSI and detection kept", () => {
  it("renders ANSI colour instead of escape bytes", () => {
    const { container } = wrap(<OutputBlock text={"\x1b[31mred\x1b[0m plain"} />);
    expect(container.textContent).not.toContain("\x1b");
    expect(container.textContent).toContain("red plain");
    expect(body(container).querySelector("span[style*='color'], span[class*='ansi']")).not.toBeNull();
  });

  it("labels a file tree", () => {
    wrap(<OutputBlock text={"├── src/\n│   └── index.ts\n└── package.json"} />);
    expect(screen.queryByText("File Structure")).not.toBeNull();
  });

  it("labels a table", () => {
    wrap(<OutputBlock text={"| a | b |\n|---|---|\n| 1 | 2 |"} />);
    expect(screen.queryByText("Table Output")).not.toBeNull();
  });
});

describe("OutputBlock: stderr zone", () => {
  it("shows stderr in its own zone with a neutral left rule unless the verdict is failed (plan amendment #1)", () => {
    const { container } = wrap(<OutputBlock text="out" errorText="fatal: not a git repository" />);
    const zone = container.querySelector("[data-stderr]");
    expect(zone, "the stderr zone").not.toBeNull();
    expect(zone?.textContent).toContain("fatal: not a git repository");
    expect(zone?.getAttribute("class")).toMatch(/border-l/);
    expect(zone?.getAttribute("class")).toContain("border-line");
    expect(zone?.getAttribute("class")).not.toContain("danger");
    expect(zone?.querySelector("pre")?.getAttribute("class")).not.toContain("danger");
    expect(body(container).textContent).toBe("out");
  });

  it("shows stderr even when there is no stdout (E15)", () => {
    const { container } = wrap(<OutputBlock text="" errorText="fatal: boom" />);
    expect(container.querySelector("[data-stderr]")?.textContent).toContain("fatal: boom");
  });

  it("has no stderr zone without stderr", () => {
    const { container } = wrap(<OutputBlock text="out" />);
    expect(container.querySelector("[data-stderr]")).toBeNull();
  });

  it.each(["en", "ko", "ja", "zh-CN", "zh-TW"])("%s: the zone's label is the neutral code literal `stderr`, not a word claiming an error (TC6)", async (locale) => {
    await i18n.changeLanguage(locale);
    try {
      const { container } = wrap(<OutputBlock text="✔ No problems found" errorText="warning: React version not specified" />);
      const zone = container.querySelector("[data-stderr]") as HTMLElement;
      const label = zone.firstElementChild as HTMLElement;
      expect(label.textContent).toBe("stderr");
      expect(label.matches("code[data-mono='code']"), label.outerHTML).toBe(true);
      expect(zone.textContent).not.toMatch(/error output|오류 출력|エラー出力|错误输出|錯誤輸出/i);
      // Its own zone with a left rule; danger styling is the failed verdict's alone (amendment #1).
      expect(zone.getAttribute("class")).toMatch(/border-l/);
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("its meta carries no outcome facts (the ToolRow detail owns the exit code)", () => {
    const { container } = wrap(<OutputBlock text="Exit code 1 is text here" errorText="warning: x" />);
    expect(container.querySelector("[data-output] [data-meta]")?.textContent).not.toMatch(/exit code/i);
  });
});

describe("OutputBlock: line cap and copy", () => {
  const twenty = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");

  it("caps long output and offers 'Show all 20 lines'", () => {
    const { container } = wrap(<OutputBlock text={twenty} lineCap={15} expandKey="cap" />);
    expect(visibleLines(body(container))).toHaveLength(15);
    const showAll = screen.queryByRole("button", { name: "Show all 20 lines" });
    expect(showAll, "the show-all button").not.toBeNull();
    fireEvent.click(showAll as HTMLElement);
    expect(visibleLines(body(container))).toHaveLength(20);
    expect(screen.queryByRole("button", { name: "Show less" })).not.toBeNull();
  });

  it("'Show all' is a disclosure: aria-expanded + aria-controls naming every zone it opens", () => {
    const { container } = wrap(<OutputBlock text={twenty} errorText={twenty} lineCap={15} expandKey="aria" />);
    const showAll = screen.getByRole("button", { name: "Show all 40 lines" });
    expect(showAll.getAttribute("aria-expanded")).toBe("false");
    const ids = (showAll.getAttribute("aria-controls") ?? "").split(/\s+/).filter(Boolean);
    expect(ids).toHaveLength(2);
    const zones = [...container.querySelectorAll("pre[data-output-text]")];
    expect(ids.map((id) => container.querySelector(`[id="${id}"]`))).toEqual(zones);
    fireEvent.click(showAll);
    expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("opens fully when a search match sits past the cap", () => {
    const text = `${twenty}\nneedle`;
    const { container } = wrap(<OutputBlock text={text} lineCap={15} expandKey="search" searchQuery="needle" />);
    expect(body(container).textContent).toContain("needle");
  });

  it("a search-opened block says so on its toggle and the user can still collapse it (review round 6 sweep)", () => {
    const text = `${twenty}\nneedle`;
    const { container } = wrap(<OutputBlock text={text} lineCap={15} expandKey="search-collapse" searchQuery="needle" />);
    const toggle = screen.getByRole("button", { name: "Show less" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: /Show all/ }).getAttribute("aria-expanded")).toBe("false");
    expect(body(container).textContent).not.toContain("needle");
  });

  it("offers a copy button", () => {
    wrap(<OutputBlock text="x" />);
    expect(screen.queryByRole("button", { name: "Copy output" })).not.toBeNull();
  });
});

describe("detectCommandOutputKind keeps CommandOutputDisplay's old rules (independent review)", () => {
  /** CommandOutputDisplay's predicates before the extraction, verbatim in order. */
  const old = (s: string) => {
    if (s.trim().startsWith("{") && s.trim().endsWith("}")) {
      try {
        JSON.parse(s);
        return "json";
      } catch {
        // falls through to the keyword checks
      }
    }
    if (s.includes("Test Suites:") || s.includes("jest") || s.includes("coverage")) return "test";
    if (s.includes("webpack") || s.includes("build") || s.includes("compile")) return "build";
    if (s.includes("npm") || s.includes("yarn") || s.includes("pnpm")) return "package";
    if (s.includes("|") && s.includes("-") && s.split("\n").length > 2) return "table";
    return "terminal";
  };
  it.each(['{"build":"jest pnpm"}', "{invalid jest}", "jest build pnpm", "build pnpm", "pnpm", "| a |\n| - |\n| b |", "plain", "src/\n├── a"])("%j", (s) => {
    expect(detectCommandOutputKind(s)).toBe(old(s));
  });
});
