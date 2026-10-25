import { describe, it, expect, beforeEach } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import {
  parseWorkflowRunId,
  parseWorkflowName,
} from "../components/contentRenderer/unifiedCards/workflowParsing";
import { UnifiedToolExecutionRenderer } from "../components/contentRenderer/UnifiedToolExecutionRenderer";
import { ExpandKeyProvider } from "../contexts/CaptureExpandContext";
import { useExpandRegistry } from "../store/expandRegistryStore";

// The Workflow tool_result is the only place the run id (wf_…) appears in the
// main transcript — parsing it is what anchors the WorkflowCard to the agent
// transcripts stored under subagents/workflows/<run>/ (#449).
describe("parseWorkflowRunId", () => {
  const launchText =
    "Workflow launched in background. Task ID: w364rnvi4\n" +
    "Summary: Confirm schemas before building\n" +
    "Transcript dir: /Users/x/.claude/projects/-p/abc/subagents/workflows/wf_1a198a78-3be\n" +
    "Script file: /Users/x/.claude/projects/-p/abc/workflows/scripts/verify-wf_1a198a78-3be.js";

  it("extracts the run id from a string tool_result", () => {
    expect(parseWorkflowRunId([{ content: launchText }])).toBe(
      "wf_1a198a78-3be",
    );
  });

  it("extracts the run id from array-of-text-blocks content", () => {
    expect(
      parseWorkflowRunId([{ content: [{ type: "text", text: launchText }] }]),
    ).toBe("wf_1a198a78-3be");
  });

  it("handles Windows-style path separators", () => {
    expect(
      parseWorkflowRunId([
        { content: "Transcript dir: C:\\u\\abc\\subagents\\workflows\\wf_9aac0291-563" },
      ]),
    ).toBe("wf_9aac0291-563");
  });

  it("returns null when the result has no transcript dir", () => {
    expect(parseWorkflowRunId([{ content: "Workflow failed to start" }])).toBe(
      null,
    );
    expect(parseWorkflowRunId([])).toBe(null);
  });
});

describe("parseWorkflowName", () => {
  it("reads the name from the script meta block", () => {
    const script =
      "export const meta = {\n  name: 'verify-amazon-q-cli',\n  description: 'x',\n}\nphase('Verify')";
    expect(parseWorkflowName(script)).toBe("verify-amazon-q-cli");
  });

  it("supports double quotes", () => {
    expect(parseWorkflowName('const meta = { name: "review-changes" }')).toBe(
      "review-changes",
    );
  });

  it("returns null for scripts without a meta name", () => {
    expect(parseWorkflowName("const x = 1")).toBe(null);
    expect(parseWorkflowName(null)).toBe(null);
  });
});

// TR1a: the Workflow card is a ToolRow whose target is the workflow name;
// search reaches it (the old card took no search props). A hit the row's
// ellipsis hides is highlighted in the opened detail.
describe("WorkflowCard search (TR1a)", () => {
  beforeEach(() => useExpandRegistry.getState().clearAll());

  const renderWorkflow = (id: string, name: string, searchQuery: string, results: Record<string, unknown>[] = []) =>
    render(
      createElement(
        ExpandKeyProvider,
        { value: "wf-msg" },
        createElement(UnifiedToolExecutionRenderer, {
          toolUse: { type: "tool_use", id, name: "Workflow", input: { description: "Verify the schemas", script: `export const meta = { name: '${name}' };` } },
          toolResults: results.map((r) => ({ type: "tool_result", tool_use_id: id, ...r })),
          searchQuery,
          isCurrentMatch: true,
          currentMatchIndex: 0,
        }),
      ),
    );

  it("a hit in a long workflow name opens the row; the detail repeats the name highlighted", () => {
    const name = `verify-${"amazon-q-cli-".repeat(10)}needle`;
    const { container } = renderWorkflow("wf_search_1", name, "needle");
    const detail = container.querySelector("[data-tool-detail]:not([hidden])");
    expect(detail, "the opened detail").not.toBeNull();
    expect([...(detail as Element).querySelectorAll("mark")].map((m) => m.textContent)).toContain("needle");
  });

  it("a hit in the run id opens the row and highlights it in the detail meta", () => {
    const { container } = renderWorkflow("wf_search_2", "triage", "wf_9aac0291", [{ content: "Transcript dir: /p/subagents/workflows/wf_9aac0291-563" }]);
    const meta = container.querySelector("[data-tool-detail]:not([hidden]) > [data-meta]");
    expect(meta, "the opened detail's meta line").not.toBeNull();
    expect([...(meta as Element).querySelectorAll("mark")].map((m) => m.textContent)).toContain("wf_9aac0291");
  });

  it("no hit: the row stays closed and nothing is marked", () => {
    const { container } = renderWorkflow("wf_search_3", "triage", "nonexistent");
    expect(container.querySelector("[data-tool-detail]:not([hidden])")).toBeNull();
    expect(container.querySelector("mark")).toBeNull();
  });
});
