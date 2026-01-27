# Attribute Brushing Spec: SessionBoard

## Design Rationale

The patent's (WO2015073666A1) key insight was cross-session pattern recognition via column-based visualization. Brushing answers: "which sessions touched this file?", "where did errors cluster?", "what was my tool mix?" — Shneiderman's mantra: overview first, zoom and filter, then details-on-demand.

---

## Brush Dimensions

| Dimension | Values | Source |
|-----------|--------|--------|
| **role** | user, assistant | `message.role` |
| **tool** | code, file, search, terminal, git, web, mcp, task | `getToolVariant()` → `RendererVariant` |
| **file** | specific file paths | `sessionAnalytics.fileEdits` |
| **status** | error, cancelled, cutoff, commit | stop_reason + error detection |

### Tool Categories (normalized via `RendererVariant`)

| Category | Tools | Color Var |
|----------|-------|-----------|
| code | Read, Write, Edit, MultiEdit, NotebookEdit, LSP | `--tool-code` |
| file | Glob, LS | `--tool-file` |
| search | Grep, Search | `--tool-search` |
| terminal | Bash, KillShell (non-git shell) | `--tool-terminal` |
| git | git commit (detected via command content) | `--tool-git` |
| web | WebSearch, WebFetch | `--tool-web` |
| mcp | mcp_tool_use, server_tool_use | `--tool-mcp` |
| task | Task, TodoWrite, TodoRead | `--tool-task` |

---

## Architecture: Pre-Implementation Fixes

### Issue 1: Variant Divergence (MUST FIX FIRST)

Two competing `getToolVariant` implementations:

- **`src/components/renderers/types.ts`** (canonical): Maps `Bash` → `"system"`, uses exact tool names
- **`src/utils/toolIconUtils.ts`** (fuzzy): Maps bash → `"terminal"`, uses `toLowerCase().includes()`

The canonical `TOOL_VARIANTS` map in `renderers/types.ts` maps `Bash`/`KillShell` to `"system"`, but the RendererVariant type includes both `"system"` and `"terminal"` as distinct values. Meanwhile, `toolIconUtils.ts` returns `"terminal"` for the same tools, and `InteractionCard`'s pixel view switch expects `'terminal'`.

**Resolution:** Consolidate to a single source of truth. Remove `getToolVariant` from `toolIconUtils.ts`. Update the canonical `TOOL_VARIANTS` in `renderers/types.ts`:

```typescript
// Rename "system" → "terminal" for Bash/KillShell
Bash: "terminal",
KillShell: "terminal",
```

Deprecate the `"system"` variant or alias it to `"terminal"`. The fuzzy matching in `toolIconUtils.ts` becomes a fallback for unknown/MCP tool names only, delegating to the canonical map first:

```typescript
export const getToolVariant = (name: string): RendererVariant => {
    // Canonical exact match first
    if (TOOL_VARIANTS[name]) return TOOL_VARIANTS[name];
    // Fuzzy fallback for unknown tools (MCP, custom)
    const lower = name.toLowerCase();
    if (lower.includes("bash") || lower.includes("command") || lower.includes("shell")) return "terminal";
    // ... remaining fuzzy rules
    return "neutral";
};
```

### Issue 2: InteractionCard Inline Conditionals

InteractionCard.tsx has ~917 lines with visual variant logic duplicated across 3 zoom-level render blocks. Brushing will add another conditional layer to each.

**Resolution:** Extract a `CardSemantics` interface computed once per card:

```typescript
interface CardSemantics {
    role: "user" | "assistant" | "system";
    variant: RendererVariant;     // from getToolVariant
    isCommit: boolean;
    isShell: boolean;             // NEW: terminal without git
    isFileEdit: boolean;
    editedMdFile: string | null;
    isError: boolean;
    isCancelled: boolean;
    isMcp: boolean;
    hasUrls: boolean;
    brushMatch: boolean;          // computed against activeBrush
}
```

Compute this once via `useMemo` at the top of InteractionCard, then each zoom level reads from it. This prevents the current pattern of re-deriving `isCommit`, `isFileEdit`, etc. in scattered `useMemo` hooks.

### Issue 3: Tool Frequency Summary Not Memoized

Lines ~780-819 of InteractionCard (zoom 2 header) compute tool frequency inline with an IIFE — recalculates on every render. With brushing adding re-renders on hover, this becomes a performance risk.

**Resolution:** Extract to `useMemo` with `[message, siblings]` deps.

### Issue 4: Brush State Location

