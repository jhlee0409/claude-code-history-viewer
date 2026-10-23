/**
 * Tool outcome verdict table (plan §4.2, TR0 tests-first list).
 *
 * Every row states lifecycle / verdict / reason / exit code and whether the
 * call may join a folded read·search run (`toolRun`, §4.2 last paragraph).
 * Rows mirror the recorded Claude result shapes the #727 contract preserves
 * (docs/contracts/tool-result-metadata.md) and the harness fixtures
 * (scripts/ui-capture/fixtures/inner.mjs: outcomes, unknown-outcome).
 */
import { describe, expect, it } from "vitest";
import {
  isToolRunEligible,
  normalizeResult,
  toolFamily,
  toolOutcome,
  type ToolFamily,
  type ToolOutcome,
  type ToolResultLike,
  type ToolUseLike,
} from "./toolOutcome";

const call = (name: string, id = "toolu_1"): ToolUseLike => ({ type: "tool_use", id, name, input: {} });

/** A result block carrying its own per-result metadata (`single_result`). */
const result = (content: unknown, extra: Record<string, unknown> = {}): ToolResultLike => ({
  type: "tool_result",
  tool_use_id: "toolu_1",
  content,
  ...extra,
});
const own = (toolUseResult: unknown) => ({
  toolUseResult,
  toolUseResultSource: { messageUuid: "u-1", sessionId: "s-1", contentIndex: 0, association: "single_result" },
});

/** The audit gallery's E15 payload byte for byte (no exit code, no is_error). */
const E15 = { stdout: "", stderr: "fatal: not a git repository (or any of the parent directories): .git", interrupted: false };

interface Row {
  name: string;
  use: ToolUseLike | null;
  results: ToolResultLike[];
  family: ToolFamily;
  expected: ToolOutcome;
  run: boolean;
}

