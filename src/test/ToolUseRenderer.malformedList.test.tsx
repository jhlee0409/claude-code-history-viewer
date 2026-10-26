import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ToolUseRenderer } from "@/components/contentRenderer/ToolUseRenderer";
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

vi.mock("@/contexts/theme", () => ({
  useTheme: () => ({ isDarkMode: false }),
}));

describe("ToolUseRenderer - malformed list members", () => {
  it.each([
    ["update_plan", { plan: [null] }],
    ["TodoWrite", { todos: [null] }],
    ["update_plan", { plan: "not a list" }],
    ["TodoWrite", { todos: [null], file_path: "/tmp/a.ts", content: "x" }],
    ["update_plan", { plan: [null], file_path: "/tmp/a.ts", old_string: "a", new_string: "b" }],
    ["TodoWrite", { todos: [null], description: "d", prompt: "p" }],
  ])("falls back to the default renderer for %s with %j", (name, input) => {
    const { container } = render(
      <ExpandKeyProvider value="test-message">
        <ToolUseRenderer toolUse={{ type: "tool_use", id: "nested-tool", name, input }} />
      </ExpandKeyProvider>
    );

    expect(container.textContent).toContain(`${name} common.id: nested-tool`);
    expect(container.textContent).not.toMatch(/tools\.(todoWrite|taskUpdate)/);
  });

  it("still uses the dedicated renderer for well-formed lists", () => {
    const { container } = render(
      <ExpandKeyProvider value="test-message">
        <ToolUseRenderer
          toolUse={{
            type: "tool_use",
            id: "t1",
            name: "TodoWrite",
            input: { todos: [{ content: "write tests", status: "completed" }] },
          }}
        />
      </ExpandKeyProvider>
    );

    expect(container.textContent).toContain("tools.todoWrite");
  });
});
