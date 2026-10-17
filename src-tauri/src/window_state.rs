//! Window size and position survive a restart (plan T11b).
//!
//! Owned end to end: no plugin, no JavaScript permission, desktop builder
//! only (`--serve` and `--export` return before it exists).
//!
//! - **Saved record** — [`SavedWindow`] in `<app config dir>/window-state.json`:
//!   the window's normal (un-maximized) OUTER frame in physical pixels, the
//!   scale factor and the monitor (name + physical rectangle) it was on, and
//!   whether it was maximized. Written atomically by [`save`] (temp file in
//!   the same folder, fsync, one rename) when the window closes, when the app
//!   exits, and [`SAVE_DEBOUNCE`] after the last move or resize — never on
//!   every event ([`Debouncer`]). A file that does not parse, has another
//!   version or implausible values is ignored ([`parse`]): the window opens
//!   at its configured default.
//! - **Restore** — [`restore_and_track`], called from the app's `setup`
//!   while the window is still hidden (`"visible": false` in
//!   `tauri.conf.json`); it shows the window afterwards in every case. The
//!   frame comes from the pure [`restore_plan`] / [`place`].
//!
//! **Coordinates.** tao reports physical pixels, but they mean different
//! things per platform; [`DesktopSpace::of`] holds the one rule per platform
//! and the tao lines it rests on. On Windows they are global desktop pixels.
//! On macOS and GTK (Linux, X11 and Wayland) every value is that item's
//! logical position/size times *its own* scale factor, so on a mixed-DPI
//! desktop two monitors' physical rectangles can overlap although the
//! screens do not, and a window's values change with its scale. [`place`]
//! therefore maps every rectangle into one desktop space first and judges
//! monitors one at a time: the chosen monitor is the one with the largest
//! overlap; overlaps are never added up.
//!
//! **Tracking** starts from a normal frame: the restored one, or with
//! nothing saved the window as created ([`tracking_start`]). A frame seen
//! while maximized, minimized or fullscreen never becomes the normal frame,
//! so maximizing first on a first launch still restores — and un-maximizes
//! to — the default frame.
//!
//! **Outer vs inner.** The record and every check use the OUTER frame
//! (title bar and borders included). Tauri's `set_size` sets the INNER size,
//! so [`restore_plan`] subtracts the window's current decoration
//! (outer − inner size, read from the created window) from the fitted outer
//! size.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex, PoisonError};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

/// The saved record's file name, in the app config folder.
pub const FILE_NAME: &str = "window-state.json";

/// Version of the saved record; a file with another version is ignored.
pub const FORMAT_VERSION: u32 = 1;

/// The only window whose state is kept (configured in `tauri.conf.json`).
pub const WINDOW_LABEL: &str = "main";

/// Quiet time after the last move/resize before the record is written.
pub const SAVE_DEBOUNCE: Duration = Duration::from_millis(500);

/// Width (logical px) of the title bar that must lie inside a monitor's work
/// area for the user to grab the window and drag it.
pub const GRAB_WIDTH: f64 = 100.0;

/// Height (logical px) of the title bar band that must lie inside that work
/// area.
pub const TITLE_BAR_HEIGHT: f64 = 32.0;

/// Saved sizes above this many physical pixels mean a corrupt file.
const MAX_DIMENSION: u32 = 100_000;

/// Saved scale factors above this mean a corrupt file.
const MAX_SCALE_FACTOR: f64 = 16.0;

// ---------------------------------------------------------------------------
// Geometry (pure)
// ---------------------------------------------------------------------------

/// A rectangle: a window's outer frame or a monitor's area.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    pub const fn new(x: i32, y: i32, width: u32, height: u32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    // i64 edges and i128 areas: a corrupt record (any i32 position, any u32
    // size) must not overflow.
    fn left(self) -> i64 {
        i64::from(self.x)
    }

    fn top(self) -> i64 {
        i64::from(self.y)
    }

    fn right(self) -> i64 {
        self.left() + i64::from(self.width)
    }

    fn bottom(self) -> i64 {
        self.top() + i64::from(self.height)
    }

    fn horizontal_overlap(self, other: Rect) -> i64 {
        span_overlap(self.left(), self.right(), other.left(), other.right())
    }

    fn overlap_area(self, other: Rect) -> i128 {
        let vertical = span_overlap(self.top(), self.bottom(), other.top(), other.bottom());
        i128::from(self.horizontal_overlap(other)) * i128::from(vertical)
    }

    /// Gap between the two rectangles (0 when they touch or overlap), squared.
    fn distance_squared(self, other: Rect) -> i128 {
        let dx = i128::from(span_gap(
            self.left(),
            self.right(),
            other.left(),
            other.right(),
        ));
        let dy = i128::from(span_gap(
            self.top(),
            self.bottom(),
            other.top(),
            other.bottom(),
        ));
        dx * dx + dy * dy
    }
}

/// Length of the overlap of `[a0, a1)` and `[b0, b1)`.
fn span_overlap(a0: i64, a1: i64, b0: i64, b1: i64) -> i64 {
    (a1.min(b1) - a0.max(b0)).max(0)
}

/// Gap between `[a0, a1)` and `[b0, b1)`, 0 when they overlap.
fn span_gap(a0: i64, a1: i64, b0: i64, b1: i64) -> i64 {
    (b0 - a1).max(a0 - b1).max(0)
}

/// Clamps `start` so `[start, start + length)` lies inside
/// `[area_start, area_start + area_length)`. `length` must not exceed
/// `area_length`.
fn clamp_into(start: i32, length: u32, area_start: i32, area_length: u32) -> i32 {
    let max = i64::from(area_start) + i64::from(area_length) - i64::from(length);
    // `max` is within i32: length <= area_length.
    i64::from(start).clamp(i64::from(area_start), max) as i32
}

fn scale_coordinate(value: i32, factor: f64) -> i32 {
    // `as` saturates; the clamp states it.
    (f64::from(value) * factor)
        .round()
        .clamp(f64::from(i32::MIN), f64::from(i32::MAX)) as i32
}

fn scale_length(value: u32, factor: f64) -> u32 {
    (f64::from(value) * factor)
        .round()
        .clamp(1.0, f64::from(u32::MAX)) as u32
}

fn scale_rect(rect: Rect, factor: f64) -> Rect {
    Rect::new(
        scale_coordinate(rect.x, factor),
        scale_coordinate(rect.y, factor),
        scale_length(rect.width, factor),
        scale_length(rect.height, factor),
    )
}

/// The desktop backends tao has: what decides how its numbers read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    MacOs,
    /// Every GTK target (Linux, the BSDs), X11 and Wayland alike.
    Gtk,
    Windows,
}

impl Platform {
    /// The backend this build runs on.
    pub const CURRENT: Self = if cfg!(target_os = "macos") {
        Self::MacOs
    } else if cfg!(target_os = "windows") {
        Self::Windows
    } else {
        Self::Gtk
    };
}

/// One coordinate space for every rectangle on the desktop.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopSpace {
    /// tao's physical pixels are global desktop pixels.
    Physical,
    /// An item's physical values are its logical position/size times its
    /// own scale factor; the desktop space is the logical one.
    ScaledPerItem,
}

