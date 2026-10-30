/** Structural-only replicas: no user text copied. Local scan: Claude Bash 3582,
 * is_error:false 3468, error-prefix 17, exit aliases 0; Pi/OMP false 18279,
 * error-prefix 53. Source references: docs/contracts/producer-outcome-ground-truth.md.
 */
import { describe, expect, it } from "vitest";
import { isToolRunEligible, normalizeResult, resultContent, toolFamily, toolOutcome, type ToolResultLike } from "./toolOutcome";

const claude = (flag?: boolean, content: unknown = "error: synthetic diagnostic printed by a successful command"): ToolResultLike => ({
  type: "tool_result", tool_use_id: "synthetic-call", content,
  ...(flag === undefined ? {} : { is_error: flag }),
  toolUseResult: { stdout: typeof content === "string" ? content : "", stderr: "", interrupted: false, isImage: false, noOutputExpected: false },
});
const pi = (flag: boolean): ToolResultLike => ({
  type: "tool_result", tool_use_id: "synthetic-call", is_error: flag,
  content: [{ type: "text", text: "error: synthetic stdout" }],
});

describe("C1: producer flags, not prose", () => {
  it("Claude Bash no-error is not flipped by an error-prefixed stdout", () => {
    expect(toolOutcome(null, [claude(false)], "process", "claude")).toEqual({ lifecycle: "completed", verdict: "unknown", reason: "no-exit-code" });
  });
  it.each(["pi", "ompi"])("%s keeps both false and true producer flags, without interpreting opaque details", provider => {
    const r = pi(false);
    expect(normalizeResult(r, { provider }).isError).toBe(false);
    expect(toolOutcome(null, [r], "process", provider).verdict).toBe("unknown");
    expect(toolOutcome(null, [pi(true)], "process", provider).verdict).toBe("failed");
    expect(normalizeResult({ ...r, toolUseResult: { ...r.toolUseResult as object, isError: true } }, { provider }).isError).toBe(true);
  });
  it.each(["claude", "pi", "ompi", "codex", "opencode", "kilo", "copilot"])("%s: prose alone has no grounded failure verdict", provider => {
    expect(toolOutcome(null, [{ content: "Error: could be ordinary file contents" }], "process", provider).verdict).toBe("unknown");
    expect(toolOutcome(null, [{ content: "Error: ordinary file contents" }], "read-search", provider).verdict).toBe(provider === "claude" ? "succeeded" : "unknown");
  });
  it("genuine producer error still fails, even after a no-error sibling", () => {
    expect(toolOutcome(null, [claude(false), claude(true)], "process", "claude")).toMatchObject({ verdict: "failed", reason: "provider-error" });
  });
  it("multi-part output remains ordered and flags belong to the whole result", () => {
    const parts = [{ type: "text", text: "error: synthetic stdout" }, { type: "image", source: { type: "url", url: "https://example.invalid/image.png" } }, { type: "text", text: "synthetic tail" }];
    const r = claude(false, parts);
    expect(toolOutcome(null, [r], "process", "claude").verdict).toBe("unknown");
    expect(resultContent(r).parts).toEqual([{ kind: "text", text: "error: synthetic stdout" }, { kind: "other", value: [parts[1]] }, { kind: "text", text: "synthetic tail" }]);
  });
});

// Exact preserved state/extras shapes, synthetic values; source-shaped, not live records.
const coreResult = (exit: unknown, output = "synthetic output", status = "completed"): ToolResultLike => ({
  type: "tool_result", tool_use_id: "synthetic-core", content: output,
  toolUseResult: { status, input: { command: "false" }, output, title: "synthetic command", metadata: { output, exit, description: "synthetic command" }, time: { start: 1, end: 2 } },
});
const handsResult = (exit: unknown, isError = false): ToolResultLike => ({
  type: "tool_result", tool_use_id: "synthetic-hands", content: "synthetic command output", is_error: isError,
  toolUseResult: { command: "synthetic command", metadata: { exit_code: exit, pid: -1, prefix: "", suffix: "" }, hidden: false },
});

