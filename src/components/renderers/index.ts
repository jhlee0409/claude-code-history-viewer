/**
 * Renderer Components Module
 *
 * This module provides shared infrastructure for all renderer components:
 * - types.ts: TypeScript interfaces and type definitions
 * - styles.ts: Variant-based styling using design tokens
 * - utils.ts: Common utility functions
 *
 * Usage:
 * ```tsx
 * import {
 *   type RendererVariant,
 *   getVariantStyles,
 *   getLanguageFromPath,
 * } from "@/components/renderers";
 * ```
 */

// Types
export type {
  BaseRendererProps,
  IndexedRendererProps,
  ToolUseContent,
  ToolResultContent,
  RendererVariant,
  FileMetadata,
  CommandResult,
  ProgrammingLanguage,
} from "./types";

export { TOOL_VARIANTS, getToolVariant } from "./types";

// Styles
export type { VariantStyles } from "./styles";
export { getVariantStyles, commonStyles, codeTheme, layout, layoutComposite } from "./styles";

// Utils
export {
  getLanguageFromPath,
  detectLanguageFromContent,
  hasNumberedLines,
  extractCodeFromNumberedLines,
  parseSystemReminders,
  isFileSearchResult,
  parseFilePath,
  truncate,
  formatLineCount,
  safeStringify,
  isPlainObject,
} from "./utils";
