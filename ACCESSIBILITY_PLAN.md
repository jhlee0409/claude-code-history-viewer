# Accessibility Plan (Visually Impaired and Blind Coders)

## Objective
Make Claude Code History Viewer robust for blind and low-vision coders by prioritizing screen reader semantics, full keyboard workflows, and scalable readability without breaking existing power-user flows.

## Success Metrics
1. 100% keyboard completion for core workflows: select project, open session, read messages, open settings, change filters.
2. 0 critical automated a11y violations (axe) on core screens.
3. Font scale persistence works across restart with no critical clipping in primary layouts.
4. Screen reader smoke tests pass on NVDA + Chrome and VoiceOver + Safari for core workflows.

## Scope and Non-Goals
- In scope:
1. Blind and low-vision usability of primary app workflows.
2. Semantic structure, focus behavior, keyboard interaction model, scalable typography.
3. Accessibility regression tooling in CI for the frontend.
- Out of scope for initial cycle:
1. Full WCAG certification process.
2. Complete redesign of analytics visual language.
3. Elimination of every hardcoded font size in one pass.

## Baseline Standards
- WCAG 2.2 AA baseline.
- No pointer-only interactions for required tasks.
- Programmatic name/role/value/state for interactive components.
- Predictable focus order and focus return behavior.

## Codebase Risk Areas
1. Virtualized and dynamic content surfaces in message/session views.
2. Dense compact typography and hardcoded small sizes.
3. Icon-centric controls in header and tool panels.
4. Chart-heavy analytics views with hover-first interaction.

## Workstreams

### 1) Semantics and Screen Reader UX
- Add landmark structure and heading hierarchy.
- Ensure icon-only controls use explicit accessible names.
- Add `aria-live` announcements for asynchronous state changes.
- Ensure expand/collapse controls expose `aria-expanded` and `aria-controls`.

### 2) Keyboard and Focus System
- Define and enforce keyboard interaction contracts for dropdowns, dialogs, trees, and virtualized lists.
- Harden focus trap and focus return in modal and settings flows.
- Ensure deterministic tab sequence in sidebar, main viewer, and settings.
- Improve focus ring visibility in all themes.

### 3) Low-Vision Readability
- Add persistent global font scaling (90/100/110/120/130%).
- Route typography tokens through a root scale variable.
- Prioritize conversion of tiny hardcoded text in high-traffic components.
- Add high-contrast visual mode after font scaling lands.

### 4) Non-Visual Navigation
- Add skip links to major regions.
- Add concise structural summaries for dense tool outputs.
- Improve positional context in virtualized lists where feasible.
- Provide keyboard shortcuts and a discoverable shortcut reference.

### 5) Analytics and Data Alternatives
- Provide textual summary mode for chart-heavy cards.
- Ensure all chart values are available by keyboard and screen reader.
- Add table fallbacks for key metrics where chart-only today.

### 6) Testing and Regression Gates
- Add `eslint-plugin-jsx-a11y` and `jest-axe`/`vitest-axe` checks for core components.
- Add keyboard E2E smoke cases.
- Add manual assistive-tech matrix per release.
- Block merges on high-severity a11y regressions in touched areas.

## Execution Plan by Phase

### Phase 1: Foundation (Sprint 1)
1. Implement `fontScale` setting with persistence and app-wide CSS variable.
2. Add font size control to settings dropdown.
3. Fix missing names/roles on high-traffic controls.
4. Add baseline `aria-live` region for update/watcher status.
5. Add initial automated a11y checks for root app shell and settings dropdown.

#### Phase 1 Subtasks
1. `settingsSlice` model update:
- Add `fontScale: number` to state interface and initial state.
- Add `setFontScale(scale)` action with store save logic.
- Load persisted `fontScale` during settings hydration with default fallback `100`.
2. Global font scaling wiring:
- Add `--app-font-scale` root variable in `src/index.css`.
- Scale typography tokens (`--font-size-*`) via `calc(base * var(--app-font-scale))`.
- Apply `fontScale` to `document.documentElement.style` from app bootstrap/effect.
3. Settings UI for font size:
- Create `FontMenuGroup.tsx` under header dropdown.
- Add radio options `90/100/110/120/130` with selected-state indicator.
- Insert group into `SettingDropdown` with separators and keyboard-safe structure.
4. i18n coverage:
- Add `common.settings.font.title`, `common.settings.font.compact`, `common.settings.font.default`, `common.settings.font.large`, `common.settings.font.extraLarge`, `common.settings.font.max`.
- Add keys to `en`, then mirror to `ko`, `ja`, `zh-CN`, `zh-TW`.
- Run i18n key sync/validation scripts.
5. Semantics quick wins:
- Audit icon-only controls in header and top-level actions.
- Add missing `aria-label` and `title` where appropriate.
- Ensure menu triggers communicate expanded/collapsed state.
6. Live region baseline:
- Add a shared polite `aria-live` status region in app shell.
- Emit update-check, watcher, and loading status messages.
- Debounce noisy status updates to avoid repetitive announcements.
7. Phase 1 verification:
- Add unit tests for `fontScale` load/save behavior.
- Add component tests for settings menu selection behavior.
- Add axe test for app shell + settings dropdown.
- Manual check: restart persistence and layout smoke at 130%.

### Phase 2: Navigation and Focus (Sprint 2)
1. Add skip links and landmark labels.
2. Formalize focus behavior for dropdowns/dialogs and verify focus return.
3. Improve keyboard traversal for Project Tree, Session list, and Message Viewer.
4. Convert highest-impact fixed tiny fonts to token-based values.

