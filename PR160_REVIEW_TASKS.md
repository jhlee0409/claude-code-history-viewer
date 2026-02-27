# PR #160 Review Tasks

Source: CodeRabbit review comments on PR #160  
Status legend: `TODO` / `IN_PROGRESS` / `DONE`

## Review Rule (from comments)
- For every item below: verify against current code first, and only apply a fix if still needed.
- Prefer minimal, behavior-preserving changes.
- Re-run relevant validation after each task batch.

## 1) Icon-only button aria-label coverage
- Status: `DONE`
- Priority: High
- Files:
  - `src/components/ProjectTree/index.tsx`
- Tasks:
  - Add `aria-label` to collapsed-sidebar expand button (`PanelLeft`) using `t("project.expandSidebar", "Expand sidebar")`.
  - Add `aria-label` to grouping mode icon-only buttons:
    - `none` -> `t("project.groupingNone", "Flat list")`
    - `directory` -> `t("project.groupingDirectory", "Group by directory")`
    - `worktree` -> `t("project.groupingWorktree", "Group by worktree")`

## 2) Localize hardcoded aria-labels
- Status: `DONE`
- Priority: High
- Files:
  - `src/components/MessageNavigator/NavigatorEntry.tsx`
  - `src/components/ProjectTree/components/GroupHeader.tsx`
  - i18n locale files (`en/ko/ja/zh-CN/zh-TW`)
- Tasks:
  - Replace hardcoded English navigator entry label with `t(...)` interpolation key.
  - Replace hardcoded GroupHeader aria-label string with `t(...)` key using placeholders (`action`, `label`, `count`).
  - Add/update locale keys across all supported languages.
  - Run `pnpm run generate:i18n-types`.

## 3) Project tree aria-expanded semantics on treeitems
- Status: `DONE`
- Priority: Medium
- Files:
  - `src/components/ProjectTree/components/ProjectItem.tsx`
  - (if needed) `src/components/ProjectTree/types.ts` and callers
- Tasks:
  - Add conditional `aria-expanded` only for expandable items.
  - Determine/propagate `isExpandable` (or equivalent) from data context.

## 4) Modal focus restoration fallback robustness
- Status: `DONE`
- Priority: High
- Files:
  - `src/contexts/modal/ModalProvider.tsx`
  - `src/test/ModalProvider.focus.test.tsx`
- Tasks:
  - Improve `restoreFocus`/`closeAllModals` to handle unmounted opener elements by checking fallback candidates in reverse-open order.
  - Add regression test for nested-opener-unmount case:
    - Open modal A (`open-feedback`)
    - Open modal B from inside A (`open-search`)
    - Remove/unmount A opener
    - `closeAllModals` (`close-all`)
    - Assert focus lands on next valid fallback opener

## 5) MessageNavigator a11y test brittleness
- Status: `DONE`
- Priority: Medium
- Files:
  - `src/test/MessageNavigator.accessibility.test.tsx`
- Tasks:
  - Replace exact English-name queries with stable selection (e.g., `getAllByRole("option")[index]`) to avoid locale-copy coupling.

## 6) Live status message prioritization
- Status: `DONE`
- Priority: Medium
- Files:
  - `src/App.tsx`
- Tasks:
  - Change `liveStatusMessage` from concatenated multi-state string to highest-priority single status.
  - Use explicit priority order:
    - updater checking
    - app initializing
    - analytics loading
    - message loading
    - project scanning
    - session loading
  - Ensure dependency array matches actual reads.

## 7) Keyboard help wording precision
- Status: `DONE`
- Priority: Low
- Files:
  - `src/i18n/locales/en/session.json`
- Tasks:
  - Update copy from “expand sibling groups” to “expand collapsed sibling groups”.

## 8) Settings persistence error-handling consistency
- Status: `DONE`
- Priority: Medium
- Files:
  - `src/store/slices/settingsSlice.ts`
- Tasks:
  - Align `setFontScale` and `setHighContrast` error handling with project convention:
    - Option A: show `toast.error(...)`
    - Option B: keep silent warn and add explicit comment documenting intentional behavior
  - Apply same chosen pattern in both functions.

## 9) Validation checklist after fixes
- Status: `DONE`
- Priority: High
- Tasks:
  - `pnpm run generate:i18n-types` - completed
  - `pnpm tsc --build .` - completed
  - `pnpm lint` - completed (pre-existing warnings only, no new errors)
  - `pnpm vitest run` - completed (all tests passing)
  - Update PR description/checklist with resolved review points.