`activeBrush` is in `boardSlice`, `dateFilter` is in `filterSlice`. Both are filtering mechanisms.

**Resolution:** Keep them separate — dateFilter operates on sessions (coarse), brush operates on cards (fine). Different granularity = different slices is correct. But add a `brushUtils.ts` that both components import, rather than embedding match logic in the card component.

---

## Terminal Visual Treatment (NEW)

Terminal (shell commands) should get visual distinction comparable to git commits, since shell activity is high-signal.

### Detection

```typescript
// Add to CardSemantics, after isCommit
const isShell = useMemo(() => {
    if (!toolUseBlock) return false;
    const variant = getToolVariant(toolUseBlock.name);
    return variant === 'terminal' && !isCommit;
}, [toolUseBlock, isCommit]);
```

`isShell` is `true` for bash/shell commands that are NOT git commits. Git commits already have their own treatment.

### Zoom 0 (Pixel)

Already distinct via `bg-[var(--tool-terminal)]`. No change.

### Zoom 1 (Skim)

Add **"SHELL"** badge mirroring git's "COMMIT" badge:

```tsx
{isShell && (
    <span className="ml-1 text-tool-terminal font-bold bg-tool-terminal/10 px-1 rounded-[2px] border border-tool-terminal/20">
        SHELL
    </span>
)}
```

Show command preview (first 40 chars of the bash command) as muted subtext.

### Zoom 2 (Read)

Add a **command banner** above card content, matching the file edit banner pattern:

```tsx
{isShell && shellCommand && (
    <div className="flex items-center gap-1.5 px-2 py-1 bg-[var(--tool-terminal)]/10 border-b border-[var(--tool-terminal)]/20">
        <Terminal className="w-3.5 h-3.5 text-tool-terminal" />
        <code className="text-xs text-tool-terminal font-mono truncate">{shellCommand}</code>
    </div>
)}
```

Existing exit code badge (green 0 / red non-zero) already renders here — no change needed.

### Git vs Terminal Hierarchy

- **Git commit** (`isCommit`): `GitCommitVertical` icon, indigo accent, "COMMIT" / "GIT" badge, verified checkmark. Takes priority over terminal styling.
- **Terminal** (`isShell`): `Terminal` icon, terminal accent color, "SHELL" badge, command preview. Only when NOT a git commit.

Both light up when brush is `{ type: "tool", value: "terminal" }` — OR keep them separate so `"git"` and `"terminal"` are independent brush values. Recommended: **keep separate**, since users care about the distinction.

---

## Interaction Model

### Hover Brush (Transient)

Hovering a card dims all non-matching cards across all lanes. Mouse leave restores.

**Wiring:** Connect existing `onHover`/`onLeave` callbacks in InteractionCard to `setActiveBrush`:

```typescript
// InteractionCard — on mouseEnter
onHover?.(semantics.variant, semantics.variant);  // e.g. type="tool", value="terminal"

// SessionBoard — handler
const handleHover = useCallback((type: string, value: string) => {
    setActiveBrush({ type, value });
}, [setActiveBrush]);

const handleLeave = useCallback(() => {
    if (!stickyBrush) setActiveBrush(null);  // Only clear if not sticky
}, [stickyBrush, setActiveBrush]);
```

### Click Brush (Sticky)

Clicking a tool badge or brush chip in BoardControls locks the filter. Click again or Escape to clear.

**New state in boardSlice:**

```typescript
stickyBrush: boolean;  // When true, hover doesn't clear brush
setStickyBrush: (sticky: boolean) => void;
```

### Keyboard

- `Escape` — clear active brush and sticky state
- No other shortcuts initially (avoid conflicts with existing CMD+drag panning)

---

## Visual Treatment

### Card States When Brush Active

| Card State | Zoom 0 (Pixel) | Zoom 1 (Skim) | Zoom 2 (Read) |
|------------|----------------|----------------|----------------|
| **Match** | Full opacity, existing color | Full opacity, left border accent `ring-1 ring-inset` | Full opacity, subtle glow `ring-1` |
| **No match** | `opacity-[0.12]` | `opacity-20 saturate-0` | `opacity-25 saturate-0` |
| **No brush** | Normal | Normal | Normal |

CSS classes (add to index.css or tailwind plugin):

```css
.brush-match {
    /* applied when brush active AND card matches */
    ring: 1px inset var(--accent);
    transition: opacity 150ms ease, filter 150ms ease;
}

.brush-dim {
    /* applied when brush active AND card does NOT match */
    opacity: 0.15;
    filter: saturate(0);
    transition: opacity 150ms ease, filter 150ms ease;
}
```