const ROWS: Row[] = [
  {
    name: "no result at all (process)",
    use: call("Bash"),
    results: [],
    family: "process",
    expected: { lifecycle: "no-result", verdict: "unknown", reason: "no-result-recorded" },
    run: false,
  },
  {
    name: "no result at all (read)",
    use: call("Read"),
    results: [],
    family: "read-search",
    expected: { lifecycle: "no-result", verdict: "unknown", reason: "no-result-recorded" },
    run: false,
  },
  {
    name: "interrupted, no exit code",
    use: call("Bash"),
    results: [result("[Request interrupted by user for tool use]", own({ stdout: "Running", stderr: "", interrupted: true }))],
    family: "process",
    expected: { lifecycle: "interrupted", verdict: "unknown", reason: "interrupted" },
    run: false,
  },
  {
    name: "interrupted + exit code 2",
    use: call("Bash"),
    results: [result("partial", own({ stdout: "partial", stderr: "", interrupted: true, exitCode: 2 }))],
    family: "process",
    expected: { lifecycle: "interrupted", verdict: "failed", reason: "interrupted", exitCode: 2 },
    run: false,
  },
  {
    name: "interrupted wins over is_error (fixture: e2e, exit 130)",
    use: call("Bash"),
    results: [result("[Request interrupted by user for tool use]", { is_error: true, ...own({ stdout: "Running 48 tests using 4 workers", stderr: "", interrupted: true, isImage: false, exitCode: 130 }) })],
    family: "process",
    expected: { lifecycle: "interrupted", verdict: "failed", reason: "interrupted", exitCode: 130 },
    run: false,
  },
  {
    name: "is_error: true (provider error)",
    use: call("Read"),
    results: [result("<tool_use_error>File does not exist.</tool_use_error>", { is_error: true })],
    family: "read-search",
    expected: { lifecycle: "completed", verdict: "failed", reason: "provider-error" },
    run: false,
  },
  {
    name: "is_error: true + exit code 1 (fixture: build)",
    use: call("Bash"),
    results: [result("Exit code 1\nerror TS2322", { is_error: true, ...own({ stdout: "", stderr: "error TS2322", interrupted: false, isImage: false, exitCode: 1 }) })],
    family: "process",
    expected: { lifecycle: "completed", verdict: "failed", reason: "provider-error", exitCode: 1 },
    run: false,
  },
  {
    name: "error_code in the content object",
    use: call("WebFetch"),
    results: [result({ type: "web_fetch_tool_error", error_code: "url_not_accessible" })],
    family: "read-search",
    expected: { lifecycle: "completed", verdict: "failed", reason: "api-error-code", errorCode: "url_not_accessible" },
    run: false,
  },
  {
    name: "error_code in the result's own toolUseResult (fixture: WebFetch)",
    use: call("WebFetch"),
    results: [result([{ type: "text", text: "{\"error_code\":\"url_not_accessible\"}" }], own({ error_code: "url_not_accessible" }))],
    family: "read-search",
    expected: { lifecycle: "completed", verdict: "failed", reason: "api-error-code", errorCode: "url_not_accessible" },
    run: false,
  },
  {
    name: "content string starting with `error` (existing isError rule)",
    use: call("Grep"),
    results: [result("Error: path does not exist")],
    family: "read-search",
    expected: { lifecycle: "completed", verdict: "failed", reason: "error-content" },
    run: false,
  },
  {
    name: "`errors found` is not the error word (\\b)",
    use: call("Grep"),
    results: [result("errors found: 0")],
    family: "read-search",
    expected: { lifecycle: "completed", verdict: "succeeded", reason: "no-error-signal" },
    run: true,
  },
  {
    name: "exit code 0 (process)",
    use: call("Bash"),
    results: [result("ok", own({ stdout: "ok", stderr: "", interrupted: false, exitCode: 0 }))],
    family: "process",
    expected: { lifecycle: "completed", verdict: "succeeded", reason: "exit-zero", exitCode: 0 },
    run: false,
  },
  {
    name: "exit code 1 (process)",
    use: call("Bash"),
    results: [result("boom", own({ stdout: "", stderr: "boom", interrupted: false, exitCode: 1 }))],
    family: "process",
    expected: { lifecycle: "completed", verdict: "failed", reason: "exit-nonzero", exitCode: 1 },
    run: false,
  },
  {
    name: "no exit code (process) claims no success",
    use: call("Bash"),
    results: [result("ok", own({ stdout: "ok", stderr: "", interrupted: false }))],
    family: "process",
    expected: { lifecycle: "completed", verdict: "unknown", reason: "no-exit-code" },
    run: false,
  },
  {
    name: "exit code 0 + stderr warning (stderr is not a verdict)",
    use: call("Bash"),
    results: [result("warning\n✔ ok", own({ stdout: "✔ ok", stderr: "warning: React version not specified", interrupted: false, isImage: false, exitCode: 0 }))],
    family: "process",
    expected: { lifecycle: "completed", verdict: "succeeded", reason: "exit-zero", exitCode: 0 },
    run: false,
  },
  {
    name: "E15 raw: empty stdout + fatal stderr, no exit code",
    use: call("Bash"),
    results: [result(E15.stderr, own({ ...E15 }))],
    family: "process",
    expected: { lifecycle: "completed", verdict: "unknown", reason: "no-exit-code" },
    run: false,
  },
  {
    name: "is_error: false + exit code 2 (conflict: the exit code wins)",
    use: call("Bash"),
    results: [result("CONFLICT (content)", { is_error: false, ...own({ stdout: "CONFLICT (content)", stderr: "", interrupted: false, isImage: false, exitCode: 2 }) })],
    family: "process",
    expected: { lifecycle: "completed", verdict: "failed", reason: "conflict", exitCode: 2 },
    run: false,
  },
  {
    name: "is_error: true + exit code 0 (conflict: failed)",
    use: call("Bash"),
    results: [result("odd", { is_error: true, ...own({ stdout: "odd", stderr: "", interrupted: false, exitCode: 0 }) })],
    family: "process",
    expected: { lifecycle: "completed", verdict: "failed", reason: "conflict", exitCode: 0 },
    run: false,
  },
  {
    name: "read tool result without an error signal",
    use: call("Read"),
    results: [result("     1→export * from \"./preview\";", own({ type: "text", file: { filePath: "/repo/src/index.ts", content: "export * from \"./preview\";\n", numLines: 1, startLine: 1, totalLines: 1 } }))],
    family: "read-search",
    expected: { lifecycle: "completed", verdict: "succeeded", reason: "no-error-signal" },
    run: true,
  },
  {
    name: "Grep files_with_matches without an error signal",
    use: call("Grep"),
    results: [result("src/a.ts\nsrc/b.ts", own({ mode: "files_with_matches", numFiles: 2, filenames: ["src/a.ts", "src/b.ts"] }))],
    family: "read-search",
    expected: { lifecycle: "completed", verdict: "succeeded", reason: "no-error-signal" },
    run: true,
  },
  {
    name: "WebFetch HTTP `code: 200` is not an exit code (read·search)",
    use: call("WebFetch"),
    results: [result("2.3 adds retry headers.", own({ code: 200, codeText: "OK", result: "2.3 adds retry headers.", bytes: 2048, durationMs: 120, url: "https://example.com/changelog" }))],
    family: "read-search",
    expected: { lifecycle: "completed", verdict: "succeeded", reason: "no-error-signal" },
    run: true,
  },
  {
    name: "alias return_code in the content object (code execution)",
    use: call("code_execution"),
    results: [result({ type: "code_execution_result", stdout: "", stderr: "", return_code: 0 })],
    family: "process",
    expected: { lifecycle: "completed", verdict: "succeeded", reason: "exit-zero", exitCode: 0 },
    run: false,
  },
  {
    name: "alias exitCode in the own toolUseResult",
    use: call("Bash"),
    results: [result("x", own({ exitCode: 3 }))],
    family: "process",
    expected: { lifecycle: "completed", verdict: "failed", reason: "exit-nonzero", exitCode: 3 },
    run: false,
  },
  {
    name: "alias exit_code in the content object",
    use: call("exec_command"),
    results: [result({ stdout: "done", exit_code: 0 })],
    family: "process",
    expected: { lifecycle: "completed", verdict: "succeeded", reason: "exit-zero", exitCode: 0 },
    run: false,
  },
  {
    name: "alias returncode in a nested result object",
    use: call("Bash"),
    results: [result({ result: { returncode: 4 } })],
    family: "process",
    expected: { lifecycle: "completed", verdict: "failed", reason: "exit-nonzero", exitCode: 4 },
    run: false,
  },
  {
    name: "alias code (process tools only) in the own nested result",
    use: call("shell"),
    results: [result("x", own({ result: { code: 0 } }))],
    family: "process",
    expected: { lifecycle: "completed", verdict: "succeeded", reason: "exit-zero", exitCode: 0 },
    run: false,
  },
  {
    name: "two recorded exit codes that disagree (conflict, non-zero wins)",
    use: call("Bash"),
    results: [result({ stdout: "x", exit_code: 0 }, own({ exitCode: 1 }))],
    family: "process",
    expected: { lifecycle: "completed", verdict: "failed", reason: "conflict", exitCode: 1 },
    run: false,
  },
  {
    name: "page-boundary orphan result (no tool_use in the window)",
    use: null,
    results: [result("ok: 3 files changed", own({ stdout: "ok: 3 files changed", stderr: "", interrupted: false, isImage: false }))],
    family: "other",
    expected: { lifecycle: "completed", verdict: "unknown", reason: "no-error-signal" },
    run: false,
  },
  {
    name: "page-boundary orphan of a read tool still breaks a run",
    use: null,
    results: [result("     1→x")],
    family: "read-search",
    expected: { lifecycle: "completed", verdict: "succeeded", reason: "no-error-signal" },
    run: false,
  },
  {
    name: "unassigned multi-result payload is ignored for the individual outcome",
    use: call("Bash"),
    results: [
      result("out", {
        toolUseResultSource: {
          messageUuid: "multi",
          sessionId: "s-1",
          contentIndex: 1,
          association: "unassigned",
          resultContentIndices: [1, 2],
          unassignedToolUseResult: { exitCode: 2, interrupted: true, stderr: "not attributable", is_error: true, error_code: "x" },
        },
      }),
    ],
    family: "process",
    expected: { lifecycle: "completed", verdict: "unknown", reason: "no-exit-code" },
    run: false,
  },
  {
    name: "a toolUseResult beside an unassigned envelope is not per-result data",
    use: call("Read"),
    results: [
      result("inline", {
        toolUseResult: { exitCode: 2, error_code: "x" },
        toolUseResultSource: { messageUuid: "r-inline", sessionId: "s", contentIndex: 0, association: "unassigned", resultContentIndices: [0], unassignedToolUseResult: { outer: "must not replace inline" } },
      }),
    ],
    family: "read-search",
    expected: { lifecycle: "completed", verdict: "succeeded", reason: "no-error-signal" },
    run: true,
  },
  {
    name: "prose `Exit code 1` and stderr never become an exit code",
    use: call("Bash"),
    results: [result("Exit code 1\nboom", own({ stdout: "", stderr: "exit code 1" }))],
    family: "process",
    expected: { lifecycle: "completed", verdict: "unknown", reason: "no-exit-code" },
    run: false,
  },
  {
    name: "a string exit code is not a number (`\"0\"`)",
    use: call("Bash"),
    results: [result("ok", own({ stdout: "ok", exitCode: "0" }))],
    family: "process",
    expected: { lifecycle: "completed", verdict: "unknown", reason: "no-exit-code" },
    run: false,
  },
  {
    name: "exit code null is absent",
    use: call("Bash"),
    results: [result("ok", own({ stdout: "ok", exitCode: null }))],
    family: "process",
    expected: { lifecycle: "completed", verdict: "unknown", reason: "no-exit-code" },
    run: false,
  },
  {
    name: "two results, one with an error, fail together",
    use: call("Bash"),
    results: [result("ok", own({ stdout: "ok", exitCode: 0 })), result("Error: second", { is_error: true })],
    family: "process",
    expected: { lifecycle: "completed", verdict: "failed", reason: "conflict", exitCode: 0 },
    run: false,
  },
  {
    name: "other tools (edit, MCP): completed but unknown",
    use: call("Edit"),
    results: [result("The file /repo/src/a.ts has been updated.")],
    family: "other",
    expected: { lifecycle: "completed", verdict: "unknown", reason: "no-error-signal" },
    run: false,
  },
];

