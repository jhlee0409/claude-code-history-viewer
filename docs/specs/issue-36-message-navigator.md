# Spec: Right-side Message Navigator (Table of Contents)

> **Issue:** [#36](https://github.com/jhlee0409/claude-code-history-viewer/issues/36)
> **Type:** MAJOR — New UI component + store slice + layout change
> **Status:** Draft

---

## Problem

When reviewing long Claude Code sessions (50+ turns), users must scroll linearly through the entire conversation. Browser-level `Cmd+F` finds text but provides no structural context. There is no "random access" to specific messages — users lose their place and spend significant time navigating.

## Solution

A **collapsible right-hand sidebar** ("Message Navigator") that displays a chronological table-of-contents of all messages in the active session. Each entry shows the sender role, a content preview, and a timestamp. Clicking an entry scrolls the main `MessageViewer` to that message with a brief highlight animation.

---

## 1. Store Architecture

### 1.1 New Slice: `navigatorSlice.ts`

```
src/store/slices/navigatorSlice.ts
```

```typescript
export interface NavigatorSlice {
  /** Whether the right sidebar is visible */
  isNavigatorOpen: boolean;
  /** Currently hovered/focused entry UUID (for hover-preview highlighting) */
  navigatorHoveredUuid: string | null;

  toggleNavigator: () => void;
  setNavigatorOpen: (open: boolean) => void;
  setNavigatorHoveredUuid: (uuid: string | null) => void;
}
```

**Persistence:** Save `isNavigatorOpen` to `localStorage` under key `navigator-open` so the panel state survives restarts.

### 1.2 Integration with `useAppStore`

Add `NavigatorSlice` to the combined `AppStore` type and wire `createNavigatorSlice` into the store factory (same pattern as existing slices).

### 1.3 Re-use Existing Navigation

Clicking a navigator entry calls the existing `navigateToMessage(uuid)` from `NavigationSlice`. This already handles:
- Setting `targetMessageUuid`
- Scrolling via virtualizer
- Highlight animation with auto-clear

No new navigation plumbing needed.

---

## 2. Component Architecture

### 2.1 File Structure

```
src/components/MessageNavigator/
├── MessageNavigator.tsx          # Main sidebar container
├── NavigatorEntry.tsx            # Individual message row
├── useNavigatorEntries.ts        # Hook: transforms messages → navigator data
└── types.ts                      # Local types
```

### 2.2 `NavigatorEntry` — Data Model

```typescript
interface NavigatorEntryData {
  uuid: string;
  role: "user" | "assistant" | "system" | "summary";
  /** First ~100 chars of text content, stripped of XML/markdown */
  preview: string;
  /** ISO timestamp */
  timestamp: string;
  /** Whether this message contains tool use (show icon indicator) */
  hasToolUse: boolean;
  /** Original index in messages array (for display: "Turn 1", "Turn 2") */
  turnIndex: number;
}
```

### 2.3 `useNavigatorEntries` Hook

**Input:** `messages: ClaudeMessage[]` (same array passed to `MessageViewer`)

**Processing:**
1. Filter out empty messages using existing `isEmptyMessage()` helper.
2. Filter out progress, queue-operation, and file-history-snapshot types (noise).
3. For each remaining message:
   - Extract preview via `extractClaudeMessageContent()` → truncate to 100 chars, strip XML tags.
   - Detect tool use via `getToolUseBlock()`.
   - Assign sequential `turnIndex`.
4. Memoize with `useMemo` keyed on `messages` reference.

**Performance:** For 500 messages, this is ~1ms of string work. No concern.

### 2.4 `MessageNavigator` Component

```
┌─────────────────────────────┐
│  📋 Messages (163)    [×]   │  ← Header with count + close button
├─────────────────────────────┤
│  🔍 Filter...               │  ← Optional: local text filter
├─────────────────────────────┤
│  👤 Turn 1  10:31 AM        │
│  "Please refactor the API…" │
│                              │
│  🤖 Turn 2  10:31 AM   🔧   │  ← 🔧 = has tool use
│  "I'll restructure the mo…" │
│                              │
│  👤 Turn 3  10:35 AM        │
│  "Can you also update the…" │
│                              │
│  ...                         │
│                              │
│  ▶ Current viewport ◀       │  ← Viewport indicator (Phase 2)
│                              │
└─────────────────────────────┘
```

**Key behaviors:**
- **Click** → calls `navigateToMessage(uuid)` → main view scrolls + highlights
- **Hover** → sets `navigatorHoveredUuid` for optional cross-highlight (Phase 2)
- **Active indicator** → the entry closest to the current scroll position gets a visual accent (blue left border)
- **Virtual scrolling** — use `@tanstack/react-virtual` (already a dependency) for sessions with 500+ messages

### 2.5 Active Scroll Tracking

To highlight which navigator entry corresponds to the current viewport:

1. In `MessageViewer`, expose the currently visible message range from the virtualizer via a new store field or callback:
   ```typescript
   // In useMessageVirtualization or MessageViewer
   const visibleRange = virtualizer.getVirtualItems();
   const firstVisibleUuid = flattenedMessages[visibleRange[0]?.index]?.message?.uuid;
   ```
2. Store `activeNavigatorUuid` in the navigator slice (or derive it).
3. The `NavigatorEntry` with matching UUID gets highlighted styling.
4. **Auto-scroll the navigator** to keep the active entry visible (using `scrollIntoView` with `block: 'nearest'`).

---

## 3. Layout Integration

### 3.1 `App.tsx` Changes

The navigator sits **inside** the `<main>` area, to the right of the message content. It is **always rendered** when `selectedSession && computed.isMessagesView`, but displays in two states:

1. **Expanded** (`isNavigatorOpen === true`): Shows full navigator with resizable width (default 280px, range 200-400px)
2. **Collapsed** (`isNavigatorOpen === false`): Shows a minimal 48px-wide sidebar with expand button and entry count

This approach provides visual feedback about the navigator's existence and shows the message count at a glance, even when collapsed.

```tsx
{/* Main Content Area */}
<main className="flex-1 flex flex-col min-w-0 bg-background">
  {/* ... existing header ... */}
  <div className="flex-1 flex overflow-hidden">
    {/* Message content — takes remaining space */}
    <div className="flex-1 min-w-0">
      {/* existing content switching logic */}
    </div>

    {/* Right sidebar — Message Navigator (always rendered when messages view is active) */}
    {selectedSession && computed.isMessagesView && (
      <MessageNavigator
        messages={messages}
        width={navigatorWidth}              // from useResizablePanel
        isResizing={isNavigatorResizing}
        onResizeStart={handleNavigatorResizeStart}
        isCollapsed={!isNavigatorOpen}      // controlled by navigator slice
        onToggleCollapse={toggleNavigator}  // toggle between expanded/collapsed
      />
    )}
  </div>
</main>
```

### 3.2 Resizable Panel

Re-use the existing `useResizablePanel` hook:

```typescript
const {
  width: navigatorWidth,
  isResizing: isNavigatorResizing,
  handleMouseDown: handleNavigatorResizeStart,
} = useResizablePanel({
  defaultWidth: 280,
  minWidth: 200,
  maxWidth: 400,
  storageKey: "navigator-width",
  direction: "left",            // resize handle on the left edge
});
```

> **Note:** `useResizablePanel` currently only supports left-edge resize (sidebar on left). It may need a `direction` parameter to support right-side panels where the drag handle is on the left edge. Check implementation — if it already handles this via negative delta, no change needed.

### 3.3 Toggle Button

Add a toggle button to the `MessageViewer` toolbar (next to the existing Capture Mode button):

```tsx
<button onClick={toggleNavigator} title={t("navigator.toggle")}>
  <ListTree className="w-3.5 h-3.5" />
  <span>{t("navigator.title")}</span>
</button>
```

Also add a keyboard shortcut: **`Cmd+Shift+M`** (or `Ctrl+Shift+M`) to toggle.

---

## 4. Styling

### 4.1 Design Language

Match the existing left sidebar (`ProjectTree`) aesthetic:
- Background: `bg-sidebar` (same as left panel)
- Border: `border-l border-border/50`
- Text: `text-sm` for previews, `text-2xs` for timestamps
- Role indicators: colored dots — blue for user, orange/amber for assistant, gray for system
- Active entry: `border-l-2 border-accent bg-accent/5`
- Hover: `bg-accent/10`
- Tool use indicator: small wrench icon (`Wrench` from lucide-react), `text-muted-foreground`

### 4.2 Responsive Behavior

- **Window < 768px:** Navigator auto-hides, toggle button still available (opens as overlay)
- **Window ≥ 768px:** Navigator renders inline as a flex sibling

### 4.3 Transitions

- Panel open/close: `transition-[width] duration-200 ease-in-out` with `overflow-hidden`
- Entry highlight on click: re-use existing `data-search-highlight` yellow fade animation

---

## 5. i18n

### New Keys (add to all 5 locales)

**Namespace: `message` (in `locales/{lang}/message.json`)**

| Key | EN | KO |
|-----|----|----|
| `navigator.title` | `Messages` | `메시지` |
| `navigator.toggle` | `Toggle message navigator` | `메시지 네비게이터 토글` |
| `navigator.filter` | `Filter messages...` | `메시지 필터...` |
| `navigator.turnLabel` | `Turn {{index}}` | `턴 {{index}}` |
| `navigator.noMessages` | `No messages in this session` | `이 세션에 메시지가 없습니다` |
| `navigator.close` | `Close navigator` | `네비게이터 닫기` |

After adding keys: run `pnpm run generate:i18n-types && pnpm run i18n:validate`.

---

## 6. Accessibility

- Navigator panel: `role="complementary"`, `aria-label={t("navigator.title")}`
- Each entry: `role="button"`, `tabIndex={0}`, keyboard Enter/Space to navigate
- Close button: `aria-label={t("navigator.close")}`
- Focus trap: not needed (panel is supplementary, not modal)
- Active entry: `aria-current="true"`

---

## 7. Implementation Phases

### Phase 1 — Core MVP (this PR)
- [ ] `navigatorSlice` with open/close + localStorage persistence
- [ ] `useNavigatorEntries` hook with preview extraction
- [ ] `MessageNavigator` + `NavigatorEntry` components
- [ ] Click-to-scroll via existing `navigateToMessage`
- [ ] Toggle button in MessageViewer toolbar + Cmd+Shift+M shortcut
- [ ] Layout integration in App.tsx with resizable panel
- [ ] i18n keys (all 5 locales)
- [ ] Basic a11y (roles, labels, keyboard nav)

### Phase 2 — Enhanced UX (follow-up)
- [ ] Active scroll tracking (highlight current viewport entry)
- [ ] Auto-scroll navigator to track reading position
- [ ] Local text filter within navigator
- [ ] Hover cross-highlight (hover entry → faint highlight in main view)
- [ ] Responsive overlay mode for narrow windows
- [ ] "Focus Mode" — click to isolate a single message (from issue description)

### Phase 3 — Power Features (future)
- [ ] Bookmark/pin important messages
- [ ] Color-coded turn segments (user questions vs assistant responses)
- [ ] Mini-map style scroll indicator
- [ ] Export navigator as session outline

---

## 8. Testing Strategy

### Unit Tests
- `useNavigatorEntries`: verify filtering, preview truncation, tool-use detection
- `navigatorSlice`: verify toggle, localStorage persistence

### Component Tests
- `NavigatorEntry`: renders role icon, preview, timestamp
- `MessageNavigator`: renders correct number of entries, handles click

### Integration
- Click entry → `navigateToMessage` called with correct UUID
- Toggle → panel shows/hides with transition
- Session switch → entries update

---

## 9. Performance Considerations

- **Memoization:** `useNavigatorEntries` returns a memoized array; entries are stable references when messages don't change.
- **Virtual scrolling:** For sessions with 200+ messages, use `@tanstack/react-virtual` in the navigator list (same library already used in `MessageViewer`).
- **No re-render coupling:** Navigator reads from the store independently; scrolling the main view doesn't re-render navigator entries (only the active indicator updates via store subscription).

---

## 10. File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `src/store/slices/navigatorSlice.ts` | **New** | Navigator state slice |
| `src/store/useAppStore.ts` | Edit | Wire navigator slice |
| `src/components/MessageNavigator/` | **New** | Navigator component directory |
| `src/components/MessageViewer/MessageViewer.tsx` | Edit | Add toggle button to toolbar |
| `src/App.tsx` | Edit | Add navigator to layout |
| `src/hooks/useResizablePanel.ts` | Edit | Add `direction` param if needed |
| `src/i18n/locales/*/message.json` | Edit | Add navigator i18n keys |
| `src/i18n/types.generated.ts` | Regen | Auto-generated after key additions |

---

## Appendix: Rejected Alternatives

### A. Floating panel instead of sidebar
Rejected: Overlaps message content, poor UX for persistent navigation. Sidebar provides stable spatial reference.

### B. Integrate into existing left sidebar
Rejected: Left sidebar is project/session scoped. Message navigator is session-message scoped — different hierarchy level. Mixing them creates confusion.

### C. Bottom drawer / horizontal timeline
Rejected: Vertical list matches the vertical scroll direction of messages. Horizontal timeline loses text preview space.
