# PR: Session Visualization & Navigation Overhaul

## Summary
This PR introduces a significant upgrade to the session visualization ("Session Board") and navigation architecture. It moves from a static list view to a virtualized, interactive "swimlane" board that supports deep linking, granular analytics, and improved state management.

## Key Changes

### 1. Visualization Architecture
- **Virtualized Session Board**: Replaces simple lists with a horizontal scrolling board using `@tanstack/react-virtual`, supporting thousands of sessions with 60fps performance.
- **Swimlane UI**: Sessions are visualized as time-based lanes with zoom levels (Pixel/Heatmap, Skim, Detail).
- **Rich Analytics**: Session cards now visualize model usage (Haiku/Sonnet/Opus color coding), token consumption, Git commits, and tool usage (Terminal, File, Search, MCP).

### 2. Deep Linking & Navigation
- **Message Permalinks**: Implemented internal deep linking to specific message UUIDs.
- **Bi-directional Sync**: Clicking an event on the board jumps to the exact message in the transcript with auto-scroll and highlighting.
- **Smart History**: "Back" navigation restores the exact board state (scroll position, zoom level) to prevent context loss.

### 3. Technical Refactors
- **Zustand Slices**: Refactored the monolithic store into modular slices (`boardSlice`, `navigationSlice`) for better separation of concerns.
- **Project Tree**: Fixed interaction conflicts between "Expand" and "Select" actions in the sidebar.
- **Performance**: Optimized rendering for large histories by virtualizing both the global board and individual message threads.

### 4. Search & Discovery
- **"Jump-to" Search**: implemented in-context search navigation (preserving thread context) rather than destructive filtering.
- **Fixed Date Filtering**: Corrected timezone handling in the date picker to ensure accurate local-time filtering.

## Dependencies Added
- `lucide-react`: For consistent UI iconography (replacing ad-hoc SVGs).
- `@tanstack/react-virtual`: For virtualization stability.
