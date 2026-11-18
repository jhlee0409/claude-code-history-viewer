//! Several app windows (issue #656). Desktop builder only.
//!
//! - **Labels.** The window from `tauri.conf.json` is `main`; every window
//!   opened since is `window-<n>` ([`next_window_label`]): the lowest number
//!   from 2 not in use, so a label names a slot whose saved frame
//!   (`window_state`) comes back when a window of that number opens again.
//!   The `default` capability grants `main` and `window-*`.
//! - **What each window owns.** Its page: navigation, tabs, selection - each
//!   web view runs its own store. Shared by the process: the backend caches,
//!   the one file watcher (its events go to every window), user metadata and
//!   settings (each change is announced to every window).
//! - **The window in front** ([`front_label`]): the window that gained focus
//!   last and is still open, else `main`, else any. Native menu events, a
//!   second launch's session hint and macOS `Opened` URLs go to it alone; the
//!   menu shows its state (`menu::window_in_front`). A second launch still
//!   focuses the existing app: it brings that window forward, it opens none.
//! - **Opening** ([`open_window`]): a copy of the `main` window's
//!   configuration (title bar, sizes, hidden until its frame is in place),
//!   optionally with a [`WindowTarget`] - a project, or a session - that the
//!   new page asks for once its projects are loaded ([`get_window_target`]).
//! - **Relaunch.** Only `main` is created at launch, with its saved frame and
//!   tabs; the other windows of the last run are not reopened.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, PoisonError};
use tauri::{AppHandle, Manager, Runtime, State, WebviewWindow, Window, WindowEvent};

/// The window created at launch (`tauri.conf.json`).
pub const MAIN_WINDOW: &str = "main";

/// Every other window's label: this prefix and a number from 2.
const SECONDARY_PREFIX: &str = "window-";

/// Longest path or id a target may carry.
const MAX_TARGET_FIELD: usize = 4096;

/// Longest provider id a target may carry.
const MAX_PROVIDER_ID: usize = 64;

/// The number of a secondary window label (`window-2` -> 2); `None` for
/// `main` and anything that is not exactly such a label.
pub fn window_number(label: &str) -> Option<u32> {
    let digits = label.strip_prefix(SECONDARY_PREFIX)?;
    if digits.is_empty() || digits.starts_with('0') || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok().filter(|n| *n >= 2)
}

/// The label for a new window: `window-<n>` with the lowest `n` from 2 that
/// no open window uses.
pub fn next_window_label<'a>(open: impl IntoIterator<Item = &'a str>) -> String {
    let used: HashSet<u32> = open.into_iter().filter_map(window_number).collect();
    // Of the `used.len() + 1` numbers from 2, at most `used.len()` are taken.
    let last = 2u32.saturating_add(u32::try_from(used.len()).unwrap_or(u32::MAX));
    let number = (2..=last).find(|n| !used.contains(n)).unwrap_or(last);
    format!("{SECONDARY_PREFIX}{number}")
}

/// A project, as the frontend names it (`ProjectRef` in `navigation/place.ts`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRef {
    pub provider: String,
    pub path: String,
}

/// A session, as the frontend names it (`SessionRef` in `navigation/place.ts`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRef {
    pub provider: String,
    pub file_path: String,
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actual_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
}

/// What a new window opens (`WindowTarget` in `src/navigation/windows.ts`).
/// Only handed back to the page that asks for it: nothing here touches the
/// file system.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WindowTarget {
    Project { project: ProjectRef },
    Session { session: SessionRef },
}

fn check_provider(provider: &str) -> Result<(), String> {
    let valid = !provider.is_empty()
        && provider.len() <= MAX_PROVIDER_ID
        && provider
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if valid {
        Ok(())
    } else {
        Err(format!("invalid provider id: {provider:?}"))
    }
}

fn check_field(name: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("{name} is empty"));
    }
    if value.len() > MAX_TARGET_FIELD || value.contains('\0') {
        return Err(format!("{name} is not a valid value"));
    }
    Ok(())
}

impl WindowTarget {
    /// Rejects a target the frontend could not have built from a listed
    /// project or session.
    pub fn validate(&self) -> Result<(), String> {
        match self {
            WindowTarget::Project { project } => {
                check_provider(&project.provider)?;
                check_field("project path", &project.path)
            }
            WindowTarget::Session { session } => {
                check_provider(&session.provider)?;
                check_field("session file path", &session.file_path)?;
                check_field("session id", &session.session_id)?;
                if let Some(id) = &session.actual_session_id {
                    check_field("actual session id", id)?;
                }
                if let Some(path) = &session.project_path {
                    check_field("project path", path)?;
                }
                Ok(())
            }
        }
    }
}

#[derive(Debug, Default)]
struct Inner {
    /// The target each opened window was created for, until it closes.
    targets: HashMap<String, WindowTarget>,
    /// Windows by focus, the one focused last at the end.
    focus_order: Vec<String>,
}

impl Inner {
    fn focused(&mut self, label: &str) {
        self.focus_order.retain(|l| l != label);
        self.focus_order.push(label.to_string());
    }