impl DesktopSpace {
    /// The one rule per platform, read from tao 0.35.3 (`platform_impl/`)
    /// and tauri-runtime-wry 2.11.2 (`monitor/`, work areas):
    ///
    /// - macOS — `ScaledPerItem`: monitor `position`/`size`
    ///   (`macos/monitor.rs:216,225`) and work area (`macos.rs:8`) are
    ///   points × that screen's `backingScaleFactor`; window
    ///   `outer_position`/`outer_size` (`macos/window.rs:706,746`) are points
    ///   × the window's scale; `set_outer_position`/`set_inner_size`
    ///   (`:728,755`) divide by the window's current scale.
    /// - GTK — `ScaledPerItem`, the same shape: monitor `size`/`position`
    ///   (`linux/monitor.rs:29,39`) and work area (`linux.rs:10`) are GDK
    ///   geometry × that monitor's scale; window `outer_position`/
    ///   `outer_size` (`linux/window.rs:449,501`) are GTK units × the
    ///   window's scale; the setters (`:457,490`) divide by it.
    /// - Windows — `Physical`: monitor rectangles and work areas are
    ///   `GetMonitorInfoW` pixels (`windows/monitor.rs:199,215`,
    ///   `windows.rs:9`), `outer_position`/`outer_size` are `GetWindowRect`
    ///   (`windows/window.rs:213,264`) and the setters pass physical values
    ///   through (`:229,273`): one global pixel space.
    pub const fn of(platform: Platform) -> Self {
        match platform {
            Platform::MacOs | Platform::Gtk => Self::ScaledPerItem,
            Platform::Windows => Self::Physical,
        }
    }

    /// The space of the platform this build runs on.
    pub const fn current() -> Self {
        Self::of(Platform::CURRENT)
    }

    /// Desktop units per logical pixel on a monitor of `scale_factor`.
    fn units_per_logical(self, scale_factor: f64) -> f64 {
        match self {
            Self::Physical => scale_factor,
            Self::ScaledPerItem => 1.0,
        }
    }

    /// An item's physical rectangle (at its own `scale_factor`) in desktop units.
    fn to_desktop(self, rect: Rect, scale_factor: f64) -> Rect {
        match self {
            Self::Physical => rect,
            Self::ScaledPerItem => scale_rect(rect, 1.0 / scale_factor),
        }
    }

    /// A desktop rectangle as the physical values a window of `scale_factor`
    /// takes: on macOS tao divides `set_position`/`set_size` values by the
    /// window's current scale factor.
    fn to_physical(self, rect: Rect, scale_factor: f64) -> Rect {
        match self {
            Self::Physical => rect,
            Self::ScaledPerItem => scale_rect(rect, scale_factor),
        }
    }
}

/// A monitor as the OS reports it now, physical pixels.
#[derive(Clone, Debug, PartialEq)]
pub struct MonitorInfo {
    pub name: Option<String>,
    pub bounds: Rect,
    /// The monitor without the menu bar, dock, taskbar or panels.
    pub work_area: Rect,
    pub scale_factor: f64,
    pub primary: bool,
}

/// Where the restored window goes, in desktop units.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Placement {
    /// The outer frame to apply.
    Frame(Rect),
    /// No monitor information (e.g. Wayland): only the outer size is
    /// applied; the position is left to the OS.
    SizeOnly { width: u32, height: u32 },
}

/// A monitor's work area in desktop units, with what it takes to judge it.
struct Area {
    work: Rect,
    units_per_logical: f64,
    /// Tie-breakers, in order: the monitor the window was saved on, the
    /// primary monitor.
    preference: (bool, bool),
}

/// The title bar band (`TITLE_BAR_HEIGHT` tall) is inside the work area
/// vertically and at least `GRAB_WIDTH` of it (or all of a narrower window)
/// is inside it horizontally; both converted with that monitor's scale.
fn title_bar_is_on(frame: Rect, area: &Area) -> bool {
    let band =
        ((TITLE_BAR_HEIGHT * area.units_per_logical).round() as i64).min(i64::from(frame.height));
    let grab = ((GRAB_WIDTH * area.units_per_logical).round() as i64).min(i64::from(frame.width));
    frame.top() >= area.work.top()
        && frame.top() + band <= area.work.bottom()
        && frame.horizontal_overlap(area.work) >= grab
}

/// Where the saved window should go now.
///
/// - No monitors: [`Placement::SizeOnly`] — never a position.
/// - The chosen monitor is the one whose work area the frame overlaps most;
///   if it overlaps none, the nearest; on a tie, the monitor it was saved
///   on, then the primary one.
/// - The frame is kept as saved if its title bar can be grabbed on some
///   monitor ([`GRAB_WIDTH`] × [`TITLE_BAR_HEIGHT`] inside a work area) and
///   it fits the chosen monitor's work area.
/// - Otherwise it moves to the chosen monitor: the same logical size (a
///   different scale factor changes its pixels), shrunk to the work area if
///   larger, then moved the least distance that puts it fully inside.
pub fn place(saved: &SavedWindow, monitors: &[MonitorInfo], space: DesktopSpace) -> Placement {
    let frame = space.to_desktop(saved.frame, saved.scale_factor);
    let areas: Vec<Area> = monitors
        .iter()
        .map(|monitor| Area {
            work: space.to_desktop(monitor.work_area, monitor.scale_factor),
            units_per_logical: space.units_per_logical(monitor.scale_factor),
            preference: (
                saved.monitor.as_ref().is_some_and(|m| m.is(monitor)),
                monitor.primary,
            ),
        })
        .collect();
    let Some(chosen) = areas.iter().max_by_key(|area| {
        (
            frame.overlap_area(area.work),
            -frame.distance_squared(area.work),
            area.preference,
        )
    }) else {
        return Placement::SizeOnly {
            width: frame.width,
            height: frame.height,
        };
    };

    let grabbable = areas.iter().any(|area| title_bar_is_on(frame, area));
    let fits = frame.width <= chosen.work.width && frame.height <= chosen.work.height;
    if grabbable && fits {
        return Placement::Frame(frame);
    }

    let ratio = chosen.units_per_logical / space.units_per_logical(saved.scale_factor);
    let width = scale_length(frame.width, ratio).min(chosen.work.width);
    let height = scale_length(frame.height, ratio).min(chosen.work.height);
    Placement::Frame(Rect::new(
        clamp_into(frame.x, width, chosen.work.x, chosen.work.width),
        clamp_into(frame.y, height, chosen.work.y, chosen.work.height),
        width,
        height,
    ))
}

/// The decoration of the window being restored, read after it was created.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WindowMetrics {
    /// The window's current scale factor.
    pub scale_factor: f64,
    /// Outer minus inner size, physical px (title bar, borders, menu bar).
    pub decoration_width: u32,
    pub decoration_height: u32,
}

/// What [`restore_and_track`] does to the created window, in the physical
/// values Tauri's setters take.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RestorePlan {
    /// Outer position for `set_position`; `None` leaves it to the OS.
    pub position: Option<(i32, i32)>,
    /// The placed outer size.
    pub outer_size: (u32, u32),
    /// Inner size for `set_size`: the placed outer size minus the decoration.
    pub inner_size: (u32, u32),
    /// Maximize after the normal frame is applied, so un-maximizing returns
    /// to that frame.
    pub maximize: bool,
}

impl RestorePlan {
    /// The record tracking starts from: the frame as restored (corrected),
    /// so a window that stays maximized until exit saves the corrected
    /// normal frame. Without a position, the saved record as it was.
    pub fn restored_record(&self, saved: &SavedWindow, window: WindowMetrics) -> SavedWindow {
        let Some((x, y)) = self.position else {
            return saved.clone();
        };
        let (width, height) = self.outer_size;
        SavedWindow {
            frame: Rect::new(x, y, width, height),
            scale_factor: window.scale_factor,
            ..saved.clone()
        }
    }
}

/// [`place`] turned into the setter calls for the created window.
pub fn restore_plan(
    saved: &SavedWindow,
    monitors: &[MonitorInfo],
    space: DesktopSpace,
    window: WindowMetrics,
) -> RestorePlan {
    let (position, outer) = match place(saved, monitors, space) {
        Placement::Frame(frame) => {
            let frame = space.to_physical(frame, window.scale_factor);
            (Some((frame.x, frame.y)), frame)
        }
        Placement::SizeOnly { width, height } => (
            None,
            space.to_physical(Rect::new(0, 0, width, height), window.scale_factor),
        ),
    };
    RestorePlan {
        position,
        outer_size: (outer.width, outer.height),
        inner_size: (
            outer.width.saturating_sub(window.decoration_width).max(1),
            outer.height.saturating_sub(window.decoration_height).max(1),
        ),
        maximize: saved.maximized,
    }
}

