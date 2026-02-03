import type { SearchFilterType } from '@/store/slices/types';

/**
 * All supported content types that can be rendered.
 * This includes standard message content, tool interactions, and beta features.
 */
export type ContentType =
  | 'text' | 'thinking' | 'redacted_thinking'
  | 'tool_use' | 'tool_result'
  | 'image' | 'document'
  | 'command' | 'critical_system_reminder'
  | 'server_tool_use' | 'web_search_tool_result'
  | 'mcp_tool_use' | 'mcp_tool_result'
  | 'web_fetch_tool_result' | 'code_execution_tool_result'
  | 'bash_code_execution_tool_result' | 'text_editor_code_execution_tool_result'
  | 'tool_search_tool_result' | 'search_result';

/**
 * Context information passed to all content renderers.
 * Provides search and filtering state for highlighting and navigation.
 */
export interface RenderContext {
  /** Current search query string */
  searchQuery: string;
  /** Active filter type (all, user, assistant, etc.) */
  filterType: SearchFilterType;
  /** Whether this content item is the current search match */
  isCurrentMatch: boolean;
  /** Index of current match in total matches (for "X of Y" display) */
  currentMatchIndex: number;
}

/**
 * Base props that all content renderers must accept.
 * Provides consistent interface for all registered renderers.
 */
export interface BaseContentRendererProps {
  /** The content item to render (type-specific structure) */
  content: Record<string, unknown>;
  /** Rendering context (search, filters, match state) */
  context: RenderContext;
  /** Index of this content item within its parent array */
  index: number;
}

/**
 * Registration entry for a content renderer.
 * Associates a content type with its rendering component.
 */
export interface RendererRegistration {
  /** Content type identifier (must be unique) */
  type: ContentType;
  /** React component that renders this content type */
  component: React.ComponentType<BaseContentRendererProps>;
  /**
   * Optional priority for type matching when multiple renderers could apply.
   * Higher priority renderers are checked first. Default: 0
   */
  priority?: number;
}