describe("C2: completed is lifecycle, metadata.exit is the process result", () => {
  for (const provider of ["opencode", "kilo"]) {
    it.each([0, 1, 2])(`${provider}: recorded exit %s`, exit => {
      expect(toolOutcome(null, [coreResult(exit)], "process", provider)).toEqual({ lifecycle: "completed", verdict: exit === 0 ? "succeeded" : "failed", reason: exit === 0 ? "exit-zero" : "exit-nonzero", exitCode: exit });
    });
    it.each([null, undefined, "0", false])(`${provider}: unavailable exit %s never becomes success`, exit => {
      expect(toolOutcome(null, [coreResult(exit)], "process", provider)).toEqual({ lifecycle: "completed", verdict: "unknown", reason: "no-exit-code" });
      // Non-process normal return is completed; thrown failure is error:
      // https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/session/prompt.ts#L1115-L1160
      expect(toolOutcome({ name: "Read" }, [coreResult(exit)], "read-search", provider).verdict).toBe("succeeded");
    });
    it(`${provider}: sibling codes conflict; status:error stays an error`, () => {
      expect(toolOutcome(null, [coreResult(0), coreResult(2)], "process", provider)).toMatchObject({ verdict: "failed", reason: "conflict", exitCode: 2 });
      expect(toolOutcome(null, [coreResult(0, "synthetic", "error")], "process", provider)).toMatchObject({ verdict: "failed", reason: "provider-error" });
    });
    it(`${provider}: metadata.exit never leaks to other provider contracts`, () => {
      for (const other of ["claude", "pi", "ompi", "codex", "openhands", "copilot"]) expect(normalizeResult(coreResult(1), { provider: other }).exitCode).toBeUndefined();
    });
  }
  it.each(["\n\n(Command was aborted)", "\n\n(Command timed out after 1000 ms)"])("OpenCode producer suffix %s is interruption, not success", suffix => {
    expect(toolOutcome(null, [coreResult(null, `synthetic output${suffix}`)], "process", "opencode")).toEqual({ lifecycle: "interrupted", verdict: "unknown", reason: "interrupted" });
    expect(toolOutcome(null, [coreResult(1, `synthetic output${suffix}`)], "process", "opencode")).toMatchObject({ lifecycle: "interrupted", verdict: "failed", exitCode: 1 });
  });
  it("Kilo has its own independently verified bash_metadata grammar", () => {
    for (const note of ["User aborted the command", "bash tool terminated command after exceeding timeout 1000 ms. If this command is expected to take longer and is not waiting for interactive input, retry with a larger timeout value in milliseconds."]) {
      const r = coreResult(null, `synthetic output\n\n<bash_metadata>\n${note}\n</bash_metadata>`);
      expect(toolOutcome(null, [r], "process", "kilo").lifecycle).toBe("interrupted");
      expect(toolOutcome(null, [r], "process", "claude").lifecycle).toBe("completed");
    }
    expect(toolOutcome(null, [coreResult(null, "User aborted the command")], "process", "kilo").lifecycle).toBe("completed");
  });
  it("does not invent an OpenCode cancelled enum or parse stdout markers without source state", () => {
    expect(toolOutcome(null, [coreResult(undefined, "synthetic", "cancelled")], "process", "opencode").lifecycle).toBe("completed");
    expect(toolOutcome(null, [{ content: "\n\n(Command was aborted)" }], "process", "opencode").lifecycle).toBe("completed");
  });
});

describe("round-2 producer regressions", () => {
  // OpenCode prompt.ts@b9a39b8:598-644 drops MCP isError; AI SDK 5.0.8
  // mcp-client.ts@718e5291:287-307 returns error results without throwing.
  it.each(["opencode", "kilo"])("%s excludes MCP/plugin/unknown completed tools", provider => {
    for (const name of ["context7_resolve-library-id", "mcp__server__read", "custom_plugin", "unknown", "read_file", "Grep", "read", ...(provider === "kilo" ? ["list"] : [])]) {
      expect(toolOutcome({ name }, [coreResult(undefined)], toolFamily(name), provider).verdict).toBe("unknown");
    }
    expect(toolOutcome(null, [coreResult(undefined)], "read-search", provider).verdict).toBe("unknown");
  });
  it.each(["Command failed\n\nsynthetic\n\nCommand exited with code 2", "Command failed\n\nCommand timed out after 1000 ms"])("Pi historical bash false is not success: %s", content => {
    expect(toolOutcome({ name: "bash" }, [{ type: "tool_result", content, is_error: false }], "process", "pi").verdict).toBe("unknown");
  });
  it("OMP forwarded write false stays unknown even with an Error prefix", () => {
    expect(toolOutcome({ name: "write" }, [{ type: "tool_result", content: "Error: synthetic device failure", is_error: false }], "other", "ompi").verdict).toBe("unknown");
  });
  it("Kilo shell metadata is bounded by the first closing marker", () => {
    const output = "synthetic\n\n<shell_metadata>\nshell tool terminated command after exceeding timeout 1000 ms.\n</shell_metadata>\nordinary output\n</shell_metadata>";
    expect(toolOutcome({ name: "bash" }, [coreResult(null, output)], "process", "kilo").lifecycle).toBe("completed");
  });
});

