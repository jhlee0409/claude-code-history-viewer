#!/usr/bin/env bash
# Flatpak smoke: the installed bundle runs inside its sandbox, with the
# permissions the manifest (packaging/flatpak/io.github.jhlee0409.Omnilogue.yml)
# claims.
#
# 1. The app reads a Claude Code session from the read-only home folder and
#    exports it to Downloads (headless `--export`; the binary loads every
#    library from the GNOME runtime and goes through the omnilogue.sh launcher).
# 2. The home folder is read-only and ~/.claude is writable.
# 3. A file in ~/.claude goes to the host trash through GIO and the Trash
#    portal - the path the app's session delete takes in the Flatpak
#    (src-tauri/src/commands/session/delete.rs move_to_trash).
# 4. The window shows, and its position is saved to the host's
#    ~/.config/com.claude.history-viewer/window-state.json and restored on the
#    next launch (the launcher's XDG directories and their grant).
#
# Usage: dbus-run-session -- bash scripts/ci/flatpak-smoke.sh <out-dir>
# Needs: the bundle installed, xdg-desktop-portal, Xvfb, xdotool, ImageMagick.
# Writes screenshots, app logs and summary.txt to <out-dir>. Exits nonzero on
# the first failed check.
set -euo pipefail

APP_ID=io.github.jhlee0409.Omnilogue
IDENTIFIER=com.claude.history-viewer # tauri.conf.json "identifier"
OUT=$1
mkdir -p "$OUT"
OUT=$(realpath "$OUT")
TIMEOUT=${SMOKE_TIMEOUT:-60}
MOVE_X=100
MOVE_Y=120

APP=""
XVFB=""
cleanup() {
  [ -n "$APP" ] && kill "$APP" 2>/dev/null || true
  [ -n "$XVFB" ] && kill "$XVFB" 2>/dev/null || true
}
trap cleanup EXIT

