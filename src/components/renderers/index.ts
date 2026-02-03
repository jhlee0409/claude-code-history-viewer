/**
 * Renderer Components Module
 *
 * This module provides shared infrastructure for all renderer components:
 * - types.ts: TypeScript interfaces and type definitions
 * - styles.ts: Variant-based styling using design tokens
 * - utils.ts: Common utility functions
 * - hooks.ts: Reusable React hooks for renderer logic
 * - RendererCard.tsx: Compound component for consistent renderer UI
 *
 * Usage:
 * ```tsx
 * import {
 *   type RendererVariant,
 *   getVariantStyles,
 *   getLanguageFromPath,
 *   useRendererStyles,
 *   RendererCard,
 * } from "@/components/renderers";
 * ```
 */

// Types
export type {
  BaseRendererProps,
  IndexedRendererProps,
  ToolRendererProps,
  ToolUseContent,
  ToolResultContent,
  RendererVariant,
  FileMetadata,
  CommandResult,
  ProgrammingLanguage,
} from "./types";

export { TOOL_VARIANTS } from "./types";

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

// Hooks
export { useRendererStyles, useExpandableContent } from "./hooks";

// Components
export { RendererCard } from "./RendererCard";

// Registry
export {
  registerRenderer,
  getRenderer,
  getRegistration,
  isRegisteredType,
} from "./registry";

export type {
  ContentType,
  RenderContext,
  BaseContentRendererProps,
  RendererRegistration,
} from "./registry";
