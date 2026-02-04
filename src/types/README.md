# Type System Architecture

This directory contains the type definitions for the Claude Code History Viewer application, organized for LLM-friendliness and maintainability.

## Directory Structure

```text
src/types/
├── core/           # Fundamental types (pure type definitions)
│   ├── message.ts  # Message structures (user, assistant, system)
│   ├── content.ts  # Content types (text, images, documents)
│   ├── tool.ts     # Tool use/result types
│   ├── mcp.ts      # Model Context Protocol types
│   ├── session.ts  # Session and project structures
│   ├── project.ts  # Project metadata and user settings
│   ├── settings.ts # Claude Code settings configuration
│   └── index.ts    # Barrel exports for core types
├── derived/        # Composed/aggregated types
│   ├── preset.ts   # Unified preset types (settings + MCP)
│   └── index.ts    # Barrel exports for derived types
├── *.types.ts      # Legacy domain-specific types (deprecated)
└── index.ts        # Main barrel export
```

## Design Principles

### 1. Separation of Concerns

- **Core Types** (`core/`): Pure type definitions without runtime logic
- **Runtime Utilities** (`src/utils/typeGuards.ts`): Type guards and runtime checks
- **Derived Types** (`derived/`): Composed types built from core types

### 2. Import Patterns

**Preferred (via index):**
```typescript
import type { ClaudeMessage, ContentItem } from '@/types';
```

**Direct import (for specific needs):**
```typescript
import type { ClaudeMessage } from '@/types/core/message';
import type { UnifiedPresetData } from '@/types/derived/preset';
```

**Type guards:**
```typescript
import { isUserMessage, hasToolUse } from '@/utils/typeGuards';
```

### 3. No Circular Dependencies

The structure enforces a clear dependency hierarchy:
```text
core types (no dependencies)
    ↓
derived types (depend on core)
    ↓
domain types (depend on core + derived)
    ↓
components (depend on all types)
```

## Core Types

### Message Types (`core/message.ts`)

Message structures representing conversation data:
- `RawClaudeMessage` - Raw JSONL format from disk
- `ClaudeMessage` - Processed UI message (union type)
- `ClaudeUserMessage` - User input
- `ClaudeAssistantMessage` - Claude's response
- `ClaudeSystemMessage` - System events
- `MessageNode` - Tree structure for UI rendering

### Content Types (`core/content.ts`)

Content blocks that appear in message arrays:
- `TextContent` - Plain text with optional citations
- `ThinkingContent` - Claude's extended thinking
- `ImageContent` - Image attachments
- `DocumentContent` - PDF and text documents
- `Citation` - Source references

### Tool Types (`core/tool.ts`)

Tool invocation and results:
- `ToolUseContent` - Tool execution request
- `ToolResultContent` - Tool execution result
- `WebSearchToolResultContent` - Web search results
- `CodeExecutionToolResultContent` - Code execution output
- `ContentItem` - Union of all content types

### MCP Types (`core/mcp.ts`)

Model Context Protocol integration:
- `MCPToolUseContent` - MCP tool invocation
- `MCPToolResultContent` - MCP tool result
- `MCPServerConfig` - Server configuration

### Session Types (`core/session.ts`)

Project and session organization:
- `ClaudeProject` - Project metadata
- `ClaudeSession` - Session metadata
- `GitInfo` - Git worktree information

### Project Types (`core/project.ts`)

User metadata and settings:
- `SessionMetadata` - Custom session data
- `ProjectMetadata` - Project display settings
- `UserSettings` - Global user preferences
- `UserMetadata` - Root metadata structure

### Settings Types (`core/settings.ts`)

Claude Code configuration:
- `ClaudeCodeSettings` - Complete settings structure
- `PermissionsConfig` - Tool permissions
- `HooksConfig` - Lifecycle hooks
- `MCPServerConfig` - MCP server configuration

## Derived Types

### Preset Types (`derived/preset.ts`)

Unified configuration presets:
- `UnifiedPresetData` - Combined settings + MCP preset
- `UnifiedPresetSummary` - Display metadata
- `PresetData` - Legacy user settings preset (deprecated)
- `MCPPresetData` - Legacy MCP preset (deprecated)

## Type Guards

Runtime type checking is centralized in `src/utils/typeGuards.ts`:

```typescript
// Message type guards
isUserMessage(message)
isAssistantMessage(message)
hasToolUse(message)
hasError(message)

// Content type guards
isTextContent(item)
isToolUseContent(item)
isImageContent(item)

// Metadata checks
isSessionMetadataEmpty(metadata)
hasUserMetadata(metadata)
```

## Migration Guide

### For LLMs Reading This Codebase

1. **Always import from `@/types`** for general usage
2. **Use specific paths** when you need fine-grained control:
   - `@/types/core/message` for message types
   - `@/types/core/settings` for settings types
   - `@/types/derived/preset` for preset types
3. **Use type guards** from `@/utils/typeGuards` for runtime checks
4. **Legacy files** (*.types.ts at root) are deprecated but maintained for compatibility

### Adding New Types

1. **Pure types** → Add to appropriate `core/*.ts` file
2. **Composed types** → Add to `derived/*.ts`
3. **Runtime utilities** → Add to `src/utils/typeGuards.ts`
4. **Update exports** in `src/types/index.ts`

### Example: Adding a New Core Type

```typescript
// 1. Add to src/types/core/message.ts
export interface ClaudeAnnotationMessage extends BaseClaudeMessage {
  type: "annotation";
  annotationText: string;
}

// 2. Update union type
export type ClaudeMessage =
  | ClaudeUserMessage
  | ClaudeAssistantMessage
  | ClaudeAnnotationMessage; // Add here

// 3. Add type guard to src/utils/typeGuards.ts
export function isAnnotationMessage(
  message: ClaudeMessage
): message is ClaudeAnnotationMessage {
  return message.type === "annotation";
}

// 4. Export from src/types/index.ts
export type {
  ClaudeAnnotationMessage, // Add here
} from "./core/message";
```

## Backward Compatibility

All legacy type files are maintained with deprecation warnings:
- Still functional via `@/types` barrel export
- Original file paths preserved
- JSDoc warnings guide to new structure

## Benefits of This Structure

1. **LLM-Friendly**: Clear hierarchy, predictable locations
2. **No Circular Dependencies**: Enforced by structure
3. **Easy to Navigate**: Types grouped by purpose
4. **Maintainable**: Clear separation of concerns
5. **Type-Safe**: Centralized type guards prevent runtime errors
6. **Extensible**: New types fit naturally into the hierarchy

## Related Files

- **Type Guards**: `src/utils/typeGuards.ts`
- **Main Export**: `src/types/index.ts`
- **Core Index**: `src/types/core/index.ts`
- **Derived Index**: `src/types/derived/index.ts`
