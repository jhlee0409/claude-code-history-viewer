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
});
