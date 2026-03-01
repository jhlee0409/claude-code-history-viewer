# Accessibility Changelog

This file tracks implemented accessibility work on branch `feat/a11y-foundation-plan` for PR documentation.

## 2026-02-27

### App Shell and Global Accessibility
- Added skip links for project explorer, main content, message navigator, and settings button.
- Added app-level polite live region for loading/update status.
- Added persisted global font scaling (`90/100/110/120/130`) and settings UI controls.
- Added high-contrast mode setting and root class token overrides.

### Keyboard and Focus
- Added modal opener focus restoration on close and close-all paths.
- Added keyboard traversal in message navigator:
  - roving focus model
  - `ArrowUp`/`ArrowDown`/`Home`/`End`
  - `Enter`/`Space` activation
- Added keyboard traversal in project tree:
  - `ArrowUp`/`ArrowDown`/`Home`/`End`
  - `*` expands collapsed sibling groups
  - type-ahead focus search with wrap-around
- Added project tree roving `tabIndex` so only one tree item is tabbable at a time.

### Screen Reader Semantics
- Converted navigator entries and project items to semantic button-based controls.
- Added project tree semantics:
  - container `role="tree"`
  - nodes `role="treeitem"`
  - nested `role="group"` containers
  - `aria-level`, `aria-expanded`, and `aria-selected` states
- Added project-tree-specific polite live region announcements for:
  - focus movement between tree items
  - current selection updates
  - sibling-group expansion via `*`
- Added `aria-describedby` keyboard-help hints for project tree and message navigator containers.

### Tests Added
- `src/test/App.accessibility.test.tsx`
- `src/test/ModalProvider.focus.test.tsx`
- `src/test/MessageNavigator.accessibility.test.tsx`
- `src/components/ProjectTree/components/__tests__/TreeSemantics.test.tsx`
- `src/test/treeKeyboard.test.ts`

### Documentation
- Added `README.md` accessibility section with keyboard controls, screen reader behavior, and visual accessibility options.

### Validation Commands
- `pnpm tsc --build .`
- `pnpm vitest run src/test/MessageNavigator.accessibility.test.tsx src/test/App.accessibility.test.tsx src/test/ModalProvider.focus.test.tsx`
- `pnpm vitest run src/components/ProjectTree/components/__tests__/TreeSemantics.test.tsx src/components/ProjectTree/components/__tests__/GroupedProjectList.test.tsx src/test/treeKeyboard.test.ts`
