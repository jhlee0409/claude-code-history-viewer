# Dead Code Analysis Report (Frontend)

**Generated**: 2026-01-25 (Updated)
**Target**: TypeScript/React Frontend (`src/`)

---

## Summary

| Category | Found | Cleaned |
|----------|-------|---------|
| Unused Files | 19 | 18 |
| Unused Dependencies | 4 | 5 |
| Unused Dev Dependencies | 6 | 1 |
| Unused Exports | 68 | 4 |
| Unused Exported Types | 30 | - |
| Duplicate Exports | 3 | 3 |

---

## CLEANED (This Session - 2026-01-25)

### Removed Dev Dependencies
- `autoprefixer` - Not used (replaced by @tailwindcss/postcss)

### Removed Duplicate Exports
- `src/components/common/HighlightedText.tsx` - Removed `export default`
- `src/components/ProjectContextMenu.tsx` - Removed `export default`
- `src/services/analyticsApi.ts` - Removed `analyticsApi` object and `export default`

### Refactored Components
- `src/components/CollapsibleToolResult.tsx` - **DELETED**
  - Extracted `getToolName` to new `src/utils/toolUtils.ts`
  - Component was unused, only `getToolName` function was imported

### New Utility File Created
- `src/utils/toolUtils.ts` - Contains `getToolName` function

---

## CLEANED (Previous Session)

### Deleted Script Files
- `scripts/cleanup-i18n-imports.mjs`
- `scripts/migrate-colors.js`
- `scripts/migrate-i18n-keys.mjs`

### Deleted Test Server
- `test-server/` (entire directory)

### Deleted Unused Barrel Exports
- `src/components/AnalyticsDashboard/index.ts`
- `src/components/MessageViewer/components/index.ts`
- `src/components/MessageViewer/hooks/index.ts`
- `src/components/MessageViewer/index.ts`
- `src/layouts/Header/index.ts`
- `src/services/index.ts`
- `src/store/slices/index.ts`

### Deleted Unused Utility Files
- `src/constants/colors.ts`
- `src/utils/color.ts`
- `src/utils/messageAdapter.ts`

### Deleted Unused Hooks
- `src/hooks/useNativeUpdater.ts`
- `src/hooks/usePagination.ts`

### Deleted Unused Component Files
- `src/components/contentRenderer/SyntaxHighlighterLazy.tsx`
- `src/layouts/Header/SettingDropdown/menuConfig.ts`

### Removed Dependencies
- `@types/diff`
- `@types/react-syntax-highlighter`
- `react-syntax-highlighter`
- `@types/flexsearch`

---

## NOT CLEANED (Intentional - Keep)

### False Positives
- `scripts/sync-version.cjs` - Used by `justfile`, knip doesn't detect this

### Unused Dev Dependencies (Keep for Future Use)
- `rollup-plugin-visualizer` - Optional bundle analysis tool (commented out in vite.config.ts)

### Unused Content Renderers (Keep - Future Claude API Types)
These are prepared for upcoming Claude API 2025 beta content types:
- `RedactedThinkingRenderer`
- `ServerToolUseRenderer`
- `WebSearchResultRenderer`
- `DocumentRenderer`
- `CitationRenderer`
- `SearchResultRenderer`
- `MCPToolUseRenderer`
- `MCPToolResultRenderer`
- `WebFetchToolResultRenderer`
- `CodeExecutionToolResultRenderer`
- `BashCodeExecutionToolResultRenderer`
- `TextEditorCodeExecutionToolResultRenderer`
- `ToolSearchToolResultRenderer`

### shadcn/ui Components (Library Pattern - Keep)
Variant exports follow shadcn/ui patterns:
- `alertVariants`, `badgeVariants`, `buttonVariants`, etc.
- UI component variants like `CardFooter`, `DialogClose`, etc.

### Type Exports (API Contract - Keep)
- Type definitions in `src/types/` are part of the public API
- May be used by external tooling or future features

### Helper Re-exports (Internal API - Keep)
- `src/components/MessageViewer/helpers/index.ts` - Internal module API
- `src/hooks/index.ts` - Hook barrel exports
- `src/store/slices/*.ts` - Initial state exports for testing

---

## Verification

- **Build**: PASSED
- **Tests**: 277 passed, 2 failed (pre-existing failures in worktreeUtils.test.ts)
- **Lint**: PASSED

---

## Cleanup Summary

| Metric | This Session | Total |
|--------|--------------|-------|
| Files Deleted | 1 | 18 |
| Files Modified | 4 | - |
| Dependencies Removed | 1 | 5 |
| Duplicate Exports Fixed | 3 | 3 |
| Build Status | OK | OK |
