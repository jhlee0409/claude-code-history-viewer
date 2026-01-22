/**
 * Shared utilities for renderer components
 *
 * This file provides common utility functions used across renderers.
 * Centralizing these functions reduces duplication and simplifies maintenance.
 */

import type { ProgrammingLanguage } from "./types";

/**
 * File extension to language mapping
 */
const EXTENSION_LANGUAGES: Record<string, ProgrammingLanguage> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  pyw: "python",
  rs: "rust",
  go: "go",
  java: "java",
  php: "php",
  rb: "ruby",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  mdx: "markdown",
  html: "html",
  htm: "html",
  css: "css",
  scss: "css",
  sass: "css",
  less: "css",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
};

/**
 * Detect programming language from file path
 */
export function getLanguageFromPath(filePath: string): ProgrammingLanguage {
  const ext = filePath.split(".").pop()?.toLowerCase();
  return ext ? (EXTENSION_LANGUAGES[ext] ?? "text") : "text";
}

/**
 * Detect programming language from code content
 */
export function detectLanguageFromContent(code: string): ProgrammingLanguage {
  // TypeScript indicators
  if (
    code.includes("interface ") ||
    code.includes(": string") ||
    code.includes(": number") ||
    code.includes(": boolean") ||
    /:\s*(string|number|boolean|any|void)\b/.test(code)
  ) {
    return "typescript";
  }

  // JavaScript indicators
  if (
    (code.includes("import ") && code.includes("from ")) ||
    code.includes("require(") ||
    code.includes("module.exports")
  ) {
    return "javascript";
  }

  // Rust indicators
  if (
    (code.includes("fn ") && code.includes("->")) ||
    code.includes("let mut ") ||
    code.includes("impl ") ||
    code.includes("pub struct ")
  ) {
    return "rust";
  }

  // Python indicators
  if (
    code.includes("def ") ||
    code.includes("import ") ||
    code.includes("from ") ||
    /^\s*class\s+\w+.*:/m.test(code)
  ) {
    return "python";
  }

  // Go indicators
  if (
    code.includes("func ") ||
    code.includes("package ") ||
    code.includes(":= ")
  ) {
    return "go";
  }

  // Java indicators
  if (code.includes("public class ") || code.includes("public static void")) {
    return "java";
  }

  // Shell indicators
  if (
    code.startsWith("#!/bin/") ||
    code.includes("echo ") ||
    code.includes("export ")
  ) {
    return "shell";
  }

  // JSON indicators
  if (/^\s*[[{]/.test(code) && /[}\]]\s*$/.test(code)) {
    try {
      JSON.parse(code);
      return "json";
    } catch {
      // Not valid JSON
    }
  }

  return "text";
}

/**
 * Check if content has numbered lines (e.g., "  1→const x = 1")
 */
export function hasNumberedLines(text: string): boolean {
  if (typeof text !== "string") return false;
  const hasPattern = /^\s*\d+→/m.test(text);
  const hasMultipleLines = text.split("\n").length > 1;
  const numberedCount = (text.match(/^\s*\d+→/gm) || []).length;
  return hasPattern && hasMultipleLines && numberedCount >= 2;
}

/**
 * Extract code from numbered lines format
 */
export function extractCodeFromNumberedLines(text: string): {
  code: string;
  description: string;
  language: ProgrammingLanguage;
} {
  const lines = text.split("\n");
  const codeLines: string[] = [];
  const descriptionLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^\s*\d+→(.*)$/);
    if (match && match[1] !== undefined) {
      codeLines.push(match[1]);
    } else if (line.trim()) {
      descriptionLines.push(line.trim());
    }
  }

  const code = codeLines.join("\n");
  const description = descriptionLines.join(" ");
  const language = detectLanguageFromContent(code);

  return { code, description, language };
}

/**
 * Parse system-reminder tags from content
 */
export function parseSystemReminders(text: string): {
  content: string;
  reminders: Array<{ type: string; message: string }>;
} {
  if (typeof text !== "string") {
    return { content: text, reminders: [] };
  }

  const reminders: Array<{ type: string; message: string }> = [];
  let content = text;

  // Extract system-reminder tags
  const reminderRegex = /<system-reminder>([\s\S]*?)<\/system-reminder>/g;
  let match;

  while ((match = reminderRegex.exec(text)) !== null) {
    if (match[1]) {
      reminders.push({
        type: "system-reminder",
        message: match[1].trim(),
      });
    }
    content = content.replace(match[0], "");
  }

  return { content: content.trim(), reminders };
}

/**
 * Check if content looks like file search results
 */
export function isFileSearchResult(text: string): boolean {
  if (typeof text !== "string") return false;

  const lines = text.trim().split("\n");
  if (lines.length < 2) return false;

  const hasFoundPattern = /^Found \d+ files?/i.test(lines[0] ?? "");
  const fileExtensions = [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".java",
    ".rs",
    ".go",
    ".php",
    ".rb",
    ".vue",
    ".svelte",
  ];
  const hasFilePaths = lines
    .slice(1)
    .some(
      (line) =>
        line.trim().length > 0 &&
        (line.includes("/") || line.includes("\\")) &&
        fileExtensions.some((ext) => line.includes(ext))
    );

  return hasFoundPattern || (lines.length >= 3 && hasFilePaths);
}

/**
 * Parse file path into directory and filename
 */
export function parseFilePath(filePath: string): {
  directory: string;
  fileName: string;
  extension: string;
} {
  const lastSlash = Math.max(
    filePath.lastIndexOf("/"),
    filePath.lastIndexOf("\\")
  );
  const directory = lastSlash > 0 ? filePath.substring(0, lastSlash) : "";
  const fileName = lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;
  const lastDot = fileName.lastIndexOf(".");
  const extension = lastDot > 0 ? fileName.substring(lastDot + 1) : "";

  return { directory, fileName, extension };
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "...";
}

/**
 * Format line count
 */
export function formatLineCount(count: number): string {
  return count === 1 ? "1 line" : `${count.toLocaleString()} lines`;
}

/**
 * Safely stringify unknown values for display
 */
export function safeStringify(value: unknown, pretty = true): string {
  try {
    return JSON.stringify(value, null, pretty ? 2 : 0);
  } catch {
    return String(value);
  }
}

/**
 * Check if value is a plain object
 */
export function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}
