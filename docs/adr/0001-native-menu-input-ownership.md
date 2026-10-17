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
   behind the zoom controller's back there - at any moment, also while a write's reply is on
   its way - the controller never trusts its copy of the applied level there: every menu
   step writes the newest level and Actual Size always calls `setZoom(1)`; no cache can skip
   a write (review-4 F2). Steps still go one at a time, so an older level is never sent.
6. **A command's target is captured when it is issued, not when it runs.** A command waits
   in the queue (decision 3) while input outside the queue - a click on the tab strip, in
   the sidebar, in the transcript - goes on changing which tab is in front. So when a
   command is handed to the queue (`issueCommand` in `src/commands/registry.ts`: a key, the
   palette, a control, or the journal handing over a menu event) it records the tabs as
   they are then (`TabsSnapshot`: the tab in front and the tab order), and every command
   declares what it acts on (`target` in its handler, `src/commands/commandTarget.ts`):
   - `app`: nothing tab-bound (the window, an app-wide setting); it runs as issued;
   - `tab`: one tab picked at issue; it acts on that tab whether or not it is in front,
     and does nothing once the tab is closed;
   - `shown`: the tab in front at issue (or one picked from the tab order then); it does
     nothing once another tab is in front, or the picked tab is closed.

   Commands issued *earlier* move the target, input outside the queue never does: when a
   queued command changes the tabs (New, Close, a switch), the commands still waiting
   behind it take the tabs as it left them (`TargetLedger`). That is what they would have
   seen had everything run at once - a menu New chosen before ⌘W still makes ⌘W close the
   new tab (review-3 F1) - while a click after ⌘W cannot redirect it (review-4 F1). With
   nothing waiting, issue and run are the same moment and nothing changes.

   | Command | Target captured at issue | Runs later, target gone / not in front |
   |---|---|---|
   | `palette.open` | `app` - the window's palette | runs |
   | `app.preferences` | `app` - the toolbar's preferences menu | runs |
   | `app.checkForUpdates` | `app` - the app | runs |
   | `help.feedback` | `app` - the feedback dialog | runs |
   | `view.toggleInspector` | `app` - its open state is app-wide (`stateScope.ts`) | runs; `enabled` is re-checked on the tab in front |
   | `view.toggleMinimap` | `app` - its open state is app-wide | runs |
   | `view.zoomIn` `view.zoomOut` `view.actualSize` | `app` - the window's zoom | runs |
   | `tab.new` | `app` - a new tab at the end, whatever is in front | runs |
   | `tab.close` | `tab` - the tab in front at issue | closes that tab, in front or not; closed already: nothing |
   | `tab.next` `tab.previous` | `shown` - steps from the tab in front at issue | another tab in front, or it is closed: nothing |
   | `tab.goTo1` `tab.goTo2` `tab.goTo3` `tab.goTo4` `tab.goTo5` `tab.goTo6` `tab.goTo7` `tab.goTo8` `tab.goToLast` | `shown` - and the tab at that position at issue | another tab in front, or that tab closed: nothing |
   | `go.back` `go.forward` | `shown` - that tab's own place history | another tab in front: nothing |
   | `edit.find` | `shown` - that tab's find field | another tab in front: nothing |
   | `go.settingsManager` `go.archive` | `shown` - opens in that tab | another tab in front: nothing |

   `registry.test.ts` checks this table against the handlers and runs every command with a
   moved and a closed target.

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
- A waiting command can no longer be redirected by a click: ⌘W pressed on A closes A even
  if B was clicked before ⌘W's turn came (review-4 F1); Back, Next Tab, ⌘n, Find and the
  screen commands issued on A do nothing once B is in front. Limit: the host does not know
  which tab was in front when a menu item was chosen, so a menu event is issued, for the
  page, when the journal hands it to the queue - an event the page first hears of after a
  click runs on the tab in front then.
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