    fn closed(&mut self, label: &str) {
        self.focus_order.retain(|l| l != label);
        self.targets.remove(label);
    }

    /// The window in front among `open`: focused last, else `main`, else the
    /// first (in label order, so the choice is stable).
    fn front<'a>(&self, open: &'a [String]) -> Option<&'a String> {
        self.focus_order
            .iter()
            .rev()
            .find_map(|label| open.iter().find(|o| *o == label))
            .or_else(|| open.iter().find(|o| *o == MAIN_WINDOW))
            .or_else(|| open.iter().min())
    }
}

/// Which window is in front, and what each opened window was opened for.
#[derive(Debug, Default)]
pub struct AppWindows {
    inner: Mutex<Inner>,
    /// Held while a new window is labelled and built, so two `open_window`
    /// calls never pick the same label. Never taken on the main thread.
    opening: Mutex<()>,
}

impl AppWindows {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The target window `label` was opened for, if any.
    pub fn target(&self, label: &str) -> Option<WindowTarget> {
        self.lock().targets.get(label).cloned()
    }
}

/// The label of the window in front, if a window is open.
pub fn front_label<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let open: Vec<String> = app.webview_windows().into_keys().collect();
    let windows = app.state::<AppWindows>();
    let inner = windows.lock();
    inner.front(&open).cloned()
}

/// The window in front, if one is open.
pub fn front_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    front_label(app).and_then(|label| app.get_webview_window(&label))
}

/// Brings the window in front forward (un-minimized, focused) - a second
/// launch's visible answer. Returns its label.
pub fn focus_front_window<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let window = front_window(app)?;
    let _ = window.unminimize();
    let _ = window.set_focus();
    Some(window.label().to_string())
}

/// Every saved change of user metadata (settings, names, favourites, hidden
/// projects) is announced to every window, in the order the saves were made,
/// so each window's copy - what its next edit starts from - stays current.
pub fn announce_metadata_saves<R: Runtime>(app: &AppHandle<R>) {
    use crate::commands::metadata::{MetadataState, USER_METADATA_CHANGED_EVENT};
    use tauri::Emitter;
    let handle = app.clone();
    app.state::<MetadataState>().observe_saves(move |metadata| {
        if let Err(error) = handle.emit(USER_METADATA_CHANGED_EVENT, metadata) {
            log::warn!("metadata change not announced: {error}");
        }
    });
}

/// The app-wide window-event hook (`Builder::on_window_event`).
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    let app = window.app_handle();
    let label = window.label();
    match event {
        WindowEvent::Focused(true) => {
            app.state::<AppWindows>().lock().focused(label);
            crate::menu::window_in_front(app, label);
        }
        WindowEvent::Destroyed => {
            app.state::<AppWindows>().lock().closed(label);
            crate::menu::window_closed(app, label);
        }
        _ => {}
    }
}

/// Opens a new window like `main`, in front, optionally on `target`.
/// Returns its label. Async: building a window from a synchronous command
/// deadlocks on Windows.
#[tauri::command]
pub async fn open_window(
    app: AppHandle,
    window: WebviewWindow,
    windows: State<'_, AppWindows>,
    target: Option<WindowTarget>,
) -> Result<String, String> {
    if let Some(target) = &target {
        target.validate()?;
    }
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == MAIN_WINDOW)
        .cloned()
        .ok_or("no `main` window configuration")?;
    let _opening = windows
        .opening
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    let open: Vec<String> = app.webview_windows().into_keys().collect();
    let label = next_window_label(open.iter().map(String::as_str));
    config.label.clone_from(&label);
    // Shown by `window_state` once its frame is in place.
    config.visible = false;
    if let Some(target) = target {
        windows.lock().targets.insert(label.clone(), target);
    }
    let built = tauri::WebviewWindowBuilder::from_config(&app, &config)
        .and_then(tauri::WebviewWindowBuilder::build);
    let created = match built {
        Ok(created) => created,
        Err(error) => {
            windows.lock().closed(&label);
            return Err(format!("new window not opened: {error}"));
        }
    };
    crate::window_state::restore_and_track_window(&app, &created, Some(&window));
    log::info!("window {label} opened from {}", window.label());
    Ok(label)
}