// ---------------------------------------------------------------------------
// Saved record (pure + file)
// ---------------------------------------------------------------------------

/// The monitor a window was on when saved.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SavedMonitor {
    pub name: Option<String>,
    /// Physical px, as the OS reported it then.
    pub bounds: Rect,
}

impl SavedMonitor {
    fn is(&self, monitor: &MonitorInfo) -> bool {
        self.name == monitor.name && self.bounds == monitor.bounds
    }
}

/// What `window-state.json` holds.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SavedWindow {
    pub version: u32,
    /// The normal (un-maximized) outer frame, physical px at `scale_factor`.
    pub frame: Rect,
    pub scale_factor: f64,
    pub monitor: Option<SavedMonitor>,
    pub maximized: bool,
}

impl SavedWindow {
    pub fn new(
        frame: Rect,
        scale_factor: f64,
        monitor: Option<SavedMonitor>,
        maximized: bool,
    ) -> Self {
        Self {
            version: FORMAT_VERSION,
            frame,
            scale_factor,
            monitor,
            maximized,
        }
    }

    fn is_plausible(&self) -> bool {
        let size_ok = |length: u32| (1..=MAX_DIMENSION).contains(&length);
        self.version == FORMAT_VERSION
            && size_ok(self.frame.width)
            && size_ok(self.frame.height)
            && self.scale_factor.is_finite()
            && self.scale_factor > 0.0
            && self.scale_factor <= MAX_SCALE_FACTOR
    }
}

/// The saved record in `bytes`, or `None` when it does not parse, has
/// another version or implausible values (zero or huge sizes, a bad scale).
pub fn parse(bytes: &[u8]) -> Option<SavedWindow> {
    serde_json::from_slice::<SavedWindow>(bytes)
        .ok()
        .filter(SavedWindow::is_plausible)
}

/// The saved record at `path`; `None` when missing or unusable.
pub fn load(path: &Path) -> Option<SavedWindow> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(error) => {
            log::warn!("window-state: {} not read: {error}", path.display());
            return None;
        }
    };
    let saved = parse(&bytes);
    if saved.is_none() {
        log::warn!(
            "window-state: {} ignored (unknown or corrupt)",
            path.display()
        );
    }
    saved
}

/// The temp file [`save`] writes before renaming it over `path`.
fn temp_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".tmp");
    path.with_file_name(name)
}

/// Writes `record` to `path` atomically: a temp file in the same folder,
/// fsynced, then renamed over the target in one step. A write or rename
/// that fails leaves the previous file as it was.
///
/// `fs::rename` replaces an existing target on every platform — on Windows
/// it is `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` / `FileRenameInfoEx`
/// with `REPLACE_IF_EXISTS` (std `sys/fs/windows.rs`, `rename`) — so the
/// first attempt is that one atomic replace, with no moment in which neither
/// file exists. Only if it fails on Windows (a target that cannot be replaced
/// in place) is the CLAUDE.md remove-the-target-first step used as a retry.
pub fn save(path: &Path, record: &SavedWindow) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(record).map_err(|e| format!("not serialized: {e}"))?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    let temp = temp_path(path);
    crate::commands::fs_utils::write_fresh_temp_file(&temp, &json)?;
    let renamed = fs::rename(&temp, path);
    // Windows fallback (CLAUDE.md rule): a target that cannot be replaced in
    // place (read-only attribute, opened without FILE_SHARE_DELETE) is removed
    // and the rename retried. Only on failure, so the usual path stays one
    // atomic replace.
    #[cfg(windows)]
    let renamed = renamed.or_else(|_| {
        let _ = fs::remove_file(path);
        fs::rename(&temp, path)
    });
    renamed.map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("{} not replaced: {e}", path.display())
    })
}

// ---------------------------------------------------------------------------
// Tracking (pure state + debounce)
// ---------------------------------------------------------------------------

/// The window as read after a move or resize, physical px.
#[derive(Clone, Debug, PartialEq)]
pub struct Observation {
    /// Outer frame.
    pub frame: Rect,
    pub scale_factor: f64,
    pub monitor: Option<SavedMonitor>,
    pub maximized: bool,
    pub minimized: bool,
    pub fullscreen: bool,
}

impl Observation {
    /// Not maximized, minimized or fullscreen: its frame is the normal frame.
    fn is_normal(&self) -> bool {
        !(self.maximized || self.minimized || self.fullscreen)
    }
}

/// The record to save, kept up to date from the window's moves and resizes.
#[derive(Debug, Default)]
pub struct Tracker {
    record: Option<SavedWindow>,
    dirty: bool,
}

impl Tracker {
    /// Starts from the record loaded at launch (if any), not dirty.
    pub fn new(saved: Option<SavedWindow>) -> Self {
        Self {
            record: saved,
            dirty: false,
        }
    }

    /// Applies an observation; returns whether the record changed.
    ///
    /// Only a normal window's frame becomes the normal frame. A minimized or
    /// fullscreen window is ignored (Windows reports a minimized window at
    /// −32000; fullscreen is not restored). A maximized window keeps the
    /// last normal frame and only sets the flag; with no normal frame known
    /// yet it is ignored too ([`tracking_start`] seeds one).
    pub fn observe(&mut self, observation: Observation) -> bool {
        if observation.minimized || observation.fullscreen {
            return false;
        }
        let next = match (&self.record, observation.maximized) {
            (Some(previous), true) => SavedWindow {
                maximized: true,
                ..previous.clone()
            },
            (None, true) => return false,
            (_, false) => SavedWindow::new(
                observation.frame,
                observation.scale_factor,
                observation.monitor,
                false,
            ),
        };
        if self.record.as_ref() == Some(&next) {
            return false;
        }
        self.record = Some(next);
        self.dirty = true;
        true
    }

    /// The record if it changed since the last call (and clears the flag).
    pub fn take_dirty(&mut self) -> Option<SavedWindow> {
        if !self.dirty {
            return None;
        }
        self.dirty = false;
        self.record.clone()
    }

    /// A write failed: try again next time.
    pub fn mark_dirty(&mut self) {
        self.dirty = self.record.is_some();
    }
}

/// The record tracking starts from: the frame as restored (or the saved
/// record when the restore failed); with nothing saved, the window as it
/// was created, if it is a normal window. Then a first move or maximize
/// keeps a real normal frame.
pub fn tracking_start(
    known: Option<SavedWindow>,
    created: Option<Observation>,
) -> Option<SavedWindow> {
    known.or_else(|| {
        created
            .filter(Observation::is_normal)
            .map(|created| {
                SavedWindow::new(created.frame, created.scale_factor, created.monitor, false)
            })
            .filter(SavedWindow::is_plausible)
    })
}

/// Runs an action once things have been quiet for `delay` after the last
/// [`poke`](Debouncer::poke), on its own thread. If every handle is dropped
/// while an action is pending, it still runs.
pub struct Debouncer {
    pokes: mpsc::Sender<()>,
}

impl Debouncer {
    pub fn spawn<F>(delay: Duration, mut action: F) -> Self
    where
        F: FnMut() + Send + 'static,
    {
        let (pokes, poked) = mpsc::channel::<()>();
        let spawned = std::thread::Builder::new()
            .name("window-state-save".into())
            .spawn(move || {
                // Idle until the first poke, then wait for `delay` without one.
                while poked.recv().is_ok() {
                    loop {
                        match poked.recv_timeout(delay) {
                            Ok(()) => {} // poked again: wait anew
                            Err(mpsc::RecvTimeoutError::Timeout) => {
                                action();
                                break;
                            }
                            Err(mpsc::RecvTimeoutError::Disconnected) => {
                                action();
                                return;
                            }
                        }
                    }
                }
            });
        if let Err(error) = spawned {
            log::warn!("window-state: no save thread ({error}); saved on close/exit only");
        }
        Self { pokes }
    }

    pub fn poke(&self) {
        let _ = self.pokes.send(());
    }
}

