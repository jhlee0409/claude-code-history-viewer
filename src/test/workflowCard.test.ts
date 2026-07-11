import { describe, it, expect } from "vitest";
import {
  parseWorkflowRunId,
  parseWorkflowName,
} from "../components/contentRenderer/unifiedCards/workflowParsing";

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