describe("round-1 producer regressions", () => {
  it.each(["opencode", "kilo"])("%s non-process completed restores read folding and edit success", provider => {
    // prompt.ts@b9a39b8:1115-1160; Kilo processor.ts@0a9faef:271-310.
    for (const name of ["Read", "Glob", "Edit", "Write", "WebFetch", ...(provider === "opencode" ? ["list"] : [])]) {
      const use = { name };
      const family = toolFamily(name);
      const r = coreResult(undefined);
      expect(toolOutcome(use, [r], family, provider).verdict).toBe("succeeded");
      expect(isToolRunEligible(use, [r], family, provider)).toBe(family === "read-search");
      expect(toolOutcome(use, [coreResult(undefined, "synthetic", "error")], family, provider).verdict).toBe("failed");
      expect(toolOutcome(use, [r, { content: "unverified sibling" }], family, provider).verdict).toBe("unknown");
    }
  });
  // Kilo shell.ts@0a9faef:687-723; command-timeout.ts:32-41 (environment message).
  it.each([
    "User aborted the command",
    "shell tool terminated command after exceeding timeout 1000 ms. If this command is expected to take longer and is not waiting for interactive input, retry with a larger timeout value in milliseconds.",
    "shell tool terminated command after exceeding environment timeout 1000 ms. synthetic deployment note\nsecond line",
  ])("Kilo current shell_metadata interruption: %s", note => {
    const r = coreResult(null, `synthetic output\n\n<shell_metadata>\n${note}\n</shell_metadata>`);
    expect(toolOutcome({ name: "bash" }, [r], "process", "kilo")).toMatchObject({ lifecycle: "interrupted", verdict: "unknown" });
    expect(toolOutcome(null, [r], "process", "opencode").lifecycle).toBe("completed");
    expect(toolOutcome(null, [coreResult(null, note)], "process", "kilo").lifecycle).toBe("completed");
    expect(toolOutcome(null, [coreResult(null, `${r.content}\ntrailing text`)], "process", "kilo").lifecycle).toBe("completed");
  });
  // pi-mono@a922830 edit.ts:159-211/write.ts:67-89 throw/reject failures.
  // OMP 17.3.7 edit/index.ts:191,254,341,363 flags per-file failures;
  // write.ts:1128-1176 forwards xd:// inner results, so write is NOT certified.
  it.each(["pi", "ompi"])("%s named edit/write success follows its own producer", provider => {
    for (const name of ["edit", "write"]) {
      const use = { name };
      expect(toolOutcome(use, [pi(false)], "other", provider).verdict).toBe(provider === "ompi" && name === "write" ? "unknown" : "succeeded");
      expect(toolOutcome(use, [pi(true)], "other", provider).verdict).toBe("failed");
      expect(toolOutcome(use, [{ content: "synthetic" }], "other", provider).verdict).toBe("unknown");
      expect(toolOutcome(use, [pi(false), { content: "unverified" }], "other", provider).verdict).toBe("unknown");
      expect(isToolRunEligible(use, [pi(false)], "other", provider)).toBe(false);
    }
  });
  // Released v0.6.0@00d82865 and v0.7.9@6bed5a91 resolve nonzero/timeout;
  // agent-loop.ts:196-209 then writes false. A newer single pin is insufficient.
  it("Pi bash false without a recorded exit stays unknown across producer versions", () => {
    expect(toolOutcome({ name: "bash" }, [pi(false)], "process", "pi")).toEqual({ lifecycle: "completed", verdict: "unknown", reason: "no-exit-code" });
    expect(toolOutcome({ name: "bash" }, [pi(true)], "process", "pi").verdict).toBe("failed");
    expect(toolOutcome({ name: "bash" }, [pi(false), { content: "unverified" }], "process", "pi").verdict).toBe("unknown");
    expect(toolOutcome({ name: "shell" }, [pi(false)], "process", "pi").verdict).toBe("unknown");
    expect(toolOutcome({ name: "bash" }, [pi(false)], "process", "ompi").verdict).toBe("unknown");
  });
});

