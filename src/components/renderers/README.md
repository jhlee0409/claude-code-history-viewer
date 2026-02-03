# Renderer Extension Guide

The renderer system provides a modular, extensible architecture for displaying diverse content types from Claude conversations. This guide explains how the system works and how to add support for new content types.

## Overview

The renderer system consists of:

- **Content Types**: Standardized TypeScript interfaces defining data structure
- **Renderer Components**: React components that transform data into UI
- **Registry**: Central lookup system mapping content types to renderers
- **Design System**: Shared styling, layout tokens, and hooks
- **Utilities**: Common functions for language detection, formatting, and parsing

### Architecture

```
Message Content Array
         ↓
ClaudeContentArrayRenderer (iterates items)
         ↓
Registry Lookup (matches type to renderer)
         ↓
Specific Renderer Component
         ↓
Styled UI Output using Design System
```

### Key Files

| File | Purpose |
|------|---------|
| `types.ts` | TypeScript interfaces for all renderers |
| `styles.ts` | Variant-based styling with design tokens |
| `hooks.ts` | Reusable React hooks (memoization, expandable state) |
| `utils.ts` | Utility functions for formatting and detection |
| `RendererCard.tsx` | Compound component for consistent card UI |
| `registry/index.ts` | Global registry for renderer lookup |
| `registry/types.ts` | Registry type definitions |

## Supported Content Types

### Standard Content (32 total)

**Text & Thinking**
- `text` - Plain and formatted text with citations
- `thinking` - Extended reasoning blocks
- `redacted_thinking` - Encrypted thinking (safety systems)

**Media**
- `image` - Static images (base64 or URL)
- `document` - PDF and plain text documents

**Tool Interactions**
- `tool_use` - Tool invocation with parameters
- `tool_result` - Tool execution results
- `mcp_tool_use` - Model Context Protocol tool calls
- `mcp_tool_result` - MCP tool results
- `server_tool_use` - Server-side tool calls (web_search)
- `web_search_tool_result` - Search results
- `tool_search_tool_result` - MCP tool discovery

**Beta Features (2025)**
- `web_fetch_tool_result` - Full page/PDF retrieval
- `code_execution_tool_result` - Python code execution
- `bash_code_execution_tool_result` - Bash execution
- `text_editor_code_execution_tool_result` - File operations

**System & Search**
- `command` - User commands (/init, /start, etc.)
- `critical_system_reminder` - System alerts
- `search_result` - Search result blocks
- `citation` - Source references in documents

---

## Adding a New Content Type Renderer

Follow these steps to add support for a new content type:

### Step 1: Define the Content Type

If your content type doesn't exist, define it in `src/types/core/content.ts`:

```typescript
// src/types/core/content.ts

export interface NewContentType {
  type: 'new_content_type';
  title?: string;
  data: string;
  metadata?: Record<string, unknown>;
}
```

Update the `ContentType` union in `src/components/renderers/registry/types.ts`:

```typescript
export type ContentType =
  | 'text' | 'thinking' | 'redacted_thinking'
  | ... existing types ...
  | 'new_content_type';  // Add here
```

### Step 2: Create a Type Guard (Optional)

For type safety, create a type guard in `src/utils/typeGuards.ts`:

```typescript
// src/utils/typeGuards.ts

import type { NewContentType } from '@/types/core/content';

export function isNewContentType(item: unknown): item is NewContentType {
  return (
    typeof item === 'object' &&
    item !== null &&
    'type' in item &&
    (item as Record<string, unknown>).type === 'new_content_type' &&
    'data' in item
  );
}
```

### Step 3: Create the Renderer Component

Create a new file in `src/components/contentRenderer/` with the following structure:

