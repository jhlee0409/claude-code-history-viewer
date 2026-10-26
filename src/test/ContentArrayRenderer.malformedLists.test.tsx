import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ToolExecutionResultRouter } from "@/components/messageRenderer/ToolExecutionResultRouter";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { RendererDefaultsContext } from "@/shared/rendererDefaults";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/contexts/theme", () => ({ useTheme: () => ({ isDarkMode: false }) }));

afterEach(cleanup);
let instance = 0;

function renderNested(name: string, input: Record<string, unknown>) {
  const toolResult = { content: [{ type: "tool_use", id: "nested-tool", name, input }] };
  return render(
    <ExpandKeyProvider value={`malformed-list-${++instance}`}>
      <RendererDefaultsContext.Provider value={{ defaultExpanded: true }}>
        <ToolExecutionResultRouter toolResult={toolResult} />
      </RendererDefaultsContext.Provider>
    </ExpandKeyProvider>
  );
}

const tools = [
  { name: "update_plan", key: "plan", item: { step: "Keep this step", status: "pending" }, title: "tools.taskUpdate", count: "taskOperation.taskCount" },
  { name: "TodoWrite", key: "todos", item: { id: "todo-1", content: "Keep this todo", status: "pending" }, title: "tools.todoWrite", count: "taskOperation.itemCount" },
];

for (const { name, key, item, title, count } of tools) {
  describe(`nested ${name}`, () => {
    for (const [label, members] of [["null member", [null]], ["mixed members", [item, null]]] as const) {
      it(`preserves the entire input as JSON for ${label}`, () => {
        const input = { [key]: members };
        const before = JSON.stringify(input);
        const { container } = renderNested(name, input);
        const json = container.querySelector("pre")?.textContent;
        expect(JSON.parse(json ?? "")).toEqual(input);
        expect(JSON.stringify(input)).toBe(before);
      });
    }

    for (const member of ["unexpected", 42, true, []]) {
      it(`preserves a non-record member ${JSON.stringify(member)} as JSON`, () => {
        const input = { [key]: [member] };
        const { container } = renderNested(name, input);
        expect(JSON.parse(container.querySelector("pre")?.textContent ?? "")).toEqual(input);
      });
    }

    for (const fields of [
      { file_path: "test.txt", content: "Do not treat this as Write" },
      { file_path: "test.txt", old_string: "before", new_string: "after" },
      { description: "Recorded metadata", prompt: "Do not treat this as Task" },
    ]) {
      it(`does not reroute a malformed list based on ${Object.keys(fields).join(", ")}`, () => {
        const input = { [key]: [null], ...fields };
        const { container } = renderNested(name, input);
        expect(JSON.parse(container.querySelector("pre")?.textContent ?? "")).toEqual(input);
      });
    }

    it("still renders a valid list as structured content", () => {
      const { container } = renderNested(name, { [key]: [item] });
      expect(container.textContent).toContain(title);
      expect(container.textContent).toContain(count + ":1");
      expect(container.textContent).toContain("step" in item ? item.step : item.content);
      expect(container.querySelector("pre")).toBeNull();
    });

    for (const [label, input] of [
      ["empty list", { [key]: [] }],
      ["missing list", {}],
      ["null list", { [key]: null }],
    ] as const) {
      it(`keeps the existing empty structured view for ${label}`, () => {
        const { container } = renderNested(name, input);
        expect(container.textContent).toContain(title);
        expect(container.textContent).toContain(count + ":0");
        expect(container.querySelector("pre")).toBeNull();
      });
    }
  });
}
