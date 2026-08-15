# Spec: Message Deep Linking & Navigation

## Objective
Enable a "Hypermedia Explorer" experience where any message in the history can be directly navigated to, scrolled into view, and highlighted, regardless of the current view state (Board, Search, etc.).

## 1. Store Architecture (Zustand)
We need a transient navigation state that persists across view transitions but clears after consumption.

### New State Interface
```typescript
interface NavigationState {
  // The UUID of the message to scroll to
  targetMessageUuid: string | null;
  // Whether to animate/flash the message to draw attention
  shouldHighlightTarget: boolean;
}

interface NavigationActions {
  // Main entry point for navigation
  navigateToMessage: (uuid: string) => void;
  // Called by MessageViewer after successful scroll
  clearTargetMessage: () => void;
}
```

## 2. Navigation Flow

### A. Triggering Navigation (Producer)
From `SessionBoard`, `InteractionCard`, or `GlobalSearch`:
1. User clicks "Open" or taps a card.
2. Component calls `navigateToMessage(uuid)`.
   - Sets `targetMessageUuid = uuid`.
   - Sets `analytics.currentView = 'messages'`.
   - Ensures correct `selectedSession` is set (if cross-session linking is added later).

### B. Consuming Navigation (Consumer: `MessageViewer`)
Inside `MessageViewer.tsx` (or a `useMessageNavigation` hook):
1. **Watch**: Effect depends on `targetMessageUuid`, `flattenedMessages`, and `virtualizer`.
2. **Locate**: Find the index of `targetMessageUuid` in `flattenedMessages`.
   - *Challenge*: What if the message is inside a collapsed group (e.g., Agent Task)?
   - *Solution*: Auto-expand the group containing the message, or point to the group leader if expansion is undesirable. (For now: assume flat or auto-expand).
3. **Scroll**: Call `virtualizer.scrollToIndex(index, { align: 'center', behavior: 'smooth' })`.
4. **Highlight**: Pass a `isTarget` prop to `VirtualizedMessageRow` for a CSS animation (yellow fade-out).
5. **Cleanup**: Call `clearTargetMessage()` after a short timeout or immediately after scroll initiation.

## 3. WebUI URL Routing
The browser WebUI supports durable task and message links:
- `?session=UUID` opens a task.
- `?session=UUID&msg=UUID` opens, scrolls to, and highlights a message.
- Task and message selections update browser history.
- Pasted links and browser Back/Forward hydrate the store and reuse the existing message-navigation flow.
- The Tauri desktop app does not mutate its URL; this routing is WebUI-only.

## 4. Implementation Steps

1. **Update Store**: Add `targetMessageUuid` to `AppStore`.
2. **Update App Logic**: Implement `navigateToMessage` helper.
3. **Enhance MessageViewer**:
   - Add `useEffect` for scrolling.
   - Handle "collapsed groups": If target is hidden, unhide it or scroll to parent.
4. **Visuals**: Add CSS keyframes for the "flash" highlight on the message row.

## 5. Edge Cases
- **Data Loading**: If switching sessions, wait for `isLoading` to match `false` before attempting scroll.
- **Race Conditions**: `flattenedMessages` might take a frame to rebuild after session switch. Use `useEffect` dependency on `flattenedMessages`.