/// The tracker and the file it is saved to, shared by the window's event
/// handler, the debounce thread and the app's exit hook.
pub struct Persister {
    path: PathBuf,
    tracker: Mutex<Tracker>,
    /// Held across take-and-write so two writers never interleave.
    writing: Mutex<()>,
}

impl Persister {
    pub fn new(path: PathBuf, saved: Option<SavedWindow>) -> Self {
        Self {
            path,
            tracker: Mutex::new(Tracker::new(saved)),
            writing: Mutex::new(()),
        }
    }

    /// See [`Tracker::observe`].
    pub fn observe(&self, observation: Observation) -> bool {
        self.tracker
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .observe(observation)
    }

    /// Writes the record if it changed since the last write.
    pub fn save_if_dirty(&self) {
        let _writing = self.writing.lock().unwrap_or_else(PoisonError::into_inner);
        let record = self
            .tracker
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take_dirty();
        let Some(record) = record else {
            return;
        };
        if let Err(error) = save(&self.path, &record) {
            log::warn!("window-state: not saved: {error}");
            self.tracker
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .mark_dirty();
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri glue
// ---------------------------------------------------------------------------

/// Managed so the app's exit hook ([`on_run_event`]) can flush the record.
struct WindowStateStore(Arc<Persister>);

/// Restores the main window's saved frame, shows the window, and keeps the
/// record up to date. Call from the app's `setup`, after anything that
/// changes the window's decoration (a native menu bar). The window is shown
/// in every case, also when nothing was saved or the restore failed.
pub fn restore_and_track<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
        log::warn!("window-state: no `{WINDOW_LABEL}` window");
        return;
    };
    let path = match app.path().app_config_dir() {
        Ok(dir) => Some(dir.join(FILE_NAME)),
        Err(error) => {
            log::warn!("window-state: no config folder: {error}");
            None
        }
    };
    let saved = path.as_deref().and_then(load);
    let restored = saved.as_ref().and_then(|saved| {
        apply(app, &window, saved)
            .inspect_err(|error| log::warn!("window-state: saved frame not restored: {error}"))
            .ok()
    });
    let known = restored.or(saved);
    // Nothing saved: no setter ran, so the hidden window is at its
    // configured default frame — the normal frame until it moves.
    let created = known.is_none().then(|| observe_created(&window)).flatten();
    show(&window);
    if let Some(path) = path {
        track(app, &window, path, tracking_start(known, created));
    }
}

/// Flushes the record when the app exits (⌘Q / Quit sends no window event).
pub fn on_run_event<R: Runtime>(app: &AppHandle<R>, event: &tauri::RunEvent) {
    if matches!(event, tauri::RunEvent::Exit) {
        if let Some(store) = app.try_state::<WindowStateStore>() {
            store.0.save_if_dirty();
        }
    }
}

fn monitor_info(monitor: &tauri::Monitor, primary: Option<&tauri::Monitor>) -> MonitorInfo {
    let work = monitor.work_area();
    MonitorInfo {
        name: monitor.name().cloned(),
        bounds: monitor_bounds(monitor),
        work_area: Rect::new(
            work.position.x,
            work.position.y,
            work.size.width,
            work.size.height,
        ),
        scale_factor: monitor.scale_factor(),
        primary: primary.is_some_and(|primary| {
            primary.name() == monitor.name() && primary.position() == monitor.position()
        }),
    }
}

fn monitor_bounds(monitor: &tauri::Monitor) -> Rect {
    Rect::new(
        monitor.position().x,
        monitor.position().y,
        monitor.size().width,
        monitor.size().height,
    )
}

fn apply<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    saved: &SavedWindow,
) -> tauri::Result<SavedWindow> {
    let primary = app.primary_monitor().unwrap_or_default();
    // No enumeration (or an error) is "no monitors": size only.
    let monitors: Vec<MonitorInfo> = app
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|monitor| monitor_info(monitor, primary.as_ref()))
        .collect();
    let outer = window.outer_size()?;
    let inner = window.inner_size()?;
    let metrics = WindowMetrics {
        scale_factor: window.scale_factor()?,
        decoration_width: outer.width.saturating_sub(inner.width),
        decoration_height: outer.height.saturating_sub(inner.height),
    };
    let plan = restore_plan(saved, &monitors, DesktopSpace::current(), metrics);
    log::info!("window-state: restoring {saved:?} as {plan:?}");
    // Position first: on Windows a move to a monitor of another DPI rescales
    // the window, which the size set next overrides.
    if let Some((x, y)) = plan.position {
        window.set_position(tauri::PhysicalPosition::new(x, y))?;
    }
    let (width, height) = plan.inner_size;
    window.set_size(tauri::PhysicalSize::new(width, height))?;
    if plan.maximize {
        window.maximize()?;
    }
    Ok(plan.restored_record(saved, metrics))
}

/// Shows the window once the restored frame is in place.
///
/// macOS: tao applies `set_position`/`set_size`/`maximize` asynchronously on
/// the main queue, but `show` immediately. Queuing the show on the same
/// serial queue puts it after them, so the window never appears at the
/// default frame first. Elsewhere the setters take effect in call order.
fn show<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    {
        let window = window.clone();
        dispatch2::DispatchQueue::main().exec_async(move || reveal(&window));
    }
    #[cfg(not(target_os = "macos"))]
    reveal(window);
}

fn reveal<R: Runtime>(window: &WebviewWindow<R>) {
    if let Err(error) = window.show() {
        log::error!("window-state: window not shown: {error}");
    }
    let _ = window.set_focus();
}

fn observe_window<R: Runtime>(window: &WebviewWindow<R>) -> Option<Observation> {
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    Some(Observation {
        frame: Rect::new(position.x, position.y, size.width, size.height),
        scale_factor: window.scale_factor().ok()?,
        monitor: window
            .current_monitor()
            .ok()
            .flatten()
            .map(|monitor| SavedMonitor {
                name: monitor.name().cloned(),
                bounds: monitor_bounds(&monitor),
            }),
        maximized: window.is_maximized().ok()?,
        minimized: window.is_minimized().ok()?,
        fullscreen: window.is_fullscreen().ok()?,
    })
}

/// The window as created, if its outer frame is known yet. GTK reports a
/// window that was never mapped with its origin as its outer size (tao
/// `linux/window.rs:314`); an outer frame smaller than the inner size is
/// that, not a frame. GTK's first configure event on show reports the real
/// frame anyway.
fn observe_created<R: Runtime>(window: &WebviewWindow<R>) -> Option<Observation> {
    let inner = window.inner_size().ok()?;
    observe_window(window)
        .filter(|seen| seen.frame.width >= inner.width && seen.frame.height >= inner.height)
}