Use `clsx` in InteractionCard:

```typescript
const brushClass = activeBrush
    ? (brushMatch ? "brush-match" : "brush-dim")
    : "";
```

### Lane Header Match Ratio

When brush active, each SessionLane header shows match count:

```
Session #abc123  [12/47 ████░░░░]
```

Rendered as a mini progress bar using existing CSS variable colors. Allows quick cross-session comparison without inspecting individual cards.

**Computation:** In SessionLane, memoize:

```typescript
const matchCount = useMemo(() => {
    if (!activeBrush) return null;
    const total = visibleItems.length;
    const matched = visibleItems.filter(item =>
        matchesBrush(activeBrush, item)
    ).length;
    return { matched, total };
}, [activeBrush, visibleItems]);
```

---

## BoardControls UI

Add a brush bar below existing zoom/date controls:

```
[PIXEL | SKIM | READ]  [Jan 1 — Jan 27]
[role ▾] [tool ▾] [file ▾] [status ▾]  [× Clear]
```

Each dropdown populates dynamically from visible sessions (not hardcoded). Tool dropdown shows the `RendererVariant` categories with their CSS colors as swatches. File dropdown shows top N most-edited files across visible sessions.

Active brush chip gets highlighted background matching the brush color.

---

## Brush Matching Utility

New file: `src/utils/brushMatchers.ts`

```typescript
import { getToolVariant, type RendererVariant } from "@/components/renderers/types";
import type { ClaudeMessage } from "@/types";

export interface BrushableCard {
    role: string;
    variant: RendererVariant;
    isError: boolean;
    isCancelled: boolean;
    isCommit: boolean;
    isShell: boolean;
    editedFiles: string[];
}

export interface ActiveBrush {
    type: "role" | "status" | "tool" | "file";
    value: string;
}

export function matchesBrush(brush: ActiveBrush | null, card: BrushableCard): boolean {
    if (!brush) return true;

    switch (brush.type) {
        case "role":
            return card.role === brush.value;
        case "tool":
            return card.variant === brush.value;
        case "status":
            switch (brush.value) {
                case "error": return card.isError;
                case "cancelled": return card.isCancelled;
                case "commit": return card.isCommit;
                default: return false;
            }
        case "file":
            return card.editedFiles.includes(brush.value);
        default:
            return false;
    }
}
```

Single predicate, single import, testable without React.

---

## Data Flow

```
BoardControls click / InteractionCard hover/click
  → setActiveBrush({ type, value })
  → [Zustand store update]
  → SessionBoard reads activeBrush (already wired)
  → passes to SessionLane (already accepts prop)
  → SessionLane passes to InteractionCard (already accepts prop)
  → InteractionCard computes CardSemantics.brushMatch via matchesBrush()
  → applies "brush-match" | "brush-dim" CSS class
  → SessionLane header computes match ratio
```

---

## Implementation Order

| Step | Scope | Why first |
|------|-------|-----------|
| 1. Fix variant divergence | `renderers/types.ts`, `toolIconUtils.ts` | Everything downstream depends on consistent variants |
| 2. Extract CardSemantics | `InteractionCard.tsx` | Reduces inline conditionals, creates brush attachment point |
| 3. Add `isShell` + terminal badges | `InteractionCard.tsx` | Visual payoff, validates CardSemantics extraction |
| 4. Create `brushMatchers.ts` | New utility | Testable independently |
| 5. Wire hover brush | `InteractionCard` → `SessionBoard` | Smallest change, immediate feedback |
| 6. Add CSS dim/match classes | `index.css` | Visual feedback for step 5 |
| 7. Lane header match ratio | `SessionLane.tsx` | Cross-session overview |
| 8. BoardControls dropdowns | `BoardControls.tsx` | Full brush UI |
| 9. Click-to-stick | `boardSlice` + `InteractionCard` | Persistent selection |
| 10. Memoize tool frequency | `InteractionCard.tsx` zoom 2 | Performance safety net |

---

## Open Questions

1. **Group-level matching:** When messages are grouped (zoom 0/1), should one match in the group highlight the entire group? Recommended: yes.
2. **Multi-brush:** Allow selecting multiple brush values simultaneously (e.g., terminal AND error)? Defer to v2.
3. **File brush granularity:** Brush by exact path or by directory? Start with exact path, add directory grouping later.
4. **Brush persistence:** Save last brush to Zustand store/localStorage across sessions? Nice-to-have.