#### Phase 2 Subtasks
1. Landmark and skip-link structure:
- Add skip links before main shell content.
- Define targets for projects, sessions, message content, and settings.
- Ensure targets are focusable and visible on focus.
2. Focus management contracts:
- Document expected focus behavior for dropdown, dialog, modal, command palette.
- Implement focus return to opener for each close path (`Esc`, close button, click outside).
- Add focus-trap regression tests for modal surfaces.
3. Keyboard traversal improvements:
- Project tree: arrow navigation, expand/collapse semantics, selected-item announcement.
- Session list: consistent enter/space behavior, active item state.
- Message viewer: section navigation and stable keyboard anchors for long content.
4. Typography hardcoded-size cleanup:
- Inventory `text-[Npx]` and inline `fontSize` with `rg`.
- Prioritize replacement in header, navigation panels, and metadata chips.
- Preserve dense layouts while increasing minimum readable floor.
5. Phase 2 verification:
- Keyboard smoke tests: full workflow without pointer.
- Focus order assertions in tests.
- Manual checks with NVDA + Chrome and keyboard-only mode.

### Phase 3: Complex Surfaces (Sprint 3)
1. Accessibility pass for renderers/tool output cards.
2. Add non-visual summaries and chart alternatives in analytics views.
3. Improve virtualized list announcements and contextual metadata.

#### Phase 3 Subtasks
1. Renderer semantics refactor:
- Add semantic wrappers for tool sections (`region` + accessible names).
- Ensure expandable result blocks expose current state.
- Provide concise screen-reader-only summaries for long output chunks.
2. Analytics non-visual alternatives:
- Add textual summary cards for each chart panel.
- Add table fallback for key datasets.
- Ensure chart values can be read without hover interaction.
3. Virtualization accessibility:
- Ensure list containers expose total counts where available.
- Add “position in list” context for focused entries when feasible.
- Preserve focus anchor when virtualized rows mount/unmount.
4. Phase 3 verification:
- Axe checks for analytics dashboard and message renderer composites.
- Screen reader walkthrough for long session with mixed tool outputs.
- Manual regression on performance after semantic additions.

### Phase 4: Hardening (Ongoing)
1. Expand automated checks to additional screens.
2. Add recurring manual AT audit cadence.
3. Track and burn down a11y debt in a dedicated backlog.

#### Phase 4 Subtasks
1. CI and quality gates:
- Add a11y test jobs to CI workflows.
- Set fail thresholds for critical/high violations.
- Add PR template checklist for accessibility impact.
2. Operational audit loop:
- Define monthly AT smoke test cadence.
- Rotate platform/browser combos and keep results in docs.
- Track recurring issues and create remediation tickets.
3. Accessibility debt management:
- Maintain backlog labels: `a11y-p0`, `a11y-p1`, `a11y-techdebt`.
- Track completion rate and reopened regressions per release.
- Include a11y status in release readiness checklist.

## File-Level Implementation Map (Phase 1-2)
1. `src/store/slices/settingsSlice.ts`: add `fontScale`, load/save actions.
2. `src/store/useAppStore.ts`: expose updated settings slice shape.
3. `src/layouts/Header/SettingDropdown/index.tsx`: include new font menu group.
4. `src/layouts/Header/SettingDropdown/`: add `FontMenuGroup.tsx`.
5. `src/index.css`: add `--app-font-scale` and scale typography tokens.
6. `src/main.tsx` or app shell: apply font scale to `documentElement` on load/state change.
7. `src/i18n/locales/*/common.json`: add `common.settings.font.*` labels.
8. `src/test/` and component tests: add store + UI + basic a11y assertions.

## Ticket Breakdown Template
1. `P0` Foundation tickets:
- `P0-1`: Font scale state + persistence.
- `P0-2`: Font size dropdown UI + i18n wiring.
- `P0-3`: App-level CSS token scaling.
- `P0-4`: Icon-only control naming audit.
- `P0-5`: Live region baseline.
2. `P1` Navigation tickets:
- `P1-1`: Skip links + landmarks.
- `P1-2`: Modal/menu focus return guarantees.
- `P1-3`: Keyboard traversal for project/session/message surfaces.
- `P1-4`: Hardcoded tiny typography replacement pass.
3. `P2` Complex surface tickets:
- `P2-1`: Renderer semantic grouping and summaries.
- `P2-2`: Analytics textual alternatives and table fallbacks.
- `P2-3`: Virtualization context announcements.

## Estimation Model
1. Small (S): <= 0.5 day, localized component-level change.
2. Medium (M): 1-2 days, cross-file frontend change with tests.
3. Large (L): 3-5 days, cross-surface behavior changes and regression risk.
4. Extra Large (XL): > 1 week, multi-sprint feature with architecture impact.

## Suggested Initial Estimates
1. `P0-1` Font scale state + persistence: `M`.
2. `P0-2` Font size dropdown + i18n: `S-M`.
3. `P0-3` CSS token scaling: `M`.
4. `P0-4` Icon naming audit: `M`.
5. `P0-5` Live region baseline: `M`.

## Definition of Done
1. Core workflows are fully keyboard-operable and screen-reader understandable.
2. Font scale setting persists and applies globally.
3. Core views pass automated a11y tests with zero critical violations.
4. Manual AT smoke tests pass for supported combinations.
5. CI prevents regressions for changed UI surfaces.

## QA Matrix
1. NVDA + Chrome (Windows).
2. Narrator + Edge (Windows).
3. VoiceOver + Safari (macOS).
4. Keyboard-only traversal without screen reader.

## Process Rules
1. Every UI PR includes an accessibility checklist and keyboard behavior notes.
2. New interactive components ship with semantic labels and focus behavior defined.
3. Release notes include accessibility improvements and known limitations.