```typescript
// src/components/contentRenderer/NewContentTypeRenderer.tsx

import { memo, type ReactNode } from 'react';
import { Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  type BaseContentRendererProps,
  getVariantStyles,
  layout,
} from '@/components/renderers';
import type { NewContentType } from '@/types/core/content';

export const NewContentTypeRenderer = memo(
  function NewContentTypeRenderer({
    content,
    context,
  }: BaseContentRendererProps) {
    const { t } = useTranslation();
    const typedContent = content as NewContentType;
    const styles = getVariantStyles('info'); // Or appropriate variant

    if (!typedContent.data) {
      return null;
    }

    return (
      <div
        className={cn(
          styles.container,
          'border',
          layout.rounded,
          layout.containerPadding
        )}
      >
        {/* Header */}
        <div className={cn('flex items-center', layout.iconGap, 'mb-2')}>
          <Package className={cn(layout.iconSize, styles.icon)} />
          <span className={cn(layout.titleText, styles.title)}>
            {t('newContentType.title')}
          </span>
        </div>

        {/* Content */}
        <div className={layout.contentPadding}>
          <p className={layout.bodyText}>{typedContent.data}</p>
        </div>
      </div>
    );
  }
);
```

### Step 4: Register the Renderer

Register your renderer in `src/components/contentRenderer/index.ts`:

```typescript
// src/components/contentRenderer/index.ts

import { registerRenderer } from '@/components/renderers/registry';
import { NewContentTypeRenderer } from './NewContentTypeRenderer';

// Register during module initialization
registerRenderer({
  type: 'new_content_type',
  component: NewContentTypeRenderer,
  priority: 0, // Optional: 0 is default
});

// Export for convenience
export { NewContentTypeRenderer } from './NewContentTypeRenderer';
```

### Step 5: Add i18n Keys

Add translations to all 5 language files:

```json
// src/i18n/locales/en.json
{
  "newContentType.title": "New Content Type Title"
}

// src/i18n/locales/ko.json
{
  "newContentType.title": "새 콘텐츠 타입 제목"
}

// Repeat for ja.json, zh-CN.json, zh-TW.json
```

Regenerate types:
```bash
pnpm run generate:i18n-types
```

---

## Available Design Tokens

### Variant Styles

Use `getVariantStyles()` to get consistent colors for your renderer:

```typescript
const styles = getVariantStyles('success');
// Returns: { container, icon, title, badge, badgeText, accent }
```

**Available Variants**:

| Variant | Use Case | Colors |
|---------|----------|--------|
| `success` | Successful operations | Green tones |
| `error` | Errors and failures | Red tones |
| `warning` | Warnings and alerts | Orange tones |
| `info` | General information | Blue tones |
| `neutral` | Default/neutral content | Gray tones |
| `code` | Code operations (Read, Write) | Blue |
| `file` | File operations (Glob) | Teal |
| `search` | Search operations (Grep) | Violet |
| `task` | Task management (TodoWrite) | Amber |
| `system` | System operations (Bash) | Orange |
| `thinking` | Thinking blocks | Gold |
| `git` | Git operations | Cyan |
| `web` | Web operations (WebSearch) | Sky Blue |
| `mcp` | MCP/Server operations | Magenta |
| `document` | Document operations (PDF) | Teal |
| `terminal` | Terminal/Shell output | Warm Orange |

### Layout Constants

Standardized spacing and sizing for visual consistency:

```typescript
import { layout } from '@/components/renderers';

// Spacing
layout.containerPadding      // "p-2.5" (10px)
layout.headerPadding         // "px-2.5 py-1.5"
layout.contentPadding        // "px-2.5 pb-2.5"
layout.iconGap              // "gap-1.5" (6px)
layout.iconSpacing          // "space-x-1.5"

// Sizing
layout.headerHeight         // "h-8" (32px)
layout.iconSize             // "w-4 h-4" (16x16px)
layout.iconSizeSmall        // "w-3 h-3" (12x12px)

// Typography
layout.titleText            // "text-[12px] font-medium"
layout.bodyText             // "text-[12px]"
layout.smallText            // "text-[12px]"
layout.monoText             // "text-[12px] font-mono"

// Styling
layout.rounded              // "rounded-md" (6px)
layout.codeMaxHeight        // "max-h-64"
layout.contentMaxHeight     // "max-h-96"
layout.prose                // Markdown styling
```

