# Spec: Horizontal overflow support for long terminal commands and code blocks (Issue #122)

## Classification
- **Type:** MAJOR
- **Reasoning:** This is a cross-cutting UI behavior issue, not a one-off tweak. The current truncation/cutoff behavior appears in header metadata and in multiple renderer code/output surfaces. A robust fix requires shared overflow policy updates plus targeted adoption across several renderer files (5+ files), with responsive behavior validation.

## Problem Description
Users cannot view full long terminal commands in session logs when command text exceeds the available width. Increasing window width does not always help because the log column intentionally has a max readable width, and some card containers clip overflow.

Observed UX failure:
- Long command strings are visually cut off in tool/terminal cards.
- No horizontal scrollbar is available where command text overflows.
- In narrow layouts (small screens/split view), code/output content can become hard to inspect without predictable horizontal scrolling.

Issue #122 explicitly asks for horizontal scrolling when terminal command text overflows, and suggests extending overflow-x support to other code-like views where appropriate.

## Root Cause Analysis
Based on current renderer structure:

1. **Header-level clipping for right-side metadata**
   - `Renderer` wrapper uses `overflow-hidden` at the card container level (`src/shared/RendererHeader.tsx`).
   - Some terminal-related components place long `command` text in `Header.rightContent` (e.g., `TerminalStreamRenderer`), where no dedicated horizontal scroll container is provided.
   - Result: long inline command metadata can be clipped with no recovery path.

2. **Inconsistent pre/code overflow policy across renderers**
   - Multiple renderers use combinations like `overflow-x-auto` + `whitespace-pre-wrap` (or generic `overflow-auto`) inconsistently.
   - `whitespace-pre-wrap` encourages wrapping rather than preserving one-line command readability.
   - Lack of a centralized “single-line command vs multiline code output” rule leads to fragmented behavior.

3. **No shared overflow contract for renderer surfaces**
   - There is no single reusable class/pattern documenting when to:
     - preserve line (`whitespace-pre`) and horizontal scroll,
     - wrap (`whitespace-pre-wrap`),
     - or apply both axes scrolling in constrained containers.

## Proposed Solution
Implement a **consistent horizontal overflow policy** for renderer content, prioritized for terminal command visibility.

### A. Define overflow behavior by content type
1. **Command strings (single-line shell commands):**
   - Preserve line (`whitespace-pre`)
   - Enable horizontal scrolling (`overflow-x-auto`)
   - Avoid forced truncation/cutoff

2. **Code/output blocks (potentially multiline):**
   - Keep vertical cap behavior (`max-h-*` + `overflow-y-auto`)
   - Enable horizontal scrolling for long lines
   - Use wrapping only where semantically desirable (e.g., prose-like text), not default for code/terminal output

3. **Header metadata containing long technical text:**
   - Do not rely on clipped inline rendering.
   - Either:
     - add scrollable containment in header right content, or
     - move long command display into content body row under the header (preferred for accessibility/readability).

### B. Apply to terminal-first surfaces (must-fix)
- Terminal command display in `TerminalStreamRenderer`
- Bash tool input command display in `BashToolRenderer`
- Bash/code execution result output blocks where long command/output lines appear

### C. Apply to adjacent code-like surfaces (nice-to-have in same pass)
- Generic tool input JSON viewers
- Text editor/code result preview pre blocks
- MCP/web-fetch blocks that currently wrap long technical lines unexpectedly

### D. Document the renderer rule
- Add/update renderer documentation to specify:
  - when to use horizontal scroll,
  - when wrapping is acceptable,
  - and responsive behavior expectations under narrow viewport.

## Specific File Changes (planned)
> Spec only. No implementation in this PR.

1. **`src/shared/RendererHeader.tsx`**
   - Adjust header/right-content strategy so long technical metadata is not silently clipped.
   - Introduce safe layout behavior for overflowing right-side content.

2. **`src/components/toolResultRenderer/TerminalStreamRenderer.tsx`**
   - Ensure `command` display has horizontal scroll access (and is no longer hard-clipped in header).
   - Keep output block readable under narrow width.

3. **`src/components/contentRenderer/toolUseRenderers/BashToolRenderer.tsx`**
   - Enforce horizontal scroll policy for long bash command input blocks.

4. **`src/components/contentRenderer/BashCodeExecutionToolResultRenderer.tsx`**
   - Normalize stdout/stderr overflow behavior for long unbroken lines.

5. **`src/components/contentRenderer/CodeExecutionToolResultRenderer.tsx`**
   - Align Python/code execution output overflow behavior with the same policy.

6. **`src/components/contentRenderer/ToolUseRenderer.tsx`**
   - Normalize generic tool input JSON/code block overflow behavior.

7. **`src/components/renderers/styles.ts`**
   - Add/adjust shared composite style(s) for command/code overflow handling to reduce per-file drift.

8. **`src/components/renderers/README.md`**
   - Document the overflow contract and usage examples for future renderers.

## Affected Files List
- `src/shared/RendererHeader.tsx`
- `src/components/toolResultRenderer/TerminalStreamRenderer.tsx`
- `src/components/contentRenderer/toolUseRenderers/BashToolRenderer.tsx`
- `src/components/contentRenderer/BashCodeExecutionToolResultRenderer.tsx`
- `src/components/contentRenderer/CodeExecutionToolResultRenderer.tsx`
- `src/components/contentRenderer/ToolUseRenderer.tsx`
- `src/components/renderers/styles.ts`
- `src/components/renderers/README.md`

## Testing Plan
1. **Reproduction baseline**
   - Use a long bash command (significantly wider than card width) and verify current cutoff behavior exists before fix.

2. **Terminal command visibility**
   - Confirm full command is reachable via horizontal scroll at default window size.
   - Confirm behavior remains usable when window is narrowed (split view / small laptop width).

3. **Code/output block behavior**
   - Verify long unbroken lines in stdout/stderr and code blocks are horizontally scrollable.
   - Verify multiline output still supports vertical scrolling and does not cause layout breakage.

4. **Header layout regression check**
   - Ensure tool ID badges, timestamps, and controls remain usable and not overlapped.
   - Validate both expanded and collapsed card states.

5. **Theme and platform check**
   - Test light/dark themes.
   - Test desktop app and browser build if applicable.

6. **Non-goals/regression boundaries**
   - No changes to max content width philosophy of session column.
   - No blanket replacement of prose wrapping; only technical command/code/output surfaces.

## Risks and Mitigations
- **Risk:** Over-applying horizontal scroll can hurt readability for normal text.
  - **Mitigation:** Restrict policy to command/code/output surfaces.
- **Risk:** Header interaction regressions if overflow handling changes.
  - **Mitigation:** Prefer moving long command text into content row when header space is constrained.
- **Risk:** Inconsistent behavior across legacy renderer files.
  - **Mitigation:** Centralize class patterns in shared renderer styles and document usage.

## Rollout Plan
1. Implement terminal-first fixes.
2. Apply shared overflow policy to adjacent code-like renderers.
3. Validate responsive behavior and theme consistency.
4. Close issue after confirming full-command visibility in real long-command scenarios.
