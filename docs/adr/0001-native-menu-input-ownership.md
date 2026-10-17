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
   those at or below the cursor. No ready state or page-load hook exists. A listener that
   fails to attach is retried (the pull backoff, then every last delay until it attaches);
   the user is told once (`common.menu.listenFailed`: shortcuts still work, menu commands
   run once it reconnects). The startup pull runs anyway, and each attach pulls, so the
   events chosen while nobody listened run then, in order.
3. **One command executor for every input.** Keys, the ⌘K palette, toolbar controls and
   menu events all hand their commands to one FIFO queue (`src/commands/commandQueue.ts`,
   through `dispatchCommand` or the journal). With nothing waiting a command runs at once,
   in the caller's task, so a key has no added latency. The journal **holds** the queue
   while it may not know every menu event older than the next input: from its start
   (listener attaching, first pull) until the first pull answers, and during a refetch
   after a gap. It runs those events at the hold's place, then releases it, and the keys
   and palette commands that arrived meanwhile run after them, in order. A key's
   `preventDefault` is decided when it is pressed; its command runs in its turn and
   `runCommand` re-checks `enabled` with the state of that moment. A failed pull lets go
   of the queue while it waits to retry, and a hold lasts at most `HOLD_LIMIT_MS`
   (1 s): a hung host call cannot freeze the keyboard.
4. **Menu state is shown only.** `sync_menu_state` greys/ticks items; nothing reads it back.
5. **Zoom input has one owner per platform.** macOS/Linux: the zoom commands (engine hotkeys
   off); one synchronous level updated before `setZoom`, set one level at a time; Ctrl+wheel
   counted in `wheelDeltaY` notches. Windows: WebView2 (`zoomHotkeysEnabled: true` in
   `tauri.windows.conf.json`, which also keeps pinch zoom); the page binds no zoom key or
   wheel there, and the View menu sets the same engine zoom. As the engine moves its level
   behind the zoom controller's back there, the controller trusts its copy of the applied
   level only within one burst of steps: every menu step writes its level, and Actual Size
   always calls `setZoom(1)`.

## Consequences

- The ack/ownership switch, the startup queue, orphan hand-off and the page-load reset are
  gone; their race classes cannot occur.
- Order holds across inputs, not only within the menu stream: a New Tab chosen in the menu
  during a reload runs before a ⌘W pressed while the page was still pulling. Limits: a menu
  event chosen *during* that pull (milliseconds) may run before a key pressed in the same
  window, as the host's and the page's clocks are not compared; past `HOLD_LIMIT_MS`, or
  while a failed pull waits to retry, keys run first and the late menu events after them.
- The journal orders invocation, not completion: a command that awaits is not a mutex
  (navigation keeps its own latest-wins epochs; zoom serializes its host writes).
- A key pressed while no page listens (mid-reload) reaches the menu item and is journaled,
  so it runs once after the load; it skips the page's focus/IME rules, like a menu click.
- On Windows the View menu steps from the level it last set; a pinch in between is not seen.
  Tauri exposes no zoom getter (JS or Rust: `setZoom` only). WebView2's
  `ICoreWebView2Controller::ZoomFactor` (and its `ZoomFactorChanged` event) is reachable from
  Rust through `Webview::with_webview` + `controller()`, which would need the `webview2-com`
  crate and Windows-only code that cannot be built or checked from this repo's macOS
  workflow; that is the follow-up if the jump matters. Actual Size is exact regardless.
- Flipping `menuAccelerators` on for Windows or Linux requires repeating the key-order
  measurement there (`docs/release/native-menu-smoke-checklist.md`).