### Composite Patterns

Pre-composed classes for common patterns:

```typescript
import { layoutComposite } from '@/components/renderers';

layoutComposite.container      // Full renderer container
layoutComposite.headerRow      // Header with icon + title
layoutComposite.headerButton   // Collapsible header button
layoutComposite.contentArea    // Content wrapper
layoutComposite.codeBlock      // Code display
layoutComposite.badge          // Badge/tag styling
```

### Common Styles

Reusable style definitions:

```typescript
import { commonStyles } from '@/components/renderers';

commonStyles.codeBlock
commonStyles.codeBlockHeader
commonStyles.inlineCode
commonStyles.filePath
commonStyles.divider
commonStyles.metaRow
commonStyles.scrollable
commonStyles.card
commonStyles.muted
commonStyles.small
commonStyles.iconText
commonStyles.badge
```

---

## Useful Utilities

### Language Detection

```typescript
import {
  getLanguageFromPath,
  detectLanguageFromContent,
  hasNumberedLines,
  extractCodeFromNumberedLines,
} from '@/components/renderers';

// Detect language from file extension
const lang = getLanguageFromPath('src/index.ts'); // 'typescript'

// Detect language from code content
const lang = detectLanguageFromContent('interface User {}'); // 'typescript'

// Check for numbered line format (read tool output)
const hasNumbers = hasNumberedLines(text);

// Extract code from numbered lines
const { code, language } = extractCodeFromNumberedLines(text);
```

### Formatting & Parsing

```typescript
import {
  parseFilePath,
  truncate,
  formatLineCount,
  parseSystemReminders,
  isFileSearchResult,
  safeStringify,
  isPlainObject,
} from '@/components/renderers';

// Parse file paths
const { directory, fileName, extension } = parseFilePath('/path/to/file.ts');

// Truncate long strings
const short = truncate(longText, 50); // "This is a very long text that..."

// Format line counts
const display = formatLineCount(256); // "256 lines"

// Extract system reminders from text
const { content, reminders } = parseSystemReminders(text);

// Check if text looks like file search results
if (isFileSearchResult(output)) { /* ... */ }

// Safely stringify any value to JSON
const json = safeStringify(data, true); // With pretty printing

// Type checking
if (isPlainObject(value)) { /* ... */ }
```

### Hooks

```typescript
import { useRendererStyles, useExpandableContent } from '@/components/renderers';

// Get memoized variant styles
const styles = useRendererStyles('success');

// Manage expandable content with auto-expand on search
const { isExpanded, toggle, setIsExpanded } = useExpandableContent({
  defaultExpanded: false,
  searchQuery: 'error',
  content: errorText,
});
```

---

## Best Practices

### 1. Always Use `memo()` for Performance

Wrap all renderer components with React's `memo()` to prevent unnecessary re-renders:

```typescript
export const MyRenderer = memo(function MyRenderer(props) {
  // Component body
});
```

### 2. Use i18n for All User-Visible Strings

Every text shown to users should be internationalized:

```typescript
const { t } = useTranslation();

return <span>{t('myComponent.labelKey')}</span>;
```

**Never use hardcoded strings in UI:**
```typescript
// WRONG
<span>Loading...</span>

// RIGHT
<span>{t('common.loading')}</span>
```

### 3. Handle Error States Gracefully

Always check for missing or invalid data:

```typescript
if (!typedContent.data) {
  return null; // Don't render if no data
}

if (error) {
  return (
    <div className={cn(styles.container, 'border')}>
      <X className={cn(layout.iconSize, 'text-destructive')} />
      <span>{t('error.messageKey')}</span>
    </div>
  );
}
```

### 4. Support Search Highlighting

Implement search highlighting where appropriate using the `HighlightedText` component:

