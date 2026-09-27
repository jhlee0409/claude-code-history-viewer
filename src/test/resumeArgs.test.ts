import { describe, expect, it } from "vitest";
import {
  parseResumeArgs,
  isDangerousArg,
  hasDangerousFlag,
  buildLivePreviewResumeCommand,
  getStoredResumeCliArgs,
} from "@/utils/resumeArgs";
import type { UserSettings } from "@/types";

describe("resumeArgs utility", () => {
  describe("parseResumeArgs", () => {
    it("handles empty or whitespace inputs gracefully", () => {
      expect(parseResumeArgs("")).toEqual({
        isValid: true,
        tokens: [],
        hasDangerousFlag: false,
      });
      expect(parseResumeArgs("   \t  ")).toEqual({
        isValid: true,
        tokens: [],
        hasDangerousFlag: false,
      });
    });

    it("parses valid CLI flags and values into tokens", () => {
      const res = parseResumeArgs("--model sonnet --timeout=60 -v");
      expect(res.isValid).toBe(true);
      expect(res.tokens).toEqual(["--model", "sonnet", "--timeout=60", "-v"]);
      expect(res.hasDangerousFlag).toBe(false);
      expect(res.warning).toBeUndefined();
    });

    it("detects dangerous permission-skipping flags", () => {
      const res = parseResumeArgs("--dangerously-skip-permissions");
      expect(res.isValid).toBe(true);
      expect(res.tokens).toEqual(["--dangerously-skip-permissions"]);
      expect(res.hasDangerousFlag).toBe(true);
      expect(res.warning).toBeDefined();
    });

    it("rejects shell metacharacters and injection attempts", () => {
      const maliciousCases = [
        "claude; rm -rf /",
        "--flag && curl evil.com",
        "--arg | cat",
        "`whoami`",
        "$(cat /etc/passwd)",
        "--out > file",
        "--in < file",
        "--param \"quoted with space\"",
        "--param 'single quotes'",
        "foo\\bar",
        "arg!exclamation",
        "nested(command)",
        "multi\nline",
      ];

      for (const input of maliciousCases) {
        const res = parseResumeArgs(input);
        expect(res.isValid).toBe(false);
        expect(res.tokens).toEqual([]);
        expect(res.error).toBeDefined();
      }
    });

    it("enforces maximum argument limits", () => {
      const manyArgs = Array.from({ length: 35 }, (_, i) => `--arg${i}`).join(" ");
      const res = parseResumeArgs(manyArgs);
      expect(res.isValid).toBe(false);
      expect(res.error).toContain("Maximum 32");
    });
  });

  describe("isDangerousArg & hasDangerousFlag", () => {
    it("identifies --dangerously-* variations", () => {
      expect(isDangerousArg("--dangerously-skip-permissions")).toBe(true);
      expect(isDangerousArg("--dangerously-allow-all")).toBe(true);
      expect(isDangerousArg("-dangerously-skip-permissions")).toBe(true);
      expect(isDangerousArg("--no-permissions")).toBe(true);
      expect(isDangerousArg("--verbose")).toBe(false);
      expect(isDangerousArg("--model")).toBe(false);
    });

    it("detects dangerous flag in string or array", () => {
      expect(hasDangerousFlag("--verbose --dangerously-skip-permissions")).toBe(true);
      expect(hasDangerousFlag(["--verbose", "--dangerously-skip-permissions"])).toBe(true);
      expect(hasDangerousFlag("--verbose --model sonnet")).toBe(false);
    });
  });

  describe("getStoredResumeCliArgs", () => {
    it("retrieves configured arguments or returns empty string", () => {
      const settings: UserSettings = {
        resumeCliArgs: {
          claude: "--dangerously-skip-permissions",
        },
      };
      expect(getStoredResumeCliArgs(settings, "claude")).toBe(
        "--dangerously-skip-permissions"
      );
      expect(getStoredResumeCliArgs(settings, "codex")).toBe("");
      expect(getStoredResumeCliArgs(undefined, "claude")).toBe("");
    });
  });

  describe("buildLivePreviewResumeCommand", () => {
    it("generates correct command preview with and without extra args", () => {
      expect(
        buildLivePreviewResumeCommand("claude", "--dangerously-skip-permissions", "test-id")
      ).toBe("claude --dangerously-skip-permissions --resume test-id");

      expect(buildLivePreviewResumeCommand("claude", "", "test-id")).toBe(
        "claude --resume test-id"
      );

      expect(
        buildLivePreviewResumeCommand("codex", "--model o3-mini", "test-id")
      ).toBe("codex --model o3-mini resume test-id");
    });
  });
});
