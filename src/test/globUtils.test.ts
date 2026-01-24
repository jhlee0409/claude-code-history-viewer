/**
 * Glob Pattern Matching Utilities Tests
 */

import { describe, it, expect } from "vitest";
import { matchGlobPattern } from "../utils/globUtils";

describe("matchGlobPattern", () => {
  describe("basic matching", () => {
    it("should match exact strings", () => {
      expect(matchGlobPattern("test", "test")).toBe(true);
      expect(matchGlobPattern("test", "other")).toBe(false);
    });

    it("should be case-sensitive", () => {
      expect(matchGlobPattern("Test", "test")).toBe(false);
      expect(matchGlobPattern("TEST", "TEST")).toBe(true);
    });
  });

  describe("* wildcard (any characters)", () => {
    it("should match prefix with *", () => {
      expect(matchGlobPattern("folders-dg-abc123", "folders-dg-*")).toBe(true);
      expect(matchGlobPattern("folders-dg-", "folders-dg-*")).toBe(true);
      expect(matchGlobPattern("other-prefix", "folders-dg-*")).toBe(false);
    });

    it("should match suffix with *", () => {
      expect(matchGlobPattern("test.ts", "*.ts")).toBe(true);
      expect(matchGlobPattern("component.test.ts", "*.ts")).toBe(true);
      expect(matchGlobPattern("test.js", "*.ts")).toBe(false);
    });

    it("should match middle with *", () => {
      expect(matchGlobPattern("test-abc-file", "test-*-file")).toBe(true);
      expect(matchGlobPattern("test--file", "test-*-file")).toBe(true);
      expect(matchGlobPattern("test-file", "test-*-file")).toBe(false);
    });

    it("should match multiple * wildcards", () => {
      expect(matchGlobPattern("a-b-c-d", "*-*-*")).toBe(true);
      expect(matchGlobPattern("prefix-middle-suffix", "*-middle-*")).toBe(true);
    });

    it("should match everything with single *", () => {
      expect(matchGlobPattern("anything", "*")).toBe(true);
      expect(matchGlobPattern("", "*")).toBe(true);
    });
  });

  describe("? wildcard (single character)", () => {
    it("should match single character with ?", () => {
      expect(matchGlobPattern("abc", "a?c")).toBe(true);
      expect(matchGlobPattern("aXc", "a?c")).toBe(true);
      expect(matchGlobPattern("ac", "a?c")).toBe(false);
      expect(matchGlobPattern("abbc", "a?c")).toBe(false);
    });

    it("should match multiple ? wildcards", () => {
      expect(matchGlobPattern("abcd", "??cd")).toBe(true);
      expect(matchGlobPattern("1234", "????")).toBe(true);
      expect(matchGlobPattern("123", "????")).toBe(false);
    });
  });

  describe("combined wildcards", () => {
    it("should handle * and ? together", () => {
      expect(matchGlobPattern("test-a-file.ts", "test-?-*.ts")).toBe(true);
      expect(matchGlobPattern("test-ab-file.ts", "test-?-*.ts")).toBe(false);
    });
  });

  describe("special regex characters", () => {
    it("should escape regex special characters", () => {
      expect(matchGlobPattern("file.ts", "file.ts")).toBe(true);
      expect(matchGlobPattern("file-ts", "file.ts")).toBe(false);
      expect(matchGlobPattern("test[1]", "test[1]")).toBe(true);
      expect(matchGlobPattern("test(1)", "test(1)")).toBe(true);
      expect(matchGlobPattern("test+1", "test+1")).toBe(true);
      expect(matchGlobPattern("test$1", "test$1")).toBe(true);
      expect(matchGlobPattern("test^1", "test^1")).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle empty strings", () => {
      expect(matchGlobPattern("", "")).toBe(true);
      expect(matchGlobPattern("", "*")).toBe(true);
      expect(matchGlobPattern("", "?")).toBe(false);
      expect(matchGlobPattern("a", "")).toBe(false);
    });

    it("should handle patterns at boundaries", () => {
      // Note: backslash is treated as literal character, not glob escape
      // Pattern "\\*" becomes regex "^\\.*$" which doesn't match "*"
      expect(matchGlobPattern("*", "\\*")).toBe(false);
      expect(matchGlobPattern("test", "test*")).toBe(true);
      expect(matchGlobPattern("test", "*test")).toBe(true);
    });
  });

  describe("ReDoS protection", () => {
    it("should reject patterns with too many wildcards", () => {
      // Pattern with 11 wildcards should be rejected (max is 10)
      const manyWildcards = "*a*b*c*d*e*f*g*h*i*j*k";
      expect(matchGlobPattern("test", manyWildcards)).toBe(false);
    });

    it("should accept patterns within wildcard limit", () => {
      // Pattern with 10 wildcards should work
      const maxWildcards = "*a*b*c*d*e*f*g*h*i*";
      expect(matchGlobPattern("XaXbXcXdXeXfXgXhXiX", maxWildcards)).toBe(true);
    });

    it("should handle realistic patterns quickly", () => {
      const start = performance.now();
      // Test realistic project path patterns
      for (let i = 0; i < 1000; i++) {
        matchGlobPattern("folders-dg-abc123-test-project", "folders-dg-*");
        matchGlobPattern("/Users/jack/projects/my-app", "/Users/*/projects/*");
      }
      const duration = performance.now() - start;

      // 1000 iterations should complete in under 100ms
      expect(duration).toBeLessThan(100);
    });

    it("should reject overly long patterns", () => {
      const longPattern = "*".repeat(300);
      expect(matchGlobPattern("test", longPattern)).toBe(false);
    });
  });

  describe("real-world patterns", () => {
    it("should match project hiding patterns", () => {
      expect(matchGlobPattern("folders-dg-abc123", "folders-dg-*")).toBe(true);
      expect(matchGlobPattern("my-project", "folders-dg-*")).toBe(false);
    });

    it("should match file extension patterns", () => {
      expect(matchGlobPattern("component.test.ts", "*.test.ts")).toBe(true);
      expect(matchGlobPattern("component.spec.ts", "*.test.ts")).toBe(false);
    });

    it("should match path-like patterns", () => {
      expect(
        matchGlobPattern("/Users/jack/project", "/Users/*/project")
      ).toBe(true);
      expect(
        matchGlobPattern("/Users/jack/other", "/Users/*/project")
      ).toBe(false);
    });
  });
});
