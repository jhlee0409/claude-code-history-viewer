# Windows launch smoke: the real desktop binary starts and its main window
# becomes visible (T11b creates it hidden; window_state::restore_and_track
# shows it from `setup`). Twice: the window is moved, the move must reach
# window-state.json, and the second launch must show it there.
#
# Usage: pwsh scripts/ci/launch-smoke.ps1 <binary> <out-dir>
# Writes screenshots, app logs and summary.txt to <out-dir>. Exits nonzero if
# the app dies or no window shows within -TimeoutSec seconds.
param(
  [Parameter(Mandatory)] [string] $Binary,
  [Parameter(Mandatory)] [string] $OutDir,
  [int] $TimeoutSec = 30
)
$ErrorActionPreference = 'Stop'
$Identifier = 'com.claude.history-viewer' # tauri.conf.json "identifier"
$MoveX = 150
$MoveY = 120
$MoveW = 700
$MoveH = 500

Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class Win {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  // Visible top-level windows of a process.
  public static List<IntPtr> VisibleTopLevel(uint pid) {
    var found = new List<IntPtr>();
    EnumWindows((h, l) => {
      uint owner; GetWindowThreadProcessId(h, out owner);
      if (owner == pid && IsWindowVisible(h)) found.Add(h);
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$Binary = (Resolve-Path $Binary).Path
$Summary = Join-Path $OutDir 'summary.txt'
Set-Content -Path $Summary -Value ''

# Isolated profile for the child: no user data. Tauri resolves its config
# folder through the Known Folder API, which ignores these variables, so the
# state file is looked up in both places (the runner is fresh either way).
$Sandbox = Join-Path ([IO.Path]::GetTempPath()) ("launch-smoke-" + [guid]::NewGuid())
foreach ($name in 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA') {
  $dir = Join-Path $Sandbox $name
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Set-Item -Path "env:$name" -Value $dir
}
$StateCandidates = @(
  (Join-Path ([Environment]::GetFolderPath('ApplicationData')) "$Identifier\window-state.json"),
  (Join-Path $env:APPDATA "$Identifier\window-state.json")
)

function Log([string] $message) {
  $line = "[launch-smoke] $message"
  Write-Host $line
  Add-Content -Path $Summary -Value $line
}

$script:App = $null
function Fail([string] $message) {
  Log "FAIL: $message"
  Get-ChildItem $OutDir -Filter 'app-*.log' | ForEach-Object {
    Write-Host "--- $($_.Name)"; Get-Content $_.FullName -Tail 80
  }
  if ($script:App -and -not $script:App.HasExited) { Stop-Process -Id $script:App.Id -Force }
  exit 1
}

# The app's largest visible top-level window of at least 100x100 (the main
# window's minimum is 380x400; tao also owns small helper windows):
# @{ Handle; X; Y; W; H } or $null.
function Find-Window {
  $best = $null
  foreach ($h in [Win]::VisibleTopLevel([uint32]$script:App.Id)) {
    $r = New-Object Win+RECT
    [void][Win]::GetWindowRect($h, [ref]$r)
    $w = $r.Right - $r.Left; $hgt = $r.Bottom - $r.Top
    if ($w -ge 100 -and $hgt -ge 100 -and (-not $best -or $w * $hgt -gt $best.W * $best.H)) {
      $best = @{ Handle = $h; X = $r.Left; Y = $r.Top; W = $w; H = $hgt }
    }
  }
  return $best
}

function Save-Screenshot([string] $path) {
  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose(); $bitmap.Dispose()
}

function Start-Launch([int] $n) {
  # -NoNewWindow: the debug build is a console app; keep its console off screen.
  $script:App = Start-Process -FilePath $Binary -PassThru -NoNewWindow `
    -RedirectStandardOutput (Join-Path $OutDir "app-$n.log") `
    -RedirectStandardError (Join-Path $OutDir "app-$n.err.log")
  $clock = [Diagnostics.Stopwatch]::StartNew()
  while ($true) {
    if ($script:App.HasExited) { Fail "launch ${n}: app exited (code $($script:App.ExitCode)) before its window showed" }
    $window = Find-Window
    if ($window) { break }
    if ($clock.Elapsed.TotalSeconds -gt $TimeoutSec) { Fail "launch ${n}: no visible window after ${TimeoutSec}s" }
    Start-Sleep -Milliseconds 500
  }
  $ms = $clock.ElapsedMilliseconds
  Start-Sleep -Seconds 2 # let the page paint before the screenshot
  Save-Screenshot (Join-Path $OutDir "windows-launch-$n.png")
  Log "launch ${n}: window 0x$($window.Handle.ToString('x')) visible after ${ms}ms, rect x=$($window.X) y=$($window.Y) w=$($window.W) h=$($window.H), screenshot windows-launch-$n.png"
  return $window
}

function Stop-Launch($window) {
  # WM_CLOSE: the app's own close path (saves the window state, then exits).
  [void][Win]::PostMessage($window.Handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
  if ($script:App.WaitForExit(15000)) {
    Log "closed via WM_CLOSE (exit code $($script:App.ExitCode))"
  } else {
    Log "note: no exit 15s after WM_CLOSE; killed"
    Stop-Process -Id $script:App.Id -Force
    $script:App.WaitForExit()
  }
}

function Get-StateFile {
  foreach ($path in $StateCandidates) { if (Test-Path $path) { return Get-Item $path } }
  return $null
}

Log "binary $Binary"

$window = Start-Launch 1
# Move the window; the app writes window-state.json 500 ms after the last
# move (SAVE_DEBOUNCE) and again on close.
# Also resized: the runner's screen is small (1024x768), and a frame that
# does not fit is pulled back on screen at restore, which is not under test.
# SWP_NOZORDER | SWP_NOACTIVATE
[void][Win]::SetWindowPos($window.Handle, [IntPtr]::Zero, $MoveX, $MoveY, $MoveW, $MoveH, 0x0004 -bor 0x0010)
# The file may already exist from the initial show; wait for the moved frame.
$moved = '"frame":{"x":' + $MoveX + ',"y":' + $MoveY + ',"width":' + $MoveW + ',"height":' + $MoveH + '}'
$state = $null
for ($i = 0; $i -lt 40; $i++) {
  $state = Get-StateFile
  if ($state -and (Get-Content $state.FullName -Raw).Contains($moved)) { break }
  $state = $null
  Start-Sleep -Milliseconds 250
}
if (-not $state) {
  $found = Get-StateFile
  $content = if ($found) { (Get-Content $found.FullName -Raw) -replace '\s', '' } else { 'missing' }
  Fail "window-state.json does not hold the moved frame: $content"
}
Stop-Launch $window
Log "state file $($state.FullName): $((Get-Content $state.FullName -Raw) -replace '\s', '')"

$window = Start-Launch 2
if ($window.X -ne $MoveX -or $window.Y -ne $MoveY -or $window.W -ne $MoveW -or $window.H -ne $MoveH) {
  Fail "launch 2 at x=$($window.X) y=$($window.Y) w=$($window.W) h=$($window.H), expected the saved x=$MoveX y=$MoveY w=$MoveW h=$MoveH"
}
Log "launch 2: restored the saved frame x=$MoveX y=$MoveY w=$MoveW h=$MoveH"
Stop-Launch $window
Remove-Item -Recurse -Force $Sandbox -ErrorAction SilentlyContinue
Log 'PASS'
