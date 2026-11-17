import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { ClaudeContentArrayRenderer } from "@/components/contentRenderer/ClaudeContentArrayRenderer";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const makeToolUse = (id: string, input: unknown) => ({
  type: "tool_use",
  id,
  name: "AskUserQuestion",
  input,
});

const renderContent = (
  id: string,
  input: unknown,
  props: { searchQuery?: string; isCurrentMatch?: boolean; currentMatchIndex?: number } = {}
) =>
  render(
    <ExpandKeyProvider value="test-message">
      <ClaudeContentArrayRenderer content={[makeToolUse(id, input)]} {...props} />
    </ExpandKeyProvider>
  );

const validInput = {
  questions: [
    {
      question: "Which storage backend?",
      header: "Storage",
      multiSelect: false,
      options: [
        { label: "SQLite", description: "Bundled file database" },
        { label: "PostgreSQL", description: "Networked server" },
      ],
    },
  ],
};

describe("AskUserQuestionCard (#429)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the question, header, and option labels/descriptions when expanded", () => {
    // Search match forces the collapsed card open so its content is asserted.
    const { container } = renderContent("ask_1", validInput, { searchQuery: "PostgreSQL" });

    expect(container.textContent).toContain("Which storage backend?");
    expect(container.textContent).toContain("Storage");
    expect(container.textContent).toContain("SQLite");
    expect(container.textContent).toContain("Bundled file database");
    expect(container.textContent).toContain("Networked server");

    // The matched option label is highlighted, not shown as raw JSON.
    const marks = container.querySelectorAll("mark");
    expect(marks.length).toBeGreaterThan(0);
    expect(
      Array.from(marks).some((m) => m.textContent === "PostgreSQL")
    ).toBe(true);
    // Not the generic JSON fallback.
    expect(container.textContent).not.toContain('"multiSelect"');
  });

  it("falls back to the generic renderer for an unrecognized input shape", () => {
    // Missing `questions` → parse returns null → DefaultCard JSON fallback.
    const { container } = renderContent(
      "ask_bad",
      { prompt: "not a questions array" },
      { searchQuery: "questions array" }
    );

    // DefaultCard renders the raw input JSON (auto-expanded on match).
    expect(container.textContent).toContain("not a questions array");
    expect(container.textContent).toContain('"prompt"');
  });

  // TR1a: the row's target is the first question; when its ellipsis hides
  // the hit, the opened detail shows it highlighted.
  it("a hit in a long question opens the row and is highlighted in the detail", () => {
    const question = `${"Which of the storage backends we evaluated last quarter ".repeat(4)}handles needle-writes?`;
    const { container } = renderContent("ask_long", { questions: [{ question, options: [{ label: "SQLite" }] }] }, { searchQuery: "needle-writes", isCurrentMatch: true, currentMatchIndex: 0 });
    const detail = container.querySelector("[data-tool-detail]:not([hidden])");
    expect(detail, "the opened detail").not.toBeNull();
    expect([...(detail as Element).querySelectorAll("mark")].map((m) => m.textContent)).toContain("needle-writes");
  });

  it("the row says the recorded tool name and the first question", () => {
    const { container } = renderContent("ask_head", validInput);
    const row = container.querySelector("[data-tool-row]");
    expect(row, "a ToolRow head").not.toBeNull();
    expect(row?.querySelector("[data-tool-verb]")?.textContent).toBe("AskUserQuestion");
    expect(row?.textContent).toContain("Which storage backend?");
  });
});
