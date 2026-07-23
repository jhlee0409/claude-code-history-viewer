import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
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
// renders via DefaultCard (no dedicated renderer for AskUserQuestion). #429
// NOTE: expand state is cached in a module-level registry keyed by tool id,
// so each case uses a distinct id to stay isolated.
const makeAskUserQuestion = (id: string) => ({
  type: "tool_use",
  id,
  name: "AskUserQuestion",
  input: {
    questions: [{ question: "What reflectance model should we use?" }],
  },
});

const renderContent = (
  id: string,
  props: {
    searchQuery?: string;
    isCurrentMatch?: boolean;
    currentMatchIndex?: number;
  }
) =>
  render(
    <ExpandKeyProvider value="test-message">
      <ClaudeContentArrayRenderer content={[makeAskUserQuestion(id)]} {...props} />
    </ExpandKeyProvider>
  );

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
});