```typescript
import { HighlightedText } from '../common/HighlightedText';

return (
  <div>
    {context.searchQuery ? (
      <HighlightedText
        text={typedContent.data}
        searchQuery={context.searchQuery}
        isCurrentMatch={context.isCurrentMatch}
        currentMatchIndex={context.currentMatchIndex}
      />
    ) : (
      typedContent.data
    )}
  </div>
);
```

### 5. Use Compound Components for Complex UIs

Use the `RendererCard` compound component for consistent card layouts:

```typescript
import { RendererCard } from '@/components/renderers';

<RendererCard variant="info" enableToggle defaultExpanded={false}>
  <RendererCard.Header
    title="My Content"
    icon={<Package />}
    rightContent={<Badge>ID: 123</Badge>}
  />
  <RendererCard.Content>
    {/* Your content here */}
  </RendererCard.Content>
</RendererCard>
```

### 6. Props Interface Documentation

Document all component props clearly:

```typescript
interface Props {
  /** The content to render */
  content: NewContentType;
  /** Rendering context (search, filters, matches) */
  context: RenderContext;
  /** Optional custom styling */
  className?: string;
}
```

### 7. Semantic HTML & Accessibility

Include proper ARIA attributes and semantic markup:

```typescript
<button
  type="button"
  onClick={toggle}
  aria-expanded={isExpanded}
  aria-label={t('aria.toggleContent')}
>
  Toggle
</button>

<div
  role="dialog"
  aria-modal="true"
  aria-label={t('modal.title')}
>
  Modal content
</div>
```

---

## Registry System

### How Registration Works

The registry is a centralized lookup system populated during module initialization:

```
Module Import
     ↓
registerRenderer() called
     ↓
Registry Map Updated
     ↓
getRenderer('type') returns component
```

### Using the Registry

The registry is used internally by `ClaudeContentArrayRenderer` to match content types to renderers:

```typescript
import { getRenderer, isRegisteredType } from '@/components/renderers/registry';

// Check if a type is registered
if (isRegisteredType(item.type)) {
  // Get the renderer component
  const Renderer = getRenderer(item.type);

  // Render the content
  return (
    <Renderer
      content={item}
      context={renderContext}
      index={itemIndex}
    />
  );
}
```

### Priority System

Higher priority renderers are checked first when multiple renderers could apply:

```typescript
registerRenderer({
  type: 'text',
  component: TextRenderer,
  priority: 10, // Higher priority
});

registerRenderer({
  type: 'text',
  component: SpecializedTextRenderer,
  priority: 20, // This would be checked first
});
```

---

## Example: Complete Renderer Implementation

Here's a complete example of adding a custom "summary" renderer:

```typescript
// 1. Define the type
// src/types/core/content.ts
export interface SummaryContent {
  type: 'summary';
  title: string;
  items: string[];
  category?: string;
}

// 2. Create the renderer
// src/components/contentRenderer/SummaryRenderer.tsx
import { memo } from 'react';
import { List } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  type BaseContentRendererProps,
  getVariantStyles,
  layout,
} from '@/components/renderers';
import type { SummaryContent } from '@/types/core/content';

export const SummaryRenderer = memo(function SummaryRenderer({
  content,
}: BaseContentRendererProps) {
  const { t } = useTranslation();
  const typedContent = content as SummaryContent;
  const styles = getVariantStyles('info');

  if (!typedContent.items || typedContent.items.length === 0) {
    return null;
  }

  return (
    <div className={cn(styles.container, 'border', layout.rounded)}>
      {/* Header */}
      <div className={cn('flex items-center', layout.iconGap, layout.headerPadding)}>
        <List className={cn(layout.iconSize, styles.icon)} />
        <span className={cn(layout.titleText, styles.title)}>
          {typedContent.title}
        </span>
      </div>

      {/* Items */}
      <div className={layout.contentPadding}>
        <ul className={cn('space-y-1')}>
          {typedContent.items.map((item, idx) => (
            <li key={idx} className={cn(layout.bodyText, 'flex items-start')}>
              <span className="mr-2 text-muted-foreground">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
});

// 3. Register and export
// src/components/contentRenderer/index.ts
import { registerRenderer } from '@/components/renderers/registry';
import { SummaryRenderer } from './SummaryRenderer';

registerRenderer({
  type: 'summary',
  component: SummaryRenderer,
});

export { SummaryRenderer } from './SummaryRenderer';

// 4. Add i18n
// src/i18n/locales/en.json
{
  "summaryRenderer.title": "Summary"
}
```

