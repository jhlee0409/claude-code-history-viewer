# Native menu smoke checklist — Windows x64 and Linux x64 (release blocker)

Added with the native menu bar (plan T11a). The menu is built from `src/commands/manifest.json` in
`src-tauri/src/menu/`; its macOS behaviour is covered by tests and a real-app check, Windows and
Linux only by this checklist.

Run on the **CI build artifacts** (Windows `.exe`/`.msi`, Linux `.AppImage` and `.deb`) of the
release candidate. Every box must be checked on both platforms before a release; record OS
version, artifact name and commit SHA.

How input is owned — one fixed owner per input, never switched by the menu's enabled state:

| Input | macOS | Windows | Linux |
|---|---|---|---|
| App shortcuts (Ctrl+K, Ctrl+T…) | page key listener; it claims every app key, so the menu item's accelerator only shows it | page key listener; items show **no** accelerator (`menuAccelerators.win = false`) | page key listener; items show **no** accelerator (`menuAccelerators.linux = false`) |
| Menu clicks | menu journal → `runCommand`, once each, in order | same | same |
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
      Actual Size again. Each must land at 100%.
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
- [ ] Reload the page (Ctrl+R in dev builds only) and, while it reloads, click File → New Tab twice and
      File → Close Tab once: after the load there are exactly two tabs, the original first (the menu
      journal runs each event once, in order).

## After both platforms pass
1. Flip `menuAccelerators.<os>` to `true` in a follow-up PR **only** if native accelerator text is wanted
   there, and only after measuring that the web view gets a key before the menu and that
   `preventDefault()` keeps the menu item from also running it (macOS method and results:
   `docs/adr/0001-native-menu-input-ownership.md`). GTK runs window accelerators before the focused widget gets the key,
   so on Linux this is expected to fail: keep it off there. Re-run section B after any flip.
2. Paste this filled checklist into the release PR.
