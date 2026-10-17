# Native menu smoke checklist — Windows x64 and Linux x64 (release blocker)

Added with the native menu bar (plan T11a). The menu is built from `src/commands/manifest.json` in
`src-tauri/src/menu/`; its macOS behaviour is covered by tests and a real-app check, Windows and
Linux only by this checklist.

Run on the **CI build artifacts** (Windows `.exe`/`.msi`, Linux `.AppImage` and `.deb`) of the
release candidate. Every box must be checked on both platforms before a release; record OS
version, artifact name and commit SHA. While unchecked, `nativeShortcuts.win` / `.linux` in
`src/commands/manifest.json` stay `false` (the DOM listener owns shortcuts there).

Artifact / SHA: ____________________  Tester / date: ____________________

## A. Menu shows (both platforms)
- [ ] Menu bar under the title bar: File, Edit, View, Go, Window, Help (no App menu).
- [ ] File: New Tab, Close Tab | Settings… | Quit (Windows only — Linux has no Quit).
- [ ] Edit: (Windows: Undo, Redo |) Cut, Copy, Paste, Select All | Find in Conversation.
- [ ] View: Inspector, Session Minimap (checkbox items).
- [ ] Go: Back, Forward | Open Claude Code Settings, Open Archive Manager | Search and Commands.
- [ ] Window: (Windows: Minimize, Maximize |) Next Tab, Previous Tab | Go to Tab 1–8, Go to Last Tab.
- [ ] Help: Send Feedback… | Check for Updates… | About.
- [ ] App-command items show **no** accelerator text (flag off); the window layout is not pushed off-screen by the menu bar (title-bar overlay style).
- [ ] Switch language (gear → Language → 한국어, then 日本語, 简体中文, 繁體中文, English): menu titles and items change each time; no duplicate menu bar appears.

## B. Each shortcut runs once (DOM owner)
Use a toggle so a double run is visible (it would cancel out):
- [ ] Ctrl+Shift+F: minimap toggles **once** per press; View → Session Minimap tick follows.
- [ ] Ctrl+Shift+M (with a session open): inspector toggles once per press; tick follows.
- [ ] Ctrl+K opens the palette once; Ctrl+T opens one new tab; Ctrl+W closes one tab.
- [ ] Alt+← / Alt+→ go back / forward one step.
- [ ] Ctrl+, opens the gear menu.
- [ ] Clicking each menu item runs it once (same toggles as above via the menu).
- [ ] Disabled state: with no session open, View → Inspector and Edit → Find are greyed out.

## C. Edit — copy / paste (the predefined items must not break the web view)
- [ ] In the palette search field: type text, Ctrl+A selects it, Ctrl+C copies (paste into another app), Ctrl+X cuts, Ctrl+V pastes back.
- [ ] Select message text in a conversation, Ctrl+C, paste elsewhere: text arrives.
- [ ] Edit → Copy / Paste via the **menu** with a text field focused work the same.
- [ ] Windows: Ctrl+Z / Ctrl+Y in a text field undo/redo typing.
- [ ] Linux (IBus/fcitx Korean or Japanese input): typing composes normally; Ctrl+C/V still work with the IME on.

## D. Lifecycle
- [ ] Second launch (run the binary again) focuses the existing window; no second menu bar/window.
- [ ] Reload the page (Ctrl+R in dev builds only) then use a menu item: it runs once.

## After both platforms pass
1. Flip `nativeShortcuts.<os>` to `true` in a follow-up PR **only** if native accelerators are wanted
   there, then re-run section B with the native owner (the DOM listener must then skip the key).
2. Paste this filled checklist into the release PR.
