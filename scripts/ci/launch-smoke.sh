#!/usr/bin/env bash
# Linux launch smoke: the real desktop binary starts and its main window
# becomes visible (T11b creates it hidden; window_state::restore_and_track
# shows it from `setup`). Twice: the window is moved, the move must reach
# window-state.json, and the second launch must show it there.
#
# Usage: dbus-run-session -- bash scripts/ci/launch-smoke.sh <binary> <out-dir>
# Needs: Xvfb, xdotool, ImageMagick (`import`). Writes screenshots, app logs
# and summary.txt to <out-dir>. Exits nonzero if the app dies or no window
# shows within SMOKE_TIMEOUT seconds (default 30).
set -euo pipefail

BIN=$(realpath "$1")
OUT=$2
mkdir -p "$OUT"
OUT=$(realpath "$OUT")
TIMEOUT=${SMOKE_TIMEOUT:-30}
IDENTIFIER=com.claude.history-viewer # tauri.conf.json "identifier"
MOVE_X=100
MOVE_Y=120

# Isolated profile: no user data, fresh config folder.
SANDBOX=$(mktemp -d)
export HOME=$SANDBOX/home XDG_CONFIG_HOME=$SANDBOX/config
export XDG_DATA_HOME=$SANDBOX/data XDG_CACHE_HOME=$SANDBOX/cache
mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"
STATE=$XDG_CONFIG_HOME/$IDENTIFIER/window-state.json
export LIBGL_ALWAYS_SOFTWARE=1

APP=""
XVFB=""
cleanup() {
  [ -n "$APP" ] && kill "$APP" 2>/dev/null || true
  [ -n "$XVFB" ] && kill "$XVFB" 2>/dev/null || true
  rm -rf "$SANDBOX"
}
trap cleanup EXIT

log() { echo "[launch-smoke] $*" | tee -a "$OUT/summary.txt"; }
fail() {
  log "FAIL: $*"
  for f in "$OUT"/app-*.log; do [ -f "$f" ] && { echo "--- $f"; tail -n 80 "$f"; }; done
  exit 1
}

# No window manager: the window maps as the app asks, and xdotool can move it.
export DISPLAY=:99
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp >"$OUT/xvfb.log" 2>&1 &
XVFB=$!
for _ in $(seq 1 50); do xdotool getdisplaygeometry >/dev/null 2>&1 && break; sleep 0.2; done
xdotool getdisplaygeometry >/dev/null 2>&1 || fail "Xvfb did not start"

# Prints "<window id> <x> <y> <width> <height>" of the app's largest visible
# window of at least 100x100 (the main window's minimum is 380x400), or
# nothing.
visible_window() {
  local best="" area=0 id
  for id in $(xdotool search --onlyvisible --pid "$APP" 2>/dev/null || true); do
    eval "$(xdotool getwindowgeometry --shell "$id" 2>/dev/null || echo WIDTH=0 HEIGHT=0)"
    if [ "${WIDTH:-0}" -ge 100 ] && [ "${HEIGHT:-0}" -ge 100 ] && [ $((WIDTH * HEIGHT)) -gt "$area" ]; then
      area=$((WIDTH * HEIGHT))
      best="$id $X $Y $WIDTH $HEIGHT"
    fi
  done
  echo "$best"
}

# launch <n>: start the app, wait for its window, screenshot it. Sets WIN/RECT.
launch() {
  local n=$1 start ms found=""
  "$BIN" >"$OUT/app-$n.log" 2>&1 &
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
  RECT="x=$x y=$y w=$w h=$h"
  sleep 2 # let the page paint before the screenshot
  import -window root "$OUT/linux-launch-$n.png"
  log "launch $n: window $WIN visible after ${ms}ms, rect $RECT, screenshot linux-launch-$n.png"
}

stop() {
  kill -TERM "$APP" 2>/dev/null || true
  wait "$APP" 2>/dev/null || true
  APP=""
}

: >"$OUT/summary.txt"
log "binary $BIN"

launch 1
# Move the window; the app writes window-state.json 500 ms after the last
# move (SAVE_DEBOUNCE). Headless there is no WM to send a polite close, so
# the debounced write is the round trip under test; SIGTERM then ends it.
# The file may already exist from the initial show; wait for the moved frame.
xdotool windowmove "$WIN" "$MOVE_X" "$MOVE_Y"
sleep 0.5
read -r _ x y _ _ <<<"$(visible_window)"
log "moved window to ($x,$y)"
MOVED="\"frame\":{\"x\":$MOVE_X,\"y\":$MOVE_Y,"
state_compact() { tr -d '\n\t ' <"$STATE" 2>/dev/null; } # the file is pretty-printed
for _ in $(seq 1 40); do state_compact | grep -qF "$MOVED" && break; sleep 0.25; done
state_compact | grep -qF "$MOVED" ||
  fail "window-state.json does not hold the moved frame: $(tr -d '\n ' <"$STATE" 2>/dev/null || echo missing)"
log "state file written: $(tr -d '\n ' <"$STATE")"
stop

launch 2
read -r _ x y _ _ <<<"$(visible_window)"
[ "$x" = "$MOVE_X" ] && [ "$y" = "$MOVE_Y" ] ||
  fail "launch 2 at ($x,$y), expected the saved ($MOVE_X,$MOVE_Y)"
log "launch 2: restored the moved position ($MOVE_X,$MOVE_Y)"
stop
log "PASS"