describe("toolOutcome: verdict table (§4.2)", () => {
  it.each(ROWS.map((row) => [row.name, row] as const))("%s", (_name, row) => {
    expect(toolOutcome(row.use, row.results, row.family)).toStrictEqual(row.expected);
  });

  it.each(ROWS.map((row) => [row.name, row] as const))("toolRun eligibility: %s", (_name, row) => {
    expect(isToolRunEligible(row.use, row.results, row.family)).toBe(row.run);
  });
});

describe("normalizeResult: present 0 / false / \"\" / null / absent stay distinct", () => {
  it("E15: stdout \"\", stderr kept, interrupted false, no exit code synthesized", () => {
    const n = normalizeResult(result(E15.stderr, own({ ...E15 })));
    expect(n.stdout).toBe("");
    expect(n.stderr).toBe(E15.stderr);
    expect(n.interrupted).toBe(false);
    expect("exitCode" in n).toBe(false);
    expect("isError" in n).toBe(false);
  });

  it("exit code 0 is recorded, null / a string / absent are not", () => {
    expect(normalizeResult(result("x", own({ exitCode: 0 }))).exitCode).toBe(0);
    expect("exitCode" in normalizeResult(result("x", own({ exitCode: null })))).toBe(false);
    expect("exitCode" in normalizeResult(result("x", own({ exitCode: "0" })))).toBe(false);
    expect("exitCode" in normalizeResult(result("x", own({})))).toBe(false);
  });

  it("is_error false is kept as false; absent / null are not an error flag", () => {
    expect(normalizeResult(result("x", { is_error: false })).isError).toBe(false);
    expect(normalizeResult(result("x", { is_error: true })).isError).toBe(true);
    expect("isError" in normalizeResult(result("x"))).toBe(false);
    expect("isError" in normalizeResult(result("x", { is_error: null }))).toBe(false);
  });

  it("stdout \"\" differs from absent stdout; interrupted false from absent", () => {
    const empty = normalizeResult(result("x", own({ stdout: "", interrupted: false })));
    expect(empty.stdout).toBe("");
    expect(empty.interrupted).toBe(false);
    const none = normalizeResult(result("x", own({})));
    expect("stdout" in none).toBe(false);
    expect("interrupted" in none).toBe(false);
  });

  it("the plain content string is kept as text, an empty string included", () => {
    expect(normalizeResult(result("a\nb")).text).toBe("a\nb");
    expect(normalizeResult(result("")).text).toBe("");
    expect("text" in normalizeResult(result([{ type: "text", text: "x" }]))).toBe(false);
  });

  it("the bare `code` alias is an exit code only when asked (process tools)", () => {
    const http = result("x", own({ code: 200, codeText: "OK" }));
    expect("exitCode" in normalizeResult(http)).toBe(false);
    expect(normalizeResult(http, { bareCodeIsExitCode: true }).exitCode).toBe(200);
  });

  it("the unassigned payload never reaches the normalized result", () => {
    const n = normalizeResult(
      result("out", {
        toolUseResultSource: { messageUuid: "m", sessionId: "s", contentIndex: 1, association: "unassigned", resultContentIndices: [1, 2], unassignedToolUseResult: { exitCode: 2, stderr: "x", interrupted: true } },
      }),
    );
    expect(n).toStrictEqual({ text: "out" });
  });
});

describe("toolFamily", () => {
  it.each([
    ["Bash", "process"],
    ["bash", "process"],
    ["shell", "process"],
    ["exec_command", "process"],
    ["code_execution", "process"],
    ["bash_code_execution", "process"],
    ["Read", "read-search"],
    ["read_file", "read-search"],
    ["Grep", "read-search"],
    ["Glob", "read-search"],
    ["LS", "read-search"],
    ["list_dir", "read-search"],
    ["WebSearch", "read-search"],
    ["web_fetch", "read-search"],
    ["WebFetch", "read-search"],
    ["Edit", "other"],
    ["Write", "other"],
    ["mcp__github__create_issue", "other"],
    ["Task", "other"],
    ["", "other"],
  ] as const)("%s → %s", (name, family) => {
    expect(toolFamily(name)).toBe(family);
  });
});