fn track<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    path: PathBuf,
    saved: Option<SavedWindow>,
) {
    let persister = Arc::new(Persister::new(path, saved));
    let debouncer = {
        let persister = Arc::clone(&persister);
        Debouncer::spawn(SAVE_DEBOUNCE, move || persister.save_if_dirty())
    };
    app.manage(WindowStateStore(Arc::clone(&persister)));
    let observed = window.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
            if let Some(observation) = observe_window(&observed) {
                if persister.observe(observation) {
                    debouncer.poke();
                }
            }
        }
        tauri::WindowEvent::CloseRequested { .. } => {
            if let Some(observation) = observe_window(&observed) {
                persister.observe(observation);
            }
            persister.save_if_dirty();
        }
        _ => {}
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod placement_tests {
    use super::*;
    use DesktopSpace::{Physical, ScaledPerItem};

    const fn rect(x: i32, y: i32, width: u32, height: u32) -> Rect {
        Rect::new(x, y, width, height)
    }

    fn monitor(bounds: Rect, work_area: Rect, scale_factor: f64, primary: bool) -> MonitorInfo {
        MonitorInfo {
            name: None,
            bounds,
            work_area,
            scale_factor,
            primary,
        }
    }

    /// A 1440x900 laptop at 1x, work area below a 25 px menu bar.
    fn laptop() -> MonitorInfo {
        monitor(rect(0, 0, 1440, 900), rect(0, 25, 1440, 875), 1.0, true)
    }

    /// A 2560x1440 1x monitor to the laptop's right.
    fn external() -> MonitorInfo {
        monitor(
            rect(1440, 0, 2560, 1440),
            rect(1440, 0, 2560, 1440),
            1.0,
            false,
        )
    }

    fn saved(frame: Rect, scale_factor: f64) -> SavedWindow {
        SavedWindow::new(frame, scale_factor, None, false)
    }

    fn place1(frame: Rect, monitors: &[MonitorInfo]) -> Placement {
        place(&saved(frame, 1.0), monitors, Physical)
    }

    #[test]
    fn an_on_screen_frame_is_kept() {
        let frame = rect(100, 100, 1200, 700);
        assert_eq!(place1(frame, &[laptop()]), Placement::Frame(frame));
    }

    #[test]
    fn a_frame_partly_off_the_right_edge_with_enough_title_bar_left_is_kept() {
        // 140 px of the title bar are on screen: the user can drag it back.
        let frame = rect(1300, 100, 1200, 700);
        assert_eq!(place1(frame, &[laptop()]), Placement::Frame(frame));
    }

    #[test]
    fn a_frame_whose_monitor_is_gone_moves_onto_a_remaining_monitor() {
        let frame = rect(2000, 150, 1200, 700);
        assert_eq!(
            place1(frame, &[laptop()]),
            Placement::Frame(rect(240, 150, 1200, 700))
        );
    }

    #[test]
    fn a_frame_with_only_a_sliver_of_title_bar_on_screen_is_pulled_back() {
        let frame = rect(1435, 100, 1200, 700);
        assert_eq!(
            place1(frame, &[laptop()]),
            Placement::Frame(rect(240, 100, 1200, 700))
        );
    }

    #[test]
    fn a_frame_whose_title_bar_is_above_the_work_area_is_pulled_down() {
        let frame = rect(100, -300, 1200, 700);
        assert_eq!(
            place1(frame, &[laptop()]),
            Placement::Frame(rect(100, 25, 1200, 700))
        );
    }

    #[test]
    fn a_frame_whose_title_bar_is_at_the_bottom_edge_is_pulled_up() {
        let frame = rect(100, 890, 1200, 700);
        assert_eq!(
            place1(frame, &[laptop()]),
            Placement::Frame(rect(100, 200, 1200, 700))
        );
    }

    #[test]
    fn an_outer_frame_larger_than_the_work_area_is_fitted_to_it() {
        let frame = rect(0, 25, 2560, 1400);
        assert_eq!(
            place1(frame, &[laptop()]),
            Placement::Frame(rect(0, 25, 1440, 875))
        );
    }

    #[test]
    fn a_fully_off_screen_frame_goes_to_the_nearest_monitor() {
        let frame = rect(9000, 100, 1200, 700);
        assert_eq!(
            place1(frame, &[laptop(), external()]),
            Placement::Frame(rect(2800, 100, 1200, 700))
        );
    }

    #[test]
    fn a_frame_overlapping_two_monitors_is_corrected_onto_the_one_it_overlaps_most() {
        // Title bar above both tops; most of the body is on the external one.
        let frame = rect(1400, -100, 1200, 700);
        assert_eq!(
            place1(frame, &[laptop(), external()]),
            Placement::Frame(rect(1440, 0, 1200, 700))
        );
    }

    #[test]
    fn a_frame_spanning_two_monitors_with_a_grabbable_title_bar_is_kept() {
        let frame = rect(1000, 200, 1200, 700);
        assert_eq!(
            place1(frame, &[laptop(), external()]),
            Placement::Frame(frame)
        );
    }

    #[test]
    fn mirrored_displays_do_not_make_an_unreachable_title_bar_reachable() {
        // Mirrors report the same area twice; nothing is added up.
        let frame = rect(-100, -50, 1200, 700);
        assert_eq!(
            place1(frame, &[laptop(), laptop()]),
            Placement::Frame(rect(0, 25, 1200, 700))
        );
    }

    /// Review F1: on macOS a 2x primary (1440x900 points, work area below a
    /// 25 pt menu bar) and a 1x 2560x1440 monitor to its right report
    /// physical work areas (0,50,2880,1750) and (1440,0,2560,1440), which
    /// overlap. A frame saved on the primary whose title bar is above both
    /// must still be corrected; summing the overlaps made it look covered.
    #[test]
    fn mixed_dpi_overlapping_physical_rects_are_not_double_counted() {
        let primary = monitor(rect(0, 0, 2880, 1800), rect(0, 50, 2880, 1750), 2.0, true);
        let side = monitor(
            rect(1440, 0, 2560, 1440),
            rect(1440, 0, 2560, 1440),
            1.0,
            false,
        );
        let saved = saved(rect(1600, -100, 1200, 700), 2.0);

        // macOS: in points the frame is (800,-50,600,350) on the primary.
        assert_eq!(
            place(&saved, &[primary.clone(), side.clone()], ScaledPerItem),
            Placement::Frame(rect(800, 25, 600, 350))
        );
        // The same numbers read as global pixels: still corrected, onto the
        // single monitor it overlaps most.
        assert!(matches!(
            place(&saved, &[primary, side], Physical),
            Placement::Frame(frame) if frame.y >= 0
        ));
    }

    /// macOS, mixed DPI: a window on a 1x monitor right of a 2x laptop has
    /// physical coordinates inside the laptop's physical rectangle. Compared
    /// in points it is on the external monitor and stays there.
    #[test]
    fn mixed_dpi_frames_are_compared_in_one_desktop_space_on_macos() {
        let retina = monitor(rect(0, 0, 2880, 1800), rect(0, 50, 2880, 1750), 2.0, true);
        let side = monitor(
            rect(1440, 0, 2560, 1440),
            rect(1440, 0, 2560, 1440),
            1.0,
            false,
        );
        let saved = saved(rect(1600, 100, 1000, 600), 1.0);
        assert_eq!(
            place(&saved, &[retina, side], ScaledPerItem),
            Placement::Frame(rect(1600, 100, 1000, 600))
        );
    }

    #[test]
    fn monitors_left_of_and_above_the_primary_have_valid_negative_coordinates() {
        let left = monitor(
            rect(-1920, 0, 1920, 1080),
            rect(-1920, 0, 1920, 1040),
            1.0,
            false,
        );
        let above = monitor(
            rect(0, -1080, 1920, 1080),
            rect(0, -1080, 1920, 1080),
            1.0,
            false,
        );
        let on_left = rect(-1800, 100, 800, 600);
        let on_above = rect(100, -1000, 800, 600);
        let monitors = [laptop(), left.clone(), above];
        assert_eq!(place1(on_left, &monitors), Placement::Frame(on_left));
        assert_eq!(place1(on_above, &monitors), Placement::Frame(on_above));
        // Off the far left of the left monitor: pulled onto it, still negative.
        // (70 px of its title bar on the left monitor: too little to grab.)
        assert_eq!(
            place1(rect(-2650, 100, 800, 600), &[laptop(), left]),
            Placement::Frame(rect(-1920, 100, 800, 600))
        );
    }

    #[test]
    fn no_monitor_information_applies_the_size_only() {
        assert_eq!(
            place1(rect(-5000, -5000, 800, 600), &[]),
            Placement::SizeOnly {
                width: 800,
                height: 600
            }
        );
    }

    #[test]
    fn the_grabbable_title_bar_is_measured_in_that_monitors_logical_pixels() {
        // 120 physical px of title bar on screen: enough at 1x (100 needed),
        // not at 1.5x (150 needed).
        let frame = rect(1320, 100, 800, 600);
        assert_eq!(place1(frame, &[laptop()]), Placement::Frame(frame));
        let hidpi = monitor(rect(0, 0, 1440, 900), rect(0, 25, 1440, 875), 1.5, true);
        assert_eq!(
            place(&saved(frame, 1.5), &[hidpi], Physical),
            Placement::Frame(rect(640, 100, 800, 600))
        );
    }

    #[test]
    fn moving_to_a_monitor_of_another_scale_keeps_the_logical_size() {
        // Windows/Linux: saved 1200x800 logical on a 1.5x monitor that is
        // gone; on the 1x laptop it is 1200x800 pixels again.
        let frame = rect(3000, 200, 1800, 1200);
        assert_eq!(
            place(&saved(frame, 1.5), &[laptop()], Physical),
            Placement::Frame(rect(240, 100, 1200, 800))
        );
    }

    #[test]
    fn a_tie_goes_to_the_saved_monitor_then_the_primary() {
        // Two monitors the same distance above and below an off-screen frame.
        let top = monitor(
            rect(0, -1000, 1000, 1000),
            rect(0, -1000, 1000, 1000),
            1.0,
            false,
        );
        let bottom = monitor(
            rect(0, 2000, 1000, 1000),
            rect(0, 2000, 1000, 1000),
            1.0,
            true,
        );
        // 850..1150: 850 below the top monitor and 850 above the bottom one.
        let mid = rect(0, 850, 400, 300);
        assert_eq!(
            place1(mid, &[top.clone(), bottom.clone()]),
            Placement::Frame(rect(0, 2000, 400, 300))
        );
        let mut on_top = saved(mid, 1.0);
        on_top.monitor = Some(SavedMonitor {
            name: None,
            bounds: top.bounds,
        });
        assert_eq!(
            place(&on_top, &[top, bottom], Physical),
            Placement::Frame(rect(0, -300, 400, 300))
        );
    }

    #[test]
    fn extreme_saved_values_do_not_overflow() {
        let huge = rect(i32::MIN, i32::MAX, u32::MAX, u32::MAX);
        assert_eq!(
            place1(huge, &[laptop()]),
            Placement::Frame(rect(0, 25, 1440, 875))
        );
        let far = rect(i32::MAX, i32::MIN, 800, 600);
        assert_eq!(
            place1(far, &[laptop(), external()]),
            Placement::Frame(rect(3200, 0, 800, 600))
        );
    }

    fn metrics(scale_factor: f64, decoration: (u32, u32)) -> WindowMetrics {
        WindowMetrics {
            scale_factor,
            decoration_width: decoration.0,
            decoration_height: decoration.1,
        }
    }

    /// Review F4: the OUTER frame is fitted to the work area; the inner size
    /// handed to `set_size` leaves room for the title bar and borders.
    #[test]
    fn the_inner_size_set_is_the_fitted_outer_size_minus_the_decoration() {
        let taskbar = monitor(rect(0, 0, 1920, 1080), rect(0, 0, 1920, 1040), 1.0, true);
        let plan = restore_plan(
            &saved(rect(3000, 100, 2400, 1500), 1.0),
            &[taskbar],
            Physical,
            metrics(1.0, (16, 39)),
        );
        assert_eq!(plan.position, Some((0, 0)));
        assert_eq!(plan.inner_size, (1904, 1001));
        // Outer bottom = y + inner height + decoration = the work area's bottom.
        let (_, y) = plan.position.unwrap();
        assert_eq!(i64::from(y) + i64::from(plan.inner_size.1) + 39, 1040);
    }

    /// Review F2: a maximized record restores its corrected normal frame
    /// (where un-maximizing returns) and is then maximized.
    #[test]
    fn a_maximized_record_restores_the_corrected_normal_frame_then_maximizes() {
        let mut record = saved(rect(2200, 100, 1200, 700), 1.0);
        record.maximized = true;
        let plan = restore_plan(&record, &[laptop()], Physical, metrics(1.0, (0, 0)));
        assert_eq!(
            plan,
            RestorePlan {
                position: Some((240, 100)),
                outer_size: (1200, 700),
                inner_size: (1200, 700),
                maximize: true,
            }
        );
    }

    #[test]
    fn tracking_starts_from_the_restored_frame_not_the_saved_one() {
        let mut record = saved(rect(2200, 100, 1200, 700), 1.0);
        record.maximized = true;
        let window = metrics(1.0, (0, 28));
        let plan = restore_plan(&record, &[laptop()], Physical, window);
        assert_eq!(
            plan.restored_record(&record, window),
            SavedWindow::new(rect(240, 100, 1200, 700), 1.0, None, true)
        );
        // No monitors, no position: the saved record is kept.
        let plan = restore_plan(&record, &[], Physical, window);
        assert_eq!(plan.restored_record(&record, window), record);
    }

    #[test]
    fn on_macos_the_plan_is_in_the_windows_current_scale() {
        // Saved on a 2x display at points (100,100) 1000x700; restored into
        // a window that tao currently scales at 2x.
        let retina = monitor(rect(0, 0, 2880, 1800), rect(0, 50, 2880, 1750), 2.0, true);
        let plan = restore_plan(
            &saved(rect(200, 200, 2000, 1400), 2.0),
            std::slice::from_ref(&retina),
            ScaledPerItem,
            metrics(2.0, (0, 0)),
        );
        assert_eq!(plan.position, Some((200, 200)));
        assert_eq!(plan.inner_size, (2000, 1400));
        // The same record restored into a window tao scales at 1x (created on
        // a 1x screen): the same points, at 1x.
        let plan = restore_plan(
            &saved(rect(200, 200, 2000, 1400), 2.0),
            &[retina],
            ScaledPerItem,
            metrics(1.0, (0, 0)),
        );
        assert_eq!(plan.position, Some((100, 100)));
        assert_eq!(plan.inner_size, (1000, 700));
    }

    /// What tao does with the plan's physical values, per the setter lines
    /// cited on [`DesktopSpace::of`]: macOS and GTK divide them by the
    /// window's current scale (points / GTK units), Windows passes them on.
    /// Returns the native (x, y, inner width, inner height).
    fn native_frame(platform: Platform, plan: &RestorePlan, window_scale: f64) -> [f64; 4] {
        let divisor = match platform {
            Platform::MacOs | Platform::Gtk => window_scale,
            Platform::Windows => 1.0,
        };
        let (x, y) = plan.position.expect("a position");
        let (width, height) = plan.inner_size;
        [
            f64::from(x),
            f64::from(y),
            f64::from(width),
            f64::from(height),
        ]
        .map(|value| value / divisor)
    }

    #[test]
    fn each_platform_has_one_desktop_space() {
        assert_eq!(DesktopSpace::of(Platform::MacOs), ScaledPerItem);
        assert_eq!(DesktopSpace::of(Platform::Gtk), ScaledPerItem);
        assert_eq!(DesktopSpace::of(Platform::Windows), Physical);
        let expected = if cfg!(target_os = "macos") {
            Platform::MacOs
        } else if cfg!(target_os = "windows") {
            Platform::Windows
        } else {
            Platform::Gtk
        };
        assert_eq!(Platform::CURRENT, expected);
        assert_eq!(DesktopSpace::current(), DesktopSpace::of(expected));
    }

    /// A 2x primary (1440x900 logical, work area below a 25 px bar) and a
    /// 1x 2560x1440 monitor to its right, as tao reports them on macOS and
    /// GTK: each rectangle is its logical one times its own scale.
    fn mixed_scale_per_item() -> [MonitorInfo; 2] {
        [
            MonitorInfo {
                name: Some("primary".into()),
                ..monitor(rect(0, 0, 2880, 1800), rect(0, 50, 2880, 1750), 2.0, true)
            },
            MonitorInfo {
                name: Some("side".into()),
                ..monitor(
                    rect(1440, 0, 2560, 1440),
                    rect(1440, 0, 2560, 1440),
                    1.0,
                    false,
                )
            },
        ]
    }

    /// Review-2 F1 (probe 7): saved on the 1x side monitor at (1600,100)
    /// 1000x600; the new window is created at 2x on the primary. GTK must
    /// get back the saved GTK units, not half of them.
    #[test]
    fn gtk_mixed_scale_restores_the_saved_frame_into_a_window_of_another_scale() {
        let monitors = mixed_scale_per_item();
        let record = SavedWindow::new(
            rect(1600, 100, 1000, 600),
            1.0,
            Some(SavedMonitor {
                name: monitors[1].name.clone(),
                bounds: monitors[1].bounds,
            }),
            false,
        );
        let window = metrics(2.0, (0, 0));
        let plan = restore_plan(&record, &monitors, DesktopSpace::of(Platform::Gtk), window);
        assert_eq!(
            native_frame(Platform::Gtk, &plan, 2.0),
            [1600.0, 100.0, 1000.0, 600.0]
        );
    }

    /// GTK: the side monitor is gone; the frame moves onto the 2x primary
    /// keeping its logical size (1000x600 GTK units).
    #[test]
    fn gtk_a_frame_from_a_removed_1x_monitor_keeps_its_logical_size_on_a_2x_one() {
        let [primary, _] = mixed_scale_per_item();
        let record = saved(rect(1600, 100, 1000, 600), 1.0);
        let plan = restore_plan(
            &record,
            &[primary],
            DesktopSpace::of(Platform::Gtk),
            metrics(2.0, (0, 0)),
        );
        assert_eq!(
            native_frame(Platform::Gtk, &plan, 2.0),
            [440.0, 100.0, 1000.0, 600.0]
        );
    }

    /// The same desktop on macOS: the saved points come back.
    #[test]
    fn macos_mixed_scale_restores_the_saved_frame_into_a_window_of_another_scale() {
        let monitors = mixed_scale_per_item();
        let record = saved(rect(1600, 100, 1000, 600), 1.0);
        let plan = restore_plan(
            &record,
            &monitors,
            DesktopSpace::of(Platform::MacOs),
            metrics(2.0, (0, 0)),
        );
        assert_eq!(
            native_frame(Platform::MacOs, &plan, 2.0),
            [1600.0, 100.0, 1000.0, 600.0]
        );
    }

    /// Windows: one global pixel space (the 1x monitor starts where the
    /// 2x one's 2880 pixels end); the values pass through unchanged.
    #[test]
    fn windows_mixed_dpi_restores_the_saved_pixels_into_a_window_of_another_scale() {
        let primary = monitor(rect(0, 0, 2880, 1800), rect(0, 0, 2880, 1720), 2.0, true);
        let side = monitor(
            rect(2880, 0, 2560, 1440),
            rect(2880, 0, 2560, 1400),
            1.0,
            false,
        );
        let record = saved(rect(3000, 100, 1016, 639), 1.0);
        let plan = restore_plan(
            &record,
            &[primary, side],
            DesktopSpace::of(Platform::Windows),
            metrics(2.0, (16, 39)),
        );
        assert_eq!(
            native_frame(Platform::Windows, &plan, 2.0),
            [3000.0, 100.0, 1000.0, 600.0]
        );
    }

    #[test]
    fn without_monitors_the_plan_sets_no_position() {
        let plan = restore_plan(
            &saved(rect(-5000, -5000, 800, 600), 1.0),
            &[],
            Physical,
            metrics(1.0, (0, 30)),
        );
        assert_eq!(plan.position, None);
        assert_eq!(plan.inner_size, (800, 570));
    }
}

