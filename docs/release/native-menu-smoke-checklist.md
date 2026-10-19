# Native menu smoke checklist — Windows x64 and Linux x64 (manual reference)

Added with the native menu bar (plan T11a). The menu is built from `src/commands/manifest.json` in
`src-tauri/src/menu/`; its macOS behaviour is covered by tests and a real-app check, Windows and
Linux only by this checklist.

Run on the **CI build artifacts** (Windows `.exe`/`.msi`, Linux `.AppImage` and `.deb`) of the
release candidate when menu or input behaviour changes; record OS version, artifact name and
commit SHA. Not a release gate: CI's launch smoke (`scripts/ci/launch-smoke.*`) covers startup.

How input is owned — one fixed owner per input, never switched by the menu's enabled state:

| Input | macOS | Windows | Linux |
|---|---|---|---|
| App shortcuts (Ctrl+K, Ctrl+T…) | page key listener; it claims every app key, so the menu item's accelerator only shows it | page key listener; items show **no** accelerator (`menuAccelerators.win = false`) | page key listener; items show **no** accelerator (`menuAccelerators.linux = false`) |
| Menu clicks | menu journal → `runCommand`, once each, in order | same | same |
| Order across inputs | one command queue: keys, palette, toolbar and menu events run in arrival order; a key waits only while the journal fetches older menu events (≤ 1 s); a command acts on the tab in front when it was issued (a menu event: stamped by the host from the page's last report) | same | same |
| Zoom keys (Ctrl+= Ctrl++ Ctrl+- Ctrl+0) | zoom commands (page); `zoomHotkeysEnabled: false` | **WebView2** (`zoomHotkeysEnabled: true` in `tauri.windows.conf.json`); the page binds none | zoom commands (page); `zoomHotkeysEnabled: false` |
| Ctrl + wheel | zoom commands, one step per notch | **WebView2** | zoom commands, one step per notch |
| Pinch zoom | not used by the app | **WebView2** (the same switch as its zoom keys) | WebKitGTK's own gesture, not affected |
| View → Zoom In / Out / Actual Size | zoom commands | zoom commands, setting the same WebView2 zoom factor | zoom commands |

Artifact / SHA: ____________________  Tester / date: ____________________

## A. Menu shows (both platforms)
- [ ] Menu bar under the title bar: File, Edit, View, Go, Window, Help (no App menu).
- [ ] File: New Tab, Close Tab | Settings… | Quit (Windows only — Linux has no Quit).
- [ ] Edit: (Windows: Undo, Redo |) Cut, Copy, Paste, Select All | Find in Conversation.
- [ ] View: Inspector, Session Minimap (checkbox items) | Zoom In, Zoom Out, Actual Size.
- [ ] Go: Back, Forward | Open Claude Code Settings, Open Archive Manager | Search and Commands.
- [ ] Window: (Windows: Minimize, Maximize |) Next Tab, Previous Tab | Go to Tab 1–8, Go to Last Tab.
- [ ] Help: Send Feedback… | Check for Updates… | About.
- [ ] App-command items show **no** accelerator text (`menuAccelerators` off); the window layout is not pushed off-screen by the menu bar (title-bar overlay style).
- [ ] Switch language (gear → Language → 한국어, then 日本語, 简体中文, 繁體中文, English): menu titles and items change each time; no duplicate menu bar appears.

## B. Each input runs once
Use a toggle so a double run is visible (it would cancel out):
- [ ] Ctrl+Shift+F: minimap toggles **once** per press; View → Session Minimap tick follows.
- [ ] Ctrl+Shift+M (with a session open): inspector toggles once per press; tick follows.
- [ ] Ctrl+K opens the palette once; Ctrl+T opens one new tab; Ctrl+W closes one tab.
- [ ] Alt+← / Alt+→ go back / forward one step.
- [ ] Ctrl+, opens the gear menu.
- [ ] Clicking each menu item runs it once (same toggles as above via the menu).
- [ ] Keys and menu share one order: File → New Tab, then Ctrl+W as soon as the new tab shows → the new
      tab opens and closes, the original tab stays. Reload (Ctrl+R in a dev build, or relaunch) and press Ctrl+T at once,
      several times → one tab per press, no key lost, no delay you can feel.
- [ ] A command acts on the tab you saw in front when you issued it (ADR 0001 decision 6): with tabs A
      and B, A in front, reload and press Ctrl+W, then click tab B at once → A closes, B stays (never B
      closed). With tabs A, B, C: reload, press Ctrl+W, click B, press Ctrl+W, click C, all at once → A and
      B close, C stays. Likewise reload, press Ctrl+PageDown (Next Tab) and click a third tab at once → the
      clicked tab stays in front. (The window is milliseconds; record "not reproducible" rather than
      forcing it.)
- [ ] A menu command acts on the tab in front when it was chosen: with tabs A and B, A in front, choose
      File → Close Tab → A closes. Click B, then File → Close Tab → B closes. With no tab click in between,
      Window → Next Tab steps from the tab in front.
- [ ] No "The menu bar is not responding" toast at startup or after a language change (it would mean the
      menu event listener failed to attach; record it with the console log if it appears).
- [ ] Disabled state: with no session open, View → Inspector and Edit → Find are greyed out; with one
      tab, Window → Next Tab is greyed out and its shortcut does nothing.

### B-Windows. Zoom — WebView2 owns zoom input
- [ ] Ctrl+= zooms in **one** step per press (compare text size after 1 press vs 2), Ctrl++ (Shift+= and
      numpad +) one step, Ctrl+- one step out, Ctrl+0 back to 100%. Same from a text field and with the
      palette open. (WebView2's own steps; a double zoom would jump two steps.)
- [ ] Ctrl + mouse wheel: one zoom step per notch, not two.
- [ ] **Touch-screen pinch** and **touchpad pinch** zoom the page smoothly; the level stays after release.
- [ ] View → Zoom In / Zoom Out / Actual Size change the zoom once per click.
- [ ] **Actual Size after engine zoom** returns to 100% every time: (1) Ctrl+= twice, then View → Actual
      Size; (2) pinch in, View → Actual Size; (3) View → Actual Size, pinch (or Ctrl+wheel) again, View →
      Actual Size again; (4) View → Actual Size, pinch at once, View → Actual Size again within a
      second (the first write may still be unanswered). Each must land at 100%.
- [ ] Known limit (record what you see): after a pinch, Ctrl+wheel or Ctrl+= the menu's Zoom In / Out step
      from the level the menu last set — Tauri cannot read WebView2's level — so the first menu step after
      a pinch may jump (e.g. pinch to 200%, View → Zoom In → 120%).

### B-Linux. Zoom — the zoom commands own zoom input
- [ ] Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0: one 20% step per press (Ctrl+0 → 100%), also in a text field and
      with the palette open. View → Zoom In / Zoom Out / Actual Size the same, once per click.
- [ ] Ctrl + mouse wheel: **one step per notch** (counted from `wheelDeltaY`, 120 a notch); with a touchpad,
      Ctrl + two-finger scroll zooms gradually, not a step per event.
- [ ] Three quick wheel notches zoom three steps (160%), not one.

## C. Edit — copy / paste (the predefined items must not break the web view)
- [ ] In the palette search field: type text, Ctrl+A selects it, Ctrl+C copies (paste into another app), Ctrl+X cuts, Ctrl+V pastes back.
- [ ] Select message text in a conversation, Ctrl+C, paste elsewhere: text arrives.
- [ ] Edit → Copy / Paste via the **menu** with a text field focused work the same.
- [ ] Windows: Ctrl+Z / Ctrl+Y in a text field undo/redo typing.
- [ ] Linux (IBus/fcitx Korean or Japanese input): typing composes normally; Ctrl+C/V still work with the IME on.

## D. Lifecycle
- [ ] Second launch (run the binary again) focuses the existing window; no second menu bar/window.
- [ ] With one tab open (call it O; open a session in it so you can recognise it), reload the page
      (Ctrl+R in dev builds only) and, while it reloads, click File → New Tab twice and File → Close Tab
      once: after the load there are **exactly two tabs** - the journal runs each menu event once, in
      order (none lost, none run twice). Close closes the tab that was in front when you chose it (ADR
      0001 decision 6, WYSIWYG: the event is stamped with the tab the page last reported), so which two
      remain depends on timing: usually O and one new tab (a New had already run - in the old page,
      which keeps running events until the new one replaces it, or in the new page - and its tab was
      in front); two new tabs only if O was still the reported front tab when you chose Close. One or
      three tabs is a failure.

## After both platforms pass
1. Flip `menuAccelerators.<os>` to `true` in a follow-up PR **only** if native accelerator text is wanted
   there, and only after measuring that the web view gets a key before the menu and that
   `preventDefault()` keeps the menu item from also running it (macOS method and results:
   `docs/adr/0001-native-menu-input-ownership.md`). GTK runs window accelerators before the focused widget gets the key,
   so on Linux this is expected to fail: keep it off there. Re-run section B after any flip.
2. Paste this filled checklist into the release PR.
