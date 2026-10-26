/**
 * The opened Edit (plan §4.3 "펼친 Edit", TR2a; acceptance D4).
 *
 * ToolRow (Edit · relative path · +a −d) → open → ONE meta line (operation
 * kind · user-modified flag when recorded · `…` menu) → the DiffView, with
 * zero elements between them. The old box (second "File Edit Result" header,
 * absolute path well, Edit Type / User Modified chips, Changes toolbar,
 * Advanced Text Analysis box) is gone; the advanced compare and side-by-side
 * implementations moved into the `…` menu unchanged (parity is TR2b).
 *
 * The standalone FileEditRenderer (a toolUseResult routed on its own) keeps
 * every behaviour its props drove at 12e952c0: the relative path (now in the
 * meta line), the edit type, the recorded user-modified flag, the three
 * copies (changed result, file after change, original file) and the
 * original file content with its search highlight, after the diff.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import i18n from "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { ThemeProvider } from "@/contexts/theme";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { useAppStore } from "@/store/useAppStore";
import { UnifiedToolExecutionRenderer } from "@/components/contentRenderer/UnifiedToolExecutionRenderer";
import { FileEditRenderer } from "./FileEditRenderer";

const CWD = "/Users/dev/work/kiln";
const FILE = `${CWD}/src/preview/renderPreview.ts`;
const OLD = "  return input.trim();\n";
const NEW = "  return input.trim().replace(/\\s+/g, \" \");\n";
const ORIGINAL = "export function renderPreview(input: string) {\n  return input.trim();\n}\n";

// The original file content (FileContent) reads the theme, as in the app.
const wrap = (ui: ReactNode) =>
  render(
    <ThemeProvider>
      <ExpandKeyProvider value="msg-order">{ui}</ExpandKeyProvider>
    </ThemeProvider>,
  );
const own = (toolUseResult: unknown) => ({
  toolUseResult,
  toolUseResultSource: { messageUuid: "u", sessionId: "s", contentIndex: 0, association: "single_result" },
});
const editCard = (input: Record<string, unknown>, results: Record<string, unknown>[] = [{ content: `The file ${FILE} has been updated.` }]) => {
  const id = `toolu_order_${Math.random().toString(36).slice(2)}`;
  return wrap(
    <UnifiedToolExecutionRenderer
      toolUse={{ type: "tool_use", id, name: "Edit", input }}
      toolResults={results.map((r) => ({ type: "tool_result", tool_use_id: id, ...r }))}
    />,
  );
};
const openRow = (container: HTMLElement) => {
  const row = container.querySelector("[data-tool-row]") as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { expanded: false }));
};
const meta = (container: HTMLElement) => {
  const el = container.querySelector<HTMLElement>("[data-edit-meta]");
  expect(el, "the opened Edit's meta line ([data-edit-meta])").not.toBeNull();
  return el as HTMLElement;
};
const openMenu = (container: HTMLElement) => {
  const trigger = within(meta(container)).getByRole("button", { name: "More actions" });
  expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.getByRole("menu");
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
  });
});

describe("opened Edit: meta line → DiffView, nothing between", () => {
  it("the detail starts with the meta line and the diff is its very next element", () => {
    const { container } = editCard({ file_path: FILE, old_string: OLD, new_string: NEW });
    openRow(container);
    const line = meta(container);
    const next = line.nextElementSibling;
    expect(next?.hasAttribute("data-diff-view"), `element after the meta line: ${next?.outerHTML.slice(0, 160)}`).toBe(true);
    // The opened detail's content starts with the Input zone (IO zones, owner
    // option B: the diff is the recorded change = Input); inside it, after the
    // zone's label line and nothing else, the meta line comes first.
    const detail = container.querySelector("[data-tool-detail]") as HTMLElement;
    const first = detail.querySelector(":scope > div")?.firstElementChild;
    expect(first?.getAttribute("data-detail-zone"), `first element of the detail: ${first?.outerHTML.slice(0, 160)}`).toBe("input");
    expect(first?.children[0]?.hasAttribute("data-zone-label"), "the zone starts with its label line").toBe(true);
    expect(first?.children.length, "the zone is its label line, then its body").toBe(2);
    const body = first?.children[1]?.firstElementChild;
    expect(body === line || body?.firstElementChild === line, `first element of the Input zone's body: ${body?.outerHTML.slice(0, 160)}`).toBe(true);
  });

  it("the old box is gone: no second header, no absolute path well, no Edit Type / User Modified chips", () => {
    const { container } = editCard({ file_path: FILE, old_string: OLD, new_string: NEW });
    openRow(container);
    const detail = container.querySelector("[data-tool-detail]") as HTMLElement;
    expect(detail.textContent).not.toContain("File Edit Result");
    expect(detail.textContent).not.toContain("Edit Type");
    expect(detail.textContent).not.toContain("Advanced Text Analysis");
    expect(detail.textContent).not.toContain(CWD);
    // No chip row: the meta line's items are plain inline text, no bordered boxes.
    for (const el of meta(container).querySelectorAll("*")) {
      expect((el.getAttribute("class") ?? "").split(/\s+/), el.outerHTML.slice(0, 120)).not.toContain("border");
    }
  });

  it("one meta line: the operation kind, then the menu; the user-modified flag only when recorded true", () => {
    const plain = editCard({ file_path: FILE, old_string: OLD, new_string: NEW });
    openRow(plain.container);
    expect(meta(plain.container).textContent).toBe("Replace");
    plain.unmount();

    const all = editCard({ file_path: FILE, old_string: "a", new_string: "b", replace_all: true });
    openRow(all.container);
    expect(meta(all.container).textContent).toBe("Replace all");
    all.unmount();

    const modified = editCard({ file_path: FILE, old_string: OLD, new_string: NEW }, [
      { content: `The file ${FILE} has been updated.`, ...own({ filePath: FILE, oldString: OLD, newString: NEW, originalFile: ORIGINAL, userModified: true, replaceAll: false }) },
    ]);
    openRow(modified.container);
    expect(meta(modified.container).textContent).toBe("Replace · Modified by user");
  });

  it("the recorded original file numbers the diff with the file's own lines", () => {
    const { container } = editCard({ file_path: FILE, old_string: OLD, new_string: NEW }, [
      { content: `The file ${FILE} has been updated.`, ...own({ filePath: FILE, oldString: OLD, newString: NEW, originalFile: ORIGINAL, userModified: false, replaceAll: false }) },
    ]);
    openRow(container);
    const nos = [...container.querySelectorAll("[data-diff-line]")].map((l) => `${l.querySelector("[data-diff-old-no]")?.textContent}/${l.querySelector("[data-diff-new-no]")?.textContent}`);
    expect(nos).toEqual(["2/", "/2"]);
  });
});

describe("the `…` menu: comparison mode (old implementations, unchanged), copy, open in Edits", () => {
  it("lists the comparison modes, the copies and Open in Recent edits", () => {
    const { container } = editCard({ file_path: FILE, old_string: OLD, new_string: NEW });
    openRow(container);
    const menu = openMenu(container);
    expect(within(menu).getAllByRole("menuitemradio").map((el) => el.textContent)).toEqual(["Unified", "Side by side", "Advanced compare"]);
    expect(within(menu).getByRole("menuitemradio", { name: "Unified" }).getAttribute("aria-checked")).toBe("true");
    expect(within(menu).getAllByRole("menuitem").map((el) => el.textContent)).toEqual(["Copy Changed Result", "Open in Recent edits"]);
    fireEvent.keyDown(menu, { key: "Escape" });
  });

  it("Advanced compare swaps the diff for the existing AdvancedTextDiff; Unified brings the DiffView back", () => {
    const { container } = editCard({ file_path: FILE, old_string: OLD, new_string: NEW });
    openRow(container);
    fireEvent.click(within(openMenu(container)).getByRole("menuitemradio", { name: "Advanced compare" }));
    expect(container.querySelector("[data-diff-view]")).toBeNull();
    expect(screen.getByText(/Comparison Method/)).toBeTruthy();
    // Still nothing between the meta line and the chosen view.
    expect(meta(container).nextElementSibling?.textContent).toContain("Comparison Method");
    fireEvent.click(within(openMenu(container)).getByRole("menuitemradio", { name: "Unified" }));
    expect(meta(container).nextElementSibling?.hasAttribute("data-diff-view")).toBe(true);
  });

  it("Side by side shows the existing two-column viewer (Before / After)", () => {
    const { container } = editCard({ file_path: FILE, old_string: OLD, new_string: NEW });
    openRow(container);
    fireEvent.click(within(openMenu(container)).getByRole("menuitemradio", { name: "Side by side" }));
    expect(container.querySelector("[data-diff-view]")).toBeNull();
    const view = meta(container).nextElementSibling as HTMLElement;
    expect(view.textContent).toContain("Before");
    expect(view.textContent).toContain("After");
  });

  it("Copy Changed Result copies the new text", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true, writable: true });
    const { container } = editCard({ file_path: FILE, old_string: OLD, new_string: NEW });
    openRow(container);
    const item = within(openMenu(container)).getByRole("menuitem", { name: "Copy Changed Result" });
    await act(async () => {
      fireEvent.click(item);
    });
    expect(writeText).toHaveBeenCalledWith(NEW);
  });

  it("Open in Recent edits opens the Edits screen filtered to the file", async () => {
    const navigate = vi.fn(() => Promise.resolve(true));
    useAppStore.setState({ navigate } as never);
    const { container } = editCard({ file_path: FILE, old_string: OLD, new_string: NEW });
    openRow(container);
    const item = within(openMenu(container)).getByRole("menuitem", { name: "Open in Recent edits" });
    await act(async () => {
      fireEvent.click(item);
    });
    expect(navigate).toHaveBeenCalledWith({ view: "edits" });
    expect(useAppStore.getState().analytics.recentEditsSearchQuery).toBe(FILE);
  });
});

describe("standalone FileEditRenderer (toolUseResult route): base props keep acting", () => {
  const result = { filePath: FILE, oldString: OLD, newString: NEW, originalFile: ORIGINAL, userModified: true, replaceAll: false };

  it("meta line with the relative path, then the diff, then the original file content", () => {
    const { container } = wrap(<FileEditRenderer toolResult={result} />);
    const line = meta(container);
    const path = line.querySelector("[data-path]");
    // Relative to the open project (D1: never an unexplained absolute path).
    expect(path?.getAttribute("data-path-kind")).toBe("project");
    expect(line.textContent).toBe("src/preview/renderPreview.ts · Replace · Modified by user");
    expect(line.nextElementSibling?.hasAttribute("data-diff-view")).toBe(true);
    const after = line.nextElementSibling?.nextElementSibling as HTMLElement | null;
    expect(after?.textContent).toContain("Original File Content");
  });

  it("the menu offers all three copies when the original file is recorded", () => {
    const { container } = wrap(<FileEditRenderer toolResult={result} />);
    const menu = openMenu(container);
    expect(within(menu).getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
      "Copy Changed Result",
      "Copy File After Change",
      "Copy Original File",
      "Open in Recent edits",
    ]);
    fireEvent.keyDown(menu, { key: "Escape" });
  });

  it("a deletion (empty new text) still shows its diff", () => {
    const { container } = wrap(<FileEditRenderer toolResult={{ filePath: FILE, oldString: OLD, newString: "" }} />);
    const kinds = [...container.querySelectorAll("[data-diff-line]")].map((l) => l.getAttribute("data-diff-line"));
    expect(kinds).toEqual(["del"]);
  });

  it("searchQuery still reaches the original file content: a hit past its 20-line cut opens it", () => {
    const long = Array.from({ length: 30 }, (_, i) => (i === 27 ? "const needleLine = 28;" : `const line${i + 1} = ${i + 1};`)).join("\n") + "\n";
    const longResult = { ...result, originalFile: `${long}${ORIGINAL}` };
    /** Open the original-content card (collapsed by default, as at the base) and return its text. */
    const originalContent = (container: HTMLElement) => {
      const card = meta(container).nextElementSibling?.nextElementSibling as HTMLElement;
      const toggle = within(card).queryAllByRole("button", { expanded: false })[0];
      if (toggle) fireEvent.click(toggle);
      return card.textContent ?? "";
    };
    const plain = wrap(<FileEditRenderer toolResult={longResult} />);
    expect(originalContent(plain.container)).not.toContain("needleLine");
    plain.unmount();
    useExpandRegistry.getState().clearAll();
    const searched = wrap(<FileEditRenderer toolResult={longResult} searchQuery="needleline" />);
    expect(originalContent(searched.container)).toContain("needleLine");
  });
});