#[cfg(test)]
mod record_tests {
    use super::*;

    fn record() -> SavedWindow {
        SavedWindow::new(
            Rect::new(-1800, 120, 2200, 1300),
            2.0,
            Some(SavedMonitor {
                name: Some("Built-in Retina Display".into()),
                bounds: Rect::new(0, 0, 3600, 2338),
            }),
            false,
        )
    }

    #[test]
    fn a_saved_record_loads_back_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join(FILE_NAME);
        save(&path, &record()).unwrap();
        assert_eq!(load(&path), Some(record()));
    }

    #[test]
    fn the_file_is_versioned_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        save(&path, &record()).unwrap();
        let json: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(json["version"], 1);
        assert_eq!(json["frame"]["x"], -1800);
        assert_eq!(json["scale_factor"], 2.0);
        assert_eq!(json["monitor"]["name"], "Built-in Retina Display");
        assert_eq!(json["maximized"], false);
    }

    #[test]
    fn save_replaces_the_file_through_a_temp_file_and_leaves_none_behind() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        fs::write(&path, b"old").unwrap();
        save(&path, &record()).unwrap();
        assert_eq!(load(&path), Some(record()));
        let names: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from(FILE_NAME)]);
    }

    #[test]
    fn a_failed_write_leaves_the_previous_file_intact() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        save(&path, &record()).unwrap();
        let before = fs::read(&path).unwrap();
        // A directory where the temp file goes: the write fails before the
        // rename.
        fs::create_dir(temp_path(&path)).unwrap();
        let mut moved = record();
        moved.frame.x = 0;
        assert!(save(&path, &moved).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
    }

    #[test]
    fn a_corrupt_file_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        fs::write(&path, b"{\"version\":1,\"frame\":").unwrap();
        assert_eq!(load(&path), None);
        assert_eq!(load(&dir.path().join("missing.json")), None);
    }

    #[test]
    fn another_version_or_shape_is_ignored() {
        let mut json = serde_json::to_value(record()).unwrap();
        json["version"] = 2.into();
        assert_eq!(parse(&serde_json::to_vec(&json).unwrap()), None);
        // The old plugin's file shape.
        let plugin = br#"{"main":{"width":1200,"height":800,"x":1,"y":2,"prev_x":1,"prev_y":2,"maximized":false,"visible":true,"decorated":true,"fullscreen":false}}"#;
        assert_eq!(parse(plugin), None);
    }

    #[test]
    fn implausible_values_are_ignored() {
        let edits: [fn(&mut SavedWindow); 4] = [
            |r: &mut SavedWindow| r.frame.width = 0,
            |r: &mut SavedWindow| r.frame.height = MAX_DIMENSION + 1,
            |r: &mut SavedWindow| r.scale_factor = 0.0,
            |r: &mut SavedWindow| r.scale_factor = 64.0,
        ];
        for edit in edits {
            let mut bad = record();
            edit(&mut bad);
            assert_eq!(parse(&serde_json::to_vec(&bad).unwrap()), None, "{bad:?}");
        }
        assert_eq!(
            parse(&serde_json::to_vec(&record()).unwrap()),
            Some(record())
        );
    }
}

