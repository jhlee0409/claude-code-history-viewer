import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { ClaudeContentArrayRenderer } from "@/components/contentRenderer/ClaudeContentArrayRenderer";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  initReactI18next: {
    type: "3rdParty",
    init: () => {},
  },
}));

// A tool_use with a string id normalizes into a unified tool execution and
// renders via DefaultCard when no card owns its name (#429; since #429 an
// AskUserQuestion has its own card, so an MCP tool stands in here). The
// input's only field is not a summary key, so the collapsed row hides it.
// NOTE: expand state is cached in a module-level registry keyed by tool id,
// so each case uses a distinct id to stay isolated.
const makeAskUserQuestion = (id: string, question = "What reflectance model should we use?") => ({
  type: "tool_use",
  id,
  name: "mcp__render__pick_model",
  input: {
    questions: [{ question }],
  },
});

type SearchProps = {
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
};

const renderContent = (id: string, props: SearchProps, question?: string) => {
  const ui = (p: SearchProps) => (
    <ExpandKeyProvider value="test-message">
      <ClaudeContentArrayRenderer content={[makeAskUserQuestion(id, question)]} {...p} />
    </ExpandKeyProvider>
  );
  const view = render(ui(props));
  return { ...view, rerenderWith: (p: SearchProps) => view.rerender(ui(p)) };
};

/** The row's disclosure state (ToolRow: aria-expanded on its button). */
const rowOpen = (container: HTMLElement) =>
  container.querySelector("[data-tool-row] button[aria-expanded]")?.getAttribute("aria-expanded") ?? null;

describe("DefaultCard in-session search (#429)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the tool input collapsed and hidden when there is no search", () => {
    const { container } = renderContent("toolu_ask_none", {});

    // Collapsed by default: the matched input text is not rendered at all.
    expect(container.textContent).not.toContain("reflectance model");
    expect(container.querySelector("mark")).toBeNull();
  });

  it("auto-expands and highlights the tool input when the search term is inside it", () => {
    const { container } = renderContent("toolu_ask_hit", {
      searchQuery: "reflectance",
      isCurrentMatch: true,
      currentMatchIndex: 0,
    });

    // Auto-expanded: the previously-collapsed input is now visible.
    expect(container.textContent).toContain("reflectance model");

    // Highlighted: the match is wrapped in a <mark> and flagged as current.
    const marks = container.querySelectorAll("mark");
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[0]?.textContent?.toLowerCase()).toBe("reflectance");
    expect(container.querySelector('mark[aria-current="true"]')).not.toBeNull();
  });

  it("does not expand when the search term is absent from the input", () => {
    const { container } = renderContent("toolu_ask_miss", {
      searchQuery: "nonexistent-term",
    });

    // No match inside → stays collapsed, nothing highlighted.
    expect(container.textContent).not.toContain("reflectance model");
    expect(container.querySelector("mark")).toBeNull();
  });

  // TR1a: the auto-open is an effect keyed on the query, not `open = stored || hit`.
  it("the user can collapse it while the query still matches; a new matching query opens it again", () => {
    const view = renderContent("toolu_ask_matrix", { searchQuery: "reflectance", isCurrentMatch: true, currentMatchIndex: 0 });
    expect(rowOpen(view.container)).toBe("true");
    const button = view.container.querySelector("[data-tool-row] button[aria-expanded]") as HTMLElement;
    fireEvent.click(button);
    expect(rowOpen(view.container)).toBe("false");
    view.rerenderWith({ searchQuery: "reflectance", isCurrentMatch: true, currentMatchIndex: 0 });
    expect(rowOpen(view.container)).toBe("false");
    view.rerenderWith({ searchQuery: "model should", isCurrentMatch: true, currentMatchIndex: 0 });
    expect(rowOpen(view.container)).toBe("true");
    view.rerenderWith({ searchQuery: "" });
    expect(view.container.querySelector("mark")).toBeNull();
  });

  it("a hit the row's ellipsis hides is highlighted in the opened detail", () => {
    const long = `${"Which of the physically based shading models ".repeat(5)}fits glossy-needle surfaces?`;
    const view = renderContent("toolu_ask_ellipsis", { searchQuery: "glossy-needle", isCurrentMatch: true, currentMatchIndex: 0 }, long);
    const detail = view.container.querySelector("[data-tool-detail]:not([hidden])");
    expect(detail, "the opened detail").not.toBeNull();
    expect([...(detail as Element).querySelectorAll("mark")].map((m) => m.textContent)).toContain("glossy-needle");
  });
});