describe("C3/C4: OpenHands unavailable sentinel and backend flag provenance", () => {
  it.each([-1, null, undefined, "0"])("unavailable exit %s stays unknown, not failed or conflicted", exit => {
    expect(toolOutcome(null, [handsResult(exit)], "process", "openhands")).toEqual({ lifecycle: "completed", verdict: "unknown", reason: "no-exit-code" });
  });
  it.each([0, 1, 2])("real exit %s decides without a fabricated false-flag conflict", exit => {
    expect(toolOutcome(null, [handsResult(exit)], "process", "openhands")).toEqual({ lifecycle: "completed", verdict: exit === 0 ? "succeeded" : "failed", reason: exit === 0 ? "exit-zero" : "exit-nonzero", exitCode: exit });
  });
  it("true synthesized error represents observation:error; false is not a producer no-error assertion", () => {
    expect(normalizeResult(handsResult(2), { provider: "openhands" }).isError).toBeUndefined();
    expect(toolOutcome(null, [handsResult(-1, true)], "process", "openhands")).toMatchObject({ verdict: "failed", reason: "provider-error" });
    expect(toolOutcome(null, [handsResult(0), handsResult(2)], "process", "openhands")).toMatchObject({ verdict: "failed", reason: "conflict", exitCode: 2 });
    expect(toolOutcome(null, [handsResult(-1)], "process", "codex")).toMatchObject({ verdict: "failed", exitCode: -1 });
  });
});

describe("Claude optional error flag is producer no-error (U7 correction)", () => {
  it("Claude Read absent is_error succeeds and restores folding eligibility", () => {
    const use = { name: "Read" };
    const results = [{ type: "tool_result", tool_use_id: "synthetic-read", content: "Error: ordinary file text" }];
    expect(toolOutcome(use, results, "read-search", "claude").verdict).toBe("succeeded");
    expect(isToolRunEligible(use, results, "read-search")).toBe(true);
  });
  it("Claude Read absent is_error is fold-eligible independently of its verdict assertion", () => {
    expect(isToolRunEligible({ name: "Read" }, [{ type: "tool_result", content: "synthetic file text" }], "read-search")).toBe(true);
  });
  it.each(["Read", "Grep", "Glob", "WebSearch", "WebFetch", "Edit", "MultiEdit", "Write"])("%s: absent/false means no-error; true still fails (C1)", name => {
    for (const flag of [undefined, false, true]) {
      const r = { type: "tool_result", content: "Error: ordinary result text", ...(flag === undefined ? {} : { is_error: flag }) };
      expect(toolOutcome({ name }, [r], toolFamily(name), "claude").verdict).toBe(flag === true ? "failed" : "succeeded");
    }
  });
});

describe("missing producer evidence on other providers stays unknown", () => {
  it.each(["Read", "Grep", "WebFetch"])("%s: missing flags stay unknown; explicit no-error remains a positive control", name => {
    const use = { name };
    expect(toolOutcome(use, [{ content: "synthetic contents" }], "read-search", "codex").verdict).toBe("unknown");
    expect(toolOutcome(use, [{ content: "synthetic contents", is_error: false }], "read-search", "codex").verdict).toBe("succeeded");
    expect(isToolRunEligible(use, [{ content: "synthetic contents" }], "read-search", "codex")).toBe(false);
  });
  it.each([200, 403, 404, 418, 500])("WebFetch HTTP code %s is not a producer error flag (HTTP-error-page policy open)", code => {
    const r = { content: "synthetic response", toolUseResult: { bytes: 18, code, codeText: "synthetic status", durationMs: 1, result: "synthetic response", url: "https://example.invalid" } };
    expect(toolOutcome({ name: "WebFetch" }, [r], "read-search", "claude")).toEqual({ lifecycle: "completed", verdict: "succeeded", reason: "no-error-signal" });
  });
});