/// What the calling window was opened for: `None` for `main` and a window
/// opened without a target.
#[tauri::command]
pub fn get_window_target(
    window: WebviewWindow,
    windows: State<'_, AppWindows>,
) -> Option<WindowTarget> {
    windows.target(window.label())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every window this app opens gets the app's permissions (a window the
    /// capability misses gets no IPC at all), and a page may announce a
    /// setting change to the other windows.
    #[test]
    fn the_capability_covers_every_window_this_app_opens() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let patterns: Vec<&str> = capability["windows"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(serde_json::Value::as_str)
            .collect();
        let covered = |label: &str| {
            patterns.iter().any(|pattern| {
                *pattern == label
                    || pattern
                        .strip_suffix('*')
                        .is_some_and(|prefix| label.starts_with(prefix))
            })
        };
        let second = next_window_label([MAIN_WINDOW]);
        for label in [MAIN_WINDOW, second.as_str(), "window-17"] {
            assert!(covered(label), "{label} has no capability");
        }
        assert!(capability["permissions"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("core:event:allow-emit")));
    }

    #[test]
    fn secondary_labels_take_the_lowest_free_number_from_two() {
        assert_eq!(next_window_label(["main"]), "window-2");
        assert_eq!(next_window_label(["main", "window-2"]), "window-3");
        assert_eq!(
            next_window_label(["main", "window-3", "window-2"]),
            "window-4"
        );
        // A closed window's slot is used again.
        assert_eq!(next_window_label(["main", "window-3"]), "window-2");
        // With `main` closed the next window is still a secondary one.
        assert_eq!(next_window_label(["window-2"]), "window-3");
        assert_eq!(next_window_label([]), "window-2");
    }

    #[test]
    fn only_canonical_secondary_labels_have_a_number() {
        assert_eq!(window_number("window-2"), Some(2));
        assert_eq!(window_number("window-15"), Some(15));
        for other in [
            "main",
            "window-1",
            "window-0",
            "window-02",
            "window-",
            "window-x",
            "window-2a",
            "window--2",
            "window-+2",
            "",
        ] {
            assert_eq!(window_number(other), None, "{other:?}");
        }
    }

    fn open(labels: &[&str]) -> Vec<String> {
        labels.iter().map(|l| (*l).to_string()).collect()
    }

    #[test]
    fn the_window_in_front_is_the_last_focused_one_still_open() {
        let mut inner = Inner::default();
        let windows = open(&["main", "window-2", "window-3"]);
        assert_eq!(inner.front(&windows).map(String::as_str), Some("main"));
        inner.focused("window-3");
        inner.focused("window-2");
        assert_eq!(inner.front(&windows).map(String::as_str), Some("window-2"));
        inner.focused("window-3");
        assert_eq!(inner.front(&windows).map(String::as_str), Some("window-3"));
        // Closed: the one focused before it.
        inner.closed("window-3");
        let windows = open(&["main", "window-2"]);
        assert_eq!(inner.front(&windows).map(String::as_str), Some("window-2"));
        // A window gone without a `Destroyed` yet is skipped too.
        assert_eq!(
            inner.front(&open(&["main"])).map(String::as_str),
            Some("main")
        );
        // `main` closed, nothing focused: the first secondary window.
        let mut fresh = Inner::default();
        assert_eq!(
            fresh
                .front(&open(&["window-3", "window-2"]))
                .map(String::as_str),
            Some("window-2")
        );
        fresh.closed("window-2");
        assert_eq!(fresh.front(&[]), None);
    }

    #[test]
    fn a_closed_window_s_target_is_dropped() {
        let windows = AppWindows::default();
        let target = WindowTarget::Project {
            project: ProjectRef {
                provider: "claude".into(),
                path: "/p".into(),
            },
        };
        windows
            .lock()
            .targets
            .insert("window-2".into(), target.clone());
        assert_eq!(windows.target("window-2"), Some(target));
        assert_eq!(windows.target("main"), None);
        windows.lock().closed("window-2");
        assert_eq!(windows.target("window-2"), None);
    }

    #[test]
    fn targets_parse_and_serialize_as_the_frontend_writes_them() {
        let json = serde_json::json!({
            "kind": "session",
            "session": {
                "provider": "codex",
                "filePath": "/home/u/.codex/sessions/a.jsonl",
                "sessionId": "abc",
                "projectPath": "codex:///work/repo"
            }
        });
        let target: WindowTarget = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(
            target,
            WindowTarget::Session {
                session: SessionRef {
                    provider: "codex".into(),
                    file_path: "/home/u/.codex/sessions/a.jsonl".into(),
                    session_id: "abc".into(),
                    actual_session_id: None,
                    project_path: Some("codex:///work/repo".into()),
                }
            }
        );
        assert_eq!(serde_json::to_value(&target).unwrap(), json);
        assert!(target.validate().is_ok());

        let project: WindowTarget = serde_json::from_value(serde_json::json!({
            "kind": "project",
            "project": { "provider": "claude", "path": "/Users/u/.claude/projects/-repo" }
        }))
        .unwrap();
        assert!(project.validate().is_ok());
        assert!(
            serde_json::from_value::<WindowTarget>(serde_json::json!({ "kind": "folder" }))
                .is_err()
        );
    }

    #[test]
    fn targets_with_bad_fields_are_refused() {
        let project = |provider: &str, path: &str| WindowTarget::Project {
            project: ProjectRef {
                provider: provider.into(),
                path: path.into(),
            },
        };
        assert!(project("claude", "").validate().is_err());
        assert!(project("", "/p").validate().is_err());
        assert!(project("../x", "/p").validate().is_err());
        assert!(project(&"a".repeat(65), "/p").validate().is_err());
        assert!(project("claude", "/p\0").validate().is_err());
        assert!(project("claude", &"p".repeat(4097)).validate().is_err());
        let session = WindowTarget::Session {
            session: SessionRef {
                provider: "claude".into(),
                file_path: "/s.jsonl".into(),
                session_id: String::new(),
                actual_session_id: None,
                project_path: None,
            },
        };
        assert!(session.validate().is_err());
    }
}
