# 0001 — Native menu input: one fixed owner per input, menu events in a journal

- **Status**: accepted
- **Date**: 2026-10-18

## Context

T11a builds the desktop menu bar from the command manifest. Two review rounds of the first
bridge found race windows one at a time, all from the same design: a key's owner switched
between the page and the native menu item according to the item's *acknowledged* enabled
state (an asynchronous copy), and menu events were delivered by a "ready" handshake (queue
until the first `sync_menu_state` reply, live after it) that a reload, a replaced listener or a
late reply could reorder or drop.

Measured in the real macOS app (WKWebView, System Events key presses, a page probe logging
`keydown`, `defaultPrevented` and `menu-command`):

- the page receives a ⌘ key **before** the menu, whatever the item's state;
- if the page calls `preventDefault()`, the item's accelerator does **not** run;
- if the page leaves it, an enabled item runs after dispatch; a disabled one does nothing.

## Decision

1. **The page owns every app shortcut on every platform.** One window key listener runs
   them through `runCommand`. Where native items carry the app accelerators (macOS,
   `menuAccelerators`), the listener claims (prevents) every app key it matches, run or not,
   so the accelerator only shows the key. No key depends on native enabled state. Windows and
   Linux items carry no app accelerators (GTK activates window accelerators before the
   focused widget; neither is measured yet).
2. **Every menu event goes through one journal.** Rust numbers each app-command menu event
   (`epoch` + monotonic `seq`), keeps it until acknowledged and emits it live. The page runs
   events strictly in `seq` order, writes its cursor (sessionStorage) before running, and
   acknowledges; a reload or a replacement listener pulls the unacknowledged events and skips
   those at or below the cursor. No ready state or page-load hook exists.
3. **Menu state is shown only.** `sync_menu_state` greys/ticks items; nothing reads it back.
4. **Zoom input has one owner per platform.** macOS/Linux: the zoom commands (engine hotkeys
   off); one synchronous level updated before `setZoom`, set one level at a time; Ctrl+wheel
   counted in `wheelDeltaY` notches. Windows: WebView2 (`zoomHotkeysEnabled: true` in
   `tauri.windows.conf.json`, which also keeps pinch zoom); the page binds no zoom key or
   wheel there, and the View menu sets the same engine zoom.

## Consequences

- The ack/ownership switch, the startup queue, orphan hand-off and the page-load reset are
  gone; their race classes cannot occur.
- A key pressed while no page listens (mid-reload) reaches the menu item and is journaled,
  so it runs once after the load; it skips the page's focus/IME rules, like a menu click.
- On Windows the View menu steps from the level it last set; a pinch in between is not seen
  (the engine's level is not readable through Tauri).
- Flipping `menuAccelerators` on for Windows or Linux requires repeating the key-order
  measurement there (`docs/release/native-menu-smoke-checklist.md`).