#[cfg(test)]
mod tracking_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::thread::sleep;

    fn seen(frame: Rect, maximized: bool) -> Observation {
        Observation {
            frame,
            scale_factor: 2.0,
            monitor: None,
            maximized,
            minimized: false,
            fullscreen: false,
        }
    }

    const NORMAL: Rect = Rect::new(100, 100, 1200, 800);
    const ZOOMED: Rect = Rect::new(0, 50, 2880, 1750);

    #[test]
    fn a_move_or_resize_updates_the_normal_frame() {
        let mut tracker = Tracker::new(None);
        assert!(tracker.observe(seen(NORMAL, false)));
        assert_eq!(
            tracker.take_dirty(),
            Some(SavedWindow::new(NORMAL, 2.0, None, false))
        );
        assert_eq!(tracker.take_dirty(), None, "written once");
    }

    #[test]
    fn the_same_frame_again_is_not_a_change() {
        let mut tracker = Tracker::new(Some(SavedWindow::new(NORMAL, 2.0, None, false)));
        assert!(!tracker.observe(seen(NORMAL, false)));
        assert_eq!(tracker.take_dirty(), None);
    }

    #[test]
    fn maximizing_keeps_the_normal_frame_and_sets_the_flag() {
        let mut tracker = Tracker::new(None);
        tracker.observe(seen(NORMAL, false));
        assert!(tracker.observe(seen(ZOOMED, true)));
        assert_eq!(
            tracker.take_dirty(),
            Some(SavedWindow::new(NORMAL, 2.0, None, true))
        );
        // Un-maximizing back to the normal frame clears the flag.
        assert!(tracker.observe(seen(NORMAL, false)));
        assert_eq!(
            tracker.take_dirty(),
            Some(SavedWindow::new(NORMAL, 2.0, None, false))
        );
    }

    /// Review-2 F2 (probe 8): first launch, maximized before any move.
    /// Tracking starts from the window as created (1200x800 points at 2x,
    /// centred), so the saved normal frame is that frame, not the zoomed
    /// one; the relaunch applies it before maximizing, so un-maximizing
    /// returns to it.
    #[test]
    fn maximizing_first_on_first_launch_saves_the_created_normal_frame() {
        let created = Rect::new(600, 408, 2400, 1600);
        let zoomed = Rect::new(0, 78, 3600, 2260);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        let start = tracking_start(None, Some(seen(created, false)));
        let persister = Persister::new(path.clone(), start);
        persister.save_if_dirty();
        assert!(!path.exists(), "launch and quit alone write nothing");
        assert!(persister.observe(seen(zoomed, true)));
        persister.save_if_dirty();
        let stored = load(&path).unwrap();
        assert_eq!(stored, SavedWindow::new(created, 2.0, None, true));

        let built_in = MonitorInfo {
            name: None,
            bounds: Rect::new(0, 0, 3600, 2338),
            work_area: zoomed,
            scale_factor: 2.0,
            primary: true,
        };
        let window = WindowMetrics {
            scale_factor: 2.0,
            decoration_width: 0,
            decoration_height: 0,
        };
        let plan = restore_plan(&stored, &[built_in], DesktopSpace::ScaledPerItem, window);
        assert_eq!(plan.position, Some((created.x, created.y)));
        assert_eq!(plan.outer_size, (created.width, created.height));
        assert!(plan.maximize);
    }

    #[test]
    fn a_maximized_minimized_or_fullscreen_frame_is_never_the_normal_frame() {
        let mut tracker = Tracker::new(None);
        assert!(!tracker.observe(seen(ZOOMED, true)));
        assert_eq!(tracker.take_dirty(), None);
        let mut minimized = seen(NORMAL, false);
        minimized.minimized = true;
        let mut fullscreen = seen(NORMAL, false);
        fullscreen.fullscreen = true;
        for created in [seen(ZOOMED, true), minimized, fullscreen] {
            assert_eq!(tracking_start(None, Some(created)), None);
        }
    }

    #[test]
    fn tracking_starts_from_the_restored_record_before_the_created_window() {
        let restored = SavedWindow::new(NORMAL, 2.0, None, true);
        assert_eq!(
            tracking_start(Some(restored.clone()), Some(seen(ZOOMED, false))),
            Some(restored)
        );
        assert_eq!(
            tracking_start(None, Some(seen(NORMAL, false))),
            Some(SavedWindow::new(NORMAL, 2.0, None, false))
        );
        assert_eq!(tracking_start(None, None), None);
    }

    #[test]
    fn minimized_and_fullscreen_windows_are_ignored() {
        let mut tracker = Tracker::new(Some(SavedWindow::new(NORMAL, 2.0, None, false)));
        let mut minimized = seen(Rect::new(-32000, -32000, 160, 28), false);
        minimized.minimized = true;
        let mut fullscreen = seen(Rect::new(0, 0, 2880, 1800), false);
        fullscreen.fullscreen = true;
        assert!(!tracker.observe(minimized));
        assert!(!tracker.observe(fullscreen));
        assert_eq!(tracker.take_dirty(), None);
    }

    #[test]
    fn a_burst_of_pokes_runs_the_action_once_after_the_quiet_time() {
        let runs = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&runs);
        let debouncer = Debouncer::spawn(Duration::from_millis(150), move || {
            counter.fetch_add(1, Ordering::SeqCst);
        });
        for _ in 0..20 {
            debouncer.poke();
            sleep(Duration::from_millis(5));
        }
        assert_eq!(runs.load(Ordering::SeqCst), 0, "not while still moving");
        sleep(Duration::from_millis(500));
        assert_eq!(runs.load(Ordering::SeqCst), 1);
        debouncer.poke();
        sleep(Duration::from_millis(500));
        assert_eq!(runs.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_pending_action_still_runs_when_the_debouncer_is_dropped() {
        let runs = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&runs);
        let debouncer = Debouncer::spawn(Duration::from_secs(60), move || {
            counter.fetch_add(1, Ordering::SeqCst);
        });
        debouncer.poke();
        drop(debouncer);
        sleep(Duration::from_millis(200));
        assert_eq!(runs.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn the_persister_writes_the_latest_frame_once_per_change() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        let persister = Persister::new(path.clone(), None);
        persister.save_if_dirty();
        assert!(!path.exists(), "nothing observed, nothing written");
        persister.observe(seen(Rect::new(1, 1, 500, 500), false));
        persister.observe(seen(NORMAL, false));
        persister.save_if_dirty();
        assert_eq!(
            load(&path),
            Some(SavedWindow::new(NORMAL, 2.0, None, false))
        );
        fs::remove_file(&path).unwrap();
        persister.save_if_dirty();
        assert!(!path.exists(), "unchanged, not rewritten");
    }
}