log() {
  echo "[flatpak-smoke] $*" | tee -a "$OUT/summary.txt"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "[flatpak-smoke] $*" >>"$GITHUB_STEP_SUMMARY"; fi
}
fail() {
  log "FAIL: $*"
  for f in "$OUT"/*.log; do [ -f "$f" ] && { echo "--- $f"; tail -n 80 "$f"; }; done
  exit 1
}
in_sandbox() { flatpak run --command=sh "$APP_ID" -c "$1"; }

: >"$OUT/summary.txt"
log "$(flatpak info "$APP_ID" | grep -E 'Version|Runtime' | tr -s ' ' | paste -sd ';')"

# --- 1. headless export: read from ~/.claude, write to Downloads ------------
DOWNLOADS=$(xdg-user-dir DOWNLOAD 2>/dev/null || echo "$HOME/Downloads")
[ "$DOWNLOADS" = "$HOME" ] && DOWNLOADS=$HOME/Downloads
mkdir -p "$HOME/.claude/projects/-smoke-project" "$DOWNLOADS"
SESSION=$HOME/.claude/projects/-smoke-project/11111111-2222-3333-4444-555555555555.jsonl
cat >"$SESSION" <<'JSONL'
{"type":"user","uuid":"u-1","parentUuid":null,"sessionId":"11111111-2222-3333-4444-555555555555","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/smoke-project","message":{"role":"user","content":"hello from the flatpak smoke test"}}
{"type":"assistant","uuid":"a-1","parentUuid":"u-1","sessionId":"11111111-2222-3333-4444-555555555555","timestamp":"2026-01-01T00:00:01.000Z","cwd":"/smoke-project","message":{"id":"msg_1","role":"assistant","model":"claude-sonnet-4-5","content":[{"type":"text","text":"hi"}],"usage":{"input_tokens":1,"output_tokens":1}}}
JSONL
EXPORT=$DOWNLOADS/flatpak-smoke-export.json
rm -f "$EXPORT"
flatpak run "$APP_ID" --export "$SESSION" --format json --output "$EXPORT" >"$OUT/export.log" 2>&1 ||
  fail "--export exited with $?"
grep -q "hello from the flatpak smoke test" "$EXPORT" || fail "the export does not hold the session"
log "export: read $SESSION, wrote $EXPORT"

# --- 2. home read-only, ~/.claude writable ----------------------------------
if in_sandbox "touch \"\$HOME/flatpak-smoke-probe\"" 2>/dev/null; then
  rm -f "$HOME/flatpak-smoke-probe"
  fail "the sandbox can write to the home folder"
fi
log "home folder: read-only"
in_sandbox "touch \"\$HOME/.claude/flatpak-smoke-probe\"" || fail "the sandbox cannot write to ~/.claude"
[ -f "$HOME/.claude/flatpak-smoke-probe" ] || fail "the probe in $HOME/.claude did not reach the host"
log "$HOME/.claude: writable"
# Informational: tools the app shells out to (git log, Cursor's pgrep check).
for tool in git pgrep; do
  if in_sandbox "command -v $tool" >/dev/null 2>&1; then log "runtime has $tool"; else log "runtime lacks $tool"; fi
done

# --- 3. trash through the portal --------------------------------------------
TRASH=${XDG_DATA_HOME:-$HOME/.local/share}/Trash
rm -rf "$TRASH"/files/flatpak-smoke-probe* "$TRASH"/info/flatpak-smoke-probe*
in_sandbox "gio trash \"\$HOME/.claude/flatpak-smoke-probe\"" >"$OUT/trash.log" 2>&1 ||
  fail "gio trash failed inside the sandbox"
[ ! -e "$HOME/.claude/flatpak-smoke-probe" ] || fail "the trashed file is still in ~/.claude"
# The portal names trashed files `<name>.<n>`.
TRASHED=$(find "$TRASH/files" -maxdepth 1 -name 'flatpak-smoke-probe*' 2>/dev/null | head -1)
if [ -z "$TRASHED" ]; then
  log "probe found at: $(find "$HOME" /tmp /var/tmp -name 'flatpak-smoke-probe*' 2>/dev/null | paste -sd' ' || true)"
  fail "the trashed file is not in the host trash ($TRASH)"
fi
[ ! -e "$HOME/.claude/.Trash-$(id -u)" ] || fail "a .Trash-$(id -u) folder was created inside ~/.claude"
log "trash: ~/.claude/flatpak-smoke-probe moved to $TRASHED through the Trash portal"

# --- 4. window shows; its state is saved to the host config folder ----------
export DISPLAY=:99
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp >"$OUT/xvfb.log" 2>&1 &
XVFB=$!
for _ in $(seq 1 50); do xdotool getdisplaygeometry >/dev/null 2>&1 && break; sleep 0.2; done
xdotool getdisplaygeometry >/dev/null 2>&1 || fail "Xvfb did not start"

STATE=$HOME/.config/$IDENTIFIER/window-state.json
rm -f "$STATE"

# No window manager and nothing else on the display: the largest visible
# top-level window of at least 100x100 is the app's (its minimum is 380x400).
visible_window() {
  local best="" area=0 id
  for id in $(xdotool search --onlyvisible --maxdepth 1 --name '' 2>/dev/null || true); do
    eval "$(xdotool getwindowgeometry --shell "$id" 2>/dev/null || echo WIDTH=0 HEIGHT=0)"
    if [ "${WIDTH:-0}" -ge 100 ] && [ "${HEIGHT:-0}" -ge 100 ] && [ $((WIDTH * HEIGHT)) -gt "$area" ]; then
      area=$((WIDTH * HEIGHT))
      best="$id $X $Y $WIDTH $HEIGHT"
    fi
  done
  echo "$best"
}

launch() {
  local n=$1 start ms found=""
  LIBGL_ALWAYS_SOFTWARE=1 flatpak run --env=LIBGL_ALWAYS_SOFTWARE=1 "$APP_ID" >"$OUT/app-$n.log" 2>&1 &
  APP=$!
  start=$(date +%s%N)
  while :; do
    kill -0 "$APP" 2>/dev/null || { wait "$APP" || true; fail "launch $n: app exited before its window showed"; }
    found=$(visible_window)
    [ -n "$found" ] && break
    ms=$((($(date +%s%N) - start) / 1000000))
    [ "$ms" -gt $((TIMEOUT * 1000)) ] && fail "launch $n: no visible window after ${TIMEOUT}s"
    sleep 0.5
  done
  ms=$((($(date +%s%N) - start) / 1000000))
  read -r WIN x y w h <<<"$found"
  sleep 3 # let the page paint before the screenshot
  import -window root "$OUT/flatpak-launch-$n.png"
  log "launch $n: window $WIN visible after ${ms}ms at x=$x y=$y w=$w h=$h, screenshot flatpak-launch-$n.png"
}

stop() {
  flatpak kill "$APP_ID" 2>/dev/null || kill -TERM "$APP" 2>/dev/null || true
  wait "$APP" 2>/dev/null || true
  APP=""
}

launch 1
xdotool windowmove "$WIN" "$MOVE_X" "$MOVE_Y"
MOVED="\"frame\":{\"x\":$MOVE_X,\"y\":$MOVE_Y,"
state_compact() { tr -d '\n\t ' <"$STATE" 2>/dev/null; }
for _ in $(seq 1 40); do state_compact | grep -qF "$MOVED" && break; sleep 0.25; done
state_compact | grep -qF "$MOVED" ||
  fail "$STATE does not hold the moved frame: $(state_compact || echo missing)"
log "window state saved to the host: $STATE"
stop

launch 2
read -r _ x y _ _ <<<"$(visible_window)"
[ "$x" = "$MOVE_X" ] && [ "$y" = "$MOVE_Y" ] ||
  fail "launch 2 at ($x,$y), expected the saved ($MOVE_X,$MOVE_Y)"
log "launch 2: restored the saved position ($MOVE_X,$MOVE_Y)"
stop
log "PASS"
