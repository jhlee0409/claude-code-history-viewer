# Dead Code Analysis Report (Frontend)

**Generated**: 2026-01-26 (Updated)
**Target**: TypeScript/React Frontend (`src/`)

---

## Summary

| Category | Found | Cleaned |
|----------|-------|---------|
| Unused Files | 4 | 4 |
| Unused Dependencies | 1 | 1 |
| Unused Dev Dependencies | 1 | 0 |
| Unused Exports | 115 | 43 |
| Unused Exported Types | 192 | - |
| Duplicate Exports | 3 | 3 |

---

## CLEANED (Session - 2026-01-26)

### Deleted Unused Files
- `src/components/MessageViewer/components/index.ts` - Barrel export not used (components imported directly)
- `src/config/app.config.ts` - Configuration file with no imports
- `src/store/slices/index.ts` - Barrel export not used (slices imported directly)

### Removed Unused Hook
- `src/hooks/useModals.ts` - Hook completely unused in codebase

### Removed Unused Dependency
- `@tauri-apps/plugin-http` - Not used anywhere in code

### Made Internal Constants Private (removed unnecessary exports)
- `src/store/slices/analyticsSlice.ts` - `initialAnalyticsSliceState`
- `src/store/slices/captureModeSlice.ts` - `initialCaptureModeState`
- `src/store/slices/globalStatsSlice.ts` - `initialGlobalStatsState`
- `src/store/slices/messageSlice.ts` - `initialMessageState`
- `src/store/slices/projectSlice.ts` - `initialProjectState`
- `src/store/slices/searchSlice.ts` - `initialSearchState`
- `src/store/slices/settingsSlice.ts` - `initialSettingsState`

### Made Internal Helpers Private (removed unnecessary exports)
- `src/components/MessageViewer/helpers/agentProgressHelpers.ts` - `isAgentProgressMessage`
- `src/components/MessageViewer/helpers/agentTaskHelpers.ts` - `isAgentTaskLaunchMessage`, `isAgentTaskCompletionMessage`, `isAgentTaskMessage`, `extractAgentTask`

### Cleaned Up Unused Config Exports
- `src/config/update.config.ts` - Removed 8 unused constants (kept only 3 that are used)

### Simplified Barrel Exports
- `src/hooks/index.ts` - Reduced from 5 exports to 1 (only `useToggle` used via barrel)
- `src/components/MessageViewer/helpers/index.ts` - Reduced from 16 exports to 2

---

## CLEANED (Session - 2026-01-25)

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

## Remaining Unused (Intentional - Keep)

### False Positives
- `scripts/sync-version.cjs` - Used by `justfile`, knip doesn't detect this

### Unused Dev Dependencies (Keep for Future Use)
- `rollup-plugin-visualizer` - Optional bundle analysis tool (commented out in vite.config.ts)

### Unused Content Renderers (Keep - Public API for Future Content Types)
These components are exported as part of a consistent public API pattern:
- Various renderers in `src/components/contentRenderer/`
- Various renderers in `src/components/messageRenderer/`

### shadcn/ui Components (Library Pattern - Keep)
Variant exports follow shadcn/ui patterns:
- `alertVariants`, `badgeVariants`, `buttonVariants`, etc.
- UI component variants like `CardFooter`, `DialogClose`, etc.

### Type Exports (API Contract - Keep)
- Type definitions in `src/types/` are part of the public API
- 192 unused exported types are intentionally kept for external tooling and type safety

---

## Verification

- **Build**: PASSED
- **TypeScript**: PASSED
- **Tests**: 331 passed
- **Lint**: PASSED

---

## Cleanup Summary

| Metric | 2026-01-26 Session | Total |
|--------|--------------|-------|
| Files Deleted | 4 | 22 |
| Files Modified | 11 | - |
| Dependencies Removed | 1 | 6 |
| Exports Cleaned | 43 | 47 |
| Build Status | OK | OK |