#[cfg(test)]
mod registration_tests {
    /// The desktop builder's source, from its first line to the app's run.
    /// `lib.rs` with `\n` line ends: a Windows checkout (core.autocrlf) has `\r\n`.
    fn lib_source() -> String {
        include_str!("lib.rs").replace("\r\n", "\n")
    }

    fn desktop_builder() -> String {
        let source = lib_source();
        let start = source
            .find("let mut builder = tauri::Builder::default()")
            .expect("desktop builder");
        let end = start
            + source[start..]
                .find("\n#[cfg(target_os = \"linux\")]\nfn configure_linux_ime_environment")
                .expect("end of run_tauri");
        source[start..end].to_string()
    }

    /// Checked on the source, as the builder cannot run headless.
    /// Single-instance stays first (a second launch exits before anything
    /// reads the record); the restore runs in the one `setup` hook — a second
    /// `.setup(` would silently replace the first.
    #[test]
    fn the_restore_runs_in_the_one_setup_hook_and_the_exit_hook_flushes() {
        let body = desktop_builder();
        let first_plugin = body.find(".plugin(").expect("a plugin");
        assert!(body[first_plugin..].starts_with(".plugin(tauri_plugin_single_instance::init("));
        assert_eq!(body.matches(".setup(").count(), 1, "one setup hook");
        let setup = &body[body.find(".setup(").unwrap()..];
        let setup = &setup[..setup.find("Ok(())").expect("setup end")];
        assert!(setup.contains("window_state::restore_and_track(app.handle());"));
        let run = &body[body.find(".run(|app, event| {").expect("run closure")..];
        assert!(run.contains("window_state::on_run_event(app, &event);"));
    }

    /// `--serve` and `--export` return before the desktop builder exists.
    #[test]
    fn only_the_desktop_builder_uses_window_state() {
        let source = lib_source();
        assert_eq!(
            source.matches("window_state::restore_and_track(").count(),
            1
        );
        let run = &source[source.find("pub fn run()").expect("run")..];
        let run = &run[..run.find("\n}\n").expect("end of run")];
        assert!(!run.contains("window_state"));
        assert!(run.contains("export::run_export(&args)"));
        assert!(run.contains("run_server(&args);\n            return;"));
    }

    /// The window is created hidden; `restore_and_track` shows it after the
    /// frame is applied (no flash at the default frame).
    #[test]
    fn the_main_window_starts_hidden() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let main = &config["app"]["windows"][0];
        assert_eq!(main["label"], super::WINDOW_LABEL);
        assert_eq!(main["visible"], false);
    }

    #[test]
    fn the_window_state_plugin_is_gone() {
        let manifest = include_str!("../Cargo.toml");
        assert!(!manifest.contains("tauri-plugin-window-state"));
        assert!(!include_str!("lib.rs").contains("tauri_plugin_window_state"));
    }
}