---

## Troubleshooting

### Renderer Not Displaying

1. Check that content type is registered in `registry/types.ts`
2. Verify `registerRenderer()` is called in `src/components/contentRenderer/index.ts`
3. Check browser console for TypeScript/runtime errors
4. Ensure component is wrapped with `memo()`

### Styling Not Applied

1. Verify `getVariantStyles()` is called with correct variant
2. Check that `cn()` is applied to classes (from `@/lib/utils`)
3. Ensure Tailwind classes are spelled correctly
4. Verify color tokens exist in Tailwind config

### i18n Keys Not Found

1. Add key to all 5 language files (en, ko, ja, zh-CN, zh-TW)
2. Keys must have identical spelling across all files
3. Run `pnpm run generate:i18n-types` to regenerate types
4. Verify key count is identical: `pnpm run i18n:sync`

### Search Highlighting Not Working

1. Ensure context object includes searchQuery
2. Use `HighlightedText` component for text highlighting
3. Verify `isCurrentMatch` is passed correctly
4. Check that content text is string type

---

## Existing Renderers Reference

| Renderer | Type | Variant | Location |
|----------|------|---------|----------|
| TextContentRenderer | `text` | — | Built-in |
| ThinkingRenderer | `thinking` | `thinking` | `ThinkingRenderer.tsx` |
| RedactedThinkingRenderer | `redacted_thinking` | `thinking` | `RedactedThinkingRenderer.tsx` |
| ImageRenderer | `image` | — | `ImageRenderer.tsx` |
| DocumentRenderer | `document` | `document` | `DocumentRenderer.tsx` |
| CommandRenderer | `command` | `info` | `CommandRenderer.tsx` |
| ToolUseRenderer | `tool_use` | Tool-specific | `ToolUseRenderer.tsx` |
| ToolSearchToolResultRenderer | `tool_search_tool_result` | `mcp` | `ToolSearchToolResultRenderer.tsx` |
| ServerToolUseRenderer | `server_tool_use` | `web` | `ServerToolUseRenderer.tsx` |
| WebSearchResultRenderer | `web_search_tool_result` | `web` | `WebSearchResultRenderer.tsx` |
| WebFetchToolResultRenderer | `web_fetch_tool_result` | `web` | `WebFetchToolResultRenderer.tsx` |
| MCPToolUseRenderer | `mcp_tool_use` | `mcp` | `MCPToolUseRenderer.tsx` |
| MCPToolResultRenderer | `mcp_tool_result` | `mcp` | `MCPToolResultRenderer.tsx` |
| CodeExecutionToolResultRenderer | `code_execution_tool_result` | `system` | `CodeExecutionToolResultRenderer.tsx` |
| BashCodeExecutionToolResultRenderer | `bash_code_execution_tool_result` | `terminal` | `BashCodeExecutionToolResultRenderer.tsx` |
| TextEditorCodeExecutionToolResultRenderer | `text_editor_code_execution_tool_result` | `code` | `TextEditorCodeExecutionToolResultRenderer.tsx` |
| SearchResultRenderer | `search_result` | `search` | `SearchResultRenderer.tsx` |
| CitationRenderer | `citation` | `info` | `CitationRenderer.tsx` |

---

## Related Documentation

- **Type Definitions**: `src/types/core/content.ts`
- **Design System**: `src/components/renderers/styles.ts`
- **Type Guards**: `src/utils/typeGuards.ts`
- **i18n Setup**: `src/i18n/locales/`

## Support

For questions or issues:

1. Check existing renderers for similar patterns
2. Review the design system documentation
3. Examine type definitions in `src/types/core/`
4. Test new renderers in isolation before integration
