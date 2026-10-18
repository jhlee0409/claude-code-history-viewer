# Window-state smoke checklist — Windows x64 and Linux x64

Added with window size/position restore (plan T11b). The app owns it end to end in
`src-tauri/src/window_state.rs` (no plugin, no page permission). The main window is created hidden
(`"visible": false`); in `setup` the saved frame is corrected for the monitors present now and
applied, then the window is shown. The placement rules are unit-tested and macOS was checked on a
real app. Windows and Linux are covered only by this checklist (multi-monitor layouts, DPI, title
bars and panels differ per platform).

Run on the **CI build artifacts** (Windows `.exe`/`.msi`, Linux `.AppImage` and `.deb`) of the
release candidate, ideally with two monitors. Record OS version, session type (Linux: X11 or
Wayland), artifact name and commit SHA.

What is restored: size, position, maximized. Not restored: fullscreen, minimized, visibility.
State file (delete it to reset):

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\com.claude.history-viewer\window-state.json` |
| Linux | `~/.config/com.claude.history-viewer/window-state.json` |
| macOS | `~/Library/Application Support/com.claude.history-viewer/window-state.json` |

The file is versioned JSON: `frame` is the window's normal (un-maximized) OUTER frame (title bar
and borders included) in physical pixels, with the `scale_factor` and `monitor` it was on, and
`maximized`. It is written atomically (temp file + one replacing rename) about 0.5 s after the last move or
resize, when the window is closed and when the app quits. A file that does not parse or has
another `version` is ignored: the window opens at the default 1200×800, centered.

Artifact / SHA: ____________________  Tester / date: ____________________

## A. Restore (both platforms)
- [ ] First launch with no state file: the window opens 1200×800, centered, without first
      appearing somewhere else.
- [ ] Resize and move the window, wait 1 s: the state file exists/changed while the app runs.
- [ ] Move the window and quit right away (File → Quit / Alt+F4), relaunch: same size and
      position (the exit save, not only the delayed one).
- [ ] Maximize, quit, relaunch: the window opens maximized; un-maximizing returns to the size and
      position it had before maximizing.
- [ ] Delete the state file, launch, maximize **without moving or resizing first**, quit,
      relaunch: the window opens maximized; un-maximizing returns to the default 1200×800,
      centered (not a work-area-sized window).
- [ ] Enter fullscreen (F11 if available), quit, relaunch: the window opens as a normal window at
      its last non-fullscreen frame.
- [ ] Minimize, quit from the taskbar, relaunch: the window opens at its last normal frame
      (Windows reports a minimized window at −32000; that is never saved).
- [ ] Launch a second instance while the first is open: the first window is focused, its size and
      position do not change.

## B. Off-screen correction (both platforms)
A frame is kept when 100 × 32 logical px of its title bar lie inside a monitor's work area and it
fits the monitor it overlaps most; otherwise its outer frame is fitted to that monitor's work area
(the nearest monitor if it overlaps none) and moved fully inside.
- [ ] Two monitors: move the window onto the second monitor, quit, unplug/disable that monitor,
      relaunch: the window appears fully on the remaining monitor.
- [ ] A monitor left of / above the primary (negative coordinates): a window there stays there.
- [ ] Edit the file: `"x"` and `"y"` = `-10000`, relaunch: the window is fully visible.
- [ ] Edit the file: only ~10 px of the window's left edge on screen (`"x"` = screen width − 10),
      relaunch: the window is pulled fully onto the screen.
- [ ] Edit the file: `"y"` = `-300` (title bar above the screen), relaunch: the title bar is
      visible and draggable.
- [ ] Edit the file: `"width"`/`"height"` larger than the screen, relaunch: the whole window —
      title bar, borders and (with the native menu, T11a) the menu bar — fits the work area; the
      taskbar/panel is not covered.
- [ ] A window partly off the right edge with a good part of its title bar visible stays where it
      was.
- [ ] Mixed DPI (e.g. 100 % + 150 %): save on the 150 % monitor, unplug it, relaunch: the window
      keeps its logical size on the 100 % monitor (not 1.5× too large). Note any offset.
- [ ] Mixed DPI, window opening on the other monitor: with a 200 % primary and a 100 % second
      monitor (Linux: per-monitor scaling), move the window onto the 100 % monitor, quit,
      relaunch (the new window is created on the 200 % primary): it comes back on the 100 %
      monitor at the same place and size — not at half its position and half its size on the
      primary. On Wayland only the size is checked (the compositor places the window). Linux treats tao values as per-item scaled like macOS; Windows as global
      pixels.
- [ ] Edit the file to `{"version":1,"frame":` (corrupt), relaunch: the window opens at the
      default and is shown.
- [ ] With the native menu bar: quit and relaunch three times without touching the window: the
      size stays the same (the menu bar is in the measured decoration, so no menu-bar height is
      lost or added per launch), and the menu bar is present on every launch.

## C. Linux Wayland
- [ ] Wayland session: the window opens (shown, not stuck hidden) at the saved size; the position
      is left to the compositor. Restart twice: no drift, no crash.

## D. Headless modes are unaffected
- [ ] `--serve` (WebUI) and `--export <id>` run without creating or changing the state file.
